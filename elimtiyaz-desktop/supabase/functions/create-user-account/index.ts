// ============================================================================
// create-user-account/index.ts
// ============================================================================
// Edge Function: Admin-Created Login Accounts (T-079)
// ----------------------------------------------------------------------------
// Owner request: "Implement the functionality in the desktop app that allows
// an admin to create accounts for other users so they can log in with their
// own accounts."
//
// FLOW:
//   1. SuperAdmin opens the desktop Settings → Comptes tab, fills the create
//      account form (email, name, phone, role, optional initial password).
//   2. The desktop calls this Edge Function (functions.invoke — the caller's
//      JWT rides along automatically).
//   3. This EF authenticates the caller and requires the super_admin role.
//   4. auth.admin.createUser() creates the auth.users row:
//        - email_confirm: true  → the user can sign in immediately
//        - app_metadata.tenant_id → the TRUSTED admin path SEC-108 expects
//          (unlike self-signup user_metadata, app_metadata set here is
//          server-controlled)
//        - user_metadata.requested_role ∈ {parent, student, staff} — the
//          account_approval_requests CHECK constraint only allows these
//          three; the SPECIFIC role (e.g. financial_officer) is passed to
//          the RPC below, not to the trigger.
//   5. The handle_new_auth_user() trigger (migration 0002) mints
//      user_profiles(status='pending') + account_approval_requests(pending).
//   6. The admin_create_user_account RPC (migration 0044) atomically
//      activates the profile, assigns the chosen role and resolves the
//      approval request. EXECUTE on that RPC is restricted to service_role
//      (this EF) — it cannot be called directly by clients.
//   7. Audit log entry user_account.create (WITHOUT the password).
//
// SECURITY (lessons applied):
//   - SEC-107: approve-signup-request lets support_staff assign ANY role
//     (escalation). THIS function is super_admin ONLY — requireRole with
//     "super_admin" resolves to exactly that role.
//   - SEC-100: no credential literals; the initial password is generated or
//     admin-supplied, returned ONCE in the response, never logged, never
//     emailed, never stored in the audit trail.
//   - The user changes the initial password at first sign-in (the desktop
//     changePassword path works since T-003).
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { createServiceRoleClient, extractAuthContext, requireRole, withAuditSurfacing, writeAuditLog } from "../_shared/supabase.ts";

interface CreateUserAccountBody {
  email: string;
  full_name?: string;
  phone?: string;
  /** One of the 11 wire role codes. */
  role: string;
  /** Optional initial password (plan §12.04 policy). Generated when absent. */
  password?: string;
  /**
   * T-371 (WORKFORCE-501) — the personnel row this account belongs to.
   * When set, the admin_create_user_account RPC binds personnel.user_id to
   * the new profile IN the creation transaction, so the employee's own
   * profile / tasks / responsibilities resolve from the very first sign-in.
   */
  personnel_id?: string;
}

/** The 11-role matrix (§02.07 + §09) — mirrors desktop core/rbac/roles.ts. */
const VALID_ROLES = new Set([
  "super_admin",
  "financial_officer",
  "teacher",
  "support_staff",
  "manager",
  "buyer",
  "driver",
  "warehouse_worker",
  "worker",
  "parent",
  "student",
]);

/** Map a wire role to the account_approval_requests.requested_role domain. */
function toRequestedRole(role: string): "parent" | "student" | "staff" {
  if (role === "parent") return "parent";
  if (role === "student") return "student";
  return "staff";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The employee context echoed in the response + audit payload (T-371). */
interface PersonnelLink {
  id: string;
  personnel_code: string;
  first_name: string;
  last_name: string;
  position: string | null;
  is_active: boolean;
  deleted_at: string | null;
  user_id: string | null;
}

function meetsPasswordPolicy(pw: string): boolean {
  return pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw);
}

