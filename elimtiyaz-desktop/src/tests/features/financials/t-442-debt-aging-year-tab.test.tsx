/**
 * T-442 (UI-323) — the Debt Aging drawer's « Par année » tab UI suite.
 *
 * Pins the owner's core mandate ON THE DEBT SURFACE: "if a student has an
 * outstanding balance from 2024, I should be able to open the 2024 record
 * and see exactly what they owed in 2024, what they paid during that year,
 * what services they had selected, and what remains unpaid. The same
 * should be available separately for 2025, 2026, etc."
 *
 * The contract:
 *   1. The family drill-down drawer gains the « Par année » tab.
 *   2. Selecting it mounts the SAME canonical year-history section the
 *      CRM drawer renders (one engine, one component, two surfaces) —
 *      with the per-year cards, the « Services de l'année » breakdown,
 *      the payments with their coverage, and the per-year prior-debt
 *      banner.
 *   3. The per-year numbers reconcile with the debt-aging row's
 *      outstanding (INV-20a — the same rows, the same clamp).
 *   4. The conditional mount (T-430): the panel's observables subscribe
 *      only when the tab is selected — the obligations tab renders
 *      without the year cards until then.
 *
 * Run:
 *   npx vitest run src/tests/features/financials/t-442-debt-aging-year-tab.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "../../../i18n/i18n";
import { DebtAgingTab } from "../../../features/financials/debt-aging-tab";
import { computeDebtAgingAnalysis } from "../../../domain/calc/ledger/debt-aging";
import type { DebtAgingAnalysis } from "../../../domain/calc/ledger/debt-aging";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Installment, Payment, PaymentAllocation } from "../../../domain/model/payment";
import type { Student } from "../../../domain/model/student";
import type { Parent as ParentModel } from "../../../domain/model/parent";
import type { AcademicYear } from "../../../domain/model/academic";

/* ── Fixtures: a two-year debtor family at the pinned clock ─────────── */

const NOW = new Date("2027-01-15T12:00:00.000Z");
const P_A = "p-archetype-a";

