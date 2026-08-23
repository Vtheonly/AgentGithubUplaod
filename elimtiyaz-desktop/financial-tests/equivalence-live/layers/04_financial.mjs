// ============================================================================
// LAYER 4 — Financial / calculation layer equivalence.
// ----------------------------------------------------------------------------
// Verifies balances, payments, totals, adjustments and derived values are
// equivalent between the two client scopes — comparing BOTH the ledger-derived
// totals (balance-by-replay, INV-1) and the payments-table totals, including
// the centimes→DZD conversion path (mobile computes via /100.0).
// ============================================================================

import { normalizeScopeState, deepCompare } from "../lib/normalize.mjs";

export default {
  id: "04-financial",
  name: "Financial/calculation layer — balances, payments, totals, adjustments",
  requires: ["execution"],
  run(ctx) {
    const checks = [];
    const { states } = ctx.execution;
    const nD = normalizeScopeState("D", states.D || {});
    const nM = normalizeScopeState("M", states.M || {});

    // Expected canonical financial state (from canonicalFamily input):
    //   charge 330,000 | payment 1: 132,000 | payment 2: 40,000 | adjustment -5,000
    const expected = {
      charged: 330000,
      paid: 172000,
      adjusted: -5000,
      balance: 153000, // 330000 - 172000 - 5000
      paymentsTableTotal: 172000,
      paymentCount: 2,
    };

    for (const [label, n] of [["D", nD], ["M", nM]]) {
      for (const [k, v] of Object.entries(expected)) {
        const got = n.totals[k];
        checks.push({
          check: `[${label}] financial total ${k} == ${v}`,
          status: Math.abs(got - v) < 0.01 ? "PASS" : "FAIL",
          detail: `got ${got}`,
        });
      }
    }

    // Cross-client financial equivalence (the core claim):
    const cmp = deepCompare(nD.totals, nM.totals);
    checks.push({
      check: "derived financial totals equivalent across clients (centime-exact)",
      status: cmp.equal ? "PASS" : "FAIL",
      detail: cmp.equal ? "" : JSON.stringify(cmp.diffs.slice(0, 6)),
    });

    // Ledger entry-by-entry equivalence (amount, type, category, account shape).
    // sourceType/sourceIdTail are CLIENT PROVENANCE by design (manual_entry vs
    // android_sync, scope-tagged ids) — verified separately in layers 07/11.
    const stripProv = (led) => led.map(({ sourceType, sourceIdTail, ...rest }) => rest);
    const ledgerCmp = deepCompare(stripProv(nD.ledger), stripProv(nM.ledger));
    checks.push({
      check: "ledger entries equivalent (type/category/amount/account-shape, normalized order)",
      status: ledgerCmp.equal ? "PASS" : "FAIL",
      detail: ledgerCmp.equal
        ? `(${nD.ledger.length} entries each; provenance fields excluded by design — verified in layers 07/11)`
        : JSON.stringify(ledgerCmp.diffs.slice(0, 8)),
    });

    // Installment-derived state equivalence (tranche schedule + amounts)
    const instCmp = deepCompare(nD.installments, nM.installments);
    checks.push({
      check: "installment schedules equivalent (tranche amounts/due dates/status)",
      status: instCmp.equal ? "PASS" : "FAIL",
      detail: instCmp.equal
        ? `(${nD.installments.length} installments each)`
        : JSON.stringify(instCmp.diffs.slice(0, 8)),
    });

    // Centime-exactness sentinel: the mobile /100.0 float path must not drift
    // by even 1 centime versus desktop's decimal path.
    const centimeDrift = (nD.totals.paid - nM.totals.paid) * 100;
    checks.push({
      check: "centime drift between client amount paths == 0",
      status: Math.abs(centimeDrift) < 0.5 ? "PASS" : "FAIL",
      detail: `drift = ${centimeDrift} centimes`,
    });

    return checks;
  },
};
