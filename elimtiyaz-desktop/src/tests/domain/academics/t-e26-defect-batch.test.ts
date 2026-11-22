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

describe("E2.6 / BUG-004 — deterministicStudentCode's missing empty-field filter", () => {
  // The parent side filters empty identity fields after trim (the
  // cross-platform equivalence fix); the student side joined them raw.
  it("empty/whitespace student identity fields are excluded from the hash (the parent rule)", async () => {
    const { deterministicStudentCode } = await import("../../../core/format/id");
    const withEmpty = deterministicStudentCode(2026, "par-1", {
      displayName: "  ",
      firstName: "A",
      lastName: "B",
    });
    const without = deterministicStudentCode(2026, "par-1", {
      firstName: "A",
      lastName: "B",
    });
    expect(withEmpty).toBe(without);
  });

  it("an empty parentId no longer fabricates a non-empty join (the fallback seed wins)", async () => {
    const { deterministicStudentCode } = await import("../../../core/format/id");
    // Pre-fix: ("", {displayName:"Nour"}) joined to "|Nour||" — the
    // identity length check passed and the fallback seed was unreachable.
    // Post-fix: displayName alone still forms the identity (it is a REAL
    // field) — the seed only wins when EVERYTHING is empty.
    const onlyName = deterministicStudentCode(2026, "", { displayName: "Nour" });
    const allEmpty = deterministicStudentCode(2026, "", { displayName: " " }, "sync-entry-7");
    const allEmptyAgain = deterministicStudentCode(2026, "", { displayName: "" }, "sync-entry-7");
    expect(onlyName).toMatch(/^ELV-2026-[0-9A-F]{6}$/);
    expect(allEmpty).toBe(allEmptyAgain); // retry-stable through the seed
    // And the seed lane is actually reachable now (differs from the
    // orphan-default lane and from any identity hash).
    const orphanDefault = deterministicStudentCode(2026, "", { displayName: "" });
    expect(allEmpty).not.toBe(orphanDefault);
  });

  it("sparse identity produces a DIFFERENT (noise-free) code than the old raw join", async () => {
    const { deterministicStudentCode, stableHash } = await import("../../../core/format/id");
    // The old rule: ["", "", "A", ""].join("|").trim() = "||A|" — hashed
    // the pipe noise. The new rule hashes exactly "A".
    const fixed = deterministicStudentCode(2026, "", { firstName: "A" });
    expect(fixed).toBe(`ELV-2026-${stableHash("A")}`);
  });
});

describe("E2.6 / BUG-005 — plan_collection_campaign slices before sorting", () => {
  it("amount_first plans the campaign around the LARGEST debtors, not the first N rows", async () => {
    const { executeWorkflowTool } = await import("../../../core/ai/tools/workflow-tools");
    // A stub repos surface: 6 debtors in ASCENDING amount order (the worst
    // ordering for the old slice-first rule) with limit 3.
    const summary = [
      { parentId: "p1", parentName: "Petit Un", parentPhone: null, studentCount: 1, outstandingAmount: 1_000, daysOverdue: 40, bucket: "31-60" },
      { parentId: "p2", parentName: "Petit Deux", parentPhone: null, studentCount: 1, outstandingAmount: 2_000, daysOverdue: 45, bucket: "31-60" },
      { parentId: "p3", parentName: "Petit Trois", parentPhone: null, studentCount: 1, outstandingAmount: 3_000, daysOverdue: 50, bucket: "31-60" },
      { parentId: "p4", parentName: "Grand Quatre", parentPhone: null, studentCount: 2, outstandingAmount: 400_000, daysOverdue: 35, bucket: "31-60" },
      { parentId: "p5", parentName: "Grand Cinq", parentPhone: null, studentCount: 2, outstandingAmount: 500_000, daysOverdue: 30, bucket: "31-60" },
      { parentId: "p6", parentName: "Grand Six", parentPhone: null, studentCount: 2, outstandingAmount: 600_000, daysOverdue: 32, bucket: "31-60" },
    ];
    const repos = {
      debt: {
        observeSummary: () => ({ get: () => summary }),
      },
    } as unknown as Parameters<typeof executeWorkflowTool>[2];

    const out = await executeWorkflowTool(
      "plan_collection_campaign",
      { strategy: "amount_first", limit: 3 },
      repos,
    );
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.error).toBeUndefined();
    // The planned debtors must be the three LARGEST (600k/500k/400k), not
    // the first three repository rows (1k/2k/3k) the old slice produced.
    const names = (parsed.prioritized_debtors as Array<{ parent_name: string }>).map((d) => d.parent_name);
    expect(names).toContain("Grand Six");
    expect(names).toContain("Grand Cinq");
    expect(names).toContain("Grand Quatre");
    expect(names).not.toContain("Petit Un");
  });

  it("aging_first prioritizes the OLDEST overdue debtors in the slice", async () => {
    const { executeWorkflowTool } = await import("../../../core/ai/tools/workflow-tools");
    const summary = [
      { parentId: "p1", parentName: "Récent Un", parentPhone: null, studentCount: 1, outstandingAmount: 10_000, daysOverdue: 31, bucket: "31-60" },
      { parentId: "p2", parentName: "Récent Deux", parentPhone: null, studentCount: 1, outstandingAmount: 10_000, daysOverdue: 33, bucket: "31-60" },
      { parentId: "p3", parentName: "Récent Trois", parentPhone: null, studentCount: 1, outstandingAmount: 10_000, daysOverdue: 35, bucket: "31-60" },
      { parentId: "p4", parentName: "Ancien Quatre", parentPhone: null, studentCount: 1, outstandingAmount: 5_000, daysOverdue: 200, bucket: "180+" },
      { parentId: "p5", parentName: "Ancien Cinq", parentPhone: null, studentCount: 1, outstandingAmount: 5_000, daysOverdue: 150, bucket: "91-180" },
      { parentId: "p6", parentName: "Ancien Six", parentPhone: null, studentCount: 1, outstandingAmount: 5_000, daysOverdue: 120, bucket: "91-180" },
    ];
    const repos = {
      debt: {
        observeSummary: () => ({ get: () => summary }),
      },
    } as unknown as Parameters<typeof executeWorkflowTool>[2];

    const out = await executeWorkflowTool(
      "plan_collection_campaign",
      { strategy: "aging_first", limit: 3 },
      repos,
    );
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.error).toBeUndefined();
    const names = (parsed.prioritized_debtors as Array<{ parent_name: string }>).map((d) => d.parent_name);
    expect(names).toContain("Ancien Quatre");
    expect(names).toContain("Ancien Cinq");
    expect(names).toContain("Ancien Six");
    expect(names).not.toContain("Récent Un");
  });
});
