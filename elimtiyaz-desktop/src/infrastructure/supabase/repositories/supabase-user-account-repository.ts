/**
 * SupabaseUserAccountRepository — admin account provisioning via the
 * `create-user-account` Edge Function (T-079).
 *
 * Why an Edge Function and NOT direct table writes from the client:
 * creating a login account means inserting into `auth.users`, which is
 * ONLY possible through the Admin API (service role) — a key that must
 * never ship in the desktop client (plan §12.05). The EF runs
 * server-side, authenticates the caller (super_admin ONLY — deliberately
 * narrower than approve-signup-request, whose assign_role surface is the
 * registered SEC-107 escalation), calls auth.admin.createUser, then the
 * admin_create_user_account RPC (migration 0044) which atomically
 * activates the trigger-created profile, assigns the chosen role and
 * resolves the auto-created approval request.
 *
 * This repository performs the same client-side validation as the EF
 * (fast feedback, avoids a needless round-trip) and maps the EF's JSON
 * envelope ({ data } | { error: { code, message } }) to Result<AppError>.
 *
 * T-381 — deleteAccount goes through the delete-user-account Edge Function
 * (the create mirror; same super_admin gate, same envelope mapping).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountOverviewEntry,
  CreateAccountInput,
  CreatedAccount,
  UserAccountRepository,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { Role } from "../../../core/rbac/roles";
import { supabaseErrorToAppError } from "../supabase-client";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** All wire roles accepted by the EF (the 11-role matrix, §02.07 + §09). */
const VALID_ROLES: ReadonlySet<string> = new Set(Object.values(Role));

/** Plan §12.04 policy — same rules as changePassword (both repositories). */
function meetsPasswordPolicy(pw: string): boolean {
  return pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw);
}

/** Wire body of the create-user-account Edge Function. */
interface CreateUserAccountBody {
  email: string;
  full_name?: string;
  phone?: string;
  role: string;
  password?: string;
  /** T-371 — the personnel row to bind (uuid). */
  personnel_id?: string;
}

/** Success payload returned by the EF (envelope `data` field). */
interface CreateUserAccountResponse {
  auth_user_id: string;
  user_profile_id: string;
  email: string;
  role: string;
  initial_password: string;
  /** T-371 — present when an employee was bound. */
  personnel_id?: string;
  personnel_code?: string;
  personnel_name?: string;
}

