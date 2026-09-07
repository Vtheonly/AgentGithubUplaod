/**
 * Migration 0083 source-guard tests (T-236 / RBAC-302 — 35th session).
 *
 * Pins the teacher CRM data-scoping at the SQL source level so a future
 * edit cannot silently re-widen the policies (the t-058 append-only guard
 * protects the chain shape; this protects the POLICY SEMANTICS):
 *
 *   1. students_update: 'teacher' absent from the role list (teachers can
 *      NEVER write student profiles through PostgREST).
 *   2. students_select: the teacher branch is scoped through
 *      homeroom_teacher_id / class_subjects.teacher_id / personnel.user_id.
 *   3. parents_select: 'teacher' absent (the parent directory is
 *      administrative-only).
 *   4. assessments_select: 0041's parent/student self branches preserved
 *      verbatim + the teacher branch scoped through personnel.
 *   5. The migration registers itself in supabase_migrations
 *      (T-091/MIG-TOKENS pattern — file + registration in one change).
 *   6. The apply + verify scripts exist and reference the migration.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/0083_teacher_crm_data_scoping.sql"),
  "utf8",
);

describe("T-236 — migration 0083 teacher CRM data-scoping (source guards)", () => {
  // Anchor sections on the DDL statements (policy names also appear in the
  // discovery header comments — splitting on the bare name grabs the header).
  const section = (dropStatement: string): string =>
    MIGRATION.split(dropStatement)[1] ?? "";

  it("students_update drops the teacher role (administrative trio kept)", () => {
    const s = section("drop policy if exists students_update");
    expect(s).not.toMatch(/array\[[^\]]*'teacher'/);
    expect(s).toContain("'super_admin', 'financial_officer', 'support_staff'");
  });

  it("students_select scopes the teacher branch to assigned classes", () => {
    const s = section("drop policy if exists students_select");
    expect(s).toContain("has_role('teacher')");
    expect(s).toContain("homeroom_teacher_id in (");
    expect(s).toContain("class_subjects cs");
    expect(s).toContain("p.user_id = public.current_user_profile_id()");
    // The administrative tenant-wide branch is preserved.
    expect(s).toContain(
      "'super_admin', 'financial_officer', 'support_staff', 'manager'",
    );
  });

  it("parents_select drops the teacher role entirely", () => {
    const s = section("drop policy if exists parents_select");
    expect(s).not.toMatch(/array\[[^\]]*'teacher'/);
    expect(s).toContain("'super_admin', 'financial_officer', 'support_staff', 'manager'");
  });

  it("assessments_select preserves 0041's parent/student branches and scopes teacher", () => {
    const s = section("drop policy if exists assessments_select");
    expect(s).toContain("p.auth_user_id = auth.uid()");
    expect(s).toContain("s.auth_user_id = auth.uid()");
    expect(s).toContain("has_role('teacher')");
    expect(s).toContain("homeroom_teacher_id IN (");
    expect(s).toContain("class_subjects cs");
  });

  it("registers itself in supabase_migrations (MIG-TOKENS pattern)", () => {
    expect(MIGRATION).toMatch(
      /insert into supabase_migrations\.schema_migrations[\s\S]*'0083'[\s\S]*on conflict \(version\) do nothing/,
    );
  });

  it("the apply + verify scripts exist and reference migration 0083", () => {
    const apply = fs.readFileSync(
      path.resolve(__dirname, "../../../scripts/apply_0083_live.sh"),
      "utf8",
    );
    expect(apply).toContain("0083_teacher_crm_data_scoping.sql");
    expect(apply).toContain("BEGIN;");
    expect(apply).toContain("COMMIT;");
    const verify = fs.readFileSync(
      path.resolve(__dirname, "../../../scripts/verify_t-236.sql"),
      "utf8",
    );
    expect(verify).toContain("begin;");
    expect(verify).toContain("rollback;");
    expect(verify).toContain("t236_results");
  });
});
