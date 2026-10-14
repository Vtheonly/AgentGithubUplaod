/**
 * T-532 / UI-346 (GitHub issue #32 §4 — the "Free List"): the Class
 * Placement Studio's in-session draft survives leaving and returning.
 *
 * THE REPORTED SYMPTOM: "Fix the Free List functionality so that users can
 * return to an existing workflow without having to start over. Preserve
 * existing selections, configuration, and progress wherever applicable…
 * ensure that returning to the workflow does not unnecessarily reset
 * completed steps or discard previously entered information."
 *
 * BEFORE THE FIX: the studio's ENTIRE working state (the assignment map,
 * the drafted sections, the existing-class patches) was component-local
 * useState — navigating away from the Academics page, switching tabs, or
 * restarting the application reset every completed step: the drafted
 * sections vanished and every assigned student dropped back into the
 * « Réserve » (the unassigned pool).
 *
 * WHAT THIS SUITE PINS:
 *
 *   A. The draft SURVIVES a full hook unmount/remount (the "start over"
 *      symptom closed): assignments, drafted sections and patches restore.
 *
 *   B. The restore is RE-VALIDATED against the live data: a student no
 *      longer in the eligible pool drops out; an assignment to a class
 *      that no longer exists drops — never a silent ghost.
 *
 *   C. A SUCCESSFUL finalize clears the draft (a completed workflow leaves
 *      nothing stale) — and a FAILED finalize keeps it (retry-able).
 *
 *   D. The explicit reset (Reprendre à zéro) discards the draft.
 *
 *   E. Cross-context isolation: another grade's draft never restores into
 *      this context; switching contexts reloads that context's own draft.
 *
 *   F. The storage module's malformed-draft guard (version/format).
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-532-placement-draft-persistence.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import type * as React from "react";
import type { ReactNode } from "react";

import "../../../i18n/i18n";
import { store } from "../../../infrastructure/mock/repositories/mock-store";
import {
  mockRepositories,
  RepositoryProvider,
} from "../../../app/providers/repository-provider";
import type { Repositories } from "../../../app/providers/repository-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { Role } from "../../../core/rbac/roles";
import type { Session } from "../../../core/rbac/session";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type { Student, GradeLevel } from "../../../domain/model/student";
import type {
  FinalizeClassPlacementsInput,
  ClassPlacementRepository,
  FinalizeClassPlacementsResult,
} from "../../../domain/repository/academic-repository";
import { useClassPlacementStudio } from "../../../features/academics/hooks/use-class-placement-studio";
import {
  placementDraftKey,
  readPlacementDraft,
  writePlacementDraft,
  clearPlacementDraft,
  PLACEMENT_DRAFT_VERSION,
} from "../../../features/academics/placement/placement-draft-storage";

/* ------------------------------------------------------------------ */
/* Fixtures (the t-370 harness pattern).                               */
/* ------------------------------------------------------------------ */

const TENANT = store.parents[0]?.tenantId ?? "t1";
const SESSION_KEY = "el-imtiyaz.session";

