/**
 * T-413 — the cross-section navigation & Pedagogy student-search suite.
 *
 * Covers:
 *   1. The StudentActionsMenu — the standardized 3-dot "Ouvrir dans…" menu:
 *      every action navigates with the CANONICAL student identity, dead
 *      actions never render, and the deep-link targets are the ones the
 *      sections actually consume.
 *   2. The Pedagogy StudentsDirectoryTab — the canonical student search
 *      (name / ELV code / family / class), the level + class filters, the
 *      deep-link consumption, and the "no local dataset" rule.
 *   3. The deep-link emitters ↔ consumers contract matrix (the audit
 *      FA-16 lesson: an emitted param nobody consumes is a dead link).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../.."); // src/
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

const MENU = read("shared/ui/student-actions-menu.tsx");
const DIRECTORY = read("features/academics/students-directory-tab.tsx");
const ACADEMICS_PAGE = read("features/academics/academics-page.tsx");
const FINANCIALS_PAGE = read("features/financials/financials-page.tsx");
const INSTALLMENTS = read("features/financials/installment-schedule-tab.tsx");
const CRM_PAGE = read("features/crm/crm-page.tsx");
const CLASS_DETAIL = read("features/academics/class-detail-page.tsx");

/* ------------------------------------------------------------------ */
/* 1. The standardized 3-dot menu                                       */
/* ------------------------------------------------------------------ */

