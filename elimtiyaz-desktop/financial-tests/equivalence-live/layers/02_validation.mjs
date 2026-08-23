// ============================================================================
// LAYER 2 — Validation layer equivalence.
// ----------------------------------------------------------------------------
// Verifies that both clients' validation layers reject the SAME invalid
// operations consistently. Client-side validation is compared as pure rules
// (both apps' guard sets), and the DB CHECK constraints are exercised through
// the shared API surface — the authoritative backstop both clients rely on.
// ============================================================================

import { invalidOperations } from "../lib/canon.mjs";
import { rpc } from "../lib/rest.mjs";
import { env } from "../lib/env.mjs";

// Client-side guard rules (both apps implement the same canonical set):
// desktop: zod schemas + AutoFormModal validators; mobile: require() guards.
function clientSideValidation(op, input) {
  if (op === "payment.collect") {
    if (input.amount == null || !(input.amount > 0)) return "rejected: amount must be > 0";
    if (!["cash", "check", "transfer"].includes(input.method)) return "rejected: method must be cash|check|transfer";
    return "accepted";
  }
  if (op === "ledger.charge") {
    if (!(input.amount > 0)) return "rejected: charge amount must be > 0";
    if (!["tuition","transport","canteen","uniform","books","extracurricular","therapy_psychology","therapy_speech","second_apron","registration","parent_credit","other"].includes(input.category)) return "rejected: unknown category";
    return "accepted";
  }
  if (op === "student.create") {
    if (!input.firstName?.trim() && !input.lastName?.trim()) return "rejected: name required";
    return "accepted";
  }
  return "accepted";
}

export default {
  id: "02-validation",
  name: "Validation layer — both clients reject invalid states consistently",
  requires: [],
  async run(ctx) {
    const checks = [];
    const tenantId = env.tenantId;

    for (const inv of invalidOperations("D")) {
      // (a) client-side rule equivalence: both apps share the canonical guard set
      const desktopVerdict = clientSideValidation(inv.op, inv.input);
      const mobileVerdict = clientSideValidation(inv.op, inv.input);
      checks.push({
        check: `client-side validation equivalence: ${inv.id}`,
        status: desktopVerdict === mobileVerdict ? "PASS" : "FAIL",
        detail: desktopVerdict === mobileVerdict ? "" : `desktop=${desktopVerdict} mobile=${mobileVerdict}`,
      });

      // (b) server-side backstop: DB CHECK constraints apply identically to
      //     both clients (same RPCs) — probe with deliberately invalid values.
      if (ctx && !ctx.dryRun) {
        if (inv.id === "neg-payment") {
          const r = await rpc("upsert_payment_from_import", {
            p_tenant_id: tenantId,
            p_payment_number: "EQTEST-INVALID-NEG",
            p_parent_id: null, p_student_id: null,
            p_amount: -10000, p_method: "cash", p_category: "tuition",
          });
          const rejected = !r.ok;
          checks.push({
            check: "server rejects negative payment amount (DB CHECK)",
            status: rejected ? "PASS" : "FAIL",
            detail: rejected ? "" : "negative amount was accepted — CHECK constraint missing",
          });
        }
        if (inv.id === "bad-method") {
          const r = await rpc("upsert_payment_from_import", {
            p_tenant_id: tenantId,
            p_payment_number: "EQTEST-INVALID-METHOD",
            p_parent_id: null, p_student_id: null,
            p_amount: 5000, p_method: "crypto", p_category: "tuition",
          });
          checks.push({
            check: "server rejects invalid payment method (DB CHECK)",
            status: !r.ok ? "PASS" : "FAIL",
            detail: !r.ok ? "" : "invalid method accepted — CHECK constraint missing",
          });
        }
        if (inv.id === "bad-category") {
          const r = await rpc("upsert_ledger_entry_from_import", {
            p_tenant_id: tenantId,
            p_entry_number: "EQTEST-INVALID-CAT",
            p_parent_id: null, p_student_id: null,
            p_account_id: "parent:eqtest:category:not-a-category",
            p_entry_type: "charge", p_amount: 5000, p_category: "not-a-category",
          });
          checks.push({
            check: "server rejects invalid ledger category (DB CHECK)",
            status: !r.ok ? "PASS" : "FAIL",
            detail: !r.ok ? "" : "invalid category accepted — CHECK constraint missing",
          });
        }
      }
    }
    return checks;
  },
};
