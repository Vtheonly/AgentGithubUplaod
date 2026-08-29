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
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
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
}

/** Success payload returned by the EF (envelope `data` field). */
interface CreateUserAccountResponse {
  auth_user_id: string;
  user_profile_id: string;
  email: string;
  role: string;
  initial_password: string;
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

    const { data, error } = await this.client.functions.invoke(
      "create-user-account",
      { body },
    );

    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    if (data?.error) {
      // EF-level rejection (duplicate email, forbidden, …).
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
    });
  }
}