const YEARS: AcademicYear[] = [
  { id: "ay-2024", tenantId: "t1", code: "2024-2025", label: "2024-2025", startDate: "2024-09-01", endDate: "2025-06-30", termStructure: "trimester", isCurrent: false, isArchived: true },
  { id: "ay-2025", tenantId: "t1", code: "2025-2026", label: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30", termStructure: "trimester", isCurrent: false, isArchived: true },
  { id: "ay-2026", tenantId: "t1", code: "2026-2027", label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30", termStructure: "trimester", isCurrent: true, isArchived: false },
];

let insSeq = 0;
function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  insSeq += 1;
  return {
    id: overrides.id ?? `ins-${insSeq}`,
    parentId: overrides.parentId ?? P_A,
    studentId: overrides.studentId ?? "stu-a",
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    trancheNumber: "trancheNumber" in overrides ? overrides.trancheNumber : 1,
    amountDue: overrides.amountDue ?? 0,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2024-09-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "unpaid",
    academicYearId: overrides.academicYearId,
  };
}

/** The family's REAL rows — the debt spans TWO prior years. */
const FAMILY_INSTALLMENTS: readonly Installment[] = [
  // ── 2024-2025 (the origin year of the debt) ──
  makeInstallment({ id: "fi-24", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: 25_000, amountPaid: 25_000, dueDate: "2024-09-15", paidDate: "2024-09-20", status: "paid", academicYearId: "ay-2024" }),
  makeInstallment({ id: "t1-24", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 60_000, amountPaid: 40_000, dueDate: "2024-09-15", status: "partial", academicYearId: "ay-2024" }),
  makeInstallment({ id: "tr1-24", label: "Transport T1", category: "transport", trancheNumber: 1, amountDue: 20_000, dueDate: "2024-09-15", status: "unpaid", academicYearId: "ay-2024" }),
  // ── 2025-2026 (a second debt year) ──
  makeInstallment({ id: "t1-25", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 80_000, dueDate: "2025-09-15", status: "unpaid", academicYearId: "ay-2025" }),
  // ── 2026-2027 (the current year) ──
  makeInstallment({ id: "t1-26", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 90_000, dueDate: "2026-09-15", status: "unpaid", academicYearId: "ay-2026" }),
];

const FAMILY_PAYMENTS: readonly Payment[] = [
  {
    id: "pay-24a", tenantId: "t1", receiptNumber: "REC-2024-000001", parentId: P_A, studentId: null,
    amount: 25_000, method: "cash", status: "paid", category: null, installmentId: null,
    proofUrl: null, notes: null, collectedBy: "usr-1",
    collectedAt: "2024-09-20T10:00:00.000Z", createdAt: "2024-09-20T10:00:00.000Z", updatedAt: "2024-09-20T10:00:00.000Z",
    academicYearId: "ay-2024",
  },
  {
    id: "pay-24b", tenantId: "t1", receiptNumber: "REC-2024-000002", parentId: P_A, studentId: null,
    amount: 40_000, method: "cash", status: "paid", category: null, installmentId: null,
    proofUrl: null, notes: null, collectedBy: "usr-1",
    collectedAt: "2024-11-05T10:00:00.000Z", createdAt: "2024-11-05T10:00:00.000Z", updatedAt: "2024-11-05T10:00:00.000Z",
    academicYearId: "ay-2024",
  },
];

const FAMILY_ALLOCATIONS: readonly PaymentAllocation[] = [
  { id: "alloc-1", paymentId: "pay-24a", chargeId: null, installmentId: "fi-24", category: "tuition", allocatedAmount: 25_000, label: "Frais d'inscription (FI)", createdAt: "2024-09-20T10:00:00.000Z", academicYearId: "ay-2024" },
  { id: "alloc-2", paymentId: "pay-24b", chargeId: null, installmentId: "t1-24", category: "tuition", allocatedAmount: 40_000, label: "Tranche 1 — Scolarité (V1)", createdAt: "2024-11-05T10:00:00.000Z", academicYearId: "ay-2024" },
];

const FAMILY_LEDGER: readonly LedgerEntry[] = [
  {
    id: "led-1", tenantId: "t1", accountId: `parent:${P_A}:category:all`, parentId: P_A, studentId: "stu-a",
    category: null, amount: -25_000, type: "payment", sourceType: "payment", sourceId: "pay-24a",
    method: "cash", receiptNumber: "REC-2024-000001", paymentStatus: "paid", reversesId: null,
    description: "Encaissement", actorId: "usr-1", actorName: "Staff", at: "2024-09-20T10:00:00.000Z", metadata: {},
  },
  {
    id: "led-2", tenantId: "t1", accountId: `parent:${P_A}:category:all`, parentId: P_A, studentId: "stu-a",
    category: null, amount: -40_000, type: "payment", sourceType: "payment", sourceId: "pay-24b",
    method: "cash", receiptNumber: "REC-2024-000002", paymentStatus: "paid", reversesId: null,
    description: "Encaissement", actorId: "usr-1", actorName: "Staff", at: "2024-11-05T10:00:00.000Z", metadata: {},
  },
];

function paymentEntryLedger(parentId: string, at: string, amount = -8_000): LedgerEntry {
  return {
    id: `led-${parentId}-${at}`,
    tenantId: "t1",
    accountId: `parent:${parentId}:category:tuition`,
    parentId,
    studentId: `stu-${parentId}`,
    category: "tuition",
    amount,
    type: "payment",
    sourceType: "payment",
    sourceId: "pay-x",
    method: "cash",
    receiptNumber: null,
    paymentStatus: "paid",
    reversesId: null,
    description: "Encaissement",
    actorId: "usr-1",
    actorName: "Staff",
    at,
    metadata: {},
  };
}

const ARCHETYPE_A: DebtAgingAnalysis = computeDebtAgingAnalysis({
  parentId: P_A,
  installments: FAMILY_INSTALLMENTS,
  ledgerEntries: [...FAMILY_LEDGER, paymentEntryLedger(P_A, new Date(2025, 8, 5).toISOString())],
  academicYears: YEARS.map((y) => ({ code: y.code, startDate: y.startDate, endDate: y.endDate })),
  now: NOW,
});
void ARCHETYPE_A;

/* ── The repository / auth / router stubs ───────────────────────────── */

function obs<T>(value: T) {
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      listeners.add(fn);
      fn(value);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

const STUDENTS: Student[] = [
  {
    id: "stu-a", parentId: P_A, studentCode: "ELV-A", firstName: "Enfant", middleName: null, lastName: "A",
    dateOfBirth: "2015-01-01", gender: "male", gradeLevelId: null, classId: null, enrollmentDate: "2024-09-01",
    displayName: "Enfant A", isActive: true, tenantId: "t1", filiereCode: null, specialiteCode: null, deletedAt: null,
  } as unknown as Student,
];

const PARENTS: ParentModel[] = [
  {
    id: P_A, tenantId: "t1", parentCode: "PAR-A", firstName: "Parent", lastName: "A",
    primaryPhone: "0550000000", secondaryPhone: null, email: null, nationalId: null, occupation: null,
    address: null, city: null, postalCode: null, relationship: "father", notes: null, isActive: true,
    isFinanciallyRestricted: false, authUserId: null, displayName: "Famille A", deletedAt: null,
  } as unknown as ParentModel,
];

const agingObs = obs<DebtAgingAnalysis[]>([ARCHETYPE_A]);

let state: Record<string, unknown>;

function makeState() {
  return {
    debt: {
      observeAging: () => agingObs,
      refreshAging: vi.fn(async () => undefined),
    },
    students: { observe: () => obs(STUDENTS) },
    parents: { observe: () => obs(PARENTS) },
    // The T-442 « Par année » tab's canonical streams — the SAME methods
    // the CRM parent drawer consumes.
    installments: { observeByParent: (pid: string) => obs(pid === P_A ? FAMILY_INSTALLMENTS : []) },
    payments: {
      observeByParent: (pid: string) => obs(pid === P_A ? FAMILY_PAYMENTS : []),
      observeAllocations: () => obs(FAMILY_ALLOCATIONS),
    },
    ledger: { observeByParent: (pid: string) => obs(pid === P_A ? FAMILY_LEDGER : []) },
    academicYears: { observeAll: () => obs(YEARS) },
    pricing: {
      listConfigs: vi.fn(async () => ({ ok: true, value: [] })),
    },
  };
}

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));

