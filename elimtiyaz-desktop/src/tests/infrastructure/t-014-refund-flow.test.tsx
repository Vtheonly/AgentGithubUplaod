/**
 * T-014 — desktop refund flow regression suite (BUSINESS-003 + DEAD-015).
 *
 * Problems covered:
 *  - BUSINESS-003: SupabasePaymentRepository.refund() hardcoded
 *    "Manual refund" and read the actor from localStorage fallbacks — the
 *    audit trail recorded "Excel Import" for a named officer's refund.
 *    The signature now carries (reason, actorId, actorName?) and every
 *    implementation propagates them; reason is mandatory (≥3 chars).
 *  - DEAD-015: NO refund UI existed anywhere on the desktop — the refund
 *    path was dead code. PaymentDetailDrawer now exposes a "Rembourser"
 *    action gated on Permission.RefundPayment with a mandatory-reason modal.
 *  - Double-refund guard (mirrors revert_payment_allocation's
 *    "paid|pending only" rejection, migration 0041:493-495).
 *
 * Layers exercised: mock repository (TS canonical mirror), Supabase
 * repository (fake client capturing the RPC args), and the drawer UI
 * (permission gating + reason requirement) with mocked providers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";

// i18n first — components call useTranslation().
import "../../i18n/i18n";

import { mockPaymentRepository, mockLedgerRepository, mockInstallmentRepository } from "../../infrastructure/mock/mock-repositories";
import { SupabasePaymentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { Permission } from "../../core/rbac/permissions";
import type { Payment, CollectPaymentInput, Installment } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";

type Row = Record<string, any>;

/** Subscribe-once helper mirroring the established test pattern. */
function current<T>(obs: { get(): T }): T {
  return obs.get();
}

/** First seed tranche with a remaining balance (par-002 — see full-payment-flow). */
function firstRefundableTranche(): Installment {
  const installments = current<Installment[]>(mockInstallmentRepository.observe());
  const target = installments.find((i) => i.parentId === "par-002" && i.status !== "paid" && i.amountDue - i.amountPaid > 0);
  expect(target).toBeDefined();
  return target as Installment;
}

function collectFullPayment(target: Installment, collectedBy: string) {
  const input: CollectPaymentInput = {
    parentId: target.parentId,
    studentId: target.studentId,
    amount: target.amountDue - target.amountPaid,
    method: "cash",
    category: "tuition",
    installmentId: target.id,
  };
  return mockPaymentRepository.collect(input, collectedBy);
}

// ============================================================================
// Mock repository — reason + actor propagation, double-refund guard
// ============================================================================

describe("T-014 — mock refundPayment propagates reason + actor (BUSINESS-003)", () => {
  it("writes the ledger reversal entry with the real actor + reason", async () => {
    const target = firstRefundableTranche();
    const collectResult = await collectFullPayment(target, "usr-officer");
    expect(collectResult.ok).toBe(true);
    if (!collectResult.ok) return;

    const refundResult = await mockPaymentRepository.refund(
      collectResult.value.id,
      "Doublon annulé par la direction",
      "usr-brahim",
      "Brahim Souilah",
    );
    expect(refundResult.ok).toBe(true);
    if (!refundResult.ok) return;
    expect(refundResult.value.status).toBe("refunded");

    // The reversal entry carries the REAL actor + reason — never the old
    // hardcoded "usr-current" / "Remboursement manuel".
    const ledger = current<LedgerEntry[]>(mockLedgerRepository.observe());
    const reversal = ledger.find(
      (e) => e.type === "reversal" && e.sourceId === collectResult.value.id,
    );
    expect(reversal).toBeDefined();
    expect(reversal!.actorId).toBe("usr-brahim");
    expect(reversal!.actorName).toBe("Brahim Souilah");
    expect((reversal!.metadata as { refundReason?: string }).refundReason).toBe(
      "Doublon annulé par la direction",
    );
  });

  it("reverts the installment allocation (tranche re-opened)", async () => {
    const target = firstRefundableTranche();
    const paidBefore = target.amountPaid;
    const collectResult = await collectFullPayment(target, "usr-officer");
    expect(collectResult.ok).toBe(true);
    if (!collectResult.ok) return;

    const refundResult = await mockPaymentRepository.refund(
      collectResult.value.id,
      "Erreur de saisie",
      "usr-brahim",
    );
    expect(refundResult.ok).toBe(true);

    const after = current<Installment[]>(mockInstallmentRepository.observe());
    const reopened = after.find((i) => i.id === target.id);
    expect(reopened!.amountPaid).toBe(paidBefore);
    expect(reopened!.status).not.toBe("paid");
  });

  it("rejects a second refund of the same payment (double-refund guard)", async () => {
    const target = firstRefundableTranche();
    const collectResult = await collectFullPayment(target, "usr-officer");
    expect(collectResult.ok).toBe(true);
    if (!collectResult.ok) return;

    const first = await mockPaymentRepository.refund(collectResult.value.id, "Premier remboursement", "usr-brahim");
    expect(first.ok).toBe(true);

    const second = await mockPaymentRepository.refund(collectResult.value.id, "Second remboursement", "usr-brahim");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.message).toContain("ne peut pas être remboursé");
    }
  });

  it("rejects a refund without a meaningful reason (<3 chars)", async () => {
    const target = firstRefundableTranche();
    const collectResult = await collectFullPayment(target, "usr-officer");
    expect(collectResult.ok).toBe(true);
    if (!collectResult.ok) return;

    const result = await mockPaymentRepository.refund(collectResult.value.id, "ab", "usr-brahim");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("3 caractères");
    }
  });
});

