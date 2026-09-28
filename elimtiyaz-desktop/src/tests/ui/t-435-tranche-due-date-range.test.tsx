/**
 * T-435 — the tranche due-date RANGE (UI-317): the owner's "fix the
 * configuration for the due date for the tranche so I can see the due
 * date range" request, pinned.
 *
 * The gap this closes (the T-434 follow-on): T-434 put ONE date on the
 * wave cards — the wave's EARLIEST due date — and the Finance strip's
 * échéance was a HARDCODED hint ("échéance 15 sep": no year, not derived
 * from the rows, silently wrong the moment the per-row échéance editor
 * moves a due date). The owner needs the RANGE: a wave whose rows drifted
 * off the official schedule (min ≠ max) must SHOW the spread, and the
 * strip must derive its line from the same canonical stats it sums.
 *
 * Also pins the two configuration consolidations:
 *   - `tuitionTranchesForGrade` labels now carry the OFFICIAL T-425
 *     schedule (the old "Sept–Déc / Jan–Mar / Avr–Juin" labels were the
 *     retired pre-T-425 term-based schedule — a wrong due-date range in
 *     the label itself).
 *   - the Excel import engine derives its due dates from the ONE
 *     canonical generator (`getOfficialTuitionDueDates`), no inline twin.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "../../i18n/i18n";
import { deriveTrancheWaveStats } from "../../domain/calc/payment/tranche-waves";
import {
  deriveTrancheWaves as deriveStatisticsWaves,
} from "../../features/dashboard/components/analytics/executive-statistics";
import { WaveVelocityCard } from "../../features/dashboard/components/analytics/executive-cards";
import {
  deriveTrancheWaves as deriveFinanceStrip,
  TrancheWaveHeader,
} from "../../features/financials/installment-schedule-tab";
import { formatDueDateRange } from "../../core/format/date";
import {
  getOfficialTuitionDueDates,
  tuitionTranchesForGrade,
} from "../../domain/calc/pricing";
import type { PricingConfig } from "../../domain/model/pricing";
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
const PAST_60D = new Date(NOW - 60 * DAY).toISOString();
const FUTURE_90D = new Date(NOW + 90 * DAY).toISOString();
const FUTURE_120D = new Date(NOW + 120 * DAY).toISOString();
const SEPT15_2026 = "2026-09-15T00:00:00.000Z";
const OCT15_2026 = "2026-10-15T00:00:00.000Z";

describe("T-435 (UI-317) — the canonical stats carry the wave's due-date RANGE", () => {
  it("a wave whose rows share one date (the official schedule) has dueDateMin === dueDateMax", () => {
    const stats = deriveTrancheWaveStats(
      [
        mk({ parentId: "p1", dueDate: SEPT15_2026, trancheNumber: 1 }),
        mk({ parentId: "p2", dueDate: SEPT15_2026, trancheNumber: 1 }),
      ],
      NOW,
    );
    expect(stats).toHaveLength(1);
    expect(stats[0].dueDateMin).not.toBeNull();
    expect(stats[0].dueDateMax).toBe(stats[0].dueDateMin);
  });

  it("a wave whose rows DRIFTED (the per-row échéance editor) carries the true min → max spread", () => {
    const stats = deriveTrancheWaveStats(
      [
        mk({ parentId: "p1", dueDate: SEPT15_2026, trancheNumber: 1 }),
        mk({ parentId: "p2", dueDate: OCT15_2026, trancheNumber: 1 }),
      ],
      NOW,
    );
    expect(stats[0].dueDateMin).toBe(new Date(SEPT15_2026).getTime());
    expect(stats[0].dueDateMax).toBe(new Date(OCT15_2026).getTime());
  });
});

describe("T-435 (UI-317) — the Statistics wave card renders the RANGE", () => {
  it("a uniform wave renders the single date (no range arrow)", () => {
    const waves = deriveStatisticsWaves(
      [mk({ parentId: "p1", dueDate: PAST_30D, trancheNumber: 1 })],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    const line = screen.getByTestId("wave-due-1").textContent ?? "";
    expect(line).toContain("Échéance :");
    expect(line).not.toContain("→");
  });

  it("a drifted wave renders 'min → max' (the spread is visible, never collapsed)", () => {
    const waves = deriveStatisticsWaves(
      [
        mk({ parentId: "p1", dueDate: PAST_60D, trancheNumber: 1 }),
        mk({ parentId: "p2", dueDate: PAST_30D, trancheNumber: 1 }),
      ],
      NOW,
    );
    render(<WaveVelocityCard waves={waves} />);
    const line = screen.getByTestId("wave-due-1").textContent ?? "";
    expect(line).toContain("→");
    // The days-late anchor stays the EARLIEST date (the wave's phase input).
    expect(line).toMatch(/— \d+ j de retard/);
  });

  it("the Statistics view model passes dueDateMax through (min ≠ max, both ISO)", () => {
    const waves = deriveStatisticsWaves(
      [
        mk({ parentId: "p1", dueDate: FUTURE_90D, trancheNumber: 2 }),
        mk({ parentId: "p2", dueDate: FUTURE_120D, trancheNumber: 2 }),
      ],
      NOW,
    );
    const w2 = waves.find((w) => w.wave === 2)!;
    expect(w2.dueDate).toBe(FUTURE_90D);
    expect(w2.dueDateMax).toBe(FUTURE_120D);
  });
});

describe("T-435 (UI-317) — the Finance strip DERIVES its échéance from the rows", () => {
  it("the strip's TrancheWave carries the pooled derived dates (min, max, isOverdue, remaining)", () => {
    const strip = deriveFinanceStrip([
      mk({ parentId: "p1", dueDate: SEPT15_2026, trancheNumber: 1 }),
      mk({ parentId: "p2", dueDate: OCT15_2026, trancheNumber: 1 }),
      mk({ parentId: "p3", dueDate: FUTURE_90D, trancheNumber: 2 }),
    ]);
    const t1 = strip.find((w) => w.index === 1)!;
    expect(t1.dueDate).toBe(SEPT15_2026);
    expect(t1.dueDateMax).toBe(OCT15_2026);
    expect(t1.isOverdue).toBe(true); // both dates past, rows unpaid
    expect(t1.remaining).toBe(200_000);
    const t2 = strip.find((w) => w.index === 2)!;
    expect(t2.isOverdue).toBe(false);
  });

  it("the rendered line shows the derived RANGE, not the hardcoded hint", () => {
    const strip = deriveFinanceStrip([
      mk({ parentId: "p1", dueDate: SEPT15_2026, trancheNumber: 1 }),
      mk({ parentId: "p2", dueDate: OCT15_2026, trancheNumber: 1 }),
    ]);
    render(
      <TrancheWaveHeader waves={strip} basisLabel="toutes catégories confondues" showTuitionBreakdown />,
    );
    const line = screen.getByTestId("strip-due-1").textContent ?? "";
    expect(line).toContain("Échéance :");
    expect(line).toContain("→");
    expect(line).toMatch(/— \d+ j de retard/);
    // The hardcoded hint NEVER renders when the rows carry dates.
    expect(line).not.toContain("échéance 15 sep");
  });

  it("the static hint stays ONLY as the no-parseable-date fallback", () => {
    const strip = deriveFinanceStrip([
      mk({ parentId: "p1", dueDate: "not-a-date", trancheNumber: 1 }),
    ]);
    render(
      <TrancheWaveHeader waves={strip} basisLabel="toutes catégories confondues" showTuitionBreakdown />,
    );
    const line = (screen.getByTestId("strip-due-1").textContent ?? "").trim();
    expect(line).toBe("échéance 15 sep");
  });

  it("a future wave renders 'dans N j' and a CLOSED wave never claims lateness", () => {
    const strip = deriveFinanceStrip([
      mk({ parentId: "p1", dueDate: FUTURE_90D, trancheNumber: 2 }),
      // T1 fully collected past its date — closed, no lateness claim.
      mk({
        parentId: "p2",
        dueDate: PAST_30D,
        trancheNumber: 1,
        amountPaid: 100_000,
        status: "paid",
      }),
    ]);
    render(
      <TrancheWaveHeader waves={strip} basisLabel="toutes catégories confondues" showTuitionBreakdown />,
    );
    const line2 = screen.getByTestId("strip-due-2").textContent ?? "";
    expect(line2).toMatch(/— dans \d+ j/);
    const line1 = screen.getByTestId("strip-due-1").textContent ?? "";
    expect(line1).toContain("Échéance :");
    expect(line1).not.toContain("de retard");
  });

  it("the strip pools the range ACROSS categories (tuition Sept 15 + transport Oct 15)", () => {
    const strip = deriveFinanceStrip([
      mk({ parentId: "p1", dueDate: SEPT15_2026, trancheNumber: 1 }),
      mk({
        parentId: "p2",
        dueDate: OCT15_2026,
        trancheNumber: 1,
        category: "transport",
      }),
    ]);
    const t1 = strip.find((w) => w.index === 1)!;
    expect(t1.dueDate).toBe(SEPT15_2026);
    expect(t1.dueDateMax).toBe(OCT15_2026);
  });
});

describe("T-435 (UI-317) — formatDueDateRange (the ONE shared formatter)", () => {
  it("degenerates to the single date when min === max (the official schedule)", () => {
    expect(formatDueDateRange(SEPT15_2026, SEPT15_2026)).toBe("15 sept. 2026");
    expect(formatDueDateRange(SEPT15_2026, null)).toBe("15 sept. 2026");
  });

  it("renders 'min → max' when the dates differ", () => {
    expect(formatDueDateRange(SEPT15_2026, OCT15_2026)).toBe(
      "15 sept. 2026 → 15 oct. 2026",
    );
  });

  it("returns null when there is no date at all (the caller's fallback contract)", () => {
    expect(formatDueDateRange(null, null)).toBeNull();
  });
});

describe("T-435 (UI-317) — the due-date CONFIGURATION consolidation", () => {
  it("tuitionTranchesForGrade labels carry the OFFICIAL schedule (never the retired term-based ranges)", () => {
    // A minimal partial config (the service-pricing-profile.test convention):
    // the function reads only tuitionByGradeLevel[gradeLevel].
    const config = {
      tuitionByGradeLevel: {
        "4am": { annualAmount: 340_000, installments: [136_000, 102_000, 102_000] as const },
      },
    } as unknown as PricingConfig;
    const tranches = tuitionTranchesForGrade(config, "4am");
    expect(tranches.map((t) => t.label)).toEqual([
      "Tranche 1 (15 sept.)",
      "Tranche 2 (15 déc.)",
      "Tranche 3 (15 mars)",
    ]);
    // The amounts pass through unchanged (the label fix is display-only).
    expect(tranches.map((t) => t.amountDue)).toEqual([136_000, 102_000, 102_000]);
    // The retired pre-T-425 term labels must never come back.
    for (const t of tranches) {
      expect(t.label).not.toMatch(/Sept–Déc|Jan–Mar|Avr–Juin/);
    }
  });

  it("the import engine's canonical triple is the same schedule every surface derives from", () => {
    const [t1, t2, t3] = getOfficialTuitionDueDates(2026);
    // The bare-date form the import pipeline stores (slice(0, 10)).
    expect(t1.slice(0, 10)).toBe("2026-09-15");
    expect(t2.slice(0, 10)).toBe("2026-12-15");
    expect(t3.slice(0, 10)).toBe("2027-03-15");
  });
});
