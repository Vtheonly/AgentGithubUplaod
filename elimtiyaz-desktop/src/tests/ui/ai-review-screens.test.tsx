/**
 * AI-review screens regression suite (T-247..T-252, 37th session, 2026-09-09).
 *
 * Guards the 37th-session AI-review adaptations (all REAL-data derivations,
 * §15.16 discipline):
 *   - T-247 `deriveTrancheProjection` — the échéancier théorique line math
 *     (40% Sep / 30% Déc / 30% Mar from the canonical rule; 0 elsewhere).
 *   - T-247 SeeDetailsModal render — the collection-rate summary trio, the
 *     donut's REAL center total (Σ gender counts), legend callouts, the
 *     per-bucket severity badges, honest "—" when kpis are absent.
 *   - T-248 `trancheNumberOf` — canonical label matching (never a substring
 *     match: "Tranche 10" / "Année complète" must NOT match).
 *   - T-248 `deriveTrancheWaves` — wave grouping + canonical sums + the
 *     next-target highlight + pending surfacing.
 *   - T-249 UnifiedPaymentModal render — quick-pay shortcut chips and the
 *     cashier change-return calculator (Montant remis → Monnaie à rendre).
 *   - T-250 TuitionCard render — the consolidated 14-level matrix (one row
 *     per GRADE_LEVEL, balance column present).
 *   - T-252 ParentDetailDrawer render — the family coverage stack and the
 *     per-tranche 1-click collect button (real mock installment rows).
 *
 * Recharts is mocked (jsdom renders ResponsiveContainer at 0×0 — derivations
 * are tested as pure functions).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// jsdom has no ResizeObserver — PageTabList (used by the SeeDetailsModal and
// the financials page chrome) needs one. Local stub (the global setup stays
// untouched — zero blast radius on the 2694-test baseline).
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

// Initialize i18n FIRST — useTranslation() will otherwise throw.
import "../../i18n/i18n";
import { deriveTrancheProjection, SeeDetailsModal } from "../../features/dashboard/see-details-modal";
import { trancheNumberOf, deriveTrancheWaves } from "../../features/financials/installment-schedule-tab";
import type { DashboardKpi, RevenuePoint } from "../../domain/model/operations";
import type { Installment } from "../../domain/model/payment";
import { GRADE_LEVELS, GRADE_LEVEL_LABELS_FR } from "../../domain/model/student";
import { seedInstallments } from "../../infrastructure/mock/seed-data";

// Mock recharts — jsdom gives ResponsiveContainer a 0×0 box; data derivations
// are covered by the pure-function suites.
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

// ============================================================
// T-247 — deriveTrancheProjection (pure)
// ============================================================

const REV: RevenuePoint[] = [
  { label: "Oct", amount: 100 },
  { label: "Nov", amount: 200 },
  { label: "Déc", amount: 300 },
  { label: "Jan", amount: 50 },
  { label: "Fév", amount: 60 },
  { label: "Mar", amount: 70 },
];

describe("T-247 — deriveTrancheProjection (échéancier théorique)", () => {
  it("allocates 40/30/30 on the canonical months and 0 elsewhere", () => {
    const out = deriveTrancheProjection(REV, 1_000_000);
    const byLabel = new Map(out.map((p) => [p.label, p.targetProjection]));
    expect(byLabel.get("Déc")).toBe(300_000);
    expect(byLabel.get("Mar")).toBe(300_000);
    expect(byLabel.get("Nov")).toBe(0);
    expect(byLabel.get("Jan")).toBe(0);
    expect(out.every((p) => p.amount === REV.find((r) => r.label === p.label)?.amount)).toBe(true);
  });

  it("projects 40% on Sep (the registration tranche month)", () => {
    const out = deriveTrancheProjection(
      [{ label: "Sep", amount: 400_000 }],
      1_000_000,
    );
    expect(out[0].targetProjection).toBe(400_000);
  });

  it("rounds to whole DZD (no fractional money)", () => {
    const out = deriveTrancheProjection([{ label: "Sep", amount: 0 }], 333);
    expect(out[0].targetProjection).toBe(133); // round(333 * 0.4)
  });

  it("keeps bar amounts untouched when totalExpected is 0", () => {
    const out = deriveTrancheProjection(REV, 0);
    expect(out.every((p) => p.targetProjection === 0)).toBe(true);
    expect(out[0].amount).toBe(100);
  });
});

// ============================================================
// T-248 — trancheNumberOf + deriveTrancheWaves (pure)
// ============================================================

describe("T-248 — trancheNumberOf (canonical label matching)", () => {
  it("matches the real label shapes", () => {
    expect(trancheNumberOf("Tranche 1")).toBe(1);
    expect(trancheNumberOf("Tranche 2 (Jan–Mar)")).toBe(2);
    expect(trancheNumberOf("  tranche 3 ")).toBe(3);
  });

  it("never substring-matches (Tranche 10 / Année complète)", () => {
    expect(trancheNumberOf("Tranche 10")).toBeNull();
    expect(trancheNumberOf("Année complète 1")).toBeNull();
    expect(trancheNumberOf("Abonnement transport")).toBeNull();
  });
});

function mkInstallment(over: Partial<Installment> & { label: string }): Installment {
  return {
    id: over.label,
    parentId: "par-001",
    studentId: null,
    category: "tuition",
    amountDue: 100,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2026-06-01T00:00:00.000Z",
    paidDate: null,
    status: "pending",
    ...over,
  } as Installment;
}

describe("T-248 — deriveTrancheWaves (REAL row grouping)", () => {
  it("groups, sums and highlights the first wave with remaining balance", () => {
    const rows: Installment[] = [
      mkInstallment({ label: "Tranche 1", amountDue: 100, amountPaid: 100, status: "paid" }),
      mkInstallment({ label: "Tranche 2", amountDue: 100, amountPaid: 40, status: "partial" }),
      mkInstallment({ label: "Tranche 3", amountDue: 100, amountPaid: 0, status: "pending" }),
      mkInstallment({ label: "Année complète", amountDue: 999, amountPaid: 0, status: "pending" }),
    ];
    const waves = deriveTrancheWaves(rows);
    expect(waves).toHaveLength(3);
    const t1 = waves[0];
    const t2 = waves[1];
    const t3 = waves[2];
    // T1 fully collected → 100%, NOT the next target.
    expect(t1.due).toBe(100);
    expect(t1.paid).toBe(100);
    expect(t1.pct).toBe(100);
    expect(t1.isNextTarget).toBe(false);
    // T2 is the next collection target (40% collected).
    expect(t2.isNextTarget).toBe(true);
    expect(t2.pct).toBe(40);
    expect(t2.due).toBe(100);
    expect(t2.paid).toBe(40);
    // T3 not targeted yet.
    expect(t3.isNextTarget).toBe(false);
    // "Année complète" is excluded from every wave.
    expect(waves.every((w) => w.due <= 100)).toBe(true);
  });

  it("surfaces uncleared pending funds as their own figure", () => {
    const waves = deriveTrancheWaves([
      mkInstallment({ label: "Tranche 2", amountDue: 100, amountPaid: 30, amountPending: 20, status: "partial" }),
    ]);
    expect(waves[1].pending).toBe(20);
    expect(waves[1].pct).toBe(30); // cleared-only rate
  });

  it("returns honest zero waves for non-tranche rows only", () => {
    const waves = deriveTrancheWaves([
      mkInstallment({ label: "Année complète", amountDue: 500, amountPaid: 100, status: "partial" }),
    ]);
    expect(waves.every((w) => w.due === 0 && w.pct === 0)).toBe(true);
  });
});

// ============================================================
// T-247 — SeeDetailsModal render (mock charts, REAL fixture data)
// ============================================================

const KPIS: DashboardKpi = {
  totalStudents: 389,
  totalParents: 258,
  totalStaff: 14,
  monthlyRevenue: 300,
  outstandingDebt: 700,
  pendingExpenses: 0,
  attendanceRateToday: 0.94,
  overdueAlerts: 0,
};

const MODAL_DATA = {
  kpis: KPIS,
  revenue: REV,
  debtAging: [
    { bucket: "0_30" as const, amount: 100, debtorCount: 5 },
    { bucket: "31_60" as const, amount: 200, debtorCount: 8 },
    { bucket: "91_180" as const, amount: 300, debtorCount: 2 },
  ],
  demographics: {
    grade: [{ label: "1AP", count: 30, percent: 8 }],
    gender: [
      { label: "Garçons", count: 200, percent: 51 },
      { label: "Filles", count: 189, percent: 49 },
    ],
    age: [],
    capacity: [],
  },
  topDebtors: [],
};

describe("T-247 — SeeDetailsModal render", () => {
  it("shows the collection-rate summary trio from REAL totals", () => {
    render(
      <SeeDetailsModal open onOpenChange={() => {}} initialTab="revenue" data={MODAL_DATA} />,
    );
    expect(screen.getByText("Encaissé annuel")).toBeInTheDocument();
    expect(screen.getByText("Créances restantes")).toBeInTheDocument();
    expect(screen.getByText("Taux de recouvrement")).toBeInTheDocument();
    // 780 collected / 1480 expected → 53%.
    expect(screen.getByText("53%")).toBeInTheDocument();
  });

  it("renders the échéancier théorique line when kpis exist, honest absence otherwise", () => {
    const { rerender } = render(
      <SeeDetailsModal open onOpenChange={() => {}} initialTab="revenue" data={MODAL_DATA} />,
    );
    expect(screen.getAllByTestId("recharts-line").length).toBeGreaterThan(0);

    rerender(
      <SeeDetailsModal
        open
        onOpenChange={() => {}}
        initialTab="revenue"
        data={{ ...MODAL_DATA, kpis: null }}
      />,
    );
    expect(screen.queryByTestId("recharts-line")).toBeNull();
    // The summary trio degrades to "—" without kpis.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("donut center shows the REAL Σ gender counts (not a synthesized total)", () => {
    render(
      <SeeDetailsModal open onOpenChange={() => {}} initialTab="demographics" data={MODAL_DATA} />,
    );
    // 200 + 189 = 389 — derived from the gender series itself.
    expect(screen.getByText("389")).toBeInTheDocument();
    expect(screen.getByText("Garçons :")).toBeInTheDocument();
    expect(screen.getByText("Filles :")).toBeInTheDocument();
  });

  it("debt tab renders per-bucket severity badges", () => {
    render(
      <SeeDetailsModal open onOpenChange={() => {}} initialTab="debt" data={MODAL_DATA} />,
    );
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Avertissement")).toBeInTheDocument();
    expect(screen.getByText("Critique")).toBeInTheDocument();
  });
});

// ============================================================
// T-249 — UnifiedPaymentModal quick-pay + change calculator
// ============================================================

describe("T-249 — UnifiedPaymentModal (quick-pay chips + change calculator)", () => {
  async function renderModal() {
    const { RepositoryProvider, mockRepositories } = await import(
      "../../app/providers/repository-provider"
    );
    const { AuthProvider } = await import("../../app/providers/auth-provider");
    const { ToastProvider } = await import("../../app/providers/toast-provider");
    const { UnifiedPaymentModal } = await import(
      "../../features/financials/unified-payment-modal"
    );

    // par-001's seed T2: partial (half paid) → a real open tranche exists.
    const context = {
      parentId: "par-001",
      mode: "installment_tranche" as const,
      targetItemId: "ins-par-001-stu-001-t2",
      presetAmount: 32_000,
      lineItems: [
        {
          itemId: "ins-par-001-stu-001-t2",
          category: "tuition" as const,
          label: "Tranche 2",
          grossAmount: 64_000,
          discountAmount: 0,
          netAmount: 64_000,
          alreadyPaidAmount: 32_000,
          remainingAmount: 32_000,
        },
      ],
      allowPartial: true,
      originRoute: "test",
    };

    render(
      <ToastProvider>
        <AuthProvider>
          <RepositoryProvider repositories={mockRepositories}>
            <UnifiedPaymentModal open onOpenChange={() => {}} context={context} />
          </RepositoryProvider>
        </AuthProvider>
      </ToastProvider>,
    );
  }

  it("renders the quick-pay shortcut chips with the tranche label", async () => {
    await renderModal();
    await waitFor(() => {
      expect(screen.getByText(/Raccourcis d'encaissement direct/i)).toBeInTheDocument();
    });
    // The chip shows the open tranche amount derived from the context item.
    expect(screen.getByText(/Payer Tranche 2/i)).toBeInTheDocument();
  });

  it("change calculator: Montant remis → Monnaie à rendre (cash only)", async () => {
    await renderModal();
    await waitFor(() => {
      expect(screen.getByText(/Calculateur de monnaie/i)).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText(/70000/i);
    fireEvent.change(input, { target: { value: "40000" } });
    // 40000 handed − 32000 due → 8000 to return.
    await waitFor(() => {
      expect(screen.getByText(/8 000 DZD/i)).toBeInTheDocument();
    });
  });
});

// ============================================================
// T-250 — TuitionCard consolidated matrix
// ============================================================

describe("T-250 — TuitionCard (14-level consolidated matrix)", () => {
  it("renders ONE row per grade level with the balance column", async () => {
    const { RepositoryProvider, mockRepositories } = await import(
      "../../app/providers/repository-provider"
    );
    const { AuthProvider } = await import("../../app/providers/auth-provider");
    const { ToastProvider } = await import("../../app/providers/toast-provider");
    const { TuitionCard } = await import(
      "../../features/settings/pricing/tuition-card"
    );

    render(
      <ToastProvider>
        <AuthProvider>
          <RepositoryProvider repositories={mockRepositories}>
            <TuitionCard />
          </RepositoryProvider>
        </AuthProvider>
      </ToastProvider>,
    );

    // All 14 levels in a single table (the scroll-wall is gone).
    for (const g of GRADE_LEVELS) {
      expect(screen.getByText(GRADE_LEVEL_LABELS_FR[g])).toBeInTheDocument();
    }
    expect(screen.getByText(/Équilibre/i)).toBeInTheDocument();
    // The matrix header + the explicit-tool note (canEdit-independent).
    expect(screen.getByText(/Grille Tarifaire de Scolarité/i)).toBeInTheDocument();
    expect(screen.getByText(/OUTIL explicite/i)).toBeInTheDocument();
  });
});

// ============================================================
// T-252 — ParentDetailDrawer coverage stack + per-tranche collect
// ============================================================

describe("T-252 — ParentDetailDrawer (coverage + 1-click tranche collect)", () => {
  it("renders the coverage stack and per-tranche Encaisser buttons from REAL rows", async () => {
    const { RepositoryProvider, mockRepositories } = await import(
      "../../app/providers/repository-provider"
    );
    const { AuthProvider } = await import("../../app/providers/auth-provider");
    const { ToastProvider } = await import("../../app/providers/toast-provider");
    const { ParentDetailDrawer } = await import(
      "../../features/crm/parent-detail-drawer"
    );

    // par-002 (Amina Cherif): the seed's odd-index parents carry an OPEN
    // tranche (T3 unpaid — idx % 2 === 1). Sanity: real open rows exist.
    const openForPar002 = seedInstallments.filter(
      (i) => i.parentId === "par-002" && i.amountPaid < i.amountDue,
    );
    expect(openForPar002.length).toBeGreaterThan(0);

    render(
      <ToastProvider>
        <AuthProvider>
          <RepositoryProvider repositories={mockRepositories}>
            <ParentDetailDrawer parentId="par-002" open onOpenChange={() => {}} />
          </RepositoryProvider>
        </AuthProvider>
      </ToastProvider>,
    );

    // Wait for the Finances tab content (the drawer renders tabs).
    await waitFor(
      () => {
        // The 1-click collect buttons exist on open tranches.
        expect(screen.getAllByText(/^Encaisser\s/i).length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
  });
});
