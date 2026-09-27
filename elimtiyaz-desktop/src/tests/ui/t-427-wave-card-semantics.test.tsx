/**
 * T-427 — the wave-card delinquency semantics (issues #24/#25, Track 2
 * items 1+4 + Track 4 item 2): the overdue-family gating, the
 * remainingTotal-based completion, and the phase-driven sub-labels.
 *
 * DATA-048: the canonical `deriveTrancheWaveStats` gains
 * `overdueDebtorFamilyCount` (families with an unsettled, OWING,
 * STRICTLY-PAST-DUE row) — `debtorFamilyCount` keeps its documented
 * meaning (owing families regardless of due date). The wave card's
 * "en retard" presentation must use the overdue-gated count; a future
 * T2/T3 wave's current balances are "à échoir" / "non soldées", never
 * "en retard" (the audit's Track 2 item 1 finding).
 *
 * Track 2 item 4: "Clôturée" requires remainingTotal === 0 (the INV-4
 * basis — consistent with isInstallmentSettled), never the old
 * `collectedPct >= 95` rounding threshold (a wave with millions of DZD
 * outstanding showed as closed).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "../../i18n/i18n";
import { deriveTrancheWaveStats } from "../../domain/calc/payment/tranche-waves";
import { deriveTrancheWaves } from "../../features/dashboard/components/analytics/executive-statistics";
import { WaveVelocityCard } from "../../features/dashboard/components/analytics/executive-cards";
import type { Installment, PaymentCategory } from "../../domain/model/payment";

// Mock recharts (the jsdom 0×0-box convention).
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
}));

function mk(over: Partial<Installment> & { parentId: string; dueDate: string }): Installment {
  return {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: "t",
    studentId: null,
    category: "tuition" as PaymentCategory,
    label: "Tranche",
    trancheNumber: 1,
    amountDue: 100_000,
    amountPaid: 0,
    amountPending: 0,
    status: "unpaid",
    academicCycle: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  } as Installment;
}

const PAST = new Date(Date.now() - 30 * 86_400_000).toISOString();
const FUTURE = new Date(Date.now() + 90 * 86_400_000).toISOString();
const NOW = Date.now();

describe("T-427 (DATA-048) — the canonical overdue-family gating", () => {
  it("a future-due owing family counts in debtorFamilyCount but NEVER in overdueDebtorFamilyCount", () => {
    const rows = [
      mk({ parentId: "p-future", dueDate: FUTURE, trancheNumber: 3 }),
      mk({ parentId: "p-past", dueDate: PAST, trancheNumber: 1 }),
    ];
    const stats = deriveTrancheWaveStats(rows, NOW);
    const t1 = stats.find((s) => s.wave === 1)!;
    const t3 = stats.find((s) => s.wave === 3)!;
    expect(t1.debtorFamilyCount).toBe(1);
    expect(t1.overdueDebtorFamilyCount).toBe(1);
    // The future wave: owing ≠ late.
    expect(t3.debtorFamilyCount).toBe(1);
    expect(t3.overdueDebtorFamilyCount).toBe(0);
    expect(t3.anyUnsettledFuture).toBe(true);
    expect(t3.anyUnsettledOverdue).toBe(false);
  });

  it("a settled family counts in neither (the canonical settled predicate)", () => {
    const rows = [mk({ parentId: "p-settled", dueDate: PAST, amountPaid: 100_000, status: "paid" })];
    const stats = deriveTrancheWaveStats(rows, NOW);
    expect(stats[0].debtorFamilyCount).toBe(0);
    expect(stats[0].overdueDebtorFamilyCount).toBe(0);
  });

  it("a family owing on BOTH a past-due and a future row counts once per wave (distinct parents per wave)", () => {
    const rows = [
      mk({ parentId: "p-mixed", dueDate: PAST, trancheNumber: 1 }),
      mk({ parentId: "p-mixed", dueDate: FUTURE, trancheNumber: 2 }),
    ];
    const stats = deriveTrancheWaveStats(rows, NOW);
    const t1 = stats.find((s) => s.wave === 1)!;
    const t2 = stats.find((s) => s.wave === 2)!;
    expect(t1.overdueDebtorFamilyCount).toBe(1);
    expect(t2.overdueDebtorFamilyCount).toBe(0); // the future row never gates
    expect(t2.debtorFamilyCount).toBe(1);
  });

  it("the view model carries overdueDebtorFamilyCount through (deriveTrancheWaves)", () => {
    const rows = [
      mk({ parentId: "p-future", dueDate: FUTURE, trancheNumber: 3 }),
      mk({ parentId: "p-past", dueDate: PAST, trancheNumber: 1 }),
    ];
    const waves = deriveTrancheWaves(rows, NOW);
    const t3 = waves.find((w) => w.wave === 3)!;
    const t1 = waves.find((w) => w.wave === 1)!;
    expect(t1.overdueDebtorFamilyCount).toBe(1);
    expect(t3.overdueDebtorFamilyCount).toBe(0);
    expect(t3.phase).toBe("not_due");
    expect(t1.phase).toBe("overdue");
  });
});

describe("T-427 — the WaveVelocityCard presentation (Track 2 item 4 + Track 4 item 2)", () => {
  it("a 96%-collected wave with remaining DZD is NOT Clôturée (remainingTotal === 0 is the only closure)", () => {
    // 96% collected, 4,000,000 DZD still outstanding — the old
    // collectedPct >= 95 threshold marked this "Clôturée".
    const waves = deriveTrancheWaves(
      [
        mk({ parentId: "p1", dueDate: PAST, amountDue: 100_000_000, amountPaid: 96_000_000, trancheNumber: 1 }),
      ],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    expect(screen.getByTestId("wave-meter-1").textContent).not.toContain("Clôturée");
  });

  it("a fully-settled wave IS Clôturée", () => {
    const waves = deriveTrancheWaves(
      [mk({ parentId: "p1", dueDate: PAST, amountPaid: 100_000, status: "paid", trancheNumber: 1 })],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    expect(screen.getByTestId("wave-meter-1").textContent).toContain("Clôturée");
  });

  it("a future wave's sub-label is 'Familles à échoir' (never 'en retard'); an overdue wave's is 'Familles en retard'", () => {
    const waves = deriveTrancheWaves(
      [
        mk({ parentId: "p-past", dueDate: PAST, trancheNumber: 1 }),
        mk({ parentId: "p-future", dueDate: FUTURE, trancheNumber: 2 }),
      ],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    const t1 = screen.getByTestId("wave-meter-1").textContent ?? "";
    const t2 = screen.getByTestId("wave-meter-2").textContent ?? "";
    expect(t1).toContain("Familles en retard");
    expect(t2).toContain("Familles à échoir");
    expect(t2).not.toContain("Familles en retard");
  });
});
