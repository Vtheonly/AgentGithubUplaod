#!/usr/bin/env node
/**
 * ============================================================================
 * check-unbounded-reads.mjs — T-591 (E7A-2 / BUG-062/063) — the unbounded-read
 * lint guard.
 * ============================================================================
 *
 * THE RULE (the card's wording): flag any `.from()` READ chain without
 * limit/range/keyset/count context on the >1,000-row tables. The guard is a
 * documented heuristic line-window scan over the Supabase repository layer
 * (the read-path surface), with an explicit, reasoned ALLOWLIST for the
 * sanctioned sites.
 *
 * BOUNDED CONTEXT (any of these clears the chain):
 *   - `.limit(` / `.range(` — an explicit page bound
 *   - `.single(` / `.maybeSingle(` — a one-row read
 *   - `{ count: "exact", head: true }` — a count-head census (zero rows read)
 *   - `.in("id", …)` — a bounded point-lookup set (the chunked-PK pattern)
 *   - `.eq("id", …)` — a PK point lookup
 *   - `paginateKeyset` within the 3 lines BEFORE the `.from(` — the keyset
 *     walk context (the T-591 conversion shape)
 *
 * WATCHED TABLES (the live-census >1,000-row family; personnel [8 live rows]
 * and other small tables are deliberately NOT watched — add a table here
 * only with a census number in the reason):
 *   payments · installments · ledger_entries · students · parents ·
 *   attendance_records · salary_payments · er_source_observations ·
 *   er_match_proposals · er_identity_edges · er_aggregation_events ·
 *   student_documents · student_academic_histories · calendar_events ·
 *   notifications · inventory_items · inventory_transactions ·
 *   expense_tickets
 *
 * WRITE chains (insert/update/upsert/delete) are ignored — the guard is
 * about the READ family.
 *
 * USAGE:
 *   node scripts/check-unbounded-reads.mjs [--root <dir>] [--json]
 *   Exit 0 = clean (modulo the allowlist); exit 1 = violations.
 *   `--json` prints the machine-readable report (the vitest gate parses it).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf("--root");
const ROOT = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
const AS_JSON = argv.includes("--json");

const WATCHED = new Set([
  "payments", "installments", "ledger_entries", "students", "parents",
  "attendance_records", "salary_payments", "er_source_observations",
  "er_match_proposals", "er_identity_edges", "er_aggregation_events",
  "student_documents", "student_academic_histories", "calendar_events",
  "notifications", "inventory_items", "inventory_transactions",
  "expense_tickets",
]);

const REPO_DIR = join(ROOT, "src/infrastructure/supabase/repositories");
const ALLOWLIST_PATH = join(ROOT, "scripts/unbounded-reads-allowlist.json");

/**
 * The allowlist — every entry needs a REASON. Entries match
 * { file, lineStart, lineEnd?, table? } against a violation to silence it.
 */
function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).entries ?? [];
}

function listRepositoryFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isFile() && name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function isWriteChain(windowText) {
  return [".insert(", ".update(", ".upsert(", ".delete("].some((w) => windowText.includes(w));
}

function hasBoundedContext(windowText, preText) {
  if (windowText.includes(".limit(") || windowText.includes(".range(")) return true;
  if (windowText.includes(".single(") || windowText.includes(".maybeSingle(")) return true;
  if (/\{\s*count:\s*"exact"/.test(windowText)) return true;
  if (/\.in\(\s*"id"/.test(windowText)) return true;
  if (/\.eq\(\s*"id"/.test(windowText)) return true;
  if (preText.includes("paginateKeyset")) return true;
  return false;
}

function scan() {
  const allowlist = loadAllowlist();
  const violations = [];
  for (const file of listRepositoryFiles(REPO_DIR)) {
    const rel = file.slice(ROOT.length + 1);
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /\.from\("([a-z_]+)"\)/.exec(lines[i]);
      if (!m) continue;
      const table = m[1];
      if (!WATCHED.has(table)) continue;
      const windowText = lines.slice(i, Math.min(lines.length, i + 14)).join("\n");
      if (!windowText.includes(".select(")) continue; // not a READ chain
      if (isWriteChain(windowText)) continue; // write chains are not the guard's lane
      const preText = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      if (hasBoundedContext(windowText, preText)) continue;
      violations.push({ file: rel, line: i + 1, table });
    }
  }
  const active = violations.filter(
    (v) =>
      !allowlist.some(
        (a) =>
          a.file === v.file &&
          v.line >= (a.lineStart ?? a.line ?? 0) &&
          v.line <= (a.lineEnd ?? a.line ?? Number.MAX_SAFE_INTEGER) &&
          (!a.table || a.table === v.table),
      ),
  );
  return { violations, active, allowlistCount: allowlist.length };
}

const report = scan();
if (AS_JSON) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  if (report.allowlistCount > 0) {
    console.log(`allowlist: ${report.allowlistCount} reasoned entr(ies) honored`);
  }
  if (report.active.length === 0) {
    console.log(`unbounded-read guard OK: ${report.violations.length} raw site(s), ${report.allowlistCount} allowlisted, 0 active violations.`);
  } else {
    console.log(`unbounded-read guard VIOLATIONS (${report.active.length}):`);
    for (const v of report.active) {
      console.log(`  ${v.file}:${v.line}  table=${v.table}`);
    }
  }
}
process.exit(report.active.length === 0 ? 0 : 1);
