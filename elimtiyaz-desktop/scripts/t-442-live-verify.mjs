/**
 * T-442 live verification — run the CANONICAL year-history engine over a
 * REAL live family's rows (read-only, via the Supabase data gateway) and
 * cross-check the new per-year derivations against the raw stored facts.
 *
 * Convention: this is the read-only live-evidence leg of T-442 (the engine
 * + UI task needs no migration; the §13 live-verification bar is met by
 * proving the engine's numbers on the REAL corpus). No mutation: only
 * GET requests. The sb_secret data-gateway key is read from the
 * SUPABASE_SERVICE_ROLE_KEY environment variable (NEVER written into the
 * repo — §15.12/§15.14-14).
 *
 * Run:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/t-442-live-verify.mjs
 */
import { execSync } from "node:child_process";

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

/* ── 1. The live corpus census (the engine's honest-basis inputs) ───── */

const installments = await getAll(
  "installments",
  "id,parent_id,student_id,category,tranche_number,label,amount_due,amount_paid,amount_pending,due_date,paid_date,status,academic_year_id",
  "due_date",
);
const payments = await getAll(
  "payments",
  "id,parent_id,amount,method,status,category,collected_at,receipt_number,academic_year_id",
  "collected_at",
);
const allocations = await get("payment_allocations?select=id,payment_id,installment_id,category,allocated_amount,label,created_at,academic_year_id&limit=1000");
const ledger = await getAll(
  "ledger_entries",
  "id,parent_id,entry_type,amount,category,source_type,source_id,method,receipt_number,payment_status,reverses_id,at,metadata",
  "at",
);
const years = await get("academic_years?select=id,code,start_date,end_date");

console.log(`\nCorpus: ${installments.length} installments · ${payments.length} payments · ${allocations.length} allocations · ${ledger.length} ledger entries · ${years.length} academic years\n`);

/* ── 2. Pick the family with the most charges (the richest record) ──── */

const byParent = new Map();
for (const i of installments) {
  byParent.set(i.parent_id, (byParent.get(i.parent_id) ?? 0) + 1);
}
const [richestParent, richestCount] = [...byParent.entries()].sort((a, b) => b[1] - a[1])[0];
check(
  "the richest live family carries a multi-service charge set (FI/T0 + tuition tranches + transport)",
  richestCount >= 5,
  `parent ${richestParent} with ${richestCount} installments`,
);

// A second family with PARTIAL payments (amount_paid > 0 on some row).
const partialParent = installments.find(
  (i) => i.parent_id !== richestParent && i.amount_paid > 0 && i.amount_due > i.amount_paid,
)?.parent_id;
const families = partialParent ? [richestParent, partialParent] : [richestParent];

/* ── 3. Run the canonical engine over the live rows (tsx loads the TS) ── */

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
    academicYearId: i.academic_year_id,
  };
}
function toEnginePayment(p) {
  return {
    id: p.id,
    tenantId: "t",
    receiptNumber: p.receipt_number,
    parentId: p.parent_id,
    studentId: null,
    amount: Number(p.amount),
    method: p.method,
    status: p.status,
    category: p.category,
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "live",
    collectedAt: p.collected_at,
    createdAt: p.collected_at,
    updatedAt: p.collected_at,
    academicYearId: p.academic_year_id,
  };
}
function toEngineLedger(e) {
  return {
    id: e.id,
    tenantId: "t",
    accountId: "live",
    parentId: e.parent_id,
    studentId: null,
    category: e.category,
    amount: Number(e.amount),
    type: e.entry_type,
    sourceType: e.source_type,
    sourceId: e.source_id,
    method: e.method,
    receiptNumber: e.receipt_number,
    paymentStatus: e.payment_status,
    reversesId: e.reverses_id,
    description: "",
    actorId: "live",
    actorName: "live",
    at: e.at,
    metadata: e.metadata ?? {},
  };
}

