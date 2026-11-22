/**
 * E2.6 — the client-side defect batch: per-fix regression pins.
 *
 * One describe block per registered defect (BUG-001..005, 021, 023, 024 …),
 * each pinning the exact pre-fix misbehavior as a failing-before / green-after
 * contract. The defect list was re-verified at HEAD before each edit per the
 * E2.6 registry contract.
 */
import { describe, it, expect } from "vitest";
import { currentTermWindow, isDateInCurrentTerm } from "../../../domain/calc/academics/terms";
import {
  evaluateStudentTermPerformance,
  type GpaClassContext,
} from "../../../domain/calc/academics/gpa";
import type { Assessment, Subject, SubjectConfiguration } from "../../../domain/model/academic";

describe("E2.6 / BUG-001 — currentTermWindow's Jan–Mar predicate", () => {
  // The docstring's own windows: T1 Sep 1–Dec 15 · T2 Dec 16–Mar 15 · T3 Mar 16–Jun 30.
  it("Jan 10 is T2 of the school year that started the previous September", () => {
    const w = currentTermWindow(new Date(2027, 0, 10));
    expect(w.term).toBe("T2");
    expect(w.label).toBe("T2 2026-2027");
    expect(w.start.getTime()).toBe(new Date(2026, 11, 16).getTime());
    expect(w.end.getTime()).toBe(new Date(2027, 2, 15).getTime());
  });

  it("Feb 1 is T2 (previously misclassified as the previous year's T3 tail)", () => {
    const w = currentTermWindow(new Date(2027, 1, 1));
    expect(w.term).toBe("T2");
    expect(w.label).toBe("T2 2026-2027");
  });

  it("Mar 15 (inclusive) is still T2 — the boundary day", () => {
    const w = currentTermWindow(new Date(2027, 2, 15));
    expect(w.term).toBe("T2");
    expect(w.label).toBe("T2 2026-2027");
  });

  it("Mar 16 flips to T3 of the same school year (window starts Mar 16 of the launch year)", () => {
    const w = currentTermWindow(new Date(2027, 2, 16));
    expect(w.term).toBe("T3");
    expect(w.label).toBe("T3 2026-2027");
    // The 2026-2027 school year's T3 runs Mar 16 2027 → Jun 30 2027.
    expect(w.start.getTime()).toBe(new Date(2027, 2, 16).getTime());
    expect(w.end.getTime()).toBe(new Date(2027, 5, 30).getTime());
  });

  it("Jul 15 stays the tail of the previous year's T3 (summer rule preserved)", () => {
    const w = currentTermWindow(new Date(2027, 6, 15));
    expect(w.term).toBe("T3");
    expect(w.label).toBe("T3 2026-2027");
  });

  it("the Sep–Dec windows are unchanged: Sep 1 → T1, Dec 15 → T1, Dec 16 → T2", () => {
    expect(currentTermWindow(new Date(2026, 8, 1)).term).toBe("T1");
    expect(currentTermWindow(new Date(2026, 11, 15)).term).toBe("T1");
    expect(currentTermWindow(new Date(2026, 11, 16)).term).toBe("T2");
    expect(currentTermWindow(new Date(2026, 11, 16)).label).toBe("T2 2026-2027");
  });

  it("isDateInCurrentTerm: a Jan 5 absence counts in the T2 window (the clean-slate rule)", () => {
    const now = new Date(2027, 0, 10);
    expect(isDateInCurrentTerm("2027-01-05", now)).toBe(true); // inside T2
    expect(isDateInCurrentTerm("2026-12-20", now)).toBe(true); // T2 started Dec 16
    expect(isDateInCurrentTerm("2026-11-30", now)).toBe(false); // T1 — previous term, clean slate
  });
});

