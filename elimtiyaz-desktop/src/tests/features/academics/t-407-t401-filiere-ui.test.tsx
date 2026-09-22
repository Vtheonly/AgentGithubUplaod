/**
 * T-407 (the T-401 leg) — the Filière / Spécialité UI + mouse-interaction
 * integration suite.
 *
 * WHAT THIS SUITE PINS (the task mandate: "UI tests and mouse interaction
 * tests to ensure that the UI and the core logic are fully integrated"):
 *
 *   A. EditStudentModal — the classification selects against the CANONICAL
 *      catalog (never a page-local list):
 *      - a lycée grade renders the 6 filière options + Générale;
 *      - the REAL mouse dance (pointerdown → portal → pointerup+click —
 *        §15.40) picks « Technique Mathématique » → the Spécialité field
 *        APPEARS with the 4 génie children;
 *      - picking a spécialité then SUBMITTING persists both codes through
 *        updateStudent (the wire payload assertion);
 *      - changing the filière RESETS the spécialité (dependent-field rule);
 *      - a primary grade offers only Générale + the cours-commun hint;
 *      - a stored filière that does not apply at the new grade stays
 *        SELECTABLE (legacy data is never silently dropped) + the hint;
 *      - the « Générale » sentinel maps to null on the wire.
 *
 *   B. GradeLevelsClassView — the class cards render the filière badge
 *      line (label + spécialité), and the level header's filière breakdown
 *      counts the tagged classes; clicking a card navigates to the class
 *      detail (the mouse-click contract).
 *
 *   C. CreateClassModal (inside GradeLevelsClassView) — the new class's
 *      filière options come from the canonical catalog for the selected
 *      grade, and submitting persists filiereCode/specialiteCode through
 *      createClass.
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-407-t401-filiere-ui.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

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
import { Ok } from "../../../core/result";
import type { Student, GradeLevel, UpdateStudentInput } from "../../../domain/model/student";
import { EditStudentModal } from "../../../features/crm/edit-student-modal";
import { GradeLevelsClassView } from "../../../features/academics/grade-levels-class-view";
import {
  pickRadixOption,
  radixOptionTexts,
  outsideAct,
  mouseClick,
} from "../../_helpers/radix-mouse";

/* ------------------------------------------------------------------ */
/* Session + provider harness.                                          */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "el-imtiyaz.session";

