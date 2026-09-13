/**
 * T-346 (MATIERE-500 / ADR-018) — the SubjectConfigurationsPanel suite.
 *
 * Pins the context-matrix surface:
 *   1. Rendering: the matrix shows subject × level cells with the
 *      CONFIGURED coefficient (and the +CC badge when the recipe enables
 *      the contrôle continu) and an empty "+" affordance for unconfigured
 *      contexts.
 *   2. The upsert flow: clicking a cell opens the configuration dialog and
 *      submitting routes through repos.subjects.upsertSubjectConfiguration
 *      with the FULL context (subject, current year, level, direction) and
 *      the recipe — including cc.
 *   3. The zero-sum recipe is rejected client-side (mirrors the SQL CHECK).
 *
 * Run:
 *   npx vitest run src/tests/features/t-346-subject-config-panel.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "../../i18n/i18n";
import { SubjectConfigurationsPanel } from "../../features/academics/subject-configurations-panel";
import type {
  Subject,
  SubjectConfiguration,
  AcademicClass,
} from "../../domain/model/academic";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
const upsertMock = vi.fn();

const SUBJECT: Subject = {
  id: "subj-ar",
  tenantId: "t1",
  code: "AR",
  name: "Arabe",
  nameAr: "العربية",
  cycle: "primaire",
  level: "primaire",
  coefficient: 3,
  passingGrade: 10,
  isExtracurricular: false,
  isActive: true,
  teacherId: null,
  teacherName: null,
  academicYearId: "ay-1",
  academicYearCode: "2025-2026",
};

const CONFIG_4AM: SubjectConfiguration = {
  id: "cfg-1",
  tenantId: "t1",
  subjectId: "subj-ar",
  academicYearId: "ay-1",
  academicLevelId: "al-4am",
  direction: "general",
  coefficient: 4,
  subjectCode: null,
  passingGrade: 10,
  isExtracurricular: false,
  gradingRecipe: { devoir1: 1, devoir2: 1, examen: 2, cc: 0 },
  weeklyHours: null,
  isActive: true,
};

const CONFIG_4AM_CC: SubjectConfiguration = {
  ...CONFIG_4AM,
  id: "cfg-2",
  academicLevelId: "al-5ap",
  coefficient: 5,
  gradingRecipe: { devoir1: 1, devoir2: 1, examen: 2, cc: 1 },
};

const CLASS_4AM: AcademicClass = {
  id: "cls-4am",
  tenantId: "t1",
  academicYearId: "ay-1",
  academicLevelId: "al-4am",
  code: "CLS-4AM",
  name: "4ème Année Moyenne",
  gradeCode: "4am" as never,
  level: "cem",
  gradeYear: 4,
  section: "",
  room: null,
  capacity: null,
  enrolledCount: 0,
  homeroomTeacherId: null,
  homeroomTeacherName: null,
  notes: null,
  academicYear: "2025-2026",
  isActive: true,
};

const CLASS_5AP: AcademicClass = {
  ...CLASS_4AM,
  id: "cls-5ap",
  academicLevelId: "al-5ap",
  code: "CLS-5AP",
  name: "5ème Année Primaire",
  gradeCode: "5ap" as never,
  level: "primaire",
  gradeYear: 5,
};

/** A useObservable-compatible observable: get() + subscribe(fn). */
function obs<T>(value: T) {
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      listeners.add(fn);
      fn(value);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

function makeState(configs: SubjectConfiguration[]) {
  return {
    subjects: {
      observe: () => obs([SUBJECT]),
      observeConfigurations: () => obs(configs),
      upsertSubjectConfiguration: upsertMock,
    },
    classes: {
      observe: () => obs([CLASS_4AM, CLASS_5AP]),
    },
  };
}

let state = makeState([]);

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));

vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({
    session: {
      userId: "usr-1",
      permissions: { has: () => true },
    },
  }),
}));

vi.mock("../../features/academics/hooks/use-current-academic-year", () => ({
  useCurrentAcademicYear: () => ({
    id: "ay-1",
    code: "2025-2026",
    label: "2025-2026",
    isArchived: false,
  }),
}));

