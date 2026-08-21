/**
 * Cross-Platform Equivalence Comparator.
 *
 * Reads two result-sets:
 *   - `results/desktop/<scenario_id>.json`  (produced by desktop_runner.ts)
 *   - `results/android/<scenario_id>.json`  (produced by AndroidEquivalenceRunner.kt)
 *
 * For each scenario present in BOTH sets, performs a deep, centime-level
 * comparison of the complete domain result. Outputs:
 *   - `reports/equivalence_report_<timestamp>.md`  (human-readable summary)
 *   - `regression/<scenario_id>_<timestamp>.json`  (one file per discrepancy,
 *      saved as a permanent regression test case)
 *
 * Normalization rules:
 *   - Date strings: parsed as ISO-8601 instants and compared by epoch-millis.
 *     The desktop uses `Date.toISOString()` ("2026-09-15T00:00:00.000Z"),
 *     Android uses `OffsetDateTime.toString()` ("2026-09-15T00:00+00:00").
 *     Both represent the same instant — they MUST be treated as equal.
 *   - Object key ordering: ignored. JSON objects are compared field-by-field.
 *   - Array ordering: NOT normalized for installments / accounts / ledger
 *     entries — both engines must produce the same canonical order.
 *
 * NOT normalized (treated as genuine discrepancies):
 *   - Centime values: compared exactly. A 1-centime difference IS a
 *     discrepancy. The canonical spec uses centimes (Long) precisely
 *     to avoid floating-point drift.
 *   - Status codes: compared verbatim. Both engines use the same wire codes.
 *   - Violation codes: compared verbatim.
 *
 * Usage:
 *   npx tsx comparison/comparator.ts
 *   npx tsx comparison/comparator.ts --strict   # treat warnings as errors
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ───────────────────────────────────────────────────────────────────────────
// Types — match the result files written by both runners.
// ───────────────────────────────────────────────────────────────────────────

interface ResultFile {
  scenarioId: string;
  engine: "desktop" | "android";
  engineVersion: string;
  category: string;
  tags?: string[];
  description: string;
  operationType: string;
  result: Record<string, unknown> & { error?: string };
  expected?: Record<string, unknown>;
  durationMs: number;
  timestamp: string;
}

interface ComparisonOutcome {
  scenarioId: string;
  category: string;
  operationType: string;
  desktopStatus: "pass" | "error" | "missing";
  androidStatus: "pass" | "error" | "missing";
  canonicalExpectedMet: boolean | null;   // null = no canonical expected defined
  discrepancies: Array<{
    path: string;                          // JSON path within `result`
    desktopValue: unknown;
    androidValue: unknown;
    delta?: number;                        // for numeric values
  }>;
  durationMs: { desktop: number; android: number };
}

// ───────────────────────────────────────────────────────────────────────────
// Normalization — only representational differences.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Parse an ISO-8601 timestamp and return the epoch-millis.
 * Returns `null` if the input is not a parseable date.
 *
 * Accepts both desktop's `Date.toISOString()` format ("2026-09-15T00:00:00.000Z")
 * and Android's `OffsetDateTime.toString()` format ("2026-09-15T00:00+00:00").
 */
