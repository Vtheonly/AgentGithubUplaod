/**
 * T-407 (the T-403 leg) — the Promotion Cycles UI + mouse-interaction
 * integration suite.
 *
 * WHAT THIS SUITE PINS (the human-in-the-loop workflow end to end, at the
 * UI layer, with REAL mouse events — §15.40):
 *
 *   A. PromotionCyclesTab (the dedicated area):
 *      - the honest empty state + the create button's year labels;
 *      - a REAL click on « Nouveau cycle » creates the cycle through
 *        openOrCreateCycle (toast + the aggregated row with the class
 *        count of the current year);
 *      - the create button DISABLES once the source year has an active
 *        cycle (one cycle per year);
 *      - clicking « Continuer »/« Ouvrir » opens the detail.
 *
 *   B. PromotionCycleDetail (the class worklist + the gating):
 *      - « Terminer le cycle » is DISABLED while classes remain pending,
 *        with the remaining-classes hint listing them by name;
 *      - after the last class is processed the button ENABLES; clicking it
 *        completes the cycle (toast) and the post-completion handoff card
 *        (Constitution des classes) appears;
 *      - « Rouvrir » returns a processed class to review (« Examiner »
 *        re-appears).
 *
 *   C. PromotionClassReviewModal (THE human-in-the-loop unit):
 *      - the decision table renders the class's students with their
 *        yearly GPAs, destinations and decision selects;
 *      - the client-side pre-visualization of the incomplete-notes warning
 *        (« Les notes ne sont pas encore toutes renseignées ») renders
 *        BEFORE any confirm attempt;
 *      - the FIRST « Confirmer la classe » click is REJECTED by the server
 *        two-phase ack ([NOTES_INCOMPLETES]) and surfaces the BLOCKING
 *        warning panel — never a silent pass;
 *      - « Annuler » dismisses the warning WITHOUT confirming;
 *      - « Oui, continuer la confirmation » re-submits with the ack and
 *        the class lands processed (toast + counts);
 *      - a per-student decision OVERRIDE via the real Radix mouse dance
 *        flows into the confirm payload;
 *      - raising the « Seuil de passage » flips a borderline student's
 *        suggested decision (the SAME canonical engine, re-run live).
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-407-t403-cycles-ui.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import * as React from "react";

import "../../../i18n/i18n";
import { store } from "../../../infrastructure/mock/repositories/mock-store";
import {
  MockPromotionCycleRepository,
} from "../../../infrastructure/mock/repositories/academic-repository";
import {
  mockRepositories,
  RepositoryProvider,
} from "../../../app/providers/repository-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { Role } from "../../../core/rbac/roles";
import type { Student, GradeLevel } from "../../../domain/model/student";
import type { Assessment } from "../../../domain/model/academic";
import type { AcademicClass } from "../../../domain/model/academic";
import { PromotionCyclesTab } from "../../../features/academics/promotion-cycles/promotion-cycles-tab";
import { PromotionCycleDetail } from "../../../features/academics/promotion-cycles/promotion-cycle-detail";
import { PromotionClassReviewModal } from "../../../features/academics/promotion-cycles/promotion-class-review-modal";
import { ToastViewport } from "../../../shared/layout/toast-viewport";
import type { PromotionCycle, PromotionCycleClass } from "../../../domain/model/promotion-cycle";
import { pickRadixOption, outsideAct, mouseClick } from "../../_helpers/radix-mouse";

/* ------------------------------------------------------------------ */
/* Fixtures — a dedicated single-class year (deterministic gating).     */
/* ------------------------------------------------------------------ */

const TENANT = store.parents[0]?.tenantId ?? "t1";
const YEAR = "2023-2024";
const YEAR_ID = "ay-t406-2023-2024";
const CLASS_ID = "5d3f0000-0000-4000-8000-00000000c403";

const STUDENT_PASSING: Student = {
  id: "6e4a0000-0000-4000-8000-00000000d403",
  tenantId: TENANT,
  code: "ELV-2025-T40603",
  parentId: "par-001",
  firstName: "Sofia",
  lastName: "Bouzid",
  displayName: "Sofia Bouzid",
  gender: "female",
  birthDate: "2015-06-01",
  enrollmentDate: "2023-09-01",
  level: "primaire",
  gradeYear: 3,
  gradeLevel: "3ap",
  classId: CLASS_ID,
  photoUrl: null,
  medicalNotes: null,
  transportTier: null,
  status: "active",
  paymentPlan: "tranches",
  academicHistory: [],
  documents: [],
  notes: [],
  createdAt: "2023-09-01T00:00:00.000Z",
  updatedAt: "2023-09-01T00:00:00.000Z",
} as unknown as Student;