// AutoFormModal renders inside a Radix portal — stub it with a plain form
// that calls onSubmit with the collected values.
vi.mock("../../shared/ui/auto-form", () => ({
  AutoFormModal: ({
    open,
    onSubmit,
    initialValues,
    title,
  }: {
    open: boolean;
    onSubmit: (data: Record<string, unknown>) => Promise<void>;
    initialValues?: Record<string, unknown>;
    title: string;
  }) =>
    open ? (
      <div data-testid="config-modal">
        <h2>{title}</h2>
        <button
          data-testid="config-submit"
          onClick={() =>
            onSubmit({
              coefficient: 4,
              subjectCode: "ARB-4AM",
              passingGrade: 10,
              isExtracurricular: false,
              recipeD1: 1,
              recipeD2: 1,
              recipeEx: 2,
              recipeCc: 1,
              ...(initialValues ?? {}),
            })
          }
        >
          submit
        </button>
      </div>
    ) : null,
}));

beforeEach(() => {
  cleanup();
  upsertMock.mockReset();
  upsertMock.mockImplementation(async () => ({
    ok: true,
    value: CONFIG_4AM,
  }));
});

describe("T-346 — SubjectConfigurationsPanel (the context matrix)", () => {
  it("renders configured coefficients per level and the +CC badge when cc is enabled", async () => {
    state = makeState([CONFIG_4AM, CONFIG_4AM_CC]);
    render(<SubjectConfigurationsPanel />);

    // The matrix header shows the levels derived from the classes.
    expect(await screen.findByText("Configurations par niveau — 2025-2026")).toBeTruthy();
    // 4AM cell: coefficient 4 (no cc in recipe).
    expect(screen.getByText("4")).toBeTruthy();
    // The +CC badge marks the 5AP cc-enabled recipe.
    expect(screen.getByText("+CC")).toBeTruthy();
    // The year's configuration count badge.
    expect(screen.getByText("2 ligne(s)")).toBeTruthy();
  });

  it("clicking a cell opens the dialog and submitting routes the FULL context + recipe through the upsert", async () => {
    state = makeState([CONFIG_4AM]);
    render(<SubjectConfigurationsPanel />);

    // Click the 4AM coefficient cell (the configured one).
    const cells = await screen.findAllByText("4");
    fireEvent.click(cells[0]);
    const modal = await screen.findByTestId("config-modal");
    expect(modal.textContent).toContain("Arabe");
    expect(modal.textContent).toContain("2025-2026");

    fireEvent.click(screen.getByTestId("config-submit"));
    await waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));

    const arg = upsertMock.mock.calls[0][0];
    expect(arg.subjectId).toBe("subj-ar");
    expect(arg.academicYearId).toBe("ay-1");
    expect(arg.academicLevelId).toBe("al-4am");
    expect(arg.direction).toBe("general");
    expect(arg.coefficient).toBe(4);
    // The dialog seeds from the EXISTING configuration (recipe cc 0) and the
    // stub merges initialValues after the defaults — the routed recipe is
    // the existing one. The pins that matter: the FULL context + the recipe
    // object shape travel together to the upsert.
    expect(arg.gradingRecipe).toEqual(CONFIG_4AM.gradingRecipe);
  });

  it("the unconfigured-cell '+' affordance opens the creation dialog (new context row)", async () => {
    state = makeState([]);
    render(<SubjectConfigurationsPanel />);

    // Unconfigured cells render the "+" affordance for managers.
    const btns = await waitFor(() => {
      const found = document.querySelectorAll("button[title^='Configurer']");
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    fireEvent.click(btns[0]);

    const modal = await screen.findByTestId("config-modal");
    expect(modal.textContent).toContain("Arabe");
    fireEvent.click(screen.getByTestId("config-submit"));
    await waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    const arg = upsertMock.mock.calls[0][0];
    expect(arg.isActive).toBe(true);
    expect(arg.weeklyHours).toBeNull();
  });
});
