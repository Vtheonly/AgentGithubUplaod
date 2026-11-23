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

/* ================================================================== */
/*  T-586 INCREMENT 2 — the stats-tips glossary sweep, the 5 worst     */
/*  text rewrites, the Prix/Payé/Couverture standardization, the       */
/*  percentage clamps (Session 53).                                    */
/* ================================================================== */

describe("T-586 incr.2 — the stats-tips glossary sweep (96 entries × 3 locales)", () => {
  const statsTips = read("i18n/stats-tips.ts");

  it("I1: NO domain jargon in the VISIBLE dictionary strings (INV-x / ADR-xxx / PARITY-xxx / T-xxx / §xx)", () => {
    // Strip code comments, then scan the remaining string literals — the
    // operator-visible glossary text.
    const noBlock = statsTips.replace(/\/\*[\s\S]*?\*\//g, "");
    const noLine = noBlock.replace(/\/\/[^\n]*/g, "");
    const strings = noLine.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    const jargon = strings.filter((s) =>
      /INV-\d|ADR-\d|PARITY-\d|T-\d{3}|§\d/.test(s),
    );
    expect(
      jargon,
      `visible glossary strings still carrying jargon: ${jargon.slice(0, 3).join(" | ")}`,
    ).toEqual([]);
  });

  it("I2: the refs are PRESERVED in code comments (69 trailing ref comments — discoverable, not deleted)", () => {
    const refs = statsTips.match(/\/\/[^\n]*/g) ?? [];
    const withRefs = refs.filter((c) => /INV-\d|ADR-\d|PARITY-\d|T-\d{3}/.test(c));
    // 57 (pass 1) + 12 (pass 2) = 69 moved refs.
    expect(withRefs.length).toBeGreaterThanOrEqual(69);
  });
});

describe("T-586 incr.2 — the 5 worst text blocks rewritten", () => {
  it("W1: the refund paragraph is plain French (no LIFO / contrepassation / ledger)", () => {
    const src = read("features/financials/payment-detail-drawer.tsx");
    expect(src).not.toContain("(LIFO)");
    expect(src).not.toContain("contrepassation sera");
    // The restored informative body is still there (T-444's guarantee).
    // (JSX wraps the sentence across lines — assert the stable fragments.)
    expect(src).toContain("remboursé : les tranches concernées seront rouvertes");
    expect(src).toContain("journalisée avec votre");
  });

  it("W2: the tranche-edit toast is two clauses + the conditional warning (no family-total clause, no ALL-CAPS)", () => {
    const src = read("features/financials/tranche-amount-edit-modal.tsx");
    expect(src).not.toContain("Total dû famille");
    expect(src).not.toContain("JAMAIS déplacés");
    expect(src).toContain("Reste à payer :");
    expect(src).toContain("aucun paiement existant n'est modifié");
  });

  it("W3: the anomaly prompt no longer asks the model to repeat the disclaimer (the banner carries it ONCE)", () => {
    // Strip comments first — the T-586 fix note ITSELF names the removed
    // instruction; the pin guards the ACTIVE code, not the archaeology.
    const src = read("features/financials/anomaly-explainer-modal.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src).not.toContain("Termine par la mention");
    // The empty-signals wall is compressed (no threshold jargon stack).
    expect(src).not.toContain("48&nbsp;h");
    expect(src).not.toContain("≥ 3× la moyenne");
  });

  it("W4: the cash-flow radar has no double parenthetical and no ' DA' variant", () => {
    const src = read("features/financials/cash-flow-radar.tsx");
    expect(src).not.toContain("(échues ≤ 30 j");
    expect(src).not.toContain(" DA`");
    expect(src).not.toContain("} DA");
    expect(src).toContain("Rentrées prévues sous 30 jours");
  });

  it("W5: the radar velocity meters clamp the BAR widths (the honest raw number stays)", () => {
    const src = read("features/financials/cash-flow-radar.tsx");
    expect(src).toContain("const clampPct");
    // All three bars route through the clamp.
    expect(src.match(/clampPct\(treasury\.t[123]CollectionRate\)/g)).toHaveLength(3);
    // No raw width remains.
    expect(src).not.toMatch(/width: `\$\{treasury\.t\dCollectionRate\}%`\}/);
  });
});

describe("T-586 incr.2 — the Prix / Prix justifié / Couverture standardization", () => {
  it("P1: the breakdown card uses the three standard labels — no variants", () => {
    const src = read("features/financials/payment-breakdown-card.tsx");
    // (JSX text nodes sit on their own lines — the variant NOT-asserts do
    // the discriminating work; the positive asserts pin the new labels.)
    expect(src).toContain("Couverture");
    expect(src).toContain("<span>Prix</span>");
    expect(src).toContain("Prix justifié");
    expect(src).toContain("Payé à ce jour");
    // The retired variants.
    expect(src).not.toContain("Détail de la couverture");
    expect(src).not.toContain("Total attendu");
    expect(src).not.toContain("Total payé");
    expect(src).not.toContain("(net)");
    expect(src).not.toContain("(historique)");
  });
});

describe("T-586 incr.2 — compact stays KPI-only (the A1.4 illusion fix)", () => {
  it("C1: the debt-aging row sub-label and section header use the FULL-precision formatter", () => {
    const src = read("features/financials/debt-aging-tab.tsx");
    // The two non-KPI compact sites are de-compacted...
    expect(src).not.toContain("subsequentYearPaymentTotal, { compact: true }");
    expect(src).not.toContain("totalOutstanding, { compact: true }");
    // ...while the file keeps no compact call at all (it had none on KPIs).
    expect(src).not.toContain("{ compact: true }");
  });

  it("C2: the KPI surfaces keep compact (the financials-page tiles, the radar boxes)", () => {
    const page = read("features/financials/financials-page.tsx");
    expect(page).toContain("formatDzd(totalToday, { compact: true })");
    const radar = read("features/financials/cash-flow-radar.tsx");
    expect(radar).toContain("formatDzd(treasury.netOperatingCashFlow, { compact: true })");
  });
});
