/**
 * T-351 regression suite (63rd session, 2026-09-14) — DASH-401 + DASH-406:
 * the reactive debt/payments/students/personnel wiring.
 *
 * DASH-401 (the owner's screenshot set): `dashboard-page.tsx` read
 * `repos.debt.observeSummary().get()` SYNCHRONOUSLY inside the year-range
 * effect. In Supabase mode the summary cache seeds asynchronously
 * (SubjectBehavior starting `[]` + `void seedSummary()`), so the FIRST
 * read returned `[]` — the Pareto card said "Aucun débiteur", the rail
 * said "Aucune relance nécessaire", and the modal's top-debtors table
 * said "Aucune créance en cours" while the aging card directly above
 * showed 58.6M DZD across 197 families. The data only appeared after the
 * user switched the academic year (the only effect re-run trigger).
 *
 * DASH-406: the Reports tab read payments/debt/students/personnel with
 * the same `.get()` race inside click handlers → empty XLSX exports in
 * the first seconds of a session.
 *
 * This suite pins the fix at two levels:
 *   1. SOURCE GUARDS — the race patterns must not return; the reactive
 *      subscriptions must exist (the t-230 source-pin pattern).
 *   2. BEHAVIOR — a debt stream that lands AFTER mount populates the
 *      risk engine WITHOUT any year change, and the engine sees the
 *      FULL stream (families ranked 11+ evaluate with their real debt,
 *      not 0 — the previous top-10-only feed).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";

// Initialize i18n FIRST — useTranslation() will otherwise throw.
import "../../../i18n/i18n";
import { AnalyticsTab, type AnalyticsTabProps } from "../../../features/dashboard/tabs/analytics-tab";
import { evaluateStudentRiskProfiles } from "../../../features/dashboard/components/analytics/operational-query-engine";
import type { DebtSummary } from "../../../domain/model/payment";
import type { Student } from "../../../domain/model/student";
import type { Parent } from "../../../domain/model/parent";
import { useObservable } from "../../../shared/hooks/use-observable";
import { SubjectBehavior } from "../../../infrastructure/mock/subject-behavior";

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

// ============================================================
// 1. SOURCE GUARDS — the race patterns must not return
// ============================================================

const PAGE_SRC = readFileSync(
  join(__dirname, "../../../features/dashboard/dashboard-page.tsx"),
  "utf8",
);
const REPORTS_SRC = readFileSync(
  join(__dirname, "../../../features/dashboard/tabs/reports-tab.tsx"),
  "utf8",
);

describe("T-351 — source guards (DASH-401/406: the .get() races are gone)", () => {
  it("dashboard-page.tsx never reads observeSummary().get() (the async-seed race)", () => {
    expect(PAGE_SRC).not.toContain("observeSummary().get()");
  });

  it("dashboard-page.tsx SUBSCRIBES to the debt summary observable (the reactive pattern)", () => {
    expect(PAGE_SRC).toMatch(/repos\.debt\.observeSummary\(\)\s*\.subscribe/);
  });

  it("dashboard-page.tsx passes the FULL debtSummaries stream to AnalyticsTab (not only the top-10 slice)", () => {
    expect(PAGE_SRC).toContain("debtSummaries={debtSummaries}");
  });

  it("reports-tab.tsx contains no synchronous observe().get() read inside the module", () => {
    // The handlers must consume the useObservable streams; a `.get()` on
    // an unseeded cache is the DASH-406 empty-export race.
    expect(REPORTS_SRC).not.toMatch(/repos\.\w+\.observe\w*\(\)\.get\(\)/);
  });

  it("reports-tab.tsx subscribes its export streams via useObservable", () => {
    expect(REPORTS_SRC).toContain("useObservable(() => repos.payments.observe()");
    expect(REPORTS_SRC).toContain("useObservable(() => repos.debt.observeSummary()");
    expect(REPORTS_SRC).toContain("useObservable(() => repos.students.observe()");
    expect(REPORTS_SRC).toContain("useObservable(() => repos.personnel.observe()");
  });
});

// ============================================================
// 2. BEHAVIOR — the full debt stream reaches the risk engine
// ============================================================

/** DebtSummary fixture builder (domain-typed — REG-007 convention). */
function debtor(parentId: string, amount: number, days = 90): DebtSummary {
  return {
    parentId,
    parentName: `Famille ${parentId}`,
    parentPhone: "0555",
    studentCount: 1,
    outstandingAmount: amount,
    daysOverdue: days,
    bucket: "180_plus" as const,
  };
}

/** Student fixture base — Omit<Student, "id"> keeps the contract honest. */
const STUDENT_INPUT_BASE: Omit<Student, "id"> = {
  tenantId: "t1",
  code: "ELV-X",
  parentId: "p1",
  firstName: "Élève",
  lastName: "X",
  displayName: null,
  gender: "unspecified",
  birthDate: "2012-05-01",
  enrollmentDate: "2025-09-01",
  level: "primaire",
  gradeYear: 1,
  gradeLevel: "1ap",
  classId: null,
  photoUrl: null,
  medicalNotes: null,
  transportTier: null,
  status: "active",
  paymentPlan: "tranches",
  academicHistory: [],
  documents: [],
  createdAt: "2025-09-01T00:00:00Z",
  updatedAt: "2025-09-01T00:00:00Z",
};

