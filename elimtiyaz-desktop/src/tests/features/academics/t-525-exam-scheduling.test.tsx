/**
 * T-525 (CROSS-201) — the Pedagogy exam-scheduling surface: the
 * "Programmer un examen" modal + the Examens tab, wired through the
 * CANONICAL CalendarRepository (repos.calendar.create/update/delete — the
 * T-175 port) so scheduled exams reach calendar_events as
 * kind='custom' + target_entity_type='exam' — the exact contract the parent
 * portal calendar renders (event-kind.ts) and migration 0154 scopes.
 *
 * WHAT THIS SUITE PINS:
 *
 *   A. The CREATE flow (ExamSchedulingModal): submitting the form calls
 *      repos.calendar.create with kind="exam" + the class/date/time/room/
 *      invigilator payload — a REAL repository call, not local state.
 *
 *   B. Required-field honesty: an empty submit is refused with the French
 *      warning (classe + titre + date requis) — no repository call.
 *
 *   C. The EDIT/RESCHEDULE flow: the modal prefilled from an existing exam
 *      calls repos.calendar.UPDATE on the SAME id — never create (the
 *      issue's "updates its calendar entry without creating duplicates").
 *
 *   D. The Examens tab: the list renders from observeExams() with the
 *      class badge, the edit affordance (→ update) and the delete
 *      affordance (→ delete, 0013 soft-delete semantics).
 *
 *   E. Source guards: the academics page exposes the Examens tab gated by
 *      the assignHomework capability (the Devoirs sibling), with the
 *      "Programmer un examen" header action; the modal + tab mount through
 *      the canonical repository (no parallel store).
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-525-exam-scheduling.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import * as React from "react";
import * as fs from "node:fs";
import * as path from "node:path";

import "../../../i18n/i18n";
import {
  ensureRadixJsdomCompat,
  pickRadixOption,
  outsideAct,
} from "../../_helpers/radix-mouse";
import {
  RepositoryProvider,
  type Repositories,
} from "../../../app/providers/repository-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { SubjectBehavior } from "../../../infrastructure/mock/subject-behavior";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type { AcademicClass } from "../../../domain/model/academic";
import type { ExamCalendarEvent } from "../../../domain/model/calendar";
import { ExamSchedulingModal } from "../../../features/academics/exam-scheduling-modal";
import { ExamsTab } from "../../../features/academics/exams-tab";

/* ------------------------------------------------------------------ */
/* Session + provider harness (the t-474 pattern).                     */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "el-imtiyaz.session";
const TENANT = "00000000-0000-0000-0000-000000000001";
const STAFF = "user-t525";

