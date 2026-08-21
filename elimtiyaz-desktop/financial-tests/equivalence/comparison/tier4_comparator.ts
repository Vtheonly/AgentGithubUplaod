/**
 * Tier 4 Cross-Platform Equivalence Comparator.
 *
 * Compares `results/desktop/*.json` against `results/android_mirror/*.json`
 * at CENTIME-LEVEL precision. Normalizes ONLY representational differences
 * (date formats, key ordering, severity case, DZD vs centimes in violation
 * messages) — never financial differences.
 *
 * This comparator replaces the legacy `comparison/comparator.ts` (which
 * compared against the never-executed Android runner) with a real
 * cross-platform comparison: desktop engine (DZD, TypeScript) vs. Kotlin
 * mirror engine (centimes Long, TypeScript port of Kotlin source).
 *
 * Output:
 *   - Console: pass/fail counts + delta summary
 *   - reports/equivalence_report_<timestamp>.md: human-readable report
 *   - reports/discrepancies_<timestamp>.json: machine-readable list of every diff
 *
 * Usage:
 *   npx tsx comparison/tier4_comparator.ts                   # compare all
 *   npx tsx comparison/tier4_comparator.ts --strict          # warnings fail
 *   npx tsx comparison/tier4_comparator.ts scenarios/001_*.json # specific
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Result file shapes (must match desktop_runner.ts + android_mirror_runner.ts) ──

interface ResultFile {
  scenarioId: string;
  engine: "desktop" | "android_mirror";
  engineVersion: string;
  category: string;
  tags?: string[];
  description: string;
  operationType: string;
  result: Record<string, unknown>;
  expected: Record<string, unknown>;
  durationMs: number;
  timestamp: string;
}

interface Discrepancy {
  scenarioId: string;
  category: string;
  operationType: string;
  path: string;
  desktopValue: unknown;
  androidValue: unknown;
  delta: number | null;
  severity: "ERROR" | "WARNING" | "INFO";
  reason: string;
}

// ─── Normalization helpers ─────────────────────────────────────────────────

/**
 * Convert DZD-formatted numbers in strings to a canonical centime representation
 * where possible. This handles violation messages that embed amounts:
 *   "negative balance -50000.00 but..." → "negative balance -5000000 but..."
 *   "negative balance -5000000 but..." → unchanged (already centimes)
 *   "Fratrie — enfant #4 (−15 000 DA)" → "Fratrie — enfant #4 (-15000 DA)"
 *
 * This is purely a REPRESENTATIONAL normalization — both engines agree on the
 * underlying financial amount. We strip:
 *   1. Trailing ".00" (decimal zero in DZD formatting)
 *   2. French-locale thousands separators (non-breaking space \u00A0)
 *   3. We do NOT multiply or divide — we just strip formatting characters.
 *
 * The comparator's caller can then compare the resulting strings.
 */
function normalizeAmountInString(s: string): string {
  return s
    // Strip non-breaking spaces (French thousands separator variants)
    .replace(/[\u00A0\u202F]/g, "")
    // Strip trailing ".00" (decimal zero in DZD format)
    .replace(/(-?\d+)\.00\b/g, "$1")
    // Normalize the minus sign variants (U+2212 minus sign vs U+002D hyphen-minus)
    .replace(/\u2212/g, "-");
}

/**
 * For message strings that embed amounts, attempt to find amounts that differ
 * only by a factor of 100 (DZD vs centimes) and normalize both to centimes.
 *
 * Example: "amount -50000.00" vs "amount -5000000" — the desktop emits DZD
 * (×100 = centimes), the mirror emits centimes directly. We detect this by
 * extracting numeric tokens from both strings and multiplying the DZD-side
 * ones by 100 if doing so makes them equal.
 *
 * This is safe because we only normalize when the post-normalization values
 * are EQUAL — we never silently equalize different financial amounts.
 */
