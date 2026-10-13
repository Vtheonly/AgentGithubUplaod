/**
 * t529-diagnostics-purpose-live.ts — the LIVE verification of the T-529
 * changes over the REAL books, through the app's REAL code paths,
 * READ-ONLY (zero writes; the engine is a pure consumer).
 *
 * WHAT THIS PROBES (each fixed class cross-checked against an independent
 * census re-derived from the raw streams — never the engine checking
 * itself):
 *   T1. sign-in → the app's OWN client → the REAL repositories warmed
 *       (incl. the pricing config — the new input).
 *   T2. AUDIT-510 FIXED live — the owner's exact example: the FI
 *       encaissement IMP-2a3c16a6…-FI (25,000 DZD, HAMIDI, Excel import)
 *       now carries the configured-price finding with BOTH references
 *       (flat 5,000 + per-grade), the delta, the provenance, the possible
 *       causes, and the resolution steps — vs 0 findings before T-529.
 *   T3. The CONFIG TENSION finding present (the root cause surfaced once).
 *   T4. AUDIT-509 re-verified live — the re-pasted card's entry e8afa61f
 *       still positively reconciled (the green row), 0 dangling globally.
 *   T5. The registration charge (the 5,000 « nouvelle famille ») carries
 *       the reconciled price basis row.
 *   T6. The PRESERVED classes byte-stable vs the T-528 census: pay-no-ledger
 *       ≡ the independent census · dup-tuple 0 · dup-siblings ≡ the census ·
 *       shared-receipt 0 · the Example-A corpus still visible.
 *   T7. The all-origins coverage: coverage.pricingConfig=true + the charge
 *       identity-form census ≡ the registration forensics.
 *   T8. READ-ONLY + deterministic: the re-run byte-identical, the row
 *       counts never move.
 *
 * Usage:
 *   npx tsx scripts/t529-diagnostics-purpose-live.ts
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
/** The owner's example — located by its deterministic receipt stem (IMP-…-FI). */
const FI_RECEIPT_SUFFIX = "-FI";

