/**
 * CounterPaymentModal — backward-compat wrapper around `UnifiedPaymentModal`.
 *
 * Iteration 2 (Epic 5.3): The canonical payment experience is now
 * `UnifiedPaymentModal`, which accepts a `PaymentNavigationContext` and
 * implements the full Stage 1 + Stage 2 flow (PDF preview, WhatsApp share,
 * etc.). This wrapper preserves the old preset-prop API so existing callers
 * (`financials-page.tsx`, `installment-schedule-tab.tsx`) keep working
 * without modification.
 *
 * New call sites should construct a `PaymentNavigationContext` and call
 * `UnifiedPaymentModal` directly.
 */
import { useMemo } from "react";
import type {
  PaymentCategory,
} from "../../domain/model/payment";
import { buildFamilyCollectContext } from "../../domain/model/payment";
import { UnifiedPaymentModal } from "./unified-payment-modal";

export interface CounterPaymentModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presetParentId?: string | null;
  presetStudentId?: string | null;
  presetCategory?: PaymentCategory | null;
  presetAmount?: number | null;
  presetInstallmentId?: string | null;
}

export function CounterPaymentModal({
  open,
  onOpenChange,
  presetParentId,
  presetStudentId,
  presetCategory,
  presetAmount,
  presetInstallmentId,
}: CounterPaymentModalProps) {
  // Build a context only when at least one preset is provided. When all
  // presets are null, we pass `null` so the modal falls back to inline
  // parent search (counter-payment-from-scratch mode).
  // T-578 (BUG-046): the fabricated "Paiement comptoir" quote line (a
  // zero-history consolidation) is dead — the builder emits a family-debt
  // context the modal derives from the REAL installments stream; the
  // counter's preset category rides the explicit categoryScope.
  const context = useMemo(() => {
    const hasPreset =
      !!presetParentId ||
      !!presetStudentId ||
      !!presetCategory ||
      !!presetAmount ||
      !!presetInstallmentId;
    if (!hasPreset) return null;
    return buildFamilyCollectContext(presetParentId ?? "", {
      studentId: presetStudentId ?? null,
      targetInstallmentId: presetInstallmentId ?? undefined,
      category: presetCategory ?? null,
      presetAmount: presetAmount ?? undefined,
      allowPartial: true,
      originRoute: "counter_payment",
    });
  }, [presetParentId, presetStudentId, presetCategory, presetAmount, presetInstallmentId]);

  return (
    <UnifiedPaymentModal
      open={open}
      onOpenChange={onOpenChange}
      context={context}
    />
  );
}
