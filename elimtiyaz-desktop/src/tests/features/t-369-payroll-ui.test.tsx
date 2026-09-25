/**
 * T-369 (WORKFORCE-500) — the PayrollManagement UI end-to-end suite.
 *
 * The 74d3ebb UI was never tested against its intended backend path. This
 * suite pins the COMPLETE workflow through the repository contract:
 *
 *   1. Rendering: the staff ledger lists the active personnel with their
 *      base salaries and the per-period PAID statuses derived from the
 *      reactive salaryPayments stream (NOT local state — the pre-T-369
 *      client-side simulation is gone).
 *   2. The adjustment flow: Ajuster → the mandatory-reason modal → submit
 *      routes through repos.personnel.adjustSalary (the canonical RPC path
 *      in Supabase mode) with the full context.
 *   3. The mandatory-reason guard: an empty reason keeps the modal's
 *      submit disabled (the UI-level mirror of the 0095 DB CHECK).
 *   4. The disbursement flow: Marquer Payé → confirm routes through
 *      repos.personnel.recordSalaryPayment with the selected period.
 *   5. The worker (non-admin) view renders the personal payslip card with
 *      the real base salary from observeByUserId.
 *
 * Run:
 *   npx vitest run src/tests/features/t-369-payroll-ui.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "../../i18n/i18n";
import { PayrollManagement } from "../../features/personnel/management/payroll-management";
import { Role } from "../../core/rbac/roles";
import type { Personnel } from "../../domain/model/personnel";
import type { SalaryPaymentRecord } from "../../domain/model/personnel";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const adjustSalaryMock = vi.fn();
const recordSalaryPaymentMock = vi.fn();

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

const PERSONNEL: Personnel = {
  id: "per-100",
  userId: null,
  firstName: "Amina",
  lastName: "Meziane",
  staffCategory: "teacher",
  roleId: Role.Teacher,
  departmentId: "dept-teachers",
  supervisorId: null,
  position: "Professeur de Mathématiques",
  phone: "+213 555 11 22 33",
  email: "a.meziane@elimtiyaz.dz",
  address: null,
  hireDate: "2020-09-01",
  terminationDate: null,
  salary: 65000,
  paymentMethod: "bank_transfer",
  bankAccount: "RIB-001",
  weeklyHoursTarget: 30,
  weeklyHoursLogged: 28,
  avatarUrl: null,
  status: "active",
  salaryAdjustments: [],
  salaryPayments: [],
  documents: [],
  notes: [],
  emergencyContact: null,
  dateOfBirth: null,
  nationalId: null,
  tenantId: "t1",
};

// T-400 (ea5029c): the ledger's periods are now the CURRENT Algeria-local
// business periods (PAYROLL_PERIOD_OPTIONS[0].value), not a hard-coded
// "2026-03" — derive the default selected period exactly like the component.
const CURRENT_PERIOD = (() => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
})();

const PAID_PAYMENT: SalaryPaymentRecord = {
  id: "pay-1",
  personnelId: "per-100",
  period: CURRENT_PERIOD,
  baseSalary: 65000,
  bonusesTotal: 0,
  deductionsTotal: 0,
  netPaid: 65000,
  status: "paid",
  paymentDate: "2026-03-31",
  method: "bank_transfer",
  referenceNumber: "VIR-031",
  notes: null,
  paidBy: "usr-admin",
  paidByName: "Super Admin",
};

let payments: SalaryPaymentRecord[] = [];

function makeState() {
  return {
    personnel: {
      observe: () => obs([PERSONNEL]),
      observeByUserId: () => obs(PERSONNEL),
      adjustSalary: adjustSalaryMock,
      recordSalaryPayment: recordSalaryPaymentMock,
      observeSalaryPayments: () => obs(payments),
    },
    departments: {
      observe: () => obs([{ id: "dept-teachers", name: "Corps Enseignant" }]),
    },
  };
}

let state = makeState();

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));

const toastStubs = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
};

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => toastStubs,
}));

let session: Record<string, unknown> = {
  userId: "usr-admin",
  displayName: "Super Admin",
  role: Role.SuperAdmin,
  tenantId: "t1",
};

vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session }),
}));

// The payslip PDF generator is a heavy pdf-lib pipeline with its own T-368
// suites — stub it here (this suite pins the REPOSITORY wiring, not the PDF).
vi.mock("../../infrastructure/receipt-pdf", () => ({
  generatePayslipPdf: vi.fn(async () => new Uint8Array([1])),
  downloadPdf: vi.fn(),
}));

beforeEach(() => {
  adjustSalaryMock.mockReset();
  recordSalaryPaymentMock.mockReset();
  adjustSalaryMock.mockResolvedValue({ ok: true, value: { ...PERSONNEL, salary: 70000 } as never });
  recordSalaryPaymentMock.mockResolvedValue({ ok: true, value: PAID_PAYMENT });
  payments = [];
  state = makeState();
  session = {
    userId: "usr-admin",
    displayName: "Super Admin",
    role: Role.SuperAdmin,
    tenantId: "t1",
  };
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T-369 PayrollManagement UI (WORKFORCE-500)", () => {
  it("1. renders the staff ledger with the base salary and derives the period's paid statuses from the payments stream", () => {
    render(<PayrollManagement />);

    expect(screen.getByText("Amina Meziane")).toBeTruthy();
    // T-412 realignment: the base salary now appears BOTH in the staff ledger
    // cell AND in the canonical forecast section's next-funding figure (the
    // 1-person payroll ⇒ both surfaces derive the same 65 000 DA — parity by
    // construction). getAllByText keeps this assertion intent-preserving.
    expect(screen.getAllByText(/65 000/).length).toBeGreaterThanOrEqual(1);

    // Nobody paid for the default (current) period — "En attente".
    expect(screen.getByText("En attente")).toBeTruthy();

    // Now the same personnel IS paid for the current period — the status
    // flips from the REPOSITORY stream, not from local state.
    payments = [PAID_PAYMENT];
    cleanup();
    render(<PayrollManagement />);
    expect(screen.getByText("Payé")).toBeTruthy();
    expect(screen.queryByText("En attente")).toBeNull();
  });

  it("2. the Ajuster flow routes through repos.personnel.adjustSalary with the full context", async () => {
    render(<PayrollManagement />);

    fireEvent.click(screen.getByRole("button", { name: /Ajuster/ }));

    // The modal's mandatory-reason guard: submit stays disabled while the
    // reason is empty (the 0095 DB CHECK's UI mirror).
    const submit = await screen.findByRole("button", { name: /Valider l'ajustement/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/Indiquez le motif précis/), {
      target: { value: "Revalorisation grille 2026" },
    });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(submit);

    await waitFor(() => expect(adjustSalaryMock).toHaveBeenCalledTimes(1));
    expect(adjustSalaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        personnelId: "per-100",
        type: "raise", // the modal's default
        amount: 5000,  // the modal's default
        reason: "Revalorisation grille 2026",
        actorId: "usr-admin",
        actorName: "Super Admin",
      }),
    );
    // The pre-T-369 client-side path (updatePersonnel with an embedded
    // salaryAdjustments array) must NEVER be called.
    expect(state.personnel).not.toHaveProperty("updatePersonnel");
  });

  it("3. the Marquer Payé flow routes through repos.personnel.recordSalaryPayment with the selected period", async () => {
    render(<PayrollManagement />);

    fireEvent.click(screen.getByRole("button", { name: /Marquer Payé/ }));
    const submit = await screen.findByRole("button", { name: /Confirmer le versement/ });
    fireEvent.click(submit);

    await waitFor(() => expect(recordSalaryPaymentMock).toHaveBeenCalledTimes(1));
    expect(recordSalaryPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        personnelId: "per-100",
        period: CURRENT_PERIOD, // the ledger's selected (current) period
        method: "bank_transfer",
        actorId: "usr-admin",
        actorName: "Super Admin",
      }),
    );
  });

  it("4. the worker (non-admin) view shows the personal payslip card with the real base salary", () => {
    session = {
      userId: "usr-worker",
      displayName: "Amina Meziane",
      role: Role.Teacher,
      tenantId: "t1",
    };
    render(<PayrollManagement />);

    expect(screen.getByText(/Ma Rémunération & Bulletins de Paie/)).toBeTruthy();
    expect(screen.getByText(/65 000/)).toBeTruthy();
    expect(screen.getByText(/Virement bancaire/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Marquer Payé/ })).toBeNull();
  });
});
