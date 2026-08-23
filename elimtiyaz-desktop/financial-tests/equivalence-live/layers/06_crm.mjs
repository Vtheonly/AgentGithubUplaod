// ============================================================================
// LAYER 6 — CRM / domain layer equivalence.
// ----------------------------------------------------------------------------
// Verifies students, parents, relationships, notes/history and domain-entity
// operations produce equivalent domain state through both clients: parent
// profile fields, student profile fields, parent-child relationship integrity,
// soft-delete/active flags, and phone-edit persistence.
// ============================================================================

import { deepCompare } from "../lib/normalize.mjs";

export default {
  id: "06-crm",
  name: "CRM/domain layer — students, parents, relationships, history",
  requires: ["execution"],
  run(ctx) {
    const checks = [];
    const { states } = ctx.execution;
    const D = states.D || {}, M = states.M || {};

    // Parent domain equivalence (after phone edit: last digit -> 9)
    // Phones differ per scope BY DESIGN (collision avoidance); what must be
    // equivalent is the EDIT BEHAVIOR: both scopes' canonical edit replaced
    // the last digit with "9".
    const stripScope = (s) => String(s ?? "")
      .replace(/ \([DM]\)$/, "")
      .replace(/-([dm])@/, "-@"); // email carries the scope marker by design
    const parentFields = (p) => p ? ({
      firstName: p.first_name,
      lastName: p.last_name,
      displayName: stripScope(p.display_name),
      phoneEditedLastDigit: (p.primary_phone || "").slice(-1),
      phoneShapeOk: /^0990(10|20)\d{6}$/.test(p.primary_phone || ""),
      email: stripScope(p.email),
      isActive: p.is_active,
    }) : null;
    const pCmp = deepCompare(parentFields(D.parent), parentFields(M.parent));
    checks.push({
      check: "parent domain fields equivalent after canonical edit (incl. phone edit)",
      status: pCmp.equal ? "PASS" : "FAIL",
      detail: pCmp.equal ? "" : JSON.stringify(pCmp.diffs.slice(0, 6)),
    });

    // Student domain equivalence
    const studentFields = (s) => s ? ({
      firstName: s.first_name,
      lastName: s.last_name,
      displayName: stripScope(s.display_name),
      gradeLevelCode: s.grade_level_code,
      paymentPlan: s.payment_plan,
      enrollmentStatus: s.enrollment_status,
      isActive: s.is_active,
      dateOfBirth: s.date_of_birth,
    }) : null;
    const sCmp = deepCompare(studentFields(D.student), studentFields(M.student));
    checks.push({
      check: "student domain fields equivalent (incl. grade edit 1am -> 2am)",
      status: sCmp.equal ? "PASS" : "FAIL",
      detail: sCmp.equal ? "" : JSON.stringify(sCmp.diffs.slice(0, 6)),
    });

    // Relationship integrity: student.parent_id -> the scope's parent.id
    for (const [label, st] of [["D", D], ["M", M]]) {
      const ok = st.student && st.parent && st.student.parent_id === st.parent.id;
      checks.push({
        check: `[${label}] student-parent relationship integrity (FK points to own parent)`,
        status: ok ? "PASS" : "FAIL",
        detail: ok ? "" : `student.parent_id=${st.student?.parent_id} parent.id=${st.parent?.id}`,
      });
    }

    // Deterministic identity codes (parity of the code FORMAT both clients rely on)
    for (const [label, st] of [["D", D], ["M", M]]) {
      const codeOk = /^PAR-2026-EQTEST-[DM]\d+$/.test(st.parent?.parent_code || "") &&
        /^ELV-2026-EQTEST-[DM]\d+$/.test(st.student?.student_code || "");
      checks.push({
        check: `[${label}] canonical entity code format preserved`,
        status: codeOk ? "PASS" : "FAIL",
        detail: `parent=${st.parent?.parent_code} student=${st.student?.student_code}`,
      });
    }

    // Ledger history completeness per scope (charge + 2 payments + adjustment)
    for (const [label, st] of [["D", D], ["M", M]]) {
      const types = (st.ledger || []).map((e) => e.entry_type).sort();
      const expected = ["adjustment", "charge", "payment", "payment"];
      const ok = JSON.stringify(types) === JSON.stringify(expected);
      checks.push({
        check: `[${label}] ledger history complete (charge + 2 payments + adjustment)`,
        status: ok ? "PASS" : "FAIL",
        detail: `types=${JSON.stringify(types)}`,
      });
    }

    return checks;
  },
};
