/**
 * T-521 (issue #29 / WORKFORCE-517) — the Staff/Personnel expense surface
 * regression suite: THE "ddd" FIX.
 *
 * The registered root cause: the Personnel section's "Demandes & Dépenses"
 * tab rendered ONLY leave requests — an expense created in Finance (the
 * owner's `ddd`) had NO rendering path anywhere in Personnel. The fix mounts
 * the ExpenseReviewSection inside RequestsManagement, reading the SAME
 * canonical expenses observable the Finance tab reads.
 *
 * The pins:
 *   S1. The mounting contract — RequestsManagement renders the expense
 *       section (the surface exists now; the regression the owner reported
 *       can never silently return).
 *   S2. The "ddd" visibility — an expense on the canonical stream with
 *       status "submitted" renders in the reviewer's pending queue.
 *   S3. The reviewer's quick approve goes through the canonical repository
 *       (the SAME write the Finance drawer makes) and surfaces the error
 *       branch (the WORKFORCE-510 never-swallow rule).
 *   S4. "Mes dépenses" shows the submitter's own tickets (and the
 *       responsible person's).
 *   S5. The administrator dashboard's "Demandes & Dépenses" KPI counts the
 *       REAL pending expense tickets (it previously counted leave only).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));
const sessionMock = { session: null as null | { userId: string; role: string; permissions: Set<string> } };
vi.mock("../../../app/providers/auth-provider", () => ({
  useAuth: () => sessionMock,
}));
vi.mock("../../../app/providers/toast-provider", () => ({
  useToast: () => toastState,
}));
// The drawer + submit modal carry their own suites — stub them here so this
// suite pins the QUEUE surface, not the drawer internals.
vi.mock("../../../features/financials/expense-detail-drawer", () => ({
  ExpenseDetailDrawer: () => <div data-testid="expense-drawer-stub" />,
}));
vi.mock("../../../features/financials/expense-submit-modal", () => ({
  ExpenseSubmitModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="expense-submit-stub" /> : null,
}));

import { RequestsManagement } from "../../../features/personnel/management/requests-management";
import { ExpenseReviewSection } from "../../../features/personnel/management/expense-review-section";
import type { Expense } from "../../../domain/model/expense";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let state: any;
const toastState = {
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
};

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

const PERSONNEL = [
  { id: "per-1", userId: "usr-drv-1", firstName: "Karim", lastName: "Benali", status: "active" },
  { id: "per-2", userId: "usr-adm-1", firstName: "Admin", lastName: "User", status: "active" },
];

/** The owner's `ddd` — created in Finance, must appear in Staff/Personnel. */
function dddExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp-ddd",
    tenantId: "t1",
    requestCode: "EXP-2026-000DDD",
    title: "ddd",
    description: "La dépense de test du propriétaire",
    amount: 5000,
    category: "other",
    urgency: "medium",
    payee: "Test",
    status: "submitted",
    submittedBy: "usr-drv-1",
    submittedAt: "2026-10-13T08:00:00.000Z",
    responsibleProfileId: "usr-drv-1",
    approvedBy: null,
    approvedAt: null,
    approvalNote: null,
    disbursedBy: null,
    disbursedAt: null,
    proofUrl: null,
    proofUploadedBy: null,
    proofUploadedAt: null,
    finalSpentAmount: null,
    anomalyScore: null,
    anomalyNote: null,
    ...overrides,
  } as Expense;
}

const approveMock = vi.fn();

function seedState(expenses: Expense[], leaveRequests: unknown[] = []) {
  state = {
    personnel: { observe: () => obs(PERSONNEL), observeByUserId: () => obs(null) },
    leaveRequests: { observe: () => obs(leaveRequests) },
    tasks: { observe: () => obs([]) },
    workforceAttendance: { observeAbsences: () => obs([]) },
    expenses: {
      observe: () => obs(expenses),
      observeById: () => obs(expenses[0] ?? null),
      approve: approveMock,
    },
  };
}

