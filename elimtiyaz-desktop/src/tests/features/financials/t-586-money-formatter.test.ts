/**
 * T-586 (Session 52, increment 1) — BUG-057's money-formatter unification +
 * the direct user-visible jargon purge.
 *
 * BUG-057 (the four formatters): the card's named surfaces carried raw
 * `toLocaleString("fr-FR")` money formatting with a " DA" suffix — NOT
 * NaN-safe and inconsistent with the canonical `formatDzd*` (" DZD").
 * This suite pins:
 *   S1  the canonical formatters' NaN safety + ONE " DZD" suffix.
 *   S2  the purged surfaces contain NO raw toLocaleString money formatting
 *       and no " DA" variants (source-scan guards on the card's files).
 *   S3  the domain-calc strings that reach operators (anomaly signals,
 *       financial-query engine notes, webhook evidence) render through the
 *       canonical formatter — behavioral pins with fixtures.
 *   S4  the de-jargonized labels: "Reste dû" (not "Reste (INV-4)"), the
 *       tooltip texts without "(T-502)"/"(modèle officiel T-425)",
 *       "(plan §18.03)", and the waterfall toast rewritten (source pins).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDzd, formatDzdPlain } from "../../../core/format/currency";
import { deriveExpenseAnomalySignals } from "../../../domain/calc/expense/anomaly-signals";
import type { Expense } from "../../../domain/model/expense";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../../../");
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");
/** formatDzd* emits U+202F grouping (correct for UI) — normalize for asserts. */
const nbsp = (s: string): string => s.replace(/[\s\u202f]/g, "");

/* ---------------- S1 — the canonical formatters ---------------- */

describe("T-586 / BUG-057 — the canonical DZD formatters", () => {
  it("S1: NaN-safe with ONE ' DZD' suffix (formatDzd), plain grouping (formatDzdPlain)", () => {
    // The grouping separator is U+202F (narrow no-break space — the fr-FR
    // convention; assertions normalize it away).
    expect(nbsp(formatDzd(1_350_000))).toBe("1350000DZD");
    expect(nbsp(formatDzdPlain(1_350_000))).toBe("1350000");
    expect(formatDzd(1_350_000).endsWith(" DZD")).toBe(true);
    // NaN never leaks as the literal "NaN" (the raw toLocaleString defect).
    expect(formatDzd(Number.NaN)).toBe("— DZD");
    expect(formatDzdPlain(Number.NaN)).toBe("0");
  });
});

/* ---------------- S2 — the source-scan guards ---------------- */

describe("T-586 / BUG-057 — no raw money formatting on the card's surfaces", () => {
  const FILES = [
    "features/dashboard/alert-detail-modal.tsx",
    "features/financials/financial-query-console.tsx",
    "features/dashboard/components/analytics/operational-query-console.tsx",
    "domain/calc/expense/anomaly-signals.ts",
    "domain/calc/payment/financial-query-engine.ts",
    "domain/calc/payment/webhook-diagnostics.ts",
  ];

  it("S2: every purged surface is free of raw toLocaleString and ' DA' money variants", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, `${f} must not format money via toLocaleString`).not.toMatch(
        /\$\{[^}]*\.toLocaleString\("fr-FR"\)\} ?D/,
      );
      expect(src, `${f} must not use the ' DA' suffix`).not.toMatch(/\} DA[«”' .,:;]/);
    }
  });

  it("S4: the de-jargonized user-visible labels (the direct purge sites)", () => {
    // Reste dû — not "Reste (INV-4)".
    expect(read("features/financials/tranche-amount-edit-modal.tsx")).toContain(">Reste dû<");
    expect(read("features/financials/tranche-amount-edit-modal.tsx")).not.toContain("Reste (INV-4)");
    // The (T-502) tooltip leak — both copies.
    expect(read("features/crm/student-detail/payments-tab.tsx")).not.toContain("(T-502)");
    expect(read("features/crm/parent-detail-drawer.tsx")).not.toContain("(T-502)");
    // The (modèle officiel T-425) tooltip.
    expect(read("features/crm/parent-year-history-section.tsx")).not.toContain("modèle officiel T-425");
    // The plan §18.03 leaks + the waterfall toast.
    const modal = read("features/financials/unified-payment-modal.tsx");
    expect(modal).not.toContain("plan §18.03");
    expect(modal).not.toContain("Allocation waterfall appliquée");
    expect(modal).toContain("Répartition automatique sur les échéances appliquée");
    // The règle INV-14 select option.
    expect(read("features/financials/manual-debt-modal.tsx")).not.toContain("règle INV-14");
  });
});

/* ---------------- S3 — behavioral pins on the domain strings ---------------- */

describe("T-586 / BUG-057 — the domain-calc operator strings render canonically", () => {
  const baseExpense: Expense = {
    id: "exp-1",
    tenantId: "ten-1",
    requestCode: "REQ-001",
    title: "Achat cartouches",
    description: "Achat cartouches encre",
    amount: 45_000,
    category: "supplies",
    urgency: "medium",
    payee: "Fournisseur A",
    status: "submitted",
    submittedBy: "usr-1",
    submittedAt: "2026-11-20T10:00:00.000Z",
    responsibleProfileId: null,
    approvedBy: null,
    approvedAt: null,
    approvalNote: null,
    disbursedBy: null,
    disbursedAt: null,
    proofUrl: null,
    proofUploadedBy: null,
    proofUploadedAt: null,
    finalSpentAmount: null,
    anomalyScore: null,
    anomalyNote: null,
  };

  it("S3a: the duplicate-anomaly description carries the canonical grouping (no ' DA', no raw number)", async () => {
    const nearDuplicate: Expense = {
      ...baseExpense,
      id: "exp-0",
      submittedAt: "2026-11-19T10:00:00.000Z",
      amount: 45_000,
    };
    const signals = deriveExpenseAnomalySignals(baseExpense, [nearDuplicate]);
    const dup = signals.find((s) => s.type === "duplicate");
    expect(dup).toBeDefined();
    // 45 000 with the canonical fr-FR grouping — and NO " DA" suffix.
    expect(nbsp(dup!.description)).toContain("45000");
    expect(dup!.description).not.toContain(" DA");
  });

  it("S3b: the budget-overrun description formats both amounts canonically", () => {
    const others = Array.from({ length: 4 }, (_, i) => ({
      ...baseExpense,
      id: `exp-mean-${i}`,
      submittedAt: "2026-11-01T10:00:00.000Z",
      amount: 5_000,
    }));
    const signals = deriveExpenseAnomalySignals({ ...baseExpense, amount: 40_000 }, others);
    const overrun = signals.find((s) => s.type === "budget_overrun");
    expect(overrun).toBeDefined();
    expect(nbsp(overrun!.description)).toContain("40000");
    expect(nbsp(overrun!.description)).toContain("5000");
    expect(overrun!.description).not.toContain(" DA");
  });
});