export class SupabaseUserAccountRepository implements UserAccountRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createAccount(input: CreateAccountInput): Promise<Result<CreatedAccount>> {
    // Client-side pre-validation — mirrors the EF so the user gets instant
    // feedback and we skip pointless network round-trips.
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return Err(Errors.validation("Adresse email invalide"));
    }
    if (!VALID_ROLES.has(input.role)) {
      return Err(Errors.validation(`Rôle inconnu : ${String(input.role)}`));
    }
    if (
      input.initialPassword !== undefined &&
      input.initialPassword.length > 0 &&
      !meetsPasswordPolicy(input.initialPassword)
    ) {
      return Err(
        Errors.validation(
          "Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre",
        ),
      );
    }

    const body: CreateUserAccountBody = {
      email,
      role: input.role,
    };
    if (input.fullName && input.fullName.trim().length > 0) {
      body.full_name = input.fullName.trim();
    }
    if (input.phone && input.phone.trim().length > 0) {
      body.phone = input.phone.trim();
    }
    // Omit the password key entirely when unset — the EF generates one.
    if (input.initialPassword && input.initialPassword.length > 0) {
      body.password = input.initialPassword;
    }
    // T-371 — the employee to bind. Omitted entirely when unset so the
    // pre-0097 EF deployments (no personnel_id in the body contract) keep
    // accepting the payload during the migration window.
    if (input.personnelId && input.personnelId.trim().length > 0) {
      body.personnel_id = input.personnelId.trim();
    }

    const { data, error } = await this.client.functions.invoke(
      "create-user-account",
      { body },
    );

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    if (data?.error) {
      // EF-level rejection (duplicate email, forbidden, personnel not
      // found / already linked, …).
      return Err(Errors.server(data.error.message ?? "Création du compte échouée"));
    }
    if (!data?.data) {
      return Err(Errors.server("Réponse invalide du serveur (création de compte)"));
    }

    const payload = data.data as CreateUserAccountResponse;
    return Ok({
      email: payload.email,
      // The EF validates the role code against public.roles; unknown codes
      // never reach a successful response, so mapRoleCode is unnecessary
      // here — echo the requested role.
      role: input.role,
      initialPassword: payload.initial_password,
      // T-371 — echo the association for the confirmation panel.
      personnelCode: payload.personnel_code ?? null,
      personnelName: payload.personnel_name ?? null,
    });
  }

  /**
   * T-371 — the accounts overview. Four RLS-permitted reads joined
   * client-side (PostgREST embed chains across two FK hops are brittle;
   * explicit selects keep the mapping local and debuggable):
   *   user_profiles (own-tenant, super_admin-readable per 0019)
   *   role_assignments (super_admin-readable per 0019)
   *   roles (reference table)
   *   personnel (super_admin-readable per 0019 personnel_select)
   */
  async listAccounts(): Promise<Result<AccountOverviewEntry[]>> {
    const [profilesRes, assignmentsRes, rolesRes, personnelRes] =
      await Promise.all([
        this.client.from("user_profiles").select("id, email, display_name, status").order("email"),
        this.client.from("role_assignments").select("user_profile_id, role_id, revoked_at"),
        this.client.from("roles").select("id, code"),
        this.client.from("personnel").select("id, user_id, personnel_code, first_name, last_name").is("deleted_at", null),
      ]);

    const failure = profilesRes.error ?? assignmentsRes.error ?? rolesRes.error ?? personnelRes.error;
    if (failure) {
      return Err(supabaseErrorToAppError(failure));
    }

    const roleIdToCode = new Map<string, string>(
      ((rolesRes.data ?? []) as Array<{ id: string; code: string }>).map((r) => [r.id, r.code]),
    );
    const profileIdToRole = new Map<string, Role>();
    for (const ra of (assignmentsRes.data ?? []) as Array<{
      user_profile_id: string;
      role_id: string;
      revoked_at: string | null;
    }>) {
      if (ra.revoked_at !== null) continue;
      const code = roleIdToCode.get(ra.role_id);
      if (code && !profileIdToRole.has(ra.user_profile_id)) {
        profileIdToRole.set(ra.user_profile_id, mapWireRoleCode(code));
      }
    }
    const profileIdToPersonnel = new Map<string, {
      id: string;
      personnel_code: string;
      name: string;
    }>();
    for (const p of (personnelRes.data ?? []) as Array<{
      id: string;
      user_id: string | null;
      personnel_code: string;
      first_name: string;
      last_name: string;
    }>) {
      if (p.user_id && !profileIdToPersonnel.has(p.user_id)) {
        profileIdToPersonnel.set(p.user_id, {
          id: p.id,
          personnel_code: p.personnel_code,
          name: `${p.first_name} ${p.last_name}`.trim(),
        });
      }
    }

    const entries: AccountOverviewEntry[] = (
      profilesRes.data ?? [] as Array<{
        id: string;
        email: string;
        display_name: string | null;
        status: string;
      }>
    ).map((row) => {
      const bound = profileIdToPersonnel.get(row.id) ?? null;
      return {
        profileId: row.id,
        email: row.email,
        displayName: row.display_name,
        status: row.status,
        role: profileIdToRole.get(row.id) ?? null,
        personnelId: bound?.id ?? null,
        personnelCode: bound?.personnel_code ?? null,
        personnelName: bound?.name ?? null,
      };
    });
    return Ok(entries);
  }

  /**
   * T-381 — remove a login account through the delete-user-account Edge
   * Function (the create mirror): profile + role assignments + auth
   * identity, with linked employees/parents unbound server-side. The EF
   * refuses the caller's own account and the owner-pinned admin; those
   * rejections surface here as validation/conflict errors from the
   * EF's JSON envelope.
   */
  async deleteAccount(profileId: string): Promise<Result<void>> {
    const id = profileId.trim();
    if (id.length === 0) {
      return Err(Errors.validation("Identifiant de compte manquant"));
    }

    const { data, error } = await this.client.functions.invoke(
      "delete-user-account",
      { body: { profile_id: id } },
    );

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    if (data?.error) {
      // EF-level rejection (self-deletion, owner-pinned admin protection,
      // not found, …).
      return Err(Errors.server(data.error.message ?? "Suppression du compte échouée"));
    }
    return Ok(undefined);
  }
}

/** Wire role code → Role (mirrors the auth repository's mapRoleCode). */
function mapWireRoleCode(code: string): Role {
  const mapping: Record<string, Role> = {
    super_admin: Role.SuperAdmin,
    financial_officer: Role.FinancialOfficer,
    teacher: Role.Teacher,
    support_staff: Role.SupportStaff,
    manager: Role.Manager,
    buyer: Role.Buyer,
    driver: Role.Driver,
    warehouse_worker: Role.WarehouseWorker,
    worker: Role.Worker,
    parent: Role.Parent,
    student: Role.Student,
  };
  return mapping[code] ?? Role.SupportStaff;
}
