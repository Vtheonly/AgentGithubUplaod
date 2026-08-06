/**
 * Mock ClubRepository — Clubs + Memberships + Activities (plan §05.07).
 *
 * FINANCE ISOLATION: This repository ONLY touches club-related collections.
 * It does NOT touch ledger / payments / installments / debt. Billing for
 * clubs is handled by Finance via the complementary-services pricing.
 */
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import type {
  Club,
  ClubMembership,
  ClubActivity,
  CreateClubInput,
  UpdateClubInput,
  EnrollMemberInput,
  WithdrawMemberInput,
  LogActivityInput,
} from "../../../domain/model/club";
import type { ClubRepository } from "../../../domain/repository/club-repository";
import type { Observable } from "../../../domain/repository/repository";
import { SubjectBehavior } from "../subject-behavior";
import {
  validateCreateClubInput,
  validateUpdateClubInput,
  validateEnrollMemberInput,
  validateWithdrawMemberInput,
  validateLogActivityInput,
  canEnrollMember,
  canArchiveClub,
  canRestoreClub,
  canDeleteClub,
  checkDuplicateClubCode,
} from "../../../domain/calc/clubs/validation";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function lookupStudent(studentId: string) {
  return store.students.find((s) => s.id === studentId);
}

export class MockClubRepository implements ClubRepository {
  // ---- Catalog ----
  observe(): Observable<Club[]> {
    return store.clubs$;
  }

  observeById(id: string): Observable<Club | null> {
    return new SubjectBehavior(store.clubs.find((c) => c.id === id) ?? null);
  }

  observeByAcademicYear(academicYearId: string): Observable<Club[]> {
    return new SubjectBehavior(
      store.clubs.filter((c) => c.academicYearId === academicYearId),
    );
  }

  async getById(id: string): Promise<Result<Club>> {
    await delay(50);
    const club = store.clubs.find((c) => c.id === id);
    if (!club) return Err(Errors.notFound("Club", id));
    return Ok(club);
  }

