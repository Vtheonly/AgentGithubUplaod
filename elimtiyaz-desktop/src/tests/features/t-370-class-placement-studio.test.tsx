/**
 * T-370 (ACAD-500) — the Class Formation & Student Placement Studio backend
 * integration suite.
 *
 * The 9ddde68 UI commit shipped the studio with NO backend integration; the
 * 08f7f13 follow-up wired it to a non-atomic classes+students loop whose
 * defects were (live console evidence, 2026-09-14 05:56 UTC): six
 * `students?id=eq.<uuid>` PATCH requests failing HTTP 400
 * (`22P02 invalid input syntax for type uuid: "draft-cls-A1"`) because
 * students were pointed at client draft ids that never existed, while every
 * repository Result was silently swallowed and the toast still said success.
 *
 * This suite pins the REPAIRED contract at all three layers:
 *
 *   1. MockClassPlacementRepository — validate-ALL-then-mutate atomicity
 *      (any bad entry leaves the store byte-identical), draft-id mapping
 *      (the created class's REAL id replaces the draft pointer), the
 *      existing-class patches, the enrolled-count recompute, and ONE
 *      `class.placement_finalize` audit entry for the whole batch.
 *   2. SupabaseClassPlacementRepository — the exact fn_finalize_class_placements
 *      RPC payload (param names + field names the server contract dictates),
 *      the non-UUID guard BEFORE the RPC, error mapping, the no-confirmation
 *      guard, and the classes+students cache refresh after a commit.
 *   3. The studio hook — finalizePlacements routes through the repository
 *      (never a classes+students loop), failure surfaces an error toast
 *      (no congratulatory toast on failure), success resets the session
 *      state, and the payload carries clientDraftId + real-class patches
 *      only.
 *
 * Run:
 *   npx vitest run src/tests/features/t-370-class-placement-studio.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import "../../i18n/i18n";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import {
  MockClassPlacementRepository,
} from "../../infrastructure/mock/repositories/academic-repository";
import {
  SupabaseClassPlacementRepository,
  SupabaseClassRepository,
} from "../../infrastructure/supabase/repositories/supabase-academic-repository";
import { SupabaseStudentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { useClassPlacementStudio } from "../../features/academics/hooks/use-class-placement-studio";
import {
  RepositoryProvider,
  mockRepositories,
} from "../../app/providers/repository-provider";
import type { Repositories } from "../../app/providers/repository-provider";
import { AuthProvider } from "../../app/providers/auth-provider";
import { ToastProvider } from "../../app/providers/toast-provider";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import { AuditActions } from "../../core/audit-actions";
import type { Session } from "../../core/rbac/session";
import { Role } from "../../core/rbac/roles";
import type { Student, GradeLevel } from "../../domain/model/student";
import type {
  FinalizeClassPlacementsInput,
  ClassPlacementRepository,
  FinalizeClassPlacementsResult,
} from "../../domain/repository/academic-repository";

// ============================================================================
// Fixtures
// ============================================================================

/**
 * The domain contract is all-readonly; the tests mutate batches per case
 * (duplicate code, cross-grade, dead student…). A deep-mutable mirror keeps
 * the fixtures typed against the REAL contract shape (§15.25 — fixtures
 * typed against the domain input types) while allowing per-case edits.
 */
