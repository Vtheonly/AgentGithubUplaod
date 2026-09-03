// ============================================================================
// bind-activation-code/index.ts
// ============================================================================
// Edge Function: Bind an activation code to the caller's auth.users.id
// ----------------------------------------------------------------------------
// This is the Web Portal side of the Account Activation Protocol (plan §02.08
// / §06) — the ONLY deployed version of this function (CROSS-009 closed by
// T-146; the website repo's drifted duplicate was deleted the same day).
//
// FLOW:
//   1. Office staff creates a parent + N students on the Desktop app.
//   2. Staff generates a 6-7 digit activation code (issued to the parent).
//   3. Parent opens the Web Portal, logs in via Google OAuth.
//   4. Parent enters the activation code.
//   5. The Web Portal calls THIS Edge Function.
//   6. This function calls `public.bind_activation_code()` RPC which:
//      - Validates the code (exists, not used, not expired)
//      - Marks the code as bound (single-use enforcement)
//      - Updates `parents.auth_user_id` to the caller's auth.users.id
//      - Returns the parent info + student count
//   7. ADR-011 (T-146, 2026-09-03 — resolves UNKNOWN-001): binding the code
//      ALSO ACTIVATES the account — grants the `parent` role and flips
//      `user_profiles.status` from 'pending' to 'active'. The owner's
//      mandate ("entering the code must activate and give access") is the
//      product decision; the pre-T-146 hub EF left the user in 'pending'
//      forever (BUSINESS-008) while the website's drifted copy activated
//      with no audit trail and no suspended/deleted guard (SEC-104).
//
// SECURITY:
//   - Requires JWT (caller must be authenticated via Google OAuth).
//   - The activation code binds the auth.users.id to ONE parent record only.
//   - Single-use: code cannot be reused (enforced inside the RPC).
//   - CALLER AUTH (T-146): extractAuthContext() REJECTS profiles whose
//     status !== 'active' — i.e. it rejected the very 'pending' users this
//     endpoint exists for (live evidence 2026-09-03: every bind attempt
//     died with 401 before the code was even validated). This function
//     therefore verifies the JWT and fetches the profile DIRECTLY, and
//     applies its own status gates:
//       * 'active'    -> idempotent 409 account_already_active
//       * 'pending'   -> proceed (the activation path)
//       * 'suspended' -> 403 account_suspended (SEC-104: never resurrect)
//       * 'deleted'   -> 403 account_rejected (SEC-104)
//   - The activation flip + role grant run through the service-role client
//     (admin-only operations); the caller's JWT is verified FIRST so the
//     bind target (p_auth_user_id) can never be forged.
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import {
  createServiceRoleClient,
  writeAuditLog,
  withAuditSurfacing,
} from "../_shared/supabase.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface BindCodeRequest {
  /** Desktop/Android clients send `activation_code`. */
  activation_code?: string;
  /** The Next.js Web Portal sends `code` (activation-code-screen.tsx). */
  code?: string;
}