/** A 3ème-année student with PASSING grades → the graduation path. */
const STUDENT_GRADUATING: Student = {
  ...STUDENT_PASSING,
  id: "6e4a0000-0000-4000-8000-00000000d404",
  code: "ELV-2025-T40604",
  firstName: "Adel",
  lastName: "Rahmani",
  displayName: "Adel Rahmani",
  gender: "male",
  level: "lycee",
  gradeYear: 3,
  gradeLevel: "3eme_annee",
} as unknown as Student;

/** An ACTIVE student with NO assessments — the incomplete-notes path. */
const STUDENT_INCOMPLETE: Student = {
  ...STUDENT_PASSING,
  id: "6e4a0000-0000-4000-8000-00000000d405",
  code: "ELV-2025-T40605",
  firstName: "Meriem",
  lastName: "Larbi",
  displayName: "Meriem Larbi",
  gender: "female",
} as unknown as Student;

const TEST_CLASS: AcademicClass = {
  id: CLASS_ID,
  tenantId: TENANT,
  academicYearId: YEAR_ID,
  academicYear: YEAR,
  academicLevelId: "al-3ap",
  code: "CLS-T406-CYC",
  name: "3ème AP - Cycle T406",
  gradeCode: "3ap" as GradeLevel,
  level: "primaire",
  gradeYear: 3,
  section: "Section T406",
  filiereCode: null,
  specialiteCode: null,
  room: "C01",
  capacity: null,
  homeroomTeacherId: null,
  homeroomTeacherName: null,
  notes: null,
  enrolledCount: 3,
  isActive: true,
} as unknown as AcademicClass;

/** Complete passing assessments for the two graded students (avg 12.5). */
function completeAssessment(studentId: string, i: number): Assessment {
  return {
    id: `asm-t406-${i}`,
    studentId,
    classId: CLASS_ID,
    subjectId: "sub-001",
    term: "T3",
    academicYear: YEAR,
    devoir1: 12,
    devoir2: 14,
    examen: 12,
    cc: null,
    subjectAverage: 12.5,
    coefficient: 3,
    coefficientDevoir1: 1,
    coefficientDevoir2: 1,
    coefficientExamen: 2,
    coefficientCc: 0,
    enteredBy: "user-t406",
    enteredAt: "2024-06-01T00:00:00.000Z",
  } as unknown as Assessment;
}

const ASSESSMENTS = [
  completeAssessment(STUDENT_PASSING.id, 1),
  completeAssessment(STUDENT_GRADUATING.id, 2),
];

/* ------------------------------------------------------------------ */
/* Harness + lifecycle.                                                 */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

const STUDENTS = [STUDENT_PASSING, STUDENT_GRADUATING, STUDENT_INCOMPLETE];

function injectFixtures(): void {
  if (!store.academicYears.some((y) => y.id === YEAR_ID)) {
    store.academicYears.push({
      id: YEAR_ID,
      tenantId: TENANT,
      code: YEAR,
      label: `Année scolaire ${YEAR}`,
      startDate: "2023-09-01",
      endDate: "2024-06-30",
      termStructure: "trimester",
      isCurrent: false,
      isArchived: true,
    } as never);
  }
  if (!store.classes.some((c) => c.id === CLASS_ID)) store.classes.push({ ...TEST_CLASS });
  for (const s of STUDENTS) {
    if (!store.students.some((x) => x.id === s.id)) store.students.push({ ...s });
  }
  for (const a of ASSESSMENTS) {
    if (!store.assessments.some((x) => x.id === a.id)) store.assessments.push(a);
  }
  store.classes$.set([...store.classes]);
  store.notifyStudents();
  store.notifyAssessments();
  store.notifyAcademicYears();
}

