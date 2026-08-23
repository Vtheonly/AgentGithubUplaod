/**
 * Mock StudentRepository — in-memory CRUD for students with reactive
 * observation, batch registration (atomic with rollback), and promotion.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including the iteration 6 logic
 * for atomic batch registration with snapshot-based rollback.
 */
import type {
  StudentRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { studentCode } from "../../../core/format/id";
import { derived } from "../subject-behavior";
import type {
  Student,
  CreateStudentInput,
  UpdateStudentInput,
  BatchRegistrationInput,
  BatchRegistrationResult,
  GradeLevel,
} from "../../../domain/model/student";
import { gradeLevelFromLevelYear } from "../../../domain/model/student";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";
import { defaultPricingConfig } from "../pricing-seed";
import {
  evaluateAllSystemDiscounts,
  sumDiscounts,
  splitNetTuitionByOfficialSchedule,
  getOfficialTuitionDueDates,
  tuitionForGradeLevel,
  transportTranchesForDestination,
} from "../../../domain/calc/pricing";
import { createChargeEntry } from "../../../domain/calc/ledger/entries";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Installment } from "../../../domain/model/payment";
import { MockParentRepository } from "./parent-repository";
import type { AppError } from "../../../core/result";

export class MockStudentRepository implements StudentRepository {
  observe(): Observable<Student[]> {
    return store.students$;
  }

  observeByParent(parentId: string): Observable<Student[]> {
    // FIX (reactivity): derive from the store stream so the parent drawer's
    // children list updates when students are created/edited/deleted.
    return derived([store.students$], () => store.students.filter((s) => s.parentId === parentId));
  }

  observeByClass(classId: string): Observable<Student[]> {
    return derived([store.students$], () => store.students.filter((s) => s.classId === classId));
  }

  observeById(id: string): Observable<Student | null> {
    return derived([store.students$], () => store.students.find((s) => s.id === id) ?? null);
  }

