// ============================================================================
// LAYER 7 — API / service layer equivalence.
// ----------------------------------------------------------------------------
// Verifies both clients send semantically equivalent operations and receive
// consistent results: identical RPC contracts, identical return shapes
// (out_*_id, out_was_inserted), and identical idempotency semantics on
// re-submission of the same canonical operation.
// ============================================================================

import { rpc } from "../lib/rest.mjs";
import { env } from "../lib/env.mjs";
import { canonicalFamily } from "../lib/canon.mjs";

export default {
  id: "07-api",
  name: "API/service layer — semantically equivalent operations & responses",
  requires: [],
  async run(ctx) {
    const checks = [];
    const canon = canonicalFamily("D", { index: 99 }); // dedicated API-layer probe

    // 1. Same RPC callable by both clients (the shared contract) — call the
    //    parent upsert twice with IDENTICAL canonical values: first call
    //    inserts, second call updates (out_was_inserted flips true -> false).
    const first = await rpc("upsert_parent_from_import", {
      p_tenant_id: env.tenantId,
      p_parent_code: canon.parent.parentCode,
      p_first_name: canon.parent.firstName,
      p_last_name: canon.parent.lastName,
      p_display_name: canon.parent.displayName,
      p_primary_phone: canon.parent.primaryPhone,
    });
    const second = await rpc("upsert_parent_from_import", {
      p_tenant_id: env.tenantId,
      p_parent_code: canon.parent.parentCode,
      p_first_name: canon.parent.firstName,
      p_last_name: canon.parent.lastName,
      p_display_name: canon.parent.displayName,
      p_primary_phone: canon.parent.primaryPhone,
    });

    checks.push({
      check: "RPC responds with canonical return shape (out_parent_id, out_was_inserted)",
      status: first.ok && Array.isArray(first.data) && first.data[0]?.out_parent_id ? "PASS" : "FAIL",
      detail: first.ok ? "" : String(first.error?.message).slice(0, 160),
    });

    if (first.ok && second.ok && Array.isArray(first.data) && Array.isArray(second.data)) {
      const insertedFirst = first.data[0]?.out_was_inserted;
      const insertedSecond = second.data[0]?.out_was_inserted;
      checks.push({
        check: "idempotency contract: re-submit flips out_was_inserted true -> false",
        status: insertedFirst === true && insertedSecond === false ? "PASS" : "FAIL",
        detail: `first=${insertedFirst} second=${insertedSecond}`,
      });
      checks.push({
        check: "idempotency contract: same stable row id across re-submits",
        status: first.data[0]?.out_parent_id === second.data[0]?.out_parent_id ? "PASS" : "FAIL",
        detail: `${first.data[0]?.out_parent_id} vs ${second.data[0]?.out_parent_id}`,
      });
    }

    // 2. Mobile-style ref resolution (0037): when deployed, upsert_student
    //    accepts parent CODE (what Android sends). Verify the contract works
    //    from a "mobile perspective" using the same parent created above.
    if (first.ok && Array.isArray(first.data) && ctx.probe.has.upsert_student_from_import_text_parent) {
      const parentId = first.data[0].out_parent_id;
      const byCode = await rpc("upsert_student_from_import", {
        p_tenant_id: env.tenantId,
        p_student_code: "ELV-2026-EQTEST-API99",
        p_parent_id: canon.parent.parentCode, // mobile sends the CODE
        p_first_name: "ApiProbe",
        p_last_name: "Eqtest",
        p_grade_level_code: "5ap",
      });
      const byUuid = await rpc("upsert_student_from_import", {
        p_tenant_id: env.tenantId,
        p_student_code: "ELV-2026-EQTEST-API99",
        p_parent_id: parentId, // desktop sends the UUID
        p_first_name: "ApiProbe",
        p_last_name: "Eqtest",
        p_grade_level_code: "5ap",
      });
      if (byCode.ok && byUuid.ok) {
        const sameStudent = byCode.data[0]?.out_student_id === byUuid.data[0]?.out_student_id;
        checks.push({
          check: "ref-tolerance: parent-code ref and uuid ref resolve to SAME student",
          status: sameStudent ? "PASS" : "FAIL",
          detail: `code->${byCode.data[0]?.out_student_id} uuid->${byUuid.data[0]?.out_student_id}`,
        });
      } else {
        checks.push({
          check: "ref-tolerance: parent-code ref accepted (0037 contract)",
          status: byCode.ok ? "PASS" : "FAIL",
          detail: String(byCode.error?.message).slice(0, 160),
        });
      }
    } else {
      checks.push({
        check: "ref-tolerance (0037 parent-code refs)",
        status: "SKIPPED",
        detail: "0037 RPCs not deployed — mobile must send UUID refs pre-migration",
      });
    }

    // cleanup API probe entities
    if (!ctx.dryRun) {
      await rpc("upsert_parent_from_import", {
        p_tenant_id: env.tenantId, p_parent_code: canon.parent.parentCode,
        p_first_name: "DELETED", p_last_name: "DELETED", p_is_active: false,
      }).catch(() => {});
      // hard delete via REST on the probe rows
      try {
        const { del, select } = await import("../lib/rest.mjs");
        const students = await select("students", `select=id&student_code=eq.ELV-2026-EQTEST-API99`);
        if (students.ok && students.data?.length) await del("students", `?student_code=eq.ELV-2026-EQTEST-API99`);
        const parents = await select("parents", `select=id&parent_code=eq.${canon.parent.parentCode}`);
        if (parents.ok && parents.data?.length) {
          const pid = parents.data[0].id;
          await del("ledger_entries", `?parent_id=eq.${pid}`);
          await del("payments", `?parent_id=eq.${pid}`);
          await del("installments", `?parent_id=eq.${pid}`);
          await del("parents", `?id=eq.${pid}`);
        }
      } catch { /* best effort */ }
    }

    return checks;
  },
};
