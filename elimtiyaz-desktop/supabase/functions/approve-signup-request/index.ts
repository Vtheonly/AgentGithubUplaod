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
import { PORTAL_URL, sendEmailFromEnv } from "../_shared/send-email.ts";

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
  /**
   * T-413 (STUDENT-100): approve AND enroll a student — routes the approval
   * through the approve_student_application composite RPC (migration 0116)
   * which creates the canonical student record (ELV code, class enrollment,
   * student_academic_histories entry) in the same transaction as the account
   * activation. Valid for BOTH student-role requests (the applicant becomes
   * the student) and parent-role requests (the family's child is enrolled —
   * the parent binding happens in the same composite).
   */
  create_new_student?: boolean;
  new_student?: {
    first_name: string;
    middle_name?: string;
    last_name: string;
    date_of_birth: string;            // ISO date (YYYY-MM-DD), must be in the past
    gender?: "male" | "female" | "other";
    grade_level_code?: string;        // canonical code ("5ap", "1am", ...) — required unless class_id carries the level
    class_id?: string;               // optional enrollment: the class to place the student in
    medical_notes?: string;
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
  // T-413 reclassification: every website self-signup lands as requested_role
  // ='parent' (0054/SEC-108 hardcodes it — the client cannot claim a role).
  // When the admin recognises the applicant IS the student (their own Google
  // account), the approval's assign_role='student' reclassifies the request
  // BEFORE any guard runs — the guards then evaluate the RECLASSIFIED role,
  // and the composite RPC binds the STUDENT account (students.auth_user_id)
  // instead of the parent's. Only parent↔student reclassifications are
  // honoured here; staff roles keep the SEC-107 gate.
  if (
    body.assign_role &&
    (body.assign_role === "student" || body.assign_role === "parent") &&
    body.assign_role !== String(approvalRequest.requested_role)
  ) {
    const { error: reclassifyError } = await supabase
      .from("account_approval_requests")
      .update({ requested_role: body.assign_role })
      .eq("id", body.request_id)
      .eq("status", "pending");

    if (reclassifyError) {
      console.error("[approve-signup] reclassification failed:", reclassifyError);
      return jsonError(req, 500, "reclassification_failed", "Failed to reclassify the request", reclassifyError.message);
    }
    await writeAuditLog(
      ctx.tenantId,
      "account_approval.reclassified",
      "account_approval_request",
      body.request_id,
      ctx.userProfileId,
      ctx.email,
      { requested_role: approvalRequest.requested_role },
      { requested_role: body.assign_role, reason: "T-413 student-application approval" },
      `Reclassified ${approvalRequest.email} from '${approvalRequest.requested_role}' to '${body.assign_role}' during the student-application approval`,
      requestId
    );
    approvalRequest.requested_role = body.assign_role;
  }

  // PARENT-102 guard (T-132, 22nd session): a parent-role approve with
  // NEITHER `target_parent_id` NOR `create_new_parent=true` would activate
  // the user and assign the parent role WITHOUT ever setting
  // parents.auth_user_id — the "active but unbound" limbo (the SQL RPC
  // skips the binding when p_target_parent_id is NULL, the website's
  // auth-provider then finds no parent row and shows "not activated"
  // forever, bind-activation-code rejects active users with 409, and the
  // request is no longer pending so this RPC can never be re-called — no
  // recovery path). One legitimate escape: an explicit assign_role override
  // to a STAFF role (roles.is_staff_role) produces a staff account, which
  // needs no parent binding. Staff-role requests never need a binding.
  if (
    String(approvalRequest.requested_role) === "parent" &&
    !body.create_new_parent &&
    !body.target_parent_id
  ) {
    let staffOverride = false;
    if (body.assign_role && body.assign_role !== approvalRequest.requested_role) {
      const { data: overrideRole, error: overrideRoleError } = await supabase
        .from("roles")
        .select("is_staff_role")
        .eq("code", body.assign_role)
        .single();
      if (overrideRoleError || !overrideRole) {
        return jsonError(req, 400, "invalid_role", `Unknown role code: ${body.assign_role}`);
      }
      staffOverride = overrideRole.is_staff_role === true;
    }
    if (!staffOverride) {
      await writeAuditLog(
        ctx.tenantId,
        "account_approval.missing_target_parent_denied",
        "account_approval_request",
        body.request_id,
        ctx.userProfileId,
        ctx.email,
        { email: approvalRequest.email, requested_role: approvalRequest.requested_role },
        { denied_by: "PARENT-102 binding guard", requested_binding: "target_parent_id or create_new_parent" },
        `PARENT-102: refused to approve ${approvalRequest.email} without a parent binding (would create an active-but-unbound user)`,
        requestId
      );
      return jsonError(
        req,
        400,
        "missing_target_parent",
        "A parent-role approval requires target_parent_id or create_new_parent=true (otherwise the user would be active but unbound to any parent profile)",
      );
    }
  }

  // 6a. If create_new_parent=true AND this is NOT a student-enrollment
  // approval, create the parent profile first (the T-413 composite RPC
  // creates the parent itself — running both would double-create).
  let targetParentId = body.target_parent_id;
  let targetStudentId = body.target_student_id;

  const isStudentEnrollmentApproval =
    body.create_new_student === true ||
    (String(approvalRequest.requested_role) === "student" && !!body.target_student_id);

  if (
    body.create_new_parent &&
    body.new_parent &&
    !isStudentEnrollmentApproval
  ) {
    const np = body.new_parent;
    if (!np.first_name || !np.last_name || !np.primary_phone) {
      return jsonError(req, 400, "missing_parent_fields", "first_name, last_name, primary_phone are required");
    }

    // T-115 / DRIFT-001 (19th session, migration 0065): the parent code is the
    // CANONICAL deterministic derivation — the same fn_deterministic_parent_code
    // SQL RPC every other platform uses (FNV-1a of the identity fields, so
    // re-approving the same identity converges on the same code and the
    // unique (tenant_id, parent_code) constraint refuses duplicates). This
    // replaces the old Math.random() 4-char suffix, which created a NEW code
    // on every attempt — a retried approval could duplicate the parent.
    const { data: parentCode, error: codeError } = await supabase.rpc(
      "fn_deterministic_parent_code",
      {
        p_year: new Date().getFullYear(),
        p_phone: np.primary_phone,
        p_first_name: np.first_name,
        p_last_name: np.last_name,
      },
    );
    if (codeError || !parentCode) {
      console.error("[approve-signup] parent code generation failed:", codeError);
      return jsonError(req, 500, "parent_code_failed", "Failed to derive the canonical parent code", codeError?.message);
    }

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

  // 6b. STUDENT-102 guard (T-413): a STUDENT-role approval requires a student
  // binding — target_student_id (bind existing) or create_new_student
  // (create + enroll). The PARENT-102 guard above closes the limbo for
  // parents; this is its student twin (an approved student with no student
  // record is "active but unbound" — the exact STUDENT-101 defect migration
  // 0116 closes at the RPC level too; this is the earlier, cheaper UI-side
  // rejection with the same staff-override escape).
  if (
    String(approvalRequest.requested_role) === "student" &&
    !body.create_new_student &&
    !body.target_student_id
  ) {
    let staffOverride = false;
    if (body.assign_role && body.assign_role !== approvalRequest.requested_role) {
      const { data: overrideRole, error: overrideRoleError } = await supabase
        .from("roles")
        .select("is_staff_role")
        .eq("code", body.assign_role)
        .single();
      if (overrideRoleError || !overrideRole) {
        return jsonError(req, 400, "invalid_role", `Unknown role code: ${body.assign_role}`);
      }
      staffOverride = overrideRole.is_staff_role === true;
    }
    if (!staffOverride) {
      await writeAuditLog(
        ctx.tenantId,
        "account_approval.missing_target_student_denied",
        "account_approval_request",
        body.request_id,
        ctx.userProfileId,
        ctx.email,
        { email: approvalRequest.email, requested_role: approvalRequest.requested_role },
        { denied_by: "STUDENT-102 binding guard", requested_binding: "target_student_id or create_new_student" },
        `STUDENT-102: refused to approve ${approvalRequest.email} without a student binding (would create an active-but-unbound user)`,
        requestId
      );
      return jsonError(
        req,
        400,
        "missing_target_student",
        "A student-role approval requires target_student_id or create_new_student=true (otherwise the user would be active but unbound to any student profile)",
      );
    }
  }

  // 6b-2. Category guard: a parent-role approval must never carry a student
  // binding (the account binds the PARENT; children are CREATED, not bound).
  if (
    String(approvalRequest.requested_role) === "parent" &&
    body.target_student_id
  ) {
    return jsonError(
      req,
      400,
      "parent_request_cannot_bind_student",
      "A parent-role approval binds the parent account. To enroll their child, pass create_new_student + new_student instead of target_student_id.",
    );
  }

  // 6b-3. T-413 (STUDENT-100): the student-enrollment composite path — ONE
  // server-side RPC (approve_student_application, migration 0116) creates
  // the parent (when needed), the canonical student record (ELV code, class
  // enrollment, student_academic_histories entry), activates the account,
  // and binds the STUDENT (student-role) or the PARENT (parent-role) — all
  // in one transaction (the §15.39 PERF-501 lesson: no client-orchestrated
  // multi-call composite).
  if (isStudentEnrollmentApproval) {
    if (body.create_new_student && !body.new_student) {
      return jsonError(
        req,
        400,
        "missing_student_fields",
        "create_new_student=true requires the new_student payload (first_name, last_name, date_of_birth are required)",
      );
    }

    const { data: studentApproval, error: studentApproveError } = await supabase.rpc(
      "approve_student_application",
      {
        p_request_id: body.request_id,
        p_reviewer_profile_id: ctx.userProfileId,
        p_decision_note: body.decision_note ?? null,
        p_target_student_id: targetStudentId ?? null,
        p_target_parent_id: targetParentId ?? null,
        p_new_parent: body.create_new_parent && body.new_parent ? body.new_parent : null,
        p_new_student: body.new_student ?? null,
      },
    );

    if (studentApproveError) {
      console.error("[approve-signup] student enrollment approval failed:", studentApproveError);
      return jsonError(req, 500, "student_enrollment_failed", "Failed to approve the student application", studentApproveError.message);
    }

    const studentResult = studentApproval as {
      student_id: string;
      student_code: string;
      parent_id: string;
      role_id: string;
      created_student: boolean;
    };

    await writeAuditLog(
      ctx.tenantId,
      "account_approval.approve_student_application",
      "account_approval_request",
      body.request_id,
      ctx.userProfileId,
      ctx.email,
      { email: approvalRequest.email, requested_role: approvalRequest.requested_role, status: "pending" },
      {
        email: approvalRequest.email,
        requested_role: approvalRequest.requested_role,
        target_parent_id: studentResult.parent_id,
        target_student_id: studentResult.student_id,
        student_code: studentResult.student_code,
        created_new_parent: body.create_new_parent ?? false,
        created_new_student: studentResult.created_student,
        status: "approved",
      },
      `Approved student application for ${approvalRequest.email} — student ${studentResult.student_code} enrolled`,
      requestId
    );

    // Best-effort confirmation email (the 6f convention — never fails the
    // committed approval).
    const { data: approvedProfile } = await supabase
      .from("user_profiles")
      .select("email, display_name")
      .eq("auth_user_id", approvalRequest.auth_user_id)
      .maybeSingle();

    let studentEmailOutcome: { sent: boolean; reason?: string; error?: string } | null = null;
    if (approvedProfile?.email) {
      studentEmailOutcome = await sendEmailFromEnv({
        to: approvedProfile.email,
        subject: "Votre inscription El-Imtiyaz est approuvée",
        html: `
            <h1>Bienvenue chez El-Imtiyaz</h1>
            <p>Bonjour ${approvedProfile.display_name ?? ""},</p>
            <p>L'inscription a été approuvée. Le dossier élève <strong>${studentResult.student_code}</strong> est actif.</p>
            <p><a href="${PORTAL_URL}">Accéder au portail</a></p>
          `,
      });
      if (!studentEmailOutcome.sent) {
        console.warn(
          `[approve-signup] Student-approval email NOT sent to ${approvedProfile.email}:`,
          studentEmailOutcome.reason,
          studentEmailOutcome.error ?? "",
        );
      }
    }

    return jsonOk(req, {
      request_id: body.request_id,
      status: "approved",
      auth_user_id: approvalRequest.auth_user_id,
      target_parent_id: studentResult.parent_id,
      target_student_id: studentResult.student_id,
      student_code: studentResult.student_code,
      created_student: studentResult.created_student,
      assigned_role: body.assign_role ?? approvalRequest.requested_role,
      email: studentEmailOutcome,
      message: `Student application approved. Student ${studentResult.student_code} is enrolled and ${approvalRequest.email} can now sign in.`,
    });
  }

  // 6c. Call the approve_account_request RPC function (the plain path —
  // unchanged behaviour for bind-only parent approvals)
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

  // 6f. Send confirmation email — T-131 / PUSH-104 (2026-09-03): now through
  // the ONE shared Resend integration (_shared/send-email.ts). The old inline
  // fetch never checked resp.ok (a Resend 4xx "succeeded" silently), swallowed
  // all errors, and linked a DEAD legacy portal origin — this now links
  // the production origin from the credentials sheet §2.2 (PORTAL_URL). The email
  // remains a best-effort POST-approval step (the approval itself is already
  // committed in step 6b): its structured outcome is surfaced in the response
  // payload and logged on failure, never silently swallowed, and never fails
  // the already-committed approval.
  let emailOutcome: { sent: boolean; reason?: string; error?: string } | null = null;
  if (userProfile?.email) {
    emailOutcome = await sendEmailFromEnv({
      to: userProfile.email,
      subject: "Votre compte El-Imtiyaz est approuvé",
      html: `
            <h1>Bienvenue chez El-Imtiyaz</h1>
            <p>Bonjour ${userProfile.display_name ?? ""},</p>
            <p>Votre compte a été approuvé. Vous pouvez maintenant vous connecter au portail.</p>
            <p><a href="${PORTAL_URL}">Accéder au portail</a></p>
          `,
    });
    if (!emailOutcome.sent) {
      console.warn(
        `[approve-signup] Confirmation email NOT sent to ${userProfile.email}:`,
        emailOutcome.reason,
        emailOutcome.error ?? "",
      );
    }
  }

  return jsonOk(req, {
    request_id: body.request_id,
    status: "approved",
    auth_user_id: approvalRequest.auth_user_id,
    target_parent_id: targetParentId ?? null,
    target_student_id: targetStudentId ?? null,
    assigned_role: body.assign_role ?? approvalRequest.requested_role,
    email: emailOutcome,
    message: `Registration approved. User ${approvalRequest.email} can now sign in.`,
  });
}));