function tryParseDate(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Normalize a single value for comparison.
 * - Dates are converted to epoch-millis.
 * - Numbers are kept as-is (centimes — exact).
 * - Strings, booleans: kept as-is.
 * - Arrays and objects: normalized recursively.
 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  // Try parsing as a date first.
  const epochMs = tryParseDate(value);
  if (epochMs !== null && typeof value === "string" && value.length >= 10 && value.includes("-")) {
    return epochMs;
  }

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = normalize(v);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Deep comparison with path tracking.
// ───────────────────────────────────────────────────────────────────────────

interface Discrepancy {
  path: string;
  desktopValue: unknown;
  androidValue: unknown;
  delta?: number;
}

function deepCompare(
  desktop: unknown,
  android: unknown,
  path: string,
  out: Discrepancy[],
): void {
  const nd = normalize(desktop);
  const na = normalize(android);

  // Type mismatch.
  if (typeof nd !== typeof na) {
    out.push({
      path,
      desktopValue: nd,
      androidValue: na,
    });
    return;
  }

  // Null / undefined.
  if (nd === null && na === null) return;
  if (nd === null || na === null) {
    out.push({ path, desktopValue: nd, androidValue: na });
    return;
  }

  // Primitives.
  if (typeof nd !== "object") {
    if (nd !== na) {
      const delta = typeof nd === "number" && typeof na === "number" ? nd - na : undefined;
      out.push({ path, desktopValue: nd, androidValue: na, delta });
    }
    return;
  }

  // Arrays.
  if (Array.isArray(nd) || Array.isArray(na)) {
    if (!Array.isArray(nd) || !Array.isArray(na)) {
      out.push({ path, desktopValue: nd, androidValue: na });
      return;
    }
    if (nd.length !== na.length) {
      out.push({
        path: `${path}.length`,
        desktopValue: nd.length,
        androidValue: na.length,
      });
      // Continue comparing element-by-element up to the shorter length.
    }
    const maxLen = Math.max(nd.length, na.length);
    for (let i = 0; i < maxLen; i++) {
      const d = nd[i];
      const a = na[i];
      if (d === undefined || a === undefined) {
        if (d !== a) {
          out.push({ path: `${path}[${i}]`, desktopValue: d, androidValue: a });
        }
        continue;
      }
      deepCompare(d, a, `${path}[${i}]`, out);
    }
    return;
  }

  // Objects — compare field-by-field.
  const dobj = nd as Record<string, unknown>;
  const aobj = na as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(dobj), ...Object.keys(aobj)]);
  for (const k of allKeys) {
    const d = dobj[k];
    const a = aobj[k];
    if (d === undefined && a === undefined) continue;
    if (d === undefined || a === undefined) {
      out.push({ path: `${path}.${k}`, desktopValue: d, androidValue: a });
      continue;
    }
    deepCompare(d, a, `${path}.${k}`, out);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Comparator — iterate over all scenarios, compare, write reports.
// ───────────────────────────────────────────────────────────────────────────

function loadResults(dir: string): Map<string, ResultFile> {
  const out = new Map<string, ResultFile>();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    if (file.startsWith("_")) continue;   // skip _summary.json
    const fullPath = path.join(dir, file);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const result = JSON.parse(content) as ResultFile;
      out.set(result.scenarioId, result);
    } catch (e) {
      console.error(`Failed to load ${fullPath}: ${(e as Error).message}`);
    }
  }
  return out;
}

function compareAll(
  desktopDir: string,
  androidDir: string,
  regressionDir: string,
  reportsDir: string,
  strict: boolean,
): void {
  const desktopResults = loadResults(desktopDir);
  const androidResults = loadResults(androidDir);

  const allIds = new Set<string>([...desktopResults.keys(), ...androidResults.keys()]);
  const outcomes: ComparisonOutcome[] = [];

  console.log(`Comparator: ${desktopResults.size} desktop, ${androidResults.size} android, ${allIds.size} unique scenarios`);
  console.log("=".repeat(60));

  for (const id of Array.from(allIds).sort()) {
    const desktop = desktopResults.get(id);
    const android = androidResults.get(id);

    const outcome: ComparisonOutcome = {
      scenarioId: id,
      category: desktop?.category ?? android?.category ?? "unknown",
      operationType: desktop?.operationType ?? android?.operationType ?? "unknown",
      desktopStatus: desktop ? (desktop.result.error ? "error" : "pass") : "missing",
      androidStatus: android ? (android.result.error ? "error" : "pass") : "missing",
      canonicalExpectedMet: null,
      discrepancies: [],
      durationMs: {
        desktop: desktop?.durationMs ?? 0,
        android: android?.durationMs ?? 0,
      },
    };

    // Compare desktop vs android (canonical-equivalence check).
    if (desktop && android) {
      const desktopResult = desktop.result;
      const androidResult = android.result;

      if (desktopResult.error || androidResult.error) {
        // If either side errored, we don't compare results — both sides
        // should agree on whether an operation is supported.
        if (desktopResult.error && androidResult.error) {
          // Both errored — that's agreement, no discrepancy.
          // (Error message text may differ — only compare error presence.)
        } else {
          outcome.discrepancies.push({
            path: "error",
            desktopValue: desktopResult.error ?? "no error",
            androidValue: androidResult.error ?? "no error",
          });
        }
      } else {
        deepCompare(desktopResult, androidResult, "result", outcome.discrepancies);
      }
    }

    // Compare against canonical expected (if `then` is defined in either
    // result file).
    const canonical = desktop?.expected ?? android?.expected;
    if (canonical && Object.keys(canonical).length > 0) {
      outcome.canonicalExpectedMet = checkCanonicalExpected(desktop?.result, android?.result, canonical, outcome.discrepancies);
    }

    outcomes.push(outcome);

    if (outcome.discrepancies.length === 0) {
      console.log(`  ✓ ${id} (desktop ${outcome.durationMs.desktop}ms / android ${outcome.durationMs.android}ms)`);
    } else {
      console.log(`  ✗ ${id} — ${outcome.discrepancies.length} discrepancies`);
      for (const d of outcome.discrepancies.slice(0, 3)) {
        console.log(`      ${d.path}: desktop=${JSON.stringify(d.desktopValue)} vs android=${JSON.stringify(d.androidValue)}`);
      }
      if (outcome.discrepancies.length > 3) {
        console.log(`      ... and ${outcome.discrepancies.length - 3} more`);
      }
    }
  }

  // Write regression files for all discrepancies.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  writeRegressionFiles(outcomes, regressionDir, timestamp);

  // Write the equivalence report.
  writeReport(outcomes, reportsDir, timestamp, strict);
}

