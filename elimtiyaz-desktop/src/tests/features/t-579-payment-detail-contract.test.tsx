/**
 * T-579 (BUG-053) — the payment-detail drawer's transfer block + the
 * canonical coverage card. Increment 1 of the every-detail contract (the
 * PDF expansion rides the next session — recorded on the registry card).
 *
 *   S1  a TRANSFER payment renders "Détails du Virement" with the
 *       reference + bank (BUG-053: the check drawer rendered its block
 *       while the transfer drawer showed NOTHING — the S12 runtime proof).
 *   S2  a CHECK payment keeps its block (the parity pin).
 *   S3  the PaymentBreakdownCard (T-330's canonical coverage chain) mounts
 *       in the drawer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { ensureRadixJsdomCompat } from "../_helpers/radix-mouse";
import type { Observable } from "../../domain/repository/repository";
import type { Payment } from "../../domain/model/payment";

function obs<T>(value: T): Observable<T> {
  return { get: () => value, subscribe: (fn: (v: T) => void) => { fn(value); return () => {}; } };
}

function makePayment(over: Partial<Payment>): Payment {
  return {
    id: "pay-1", parentId: "par-1", studentId: null, amount: 25_000,
    method: "transfer", category: "tuition", status: "paid",
    receiptNumber: "RCP-2026-000001", collectedAt: "2026-11-01T10:00:00.000Z",
    expectedAmount: 20_000, excessAmount: 5_000, excessRemark: null,
    collectedBy: "usr-1", notes: null, proofUrl: null,
    checkNumber: null, checkBankName: null, checkIssueDate: null, checkClearanceDate: null,
    transferReference: "VIR-789", transferSourceBank: "BNA",
    ...over,
  } as Payment;
}

let PAYMENT: Payment = makePayment({});
const STABLE_REPOS = {
  payments: {
    observeById: () => obs(PAYMENT),
    allocationsForPayment: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
  },
  ledger: { observeByParent: () => obs([]) },
  parents: { observe: () => obs([{ id: "par-1", firstName: "A", lastName: "B", code: "P-1", phone: "0555" }]) },
  students: { observe: () => obs([]) },
};

vi.mock("../../app/providers/repository-provider", () => ({ useRepositories: () => STABLE_REPOS }));
vi.mock("../../app/providers/toast-provider", () => ({ useToast: () => ({ showInfo: () => {}, showSuccess: () => {}, showError: () => {}, showWarning: () => {} }) }));
vi.mock("../../app/providers/auth-provider", () => ({ useAuth: () => ({ session: { userId: "me", permissions: new Set() } }) }));
vi.mock("../../shared/navigation/person-navigation-context", () => ({ usePersonNavigation: () => ({ openParent: () => {}, openStudent: () => {} }) }));

import { PaymentDetailDrawer } from "../../features/financials/payment-detail-drawer";

describe("T-579 / BUG-053 — the drawer's transfer block + coverage card", () => {
  beforeEach(() => { ensureRadixJsdomCompat(); });
  afterEach(cleanup);

  it("S1: a transfer payment renders the Détails du Virement block (BUG-053)", async () => {
    PAYMENT = makePayment({});
    render(<PaymentDetailDrawer paymentId="pay-1" open onOpenChange={() => {}} />);
    await waitFor(() => { expect(screen.getByText("Détails du Virement")).toBeTruthy(); });
    expect(screen.getByText("VIR-789")).toBeTruthy();
    expect(screen.getByText("BNA")).toBeTruthy();
  });

  it("S2: a check payment keeps its block (parity)", async () => {
    PAYMENT = makePayment({ method: "check", checkNumber: "CHQ-1", checkBankName: "CPA", transferReference: null, transferSourceBank: null });
    render(<PaymentDetailDrawer paymentId="pay-1" open onOpenChange={() => {}} />);
    await waitFor(() => { expect(screen.getByText("Détails du Chèque")).toBeTruthy(); });
    expect(screen.queryByText("Détails du Virement")).toBeNull();
  });

  it("S3: the canonical PaymentBreakdownCard mounts in the drawer", async () => {
    PAYMENT = makePayment({});
    render(<PaymentDetailDrawer paymentId="pay-1" open onOpenChange={() => {}} />);
    await waitFor(() => { expect(screen.getByText("Détail de la couverture")).toBeTruthy(); });
  });
});
