#!/usr/bin/env node
// ============================================================================
// run.mjs — Cross-platform equivalence suite orchestrator (live database).
// ----------------------------------------------------------------------------
// Executes the canonical scenario through BOTH client adapters (Desktop &
// Mobile API-call patterns encoded from the real source code), then runs the
// 11-layer verification pipeline over the resulting state.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node run.mjs
//   EQUIVALENCE_DRY_RUN=1 node run.mjs          # no writes
//   node run.mjs --layers 01,04,08              # subset
//   node run.mjs --out /path/to/report/dir      # default ./report
//
// Safety:
//   - Test entities are tagged (EQTEST codes) and cleaned up after the run.
//   - The real corpus is snapshotted before/after and asserted untouched.
//   - All credentials come from environment variables only.
// ============================================================================

import { assertEnv, env } from "./lib/env.mjs";
import { probeCapabilities } from "./lib/probe.mjs";
import { executeCanonicalScenario } from "./lib/executor.mjs";
import { cleanupAll, realCorpusSnapshot, assertNoRealDataTouched } from "./lib/scope.mjs";
import { aggregateResults, writeReports } from "./lib/report.mjs";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const layerFilter = (() => {
  const i = args.indexOf("--layers");
  return i >= 0 ? args[i + 1]?.split(",").map((s) => s.trim()) : null;
})();
const outDir = (() => {
  const i = args.indexOf("--out");
  return i >= 0 ? args[i + 1] : join(here, "report");
})();
const iterations = (() => {
  const i = args.indexOf("--iterations");
  return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 1) : 1;
})();

async function main() {
  assertEnv();
  console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│  EL-IMTIYAZ CROSS-PLATFORM EQUIVALENCE SUITE (LIVE)        │`);
  console.log(`└─────────────────────────────────────────────────────────────┘\n`);
  console.log(`target : ${env.supabaseUrl}`);
  console.log(`tenant : ${env.tenantId}`);
  console.log(`dry-run: ${env.dryRun}\n`);

  // 1. capability probe
  const probe = await probeCapabilities();
  console.log(`migration state: ${probe.migrationState}`);
  console.log(`canonical RPCs : collect_and_allocate_payment=${probe.has.collect_and_allocate_payment} compute_parent_summary=${probe.has.compute_parent_summary} upsert_installment_from_import=${probe.has.upsert_installment_from_import}\n`);

  // 2. clean any stale EQTEST rows from previous runs
  if (!env.dryRun) {
    const cleaned = await cleanupAll();
    console.log("stale EQTEST rows cleaned:", JSON.stringify(cleaned).slice(0, 200));
  }

  // 3. snapshot the real corpus
  const corpusBefore = await realCorpusSnapshot();
  console.log(`real corpus snapshot: parents=${corpusBefore.parents} students=${corpusBefore.students} ledger_total=${corpusBefore.ledger_total} payments_total=${corpusBefore.payments_total}\n`);

  // 4. execute canonical scenarios (both clients, isolated scopes)
  const executions = [];
  if (!env.dryRun) {
    for (let i = 1; i <= iterations; i++) {
      console.log(`── executing canonical scenario ${i}/${iterations} through both clients …`);
      const exec = await executeCanonicalScenario({ probe, index: i });
      executions.push(exec);
      const traceOk = (s) => exec.traces[s].filter((t) => !t.ok && !t.detail?.startsWith("SKIPPED")).length;
      console.log(`   scope D: ${traceOk("D")} failed steps | scope M: ${traceOk("M")} failed steps`);
    }
  }

  // 5. run layers
  const layerModules = [
    "./layers/01_ui_input.mjs",
    "./layers/02_validation.mjs",
    "./layers/03_business_logic.mjs",
    "./layers/04_financial.mjs",
    "./layers/05_academic.mjs",
    "./layers/06_crm.mjs",
    "./layers/07_api.mjs",
    "./layers/08_database.mjs",
    "./layers/09_audit.mjs",
    "./layers/10_document.mjs",
    "./layers/11_sync.mjs",
  ];

  const layers = [];
  for (const mod of layerModules) {
    const layer = (await import(mod)).default;
    if (layerFilter && !layerFilter.some((f) => layer.id.startsWith(f))) continue;
    if (env.dryRun && !layer.requires?.length === false && layer.requires?.includes("execution")) {
      layers.push({ id: layer.id, name: layer.name, checks: [{ check: "layer", status: "SKIPPED", detail: "dry-run mode" }] });
      continue;
    }
    process.stdout.write(`  layer ${layer.id} … `);
    const ctx = { probe, execution: executions[executions.length - 1], executions, dryRun: env.dryRun };
    let checks;
    try {
      checks = (await layer.run(ctx)) || [];
    } catch (e) {
      checks = [{ check: "layer executed", status: "FAIL", detail: String(e?.stack || e).slice(0, 400) }];
    }
    const p = checks.filter((c) => c.status === "PASS").length;
    const f = checks.filter((c) => c.status === "FAIL").length;
    const s = checks.filter((c) => c.status === "SKIPPED").length;
    console.log(`${p} pass / ${f} fail / ${s} skipped`);
    layers.push({ id: layer.id, name: layer.name, checks });
  }

  // 6. cleanup EQTEST scope + verify real corpus untouched
  if (!env.dryRun) {
    await cleanupAll();
    const guard = await assertNoRealDataTouched(corpusBefore);
    layers.push({
      id: "12-guard",
      name: "Test isolation guard — real corpus untouched",
      checks: [{
        check: "real corpus invariant (parents/students/ledger/payments unchanged)",
        status: guard.ok ? "PASS" : "FAIL",
        detail: guard.ok ? "" : guard.issues.join("; "),
      }],
    });
  }

  // 7. aggregate + write reports
  const agg = aggregateResults(layers);
  const meta = {
    generated: new Date().toISOString(),
    supabaseHost: env.supabaseUrl.replace(/^https:\/\//, ""),
    tenantId: env.tenantId,
    migrationState: probe.migrationState,
    iterations,
  };
  const paths = writeReports(agg, meta, outDir);

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`RESULT: ${agg.pass}/${agg.total} PASS | ${agg.fail} FAIL | ${agg.skip} SKIPPED`);
  console.log(`verdict: ${agg.fail === 0 ? "CLIENTS ARE EQUIVALENT (on executed checks)" : "MISMATCH — investigate"}`);
  console.log(`reports: ${paths.mdPath}`);
  console.log(`         ${paths.jsonPath}\n`);

  process.exitCode = agg.fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("SUITE ERROR:", e);
  process.exitCode = 2;
});