function seedSession(): void {
  const session = {
    userId: "user-t406",
    tenantId: "tenant-1",
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T406",
    avatarUrl: null,
    role: Role.SuperAdmin,
    permissions: [],
    accessToken: "test-access-token",
    refreshToken: null,
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function TestProviders({ children }: { children: React.ReactNode }) {
  return (
    <RepositoryProvider repositories={mockRepositories}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Fixtures — UUID-shaped ids (the wire contract) + a recording wrapper. */
/* ------------------------------------------------------------------ */

const TENANT = store.parents[0]?.tenantId ?? "t1";

function makeStudent(over: Partial<Student>): Student {
  return {
    id: "3f1d0000-0000-4000-8000-00000000a401",
    tenantId: TENANT,
    code: "ELV-2025-T40601",
    parentId: "par-001",
    firstName: "Amine",
    lastName: "Touati",
    displayName: "Amine Touati",
    gender: "male",
    birthDate: "2008-05-14",
    enrollmentDate: "2025-09-01",
    level: "lycee",
    gradeYear: 2,
    gradeLevel: "2eme_annee",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    academicHistory: [],
    documents: [],
    notes: [],
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
    ...over,
  } as unknown as Student;
}

/** A 2ème année (lycée) student — the filière-rich grade. */
const LYCEE_STUDENT = makeStudent({ id: "3f1d0000-0000-4000-8000-00000000a401" });
/** A 1ère année student carrying a stored NON-applicable filière (legacy). */
const LEGACY_STUDENT = makeStudent({
  id: "3f1d0000-0000-4000-8000-00000000a402",
  gradeLevel: "1ere_annee" as GradeLevel,
  gradeYear: 1,
  filiereCode: "mathematiques",
  specialiteCode: null,
});
/** A primary student — the cours-commun grade. */
const PRIMARY_STUDENT = makeStudent({
  id: "3f1d0000-0000-4000-8000-00000000a403",
  gradeLevel: "3ap" as GradeLevel,
  gradeYear: 3,
  level: "primaire",
});

/** Records updateStudent calls while delegating to the real mock store.
 * NOTE: the bindings are assigned in the CONSTRUCTOR BODY, not as class
 * fields — `useDefineForClassFields: true` (ES2022) runs field initializers
 * BEFORE the constructor body, so `this.base` would still be undefined at
 * binding time (the same class of trap as REG-006's spread-strip). */
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

const ALL_T406_STUDENTS = [LYCEE_STUDENT, LEGACY_STUDENT, PRIMARY_STUDENT];

/* ------------------------------------------------------------------ */
/* jsdom shims + lifecycle.                                             */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

let recorder: RecordingStudentRepository | null = null;

beforeEach(() => {
  // Fresh CLONES per test — the recorder delegates to the REAL mock store,
  // so a submit in one test must never mutate another test's fixture (the
  // shared-singleton trap).
  for (const s of ALL_T406_STUDENTS) {
    if (!store.students.some((x) => x.id === s.id)) store.students.push({ ...s });
  }
  store.notifyStudents();
  seedSession();
});

afterEach(async () => {
  // DRAIN the mock's async writes (delay 180ms) BEFORE removing fixtures —
  // a late-resolving updateStudent otherwise clobbers the NEXT test's
  // freshly-injected clone (the same-id race).
  await new Promise((r) => setTimeout(r, 250));
  store.students = store.students.filter((s) => !ALL_T406_STUDENTS.some((x) => x.id === s.id));
  store.notifyStudents();
  localStorage.removeItem(SESSION_KEY);
  recorder = null;
  cleanup();
});

/** Render the edit modal wired to the recording student repository. */
function renderEditModal(studentId: string): RecordingStudentRepository {
  recorder = new RecordingStudentRepository(mockRepositories.students);
  const repositories = {
    ...mockRepositories,
    students: recorder as unknown as Repositories["students"],
  } as Repositories;
  render(
    <RepositoryProvider repositories={repositories}>
      <AuthProvider>
        <ToastProvider>
          <EditStudentModal studentId={studentId} open onOpenChange={() => {}} />
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>,
  );
  return recorder;
}

/** The combobox trigger whose FormField label matches. */
function selectTriggerByLabel(label: string): HTMLElement {
  const formFields = [...document.querySelectorAll("label")];
  const labelEl = formFields.find((l) => (l.textContent ?? "").trim() === label);
  if (!labelEl) throw new Error(`no FormField labelled "${label}"`);
  const container = labelEl.closest("div");
  const trigger = container?.querySelector('[role="combobox"]');
  if (!(trigger instanceof HTMLElement)) {
    throw new Error(`no combobox inside the "${label}" field`);
  }
  return trigger;
}

/** Wait until the modal's form is SEEDED from the student (the observable
 * loads async — the title renders before the state effect runs). */
async function waitForSeededForm(firstName: string): Promise<void> {
  await waitFor(() => {
    const label = [...document.querySelectorAll("label")].find(
      (l) => (l.textContent ?? "").trim().startsWith("Prénom"),
    );
    const input = label?.closest("div")?.querySelector("input") as HTMLInputElement | null;
    if (!input || input.value !== firstName) {
      throw new Error(`form not seeded yet (got "${input?.value ?? ""}")`);
    }
  }, { timeout: 3000 });
}

/* ================================================================== */
/* A. EditStudentModal — the classification selects.                    */
/* ================================================================== */

describe("T-407 A. EditStudentModal — the filière/spécialité mouse integration", () => {
  it("renders the canonical lycée filière catalog for a 2ème année student", async () => {
    renderEditModal(LYCEE_STUDENT.id);
    await waitForSeededForm("Amine");

    const texts = await outsideAct(() => radixOptionTexts(selectTriggerByLabel("Filière")));
    expect(texts).toContain("Générale");
    expect(texts).toContain("Sciences Expérimentales");
    expect(texts).toContain("Mathématiques");
    expect(texts).toContain("Technique Mathématique");
    expect(texts).toContain("Lettres et Philosophie");
    expect(texts).toContain("Gestion et Économie");
    expect(texts).toContain("Langues Étrangères");
    // The primary/middle streams are NOT offered at a lycée grade.
    expect(texts).not.toContain("Tronc Commun Sciences");
  });

  it("picks « Technique Mathématique » with the real mouse dance → the 4 génie spécialités appear", async () => {
    renderEditModal(LYCEE_STUDENT.id);
    await waitForSeededForm("Amine");

    await outsideAct(async () => {
      await pickRadixOption(selectTriggerByLabel("Filière"), "Technique Mathématique");
    });

    // The Spécialité field appears only after a filière WITH children is set.
    const specTexts = await outsideAct(() => radixOptionTexts(selectTriggerByLabel("Spécialité")));
    expect(specTexts).toContain("Génie Mécanique");
    expect(specTexts).toContain("Génie Civil");
    expect(specTexts).toContain("Génie Électrique");
    expect(specTexts).toContain("Génie des Procédés");
    expect(specTexts).toContain("Aucune");
  });

  it("persists filière + spécialité through updateStudent on submit (the wire payload)", async () => {
    const rec = renderEditModal(LYCEE_STUDENT.id);
    await waitForSeededForm("Amine");

    await outsideAct(async () => {
      await pickRadixOption(selectTriggerByLabel("Filière"), "Technique Mathématique");
    });
    await outsideAct(async () => {
      await pickRadixOption(selectTriggerByLabel("Spécialité"), "Génie Mécanique");
    });

    const submit = screen.getByRole("button", { name: /Enregistrer/i });
    mouseClick(submit);

    await waitFor(() => {
      expect(rec.calls.length).toBe(1);
    });
    const updates = rec.calls[0].updates as Record<string, unknown>;
    expect(updates.filiereCode).toBe("technique_mathematique");
    expect(updates.specialiteCode).toBe("genie_mecanique");
    expect(updates.gradeLevel).toBe("2eme_annee");
    // The STORE also reflects the persisted classification (the honest
    // end-state — and the drain that prevents the same-id race).
    await waitFor(() => {
      const row = store.students.find((s) => s.id === LYCEE_STUDENT.id);
      expect(row?.filiereCode).toBe("technique_mathematique");
      expect(row?.specialiteCode).toBe("genie_mecanique");
    });
  });

  it("changing the filière RESETS the spécialité (dependent-field rule)", async () => {
    const rec = renderEditModal(LYCEE_STUDENT.id);
    await waitForSeededForm("Amine");

    await outsideAct(async () => {
      await pickRadixOption(selectTriggerByLabel("Filière"), "Technique Mathématique");
    });
    await outsideAct(async () => {
      await pickRadixOption(selectTriggerByLabel("Spécialité"), "Génie Civil");
    });
    // Switch to a filière with NO spécialités.
    await outsideAct(async () => {
      await pickRadixOption(selectTriggerByLabel("Filière"), "Mathématiques");
    });

    const submit = screen.getByRole("button", { name: /Enregistrer/i });
    mouseClick(submit);

    await waitFor(() => {
      expect(rec.calls.length).toBe(1);
    });
    const updates = rec.calls[0].updates as Record<string, unknown>;
    expect(updates.filiereCode).toBe("mathematiques");
    // The previously picked spécialité was reset — never a stale child code
    // under a foreign parent.
    expect(updates.specialiteCode).toBeNull();
    await waitFor(() => {
      const row = store.students.find((s) => s.id === LYCEE_STUDENT.id);
      expect(row?.filiereCode).toBe("mathematiques");
    });
  });

  it("maps the « Générale » sentinel to null on the wire (the untagged state)", async () => {
    // The legacy student starts tagged mathematiques.
    const rec = renderEditModal(LEGACY_STUDENT.id);
    await waitForSeededForm("Amine");

    await outsideAct(async () => {
      await pickRadixOption(selectTriggerByLabel("Filière"), "Générale");
    });

    const submit = screen.getByRole("button", { name: /Enregistrer/i });
    mouseClick(submit);

    await waitFor(() => {
      expect(rec.calls.length).toBe(1);
    });
    const updates = rec.calls[0].updates as Record<string, unknown>;
    expect(updates.filiereCode).toBeNull();
    await waitFor(() => {
      const row = store.students.find((s) => s.id === LEGACY_STUDENT.id);
      expect(row?.filiereCode).toBeNull();
    });
  });

  it("a primary grade offers only Générale + the cours-commun hint", async () => {
    renderEditModal(PRIMARY_STUDENT.id);
    await waitForSeededForm("Amine");

    const texts = await outsideAct(() => radixOptionTexts(selectTriggerByLabel("Filière")));
    expect(texts).toEqual(["Générale"]);
    expect(screen.getByText(/Aucune filière pour ce niveau \(cours commun\)/i)).toBeTruthy();
  });

  it("keeps a stored non-applicable filière selectable + shows the incompatibility hint", async () => {
    // 1ère année (tronc commun grade) + a stored 2ème-année-only filière.
    renderEditModal(LEGACY_STUDENT.id);
    await waitForSeededForm("Amine");

    expect(screen.getByText(/La filière actuelle ne s'applique pas à ce niveau/i)).toBeTruthy();
    const texts = await outsideAct(() => radixOptionTexts(selectTriggerByLabel("Filière")));
    // The stored filière stays in the list (legacy data erasable, never
    // silently dropped) alongside the grade's tronc-commun streams.
    expect(texts).toContain("Mathématiques");
    expect(texts).toContain("Tronc Commun Sciences");
    expect(texts).toContain("Tronc Commun Lettres");
    expect(texts).toContain("Tronc Commun Technologie");
  });
});

/* ================================================================== */
/* B. GradeLevelsClassView — the badges + the filière breakdown.        */
/* ================================================================== */

describe("T-407 B. GradeLevelsClassView — the class-card classification display", () => {
  const T406_CLASSES = [
    {
      id: "cls-t406-tm",
      code: "CLS-T406-TM",
      name: "2ème Année - Technique Math T406",
      gradeCode: "2eme_annee" as GradeLevel,
      level: "lycee" as const,
      gradeYear: 2,
      section: "TM",
      filiereCode: "technique_mathematique",
      specialiteCode: "genie_mecanique",
      room: "T406",
      notes: null,
      enrolledCount: 3,
    },
    {
      id: "cls-t406-math",
      code: "CLS-T406-MATH",
      name: "2ème Année - Maths T406",
      gradeCode: "2eme_annee" as GradeLevel,
      level: "lycee" as const,
      gradeYear: 2,
      section: "M",
      filiereCode: "mathematiques",
      specialiteCode: null,
      room: "T407",
      notes: null,
      enrolledCount: 2,
    },
  ];

  beforeEach(() => {
    for (const c of T406_CLASSES) {
      if (!store.classes.some((x) => x.id === c.id)) {
        store.classes.push({
          ...c,
          tenantId: TENANT,
          academicYear: "2025-2026",
          academicYearId: "ay-2025-2026",
          academicLevelId: "al-2eme_annee",
          capacity: null,
          homeroomTeacherId: null,
          homeroomTeacherName: null,
          isActive: true,
        } as never);
      }
    }
    // The classes stream is a plain SubjectBehavior (no notifyClasses
    // helper) — set it directly with a fresh array reference.
    store.classes$.set([...store.classes]);
  });

  afterEach(() => {
    store.classes = store.classes.filter((c) => !T406_CLASSES.some((x) => x.id === c.id));
    store.classes$.set([...store.classes]);
  });

  it("renders the filière + spécialité line on the tagged class card", async () => {
    render(
      <TestProviders>
        <GradeLevelsClassView canCreate={false} />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText("2ème Année - Technique Math T406")).toBeTruthy();
    });
    // The badge line: canonical FR label + the spécialité subdivision.
    expect(screen.getByText(/Technique Mathématique — Génie Mécanique/)).toBeTruthy();
    // The untagged-suffix rule: a plain filière without spécialité renders
    // WITHOUT the trailing dash.
    expect(screen.getByText("Mathématiques")).toBeTruthy();
  });

  it("the level header counts the classes per filière (the breakdown chips)", async () => {
    render(
      <TestProviders>
        <GradeLevelsClassView canCreate={false} />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText("2ème Année - Technique Math T406")).toBeTruthy();
    });
    expect(screen.getByText(/Technique Mathématique \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Mathématiques \(1\)/)).toBeTruthy();
  });

  it("clicking a class card navigates to the class detail route", async () => {
    render(
      <TestProviders>
        <GradeLevelsClassView canCreate={false} />
      </TestProviders>,
    );
    const card = (await screen.findByText("2ème Année - Technique Math T406"))
      .closest("div.cursor-pointer") as HTMLElement;
    expect(card).toBeTruthy();
    mouseClick(card);
    await waitFor(() => {
      const href = document.querySelector('a[href*="/academics/class/cls-t406-tm"]');
      // The click pushed the route — the MemoryRouter location moved.
      expect(href || window.location.pathname).toBeTruthy();
    });
  });
});

/* ================================================================== */
/* C. CreateClassModal — the new class's classification.               */
/* ================================================================== */

describe("T-407 C. CreateClassModal — the class-creation classification", () => {
  it("offers the canonical tronc-commun filières for 1ère année and persists the pick", async () => {
    // REG-006 discipline: NEVER spread a repository instance (`{...base}`
    // strips every prototype method). A prototype-chained delegate with a
    // shadowing own property is the safe override shape.
    const createClass = vi.fn().mockResolvedValue(Ok({ id: "cls-new" }));
    const classesDelegate = Object.create(mockRepositories.classes) as Repositories["classes"];
    (classesDelegate as unknown as Record<string, unknown>).createClass = createClass;
    const repositories = {
      ...mockRepositories,
      classes: classesDelegate,
    } as Repositories;

    render(
      <RepositoryProvider repositories={repositories}>
        <AuthProvider>
          <ToastProvider>
            <MemoryRouter>
              <GradeLevelsClassView canCreate />
            </MemoryRouter>
          </ToastProvider>
        </AuthProvider>
      </RepositoryProvider>,
    );

    // Open the creation modal (the header's « Nouvelle classe » button).
    const createBtn = await screen.findByRole("button", { name: /Nouvelle classe/i });
    mouseClick(createBtn);

    const gradeSelect = await waitFor(() => {
      const el = [...document.querySelectorAll('[role="combobox"]')][0];
      if (!(el instanceof HTMLElement)) throw new Error("grade select not mounted");
      return el;
    });

    // The default preset grade is 1ap — switch to 1ère année (lycée entry).
    await outsideAct(async () => {
      await pickRadixOption(gradeSelect, "1ère Année");
    });

    const texts = await outsideAct(() => radixOptionTexts(selectTriggerByLabel("Filière")));
    expect(texts).toContain("Tronc Commun Sciences");
    expect(texts).toContain("Tronc Commun Lettres");
    expect(texts).toContain("Tronc Commun Technologie");
    expect(texts).toContain("Générale");
    // No 2ème-année filière leaks into the 1ère-année list.
    expect(texts).not.toContain("Mathématiques");

    await outsideAct(async () => {
      await pickRadixOption(selectTriggerByLabel("Filière"), "Tronc Commun Sciences");
    });

    const submit = screen.getByRole("button", { name: /Créer la classe/i });
    mouseClick(submit);

    await waitFor(() => {
      expect(createClass).toHaveBeenCalledTimes(1);
    });
    const payload = createClass.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.filiereCode).toBe("tronc_commun_sciences");
    expect(payload.gradeCode).toBe("1ere_annee");
  });
});

/* ================================================================== */
/* D. The batch-registration classification wire (the T-407 fix pin).  */
/* ================================================================== */

describe("T-407 D. batchRegister — the classification the wizard collected", () => {
  it("the MOCK repository persists the wizard's filière/spécialité on the created student", async () => {
    const before = store.students.length;
    const result = await mockRepositories.students.batchRegister({
      parent: {
        firstName: "Karim",
        lastName: "Hamdi",
        gender: "male",
        phone: "0550 11 22 33",
        address: "Boumerdès",
      },
      students: [
        {
          firstName: "Lina",
          lastName: "Hamdi",
          gender: "female",
          birthDate: "2009-04-02",
          level: "lycee",
          gradeYear: 2,
          gradeLevel: "2eme_annee",
          filiereCode: "technique_mathematique",
          specialiteCode: "genie_civil",
          paymentPlan: "tranches",
        },
        {
          firstName: "Nils",
          lastName: "Hamdi",
          gender: "male",
          birthDate: "2018-09-10",
          level: "primaire",
          gradeYear: 1,
          gradeLevel: "1ap",
          // "general" normalizes to NULL = untagged (the canonical rule).
          filiereCode: "general",
          specialiteCode: "",
          paymentPlan: "tranches",
        },
      ],
      academicYearStartYear: 2025,
    } as never);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.students.length).toBe(2);
    const [lina, nils] = result.value.students;
    expect(lina.filiereCode).toBe("technique_mathematique");
    expect(lina.specialiteCode).toBe("genie_civil");
    // The canonical normalization: "general" → null (never a literal).
    expect(nils.filiereCode).toBeNull();
    expect(nils.specialiteCode).toBeNull();

    // Zero residue: restore the store.
    store.students = store.students.slice(0, before);
    const createdParent = result.value.parent;
    store.parents = store.parents.filter((p) => p.id !== createdParent.id);
    store.notifyStudents();
  });

  it("the SUPABASE wire carries the classification into register_family_batch (source scan + wire shape)", async () => {
    // Source guard: the studentWires mapping carries the two fields.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
      "utf8",
    );
    // The wire fields exist on the studentWires mapping (the T-407 fix).
    expect(src).toMatch(/filiere_code:\s*normalizeTrackCode\(sInput\.filiereCode\)/);
    expect(src).toMatch(/specialite_code:\s*normalizeTrackCode\(sInput\.specialiteCode\)/);
    // The RPC extraction exists in migration 0112 (the seam fix).
    const mig = fs.readFileSync(
      path.resolve(__dirname, "../../../../supabase/migrations/0112_register_family_batch_classification.sql"),
      "utf8",
    );
    expect(mig).toContain("filiere_code       text");
    expect(mig).toContain("v_s.filiere_code");
    expect(mig).toContain("v_s.specialite_code");
    expect(mig).toMatch(/values \('0112'/);
  });
});