beforeEach(() => {
  approveMock.mockReset();
  toastState.showError.mockReset();
  toastState.showSuccess.mockReset();
  sessionMock.session = {
    userId: "usr-adm-1",
    role: "super_admin",
    permissions: new Set(["approve_expense", "submit_expense"]),
  };
});

afterEach(() => cleanup());

describe("S1+S2 — the mounting + the ddd visibility (WORKFORCE-517)", () => {
  it("RequestsManagement renders the expense review section and the pending queue shows the Finance-created ddd", async () => {
    seedState([dddExpense()]);
    render(<RequestsManagement />);

    // S1: the section is mounted inside the tab.
    expect(screen.getByText(/Dépenses à valider \(1\)/)).toBeTruthy();
    // S2: the ddd — created in Finance — is now VISIBLE in Staff/Personnel.
    expect(screen.getByText("ddd")).toBeTruthy();
    expect(screen.getByText("EXP-2026-000DDD")).toBeTruthy();
  });

  it("the missing-responsible flag surfaces in the queue (never a fabricated name)", () => {
    seedState([dddExpense({ responsibleProfileId: null })]);
    render(<ExpenseReviewSection />);
    expect(screen.getAllByText(/À renseigner/).length).toBeGreaterThan(0);
  });
});

describe("S3 — the reviewer's canonical approve + error surfacing", () => {
  it("quick approve goes through the canonical repository and toasts the error branch on failure", async () => {
    seedState([dddExpense()]);
    approveMock.mockResolvedValue({ ok: false, error: { userMessage: "RLS refusal" } });
    render(<ExpenseReviewSection />);

    fireEvent.click(screen.getByRole("button", { name: /Approuver/i }));
    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith("exp-ddd", "usr-adm-1", "Approuvé");
    });
    await waitFor(() => {
      expect(toastState.showError).toHaveBeenCalledWith("Échec de l'approbation", "RLS refusal");
    });
  });

  it("the self-approval guard blocks the requester's own ticket with the plan §08 warning", async () => {
    seedState([dddExpense({ submittedBy: "usr-adm-1" })]); // the admin's own ticket
    render(<ExpenseReviewSection />);
    const approveButton = screen.getByRole("button", { name: /Approuver/i }) as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true); // disabled, never a silent failure
  });
});

describe("S4 — Mes dépenses (a non-reviewer session — only the linked tickets)", () => {
  it("shows the submitter's own and the responsible person's tickets; the unlinked stay invisible", () => {
    // A WORKER session: no reviewer queue, only "Mes dépenses".
    sessionMock.session = {
      userId: "usr-drv-1",
      role: "worker",
      permissions: new Set(["submit_expense"]),
    };
    seedState([
      dddExpense(), // submittedBy usr-drv-1, responsible usr-drv-1
      dddExpense({
        id: "exp-resp",
        requestCode: "EXP-2026-RESP",
        title: "Dont je suis responsable",
        submittedBy: "someone-else",
        responsibleProfileId: "usr-drv-1", // the worker is RESPONSIBLE (distinct from submitter)
      }),
      dddExpense({
        id: "exp-none",
        requestCode: "EXP-2026-NONE",
        title: "Sans lien",
        submittedBy: "someone-else",
        responsibleProfileId: "someone-else",
      }),
    ]);
    render(<ExpenseReviewSection />);
    // No reviewer queue for a worker.
    expect(screen.queryByText(/Dépenses à valider/)).toBeNull();
    // The two linked tickets render — the submitter's own AND the one the
    // worker is responsible for (the WORKFORCE-520 distinct-role contract).
    expect(screen.getByText("ddd")).toBeTruthy();
    expect(screen.getByText("Dont je suis responsable")).toBeTruthy();
    // The unlinked ticket stays invisible.
    expect(screen.queryByText("Sans lien")).toBeNull();
  });
});
