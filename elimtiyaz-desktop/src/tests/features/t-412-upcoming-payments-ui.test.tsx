/**
 * T-412 — the Personnel "Paiements du Personnel à Venir" section's UI suite
 * (96th session, Phase 2).
 *
 * Pins the OPERATIONAL consumer of the canonical payroll forecast:
 *   1. The waves table renders the payroll waves with the ADR-024
 *      vocabulary (masse salariale attendue / date de paiement / fonds
 *      sécurisés / besoin de financement / disponibilité).
 *   2. The per-personnel breakdown behind a wave expands on click — the
 *      obligations contributing to the total.
 *   3. Reactive restatement: recording a disbursement shrinks the wave's
 *      remaining funding requirement + flips the readiness chip (the
 *      forecast reflects payment changes automatically).
 *   4. Personnel changes restate the forecast (a termination drops the
 *      future waves' expected payroll).
 *   5. The honest empty state (no eligible staff).
 *   6. The cross-page summary links to Finance + Statistics exist.
 *
 * Run:
 *   npx vitest run src/tests/features/t-412-upcoming-payments-ui.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "../../i18n/i18n";
import { UpcomingPersonnelPayments } from "../../features/personnel/management/upcoming-payroll-payments";
import { Role } from "../../core/rbac/roles";
import { formatDzdPlain } from "../../core/format/currency";
import type { Personnel, SalaryPaymentRecord } from "../../domain/model/personnel";

// ---------------------------------------------------------------------------
// Stubs (the t-369 conventions)
// ---------------------------------------------------------------------------

/**
 * A LIVE observable stub — mirrors the real repository SubjectBehavior: one
 * STABLE observable identity whose `get()` reads the live test variable and
 * whose `emit()` pushes a restatement to every subscriber (the reactive
 * contract the component's forecast depends on). A fresh-closure-per-call
 * obs() would NOT restate on data changes (useObservable subscribes once).
 */
function liveObs<T>(read: () => T) {
  const listeners = new Set<(v: T) => void>();
  return {
    observable: {
      get: () => read(),
      subscribe: (fn: (v: T) => void) => {
        listeners.add(fn);
        fn(read());
        return () => {
          listeners.delete(fn);
        };
      },
    },
    emit: () => {
      const v = read();
      for (const fn of listeners) fn(v);
    },
  };
}

const CURRENT_PERIOD = (() => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
})();

function makePersonnel(
  overrides: Partial<Personnel> = {},
): Personnel {
  return {
    id: overrides.id ?? "per-1",
    userId: null,
    firstName: overrides.firstName ?? "Amina",
    lastName: overrides.lastName ?? "Meziane",
    staffCategory: overrides.staffCategory ?? "teacher",
    roleId: overrides.roleId ?? Role.Teacher,
    departmentId: null,
    supervisorId: null,
    position: overrides.position ?? "Professeur",
    phone: "0550000000",
    email: null,
    address: null,
    hireDate: overrides.hireDate ?? "2020-09-01",
    terminationDate: overrides.terminationDate ?? null,
    salary: overrides.salary ?? 65_000,
    paymentMethod: "bank_transfer",
    bankAccount: null,
    weeklyHoursTarget: 30,
    weeklyHoursLogged: 28,
    avatarUrl: null,
    status: overrides.status ?? "active",
    salaryAdjustments: [],
    salaryPayments: [],
    documents: [],
    notes: [],
    emergencyContact: null,
    dateOfBirth: null,
    nationalId: null,
    tenantId: "t1",
  };
}

function makePayment(
  overrides: Partial<SalaryPaymentRecord> = {},
): SalaryPaymentRecord {
  return {
    id: overrides.id ?? "pay-1",
    personnelId: overrides.personnelId ?? "per-1",
    period: overrides.period ?? CURRENT_PERIOD,
    baseSalary: overrides.baseSalary ?? 65_000,
    bonusesTotal: 0,
    deductionsTotal: 0,
    netPaid: overrides.netPaid ?? 65_000,
    status: overrides.status ?? "paid",
    paymentDate: overrides.paymentDate ?? null,
    method: "bank_transfer",
    referenceNumber: null,
    notes: null,
    paidBy: "usr-admin",
    paidByName: "Super Admin",
  };
}

let personnel: Personnel[] = [];
let payments: SalaryPaymentRecord[] = [];

const personnelStream = liveObs<Personnel[]>(() => personnel);
const paymentsStream = liveObs<SalaryPaymentRecord[]>(() => payments);

let state: Record<string, unknown>;

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  personnel = [makePersonnel()];
  payments = [];
  state = {
    personnel: {
      observe: () => personnelStream.observable,
      observeSalaryPayments: () => paymentsStream.observable,
    },
  };
});

