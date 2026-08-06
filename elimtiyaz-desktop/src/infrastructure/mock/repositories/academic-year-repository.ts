/**
 * Mock AcademicYearRepository — implements the full lifecycle:
 *   create / update / archive / restore / delete / set-current
 *
 * FINANCE ISOLATION: This repository ONLY touches `store.academicYears`.
 * It does not call any ledger / payment / installment / debt repository.
 */
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import type { AcademicYear } from "../../../domain/model/academic";
import type { AcademicYearRepository } from "../../../domain/repository/academic-repository";
import type {
  CreateSchoolYearInput,
  UpdateSchoolYearInput,
} from "../../../domain/calc/academics/school-year";
import {
  validateCreateSchoolYearInput,
  validateUpdateSchoolYearInput,
  canArchiveSchoolYear,
  canRestoreSchoolYear,
  canDeleteSchoolYear,
  canSetCurrentSchoolYear,
  checkDuplicateCode,
} from "../../../domain/calc/academics/school-year";
import type { Observable } from "../../../domain/repository/repository";
import { SubjectBehavior } from "../subject-behavior";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

export class MockAcademicYearRepository implements AcademicYearRepository {
  observeAll(): Observable<AcademicYear[]> {
    return store.academicYears$;
  }

  observeById(id: string): Observable<AcademicYear | null> {
    return new SubjectBehavior(
      store.academicYears.find((y) => y.id === id) ?? null,
    );
  }

  async getCurrentYear(): Promise<Result<AcademicYear>> {
    await delay(50);
    const current = store.academicYears.find((y) => y.isCurrent && !y.isArchived);
    if (!current) {
      return Err(Errors.notFound("Current academic year", "current"));
    }
    return Ok(current);
  }

  async getYearByCode(code: string): Promise<Result<AcademicYear | null>> {
    await delay(50);
    const year = store.academicYears.find((y) => y.code === code) ?? null;
    return Ok(year);
  }

  async setCurrentYear(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<AcademicYear>> {
    await delay(120);
    const year = store.academicYears.find((y) => y.id === id);
    if (!year) return Err(Errors.notFound("Academic year", id));

    const canSet = canSetCurrentSchoolYear(year);
    if (!canSet.isValid) return Err(Errors.validation(canSet.errors.join(" "), canSet.errors.join(" ")));

    // Unset all other current flags
    store.academicYears = store.academicYears.map((y) =>
      y.id === id
        ? { ...y, isCurrent: true, isArchived: false }
        : { ...y, isCurrent: false },
    );
    store.notifyAcademicYears();

    appendAudit({
      action: AuditActions.SchoolYearSetCurrent,
      entityType: "academic_year",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { code: year.code, wasCurrent: year.isCurrent }, after: { isCurrent: true } },
      note: `Année ${year.code} définie comme courante`,
    });

    return Ok(store.academicYears.find((y) => y.id === id)!);
  }

