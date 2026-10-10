/**
 * T-502 (DEBT-104) — the Investigation Console's severe-debt edge is
 * CONFIGURABLE (the owner's mandate: "In Console d'Investigation
 * Opérationnelle, there is currently a hardcoded limit of 40,000 … I want
 * this limit to be configurable rather than permanently fixed at 40K").
 *
 * The 40 000 was the « Créances Critiques » quick query's family-debt
 * threshold (`debtAmount >= 40_000` in OPERATIONAL_PRESETS) — an edge the
 * owner could not move from Settings → Configuration while every sibling
 * edge (grace/yellow/red/active-payer since 0125, the amount bands + the
 *      level messages since 0138) was configurable.
 *
 * This suite pins:
 *   1. `operationalPresetsFor` — the preset list parameterized by the
 *      configured edge: the DEFAULT preserves the 40 000 behavior exactly
 *      (boundary: 39 999 no / 40 000 yes), a CONFIGURED value moves both
 *      the filter and the chip's label, 0 disables the edge (the 0138
 *      amount-band convention), and the non-debt presets are untouched.
 *   2. The DEFAULT thresholds carry severeDebtDzd: 40 000 (the documented
 *      default — every consumer without a configured value inherits it).
 *   3. Migration 0150 (source pins): the `debt.severe_debt_dzd` seed
 *      (default 40 000, validation 0–100 000 000) + the recreated reader's
 *      `severeDebtDzd` jsonb key. (Numbered 0150 — the live chain's
 *      0147/0148/0149 slots belong to the concurrent session's
 *      live-applied migrations; this task takes the next free number.)
 *   4. The wiring (source pins): the tab passes the ACTIVE thresholds'
 *      value to the console; the console builds its presets from the prop
 *      (no independent hardcode anywhere — the mandate's requirement 7).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  operationalPresetsFor,
} from "../../../features/dashboard/components/analytics/operational-query-engine";
import type { StudentRiskProfile } from "../../../features/dashboard/components/analytics/operational-query-engine";
import { DEFAULT_DEBT_AGING_THRESHOLDS } from "../../../domain/calc/ledger/debt-aging";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A minimal risk profile with only the debt dimension set. */
function profileWithDebt(debtAmount: number): StudentRiskProfile {
  return {
    studentId: `stu-${debtAmount}`,
    studentName: `Élève ${debtAmount}`,
    studentCode: "ELV-1",
    classId: null,
    className: "CE1",
    level: "primaire",
    gradeLevel: "ce1",
    parentId: "par-1",
    parentName: "Parent",
    parentPhone: "",
    gpa: null,
    isPassing: null,
    attendanceRate: 1,
    unexcusedAbsences: 0,
    debtAmount,
    daysOverdue: 0,
    riskScore: 0,
    riskCategory: "financial_tension",
    primaryRiskReason: "",
  };
}

