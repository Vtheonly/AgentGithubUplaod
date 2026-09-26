#!/usr/bin/env node
/**
 * T-419 / ADR-029 — THE UNIFIED TEST RUNNER (issue #22 §30/§31/§36).
 *
 * `npm test` invokes this script. It is the ONE authoritative entry point
 * for the complete desktop test system, orchestrating every layer of the
 * unified testing architecture:
 *
 *   Layer 0 — typecheck (tsc --noEmit; the §15.25 ladder rung — vitest
 *             transpiles WITHOUT typechecking, so a green suite is not a
 *             typecheck; skip with --skip-typecheck for a pure test loop).
 *   Layer 1 — the FULL Vitest suite (the ONE root: src/tests/** — unit/
 *             domain, features/UI, infrastructure, integration,
 *             performance, security/RBAC, cross-platform Tier-2/Tier-4).
 *   Layer 2 — the financial equivalence TS pipeline (the ADR-006 canonical
 *             framework): deterministic scenario generation (seed 42) →
 *             the desktop runner (GATING) → the android-mirror runner
 *             (GATING) → the tier-4 mirror comparison (REPORTED while
 *             PARITY-005 is open — its 112 error rows are a registered,
 *             documented divergence, not a new regression; flip to gating
 *             with --strict-tier4 or after PARITY-005 closes) → the sanity
 *             comparator (GATING: the desktop engine must meet the corpus's
 *             canonical `then` expectations — runs against a TEMP copy so
 *             the results/android slot stays reserved for real Kotlin).
 *   Layer 3 — the environment-gated layers (REPORTED, never silently
 *             skipped — issue §20/§31): the REAL Kotlin runner (needs the
 *             Android repo as a sibling + JDK/gradle), the backend runner
 *             (needs a live PostgreSQL with the canonical chain), and the
 *             live-E2E family (owner credentials — the verify_t-XXX.sql
 *             convention owns live verification per ADR-006's recorded
 *             deviation).
 *
 * The unified summary (console + test-reports/unified-report_<ts>.md)
 * reports: totals, pass/fail, skips, environment-gated layers with
 * reasons, the tier-4 known-divergence status, and — critically — a
 * comparison against the DOCUMENTED baseline (scripts/test-baseline.json):
 * a full run whose failing set matches the documented 25-failure baseline
 * is reported as "baseline-matched"; any NEW failure (or vanished failure)
 * is flagged loudly so a regression can never hide behind the documented
 * red (the §15.14 discipline).
 *
 * Usage:
 *   npm test                              # all layers (the authoritative run)
 *   npm test -- --layer=1                 # the vitest suite only (fast loop: npm run test:vitest)
 *   npm test -- --layer=2                 # the equivalence pipeline only
 *   npm test -- --layer=3                 # the environment census only
 *   npm test -- --suite=domain            # targeted vitest (a mode, not a framework — issue §12)
 *   npm test -- --skip-typecheck          # skip Layer 0
 *   npm test -- --strict-tier4            # tier-4 mirror comparison gates the exit code
 *
 * Every enabled layer ALWAYS runs and reports (no early abort except a
 * Layer-2 generator failure, which makes the downstream steps impossible).
 *
 * Exit code: non-zero if any GATING layer fails — including the documented
 * 25-failure vitest baseline (RED-as-documented: real open defects, but the
 * summary says BASELINE-MATCHED so a NEW regression can never hide behind
 * them). Layer 3 environment-gates never fail the run; the tier-4
 * comparison only fails it under --strict-tier4 or post-PARITY-005.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESKTOP_ROOT = path.resolve(__dirname, "..");
const EQUIV = path.join(DESKTOP_ROOT, "financial-tests", "equivalence");
const REPORTS_DIR = path.join(DESKTOP_ROOT, "test-reports");

// ─── CLI ───────────────────────────────────────────────────────────────────

function argValue(name) {
  const argv = process.argv;
  // support both `--name value` and `--name=value`
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith(name + "=")) return argv[i].slice(name.length + 1);
  }
  return undefined;
}
const has = (name) => process.argv.includes(name);
const layers = (argValue("--layer") ?? "all").split(",").map((s) => s.trim());
const runLayer = (n) => layers.includes("all") || layers.includes(String(n));
const suiteFilter = argValue("--suite");
const skipTypecheck = has("--skip-typecheck");
const strictTier4 = has("--strict-tier4");

// ─── utilities ─────────────────────────────────────────────────────────────

const TSX = ["npx", "tsx"];
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: DESKTOP_ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function parseVitestSummary(stdout) {
  const summary = { files: null, tests: null, failingFiles: [] };
  const fileLine = stdout.match(/Test Files\s+(.+)/);
  if (fileLine) {
    const numbers = fileLine[1].match(/(\d+)\s+failed|\s+(\d+)\s+passed|\s+(\d+)\s+skipped/g) ?? [];
    const failed = fileLine[1].match(/(\d+) failed/);
    const passed = fileLine[1].match(/(\d+) passed/);
    const skipped = fileLine[1].match(/(\d+) skipped/);
    const total = fileLine[1].match(/\((\d+)\)/);
    summary.files = {
      failed: failed ? Number(failed[1]) : 0,
      passed: passed ? Number(passed[1]) : 0,
      skipped: skipped ? Number(skipped[1]) : 0,
      total: total ? Number(total[1]) : 0,
    };
  }
  const testLine = stdout.match(/Tests\s+(.+)/);
  if (testLine) {
    const failed = testLine[1].match(/(\d+) failed/);
    const passed = testLine[1].match(/(\d+) passed/);
    const skipped = testLine[1].match(/(\d+) skipped/);
    const total = testLine[1].match(/\((\d+)\)/);
    summary.tests = {
      failed: failed ? Number(failed[1]) : 0,
      passed: passed ? Number(passed[1]) : 0,
      skipped: skipped ? Number(skipped[1]) : 0,
      total: total ? Number(total[1]) : 0,
    };
  }
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*FAIL\s+(\S+?\.test\.[jt]sx?)\s/);
    if (m) summary.failingFiles.push(m[1]);
  }
  summary.failingFiles = [...new Set(summary.failingFiles)].sort();
  return summary;
}

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, "scripts", "test-baseline.json"), "utf-8"));
  } catch {
    return null;
  }
}

// ─── the report ────────────────────────────────────────────────────────────

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const report = { startedAt: new Date().toISOString(), layers: {} };
let exitCode = 0;
function fail() {
  // No early abort — every enabled layer runs and the unified summary is
  // always emitted (a silent abort hides state; issue #22 §36).
  exitCode = exitCode || 1;
}

// ─── Layer 0 — typecheck ───────────────────────────────────────────────────

if (runLayer(0) && !skipTypecheck) {
  process.stdout.write("\n━━━ Layer 0 — typecheck (tsc --noEmit) ━━━\n");
  const r = run("npx", ["tsc", "--noEmit"]);
  const ok = r.code === 0;
  report.layers.typecheck = { ok, code: r.code };
  console.log(ok ? "  ✓ typecheck clean (0 errors)" : "  ✗ typecheck FAILED");
  if (!ok) {
    console.log(r.stdout.split("\n").slice(0, 15).join("\n"));
    fail();
    // No early abort: the unified report must cover EVERY layer (issue §36) —
    // a typecheck failure does not prevent the suites from running.
  }
}

// ─── Layer 1 — the full Vitest suite ───────────────────────────────────────

if (runLayer(1)) {
  process.stdout.write("\n━━━ Layer 1 — the full Vitest suite (src/tests — the ONE root) ━━━\n");
  const vitestArgs = ["run"];
  if (suiteFilter) vitestArgs.push(suiteFilter);
  const r = run("npx", ["vitest", ...vitestArgs]);
  const summary = parseVitestSummary(r.stdout + "\n" + r.stderr);
  const baseline = loadBaseline();
  let baselineStatus = "n/a (no baseline manifest or targeted suite run)";
  if (baseline && summary.tests && !suiteFilter) {
    const sameCounts =
      summary.tests.failed === baseline.tests.failed &&
      summary.tests.passed === baseline.tests.passed &&
      summary.tests.skipped === baseline.tests.skipped;
    const actualSet = new Set(summary.failingFiles);
    const baseSet = new Set(baseline.failingFiles);
    const newFailures = [...actualSet].filter((f) => !baseSet.has(f));
    const vanished = [...baseSet].filter((f) => !actualSet.has(f));
    if (sameCounts && newFailures.length === 0 && vanished.length === 0) {
      baselineStatus = `BASELINE-MATCHED (${baseline.tests.failed} documented failures — red as documented)`;
    } else {
      baselineStatus = `BASELINE DEVIATION: tests ${summary.tests.failed} vs documented ${baseline.tests.failed}`;
      if (newFailures.length) baselineStatus += ` | NEW failing files: ${newFailures.join(", ")}`;
      if (vanished.length) baselineStatus += ` | vanished failing files: ${vanished.join(", ")}`;
    }
  }
  report.layers.vitest = { summary, baselineStatus, code: r.code };
  if (summary.tests) {
    console.log(
      `  Test Files: ${summary.files?.failed ?? "?"} failed | ${summary.files?.passed ?? "?"} passed | ${summary.files?.skipped ?? "?"} skipped (${summary.files?.total ?? "?"})`,
    );
    console.log(
      `       Tests: ${summary.tests.failed} failed | ${summary.tests.passed} passed | ${summary.tests.skipped} skipped (${summary.tests.total})`,
    );
  } else {
    console.log("  ⚠ could not parse the vitest summary from the output");
  }
  console.log(`  Baseline: ${baselineStatus}`);
  if (r.code !== 0) {
    // Vitest exit != 0. The unified runner keeps npm test's exit semantics
    // RED while ANY failure exists (the documented baseline included — the
    // 25 failures are real open defects under their own problem entries,
    // and pretending the suite is green would be the §15.14 class). The
    // SUMMARY distinguishes the two reds: BASELINE-MATCHED (documented, no
    // new regressions) vs BASELINE DEVIATION (new/vanished failures — the
    // loud one). No early abort: Layer 2/3 still run and report.
    fail();
  }
}

// ─── Layer 2 — the financial equivalence TS pipeline ───────────────────────

if (runLayer(2)) {
  process.stdout.write("\n━━━ Layer 2 — the financial equivalence pipeline (ADR-006 framework) ━━━\n");
  const eq = {};

  // 2.1 deterministic scenario generation (issue §23: same seed → same scenarios)
  process.stdout.write("  [2.1] generating scenarios (seed=42, count=500)…\n");
  const gen = run(TSX[0], [TSX[1], "financial-tests/equivalence/generators/scenario_generator.ts", "--count=500", "--seed=42"]);
  eq.generator = { ok: gen.code === 0 };
  if (gen.code !== 0) {
    console.log("  ✗ generator FAILED"); console.log(gen.stderr.slice(0, 800));
    report.layers.equivalence = eq; fail();
    // Early abort WITHIN Layer 2 only: every subsequent step consumes the
    // generated scenarios — continuing is impossible, and that is reported.
    finalize();
  } else {
    console.log("    ✓ 500 generated (deterministic)");
  }

  // 2.2 the desktop runner — GATING
  if (eq.generator.ok) {
    process.stdout.write("  [2.2] desktop runner (the canonical TS engine)…\n");
    const dr = run(TSX[0], [TSX[1], "financial-tests/equivalence/desktop/desktop_runner.ts", "--generated"]);
    const m = (dr.stdout + dr.stderr).match(/Desktop runner: (\d+) passed, (\d+) failed, (\d+) errored \(of (\d+) total\)/);
    eq.desktopRunner = m
      ? { passed: +m[1], failed: +m[2], errored: +m[3], total: +m[4], ok: dr.code === 0 }
      : { ok: false, raw: (dr.stdout + dr.stderr).slice(-400) };
    if (m) console.log(`    ✓ ${m[1]} passed, ${m[2]} failed, ${m[3]} errored (of ${m[4]}) — the 10 errored = the zero-payment error-equivalence family`);
    if (dr.code !== 0) { console.log("  ✗ desktop runner FAILED"); fail(); }
  }

  // 2.3 the android-mirror runner — GATING (execution; skips are reported)
  if (eq.generator.ok) {
    process.stdout.write("  [2.3] android-mirror runner (the Kotlin-port TS engine)…\n");
    const mr = run(TSX[0], [TSX[1], "financial-tests/equivalence/android_mirror/android_mirror_runner.ts", "--generated"]);
    const m = (mr.stdout + mr.stderr).match(/Android mirror runner: (\d+) passed, (\d+) failed, (\d+) errored, (\d+) skipped \(of (\d+) total\)/);
    eq.mirrorRunner = m
      ? { passed: +m[1], failed: +m[2], errored: +m[3], skipped: +m[4], total: +m[5], ok: mr.code === 0 }
      : { ok: false, raw: (mr.stdout + mr.stderr).slice(-400) };
    if (m) console.log(`    ✓ ${m[1]} passed, ${m[2]} failed, ${m[3]} errored, ${m[4]} skipped (of ${m[5]}) — the 35 skips carry reasons (ops not ported to the TS mirror runner)`);
    if (mr.code !== 0) { console.log("  ✗ mirror runner FAILED"); fail(); }
  }

  // 2.4 the tier-4 mirror comparison — REPORTED (PARITY-005) / gating with --strict-tier4
  if (eq.generator.ok) {
    process.stdout.write("  [2.4] tier-4 comparison (desktop vs mirror)…\n");
    const t4 = run(TSX[0], [TSX[1], "financial-tests/equivalence/comparison/tier4_comparator.ts"]);
    const out = t4.stdout + t4.stderr;
    const passed = out.match(/Scenarios passed \(equivalent\): (\d+) \/ (\d+)/);
    const skipped = out.match(/Scenarios skipped [^:]*: (\d+)/);
    const disc = out.match(/Discrepancies: (\d+) \((\d+) errors, (\d+) warnings\)/);
    eq.tier4 = {
      equivalent: passed ? +passed[1] : null,
      total: passed ? +passed[2] : null,
      skipped: skipped ? +skipped[1] : null,
      rows: disc ? +disc[1] : null,
      errors: disc ? +disc[2] : null,
      warnings: disc ? +disc[3] : null,
      ok: t4.code === 0 || t4.code === 2, // 2 = comparator's documented error exit
      knownProblem: "PARITY-005",
    };
    if (disc) {
      console.log(`    ${disc[2] > 0 ? "⚑" : "✓"} ${passed?.[1]}/${passed?.[2]} equivalent, ${skipped?.[1]} skipped, ${disc[1]} rows (${disc[2]} errors, ${disc[3]} warnings)`);
      if (+disc[2] > 0) {
        console.log(`      → KNOWN divergence (PARITY-005: the mirror still applies the CALC-001-removed discount rules).`);
        console.log(`        REPORTED, non-gating${strictTier4 ? "" : " (use --strict-tier4 to gate on it)"} — repair is the registered follow-up.`);
        if (strictTier4) fail();
      }
    } else {
      console.log("  ⚠ could not parse the tier-4 summary");
      eq.tier4.parseFailed = true;
    }
  }

  // 2.5 the sanity comparator — GATING (the canonical-expectations gate)
  if (eq.generator.ok && eq.desktopRunner?.ok) {
    process.stdout.write("  [2.5] sanity comparator (desktop vs temp copy — the framework + canonical `then` gate)…\n");
    const tempDir = path.join(EQUIV, "results", "_sanity_android");
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    for (const f of fs.readdirSync(path.join(EQUIV, "results", "desktop"))) {
      if (f.endsWith(".json") && !f.startsWith("_")) {
        fs.copyFileSync(path.join(EQUIV, "results", "desktop", f), path.join(tempDir, f));
      }
    }
    const sc = run(TSX[0], [
      TSX[1], "financial-tests/equivalence/comparison/comparator.ts",
      "--desktop-dir", path.join(EQUIV, "results", "desktop"),
      "--android-dir", tempDir,
    ]);
    const out = sc.stdout + sc.stderr;
    const rate = out.match(/Equivalence rate: (\d+)\/(\d+) \((.+)%\)/);
    const canon = out.match(/Canonical expected verified: (\d+)\/(\d+)/);
    const discrepancies = out.match(/Discrepancies: (\d+)/);
    eq.sanityComparator = {
      equivalent: rate ? +rate[1] : null,
      total: rate ? +rate[2] : null,
      canonicalVerified: canon ? +canon[1] : null,
      canonicalDefined: canon ? +canon[2] : null,
      discrepancies: discrepancies ? +discrepancies[1] : null,
    };
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (rate) {
      const allGood = +rate[1] === +rate[2] && canon && +canon[1] === +canon[2];
      console.log(`    ${allGood ? "✓" : "✗"} ${rate[1]}/${rate[2]} equivalent; canonical expected verified ${canon?.[1]}/${canon?.[2]}; discrepancies ${discrepancies?.[1]}`);
      if (!allGood) { fail(); }
    } else {
      console.log("  ⚠ could not parse the sanity comparator output");
      eq.sanityComparator.parseFailed = true;
    }
  }

  report.layers.equivalence = eq;
}

// ─── Layer 3 — the environment-gated census (reported, never silent) ───────

if (runLayer(3)) {
  process.stdout.write("\n━━━ Layer 3 — environment-gated layers (reported with reasons — never silently skipped) ━━━\n");
  const env3 = {};

  // 3.1 the REAL Kotlin runner — needs the Android repo as a sibling + JDK + gradle
  const androidRepo = path.resolve(DESKTOP_ROOT, "..", "..", "..", "elimtiyaz-android");
  const gradlew = path.join(androidRepo, "gradlew");
  const hasJava = run("bash", ["-lc", "command -v java && java -version 2>&1 | head -1"]).code === 0;
  const kotlinReady = fs.existsSync(gradlew) && hasJava;
  env3.realKotlin = {
    available: kotlinReady,
    reason: kotlinReady
      ? "prerequisites present — run: cd elimtiyaz-android && ./gradlew test (reads the corpus in place per docs/testing/cross-platform.md §2.1)"
      : `ENVIRONMENT-GATED: ${fs.existsSync(gradlew) ? "java/JDK not on PATH" : "the Android repo is not checked out as a sibling (../elimtiyaz-android)"} — the corpus path contract is preserved (ADR-029); provision per AGENTS.md §11 (Temurin JDK 21 + SDK 35) and re-run`,
  };
  console.log(`  [3.1] real Kotlin runner: ${kotlinReady ? "AVAILABLE (see reason for the command)" : "ENVIRONMENT-GATED"}`);
  if (!kotlinReady) console.log(`        ${env3.realKotlin.reason}`);

  // 3.2 the backend runner — needs a live PostgreSQL with the canonical chain
  const pgEnv = process.env.EQUIVALENCE_BACKEND_PGURL;
  env3.backend = {
    available: Boolean(pgEnv),
    reason: pgEnv
      ? "EQUIVALENCE_BACKEND_PGURL set — run: npx tsx financial-tests/equivalence/backend/backend_runner.ts (transaction-rollback isolated)"
      : "ENVIRONMENT-GATED: no live PostgreSQL provisioned (set EQUIVALENCE_BACKEND_PGURL or pass --database/--host/--port to the backend runner); live server verification is owned by the verify_t-XXX.sql convention (AGENTS.md §11.1, ADR-006's recorded deviation)",
  };
  console.log(`  [3.2] backend runner: ${pgEnv ? "AVAILABLE" : "ENVIRONMENT-GATED"}`);
  if (!pgEnv) console.log(`        ${env3.backend.reason}`);

  // 3.3 the live-E2E family — owner credentials
  env3.liveE2E = {
    available: false,
    reason:
      "ENVIRONMENT-GATED by design: live end-to-end verification runs through the owner-credential convention (scripts/verify_t-XXX.sql + the t-XXX-live-verification.md evidence trail, AGENTS.md §11.1) — never as part of the deterministic local suite",
  };
  console.log(`  [3.3] live-E2E family: ENVIRONMENT-GATED (the verify_t-XXX convention owns it)`);
  console.log(`        ${env3.liveE2E.reason}`);

  report.layers.environmentGated = env3;
}

// ─── finalize ──────────────────────────────────────────────────────────────

finalize();

function finalize() {
  if (finalize.done) return;
  finalize.done = true;
  report.finishedAt = new Date().toISOString();
  report.exitCode = exitCode;

  const lines = [];
  lines.push("# Unified Test Report (T-419 / ADR-029)");
  lines.push("");
  lines.push(`**Started:** ${report.startedAt}`);
  lines.push(`**Finished:** ${report.finishedAt}`);
  lines.push(`**Command:** npm test ${process.argv.slice(2).join(" ")}`.trim());
  lines.push("");
  lines.push("## Layer summary");
  lines.push("");
  lines.push("| Layer | Result |");
  lines.push("|---|---|");

  const tc = report.layers.typecheck;
  if (tc) lines.push(`| 0 — typecheck | ${tc.ok ? "✓ 0 errors" : "✗ FAILED"} |`);
  const vt = report.layers.vitest;
  if (vt?.tests || vt?.summary?.tests) {
    const s = vt.summary.tests ?? vt.tests;
    lines.push(`| 1 — vitest full suite | ${s.failed} failed / ${s.passed} passed / ${s.skipped} skipped (${s.total}) — ${vt.baselineStatus} |`);
  }
  const eq = report.layers.equivalence;
  if (eq) {
    if (eq.desktopRunner?.total != null) lines.push(`| 2.2 — desktop runner | ${eq.desktopRunner.passed} passed / ${eq.desktopRunner.failed} failed / ${eq.desktopRunner.errored} errored (${eq.desktopRunner.total}) |`);
    if (eq.mirrorRunner?.total != null) lines.push(`| 2.3 — mirror runner | ${eq.mirrorRunner.passed} passed / ${eq.mirrorRunner.failed} failed / ${eq.mirrorRunner.errored} errored / ${eq.mirrorRunner.skipped} skipped (${eq.mirrorRunner.total}) |`);
    if (eq.tier4?.total != null) lines.push(`| 2.4 — tier-4 comparison | ${eq.tier4.equivalent}/${eq.tier4.total} equivalent, ${eq.tier4.skipped} skipped, ${eq.tier4.rows} rows (${eq.tier4.errors} errors, ${eq.tier4.warnings} warnings) — KNOWN ${eq.tier4.knownProblem}${strictTier4 ? ", strict" : ", reported" } |`);
    if (eq.sanityComparator?.total != null) lines.push(`| 2.5 — sanity comparator | ${eq.sanityComparator.equivalent}/${eq.sanityComparator.total} equivalent; canonical ${eq.sanityComparator.canonicalVerified}/${eq.sanityComparator.canonicalDefined}; discrepancies ${eq.sanityComparator.discrepancies} |`);
  }
  const env3 = report.layers.environmentGated;
  if (env3) {
    lines.push(`| 3.1 — real Kotlin | ${env3.realKotlin.available ? "AVAILABLE" : "ENVIRONMENT-GATED"} |`);
    lines.push(`| 3.2 — backend runner | ${env3.backend.available ? "AVAILABLE" : "ENVIRONMENT-GATED"} |`);
    lines.push(`| 3.3 — live E2E | ENVIRONMENT-GATED (by design) |`);
  }
  lines.push("");
  if (env3) {
    lines.push("### Environment-gated reasons");
    lines.push("");
    lines.push(`- **real Kotlin:** ${env3.realKotlin.reason}`);
    lines.push(`- **backend:** ${env3.backend.reason}`);
    lines.push(`- **live E2E:** ${env3.liveE2E.reason}`);
    lines.push("");
  }
  lines.push("## Verdict");
  lines.push("");
  const vt2 = report.layers.vitest;
  const failedTests = vt2?.summary?.tests?.failed ?? 0;
  if (exitCode === 0) {
    lines.push("**GREEN** — every gating layer passed with zero failures.");
  } else if (vt2 && vt2.baselineStatus?.startsWith("BASELINE-MATCHED")) {
    lines.push(`**RED (documented baseline)** — ${failedTests} documented failures remain open under their own problem entries; NO new regressions vs scripts/test-baseline.json. Any other gating layer also passing is reflected above.`);
  } else {
    lines.push("**RED** — a gating layer failed or the baseline DEVIATED (new/vanished failures — investigate before building on this state).");
  }
  lines.push("");

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportFile = path.join(REPORTS_DIR, `unified-report_${timestamp}.md`);
  fs.writeFileSync(reportFile, lines.join("\n"));
  fs.writeFileSync(path.join(REPORTS_DIR, "unified-report_latest.json"), JSON.stringify(report, null, 2));

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("UNIFIED TEST SUMMARY");
  for (const l of lines.filter((x) => x.startsWith("| ") && !x.startsWith("| Layer") && !x.startsWith("|---"))) {
    console.log("  " + l.replace(/\|/g, "│").slice(0, 110));
  }
  console.log(`\n  Verdict: ${
    exitCode === 0
      ? "GREEN — every gating layer passed with zero failures"
      : report.layers.vitest?.baselineStatus?.startsWith("BASELINE-MATCHED")
        ? `RED (documented baseline) — ${failedTests} documented failures, NO new regressions`
        : "RED — a gating layer failed or the baseline DEVIATED"
  }`);
  console.log(`  Full report: ${path.relative(DESKTOP_ROOT, reportFile)}`);
  console.log("═══════════════════════════════════════════════════════════");

  process.exit(exitCode);
}
