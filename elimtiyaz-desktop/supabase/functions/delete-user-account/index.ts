// ============================================================================
// delete-user-account/index.ts
// ============================================================================
// Edge Function: Admin removal of login accounts (T-381)
// ----------------------------------------------------------------------------
// Owner request: "I forgot to add the ability to remove users and students,
// so add that functionality as well."
//
// FLOW (the mirror of create-user-account, T-079):
//   1. SuperAdmin opens the desktop Settings → Comptes tab and clicks the
//      "Supprimer" action on an account row (ConfirmModal-guarded).
//   2. The desktop calls this Edge Function with the target's user_profiles.id
//      (functions.invoke — the caller's JWT rides along automatically).
//   3. This EF authenticates the caller and requires the super_admin role
//      (same gate as create-user-account — deliberately narrower than the
//      approvals workflow, whose assign_role surface is the registered
//      SEC-107 escalation).
//   4. Guard rails:
//        a. the target profile must exist AND belong to the caller's tenant;
//        b. an admin can never delete their OWN account (ctx.userProfileId);
//        c. the OWNER-PINNED admin credential (admin@elimtiyaz.dz,
//           docs/operations/credentials.md §1) is untouchable — the OPS-310
//           lesson generalized: the owner's identity belongs to the owner,
//           and deleting it would lock the owner out of their own system
//           with no recovery path short of the dashboard.
//   5. Cleanup, in dependency-safe order (each step's failure leaves the
//      SAFEST recoverable state — see the ordering rationale inline):
//        a. unbind parents.auth_user_id / students.auth_user_id (plain
//           columns, NO FK — must be cleared manually before the identity
//           goes away, otherwise the rows point at a dead auth user and the
//           re-bind path (approve_account_request) would silently keep a
//           stale binding);
//        b. expire any pending account_approval_requests for the auth user
//           (the CHECK domain allows 'expired'; a stale 'pending' row would
//           linger in the Inscriptions queue forever);
//        c. DELETE the user_profiles row — role_assignments cascade
//           (ON DELETE CASCADE, migration 0002) and the personnel binding
//           self-clears (personnel.user_id → user_profiles ON DELETE SET
//           NULL, migration 0009);
//        d. DELETE the auth.users row via auth.admin.deleteUser (hard
//           delete). Done LAST on purpose: if THIS step fails after the
//           profile is gone, the leftover auth user is inert (no profile →
//           extractAuthContext fails → no sign-in) and re-creating the
//           account with the same email surfaces a clean 422 instead of
//           tripping the (tenant_id, email) unique index the other ordering
//           (auth first, profile second) would corrupt.
//   6. Audit log entry user_account.delete (the email, the role held, the
//      unbound personnel linkage and the cleared parent bindings are part
//      of the record — never a password, there is none to record).
//
// SECURITY (lessons applied):
//   - SEC-107: super_admin ONLY. A lower role must never be able to remove
//     accounts (privilege DoS).
//   - OPS-310: the owner-pinned admin is explicitly protected by email.
//   - SEC-100: no credential material in the audit payload.
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { createServiceRoleClient, extractAuthContext, requireRole, withAuditSurfacing, writeAuditLog } from "../_shared/supabase.ts";

