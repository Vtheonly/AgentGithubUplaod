/**
 * T-434 — the wave échéance visibility (UI-316) + the reconciliation-basis
 * regression guard (DATA-050): the owner's two questions, pinned.
 *
 * Q1 ("Finance 75 % vs Statistics 77 % on the first tranche"): the two
 * surfaces measure DIFFERENT bases — the Statistics card isolates scolarité,
 * the Finance strip pools every category. The live pair (the t-434 probe +
 * the C6 census): Statistics T1 (scolarité) = 75 %, Finance T1 (pooled) =
 * 77 % — transport T1 at 97 % pulls the pooled rate UP. The owner's report
 * carried the two values attached to the opposite surfaces (DATA-050 — the
 * same swap the T-432 documentation recorded); the reconciliation
 * ("dont scolarité : N %") is the invariant that must hold.
 *
 * Q2 ("why is the first tranche red — is it not due yet?"): the red verdict
 * was CORRECT (T1 is due Sept 15 on the owner-confirmed official schedule,
 * live phase=overdue) — but the card never SHOWED the due date, so the red
 * state had no visible cause. The fix: every wave card carries its échéance
 * + the days late when overdue (UI-316).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "../../i18n/i18n";
import { deriveTrancheWaves as deriveStatisticsWaves } from "../../features/dashboard/components/analytics/executive-statistics";
import { WaveVelocityCard } from "../../features/dashboard/components/analytics/executive-cards";
import {
  deriveTrancheWaves as deriveFinanceStrip,
  TrancheWaveHeader,
} from "../../features/financials/installment-schedule-tab";
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

const DAY = 86_400_000;
const NOW = Date.now();
const PAST_30D = new Date(NOW - 30 * DAY).toISOString();
const FUTURE_90D = new Date(NOW + 90 * DAY).toISOString();
const SEPT15 = "2026-09-15T00:00:00.000Z";

describe("T-434 (UI-316) — the Statistics wave card shows its échéance", () => {
  it("an overdue wave renders the due date AND the days late (the red verdict's visible cause)", () => {
    const waves = deriveStatisticsWaves(
      [mk({ parentId: "p1", dueDate: PAST_30D, trancheNumber: 1 })],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    const line = screen.getByTestId("wave-due-1").textContent ?? "";
    expect(line).toContain("Échéance :");
    expect(line).toMatch(/— \d+ j de retard/);
  });

  it("the live T1 shape (due Sept 15, phase overdue) renders the Sept 15 échéance", () => {
    const waves = deriveStatisticsWaves(
      [mk({ parentId: "p1", dueDate: SEPT15, trancheNumber: 1 })],
      new Date("2026-09-28T12:00:00.000Z").getTime(),
    );
    render(<WaveVelocityCard waves={waves} />);
    const line = screen.getByTestId("wave-due-1").textContent ?? "";
    expect(line).toContain("15");
    expect(line).toContain("sept.");
    expect(line).toContain("j de retard");
  });

  it("a not-yet-due wave renders 'dans N j' and NEVER 'de retard' (T2/T3 are the future waves)", () => {
    const waves = deriveStatisticsWaves(
      [mk({ parentId: "p1", dueDate: FUTURE_90D, trancheNumber: 2 })],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    const line = screen.getByTestId("wave-due-2").textContent ?? "";
    expect(line).toContain("Échéance :");
    expect(line).toMatch(/— dans \d+ j/);
    expect(line).not.toContain("de retard");
    // The whole card never claims lateness on a future wave.
    expect(screen.getByTestId("wave-meter-2").textContent ?? "").not.toContain("En retard");
  });

  it("a CLOSED wave (remaining 0) never claims lateness, even past its due date", () => {
    const waves = deriveStatisticsWaves(
      [mk({ parentId: "p1", dueDate: PAST_30D, amountPaid: 100_000, status: "paid", trancheNumber: 1 })],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    const line = screen.getByTestId("wave-due-1").textContent ?? "";
    expect(line).toContain("Échéance :");
    expect(line).not.toContain("de retard");
    expect(screen.getByTestId("wave-meter-1").textContent ?? "").toContain("Clôturée");
  });

  it("an overdue TRANSPORT wave in the auxiliary grid carries its échéance + 'en retard'", () => {
    const waves = deriveStatisticsWaves(
      [
        mk({ parentId: "p1", dueDate: PAST_30D, trancheNumber: 1, category: "transport" }),
        mk({ parentId: "p1", dueDate: PAST_30D, trancheNumber: 1 }), // tuition keeps the grid alive
      ],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    const others = screen.getByTestId("wave-others").textContent ?? "";
    expect(others).toContain("échéance");
    expect(others).toContain("en retard");
  });
});

describe("T-434 (UI-316) — the Finance strip shows its échéance visibly (not tooltip-only)", () => {
  it("each strip card renders its échéance as DERIVED text (T-435: from the rows, not the static hint)", () => {
    // Relative dates so the pin is clock-independent: T1 past due, T2 future.
    const strip = deriveFinanceStrip([
      mk({ parentId: "p1", dueDate: PAST_30D, trancheNumber: 1 }),
      mk({ parentId: "p2", dueDate: FUTURE_90D, trancheNumber: 2 }),
    ]);
    render(
      <TrancheWaveHeader waves={strip} basisLabel="toutes catégories confondues" showTuitionBreakdown />,
    );
    const line1 = screen.getByTestId("strip-due-1").textContent ?? "";
    expect(line1).toContain("Échéance :");
    expect(line1).toMatch(/— \d+ j de retard/);
    const line2 = screen.getByTestId("strip-due-2").textContent ?? "";
    expect(line2).toContain("Échéance :");
    expect(line2).toMatch(/— dans \d+ j/);
  });
});

describe("T-434 (DATA-050) — the reconciliation-basis regression guard", () => {
  it("the strip's tuitionPct is character-identical to the Statistics collectedPct (same wave, same rows)", () => {
    const rows = [
      // Tuition T1: 75 collected of 100 due → 75%.
      mk({ parentId: "p1", dueDate: SEPT15, trancheNumber: 1, amountDue: 100_000, amountPaid: 75_000 }),
      // Transport T1: 97 of 100 → 97% — pulls the pooled rate UP (the live shape).
      mk({
        parentId: "p1",
        dueDate: SEPT15,
        trancheNumber: 1,
        category: "transport",
        amountDue: 100_000,
        amountPaid: 97_000,
      }),
    ];
    const statistics = deriveStatisticsWaves(rows, NOW).find((w) => w.category === "tuition" && w.wave === 1)!;
    const strip = deriveFinanceStrip(rows).find((w) => w.index === 1)!;
    // The two DIFFERENT truths on their bases:
    expect(statistics.collectedPct).toBe(75);
    expect(strip.pct).toBe(86); // (75k+97k)/(100k+100k) — the pooled rate
    // …and the reconciliation bridge:
    expect(strip.tuitionPct).toBe(statistics.collectedPct);
  });
});
