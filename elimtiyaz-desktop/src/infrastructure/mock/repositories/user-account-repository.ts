/**
 * MockUserAccountRepository — in-memory admin account provisioning (T-079).
 *
 * Mirrors the create-user-account Edge Function contract for dev/demo mode:
 *   - validates email + plan §12.04 password policy (same rules as
 *     changePassword — deliberately duplicated across implementations, the
 *     established pattern in this layer),
 *   - rejects duplicate emails (account squatting),
 *   - generates a policy-compliant password when none is provided,
 *   - mints the account into the SHARED seedAccounts array so the new user
 *     can immediately sign in through MockAuthRepository (mock semantics
 *     after T-001: known email + non-empty password),
 *   - appends a `user_account.create` audit entry WITHOUT the password.
 *
 * Unlike the Supabase layer there is no role-escalation concern here — the
 * mock layer is a dev/demo fallback that is bypassed entirely when Supabase
 * is configured (see repository-provider.tsx).
 */
import type {
  CreateAccountInput,
  CreatedAccount,
  UserAccountRepository,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { Role } from "../../../core/rbac/roles";
import { delay } from "./mock-store";
import {
  seedAccounts,
  TENANT_ID,
  AuditActions,
  appendAudit,
} from "./mock-store";

/** All wire roles accepted by createAccount (the 11-role matrix, §02.07 + §09). */
const VALID_ROLES: ReadonlySet<string> = new Set(Object.values(Role));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Plan §12.04 policy — identical rules to changePassword in both repos. */
function meetsPasswordPolicy(pw: string): boolean {
  return (
    pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)
  );
}

/**
 * Generates a 12-char password guaranteed to satisfy the §12.04 policy.
 * Mirrors the generator inside the create-user-account Edge Function (the
 * EF runs on Deno and cannot import from src/ — accepted duplication).
 */
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
  // Guarantee one of each class, then fill the rest, then shuffle.
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

/** Mints sequential mock user ids (usr-gen-001, …) distinct from the seeds. */
function nextMockUserId(): string {
  const count =
    seedAccounts.filter((a) => a.userId.startsWith("usr-gen-")).length + 1;
  return `usr-gen-${String(count).padStart(3, "0")}`;
}

export class MockUserAccountRepository implements UserAccountRepository {
  async createAccount(input: CreateAccountInput): Promise<Result<CreatedAccount>> {
    await delay(200);

    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return Err(Errors.validation("Adresse email invalide"));
    }
    if (!VALID_ROLES.has(input.role)) {
      return Err(Errors.validation(`Rôle inconnu : ${String(input.role)}`));
    }
    if (
      seedAccounts.some(
        (a) => a.email.toLowerCase() === email,
      )
    ) {
      return Err(
        Errors.conflict(`Un compte existe déjà pour ${email}`),
      );
    }

    const initialPassword =
      input.initialPassword && input.initialPassword.length > 0
        ? input.initialPassword
        : generatePassword();
    if (!meetsPasswordPolicy(initialPassword)) {
      return Err(
        Errors.validation(
          "Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre",
        ),
      );
    }

    const userId = nextMockUserId();
    // Mint into the SHARED seedAccounts — MockAuthRepository.signIn reads
    // this array, so the created user can sign in immediately (the whole
    // point of T-079).
    seedAccounts.push({
      email,
      userId,
      displayName: input.fullName?.trim() || email,
      role: input.role,
      // Mock sign-in semantics (T-001) check only email + non-empty
      // password, so no secret is stored here.
    });

    appendAudit({
      action: AuditActions.UserAccountCreate,
      entityType: "user_account",
      entityId: email,
      actorId: "admin",
      actorName: "Administrateur (mock)",
      diff: {
        before: null,
        // NEVER include the initial password (SEC-100).
        after: { email, role: input.role, displayName: input.fullName ?? null },
      },
      note: `Compte créé par l'administrateur (${TENANT_ID})`,
    });

    return Ok({
      email,
      role: input.role,
      initialPassword,
    });
  }
}

/** Singleton instance — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockUserAccountRepository: UserAccountRepository =
  new MockUserAccountRepository();
