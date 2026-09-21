// ============================================================================
// scripts/timetable-packaging-smoke.mjs — T-404 packaging gates (2026-09-22)
// ============================================================================
/**
 * The T-404 clean-machine generation test. PROVES the solver needs nothing
 * from the developer environment:
 *
 *   Gate A — Standalone bundle: the canonical solver + fixture are bundled
 *            into ONE self-contained .mjs (esbuild, platform=node, zero
 *            imports at runtime).
 *   Gate B — Bare-environment execution: the standalone bundle runs under
 *            `env -i` (EMPTY environment — no NODE_PATH, no NODE_MODULES,
 *            no dev server, no vite) and produces the known-good fixture
 *            result (status=valid, all periods placed, zero hard
 *            violations).
 *   Gate C — Determinism: two consecutive bare runs produce byte-identical
 *            schedule signatures (the known-good deterministic fixture,
 *            packaging requirement 5).
 *   Gate D — Failure diagnostics: the impossible variant reports honest
 *            unplaced reasons under the same bare environment (requirement
 *            6).
 *   Gate E — Solver build identification: the output carries solver id +
 *            build stamp (requirement 8).
 *
 * Usage: node scripts/timetable-packaging-smoke.mjs
 * Exit code 0 = all gates PASS.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// ── Gate A: standalone bundle ─────────────────────────────────────────────
const esbuildPath = path.join(
  repoRoot,
  "node_modules",
  "esbuild",
  "bin",
  "esbuild",
);
if (!existsSync(esbuildPath)) {
  console.error("FAIL: esbuild not found at", esbuildPath);
  process.exit(1);
}

const workDir = mkdtempSync(path.join(tmpdir(), "t404-smoke-"));
const entryFile = path.join(workDir, "smoke-entry.ts");
const outFile = path.join(workDir, "timetable-solver-standalone.mjs");

writeFileSync(
  entryFile,
  `
import { buildFixtureProblem, buildImpossibleProblem } from ${JSON.stringify(
    path.join(repoRoot, "src/domain/calc/timetable/fixture"),
  )};
import { getTimetableSolver, GREEDY_SOLVER_ID } from ${JSON.stringify(
    path.join(repoRoot, "src/domain/calc/timetable/solver"),
  )};
import ${JSON.stringify(path.join(repoRoot, "src/domain/calc/timetable/solver"))};

const solver = getTimetableSolver(GREEDY_SOLVER_ID);
const problem = buildFixtureProblem();
const solution = solver.solve(problem);
const signature = (s) =>
  s.entries
    .map((e) => [e.classId, e.subjectId, e.day, e.periodIndex, e.teacherId, e.roomId, e.lessonGroup].join("|"))
    .sort()
    .join(";");

const impossible = solver.solve(buildImpossibleProblem());

console.log(
  JSON.stringify({
    solverId: solver.id,
    solverBuild: solver.build,
    status: solution.status,
    placedPeriods: solution.statistics.placedPeriods,
    requiredPeriods: solution.statistics.requiredPeriods,
    hardViolations: solution.statistics.hardViolationCount,
    unplaced: solution.statistics.unplacedCount,
    signature: signature(solution),
    impossibleStatus: impossible.status,
    impossibleUnplaced: impossible.unplaced.length,
    impossibleFirstReason: impossible.unplaced[0]?.reason ?? null,
  }),
);
`,
);

// NOTE: node_modules/esbuild/bin/esbuild is a NATIVE ELF binary — executed
// directly, NOT through node.
execFileSync(esbuildPath, [
  entryFile,
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${outFile}`,
  "--log-level=error",
]);
console.log("GATE A (standalone bundle): PASS —", path.basename(outFile));

// ── Gates B/C/D/E: bare-environment execution ×2 ──────────────────────────
function bareRun() {
  // `env -i` = completely EMPTY environment: no PATH, no NODE_PATH, no
  // NODE_* variables. The only thing the process gets is the absolute node
  // binary path + the standalone bundle. If the solver depended on ANY
  // developer-runtime artifact, this run would fail.
  const result = spawnSync(process.execPath, [outFile], {
    env: {},
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) {
    console.error("FAIL: bare run exited", result.status, result.stderr);
    process.exit(1);
  }
  return JSON.parse(result.stdout.trim());
}

const run1 = bareRun();
const run2 = bareRun();

let pass = true;
function check(gate, ok, detail) {
  console.log(`GATE ${gate}: ${ok ? "PASS" : "FAIL"}${detail ? " — " + detail : ""}`);
  if (!ok) pass = false;
}

// Gate B: known-good fixture result.
check(
  "B (bare-env known-good generation)",
  run1.status === "valid" &&
    run1.placedPeriods === run1.requiredPeriods &&
    run1.placedPeriods > 0 &&
    run1.hardViolations === 0 &&
    run1.unplaced === 0,
  `status=${run1.status} placed=${run1.placedPeriods}/${run1.requiredPeriods} hard=${run1.hardViolations} unplaced=${run1.unplaced}`,
);

// Gate C: determinism (byte-identical signatures).
check(
  "C (determinism ×2 bare runs)",
  run1.signature === run2.signature && run1.signature.length > 0,
  `signature sha=${signatureHash(run1.signature)} identical=${run1.signature === run2.signature}`,
);

// Gate D: honest impossibility diagnostics.
check(
  "D (failure diagnostics)",
  run1.impossibleStatus !== "valid" &&
    run1.impossibleUnplaced > 0 &&
    typeof run1.impossibleFirstReason === "string" &&
    run1.impossibleFirstReason.length > 10,
  `impossible=${run1.impossibleStatus} unplaced=${run1.impossibleUnplaced}`,
);

// Gate E: solver build identification.
check(
  "E (solver identification)",
  run1.solverId === "ts-greedy-v1" && /^v\d+\.\d+\.\d+/.test(run1.solverBuild),
  `solver=${run1.solverId} build=${run1.solverBuild}`,
);

// ── Cleanup ───────────────────────────────────────────────────────────────
rmSync(workDir, { recursive: true, force: true });

console.log(pass ? "ALL PACKAGING SMOKE GATES: PASS" : "PACKAGING SMOKE: FAILED");
process.exit(pass ? 0 : 1);

function signatureHash(sig) {
  let h = 0;
  for (let i = 0; i < sig.length; i++) {
    h = (Math.imul(31, h) + sig.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
