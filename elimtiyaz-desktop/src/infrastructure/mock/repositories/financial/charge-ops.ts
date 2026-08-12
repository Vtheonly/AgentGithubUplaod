/**
 * Manual charge operations — append à-la-carte charge entries for canteen,
 * uniform, books, 2nd apron, and other additional services.
 *
 * UNIFIED ARCHITECTURE (Epic 4.3):
 *   Closes the loop on non-tuition billing. Clubs + Therapy already write
 *   charges via their repositories (`buildClubEnrollmentCharge` /
 *   `buildTherapyCharge`); this module exposes the same pattern for the
 *   remaining additional services so the parent's account balance always
 *   reflects every service consumed.
 *
 *   The resulting `LedgerEntry` is a normal `charge` (positive debit) —
 *   `computeAccountBalance` will net it against any `parent_credit`
 *   balance automatically.
 */
import type { Result } from "../../../../core/result";
import { Ok } from "../../../../core/result";
import { AuditActions } from "../../../../core/audit-actions";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import { buildAdditionalServiceCharge } from "../../../../domain/calc/ledger/non-tuition-charges";
import type { FinancialOpsCtx } from "./types";

/** Qualifier for an additional service charge. */
export type AdditionalServiceQualifier =
  | "canteen_term"
  | "uniform"
  | "books"
  | "second_apron";

export interface AppendManualChargeInput {
  readonly parentId: string;
  readonly studentId: string;
  readonly serviceQualifier: AdditionalServiceQualifier;
  readonly description?: string;
}

/**
 * Append a manual charge entry for an additional service (canteen,
 * uniform, books, 2nd apron). Returns the created ledger entry.
 */
export async function appendManualCharge(
  ctx: FinancialOpsCtx,
  input: AppendManualChargeInput,
  actorId: string,
): Promise<Result<LedgerEntry>> {
  const { store, appendAudit, nowIso, delay, tenantId } = ctx;
  await delay(150);
  const charge = buildAdditionalServiceCharge(
    {
      tenantId,
      parentId: input.parentId,
      studentId: input.studentId,
      actorId,
      actorName: "Session courante",
      sourceType: "manual_entry",
      sourceId: `manual-charge-${Date.now()}`,
      description: input.description,
    },
    input.serviceQualifier,
  );
  store.ledger = [...store.ledger, charge];
  store.notifyLedger();
  appendAudit({
    action: AuditActions.PaymentAdjust,
    entityType: "charge",
    entityId: charge.id,
    actorId,
    actorName: "Session courante",
    diff: {
      before: null,
      after: {
        category: charge.category,
        amount: charge.amount,
        serviceQualifier: input.serviceQualifier,
        parentId: input.parentId,
        studentId: input.studentId,
      },
    },
    note: `Charge manuelle — ${input.serviceQualifier} (${charge.amount} DZD)`,
  });
  return Ok(charge);
}
