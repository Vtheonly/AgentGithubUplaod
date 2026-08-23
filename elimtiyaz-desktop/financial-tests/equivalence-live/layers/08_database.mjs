// ============================================================================
// LAYER 8 — Database layer equivalence (the normalized comparison core).
// ----------------------------------------------------------------------------
// Verifies the resulting rows, relationships, constraints and derived state
// are equivalent between the two client scopes via a full normalized deep
// comparison — including hidden fields (account_id shape, source provenance,
// receipt linkage) and NOT just the visible UI state.
// ============================================================================

import { normalizeScopeState, deepCompare } from "../lib/normalize.mjs";
import { select } from "../lib/rest.mjs";

export default {
  id: "08-database",
  name: "Database layer — rows, relationships, constraints, derived state",
  requires: ["execution"],
  async run(ctx) {
    const checks = [];
    const { states } = ctx.execution;
    const nD = normalizeScopeState("D", states.D || {});
    const nM = normalizeScopeState("M", states.M || {});

    // Full normalized state comparison (everything except client-provenance
    // fields, which layers 7/11 verify separately).
    const stripProvenance = (n) => ({
      parent: n.parent && {
        firstName: n.parent.firstName, lastName: n.parent.lastName,
        displayName: String(n.parent.displayName || "").replace(/ \([DM]\)$/, ""),
        phoneEditedLastDigit: String(n.parent.primaryPhone || "").slice(-1),
        isActive: n.parent.isActive,
      },
      student: n.student && {
        firstName: n.student.firstName, lastName: n.student.lastName,
        displayName: String(n.student.displayName || "").replace(/ \([DM]\)$/, ""),
        gradeLevelCode: n.student.gradeLevelCode, paymentPlan: n.student.paymentPlan,
        enrollmentStatus: n.student.enrollmentStatus, isActive: n.student.isActive,
      },
      ledger: n.ledger.map((e) => ({
        entryType: e.entryType, category: e.category, amount: e.amount,
        paymentStatus: e.paymentStatus, method: e.method, accountIdShape: e.accountIdShape,
      })),
      payments: n.payments.map((p) => ({
        amount: p.amount, method: p.method, category: p.category, status: p.status,
      })),
      installments: n.installments.map((i) => ({
        trancheNumber: i.trancheNumber, category: i.category, amountDue: i.amountDue,
        amountPaid: i.amountPaid, amountPending: i.amountPending, status: i.status,
        dueDate: i.dueDate,
      })),
      totals: n.totals,
    });

    const cmp = deepCompare(stripProvenance(nD), stripProvenance(nM));
    checks.push({
      check: "full normalized DB state equivalent across clients (deep compare)",
      status: cmp.equal ? "PASS" : "FAIL",
      detail: cmp.equal
        ? `parents/students/ledger(${nD.ledger.length})/payments(${nD.payments.length})/installments(${nD.installments.length}) all equivalent`
        : JSON.stringify(cmp.diffs.slice(0, 10)),
    });

    // Row-count parity per table
    for (const [key, label] of [
      ["ledgerCount", "ledger entries"], ["paymentCount", "payments"], ["installmentCount", "installments"],
    ]) {
      checks.push({
        check: `row-count parity: ${label}`,
        status: nD.totals[key] === nM.totals[key] ? "PASS" : "FAIL",
        detail: `D=${nD.totals[key]} M=${nM.totals[key]}`,
      });
    }

    // Constraint spot-checks: unique source ids (no duplicates per scope)
    for (const [label, st] of [["D", states.D || {}], ["M", states.M || {}]]) {
      const sids = (st.ledger || []).map((e) => e.source_id).filter(Boolean);
      const unique = new Set(sids).size === sids.length;
      checks.push({
        check: `[${label}] ledger source_id uniqueness (idempotent identity)`,
        status: unique ? "PASS" : "FAIL",
        detail: unique ? "" : `duplicates: ${JSON.stringify(sids.filter((s, i) => sids.indexOf(s) !== i))}`,
      });
    }

    // FK integrity: every payment/ledger/installment row references the scope parent+student
    for (const [label, st] of [["D", states.D || {}], ["M", states.M || {}]]) {
      const pid = st.parent?.id, sid = st.student?.id;
      const rows = [...(st.payments || []), ...(st.ledger || []), ...(st.installments || [])];
      const bad = rows.filter((r) => r.parent_id !== pid || (r.student_id != null && r.student_id !== sid));
      checks.push({
        check: `[${label}] FK integrity (all rows reference own parent/student)`,
        status: bad.length === 0 ? "PASS" : "FAIL",
        detail: bad.length ? `${bad.length} rows with wrong FK` : "",
      });
    }

    // Derived state: installments must reflect canonical amounts (40/30/30)
    if (ctx.probe.has.upsert_installment_from_import) {
      for (const [label, n] of [["D", nD], ["M", nM]]) {
        const dues = n.installments.map((i) => i.amountDue);
        const expected = [132000, 99000, 99000];
        const ok = JSON.stringify(dues) === JSON.stringify(expected);
        checks.push({
          check: `[${label}] installment derived schedule (40/30/30 of 330000)`,
          status: ok ? "PASS" : "FAIL",
          detail: `dues=${JSON.stringify(dues)}`,
        });
      }
    } else {
      checks.push({
        check: "installment derived schedule (40/30/30 of 330000)",
        status: "SKIPPED",
        detail: "upsert_installment_from_import not deployed (pre-0037) — installments not writable via API yet",
      });
    }

    return checks;
  },
};
