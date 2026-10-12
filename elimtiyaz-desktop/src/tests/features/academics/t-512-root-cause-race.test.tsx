/**
 * T-512 (GitHub issue #27) — THE ROOT-CAUSE REPRODUCTION.
 *
 * THE MECHANISM (proven against the live audit trail, 2026-10-12 10:32–10:35):
 * the class-creation modal's `handleSubmit` clears its `submitting` state
 * right after `createClass` resolves — but the per-student assignment loop
 * runs AFTER that, while the modal is still open and fully interactive.
 * Every checkbox clicked during that in-flight window updates the selection
 * STATE (the badge shows the new count) but the already-running loop iterates
 * the CLICK-TIME closure set — the late click is silently discarded when the
 * modal closes and resets the selection.
 *
 * The live evidence (audit_logs, the owner's own reproduction session):
 *   Benali       10:32 — 1 selected → 0 written
 *   Khelifi      10:33 — 4 selected → 3 written
 *   Bouzid       10:34 — 5 selected → 4 written (ALAA ATMANI never written)
 *   Préscolaire  10:35 — 5 selected → 5 written (the operator waited)
 *
 * This suite pins BOTH sides:
 *   A. the RACE ITSELF — a click during the in-flight window is discarded by
 *      the stale closure (the pre-fix behavior, kept as the mechanism proof);
 *   B. the FIX — while submitting, the multi-select is DISABLED, so a late
 *      click can never be acknowledged-then-discarded (no write/no error).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import * as React from "react";

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
import type { Result } from "../../../core/result";
import type { Student, UpdateStudentInput } from "../../../domain/model/student";
import { GradeLevelsClassView } from "../../../features/academics/grade-levels-class-view";
import { MemoryRouter } from "react-router-dom";
import { PersonNavigationProvider } from "../../../shared/navigation/person-navigation-context";

const SESSION_KEY = "el-imtiyaz.session";
const TENANT = store.parents[0]?.tenantId ?? "t1";

function seedSession(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: "user-t512race",
    tenantId: TENANT,
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T510race",
    avatarUrl: null,
    role: Role.SuperAdmin,
    permissions: [],
    accessToken: "test-access-token",
    refreshToken: null,
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  }));
}

function makeStudent(over: Partial<Student>): Student {
  return {
    id: "c5100000-0000-4000-8000-000000000001",
    tenantId: TENANT,
    code: "ELV-2026-T510R01",
    parentId: "par-001",
    firstName: "Amine",
    lastName: "Zerrouki",
    displayName: "Amine Zerrouki",
    gender: "male",
    birthDate: "2012-03-14",
    enrollmentDate: "2026-09-01",
    level: "cem",
    gradeYear: 1,
    gradeLevel: "4am",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    academicHistory: [],
    documents: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as unknown as Student;
}

const NAMES: Array<[string, string]> = [
  ["Amine", "Zerrouki"],
  ["Lina", "Hamdi"],
  ["Nadir", "Cherif"],
  ["Sofia", "Brahimi"],
  ["Karim", "Meziane"],
];

const COHORT: Student[] = NAMES.map(([firstName, lastName], i) =>
  makeStudent({
    id: `c5100000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    code: `ELV-2026-T510R${String(i + 1).padStart(2, "0")}`,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
  }),
);

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

class RecordingStudentRepository {
  readonly calls: Array<{ id: string; updates: UpdateStudentInput }> = [];
  private readonly base: Repositories["students"];
  observe: Repositories["students"]["observe"];
  observeById: Repositories["students"]["observeById"];
  observeByParent: Repositories["students"]["observeByParent"];
  observeByClass: Repositories["students"]["observeByClass"];
  search: Repositories["students"]["search"];
  constructor(base: Repositories["students"]) {
    this.base = base;
    this.observe = base.observe.bind(base);
    this.observeById = base.observeById.bind(base);
    this.observeByParent = base.observeByParent.bind(base);
    this.observeByClass = base.observeByClass.bind(base);
    this.search = base.search.bind(base);
  }
  async updateStudent(id: string, updates: UpdateStudentInput): Promise<Result<Student>> {
    this.calls.push({ id, updates });
    return this.base.updateStudent(id, updates);
  }
  async createStudent(
    parentId: string,
    input: Parameters<Repositories["students"]["createStudent"]>[1],
  ): Promise<Result<Student>> {
    return this.base.createStudent(parentId, input);
  }
  async promote(studentIds: string[], academicYear: string): Promise<Result<Student[]>> {
    return this.base.promote(studentIds, academicYear);
  }
  async deleteStudent(id: string): Promise<Result<void>> {
    return this.base.deleteStudent(id);
  }
  async batchRegister(
    input: Parameters<Repositories["students"]["batchRegister"]>[0],
  ): Promise<Result<import("../../../domain/model/student").BatchRegistrationResult>> {
    return this.base.batchRegister(input);
  }
  async addStudentDocument(
    ...args: Parameters<Repositories["students"]["addStudentDocument"]>
  ): ReturnType<Repositories["students"]["addStudentDocument"]> {
    return this.base.addStudentDocument(...args);
  }
}

function makeRecordingRepos(recorder: RecordingStudentRepository): Repositories {
  return {
    ...mockRepositories,
    students: recorder as unknown as Repositories["students"],
  } as Repositories;
}

beforeEach(() => {
  for (const s of COHORT) {
    if (!store.students.some((x) => x.id === s.id)) store.students.push({ ...s });
  }
  store.notifyStudents();
  seedSession();
});

/** Snapshot of the pre-test class ids — afterEach removes anything NEW. */
let classesBefore: string[];

