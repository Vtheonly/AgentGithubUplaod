/**
 * SupabaseApprovalRepository — admin operations for the web-registration →
 * admin-approval workflow.
 *
 * Per plan §06 (Account Activation Protocol) + the user's brief:
 *   "Approval workflow so that when a user registers from the website, an
 *    administrator can approve the account and assign it to the appropriate
 *    apprentice [parent/student] profile in the database."
 *
 * The actual approval/rejection is performed by the `approve-signup-request`
 * Edge Function (which calls the `approve_account_request` / `reject_account_request`
 * PostgreSQL functions). This repository provides the desktop-side UI with
 * the list of pending requests + the binding to call the Edge Function.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountApprovalRequestRow } from "../types";
import { Ok, Err, type Result } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";

/**
 * Extract the hub Edge Functions' STRUCTURED error body from a
 * functions-js error object.
 *
 * T-184 / ACT-202 (2026-09-05): `SupabaseClient.functions.invoke` (via
 * @supabase/functions-js 2.112.3) returns `{ data: null, error }` for EVERY
 * non-2xx status — the Response is wrapped in `FunctionsHttpError`, whose
 * `context` property holds the raw Response and whose `message` is the
 * generic "Function returned an error". The hub EFs respond with
 * `{ error: { code, message, details } }` (the _shared/cors.ts jsonError
 * shape — pinned by T-146/T-147's live round-trip), so the real reason must
 * be parsed off `error.context`. Returns null when the context is missing,
 * already consumed, or not the structured shape (callers then fall back to
 * their generic mapping).
 */
async function structuredEdgeFunctionError(
  error: unknown,
): Promise<{ code?: string; message?: string } | null> {
  const ctx = (error as { context?: unknown } | null | undefined)?.context;
  if (!ctx || typeof (ctx as Response).json !== "function") {
    return null;
  }
  try {
    const body = (await (ctx as Response).json()) as {
      error?: { code?: unknown; message?: unknown };
    } | null;
    const e = body?.error;
    if (e && typeof e === "object") {
      return {
        code: typeof e.code === "string" ? e.code : undefined,
        message: typeof e.message === "string" ? e.message : undefined,
      };
    }
    return null;
  } catch {
    // Body already consumed or not JSON — the generic path applies.
    return null;
  }
}

export interface PendingApprovalWithDetails extends AccountApprovalRequestRow {
  parent_match?: {
    id: string;
    parent_code: string;
    first_name: string;
    last_name: string;
    primary_phone: string;
    email: string | null;
  } | null;
  student_match?: {
    id: string;
    student_code: string;
    first_name: string;
    last_name: string;
  } | null;
}