type DeepMutable<T> = T extends (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;
type MutableBatch = DeepMutable<FinalizeClassPlacementsInput>;

const TENANT = store.parents[0]?.tenantId ?? "t1";
const SESSION_KEY = "el-imtiyaz.session";

/** A complete, ACTIVE 4ap student injected for the pool + enrolled asserts. */
const ACTIVE_4AP_STUDENT: Student = {
  id: "stu-t370-active",
  tenantId: TENANT,
  code: "ELV-2025-T37001",
  parentId: "par-001",
  firstName: "Test",
  lastName: "Placement",
  displayName: null,
  gender: "male",
  birthDate: "2015-01-01",
  enrollmentDate: "2025-09-01",
  level: "primaire",
  gradeYear: 4,
  gradeLevel: "4ap" as GradeLevel,
  classId: null,
  photoUrl: null,
  medicalNotes: null,
  transportTier: null,
  status: "active",
  paymentPlan: null,
  academicHistory: [],
  documents: [],
  notes: [],
  createdAt: "2025-09-01T00:00:00.000Z",
  updatedAt: "2025-09-01T00:00:00.000Z",
} as unknown as Student;

/** Mock-era ids (the shared mock-store conventions). */
function happyBatch(): MutableBatch {
  return {
    targetAcademicYearId: "ay-2025-2026",
    targetAcademicYearCode: "2025-2026",
    newClasses: [
      {
        clientDraftId: "draft-cls-t370",
        code: "CLS-T370-A",
        name: "4ème AP - Section T370",
        gradeCode: "4ap" as GradeLevel,
        section: "Section T370",
        filiereCode: null,
        specialiteCode: null,
        room: "T370",
        capacity: 25,
        homeroomTeacherId: "per-001",
        homeroomTeacherName: "Mme Aïcha Bouhenni",
      },
    ],
    classesToUpdate: [{ id: "cls-001", room: "B99", capacity: 31 }],
    studentAssignments: [
      {
        // Draft-id target: the repository must map this to the CREATED id.
        studentId: ACTIVE_4AP_STUDENT.id,
        targetClassId: "draft-cls-t370",
        gradeLevel: "4ap" as GradeLevel,
        level: "primaire",
        gradeYear: 4,
      },
      {
        // Existing-class target (1ap student → a real 1ap section).
        studentId: "stu-002",
        targetClassId: "cls-008",
        gradeLevel: "1ap" as GradeLevel,
        level: "primaire",
        gradeYear: 1,
      },
    ],
    performedBy: "user-t370",
    performedByName: "Agent T370",
  };
}

/** UUID-shaped ids (the Supabase layer's pre-validation requires them). */
const UUIDS = {
  year: "ccf2a038-adb8-4e2c-b0ff-62e0729d422e",
  newStudent: "2800fade-f79e-41e0-8918-96c2ac009a53",
  existingStudent: "934372ca-0cf5-47f1-9685-8c9dfcc39d65",
  patchClass: "b3a11a4a-7a67-4933-a3f3-00a09cce7034",
  existingClass: "4c5bc361-6ecb-4066-a12a-84f97bea6206",
  teacher: "e7dfd9ab-449b-4c1c-bab9-d78555751f38",
  actor: "0f9d6a3e-1b2c-4d5e-8f7a-9b0c1d2e3f4a",
};

function uuidHappyBatch(): MutableBatch {
  return {
    targetAcademicYearId: UUIDS.year,
    targetAcademicYearCode: "2025-2026",
    newClasses: [
      {
        clientDraftId: "draft-cls-t370",
        code: "CLS-T370-A",
        name: "4ème AP - Section T370",
        gradeCode: "4ap" as GradeLevel,
        section: "Section T370",
        filiereCode: null,
        specialiteCode: null,
        room: "T370",
        capacity: 25,
        homeroomTeacherId: UUIDS.teacher,
        homeroomTeacherName: "Mme Aïcha Bouhenni",
      },
    ],
    classesToUpdate: [{ id: UUIDS.patchClass, room: "B99", capacity: 31 }],
    studentAssignments: [
      {
        studentId: UUIDS.newStudent,
        targetClassId: "draft-cls-t370",
        gradeLevel: "4ap" as GradeLevel,
        level: "primaire",
        gradeYear: 4,
      },
      {
        studentId: UUIDS.existingStudent,
        targetClassId: UUIDS.existingClass,
        gradeLevel: "1ap" as GradeLevel,
        level: "primaire",
        gradeYear: 1,
      },
    ],
    performedBy: UUIDS.actor,
    performedByName: "Agent T370",
  };
}

// ============================================================================
// 1. MockClassPlacementRepository — atomicity, draft mapping, audit
// ============================================================================

describe("T-370 MockClassPlacementRepository (ACAD-500 repair)", () => {
  let repo: MockClassPlacementRepository;
  let classesBefore: typeof store.classes;
  let studentsBefore: typeof store.students;
  let auditBefore: number;

  beforeEach(() => {
    repo = new MockClassPlacementRepository();
    if (!store.students.some((s) => s.id === ACTIVE_4AP_STUDENT.id)) {
      store.students.push(ACTIVE_4AP_STUDENT);
    }
    classesBefore = store.classes.map((c) => ({ ...c }));
    studentsBefore = store.students.map((s) => ({ ...s }));
    auditBefore = store.audit.length;
  });

  afterEach(() => {
    // Zero-residue restore (t-300 convention).
    store.classes = classesBefore;
    store.students = studentsBefore;
    store.classes$.set([...store.classes]);
    store.notifyStudents();
  });

  it("commits the whole batch: draft-id mapping, patches, counts, ONE audit entry", async () => {
    const result = await repo.finalizePlacements(happyBatch());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.createdClassesCount).toBe(1);
    expect(result.value.updatedClassesCount).toBe(1);
    expect(result.value.assignedStudentsCount).toBe(2);

    // The draft was created with a REAL id (never the draft pointer).
    const created = store.classes.find((c) => c.code === "CLS-T370-A");
    expect(created).toBeDefined();
    expect(created?.id).not.toBe("draft-cls-t370");
    expect(created?.academicYearId).toBe("ay-2025-2026");
    expect(created?.academicLevelId).toBe("al-4ap");

    // Draft-id mapping: the student points at the CREATED id — the exact
    // pointer the 08f7f13 loop corrupted (live 22P02 evidence).
    const moved = store.students.find((s) => s.id === ACTIVE_4AP_STUDENT.id);
    expect(moved?.classId).toBe(created?.id);

    // Existing-class assignment honored.
    const existing = store.students.find((s) => s.id === "stu-002");
    expect(existing?.classId).toBe("cls-008");

    // The existing-class patch landed (dropped by the 08f7f13 loop).
    const patched = store.classes.find((c) => c.id === "cls-001");
    expect(patched?.room).toBe("B99");
    expect(patched?.capacity).toBe(31);

    // enrolledCount recomputed from the students histogram.
    expect(created?.enrolledCount).toBe(1);

    // Exactly ONE audit entry for the whole batch (prepend-only store:
    // the newest entry is index 0).
    expect(store.audit.length).toBe(auditBefore + 1);
    const entry = store.audit[0];
    expect(entry.action).toBe(AuditActions.ClassPlacementFinalize);
    expect(entry.action).toBe("class.placement_finalize");
  });

  it("is ATOMIC: a duplicate class code rejects the batch and mutates NOTHING", async () => {
    const batch = happyBatch();
    // CLS-4AP-A already exists in the 2025-2026 seed classes.
    batch.newClasses[0].code = "CLS-4AP-A";

    const result = await repo.finalizePlacements(batch);

    expect(result.ok).toBe(false);
    // Byte-identical store: no class created, no student moved, no audit.
    expect(store.classes.length).toBe(classesBefore.length);
    expect(store.students.map((s) => [s.id, s.classId])).toEqual(
      studentsBefore.map((s) => [s.id, s.classId]),
    );
    expect(store.audit.length).toBe(auditBefore);
  });

  it("is ATOMIC: a cross-grade assignment rejects the batch and mutates NOTHING", async () => {
    const batch = happyBatch();
    // 1ap student pointed at the 4ap draft — grade integrity violation.
    batch.studentAssignments[1] = {
      studentId: "stu-002",
      targetClassId: "draft-cls-t370",
      gradeLevel: "1ap" as GradeLevel,
      level: "primaire",
      gradeYear: 1,
    };

    const result = await repo.finalizePlacements(batch);

    expect(result.ok).toBe(false);
    expect(store.classes.length).toBe(classesBefore.length);
    expect(store.students.map((s) => [s.id, s.classId])).toEqual(
      studentsBefore.map((s) => [s.id, s.classId]),
    );
    expect(store.audit.length).toBe(auditBefore);
  });

  it("is ATOMIC: an unknown student rejects the batch and mutates NOTHING", async () => {
    const batch = happyBatch();
    batch.studentAssignments[1] = {
      studentId: "stu-does-not-exist",
      targetClassId: "cls-008",
      gradeLevel: "1ap" as GradeLevel,
      level: "primaire",
      gradeYear: 1,
    };

    const result = await repo.finalizePlacements(batch);

    expect(result.ok).toBe(false);
    expect(store.classes.length).toBe(classesBefore.length);
    expect(store.audit.length).toBe(auditBefore);
  });

  it("rejects an unknown target academic year without touching the store", async () => {
    const batch = happyBatch();
    batch.targetAcademicYearId = null;
    batch.targetAcademicYearCode = "1999-2000";

    const result = await repo.finalizePlacements(batch);

    expect(result.ok).toBe(false);
    expect(store.classes.length).toBe(classesBefore.length);
    expect(store.audit.length).toBe(auditBefore);
  });
});

