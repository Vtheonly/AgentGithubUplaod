/**
 * T-413 — Student Approval, Enrollment & Synchronization regression suite.
 *
 * Covers the desktop legs of the student-application approval flow:
 *   1. The repository's STUDENT matching (the previously-dead
 *      `student_match` field): the activation-code student lookup and the
 *      application-payload name lookup.
 *   2. The ApprovalsTab student UI contract (source-scan guards, the
 *      t-199/t-331 convention): the student action buttons, the
 *      application-payload card, the reclassification toggle, and the
 *      validation gates.
 *   3. The Edge Function's STUDENT-102 guard + the composite path (the
 *      create_new_student routing to approve_student_application).
 *   4. The migration's SQL surface (the RPC, the RLS policies, the trigger
 *      — the source-scan guards that fail when the chain drifts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../.."); // src/
const APP_ROOT = join(SRC, ".."); // elimtiyaz-desktop/
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

const TAB = read("features/settings/approvals-tab.tsx");
const REPO = read("infrastructure/supabase/repositories/supabase-approval-repository.ts");
const TYPES = read("infrastructure/supabase/types.ts");
const EF = readFileSync(
  join(APP_ROOT, "supabase/functions/approve-signup-request/index.ts"),
  "utf8",
);
const MIGRATION = readFileSync(
  join(APP_ROOT, "supabase/migrations/0116_student_application_approval.sql"),
  "utf8",
);

/* ------------------------------------------------------------------ */
/* 1. The repository's student matching                                 */
/* ------------------------------------------------------------------ */

describe("T-413 — the repository student matching (STUDENT-100)", () => {
  it("the activation-code path resolves a STUDENT (activation_codes.student_id)", () => {
    expect(REPO).toContain("codeRow?.student_id");
    expect(REPO).toMatch(
      /from\("students"\)[\s\S]{0,220}\.eq\("id", codeRow\.student_id\)/,
    );
  });

  it("the application payload's student name matches the CANONICAL students table", () => {
    expect(REPO).toContain("request.student_application?.student");
    expect(REPO).toMatch(
      /from\("students"\)[\s\S]{0,260}\.ilike\("first_name", applicant\.first_name\)/,
    );
    // NEVER a local/mock dataset: the lookup goes through the Supabase
    // client, not any in-memory list.
    expect(REPO).not.toMatch(
      /student_match[\s\S]{0,80}students\.filter/,
    );
  });

  it("approveWithExistingStudent calls the EF with target_student_id", () => {
    expect(REPO).toContain("async approveWithExistingStudent(");
    expect(REPO).toMatch(
      /target_student_id: targetStudentId/,
    );
  });

  it("approveWithNewStudent sends create_new_student + the parent resolution", () => {
    expect(REPO).toContain("async approveWithNewStudent(");
    expect(REPO).toMatch(/create_new_student: true/);
    expect(REPO).toMatch(/target_parent_id: parent\.targetParentId/);
    expect(REPO).toMatch(/new_parent: parent\.newParent/);
    // assign_role='student' flows through for the reclassification case.
    expect(REPO).toMatch(/assign_role: assignRole/);
  });

  it("the typed row carries the student_application payload (migration 0116 §1)", () => {
    expect(TYPES).toContain("student_application: StudentApplicationPayload | null;");
    expect(TYPES).toContain("export interface StudentApplicationPayload");
  });
});

/* ------------------------------------------------------------------ */
/* 2. The ApprovalsTab student UI contract                              */
/* ------------------------------------------------------------------ */

