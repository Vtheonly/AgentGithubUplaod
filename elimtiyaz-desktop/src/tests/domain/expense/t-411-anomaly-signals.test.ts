/**
 * T-411 Phase 3 (DATA-027) — the REAL expense anomaly signals.
 *
 * Pins `deriveExpenseAnomalySignals` (the canonical module that replaced
 * `buildMockSignals`'s fabricated constants): duplicates fire on real
 * payee+amount+window collisions; new_vendor on a payee with no history;
 * budget_overrun on ≥3× the category mean with ≥3 samples; and a clean
 * expense yields ZERO signals (the honest empty state — never fiction).
 */
import { describe, it, expect } from "vitest";
import { deriveExpenseAnomalySignals } from "../../../domain/calc/expense/anomaly-signals";
import type { Expense, ExpenseCategory } from "../../../domain/model/expense";

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: overrides.id ?? "exp-1",
    tenantId: "t-1",
    requestCode: "EXP-1",
    title: overrides.title ?? "Fournitures",
    description: null,
    amount: overrides.amount ?? 10_000,
    category: (overrides.category ?? "supplies") as ExpenseCategory,
    urgency: "normal",
    payee: overrides.payee ?? "Papeterie El Baraka",
    status: overrides.status ?? "submitted",
    submittedBy: "usr-1",
    submittedAt: overrides.submittedAt ?? "2026-09-20T10:00:00.000Z",
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
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
  } as unknown as Expense;
}

describe("T-411 / DATA-027 — deriveExpenseAnomalySignals (real derivations)", () => {
  it("a same-payee same-amount expense within 48h fires duplicate", () => {
    const target = makeExpense({ id: "a", amount: 45_000, submittedAt: "2026-09-20T10:00:00.000Z" });
    const twin = makeExpense({
      id: "b", amount: 45_050, submittedAt: "2026-09-19T12:00:00.000Z", title: "Twin",
    });
    const signals = deriveExpenseAnomalySignals(target, [twin]);
    expect(signals.some((s) => s.type === "duplicate")).toBe(true);
  });

  it("a same-payee expense OUTSIDE 48h does not fire duplicate", () => {
    const target = makeExpense({ id: "a", submittedAt: "2026-09-20T10:00:00.000Z" });
    const old = makeExpense({ id: "b", submittedAt: "2026-09-15T10:00:00.000Z" });
    const signals = deriveExpenseAnomalySignals(target, [old]);
    expect(signals.some((s) => s.type === "duplicate")).toBe(false);
  });

  it("an unknown payee fires new_vendor; a known payee does not", () => {
    const target = makeExpense({ payee: "Nouveau Fournisseur" });
    const known = makeExpense({ id: "b", payee: "Papeterie El Baraka" });
    const alsoKnown = makeExpense({ id: "c", payee: "Papeterie El Baraka" });
    // target's payee appears nowhere else → new_vendor fires.
    expect(deriveExpenseAnomalySignals(target, [known]).some((s) => s.type === "new_vendor")).toBe(true);
    // known's payee appears on alsoKnown → no signal.
    expect(deriveExpenseAnomalySignals(known, [target, alsoKnown]).some((s) => s.type === "new_vendor")).toBe(false);
  });

  it("≥3× the category mean (≥3 samples) fires budget_overrun; thin evidence never does", () => {
    const target = makeExpense({ amount: 100_000, category: "supplies" });
    const threeSmall = [
      makeExpense({ id: "b1", amount: 10_000, category: "supplies" }),
      makeExpense({ id: "b2", amount: 10_000, category: "supplies" }),
      makeExpense({ id: "b3", amount: 10_000, category: "supplies" }),
    ];
    expect(
      deriveExpenseAnomalySignals(target, threeSmall).some((s) => s.type === "budget_overrun"),
    ).toBe(true);
    // only 2 samples → no verdict from thin evidence
    expect(
      deriveExpenseAnomalySignals(target, threeSmall.slice(0, 2)).some((s) => s.type === "budget_overrun"),
    ).toBe(false);
  });

  it("a clean expense yields ZERO signals — the honest empty state (never fiction)", () => {
    const target = makeExpense({ amount: 10_000, payee: "Known Vendor", category: "supplies" });
    const history = [
      makeExpense({ id: "b1", amount: 9_500, payee: "Known Vendor", category: "supplies", submittedAt: "2026-08-01T10:00:00.000Z" }),
      makeExpense({ id: "b2", amount: 10_500, payee: "Known Vendor", category: "supplies", submittedAt: "2026-07-01T10:00:00.000Z" }),
      makeExpense({ id: "b3", amount: 10_000, payee: "Known Vendor", category: "supplies", submittedAt: "2026-06-01T10:00:00.000Z" }),
    ];
    expect(deriveExpenseAnomalySignals(target, history)).toEqual([]);
  });
});
