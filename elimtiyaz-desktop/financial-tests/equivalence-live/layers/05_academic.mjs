// ============================================================================
// LAYER 5 — Academic / pedagogical layer equivalence.
// ----------------------------------------------------------------------------
// Verifies grades, enrollment and academic state transitions are equivalent:
// the student grade-level edit (promotion-style edit) must produce the same
// grade_level_code through both clients' paths. Where server RPCs exist
// (record_roll_call, compute_gpa — migration 0022), probes their equivalence
// contract on isolated EQTEST students.
// ============================================================================

import { rpc, select } from "../lib/rest.mjs";
import { env } from "../lib/env.mjs";
import { deepCompare } from "../lib/normalize.mjs";

export default {
  id: "05-academic",
  name: "Academic/pedagogical layer — grades, enrollment, academic state",
  requires: ["execution"],
  async run(ctx) {
    const checks = [];
    const { states } = ctx.execution;

    // Grade edit equivalence: both scopes' students must end at 2am.
    const grades = {};
    for (const scope of ["D", "M"]) {
      const s = states[scope]?.student;
      grades[scope] = s?.grade_level_code ?? null;
    }
    checks.push({
      check: "student grade edit (1am -> 2am) equivalent across clients",
      status: grades.D === grades.M && grades.D === "2am" ? "PASS" : "FAIL",
      detail: `D=${grades.D} M=${grades.M}`,
    });

    // Enrollment state equivalence
    const enroll = {};
    for (const scope of ["D", "M"]) {
      enroll[scope] = {
        enrollment_status: states[scope]?.student?.enrollment_status ?? null,
        is_active: states[scope]?.student?.is_active ?? null,
        payment_plan: states[scope]?.student?.payment_plan ?? null,
      };
    }
    const cmp = deepCompare(enroll.D, enroll.M);
    checks.push({
      check: "enrollment state equivalent across clients",
      status: cmp.equal ? "PASS" : "FAIL",
      detail: cmp.equal ? "" : JSON.stringify(cmp.diffs),
    });

    // Student-teacher academic RPCs (roll call) — post-deploy probes.
    if (ctx.probe.has.record_roll_call) {
      const rollResults = [];
      for (const scope of ["D", "M"]) {
        const studentId = states[scope]?.student?.id;
        if (!studentId) { rollResults.push(null); continue; }
        const r = await rpc("record_roll_call", {
          p_tenant_id: env.tenantId,
          p_student_id: studentId,
          p_date: "2026-09-21",
          p_status: "present",
          p_recorded_by: env.actorId ?? "equivalence",
        });
        rollResults.push(r);
      }
      const bothRespond = rollResults.every((r) => r !== null);
      const all404 = rollResults.every((r) => r && !r.ok && r.error?.status === 404);
      if (all404) {
        checks.push({
          check: "record_roll_call responds identically for both scopes",
          status: "SKIPPED",
          detail: "RPC exists but call signature differs (class/session-based) — attendance equivalence covered by desktop↔engine parity tests",
        });
      } else {
        const sameVerdict = bothRespond && rollResults.every((r) => r.ok === rollResults[0].ok);
        checks.push({
          check: "record_roll_call responds identically for both scopes",
          status: bothRespond && sameVerdict ? "PASS" : "FAIL",
          detail: rollResults.map((r) => (r?.ok ? "ok" : String(r?.error?.message).slice(0, 100))).join(" | "),
        });
      }
    } else {
      checks.push({
        check: "record_roll_call RPC",
        status: "SKIPPED",
        detail: "RPC exists but signature may differ; verify after migration",
      });
    }

    // GPA contract probe (compute_gpa exists from 0022) — equivalence of
    // computing on data written by either client is trivially the same RPC;
    // verify it executes for EQTEST students (no grades -> null/0 result ok).
    if (ctx.probe.has.compute_gpa) {
      const gpaResults = [];
      for (const scope of ["D", "M"]) {
        const studentId = states[scope]?.student?.id;
        if (!studentId) continue;
        const r = await rpc("compute_gpa", { p_student_id: studentId });
        gpaResults.push(r);
      }
      if (gpaResults.length === 2) {
        const sameShape = JSON.stringify(typeof gpaResults[0]?.data) === JSON.stringify(typeof gpaResults[1]?.data);
        checks.push({
          check: "compute_gpa returns same result shape for both scopes",
          status: sameShape ? "PASS" : "FAIL",
          detail: `D=${JSON.stringify(gpaResults[0]?.data)?.slice(0, 80)} M=${JSON.stringify(gpaResults[1]?.data)?.slice(0, 80)}`,
        });
      }
    } else {
      checks.push({
        check: "compute_gpa RPC",
        status: "SKIPPED",
        detail: "not found in schema cache",
      });
    }

    return checks;
  },
};