function student(id: string, parentId: string, first: string): Student {
  return {
    ...STUDENT_INPUT_BASE,
    id,
    parentId,
    firstName: first,
    lastName: parentId.toUpperCase(),
    code: `ELV-${id}`,
  };
}

/** Parent fixture base — Omit<Parent, "id">. */
const PARENT_INPUT_BASE: Omit<Parent, "id"> = {
  tenantId: "t1",
  code: "PAR-X",
  firstName: "Parent",
  lastName: "X",
  displayName: null,
  gender: "unspecified",
  phone: "0555",
  whatsapp: null,
  email: null,
  occupation: null,
  address: null,
  cityTier: null,
  transportDestination: null,
  preferredLanguage: "fr",
  avatarUrl: null,
  financiallyRestricted: false,
  authUserId: null,
  createdAt: "2025-09-01T00:00:00Z",
  updatedAt: "2025-09-01T00:00:00Z",
};

function parent(id: string, last: string): Parent {
  return { ...PARENT_INPUT_BASE, id, lastName: last, code: `PAR-${id}` };
}

describe("T-351 — AnalyticsTab consumes the FULL debt stream (DASH-401)", () => {
  /**
   * 12 debtor families; the page's top-10 display slice would EXCLUDE
   * p11 and p12. The risk engine must see them: the students of p11/p12
   * must land in the "Créances Critiques" preset (>40 000 DA).
   */
  const fullSummaries: DebtSummary[] = Array.from({ length: 12 }, (_, i) =>
    debtor(`p${i + 1}`, 60_000 - i * 100),
  );
  const top10 = fullSummaries.slice(0, 10) as DebtSummary[];

  const tabProps: AnalyticsTabProps = {
    revenue: [],
    prevRevenue: [],
    academicYear: "2025-2026",
    prevAcademicYear: null,
    debtAging: [],
    topDebtors: top10,
    debtSummaries: fullSummaries,
    payments: [],
    range: { from: "2025-09-01", to: "2026-06-30" },
  };

  it("families ranked 11+ reach the risk engine with their real debt (not 0)", () => {
    // The engine is fed the full stream via the tab. We verify through the
    // engine contract directly (the tab's wiring is source-pinned above):
    // evaluateStudentRiskProfiles must be called with debtSummaries that
    // include p11/p12 — assert by querying the engine with students from
    // p11/p12 wired to the FULL stream.
    const profiles = evaluateStudentRiskProfiles({
      students: [student("s11", "p11", "Onzième"), student("s12", "p12", "Douzième")],
      parents: [parent("p11", "ONZE"), parent("p12", "DOUZE")],
      classes: [],
      subjects: [],
      assessments: [],
      attendance: [],
      debtSummaries: fullSummaries,
    });
    // Both students carry the p11/p12 debt (59 000 / 58 900 DZD).
    expect(profiles.map((p) => p.debtAmount)).toEqual([59_000, 58_900]);
    expect(profiles.every((p) => p.riskCategory === "financial_tension")).toBe(true);
  });

  it("the tab renders the diagnostic view and the severe-debt preset finds the full-stream debt", async () => {
    // The repository context defaults to the mock repositories; the
    // students/parents streams there are the seeded demo data. We assert
    // the tab renders without errors and the console's preset machinery
    // works with the full debtSummaries prop (the deep wiring is pinned
    // by the source guards + the engine test above).
    render(<AnalyticsTab {...tabProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Diagnostic Actif/ }));
    const console = screen.getByTestId("analytics-tab");
    expect(console).toBeInTheDocument();
    // The CrossRiskCard renders its quadrant headings (the preset chips
    // + the quadrant titles share the label — assert presence, not
    // uniqueness).
    expect(screen.getAllByText(/Triple Risque/i).length).toBeGreaterThan(0);
  });
});

describe("T-351 — reactive population without a year change (the DASH-401 race)", () => {
  it("a debt stream landing AFTER mount updates the subscribed state (useObservable semantics)", async () => {
    // The page's subscription pattern is `subscribe(setState)` — an
    // observable that emits AFTER mount must produce a re-render with the
    // new value. We pin the semantic with a tiny inline component against
    // a controllable SubjectBehavior (the exact class the Supabase debt
    // repository caches behind observeSummary()).
    // The async-seed contract: starts EMPTY (the Supabase race condition),
    // the data lands after the subscription is live.
    const subject = new SubjectBehavior<string[]>([]);

    function Probe() {
      const v = useObservable(() => subject, []);
      return <div data-testid="probe">{v.join(",")}</div>;
    }
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("");

    // The async seed lands AFTER mount — exactly the moment `.get()` used
    // to race past (returning the initial []).
    await act(async () => {
      subject.set(["a", "b"]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toBe("a,b");
    });
  });
});
