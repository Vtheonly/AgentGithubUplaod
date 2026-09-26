/**
 * T-420 / PERF-504 — the financial-realtime pause seam (104th session,
 * 2026-09-27 — the issue-#20 performance half).
 *
 * THE DEFECT: the bridge re-seeds EIGHT full collections on every debounced
 * realtime event (75 ms). During the owner's 1,139-row import the ~1,400
 * INSERT events turned the bridge into a continuous full-table read storm
 * that exhausted the connection pool (159 statement timeouts + 166 gateway
 * 504s) — the trigger that killed the financial flush mid-flight
 * (IMPORT-112/113). See docs/recovery/t-420-import-integrity-baseline.md §6.
 *
 * WHY SOURCE GUARDS (not behavioral tests): importing the
 * financial-realtime module in vitest pulls the supabase-repositories →
 * repository-provider chain whose module-level init fails in the test
 * environment — the DOCUMENTED pre-existing t-390 collection failure (one
 * of the 25-failure baseline set). A new test importing that chain would
 * ADD a baseline failure; the T-416 source-guard convention (43 guards on
 * the purge SQL) is the honest alternative: pin the wiring and the
 * suppression semantics in the source.
 *
 * What this suite pins:
 *
 *   1. THE WIRING — the Excel import modal MUST pause the bridge before
 *      its commit-phase importFile and resume it in a finally block (the
 *      success AND failure paths). Removing the pause reintroduces the
 *      storm that corrupts imports under pool exhaustion.
 *   2. THE SUPPRESSION SEMANTICS — both the scheduler and the refresh
 *      itself check the pause flag (an already-scheduled debounce that
 *      fires during a pause collapses into the single post-import
 *      refresh).
 *   3. THE COLLAPSE — resume performs exactly ONE refresh, and the
 *      runtime installs the trigger the resume path calls.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-420-realtime-pause-seam.test.ts
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const MODAL_PATH = path.join(
  REPO_ROOT, "src", "features", "crm", "excel-import-modal.tsx",
);
const BRIDGE_PATH = path.join(
  REPO_ROOT, "src", "infrastructure", "supabase", "financial-realtime.ts",
);

describe("T-420 / PERF-504 — the financial-realtime pause seam (source guards)", () => {
  it("1 — THE WIRING: the import modal pauses the bridge around the commit and resumes in finally", () => {
    const src = fs.readFileSync(MODAL_PATH, "utf-8");

    // The pause precedes the commit-phase importFile call.
    const pauseIdx = src.indexOf("pauseFinancialRealtime();");
    expect(pauseIdx).toBeGreaterThanOrEqual(0);
    const commitIdx = src.indexOf("dryRun: false");
    expect(commitIdx).toBeGreaterThan(pauseIdx);

    // The resume lives in a finally block (runs on success AND failure).
    const finallyIdx = src.indexOf("} finally {");
    const resumeIdx = src.indexOf("await resumeFinancialRealtime()");
    expect(finallyIdx).toBeGreaterThanOrEqual(0);
    expect(resumeIdx).toBeGreaterThan(finallyIdx);

    // The pause is BEFORE the try (so the finally always pairs with it).
    const tryIdx = src.indexOf("try {", pauseIdx);
    expect(tryIdx).toBeGreaterThan(pauseIdx);
  });

  it("2 — the bridge source suppresses BOTH the scheduler and an in-flight refresh while paused", () => {
    const src = fs.readFileSync(BRIDGE_PATH, "utf-8");

    // scheduleRefresh checks the pause flag BEFORE arming the debounce…
    const schedMatch = src.match(
      /const scheduleRefresh = \(\) => \{\s*if \(realtimePaused\) \{/,
    );
    expect(schedMatch).not.toBeNull();

    // …and refreshAll re-checks it at FIRE time (a debounce armed just
    // before the pause collapses into the single post-import refresh).
    const refreshMatch = src.match(
      /const refreshAll = async \(\) => \{\s*if \(realtimePaused\) \{/,
    );
    expect(refreshMatch).not.toBeNull();
  });

  it("3 — THE COLLAPSE: resume performs exactly ONE refresh via the runtime-installed trigger", () => {
    const src = fs.readFileSync(BRIDGE_PATH, "utf-8");

    // The exports exist (the modal imports them — typecheck pins the shape).
    expect(src).toContain("export function pauseFinancialRealtime(): void");
    expect(src).toContain("export async function resumeFinancialRealtime(): Promise<void>");

    // resume performs exactly ONE refresh (the collapse of the storm)…
    expect(src).toContain("await triggerFinancialRefresh();");
    // …via the trigger the started runtime installs.
    expect(src).toContain("triggerFinancialRefresh = refreshAll;");

    // resume is guarded (never propagates a refresh failure).
    expect(src).toMatch(/resumeFinancialRealtime[\s\S]{0,600}catch \{/);
  });
});