interface DeleteUserAccountBody {
  /** user_profiles.id of the account to remove (the AccountsTab row key). */
  profile_id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The OWNER-PINNED admin identity — protected from deletion (OPS-310 class). */
const OWNER_PINNED_ADMIN_EMAIL = "admin@elimtiyaz.dz";

Deno.serve(withAuditSurfacing(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // 1. Authentication — caller must be signed in.
  const ctx = await extractAuthContext(req);
  if (!ctx) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }

  // 2. Authorization — super_admin ONLY (the create gate, mirrored).
  if (!requireRole(ctx, "super_admin")) {
    return jsonError(
      req,
      403,
      "forbidden",
      "Only super_admin can delete user accounts",
    );
  }

  if (!ctx.tenantId) {
    return jsonError(
      req,
      500,
      "no_tenant",
      "Caller profile has no tenant — cannot delete accounts",
    );
  }

  // 3. Parse + validate the body.
  let body: DeleteUserAccountBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  const profileId = (body.profile_id ?? "").trim();
  if (!UUID_RE.test(profileId)) {
    return jsonError(req, 400, "invalid_profile_id", "profile_id must be a UUID");
  }

  const supabase = createServiceRoleClient();

  // 4. Resolve the target profile — must exist AND belong to the caller's
  //    tenant (cross-tenant deletion is structurally impossible).
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("id, email, display_name, status, auth_user_id, tenant_id")
    .eq("id", profileId)
    .maybeSingle();

  if (profileError) {
    console.error("[delete-user-account] profile lookup failed:", profileError);
    return jsonError(req, 500, "profile_lookup_failed", "Failed to look up the target profile", profileError.message);
  }
  if (!profile) {
    return jsonError(req, 404, "profile_not_found", "Compte introuvable (déjà supprimé ou inexistant)");
  }
  if (profile.tenant_id !== ctx.tenantId) {
    // 404, not 403 — do not leak the existence of other tenants' accounts.
    return jsonError(req, 404, "profile_not_found", "Compte introuvable (déjà supprimé ou inexistant)");
  }

  // 5a. Never yourself.
  if (profile.id === ctx.userProfileId) {
    return jsonError(
      req,
      409,
      "cannot_delete_self",
      "Un administrateur ne peut pas supprimer son propre compte",
    );
  }

  // 5b. Never the owner-pinned admin (OPS-310 generalized).
  if (profile.email.toLowerCase() === OWNER_PINNED_ADMIN_EMAIL) {
    return jsonError(
      req,
      403,
      "owner_account_protected",
      "Le compte administrateur propriétaire ne peut pas être supprimé (identité propriétaire — docs/operations/credentials.md §1)",
    );
  }

  // 6. Capture the account's role + personnel linkage for the audit record
  //    BEFORE the rows go away.
  const { data: roleAssignment } = await supabase
    .from("role_assignments")
    .select("role_id")
    .eq("user_profile_id", profile.id)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  let heldRoleCode: string | null = null;
  if (roleAssignment) {
    const { data: roleRow } = await supabase
      .from("roles")
      .select("code")
      .eq("id", roleAssignment.role_id)
      .maybeSingle();
    heldRoleCode = roleRow?.code ?? null;
  }
  const { data: boundPersonnel } = await supabase
    .from("personnel")
    .select("id, personnel_code, first_name, last_name")
    .eq("user_id", profile.id)
    .is("deleted_at", null)
    .maybeSingle();

  const authUserId = profile.auth_user_id as string;

  // 7a. Unbind parents / students that point at this auth identity (plain
  //     columns, no FK — the manual leg the cascades cannot cover).
  const { error: parentUnbindError } = await supabase
    .from("parents")
    .update({ auth_user_id: null })
    .eq("auth_user_id", authUserId);
  if (parentUnbindError) {
    console.error("[delete-user-account] parent unbind failed:", parentUnbindError);
    return jsonError(req, 500, "unbind_failed", "Échec du détachement des parents liés", parentUnbindError.message);
  }
  const { error: studentUnbindError } = await supabase
    .from("students")
    .update({ auth_user_id: null })
    .eq("auth_user_id", authUserId);
  if (studentUnbindError) {
    console.error("[delete-user-account] student unbind failed:", studentUnbindError);
    return jsonError(req, 500, "unbind_failed", "Échec du détachement des élèves liés", studentUnbindError.message);
  }

  // 7b. Expire pending approval requests for this auth user (a stale
  //     'pending' row would linger in the Inscriptions queue forever).
  await supabase
    .from("account_approval_requests")
    .update({ status: "expired", reviewed_at: new Date().toISOString() })
    .eq("auth_user_id", authUserId)
    .eq("status", "pending");

  // 7c. Delete the profile row — role_assignments cascade (0002), the
  //     personnel binding self-clears (0009 ON DELETE SET NULL).
  const { error: profileDeleteError } = await supabase
    .from("user_profiles")
    .delete()
    .eq("id", profile.id);
  if (profileDeleteError) {
    console.error("[delete-user-account] profile delete failed:", profileDeleteError);
    return jsonError(req, 500, "profile_delete_failed", "Échec de la suppression du profil", profileDeleteError.message);
  }

  // 7d. Delete the auth identity LAST (the ordering rationale in the
  //     header comment): a failure here leaves an inert auth user, never
  //     a unique-index-corrupting orphan profile.
  const { error: authDeleteError } = await supabase.auth.admin.deleteUser(
    authUserId,
    false, // hard delete — shouldSoftDelete: false
  );
  if (authDeleteError) {
    console.error("[delete-user-account] auth delete failed:", authDeleteError);
    return jsonError(
      req,
      500,
      "auth_delete_failed",
      "Profil supprimé mais l'identité d'authentification n'a pas pu être retirée — le compte est inerte (connexion impossible). Réessayez ou retirez l'utilisateur depuis le dashboard.",
      authDeleteError.message,
    );
  }

  // 8. Audit trail (plan §12.01) — the removal is a security-relevant event.
  await writeAuditLog(
    ctx.tenantId,
    "user_account.delete",
    "user_profile",
    profile.id,
    ctx.userProfileId,
    ctx.email,
    {
      email: profile.email,
      display_name: profile.display_name,
      status: profile.status,
      role: heldRoleCode,
      personnel: boundPersonnel
        ? {
            id: boundPersonnel.id,
            personnel_code: boundPersonnel.personnel_code,
            name: `${boundPersonnel.first_name} ${boundPersonnel.last_name}`.trim(),
          }
        : null,
    },
    null,
    `Admin ${ctx.email} removed the account for ${profile.email}` +
      (boundPersonnel ? ` (employee ${boundPersonnel.personnel_code} unbound)` : ""),
    requestId,
  );

  // 9. Success.
  return jsonOk(req, {
    profile_id: profile.id,
    email: profile.email,
    role: heldRoleCode,
    message: `Account ${profile.email} removed — profile, role assignments and the auth identity are gone; linked employees/parents were unbound.`,
  });
}));