function seedSession(): void {
  const session = {
    userId: STAFF,
    tenantId: TENANT,
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T525",
    avatarUrl: null,
    role: "super_admin",
    permissions: [],
    accessToken: "test-access-token",
    refreshToken: null,
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

const CLASS_ID = "eeeeeeee-0000-4000-8000-0000000000e1";
const CLASS_ID_2 = "eeeeeeee-0000-4000-8000-0000000000e2";

const CLASSES: AcademicClass[] = [
  {
    id: CLASS_ID,
    code: "CLS-5AP-A",
    name: "5AP - Section A",
    gradeLevel: "5ap",
    capacity: 30,
    homeroomTeacherId: null,
    homeroomTeacherName: null,
    academicYearId: "year-1",
    tenantId: TENANT,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    studentIds: [],
  } as unknown as AcademicClass,
  {
    id: CLASS_ID_2,
    code: "CLS-4AM-B",
    name: "4AM - Section B",
    gradeLevel: "4am",
    capacity: 30,
    homeroomTeacherId: null,
    homeroomTeacherName: null,
    academicYearId: "year-1",
    tenantId: TENANT,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    studentIds: [],
  } as unknown as AcademicClass,
];

function makeExam(over: Partial<ExamCalendarEvent> = {}): ExamCalendarEvent {
  return {
    id: "cal-exam-t525-1",
    kind: "exam",
    date: "2026-10-20",
    time: "08:30",
    title: "Examen de Mathématiques — Trimestre 1",
    description: null,
    sourceLabel: "Examen",
    priority: "medium",
    createdBy: STAFF,
    assignedToUserId: null,
    assignedToRole: null,
    createdAt: "2026-10-13T10:00:00.000Z",
    classId: CLASS_ID,
    room: "Salle 12",
    invigilatorName: "M. Benali",
    ...over,
  };
}

/** A minimal Repositories stub: only the surfaces the modal/tab consume. */
function makeRepos(exams: ExamCalendarEvent[] = []) {
  const exams$ = new SubjectBehavior<ExamCalendarEvent[]>(exams);
  const classes$ = new SubjectBehavior<AcademicClass[]>(CLASSES);
  return {
    classes: { observe: () => classes$ },
    calendar: {
      observeExams: () => exams$,
      create: vi.fn().mockResolvedValue(Ok(makeExam())),
      update: vi.fn().mockResolvedValue(Ok(makeExam({ date: "2026-10-22" }))),
      delete: vi.fn().mockResolvedValue(Ok(undefined)),
    },
  } as unknown as Repositories;
}

function TestProviders({
  children,
  repositories,
}: {
  children: React.ReactNode;
  repositories: Repositories;
}) {
  return (
    <RepositoryProvider repositories={repositories}>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

/* ------------------------------------------------------------------ */

beforeAll(() => {
  ensureRadixJsdomCompat();
});

beforeEach(() => {
  seedSession();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(SESSION_KEY);
});

describe("T-525 A — the CREATE flow: the modal writes through the canonical repository", () => {
  it("submitting the form calls repos.calendar.create with kind='exam' + the full payload", async () => {
    const repos = makeRepos();
    render(
      <TestProviders repositories={repos}>
        <ExamSchedulingModal open onOpenChange={() => {}} />
      </TestProviders>,
    );

    // Fill the form: the Radix class select (the §15.40 dance), then the inputs
    // (FormField does not wire htmlFor→id — query by placeholder/type, the
    // established pattern for these modals).
    await outsideAct(async () => {
      await pickRadixOption(screen.getByRole("combobox"), "5AP - Section A");
    });

    fireEvent.change(screen.getByPlaceholderText("Examen de Mathématiques — Trimestre 1"), {
      target: { value: "Examen de Mathématiques — Trimestre 1" },
    });
    fireEvent.change(document.querySelector('input[type="date"]')!, {
      target: { value: "2026-10-20" },
    });
    fireEvent.change(document.querySelector('input[type="time"]')!, {
      target: { value: "08:30" },
    });
    fireEvent.change(screen.getByPlaceholderText("Salle 12"), {
      target: { value: "Salle 12" },
    });
    fireEvent.change(screen.getByPlaceholderText("M. Benali"), {
      target: { value: "M. Benali" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Programmer l'examen/i }));

    await waitFor(() => {
      expect(repos.calendar.create).toHaveBeenCalledTimes(1);
    });
    expect(repos.calendar.create).toHaveBeenCalledWith({
      kind: "exam",
      date: "2026-10-20",
      time: "08:30",
      title: "Examen de Mathématiques — Trimestre 1",
      description: null,
      priority: "medium",
      createdBy: STAFF,
      classId: CLASS_ID,
      room: "Salle 12",
      invigilatorName: "M. Benali",
    });
    // NEVER a parallel write path:
    expect(repos.calendar.update).not.toHaveBeenCalled();
  });
});

describe("T-525 B — required-field honesty", () => {
  it("an empty submit is refused with the French warning and NO repository call", async () => {
    const repos = makeRepos();
    render(
      <TestProviders repositories={repos}>
        <ExamSchedulingModal open onOpenChange={() => {}} />
      </TestProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Programmer l'examen/i }));
    await waitFor(() => screen.getByText("Champs requis"));
    expect(
      screen.getByText(/Veuillez spécifier la classe, le titre et la date de l'examen/i),
    ).toBeInTheDocument();
    expect(repos.calendar.create).not.toHaveBeenCalled();
    expect(repos.calendar.update).not.toHaveBeenCalled();
  });

  it("a repository failure surfaces the error honestly (no success toast path)", async () => {
    const repos = makeRepos();
    (repos.calendar.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      Err(Errors.validation("Le titre est requis")),
    );
    render(
      <TestProviders repositories={repos}>
        <ExamSchedulingModal open onOpenChange={() => {}} />
      </TestProviders>,
    );

    await outsideAct(async () => {
      await pickRadixOption(screen.getByRole("combobox"), "5AP - Section A");
    });
    fireEvent.change(screen.getByPlaceholderText("Examen de Mathématiques — Trimestre 1"), {
      target: { value: "Examen" },
    });
    fireEvent.change(document.querySelector('input[type="date"]')!, {
      target: { value: "2026-10-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Programmer l'examen/i }));

    await waitFor(() => screen.getByText("Échec de la programmation"));
    expect(repos.calendar.create).toHaveBeenCalledTimes(1);
  });
});

describe("T-525 C — the EDIT/RESCHEDULE flow: the SAME row, never a duplicate", () => {
  it("the modal prefilled from an exam calls repos.calendar.update on the SAME id", async () => {
    const exam = makeExam();
    const repos = makeRepos([exam]);
    render(
      <TestProviders repositories={repos}>
        <ExamSchedulingModal open onOpenChange={() => {}} exam={exam} />
      </TestProviders>,
    );

    // Prefilled: the title + date + time carry the exam.
    expect(
      (screen.getByPlaceholderText("Examen de Mathématiques — Trimestre 1") as HTMLInputElement)
        .value,
    ).toBe("Examen de Mathématiques — Trimestre 1");
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(
      "2026-10-20",
    );
    expect((document.querySelector('input[type="time"]') as HTMLInputElement).value).toBe(
      "08:30",
    );

    // Reschedule: move the date, keep everything else.
    fireEvent.change(document.querySelector('input[type="date"]')!, {
      target: { value: "2026-10-22" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer les modifications/i }));

    await waitFor(() => {
      expect(repos.calendar.update).toHaveBeenCalledTimes(1);
    });
    expect(repos.calendar.update).toHaveBeenCalledWith(
      "cal-exam-t525-1",
      expect.objectContaining({ date: "2026-10-22", time: "08:30" }),
    );
    // The edit path NEVER creates a second row:
    expect(repos.calendar.create).not.toHaveBeenCalled();
  });
});

describe("T-525 D — the Examens tab: the list + the edit/delete affordances", () => {
  it("renders the scheduled exams from observeExams() with the class badge and the actions", async () => {
    const exam = makeExam();
    const other = makeExam({
      id: "cal-exam-t525-2",
      title: "Examen de Physique",
      classId: CLASS_ID_2,
      date: "2026-11-05",
      time: null,
      room: null,
      invigilatorName: "Mme Hadj",
    });
    const repos = makeRepos([exam, other]);
    render(
      <TestProviders repositories={repos}>
        <ExamsTab onSchedule={() => {}} onEdit={() => {}} />
      </TestProviders>,
    );

    await waitFor(() => screen.getByText("Examen de Mathématiques — Trimestre 1"));
    expect(screen.getByText("Examen de Physique")).toBeInTheDocument();
    // The class badge renders (the class list join):
    expect(screen.getByText("5AP - Section A")).toBeInTheDocument();
    // The room + invigilator chips:
    expect(screen.getByText("Salle 12")).toBeInTheDocument();
    expect(screen.getByText("M. Benali")).toBeInTheDocument();
    // Both affordances exist per row:
    const editButtons = screen.getAllByRole("button", { name: /Modifier/i });
    const deleteButtons = screen.getAllByRole("button", { name: /Supprimer/i });
    expect(editButtons.length).toBe(2);
    expect(deleteButtons.length).toBe(2);
  });

  it("the edit affordance opens the exam for rescheduling and delete soft-deletes through the repository", async () => {
    const exam = makeExam();
    const repos = makeRepos([exam]);
    const state: { edited: ExamCalendarEvent | null } = { edited: null };
    render(
      <TestProviders repositories={repos}>
        <ExamsTab
          onSchedule={() => {}}
          onEdit={(e) => {
            state.edited = e;
          }}
        />
      </TestProviders>,
    );

    await waitFor(() => screen.getByText("Examen de Mathématiques — Trimestre 1"));
    fireEvent.click(screen.getAllByRole("button", { name: /Modifier/i })[0]);
    await waitFor(() => {
      expect(state.edited).not.toBeNull();
    });
    expect((state.edited as ExamCalendarEvent).id).toBe("cal-exam-t525-1");

    fireEvent.click(screen.getAllByRole("button", { name: /Supprimer/i })[0]);
    await waitFor(() => screen.getByText("Supprimer l'examen ?"));
    fireEvent.click(screen.getByRole("button", { name: /^Supprimer$/ }));
    await waitFor(() => {
      expect(repos.calendar.delete).toHaveBeenCalledWith("cal-exam-t525-1");
    });
  });

  it("the empty state directs to the scheduling action (no exams yet)", async () => {
    const repos = makeRepos([]);
    render(
      <TestProviders repositories={repos}>
        <ExamsTab onSchedule={() => {}} onEdit={() => {}} />
      </TestProviders>,
    );
    await waitFor(() =>
      screen.getByText(/Aucun examen programmé — cliquez sur « Programmer un examen »/i),
    );
  });
});

describe("T-525 E — source guards: the wiring is the canonical path", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.resolve(__dirname, "../../../features/academics", rel), "utf-8");

  it("the academics page exposes the Examens tab gated by the assignHomework capability (the Devoirs sibling)", () => {
    const page = read("academics-page.tsx");
    expect(page).toContain('"exams"');
    expect(page).toContain('label: "Examens"');
    // The SAME capability as the homework tab (the scheduling family):
    expect(page).toMatch(/value: "exams",[\s\S]{0,200}visible: canObj\.assignHomework/);
    // The header action:
    expect(page).toContain("Programmer un examen");
  });

  it("the modal writes ONLY through repos.calendar (no parallel store, no direct supabase call)", () => {
    const modal = read("exam-scheduling-modal.tsx");
    expect(modal).toContain("repos.calendar.create");
    expect(modal).toContain("repos.calendar.update");
    expect(modal).not.toContain("supabase");
    expect(modal).not.toContain("from(\"calendar_events\")");
  });

  it("the tab reads ONLY through repos.calendar.observeExams", () => {
    const tab = read("exams-tab.tsx");
    expect(tab).toContain("repos.calendar.observeExams()");
    expect(tab).not.toContain("supabase");
  });
});