describe("T-413 — StudentActionsMenu (the standardized 3-dot menu)", () => {
  it("exists as ONE shared component (no forked implementations)", () => {
    expect(MENU).toContain("export function StudentActionsMenu(");
    // The reuse rule: the surfaces that mount it.
    expect(DIRECTORY).toContain("StudentActionsMenu");
    expect(CRM_PAGE).toContain("StudentActionsMenu");
    expect(CLASS_DETAIL).toContain("StudentActionsMenu");
  });

  it("every action navigates with the canonical student identity", () => {
    expect(MENU).toContain("navigate(`/crm?studentId=${student.id}`)");
    expect(MENU).toContain("navigate(`/academics?studentId=${student.id}`)");
    expect(MENU).toContain("navigate(`/crm?parentId=${student.parentId}`)");
    expect(MENU).toContain("navigate(`/financials?familyId=${student.parentId}`)");
    expect(MENU).toContain("navigate(`/academics/class/${student.classId}`)");
  });

  it("actions WITHOUT context never render (no dead links — the FA-16 lesson)", () => {
    // The parent + finance actions are conditional on parentId; the class
    // action on classId — built via conditional spread into the array.
    expect(MENU).toMatch(/\.\.\.\(student\.parentId[\s\S]{0,60}\?\s*\[/);
    expect(MENU).toMatch(/\.\.\.\(student\.classId[\s\S]{0,60}\?\s*\[/);
  });

  it("the trigger is accessible (aria-label + title) and stops row-click propagation", () => {
    expect(MENU).toMatch(/aria-label=\{label \?\? `Actions pour \$\{studentName\}`\}/);
    expect(MENU).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The Pedagogy student search                                       */
/* ------------------------------------------------------------------ */

describe("T-413 — the Pedagogy student search (StudentsDirectoryTab)", () => {
  it("searches the CANONICAL records (repos.students — never a local dataset)", () => {
    expect(DIRECTORY).toContain("repos.students.observe()");
    expect(DIRECTORY).not.toMatch(/MOCK_STUDENTS|mockStudents|hardcoded/i);
  });

  it("the identifier coverage: name, ELV code, family, class, level", () => {
    expect(DIRECTORY).toMatch(/studentDisplayName\(s\)\.toLowerCase\(\)\.includes\(q\)/);
    expect(DIRECTORY).toMatch(/s\.code\.toLowerCase\(\)\.includes\(q\)/);
    expect(DIRECTORY).toMatch(/parentDisplayName\(parent\)\.toLowerCase\(\)\.includes\(q\)/);
    expect(DIRECTORY).toMatch(/\(cls \? \(cls\.name \?\? cls\.code\)\.toLowerCase\(\)\.includes\(q\) : false\)/);
  });

  it("level + class filters exist", () => {
    expect(DIRECTORY).toContain('>Tous les niveaux</SelectItem>');
    expect(DIRECTORY).toContain(">Toutes les classes</SelectItem>");
    expect(DIRECTORY).toMatch(/levelFilter !== "all" && s\.gradeLevel !== levelFilter/);
    expect(DIRECTORY).toMatch(/classFilter !== "all" && s\.classId !== classFilter/);
  });

  it("every row carries the 3-dot menu + a selected-student detail panel", () => {
    expect(DIRECTORY).toContain("<StudentActionsMenu");
    expect(DIRECTORY).toContain("initialStudentId");
  });

  it("renders the honest empty state (never fabricated rows)", () => {
    expect(DIRECTORY).toContain("Aucun élève trouvé");
    expect(DIRECTORY).toContain(
      "Aucun élève du dossier central ne correspond à ces critères.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* 3. The deep-link emitters ↔ consumers contract matrix                */
/* ------------------------------------------------------------------ */

describe("T-413 — the deep-link contract matrix (emitter ↔ consumer)", () => {
  it("/academics?studentId= is EMITTED (the menu) and CONSUMED (the page)", () => {
    expect(MENU).toContain("`/academics?studentId=${student.id}`");
    expect(ACADEMICS_PAGE).toMatch(/searchParams\.get\("studentId"\)/);
    expect(ACADEMICS_PAGE).toContain('setTab("students_directory")');
    expect(ACADEMICS_PAGE).toContain("<StudentsDirectoryTab");
    expect(ACADEMICS_PAGE).toContain("initialStudentId={directoryStudentId}");
  });

  it("/financials?familyId= is EMITTED (the menu) and CONSUMED (the page + tab)", () => {
    expect(MENU).toContain("`/financials?familyId=${student.parentId}`");
    expect(FINANCIALS_PAGE).toMatch(/searchParams\.get\("familyId"\)/);
    expect(FINANCIALS_PAGE).toContain("setInstallmentFamilyFilter(familyId)");
    expect(FINANCIALS_PAGE).toMatch(/initialFamilyId=\{installmentFamilyFilter\}/);
    expect(INSTALLMENTS).toContain("initialFamilyId");
    expect(INSTALLMENTS).toMatch(/familyFilter !== "all"/);
  });

  it("/crm?studentId= is EMITTED (the menu) and CONSUMED (the CRM page — pre-existing)", () => {
    expect(MENU).toContain("`/crm?studentId=${student.id}`");
    expect(CRM_PAGE).toMatch(/searchParams\.get\("studentId"\)/);
  });

  it("/crm?parentId= is EMITTED (the menu) and CONSUMED (the CRM page — pre-existing)", () => {
    expect(MENU).toContain("`/crm?parentId=${student.parentId}`");
    expect(CRM_PAGE).toMatch(/searchParams\.get\("parentId"\)/);
  });

  it("/academics/class/{id} is EMITTED (the menu) and ROUTED (app-shell — pre-existing)", () => {
    expect(MENU).toContain("`/academics/class/${student.classId}`");
    // The route exists in the shell (the classId deep link target).
    expect(read("app/app-shell.tsx")).toContain(
      'path="/academics/class/:classId"',
    );
  });

  it("the CRM students table + the class roster mount the standardized menu", () => {
    expect(CRM_PAGE).toMatch(
      /T-413: the standardized 3-dot cross-section menu/,
    );
    expect(CLASS_DETAIL).toContain("<StudentActionsMenu student={s} />");
  });

  it("the Pedagogy page exposes the students directory tab", () => {
    expect(ACADEMICS_PAGE).toContain('"students_directory"');
    expect(ACADEMICS_PAGE).toContain("Annuaire élèves");
  });
});