describe("T-502 (DEBT-104) — operationalPresetsFor: the severe-debt quick query follows the CONFIGURED edge", () => {
  it("the DEFAULT (40 000) preserves the pre-0147 behavior exactly — the boundary is ≥ 40 000", () => {
    const presets = operationalPresetsFor(40_000);
    const severe = presets.find((p) => p.id === "severe_debt")!;
    expect(severe.customFilter).toBeTruthy();
    expect(severe.customFilter!(profileWithDebt(39_999))).toBe(false); // below the edge
    expect(severe.customFilter!(profileWithDebt(40_000))).toBe(true); // AT the edge
    expect(severe.customFilter!(profileWithDebt(120_000))).toBe(true); // deep past it
    // The chip's label states the edge it applies (locale-stable grouping).
    expect(severe.title).toContain("40 000 DA");
  });

  it("a CONFIGURED value moves BOTH the filter and the label (the owner's exact ask)", () => {
    const presets = operationalPresetsFor(90_000);
    const severe = presets.find((p) => p.id === "severe_debt")!;
    // A 45 000 family was critical at the default 40 000 — at the
    // configured 90 000 it is NOT (the dossier list follows the setting).
    expect(severe.customFilter!(profileWithDebt(45_000))).toBe(false);
    expect(severe.customFilter!(profileWithDebt(90_000))).toBe(true);
    expect(severe.title).toContain("90 000 DA");
    expect(severe.title).not.toContain("40 000");
    // A lower configured edge widens the net.
    const lowEdge = operationalPresetsFor(5_000);
    const lowSevere = lowEdge.find((p) => p.id === "severe_debt")!;
    expect(lowSevere.customFilter!(profileWithDebt(4_999))).toBe(false);
    expect(lowSevere.customFilter!(profileWithDebt(5_000))).toBe(true);
  });

  it("0 DISABLES the edge (the 0138 amount-band convention — no family crosses it)", () => {
    const presets = operationalPresetsFor(0);
    const severe = presets.find((p) => p.id === "severe_debt")!;
    expect(severe.customFilter!(profileWithDebt(500_000))).toBe(false);
    expect(severe.customFilter!(profileWithDebt(0))).toBe(false);
  });

  it("the four NON-debt presets are untouched by the configuration (ids, titles, subtitles, icons stable)", () => {
    const strip = (list: ReturnType<typeof operationalPresetsFor>) =>
      list
        .filter((p) => p.id !== "severe_debt")
        .map(({ id, title, subtitle, iconName }) => ({ id, title, subtitle, iconName }));
    expect(strip(operationalPresetsFor(40_000))).toEqual(strip(operationalPresetsFor(90_000)));
    expect(operationalPresetsFor(40_000).map((p) => p.id)).toEqual([
      "triple_critical",
      "severe_debt",
      "academic_drop",
      "chronic_absenteeism",
      "high_performers",
    ]);
  });
});

describe("T-502 (DEBT-104) — the default + the migration + the wiring (source pins)", () => {
  it("DEFAULT_DEBT_AGING_THRESHOLDS.severeDebtDzd is 40 000 (the documented default every consumer inherits)", () => {
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.severeDebtDzd).toBe(40_000);
  });

  it("migration 0150 seeds debt.severe_debt_dzd (default 40 000, validated 0–100 000 000) and extends the reader", () => {
    const migration = readFileSync(
      join(__dirname, "../../../../supabase/migrations/0150_severe_debt_threshold.sql"),
      "utf-8",
    );
    // The seed: ONE new settings key, default 40 000 (the previously
    // hardcoded value), sensible min/max validation.
    expect(migration).toContain("'debt.severe_debt_dzd'");
    expect(migration).toContain("'40000'");
    expect(migration).toContain("'number', '40000', 96, 0, 100000000");
    // The reader: the jsonb gains the camelCase key (the 0111/0133/0138
    // parity convention).
    expect(migration).toContain("'severeDebtDzd', coalesce(v_severe, 40000)");
    // The 0138 lesson applied: ONE type per VALUES column (all TEXT
    // default_value literals — no mixed INTEGER/TEXT 22P02 trap).
    expect(migration).toContain("to_jsonb((v.default_value)::numeric)");
  });

  it("the wiring: the tab passes the ACTIVE thresholds' value; the console builds its presets from the prop (no independent hardcode)", () => {
    const tab = readFileSync(
      join(__dirname, "../../../features/dashboard/tabs/analytics-tab.tsx"),
      "utf-8",
    );
    expect(tab).toContain("severeDebtDzd={debtThresholdsActive.severeDebtDzd}");
    const consoleSrc = readFileSync(
      join(__dirname, "../../../features/dashboard/components/analytics/operational-query-console.tsx"),
      "utf-8",
    );
    expect(consoleSrc).toContain("operationalPresetsFor(severeDebtDzd ?? DEFAULT_DEBT_AGING_THRESHOLDS.severeDebtDzd");
    // The mandate's requirement 7: no independent hardcode overrides the
    // configuration — the literal 40 000 appears ONLY as the documented
    // fallback default (the ?? chain), never as a filter constant.
    expect(consoleSrc).not.toContain(">= 40_000");
    expect(consoleSrc).not.toContain(">= 40000");
    const engine = readFileSync(
      join(__dirname, "../../../features/dashboard/components/analytics/operational-query-engine.ts"),
      "utf-8",
    );
    expect(engine).not.toContain(">= 40_000");
    expect(engine).toContain("p.debtAmount >= severeDebtDzd");
  });
});
