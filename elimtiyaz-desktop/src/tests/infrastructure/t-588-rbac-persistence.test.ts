/**
 * t-588-rbac-persistence.test.ts — T-588 / BUG-017 / SET-U5: the RBAC
 * matrix persistence seam.
 *
 * What this suite pins:
 *
 *   A. The MockRbacRepository round-trip (save → load reflects; reset →
 *      defaults; hasOverrides honest).
 *   B. THE MOCK-MODE PLACEBO FIX: mock sign-in now APPLIES the saved
 *      override (previously the enforcement path never read the store —
 *      the editor was a placebo in mock mode too).
 *   C. The mock-store RESTORE path writes the CANONICAL key (the old
 *      restore wrote the dead "rbac-matrix-overrides" key nobody read —
 *      restoring a backup silently dropped every RBAC customization).
 *   D. Migration 0006 content pins: the 41 catalog codes, the three RPCs,
 *      the super_admin grant completion, append-only discipline.
 *   E. The SupabaseRbacRepository payload contract: the save covers the
 *      WHOLE desktop vocabulary per role (granted + denied), so the RPC
 *      can diff server-side and never strips unlisted legacy codes.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-588-rbac-persistence.test.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockRbacRepository } from "../../infrastructure/mock/repositories/mock-rbac-repository";
import { RBAC_OVERRIDES_STORAGE_KEY } from "../../domain/model/rbac";
import { Role, STAFF_ROLES } from "../../core/rbac/roles";
import { Permission, DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { SupabaseRbacRepository } from "../../infrastructure/supabase/repositories/supabase-rbac-repository";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

function defaultArrays(): Record<Role, Permission[]> {
  const out = {} as Record<Role, Permission[]>;
  for (const role of STAFF_ROLES) out[role] = Array.from(DEFAULT_ROLE_PERMISSIONS[role]);
  return out;
}

beforeEach(() => {
  localStorage.clear();
});

/* ------------------------------------------------------------------ */
/*  A. The mock repository round-trip                                 */
/* ------------------------------------------------------------------ */

