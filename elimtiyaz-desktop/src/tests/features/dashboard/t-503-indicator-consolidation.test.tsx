/**
 * T-503 suite (UI-335) — the DUPLICATE-INDICATOR consolidation + the
 * per-indicator SHOW/HIDE toggles:
 *
 *   1. ONE CONSOLE MOUNT: the OperationalQueryConsole is retired from the
 *      Pilotage view (the owner's census: "three or four instances… two
 *      instances in each dashboard mode") — it lives ONLY in Diagnostic,
 *      its own label's home ("Console de diagnostic opérationnel").
 *   2. ONE DERIVATION: CrossRiskCard consumes the CANONICAL
 *      deriveTripleRiskSummary object (the same one the pilotage radar
 *      renders) — the inline recount of the same four counts is retired.
 *   3. THE QUADRANT→CONSOLE FILTER: the CrossRiskCard quadrants finally
 *      drive the console's category filter (the card's caption promise).
 *   4. SHOW/HIDE TOGGLES: per-indicator visibility in the shared layout
 *      editor — hide (edit mode, per cell), restore (the hidden tray),
 *      the honest all-hidden empty state, persistence through the same
 *      layout store, and the domain parser's hidden round-trip.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

// Initialize i18n FIRST — the surfaces are French-labeled.
import "../../../i18n/i18n";
import { DashboardLayoutEditor } from "../../../features/dashboard/dashboard-layout-editor";
import {
  OperationalQueryConsole,
} from "../../../features/dashboard/components/analytics/operational-query-console";
import { CrossRiskCard } from "../../../features/dashboard/components/analytics/cross-risk-card";
import {
  deriveTripleRiskSummary,
} from "../../../features/dashboard/components/analytics/executive-statistics";
import type {
  StudentRiskProfile,
} from "../../../features/dashboard/components/analytics/operational-query-engine";
import { AnalyticsTab } from "../../../features/dashboard/tabs/analytics-tab";
import { parseStoredDashboardLayout } from "../../../domain/repository/dashboard-layout-repository";
import type {
  DashboardLayoutRepository,
  StoredDashboardLayout,
} from "../../../domain/repository/dashboard-layout-repository";
import { Ok } from "../../../core/result";
import { dashboardLayoutCacheKey } from "../../../features/dashboard/dashboard-layout-storage";
import { PersonNavigationProvider } from "../../../shared/navigation/person-navigation-context";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import type { Payment } from "../../../domain/model/payment";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Shared harness (the t-351/analytics-visuals conventions).
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// The fake dedicated layout store (the t-448 structural pattern), injected
// AROUND the real default repositories — the console's action menus read the
// real mock-repositories context, so only the dashboardLayouts slot is
// overridden (the t-448 whole-context mock would break ParentActionsMenu /
// StudentActionsMenu).
// ---------------------------------------------------------------------------
const layoutStore = {
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
};

function makeStore(): DashboardLayoutRepository {
  return {
    load: layoutStore.load as unknown as DashboardLayoutRepository["load"],
    save: layoutStore.save as unknown as DashboardLayoutRepository["save"],
    clear: layoutStore.clear as unknown as DashboardLayoutRepository["clear"],
  };
}

vi.mock("../../../app/providers/repository-provider", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../app/providers/repository-provider")
    >();
  return {
    ...actual,
    useRepositories: () => ({
      ...actual.useRepositories(),
      dashboardLayouts: makeStore(),
    }),
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  layoutStore.load.mockResolvedValue(Ok(null));
  layoutStore.save.mockResolvedValue(Ok(new Date(0).toISOString()));
  layoutStore.clear.mockResolvedValue(Ok(undefined));
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------
function profile(overrides: Partial<StudentRiskProfile> & Pick<StudentRiskProfile, "studentId" | "studentName" | "riskCategory">): StudentRiskProfile {
  return {
    studentCode: "ELV-1",
    classId: null,
    className: "Classe A",
    level: "college",
    gradeLevel: "1AM",
    parentId: "par-1",
    parentName: "Famille Test",
    parentPhone: "—",
    gpa: 12,
    isPassing: true,
    attendanceRate: 1,
    unexcusedAbsences: 0,
    debtAmount: 0,
    daysOverdue: 0,
    riskScore: 10,
    primaryRiskReason: "Profil régulier",
    ...overrides,
  };
}

const PROFILES: StudentRiskProfile[] = [
  profile({
    studentId: "s-triple",
    studentName: "Élève Triple",
    riskCategory: "triple_critical",
  }),
  profile({
    studentId: "s-academic",
    studentName: "Élève Académique",
    riskCategory: "academic_alert",
  }),
];

const EDITOR_ITEMS = [
  {
    id: "radar",
    label: "Radar de vigilance",
    content: <div data-testid="content-radar">radar</div>,
    x: 0,
    y: 0,
    w: 6,
    h: 6,
  },
  {
    id: "console",
    label: "Console de diagnostic",
    content: <div data-testid="content-console">console</div>,
    x: 6,
    y: 0,
    w: 6,
    h: 6,
  },
] as unknown as Parameters<typeof DashboardLayoutEditor>[0]["items"];

function cellExists(itemId: string): boolean {
  return Boolean(
    document.querySelector(`[data-dashboard-layout-id="${itemId}"]`),
  );
}

// ============================================================
// 1. ONE CONSOLE MOUNT
// ============================================================
const readSrc = (rel: string) =>
  readFileSync(join(__dirname, rel), "utf8");

describe("T-503 (UI-335) — ONE console mount", () => {

  it("the tab source mounts the OperationalQueryConsole EXACTLY ONCE (the pilotage duplicate retired)", () => {
    const tab = readSrc("../../../features/dashboard/tabs/analytics-tab.tsx");
    const mounts = tab.match(/<OperationalQueryConsole/g) ?? [];
    expect(mounts.length).toBe(1);
    // The retired layout item is gone.
    expect(tab).not.toContain('"pilotage-queries"');
  });

  it("the DEFAULT (Pilotage) view renders NO console; the Diagnostic view renders it", () => {
    function pay(overrides: Partial<Payment> & Pick<Payment, "id">): Payment {
      return {
        tenantId: "t1",
        receiptNumber: `REC-${overrides.id}`,
        parentId: "par-001",
        studentId: null,
        amount: 10_000,
        method: "cash",
        status: "paid",
        category: "tuition",
        installmentId: null,
        proofUrl: null,
        notes: null,
        collectedBy: "staff-1",
        collectedAt: "2025-09-15T10:00:00Z",
        createdAt: "2025-09-15T10:00:00Z",
        updatedAt: "2025-09-15T10:00:00Z",
        ...overrides,
      } as Payment;
    }
    render(
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter>
            <PersonNavigationProvider>
              <AnalyticsTab
                revenue={[{ label: "Sep", amount: 30_000 }]}
                prevRevenue={[]}
                academicYear="2025-2026"
                prevAcademicYear={null}
                debtAging={[]}
                topDebtors={[]}
                payments={[pay({ id: "p1" })]}
              />
            </PersonNavigationProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>,
    );
    // Pilotage (the default): the console is absent — the radar hero stays.
    expect(screen.queryByText("Console d'Investigation Opérationnelle")).toBeNull();
    expect(screen.getByTestId("triple-risk-summary-card")).toBeInTheDocument();

    // Diagnostic: the ONE console mount.
    fireEvent.click(
      screen.getByRole("button", { name: "Diagnostic Actif" }),
    );
    expect(
      screen.getByText("Console d'Investigation Opérationnelle"),
    ).toBeInTheDocument();
    // The radar belongs to pilotage — absent here.
    expect(screen.queryByTestId("triple-risk-summary-card")).toBeNull();
  });
});

// ============================================================
// 2. ONE DERIVATION + 3. THE QUADRANT WIRING
// ============================================================
describe("T-503 (UI-335) — CrossRiskCard consumes the canonical summary + the quadrant filter", () => {
  it("the card's counts come from the CANONICAL summary object (source pin — the inline recount retired)", () => {
    const card = readSrc("../../../features/dashboard/components/analytics/cross-risk-card.tsx");
    expect(card).toContain("summary: TripleRiskSummary");
    expect(card).toContain("summary.tripleCriticalCount");
    // The retired inline recount of the same four counts.
    expect(card).not.toContain('profiles.filter((p) => p.riskCategory === "triple_critical").length');
  });

  it("the quadrant clicks fire onSelectCategory with the four canonical categories", () => {
    const onSelectCategory = vi.fn();
    const summary = deriveTripleRiskSummary(PROFILES);
    render(
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter>
            <PersonNavigationProvider>
              <CrossRiskCard
                summary={summary}
                onSelectCategory={onSelectCategory}
              />
            </PersonNavigationProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>,
    );
    // The canonical summary feeds the quadrants: the triple count (1) and
    // the academic count (1) both come from deriveTripleRiskSummary.
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Triple Risque"));
    expect(onSelectCategory).toHaveBeenCalledWith("triple_critical");
    fireEvent.click(screen.getByText("Assiduité"));
    expect(onSelectCategory).toHaveBeenCalledWith("attendance_alert");
    fireEvent.click(screen.getByText("Tension Dette"));
    expect(onSelectCategory).toHaveBeenCalledWith("financial_tension");
  });

  it("the CONSOLE honors the controlled category filter (the quadrant's target)", () => {
    render(
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter>
            <PersonNavigationProvider>
              <OperationalQueryConsole
                profiles={PROFILES}
                selectedCategory="triple_critical"
                onSelectedCategoryChange={vi.fn()}
              />
            </PersonNavigationProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>,
    );
    // Only the triple_critical profile's row survives the filter.
    expect(screen.getByText("Élève Triple")).toBeInTheDocument();
    expect(screen.queryByText("Élève Académique")).toBeNull();
  });

  it("the console's UNCONTROLLED default is unchanged (the default triple-critical preset — the pre-T-503 callers' contract)", () => {
    render(
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter>
            <PersonNavigationProvider>
              <OperationalQueryConsole profiles={PROFILES} />
            </PersonNavigationProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>,
    );
    // The pre-T-503 console opened on the triple-critical quick query —
    // the uncontrolled default keeps exactly that behavior.
    expect(screen.getByText("Élève Triple")).toBeInTheDocument();
    expect(screen.queryByText("Élève Académique")).toBeNull();
  });

  it("a quadrant selection of a NON-triple category clears the default preset (the mutual exclusion)", () => {
    render(
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter>
            <PersonNavigationProvider>
              <OperationalQueryConsole
                profiles={PROFILES}
                selectedCategory="academic_alert"
                onSelectedCategoryChange={vi.fn()}
              />
            </PersonNavigationProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>,
    );
    // The default triple-critical preset is DEACTIVATED by the controlled
    // category — the academic row shows.
    expect(screen.getByText("Élève Académique")).toBeInTheDocument();
    expect(screen.queryByText("Élève Triple")).toBeNull();
  });
});

// ============================================================
// 4. THE SHOW/HIDE TOGGLES
// ============================================================
describe("T-503 (UI-335) — the per-indicator show/hide toggles", () => {
  it("hiding an indicator in edit mode removes it from the grid and lists it in the tray; Afficher restores it", () => {
    render(
      <DashboardLayoutEditor storageKey="t503-ui335" items={EDITOR_ITEMS} editing />,
    );
    expect(cellExists("radar")).toBe(true);
    expect(cellExists("console")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Masquer Radar de vigilance" }));
    expect(cellExists("radar")).toBe(false);
    expect(cellExists("console")).toBe(true);

    // The tray lists the hidden indicator with its restore action.
    const tray = screen.getByTestId("dashboard-hidden-tray");
    expect(within(tray).getByText(/Indicateurs masqués \(1\)/)).toBeTruthy();
    fireEvent.click(within(tray).getByRole("button", { name: "Afficher Radar de vigilance" }));
    expect(cellExists("radar")).toBe(true);
    expect(screen.queryByTestId("dashboard-hidden-tray")).toBeNull();
  });

  it("a hidden indicator stays hidden in VIEW mode (and the visible sibling renders)", () => {
    const { rerender } = render(
      <DashboardLayoutEditor storageKey="t503-ui335" items={EDITOR_ITEMS} editing />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Masquer Radar de vigilance" }));
    rerender(
      <DashboardLayoutEditor storageKey="t503-ui335" items={EDITOR_ITEMS} />,
    );
    expect(cellExists("radar")).toBe(false);
    expect(cellExists("console")).toBe(true);
    // No TRAY outside edit mode (the tray is the edit-mode home).
    expect(screen.queryByTestId("dashboard-hidden-tray")).toBeNull();
    // T-504 (UI-337) re-pin: the VIEW-MODE RESTORE BAR now renders instead —
    // the hidden indicator is ALWAYS discoverable (the owner's report: no
    // way to see the hidden thing to bring it back). The one-click restore
    // works directly from view mode.
    const bar = screen.getByTestId("dashboard-hidden-restore-bar");
    expect(within(bar).getByText(/1 indicateur masqué/)).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Afficher Radar de vigilance" }));
    expect(cellExists("radar")).toBe(true);
    expect(screen.queryByTestId("dashboard-hidden-restore-bar")).toBeNull();
  });

  it("the ALL-HIDDEN honest empty state renders when every indicator is hidden", () => {
    const { rerender } = render(
      <DashboardLayoutEditor storageKey="t503-ui335" items={EDITOR_ITEMS} editing />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Masquer Radar de vigilance" }));
    fireEvent.click(screen.getByRole("button", { name: "Masquer Console de diagnostic" }));
    rerender(
      <DashboardLayoutEditor storageKey="t503-ui335" items={EDITOR_ITEMS} />,
    );
    expect(screen.getByTestId("dashboard-all-hidden")).toBeInTheDocument();
    expect(screen.queryByTestId("content-radar")).toBeNull();
    expect(screen.queryByTestId("content-console")).toBeNull();
  });

  it("the hidden flag persists through the explicit save and a fresh mount (the same layout store)", async () => {
    const viewKey = "t503-ui335-persist";
    const { unmount } = render(
      <DashboardLayoutEditor storageKey={viewKey} items={EDITOR_ITEMS} editing />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Masquer Radar de vigilance" }));
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));

    // The explicit save wrote the server row with the hidden flag…
    await waitForSave(layoutStore.save);
    const savedLayout = layoutStore.save.mock.calls[0][1] as StoredDashboardLayout;
    expect(savedLayout.radar?.hidden).toBe(true);
    expect(savedLayout.console?.hidden).toBeUndefined();

    unmount();
    // …and the local cache round-trips it (a fresh mount on a new profile
    // with no server row reads the cache).
    layoutStore.load.mockResolvedValue(Ok(null));
    render(
      <DashboardLayoutEditor storageKey={viewKey} items={EDITOR_ITEMS} />,
    );
    expect(cellExists("radar")).toBe(false);
    expect(cellExists("console")).toBe(true);
  });

  it("the domain parser passes the hidden flag through — ONLY an explicit true (backward compatible)", () => {
    const parsed = parseStoredDashboardLayout({
      a: { x: 0, y: 0, w: 6, h: 6, hidden: true },
      b: { x: 6, y: 0, w: 6, h: 6 },
      c: { x: 0, y: 7, w: 6, h: 6, hidden: "yes" },
      d: { x: 0, y: 14, w: 6, h: 6, hidden: false },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.a.hidden).toBe(true);
    expect(parsed!.b.hidden).toBeUndefined();
    expect(parsed!.c.hidden).toBeUndefined();
    expect(parsed!.d.hidden).toBeUndefined();
  });
});

/** Await the async explicit save (the .then chain in persistNow). */
function waitForSave(mock: { mock: { calls: unknown[][] } }, expectedCalls = 1) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (mock.mock.calls.length >= expectedCalls) resolve();
      else if (Date.now() - started > 2000)
        reject(new Error("the explicit save never fired"));
      else setTimeout(check, 10);
    };
    check();
  });
}