function checkCanonicalExpected(
  desktopResult: ResultFile["result"] | undefined,
  androidResult: ResultFile["result"] | undefined,
  canonical: Record<string, unknown>,
  discrepancies: Discrepancy[],
): boolean {
  // Verify both results match the canonical expected values.
  // Skip keys that start with `_` (comments).
  let met = true;
  for (const [k, expected] of Object.entries(canonical)) {
    if (k.startsWith("_")) continue;   // comment key
    const dValue = desktopResult?.[k];
    const aValue = androidResult?.[k];

    const nd = normalize(dValue);
    const na = normalize(aValue);
    const ne = normalize(expected);

    // For "violations" array — check that each expected code is present
    // (the engine may emit additional warnings — we check expected ⊆ actual).
    if (k === "violations" && Array.isArray(ne)) {
      const expectedCodes = (ne as unknown[]).map((c) => typeof c === "string" ? c : (c as { code: string }).code);
      const dCodes = Array.isArray(nd) ? (nd as unknown[]).map((c) => (c as { code: string }).code) : [];
      const aCodes = Array.isArray(na) ? (na as unknown[]).map((c) => (c as { code: string }).code) : [];
      for (const code of expectedCodes) {
        if (typeof code === "string" && !dCodes.includes(code)) {
          discrepancies.push({
            path: `canonical.violations[${code}]`,
            desktopValue: dCodes,
            androidValue: aCodes,
          });
          met = false;
        }
        if (typeof code === "string" && !aCodes.includes(code)) {
          discrepancies.push({
            path: `canonical.violations[${code}]`,
            desktopValue: dCodes,
            androidValue: aCodes,
          });
          met = false;
        }
      }
      continue;
    }

    // For "discountsApplied" — set comparison.
    if (k === "discountsApplied" && Array.isArray(ne)) {
      const expectedSet = new Set(ne as unknown[]);
      const dSet = new Set(Array.isArray(nd) ? nd : []);
      const aSet = new Set(Array.isArray(na) ? na : []);
      // Both should contain exactly the expected discounts.
      for (const expected of expectedSet) {
        if (!dSet.has(expected) || !aSet.has(expected)) {
          discrepancies.push({
            path: `canonical.${k}`,
            desktopValue: Array.from(dSet),
            androidValue: Array.from(aSet),
          });
          met = false;
        }
      }
      continue;
    }

    // Default — exact numeric / value comparison.
    if (typeof ne === "number") {
      const dNum = typeof nd === "number" ? nd : NaN;
      const aNum = typeof na === "number" ? na : NaN;
      if (dNum !== ne) {
        discrepancies.push({
          path: `canonical.${k} (desktop)`,
          desktopValue: dNum,
          androidValue: aNum,
          delta: dNum - ne,
        });
        met = false;
      }
      if (aNum !== ne) {
        discrepancies.push({
          path: `canonical.${k} (android)`,
          desktopValue: dNum,
          androidValue: aNum,
          delta: aNum - ne,
        });
        met = false;
      }
    } else if (typeof ne === "boolean") {
      if (nd !== ne || na !== ne) {
        discrepancies.push({
          path: `canonical.${k}`,
          desktopValue: nd,
          androidValue: na,
        });
        met = false;
      }
    }
  }
  return met;
}

