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
      return Err(supabaseErrorToAppError(error));
    }
    if (data?.error) {
      return Err(Errors.server(data.error.message ?? "Binding failed"));
    }
    return Ok(data.data);
  }

  /**
   * Generate a new activation code for a parent (admin operation).
   */
  async generateActivationCode(parentId: string): Promise<Result<string>> {
    const { data, error } = await this.client.rpc("generate_activation_code", {
      p_tenant_id: (await this.client.rpc("current_tenant_id")).data,
    });

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }

    // Insert the code linked to the parent
    const { error: insertError } = await this.client.from("activation_codes").insert({
      parent_id: parentId,
      code: data,
      issued_by: (await this.client.rpc("current_user_profile_id")).data,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    if (insertError) {
      return Err(supabaseErrorToAppError(insertError));
    }

    return Ok(data);
  }
}
