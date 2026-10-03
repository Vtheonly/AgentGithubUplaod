/**
 * T-467 — the top-10 reference population (DASH-411), the regression suite.
 *
 * THE ARCHITECTURE UNDER TEST (the owner's mandate): every top-10 meter gets
 * a USER-SELECTABLE reference population —
 *   Mode 1 "whole-dataset": each contributor's % = amount ÷ the WHOLE
 *     dataset's metric value (the top 10 are NOT normalized to 100%);
 *   Mode 2 "top10": each contributor's % = amount ÷ the top-10's own
 *     combined value (the ten sum to 100% — the distribution within them).
 * The top-10 SELECTION must NEVER change when the mode switches — the
 * resolution carries BOTH bases precomputed, so the mode is a pure
 * rendering choice.
 *
 * Layers exercised:
 *   - the lineage resolution's dual bases + reference metadata (pure);
 *   - derivePareto's dual bases (the third arg — the whole-dataset total);
 *   - the reference-mode selector control (the interaction);
 *   - the student-id plumb-through for the clickable records (the lineage
 *     record carries the navigation target).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import "../../../i18n/i18n";
import { buildResolution } from "../../../features/dashboard/components/analytics/data-inspector-lineage";
import { derivePareto } from "../../../features/dashboard/components/analytics/analytics-derivations";
import {
  ReferencePopulationSelector,
  referenceSharePct,
  type ReferencePopulationMode,
} from "../../../features/dashboard/components/analytics/reference-population-selector";
import type { Payment } from "../../../domain/model/payment";
import type { Student } from "../../../domain/model/student";
import type { Parent } from "../../../domain/model/parent";
import type { LedgerEntry } from "../../../domain/model/ledger";

const ACADEMIC_YEAR = "2025-2026";
const RANGE = { from: "2025-09-01", to: "2026-09-01" };

/* ── Fixtures (the t-389 patterns) ─────────────────────────────────── */

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    tenantId: "tenant-1",
    receiptNumber: "REC-2026-000001",
    parentId: "p-1",
    studentId: "stu-1",
    amount: 10_000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-cashier",
    collectedAt: "2025-10-01T10:00:00.000Z",
    createdAt: "2025-10-01T10:00:00.000Z",
    updatedAt: "2025-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeStudent(id: string, parentId: string, name: string): Student {
  return {
    id,
    tenantId: "tenant-1",
    code: `ELV-${id}`,
    parentId,
    firstName: name.split(" ")[1] ?? name,
    lastName: name.split(" ")[0],
    displayName: name,
    gender: "female",
    birthDate: "2015-04-02",
    enrollmentDate: "2025-09-01",
    level: "primaire",
    gradeYear: 3,
    gradeLevel: "3ap",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
  } as unknown as Student;
}

function makeParent(id: string, name: string): Parent {
  return {
    id,
    tenantId: "tenant-1",
    code: `PAR-2025-${id}`,
    firstName: "",
    lastName: name,
    displayName: name,
    phone: "0550000000",
    email: null,
    address: null,
    cityTier: null,
    authUserId: null,
    activationCode: null,
    status: "active",
    notes: null,
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
  } as unknown as Parent;
}

/** TWELVE paying families — enough for a top-10 + a 2-family remainder. */
const FAMILY_AMOUNTS: [string, string, number][] = [
  ["p-1", "Famille A", 120_000],
  ["p-2", "Famille B", 90_000],
  ["p-3", "Famille C", 70_000],
  ["p-4", "Famille D", 55_000],
  ["p-5", "Famille E", 40_000],
  ["p-6", "Famille F", 35_000],
  ["p-7", "Famille G", 30_000],
  ["p-8", "Famille H", 25_000],
  ["p-9", "Famille I", 20_000],
  ["p-10", "Famille J", 15_000],
  ["p-11", "Famille K", 10_000],
  ["p-12", "Famille L", 5_000],
];