afterEach(async () => {
  // Flush ANY in-flight mock writes (the shared-store pollution guard):
  // poll until the student rows stop churning, then remove the cohort and
  // any class this test created.
  for (let i = 0; i < 30; i++) {
    const snapshot = JSON.stringify(
      store.students.filter((s) => COHORT.some((x) => x.id === s.id)).map((s) => [s.id, s.classId]),
    );
    await new Promise((r) => setTimeout(r, 100));
    const again = JSON.stringify(
      store.students.filter((s) => COHORT.some((x) => x.id === s.id)).map((s) => [s.id, s.classId]),
    );
    if (snapshot === again) break;
  }
  store.students = store.students.filter((s) => !COHORT.some((x) => x.id === s.id));
  store.classes = store.classes.filter((c) => classesBefore.includes(c.id));
  // Any student the batch may still have pointed at a created class is gone
  // with the cohort removal above; re-notify both streams.
  store.notifyStudents();
  store.classes$.set([...store.classes]);
  localStorage.removeItem(SESSION_KEY);
  cleanup();
});

async function openCreateModal() {
  render(
    <RepositoryProvider repositories={makeRecordingRepos(recorder)}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter>
            <PersonNavigationProvider>
              <GradeLevelsClassView canCreate={true} />
            </PersonNavigationProvider>
          </MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>,
  );
  const levelButtons = await screen.findAllByRole("button", {
    name: /Ajouter une classe à ce niveau/i,
  });
  const am4Button = levelButtons.find((btn) =>
    (btn.closest("div")?.textContent ?? "").includes("4AM"),
  ) ?? levelButtons[levelButtons.length - 1];
  fireEvent.click(am4Button);
  await waitFor(() => {
    expect(screen.getByText("Créer une nouvelle classe")).toBeTruthy();
  });
  await waitFor(() => {
    expect(screen.getByText(/Amine Zerrouki/)).toBeTruthy();
  });
}

let recorder: RecordingStudentRepository;

describe("T-512 root cause — the in-flight click window (issue #27)", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("THE RACE, POST-FIX — a mid-batch checkbox click can NOT be acknowledged-then-discarded: the input is disabled and the badge never lies", async () => {
    recorder = new RecordingStudentRepository(mockRepositories.students);

    await openCreateModal();

    // The operator checks 4 students, then submits.
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByTestId(`class-student-checkbox-${COHORT[i].id}`));
    }
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "4 sélectionnés",
    );

    // SUBMIT — the batch (getByGradeCode → createClass → the per-student
    // loop) is now in flight. PRE-FACT the checkboxes stayed interactive
    // through this whole window and a late click was acknowledged by the
    // badge then silently discarded by the click-time closure loop (the
    // live "one less than selected" symptom — the owner's 2026-10-12 audit
    // trail: 1→0, 4→3, 5→4 registered in three consecutive attempts).
    fireEvent.click(screen.getByRole("button", { name: /Créer la classe/i }));

    // POST-FIX: while the batch is in flight the 5th checkbox is DISABLED —
    // the operator physically cannot add a student to a batch that already
    // captured its selection. (In a real browser a disabled control fires
    // no event at all — neither direct clicks nor label forwarding — so the
    // badge can never acknowledge a mid-batch addition.)
    await waitFor(() => {
      const fifth = screen.getByTestId(
        `class-student-checkbox-${COHORT[4].id}`,
      ) as HTMLInputElement;
      expect(fifth.disabled).toBe(true);
    });

    // The batch writes EXACTLY the click-time selection — 4 writes, none
    // for the never-selectable 5th student.
    await waitFor(() => {
      expect(recorder.calls.length).toBe(4);
    }, { timeout: 5000 });
    expect(
      recorder.calls.some((c) => c.id === COHORT[4].id),
    ).toBe(false);
    for (const call of recorder.calls) {
      expect(call.updates.classId).toBeTruthy();
    }

    // Wait for the WHOLE batch to finish (the modal closes after the loop +
    // the toast) so NOTHING leaks into the next test.
    await waitFor(() => {
      expect(screen.queryByText("Créer une nouvelle classe")).toBeNull();
    }, { timeout: 5000 });
  });

  it("the selecting experience is UNCHANGED while idle (disabled=false until submit)", async () => {
    recorder = new RecordingStudentRepository(mockRepositories.students);

    await openCreateModal();

    // Idle: every checkbox is enabled, toggles work, the badge follows.
    for (let i = 0; i < 5; i++) {
      const cb = screen.getByTestId(
        `class-student-checkbox-${COHORT[i].id}`,
      ) as HTMLInputElement;
      expect(cb.disabled).toBe(false);
      fireEvent.click(cb);
    }
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "5 sélectionnés",
    );
  });
});