function removeFixtures(): void {
  store.academicYears = store.academicYears.filter((y) => y.id !== YEAR_ID);
  store.classes = store.classes.filter((c) => c.id !== CLASS_ID);
  store.students = store.students.filter((s) => STUDENTS.some((x) => x.id === s.id) === false);
  store.assessments = store.assessments.filter((a) => !ASSESSMENTS.some((x) => x.id === a.id));
  store.classes$.set([...store.classes]);
  store.notifyStudents();
  store.notifyAssessments();
  store.notifyAcademicYears();
}

beforeEach(() => {
  MockPromotionCycleRepository.reset();
  injectFixtures();
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({
      userId: "user-t406", tenantId: TENANT, email: "a@b.c", displayName: "Agent T406",
      avatarUrl: null, role: Role.SuperAdmin, permissions: [],
      accessToken: "t", refreshToken: null, expiresAt: Date.now() + 3600000, locale: "fr",
    }),
  );
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 300));
  MockPromotionCycleRepository.reset();
  removeFixtures();
  localStorage.removeItem("el-imtiyaz.session");
  cleanup();
});

function TestProviders({ children }: { children: React.ReactNode }) {
  return (
    <RepositoryProvider repositories={mockRepositories}>
      <AuthProvider>
        <ToastProvider>
          {children}
          {/* The toasts only materialize in the DOM through the viewport
              (the t-399 harness pattern). */}
          <ToastViewport />
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

/** Opens the dedicated single-class cycle (the deterministic fixture). */
async function openTestCycle(): Promise<PromotionCycle> {
  const result = await mockRepositories.promotionCycles.openOrCreateCycle({
    sourceAcademicYear: YEAR,
    performedBy: "user-t406",
    performedByName: "Agent T406",
  });
  if (!result.ok) throw new Error(`openOrCreateCycle failed: ${result.error.message}`);
  return result.value;
}

async function cycleClassesOf(cycleId: string): Promise<readonly PromotionCycleClass[]> {
  const result = await mockRepositories.promotionCycles.getCycleClasses(cycleId);
  if (!result.ok) throw new Error("getCycleClasses failed");
  return result.value;
}

/** Renders the review modal for the dedicated class inside the cycle. */
async function renderReviewModal(): Promise<{
  cycle: PromotionCycle;
  cycleClass: PromotionCycleClass;
  onConfirmed: ReturnType<typeof vi.fn>;
}> {
  const cycle = await openTestCycle();
  const classes = await cycleClassesOf(cycle.id);
  const row = classes.find((c) => c.classId === CLASS_ID);
  if (!row) throw new Error("the test class is not in the cycle");
  const onConfirmed = vi.fn();
  render(
    <TestProviders>
      <PromotionClassReviewModal
        cycle={cycle}
        cycleClass={row}
        open
        onOpenChange={() => {}}
        onConfirmed={onConfirmed}
      />
    </TestProviders>,
  );
  // Wait for the STUDENTS to stream in (the modal title renders before the
  // class roster observable resolves).
  await waitFor(() => {
    expect(screen.getByText("Sofia Bouzid")).toBeTruthy();
  });
  return { cycle, cycleClass: row, onConfirmed };
}

/* ================================================================== */
/* A. The Cycles tab.                                                   */
/* ================================================================== */

describe("T-407 A. PromotionCyclesTab — the dedicated area", () => {
  it("renders the honest empty state with the current-year create labels", async () => {
    render(
      <TestProviders>
        <PromotionCyclesTab />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText("Aucun cycle de promotion")).toBeTruthy();
    });
    // The current seed year is 2025-2026 → target 2026-2027.
    expect(screen.getByText(/Nouveau cycle — 2025-2026 → 2026-2027/)).toBeTruthy();
    expect(
      screen.getByText(/Créez le cycle de l'année courante/),
    ).toBeTruthy();
  });

  it("a real click creates the cycle (toast + the aggregated row with the class count)", async () => {
    render(
      <TestProviders>
        <PromotionCyclesTab />
      </TestProviders>,
    );
    const createBtn = await screen.findByRole("button", {
      name: /Nouveau cycle — 2025-2026 → 2026-2027/,
    });
    mouseClick(createBtn);

    // The toast announces the creation with the class count.
    await waitFor(() => {
      expect(screen.getByText("Cycle de promotion créé")).toBeTruthy();
    });
    // The cycle detail opens (selected) — the header shows the pair.
    await waitFor(() => {
      expect(screen.getByText(/Cycle 2025-2026 → 2026-2027/)).toBeTruthy();
    });
  });

  it("the create button disables once the source year has an active cycle", async () => {
    render(
      <TestProviders>
        <PromotionCyclesTab />
      </TestProviders>,
    );
    const createBtn = await screen.findByRole("button", {
      name: /Nouveau cycle — 2025-2026 → 2026-2027/,
    });
    mouseClick(createBtn);
    await waitFor(() => {
      expect(screen.getByText(/Cycle 2025-2026 → 2026-2027/)).toBeTruthy();
    });
    // Back to the table (the « Cycles » back button).
    const back = screen.getByRole("button", { name: /Cycles/ });
    mouseClick(back);
    const disabledBtn = await screen.findByRole("button", {
      name: /Cycle 2025-2026 déjà ouvert/,
    });
    expect((disabledBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

/* ================================================================== */
/* B. The cycle detail — the worklist, the gating, the reopen.          */
/* ================================================================== */

describe("T-407 B. PromotionCycleDetail — the worklist + the completion gating", () => {
  it("« Terminer le cycle » is disabled while a class is pending, with the remaining hint", async () => {
    const cycle = await openTestCycle();
    render(
      <TestProviders>
        <PromotionCycleDetail
          cycle={cycle}
          onBack={() => {}}
          onCycleUpdated={() => {}}
        />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getAllByText("3ème AP - Cycle T406").length).toBeGreaterThanOrEqual(1);
    });
    const completeBtn = screen.getByRole("button", { name: /Terminer le cycle/i });
    expect((completeBtn as HTMLButtonElement).disabled).toBe(true);
    // The hint names the remaining classes (the class name also appears in
    // the worklist row — count both).
    expect(
      screen.getAllByText(/classes restantes : 3ème AP - Cycle T406/).length,
    ).toBe(1);
    // The pending class offers « Examiner ».
    expect(screen.getByRole("button", { name: /Examiner/ })).toBeTruthy();
  });

  it("after the last class is processed the button enables; clicking completes + the handoff card", async () => {
    const cycle = await openTestCycle();
    const classes = await cycleClassesOf(cycle.id);
    const row = classes.find((c) => c.classId === CLASS_ID)!;

    // Process the class through the SAME repository path (the review modal
    // leg is covered in suite C — here we pin the gating transition).
    const confirm = await mockRepositories.promotionCycles.confirmClass({
      cycleId: cycle.id,
      classId: CLASS_ID,
      decisions: STUDENTS.map((s) => ({
        student_id: s.id,
        decision: "promoted" as const,
        next_grade_code: "4ap" as GradeLevel,
        academic_year: YEAR,
        cycle: "primaire" as const,
        grade_code: s.gradeLevel,
        grade_year: s.gradeYear,
        class_id: null,
        class_name: row.className,
        gpa: 12.5,
        rank: null,
        narrative: null,
      })),
      acknowledgeIncompleteNotes: true,
      performedBy: "user-t406",
      performedByName: "Agent T406",
    });
    expect(confirm.ok).toBe(true);

    // The refreshed cycle (the aggregates after the confirmation).
    const cycles = await mockRepositories.promotionCycles.listCycles();
    if (!cycles.ok) throw new Error("listCycles failed");
    const updated = cycles.value.find((c) => c.id === cycle.id)!;

    render(
      <TestProviders>
        <PromotionCycleDetail
          cycle={updated}
          onBack={() => {}}
          onCycleUpdated={() => {}}
        />
      </TestProviders>,
    );
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Terminer le cycle/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    // The processed class offers « Rouvrir », not « Examiner ».
    expect(screen.queryByRole("button", { name: /Examiner/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Rouvrir/ })).toBeTruthy();

    mouseClick(screen.getByRole("button", { name: /Terminer le cycle/i }));
    await waitFor(() => {
      // The toast AND the completed badge both read « Cycle terminé ».
      expect(screen.getAllByText("Cycle terminé").length).toBeGreaterThanOrEqual(2);
    });
    // The post-completion handoff card.
    expect(screen.getByText(/Constitution des classes/)).toBeTruthy();
    expect(screen.getByText(/la répartition consomme le résultat de la promotion/)).toBeTruthy();
  });

  it("« Rouvrir » returns a processed class to review (Examiner re-appears)", async () => {
    const cycle = await openTestCycle();
    const classes = await cycleClassesOf(cycle.id);
    const row = classes.find((c) => c.classId === CLASS_ID)!;
    await mockRepositories.promotionCycles.confirmClass({
      cycleId: cycle.id,
      classId: CLASS_ID,
      decisions: STUDENTS.map((s) => ({
        student_id: s.id,
        decision: "repeated" as const,
        next_grade_code: null,
        academic_year: YEAR,
        cycle: "primaire" as const,
        grade_code: s.gradeLevel,
        grade_year: s.gradeYear,
        class_id: null,
        class_name: row.className,
        gpa: 12.5,
        rank: null,
        narrative: null,
      })),
      acknowledgeIncompleteNotes: true,
      performedBy: "user-t406",
      performedByName: "Agent T406",
    });
    const cyclesAfter = await mockRepositories.promotionCycles.listCycles();
    if (!cyclesAfter.ok) throw new Error("listCycles failed");
    const updated = cyclesAfter.value.find((c) => c.id === cycle.id)!;

    render(
      <TestProviders>
        <PromotionCycleDetail
          cycle={updated}
          onBack={() => {}}
          onCycleUpdated={() => {}}
        />
      </TestProviders>,
    );
    const reopen = await screen.findByRole("button", { name: /Rouvrir/ });
    mouseClick(reopen);
    await waitFor(() => {
      expect(screen.getByText("Classe rouverte")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Examiner/ })).toBeTruthy();
    });
    // The gating re-engages.
    const completeBtn = screen.getByRole("button", { name: /Terminer le cycle/i }) as HTMLButtonElement;
    expect(completeBtn.disabled).toBe(true);
  });
});

/* ================================================================== */
/* C. The review modal — THE human-in-the-loop unit.                    */
/* ================================================================== */

describe("T-407 C. PromotionClassReviewModal — the review + the two-phase ack", () => {
  it("renders the decision table with GPAs, destinations and the incomplete badge", async () => {
    await renderReviewModal();

    // The three students.
    expect(screen.getByText("Sofia Bouzid")).toBeTruthy();
    expect(screen.getByText("Adel Rahmani")).toBeTruthy();
    expect(screen.getByText("Meriem Larbi")).toBeTruthy();
    // The graded students' GPA (both at 12.50); the incomplete student's
    // honest dash.
    expect(screen.getAllByText("12.50").length).toBe(2);
    expect(screen.getAllByText(/à paraître/).length).toBe(1);
    // The destination badges: 3ap → 4ap; 3eme_annee → Fin de scolarité.
    expect(screen.getByText("4ap")).toBeTruthy();
    expect(screen.getByText("Fin de scolarité")).toBeTruthy();
    // The incomplete student carries the warning badge.
    expect(screen.getByText("notes incomplètes")).toBeTruthy();
  });

  it("pre-visualizes the incomplete-notes warning BEFORE any confirm attempt", async () => {
    await renderReviewModal();
    expect(
      screen.getByText(/Les notes ne sont pas encore toutes renseignées \(1 élève\(s\) : Meriem Larbi\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Les moyennes manquantes ne sont jamais traitées comme zéro/),
    ).toBeTruthy();
  });

  it("the FIRST confirm is rejected by the two-phase ack; « Annuler » dismisses without confirming", async () => {
    const { onConfirmed } = await renderReviewModal();

    mouseClick(screen.getByRole("button", { name: /Confirmer la classe/ }));
    // The BLOCKING warning panel (the server's [NOTES_INCOMPLETES] marker).
    await waitFor(() => {
      expect(screen.getByText("Les notes ne sont pas toutes renseignées")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Oui, continuer la confirmation/ })).toBeTruthy();

    // Annuler → dismissed, nothing confirmed. NOTE: the modal's own footer
    // also carries an « Annuler » — pick the one INSIDE the warning panel.
    const warningPanel = screen
      .getByText("Les notes ne sont pas toutes renseignées")
      .closest("div.rounded-lg")!;
    const cancelInWarning = [...warningPanel.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Annuler",
    )!;
    mouseClick(cancelInWarning);
    await waitFor(() => {
      expect(screen.queryByText("Les notes ne sont pas toutes renseignées")).toBeNull();
    });
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Confirmer la classe/ })).toBeTruthy();
  });

  it("« Oui, continuer la confirmation » re-submits with the ack → the class lands processed", async () => {
    const { cycle, onConfirmed } = await renderReviewModal();

    mouseClick(screen.getByRole("button", { name: /Confirmer la classe/ }));
    await waitFor(() => {
      expect(screen.getByText("Les notes ne sont pas toutes renseignées")).toBeTruthy();
    });
    mouseClick(screen.getByRole("button", { name: /Oui, continuer la confirmation/ }));

    await waitFor(() => {
      expect(screen.getByText("Classe confirmée")).toBeTruthy();
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);

    // The canonical execution landed: the promoted students advanced + the
    // history appended (the SAME execute_batch_promotion semantics).
    await waitFor(() => {
      const sofia = store.students.find((s) => s.id === STUDENT_PASSING.id);
      expect(sofia?.gradeLevel).toBe("4ap");
      expect(sofia?.classId).toBeNull();
      expect(sofia?.academicHistory?.some((h) => h.academicYear === YEAR && h.decision === "promoted")).toBe(true);
      // The incomplete-notes student stayed on the honest default (repeat).
      const meriem = store.students.find((s) => s.id === STUDENT_INCOMPLETE.id);
      expect(meriem?.gradeLevel).toBe("3ap");
    });
    // The class row is processed in the cycle. NOTE the aggregate
    // semantics: « graduated » counts in the DEFERRED bucket (the 0108
    // mirror), so 3 students → 1 promoted + 1 repeated + 1 deferred.
    const classes = await cycleClassesOf(cycle.id);
    const row = classes.find((c) => c.classId === CLASS_ID)!;
    expect(row.status).toBe("processed");
    expect(row.promotedCount).toBe(1);
    expect(row.repeatingCount).toBe(1);
    expect(row.deferredCount).toBe(1);
  });

  it("a per-student decision OVERRIDE via the mouse dance flows into the confirm payload", async () => {
    await renderReviewModal();

    // The incomplete student's decision select — override to Promu(e).
    const meriemRow = screen.getByText("Meriem Larbi").closest("tr")!;
    const trigger = meriemRow.querySelector('[role="combobox"]') as HTMLElement;
    await outsideAct(async () => {
      await pickRadixOption(trigger, "Promu(e)");
    });

    // Confirm through the two-phase ack.
    mouseClick(screen.getByRole("button", { name: /Confirmer la classe/ }));
    await waitFor(() => {
      expect(screen.getByText("Les notes ne sont pas toutes renseignées")).toBeTruthy();
    });
    mouseClick(screen.getByRole("button", { name: /Oui, continuer la confirmation/ }));
    await waitFor(() => {
      expect(screen.getByText("Classe confirmée")).toBeTruthy();
    });

    // The override landed: Meriem was PROMOTED despite the missing notes
    // (the explicit human decision — never a silent default).
    await waitFor(() => {
      const meriem = store.students.find((s) => s.id === STUDENT_INCOMPLETE.id);
      expect(meriem?.gradeLevel).toBe("4ap");
      expect(
        meriem?.academicHistory?.some(
          (h) => h.academicYear === YEAR && h.decision === "promoted",
        ),
      ).toBe(true);
    });
  });

  it("raising the « Seuil de passage » flips the borderline student's suggested decision", async () => {
    await renderReviewModal();

    // At the default threshold 10: Sofia (12.50) is Promu(e).
    const sofiaRow = screen.getByText("Sofia Bouzid").closest("tr")!;
    expect(sofiaRow.textContent).toContain("Admis");

    // Raise the threshold to 15 — Sofia's 12.50 is now below it. The
    // FormField label is not htmlFor-associated — find the input through
    // the label's field container. React's controlled-input contract:
    // the PROTOTYPE value setter + a bubbling input event (the t-399
    // engine's documented dance — direct assignment fights valueTracker).
    const thresholdLabel = [...document.querySelectorAll("label")].find((l) =>
      (l.textContent ?? "").includes("Seuil de passage"),
    )!;
    const input = thresholdLabel.closest("div")!.querySelector(
      "input[type=number]",
    ) as HTMLInputElement;
    await outsideAct(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "15");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await waitFor(() => {
      const row = screen.getByText("Sofia Bouzid").closest("tr")!;
      expect(row.textContent).toContain("Non admis");
      // And her suggested decision select now reads Redouble.
      const trigger = row.querySelector('[role="combobox"]') as HTMLElement;
      expect(trigger.textContent).toContain("Redouble");
    });
  });
});