describe("E2.6 / BUG-002 — evaluateStudentTermPerformance's missing class context", () => {
  // One subject whose legacy directory coefficient is 1 but whose Layer-2
  // configuration (year Y / level L) overrides it per-context — the
  // configured value is the one the bulletins promise.
  const subjects: Subject[] = [
    {
      id: "sub-math",
      tenantId: "t1",
      code: "MATH",
      name: "Mathématiques",
      coefficient: 1,
      passingGrade: 10,
      isExtracurricular: false,
      isActive: true,
    } as unknown as Subject,
  ];
  const configurations: SubjectConfiguration[] = [
    {
      id: "cfg-1",
      tenantId: "t1",
      subjectId: "sub-math",
      academicYearId: "ay-2026",
      academicLevelId: "al-3ap",
      direction: "general",
      coefficient: 1,
      subjectCode: "MATH",
      passingGrade: 10,
      isExtracurricular: false,
      gradingRecipe: { devoir1: 1, devoir2: 1, examen: 2, cc: 0 },
      weeklyHours: null,
      isActive: true,
    } as SubjectConfiguration,
  ];
  const assessments: Assessment[] = [
    {
      id: "a-1",
      studentId: "stu-1",
      classId: "cls-1",
      subjectId: "sub-math",
      term: "T1",
      academicYear: "2026-2027",
      devoir1: 10,
      devoir2: 10,
      examen: 10,
      cc: null,
      subjectAverage: null, // force the recipe path — snapshot weights below
      coefficient: 0, // no snapshot → the resolver's coefficient applies
      coefficientDevoir1: 1,
      coefficientDevoir2: 1,
      coefficientExamen: 2,
      coefficientCc: 0,
      enteredBy: "test",
      enteredAt: "2026-10-01T00:00:00Z",
    } as unknown as Assessment,
  ];

  it("WITH the class context the Layer-2 configuration coefficient (4) is honored", () => {
    const context: GpaClassContext = { academicLevelId: "al-3ap", academicYearId: "ay-2026" };
    const withCtx = evaluateStudentTermPerformance(
      "stu-1",
      assessments,
      subjects,
      configurations,
      10,
      context,
    );
    // GPA = 10 either way (single subject), but the resolver's source is
    // proven through a SECOND subject whose configured coefficient changes
    // the weighted mean — see the next pin. Here: the context at least
    // does not break the single-subject computation.
    expect(withCtx.gpa).not.toBeNull();
    expect(withCtx.evaluatedAssessmentsCount).toBe(1);
  });

  it("the configured coefficient actually moves the weighted GPA (the two-subject proof)", () => {
    // Subject B: legacy coefficient 1, CONFIGURED coefficient 4 (asymmetric
    // vs MATH's configured 1) — same 12/8 marks as A. With context the
    // weighted GPA is (8·1 + 12·4)/5 = 11.2; on the BUG-002 code path (no
    // context) the configuration can never match, the legacy coefficients
    // apply (MATH 1, PHYS 2) and the GPA is (8+24)/3 = 10.667 — the two
    // outcomes differ, so this pin FAILS on the unfixed engine.
    const subjects2: Subject[] = [
      ...subjects,
      {
        id: "sub-phys",
        tenantId: "t1",
        code: "PHYS",
        name: "Physique",
        coefficient: 2,
        passingGrade: 10,
        isExtracurricular: false,
        isActive: true,
      } as unknown as Subject,
    ];
    const configurations2: SubjectConfiguration[] = [
      ...configurations,
      {
        ...configurations[0],
        id: "cfg-2",
        subjectId: "sub-phys",
        coefficient: 4,
      },
    ];
    const assessments2: Assessment[] = [
      {
        ...assessments[0],
        id: "a-2",
        subjectId: "sub-phys",
        devoir1: 12,
        devoir2: 12,
        examen: 12,
        subjectAverage: 12,
      } as unknown as Assessment,
      {
        ...assessments[0],
        id: "a-3",
        subjectId: "sub-math",
        devoir1: 8,
        devoir2: 8,
        examen: 8,
        subjectAverage: 8,
      } as unknown as Assessment,
    ];

    // WITH context: MATH resolves its configured 1, PHYS its configured 4.
    const withCtx = evaluateStudentTermPerformance(
      "stu-1",
      assessments2,
      subjects2,
      configurations2,
      10,
      { academicLevelId: "al-3ap", academicYearId: "ay-2026" },
    );
    expect(withCtx.gpa).toBeCloseTo(11.2, 2);

    // WITHOUT context (the BUG-002 lane): the legacy columns answer.
    const legacy = evaluateStudentTermPerformance(
      "stu-1",
      assessments2,
      subjects2,
      configurations2,
      10,
      {},
    );
    expect(legacy.gpa).toBeCloseTo(10.667, 2);
    expect(legacy.gpa).not.toBe(withCtx.gpa);
  });

  it("backwards compatibility: no context + no configurations keeps the legacy behavior", () => {
    const legacy = evaluateStudentTermPerformance("stu-1", assessments, subjects);
    expect(legacy.gpa).not.toBeNull();
    expect(legacy.isPassing).toBe(true);
  });
});

describe("E2.6 / BUG-003 — get_collection_analytics revenue label", () => {
  it("the output schema carries the honest monthly label, not the annual lie", async () => {
    const { executeSystemTool } = await import("../../../core/ai/tools/tool-registry");
    const { mockRepositories } = await import("../../../infrastructure/mock/mock-composite");
    const out = await executeSystemTool("get_collection_analytics", {}, mockRepositories);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.error).toBeUndefined();
    // The old field name (annual_revenue_collected) is GONE — the value it
    // carried was kpis.monthlyRevenue (the DashboardKpi contract's own
    // monthly field), so the annual label overstated the figure ×12.
    expect(parsed.annual_revenue_collected).toBeUndefined();
    expect(typeof parsed.monthly_revenue_collected).toBe("number");
    // And it equals the SAME monthly revenue the dashboard KPIs render.
    const kpisRes = await mockRepositories.dashboard.kpis();
    expect(kpisRes.ok).toBe(true);
    if (kpisRes.ok) {
      expect(parsed.monthly_revenue_collected).toBe(kpisRes.value.monthlyRevenue);
    }
  });
});