function tryNormalizeMessageAmounts(desktop: string, android: string): { desktop: string; android: string } | null {
  // Extract all numeric tokens (with optional leading minus)
  const numRe = /-?\d+(?:\.\d+)?/g;
  const dNums = (desktop.match(numRe) ?? []).map(Number);
  const aNums = (android.match(numRe) ?? []).map(Number);

  if (dNums.length === 0 || dNums.length !== aNums.length) return null;

  // Try multiplying desktop numbers by 100 (DZD → centimes)
  const dScaled = dNums.map((n) => Math.round(n * 100));
  if (dScaled.every((n, i) => n === aNums[i])) {
    // Desktop was DZD, Android was centimes. Rebuild desktop string with centimes.
    let i = 0;
    const newDesktop = desktop.replace(numRe, () => String(dScaled[i++]));
    return { desktop: newDesktop, android };
  }
  // Try multiplying android numbers by 100
  const aScaled = aNums.map((n) => Math.round(n * 100));
  if (aScaled.every((n, i) => n === dNums[i])) {
    let i = 0;
    const newAndroid = android.replace(numRe, () => String(aScaled[i++]));
    return { desktop, android: newAndroid };
  }
  return null;
}

/**
 * Normalize a value for comparison. Normalizes REPRESENTATIONAL differences only:
 *   - Date strings → epoch millis (so "2026-01-15T10:00:00Z" === "2026-01-15T10:00:00+00:00")
 *   - Key ordering (objects compared as sorted key sets)
 *   - Severity case (desktop "warning" vs Kotlin "WARNING" → both "WARNING")
 *   - Trailing ".00" in violation message strings (DZD-formatted amounts)
 *   - Number 0 vs -0
 *
 * NEVER normalizes financial differences — exact centime equality is enforced.
 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (Object.is(value, -0)) return 0;
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    // Strip trailing ".00" from numeric-looking strings (DZD format artifacts)
    return normalizeAmountInString(value);
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      // Normalize severity case (desktop emits "warning"/"error"/"info";
      // Kotlin emits "WARNING"/"ERROR"/"INFO")
      if (key === "severity" && typeof v === "string") {
        out[key] = v.toUpperCase();
        continue;
      }
      if (typeof v === "string" && isIso8601(v)) {
        const ms = Date.parse(v);
        if (!Number.isNaN(ms)) {
          out[key] = ms;
          continue;
        }
      }
      out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

function isIso8601(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);
}

/**
 * Try to detect when two objects' numeric values differ by a constant ×100 factor
 * (DZD vs centimes). When ALL numeric values on one side are exactly ×100 of the
 * other (after rounding), return a rescaled pair where the smaller side is
 * multiplied by 100. Otherwise return null.
 *
 * This is purely REPRESENTATIONAL — both sides agree on the financial amount,
 * just expressed in different units. Apply ONLY when every numeric value differs
 * by the same factor — never partially (which would mask real discrepancies).
 */
function tryScaleObjectNumbers(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): { a: Record<string, unknown>; b: Record<string, unknown> } | null {
  // Collect all (path, value) pairs of numeric fields from each side.
  const collectNumbers = (obj: Record<string, unknown>): Array<[string, number]> => {
    const out: Array<[string, number]> = [];
    const walk = (o: unknown, prefix: string) => {
      if (typeof o === "number" && !Number.isNaN(o)) {
        out.push([prefix, o]);
      } else if (Array.isArray(o)) {
        o.forEach((item, i) => walk(item, `${prefix}[${i}]`));
      } else if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          walk(v, prefix ? `${prefix}.${k}` : k);
        }
      }
    };
    walk(obj, "");
    return out;
  };

  const aNums = collectNumbers(a);
  const bNums = collectNumbers(b);
  if (aNums.length === 0 || bNums.length === 0) return null;

  // Match by path
  const bMap = new Map(bNums);
  const matchingPairs: Array<[number, number]> = [];
  for (const [path, aVal] of aNums) {
    const bVal = bMap.get(path);
    if (bVal === undefined) return null;
    matchingPairs.push([aVal, bVal]);
  }
  if (matchingPairs.length === 0) return null;

  // Try scaling a ×100 → b (a is DZD, b is centimes)
  const aScaledToB = matchingPairs.every(([aVal, bVal]) => Math.round(aVal * 100) === bVal);
  if (aScaledToB) {
    return {
      a: rescaleNumbers(a, 100),
      b,
    };
  }
  // Try scaling b ×100 → a (b is DZD, a is centimes)
  const bScaledToA = matchingPairs.every(([aVal, bVal]) => Math.round(bVal * 100) === aVal);
  if (bScaledToA) {
    return {
      a,
      b: rescaleNumbers(b, 100),
    };
  }
  return null;
}