/** 12-char policy-compliant password (mirrors the desktop mock generator). */
function generatePassword(): string {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;
  const pick = (alphabet: string): string => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return alphabet[buf[0] % alphabet.length];
  };
  const chars = [
    pick(lower),
    pick(upper),
    pick(digits),
    ...Array.from({ length: 9 }, () => pick(all)),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

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

  // 2. Authorization — super_admin ONLY (SEC-107 lesson: a lower role must
  //    never be able to mint accounts with privileged roles).
  if (!requireRole(ctx, "super_admin")) {
    return jsonError(
      req,
      403,
      "forbidden",
      "Only super_admin can create user accounts",
    );
  }

  if (!ctx.tenantId) {
    return jsonError(
      req,
      500,
      "no_tenant",
      "Caller profile has no tenant — cannot create accounts",
    );
  }

  // 3. Parse + validate the body.
  let body: CreateUserAccountBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return jsonError(req, 400, "invalid_email", "A valid email address is required");
  }
  if (!body.role || !VALID_ROLES.has(body.role)) {
    return jsonError(req, 400, "invalid_role", `Unknown role code: ${body.role}`);
  }

  const password = body.password && body.password.length > 0
    ? body.password
    : generatePassword();
  if (!meetsPasswordPolicy(password)) {
    return jsonError(
      req,
      400,
      "weak_password",
      "Password must be at least 8 characters with lowercase, uppercase and digit",
    );
  }

  const supabase = createServiceRoleClient();

  // 4. Duplicate check — user_profiles mirrors every auth.users row via the
  //    0002 trigger. (auth.admin.createUser would also reject a duplicate
  //    email with 422; this check gives a cleaner 409 first.)
  const { data: existing } = await supabase
    .from("user_profiles")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return jsonError(
      req,
      409,
      "email_taken",
      `Un compte existe déjà pour ${email}`,
    );
  }

  // 4b. T-371 — resolve + validate the employee to bind (when the admin
  //     selected one). Pre-checked here for clean 4xx codes; the RPC
  //     re-checks under FOR UPDATE as the authoritative guard.
  let personnel: PersonnelLink | null = null;
  if (body.personnel_id !== undefined && body.personnel_id !== null && body.personnel_id !== "") {
    if (!UUID_RE.test(body.personnel_id)) {
      return jsonError(
        req,
        400,
        "invalid_personnel_id",
        "personnel_id must be a UUID",
      );
    }
    const { data: row, error: personnelError } = await supabase
      .from("personnel")
      .select("id, personnel_code, first_name, last_name, position, is_active, deleted_at, user_id")
      .eq("id", body.personnel_id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (personnelError) {
      console.error("[create-user-account] personnel lookup failed:", personnelError);
      return jsonError(req, 500, "personnel_lookup_failed", "Failed to look up the employee record", personnelError.message);
    }
    if (!row || row.deleted_at) {
      return jsonError(
        req,
        404,
        "personnel_not_found",
        "Fiche employé introuvable (supprimée ou hors du tenant)",
      );
    }
    if (row.user_id) {
      return jsonError(
        req,
        409,
        "personnel_already_linked",
        `Cet employé est déjà lié à un autre compte (${row.personnel_code})`,
      );
    }
    personnel = row;
  }

  // 5. Create the auth user. email_confirm=true so login works without an
  //    email round-trip; app_metadata.tenant_id is the trusted admin path
  //    (SEC-108). requested_role stays within the trigger's CHECK domain.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: body.full_name?.trim() || email,
      phone: body.phone?.trim() || null,
      requested_role: toRequestedRole(body.role),
    },
    app_metadata: {
      tenant_id: ctx.tenantId,
      created_by_admin: true,
    },
  });

  if (createError || !created?.user) {
    // Supabase returns 422 when the email is already registered.
    const msg = createError?.message ?? "Unknown error";
    if (msg.toLowerCase().includes("already") || msg.includes("422")) {
      return jsonError(req, 409, "email_taken", `Un compte existe déjà pour ${email}`);
    }
    console.error("[create-user-account] createUser failed:", createError);
    return jsonError(req, 500, "create_failed", "Failed to create the auth user", msg);
  }

  const authUserId = created.user.id;

  // 6. Activate + assign the chosen role + resolve the auto-created
  //    approval request (+ bind the selected employee, T-371) — one atomic
  //    RPC (migrations 0044 + 0097).
  const { data: profileId, error: rpcError } = await supabase.rpc(
    "admin_create_user_account",
    {
      p_auth_user_id: authUserId,
      p_role_code: body.role,
      p_tenant_id: ctx.tenantId,
      p_reviewer_profile_id: ctx.userProfileId,
      p_decision_note: `Compte créé par ${ctx.email}`,
      p_personnel_id: personnel?.id ?? null,
      p_email: email,
    },
  );

  if (rpcError || !profileId) {
    // The auth user exists but stayed 'pending' (sign-in blocked by the
    // pending check in SupabaseAuthRepository + extractAuthContext). The
    // Inscriptions queue shows the request — an admin can finish it there.
    console.error("[create-user-account] activation RPC failed:", rpcError);
    return jsonError(
      req,
      500,
      "activation_failed",
      "Auth user created but activation failed — the request is queued in the registrations queue",
      rpcError?.message ?? null,
    );
  }

  // 7. Audit trail (plan §12.01) — NEVER the password (SEC-100 lesson).
  //    T-371: the linked employee is part of the record.
  await writeAuditLog(
    ctx.tenantId,
    "user_account.create",
    "user_profile",
    profileId,
    ctx.userProfileId,
    ctx.email,
    null,
    {
      email,
      role: body.role,
      display_name: body.full_name?.trim() || email,
      created_via: "admin",
      password_generated: !(body.password && body.password.length > 0),
      ...(personnel
        ? {
            personnel_id: personnel.id,
            personnel_code: personnel.personnel_code,
            personnel_name: `${personnel.first_name} ${personnel.last_name}`.trim(),
          }
        : {}),
    },
    `Admin ${ctx.email} created account for ${email} (${body.role})` +
      (personnel ? ` linked to ${personnel.personnel_code}` : ""),
    requestId,
  );

  // 8. Success — the initial password is returned ONCE. The admin conveys
  //    it out-of-band; the user changes it at first sign-in (T-003).
  //    T-371: the bound employee echoes so the confirmation panel can show
  //    the association the admin just created.
  return jsonOk(req, {
    auth_user_id: authUserId,
    user_profile_id: profileId,
    email,
    role: body.role,
    initial_password: password,
    ...(personnel
      ? {
          personnel_id: personnel.id,
          personnel_code: personnel.personnel_code,
          personnel_name: `${personnel.first_name} ${personnel.last_name}`.trim(),
        }
      : {}),
    message: `Account created for ${email} — the user can now sign in.` +
      (personnel ? ` Linked to employee ${personnel.personnel_code}.` : ""),
  });
}));
