#!/usr/bin/env node
/**
 * T-595 (E7A-5 / ROADMAP 6.7) — the egress measurement harness entry point.
 *
 * ONE command produces the whole artifact set under the artifacts dir
 * (default: <repo-root>/docs/recovery/egress-gates/):
 *
 *   1. egress-after.json    — the mock-seam measurement of the four
 *                             scenarios, produced by running the t-595
 *                             suite with EGRESS_ARTIFACTS_DIR set (the
 *                             suite's gates are the assertions; the JSON
 *                             is the recorded evidence).
 *   2. external-census.json — the external-dependencies query-site census
 *                             (D-17: the client portal + the Android repo
 *                             + the website repo — their queries JOIN the
 *                             audit set when the repos are provided).
 *
 * Usage:
 *   node scripts/run-egress-harness.mjs \
 *     [--artifacts-dir <dir>] \
 *     [--external <name>=<path>] [--external <name>=<path>] ...
 *
 * NO LIVE TRAFFIC: the harness drives a RECORDING fake client at the
 * Supabase seam (OPS-015/G2 live locks stand — the live-window columns
 * stay pending the owner's one-time window).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path_dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(DESKTOP_ROOT, "..");
const DEFAULT_ARTIFACTS_DIR = join(REPO_ROOT, "docs", "recovery", "egress-gates");

function path_dirname(p) {
  const parts = p.replace(/[\\/]+/g, "/").split("/");
  parts.pop();
  return parts.join("/") || ".";
}

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
let artifactsDir = DEFAULT_ARTIFACTS_DIR;
const externals = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--artifacts-dir" && argv[i + 1]) {
    artifactsDir = resolve(argv[++i]);
  } else if (argv[i] === "--external" && argv[i + 1]) {
    const [name, ...rest] = argv[++i].split("=");
    const path = rest.join("=");
    if (!name || !path) {
      console.error(`--external expects <name>=<path> (got: ${argv[i]})`);
      process.exit(2);
    }
    externals.push({ name, path: resolve(path) });
  }
}

// ------------------------------------------------- the external census

const SKIP_DIRS = new Set([
  ".git", "node_modules", "build", "dist", ".gradle", ".idea", ".next",
  "out", "target", "vendor", "Pods", "derivedData", ".DS_Store",
]);
const CODE_EXT = new Set([".kt", ".kts", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".dart", ".java"]);
const FROM_RE = /\.from\(\s*["']([A-Za-z0-9_.]+)["']/g;
const RPC_RE = /\.rpc\(\s*["']([A-Za-z0-9_]+)["']/g;

function censusRepo(root) {
  const tables = new Map();
  const rpcs = new Map();
  let files = 0;
  let codeFiles = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
        continue;
      }
      files += 1;
      const ext = name.slice(name.lastIndexOf("."));
      if (!CODE_EXT.has(ext)) continue;
      codeFiles += 1;
      let src;
      try {
        src = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      for (const m of src.matchAll(FROM_RE)) {
        tables.set(m[1], (tables.get(m[1]) ?? 0) + 1);
      }
      for (const m of src.matchAll(RPC_RE)) {
        rpcs.set(m[1], (rpcs.get(m[1]) ?? 0) + 1);
      }
    }
  };
  walk(root);
  const top = (m) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => ({ name: k, count: v }));
  return {
    root,
    filesScanned: files,
    codeFilesScanned: codeFiles,
    fromCallSites: [...tables.values()].reduce((s, n) => s + n, 0),
    rpcCallSites: [...rpcs.values()].reduce((s, n) => s + n, 0),
    distinctTables: tables.size,
    distinctRpcs: rpcs.size,
    topTables: top(tables),
    topRpcs: top(rpcs),
  };
}

// ---------------------------------------------------------------- run

mkdirSync(artifactsDir, { recursive: true });

const externalCensus = {
  task: "T-595 — the external-dependencies register census (D-17)",
  generatedAt: new Date().toISOString(),
  desktopRepo: censusRepo(DESKTOP_ROOT),
  externals: {},
  notes: [
    "portal.elimtiyaz.dz is the DEPLOYED client portal — its query surface is the elimtiyaz-website repo (the deployment target of T-614's cutover).",
    "Counts are CALL SITES (static), not runtime request counts — the audit-set membership register; the runtime measurement is the harness's own four scenarios.",
    "The Android repo was provided this session at the recorded path; re-run with --external to refresh.",
  ],
};
for (const { name, path } of externals) {
  if (!existsSync(path)) {
    console.error(`[egress-harness] external repo missing: ${name} → ${path} (skipped)`);
    continue;
  }
  externalCensus.externals[name] = censusRepo(path);
}
writeFileSync(join(artifactsDir, "external-census.json"), JSON.stringify(externalCensus, null, 2));
console.log(`[egress-harness] external census → ${join(artifactsDir, "external-census.json")}`);

console.log("[egress-harness] running the t-595 suite with EGRESS_ARTIFACTS_DIR set…");
const vitest = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vitest", "run", "src/tests/infrastructure/t-595-egress-gates.test.ts"],
  {
    cwd: DESKTOP_ROOT,
    stdio: "inherit",
    env: { ...process.env, EGRESS_ARTIFACTS_DIR: artifactsDir },
  },
);
if (vitest.status !== 0) {
  console.error(`[egress-harness] the t-595 suite FAILED (exit ${vitest.status}) — no artifact certified.`);
  process.exit(vitest.status ?? 1);
}
const afterPath = join(artifactsDir, "egress-after.json");
if (!existsSync(afterPath)) {
  console.error("[egress-harness] the suite passed but egress-after.json is missing — the artifact hook did not fire.");
  process.exit(1);
}
const after = JSON.parse(readFileSync(afterPath, "utf8"));
console.log("[egress-harness] DONE — the four gates are GREEN:");
for (const [k, v] of Object.entries(after.gates ?? {})) {
  console.log(`  ${k}: ${v}`);
}
console.log(`[egress-harness] artifacts: ${afterPath}`);