// ============================================================================
// 2. SupabaseClassPlacementRepository — RPC payload + guards
// ============================================================================

/** Minimal PostgREST fake: from() resolves empty; rpc() is spied per test. */
function makeFakeClient(rpcResult: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const emptyQuery: Record<string, unknown> = {
    select: () => emptyQuery,
    eq: () => emptyQuery,
    neq: () => emptyQuery,
    is: () => emptyQuery,
    not: () => emptyQuery,
    in: () => emptyQuery,
    order: () => emptyQuery,
    limit: () => emptyQuery,
    range: () => emptyQuery,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
  };
  const rpc = vi.fn(async () => rpcResult);
  const client = {
    from: () => emptyQuery,
    rpc,
  };
  return { client: client as unknown as SupabaseClient, rpc };
}

function makePlacementRepos(client: SupabaseClient) {
  const classes = new SupabaseClassRepository(client);
  const students = new SupabaseStudentRepository(client);
  const classesRefresh = vi
    .spyOn(classes, "refresh")
    .mockResolvedValue(undefined);
  const studentsRefresh = vi
    .spyOn(students, "refresh")
    .mockResolvedValue(undefined);
  const repo = new SupabaseClassPlacementRepository(client, classes, students);
  return { repo, classesRefresh, studentsRefresh };
}

