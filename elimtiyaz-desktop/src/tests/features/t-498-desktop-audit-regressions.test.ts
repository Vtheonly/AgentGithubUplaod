/**
 * T-498 — the comprehensive desktop-audit regression suite.
 *
 * Each block reproduces ONE defect verified during the audit (the
 * file:line evidence is in the worklog and the problem-registry
 * entries registered with this task) and pins the FIXED semantics.
 * Where the defect is a private wiring or a UI-internal formula, the
 * pin is a SOURCE-SCAN (the t-438/t-439 convention); where it is
 * callable logic, the pin is BEHAVIORAL (red-before/green-after).
 *
 * Defects covered:
 *   1.  ARCH-001 residue — the promotionCycles slot was never wired to
 *       SupabasePromotionCycleRepository (live mode silently ran the
 *       in-memory mock; cycles vanished on restart).
 *   2.  alertAbsences wrote notifications with NON-EXISTENT columns
 *       (type/entity_type/entity_id vs kind/link_entity_type/
 *       link_entity_id) + created_by:"system" (not a UUID) — parent
 *       absence alerts NEVER persisted, error unchecked.
 *   3.  write_audit_log called with a non-existent p_diff param /
 *       p_entity_id:"batch" / comma-joined multi-UUID string — audit
 *       entries never persisted (§11 audit invariant).
 *   4.  mapClassRow.gradeYear used a non-canonical includes("ap") hack
 *       — 2am/3am/4am/1ere-3eme/prescolaire classes mapped to year 1,
 *       hiding them from the re-enrollment picker in live mode (the
 *       mock used the canonical helper — mock↔live divergence).
 *   5.  The unified payment modal's chips / "Reste à payer" / "Soldé
 *       total" / single-item minimum used `due − paid` (dropped
 *       amountPending) while the auto-suggest used the canonical
 *       INV-4 — over-collection risk with uncleared cheques.
 *   6.  The data-lineage inspector's aging filter included not-yet-due
 *       rows (DATA-046 applies only to the repo chart) — permanent
 *       false "Écart" on the aging cards.
 *   7.  "Dont échues (en retard)" summed family-level FULL outstanding
 *       for late families — the canonical past-due basis is
 *       overdueAmount (Σ INV-4 remaining over dynamically-overdue rows).
 *   8.  Static `status === "overdue"` gates (live census: ZERO such
 *       rows) — replaced with the canonical isInstallmentOverdue.
 *   9.  Non-canonical attendance rate (present/total) in the Excel
 *       full-export summary + the mock dashboard — (present+late)/total.
 *   10. Invalid "absent" attendance status value in the workflow
 *       dispatch filter (dead weight; effective semantics preserved).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { installmentRemaining, isInstallmentOverdue, overdueAmount } from "../../domain/calc/payment/queries";
import { calculateAttendanceRate } from "../../domain/model/academic";
import { gradeYearFromGradeLevel } from "../../domain/model/student";
import {
  buildResolution,
  type InspectRequest,
  type LineageInput,
} from "../../features/dashboard/components/analytics/data-inspector-lineage";
import type { Installment } from "../../domain/model/payment";
import type { AttendanceRecord } from "../../domain/model/academic";

const SRC = (rel: string) =>
  readFileSync(path.resolve(process.cwd(), rel), "utf8");

/** Strip comment lines so explanatory text documenting the OLD defect can
 *  never satisfy (or trip) a negative source-scan pin. */
const NO_COMMENTS = (src: string) =>
  src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

/* ============================================================ */
/*  1 — promotionCycles wiring (ARCH-001 residue)                */
/* ============================================================ */

describe("T-498 §1 — the promotionCycles slot is wired to Supabase in live mode", () => {
  const wiring = SRC("src/infrastructure/supabase/supabase-repositories.ts");

  it("the import carries SupabasePromotionCycleRepository", () => {
    expect(wiring).toContain("SupabasePromotionCycleRepository,");
  });

  it("the override list binds the slot (the in-memory mock is replaced)", () => {
    // Pinned on the exact binding expression so an explanatory comment
    // cannot satisfy the scan.
    expect(wiring).toContain("promotionCycles: new SupabasePromotionCycleRepository(client)");
  });

  it("the repository class is the RPC-backed implementation (0108 contract)", () => {
    const impl = SRC(
      "src/infrastructure/supabase/repositories/supabase-academic-repository.ts",
    );
    expect(impl).toContain("fn_create_promotion_cycle");
    expect(impl).toContain("fn_confirm_promotion_cycle_class");
    expect(impl).toContain("fn_reopen_promotion_cycle_class");
  });
});