  async search(query: string): Promise<Result<Student[]>> {
    await delay(120);
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...store.students]);
    return Ok(
      store.students.filter((s) =>
        `${s.firstName} ${s.lastName} ${s.code}`.toLowerCase().includes(q),
      ),
    );
  }

  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    await delay(200);
    const year = new Date().getFullYear();
    // FIX (id collisions): derive the next sequence from the MAX existing
    // numeric suffix instead of `length + 1` — after a delete, `length + 1`
    // could reuse an id that still exists (duplicate React keys, wrong drawer).
    const seq = nextStudentSeq();
    // Iteration 6: derive gradeLevel if not provided explicitly.
    const gradeLevel: GradeLevel = input.gradeLevel ?? gradeLevelFromLevelYear(input.level, input.gradeYear);
    const student: Student = {
      id: `stu-${String(seq).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      code: studentCode(year, seq),
      parentId,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: input.displayName ?? `${input.firstName} ${input.lastName}`.trim(),
      gender: input.gender,
      birthDate: input.birthDate,
      enrollmentDate: nowIso(),
      level: input.level,
      gradeYear: input.gradeYear,
      gradeLevel,
      classId: input.classId ?? null,
      photoUrl: null,
      medicalNotes: input.medicalNotes ?? null,
      transportTier: input.transportTier ?? null,
      status: "active",
      paymentPlan: input.paymentPlan ?? "tranches",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.students.unshift(student);
    store.notifyStudents();
    appendAudit({
      action: AuditActions.StudentCreate,
      entityType: "student",
      entityId: student.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: { code: student.code } },
    });
    return Ok(student);
  }

  async updateStudent(id: string, updates: UpdateStudentInput): Promise<Result<Student>> {
    await delay(180);
    const idx = store.students.findIndex((s) => s.id === id);
    if (idx < 0) return Err(Errors.notFound("Student", id));
    const before = store.students[idx];
    // Iteration 6: re-derive gradeLevel if level/gradeYear were updated.
    const newLevel = updates.level ?? before.level;
    const newYear = updates.gradeYear ?? before.gradeYear;
    const newGradeLevel: GradeLevel =
      updates.gradeLevel ?? gradeLevelFromLevelYear(newLevel, newYear);
    const after: Student = {
      ...before,
      ...updates,
      level: newLevel,
      gradeYear: newYear,
      gradeLevel: newGradeLevel,
      updatedAt: nowIso(),
    };
    store.students[idx] = after;
    store.notifyStudents();
    appendAudit({
      action: AuditActions.StudentUpdate,
      entityType: "student",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after },
    });
    return Ok(after);
  }

  async deleteStudent(id: string): Promise<Result<void>> {
    await delay(180);
    // FIX (id collisions): only remove when present — the previous filter()
    // was fine, but callers relied on `store.students.length + 1` ids which
    // could collide after a delete. Id generation now uses a max-seq scan
    // (see nextId) so deletes can never cause id reuse.
    const existed = store.students.some((s) => s.id === id);
    if (!existed) return Err(Errors.notFound("Student", id));
    store.students = store.students.filter((s) => s.id !== id);
    store.notifyStudents();
    appendAudit({
      action: "student.delete",
      entityType: "student",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(undefined);
  }

  /**
   * Iteration 6: TRUE atomic batch registration with rollback.
   *
   * The plan §18.01 mandates "All multi-record writes wrapped in BEGIN...COMMIT".
   * The previous implementation created the parent first, then iterated student
   * creation — if any student failed, the parent and earlier students persisted.
   *
   * This implementation:
   *   1. Pre-validates ALL student inputs BEFORE writing anything.
   *   2. Snapshots the current state of parents and students arrays.
   *   3. Creates the parent + all students atomically.
   *   4. On ANY failure, rolls back to the snapshot.
   *   5. Writes a single audit entry on success.
   *
   * If rollback occurs, the audit log records the failure (not a success).
   */
  async batchRegister(input: BatchRegistrationInput): Promise<Result<BatchRegistrationResult>> {
    await delay(400);

    // Step 1: Pre-validate inputs (fail fast, before any mutation).
    if (input.students.length === 0) {
      return Err(Errors.validation("L'inscription groupée requiert au moins un élève"));
    }
    for (let i = 0; i < input.students.length; i++) {
      const s = input.students[i];
      if (!s.firstName?.trim() || !s.lastName?.trim()) {
        return Err(Errors.validation(`Élève ${i + 1}: prénom et nom requis`));
      }
      if (!s.birthDate) {
        return Err(Errors.validation(`Élève ${i + 1}: date de naissance requise`));
      }
    }

    // Step 2: Snapshot state for rollback.
    const parentsSnapshot = [...store.parents];
    const studentsSnapshot = [...store.students];
    const ledgerSnapshot = [...store.ledger];
    const installmentsSnapshot = [...store.installments];

    try {
      const year = input.academicYearStartYear ?? new Date().getFullYear();
      // Step 3a: Create parent.
      const parentResult = await new MockParentRepository().createParent(input.parent);
      if (!parentResult.ok) {
        throw parentResult.error;
      }
      const parent = parentResult.value;

      // Step 3b: Create all students.
      const students: Student[] = [];
      for (const sInput of input.students) {
        const seq = nextStudentSeq();
        const gradeLevel: GradeLevel =
          sInput.gradeLevel ?? gradeLevelFromLevelYear(sInput.level, sInput.gradeYear);
        const student: Student = {
          id: `stu-${String(seq).padStart(3, "0")}`,
          tenantId: TENANT_ID,
          code: studentCode(year, seq),
          parentId: parent.id,
          firstName: sInput.firstName,
          lastName: sInput.lastName,
          displayName: sInput.displayName ?? `${sInput.firstName} ${sInput.lastName}`.trim(),
          gender: sInput.gender,
          birthDate: sInput.birthDate,
          enrollmentDate: nowIso(),
          level: sInput.level,
          gradeYear: sInput.gradeYear,
          gradeLevel,
          classId: sInput.classId ?? null,
          photoUrl: null,
          medicalNotes: sInput.medicalNotes ?? null,
          transportTier: sInput.transportTier ?? null,
          status: "active",
          paymentPlan: sInput.paymentPlan ?? "tranches",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store.students.unshift(student);
        students.push(student);
      }
      store.notifyStudents();

      // Step 3c (FIX — billing persistence): create the charge entries and
      // installment schedule the wizard's step-3/step-4 review promised.
      // Mirrors the Android `LocalStudentRepository.batchRegister` (canonical
      // financial logic): all 5 discount rules evaluated ONCE on the gross
      // annual tuition, then the net is split 40/30/30 (or a single entry for
      // `full_annual`), plus per-student transport tranches and the flat
      // registration fee. Previously NOTHING was persisted — new families
      // started with a zero balance.
      const billing = buildRegistrationBilling(input, parent, students, year);
      if (billing.entries.length > 0) {
        store.ledger = [...store.ledger, ...billing.entries];
        store.notifyLedger();
      }
      if (billing.installments.length > 0) {
        store.installments = [...billing.installments, ...store.installments];
        store.notifyInstallments();
      }

      // Step 4: Audit the successful atomic transaction.
      appendAudit({
        action: AuditActions.BatchRegister,
        entityType: "batch",
        entityId: parent.id,
        actorId: "usr-current",
        actorName: "Session courante",
        diff: {
          before: null,
          after: {
            parentCode: parent.code,
            studentCount: students.length,
            chargeEntries: billing.entries.length,
            installments: billing.installments.length,
            totalCharged: billing.totalCharged,
          },
        },
        note: `Inscription groupée atomique — ${students.length} élève(s) créé(s), ${billing.entries.length} écriture(s) de facturation`,
      });
      return Ok({ parent, students });
    } catch (err) {
      // Step 5: ROLLBACK on failure — restore the snapshot.
      store.parents = parentsSnapshot;
      store.students = studentsSnapshot;
      store.ledger = ledgerSnapshot;
      store.installments = installmentsSnapshot;
      store.notifyParents();
      store.notifyStudents();
      store.notifyLedger();
      store.notifyInstallments();
      appendAudit({
        action: AuditActions.BatchRegister,
        entityType: "batch",
        entityId: "failed",
        actorId: "usr-current",
        actorName: "Session courante",
        diff: { before: null, after: null },
        note: `Échec inscription groupée — annulée (rollback). Raison: ${err instanceof Error ? err.message : String(err)}`,
      });
      if (err && typeof err === "object" && "code" in err) {
        return Err(err as AppError);
      }
      return Err(Errors.unknown(err));
    }
  }

  async promote(studentIds: string[], _academicYear: string): Promise<Result<Student[]>> {
    await delay(300);
    const promoted = store.students
      .filter((s) => studentIds.includes(s.id))
      .map((s) => ({ ...s, updatedAt: nowIso() }));
    appendAudit({
      action: AuditActions.StudentPromote,
      entityType: "student",
      entityId: studentIds.join(","),
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: { count: promoted.length } },
    });
    return Ok(promoted);
  }
}

/**
 * Max-seq id allocation — avoids reusing ids after deletions.
 * Scans `stu-XXX` ids and returns max(seq) + 1 (min 1).
 */
function nextStudentSeq(): number {
  let max = 0;
  for (const s of store.students) {
    const m = /^stu-(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * Build the billing artifacts (charge entries + installments) for a batch
 * registration — mirrors the Android canonical financial logic so both
 * platforms produce identical schedules for the same input.
 */
function buildRegistrationBilling(
  input: BatchRegistrationInput,
  parent: import("../../../domain/model/parent").Parent,
  students: readonly Student[],
  year: number,
): { entries: LedgerEntry[]; installments: Installment[]; totalCharged: number } {
  const config = defaultPricingConfig;
  const includeTransport = input.includeTransport ?? true;
  const includeRegistration = input.includeRegistration ?? true;
  const actorId = "usr-current";
  const actorName = "Session courante";
  const at = nowIso();
  const [due1, due2, due3] = getOfficialTuitionDueDates(year);
  const entries: LedgerEntry[] = [];
  const installments: Installment[] = [];

  students.forEach((student, index) => {
    // === Tuition: evaluate ALL 5 discount rules once on the gross, then split ===
    const grossTuition = tuitionForGradeLevel(config, student.gradeLevel).annualAmount;
    if (grossTuition > 0) {
      const discountEvals = evaluateAllSystemDiscounts({
        grossTuition,
        previousGradeLevel: null,
        currentGradeLevel: student.gradeLevel,
        childIndex: index + 1,
        paymentPlan: student.paymentPlan,
        paymentDate: at,
        academicYearStartYear: year,
        academicYearStart: new Date(Date.UTC(year, 8, 1)).toISOString(),
        enrollmentDate: student.enrollmentDate,
        previousRank: null,
      });
      const tuitionDiscount = sumDiscounts(discountEvals); // negative
      const netTuition = Math.max(0, grossTuition + tuitionDiscount);

      if (student.paymentPlan === "full_annual") {
        entries.push(
          createChargeEntry({
            tenantId: TENANT_ID,
            parentId: parent.id,
            studentId: student.id,
            category: "tuition",
            amount: netTuition,
            sourceType: "installment",
            sourceId: `reg-${student.id}-t1`,
            description: `Scolarité ${year} — Année complète (${student.gradeLevel})`,
            actorId,
            actorName,
            at,
            metadata: {
              tranche: 1,
              gradeLevel: student.gradeLevel,
              paymentPlan: "full_annual",
              baseAmount: grossTuition,
              netTuition,
              tuitionDiscount,
            },
          }),
        );
        installments.push(makeInstallment(
          `reg-ins-${student.id}-t1`, parent.id, student.id, "tuition",
          "Année complète", netTuition, due1,
        ));
      } else {
        const [t1, t2, t3] = splitNetTuitionByOfficialSchedule(netTuition);
        const tranches = [
          { amount: t1, num: 1 as const, label: "Tranche 1 (Sept–Déc)", due: due1 },
          { amount: t2, num: 2 as const, label: "Tranche 2 (Jan–Mar)", due: due2 },
          { amount: t3, num: 3 as const, label: "Tranche 3 (Avr–Juin)", due: due3 },
        ];
        for (const t of tranches) {
          entries.push(
            createChargeEntry({
              tenantId: TENANT_ID,
              parentId: parent.id,
              studentId: student.id,
              category: "tuition",
              amount: t.amount,
              sourceType: "installment",
              sourceId: `reg-${student.id}-t${t.num}`,
              description: `${t.label} — Scolarité ${year} (${student.gradeLevel})`,
              actorId,
              actorName,
              at,
              metadata: {
                tranche: t.num,
                gradeLevel: student.gradeLevel,
                paymentPlan: "tranches",
                baseAmount: grossTuition,
                netTuition,
                tuitionDiscount,
              },
            }),
          );
          installments.push(makeInstallment(
            `reg-ins-${student.id}-t${t.num}`, parent.id, student.id, "tuition",
            t.label, t.amount, t.due,
          ));
        }
      }
    }

    // === Transport: per-student destination, else the parent's zone ===
    if (includeTransport) {
      const destination =
        (student.transportTier as import("../../../domain/model/parent").TransportDestination | null)
        ?? parent.transportDestination;
      if (destination) {
        const tranches = transportTranchesForDestination(config, destination);
        tranches.forEach((t, i) => {
          const due = [due1, due2, due3][i];
          entries.push(
            createChargeEntry({
              tenantId: TENANT_ID,
              parentId: parent.id,
              studentId: student.id,
              category: "transport",
              amount: t.amountDue,
              sourceType: "installment",
              sourceId: `reg-${student.id}-transport-t${i + 1}`,
              description: `Transport ${year} — Tranche ${i + 1} (${destination})`,
              actorId,
              actorName,
              at,
              metadata: { tranche: i + 1, destination },
            }),
          );
          installments.push(makeInstallment(
            `reg-ins-${student.id}-transport-t${i + 1}`, parent.id, student.id, "transport",
            `Transport T${i + 1}`, t.amountDue, due,
          ));
        });
      }
    }
  });

  // === Registration fee: flat, one charge per family (per wizard step 3) ===
  if (includeRegistration && config.registrationFee > 0 && students.length > 0) {
    entries.push(
      createChargeEntry({
        tenantId: TENANT_ID,
        parentId: parent.id,
        studentId: null,
        category: "other",
        amount: config.registrationFee,
        sourceType: "manual_entry",
        sourceId: `reg-${parent.id}-fee`,
        description: `Frais d'inscription ${year} (nouvelle famille)`,
        actorId,
        actorName,
        at,
        metadata: { type: "registration_fee" },
      }),
    );
  }

  const totalCharged = entries.reduce((s, e) => s + e.amount, 0);
  return { entries, installments, totalCharged };
}

function makeInstallment(
  id: string,
  parentId: string,
  studentId: string,
  category: Installment["category"],
  label: string,
  amountDue: number,
  dueDate: string,
): Installment {
  return {
    id,
    parentId,
    studentId,
    category,
    label,
    amountDue,
    amountPaid: 0,
    amountPending: 0,
    dueDate,
    paidDate: null,
    status: "unpaid",
  };
}

/** Singleton instance — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockStudentRepository: StudentRepository = new MockStudentRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