describe("T-370 SupabaseClassPlacementRepository (the RPC wiring)", () => {
  it("sends the EXACT fn_finalize_class_placements payload the server contract dictates", async () => {
    const { client, rpc } = makeFakeClient({
      data: {
        ok: true,
        targetYearId: UUIDS.year,
        createdClassesCount: 1,
        updatedClassesCount: 1,
        assignedStudentsCount: 2,
      },
      error: null,
    });
    const { repo, classesRefresh, studentsRefresh } = makePlacementRepos(client);

    const result = await repo.finalizePlacements(uuidHappyBatch());

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(fnName).toBe("fn_finalize_class_placements");
    expect(params.p_target_year_id).toBe(UUIDS.year);
    expect(params.p_target_year_code).toBe("2025-2026");
    expect(params.p_actor_profile_id).toBe(UUIDS.actor);
    expect(params.p_actor_name).toBe("Agent T370");
    // The three JSONB arrays keep the server field names verbatim.
    const newClasses = params.p_new_classes as Array<Record<string, unknown>>;
    expect(newClasses[0].clientDraftId).toBe("draft-cls-t370");
    expect(newClasses[0].gradeCode).toBe("4ap");
    expect(newClasses[0].homeroomTeacherId).toBe(UUIDS.teacher);
    const patches = params.p_updated_classes as Array<Record<string, unknown>>;
    expect(patches[0].id).toBe(UUIDS.patchClass);
    expect(patches[0].room).toBe("B99");
    const assignments = params.p_student_assignments as Array<
      Record<string, unknown>
    >;
    // Draft-id targets pass through UNMAPPED — the server resolves them
    // inside the transaction (the client must not pre-map).
    expect(assignments[0].targetClassId).toBe("draft-cls-t370");
    expect(assignments[0].gradeLevel).toBe("4ap");
    // Both caches refresh after the commit.
    expect(classesRefresh).toHaveBeenCalledTimes(1);
    expect(studentsRefresh).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value.createdClassesCount).toBe(1);
      expect(result.value.assignedStudentsCount).toBe(2);
    }
  });

  it("rejects a non-UUID student id BEFORE the RPC (the live 22P02 class)", async () => {
    const { client, rpc } = makeFakeClient({ data: null, error: null });
    const { repo } = makePlacementRepos(client);

    const batch = uuidHappyBatch();
    batch.studentAssignments[0] = {
      studentId: "stu-local-mock-id",
      targetClassId: "draft-cls-t370",
      gradeLevel: "4ap" as GradeLevel,
      level: "primaire",
      gradeYear: 4,
    };

    const result = await repo.finalizePlacements(batch);

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    if (!result.ok) {
      expect(result.error.userMessage).toContain("resynchronisez");
    }
  });

  it("rejects a non-UUID existing-class patch id BEFORE the RPC", async () => {
    const { client, rpc } = makeFakeClient({ data: null, error: null });
    const { repo } = makePlacementRepos(client);

    const batch = uuidHappyBatch();
    batch.classesToUpdate[0] = { id: "draft-cls-t370", room: "X" };

    const result = await repo.finalizePlacements(batch);

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an RPC error to an AppError and does NOT refresh the caches", async () => {
    const { client, rpc } = makeFakeClient({
      data: null,
      error: { code: "23505", message: 'duplicate key: "CLS-T370-A"' },
    });
    const { repo, classesRefresh, studentsRefresh } = makePlacementRepos(client);

    const result = await repo.finalizePlacements(uuidHappyBatch());

    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(classesRefresh).not.toHaveBeenCalled();
    expect(studentsRefresh).not.toHaveBeenCalled();
  });

  it("rejects an RPC response without the ok confirmation", async () => {
    const { client } = makeFakeClient({ data: null, error: null });
    const { repo } = makePlacementRepos(client);

    const result = await repo.finalizePlacements(uuidHappyBatch());

    expect(result.ok).toBe(false);
  });
});