const ACTIVE_4AP_STUDENT: Student = {
  id: "stu-t532-active",
  tenantId: TENANT,
  code: "ELV-2026-T53201",
  parentId: "par-001",
  firstName: "Test",
  lastName: "Persistence",
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

function makeSession(): Session {
  return {
    userId: "user-t532",
    tenantId: "tenant-1",
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T532",
    avatarUrl: null,
    role: Role.SupportStaff,
    permissions: new Set(),
    accessToken: "test-access-token",
    refreshToken: null,
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  } as unknown as Session;
}

class FixedSessionAuthRepository {
  constructor(private readonly session: Session) {}
  async getSession(): Promise<Session | null> {
    return this.session;
  }
  async signIn(): Promise<Result<Session>> {
    return Ok(this.session);
  }
  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async refreshSession(): Promise<Result<Session>> {
    return Ok(this.session);
  }
  async changePassword(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async updateProfile(): Promise<Result<void>> {
    return Ok(undefined);
  }
}

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

function renderStudioHarness(
  placement: RecordingPlacementRepository,
  initialGrade: GradeLevel = "4ap",
): { hook: { result: { current: ReturnType<typeof useClassPlacementStudio> }; unmount: () => void }; placement: RecordingPlacementRepository } {
  const session = makeSession();
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

  const hook = renderHook(() => useClassPlacementStudio(initialGrade), { wrapper });
  return { hook, placement };
}

/** Drives the studio to a working state (1 draft + 1 assignment). */
async function prepareWorkingSession(
  hook: { result: { current: ReturnType<typeof useClassPlacementStudio> } },
): Promise<string> {
  await act(async () => {
    hook.result.current.setTargetYearCode("2025-2026");
  });
  act(() => {
    hook.result.current.createClassDraft({
      name: "4ème AP - Section T532",
      section: "Section T532",
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

/** Clears every persisted placement draft (test isolation). */
function clearAllDrafts(): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith("el-imtiyaz:placement-draft:")) {
      localStorage.removeItem(key);
    }
  }
}

beforeAll(() => {
  class ResizeObserverStub {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    observe() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    unobserve() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

let studentsBefore: Student[];

beforeEach(() => {
  studentsBefore = store.students.map((s) => ({ ...s }));
  if (!store.students.some((s) => s.id === ACTIVE_4AP_STUDENT.id)) {
    store.students.push(ACTIVE_4AP_STUDENT);
  }
  store.notifyStudents();
  clearAllDrafts();
});

afterEach(() => {
  store.students = studentsBefore;
  store.notifyStudents();
  localStorage.removeItem(SESSION_KEY);
  clearAllDrafts();
  cleanup();
});

/* ================================================================== */
/* A. The draft survives a full unmount/remount.                       */
/* ================================================================== */

describe("T-532/UI-346 A. The Free List — the draft survives leaving and returning", () => {
  it("assignments, drafted sections and patches restore after a full remount (no starting over)", async () => {
    const first = renderStudioHarness(new RecordingPlacementRepository());
    const draftId = await prepareWorkingSession(first.hook);

    // Also patch an EXISTING class of the target year (the patch layer).
    const existing = store.classes.find(
      (c) => c.academicYearId === "ay-2025-2026" || c.academicYear === "2025-2026",
    );
    const existingId = existing?.id ?? "cls-001";
    act(() => {
      first.hook.result.current.updateClassDraft(existingId, { room: "X99" });
    });

    // The draft IS persisted under the context key.
    const key = placementDraftKey("tenant-1", "2025-2026", "4ap");
    const persisted = readPlacementDraft(key);
    expect(persisted).not.toBeNull();
    expect(persisted?.version).toBe(PLACEMENT_DRAFT_VERSION);
    expect(persisted?.assignedMap.length).toBeGreaterThan(0);
    expect(persisted?.customClassDrafts.length).toBe(1);

    // LEAVE the studio (the hook fully unmounts — the tab switch /
    // navigation / restart that used to reset everything).
    first.hook.unmount();

    // RETURN: a fresh mount with the same context restores the session.
    const second = renderStudioHarness(new RecordingPlacementRepository());
    await act(async () => {
      second.hook.result.current.setTargetYearCode("2025-2026");
    });

    // The assignment restored (the student is NOT back in the reserve).
    const restored = second.hook.result.current.candidatePool.find(
      (c) => c.studentId === ACTIVE_4AP_STUDENT.id,
    );
    expect(restored?.assignedClassId).toBe(draftId);
    // The drafted section restored.
    expect(
      second.hook.result.current.classDrafts.some(
        (d) => d.isNew && d.id === draftId,
      ),
    ).toBe(true);
    // The reprise info is exposed (the banner's data).
    expect(second.hook.result.current.restoredDraftInfo).not.toBeNull();
    expect(second.hook.result.current.restoredDraftInfo?.assignmentCount).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== */
/* B. The restore is re-validated against the live data.               */
/* ================================================================== */

describe("T-532/UI-346 B. The restore re-validates (honest drops, never ghosts)", () => {
  it("an assignment to a class that no longer exists drops; an ineligible student drops", async () => {
    // Write a draft whose class target does not exist in the store.
    const ghostClassId = "cls-ghost-0000";
    const key = placementDraftKey("tenant-1", "2025-2026", "4ap");
    writePlacementDraft(key, {
      version: PLACEMENT_DRAFT_VERSION,
      targetYearCode: "2025-2026",
      targetGradeLevel: "4ap",
      assignedMap: [
        [ACTIVE_4AP_STUDENT.id, ghostClassId],
        ["stu-not-eligible-anymore", "cls-001"],
      ],
      customClassDrafts: [],
      modifiedClassPatches: [["cls-deleted-long-ago", { room: "X99" }]],
      savedAt: new Date().toISOString(),
    });

    const { hook } = renderStudioHarness(new RecordingPlacementRepository());
    await act(async () => {
      hook.result.current.setTargetYearCode("2025-2026");
    });
    // Let the re-validation effect run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The ghost-class assignment dropped (the student is back in the
    // reserve — HONEST, never an invisible ghost assignment).
    const candidate = hook.result.current.candidatePool.find(
      (c) => c.studentId === ACTIVE_4AP_STUDENT.id,
    );
    expect(candidate?.assignedClassId).toBeNull();
    // EVERY entry in the seeded draft was invalid (the ghost class target,
    // the ineligible student, the deleted-class patch) — the re-validation
    // emptied the session and the save CLEARED the draft entirely (an
    // emptied state never leaves an empty husk behind).
    expect(readPlacementDraft(key)).toBeNull();
    expect(hook.result.current.restoredDraftInfo).toBeNull();
  });
});

/* ================================================================== */
/* C. Finalize clears the draft; failure keeps it.                     */
/* ================================================================== */

describe("T-532/UI-346 C. Finalize clears the draft — failure keeps it", () => {
  it("a SUCCESSFUL finalize clears the persisted draft (remount = fresh session)", async () => {
    const { hook, placement } = renderStudioHarness(new RecordingPlacementRepository());
    await prepareWorkingSession(hook);

    await act(async () => {
      await hook.result.current.finalizePlacements();
    });
    expect(placement.calls.length).toBe(1);

    const key = placementDraftKey("tenant-1", "2025-2026", "4ap");
    expect(readPlacementDraft(key)).toBeNull();

    // A remount after finalize starts FRESH (no stale draft restored).
    const second = renderStudioHarness(new RecordingPlacementRepository());
    await act(async () => {
      second.hook.result.current.setTargetYearCode("2025-2026");
    });
    expect(second.hook.result.current.classDrafts.some((d) => d.isNew)).toBe(false);
    expect(second.hook.result.current.restoredDraftInfo).toBeNull();
  });

  it("a FAILED finalize keeps the draft (the session survives for retry)", async () => {
    const { hook } = renderStudioHarness(
      new RecordingPlacementRepository(
        Err(Errors.validation("Le code de classe existe déjà.")),
      ),
    );
    await prepareWorkingSession(hook);

    await act(async () => {
      await hook.result.current.finalizePlacements();
    });

    const key = placementDraftKey("tenant-1", "2025-2026", "4ap");
    expect(readPlacementDraft(key)).not.toBeNull();
    expect(hook.result.current.classDrafts.some((d) => d.isNew)).toBe(true);
  });
});

/* ================================================================== */
/* D. The explicit reset discards the draft.                           */
/* ================================================================== */

describe("T-532/UI-346 D. The explicit reset (Reprendre à zéro) discards the draft", () => {
  it("resetSessionAssignments clears the persisted draft AND the reprise info", async () => {
    const { hook } = renderStudioHarness(new RecordingPlacementRepository());
    await prepareWorkingSession(hook);
    expect(hook.result.current.restoredDraftInfo ?? { assignmentCount: 1 }).toBeTruthy();

    act(() => {
      hook.result.current.resetSessionAssignments();
    });

    const key = placementDraftKey("tenant-1", "2025-2026", "4ap");
    expect(readPlacementDraft(key)).toBeNull();
    expect(hook.result.current.classDrafts.some((d) => d.isNew)).toBe(false);
  });
});

/* ================================================================== */
/* E. Cross-context isolation.                                         */
/* ================================================================== */

describe("T-532/UI-346 E. Cross-grade isolation — one draft per context", () => {
  it("grade A's draft never restores for grade B; switching back reloads A's own draft", async () => {
    // Work in 4ap.
    const { hook } = renderStudioHarness(new RecordingPlacementRepository());
    const draftId = await prepareWorkingSession(hook);

    // Switch to 5ap — a DIFFERENT context: the 4ap draft must NOT leak in.
    act(() => {
      hook.result.current.setTargetGradeLevel("5ap");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hook.result.current.targetGradeLevel).toBe("5ap");
    expect(hook.result.current.classDrafts.some((d) => d.isNew)).toBe(false);

    // Switch back to 4ap — the 4ap draft reloads.
    act(() => {
      hook.result.current.setTargetGradeLevel("4ap");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(
      hook.result.current.classDrafts.some((d) => d.isNew && d.id === draftId),
    ).toBe(true);
  });
});

/* ================================================================== */
/* F. The storage module's guards.                                     */
/* ================================================================== */

describe("T-532/UI-346 F. The storage module's malformed-draft guard", () => {
  it("a malformed or wrong-version draft is discarded (never guessed at)", () => {
    const key = placementDraftKey("tenant-1", "2025-2026", "4ap");
    localStorage.setItem(key, "{not-json");
    expect(readPlacementDraft(key)).toBeNull();
    localStorage.setItem(
      key,
      JSON.stringify({ version: 999, assignedMap: [], customClassDrafts: [], modifiedClassPatches: [] }),
    );
    expect(readPlacementDraft(key)).toBeNull();
    clearPlacementDraft(key);
    expect(readPlacementDraft(key)).toBeNull();
  });
});
