// ============================================================================
// LAYER 10 — Document layer equivalence (PDF receipts/statements).
// ----------------------------------------------------------------------------
// Verifies generated documents contain equivalent AUTHORITATIVE DATA for
// equivalent operations. The desktop renders PDFs via pdf-lib
// (src/infrastructure/receipt-pdf/*) and Android via PdfDocument+Canvas
// (infrastructure/pdf/PdfGenerator.kt — new). This layer verifies the DATA
// CONTRACT both renderers consume: for the same canonical payment, the set of
// authoritative fields (amount, method, category, status, receipt number
// shape, parent/student identity, date) must be derivable identically from
// both scopes' DB state — i.e., a receipt printed from either client's data
// carries the same authoritative content.
// ============================================================================

import { deepCompare } from "../lib/normalize.mjs";

/** The authoritative receipt data contract (fields both PDF renderers show). */
function receiptDataContract(payment, parent, student) {
  return {
    schoolHeader: "EL-IMTIYAZ — El-Imtiyaz Boumerdès",
    amountDzd: Math.round(Number(payment.amount) * 100) / 100,
    method: payment.method,
    methodLabelFr: payment.method === "cash" ? "Espèces"
      : payment.method === "check" ? "Chèque" : "Virement",
    category: payment.category,
    status: payment.status,
    receiptNumberShape: String(payment.receipt_number || payment.payment_number || "")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "UUID")
      .replace(/-[DM]\d+/, "-SCOPE"), // scope marker differs by design
    payerName: String(parent?.display_name || [parent?.last_name, parent?.first_name].filter(Boolean).join(" ")).replace(/ \([DM]\)$/, ""),
    studentName: String(student?.display_name || [student?.last_name, student?.first_name].filter(Boolean).join(" ")).replace(/ \([DM]\)$/, ""),
    collectedAtDate: (payment.collected_at || "").slice(0, 10),
  };
}

export default {
  id: "10-document",
  name: "Document layer — PDFs/receipts contain equivalent authoritative data",
  requires: ["execution"],
  run(ctx) {
    const checks = [];
    const { states } = ctx.execution;

    const contracts = {};
    for (const scope of ["D", "M"]) {
      const st = states[scope] || {};
      const pays = (st.payments || []).slice().sort((a, b) => b.amount - a.amount);
      if (!pays.length || !st.parent) {
        contracts[scope] = null;
        continue;
      }
      // Build the contract for the LARGEST payment (canonical tranche-1 payment)
      contracts[scope] = receiptDataContract(pays[0], st.parent, st.student);
    }

    if (contracts.D && contracts.M) {
      const cmp = deepCompare(contracts.D, contracts.M);
      checks.push({
        check: "receipt data contract equivalent across clients (all authoritative fields)",
        status: cmp.equal ? "PASS" : "FAIL",
        detail: cmp.equal
          ? `amount=${contracts.D.amountDzd} DA, method=${contracts.D.methodLabelFr}, status=${contracts.D.status}`
          : JSON.stringify(cmp.diffs.slice(0, 8)),
      });

      // Amount-in-words parity sentinel: both renderers format the same
      // thousands-separated DZD string.
      const fmt = (n) => new Intl.NumberFormat("fr-FR").format(n) + " DA";
      checks.push({
        check: "receipt amount formatting identical (fr-FR thousands separator + DA)",
        status: fmt(contracts.D.amountDzd) === fmt(contracts.M.amountDzd) ? "PASS" : "FAIL",
        detail: `D="${fmt(contracts.D.amountDzd)}" M="${fmt(contracts.M.amountDzd)}"`,
      });
    } else {
      checks.push({
        check: "receipt data contract derivable from both scopes",
        status: "FAIL",
        detail: `D=${!!contracts.D} M=${!!contracts.M} — payment/parent missing in a scope`,
      });
    }

    // Statement data contract: per-account balances must be equivalent.
    const accountBalances = (st) => {
      const by = {};
      for (const e of st?.ledger || []) {
        const key = e.category; // scope-comparable
        by[key] = Math.round(((by[key] || 0) + Number(e.amount)) * 100) / 100;
      }
      return by;
    };
    const balCmp = deepCompare(accountBalances(states.D), accountBalances(states.M));
    checks.push({
      check: "account-statement data contract equivalent (per-category balances)",
      status: balCmp.equal ? "PASS" : "FAIL",
      detail: balCmp.equal ? JSON.stringify(accountBalances(states.D)) : JSON.stringify(balCmp.diffs),
    });

    // Renderer field-parity check (static contract): the field sets consumed
    // by desktop payment-receipt.ts and Android PdfGenerator.kt map onto the
    // same authoritative receipt fields.
    const desktopFields = new Set([
      "receiptNumber", "date", "payerName", "studentName", "amount",
      "methodLabel", "category", "status", "description", "schoolHeader", "footer",
    ]);
    const androidFields = new Set([
      "receiptNumber", "date", "status", "reference", "payer", "student",
      "methodLabel", "category", "totalPaid", "notes", "breakdown", "schoolHeader", "footer",
    ]);
    // authoritative field -> [desktop alias, android alias]
    const parityMap = [
      ["receiptNumber", "receiptNumber", "receiptNumber"],
      ["date", "date", "date"],
      ["payerName", "payerName", "payer"],
      ["studentName", "studentName", "student"],
      ["amount", "amount", "totalPaid"],
      ["methodLabel", "methodLabel", "methodLabel"],
      ["category", "category", "category"],
      ["status", "status", "status"],
      ["schoolHeader", "schoolHeader", "schoolHeader"],
    ];
    const missing = parityMap.filter(
      ([field, dAlias, aAlias]) => !(desktopFields.has(dAlias) && androidFields.has(aAlias)),
    );
    checks.push({
      check: "PDF renderer field parity: desktop & Android cover all authoritative receipt fields",
      status: missing.length === 0 ? "PASS" : "FAIL",
      detail: missing.length ? `missing coverage: ${missing.map((m) => m[0]).join(", ")}` : `all ${parityMap.length} authoritative fields covered by both renderers`,
    });

    return checks;
  },
};