const fs = await import("node:fs");
for (const parentId of families) {
  const payload = {
    parentId,
    installments: installments.filter((i) => i.parent_id === parentId).map(toEngineInstallment),
    payments: payments.filter((p) => p.parent_id === parentId).map(toEnginePayment),
    allocations: [], // live payment_allocations is EMPTY (documented) — the honest basis.
    ledgerEntries: ledger.filter((l) => l.parent_id === parentId).map(toEngineLedger),
    academicYears: years.map((y) => ({ id: y.id, code: y.code, startDate: y.start_date, endDate: y.end_date })),
    // NOTE: `now` is deliberately NOT serialized (JSON would turn a Date
    // into a string and break the engine's Date contract) — the engine
    // defaults to its own clock, which is exactly the live behavior.
  };
  const payloadPath = `/tmp/t442-payload-${parentId}.json`;
  const outputPath = `/tmp/t442-output-${parentId}.json`;
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  execSync(
    `T442_PAYLOAD=${payloadPath} T442_OUTPUT=${outputPath} npx tsx -e '(async () => {` +
      'const m = await import("./src/domain/calc/ledger/year-history.ts");' +
      'const fs = await import("node:fs");' +
      'const input = JSON.parse(fs.readFileSync(process.env.T442_PAYLOAD, "utf8"));' +
      'const out = m.computeParentYearHistory(input);' +
      "fs.writeFileSync(process.env.T442_OUTPUT, JSON.stringify(out, null, 2));" +
      "})()'",
    { cwd: process.cwd(), env: process.env, stdio: "pipe", timeout: 120000 },
  );
  const history = JSON.parse(fs.readFileSync(outputPath, "utf8"));

  // ── The cross-checks: engine output vs the raw stored facts ──
  const rows = payload.installments;
  const rawDue = rows.reduce((s, i) => s + i.amountDue, 0);
  const rawPaid = rows.reduce((s, i) => s + i.amountPaid, 0);
  const rawRemaining = rows.reduce(
    (s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending),
    0,
  );

  check(
    `family ${parentId.slice(0, 8)}: totalCharged === Σ stored amount_due`,
    Math.abs(history.years.reduce((s, y) => s + y.totalCharged, 0) - rawDue) < 0.01,
    `engine ${history.years.reduce((s, y) => s + y.totalCharged, 0)} vs raw ${rawDue}`,
  );
  check(
    `family ${parentId.slice(0, 8)}: totalPaidOnCharges === Σ stored amount_paid`,
    Math.abs(history.years.reduce((s, y) => s + y.totalPaidOnCharges, 0) - rawPaid) < 0.01,
    `engine ${history.years.reduce((s, y) => s + y.totalPaidOnCharges, 0)} vs raw ${rawPaid}`,
  );
  check(
    `family ${parentId.slice(0, 8)}: totalOutstandingNow === Σ INV-4 remaining (the Finance-tab number)`,
    Math.abs(history.totalOutstandingNow - rawRemaining) < 0.01,
    `engine ${history.totalOutstandingNow} vs raw ${rawRemaining}`,
  );

  // The T-442 derivations on the live rows:
  for (const y of history.years) {
    const yRows = rows.filter(
      (i) => y.academicYearId != null && i.academicYearId === y.academicYearId,
    );
    check(
      `family ${parentId.slice(0, 8)} / year ${y.academicYear}: the service breakdown PARTITIONS the year's charges`,
      y.serviceBreakdown.reduce((s, g) => s + g.chargeCount, 0) === yRows.length,
      `${y.serviceBreakdown.map((g) => `${g.key}(${g.chargeCount})`).join(" + ")} = ${yRows.length}`,
    );
    check(
      `family ${parentId.slice(0, 8)} / year ${y.academicYear}: Σ service groups' due === the year's totalCharged`,
      Math.abs(y.serviceBreakdown.reduce((s, g) => s + g.amountDue, 0) - y.totalCharged) < 0.01,
      `${y.serviceBreakdown.reduce((s, g) => s + g.amountDue, 0)} vs ${y.totalCharged}`,
    );
    check(
      `family ${parentId.slice(0, 8)} / year ${y.academicYear}: outstandingStillOwedNow === Σ INV-4 remaining over the year's charges`,
      Math.abs(
        y.outstandingStillOwedNow -
          yRows.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending), 0),
      ) < 0.01,
      `${y.outstandingStillOwedNow}`,
    );
    const anyCoverage = y.paymentsMadeInYear.some((p) => p.coverageBasis === "allocations");
    check(
      `family ${parentId.slice(0, 8)} / year ${y.academicYear}: every payment's coverage basis is the honest "unavailable" (live payment_allocations is empty)`,
      !anyCoverage,
      anyCoverage ? "unexpected allocation coverage on the live corpus" : "honest basis confirmed",
    );
  }
  check(
    `family ${parentId.slice(0, 8)}: Σ priorYearsStillOwed === priorYearOutstandingStillOwed`,
    Math.abs(
      history.priorYearsStillOwed.reduce((s, x) => s + x.outstanding, 0) -
        history.priorYearOutstandingStillOwed,
    ) < 0.01,
    `aggregate ${history.priorYearOutstandingStillOwed}`,
  );
}

/* ── Verdict ────────────────────────────────────────────────────────── */

const failed = results.filter((r) => !r.ok);
console.log(`\n=== T-442 live verification: ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length > 0) process.exit(1);
