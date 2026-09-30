/**
 * T-447 live verification — run the canonical POOLED all-categories T1/T2/T3
 * derivations over the REAL live corpus (read-only, via the Supabase data
 * gateway) and cross-check the parity invariants against the raw stored
 * facts + the Finance view model.
 *
 * Convention (§11.1 / the t-442 pattern): read-only — only GET requests;
 * the sb_secret data-gateway key is read from the
 * SUPABASE_SERVICE_ROLE_KEY environment variable (NEVER written into the
 * repo — §15.12/§15.14-14). No mutation: zero residue by construction.
 *
 * Checks (the owner's mandate, live):
 *   1. per wave (T1/T2/T3): the canonical pool === the RAW stored sums
 *      (Σ amount_due / Σ amount_paid / Σ amount_pending — to the dinar);
 *   2. the reconciliation identity per wave:
 *      due + overCoverage = paid + pending + remaining;
 *   3. the per-category view model (executive-statistics.deriveTrancheWaves
 *      — the Statistics layer) === the canonical per-category stats, on
 *      the LIVE rows (the Finance view-model parity is pinned OFFLINE by
 *      t-447-pooled-waves + t-447-rendering-engine-parity — the feature
 *      .tsx carries the UI import chain and is not loadable in bare node);
 *   4. the pooled family counts are SET UNIONS (≤ the Σ of per-category
 *      family counts — never double-counted);
 *   5. every category present in the wave rows appears in the pooled
 *      perCategory (no silent exclusion — the all-categories mandate);
 *   6. the non-wave summary (FI / tranche 0, unnumbered, out-of-range)
 *      covers exactly the rows the waves exclude — waves + non-wave
 *      partition the corpus (every row counted exactly once);
 *   7. Σ (waves + non-wave) remaining === the raw INV-4 outstanding
 *      (every dinar accounted for exactly once).
 *
 * Run:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/t-447-live-verify.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "https://vebfehrpzajhstyhinnw.supabase.co/rest/v1";
if (!KEY) {
  console.error("FAIL: SUPABASE_SERVICE_ROLE_KEY is not set (fail-closed).");
  process.exit(1);
}
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function get(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Fetch ALL rows of a table (PostgREST pages at 1000). */
async function getAll(table, select, order) {
  const out = [];
  let from = 0;
  for (;;) {
    const rows = await get(
      `${table}?select=${select}&order=${order}&limit=1000&offset=${from}`,
    );
    out.push(...rows);
    if (rows.length < 1000) return out;
    from += 1000;
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ── 1. The live corpus (the whole tenant — the wave analysis' basis) ── */

const installments = await getAll(
  "installments",
  "id,parent_id,student_id,category,tranche_number,label,amount_due,amount_paid,amount_pending,due_date,paid_date,status",
  "id",
);

console.log(
  `\nCorpus: ${installments.length} installments (the whole tenant — the wave analysis' basis)\n`,
);

/** Map a live snake_case row into the engine's camelCase input shape. */
function toEngineInstallment(i) {
  return {
    id: i.id,
    parentId: i.parent_id,
    studentId: i.student_id,
    category: i.category,
    label: i.label,
    trancheNumber: i.tranche_number ?? undefined,
    amountDue: Number(i.amount_due),
    amountPaid: Number(i.amount_paid),
    amountPending: Number(i.amount_pending),
    dueDate: i.due_date,
    paidDate: i.paid_date,
    status: i.status,
  };
}

const engineRows = installments.map(toEngineInstallment);

/* ── 2. Run the canonical derivations over the live rows (tsx loads the TS) ── */

const payloadPath = "/tmp/t447-payload.json";
const outputPath = "/tmp/t447-output.json";
writeFileSync(payloadPath, JSON.stringify({ installments: engineRows, nowEpochMs: Date.now() }));
execSync(
  `T447_PAYLOAD=${payloadPath} T447_OUTPUT=${outputPath} npx tsx -e '(async () => {` +
    'const m = await import("./src/domain/calc/payment/tranche-waves.ts");' +
    'const stats = await import("./src/features/dashboard/components/analytics/executive-statistics.ts");' +
    'const fs = await import("node:fs");' +
    'const input = JSON.parse(fs.readFileSync(process.env.T447_PAYLOAD, "utf8"));' +
    'const out = {' +
    "  stats: m.deriveTrancheWaveStats(input.installments, input.nowEpochMs)," +
    "  pooled: m.derivePooledTrancheWaves(input.installments, input.nowEpochMs)," +
    "  nonWave: m.deriveNonWaveSummary(input.installments, input.nowEpochMs)," +
    "  statisticsWaves: stats.deriveTrancheWaves(input.installments, input.nowEpochMs)," +
    "};" +
    "fs.writeFileSync(process.env.T447_OUTPUT, JSON.stringify(out));" +
    "})()'",
  { cwd: process.cwd(), env: process.env, stdio: "pipe", timeout: 180000 },
);
const { pooled, nonWave, statisticsWaves } = JSON.parse(readFileSync(outputPath, "utf8"));

const WAVE_ROW = (i) => i.trancheNumber === 1 || i.trancheNumber === 2 || i.trancheNumber === 3;

/* ── 3. The cross-checks: the canonical pool vs the RAW stored facts ── */

for (const w of pooled) {
  const rows = engineRows.filter((i) => i.trancheNumber === w.wave);
  const rawDue = rows.reduce((s, i) => s + i.amountDue, 0);
  const rawPaid = rows.reduce((s, i) => s + i.amountPaid, 0);
  const rawPending = rows.reduce((s, i) => s + i.amountPending, 0);
  check(
    `T${w.wave}: the canonical pool's dueTotal === Σ raw amount_due`,
    Math.abs(w.dueTotal - rawDue) < 0.01,
    `engine ${w.dueTotal} vs raw ${rawDue}`,
  );
  check(
    `T${w.wave}: paidTotal === Σ raw amount_paid`,
    Math.abs(w.paidTotal - rawPaid) < 0.01,
    `engine ${w.paidTotal} vs raw ${rawPaid}`,
  );
  check(
    `T${w.wave}: pendingTotal === Σ raw amount_pending`,
    Math.abs(w.pendingTotal - rawPending) < 0.01,
    `engine ${w.pendingTotal} vs raw ${rawPending}`,
  );
  check(
    `T${w.wave}: the reconciliation identity holds exactly (due + overCoverage = paid + pending + remaining)`,
    Math.abs(w.dueTotal + w.overCoverageTotal - (w.paidTotal + w.pendingTotal + w.remainingTotal)) < 0.01,
    `${w.dueTotal} + ${w.overCoverageTotal} = ${w.paidTotal} + ${w.pendingTotal} + ${w.remainingTotal}`,
  );
}

/* ── 4. The Statistics view-model layer over the LIVE rows (the pure
        presentation mapper — the .tsx Finance layer's parity is pinned
        offline; this proves the per-category view model agrees with the
        canonical stats on the real corpus) ── */

for (const w of pooled) {
  for (const c of w.perCategory) {
    const sw = statisticsWaves.find(
      (s) => s.category === c.category && s.wave === c.wave,
    );
    check(
      `T${w.wave}/${c.category}: the Statistics view model === the canonical stats (live)`,
      sw &&
        Math.abs(sw.dueTotal - c.dueTotal) < 0.01 &&
        Math.abs(sw.paidTotal - c.paidTotal) < 0.01 &&
        Math.abs(sw.remainingTotal - c.remainingTotal) < 0.01,
      `view ${sw?.dueTotal}/${sw?.paidTotal}/${sw?.remainingTotal} vs canonical ${c.dueTotal}/${c.paidTotal}/${c.remainingTotal}`,
    );
  }
}

/* ── 5. The family-count unions (no double-count) ── */

for (const w of pooled) {
  const sumOfCounts = w.perCategory.reduce((s, c) => s + c.familyCount, 0);
  check(
    `T${w.wave}: the pooled family count is a SET UNION (≤ Σ per-category family counts — never double-counted)`,
    w.familyCount <= sumOfCounts && w.familyCount > 0,
    `union ${w.familyCount} vs Σ per-category ${sumOfCounts}`,
  );
}

/* ── 6. The all-categories coverage (no silent exclusion) ── */

const waveRows = engineRows.filter(WAVE_ROW);
const categoriesInWaves = new Set(waveRows.map((i) => i.category));
const categoriesInPools = new Set();
for (const w of pooled) for (const c of w.perCategory) categoriesInPools.add(c.category);
check(
  "every category present in the wave rows appears in the pooled breakdown (no silent exclusion)",
  categoriesInWaves.size === categoriesInPools.size &&
    [...categoriesInWaves].every((c) => categoriesInPools.has(c)),
  `${categoriesInPools.size} categories: ${[...categoriesInPools].sort().join(", ")}`,
);

/* ── 7. The non-wave partition + the every-dinar accounting ── */

const nonWaveRows = engineRows.filter((i) => !WAVE_ROW(i));
const coveredByNonWave = nonWave.reduce((s, g) => s + g.installmentCount, 0);
check(
  "waves + non-wave partition the corpus exactly (every row counted once)",
  engineRows.filter(WAVE_ROW).length + coveredByNonWave === engineRows.length,
  `${engineRows.filter(WAVE_ROW).length} wave rows + ${coveredByNonWave} non-wave rows = ${engineRows.length}`,
);
const fiGroups = nonWave.filter((g) => g.kind === "fi");
const rawFiRows = nonWaveRows.filter((i) => i.trancheNumber === 0);
check(
  "the FI (tranche 0) rows are surfaced in their own group(s) — the registration fee visible",
  fiGroups.reduce((s, g) => s + g.installmentCount, 0) === rawFiRows.length,
  `${fiGroups.length} FI group(s) covering ${rawFiRows.length} rows`,
);

const inv4 = (i) => Math.max(0, i.amountDue - i.amountPaid - i.amountPending);
const rawOutstanding = engineRows.reduce((s, i) => s + inv4(i), 0);
const waveRemaining = pooled.reduce((s, w) => s + w.remainingTotal, 0);
const nonWaveRemaining = nonWave.reduce((s, g) => s + g.remainingTotal, 0);
check(
  "Σ (waves + non-wave) remaining === the raw INV-4 outstanding (every dinar accounted for exactly once)",
  Math.abs(waveRemaining + nonWaveRemaining - rawOutstanding) < 0.01,
  `${waveRemaining} + ${nonWaveRemaining} = ${rawOutstanding}`,
);

/* ── Verdict ── */

const failed = results.filter((r) => !r.ok).length;
console.log(
  `\n════════════════════════════════════════════\nT-447 LIVE VERIFICATION — ${results.length - failed}/${results.length} PASS${failed ? ` · ${failed} FAIL` : ""}\n════════════════════════════════════════════`,
);
if (failed > 0) process.exit(1);
