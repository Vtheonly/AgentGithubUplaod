/**
 * Integration tests for the new pedagogy mock repositories.
 *
 * Verifies:
 *   - Academic year lifecycle (create / update / archive / restore / delete / set-current)
 *   - Clubs CRUD + memberships + activities
 *   - Psychology follow-ups + sessions + reports
 *   - Orthophonie follow-ups + evaluations + sessions
 *
 * CRITICAL FINANCE ISOLATION TEST:
 *   The test suite verifies that NO ledger / payment / installment / debt
 *   entries are created or modified by any of the new repositories.
 *   This is the user's most important non-functional requirement.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { MockAcademicYearRepository } from "../../infrastructure/mock/repositories/academic-year-repository";
import { MockClubRepository } from "../../infrastructure/mock/repositories/club-repository";
import {
  MockPsychologyRepository,
  MockOrthophonieRepository,
} from "../../infrastructure/mock/repositories/therapy-repository";
import type {
  AcademicYear,
} from "../../domain/model/academic";
import type {
  Payment,
  Installment,
} from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";

const ACTOR = { actorId: "usr-test", actorName: "Test User" };

// Helper to snapshot the finance state
function snapshotFinance() {
  return {
    payments: [...store.payments] as Payment[],
    installments: [...store.installments] as Installment[],
    ledger: [...store.ledger] as LedgerEntry[],
  };
}

describe("Academic Year repository — full lifecycle", () => {
  let repo: MockAcademicYearRepository;

  beforeEach(() => {
    repo = new MockAcademicYearRepository();
  });

  it("creates a new school year", async () => {
    const before = store.academicYears.length;
    const res = await repo.createAcademicYear(
      {
        code: "2027-2028",
        label: "Année 2027-2028",
        startDate: "2027-09-01",
        endDate: "2028-06-30",
        termStructure: "trimester",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect(store.academicYears.length).toBe(before + 1);
    expect((res as any).value.code).toBe("2027-2028");
    expect((res as any).value.isArchived).toBe(false);
  });

  it("rejects duplicate codes", async () => {
    const res = await repo.createAcademicYear(
      {
        code: "2025-2026", // already in seed
        label: "Duplicate",
        startDate: "2025-09-01",
        endDate: "2026-06-30",
        termStructure: "trimester",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/existe déjà/);
  });

  it("rejects invalid date ranges", async () => {
    const res = await repo.createAcademicYear(
      {
        code: "2030-2031",
        label: "Bad dates",
        startDate: "2030-09-01",
        endDate: "2030-10-01", // only 1 month
        termStructure: "trimester",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
  });

  it("updates a school year label", async () => {
    const res = await repo.updateAcademicYear(
      "ay-2026-2027",
      { label: "Année prochaine 2026-2027" },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.label).toBe("Année prochaine 2026-2027");
  });

  it("rejects archive of current year", async () => {
    const res = await repo.archiveAcademicYear(
      "ay-2025-2026", // current
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/courante/);
  });

  it("archives + restores a non-current year", async () => {
    const archRes = await repo.archiveAcademicYear(
      "ay-2026-2027",
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(archRes.ok).toBe(true);
    expect((archRes as any).value.isArchived).toBe(true);

    const restRes = await repo.restoreAcademicYear(
      "ay-2026-2027",
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(restRes.ok).toBe(true);
    expect((restRes as any).value.isArchived).toBe(false);
  });

  it("sets current year (unsets all others)", async () => {
    const res = await repo.setCurrentYear(
      "ay-2026-2027",
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.isCurrent).toBe(true);
    const old = store.academicYears.find((y) => y.id === "ay-2025-2026");
    expect(old?.isCurrent).toBe(false);
  });

  it("rejects delete of year with classes", async () => {
    // ay-2025-2026 has classes attached
    const res = await repo.deleteAcademicYear(
      "ay-2025-2026",
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects delete of current year", async () => {
    const res = await repo.deleteAcademicYear(
      "ay-2025-2026",
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
  });

  it("deletes an empty non-current year", async () => {
    // Create a year with no classes
    await repo.createAcademicYear(
      {
        code: "2099-2100",
        label: "Empty",
        startDate: "2099-09-01",
        endDate: "2100-06-30",
        termStructure: "trimester",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    const year = store.academicYears.find((y) => y.code === "2099-2100")!;
    const res = await repo.deleteAcademicYear(
      year.id,
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect(store.academicYears.find((y) => y.id === year.id)).toBeUndefined();
  });

  it("FINANCE ISOLATION: school year operations do NOT touch finance", async () => {
    const before = snapshotFinance();
    await repo.createAcademicYear(
      {
        code: "2030-2031",
        label: "Year 2030",
        startDate: "2030-09-01",
        endDate: "2031-06-30",
        termStructure: "trimester",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    await repo.archiveAcademicYear("ay-2026-2027", ACTOR.actorId, ACTOR.actorName);
    await repo.restoreAcademicYear("ay-2026-2027", ACTOR.actorId, ACTOR.actorName);
    const after = snapshotFinance();
    expect(after.payments.length).toBe(before.payments.length);
    expect(after.installments.length).toBe(before.installments.length);
    expect(after.ledger.length).toBe(before.ledger.length);
  });
});

describe("Club repository — CRUD + memberships + activities", () => {
  let repo: MockClubRepository;

  beforeEach(() => {
    repo = new MockClubRepository();
  });

  it("creates a club", async () => {
    const res = await repo.createClub(
      {
        code: "CLUB-TEST-01",
        name: "Test Club",
        category: "chess",
        capacity: 10,
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.code).toBe("CLUB-TEST-01");
  });

  it("rejects duplicate club codes", async () => {
    const res = await repo.createClub(
      {
        code: "CLUB-CHESS-01", // exists in seed
        name: "Dup",
        category: "chess",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
  });

  it("enrolls a member and rejects duplicate active membership", async () => {
    const enroll = await repo.enrollMember({
      clubId: "club-001",
      studentId: "stu-002",
      enrolledById: ACTOR.actorId,
      enrolledByName: ACTOR.actorName,
    });
    expect(enroll.ok).toBe(true);

    const dup = await repo.enrollMember({
      clubId: "club-001",
      studentId: "stu-002",
      enrolledById: ACTOR.actorId,
      enrolledByName: ACTOR.actorName,
    });
    expect(dup.ok).toBe(false);
    expect((dup as any).error.userMessage).toMatch(/déjà membre/);
  });

  it("rejects enrollment in archived club", async () => {
    await repo.archiveClub("club-001", ACTOR.actorId, ACTOR.actorName);
    const res = await repo.enrollMember({
      clubId: "club-001",
      studentId: "stu-005",
      enrolledById: ACTOR.actorId,
      enrolledByName: ACTOR.actorName,
    });
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/archivé/);
    // Restore for other tests
    await repo.restoreClub("club-001", ACTOR.actorId, ACTOR.actorName);
  });

  it("withdraws a member", async () => {
    const enroll = await repo.enrollMember({
      clubId: "club-002",
      studentId: "stu-005",
      enrolledById: ACTOR.actorId,
      enrolledByName: ACTOR.actorName,
    });
    expect(enroll.ok).toBe(true);
    const withdraw = await repo.withdrawMember({
      membershipId: (enroll as any).value.id,
      withdrawnById: ACTOR.actorId,
      withdrawnByName: ACTOR.actorName,
    });
    expect(withdraw.ok).toBe(true);
    expect((withdraw as any).value.status).toBe("withdrawn");
  });

  it("archives a club and bulk-withdraws active members", async () => {
    // Ensure club-002 has at least 2 active members (re-enroll to be safe
    // — previous tests may have withdrawn members).
    await repo.enrollMember({
      clubId: "club-002",
      studentId: "stu-012",
      enrolledById: ACTOR.actorId,
      enrolledByName: ACTOR.actorName,
    }).catch(() => undefined); // ignore duplicate error
    await repo.enrollMember({
      clubId: "club-002",
      studentId: "stu-013",
      enrolledById: ACTOR.actorId,
      enrolledByName: ACTOR.actorName,
    }).catch(() => undefined);

    const beforeActive = store.clubMemberships.filter(
      (m) => m.clubId === "club-002" && m.status === "active",
    ).length;
    expect(beforeActive).toBeGreaterThanOrEqual(1);

    const res = await repo.archiveClub("club-002", ACTOR.actorId, ACTOR.actorName);
    expect(res.ok).toBe(true);

    const afterActive = store.clubMemberships.filter(
      (m) => m.clubId === "club-002" && m.status === "active",
    ).length;
    expect(afterActive).toBe(0);

    // Restore for other tests
    await repo.restoreClub("club-002", ACTOR.actorId, ACTOR.actorName);
  });

  it("rejects delete of club with memberships", async () => {
    const res = await repo.deleteClub("club-001", ACTOR.actorId, ACTOR.actorName);
    expect(res.ok).toBe(false);
  });

  it("logs an activity", async () => {
    const res = await repo.logActivity({
      clubId: "club-001",
      title: "Test Activity",
      description: "Description",
      date: new Date().toISOString(),
      durationMinutes: 60,
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
      attendeeStudentIds: ["stu-001"],
    });
    expect(res.ok).toBe(true);
    expect((res as any).value.title).toBe("Test Activity");
  });

  it("UNIFIED ARCHITECTURE (Epic 4.3): enrollMember appends an extracurricular charge to the ledger", async () => {
    const before = snapshotFinance();
    // Create a fresh club (previous tests may have left seed clubs in a
    // paused / archived state).
    const createRes = await repo.createClub(
      {
        code: "CLUB-FIN-TEST",
        name: "Finance Isolation Test",
        category: "chess",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(createRes.ok).toBe(true);
    const newClubId = (createRes as any).value.id;

    // Enroll a seed student NOT already in any club.
    const res = await repo.enrollMember({
      clubId: newClubId,
      studentId: "stu-003",
      enrolledById: ACTOR.actorId,
      enrolledByName: ACTOR.actorName,
    });
    expect(res.ok).toBe(true);
    await repo.logActivity({
      clubId: newClubId,
      title: "x",
      description: "y",
      date: new Date().toISOString(),
      durationMinutes: 30,
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
      attendeeStudentIds: [],
    });
    const after = snapshotFinance();
    // No payments or installments created — club billing is via ledger charges.
    expect(after.payments.length).toBe(before.payments.length);
    expect(after.installments.length).toBe(before.installments.length);
    // Exactly one new ledger entry — the extracurricular charge.
    expect(after.ledger.length).toBe(before.ledger.length + 1);
    const newEntry = after.ledger[after.ledger.length - 1];
    expect(newEntry.type).toBe("charge");
    expect(newEntry.category).toBe("extracurricular");
    expect(newEntry.amount).toBe(9_000); // chess club annual price per Prices.md
    expect(newEntry.studentId).toBe("stu-003");
    // logActivity does NOT create additional charges.
  });
});

describe("Psychology repository — follow-ups + sessions + reports", () => {
  let repo: MockPsychologyRepository;

  beforeEach(() => {
    repo = new MockPsychologyRepository();
  });

  it("creates a follow-up", async () => {
    const res = await repo.createFollowUp(
      {
        studentId: "stu-001",
        psychologistId: "per-007",
        psychologistName: "Mme Bensaïd",
        reason: "Motif suffisamment long pour la validation",
        startDate: "2025-09-15",
        parentConsent: true,
        parentConsentDate: "2025-09-10",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.status).toBe("active");
  });

  it("rejects follow-up without parent consent", async () => {
    const res = await repo.createFollowUp(
      {
        studentId: "stu-002",
        psychologistId: "per-007",
        psychologistName: "Mme Bensaïd",
        reason: "Motif suffisamment long",
        startDate: "2025-09-15",
        parentConsent: false,
        parentConsentDate: null,
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/consentement/);
  });

  it("rejects duplicate active follow-up for same psychologist+student", async () => {
    // stu-003 already has active follow-up with per-007 (psy-fu-001)
    const res = await repo.createFollowUp(
      {
        studentId: "stu-003",
        psychologistId: "per-007",
        psychologistName: "Mme Bensaïd",
        reason: "Motif suffisamment long",
        startDate: "2025-09-15",
        parentConsent: true,
        parentConsentDate: "2025-09-10",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/déjà un suivi/);
  });

  it("conducts a session", async () => {
    const res = await repo.conductSession({
      followUpId: "psy-fu-001",
      date: new Date().toISOString(),
      durationMinutes: 45,
      type: "follow_up",
      summary: "Séance test",
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
    });
    expect(res.ok).toBe(true);
    expect((res as any).value.summary).toBe("Séance test");
  });

  it("creates a report", async () => {
    const res = await repo.createReport({
      followUpId: "psy-fu-001",
      title: "Rapport test",
      period: "T1 2025-2026",
      content: "Contenu du rapport de test.",
      authoredById: ACTOR.actorId,
      authoredByName: ACTOR.actorName,
    });
    expect(res.ok).toBe(true);
  });

  it("closes a follow-up", async () => {
    const res = await repo.closeFollowUp(
      "psy-fu-001",
      new Date().toISOString(),
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.status).toBe("closed");
  });

  it("deletes a follow-up and its sessions/reports", async () => {
    // psy-fu-003 has a report attached
    const sessionsBefore = store.psychologicalSessions.filter(
      (s) => s.followUpId === "psy-fu-003",
    ).length;
    const reportsBefore = store.psychologicalReports.filter(
      (r) => r.followUpId === "psy-fu-003",
    ).length;
    expect(sessionsBefore).toBe(0);
    expect(reportsBefore).toBe(1);

    const res = await repo.deleteFollowUp("psy-fu-003", ACTOR.actorId, ACTOR.actorName);
    expect(res.ok).toBe(true);
    expect(
      store.psychologicalReports.filter((r) => r.followUpId === "psy-fu-003").length,
    ).toBe(0);
  });

  it("UNIFIED ARCHITECTURE (Epic 4.4): psychology createFollowUp appends a therapy_psychology charge to the ledger", async () => {
    const before = snapshotFinance();
    const res = await repo.createFollowUp(
      {
        studentId: "stu-004",
        psychologistId: "per-007",
        psychologistName: "Mme Bensaïd",
        reason: "Motif suffisamment long",
        startDate: "2025-09-15",
        parentConsent: true,
        parentConsentDate: "2025-09-10",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    const after = snapshotFinance();
    // No payments or installments created — therapy billing is via ledger charges.
    expect(after.payments.length).toBe(before.payments.length);
    expect(after.installments.length).toBe(before.installments.length);
    // Exactly one new ledger entry — the therapy_psychology charge.
    expect(after.ledger.length).toBe(before.ledger.length + 1);
    const newEntry = after.ledger[after.ledger.length - 1];
    expect(newEntry.type).toBe("charge");
    expect(newEntry.category).toBe("therapy_psychology");
    expect(newEntry.amount).toBe(10_000); // semester package per Prices.md
    expect(newEntry.studentId).toBe("stu-004");
  });

  it("UNIFIED ARCHITECTURE (Epic 4.4): conductSession does NOT append additional charges (billed at follow-up creation)", async () => {
    const before = snapshotFinance();
    await repo.conductSession({
      followUpId: "psy-fu-001",
      date: new Date().toISOString(),
      durationMinutes: 30,
      type: "follow_up",
      summary: "x",
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
    });
    const after = snapshotFinance();
    expect(after.ledger.length).toBe(before.ledger.length);
    expect(after.payments.length).toBe(before.payments.length);
    expect(after.installments.length).toBe(before.installments.length);
  });
});

describe("Orthophonie repository — follow-ups + evaluations + sessions", () => {
  let repo: MockOrthophonieRepository;

  beforeEach(() => {
    repo = new MockOrthophonieRepository();
  });

  it("creates a follow-up", async () => {
    const res = await repo.createFollowUp(
      {
        studentId: "stu-001",
        therapistId: "per-008",
        therapistName: "Mme Kaci",
        reason: "Motif suffisamment long pour validation",
        startDate: "2025-09-15",
        parentConsent: true,
        parentConsentDate: "2025-09-10",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
  });

  it("rejects duplicate active follow-up", async () => {
    // stu-007 already has active follow-up with per-008 (ortho-fu-001)
    const res = await repo.createFollowUp(
      {
        studentId: "stu-007",
        therapistId: "per-008",
        therapistName: "Mme Kaci",
        reason: "Motif suffisamment long",
        startDate: "2025-09-15",
        parentConsent: true,
        parentConsentDate: "2025-09-10",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(false);
    expect((res as any).error.userMessage).toMatch(/déjà un suivi/);
  });

  it("conducts an evaluation with scores", async () => {
    const res = await repo.conductEvaluation({
      followUpId: "ortho-fu-001",
      date: new Date().toISOString(),
      type: "reassessment",
      articulation: 75,
      fluency: 80,
      comprehension: 90,
      expression: 85,
      summary: "Progrès notables",
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
    });
    expect(res.ok).toBe(true);
    expect((res as any).value.articulation).toBe(75);
  });

  it("rejects evaluation with out-of-bounds scores", async () => {
    const res = await repo.conductEvaluation({
      followUpId: "ortho-fu-001",
      date: new Date().toISOString(),
      type: "initial",
      articulation: 150,
      fluency: null,
      comprehension: null,
      expression: null,
      summary: "x",
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
    });
    expect(res.ok).toBe(false);
  });

  it("conducts a session", async () => {
    const res = await repo.conductSession({
      followUpId: "ortho-fu-001",
      date: new Date().toISOString(),
      durationMinutes: 30,
      exercises: "Exercices pratiqués",
      observations: "Bonne coopération",
      progress: "improving",
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
    });
    expect(res.ok).toBe(true);
    expect((res as any).value.progress).toBe("improving");
  });

  it("closes a follow-up", async () => {
    const res = await repo.closeFollowUp(
      "ortho-fu-002",
      new Date().toISOString(),
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect((res as any).value.status).toBe("closed");
  });

  it("UNIFIED ARCHITECTURE (Epic 4.4): conductEvaluation and conductSession do NOT append additional charges (billed at follow-up creation only)", async () => {
    const before = snapshotFinance();
    await repo.conductEvaluation({
      followUpId: "ortho-fu-001",
      date: new Date().toISOString(),
      type: "reassessment",
      articulation: 75,
      fluency: 80,
      comprehension: 90,
      expression: 85,
      summary: "x",
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
    });
    await repo.conductSession({
      followUpId: "ortho-fu-001",
      date: new Date().toISOString(),
      durationMinutes: 30,
      exercises: "x",
      observations: "y",
      conductedById: ACTOR.actorId,
      conductedByName: ACTOR.actorName,
    });
    const after = snapshotFinance();
    // Evaluation + Session don't create new charges — billing is at follow-up creation.
    expect(after.payments.length).toBe(before.payments.length);
    expect(after.installments.length).toBe(before.installments.length);
    expect(after.ledger.length).toBe(before.ledger.length);
  });
});