const FAMILY_PAYMENTS: Payment[] = FAMILY_AMOUNTS.flatMap(([pid, , amount], i) => [
  makePayment({
    id: `pay-${pid}`,
    parentId: pid,
    studentId: `stu-${pid}`,
    amount,
    category: "tuition",
    method: "cash",
    collectedAt: `2025-1${(i % 2) + 1}-01T10:00:00.000Z`,
  }),
]);
const FAMILY_PARENTS: Parent[] = FAMILY_AMOUNTS.map(([pid, name]) => makeParent(pid, name));
const FAMILY_STUDENTS: Student[] = FAMILY_AMOUNTS.map(([pid], i) =>
  makeStudent(`stu-${pid}`, pid, `Élève ${i + 1}`),
);
const FAMILY_TOTAL = FAMILY_AMOUNTS.reduce((s, [, , amount]) => s + amount, 0); // 515 000
const TOP10_TOTAL = FAMILY_TOTAL - 10_000 - 5_000; // 500 000

function makeInput(overrides: Partial<Parameters<typeof buildResolution>[1]> = {}) {
  return {
    students: FAMILY_STUDENTS,
    parents: FAMILY_PARENTS,
    classes: [],
    assessments: [],
    attendance: [],
    payments: FAMILY_PAYMENTS,
    installments: [],
    debts: [],
    ledger: [] as LedgerEntry[],
    academicYear: ACADEMIC_YEAR,
    range: RANGE,
    ...overrides,
  };
}

/* ============================================================ */
/*  1 — the lineage's dual bases + reference metadata            */
/* ============================================================ */

describe("T-467 — the lineage resolution's dual reference bases (DASH-411)", () => {
  const resolved = buildResolution(
    { domain: "revenue", title: "Revenus de test", sourceValue: FAMILY_TOTAL },
    makeInput(),
  );

  it("carries BOTH bases per contributor (shareOfTotalPct + shareOfTop10Pct)", () => {
    expect(resolved.contributors).toHaveLength(12);
    const first = resolved.contributors[0]; // Famille A — 120 000
    expect(first.amount).toBe(120_000);
    // Mode 1: 120 000 ÷ 515 000 = 23.30…%
    expect(first.shareOfTotalPct).toBeCloseTo((120_000 / FAMILY_TOTAL) * 100, 5);
    // Mode 2: 120 000 ÷ 500 000 = 24%
    expect(first.shareOfTop10Pct).toBeCloseTo((120_000 / TOP10_TOTAL) * 100, 5);
    // Back-compat: `percentage` stays the WHOLE-DATASET basis.
    expect(first.percentage).toBeCloseTo(first.shareOfTotalPct, 5);
  });

  it("the top 10's Mode-2 shares sum to 100% (the distribution within the ten)", () => {
    const top10 = resolved.contributors.slice(0, 10);
    const sum = top10.reduce((s, c) => s + c.shareOfTop10Pct, 0);
    expect(sum).toBeCloseTo(100, 3);
    // …while their Mode-1 shares sum to the top-10's combined share of the
    // whole dataset — NOT 100% (the owner's "must not be normalized" rule).
    const sumOfTotal = top10.reduce((s, c) => s + c.shareOfTotalPct, 0);
    expect(sumOfTotal).toBeCloseTo((TOP10_TOTAL / FAMILY_TOTAL) * 100, 3);
    expect(sumOfTotal).toBeLessThan(100);
  });

  it("the reference metadata carries the denominators + the combined/remainder context", () => {
    expect(resolved.reference.totalValue).toBe(FAMILY_TOTAL);
    expect(resolved.reference.top10Total).toBe(TOP10_TOTAL);
    expect(resolved.reference.top10CombinedPct).toBeCloseTo((TOP10_TOTAL / FAMILY_TOTAL) * 100, 3);
    expect(resolved.reference.remainderCount).toBe(2);
    expect(resolved.reference.remainderAmount).toBe(15_000);
    expect(resolved.reference.remainderPct).toBeCloseTo((15_000 / FAMILY_TOTAL) * 100, 3);
    expect(resolved.reference.contributorCount).toBe(12);
    expect(resolved.reference.metricLabel).toBe("Revenus de test");
  });

  it("a mode switch CANNOT re-rank: the SAME resolution object serves both modes", () => {
    // The owner's structural rule: the top-10 selection is computed ONCE at
    // resolution time; the mode selects a PRECOMPUTED field — the selection
    // is identical by construction. The ranking under both lenses:
    const byTotal = [...resolved.contributors].sort((a, b) => b.shareOfTotalPct - a.shareOfTotalPct);
    const byTop10 = [...resolved.contributors].sort((a, b) => b.shareOfTop10Pct - a.shareOfTop10Pct);
    // Same amounts ⇒ same order (both bases are monotone in `amount`).
    expect(byTotal.map((c) => c.key)).toEqual(byTop10.map((c) => c.key));
    expect(byTotal.map((c) => c.key)).toEqual(FAMILY_AMOUNTS.map(([pid]) => pid));
  });

  it("the records carry the student id (the clickable navigation target)", () => {
    const record = resolved.records.find((r) => r.contributorKey === "p-1");
    expect(record).toBeDefined();
    expect(record?.studentId).toBe("stu-p-1");
    expect(record?.studentName).toBe("Élève 1");
  });

  it("referenceSharePct picks the basis per mode (the rendering helper)", () => {
    const first = resolved.contributors[0];
    expect(referenceSharePct(first, "whole-dataset")).toBeCloseTo(first.shareOfTotalPct, 5);
    expect(referenceSharePct(first, "top10")).toBeCloseTo(first.shareOfTop10Pct, 5);
  });
});