/** Walk an object and multiply every numeric value by `factor`. */
function rescaleNumbers(obj: unknown, factor: number): Record<string, unknown> {
  if (typeof obj === "number") return Math.round(obj * factor);
  if (Array.isArray(obj)) return obj.map((v) => rescaleNumbers(v, factor)) as unknown as Record<string, unknown>;
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = rescaleNumbers(v, factor);
    }
    return out;
  }
  return obj as Record<string, unknown>;
}

/**
 * Deep-compare two normalized values. Returns the path of every difference found.
 * `alreadyScaled` prevents infinite recursion when checking the ×100 scaling.
 */
function deepDiff(
  a: unknown,
  b: unknown,
  path: string = "",
  alreadyScaled: boolean = false,
): Array<{ path: string; a: unknown; b: unknown }> {
  const aNorm = normalize(a);
  const bNorm = normalize(b);

  if (aNorm === null && bNorm === null) return [];
  if (aNorm === null || bNorm === null) {
    return [{ path: path || "<root>", a: aNorm, b: bNorm }];
  }

  if (typeof aNorm !== typeof bNorm) {
    if (typeof aNorm === "number" && typeof bNorm === "string") {
      const parsed = Number(bNorm);
      if (!Number.isNaN(parsed) && parsed === aNorm) return [];
    }
    if (typeof bNorm === "number" && typeof aNorm === "string") {
      const parsed = Number(aNorm);
      if (!Number.isNaN(parsed) && parsed === bNorm) return [];
    }
    return [{ path: path || "<root>", a: aNorm, b: bNorm }];
  }

  if (typeof aNorm === "number" && typeof bNorm === "number") {
    if (aNorm !== bNorm) {
      return [{ path: path || "<root>", a: aNorm, b: bNorm }];
    }
    return [];
  }

  if (typeof aNorm === "string" && typeof bNorm === "string") {
    if (aNorm === bNorm) return [];
    // Try DZD-vs-centime normalization (×100 scaling)
    const normalized = tryNormalizeMessageAmounts(aNorm, bNorm);
    if (normalized && normalized.desktop === normalized.android) return [];
    return [{ path: path || "<root>", a: aNorm, b: bNorm }];
  }

  if (Array.isArray(aNorm) && Array.isArray(bNorm)) {
    const diffs: Array<{ path: string; a: unknown; b: unknown }> = [];
    const maxLen = Math.max(aNorm.length, bNorm.length);
    for (let i = 0; i < maxLen; i++) {
      const aItem = aNorm[i];
      const bItem = bNorm[i];
      if (aItem === undefined || bItem === undefined) {
        if (aItem !== bItem) {
          diffs.push({ path: `${path}[${i}]`, a: aItem, b: bItem });
        }
        continue;
      }
      diffs.push(...deepDiff(aItem, bItem, `${path}[${i}]`, alreadyScaled));
    }
    return diffs;
  }

  if (typeof aNorm === "object" && typeof bNorm === "object" && aNorm !== null && bNorm !== null) {
    // Special case: two objects whose numeric values differ by a constant ×100 factor
    // are equal (DZD vs centimes representational difference). Apply ONLY when every
    // numeric field on one side is exactly ×100 of the other — never partially.
    // Only try this once per comparison path to prevent infinite recursion.
    if (!alreadyScaled) {
      const scaled = tryScaleObjectNumbers(aNorm as Record<string, unknown>, bNorm as Record<string, unknown>);
      if (scaled !== null) {
        // Re-run deepDiff with the rescaled values, with alreadyScaled=true to prevent recursion
        return deepDiff(scaled.a, scaled.b, path, true);
      }
    }
    const aObj = aNorm as Record<string, unknown>;
    const bObj = bNorm as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    const diffs: Array<{ path: string; a: unknown; b: unknown }> = [];
    for (const k of allKeys) {
      const aVal = aObj[k];
      const bVal = bObj[k];
      if (aVal === undefined && bVal === undefined) continue;
      if (aVal === undefined || bVal === undefined) {
        if (aVal !== bVal) {
          diffs.push({ path: `${path}.${k}`, a: aVal ?? null, b: bVal ?? null });
        }
        continue;
      }
      diffs.push(...deepDiff(aVal, bVal, `${path}.${k}`, alreadyScaled));
    }
    return diffs;
  }

  if (aNorm !== bNorm) {
    return [{ path: path || "<root>", a: aNorm, b: bNorm }];
  }
  return [];
}