vi.mock("../../../app/providers/auth-provider", () => ({
  useAuth: () => ({
    session: {
      userId: "usr-1",
      permissions: new Set(["collect_payment"]),
      has: (p: string) => p === "collect_payment",
    },
  }),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

/* ── The suite ──────────────────────────────────────────────────────── */

beforeEach(() => {
  cleanup();
  state = makeState();
  navigateMock.mockReset();
});

describe("T-442 — the Debt Aging drawer's « Par année » tab (the per-year debt-origin breakdown)", () => {
  it("the family drill-down drawer carries the « Par année » tab — the per-year record is reachable FROM the debt surface", async () => {
    render(<DebtAgingTab />);
    await waitFor(() => {
      expect(screen.getByText(/Famille A/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Famille A/i));
    await waitFor(() => {
      expect(screen.getByText("Suivi des dettes")).toBeTruthy();
    });
    expect(screen.getByText("Par année")).toBeTruthy();
  });

  it("the obligations tab does NOT render the year cards (the conditional mount — T-430); selecting « Par année » mounts the canonical year-history section", async () => {
    render(<DebtAgingTab />);
    await waitFor(() => {
      expect(screen.getByText(/Famille A/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Famille A/i));
    await waitFor(() => {
      expect(screen.getByText(/Obligations/i)).toBeTruthy();
    });

    // Before the tab selection: the year-history section is NOT mounted.
    expect(screen.queryByText(/Historique par Année Scolaire/i)).toBeNull();

    // Select the tab → the SAME section the CRM drawer renders mounts.
    fireEvent.click(screen.getByText("Par année"));
    await waitFor(() => {
      expect(screen.getByText(/Historique par Année Scolaire/i)).toBeTruthy();
    });
    // One CARD per year with charges (the year code inside a BUTTON —
    // the year card's header; the table's origin-year cell and the
    // banner's chips are not buttons).
    for (const code of ["2024-2025", "2025-2026", "2026-2027"]) {
      expect(
        screen.getAllByText(code).some((el) => el.closest("button") != null),
      ).toBe(true);
    }
  });

  it("opening the 2024-2025 record shows exactly what they owed in 2024, what they paid, which services they had selected, and what remains unpaid", async () => {
    render(<DebtAgingTab />);
    await waitFor(() => {
      expect(screen.getByText(/Famille A/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Famille A/i));
    fireEvent.click(screen.getByText("Par année"));
    await waitFor(() => {
      expect(screen.getByText(/Historique par Année Scolaire/i)).toBeTruthy();
    });

    // The per-year prior-debt banner enumerates EACH year's debt.
    expect(screen.getByText(/Dette des années antérieures encore due aujourd'hui/)).toBeTruthy();
    expect(screen.getByText(/2024-2025 : 40[\s\u00A0\u202F]?000/)).toBeTruthy(); // 20,000 tuition + 20,000 transport
    expect(screen.getByText(/2025-2026 : 80[\s\u00A0\u202F]?000/)).toBeTruthy();

    // Open the 2024-2025 record (the origin year of the debt — the year
    // CARD's header button, not the table cell or the banner chip).
    const yearCardButton = screen
      .getAllByText("2024-2025")
      .map((el) => el.closest("button"))
      .find((b): b is HTMLButtonElement => b != null);
    expect(yearCardButton).toBeDefined();
    fireEvent.click(yearCardButton!);
    await waitFor(() => {
      expect(screen.getByText(/Services de l'année \(3\)/)).toBeTruthy();
    });

    // WHAT THEY OWED IN 2024 (per service): FI 25,000 · Scolarité 60,000 ·
    // Transport 20,000 — with paid/remaining per group.
    const tuitionRow = screen.getByText("Scolarité").closest("li");
    expect(tuitionRow?.textContent).toContain("60");
    expect(tuitionRow?.textContent).toContain("40"); // paid (the stored truth)
    expect(tuitionRow?.textContent).toContain("Reste 20");
    const transportRow = screen.getByText("Transport").closest("li");
    expect(transportRow?.textContent).toContain("Reste 20");

    // WHAT THEY PAID DURING 2024 — itemized with the coverage lines (the
    // allocation records exist in this fixture).
    expect(screen.getByText(/Paiements de l'année \(2\)/)).toBeTruthy();
    expect(screen.getAllByText(/Frais d'inscription \(FI\)/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/couverture non enregistrée/)).toBeNull();
  });

  it("the per-year numbers reconcile with the debt-aging row's outstanding (INV-20a — the same rows, the same clamp)", async () => {
    render(<DebtAgingTab />);
    await waitFor(() => {
      expect(screen.getByText(/Famille A/i)).toBeTruthy();
    });
    // The row's outstanding: 20,000 + 20,000 + 80,000 + 90,000 = 210,000.
    expect(screen.getByText(/210[\s\u00A0\u202F]?000/)).toBeTruthy();

    // The per-year enumeration sums to the same prior-years aggregate
    // (40,000 + 80,000 = 120,000 — the current year is not "prior").
    fireEvent.click(screen.getByText(/Famille A/i));
    fireEvent.click(screen.getByText("Par année"));
    await waitFor(() => {
      expect(screen.getByText(/Dette des années antérieures encore due aujourd'hui/)).toBeTruthy();
    });
    const banner = screen.getByText(/Dette des années antérieures encore due aujourd'hui/);
    expect(banner.textContent).toContain("120");
  });
});
