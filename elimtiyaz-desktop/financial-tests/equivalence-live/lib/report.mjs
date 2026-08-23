// ============================================================================
// lib/report.mjs — Result aggregation, JSON + Markdown report writer.
// ============================================================================

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function aggregateResults(layers) {
  const all = [];
  for (const l of layers) {
    for (const c of l.checks) all.push({ layer: l.id, layerName: l.name, ...c });
  }
  const pass = all.filter((c) => c.status === "PASS").length;
  const fail = all.filter((c) => c.status === "FAIL").length;
  const skip = all.filter((c) => c.status === "SKIPPED").length;
  return { total: all.length, pass, fail, skip, checks: all };
}

export function writeReports(agg, meta, outDir) {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "equivalence_live_report.json");
  const mdPath = join(outDir, "equivalence_live_report.md");

  writeFileSync(jsonPath, JSON.stringify({
    meta,
    summary: { total: agg.total, pass: agg.pass, fail: agg.fail, skip: agg.skip },
    checks: agg.checks,
  }, null, 1));

  const md = [];
  md.push("# Cross-Platform Equivalence Test Report (Live)");
  md.push("");
  md.push(`**Generated**: ${meta.generated}`);
  md.push(`**Database**: ${meta.supabaseHost} (tenant ${meta.tenantId})`);
  md.push(`**Migration state**: ${meta.migrationState}`);
  md.push(`**Verdict**: ${agg.fail === 0 ? "✅ EQUIVALENT — all executed checks passed" : "❌ MISMATCH — investigate failures below"}`);
  md.push("");
  md.push(`| Total | PASS | FAIL | SKIPPED |`);
  md.push(`|---|---|---|---|`);
  md.push(`| ${agg.total} | ${agg.pass} | ${agg.fail} | ${agg.skip} |`);
  md.push("");

  // per-layer table
  const byLayer = new Map();
  for (const c of agg.checks) {
    if (!byLayer.has(c.layer)) byLayer.set(c.layer, { name: c.layerName, p: 0, f: 0, s: 0 });
    const e = byLayer.get(c.layer);
    if (c.status === "PASS") e.p++; else if (c.status === "FAIL") e.f++; else e.s++;
  }
  md.push("## Layer results");
  md.push("");
  md.push("| Layer | Checks | PASS | FAIL | SKIPPED |");
  md.push("|---|---|---|---|---|");
  for (const [id, e] of byLayer) {
    md.push(`| ${id} | ${e.p + e.f + e.s} | ${e.p} | ${e.f} | ${e.s} |`);
  }
  md.push("");

  const failures = agg.checks.filter((c) => c.status === "FAIL");
  if (failures.length) {
    md.push("## Failures");
    md.push("");
    for (const f of failures) {
      md.push(`### [${f.layer}] ${f.check}`);
      md.push("");
      if (f.detail) md.push("```");
      if (f.detail) md.push(String(f.detail).slice(0, 800));
      if (f.detail) md.push("```");
      md.push("");
    }
  }

  const skipped = agg.checks.filter((c) => c.status === "SKIPPED");
  if (skipped.length) {
    md.push("## Skipped (with reasons)");
    md.push("");
    for (const s of skipped) {
      md.push(`- **[${s.layer}] ${s.check}** — ${s.detail}`);
    }
    md.push("");
  }

  writeFileSync(mdPath, md.join("\n"));
  return { jsonPath, mdPath };
}
