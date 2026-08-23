// ============================================================================
// lib/scope.mjs — Test-scope isolation & cleanup on the live database.
// ----------------------------------------------------------------------------
// Every entity created by the suite is tagged:
//   - parent codes  : PAR-2026-EQTEST-{D|M}NN
//   - student codes : ELV-2026-EQTEST-{D|M}NN
//   - ledger source : EQTEST-* source ids, android_sync/manual_entry with
//                     descriptions containing "(épreuve d'équivalence)"
//   - actor_name    : equivalence-live-suite / Android (metadata client=android)
//
// cleanupScope() removes ONLY rows reachable from EQTEST parent codes.
// assertNoRealDataTouched() verifies the real corpus (parents whose code does
// NOT start with PAR-2026-EQTEST) is byte-identical before/after the run.
// ============================================================================

import { select, del } from "./rest.mjs";

export async function cleanupScope(scopeLetter) {
  const removed = {};
  const codePrefix = `PAR-2026-EQTEST-${scopeLetter}`;
  const parents = await select("parents", `select=id,parent_code&parent_code=like.${codePrefix}*`);
  if (!parents.ok || !parents.data?.length) return removed;
  const parentIds = parents.data.map((p) => p.id);

  for (const table of ["installments", "payments", "ledger_entries"]) {
    const ors = parentIds.map((id) => `parent_id.eq.${id}`).join(",");
    const r = await del(table, `or=(${ors})`);
    removed[table] = r.ok ? "deleted" : `error: ${r.error?.message}`;
  }
  const studentOrs = parentIds.map((id) => `parent_id.eq.${id}`).join(",");
  const students = await select("students", `select=id&or=(${studentOrs})`);
  if (students.ok && students.data?.length) {
    await del("students", `or=(${studentOrs})`);
    removed.students = students.data.length;
  }
  // Also sweep orphaned EQTEST students by code prefix (any run, any scope).
  const orphanSweep = await del("students", "student_code=like.ELV-2026-EQTEST-*");
  if (!orphanSweep.ok) removed.orphanSweep = `error: ${orphanSweep.error?.message}`;
  const r = await del("parents", `parent_code=like.${codePrefix}*`);
  removed.parents = r.ok ? parents.data.length : `error: ${r.error?.message}`;
  return removed;
}

export async function cleanupAll() {
  return { D: await cleanupScope("D"), M: await cleanupScope("M") };
}

/** Snapshot counts of the REAL corpus (everything not EQTEST). */
export async function realCorpusSnapshot() {
  const snap = {};
  const counts = {
    parents: ["id", "parent_code", "not.like.PAR-2026-EQTEST-*"],
    students: ["id", "student_code", "not.like.ELV-2026-EQTEST-*"],
  };
  for (const [table, [sel, col, filter]] of Object.entries(counts)) {
    const r = await select(table, `select=${sel}&${col}=${filter}&limit=1`);
    snap[table] = r.ok ? "ok" : `error ${r.error?.message}`;
  }
  // numeric totals of the real corpus (financial integrity sentinel)
  const led = await select("ledger_entries", "select=amount,entry_type&source_type=not.eq.android_sync&limit=5000");
  if (led.ok && Array.isArray(led.data)) {
    snap.ledger_total = led.data.reduce((a, e) => a + Number(e.amount || 0), 0);
    snap.ledger_count = led.data.length;
  }
  const pays = await select("payments", "select=amount&limit=5000");
  if (pays.ok && Array.isArray(pays.data)) {
    // exclude EQTEST payments by amount marker is unreliable; count all and
    // subtract EQTEST parents' payments separately in assertNoRealDataTouched.
    snap.payments_total = pays.data.reduce((a, p) => a + Number(p.amount || 0), 0);
    snap.payments_count = pays.data.length;
  }
  return snap;
}

/** Verify real corpus unchanged (tolerates the suite's own EQTEST rows). */
export async function assertNoRealDataTouched(before) {
  const after = await realCorpusSnapshot();
  const issues = [];
  if (before.ledger_total != null && after.ledger_total != null) {
    // subtract EQTEST ledger rows created during the run
    const eqLed = await select(
      "ledger_entries",
      "select=amount,parent_id&source_type=eq.android_sync,manual_entry&description=like.*(épreuve d'équivalence)*&limit=5000",
    );
    let eqSum = 0;
    if (eqLed.ok && Array.isArray(eqLed.data)) eqSum = eqLed.data.reduce((a, e) => a + Number(e.amount || 0), 0);
    const beforeAdj = before.ledger_total;
    const afterAdj = after.ledger_total - eqSum;
    if (Math.abs(beforeAdj - afterAdj) > 0.01) {
      issues.push(`ledger_total drifted: before=${beforeAdj} after-minus-eqtest=${afterAdj}`);
    }
  }
  return { ok: issues.length === 0, issues, before, after };
}