  async createClub(
    input: CreateClubInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<Club>> {
    await delay(150);
    const validation = validateCreateClubInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const dupCheck = checkDuplicateClubCode(input.code, store.clubs);
    if (!dupCheck.isValid) {
      return Err(Errors.validation(dupCheck.errors.join(" "), dupCheck.errors.join(" ")));
    }

    const club: Club = {
      id: genId("club"),
      tenantId: TENANT_ID,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      capacity: input.capacity ?? null,
      supervisorId: input.supervisorId ?? null,
      supervisorName: input.supervisorName ?? null,
      academicYearId: input.academicYearId,
      academicYearCode: input.academicYearCode,
      isActive: true,
      isArchived: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.clubs = [...store.clubs, club];
    store.notifyClubs();

    appendAudit({
      action: AuditActions.ClubCreate,
      entityType: "club",
      entityId: club.id,
      actorId,
      actorName,
      diff: { before: null, after: { code: club.code, name: club.name } },
      note: `Club créé : ${club.name} (${club.code})`,
    });

    return Ok(club);
  }

  async updateClub(
    id: string,
    input: UpdateClubInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<Club>> {
    await delay(120);
    const idx = store.clubs.findIndex((c) => c.id === id);
    if (idx < 0) return Err(Errors.notFound("Club", id));

    const before = store.clubs[idx];
    const validation = validateUpdateClubInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    const after: Club = {
      ...before,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.supervisorId !== undefined ? { supervisorId: input.supervisorId } : {}),
      ...(input.supervisorName !== undefined ? { supervisorName: input.supervisorName } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: nowIso(),
    };

    store.clubs[idx] = after;
    store.notifyClubs();

    appendAudit({
      action: AuditActions.ClubUpdate,
      entityType: "club",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Club modifié : ${after.name}`,
    });

    return Ok(after);
  }

  async archiveClub(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<Club>> {
    await delay(120);
    const idx = store.clubs.findIndex((c) => c.id === id);
    if (idx < 0) return Err(Errors.notFound("Club", id));

    const before = store.clubs[idx];
    const activeMemberships = store.clubMemberships.filter(
      (m) => m.clubId === id && m.status === "active",
    );
    const canArch = canArchiveClub(before, activeMemberships.length);
    if (!canArch.isValid) {
      return Err(Errors.validation(canArch.errors.join(" "), canArch.errors.join(" ")));
    }

    // Bulk-withdraw all active memberships with system reason
    if (activeMemberships.length > 0) {
      store.clubMemberships = store.clubMemberships.map((m) =>
        m.clubId === id && m.status === "active"
          ? {
              ...m,
              status: "withdrawn" as const,
              withdrawnAt: nowIso(),
              withdrawnReason: "Club archivé",
            }
          : m,
      );
      store.notifyClubMemberships();
    }

    const after: Club = { ...before, isArchived: true, isActive: false, updatedAt: nowIso() };
    store.clubs[idx] = after;
    store.notifyClubs();

    appendAudit({
      action: AuditActions.ClubArchive,
      entityType: "club",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Club archivé : ${after.name} (${activeMemberships.length} adhésions clôturées)`,
    });

    return Ok(after);
  }

  async restoreClub(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<Club>> {
    await delay(120);
    const idx = store.clubs.findIndex((c) => c.id === id);
    if (idx < 0) return Err(Errors.notFound("Club", id));

    const before = store.clubs[idx];
    const canRest = canRestoreClub(before);
    if (!canRest.isValid) {
      return Err(Errors.validation(canRest.errors.join(" "), canRest.errors.join(" ")));
    }

    const after: Club = { ...before, isArchived: false };
    store.clubs[idx] = after;
    store.notifyClubs();

    appendAudit({
      action: AuditActions.ClubRestore,
      entityType: "club",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Club restauré : ${after.name}`,
    });

    return Ok(after);
  }

  async deleteClub(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<void>> {
    await delay(120);
    const club = store.clubs.find((c) => c.id === id);
    if (!club) return Err(Errors.notFound("Club", id));

    const totalMemberships = store.clubMemberships.filter((m) => m.clubId === id).length;
    const activityCount = store.clubActivities.filter((a) => a.clubId === id).length;
    const canDel = canDeleteClub(club, totalMemberships, activityCount);
    if (!canDel.isValid) {
      return Err(Errors.validation(canDel.errors.join(" "), canDel.errors.join(" ")));
    }

    store.clubs = store.clubs.filter((c) => c.id !== id);
    store.notifyClubs();

    appendAudit({
      action: AuditActions.ClubDelete,
      entityType: "club",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { code: club.code, name: club.name }, after: null },
      note: `Club supprimé : ${club.name}`,
    });

    return Ok(undefined);
  }

  // ---- Memberships ----
  observeMemberships(clubId: string): Observable<ClubMembership[]> {
    return new SubjectBehavior(
      store.clubMemberships.filter((m) => m.clubId === clubId),
    );
  }

  observeMembershipsByStudent(studentId: string): Observable<ClubMembership[]> {
    return new SubjectBehavior(
      store.clubMemberships.filter((m) => m.studentId === studentId),
    );
  }

  async enrollMember(input: EnrollMemberInput): Promise<Result<ClubMembership>> {
    await delay(120);
    const validation = validateEnrollMemberInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const club = store.clubs.find((c) => c.id === input.clubId);
    if (!club) return Err(Errors.notFound("Club", input.clubId));

    const student = lookupStudent(input.studentId);
    if (!student) return Err(Errors.notFound("Student", input.studentId));

    const existingActive = store.clubMemberships.filter(
      (m) => m.clubId === input.clubId && m.status === "active",
    );
    const alreadyActive = existingActive.some((m) => m.studentId === input.studentId);
    const canEnroll = canEnrollMember(club, existingActive, alreadyActive);
    if (!canEnroll.isValid) {
      return Err(Errors.validation(canEnroll.errors.join(" "), canEnroll.errors.join(" ")));
    }

    const membership: ClubMembership = {
      id: genId("cm"),
      tenantId: TENANT_ID,
      clubId: input.clubId,
      studentId: input.studentId,
      studentName: `${student.firstName} ${student.lastName}`,
      studentCode: student.code,
      enrolledAt: nowIso(),
      enrolledById: input.enrolledById,
      enrolledByName: input.enrolledByName,
      status: "active",
      withdrawnAt: null,
      withdrawnReason: null,
      notes: input.notes ?? null,
    };

    store.clubMemberships = [...store.clubMemberships, membership];
    store.notifyClubMemberships();

    appendAudit({
      action: AuditActions.ClubMemberEnroll,
      entityType: "club_membership",
      entityId: membership.id,
      actorId: input.enrolledById,
      actorName: input.enrolledByName,
      diff: { before: null, after: { clubId: club.id, studentId: student.id } },
      note: `${membership.studentName} inscrit au club ${club.name}`,
    });

    return Ok(membership);
  }

  async withdrawMember(input: WithdrawMemberInput): Promise<Result<ClubMembership>> {
    await delay(120);
    const validation = validateWithdrawMemberInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const idx = store.clubMemberships.findIndex((m) => m.id === input.membershipId);
    if (idx < 0) return Err(Errors.notFound("ClubMembership", input.membershipId));

    const before = store.clubMemberships[idx];
    if (before.status === "withdrawn") {
      return Err(Errors.validation("L'adhésion est déjà retirée.", "L'adhésion est déjà retirée."));
    }

    const after: ClubMembership = {
      ...before,
      status: "withdrawn",
      withdrawnAt: nowIso(),
      withdrawnReason: input.reason ?? null,
    };
    store.clubMemberships[idx] = after;
    store.notifyClubMemberships();

    appendAudit({
      action: AuditActions.ClubMemberWithdraw,
      entityType: "club_membership",
      entityId: after.id,
      actorId: input.withdrawnById,
      actorName: input.withdrawnByName,
      diff: { before, after },
      note: `${after.studentName} retiré du club`,
    });

    return Ok(after);
  }

  async withdrawAllMembers(
    clubId: string,
    actorId: string,
    actorName: string,
    reason: string,
  ): Promise<Result<number>> {
    await delay(150);
    let count = 0;
    store.clubMemberships = store.clubMemberships.map((m) => {
      if (m.clubId === clubId && m.status === "active") {
        count++;
        return {
          ...m,
          status: "withdrawn" as const,
          withdrawnAt: nowIso(),
          withdrawnReason: reason,
        };
      }
      return m;
    });
    store.notifyClubMemberships();

    if (count > 0) {
      appendAudit({
        action: AuditActions.ClubMemberWithdraw,
        entityType: "club_membership",
        entityId: `bulk-${clubId}`,
        actorId,
        actorName,
        diff: { before: null, after: { count, reason } },
        note: `${count} adhésion(s) retirée(s) en masse — motif : ${reason}`,
      });
    }

    return Ok(count);
  }

  // ---- Activities ----
  observeActivities(clubId: string): Observable<ClubActivity[]> {
    return new SubjectBehavior(
      store.clubActivities
        .filter((a) => a.clubId === clubId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    );
  }

  async logActivity(input: LogActivityInput): Promise<Result<ClubActivity>> {
    await delay(120);
    const validation = validateLogActivityInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const club = store.clubs.find((c) => c.id === input.clubId);
    if (!club) return Err(Errors.notFound("Club", input.clubId));

    const activity: ClubActivity = {
      id: genId("ca"),
      tenantId: TENANT_ID,
      clubId: input.clubId,
      title: input.title,
      description: input.description,
      date: input.date,
      durationMinutes: input.durationMinutes,
      conductedById: input.conductedById,
      conductedByName: input.conductedByName,
      attendeeStudentIds: input.attendeeStudentIds,
      createdAt: nowIso(),
    };

    store.clubActivities = [activity, ...store.clubActivities];
    store.notifyClubActivities();

    appendAudit({
      action: AuditActions.ClubActivityLog,
      entityType: "club_activity",
      entityId: activity.id,
      actorId: input.conductedById,
      actorName: input.conductedByName,
      diff: { before: null, after: { clubId: club.id, title: activity.title } },
      note: `Activité logée pour ${club.name} : ${activity.title}`,
    });

    return Ok(activity);
  }

  async deleteActivity(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<void>> {
    await delay(100);
    const activity = store.clubActivities.find((a) => a.id === id);
    if (!activity) return Err(Errors.notFound("ClubActivity", id));

    store.clubActivities = store.clubActivities.filter((a) => a.id !== id);
    store.notifyClubActivities();

    appendAudit({
      action: AuditActions.ClubActivityDelete,
      entityType: "club_activity",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { title: activity.title }, after: null },
      note: `Activité supprimée : ${activity.title}`,
    });

    return Ok(undefined);
  }
}

export const mockClubRepository: ClubRepository = new MockClubRepository();