Deno.serve(withAuditSurfacing(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // ── 1. Verify the caller's JWT (auth only — the profile status gate is
  //        applied BELOW, deliberately NOT via extractAuthContext, which
  //        hard-rejects non-active profiles: see the header SECURITY note).
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }
  const callerJwt = authHeader.slice(7);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) {
    return jsonError(req, 500, "server_misconfigured", "Missing Supabase env vars");
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user: authUser }, error: authErr } =
    await anonClient.auth.getUser(callerJwt);
  if (authErr || !authUser) {
    return jsonError(req, 401, "auth_failed", "Invalid or expired session");
  }
  const authUserId = authUser.id;

  // ── 2. Fetch the caller's profile + apply the status gates (ADR-011).
  const supabase = createServiceRoleClient();
  const { data: profile, error: profileErr } = await supabase
    .from("user_profiles")
    .select("id, tenant_id, status, email, display_name, approval_request_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (profileErr || !profile) {
    return jsonError(
      req,
      404,
      "profile_not_found",
      "Profile not found. Please sign in again.",
    );
  }

  if (profile.status === "active") {
    // Idempotent success shape the portal understands (it refreshes on
    // `account_already_active`): the account is already usable.
    return jsonError(
      req,
      409,
      "account_already_active",
      "Account is already active.",
      { already_active: true },
    );
  }
  if (profile.status === "suspended") {
    return jsonError(
      req,
      403,
      "account_suspended",
      "This account is suspended. Contact the school administration.",
    );
  }
  if (profile.status === "deleted") {
    return jsonError(
      req,
      403,
      "account_rejected",
      "This account has been rejected. Contact the school administration.",
    );
  }
  // status === 'pending' → proceed with the bind.

  // ── 3. Parse body (CROSS-PLATFORM COMPATIBILITY, vault §02.08): the same
  //        deployed function serves both the Web Portal (body key `code`)
  //        and the desktop/Android clients (body key `activation_code`).
  let body: BindCodeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  const rawCode = body.activation_code ?? body.code;
  if (!rawCode) {
    return jsonError(req, 400, "missing_code", "activation_code (or code) is required");
  }

  // Validate code format (6-7 digits)
  const code = rawCode.trim();
  if (!/^\d{6,7}$/.test(code)) {
    return jsonError(req, 400, "invalid_code_format", "Activation code must be 6-7 digits");
  }

  // ── 4. Call the bind_activation_code RPC (SEC-110-hardened, 0055: the
  //        service-role path is the trusted server-side caller and passes
  //        the VERIFIED JWT's auth user id — a forged p_auth_user_id can
  //        never reach the RPC).
  const { data: bindResult, error: bindError } = await supabase.rpc(
    "bind_activation_code",
    {
      p_tenant_id: profile.tenant_id,
      p_code: code,
      p_auth_user_id: authUserId,
    },
  );

  if (bindError) {
    console.error("[bind-activation-code] RPC failed:", bindError);
    const message = (bindError.message ?? "").toLowerCase();
    if (message.includes("invalid") || message.includes("already-used")) {
      return jsonError(
        req,
        404,
        "code_not_found",
        "Invalid or already-used activation code",
      );
    }
    if (message.includes("expired")) {
      return jsonError(
        req,
        410,
        "code_expired",
        "Activation code has expired. Please contact the school office.",
      );
    }
    if (message.includes("already bound to another account")) {
      return jsonError(
        req,
        409,
        "parent_already_bound",
        "This family profile is already linked to another account. Contact the school office.",
      );
    }
    return jsonError(req, 500, "bind_failed", "Failed to bind activation code", bindError.message);
  }

  if (!bindResult || bindResult.length === 0) {
    return jsonError(req, 500, "bind_failed", "No parent record returned");
  }

  const result = bindResult[0] as {
    parent_id: string;
    parent_full_name: string;
    student_count: number;
  };

  // ── 5. ADR-011 activation semantics (ported from the website's drifted
  //        copy — the logic is now canonical here, hardened per SEC-104):
  //        grant the `parent` role, flip 'pending' → 'active', clear the
  //        approval_request link. Runs ONLY for the pending user we gated
  //        above — a suspended/deleted profile can never reach this code.
  const { data: parentRole } = await supabase
    .from("roles")
    .select("id")
    .eq("code", "parent")
    .maybeSingle();

  if (parentRole?.id) {
    // T-147 live discovery: the uniqueness arbiter on role_assignments is a
    // PARTIAL unique index (role_assignments_active_uidx ON
    // (user_profile_id, tenant_id, role_id) WHERE revoked_at IS NULL) —
    // PostgREST's upsert emits a plain ON CONFLICT (cols) which CANNOT
    // target a partial index ("no unique or exclusion constraint matching
    // the ON CONFLICT specification", live 2026-09-03). The EF therefore
    // resolves existence explicitly: INSERT only when no ACTIVE assignment
    // exists (idempotent re-runs converge, revoked rows are untouched and
    // a fresh grant replaces a revoked one — same semantics the 0047 RPC
    // achieves with its predicate-qualified ON CONFLICT).
    const { data: existingGrant, error: grantReadErr } = await supabase
      .from("role_assignments")
      .select("id")
      .eq("user_profile_id", profile.id)
      .eq("tenant_id", profile.tenant_id)
      .eq("role_id", parentRole.id)
      .is("revoked_at", null)
      .maybeSingle();

    if (grantReadErr) {
      return jsonError(
        req,
        500,
        "role_grant_failed",
        "Account bound but the parent role state could not be read. Contact the school office.",
        grantReadErr.message,
      );
    }

    if (!existingGrant) {
      const { error: roleErr } = await supabase
        .from("role_assignments")
        .insert({
          user_profile_id: profile.id,
          tenant_id: profile.tenant_id,
          role_id: parentRole.id,
          // Self-service activation — the audit entries below record the
          // verified auth user + the code that authorized the grant.
          assigned_by: profile.id,
        });
      if (roleErr) {
        // The bind SUCCEEDED — surface the role-grant failure instead of
        // silently leaving the user half-activated (the user would land on
        // the dashboard with no parent role and see empty everything).
        return jsonError(
          req,
          500,
          "role_grant_failed",
          "Account bound but the parent role could not be granted. Contact the school office.",
          roleErr.message,
        );
      }
    }
  }

  const { error: flipErr } = await supabase
    .from("user_profiles")
    .update({ status: "active", approval_request_id: null })
    .eq("id", profile.id);
  if (flipErr) {
    return jsonError(
      req,
      500,
      "activation_failed",
      "Account bound but activation could not be finalized. Contact the school office.",
      flipErr.message,
    );
  }

  // ── 6. Audit trail (PARENT-103): one entry for the bind (the canonical
  //        action name the registry has tracked since 0005) + one for the
  //        activation flip (ADR-011). Failures surface via
  //        withAuditSurfacing (SEC-001) — the mutation is already committed
  //        and is NOT rolled back.
  await writeAuditLog(
    profile.tenant_id,
    "activation_code.bind",
    "parent",
    result.parent_id,
    profile.id,
    profile.email,
    {
      activation_code: code,
      auth_user_id: authUserId,
      profile_status_before: profile.status,
    },
    {
      parent_id: result.parent_id,
      parent_full_name: result.parent_full_name,
      student_count: result.student_count,
      bound_at: new Date().toISOString(),
    },
    `Parent ${result.parent_full_name} activated account with code ${code}`,
    requestId,
  );
  await writeAuditLog(
    profile.tenant_id,
    "account.activated",
    "user_profile",
    profile.id,
    profile.id,
    profile.email,
    { status: profile.status, approval_request_id: profile.approval_request_id },
    { status: "active", role_granted: parentRole ? "parent" : null },
    `Self-service activation via bind-activation-code (code ${code}, ADR-011)`,
    requestId,
  );

  // ── 7. Return success
  return jsonOk(req, {
    parent_id: result.parent_id,
    parent_full_name: result.parent_full_name,
    student_count: result.student_count,
    message: `Account successfully linked to family: ${result.parent_full_name}`,
  });
}));
