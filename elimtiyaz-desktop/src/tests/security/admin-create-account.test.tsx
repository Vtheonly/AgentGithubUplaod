/**
 * Regression tests for T-079 — admin-created user accounts.
 *
 * Owner request (2026-08-29): "Implement the functionality in the desktop
 * app that allows an admin to create accounts for other users so they can
 * log in with their own accounts."
 *
 * The core end-to-end assertion (mirrors the request verbatim):
 *   after an admin calls createAccount(...), the NEW user can sign in
 *   with their own credentials and lands in their assigned role.
 *
 * Scope of this suite (what CAN run headlessly):
 *   1. MockUserAccountRepository — validation failures, account creation,
 *      audit trail, and the create → sign-in round-trip through the REAL
 *      MockAuthRepository + seedAccounts (no structural casts: the feature
 *      did not exist before, so the red state is the missing module).
 *   2. SupabaseUserAccountRepository — Edge Function payload mapping via a
 *      fake functions.invoke client (mirrors the change-password suite's
 *      fake-client pattern).
 *
 * Out of scope here (cannot run without a live backend / Deno):
 *   - the create-user-account Edge Function itself,
 *   - the admin_create_user_account SQL RPC (migration 0044).
 *   Both are covered by code review against the approve-signup-request
 *   pattern and are capped at IMPLEMENTED in the task registry.
 *
 * Security invariants asserted (design constraints of T-079):
 *   - the initial password is returned ONCE in the Ok payload and is never
 *     a static literal shipped in source (SEC-100 lesson),
 *   - a generated password satisfies the plan §12.04 policy shared with
 *     changePassword (≥8 chars, lower + upper + digit),
 *   - duplicate emails are rejected (account squatting / confusion).
 */
import { describe, it, expect, afterEach } from "vitest";

import { MockAuthRepository } from "../../infrastructure/mock/repositories/auth-repository";
import {
  MockUserAccountRepository,
  mockUserAccountRepository,
} from "../../infrastructure/mock/repositories/user-account-repository";
import { SupabaseUserAccountRepository } from "../../infrastructure/supabase/repositories/supabase-user-account-repository";
import { seedAccounts } from "../../infrastructure/mock/repositories/mock-store";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { AuditActions } from "../../core/audit-actions";
import { Role, ROLE_LABELS_FR } from "../../core/rbac/roles";
import { mockRepositories } from "../../app/providers/repository-provider";
import type { CreateAccountInput } from "../../domain/repository/repository";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Emails minted by these tests — removed from seedAccounts afterwards. */
const MINTED: string[] = [];

function makeInput(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `new-user-${suffix}@el-imtiyaz.test`;
  MINTED.push(email);
  return {
    email,
    fullName: "Nouveau Utilisateur",
    phone: "+213 555 000 111",
    role: Role.FinancialOfficer,
    initialPassword: "InitialPassw0rd",
    ...overrides,
  };
}

function cleanupMintedAccounts(): void {
  for (const email of MINTED) {
    const idx = seedAccounts.findIndex((a) => a.email === email);
    if (idx >= 0) seedAccounts.splice(idx, 1);
  }
  MINTED.length = 0;
}

/** Plan §12.04 password policy — same rules as changePassword. */
function meetsPolicy(pw: string): boolean {
  return pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw);
}

/* ------------------------------------------------------------------ */
/* 1. MockUserAccountRepository — validation                           */
/* ------------------------------------------------------------------ */

