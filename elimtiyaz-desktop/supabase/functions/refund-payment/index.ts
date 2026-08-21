// ============================================================================
// refund-payment/index.ts
// ============================================================================
// Edge Function: Refund a previously collected payment (atomic reversal)
// ----------------------------------------------------------------------------
// Wraps the `public.refund_payment(p_tenant_id, p_payment_id,
// p_actor_profile_id, p_reason)` RPC function.
//
// USE CASE:
//   The Desktop app's Payment History tab or the Finance Officer's reversal
//   modal calls this function when a payment must be voided (bounced check,
//   duplicate entry, parent dispute, etc.). The RPC:
//     1. Validates the original payment exists and belongs to the tenant
//     2. Marks the original payment as status='refunded'
//     3. Inserts a reversal payment row (negative amount, method=original)
//     4. Reverses the ledger entry (canonical accounting — single source of truth)
//     5. Updates the linked installment's amount_paid (trigger recomputes status)
//     6. Writes an audit log entry with action='payment.refund'
//
// SECURITY:
//   - Requires JWT (caller must be authenticated)
//   - Caller must have `refund_payment` permission
//   - service_role key performs the actual DB writes (bypasses RLS)
//   - The original payment must belong to the caller's tenant (enforced by RPC)
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import {
  createServiceRoleClient,
  extractAuthContext,
  requirePermission,
  writeAuditLog,
} from "../_shared/supabase.ts";

interface RefundPaymentBody {
  payment_id: string;
  reason: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // 1. Auth context
  const ctx = await extractAuthContext(req);
  if (!ctx) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }

  // 2. Permission check
  if (!requirePermission(ctx, "refund_payment")) {
    return jsonError(req, 403, "forbidden", "refund_payment permission required");
  }

  // 3. Parse body
  let body: RefundPaymentBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  // 4. Validate fields
  if (!body.payment_id) {
    return jsonError(req, 400, "missing_fields", "payment_id is required");
  }
  if (!body.reason || body.reason.trim().length < 3) {
    return jsonError(req, 400, "missing_reason", "A reason (>= 3 chars) is required for refunds");
  }

  // 5. Fetch the original payment (for audit before-state + tenant scoping sanity)
  const supabase = createServiceRoleClient();
  const { data: originalPayment, error: fetchError } = await supabase
    .from("payments")
    .select("id, tenant_id, parent_id, amount, method, status, created_at")
    .eq("id", body.payment_id)
    .eq("tenant_id", ctx.tenantId)
    .single();

  if (fetchError || !originalPayment) {
    return jsonError(req, 404, "payment_not_found", "Original payment not found in this tenant");
  }

  if (originalPayment.status === "refunded") {
    return jsonError(req, 409, "already_refunded", "This payment has already been refunded");
  }

  // ============================================================================
  // CANONICAL ENGINE INVOCATION (migration 0034)
  // ============================================================================
  // Previously called the legacy `refund_payment` RPC (0022) — non-LIFO,
  // single-installment, broke paid_date. Migration 0034 dropped that RPC.
  // Now calls `revert_payment_allocation` (canonical LIFO with the
  // originalWasPending branch).
  // ============================================================================
  const { data, error } = await supabase.rpc("revert_payment_allocation", {
    p_tenant_id: ctx.tenantId,
    p_payment_id: body.payment_id,
    p_actor_id: ctx.userProfileId,
    p_actor_name: ctx.userDisplayName ?? ctx.email ?? "Système",
    p_reason: body.reason.trim(),
  });

  if (error) {
    console.error("[refund-payment] canonical RPC failed:", error);
    return jsonError(req, 500, "refund_failed", "Failed to process refund", error.message);
  }

  if (!data || data.length === 0) {
    return jsonError(req, 500, "no_result", "Refund RPC returned no result");
  }

  const result = data[0];
  // Canonical RPC returns: payment_id, new_status, reversal_entry_id,
  // reverts_count, total_reverted.
  const reversalPaymentId: string | null = result.reversal_entry_id ?? null;
  const revertsCount: number = Number(result.reverts_count ?? 0);
  const totalReverted: number = Number(result.total_reverted ?? 0);

  // 7. Write audit log (belt-and-suspenders — the RPC also writes one, but this
  //    captures the actor's profile_id + request_id for traceability)
  await writeAuditLog(
    ctx.tenantId,
    "payment.refund",
    "payment",
    body.payment_id,
    ctx.userProfileId,
    ctx.email,
    {
      payment_id: originalPayment.id,
      amount: originalPayment.amount,
      method: originalPayment.method,
      status: originalPayment.status,
    },
    {
      reversal_payment_id: reversalPaymentId,
      reason: body.reason,
      refunded_by: ctx.userProfileId,
    },
    `Refunded payment ${body.payment_id} (${originalPayment.amount} DZD via ${originalPayment.method}). Reason: ${body.reason}`,
    requestId
  );

  return jsonOk(req, {
    reversal_payment_id: reversalPaymentId,
    message: `Payment ${body.payment_id} has been refunded. Reversal entry ${reversalPaymentId} created.`,
  });
});