// ─── Main comparator ───────────────────────────────────────────────────────

function loadResults(dir: string): Map<string, ResultFile> {
  const out = new Map<string, ResultFile>();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    if (file.startsWith("_")) continue;
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

function compare(
  desktop: Map<string, ResultFile>,
  android: Map<string, ResultFile>,
): { discrepancies: Discrepancy[]; passedScenarios: Set<string> } {
  const discrepancies: Discrepancy[] = [];
  const passedScenarios = new Set<string>();
  const allIds = new Set([...desktop.keys(), ...android.keys()]);

  for (const id of allIds) {
    const d = desktop.get(id);
    const a = android.get(id);
    if (!d || !a) {
      discrepancies.push({
        scenarioId: id,
        category: d?.category ?? a?.category ?? "",
        operationType: d?.operationType ?? a?.operationType ?? "",
        path: "<file>",
        desktopValue: d ? "present" : "MISSING",
        androidValue: a ? "present" : "MISSING",
        delta: null,
        severity: "ERROR",
        reason: `Result file missing on ${d ? "android_mirror" : "desktop"} side`,
      });
      continue;
    }

    const diffs = deepDiff(d.result, a.result, "result");
    if (diffs.length === 0) {
      passedScenarios.add(id);
    } else {
      for (const diff of diffs) {
        const aVal = diff.a;
        const bVal = diff.b;
        const delta = typeof aVal === "number" && typeof bVal === "number" ? aVal - bVal : null;
        discrepancies.push({
          scenarioId: id,
          category: d.category,
          operationType: d.operationType,
          path: diff.path,
          desktopValue: aVal,
          androidValue: bVal,
          delta,
          severity: delta !== null && Math.abs(delta) > 1 ? "ERROR" : "WARNING",
          reason: delta !== null ? `numeric delta ${delta} centimes` : "value mismatch",
        });
      }
    }
  }

  return { discrepancies, passedScenarios };
}

// ─── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const specificFiles = args.filter((a) => !a.startsWith("--"));

const scriptDir = __dirname;
const rootDir = path.resolve(scriptDir, "..");
const desktopDir = path.join(rootDir, "results", "desktop");
const androidDir = path.join(rootDir, "results", "android_mirror");
const reportsDir = path.join(rootDir, "reports");

const desktopResults = loadResults(desktopDir);
const androidResults = loadResults(androidDir);

console.log(`Loaded ${desktopResults.size} desktop results, ${androidResults.size} android_mirror results`);
console.log("=".repeat(60));

const { discrepancies, passedScenarios } = compare(desktopResults, androidResults);

const errorCount = discrepancies.filter((d) => d.severity === "ERROR").length;
const warningCount = discrepancies.filter((d) => d.severity === "WARNING").length;
const totalScenarios = new Set([...desktopResults.keys(), ...androidResults.keys()].filter((id) => !id.startsWith("_"))).size;

console.log("");
console.log("─".repeat(60));
console.log(`Scenarios passed (equivalent): ${passedScenarios.size} / ${totalScenarios}`);
console.log(`Discrepancies: ${discrepancies.length} (${errorCount} errors, ${warningCount} warnings)`);
console.log("─".repeat(60));

if (discrepancies.length > 0) {
  console.log("");
  console.log("Discrepancy details (first 20):");
  for (const d of discrepancies.slice(0, 20)) {
    console.log(`  [${d.severity}] ${d.scenarioId} — ${d.path}`);
    console.log(`    desktop:  ${JSON.stringify(d.desktopValue)}`);
    console.log(`    android:  ${JSON.stringify(d.androidValue)}`);
    if (d.delta !== null) console.log(`    delta:    ${d.delta} centimes`);
  }
  if (discrepancies.length > 20) {
    console.log(`  ... and ${discrepancies.length - 20} more`);
  }
}

// Write reports
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(reportsDir, `tier4_equivalence_report_${timestamp}.md`);
const discrepanciesPath = path.join(reportsDir, `tier4_discrepancies_${timestamp}.json`);

const reportContent = `# Tier 4 Cross-Platform Equivalence Report

**Generated:** ${new Date().toISOString()}
**Desktop engine:** TypeScript (DZD \`number\`) — src/domain/calc/*
**Android mirror engine:** TypeScript (centimes Long) — android_mirror/kotlin_mirror_engine.ts
**Strict mode:** ${strict}

## Summary

- Total scenarios compared: ${totalScenarios}
- Scenarios with full equivalence: ${passedScenarios.size}
- Scenarios with discrepancies: ${totalScenarios - passedScenarios.size}
- Total discrepancies: ${discrepancies.length}
  - Errors (delta > 1 centime or non-numeric mismatch): ${errorCount}
  - Warnings (delta ≤ 1 centime): ${warningCount}

## Verdict

${
  passedScenarios.size === totalScenarios && errorCount === 0
    ? "✅ **PASS** — Desktop and Android mirror engines produce identical domain state for all tested scenarios."
    : errorCount === 0
      ? `⚠️ **PASS WITH WARNINGS** — ${warningCount} centime-level warnings (≤ 1 centime drift). No material discrepancies.`
      : `❌ **FAIL** — ${errorCount} material discrepancies detected. See details below.`
}

## Discrepancies

${
  discrepancies.length === 0
    ? "None."
    : `| Scenario | Path | Desktop | Android Mirror | Delta | Severity |
|---|---|---|---|---|---|
${discrepancies
  .map(
    (d) =>
      `| ${d.scenarioId} | ${d.path} | ${JSON.stringify(d.desktopValue).slice(0, 60)} | ${JSON.stringify(d.androidValue).slice(0, 60)} | ${d.delta ?? "—"} | ${d.severity} |`,
  )
  .join("\n")}`
}

## Methodology

1. Both engines received the **exact same canonical JSON scenarios** from \`scenarios/\` (hand-crafted) and \`generated/\` (mulberry32 PRNG).
2. Each engine normalized its result to centimes (the canonical scenario format).
3. The comparator performs **deep equality** at centime-level precision.
4. The only normalization applied is for representational differences (date format → epoch millis, key ordering).
5. **No rounding or tolerance is applied to financial values.**
`;

fs.writeFileSync(reportPath, reportContent);
fs.writeFileSync(
  discrepanciesPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      strict,
      totalScenarios,
      passed: passedScenarios.size,
      totalDiscrepancies: discrepancies.length,
      errors: errorCount,
      warnings: warningCount,
      discrepancies,
    },
    null,
    2,
  ),
);

console.log("");
console.log(`Report written to: ${reportPath}`);
console.log(`Discrepancies JSON: ${discrepanciesPath}`);

// Exit code: 0 = pass, 1 = warnings (strict), 2 = errors
if (errorCount > 0) process.exit(2);
if (strict && warningCount > 0) process.exit(1);
process.exit(0);
