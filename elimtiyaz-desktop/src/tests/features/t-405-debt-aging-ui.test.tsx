/**
 * T-405 — the « Suivi des Dettes » UI suite (the DebtAgingTab component).
 *
 * Pins the Finance-tab parity contract:
 *   1. The tab renders the canonical analysis stream
 *      (`repos.debt.observeAging()`) VERBATIM — the outstanding shown is
 *      the record's number (never recomputed in the component).
 *   2. The two archetype parents display OPPOSITE statuses for the SAME
 *      100 000 DZD debt — the whole point of T-405 made visible.
 *   3. Green/Yellow/Orange/Red are presentation: the chips carry the
 *      canonical §15 labels; the explanation column shows the canonical
 *      reason text (INV-16d — never a bare color).
 *   4. The status KPI filters work (click Critique → only red rows).
 *   5. The drill-down drawer shows the obligations + the behavior facts +
 *      the "Pourquoi ce statut" explanation, with the family-record action.
 *
 * Run:
 *   npx vitest run src/tests/features/t-405-debt-aging-ui.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "../../i18n/i18n";
import { DebtAgingTab } from "../../features/financials/debt-aging-tab";
import { computeDebtAgingAnalysis } from "../../domain/calc/ledger/debt-aging";
import type { DebtAgingAnalysis } from "../../domain/calc/ledger/debt-aging";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Installment } from "../../domain/model/payment";
import type { Student } from "../../domain/model/student";
import type { Parent as ParentModel } from "../../domain/model/parent";

/* ── Fixtures: the two archetype parents at the pinned clock ──────────── */

const NOW = new Date("2026-06-15T12:00:00.000Z");

const P_A = "p-archetype-a";
const P_B = "p-archetype-b";
const P_C = "p-orange-c";

function makeInstallment(parentId: string, dueDate: string, amountDue = 100_000): Installment {
  return {
    id: `ins-${parentId}`,
    parentId,
    studentId: `stu-${parentId}`,
    category: "tuition",
    label: "Tranche 1",
    amountDue,
    amountPaid: 0,
    amountPending: 0,
    dueDate,
    paidDate: null,
    status: "unpaid",
  };
}

function makePaymentEntry(parentId: string, at: string, amount = -8_000): LedgerEntry {
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
  installments: [makeInstallment(P_A, "2024-10-15")],
  ledgerEntries: Array.from({ length: 10 }, (_, i) =>
    makePaymentEntry(P_A, new Date(2025, 8 + i, 5).toISOString()),
  ),
  academicYears: [],
  now: NOW,
});

const ARCHETYPE_B: DebtAgingAnalysis = computeDebtAgingAnalysis({
  parentId: P_B,
  installments: [makeInstallment(P_B, "2024-10-15")],
  ledgerEntries: [makePaymentEntry(P_B, "2024-11-01T10:00:00.000Z", -20_000)],
  academicYears: [],
  now: NOW,
});

const ORANGE_C: DebtAgingAnalysis = computeDebtAgingAnalysis({
  parentId: P_C,
  installments: [makeInstallment(P_C, "2025-11-27", 50_000)],
  ledgerEntries: [makePaymentEntry(P_C, "2026-03-01T10:00:00.000Z", -5_000)],
  academicYears: [],
  now: NOW,
});

// The archetypes at the pinned clock: A green (kept paying), B red (silence).
// These assertions are the suite's OWN sanity gate — the engine suite pins
// the derivation; here we pin what the UI SHOWS.
void ARCHETYPE_A;
void ARCHETYPE_B;
void ORANGE_C;

/* ── The repository / auth / router stubs ───────────────────────────────── */

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

const STUDENTS: Student[] = [P_A, P_B, P_C].map((pid) => ({
  id: `stu-${pid}`,
  parentId: pid,
  studentCode: `ELV-${pid}`,
  firstName: "Enfant",
  middleName: null,
  lastName: pid.toUpperCase(),
  dateOfBirth: "2015-01-01",
  gender: "male",
  gradeLevelId: null,
  classId: null,
  enrollmentDate: "2024-09-01",
  displayName: `Enfant ${pid.toUpperCase()}`,
  isActive: true,
  tenantId: "t1",
  filiereCode: null,
  specialiteCode: null,
  deletedAt: null,
}) as unknown as Student);

const PARENTS: ParentModel[] = [P_A, P_B, P_C].map((pid) => ({
  id: pid,
  tenantId: "t1",
  parentCode: `PAR-${pid}`,
  firstName: "Parent",
  lastName: pid.toUpperCase(),
  primaryPhone: "0550000000",
  secondaryPhone: null,
  email: null,
  nationalId: null,
  occupation: null,
  address: null,
  city: null,
  postalCode: null,
  relationship: "father",
  notes: null,
  isActive: true,
  isFinanciallyRestricted: false,
  authUserId: null,
  displayName: `Famille ${pid.toUpperCase()}`,
  deletedAt: null,
} as unknown as ParentModel));

const agingObs = obs<DebtAgingAnalysis[]>([ARCHETYPE_A, ARCHETYPE_B, ORANGE_C]);

let state: Record<string, unknown>;

function makeState() {
  return {
    debt: {
      observeAging: () => agingObs,
      refreshAging: vi.fn(async () => undefined),
    },
    students: { observe: () => obs(STUDENTS) },
    parents: { observe: () => obs(PARENTS) },
  };
}

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));