const TAG = `t529-${Date.now().toString(36)}`;
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

  // ── T1. sign-in through the app's OWN client + the full warm-up ────────
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
      displayName: "T529 Live Probe",
      role: "super_admin",
      permissions: [],
      accessToken: "probe",
      refreshToken: "probe",
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );

  const repos = getSupabaseRepositories();
  const warmup = await warmExportSources(repos as never);
  const allocationsObs = repos.payments.observeAllocations?.();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const payments = repos.payments.observe().get();
  const installments = repos.installments.observe().get();
  const ledgerEntries = repos.ledger.observe().get();
  const debtSummaries = repos.debt.observeSummary().get();
  const parents = repos.parents.observe().get();
  const students = repos.students.observe().get();
  const allocations = allocationsObs ? allocationsObs.get() : [];
  const pricing = repos.pricing.observe().get();
  log(
    `streams: parents=${parents.length} students=${students.length} payments=${payments.length} ` +
    `installments=${installments.length} ledger=${ledgerEntries.length} debtSummaries=${debtSummaries.length} allocations=${allocations.length} pricing=${pricing ? "loaded" : "NULL"}`,
  );
  record(
    "T1b the audit's sources warmed (incl. pricing)",
    warmup.filter((w) => ["parents", "students", "payments", "installments", "ledger", "debtSummaries", "pricing"].includes(w.source))
      .every((w) => w.status === "warmed") && pricing != null,
  );

  // The pre-T-529 engine baseline (the T-528 census) — for the delta census.
  const pre = runWebhookDiagnostics({
    payments, installments, ledgerEntries, allocations, debtSummaries, parents, students,
  }); // NO pricingConfig — the pre-T-529 shape
  const post = runWebhookDiagnostics({
    payments, installments, ledgerEntries, allocations, debtSummaries, parents, students,
    pricingConfig: pricing,
  }); // the T-529 engine with the configured catalog
  log("pre-T-529 counts (no config):", JSON.stringify(pre.counts));
  log("T-529 counts (with the live config):", JSON.stringify(post.counts));

  /* ── T2. THE OWNER'S EXAMPLE — the 25,000 FI encaissement now flags ──── */
  const fiPayment = payments.find((p) => (p.receiptNumber ?? "").endsWith(FI_RECEIPT_SUFFIX));
  if (!fiPayment) throw new Error("no -FI receipt payment found in the payments stream");
  const fiStudent = fiPayment.studentId ? students.find((s) => s.id === fiPayment.studentId) : undefined;
  log(
    `the FI payment: ${fiPayment.receiptNumber} · ${fiPayment.amount} DZD · parent ${fiPayment.parentId} · ` +
    `student ${fiStudent ? `${fiStudent.firstName} ${fiStudent.lastName} (${fiStudent.code}, ${fiStudent.gradeLevel})` : "?"}`,
  );
  const fiFinding =
    post.findings.find((f) => f.id === `outlier_review:price-fi-pay:${fiPayment.id}`) ??
    post.findings.find((f) => f.id === `confirmed_mismatch:price-fi-pay-violation:${fiPayment.id}`);
  record(
    "T2a the owner's example flags (was 0 findings pre-T-529)",
    fiFinding !== undefined,
    fiFinding ? `${fiFinding.id} · ${fiFinding.title}` : "no configured-price finding",
  );
  if (fiFinding) {
    record(
      "T2b both configured references + the delta present",
      fiFinding.evidence.some((e) => /Tarif plat configuré/.test(e.label)) &&
        fiFinding.evidence.some((e) => /Tarif par niveau configuré/.test(e.label)) &&
        fiFinding.calculation !== null,
      `amount=${fiFinding.amount} DZD · calc=${fiFinding.calculation}`,
    );
    record(
      "T2c the provenance + the possible causes (the 7-point structure)",
      fiFinding.evidence.some((e) => e.label === "Provenance" && /import Excel/.test(e.value)) &&
        (fiFinding.possibleCauses?.length ?? 0) >= 3,
      `causes=${fiFinding.possibleCauses?.length ?? 0} · steps=${fiFinding.suggestedSteps.length}`,
    );
    record(
      "T2d the resolution recommends, never rewrites",
      fiFinding.suggestedSteps.some((s) => /Trancher la convention/.test(s)),
    );
  }
  // The independent arithmetic (re-derived outside the engine):
  const flat = pricing?.registrationFee;
  const gradeFee = fiStudent ? pricing?.registrationFeeByGrade?.[fiStudent.gradeLevel] : undefined;
  record(
    "T2e the independent arithmetic agrees (25,000 vs flat 5,000 → 20,000)",
    flat === 5_000 && fiPayment.amount === 25_000 && fiPayment.amount - flat === 20_000,
    `flat=${flat} · gradeFee(${fiStudent?.gradeLevel})=${gradeFee} · delta-vs-flat=${fiPayment.amount - (flat ?? 0)}`,
  );

  /* ── T3. The config-tension root-cause finding ────────────────────────── */
  const tension = post.findings.find((f) => f.id === "outlier_review:price-config-tension:registration-fee");
  record(
    "T3 the config tension surfaced once (flat 5,000 vs per-grade 18k–30k)",
    tension !== undefined && post.findings.filter((f) => f.id === "outlier_review:price-config-tension:registration-fee").length === 1,
    tension ? `${tension.title} · causes=${tension.possibleCauses?.length ?? 0}` : "absent",
  );

  /* ── T4. AUDIT-509 re-verified — the re-pasted card's entry ──────────── */
  const dangling = post.findings.find((f) => f.id === `confirmed_mismatch:charge-dangling:${REPORTED_ENTRY}`);
  const resolved = post.findings.find((f) => f.id === `reconciled:charge-reg-resolved:${REPORTED_ENTRY}`);
  const globalDangling = post.findings.filter((f) => f.id.startsWith("confirmed_mismatch:charge-dangling:"));
  record(
    "T4a the re-pasted entry e8afa61f: NOT dangling, positively reconciled",
    dangling === undefined && resolved !== undefined,
    resolved ? `${resolved.title} · installment=${resolved.recordIds.installment}` : "no reg-resolved finding",
  );
  record("T4b the global dangling census stays 0", globalDangling.length === 0, `${globalDangling.length} findings`);

  /* ── T5. The registration charge carries its price basis ─────────────── */
  const feeCharge = ledgerEntries.find(
    (e) => e.type === "charge" && e.metadata?.type === "registration_fee",
  );
  const feeOk = feeCharge
    ? post.findings.find((f) => f.id === `reconciled:price-fi-charge-ok:${feeCharge.id}`)
    : undefined;
  record(
    "T5 the 5,000 « nouvelle famille » charge carries the reconciled price basis",
    feeCharge !== undefined && feeOk !== undefined,
    feeCharge ? `${feeCharge.amount} DZD · ${feeOk?.title ?? "no finding"}` : "charge not found",
  );

  /* ── T6. The PRESERVED classes (byte-stable vs the T-528 census) ─────── */
  // (a) pay-no-ledger ≡ the independent census — identical in BOTH runs.
  const bySource = new Map<string, number>();
  for (const e of ledgerEntries) {
    if (e.type === "payment" && e.sourceType === "payment") bySource.set(e.sourceId, (bySource.get(e.sourceId) ?? 0) + 1);
  }
  const noLedgerCensus = payments.filter((p) => !bySource.has(p.id)).length;
  const preNoLedger = pre.findings.filter((f) => f.id.startsWith("confirmed_mismatch:pay-no-ledger:")).length;
  const postNoLedger = post.findings.filter((f) => f.id.startsWith("confirmed_mismatch:pay-no-ledger:")).length;
  record(
    "T6a pay-no-ledger ≡ the independent census, unchanged by T-529",
    preNoLedger === noLedgerCensus && postNoLedger === noLedgerCensus,
    `engine(pre)=${preNoLedger} · engine(post)=${postNoLedger} · census=${noLedgerCensus}`,
  );
  // (b) duplicates: 0 dup-tuple in both; the sibling census unchanged.
  const preDup = pre.findings.filter((f) => f.id.startsWith("duplicate_event:dup-tuple:")).length;
  const postDup = post.findings.filter((f) => f.id.startsWith("duplicate_event:dup-tuple:")).length;
  const preSib = pre.findings.filter((f) => f.id.startsWith("reconciled:dup-siblings:")).length;
  const postSib = post.findings.filter((f) => f.id.startsWith("reconciled:dup-siblings:")).length;
  record(
    "T6b duplicates unchanged (0 dup-tuple · the sibling census identical)",
    preDup === 0 && postDup === 0 && preSib === postSib,
    `dup-tuple ${preDup}→${postDup} · dup-siblings ${preSib}→${postSib}`,
  );
  // (c) shared receipts: 0 in both.
  const preShared = pre.findings.filter((f) => f.id.startsWith("duplicate_event:dup-receipt:")).length;
  const postShared = post.findings.filter((f) => f.id.startsWith("duplicate_event:dup-receipt:")).length;
  record("T6c shared receipts unchanged (0)", preShared === 0 && postShared === 0, `${preShared}→${postShared}`);
  // (d) the Example-A future-dated corpus still visible.
  const preFuture = pre.findings.filter((f) => f.id.startsWith("date_semantic_conflict:pay-future:")).length;
  const postFuture = post.findings.filter((f) => f.id.startsWith("date_semantic_conflict:pay-future:")).length;
  record(
    "T6d the Example-A future-dated corpus unchanged",
    preFuture > 0 && preFuture === postFuture,
    `${preFuture}→${postFuture}`,
  );
  // (e) THE HONEST DELTA — every NEW finding belongs to the T-529 classes.
  const preIds = new Set(pre.findings.map((f) => f.id));
  const newFindings = post.findings.filter((f) => !preIds.has(f.id));
  const allowedNew = /^(outlier_review:price-fi-pay:|confirmed_mismatch:price-fi-pay-violation:|reconciled:price-fi-pay-ok:|reconciled:price-fi-charge-ok:|outlier_review:price-fi-charge:|outlier_review:price-config-tension:|unverified:price-fi-pay-noref:)/;
  const unexpectedNew = newFindings.filter((f) => !allowedNew.test(f.id));
  record(
    "T6e every NEW finding belongs to the T-529 configured-price classes",
    unexpectedNew.length === 0,
    `new=${newFindings.length} (${newFindings.map((f) => f.id.split(":").slice(0, 2).join(":")).join(" · ")}) · unexpected=${unexpectedNew.length}`,
  );
  // (f) no pre-existing finding disappeared — EXCEPT the designed
  //     degradation: the no-catalog coverage finding exists only in the
  //     config-less run (pre) and vanishes once the catalog is supplied
  //     (post). That single ID is the honest-degradation delta by design.
  const postIds = new Set(post.findings.map((f) => f.id));
  const vanished = pre.findings.filter((f) => !postIds.has(f.id));
  const unexpectedVanished = vanished.filter((f) => f.id !== "unverified:price-noconfig:catalog");
  record(
    "T6f no pre-existing finding vanished (except the designed no-config coverage delta)",
    unexpectedVanished.length === 0,
    `vanished=${vanished.length} (${vanished.map((f) => f.id).join(", ") || "none"}) · unexpected=${unexpectedVanished.length}`,
  );

  /* ── T7. The all-origins coverage ─────────────────────────────────────── */
  record(
    "T7a coverage.pricingConfig = true",
    post.coverage.pricingConfig === true,
  );
  record(
    "T7b the charge identity-form census ≡ the registration forensics (1,143/4/1/0)",
    post.coverage.chargeForms["bulk-import-stem"] === 1_143 &&
      post.coverage.chargeForms["installment-reg-identity"] === 4 &&
      post.coverage.chargeForms["manual-entry"] === 1 &&
      post.coverage.chargeForms["installment-pk"] === 0,
    JSON.stringify(post.coverage.chargeForms),
  );

  /* ── T8. READ-ONLY + deterministic ───────────────────────────────────── */
  const post2 = runWebhookDiagnostics({
    payments, installments, ledgerEntries, allocations, debtSummaries, parents, students,
    pricingConfig: pricing,
    now: post.asOf,
  });
  record(
    "T8a deterministic re-run (byte-identical counts + finding ids)",
    JSON.stringify(post2.counts) === JSON.stringify(post.counts) &&
      JSON.stringify(post2.findings.map((f) => f.id)) === JSON.stringify(post.findings.map((f) => f.id)),
  );
  record(
    "T8b read-only (the row counts never moved)",
    repos.payments.observe().get().length === payments.length &&
      repos.ledger.observe().get().length === ledgerEntries.length,
    `payments=${repos.payments.observe().get().length}/${payments.length} · ledger=${repos.ledger.observe().get().length}/${ledgerEntries.length}`,
  );

  /* ── The verdict ──────────────────────────────────────────────────────── */
  const failed = results.filter(([, ok]) => !ok);
  log(`\n==== THE VERDICT: ${results.length - failed.length}/${results.length} GREEN ====`);
  for (const [id, ok, note] of results) log(`  ${ok ? "✓" : "✗"} ${id}${note ? ` — ${note}` : ""}`);
  if (failed.length > 0) process.exit(1);

  await client.auth.signOut();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[${TAG}] FATAL:`, err);
  process.exit(1);
});