export class SupabaseApprovalRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * List all pending approval requests for the current tenant.
   * Optionally filter by status (default: 'pending').
   */
  async listPending(status: "pending" | "approved" | "rejected" | "expired" = "pending"): Promise<Result<PendingApprovalWithDetails[]>> {
    const { data, error } = await this.client
      .from("account_approval_requests")
      .select("*")
      .eq("status", status)
      .order("requested_at", { ascending: false });

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }

    // For each request, attempt to find a matching parent by email/phone/national_id/activation_code
    const enriched: PendingApprovalWithDetails[] = [];
    for (const row of data ?? []) {
      const match = await this.findPotentialMatches(row);
      enriched.push({ ...row, ...match });
    }

    return Ok(enriched);
  }

  /**
   * For a given approval request, find a matching parent (by activation_code,
   * email, national_id, or phone). Returns the parent record if found.
   */
  private async findPotentialMatches(request: AccountApprovalRequestRow): Promise<{
    parent_match: PendingApprovalWithDetails["parent_match"];
    student_match: PendingApprovalWithDetails["student_match"];
  }> {
    // Try activation_code first (canonical path)
    if (request.activation_code) {
      const { data: codeRow } = await this.client
        .from("activation_codes")
        .select("parent_id, student_id")
        .eq("code", request.activation_code)
        .is("bound_to_auth_user_id", null)
        .single();

      if (codeRow?.parent_id) {
        const { data: parent } = await this.client
          .from("parents")
          .select("id, parent_code, first_name, last_name, primary_phone, email")
          .eq("id", codeRow.parent_id)
          .single();

        if (parent) {
          return { parent_match: parent, student_match: null };
        }
      }
    }

    // Try email match
    if (request.email) {
      const { data: parent } = await this.client
        .from("parents")
        .select("id, parent_code, first_name, last_name, primary_phone, email")
        .eq("email", request.email)
        .is("auth_user_id", null)
        .single();

      if (parent) {
        return { parent_match: parent, student_match: null };
      }
    }

    // Try national_id
    if (request.national_id) {
      const { data: parent } = await this.client
        .from("parents")
        .select("id, parent_code, first_name, last_name, primary_phone, email")
        .eq("national_id", request.national_id)
        .is("auth_user_id", null)
        .single();

      if (parent) {
        return { parent_match: parent, student_match: null };
      }
    }

    // Try phone match
    if (request.phone) {
      const { data: parent } = await this.client
        .from("parents")
        .select("id, parent_code, first_name, last_name, primary_phone, email")
        .eq("primary_phone", request.phone)
        .is("auth_user_id", null)
        .single();

      if (parent) {
        return { parent_match: parent, student_match: null };
      }
    }

    return { parent_match: null, student_match: null };
  }

  /**
   * Approve a pending request, binding it to an existing parent profile.
   * Calls the `approve-signup-request` Edge Function.
   */
  async approveWithExistingParent(
    requestId: string,
    targetParentId: string,
    decisionNote?: string,
    assignRole?: string
  ): Promise<Result<{ status: string; auth_user_id: string; target_parent_id: string }>> {
    const { data, error } = await this.client.functions.invoke("approve-signup-request", {
      body: {
        request_id: requestId,
        action: "approve",
        target_parent_id: targetParentId,
        decision_note: decisionNote,
        assign_role: assignRole,
      },
    });

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }

    if (data?.error) {
      return Err(Errors.server(data.error.message ?? "Approval failed"));
    }

    return Ok(data.data);
  }

  /**
   * Approve a pending request, creating a brand-new parent profile.
   */
  async approveWithNewParent(
    requestId: string,
    newParent: {
      first_name: string;
      last_name: string;
      primary_phone: string;
      email?: string;
      national_id?: string;
      address?: string;
      city?: string;
      relationship?: string;
    },
    decisionNote?: string,
    assignRole?: string
  ): Promise<Result<{ status: string; auth_user_id: string; target_parent_id: string }>> {
    const { data, error } = await this.client.functions.invoke("approve-signup-request", {
      body: {
        request_id: requestId,
        action: "approve",
        create_new_parent: true,
        new_parent: newParent,
        decision_note: decisionNote,
        assign_role: assignRole,
      },
    });

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    if (data?.error) {
      return Err(Errors.server(data.error.message ?? "Approval failed"));
    }
    return Ok(data.data);
  }

  /**
   * Reject a pending request with a mandatory reason.
   */
  async reject(requestId: string, reason: string): Promise<Result<void>> {
    if (!reason.trim()) {
      return Err(Errors.validation("A rejection reason is required"));
    }

    const { data, error } = await this.client.functions.invoke("approve-signup-request", {
      body: {
        request_id: requestId,
        action: "reject",
        decision_note: reason,
      },
    });

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    if (data?.error) {
      return Err(Errors.server(data.error.message ?? "Rejection failed"));
    }
    return Ok(undefined);
  }

  /**
   * Bind a parent's web account to their master profile using a 6-7 digit
   * activation code. This is the Web Portal side of the Account Activation
   * Protocol (plan §06). On the desktop side, this is used for testing
   * and for staff-assisted binding.
   *
   * T-184 / ACT-202 (2026-09-05): the error path used to collapse EVERY
   * non-2xx response into the generic "Function returned an error" string —
   * functions-js (2.112.3, live-verified in node_modules) returns
   * `{ data: null, error: FunctionsHttpError }` for any non-2xx status and
   * the hub EF's structured body `{ error: { code, message } }` (the
   * _shared/cors.ts jsonError shape, pinned by T-146/T-147) never reached
   * the `data` channel. The staff could not tell an invalid code from an
   * expired one from an already-bound family. The structured body is now
   * parsed off `error.context` (the raw Response) and mapped to a precise
   * AppError — the desktop equivalent of the website's T-153 mapping.
   */
  async bindActivationCode(activationCode: string): Promise<Result<{
    parent_id: string;
    parent_full_name: string;
    student_count: number;
  }>> {
    if (!/^\d{6,7}$/.test(activationCode)) {
      return Err(Errors.validation("Activation code must be 6-7 digits"));
    }

    const { data, error } = await this.client.functions.invoke("bind-activation-code", {
      body: { activation_code: activationCode },
    });

    if (error) {
      const structured = await structuredEdgeFunctionError(error);
      if (structured) {
        switch (structured.code) {
          case "account_already_active":
            // Idempotent per ADR-011 — the account is already usable.
            return Err(
              Errors.conflict(
                structured.message ?? "Account is already active",
                "Le compte est déjà actif — aucune action nécessaire.",
              ),
            );
          case "parent_already_bound":
            return Err(
              Errors.conflict(
                structured.message ?? "Parent already bound to another account",
                structured.message ?? "Cette famille est déjà liée à un autre compte.",
              ),
            );
          case "code_not_found":
            return Err(
              Errors.validation(
                structured.message ?? "Invalid or already-used activation code",
                "Code d'activation invalide ou déjà utilisé.",
              ),
            );
          case "code_expired":
            return Err(
              Errors.validation(
                structured.message ?? "Activation code has expired",
                "Code d'activation expiré — contactez l'administration.",
              ),
            );
          case "account_suspended":
          case "account_rejected":
            // Errors.forbidden takes one argument; the EF's real message is
            // the developer-facing detail (the fixed userMessage stays
            // permission-flavoured — appropriate for a suspended account).
            return Err(
              Errors.forbidden(
                structured.message ?? "Account suspended or rejected. Contact the school administration.",
              ),
            );
          default:
            // auth_failed / profile_not_found / server_misconfigured / …
            return Err(Errors.server(structured.message ?? "Binding failed"));
        }
      }
      return Err(supabaseErrorToAppError(error));
    }
    if (data?.error) {
      return Err(Errors.server(data.error.message ?? "Binding failed"));
    }
    return Ok(data.data);
  }

  /**
   * Generate a new activation code for a parent (admin operation).
   *
   * T-145 / ACT-200 (2026-09-03): the INSERT previously omitted
   * `tenant_id` — a NOT NULL column with NO default — so the insert
   * ALWAYS failed with a NOT NULL violation, and the caller
   * (`issueActivationCode` in parent-detail-drawer.tsx) silently fell
   * back to the deterministic offline code: the parent received a
   * phantom code that could never validate on the portal (live evidence:
   * 5 audit-logged issuances on 2026-09-03, 0 rows in activation_codes).
   *
   * The fix resolves tenant_id and issued_by ONCE, includes tenant_id in
   * the INSERT payload, and propagates the real error message up so the
   * staff sees the failure instead of handing out a code that does not
   * exist server-side.
   */
  async generateActivationCode(parentId: string): Promise<Result<string>> {
    // Resolve tenant + issuing profile in one round-trip each (both are
    // SECURITY-definer-free resolvers evaluated under the caller's RLS).
    const { data: tenantId, error: tenantErr } = await this.client.rpc("current_tenant_id");
    if (tenantErr || !tenantId) {
      return Err(
        supabaseErrorToAppError(
          tenantErr ??
            new Error("generateActivationCode: current_tenant_id() returned no tenant (is the session bound to a tenant?)")
        )
      );
    }

    const { data, error } = await this.client.rpc("generate_activation_code", {
      p_tenant_id: tenantId as string,
    });

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }

    const { data: issuerProfileId } = await this.client.rpc("current_user_profile_id");

    // Insert the code linked to the parent — tenant_id is NOT NULL with no
    // default (activation_codes schema, migration 0005): omitting it made
    // every issuance fail (ACT-200).
    const { error: insertError } = await this.client.from("activation_codes").insert({
      tenant_id: tenantId as string,
      parent_id: parentId,
      code: data,
      issued_by: (issuerProfileId as string | null) ?? null,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    if (insertError) {
      return Err(supabaseErrorToAppError(insertError));
    }

    return Ok(data);
  }
}
