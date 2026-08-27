/**
 * cross-platform-v2 — Exact comparison engine.
 *
 * Compares N platform results for the same scenario against the FIRST
 * available result (reference = desktop by convention, but any platform can
 * be the reference — a discrepancy is recorded whichever side deviates).
 *
 * Emits precise diff records (JSON path, per-platform values) so every
 * divergence can be root-caused and preserved as a regression case.
 */
import { normalize, type Json } from "./normalize";
import type { PlatformResult } from "./types";

export interface DiffRecord {
  path: string;
  values: Record<string, Json>; // platform → normalized value
  divergentPlatforms: string[];
}

export interface ScenarioComparison {
  scenarioId: string;
  platforms: string[];
  equivalent: boolean;
  errors: Array<{ platform: string; error: string }>;
  diffs: DiffRecord[];
}

/** Compare the comparable sections of PlatformResult across platforms. */
const COMPARE_SECTIONS = [
  "installments",
  "summary",
  "allocations",
  "ledgerTotals",
  "ledgerEntryCount",
  "values",
  "websiteDerived",
] as const;

export function compareResults(results: PlatformResult[]): ScenarioComparison {
  const platforms = results.map((r) => r.platform);
  const errors = results
    .filter((r) => r.error)
    .map((r) => ({ platform: r.platform, error: r.error as string }));

  // Error-equivalence: if the scenario expects an error, all platforms must
  // have errored (an `error` on the result = adapter-level failure).
  // Operation-level rejections are compared via `operationErrors` + `values`.
  const diffs: DiffRecord[] = [];

  // Reference = first non-adapter-error result.
  const reference = results.find((r) => !r.error);
  if (!reference) {
    return { scenarioId: results[0]?.scenarioId ?? "?", platforms, equivalent: errors.length === 0, errors, diffs };
  }

  for (const section of COMPARE_SECTIONS) {
    for (const r of results) {
      if (r.platform === reference.platform) continue;
      const refRaw = (reference as unknown as Record<string, unknown>)[section];
      const otherRaw = (r as unknown as Record<string, unknown>)[section];
      // Compare only sections BOTH platforms emit — platform-specific
      // sections (e.g. websiteDerived on the website, backendState on the
      // backend) are coverage-tracked by the orchestrator, not diffed.
      if (refRaw === undefined || otherRaw === undefined) continue;
      const refValue = normalize(refRaw);
      const otherValue = normalize(otherRaw);
      if (JSON.stringify(refValue) !== JSON.stringify(otherValue)) {
        diffs.push(...diffObject(section, refValue, otherValue, reference.platform, r.platform, results));
      }
    }
  }

  return {
    scenarioId: reference.scenarioId,
    platforms,
    equivalent: diffs.length === 0 && errors.length === 0,
    errors,
    diffs,
  };
}

function diffObject(
  root: string,
  ref: Json,
  other: Json,
  refPlatform: string,
  otherPlatform: string,
  allResults: PlatformResult[],
): DiffRecord[] {
  const records: DiffRecord[] = [];
  walk(ref, other, root);
  return records;

  function walk(a: Json | undefined, b: Json | undefined, path: string): void {
    const aMissing = a === null || a === undefined;
    const bMissing = b === null || b === undefined;
    if (aMissing && bMissing) return;
    if (aMissing !== bMissing) {
      // null vs undefined vs "" — normalized both to null already; reaching
      // here means one side genuinely lacks the field.
      push(path, a ?? null, b ?? null);
      return;
    }
    if (typeof a !== typeof b) {
      push(path, a ?? null, b ?? null);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        push(path, a, b);
        return;
      }
      for (let i = 0; i < a.length; i++) walk(a[i], b[i], `${path}[${i}]`);
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) walk((a as Record<string, Json>)[k], (b as Record<string, Json>)[k], `${path}.${k}`);
      return;
    }
    if (a !== b) push(path, a ?? null, b ?? null);
  }

  function push(path: string, a: Json, b: Json): void {
    const existing = records.find((r) => r.path === path);
    if (existing) {
      existing.values[otherPlatform] = b;
      existing.divergentPlatforms.push(otherPlatform);
      return;
    }
    const values: Record<string, Json> = { [refPlatform]: a, [otherPlatform]: b };
    // Include every other platform's value at this path for context.
    for (const r of allResults) {
      if (r.platform !== refPlatform && r.platform !== otherPlatform) {
        values[r.platform] = getPath(r, path);
      }
    }
    records.push({ path, values, divergentPlatforms: [otherPlatform] });
  }
}

function getPath(result: PlatformResult, path: string): Json {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur: unknown = result;
  for (const p of parts) {
    if (cur === null || cur === undefined) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return normalize(cur);
}
