/**
 * T-447 (STATS-402) — the Statistics metric-audit remediation battery:
 * the audit's confirmed defects, pinned as fixed.
 *
 *   1. THE SERVICE-YIELD SCOPE DEFECT (the audit ledger #1): the
 *      "Revenus Services Spécialisés" card consumed the RAW all-years
 *      payments stream while every sibling installment card is
 *      year-scoped and the tab's own "Encaissements services"
 *      InspectTrigger is range-scoped — the card and its own inspector
 *      trigger disagreed by every payment outside the active range.
 *      Fixed: the card derives from the range-scoped paid slice
 *      (applyAnalyticsFilters — the ONE cross-filtering engine).
 *   2. THE CLOCK-SPLIT FIX (audit §2.1): the wave card's days-late and
 *      its phase share ONE clock (the derivation's nowEpochMs — the old
 *      code recomputed Date.now() at render).
 *   3. THE DEAD-COMPOSITE REMOVAL: ExecutiveDashboard (the unreferenced
 *      export the audit re-confirmed) is gone.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Initialize i18n FIRST — useTranslation() will otherwise throw.
import "../../../i18n/i18n";
import { AnalyticsTab, type AnalyticsTabProps } from "../../../features/dashboard/tabs/analytics-tab";
import { PersonNavigationProvider } from "../../../shared/navigation/person-navigation-context";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import type { Payment, PaymentCategory } from "../../../domain/model/payment";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
  BarChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  ComposedChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  PieChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  AreaChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Bar: () => <div data-testid="recharts-bar" />,
  Line: () => <div data-testid="recharts-line" />,
  Area: () => <div data-testid="recharts-area" />,
  Pie: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Cell: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}));

vi.mock("../../../app/providers/ai-copilot-provider", () => ({
  useAICopilot: () => ({
    isOpen: false,
    setIsOpen: vi.fn(),
    toggleCopilot: vi.fn(),
    messages: [],
    isStreaming: false,
    streamingDelta: "",
    activeToolName: null,
    proposals: [],
    config: null,
    canUse: true,
    pendingClarification: null,
    askAgent: vi.fn().mockResolvedValue(undefined),
    answerClarification: vi.fn().mockResolvedValue(undefined),
    dismissClarification: vi.fn(),
    stopStreaming: vi.fn(),
    clearConversation: vi.fn(),
    approveAction: vi.fn().mockResolvedValue(undefined),
    dismissAction: vi.fn(),
    downloadArtifact: vi.fn().mockResolvedValue(undefined),
    reloadConfig: vi.fn().mockResolvedValue(undefined),
  }),
}));

const TAB_SRC = readFileSync(
  join(__dirname, "../../../features/dashboard/tabs/analytics-tab.tsx"),
  "utf8",
);
const CARDS_SRC = readFileSync(
  join(__dirname, "../../../features/dashboard/components/analytics/executive-cards.tsx"),
  "utf8",
);

function payment(id: string, category: PaymentCategory, amount: number, collectedAt: string, studentId: string | null = null): Payment {
  return {
    id,
    tenantId: "t1",
    parentId: "p1",
    studentId,
    amount,
    method: "cash",
    category,
    status: "paid",
    collectedBy: "staff-1",
    collectedAt,
    receiptNumber: null,
    note: null,
    proofPath: null,
    createdAt: collectedAt,
    updatedAt: collectedAt,
  } as unknown as Payment;
}

// ============================================================
// 1. The service-yield scope defect — the fix is pinned at BOTH levels
// ============================================================

describe("T-447 (STATS-402 #1) — the service-yield card is RANGE-SCOPED like its siblings", () => {
  it("source pin: the tab's services derivation goes through applyAnalyticsFilters (the ONE cross-filtering engine)", () => {
    expect(TAB_SRC).toMatch(
      /deriveServiceYield\(\s*applyAnalyticsFilters\(payments, range, NO_ANALYTICS_FILTERS\)/,
    );
    // and the RAW pass-through is gone
    expect(TAB_SRC).not.toMatch(/deriveServiceYield\(\s*payments,/);
  });

  it("behavior: an out-of-range service payment does NOT reach the card while the in-range one does", () => {
    const tabProps: AnalyticsTabProps = {
      revenue: [],
      prevRevenue: [],
      academicYear: "2025-2026",
      prevAcademicYear: null,
      debtAging: [],
      topDebtors: [],
      payments: [
        // IN range (the active school year), paid, a service category
        payment("pay-in", "canteen", 50_000, "2026-01-15T10:00:00Z", "stu-1"),
        // OUT of range (the PREVIOUS school year), paid, same category
        payment("pay-out", "canteen", 30_000, "2024-11-15T10:00:00Z", "stu-1"),
      ],
      range: { from: "2025-09-01", to: "2026-06-30" },
    };
    render(
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter>
            <PersonNavigationProvider>
              <AnalyticsTab {...tabProps} />
            </PersonNavigationProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>,
    );
    // The service-yield card (the default Pilotage view) renders ONE
    // canteen row: 1 règlement (the out-of-range payment excluded).
    const card = screen.getByTestId("service-yield-card");
    expect(card.textContent).toContain("Cantine");
    expect(card.textContent).toContain("1 règlements");
    // the revenue shown is the IN-RANGE payment only (compact 50 k —
    // 30 k must not appear anywhere on the card)
    expect(card.textContent).not.toContain("30");
    expect(card.textContent).toContain("50");
  });
});

// ============================================================
// 2. The clock-split fix — ONE clock for the phase AND the days-late
// ============================================================

describe("T-447 (STATS-402 §2.1) — the wave card renders with the derivation's single clock", () => {
  it("source pin: the card's daysLate uses nowEpochMs (the prop), never a render-time Date.now()", () => {
    expect(CARDS_SRC).toMatch(/daysBetweenFloor\(dueIso, nowEpochMs\)/);
    // the old split (phase from the derivation, days-late from a fresh
    // Date.now()) is gone from the card
    expect(CARDS_SRC).not.toMatch(/daysBetweenFloor\([^,]+, Date\.now\(\)\)/);
  });
});

// ============================================================
// 3. The dead composite — removed, and its testid with it
// ============================================================

describe("T-447 (TECHDEBT-100) — the unreferenced ExecutiveDashboard composite is removed", () => {
  it("executive-cards.tsx exports no ExecutiveDashboard (zero importers — the audit's DEAD-CODE-REMOVED verdict)", () => {
    expect(CARDS_SRC).not.toContain("export function ExecutiveDashboard");
  });
});
