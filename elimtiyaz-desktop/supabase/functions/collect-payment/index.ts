// ============================================================================
// collect-payment/index.ts
// ============================================================================
// Edge Function: Collect a payment (atomic — payment + ledger + receipt + audit)
// ----------------------------------------------------------------------------
// Wraps the `public.collect_payment()` RPC function.
//
// USE CASE:
//   The desktop Counter Payment modal or the mobile Collect Payment screen
//   calls this function. The function performs the entire payment collection
//   atomically:
//     1. Inserts a payment row (with method-specific proof validation)
//     2. Updates the linked installment's amount_paid (trigger auto-computes status)
//     3. Appends a ledger entry (canonical accounting — single source of truth)
//     4. Generates a receipt row (PDF generated separately via generate-receipt-pdf)
//     5. Writes an audit log entry
//
// SECURITY:
//   - Requires JWT (caller must be authenticated)
//   - Caller must have `collect_payment` permission
//   - service_role key performs the actual DB writes
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import {
  createServiceRoleClient,
  extractAuthContext,
  requirePermission,
  writeAuditLog,
} from "../_shared/supabase.ts";

interface CollectPaymentBody {
  parent_id: string;
  student_id?: string;
  amount: number;
  method: "cash" | "check" | "transfer";
  invoice_id?: string;
  installment_id?: string;
  notes?: string;
  // Method-specific fields
  check_number?: string;
  check_bank_name?: string;
  check_issue_date?: string;
  check_clearance_date?: string;
  transfer_reference?: string;
  transfer_source_bank?: string;
  proof_path?: string;  // storage path under 'payment-proofs' bucket
  /**
   * Category filter for the Waterfall Allocation Engine.
   * When `installment_id` is null, the payment is automatically distributed
   * across the parent's unpaid installments (oldest first) in this category.
   * Allowed values: "tuition" | "transport" | null (= all categories).
   */
  category_filter?: "tuition" | "transport" | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  const ctx = await extractAuthContext(req);
  if (!ctx) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }

  if (!requirePermission(ctx, "collect_payment")) {
    return jsonError(req, 403, "forbidden", "collect_payment permission required");
  }

  let body: CollectPaymentBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  // Validate required fields
  if (!body.parent_id || !body.amount || !body.method) {
    return jsonError(req, 400, "missing_fields", "parent_id, amount, and method are required");
  }

  if (body.amount <= 0) {
    return jsonError(req, 400, "invalid_amount", "Amount must be greater than 0");
  }

  if (!["cash", "check", "transfer"].includes(body.method)) {
    return jsonError(req, 400, "invalid_method", "Method must be 'cash', 'check', or 'transfer'");
  }

  // Method-specific validation (mirrors the enforce_payment_proof trigger)
  if (body.method === "check") {
    if (!body.check_number || !body.check_bank_name) {
      return jsonError(req, 400, "missing_check_fields", "check_number and check_bank_name are required for check payments");
    }
    if (!body.proof_path) {
      return jsonError(req, 400, "missing_proof", "Proof scan is mandatory for check payments (plan §13.05)");
    }
  }

  if (body.method === "transfer") {
    if (!body.transfer_reference) {
      return jsonError(req, 400, "missing_transfer_ref", "transfer_reference is required for transfer payments");
    }
    if (!body.proof_path) {
      return jsonError(req, 400, "missing_proof", "Proof scan is mandatory for transfer payments (plan §13.05)");
    }
  }

  // Call the collect_payment RPC (creates payment + ledger entry + receipt + audit).
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("collect_payment", {
    p_tenant_id: ctx.tenantId,
    p_parent_id: body.parent_id,
    p_student_id: body.student_id ?? null,
    p_amount: body.amount,
    p_method: body.method,
    p_invoice_id: body.invoice_id ?? null,
    p_installment_id: body.installment_id ?? null,
    p_actor_profile_id: ctx.userProfileId,
    p_notes: body.notes ?? null,
    p_check_number: body.check_number ?? null,
    p_check_bank_name: body.check_bank_name ?? null,
    p_check_issue_date: body.check_issue_date ?? null,
    p_check_clearance_date: body.check_clearance_date ?? null,
    p_transfer_reference: body.transfer_reference ?? null,
    p_transfer_source_bank: body.transfer_source_bank ?? null,
    p_proof_path: body.proof_path ?? null,
  });

  if (error) {
    console.error("[collect-payment] RPC failed:", error);
    return jsonError(req, 500, "collection_failed", "Failed to collect payment", error.message);
  }

  if (!data || data.length === 0) {
    return jsonError(req, 500, "no_result", "Payment collection returned no result");
  }

  const result = data[0];

  // ============================================================================
  // Waterfall Allocation — when no specific installment_id was provided,
  // automatically distribute the payment across the parent's unpaid
  // installments (oldest first). Guarantees Ledger ↔ Installment
  // mathematical consistency.
  // ============================================================================
  let allocations: Array<{
    installment_id: string;
    allocated_amount: number;
    new_amount_paid: number;
    new_status: string;
    fully_satisfied: boolean;
  }> = [];
  let unallocated_credit = 0;

  if (!body.installment_id && result.payment_id) {
    const { data: allocData, error: allocError } = await supabase.rpc(
      "allocate_payment_waterfall",
      {
        p_tenant_id: ctx.tenantId,
        p_parent_id: body.parent_id,
        p_payment_id: result.payment_id,
        p_payment_amount: body.amount,
        p_category_filter: body.category_filter ?? null,
        p_actor_profile_id: ctx.userProfileId,
      },
    );

    if (allocError) {
      console.error("[collect-payment] Waterfall allocation failed:", allocError);
      // Don't fail the whole request — the payment + ledger entry are already
      // committed. The operator can re-run allocation manually.
      return jsonOk(req, {
        payment_id: result.payment_id,
        receipt_id: result.receipt_id,
        new_installment_status: result.new_installment_status,
        allocations: [],
        unallocated_credit: body.amount,
        waterfall_error: allocError.message,
        message: `Payment of ${body.amount} DZD collected, but waterfall allocation failed: ${allocError.message}. Manual allocation required.`,
      });
    }

    if (allocData && Array.isArray(allocData)) {
      allocations = allocData.map((row: Record<string, unknown>) => ({
        installment_id: String(row.installment_id),
        allocated_amount: Number(row.allocated_amount),
        new_amount_paid: Number(row.new_amount_paid),
        new_status: String(row.new_status),
        fully_satisfied: Boolean(row.fully_satisfied),
      }));
      const totalAllocated = allocations.reduce(
        (s, a) => s + a.allocated_amount,
        0,
      );
      unallocated_credit = Math.max(0, body.amount - totalAllocated);
    }
  }

  return jsonOk(req, {
    payment_id: result.payment_id,
    receipt_id: result.receipt_id,
    new_installment_status: result.new_installment_status,
    allocations,
    unallocated_credit,
    allocated_tranche_count: allocations.length,
    message: `Payment of ${body.amount} DZD collected. Allocated to ${allocations.length} tranche(s).${
      unallocated_credit > 0 ? ` Credit: ${unallocated_credit} DZD.` : ""
    }`,
  });
});