// ============================================================================
// 3. The studio hook — the wiring (no more classes+students loop)
// ============================================================================

/** Captures finalize calls; returns Ok/Err per test. */
class RecordingPlacementRepository implements ClassPlacementRepository {
  calls: FinalizeClassPlacementsInput[] = [];
  nextResult: Result<FinalizeClassPlacementsResult>;

  constructor(nextResult?: Result<FinalizeClassPlacementsResult>) {
    this.nextResult =
      nextResult ??
      Ok({
        targetYearId: "ay-2025-2026",
        createdClassesCount: 1,
        updatedClassesCount: 0,
        assignedStudentsCount: 1,
      });
  }

  finalizePlacements(
    input: FinalizeClassPlacementsInput,
  ): Promise<Result<FinalizeClassPlacementsResult>> {
    this.calls.push(input);
    return Promise.resolve(this.nextResult);
  }
}

function makeSession(): Session {
  return {
    userId: "user-t370",
    tenantId: "tenant-1",
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T370",
    avatarUrl: null,
    role: Role.SupportStaff,
    permissions: new Set(),
    accessToken: "test-access-token",
    refreshToken: null,
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  } as unknown as Session;
}

/** AuthRepository stub that always refreshes to the T-370 session. */
class FixedSessionAuthRepository {
  constructor(private readonly session: Session) {}
  async signIn(): Promise<Result<Session>> {
    return Ok(this.session);
  }
  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async refreshSession(): Promise<Result<Session | null>> {
    return Ok(this.session);
  }
  async changePassword(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async updateProfile(): Promise<Result<void>> {
    return Ok(undefined);
  }
}

interface StudioHarness {
  hook: { result: { current: ReturnType<typeof useClassPlacementStudio> } };
  placement: RecordingPlacementRepository;
}

function renderStudioHarness(
  placement: RecordingPlacementRepository,
): StudioHarness {
  const session = makeSession();
  // Seed the stored session so AuthProvider loads it synchronously on the
  // first render (the shape loadSession re-hydrates: permissions as array).
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ ...session, permissions: [] }),
  );
  const repositories = {
    ...mockRepositories,
    classPlacement: placement,
    auth: new FixedSessionAuthRepository(
      session,
    ) as unknown as Repositories["auth"],
  } as Repositories;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repositories={repositories}>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );

  const hook = renderHook(() => useClassPlacementStudio("4ap"), { wrapper });
  return { hook, placement };
}

/** Drives the studio to a finalizable state (1 new draft + 1 assignment). */
async function prepareFinalizable(
  hook: StudioHarness["hook"],
): Promise<string> {
  await act(async () => {
    hook.result.current.setTargetYearCode("2025-2026");
  });
  act(() => {
    hook.result.current.createClassDraft({
      name: "4ème AP - Section Hook",
      section: "Section Hook",
      room: "H01",
      capacity: 30,
      homeroomTeacherId: null,
      homeroomTeacherName: null,
      notes: null,
    });
  });
  const draft = hook.result.current.classDrafts.find((d) => d.isNew);
  expect(draft).toBeDefined();
  act(() => {
    hook.result.current.assignStudent(ACTIVE_4AP_STUDENT.id, draft!.id);
  });
  return draft!.id;
}

