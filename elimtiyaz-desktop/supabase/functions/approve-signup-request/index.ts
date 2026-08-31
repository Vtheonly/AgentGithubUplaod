// ============================================================================
// approve-signup-request/index.ts
// ============================================================================
// Edge Function: Web Signup → Admin Approval → Bind to Profile
// ----------------------------------------------------------------------------
// This is the CORE of the approval workflow described in the user's brief:
//   "Approval workflow so that when a user registers from the website, an
//    administrator can approve the account and assign it to the appropriate
//    apprentice [parent/student] profile in the database."
//
// FLOW:
//   1. Web visitor signs up via Supabase Auth (Google OAuth or email/password)
//      on the Web Portal.
//   2. The `handle_new_auth_user()` trigger (migration 0002) automatically
//      creates a `user_profiles` row (status='pending') and an
//      `account_approval_requests` row.
//   3. The admin opens the Desktop app's "Pending Registrations" tab and
//      reviews the request.
//   4. The admin calls this Edge Function with one of:
//      a) `action=approve` + `target_parent_id` (bind to existing parent)
//      b) `action=approve` + `create_new_parent=true` + parent fields (create new)
//      c) `action=reject` + `decision_note` (reject with reason)
//
// SECURITY:
//   - Requires JWT (caller must be authenticated)
//   - Caller must have `super_admin` or `support_staff` role
//   - service_role key is used to perform the actual DB writes (bypasses RLS)
//   - Audit log entry is written for every decision
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { canAssignRole } from "../_shared/role-assignment.ts";
import { createServiceRoleClient, extractAuthContext, requireRole, withAuditSurfacing, writeAuditLog } from "../_shared/supabase.ts";

interface ApproveRequestBody {
  request_id: string;
  action: "approve" | "reject";
  target_parent_id?: string;          // for approve — bind to existing parent
  target_student_id?: string;         // for approve (student role) — bind to existing student
  create_new_parent?: boolean;        // for approve — create new parent profile
  new_parent?: {                      // required if create_new_parent=true
    first_name: string;
    last_name: string;
    primary_phone: string;
    email?: string;
    national_id?: string;
    address?: string;
    city?: string;
    relationship?: string;
  };
  decision_note?: string;             // required for reject; optional for approve
  assign_role?: string;               // override role (default: 'parent' or 'student' based on request)
}