/* ============================================================ */
/*  2 — derivePareto's dual bases (the third argument)           */
/* ============================================================ */

describe("T-467 — derivePareto's whole-dataset basis (DASH-411)", () => {
  const debtors = FAMILY_AMOUNTS.map(([, name, amount]) => ({
    parentName: name,
    outstandingAmount: amount,
  }));

  it("without the dataset total the whole-basis is HONESTLY null (never fabricated)", () => {
    const p = derivePareto(debtors, 8);
    expect(p).toHaveLength(8);
    expect(p.every((d) => d.cumOfTotalPct === null)).toBe(true);
    // The top-N basis (the pre-T-467 behavior) is unchanged.
    const top8Total = debtors.slice(0, 8).reduce((s, d) => s + d.outstandingAmount, 0);
    expect(p[0].cumPercent).toBe(Math.round((120_000 / top8Total) * 100));
  });

  it("with the dataset total the cumulative line measures against the WHOLE (Mode 1)", () => {
    const p = derivePareto(debtors, 8, FAMILY_TOTAL);
    // The bars are the SAME rows (the selection is basis-independent).
    expect(p.map((d) => d.name)).toEqual(debtors.slice(0, 8).map((d) => d.parentName));
    // 120 000 ÷ 515 000 = 23% (rounded) — NOT the normalized 26%.
    expect(p[0].cumOfTotalPct).toBe(Math.round((120_000 / FAMILY_TOTAL) * 100));
    // The top-8's cumulative share of the whole — under 100% by construction.
    const top8Total = debtors.slice(0, 8).reduce((s, d) => s + d.outstandingAmount, 0);
    expect(p[7].cumOfTotalPct).toBe(Math.round((top8Total / FAMILY_TOTAL) * 100));
    expect(p[7].cumOfTotalPct).toBeLessThan(100);
    // And the Mode-2 basis is still available on the SAME rows.
    expect(p[7].cumPercent).toBe(100);
  });
});

/* ============================================================ */
/*  3 — the selector control (the user-facing switch)            */
/* ============================================================ */

describe("T-467 — the ReferencePopulationSelector control", () => {
  function setup(initial: ReferencePopulationMode = "whole-dataset") {
    const onChange = vi.fn();
    const { rerender } = render(
      <ReferencePopulationSelector mode={initial} onChange={onChange} />,
    );
    return { onChange, rerender };
  }

  it("renders both modes with the active one pressed", () => {
    render(<ReferencePopulationSelector mode="whole-dataset" onChange={() => undefined} />);
    const whole = screen.getByTestId("reference-mode-whole-dataset");
    const top10 = screen.getByTestId("reference-mode-top10");
    expect(whole).toHaveAttribute("aria-pressed", "true");
    expect(top10).toHaveAttribute("aria-pressed", "false");
  });

  it("switching the mode fires onChange with the OTHER mode (never a re-rank — the caller re-renders)", () => {
    const { onChange } = setup("whole-dataset");
    fireEvent.click(screen.getByTestId("reference-mode-top10"));
    expect(onChange).toHaveBeenCalledWith("top10");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("the selector group carries the mode visibly (the misunderstanding guard)", () => {
    render(<ReferencePopulationSelector mode="top10" onChange={() => undefined} />);
    expect(screen.getByTestId("reference-population-selector")).toHaveAttribute("data-mode", "top10");
  });
});