// ============================================================================
// Supabase repository — real actor + reason reach the RPC
// ============================================================================

describe("T-014 — SupabasePaymentRepository.refund() passes reason + actor to the canonical RPC", () => {
  function makeClient(capture: { args: Row | null }) {
    return {
      rpc(fn: string, args: Row) {
        if (fn === "revert_payment_allocation") {
          capture.args = args;
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
      },
      from() {
        const row: Row = {
          id: "pay-1",
          tenant_id: "t-1",
          payment_number: "PAY-1",
          receipt_number: "REC-2026-000001",
          parent_id: "p-1",
          student_id: "s-1",
          amount: 1000,
          method: "cash",
          status: "refunded",
          category: "tuition",
          installment_id: null,
          proof_path: null,
          notes: null,
          collected_by: "usr-brahim",
          collected_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: row, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  it("propagates the real reason and actor identity", async () => {
    const capture: { args: Row | null } = { args: null };
    const repo = new SupabasePaymentRepository(makeClient(capture));
    const result = await repo.refund("pay-1", "Chèque perdu — refund demandé", "usr-brahim", "Brahim Souilah");
    expect(result.ok).toBe(true);
    expect(capture.args).toMatchObject({
      p_payment_id: "pay-1",
      p_actor_id: "usr-brahim",
      p_actor_name: "Brahim Souilah",
      p_reason: "Chèque perdu — refund demandé",
    });
  });

  it("rejects short reasons before calling the RPC", async () => {
    const capture: { args: Row | null } = { args: null };
    const repo = new SupabasePaymentRepository(makeClient(capture));
    const result = await repo.refund("pay-1", "ab", "usr-brahim");
    expect(result.ok).toBe(false);
    expect(capture.args).toBeNull();
  });
});

// ============================================================================
// UI — the drawer exposes the gated refund action (DEAD-015)
// ============================================================================

const toastStub = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};

function makePayment(overrides: Partial<Payment>): Payment {
  return {
    id: "pay-ui-1",
    tenantId: "t-1",
    receiptNumber: "REC-2026-000009",
    parentId: "p-1",
    studentId: null,
    amount: 5000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-x",
    collectedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Payment;
}

async function renderDrawer(opts: { payment: Payment | null; canRefund: boolean }) {
  const permissions = new Set<Permission>([Permission.ViewRoster]);
  if (opts.canRefund) permissions.add(Permission.RefundPayment);

  const obsOf = <T,>(value: T) => ({ get: () => value, subscribe: () => () => {} });

  const auth = await import("../../app/providers/auth-provider");
  const reposMod = await import("../../app/providers/repository-provider");
  const toastMod = await import("../../app/providers/toast-provider");

  vi.spyOn(auth, "useAuth").mockReturnValue({
    session: {
      userId: "usr-brahim",
      displayName: "Brahim Souilah",
      permissions,
    },
  } as never);
  vi.spyOn(reposMod, "useRepositories").mockReturnValue({
    payments: {
      observeById: () => obsOf(opts.payment),
      refund: async () => ({ ok: true, value: opts.payment }) as never,
    },
    parents: { observe: () => obsOf([]) },
    students: { observe: () => obsOf([]) },
  } as never);
  vi.spyOn(toastMod, "useToast").mockReturnValue(toastStub as never);

  const mod = await import("../../features/financials/payment-detail-drawer");
  return render(
    <mod.PaymentDetailDrawer paymentId={opts.payment?.id ?? null} open={!!opts.payment} onOpenChange={() => {}} />,
  );
}

describe("T-014 — PaymentDetailDrawer refund action (DEAD-015)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastStub.showSuccess.mockClear();
    toastStub.showError.mockClear();
    toastStub.showWarning.mockClear();
    toastStub.showInfo.mockClear();
  });

  it("shows the refund button for a paid payment when the session holds RefundPayment", async () => {
    await renderDrawer({ payment: makePayment({}), canRefund: true });
    expect(await screen.findByText(/Rembourser ce paiement/)).toBeDefined();
  });

  it("hides the refund button without the permission", async () => {
    await renderDrawer({ payment: makePayment({}), canRefund: false });
    expect(screen.queryByText(/Rembourser ce paiement/)).toBeNull();
  });

  it("hides the refund button for a refunded payment (not revertible)", async () => {
    await renderDrawer({ payment: makePayment({ status: "refunded" }), canRefund: true });
    expect(screen.queryByText(/Rembourser ce paiement/)).toBeNull();
  });

  it("opens the reason modal and refuses a too-short reason", async () => {
    await renderDrawer({ payment: makePayment({}), canRefund: true });
    fireEvent.click(await screen.findByText(/Rembourser ce paiement/));
    // The modal asks for the reason.
    expect(await screen.findByText(/Motif du remboursement/)).toBeDefined();
    // ConfirmModal portals to document.body — query the document, not the render container.
    const input = document.querySelector("input[placeholder*='Erreur de saisie']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "ab" } });
    fireEvent.click(screen.getByText(/Confirmer le remboursement/));
    // The mandatory-reason warning fired; nothing succeeded.
    expect(toastStub.showWarning).toHaveBeenCalled();
    expect(toastStub.showSuccess).not.toHaveBeenCalled();
  });
});