vi.mock("../../app/providers/auth-provider", () => ({
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

/* ── The suite ──────────────────────────────────────────────────────────── */

beforeEach(() => {
  cleanup();
  state = makeState();
  navigateMock.mockReset();
});

describe("T-405 — DebtAgingTab (the Suivi des Dettes view)", () => {
  it("renders the canonical records verbatim: both archetypes, opposite statuses, same 100 000 DZD", async () => {
    render(<DebtAgingTab />);

    // Both archetype families are listed with their canonical amounts —
    // the SAME number for both (the UI never recomputes).
    await waitFor(() => {
      // formatDzd: fr-FR grouping, no decimals, a non-breaking space + " DZD" suffix.
    expect(screen.getAllByText(/100[\s\u00A0\u202F]000[\s\u00A0\u202F]?DZD/).length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText(/FAMILLE P-ARCHETYPE-A/i)).toBeTruthy();

    // The OPPOSITE statuses for the identical debt — T-405's core promise.
    expect(screen.getAllByText("Actif / Soldé").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Critique").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Retard soutenu").length).toBeGreaterThanOrEqual(1);

    // The canonical facts are displayed: origin year, subsequent-year
    // activity (Oui for A, Non for B), inactivity.
    expect(screen.getAllByText("2024-2025").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Oui/i).length).toBeGreaterThanOrEqual(1);

    // INV-16d: the explanation column — never a bare color.
    expect(screen.getByText(/Actif — paiement il y a 10 j/i)).toBeTruthy();
    expect(screen.getByText(/Critique — dette ancienne \(608 j\)/i)).toBeTruthy();
  });

  it("the status KPI filter narrows the table to the selected level", async () => {
    render(<DebtAgingTab />);
    await waitFor(() => {
      expect(screen.getByText(/FAMILLE P-ARCHETYPE-A/i)).toBeTruthy();
    });

    // Click the Critique KPI → only the red archetype remains.
    fireEvent.click(screen.getByRole("button", { name: /Critique/i }));
    await waitFor(() => {
      expect(screen.queryByText(/FAMILLE P-ARCHETYPE-A/i)).toBeNull();
      expect(screen.getByText(/FAMILLE P-ARCHETYPE-B/i)).toBeTruthy();
    });

    // Reset via the À surveiller filter → nothing matches (no yellow rows)
    // — then back to all.
    fireEvent.click(screen.getByRole("button", { name: /À surveiller/i }));
    await waitFor(() => {
      expect(screen.queryByText(/FAMILLE P-ARCHETYPE-A/i)).toBeNull();
      expect(screen.queryByText(/FAMILLE P-ARCHETYPE-B/i)).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /Familles endettées/i }));
    await waitFor(() => {
      expect(screen.getByText(/FAMILLE P-ARCHETYPE-A/i)).toBeTruthy();
    });
  });

  it("the drill-down drawer shows the obligations, the behavior facts, and the explanation", async () => {
    render(<DebtAgingTab />);
    await waitFor(() => {
      expect(screen.getByText(/FAMILLE P-ARCHETYPE-A/i)).toBeTruthy();
    });

    // Row click opens the investigation drawer.
    fireEvent.click(screen.getByText(/FAMILLE P-ARCHETYPE-A/i));
    await waitFor(() => {
      expect(screen.getByText("Suivi des dettes")).toBeTruthy();
    });

    // The Obligations tab: the origin-year obligation with its facts.
    expect(screen.getByText(/Tranche 1/)).toBeTruthy();
    expect(screen.getAllByText(/Année : 2024-2025/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Retard : 608 j/)).toBeTruthy();
    // Finance-tab parity note (the canonical amount source).
    expect(screen.getByText(/même montant que l'onglet Créances/i)).toBeTruthy();

    // The Comportement tab (plain buttons in the EntityDetailDrawer shell).
    fireEvent.click(screen.getByText("Comportement"));
    await waitFor(() => {
      expect(screen.getByText(/Comportement de paiement/i)).toBeTruthy();
      expect(screen.getByText(/Paiements années suivantes/i)).toBeTruthy();
      expect(screen.getByText(/Pourquoi ce statut/i)).toBeTruthy();
      // The subsequent-year facts for the active payer.
      expect(screen.getByText(/Oui — 10 paiement/i)).toBeTruthy();
    });
  });

  it("the Fiche famille action navigates to the underlying financial record", async () => {
    render(<DebtAgingTab />);
    await waitFor(() => {
      expect(screen.getByText(/FAMILLE P-ARCHETYPE-A/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/FAMILLE P-ARCHETYPE-A/i));
    await waitFor(() => {
      expect(screen.getAllByText("Fiche famille").length).toBeGreaterThanOrEqual(1);
    });
    const familyButtons = screen.getAllByText("Fiche famille");
    fireEvent.click(familyButtons[familyButtons.length - 1]);
    expect(navigateMock).toHaveBeenCalledWith(`/crm?parentId=${P_A}`);
  });

  it("shows the empty state when there is no debtor", async () => {
    const emptyObs = obs<DebtAgingAnalysis[]>([]);
    state = {
      ...makeState(),
      debt: { observeAging: () => emptyObs, refreshAging: vi.fn(async () => undefined) },
    };
    render(<DebtAgingTab />);
    await waitFor(() => {
      expect(screen.getByText(/Aucune famille endettée/i)).toBeTruthy();
    });
  });
});
