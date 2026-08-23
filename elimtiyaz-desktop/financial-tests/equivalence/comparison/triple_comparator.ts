/**
 * Triple-Engine Differential Comparator — Desktop vs Android vs Backend.
 *
 * Reads three result-sets:
 *   - results/desktop/<id>.json   (desktop_runner.ts — TS canonical engine)
 *   - results/android/<id>.json   (AndroidEquivalenceRunner.kt — REAL Kotlin)
 *   - results/backend/<id>.json   (backend_runner.ts — live PostgreSQL)
 *
 * Comparison rules:
 *   - Backend `skipped` results (app-layer canonical rules per migration
 *     0036) are excluded — the scenario is compared desktop vs android.
 *   - All-error equivalence: if every engine that ran the scenario reports
 *     the SAME error message, the scenario is EQUIVALENT (e.g. zero-payment
 *     validation).
 *   - Only keys present in EVERY compared engine's result are compared —
 *     the backend returns a canonical subset.
 *
 * Output:
 *   - reports/triple_equivalence_report_<timestamp>.md
 *   - exit code 0 when no discrepancy, 1 otherwise.
 *
 * Usage:
 *   npx tsx financial-tests/equivalence/comparison/triple_comparator.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

interface ResultFile {
  scenarioId: string;
  engine: string;
  result: Record<string, unknown> & { error?: string; skipped?: boolean; reason?: string };
  operationType?: string;
  category?: string;
}

function loadResults(dir: string): Map<string, ResultFile> {
  const out = new Map<string, ResultFile>();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as ResultFile;
      out.set(parsed.scenarioId, parsed);
    } catch {
      // ignore malformed files
    }
  }
  return out;
}

function tryParseDate(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const epochMs = tryParseDate(value);
  if (epochMs !== null && typeof value === "string" && value.length >= 10 && value.includes("-")) {
    return epochMs;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalize(v);
  return out;
}

interface Discrepancy {
  path: string;
  values: Record<string, unknown>;
  delta?: number;
}

function deepCompare(
  a: unknown,
  b: unknown,
  path: string,
  out: Discrepancy[],
  labelA: string,
  labelB: string,
): void {
  const na = normalize(a);
  const nb = normalize(b);
  if (typeof na !== typeof nb) {
    out.push({ path, values: { [labelA]: na, [labelB]: nb } });
    return;
  }
  if (na === null || nb === null || typeof na !== "object") {
    if (na !== nb) {
      const delta = typeof na === "number" && typeof nb === "number" ? Number(na) - Number(nb) : undefined;
      out.push({ path, values: { [labelA]: na, [labelB]: nb }, delta });
    }
    return;
  }
  if (Array.isArray(na) || Array.isArray(nb)) {
    if (!Array.isArray(na) || !Array.isArray(nb)) {
      out.push({ path, values: { [labelA]: na, [labelB]: nb } });
      return;
    }
    if (na.length !== nb.length) {
      out.push({ path: `${path}.length`, values: { [labelA]: na.length, [labelB]: nb.length } });
    }
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      deepCompare(na[i], nb[i], `${path}[${i}]`, out, labelA, labelB);
    }
    return;
  }
  const oa = na as Record<string, unknown>;
  const ob = nb as Record<string, unknown>;
  for (const k of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
    deepCompare(oa[k], ob[k], `${path}.${k}`, out, labelA, labelB);
  }
}

function main() {
  const desktop = loadResults(path.join(rootDir, "results", "desktop"));
  const android = loadResults(path.join(rootDir, "results", "android"));
  const backend = loadResults(path.join(rootDir, "results", "backend"));

  const allIds = new Set([...desktop.keys(), ...android.keys(), ...backend.keys()]);
  const discrepancies: Array<{ scenarioId: string; issues: Discrepancy[]; note?: string }> = [];
  const equivalent: string[] = [];
  const partialEquivalence: Array<{ scenarioId: string; engines: string[] }> = [];

  for (const id of [...allIds].sort()) {
    const d = desktop.get(id);
    const a = android.get(id);
    const b = backend.get(id);

    const engines: Array<[string, ResultFile | undefined]> = [["desktop", d], ["android", a], ["backend", b]];
    const ran = engines.filter(([, r]) => r != null && !(r.result && r.result.skipped));
    const skipped = engines.filter(([, r]) => r != null && r.result && r.result.skipped);

    if (ran.length === 0) {
      partialEquivalence.push({ scenarioId: id, engines: skipped.map(([n]) => `${n}:skipped`) });
      continue;
    }

    // All-error equivalence: every engine that ran reports the same error.
    const errorValues = ran.map(([, r]) => r!.result.error).filter(Boolean) as string[];
    if (errorValues.length === ran.length && new Set(errorValues).size === 1) {
      equivalent.push(id);
      continue;
    }

    // Mixed error/success = discrepancy.
    const hasError = ran.some(([, r]) => Boolean(r!.result.error));
    if (hasError) {
      discrepancies.push({
        scenarioId: id,
        issues: [{
          path: "result.error",
          values: Object.fromEntries(ran.map(([n, r]) => [n, r!.result.error ?? "(no error)"])),
        }],
        note: "Mixed error/success across engines",
      });
      continue;
    }

    // Compare the intersection of result keys across engines that ran.
    const keySets = ran.map(([, r]) => new Set(Object.keys(r!.result)));
    const commonKeys = keySets.reduce<Set<string>>(
      (acc, ks) => new Set([...acc].filter((k) => ks.has(k))),
      keySets[0] ?? new Set(),
    );

    const issues: Discrepancy[] = [];
    for (const [i, [nameA, resA]] of ran.entries()) {
      for (const [nameB, resB] of ran.slice(i + 1)) {
        for (const key of commonKeys) {
          deepCompare(resA!.result[key], resB!.result[key], `result.${key}`, issues, nameA, nameB);
        }
      }
    }

    if (issues.length > 0) {
      discrepancies.push({ scenarioId: id, issues });
    } else {
      equivalent.push(id);
      if (skipped.length > 0) {
        partialEquivalence.push({ scenarioId: id, engines: skipped.map(([n]) => `${n}:app-layer`) });
      }
    }
  }

  // ── Report ──
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportDir = path.join(rootDir, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const lines: string[] = [];
  lines.push("# Triple-Engine Equivalence Report (Desktop × Android × Backend)");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`- Scenarios compared: **${allIds.size}**`);
  lines.push(`- Equivalent: **${equivalent.length}**`);
  lines.push(`- Discrepant: **${discrepancies.length}**`);
  lines.push(`- App-layer only (backend N/A by design): **${partialEquivalence.filter((p) => !equivalent.includes(p.scenarioId)).length}**`);
  lines.push("");
  if (discrepancies.length > 0) {
    lines.push("## Discrepancies");
    lines.push("");
    for (const d of discrepancies) {
      lines.push(`### ${d.scenarioId}${d.note ? ` — ${d.note}` : ""}`);
      lines.push("");
      for (const issue of d.issues) {
        lines.push(`- \`${issue.path}\`: ${JSON.stringify(issue.values)}${issue.delta != null ? ` (Δ ${issue.delta})` : ""}`);
      }
      lines.push("");
    }
  }
  lines.push("## Verdict");
  lines.push("");
  lines.push(discrepancies.length === 0
    ? `**PASS** — all ${equivalent.length} comparable scenarios produce semantically equivalent results across every engine that implements them.`
    : `**FAIL** — ${discrepancies.length} scenario(s) diverge across engines.`);
  lines.push("");
  const reportFile = path.join(reportDir, `triple_equivalence_report_${ts}.md`);
  fs.writeFileSync(reportFile, lines.join("\n"));

  console.log(`Scenarios: ${allIds.size} | equivalent: ${equivalent.length} | discrepant: ${discrepancies.length} | backend-skipped: ${partialEquivalence.length}`);
  for (const d of discrepancies) {
    console.log(`  ✗ ${d.scenarioId}`);
    for (const issue of d.issues.slice(0, 3)) {
      console.log(`      ${issue.path}: ${JSON.stringify(issue.values).slice(0, 160)}`);
    }
  }
  console.log(`Report: ${reportFile}`);
  process.exit(discrepancies.length === 0 ? 0 : 1);
}

main();