describe("T-413 — the ApprovalsTab student approval UI", () => {
  it("a student application routes to the student actions (payload OR student-role)", () => {
    expect(TAB).toContain(
      'const isStudentFlow = request.requested_role === "student" || hasApplication;',
    );
    expect(TAB).toContain("onApproveStudentNew}");
    expect(TAB).toContain("onApproveStudentExisting}");
  });

  it("the application payload renders its dedicated card (STUDENT-102)", () => {
    expect(TAB).toContain("Demande d'inscription élève");
    expect(TAB).toContain("request.student_application");
  });

  it("the detected central-student match surfaces before approval", () => {
    expect(TAB).toContain("request.student_match");
    expect(TAB).toContain("Élève correspondant détecté dans le dossier central");
  });

  it("the reclassification toggle exists (the SEC-108 reality: signups are 'parent')", () => {
    expect(TAB).toContain("function ReclassifyToggle(");
    expect(TAB).toContain("applicantIsStudent: e.target.checked");
    expect(TAB).toContain(
      'decisionModal.applicantIsStudent ? "student" : undefined',
    );
  });

  it("the student branches gate the submit button (validation before the wire)", () => {
    expect(TAB).toMatch(/isStudentExisting && !decision\.targetStudentId/);
    expect(TAB).toContain("const studentNewInvalid =");
    expect(TAB).toMatch(
      /!decision\.newStudent\?\.date_of_birth \|\|[\s\S]{0,120}\(!decision\.targetParentId && !decision\.newParent\)/,
    );
  });

  it("the new-student form collects the class enrollment (the level-scoped class picker)", () => {
    expect(TAB).toContain('label="Classe (inscription)"');
    expect(TAB).toMatch(/levelFilteredClasses\.map\(\(c\) =>/);
  });

  it("the student search in the modal is CANONICAL (the repositories' students)", () => {
    expect(TAB).toContain("repos.students.observe()");
    expect(TAB).not.toMatch(/const\s+MOCK_STUDENTS|mockStudents\s*=/);
  });

  it("the parent flows are preserved verbatim (no regression to the T-029/T-331 guards)", () => {
    expect(TAB).toContain("approveWithExistingParent");
    expect(TAB).toContain("approveWithNewParent");
    expect(TAB).toContain("Compte lié");
    expect(TAB).toMatch(/migration 0047/);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The Edge Function contract                                        */
/* ------------------------------------------------------------------ */

describe("T-413 — the approve-signup-request EF contract", () => {
  it("the STUDENT-102 guard rejects student approvals without a binding (STUDENT-101)", () => {
    expect(EF).toContain("STUDENT-102 binding guard");
    expect(EF).toMatch(
      /missing_target_student[\s\S]{0,160}student-role approval requires target_student_id or create_new_student/,
    );
  });

  it("the parent+target_student_id category error is rejected", () => {
    expect(EF).toContain("parent_request_cannot_bind_student");
  });

  it("the reclassification precedes the guards (the GoTrue timing reality)", () => {
    // The reclassification block sits BEFORE the PARENT-102 guard.
    const reclIdx = EF.indexOf("T-413 reclassification: every website self-signup");
    const guardIdx = EF.indexOf("PARENT-102 guard");
    expect(reclIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(reclIdx).toBeLessThan(guardIdx);
  });

  it("the composite path routes to approve_student_application (one round trip)", () => {
    expect(EF).toContain('"approve_student_application"');
    expect(EF).toContain("p_new_parent: body.create_new_parent && body.new_parent");
    expect(EF).toContain("p_new_student: body.new_student ?? null");
  });

  it("the EF's parent-creation branch is skipped when the composite runs (no double-create)", () => {
    expect(EF).toMatch(/body\.create_new_parent &&[\s\S]{0,80}body\.new_parent &&[\s\S]{0,80}!isStudentEnrollmentApproval/);
  });

  it("the STUDENT-102 audit entry is written on denial", () => {
    expect(EF).toContain("account_approval.missing_target_student_denied");
  });
});

/* ------------------------------------------------------------------ */
/* 4. The migration's SQL surface (the drift tripwires)                  */
/* ------------------------------------------------------------------ */

describe("T-413 — migration 0116 SQL surface", () => {
  it("the composite RPC exists with the role-aware branches", () => {
    expect(MIGRATION).toContain(
      "create or replace function public.approve_student_application(",
    );
    expect(MIGRATION).toMatch(
      /if v_request\.requested_role = 'student' then[\s\S]{0,200}v_role_id := public\.approve_account_request/,
    );
  });

  it("the STUDENT-101 guard is enforced IN the RPC (defence in depth behind the EF)", () => {
    expect(MIGRATION).toMatch(
      /a student approval requires target_student_id or new_student/,
    );
  });

  it("the canonical identity codes: deterministic parent + ELV student sequence", () => {
    expect(MIGRATION).toContain("public.fn_deterministic_parent_code(");
    expect(MIGRATION).toContain("nextval('public.student_seq')");
    expect(MIGRATION).toMatch(/'ELV-' \|\| extract\(year from now\(\)\)::text/);
  });

  it("the class enrollment + the canonical academic history entry", () => {
    expect(MIGRATION).toContain("insert into public.students (");
    expect(MIGRATION).toContain("insert into public.student_academic_histories (");
    expect(MIGRATION).toMatch(/on conflict \(student_id, academic_year\) do nothing/);
  });

  it("the rebind guard for students (the 0047 semantics)", () => {
    expect(MIGRATION).toMatch(
      /already bound to a different auth_user_id[\s\S]{0,120}Unbind the previous account via the RBAC editor/,
    );
  });

  it("the student portal-access RLS uses the RECURSION-SAFE helper (the live-caught 42P17)", () => {
    expect(MIGRATION).toContain("create or replace function public.is_own_parent_via_student(");
    expect(MIGRATION).toMatch(
      /create policy parents_student_sees_own[\s\S]{0,220}public\.is_own_parent_via_student\(parents\.id\)/,
    );
    // The direct (recursing) form must NOT come back.
    expect(MIGRATION).not.toMatch(
      /parents_student_sees_own[\s\S]{0,300}exists \(\s*select 1\s*from public\.students/,
    );
  });

  it("the self-service attach: own-pending SELECT + UPDATE policies + the column guard", () => {
    expect(MIGRATION).toContain("approval_requests_select_own_pending");
    expect(MIGRATION).toContain("approval_requests_update_own_application");
    expect(MIGRATION).toContain("account_approval_self_update_guard");
    expect(MIGRATION).toMatch(
      /may only change the student_application payload/,
    );
  });

  it("the messaging eligibility: open_parent_admin_channel admits students (STUDENT-104)", () => {
    expect(MIGRATION).toMatch(
      /r\.code in \('parent', 'student'\)/,
    );
    expect(MIGRATION).toContain("only parent or student accounts may open the administration channel");
  });

  it("the trusted-context bypasses: service_role JWT + staff + direct DB (no-JWT)", () => {
    expect(MIGRATION).toMatch(/coalesce\(auth\.jwt\(\) ->> 'role', ''\) = 'service_role'/);
    expect(MIGRATION).toMatch(/if auth\.jwt\(\) is null then/);
    expect(MIGRATION).toMatch(/has_any_role\(array\['super_admin', 'support_staff'\]\)/);
  });
});