  async createAcademicYear(
    input: CreateSchoolYearInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<AcademicYear>> {
    await delay(150);
    const validation = validateCreateSchoolYearInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const dupCheck = checkDuplicateCode(input.code, store.academicYears);
    if (!dupCheck.isValid) {
      return Err(Errors.validation(dupCheck.errors.join(" "), dupCheck.errors.join(" ")));
    }

    const year: AcademicYear = {
      id: `ay-${input.code.replace(/[^A-Z0-9]/gi, "-").toLowerCase()}`,
      tenantId: TENANT_ID,
      code: input.code,
      label: input.label,
      startDate: input.startDate,
      endDate: input.endDate,
      termStructure: input.termStructure,
      isCurrent: input.isCurrent ?? false,
      isArchived: false,
    };

    // If setting as current, unset all others
    if (year.isCurrent) {
      store.academicYears = store.academicYears.map((y) => ({
        ...y,
        isCurrent: false,
      }));
    }
    store.academicYears = [...store.academicYears, year];
    store.notifyAcademicYears();

    appendAudit({
      action: AuditActions.SchoolYearCreate,
      entityType: "academic_year",
      entityId: year.id,
      actorId,
      actorName,
      diff: { before: null, after: { code: year.code, label: year.label } },
      note: `Année scolaire créée : ${year.label}`,
    });

    return Ok(year);
  }

  async updateAcademicYear(
    id: string,
    input: UpdateSchoolYearInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<AcademicYear>> {
    await delay(120);
    const idx = store.academicYears.findIndex((y) => y.id === id);
    if (idx < 0) return Err(Errors.notFound("Academic year", id));

    const before = store.academicYears[idx];
    const validation = validateUpdateSchoolYearInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    const after: AcademicYear = {
      ...before,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.termStructure !== undefined ? { termStructure: input.termStructure } : {}),
    };

    store.academicYears[idx] = after;
    store.notifyAcademicYears();

    appendAudit({
      action: AuditActions.SchoolYearUpdate,
      entityType: "academic_year",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Année scolaire modifiée : ${after.label}`,
    });

    return Ok(after);
  }

  async archiveAcademicYear(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<AcademicYear>> {
    await delay(120);
    const idx = store.academicYears.findIndex((y) => y.id === id);
    if (idx < 0) return Err(Errors.notFound("Academic year", id));

    const before = store.academicYears[idx];
    const activeClassCount = store.classes.filter(
      (c) => c.academicYearId === id && c.isActive,
    ).length;
    const canArch = canArchiveSchoolYear(before, activeClassCount);
    if (!canArch.isValid) {
      return Err(Errors.validation(canArch.errors.join(" "), canArch.errors.join(" ")));
    }

    const after: AcademicYear = { ...before, isArchived: true };
    store.academicYears[idx] = after;
    store.notifyAcademicYears();

    appendAudit({
      action: AuditActions.SchoolYearArchive,
      entityType: "academic_year",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Année scolaire archivée : ${after.label}`,
    });

    return Ok(after);
  }

  async restoreAcademicYear(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<AcademicYear>> {
    await delay(120);
    const idx = store.academicYears.findIndex((y) => y.id === id);
    if (idx < 0) return Err(Errors.notFound("Academic year", id));

    const before = store.academicYears[idx];
    const canRest = canRestoreSchoolYear(before);
    if (!canRest.isValid) {
      return Err(Errors.validation(canRest.errors.join(" "), canRest.errors.join(" ")));
    }

    const after: AcademicYear = { ...before, isArchived: false };
    store.academicYears[idx] = after;
    store.notifyAcademicYears();

    appendAudit({
      action: AuditActions.SchoolYearRestore,
      entityType: "academic_year",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Année scolaire restaurée : ${after.label}`,
    });

    return Ok(after);
  }

  async deleteAcademicYear(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<void>> {
    await delay(120);
    const year = store.academicYears.find((y) => y.id === id);
    if (!year) return Err(Errors.notFound("Academic year", id));

    const classCount = store.classes.filter((c) => c.academicYearId === id).length;
    const studentCount = store.students.filter(
      (s) => s.classId && store.classes.some((c) => c.id === s.classId && c.academicYearId === id),
    ).length;
    const canDel = canDeleteSchoolYear(year, classCount, studentCount);
    if (!canDel.isValid) {
      return Err(Errors.validation(canDel.errors.join(" "), canDel.errors.join(" ")));
    }

    store.academicYears = store.academicYears.filter((y) => y.id !== id);
    store.notifyAcademicYears();

    appendAudit({
      action: AuditActions.SchoolYearDelete,
      entityType: "academic_year",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { code: year.code, label: year.label }, after: null },
      note: `Année scolaire supprimée : ${year.label}`,
    });

    return Ok(undefined);
  }
}

export const mockAcademicYearRepository: AcademicYearRepository =
  new MockAcademicYearRepository();