afterEach(() => {
  cleanup();
});

describe("T-412 UpcomingPersonnelPayments (Personnel operational view)", () => {
  it("1. renders the payroll waves with the ADR-024 vocabulary figures", () => {
    personnel = [makePersonnel(), makePersonnel({ id: "per-2", firstName: "Karim", salary: 35_000 })];
    render(<UpcomingPersonnelPayments />);

    expect(screen.getByText("Paiements du Personnel à Venir")).toBeTruthy();
    // Waves table headers — the four distinguished figures.
    expect(screen.getByText("Masse salariale attendue")).toBeTruthy();
    expect(screen.getByText("Date de paiement")).toBeTruthy();
    expect(screen.getByText("Fonds sécurisés")).toBeTruthy();
    expect(screen.getByText("Besoin de financement")).toBeTruthy();
    // The current wave's expected payroll = 65 000 + 35 000 (the header
    // next-funding figure + the wave rows derive the same canonical total).
    expect(screen.getAllByText("100 000 DA").length).toBeGreaterThanOrEqual(1);
    // Readiness chip for a not-yet-funded future wave.
    expect(screen.getAllByText("À venir").length).toBeGreaterThanOrEqual(1);
  });

  it("2. expands the per-personnel breakdown behind a wave", () => {
    personnel = [makePersonnel(), makePersonnel({ id: "per-2", firstName: "Karim", salary: 35_000 })];
    render(<UpcomingPersonnelPayments />);

    // The breakdown is hidden until the row expander is clicked.
    expect(screen.queryByText("Détail des obligations de paie")).toBeNull();

    const toggle = screen.getByTestId(`wave-breakdown-toggle-${CURRENT_PERIOD}`);
    fireEvent.click(toggle);

    expect(screen.getByText(/Détail des obligations de paie/)).toBeTruthy();
    // The two contributing obligations.
    expect(screen.getByText("Amina Meziane")).toBeTruthy();
    expect(screen.getByText("Karim Meziane")).toBeTruthy();
    // The breakdown's total row.
    expect(screen.getByText(/Total \(2 obligations\)/)).toBeTruthy();
  });

  it("3. restates the wave when a disbursement is recorded (reactive stream)", () => {
    personnel = [makePersonnel()];
    render(<UpcomingPersonnelPayments />);

    // Nothing paid: remaining = the full 65 000 (formatDzdPlain emits narrow
    // no-break separators — assert against the SAME formatter, not a literal).
    expect(
      screen.getByTestId(`wave-remaining-${CURRENT_PERIOD}`).textContent,
    ).toBe(`${formatDzdPlain(65_000)} DA`);

    // The salary is disbursed for the current period → the stream restates
    // (act-wrapped: the emission is an external state update, like the real
    // repository push).
    payments = [makePayment({ personnelId: "per-1", netPaid: 65_000 })];
    act(() => {
      paymentsStream.emit();
    });
    expect(
      screen.getByTestId(`wave-remaining-${CURRENT_PERIOD}`).textContent,
    ).toBe(`${formatDzdPlain(0)} DA`);
    expect(screen.getByText("Couvert")).toBeTruthy();
  });

  it("4. drops a terminated employee from the future waves (roster changes restate)", () => {
    personnel = [makePersonnel(), makePersonnel({ id: "per-2", firstName: "Karim", salary: 35_000 })];
    render(<UpcomingPersonnelPayments />);
    expect(screen.getAllByText("100 000 DA").length).toBeGreaterThanOrEqual(1);

    // per-2 terminates → gone from every wave; the stream restates.
    personnel = [
      makePersonnel(),
      makePersonnel({
        id: "per-2",
        firstName: "Karim",
        salary: 35_000,
        terminationDate: "2020-10-01",
        status: "terminated",
      }),
    ];
    act(() => {
      personnelStream.emit();
    });
    expect(screen.queryByText("100 000 DA")).toBeNull();
    expect(
      screen.getByTestId(`wave-remaining-${CURRENT_PERIOD}`).textContent,
    ).toBe(`${formatDzdPlain(65_000)} DA`);
  });

  it("5. renders the honest empty state when nobody is eligible", () => {
    personnel = [makePersonnel({ status: "terminated", terminationDate: "2020-01-01" })];
    render(<UpcomingPersonnelPayments />);
    expect(
      screen.getByText(/Aucun employé actif avec salaire renseigné/),
    ).toBeTruthy();
  });

  it("6. carries the cross-page summary links to Finance and Statistics", () => {
    render(<UpcomingPersonnelPayments />);
    expect(screen.getByTestId("link-finance-payroll")).toBeTruthy();
    expect(screen.getByTestId("link-statistics-payroll")).toBeTruthy();
  });
});