describe("T-079 MockUserAccountRepository — input validation", () => {
  afterEach(cleanupMintedAccounts);

  it("rejects an invalid email address", async () => {
    const repo = new MockUserAccountRepository();
    const result = await repo.createAccount(makeInput({ email: "not-an-email" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
  });

  it("rejects an empty email", async () => {
    const repo = new MockUserAccountRepository();
    const result = await repo.createAccount(makeInput({ email: "" }));
    expect(result.ok).toBe(false);
  });

  it("rejects an initial password that violates the §12.04 policy", async () => {
    const repo = new MockUserAccountRepository();
    // too short
    expect((await repo.createAccount(makeInput({ initialPassword: "Ab1" }))).ok).toBe(false);
    // no uppercase
    expect((await repo.createAccount(makeInput({ initialPassword: "alllower1" }))).ok).toBe(false);
    // no lowercase
    expect((await repo.createAccount(makeInput({ initialPassword: "ALLUPPER1" }))).ok).toBe(false);
    // no digit
    expect((await repo.createAccount(makeInput({ initialPassword: "NoDigitsHere" }))).ok).toBe(false);
  });

  it("rejects a duplicate email (already in seedAccounts)", async () => {
    const repo = new MockUserAccountRepository();
    const existing = seedAccounts[0];
    const result = await repo.createAccount(
      makeInput({ email: existing.email, role: Role.Teacher }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // conflict — NOT a generic server error, so the UI can message it
      expect(["conflict", "validation"]).toContain(result.error.kind);
    }
  });

  it("rejects a duplicate email even after one was minted by this suite", async () => {
    const repo = new MockUserAccountRepository();
    const input = makeInput();
    const first = await repo.createAccount(input);
    expect(first.ok).toBe(true);
    const second = await repo.createAccount(
      makeInput({ email: input.email, role: Role.SupportStaff }),
    );
    expect(second.ok).toBe(false);
  });

  it("accepts every one of the 11 wire roles", async () => {
    const repo = new MockUserAccountRepository();
    for (const role of Object.values(Role)) {
      const result = await repo.createAccount(makeInput({ role }));
      expect(result.ok, `role ${role} should be accepted`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. MockUserAccountRepository — the create → sign-in round-trip      */
/*    (THE core regression: "so they can log in with their own         */
/*     accounts")                                                      */
/* ------------------------------------------------------------------ */

describe("T-079 MockUserAccountRepository — admin creates, user signs in", () => {
  afterEach(cleanupMintedAccounts);

  it("a created user can sign in with the admin-provided password and gets the assigned role", async () => {
    const adminRepo = new MockUserAccountRepository();
    const authRepo = new MockAuthRepository();
    const input = makeInput({ role: Role.FinancialOfficer, initialPassword: "TheirOwnPass1" });

    const created = await adminRepo.createAccount(input);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.email).toBe(input.email);
      expect(created.value.role).toBe(Role.FinancialOfficer);
      // The password is echoed back ONCE so the admin can hand it over.
      expect(created.value.initialPassword).toBe("TheirOwnPass1");
    }

    // The new user signs in with THEIR OWN account (mock semantics: email
    // must exist in seedAccounts + non-empty password, per T-001).
    const signIn = await authRepo.signIn(input.email, "TheirOwnPass1");
    expect(signIn.ok).toBe(true);
    if (signIn.ok) {
      expect(signIn.value.email).toBe(input.email);
      expect(signIn.value.role).toBe(Role.FinancialOfficer);
      expect(signIn.value.userId).not.toBe("");
    }

    // A wrong (empty) password still fails — mock semantics preserved.
    const bad = await authRepo.signIn(input.email, "");
    expect(bad.ok).toBe(false);
  });

  it("generates a policy-compliant password when none is provided, and that password works at sign-in", async () => {
    const adminRepo = new MockUserAccountRepository();
    const authRepo = new MockAuthRepository();
    const input = makeInput({ role: Role.Teacher, initialPassword: undefined });

    const created = await adminRepo.createAccount(input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const generated = created.value.initialPassword;
    expect(typeof generated).toBe("string");
    expect(generated.length).toBeGreaterThanOrEqual(12);
    expect(meetsPolicy(generated)).toBe(true);
    // Generated passwords must not repeat across two accounts.
    const other = await adminRepo.createAccount(makeInput({ initialPassword: undefined }));
    if (other.ok) expect(other.value.initialPassword).not.toBe(generated);

    // The generated credential actually signs the user in.
    const signIn = await authRepo.signIn(input.email, generated);
    expect(signIn.ok).toBe(true);
    if (signIn.ok) expect(signIn.value.role).toBe(Role.Teacher);
  });

  it("the created user appears in the accounts list with their display name", async () => {
    const adminRepo = new MockUserAccountRepository();
    const input = makeInput({ fullName: "Karima Test", role: Role.SupportStaff });
    const created = await adminRepo.createAccount(input);
    expect(created.ok).toBe(true);

    const account = seedAccounts.find((a) => a.email === input.email);
    expect(account).toBeDefined();
    expect(account?.displayName).toBe("Karima Test");
    expect(account?.role).toBe(Role.SupportStaff);
  });

  it("existing seeded sign-ins still work after a new account is minted", async () => {
    const adminRepo = new MockUserAccountRepository();
    const authRepo = new MockAuthRepository();
    await adminRepo.createAccount(makeInput());

    const admin = seedAccounts.find((a) => a.role === Role.SuperAdmin);
    expect(admin).toBeDefined();
    const signIn = await authRepo.signIn(admin!.email, "whatever-non-empty");
    expect(signIn.ok).toBe(true);
    if (signIn.ok) expect(signIn.value.role).toBe(Role.SuperAdmin);
  });
});

/* ------------------------------------------------------------------ */
/* 3. MockUserAccountRepository — audit trail                          */
/* ------------------------------------------------------------------ */

describe("T-079 MockUserAccountRepository — audit trail", () => {
  afterEach(cleanupMintedAccounts);

  it("appends a user_account.create audit entry with the new identity", async () => {
    const before = store.audit.length;
    const repo = new MockUserAccountRepository();
    const input = makeInput({ role: Role.Manager });
    const created = await repo.createAccount(input);
    expect(created.ok).toBe(true);

    // New entries are prepended (unshift) — check the head of the log.
    const entry = store.audit[0];
    expect(store.audit.length).toBeGreaterThan(before);
    expect(entry.action).toBe(AuditActions.UserAccountCreate);
    expect(entry.entityType).toBe("user_account");
    if (created.ok) {
      expect(entry.entityId).toBe(created.value.email);
    }
    expect(String(entry.diff?.after)).toContain(input.email);
    expect(String(entry.diff?.after)).toContain(Role.Manager);
    // The audit entry must NOT embed the initial password (SEC-100 lesson).
    expect(String(entry.diff?.after)).not.toContain(
      created.ok ? created.value.initialPassword : "__no_password__",
    );
  });

  it("writes NO audit entry when validation fails", async () => {
    const before = store.audit.length;
    const repo = new MockUserAccountRepository();
    await repo.createAccount(makeInput({ email: "bad" }));
    await repo.createAccount(makeInput({ initialPassword: "weak" }));
    expect(store.audit.length).toBe(before);
  });
});

/* ------------------------------------------------------------------ */
/* 4. SupabaseUserAccountRepository — EF payload mapping               */
/* ------------------------------------------------------------------ */

/** Minimal fake of the SupabaseClient surface used by the repository. */
function makeFakeSupabaseClient(options: {
  responseBody?: unknown;
  httpError?: { message: string; code?: string };
} = {}) {
  const calls: Array<{ name: string; body: unknown }> = [];
  const client = {
    functions: {
      invoke: async (name: string, { body }: { body: unknown }) => {
        calls.push({ name, body });
        if (options.httpError) {
          return { data: null, error: options.httpError };
        }
        return { data: options.responseBody, error: null };
      },
    },
  };
  return { client: client as never, calls };
}

describe("T-079 SupabaseUserAccountRepository — Edge Function mapping", () => {
  it("invokes create-user-account with the wire payload", async () => {
    const { client, calls } = makeFakeSupabaseClient({
      responseBody: {
        data: { auth_user_id: "au-1", user_profile_id: "up-1", email: "x@y.dz", role: "teacher", initial_password: "GenPassw0rd1" },
      },
    });
    const repo = new SupabaseUserAccountRepository(client);
    const result = await repo.createAccount({
      email: "nouveau@elimtiyaz.dz",
      fullName: "Nouveau Test",
      phone: "+213 555 000 111",
      role: Role.Teacher,
      initialPassword: "InitialPassw0rd",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("create-user-account");
    expect(calls[0].body).toEqual({
      email: "nouveau@elimtiyaz.dz",
      full_name: "Nouveau Test",
      phone: "+213 555 000 111",
      role: "teacher",
      password: "InitialPassw0rd",
    });
    if (result.ok) {
      expect(result.value.email).toBe("x@y.dz");
      expect(result.value.role).toBe(Role.Teacher);
      expect(result.value.initialPassword).toBe("GenPassw0rd1");
    }
  });

  it("omits the password key when none is provided (server generates)", async () => {
    const { client, calls } = makeFakeSupabaseClient({
      responseBody: { data: { email: "a@b.dz", role: "support_staff", initial_password: "Generated1Aa" } },
    });
    const repo = new SupabaseUserAccountRepository(client);
    await repo.createAccount({
      email: "auto@elimtiyaz.dz",
      role: Role.SupportStaff,
      initialPassword: undefined,
    });
    expect(calls[0].body).not.toHaveProperty("password");
  });

  it("rejects invalid input BEFORE invoking the Edge Function", async () => {
    const { client, calls } = makeFakeSupabaseClient();
    const repo = new SupabaseUserAccountRepository(client);
    const bad = await repo.createAccount({ email: "nope", role: Role.Teacher });
    expect(bad.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("maps the EF error envelope to an Err with the server message", async () => {
    const { client } = makeFakeSupabaseClient({
      responseBody: { error: { code: "email_taken", message: "Un compte existe déjà pour cet email." } },
    });
    const repo = new SupabaseUserAccountRepository(client);
    const input: CreateAccountInput = {
      email: "taken@elimtiyaz.dz",
      role: Role.Driver,
    };
    const result = await repo.createAccount(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("déjà");
    }
  });

  it("maps a transport/HTTP error to an Err", async () => {
    const { client } = makeFakeSupabaseClient({
      httpError: { message: "Function returned 403", code: "403" },
    });
    const repo = new SupabaseUserAccountRepository(client);
    const result = await repo.createAccount({
      email: "anyone@elimtiyaz.dz",
      role: Role.Worker,
    });
    expect(result.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Wiring — the repository must be reachable from both assemblies   */
/* ------------------------------------------------------------------ */

describe("T-079 repository wiring", () => {
  it("mockRepositories exposes userAccounts as the MockUserAccountRepository singleton", () => {
    expect(mockRepositories.userAccounts).toBe(mockUserAccountRepository);
  });

  it("every wire role has a French label (UI select completeness)", () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_LABELS_FR[role], `missing FR label for ${role}`).toBeTruthy();
    }
  });
});
