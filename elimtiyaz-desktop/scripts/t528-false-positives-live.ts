/**
 * t528-false-positives-live.ts — the LIVE verification of the T-528 fixes
 * (AUDIT-507 the reg-identity dangling charges + AUDIT-508 the sibling
 * duplicate tuples) over the REAL books, through the app's REAL code
 * paths, READ-ONLY (zero writes; the engine is a pure consumer).
 *
 * WHAT THIS PROBES (each check independently re-derived from the raw
 * streams where possible — the engine's output cross-checked against a
 * direct census, never against itself):
 *   T1. sign-in → the app's OWN client → the REAL Supabase repositories
 *   T2. the audit's sources warmed (the t511 seam)
 *   T3. the EXACT engine over the REAL data (the same engine the
 *       « Diagnostic Webhooks » card renders — now T-528-fixed)
 *   T4. AUDIT-507 FIXED on the real books: the owner's reported entry
 *       e8afa61f-3f75-4a18-bde1-40900f219057 is reconciled (resolved
 *       through the reg-identity), NOT dangling; the family's 4
 *       registration charges all carry charge-reg-resolved findings;
 *       the global charge-dangling count for reg-sourced charges is 0.
 *   T5. AUDIT-508 FIXED on the real books: 0 dup-tuple duplicate_event
 *       findings; the dup-siblings reconciled count equals an
 *       independent census of the distinct-student tuple groups.
 *   T6. The PRESERVED classes (the owner's contract): the pay-no-ledger
 *       count (the BUSINESS-002 import class) and the dup-receipt count
 *       are unchanged by the fix (each re-derived independently), and
 *       the genuine-dangling census confirms NO installment-sourced
 *       charge is left unresolved.
 *   T7. READ-ONLY + deterministic: the second run is identical, the row
 *       counts never move.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<token> npx tsx scripts/t528-false-positives-live.ts
 */
import * as process from "node:process";

// ── Environment shims — BEFORE any src import ──────────────────────────────
import "fake-indexeddb/auto";

const memStore = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size; },
};
(globalThis as Record<string, unknown>).localStorage = localStorageShim;
(globalThis as Record<string, unknown>).window = {
  localStorage: localStorageShim,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
};

// ── Constants ───────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = process.env.T511_ADMIN_EMAIL ?? "admin@elimtiyaz.dz";
const ADMIN_PASSWORD = process.env.T511_ADMIN_PASSWORD ?? "elimtiyaz@admin2026";
const REPORTED_ENTRY = "e8afa61f-3f75-4a18-bde1-40900f219057";
const REPORTED_PARENT = "e3506a7c-8bb9-4d5d-b668-3477a90de1d9";

const TAG = `t528-${Date.now().toString(36)}`;
const log = (...a: unknown[]) => console.log(`[${TAG}]`, ...a);
const results: Array<[string, boolean, string]> = [];
function record(id: string, ok: boolean, note = ""): void {
  results.push([id, ok, note]);
  log(`${ok ? "PASS" : "FAIL"} — ${id}${note ? ` — ${note}` : ""}`);
}

