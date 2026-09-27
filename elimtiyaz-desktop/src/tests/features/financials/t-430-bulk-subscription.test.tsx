/**
 * T-430 — the performance family (issues #24/#25, Track 3 items 2+3):
 * the bulk-subscription contract.
 *
 * PERF-506: the Tranches tab mounts ONE tenant-wide
 * `repos.installments.observe()` subscription — never the per-parent
 * `observeByParent` fan-out (the pre-fix mount created 741 individual
 * observables + 741 subscriptions, one per family, plus a `.get()` cache
 * materialization each — the audit's measured load cost).
 *
 * The test mocks the repository provider (the t-412 convention) and
 * asserts the call census: `observe()` exactly once, `observeByParent`
 * NEVER.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
}));

let observeCalls: number;
let observeByParentCalls: number;

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));

vi.mock("../../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: null }),
}));

vi.mock("../../../app/providers/toast-provider", () => ({
  useToast: () => ({ showInfo: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let state: any;

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
      for (const fn of listeners) fn(read());
    },
  };
}

const PARENTS = [
  { id: "p1", firstName: "Amine", lastName: "Belkacem", displayName: null, phone: "0" },
  { id: "p2", firstName: "Sara", lastName: "Hadj", displayName: null, phone: "0" },
];

const INSTALLMENTS = [
  {
    id: "i1",
    tenantId: "t",
    parentId: "p1",
    studentId: null,
    category: "tuition",
    label: "Tranche 1",
    trancheNumber: 1,
    amountDue: 100_000,
    amountPaid: 50_000,
    amountPending: 0,
    dueDate: "2026-09-15",
    status: "partial",
    academicCycle: null,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "i2",
    tenantId: "t",
    parentId: "p2",
    studentId: null,
    category: "tuition",
    label: "Tranche 2",
    trancheNumber: 2,
    amountDue: 100_000,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2026-12-15",
    status: "unpaid",
    academicCycle: null,
    createdAt: "",
    updatedAt: "",
  },
];

// Imported AFTER the mocks are declared (vi.mock hoists above imports —
// the placement is stylistic; the hoisting is the convention).
import { InstallmentScheduleTab } from "../../../features/financials/installment-schedule-tab";

beforeEach(() => {
  observeCalls = 0;
  observeByParentCalls = 0;
  const parentsStream = liveObs(() => PARENTS);
  const installmentsStream = liveObs(() => INSTALLMENTS);
  state = {
    parents: { observe: () => parentsStream.observable },
    installments: {
      observe: () => {
        observeCalls += 1;
        return installmentsStream.observable;
      },
      observeByParent: () => {
        observeByParentCalls += 1;
        return installmentsStream.observable;
      },
    },
    overdueAlerts: { run: () => Promise.resolve({ ok: true, value: [] }) },
  };
});

afterEach(() => {
  cleanup();
});

describe("T-430 (PERF-506) — the Tranches tab's bulk subscription", () => {
  it("mounts ONE tenant-wide observe() subscription and NEVER calls observeByParent (the 741-observable fan-out is gone)", async () => {
    render(<InstallmentScheduleTab />);
    // The rows render from the bulk stream (the parent-name join works).
    expect(await screen.findByText("Amine Belkacem")).toBeTruthy();
    // The census: exactly one bulk subscription, zero per-parent fan-out.
    expect(observeCalls).toBe(1);
    expect(observeByParentCalls).toBe(0);
  });
});