Deno.serve(withAuditSurfacing(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // 1. Extract auth context (must be authenticated)
  const ctx = await extractAuthContext(req);
  if (!ctx) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }

  // 2. Authorization: caller must be super_admin or support_staff
  if (!requireRole(ctx, "support_staff")) {
    return jsonError(req, 403, "forbidden", "Only super_admin or support_staff can approve registrations");
  }

  // 3. Parse request body
  let body: ApproveRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  if (!body.request_id || !body.action) {
    return jsonError(req, 400, "missing_fields", "request_id and action are required");
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return jsonError(req, 400, "invalid_action", "action must be 'approve' or 'reject'");
  }

  const supabase = createServiceRoleClient();

  // 4. Fetch the approval request
  const { data: approvalRequest, error: fetchError } = await supabase
    .from("account_approval_requests")
    .select("*")
    .eq("id", body.request_id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending")
    .single();

  if (fetchError || !approvalRequest) {
    return jsonError(req, 404, "not_found", "Pending approval request not found");
  }

  // 5. Handle REJECT
  if (body.action === "reject") {
    if (!body.decision_note || body.decision_note.trim() === "") {
      return jsonError(req, 400, "missing_note", "A rejection reason is required");
    }

    const { error: rejectError } = await supabase.rpc("reject_account_request", {
      p_request_id: body.request_id,
      p_reviewer_profile_id: ctx.userProfileId,
      p_decision_note: body.decision_note,
    });

    if (rejectError) {
      console.error("[approve-signup] reject failed:", rejectError);
      return jsonError(req, 500, "reject_failed", "Failed to reject request", rejectError.message);
    }

    await writeAuditLog(
      ctx.tenantId,
      "account_approval.reject",
      "account_approval_request",
      body.request_id,
      ctx.userProfileId,
      ctx.email,
      { email: approvalRequest.email, requested_role: approvalRequest.requested_role },
      { status: "rejected", reason: body.decision_note },
      `Rejected registration for ${approvalRequest.email}`,
      requestId
    );

    return jsonOk(req, {
      request_id: body.request_id,
      status: "rejected",
      message: `Registration rejected. User ${approvalRequest.email} has been suspended.`,
    });
  }

  // 6. Handle APPROVE
  // 6a. If create_new_parent=true, create the parent profile first
  let targetParentId = body.target_parent_id;
  let targetStudentId = body.target_student_id;

  if (body.create_new_parent && body.new_parent) {
    const np = body.new_parent;
    if (!np.first_name || !np.last_name || !np.primary_phone) {
      return jsonError(req, 400, "missing_parent_fields", "first_name, last_name, primary_phone are required");
    }

    const parentCode = `PAR-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const { data: newParent, error: parentError } = await supabase
      .from("parents")
      .insert({
        tenant_id: ctx.tenantId,
        parent_code: parentCode,
        first_name: np.first_name,
        last_name: np.last_name,
        primary_phone: np.primary_phone,
        email: np.email ?? approvalRequest.email,
        national_id: np.national_id,
        address: np.address,
        city: np.city,
        relationship: np.relationship ?? "father",
        is_active: true,
      })
      .select("id")
      .single();

    if (parentError || !newParent) {
      console.error("[approve-signup] parent creation failed:", parentError);
      return jsonError(req, 500, "parent_creation_failed", "Failed to create new parent profile", parentError?.message);
    }

    targetParentId = newParent.id;

    await writeAuditLog(
      ctx.tenantId,
      "parent.create",
      "parent",
      newParent.id,
      ctx.userProfileId,
      ctx.email,
      null,
      { parent_code: parentCode, first_name: np.first_name, last_name: np.last_name },
      `Created new parent profile during approval of ${approvalRequest.email}`,
      requestId
    );
  }

  // 6b. Call the approve_account_request RPC function
  const { data: assignedRoleId, error: approveError } = await supabase.rpc("approve_account_request", {
    p_request_id: body.request_id,
    p_reviewer_profile_id: ctx.userProfileId,
    p_target_parent_id: targetParentId ?? null,
    p_target_student_id: targetStudentId ?? null,
    p_decision_note: body.decision_note ?? null,
  });

  if (approveError) {
    console.error("[approve-signup] approve failed:", approveError);
    return jsonError(req, 500, "approve_failed", "Failed to approve request", approveError.message);
  }

  // 6c. Optionally override the assigned role (SEC-107 constrained)
  if (body.assign_role && body.assign_role !== approvalRequest.requested_role) {
    // SEC-107 (T-008): the override used to accept ANY role code —
    // including super_admin — for a support_staff caller. Three guards now:
    //   (1) the code must resolve to a canonical `roles` row (unknown → 400);
    //   (2) staff/admin roles require a super_admin caller (→ 403, audited);
    //   (3) the revoke/insert writes are error-checked (a failed revoke
    //       followed by a successful insert would mint DUPLICATE roles).
    const { data: newRole, error: roleLookupError } = await supabase
      .from("roles")
      .select("id, code, is_staff_role")
      .eq("code", body.assign_role)
      .single();

    if (roleLookupError || !newRole) {
      return jsonError(req, 400, "invalid_role", `Unknown role code: ${body.assign_role}`);
    }

    if (canAssignRole(ctx.roles, newRole) !== "allowed") {
      await writeAuditLog(
        ctx.tenantId,
        "account_approval.role_override_denied",
        "account_approval_request",
        body.request_id,
        ctx.userProfileId,
        ctx.email,
        { requested_role: approvalRequest.requested_role },
        { attempted_role: body.assign_role, denied_by: "SEC-107 staff-role gate" },
        `SEC-107: non-super_admin caller attempted to assign staff role '${body.assign_role}' during approval of ${approvalRequest.email}`,
        requestId
      );
      return jsonError(req, 403, "role_assignment_forbidden", "Only super_admin can assign staff roles");
    }

    const { data: targetProfile, error: profileLookupError } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", approvalRequest.auth_user_id)
      .single();

    if (profileLookupError || !targetProfile) {
      console.error("[approve-signup] profile lookup failed:", profileLookupError);
      return jsonError(req, 500, "profile_not_found", "Approved user profile not found", profileLookupError?.message);
    }

    // Revoke the auto-assigned role and assign the new one
    const { error: revokeError } = await supabase
      .from("role_assignments")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_profile_id", targetProfile.id)
      .eq("role_id", assignedRoleId)
      .is("revoked_at", null);

    if (revokeError) {
      console.error("[approve-signup] role revoke failed:", revokeError);
      return jsonError(req, 500, "role_revoke_failed", "Failed to revoke the auto-assigned role", revokeError.message);
    }

    const { error: assignError } = await supabase
      .from("role_assignments")
      .insert({
        user_profile_id: targetProfile.id,
        tenant_id: ctx.tenantId,
        role_id: newRole.id,
        assigned_by: ctx.userProfileId,
      });

    if (assignError) {
      console.error("[approve-signup] role assign failed:", assignError);
      return jsonError(req, 500, "role_assign_failed", "Failed to assign the requested role", assignError.message);
    }
  }

  // 6d. Fetch the user's profile to send confirmation email (optional)
  const { data: userProfile } = await supabase
    .from("user_profiles")
    .select("email, display_name")
    .eq("auth_user_id", approvalRequest.auth_user_id)
    .single();

  // 6e. Write audit log
  await writeAuditLog(
    ctx.tenantId,
    "account_approval.approve",
    "account_approval_request",
    body.request_id,
    ctx.userProfileId,
    ctx.email,
    { email: approvalRequest.email, requested_role: approvalRequest.requested_role, status: "pending" },
    {
      email: approvalRequest.email,
      assigned_role: body.assign_role ?? approvalRequest.requested_role,
      target_parent_id: targetParentId,
      target_student_id: targetStudentId,
      created_new_parent: body.create_new_parent ?? false,
      status: "approved",
    },
    `Approved registration for ${approvalRequest.email}`,
    requestId
  );

  // 6f. Send confirmation email (optional — only if RESEND_API_KEY is set)
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey && userProfile) {
    try {
      const emailFrom = Deno.env.get("EMAIL_FROM_ADDRESS") ?? "noreply@elimtiyaz.dz";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom,
          to: userProfile.email,
          subject: "Votre compte El-Imtiyaz est approuvé",
          html: `
            <h1>Bienvenue chez El-Imtiyaz</h1>
            <p>Bonjour ${userProfile.display_name ?? ""},</p>
            <p>Votre compte a été approuvé. Vous pouvez maintenant vous connecter au portail.</p>
            <p><a href="https://portal.elimtiyaz.dz">Accéder au portail</a></p>
          `,
        }),
      });
    } catch (emailError) {
      console.warn("[approve-signup] Failed to send confirmation email:", emailError);
    }
  }

  return jsonOk(req, {
    request_id: body.request_id,
    status: "approved",
    auth_user_id: approvalRequest.auth_user_id,
    target_parent_id: targetParentId ?? null,
    target_student_id: targetStudentId ?? null,
    assigned_role: body.assign_role ?? approvalRequest.requested_role,
    message: `Registration approved. User ${approvalRequest.email} can now sign in.`,
  });
}));
