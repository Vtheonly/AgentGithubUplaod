/**
 * Integration tests for the Teacher repository.
 *
 * Verifies:
 *   - Teacher CRUD (create/update/delete)
 *   - Referential integrity: createTeacher checks personnelId exists + is teacher
 *   - Duplicate code + duplicate person+year detection
 *   - Subject assignment + primary teacher enforcement
 *   - Timetable conflict detection (same teacher/class, overlapping time)
 *   - CASCADE: deleting a teacher removes assignments + timetable entries
 *   - FINANCE ISOLATION: teacher operations don't touch finance
 */
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { MockTeacherRepository } from "../../infrastructure/mock/repositories/teacher-repository";
import type { Payment, Installment } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";

const ACTOR = { actorId: "usr-test", actorName: "Test User" };

function snapshotFinance() {
  return {
    payments: [...store.payments] as Payment[],
    installments: [...store.installments] as Installment[],
    ledger: [...store.ledger] as LedgerEntry[],
  };
}

describe("Teacher Repository — CRUD + referential integrity", () => {
  let repo: MockTeacherRepository;

  beforeEach(() => {
    repo = new MockTeacherRepository();
  });

  it("creates a teacher from existing personnel", async () => {
    const res = await repo.createTeacher(
      {
        personnelId: "per-001", // exists, staffCategory=teacher
        code: "ENS-TEST-001",
        academicYearId: "ay-2026-2027",
        academicYearCode: "2026-2027",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.personnelId).toBe("per-001");
    expect((res as any).value.firstName).toBe("Aïcha");
    expect((res as any).value.status).toBe("active");
  });

  it("rejects creation with non-existent personnel", async () => {
    const res = await repo.createTeacher(
      {
        personnelId: "per-nonexistent",
        code: "ENS-TEST-002",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/n'existe pas/);
  });

  it("rejects creation when personnel is not a teacher (staffCategory)", async () => {
    // per-007 is a psychologist (not a teacher) in seed
    const res = await repo.createTeacher(
      {
        personnelId: "per-007",
        code: "ENS-TEST-003",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/enseignant/);
  });

  it("rejects duplicate teacher code", async () => {
    const res = await repo.createTeacher(
      {
        personnelId: "per-002",
        code: "ENS-2026-001", // already exists for tch-001
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/existe déjà/);
  });

  it("rejects duplicate person+year (same person can't have 2 teacher records for same year)", async () => {
    // per-001 already has tch-001 for ay-2025-2026
    const res = await repo.createTeacher(
      {
        personnelId: "per-001",
        code: "ENS-UNIQUE-001",
        academicYearId: "ay-2025-2026", // same year
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/déjà un enregistrement/);
  });

  it("allows same person in different academic year", async () => {
    const res = await repo.createTeacher(
      {
        personnelId: "per-001",
        code: "ENS-2028-001",
        academicYearId: "ay-2027-2028", // different year from any previous test
        academicYearCode: "2027-2028",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
  });

  it("updates teacher status + maxWeeklyHours", async () => {
    const res = await repo.updateTeacher(
      "tch-001",
      { status: "on_leave", maxWeeklyHours: 18 },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.status).toBe("on_leave");
    expect((res as any).value.maxWeeklyHours).toBe(18);
  });

  it("FINANCE ISOLATION: teacher operations don't touch finance", async () => {
    const before = snapshotFinance();
    await repo.createTeacher(
      {
        personnelId: "per-003",
        code: "ENS-FIN-TEST",
        academicYearId: "ay-2026-2027",
        academicYearCode: "2026-2027",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    await repo.updateTeacher(
      "tch-002",
      { maxWeeklyHours: 25 },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    const after = snapshotFinance();
    expect(after.payments.length).toBe(before.payments.length);
    expect(after.installments.length).toBe(before.installments.length);
    expect(after.ledger.length).toBe(before.ledger.length);
  });
});

describe("Teacher ↔ Subject Assignment", () => {
  let repo: MockTeacherRepository;

  beforeEach(() => {
    repo = new MockTeacherRepository();
  });

  it("assigns a subject to a teacher", async () => {
    const res = await repo.assignSubject(
      {
        teacherId: "tch-001",
        subjectId: "sub-004",
        academicYearId: "ay-2025-2026",
        isPrimary: false,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.teacherId).toBe("tch-001");
    expect((res as any).value.subjectId).toBe("sub-004");
  });

  it("rejects duplicate assignment", async () => {
    // tsa-001 already links tch-001 → sub-003
    const res = await repo.assignSubject(
      {
        teacherId: "tch-001",
        subjectId: "sub-003",
        academicYearId: "ay-2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/déjà assigné/);
  });

  it("rejects second primary teacher for same subject+year", async () => {
    // sub-003 already has tch-001 as primary (tsa-001)
    // Try to make tch-003 (Nadia — not yet assigned to sub-003) primary for sub-003
    const res = await repo.assignSubject(
      {
        teacherId: "tch-003",
        subjectId: "sub-003",
        academicYearId: "ay-2025-2026",
        isPrimary: true,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/enseignant principal/);
  });

  it("updates Subject.teacherId when primary assignment is created", async () => {
    // Assign tch-003 as primary for sub-009 (Échecs — currently no teacher)
    const res = await repo.assignSubject(
      {
        teacherId: "tch-003",
        subjectId: "sub-009",
        academicYearId: "ay-2025-2026",
        isPrimary: true,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);

    // Verify Subject was updated
    const subject = store.subjects.find((s) => s.id === "sub-009");
    expect(subject?.teacherId).toBe("tch-003");
    expect(subject?.teacherName).toContain("Nadia");
  });

  it("unassigns a subject", async () => {
    const before = store.teacherSubjectAssignments.length;
    const res = await repo.unassignSubject("tsa-001", ACTOR.actorId, ACTOR.actorName);
    expect(res.ok).toBe(true);
    expect(store.teacherSubjectAssignments.length).toBe(before - 1);
  });
});

describe("Timetable (Emploi du Temps)", () => {
  let repo: MockTeacherRepository;

  beforeEach(() => {
    repo = new MockTeacherRepository();
  });

  it("creates a timetable entry referencing Teacher (not Account)", async () => {
    const res = await repo.createTimetableEntry(
      {
        academicYearId: "ay-2025-2026",
        classId: "cls-001",
        teacherId: "tch-001",
        subjectId: "sub-001",
        day: "friday",
        startMinutes: 540,
        endMinutes: 600,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.teacherId).toBe("tch-001");
  });

  it("rejects timetable entry with non-existent teacher", async () => {
    const res = await repo.createTimetableEntry(
      {
        academicYearId: "ay-2025-2026",
        classId: "cls-001",
        teacherId: "tch-nonexistent",
        subjectId: "sub-001",
        day: "monday",
        startMinutes: 480,
        endMinutes: 540,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
  });

  it("detects same-teacher time conflict", async () => {
    // tch-001 already has cls-001 monday 480-540 (tt-001)
    // Try to add another entry for tch-001 monday 510-570 (overlaps)
    const res = await repo.createTimetableEntry(
      {
        academicYearId: "ay-2025-2026",
        classId: "cls-002", // different class
        teacherId: "tch-001", // SAME teacher
        subjectId: "sub-002",
        day: "monday",
        startMinutes: 510,
        endMinutes: 570,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/Conflit/);
  });

  it("detects same-class time conflict", async () => {
    // cls-001 monday 480-540 (tt-001)
    // Try to add another entry for cls-001 monday 510-570 with different teacher
    const res = await repo.createTimetableEntry(
      {
        academicYearId: "ay-2025-2026",
        classId: "cls-001", // SAME class
        teacherId: "tch-002", // different teacher
        subjectId: "sub-002",
        day: "monday",
        startMinutes: 510,
        endMinutes: 570,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/Conflit/);
  });

  it("allows non-overlapping entries for same teacher", async () => {
    // tch-001 monday has 480-540 (tt-001), 540-600 (tt-002), 600-660 (tt-003)
    // Add a new entry on friday 660-720 (11:00-12:00) — no conflict
    const res = await repo.createTimetableEntry(
      {
        academicYearId: "ay-2025-2026",
        classId: "cls-001",
        teacherId: "tch-001",
        subjectId: "sub-002",
        day: "friday",
        startMinutes: 660,
        endMinutes: 720,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
  });

  it("updates a timetable entry", async () => {
    const res = await repo.updateTimetableEntry(
      "tt-001",
      { room: "C-NEW", notes: "Salle changée" },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.room).toBe("C-NEW");
    expect((res as any).value.notes).toBe("Salle changée");
  });

  it("deletes a timetable entry", async () => {
    const before = store.timetableEntries.length;
    const res = await repo.deleteTimetableEntry("tt-001", ACTOR.actorId, ACTOR.actorName);
    expect(res.ok).toBe(true);
    expect(store.timetableEntries.length).toBe(before - 1);
  });

  it("FINANCE ISOLATION: timetable operations don't touch finance", async () => {
    const before = snapshotFinance();
    await repo.createTimetableEntry(
      {
        academicYearId: "ay-2025-2026",
        classId: "cls-001",
        teacherId: "tch-001",
        subjectId: "sub-001",
        day: "wednesday",
        startMinutes: 660,
        endMinutes: 720,
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    const after = snapshotFinance();
    expect(after.payments.length).toBe(before.payments.length);
    expect(after.installments.length).toBe(before.installments.length);
    expect(after.ledger.length).toBe(before.ledger.length);
  });
});

// Runs LAST — deletes tch-001 and cascades. Must be after all other tests
// that depend on tch-001 existing.
describe("Teacher Repository — cascade delete (runs last)", () => {
  it("deletes teacher and cascades to assignments + timetable", async () => {
    const repo = new MockTeacherRepository();
    const assignmentsBefore = store.teacherSubjectAssignments.filter(
      (a) => a.teacherId === "tch-001",
    ).length;
    const timetableBefore = store.timetableEntries.filter(
      (e) => e.teacherId === "tch-001",
    ).length;
    expect(assignmentsBefore).toBeGreaterThan(0);
    expect(timetableBefore).toBeGreaterThan(0);

    const res = await repo.deleteTeacher("tch-001", ACTOR.actorId, ACTOR.actorName);
    expect(res.ok).toBe(true);

    expect(
      store.teacherSubjectAssignments.filter((a) => a.teacherId === "tch-001").length,
    ).toBe(0);
    expect(
      store.timetableEntries.filter((e) => e.teacherId === "tch-001").length,
    ).toBe(0);
  });
});