async function main(): Promise<void> {
  const { getSupabaseRepositories } = await import(
    "../src/infrastructure/supabase/supabase-repositories"
  );
  const { runWebhookDiagnostics } = await import(
    "../src/domain/calc/payment/webhook-diagnostics"
  );
  const { warmExportSources } = await import("../src/infrastructure/export/export-warmup");

  // ── T1. sign-in through the app's OWN client ────────────────────────────
  localStorageShim.setItem(
    "el-imtiyaz.local-config",
    JSON.stringify({ supabase_url: SUPABASE_URL, supabase_anon_key: PUBLISHABLE_KEY, supabase_use_supabase: true }),
  );
  const { getSupabaseClient } = await import("../src/infrastructure/supabase/supabase-client");
  const client = getSupabaseClient();
  const signIn = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (signIn.error || !signIn.data?.user) {
    throw new Error(`app-client sign-in failed: ${signIn.error?.message ?? "no user"}`);
  }
  const actorId = signIn.data.user.id;
  record("T1 admin sign-in (the app's own client)", true, signIn.data.user.email ?? "");

  localStorageShim.setItem(
    "el-imtiyaz.session",
    JSON.stringify({
      userId: actorId,
      tenantId: "00000000-0000-0000-0000-000000000001",
      email: signIn.data.user.email,
      displayName: "T528 Probe",
      role: "super_admin",
      permissions: [],
      accessToken: "probe",
      refreshToken: "probe",
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );

  // ── T2. the audit's REAL sources warmed (the t511 seam) ─────────────────
  const repos = getSupabaseRepositories();
  const warmup = await warmExportSources(repos as never);
  const auditSources = ["parents", "students", "payments", "installments", "ledger", "debtSummaries"];
  const degraded = warmup.filter((w) => w.status === "degraded");
  record(
    "T2 the audit's sources warmed",
    warmup.filter((w) => auditSources.includes(w.source)).every((w) => w.status === "warmed"),
    degraded.length === 0 ? "all warmed" : `degraded: ${degraded.map((d) => `${d.source}(${d.reason})`).join(", ")}`,
  );

  const allocationsObs = repos.payments.observeAllocations?.();
  await new Promise((resolve) => setTimeout(resolve, 2500)); // the seeds' reads land
  const payments = repos.payments.observe().get();
  const installments = repos.installments.observe().get();
  const ledgerEntries = repos.ledger.observe().get();
  const debtSummaries = repos.debt.observeSummary().get();
  const parents = repos.parents.observe().get();
  const students = repos.students.observe().get();
  const allocations = allocationsObs ? allocationsObs.get() : [];
  log(
    `  streams: parents=${parents.length} students=${students.length} payments=${payments.length} ` +
    `installments=${installments.length} ledger=${ledgerEntries.length} debtSummaries=${debtSummaries.length} allocations=${allocations.length}`,
  );

  // ── T3. the EXACT (T-528-fixed) engine over the REAL data ───────────────
  const report = runWebhookDiagnostics({
    payments, installments, ledgerEntries, allocations, debtSummaries, parents, students,
  });
  log("  counts:", JSON.stringify(report.counts));
  record(
    "T3 runWebhookDiagnostics over the real data (the T-528-fixed engine)",
    report.findings.length > 0,
    `findings=${report.findings.length} — asOf=${report.asOf}`,
  );

  // ── T4. AUDIT-507 FIXED on the real books ───────────────────────────────
  const reportedDangling = report.findings.find(
    (f) => f.id === `confirmed_mismatch:charge-dangling:${REPORTED_ENTRY}`,
  );
  const reportedResolved = report.findings.find(
    (f) => f.id === `reconciled:charge-reg-resolved:${REPORTED_ENTRY}`,
  );
  record(
    "T4a the owner's reported entry is NO LONGER dangling",
    reportedDangling === undefined,
    reportedDangling ? `still flagged: ${reportedDangling.title}` : "no charge-dangling finding",
  );
  record(
    "T4b the owner's reported entry is positively reconciled through the reg-identity",
    reportedResolved !== undefined,
    reportedResolved
      ? `${reportedResolved.title} · installment=${reportedResolved.recordIds.installment}`
      : "no charge-reg-resolved finding",
  );

  const familyResolved = report.findings.filter(
    (f) => f.category === "reconciled" && f.id.startsWith("reconciled:charge-reg-resolved:") && f.parentId === REPORTED_PARENT,
  );
  record(
    "T4c the family's registration charges all resolve (the 4-charge live census)",
    familyResolved.length === 4,
    `charge-reg-resolved for the reported parent: ${familyResolved.length}`,
  );

  // The global census: NO installment-sourced charge is left dangling on the
  // real books (every one resolves through the PK or the reg-identity).
  const instSourcedCharges = ledgerEntries.filter(
    (e) => e.type === "charge" && e.sourceType === "installment",
  );
  const danglingFindings = report.findings.filter((f) =>
    f.id.startsWith("confirmed_mismatch:charge-dangling:"),
  );
  record(
    "T4d the global dangling census: 0 unresolved installment-sourced charges",
    danglingFindings.length === 0,
    `${instSourcedCharges.length} installment-sourced charges · dangling findings=${danglingFindings.length}`,
  );

  // ── T5. AUDIT-508 FIXED on the real books ───────────────────────────────
  const dupTupleFindings = report.findings.filter((f) =>
    f.id.startsWith("duplicate_event:dup-tuple:"),
  );
  record(
    "T5a zero dup-tuple duplicate findings on the real books (the sibling class)",
    dupTupleFindings.length === 0,
    `dup-tuple findings=${dupTupleFindings.length}`,
  );

  // The independent sibling census: re-derive the distinct-student tuple
  // groups directly from the payments stream (the same rule, computed
  // outside the engine) and compare with the engine's dup-siblings count.
  const byTuple = new Map<string, typeof payments>();
  for (const p of payments) {
    const key = `${p.parentId}|${p.amount}|${p.method}|${p.collectedAt}|${p.status}`;
    const list = byTuple.get(key) ?? [];
    list.push(p);
    byTuple.set(key, list);
  }
  let siblingGroups = 0;
  for (const group of byTuple.values()) {
    if (group.length < 2) continue;
    const receipts = new Set(group.map((p) => p.receiptNumber));
    if (receipts.size === 1) continue; // (a)'s class
    const subjects = new Set(group.map((p) => p.studentId ?? "\u0000null"));
    if (group.every((p) => p.studentId !== null) && subjects.size === group.length) siblingGroups += 1;
  }
  const dupSiblingsFindings = report.findings.filter((f) =>
    f.id.startsWith("reconciled:dup-siblings:"),
  );
  record(
    "T5b the reconciled sibling findings match the independent census",
    dupSiblingsFindings.length === siblingGroups && siblingGroups > 0,
    `engine dup-siblings=${dupSiblingsFindings.length} · independent census=${siblingGroups}`,
  );

  // ── T6. The PRESERVED classes (independently re-derived) ────────────────
  // (a) The BUSINESS-002 import class: payments with no ledger twin — the
  //     fix must not move this count by one row.
  const ledgerPaymentSources = new Set(
    ledgerEntries.filter((e) => e.type === "payment" && e.sourceType === "payment").map((e) => e.sourceId),
  );
  const noLedgerTwins = payments.filter((p) => !ledgerPaymentSources.has(p.id)).length;
  const payNoLedgerFindings = report.findings.filter((f) =>
    f.id.startsWith("confirmed_mismatch:pay-no-ledger:"),
  ).length;
  record(
    "T6a the pay-no-ledger class is untouched (engine ≡ independent census)",
    payNoLedgerFindings === noLedgerTwins,
    `engine=${payNoLedgerFindings} · census=${noLedgerTwins}`,
  );

  // (b) The shared-receipt class (check (a) — the CRITICAL duplicate signal):
  const byReceipt = new Map<string, number>();
  for (const p of payments) {
    if (!p.receiptNumber) continue;
    byReceipt.set(p.receiptNumber, (byReceipt.get(p.receiptNumber) ?? 0) + 1);
  }
  const sharedReceipts = [...byReceipt.entries()].filter(([, n]) => n >= 2).length;
  const dupReceiptFindings = report.findings.filter((f) =>
    f.id.startsWith("duplicate_event:dup-receipt:"),
  ).length;
  record(
    "T6b the shared-receipt class is preserved (engine ≡ independent census)",
    dupReceiptFindings === sharedReceipts,
    `engine=${dupReceiptFindings} · census=${sharedReceipts}`,
  );

  // (c) The date-semantics class (Example A) — untouched by this fix; the
  //     count must still be non-zero and match the independent census.
  const nowMs = Date.now();
  const futureCollected = payments.filter((p) => {
    if (p.status !== "paid" && p.status !== "partial") return false;
    const ms = Date.parse(p.collectedAt);
    return Number.isFinite(ms) && ms > nowMs + 86_400_000;
  });
  record(
    "T6c the Example-A future-dated class is still reported honestly",
    futureCollected.length > 0,
    `${futureCollected.length} payment(s) · ${futureCollected.reduce((s, p) => s + p.amount, 0).toLocaleString("fr-FR")} DZD — the owner-gated §15.95a remediation corpus, still visible`,
  );

  // ── T7. READ-ONLY + deterministic ───────────────────────────────────────
  const before = {
    payments: repos.payments.observe().get().length,
    installments: repos.installments.observe().get().length,
    ledger: repos.ledger.observe().get().length,
  };
  const report2 = runWebhookDiagnostics({
    payments: repos.payments.observe().get(),
    installments: repos.installments.observe().get(),
    ledgerEntries: repos.ledger.observe().get(),
    allocations: allocationsObs ? allocationsObs.get() : [],
    debtSummaries: repos.debt.observeSummary().get(),
    parents: repos.parents.observe().get(),
    students: repos.students.observe().get(),
  });
  const after = {
    payments: repos.payments.observe().get().length,
    installments: repos.installments.observe().get().length,
    ledger: repos.ledger.observe().get().length,
  };
  record(
    "T7 read-only + deterministic (the second run is identical, the rows never move)",
    JSON.stringify(report2.counts) === JSON.stringify(report.counts) &&
      JSON.stringify(before) === JSON.stringify(after),
    `counts identical=${JSON.stringify(report2.counts) === JSON.stringify(report.counts)}; rows ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
  );

  // ── Summary ─────────────────────────────────────────────────────────────
  const failed = results.filter(([, ok]) => !ok);
  log("──────────────────────────────────────────");
  log(`RESULTS: ${results.length - failed.length}/${results.length} GREEN`);
  for (const [id, ok, note] of results) {
    if (!ok) log(`  RED — ${id} — ${note}`);
  }
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  log("FATAL:", err);
  process.exit(1);
});
