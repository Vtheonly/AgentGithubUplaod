/**
 * generate_analytics_visuals_corpus — PARITY-003 / T-292 corpus generator.
 *
 * Runs the REAL desktop derivations (the same analytics_bridge the desktop
 * runner uses) over the `given` of every analytics_visuals scenario and
 * writes the computed result into the scenario's `then` block — so the
 * corpus's expected values are BY CONSTRUCTION the desktop engine's output
 * (never hand-typed numbers).
 *
 * Usage (from the desktop repo root):
 *   npx tsx scripts/generate_analytics_visuals_corpus.ts
 *
 * Idempotent: re-running refreshes the `then` blocks (and fails loudly if
 * a scenario's `given` shape does not match the derivations' input).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  deriveWeeklyRhythmFor,
  deriveTrancheWavesFor,
  deriveDemographicsFor,
  deriveCollectionHeatmap,
  deriveYearOverYear,
  toAnalyticsPayment,
} from "../financial-tests/equivalence/desktop/analytics_bridge";

const SCENARIOS_DIR = path.resolve(__dirname, "../financial-tests/equivalence/scenarios");

function dzdToCentimes(dzd: number): number {
  return Math.round(dzd * 100);
}

function centimesToDzd(centimes: number): number {
  return centimes / 100;
}

interface ScenarioFile {
  id: string;
  category?: string;
  when?: { type?: string; now?: string; range?: { from: string; to: string }; currentRevenue?: { label: string; amountDzd: number }[]; previousRevenue?: { label: string; amountDzd: number }[] };
  given?: Record<string, never>;
}

const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));
let updated = 0;
for (const file of files) {
  const fullPath = path.join(SCENARIOS_DIR, file);
  const scenario = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as ScenarioFile;
  if (scenario.category !== "analytics_visuals") continue;
  if (scenario.when?.type !== "deriveAnalyticsVisuals") continue;

  const given = scenario.given ?? ({} as Record<string, never>);
  const when = scenario.when;
  const range = when.range;

  // (a) weekly rhythm — full payments stream
  const allPayments = ((given.payments as never[]) ?? []).map((p) =>
    toAnalyticsPayment(p as Parameters<typeof toAnalyticsPayment>[0]),
  );
  const weeklyRhythm = deriveWeeklyRhythmFor(allPayments, range);

  // (b) heatmap — paid slice
  const paidSlice = ((given.payments as { status: string }[]) ?? [])
    .filter((p) => p.status === "paid")
    .map((p) => toAnalyticsPayment(p as Parameters<typeof toAnalyticsPayment>[0]));
  const heatmap = deriveCollectionHeatmap(paidSlice, range);

  // (c) YoY
  const current = (when.currentRevenue ?? []).map((r) => ({ label: r.label, amount: r.amountDzd }));
  const previous = (when.previousRevenue ?? []).map((r) => ({ label: r.label, amount: r.amountDzd }));
  const yoy = deriveYearOverYear(current, previous);

  // (d) tranche waves
  const trancheRows = ((given.installments as { label?: string; amountDue: number; amountPaid?: number; amountPending?: number }[]) ?? []).map((i) => ({
    label: i.label ?? "",
    amountDue: centimesToDzd(i.amountDue),
    amountPaid: centimesToDzd(i.amountPaid ?? 0),
    amountPending: centimesToDzd(i.amountPending ?? 0),
  }));
  const trancheWaves = deriveTrancheWavesFor(trancheRows);

  // (e) demographics
  const currentYear = new Date(when.now ?? "2026-09-10T00:00:00Z").getUTCFullYear();
  const demographics = deriveDemographicsFor(
    ((given.students as { gender?: string; birthDate?: string | null; classId?: string | null }[]) ?? []).map((s) => ({
      gender: s.gender ?? "",
      birthDate: s.birthDate ?? null,
      classId: s.classId ?? null,
    })),
    ((given.classes as { id: string; name: string; grade_code?: string | null; capacity?: number | null }[]) ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      gradeCode: c.grade_code ?? null,
      capacity: c.capacity ?? null,
    })),
    currentYear,
  );

  const expected = {
    weeklyRhythm: weeklyRhythm.map((r) => ({
      day: r.day,
      cash: dzdToCentimes(r.cash),
      check: dzdToCentimes(r.check),
      transfer: dzdToCentimes(r.transfer),
    })),
    heatmap: {
      monthLabels: heatmap.monthLabels,
      monthKeys: heatmap.monthKeys,
      rows: heatmap.rows.map((r) => ({
        day: r.day,
        rowTotal: dzdToCentimes(r.rowTotal),
        cells: r.cells.map((c) => ({ amount: dzdToCentimes(c.amount), count: c.count, level: c.level })),
      })),
      max: dzdToCentimes(heatmap.max),
      monthTotals: heatmap.monthTotals.map(dzdToCentimes),
    },
    yoy: {
      points: yoy.points.map((p) => ({
        label: p.label,
        current: dzdToCentimes(p.current),
        previous: dzdToCentimes(p.previous),
        deltaPercent: p.deltaPercent,
      })),
      totalCurrent: dzdToCentimes(yoy.totalCurrent),
      totalPrevious: dzdToCentimes(yoy.totalPrevious),
      deltaPercent: yoy.deltaPercent,
    },
    trancheWaves: trancheWaves.map((w) => ({
      index: w.index,
      label: w.label,
      hint: w.hint,
      due: dzdToCentimes(w.due),
      paid: dzdToCentimes(w.paid),
      pending: dzdToCentimes(w.pending),
      pct: w.pct,
      isNextTarget: w.isNextTarget,
    })),
    demographics: {
      grade: demographics.grade,
      gender: demographics.gender,
      age: demographics.age,
      capacity: demographics.capacity,
    },
  };

  scenario.then = expected;
  fs.writeFileSync(fullPath, JSON.stringify(scenario, null, 2) + "\n");
  console.log(`✓ ${scenario.id}: then block (re)generated`);
  updated++;
}

console.log(`\n${updated} scenario(s) refreshed — expected values are the REAL desktop engine output.`);
if (updated === 0) {
  console.error("No analytics_visuals scenarios found — did the files land in financial-tests/equivalence/scenarios?");
  process.exit(1);
}