describe("T-588 / BUG-017 — the mock RBAC repository", () => {
  it("loads the defaults when nothing is stored (hasOverrides false)", async () => {
    const repo = new MockRbacRepository();
    const res = await repo.loadEffectiveMatrix();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasOverrides).toBe(false);
    expect(res.value.unmappedServerCodes).toEqual([]);
    for (const role of STAFF_ROLES) {
      expect(res.value.matrix[role].sort()).toEqual(
        Array.from(DEFAULT_ROLE_PERMISSIONS[role]).sort(),
      );
    }
  });

  it("save → load round-trips the edited matrix and flips hasOverrides", async () => {
    const repo = new MockRbacRepository();
    const edited = defaultArrays();
    // deny the teacher RollCall + grant the teacher ManagePricing
    edited[Role.Teacher] = edited[Role.Teacher].filter((p) => p !== Permission.RollCall);
    edited[Role.Teacher] = [...edited[Role.Teacher], Permission.ManagePricing];

    const saveRes = await repo.saveMatrix(edited);
    expect(saveRes.ok).toBe(true);

    const loaded = await repo.loadEffectiveMatrix();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.hasOverrides).toBe(true);
    expect(loaded.value.matrix[Role.Teacher]).not.toContain(Permission.RollCall);
    expect(loaded.value.matrix[Role.Teacher]).toContain(Permission.ManagePricing);
  });

  it("reset → back to defaults, hasOverrides false, key removed", async () => {
    const repo = new MockRbacRepository();
    await repo.saveMatrix(defaultArrays());
    const res = await repo.resetMatrix();
    expect(res.ok).toBe(true);
    expect(localStorage.getItem(RBAC_OVERRIDES_STORAGE_KEY)).toBeNull();
    const loaded = await repo.loadEffectiveMatrix();
    expect(loaded.ok && loaded.value.hasOverrides).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  B. The mock-mode placebo fix — sign-in APPLIES the override       */
/* ------------------------------------------------------------------ */

describe("T-588 / BUG-017 — mock sessions apply the saved override", () => {
  it("a teacher sign-in under a deny override LOSES the denied permission", async () => {
    const { MockAuthRepository } = await import(
      "../../infrastructure/mock/repositories/auth-repository"
    );
    // Teacher seed account — the default set HAS RollCall.
    expect(DEFAULT_ROLE_PERMISSIONS[Role.Teacher].has(Permission.RollCall)).toBe(true);

    const edited = defaultArrays();
    edited[Role.Teacher] = edited[Role.Teacher].filter((p) => p !== Permission.RollCall);
    localStorage.setItem(RBAC_OVERRIDES_STORAGE_KEY, JSON.stringify(edited));

    const auth = new MockAuthRepository();
    const res = await auth.signIn("teacher@elimtiyaz.dz", "any-non-empty");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.role).toBe(Role.Teacher);
    expect(res.value.permissions.has(Permission.RollCall)).toBe(false);
  });

  it("a grant override reaches the session (the placebo worked in NEITHER direction before)", async () => {
    const { MockAuthRepository } = await import(
      "../../infrastructure/mock/repositories/auth-repository"
    );
    expect(DEFAULT_ROLE_PERMISSIONS[Role.Teacher].has(Permission.ManagePricing)).toBe(false);

    const edited = defaultArrays();
    edited[Role.Teacher] = [...edited[Role.Teacher], Permission.ManagePricing];
    localStorage.setItem(RBAC_OVERRIDES_STORAGE_KEY, JSON.stringify(edited));

    const auth = new MockAuthRepository();
    const res = await auth.signIn("teacher@elimtiyaz.dz", "any-non-empty");
    expect(res.ok && res.value.permissions.has(Permission.ManagePricing)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  C. The mock-store restore path writes the CANONICAL key           */
/* ------------------------------------------------------------------ */

describe("T-588 / DEAD-018 — the restore path writes the canonical key", () => {
  it("a snapshot carrying rbacMatrixOverrides restores into the canonical key", () => {
    const snapshot: Record<string, unknown> = {
      snapshotAt: new Date().toISOString(),
      tenantId: "t1",
      parents: [],
      students: [],
      payments: [],
      installments: [],
      ledger: [],
      expenses: [],
      personnel: [],
      workflows: [],
      rbacMatrixOverrides: { teacher: ["view_roster"] },
    };
    store.replaceOperationalState(snapshot as never);
    expect(localStorage.getItem(RBAC_OVERRIDES_STORAGE_KEY)).toBe(
      JSON.stringify({ teacher: ["view_roster"] }),
    );
    // the DEAD key is not resurrected
    expect(localStorage.getItem("el-imtiyaz:rbac-matrix-overrides")).toBeNull();
  });

  it("a snapshot WITHOUT overrides clears the canonical key", () => {
    localStorage.setItem(RBAC_OVERRIDES_STORAGE_KEY, '{"teacher":["view_roster"]}');
    const snapshot: Record<string, unknown> = {
      snapshotAt: new Date().toISOString(),
      tenantId: "t1",
      parents: [],
      students: [],
      payments: [],
      installments: [],
      ledger: [],
      expenses: [],
      personnel: [],
      workflows: [],
      rbacMatrixOverrides: null,
    };
    store.replaceOperationalState(snapshot as never);
    expect(localStorage.getItem(RBAC_OVERRIDES_STORAGE_KEY)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  D. Migration 0006 content pins                                    */
/* ------------------------------------------------------------------ */

describe("T-588 — migration 0006 content pins", () => {
  const sql = read("../../../supabase/migrations/0006_rbac_matrix_persistence.sql");

  it("seeds the 41 desktop codes the catalog lacked (idempotent inserts)", () => {
    const expected = [
      "create_student", "edit_student", "delete_student", "promote_student",
      "manage_classes", "assign_homework", "view_attendance", "manage_school_years",
      "view_clubs", "manage_clubs", "enroll_club_members", "log_club_activities",
      "view_psychology", "manage_psychology", "conduct_psychology_session",
      "create_psychology_report", "view_orthophonie", "manage_orthophonie",
      "conduct_orthophonie_session", "generate_receipt", "adjust_account",
      "send_reminder", "settle_expense_proof", "disburse_expense", "clock_in_out",
      "view_salary", "approve_requests", "submit_requests", "manage_purchase_requests",
      "manage_deliveries", "view_departments", "manage_employee_profiles",
      "manage_schedules", "view_performance", "manage_performance", "manage_tasks",
      "update_task_status", "view_workforce_reports", "use_chat",
      "manage_chat_channels", "manage_tenants",
    ];
    for (const code of expected) {
      expect(sql).toContain(`'${code}'`);
    }
    // every seed insert is idempotent
    const inserts = sql.match(/insert into public\.permissions[^;]*;/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(41);
    for (const ins of inserts) {
      expect(ins).toContain("on conflict do nothing");
    }
  });

  it("defines the three RPCs with the right gates", () => {
    expect(sql).toContain("create or replace function public.read_rbac_effective_matrix()");
    expect(sql).toContain("create or replace function public.save_rbac_matrix(p_matrix jsonb)");
    expect(sql).toContain("create or replace function public.reset_rbac_matrix()");
    // the super_admin gate + the fail-loud errcodes
    expect(sql).toMatch(/has_role\('super_admin'\)/);
    expect(sql).toContain("'42501'"); // forbidden
    expect(sql).toContain("'23503'"); // unknown role/permission (FK class)
    expect(sql).toContain("'22P02'"); // bad payload / contradiction
  });

  it("completes ONLY super_admin's default grants (the T-266 invariant, server-side)", () => {
    const grantBlock = sql.match(
      /insert into role_permissions[\s\S]*?where r\.code = 'super_admin'[\s\S]*?on conflict do nothing;/,
    );
    expect(grantBlock).not.toBeNull();
    // no other role's defaults are touched by the migration
    const rolePermInserts = sql.match(/insert into role_permissions[^;]*;/g) ?? [];
    expect(rolePermInserts.length).toBe(1);
  });

  it("never modifies the applied chain (append-only discipline)", () => {
    // no DROP/ALTER on existing chain objects
    expect(sql).not.toMatch(/drop\s+(table|function|policy|index)/i);
    expect(sql).not.toMatch(/alter\s+table\s+public\.(role_permissions|permissions|tenant_role_overrides)\b/i);
  });
});

/* ------------------------------------------------------------------ */
/*  E. The Supabase repository payload contract                       */
/* ------------------------------------------------------------------ */

describe("T-588 — the SupabaseRbacRepository payload contract", () => {
  function fakeClient() {
    const calls: Array<{ fn: string; args: unknown }> = [];
    return {
      calls,
      client: {
        rpc: async (fn: string, args: unknown) => {
          calls.push({ fn, args });
          if (fn === "read_rbac_effective_matrix") {
            return {
              data: {
                teacher: ["view_roster", "use_ai", "view_students"],
                super_admin: ["view_roster"],
              },
              error: null,
            };
          }
          if (fn === "save_rbac_matrix") return { data: { saved: 2, removed: 1 }, error: null };
          if (fn === "reset_rbac_matrix") return { data: { removed: 3 }, error: null };
          return { data: null, error: null };
        },
        from: () => ({
          select: async () => ({ count: 2, error: null }),
        }),
      } as never,
    };
  }

  it("saveMatrix sends granted+denied covering the WHOLE desktop vocabulary per role", async () => {
    const { client, calls } = fakeClient();
    const repo = new SupabaseRbacRepository(client);
    const matrix = defaultArrays();
    matrix[Role.Teacher] = matrix[Role.Teacher].filter((p) => p !== Permission.RollCall);

    const res = await repo.saveMatrix(matrix);
    expect(res.ok && res.value.saved === 2 && res.value.removed === 1).toBe(true);

    const call = calls.find((c) => c.fn === "save_rbac_matrix");
    expect(call).toBeDefined();
    const payload = (call!.args as { p_matrix: Record<string, { granted: string[]; denied: string[] }> }).p_matrix;
    const allCodes = Object.values(Permission) as Permission[];
    // Permission VALUES are already the DB codes — identity, not a transform
    const toCode = (p: Permission) => p as string;
    for (const role of ["teacher", "financial_officer", "super_admin"]) {
      const both = [...payload[role].granted, ...payload[role].denied].sort();
      expect(both).toEqual(allCodes.map(toCode).sort());
      // no overlap
      expect(payload[role].granted.filter((c) => payload[role].denied.includes(c))).toEqual([]);
    }
    // the edit: teacher denied roll_call
    expect(payload.teacher.denied).toContain("roll_call");
  });

  it("loadEffectiveMatrix maps codes, counts unmapped server codes, reports overrides", async () => {
    const { client } = fakeClient();
    const repo = new SupabaseRbacRepository(client);
    const res = await repo.loadEffectiveMatrix();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.matrix[Role.Teacher]).toContain(Permission.ViewRoster);
    expect(res.value.matrix[Role.Teacher]).toContain(Permission.UseAI);
    // view_students has NO desktop-enum counterpart → unmapped
    expect(res.value.unmappedServerCodes).toContain("view_students");
    // the fake count query says 2 override rows exist
    expect(res.value.hasOverrides).toBe(true);
  });
});