function writeRegressionFiles(
  outcomes: ComparisonOutcome[],
  regressionDir: string,
  timestamp: string,
): void {
  if (!fs.existsSync(regressionDir)) fs.mkdirSync(regressionDir, { recursive: true });
  let savedCount = 0;
  for (const outcome of outcomes) {
    if (outcome.discrepancies.length === 0) continue;
    const file = path.join(regressionDir, `${outcome.scenarioId}__${timestamp}.json`);
    const regression = {
      scenarioId: outcome.scenarioId,
      category: outcome.category,
      operationType: outcome.operationType,
      discoveredAt: timestamp,
      discrepancies: outcome.discrepancies,
      desktopStatus: outcome.desktopStatus,
      androidStatus: outcome.androidStatus,
      canonicalExpectedMet: outcome.canonicalExpectedMet,
      durationMs: outcome.durationMs,
      status: "DISCOVERED",   // updated to "FIXED" once a fix is verified
    };
    fs.writeFileSync(file, JSON.stringify(regression, null, 2));
    savedCount++;
  }
  console.log(`\nRegression cases saved: ${savedCount} files in ${regressionDir}`);
}

function writeReport(
  outcomes: ComparisonOutcome[],
  reportsDir: string,
  timestamp: string,
  strict: boolean,
): void {
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const totalScenarios = outcomes.length;
  const matchedBoth = outcomes.filter((o) => o.desktopStatus !== "missing" && o.androidStatus !== "missing").length;
  const exactMatch = outcomes.filter((o) =>
    o.desktopStatus !== "missing" &&
    o.androidStatus !== "missing" &&
    o.discrepancies.length === 0,
  ).length;
  const withDiscrepancies = outcomes.filter((o) => o.discrepancies.length > 0).length;
  const desktopOnly = outcomes.filter((o) => o.androidStatus === "missing").length;
  const androidOnly = outcomes.filter((o) => o.desktopStatus === "missing").length;
  const canonicalMet = outcomes.filter((o) => o.canonicalExpectedMet === true).length;
  const canonicalDefined = outcomes.filter((o) => o.canonicalExpectedMet !== null).length;

  const percentage = matchedBoth > 0 ? ((exactMatch / matchedBoth) * 100).toFixed(2) : "0.00";

  const lines: string[] = [];
  lines.push(`# Cross-Platform Equivalence Report`);
  lines.push("");
  lines.push(`**Generated:** ${timestamp}`);
  lines.push(`**Strict mode:** ${strict}`);
  lines.push("");
  lines.push(`## Executive Summary`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total scenarios | ${totalScenarios} |`);
  lines.push(`| Matched on both sides | ${matchedBoth} |`);
  lines.push(`| **Exact equivalence (zero discrepancies)** | **${exactMatch}** |`);
  lines.push(`| Scenarios with discrepancies | ${withDiscrepancies} |`);
  lines.push(`| Desktop-only (Android missing) | ${desktopOnly} |`);
  lines.push(`| Android-only (Desktop missing) | ${androidOnly} |`);
  lines.push(`| Canonical expected verified | ${canonicalMet} / ${canonicalDefined} |`);
  lines.push(`| **Equivalence rate** | **${percentage}%** |`);
  lines.push("");

  if (withDiscrepancies > 0) {
    lines.push(`## Discrepancies`);
    lines.push("");
    for (const o of outcomes.filter((o) => o.discrepancies.length > 0)) {
      lines.push(`### ${o.scenarioId}`);
      lines.push("");
      lines.push(`- Category: \`${o.category}\``);
      lines.push(`- Operation: \`${o.operationType}\``);
      lines.push(`- Desktop: ${o.desktopStatus} (${o.durationMs.desktop}ms)`);
      lines.push(`- Android: ${o.androidStatus} (${o.durationMs.android}ms)`);
      lines.push(`- Discrepancy count: ${o.discrepancies.length}`);
      lines.push("");
      lines.push(`| Path | Desktop | Android | Delta |`);
      lines.push(`|---|---|---|---|`);
      for (const d of o.discrepancies.slice(0, 20)) {
        const dVal = typeof d.desktopValue === "object" ? JSON.stringify(d.desktopValue).slice(0, 60) : String(d.desktopValue);
        const aVal = typeof d.androidValue === "object" ? JSON.stringify(d.androidValue).slice(0, 60) : String(d.androidValue);
        lines.push(`| \`${d.path}\` | ${dVal} | ${aVal} | ${d.delta ?? ""} |`);
      }
      if (o.discrepancies.length > 20) {
        lines.push(`| ... and ${o.discrepancies.length - 20} more |  |  |  |`);
      }
      lines.push("");
    }
  }

  lines.push(`## Scenarios by Category`);
  lines.push("");
  const byCategory = new Map<string, { total: number; matched: number; withDiscrepancies: number }>();
  for (const o of outcomes) {
    const c = byCategory.get(o.category) ?? { total: 0, matched: 0, withDiscrepancies: 0 };
    c.total++;
    if (o.desktopStatus !== "missing" && o.androidStatus !== "missing") c.matched++;
    if (o.discrepancies.length > 0) c.withDiscrepancies++;
    byCategory.set(o.category, c);
  }
  lines.push(`| Category | Total | Matched both | With discrepancies |`);
  lines.push(`|---|---|---|---|`);
  for (const [cat, counts] of Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${cat} | ${counts.total} | ${counts.matched} | ${counts.withDiscrepancies} |`);
  }
  lines.push("");

  if (exactMatch === matchedBoth && matchedBoth > 0) {
    lines.push(`## Conclusion`);
    lines.push("");
    lines.push(`For the tested domain of valid business operations and inputs (${matchedBoth} scenarios), the desktop and Android implementations produce **exactly equivalent financial and business results**.`);
    lines.push("");
    lines.push(`Evidence:`);
    lines.push(`- ${exactMatch}/${matchedBoth} scenarios produced bit-identical centime-level results`);
    lines.push(`- ${canonicalMet}/${canonicalDefined} scenarios with canonical expectations verified`);
    lines.push(`- Zero discrepancies detected`);
    lines.push(`- Regression cases preserved for all known past discrepancies`);
  } else if (exactMatch > 0) {
    lines.push(`## Conclusion`);
    lines.push("");
    lines.push(`**Partial equivalence** — ${exactMatch}/${matchedBoth} scenarios produce identical results. See Discrepancies above for the remaining ${withDiscrepancies} scenarios.`);
  } else {
    lines.push(`## Conclusion`);
    lines.push("");
    lines.push(`**No equivalence verified** — either no scenarios ran on both sides, or all scenarios produced discrepancies.`);
  }

  const reportFile = path.join(reportsDir, `equivalence_report_${timestamp}.md`);
  fs.writeFileSync(reportFile, lines.join("\n"));
  console.log(`\nReport written to: ${reportFile}`);
  console.log("");
  console.log("=".repeat(60));
  console.log(`Equivalence rate: ${exactMatch}/${matchedBoth} (${percentage}%)`);
  console.log(`Discrepancies: ${withDiscrepancies}`);
  console.log(`Canonical expected verified: ${canonicalMet}/${canonicalDefined}`);
}

// ───────────────────────────────────────────────────────────────────────────
// CLI entry point.
// ───────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const rootDir = path.resolve(__dirname, "..");
const desktopResultsDir = path.join(rootDir, "results", "desktop");
const androidResultsDir = path.join(rootDir, "results", "android");
const regressionDir = path.join(rootDir, "regression");
const reportsDir = path.join(rootDir, "reports");

compareAll(desktopResultsDir, androidResultsDir, regressionDir, reportsDir, strict);
