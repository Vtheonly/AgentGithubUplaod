// ============================================================================
// lib/executor.mjs — Canonical scenario executor.
// ----------------------------------------------------------------------------
// Executes the SAME canonical family scenario through both client adapters,
// each in its own isolated scope (D / M), and collects the complete resulting
// DB state per scope. Layer modules then compare their aspect of the result.
//
// Execution order per scope (mirrors the user's canonical-input diagram):
//   parent create -> student create -> tuition charge (+3 installments)
//   -> payment 1 (full tranche 1) -> payment 2 (partial tranche 2)
//   -> adjustment (credit) -> student grade edit -> parent phone edit
// ============================================================================

import { canonicalFamily } from "./canon.mjs";
import { DesktopClient, MobileClient } from "./clients.mjs";
import { select } from "./rest.mjs";
import { env } from "./env.mjs";

export async function executeCanonicalScenario({ probe, index = 1 } = {}) {
  const traces = { D: [], M: [] };
  const states = {};

  for (const scopeLetter of ["D", "M"]) {
    const client = scopeLetter === "D" ? new DesktopClient(probe) : new MobileClient(probe);
    const canon = canonicalFamily(scopeLetter, { index });
    const trace = traces[scopeLetter];
    const ctx = { canon, parentId: null, studentId: null, paymentIds: [] };

    const step = async (name, fn) => {
      try {
        const r = await fn();
        trace.push({ step: name, ok: r?.ok !== false && !(r?.payment && r.payment.ok === false), detail: summarize(r) });
        return r;
      } catch (e) {
        trace.push({ step: name, ok: false, detail: String(e?.message || e).slice(0, 200) });
        return { ok: false, error: e };
      }
    };

    // 1. parent
    await step("parent.create", () => client.upsertParent(canon.parent)).then((r) => {
      if (r?.ok && Array.isArray(r.data) && r.data[0]?.out_parent_id) {
        ctx.parentId = r.data[0].out_parent_id;
      } else if (r?.ok && Array.isArray(r.data) && r.data[0]?.parent_id) {
        ctx.parentId = r.data[0].parent_id;
      }
    });
    if (!ctx.parentId) {
      trace.push({ step: "ABORT", ok: false, detail: "parent create failed — remaining steps skipped" });
      states[scopeLetter] = await collectState(ctx);
      continue;
    }

    // 2. student
    await step("student.create", async () => {
      const ref = client instanceof MobileClient
        ? (client.refMode === "code" ? canon.parent.parentCode : ctx.parentId)
        : ctx.parentId;
      return client.upsertStudent(canon.student, ref);
    }).then((r) => {
      const row = Array.isArray(r?.data) ? r.data[0] : null;
      ctx.studentId = row?.out_student_id || row?.student_id || null;
    });
    if (!ctx.studentId) {
      trace.push({ step: "ABORT", ok: false, detail: "student create failed — remaining steps skipped" });
      states[scopeLetter] = await collectState(ctx);
      continue;
    }

    // 3. tuition charge + installments
    const charge = canon.charges[0];
    await step("ledger.charge", () =>
      client.pushCharge({
        parentId: ctx.parentId,
        studentId: ctx.studentId,
        category: charge.category,
        amount: charge.amount,
        description: charge.description,
        sourceId: `EQTEST-${scopeLetter}${index}-DEVIS`,
        entryNumber: `EQLED-${scopeLetter}${index}-CHARGE`,
      }));

    for (let t = 0; t < 3; t++) {
      await step(`installment.t${t + 1}`, () =>
        client.pushInstallment({
          parentId: ctx.parentId,
          parentCode: canon.parent.parentCode,
          studentId: ctx.studentId,
          trancheNumber: t + 1,
          amountDue: charge.tranches[t],
          amountPaid: 0,
          amountPending: 0,
          dueDate: charge.dueDates[t],
          status: "unpaid",
          category: "tuition",
          paymentPlan: "tranches",
          sourceId: `EQTEST-${scopeLetter}${index}:tuition:T${t + 1}`,
        }));
    }

    // 4. payments
    let payIdx = 0;
    for (const p of canon.payments) {
      payIdx++;
      await step(`payment.collect#${payIdx}`, () =>
        client.pushPayment({
          parentId: ctx.parentId,
          parentCode: canon.parent.parentCode,
          studentId: ctx.studentId,
          paymentNumber: `EQPAY-${scopeLetter}${index}-${payIdx}`,
          amount: p.amount,
          method: p.method,
          category: p.category,
          description: p.description,
          collectedAt: p.collectedAt,
        }));
    }

    // 5. adjustment
    await step("ledger.adjust", () =>
      client.pushAdjustment({
        parentId: ctx.parentId,
        parentCode: canon.parent.parentCode,
        studentId: ctx.studentId,
        amount: canon.adjustment.amount,
        reason: canon.adjustment.reason,
        description: canon.adjustment.description,
        sourceId: `EQTEST-${scopeLetter}${index}-ADJ`,
        entryNumber: `EQLED-${scopeLetter}${index}-ADJ`,
      }));

    // 6. edits (both clients re-push the full entity — idempotent upsert contract)
    await step("student.edit.grade", () => {
      const parentRef = client instanceof MobileClient && client.refMode === "code"
        ? canon.parent.parentCode : ctx.parentId;
      return client.updateStudentGrade(canon.student, parentRef, canon.edits.studentGradeLevelCode);
    });
    await step("parent.edit.phone", () => {
      const newPhone = canon.parent.primaryPhone.slice(0, 9) + canon.edits.parentPhoneSuffix;
      return client.updateParentPhone(canon.parent, newPhone);
    });

    states[scopeLetter] = await collectState(ctx);
  }

  return { traces, states, index };
}

export async function collectState(ctx) {
  const state = { parent: null, student: null, ledger: [], payments: [], installments: [] };
  if (!ctx.parentId) return state;
  const p = await select("parents", `select=*&id=eq.${ctx.parentId}`);
  state.parent = p.ok ? p.data?.[0] ?? null : null;
  if (ctx.studentId) {
    const s = await select("students", `select=*&id=eq.${ctx.studentId}`);
    state.student = s.ok ? s.data?.[0] ?? null : null;
  }
  const led = await select("ledger_entries", `select=*&parent_id=eq.${ctx.parentId}&order=created_at.asc`);
  if (led.ok) state.ledger = led.data || [];
  const pay = await select("payments", `select=*&parent_id=eq.${ctx.parentId}&order=created_at.asc`);
  if (pay.ok) state.payments = pay.data || [];
  const inst = await select("installments", `select=*&parent_id=eq.${ctx.parentId}&order=tranche_number.asc`);
  if (inst.ok) state.installments = inst.data || [];
  return state;
}

function summarize(r) {
  if (!r) return "no result";
  if (r.skipped) return `SKIPPED: ${r.error}`;
  if (r.ok === false) return `ERROR: ${r.error?.message || String(r.error).slice(0, 160)}`;
  const d = Array.isArray(r.data) ? r.data[0] : r.data;
  return d ? JSON.stringify(Object.values(d).slice(0, 3)).slice(0, 120) : "ok";
}