/* ============================================================ */
/*  2 — alertAbsences notification insert shape                  */
/* ============================================================ */

// The alertAbsences insert block (between its explanatory comment and
// the audit RPC) — extracted so the negative scans are scoped to it.
const ACADEMIC_REPO = SRC(
  "src/infrastructure/supabase/repositories/supabase-academic-repository.ts",
);
const ALERT_BLOCK = ACADEMIC_REPO.slice(
  ACADEMIC_REPO.indexOf("Parent notifications for flagged students only"),
  ACADEMIC_REPO.indexOf(
    "return Ok(undefined);",
    ACADEMIC_REPO.indexOf("Parent notifications for flagged students only"),
  ),
);

describe("T-498 §2 — alertAbsences writes REAL notifications columns (0013 schema)", () => {
  it("uses the real columns: kind / link_entity_type / link_entity_id / triggered_at", () => {
    expect(ALERT_BLOCK).toContain('kind: "warning"');
    expect(ALERT_BLOCK).toContain("link_entity_type: \"student\"");
    expect(ALERT_BLOCK).toContain("link_entity_id: studentId");
    expect(ALERT_BLOCK).toContain("triggered_at:");
  });

  it("created_by is a valid uuid-or-null (never the \"system\" string)", () => {
    const code = NO_COMMENTS(ALERT_BLOCK);
    expect(code).toContain("created_by: null");
    expect(code).not.toMatch(/created_by:\s*"system"/);
  });

  it("the ghost columns (type / entity_type / entity_id) are gone from the insert", () => {
    const code = NO_COMMENTS(ALERT_BLOCK);
    expect(code).not.toMatch(/\bentity_type:\s*"/);
    expect(code).not.toMatch(/\bentity_id:\s*studentId/);
    expect(code).not.toMatch(/type:\s*"attendance_alert"/);
  });

  it("the insert result IS error-checked (no silent failure)", () => {
    expect(ALERT_BLOCK).toContain("error: alertErr");
  });

  it("parent-role broadcast targeting (the portal read path)", () => {
    expect(ALERT_BLOCK).toContain('target_role: "parent"');
  });
});

/* ============================================================ */
/*  3 — write_audit_log parameter validity (audit invariant §11) */
/* ============================================================ */

describe("T-498 §3 — write_audit_log calls use parameters the RPC actually has (0014)", () => {
  it("alertAbsences: no comma-joined multi-UUID p_entity_id; ids ride p_after_json", () => {
    const code = NO_COMMENTS(ALERT_BLOCK);
    expect(code).not.toMatch(/p_entity_id:\s*flagged\.map/);
    expect(code).not.toMatch(/\.join\(","\)/);
    expect(code).toContain("p_after_json:");
    expect(code).toContain("p_entity_id: null");
  });

  it("overdue-alert-generator: no p_diff param, no \"batch\" entity id", () => {
    const gen = NO_COMMENTS(
      SRC("src/infrastructure/supabase/repositories/supabase-overdue-alert-generator.ts"),
    );
    expect(gen).not.toMatch(/p_diff:/);
    expect(gen).not.toMatch(/p_entity_id:\s*"batch"/);
    // The structured facts ride the REAL payload column.
    expect(gen).toContain("p_after_json: { before: null, after: { count } }");
  });
});

/* ============================================================ */
/*  4 — mapClassRow.gradeYear canonical derivation               */
/* ============================================================ */

describe("T-498 §4 — class gradeYear derives from the canonical helper", () => {
  const file = SRC(
    "src/infrastructure/supabase/repositories/supabase-academic-repository.ts",
  );

  it("mapClassRow uses gradeYearFromGradeLevel (the students' derivation)", () => {
    expect(file).toContain("gradeYear: gradeYearFromGradeLevel(row.grade_code as GradeLevel) ?? 1");
  });

  it("the includes(\"ap\") parseInt hack is GONE", () => {
    expect(NO_COMMENTS(file)).not.toMatch(/grade_code\?\.includes\("ap"\)\s*\?\s*parseInt/);
  });

  it("BEHAVIORAL: every real grade code maps to its canonical year (the re-enroll picker contract)", () => {
    // The pre-fix hack returned 1 for every non-*ap code.
    const expectations: Array<[string, number]> = [
      ["1ap", 1], ["2ap", 2], ["3ap", 3], ["4ap", 4], ["5ap", 5],
      ["1am", 1], ["2am", 2], ["3am", 3], ["4am", 4],
      ["1ere_annee", 1], ["2eme_annee", 2], ["3eme_annee", 3],
      ["prescolaire_1", 0], ["prescolaire_2", 0],
    ];
    for (const [code, year] of expectations) {
      expect(gradeYearFromGradeLevel(code as never)).toBe(year);
    }
  });
});

/* ============================================================ */
/*  5 — INV-4 remaining on projections (payment modal parity)    */
/* ============================================================ */

describe("T-498 §5 — installmentRemaining is structural and INV-4-correct", () => {
  it("a projection (PaymentTrancheSpec shape) computes due − paid − pending", () => {
    // The auto-suggest / chips / slider parity case: an uncleared cheque
    // (amountPending) covers part of the tranche.
    const spec = { amountDue: 100_000, amountPaid: 30_000, amountPending: 20_000 };
    expect(installmentRemaining(spec)).toBe(50_000);
  });

  it("pending omitted (quote line items) degrades to due − paid", () => {
    expect(installmentRemaining({ amountDue: 100_000, amountPaid: 30_000 })).toBe(70_000);
  });

  it("over-coverage clamps at zero (never negative)", () => {
    expect(
      installmentRemaining({ amountDue: 100_000, amountPaid: 90_000, amountPending: 20_000 }),
    ).toBe(0);
  });

  it("null pending is tolerated (row mapper shape)", () => {
    expect(
      installmentRemaining({ amountDue: 100_000, amountPaid: 0, amountPending: null }),
    ).toBe(100_000);
  });

  it("the modal's chips/summary use the canonical helper (source pins)", () => {
    const modal = SRC("src/features/financials/unified-payment-modal.tsx");
    expect(modal).toContain("Payer {t.label} ({formatDzdPlain(installmentRemaining(t))})");
    expect(modal).toContain("totalRemaining");
    // The stale "cleared-funds convention" claim must be gone (the
    // auto-suggest uses INV-4 — the comment lied).
    expect(modal).not.toContain("Amounts use the file's established cleared-funds");
    expect(modal).toContain("amountPending: i.amountPending");
  });

  it("the slider consumes the canonical helper (no inline due − paid left)", () => {
    const slider = SRC("src/features/financials/payment-slider.tsx");
    expect(slider).not.toMatch(/Math\.max\(0,\s*t\.amountDue - t\.amountPaid\)/);
    expect(slider).toContain("installmentRemaining(t)");
  });
});

/* ============================================================ */
/*  6 — inspector aging excludes not-yet-due rows (DATA-046)     */
/* ============================================================ */

describe("T-498 §6 — the aging resolution mirrors the aging card (future rows excluded)", () => {
  const now = Date.now();
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  const daysAhead = (days: number) => new Date(now + days * 86_400_000).toISOString().slice(0, 10);

  function makeInstallment(overrides: Partial<Installment> = {}): Installment {
    return {
      id: "ins-1",
      parentId: "p-1",
      studentId: "stu-1",
      category: "tuition",
      label: "Tranche 1",
      trancheNumber: 1,
      amountDue: 100_000,
      amountPaid: 0,
      amountPending: 0,
      dueDate: daysAgo(10),
      paidDate: null,
      status: "unpaid",
      academicCycle: "primaire",
      paymentPlan: "tranches",
      isCustomSchedule: false,
      customSchedule: false,
      customScheduleNote: null,
      ...overrides,
    } as Installment;
  }

  function makeInput(overrides: Partial<LineageInput> = {}): LineageInput {
    return {
      students: [],
      parents: [],
      classes: [],
      assessments: [],
      attendance: [],
      payments: [],
      installments: [],
      debts: [],
      ledger: [],
      academicYear: "2025-2026",
      range: { from: "2025-09-01", to: "2026-09-01" },
      ...overrides,
    };
  }

  it("a not-yet-due T3 tranche is NOT reported in the 0_30 bucket (no false Écart)", () => {
    // RED before the fix: the future row (dueDate +90d) landed in 0_30
    // and inflated resolvedValue to 30_000 vs the chart's 10_000.
    const installments = [
      makeInstallment({ id: "ins-late", amountDue: 10_000, dueDate: daysAgo(5) }),
      makeInstallment({ id: "ins-future", amountDue: 20_000, dueDate: daysAhead(90) }),
    ];
    const resolved = buildResolution(
      {
        domain: "debt",
        title: "0_30",
        sourceValue: 10_000,
        filters: { agingBucket: "0_30", scope: "all" },
      } as InspectRequest,
      makeInput({ installments }),
    );
    expect(resolved.resolvedValue).toBe(10_000);
    expect(resolved.contributors.every((c) => c.id !== "ins-future")).toBe(true);
  });

  it("the buckets still partition the PAST-DUE debt (the chart's basis)", () => {
    const installments = [
      makeInstallment({ id: "ins-fresh", amountDue: 10_000, dueDate: daysAgo(5) }),
      makeInstallment({ id: "ins-mid", amountDue: 20_000, dueDate: daysAgo(45) }),
      makeInstallment({ id: "ins-old", amountDue: 40_000, dueDate: daysAgo(200) }),
      makeInstallment({ id: "ins-future", amountDue: 99_999, dueDate: daysAhead(120) }),
    ];
    const buckets = (["0_30", "31_60", "61_90", "91_180", "180_plus"] as const).map((bucket) =>
      buildResolution(
        { domain: "debt", title: bucket, sourceValue: 0, filters: { agingBucket: bucket, scope: "all" } },
        makeInput({ installments }),
      ).resolvedValue,
    );
    expect(buckets[0]).toBe(10_000);
    expect(buckets[1]).toBe(20_000);
    expect(buckets[4]).toBe(40_000);
    // The future tranche contributes to NO bucket.
    expect(buckets.reduce((s, b) => s + b, 0)).toBe(70_000);
  });

  it("lateDays derives from isInstallmentOverdue (the status string never gates it)", () => {
    // Live census: ZERO status="overdue" rows — the static gate could
    // never fire. A 10-days-late unpaid row must show its real age.
    // (Distinct parents so the contributor aggregation is unambiguous.)
    const installments = [
      makeInstallment({ id: "ins-late", parentId: "p-late", amountDue: 10_000, dueDate: daysAgo(10), status: "unpaid" }),
      makeInstallment({ id: "ins-future", parentId: "p-future", amountDue: 10_000, dueDate: daysAhead(10), status: "unpaid" }),
    ];
    const resolved = buildResolution(
      { domain: "debt", title: "all", sourceValue: 20_000, filters: { scope: "all" } },
      makeInput({ installments }),
    );
    const late = resolved.contributors.find((c) => c.key === "p-late");
    const future = resolved.contributors.find((c) => c.key === "p-future");
    expect(late?.lateDays).toBe(10);
    expect(future?.lateDays).toBe(0);
  });
});

/* ============================================================ */
/*  7 — the past-due KPI basis (financials-page)                 */
/* ============================================================ */

describe("T-498 §7 — \"Dont échues\" is the canonical past-due amount", () => {
  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString().slice(0, 10);
  const daysAhead = (d: number) => new Date(now + d * 86_400_000).toISOString().slice(0, 10);

  it("BEHAVIORAL: overdueAmount counts only past-due rows' INV-4 remaining", () => {
    // The pre-fix family-level basis reported the future T3 as "échue".
    const installments = [
      {
        id: "a", parentId: "p1", studentId: null, category: "tuition", label: "T1",
        trancheNumber: 1, amountDue: 40_000, amountPaid: 10_000, amountPending: 0,
        dueDate: daysAgo(30), paidDate: null, status: "partial", academicCycle: "primaire",
        paymentPlan: "tranches", isCustomSchedule: false, customSchedule: false,
        customScheduleNote: null,
      },
      {
        id: "b", parentId: "p1", studentId: null, category: "tuition", label: "T3",
        trancheNumber: 3, amountDue: 40_000, amountPaid: 0, amountPending: 0,
        dueDate: daysAhead(60), paidDate: null, status: "unpaid", academicCycle: "primaire",
        paymentPlan: "tranches", isCustomSchedule: false, customSchedule: false,
        customScheduleNote: null,
      },
    ] as unknown as Installment[];
    // Family outstanding = 30_000 + 40_000 = 70_000 (the pre-fix KPI).
    // Canonical past-due = 30_000 only.
    expect(overdueAmount(installments)).toBe(30_000);
  });

  it("the page + DebtTab consume the canonical helper (source pins)", () => {
    const page = SRC("src/features/financials/financials-page.tsx");
    expect(page).toMatch(/import \{ overdueAmount \} from "\.\.\/\.\.\/domain\/calc\/payment\/queries"/);
    expect(page).not.toMatch(
      /\.filter\(\(d\) => d\.daysOverdue > 0\)[\s\S]{0,80}\.reduce\(\(s, d\) => s \+ d\.outstandingAmount, 0\)/,
    );
  });
});

/* ============================================================ */
/*  8 — static overdue gates retired                            */
/* ============================================================ */

describe("T-498 §8 — overdue-ness is derived, never read from the status string", () => {
  it("no static status === \"overdue\" gate remains on the audited surfaces", () => {
    const files = [
      "src/features/dashboard/alert-detail-modal.tsx",
      "src/features/dashboard/components/analytics/data-inspector-lineage.ts",
      "src/features/crm/student-detail/payments-tab.tsx",
      "src/features/crm/parent-detail-drawer.tsx",
    ];
    for (const f of files) {
      expect(SRC(f), f).not.toMatch(/\.status === "overdue"/);
    }
  });

  it("BEHAVIORAL: isInstallmentOverdue derives from (dueDate, now, remaining)", () => {
    const base = {
      amountDue: 10_000, amountPaid: 0, amountPending: 0, status: "unpaid",
    };
    const past = { ...base, dueDate: new Date(Date.now() - 5 * 86_400_000).toISOString() };
    const future = { ...base, dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString() };
    const coveredByCheque = { ...past, amountPaid: 0, amountPending: 10_000 };
    expect(isInstallmentOverdue(past)).toBe(true);
    expect(isInstallmentOverdue(future)).toBe(false);
    expect(isInstallmentOverdue(coveredByCheque)).toBe(false); // INV-4 coverage
  });
});

/* ============================================================ */
/*  9 — canonical attendance rate                               */
/* ============================================================ */

describe("T-498 §9 — attendance rate is (present + late) / total everywhere", () => {
  const rec = (status: string): AttendanceRecord =>
    ({ status } as unknown as AttendanceRecord);

  it("BEHAVIORAL: late counts as attended", () => {
    expect(calculateAttendanceRate([rec("present"), rec("late")])).toBe(1);
    expect(calculateAttendanceRate([rec("present"), rec("late"), rec("absent_unexcused")])).toBeCloseTo(0.67, 2);
  });

  it("the Excel full-export summary uses the canonical helper", () => {
    const exp = SRC("src/infrastructure/excel/full-export.ts");
    expect(exp).toContain("calculateAttendanceRate(data.attendance) * 100");
    expect(exp).not.toMatch(
      /data\.attendance\.filter\(\(a\) => a\.status === "present"\)\.length/,
    );
  });

  it("the mock dashboard uses the canonical helper (mock↔live parity)", () => {
    const dash = SRC("src/infrastructure/mock/repositories/dashboard-repository.ts");
    expect(dash).not.toMatch(
      /recentAttendance\.filter\(\(r\) => r\.status === "present"\)\.length \/ recentAttendance\.length/,
    );
    expect(dash).toContain("calculateAttendanceRate(recentAttendance)");
  });
});

/* ============================================================ */
/*  10 — invalid attendance status value retired                */
/* ============================================================ */

describe("T-498 §10 — the workflow dispatch filter carries only real statuses", () => {
  it("the dead \"absent\" value is gone (effective semantics preserved: unexcused-only)", () => {
    const file = SRC(
      "src/infrastructure/supabase/repositories/supabase-academic-repository.ts",
    );
    expect(file).not.toMatch(/\["absent_unexcused",\s*"absent"\]/);
    expect(file).toContain('.in("status", ["absent_unexcused"])');
  });
});
