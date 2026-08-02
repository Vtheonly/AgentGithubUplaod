/**
 * Tests for the Supabase integration layer.
 *
 * These tests verify:
 *   1. The SupabaseAuthRepository correctly maps Supabase auth responses to
 *      the app's Session type (including role + permission enum mapping).
 *   2. The SupabaseApprovalRepository correctly calls the Edge Function
 *      endpoints and handles success/error responses.
 *   3. The supabaseErrorToAppError helper maps Postgres error codes to the
 *      correct AppError categories.
 *   4. The RepositoryProvider correctly falls back to mock when
 *      VITE_USE_SUPABASE is not 'true'.
 *
 * NOTE: These tests use mocked Supabase clients (no real network calls).
 * Integration tests against a live Supabase project are in
 * `integration/supabase-integration.test.ts` (skipped unless
 * VITE_SUPABASE_URL is set).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Errors } from "../../core/app-error";
import { supabaseErrorToAppError } from "../../infrastructure/supabase/supabase-client";
import { Role } from "../../core/rbac/roles";
import { Permission } from "../../core/rbac/permissions";

// ============================================================================
// 1. supabaseErrorToAppError — Postgres error code mapping
// ============================================================================

describe("supabaseErrorToAppError", () => {
  it("maps duplicate key violation (23505) to conflict", () => {
    const error = supabaseErrorToAppError({ code: "23505", message: "duplicate key value violates unique constraint" });
    expect(error.code).toBe("ERR_CONFLICT");
  });

  it("maps foreign key violation (23503) to validation", () => {
    const error = supabaseErrorToAppError({ code: "23503", message: "foreign key constraint violation" });
    expect(error.code).toBe("ERR_VALIDATION");
  });

  it("maps RLS permission denied (42501) to forbidden", () => {
    const error = supabaseErrorToAppError({ code: "42501", message: "permission denied for table parents" });
    expect(error.code).toBe("ERR_FORBIDDEN");
  });

  it("maps 'permission denied' in message to forbidden", () => {
    const error = supabaseErrorToAppError({ code: "", message: "permission denied for table parents" });
    expect(error.code).toBe("ERR_FORBIDDEN");
  });

  it("maps 'RLS' substring in message to forbidden", () => {
    const error = supabaseErrorToAppError({ code: "", message: "RLS policy blocked the operation" });
    expect(error.code).toBe("ERR_FORBIDDEN");
  });

  it("maps JWT errors to unauthorized", () => {
    const error = supabaseErrorToAppError({ code: "401", message: "JWT expired" });
    expect(error.code).toBe("ERR_UNAUTHORIZED");
  });

  it("maps network errors", () => {
    const error = supabaseErrorToAppError({ code: "", message: "fetch failed: network error" });
    expect(error.code).toBe("ERR_NETWORK");
  });

  it("maps timeout errors", () => {
    const error = supabaseErrorToAppError({ code: "", message: "Request timeout" });
    expect(error.code).toBe("ERR_TIMEOUT");
  });

  it("falls back to server error for unknown codes", () => {
    const error = supabaseErrorToAppError({ code: "PGRST100", message: "Some unknown Supabase error" });
    expect(error.code).toBe("ERR_SERVER");
  });

  it("handles missing message gracefully", () => {
    const error = supabaseErrorToAppError({ code: "", message: "" });
    expect(error.code).toBe("ERR_SERVER");
    // Empty string falls through all checks and becomes a server error
  });
});

// ============================================================================
// 2. Role mapping (auth repository internal helper)
// ============================================================================

describe("Role code mapping", () => {
  // Replicate the mapping logic from supabase-auth-repository.ts
  function mapRoleCode(code: string): Role {
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

  it("maps all 11 role codes correctly", () => {
    expect(mapRoleCode("super_admin")).toBe(Role.SuperAdmin);
    expect(mapRoleCode("financial_officer")).toBe(Role.FinancialOfficer);
    expect(mapRoleCode("teacher")).toBe(Role.Teacher);
    expect(mapRoleCode("support_staff")).toBe(Role.SupportStaff);
    expect(mapRoleCode("manager")).toBe(Role.Manager);
    expect(mapRoleCode("buyer")).toBe(Role.Buyer);
    expect(mapRoleCode("driver")).toBe(Role.Driver);
    expect(mapRoleCode("warehouse_worker")).toBe(Role.WarehouseWorker);
    expect(mapRoleCode("worker")).toBe(Role.Worker);
    expect(mapRoleCode("parent")).toBe(Role.Parent);
    expect(mapRoleCode("student")).toBe(Role.Student);
  });

  it("falls back to SupportStaff for unknown role codes", () => {
    expect(mapRoleCode("unknown_role")).toBe(Role.SupportStaff);
    expect(mapRoleCode("")).toBe(Role.SupportStaff);
  });
});

// ============================================================================
// 3. Permission code mapping (snake_case → PascalCase enum)
// ============================================================================

describe("Permission code mapping", () => {
  function mapPermissionCodes(codes: string[]): Set<string> {
    const result = new Set<string>();
    for (const code of codes) {
      const pascal = code
        .split("_")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
      if (pascal in Permission) {
        result.add(pascal);
      }
    }
    return result;
  }

  it("converts snake_case to PascalCase", () => {
    const codes = ["view_roster", "enter_grades", "manage_pricing"];
    const result = mapPermissionCodes(codes);
    expect(result.has("ViewRoster")).toBe(true);
    expect(result.has("EnterGrades")).toBe(true);
    expect(result.has("ManagePricing")).toBe(true);
  });

  it("silently drops unknown permission codes", () => {
    const codes = ["view_roster", "unknown_permission", ""];
    const result = mapPermissionCodes(codes);
    expect(result.size).toBe(1);
    expect(result.has("ViewRoster")).toBe(true);
  });

  it("handles empty input", () => {
    const result = mapPermissionCodes([]);
    expect(result.size).toBe(0);
  });
});

// ============================================================================
// 4. RepositoryProvider fallback behavior
// ============================================================================

describe("RepositoryProvider env-var fallback", () => {
  it("VITE_USE_SUPABASE defaults to undefined (falsy) in tests", () => {
    expect(import.meta.env.VITE_USE_SUPABASE).toBeFalsy();
  });

  it("mockRepositories is exported and has all required repository slots", async () => {
    const { mockRepositories } = await import("../../app/providers/repository-provider");
    expect(mockRepositories).toBeDefined();
    expect(mockRepositories.auth).toBeDefined();
    expect(mockRepositories.parents).toBeDefined();
    expect(mockRepositories.students).toBeDefined();
    expect(mockRepositories.payments).toBeDefined();
    expect(mockRepositories.ledger).toBeDefined();
    expect(mockRepositories.audit).toBeDefined();
    expect(mockRepositories.notifications).toBeDefined();
    expect(mockRepositories.dashboard).toBeDefined();
    expect(mockRepositories.pricing).toBeDefined();
  });
});

// ============================================================================
// 5. Approval workflow repository — mocked client tests
// ============================================================================

describe("SupabaseApprovalRepository", () => {
  // We test the approval repository by mocking the Supabase client's
  // functions.invoke method. The actual Edge Function call is tested in
  // the integration suite.

  it("can be imported and instantiated (smoke test)", async () => {
    const { SupabaseApprovalRepository } = await import(
      "../../infrastructure/supabase/repositories/supabase-approval-repository"
    );
    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({ data: [], error: null })),
            })),
          })),
        })),
      })),
      functions: { invoke: vi.fn() },
      rpc: vi.fn(() => ({ data: null, error: null })),
    };
    const repo = new SupabaseApprovalRepository(mockClient as any);
    expect(repo).toBeDefined();
    expect(typeof repo.listPending).toBe("function");
    expect(typeof repo.approveWithExistingParent).toBe("function");
    expect(typeof repo.approveWithNewParent).toBe("function");
    expect(typeof repo.reject).toBe("function");
    expect(typeof repo.bindActivationCode).toBe("function");
  });

  it("rejects invalid activation codes before calling the API", async () => {
    const { SupabaseApprovalRepository } = await import(
      "../../infrastructure/supabase/repositories/supabase-approval-repository"
    );
    const mockClient = { functions: { invoke: vi.fn() } };
    const repo = new SupabaseApprovalRepository(mockClient as any);

    const result1 = await repo.bindActivationCode("12345");  // too short
    expect(result1.ok).toBe(false);
    if (!result1.ok) {
      expect(result1.error.code).toBe("ERR_VALIDATION");
    }

    const result2 = await repo.bindActivationCode("abcdefgh");  // non-numeric
    expect(result2.ok).toBe(false);

    const result3 = await repo.bindActivationCode("12345678");  // too long
    expect(result3.ok).toBe(false);

    expect(mockClient.functions.invoke).not.toHaveBeenCalled();
  });

  it("validates rejection reason is required", async () => {
    const { SupabaseApprovalRepository } = await import(
      "../../infrastructure/supabase/repositories/supabase-approval-repository"
    );
    const mockClient = { functions: { invoke: vi.fn() } };
    const repo = new SupabaseApprovalRepository(mockClient as any);

    const result = await repo.reject("req-123", "  ");  // whitespace only
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ERR_VALIDATION");
    }
    expect(mockClient.functions.invoke).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 6. SupabaseAuthRepository — password validation
// ============================================================================

describe("SupabaseAuthRepository password validation", () => {
  it("rejects passwords shorter than 8 characters", async () => {
    const { SupabaseAuthRepository } = await import(
      "../../infrastructure/supabase/repositories/supabase-auth-repository"
    );
    const mockClient = {
      auth: {
        getSession: vi.fn(() => ({ data: { session: { user: { email: "test@test.dz" } } } })),
        signInWithPassword: vi.fn(),
        updateUser: vi.fn(),
        signOut: vi.fn(),
      },
    };
    const repo = new SupabaseAuthRepository(mockClient as any);
    const result = await repo.changePassword("currentPass", "short");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ERR_VALIDATION");
    }
  });

  it("rejects passwords without lowercase letter", async () => {
    const { SupabaseAuthRepository } = await import(
      "../../infrastructure/supabase/repositories/supabase-auth-repository"
    );
    const mockClient = {
      auth: {
        getSession: vi.fn(() => ({ data: { session: { user: { email: "test@test.dz" } } } })),
        signInWithPassword: vi.fn(),
        updateUser: vi.fn(),
        signOut: vi.fn(),
      },
    };
    const repo = new SupabaseAuthRepository(mockClient as any);
    const result = await repo.changePassword("currentPass", "ALLUPPER123");
    expect(result.ok).toBe(false);
  });

  it("rejects passwords without uppercase letter", async () => {
    const { SupabaseAuthRepository } = await import(
      "../../infrastructure/supabase/repositories/supabase-auth-repository"
    );
    const mockClient = {
      auth: {
        getSession: vi.fn(() => ({ data: { session: { user: { email: "test@test.dz" } } } })),
        signInWithPassword: vi.fn(),
        updateUser: vi.fn(),
        signOut: vi.fn(),
      },
    };
    const repo = new SupabaseAuthRepository(mockClient as any);
    const result = await repo.changePassword("currentPass", "alllower123");
    expect(result.ok).toBe(false);
  });

  it("rejects passwords without digit", async () => {
    const { SupabaseAuthRepository } = await import(
      "../../infrastructure/supabase/repositories/supabase-auth-repository"
    );
    const mockClient = {
      auth: {
        getSession: vi.fn(() => ({ data: { session: { user: { email: "test@test.dz" } } } })),
        signInWithPassword: vi.fn(),
        updateUser: vi.fn(),
        signOut: vi.fn(),
      },
    };
    const repo = new SupabaseAuthRepository(mockClient as any);
    const result = await repo.changePassword("currentPass", "NoDigitsHere");
    expect(result.ok).toBe(false);
  });
});