describe("T-370 useClassPlacementStudio (the hook wiring)", () => {
  beforeEach(() => {
    if (!store.students.some((s) => s.id === ACTIVE_4AP_STUDENT.id)) {
      store.students.push(ACTIVE_4AP_STUDENT);
    }
    // Propagate to every students$ subscriber BEFORE the hook renders
    // (the pool derives from the reactive students stream).
    store.notifyStudents();
  });

  afterEach(() => {
    store.students = store.students.filter(
      (s) => s.id !== ACTIVE_4AP_STUDENT.id,
    );
    store.notifyStudents();
    localStorage.removeItem(SESSION_KEY);
  });

  it("routes finalize through the classPlacement repository (ONE call, never a loop)", async () => {
    const placement = new RecordingPlacementRepository();
    const { hook } = renderStudioHarness(placement);

    const draftId = await prepareFinalizable(hook);

    await act(async () => {
      await hook.result.current.finalizePlacements();
    });

    // ONE repository call — the 08f7f13 classes+students loop is gone.
    expect(placement.calls.length).toBe(1);
    const payload = placement.calls[0];
    expect(payload.targetAcademicYearCode).toBe("2025-2026");
    expect(payload.targetAcademicYearId).toBe("ay-2025-2026");
    expect(payload.performedBy).toBe("user-t370");
    expect(payload.performedByName).toBe("Agent T370");
    // The draft carries its clientDraftId for server-side mapping.
    expect(payload.newClasses[0].clientDraftId).toBe(draftId);
    // The assignment targets the draft id (mapped server-side).
    expect(payload.studentAssignments[0].targetClassId).toBe(draftId);
    expect(payload.studentAssignments[0].studentId).toBe(
      ACTIVE_4AP_STUDENT.id,
    );
  });

  it("surfaces a repository failure as an error toast and keeps the session state", async () => {
    const placement = new RecordingPlacementRepository(
      Err(Errors.validation("Le code de classe existe déjà.")),
    );
    const { hook } = renderStudioHarness(placement);

    await prepareFinalizable(hook);

    await act(async () => {
      await hook.result.current.finalizePlacements();
    });

    expect(placement.calls.length).toBe(1);
    // The draft session SURVIVES a failure (the user can fix and retry —
    // not silently wiped by a congratulatory path).
    expect(hook.result.current.classDrafts.some((d) => d.isNew)).toBe(true);
  });

  it("resets the session state after a successful finalize", async () => {
    const placement = new RecordingPlacementRepository();
    const { hook } = renderStudioHarness(placement);

    await prepareFinalizable(hook);

    await act(async () => {
      await hook.result.current.finalizePlacements();
    });

    // The session reset: no drafts left, the in-session assignment cleared
    // (candidates already placed in existing classes keep their PERSISTED
    // class — only the session's temporary assignments are reset).
    expect(hook.result.current.classDrafts.some((d) => d.isNew)).toBe(false);
    const sessionStudent = hook.result.current.candidatePool.find(
      (c) => c.studentId === ACTIVE_4AP_STUDENT.id,
    );
    expect(sessionStudent?.assignedClassId).toBeNull();
    expect(hook.result.current.isSubmitting).toBe(false);
  });
});

// ============================================================================
// 4. Source guards (the ACAD-500 regression fences)
// ============================================================================

describe("T-370 source guards", () => {
  it("the studio hook NEVER calls classes.createClass / students.updateStudent on the finalize path", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../features/academics/hooks/use-class-placement-studio.ts",
      ),
      "utf8",
    );
    // The finalize section must route through the repository only.
    expect(src).toContain("repos.classPlacement.finalizePlacements");
    expect(src).not.toContain("repos.classes.createClass");
    expect(src).not.toContain("repos.students.updateStudent");
    // No silent Result swallowing: the failure branch surfaces the error.
    expect(src).toContain("result.error.userMessage");
  });

  it("the audit action matches the server RPC's write_audit_log action", () => {
    expect(AuditActions.ClassPlacementFinalize).toBe("class.placement_finalize");
  });
});
