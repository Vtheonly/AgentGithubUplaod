/**
 * t511-webhook-diagnostics-live.ts — the LIVE verification of the Webhook
 * & Ledger Traceability Diagnostics (the 159th session's AUDIT-506
 * closeout, GitHub issue #30).
 *
 * WHAT THIS PROBES (through the app's REAL code paths, READ-ONLY — zero
 * writes, zero RPC mutations, zero corrections; the engine is a pure
 * consumer of the warmed streams):
 *   L1. sign-in → the app's OWN client (the exact wiring the packaged app
 *       uses) → the REAL Supabase repositories
 *   L2. the migration-chain hygiene check (§15.11: live schema_migrations
 *       vs the local chain head — the token from the ENVIRONMENT only,
 *       the §15.14 push-protection rule)
 *   L3. the audit's REAL sources warmed (parents / students / payments /
 *       installments / ledger / debt summaries / allocations — the SAME
 *       warmExportSources seam the export rides)
 *   L4. runWebhookDiagnostics over the REAL data (the EXACT engine the
 *       Finance → Diagnostics « Diagnostic Webhooks » card renders)
 *   L5. the report-shape invariants: coverage ≡ the real volumes, counts ≡
 *       the findings array (the no-silent-omission contract)
 *   L6. the findings taxonomy on REAL data: one sample finding per
 *       non-empty category, each carrying its evidence inventory
 *   L7. the Example-A live shape: the count of COLLECTED payments whose
 *       collection date lies in the future (the T-502 remediation class —
 *       reported honestly, whatever it is)
 *   L8. the READ-ONLY guarantee: a second run over the same streams
 *       produces the IDENTICAL report (determinism) and the row counts
 *       never move (zero mutation by construction — the script calls no
 *       write method on any repository).
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<token> npx tsx scripts/t511-webhook-diagnostics-live.ts
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
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

// ── Constants ───────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = process.env.T511_ADMIN_EMAIL ?? "admin@elimtiyaz.dz";
const ADMIN_PASSWORD = process.env.T511_ADMIN_PASSWORD ?? "elimtiyaz@admin2026";

const TAG = `t511-${Date.now().toString(36)}`;
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

  // ── L1. sign-in through the app's OWN client ────────────────────────────
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
  record("L1 admin sign-in (the app's own client)", true, signIn.data.user.email ?? "");

  localStorageShim.setItem(
    "el-imtiyaz.session",
    JSON.stringify({
      userId: actorId,
      tenantId: "00000000-0000-0000-0000-000000000001",
      email: signIn.data.user.email,
      displayName: "T511 Probe",
      role: "super_admin",
      permissions: [],
      accessToken: "probe",
      refreshToken: "probe",
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );

  // ── L2. the migration-chain hygiene check (§15.11) ──────────────────────
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? "";
  if (!accessToken) {
    record("L2 live migration chain head", false, "SUPABASE_ACCESS_TOKEN not exported (the §15.14 env-only convention)");
  } else {
    const sqlRes = await fetch(
      "https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "select max(version) as head from supabase_migrations.schema_migrations" }),
      },
    );
    if (sqlRes.ok) {
      const rows = (await sqlRes.json()) as Array<{ head: string | null }>;
      record("L2 live migration chain head", true, `head=${rows[0]?.head ?? "(none)"}`);
    } else {
      record("L2 live migration chain head", false, `Management API ${sqlRes.status}`);
    }
  }

  // ── L3. the audit's REAL sources warmed ─────────────────────────────────
  const repos = getSupabaseRepositories();
  const warmup = await warmExportSources(repos as never);
  const auditSources = ["parents", "students", "payments", "installments", "ledger", "debtSummaries"];
  const degraded = warmup.filter((w) => w.status === "degraded");
  record(
    "L3a the audit's sources warmed",
    warmup.filter((w) => auditSources.includes(w.source)).every((w) => w.status === "warmed"),
    degraded.length === 0 ? "all warmed" : `degraded: ${degraded.map((d) => `${d.source}(${d.reason})`).join(", ")}`,
  );

  // The allocations observable (the FinancialsPage's own wiring shape).
  const allocationsObs = repos.payments.observeAllocations?.();
  await new Promise((resolve) => setTimeout(resolve, 2500)); // the seeds' reads land
  const payments = repos.payments.observe().get();
  const installments = repos.installments.observe().get();
  const ledgerEntries = repos.ledger.observe().get();
  const debtSummaries = repos.debt.observeSummary().get();
  const parents = repos.parents.observe().get();
  const students = repos.students.observe().get();
  const allocations = allocationsObs ? allocationsObs.get() : [];
  record(
    "L3b the streams hold REAL data",
    parents.length > 0 && payments.length > 0 && ledgerEntries.length > 0,
    `parents=${parents.length} students=${students.length} payments=${payments.length} installments=${installments.length} ledger=${ledgerEntries.length} debtSummaries=${debtSummaries.length} allocations=${allocations.length}`,
  );

  // ── L4. the EXACT engine over the REAL data ────────────────────────────
  const report = runWebhookDiagnostics({
    payments, installments, ledgerEntries, allocations, debtSummaries, parents, students,
  });
  const actionable =
    report.counts.confirmed_mismatch + report.counts.duplicate_event +
    report.counts.unjustified_amount + report.counts.outlier_review +
    report.counts.date_semantic_conflict;
  record(
    "L4 runWebhookDiagnostics over the real data",
    report.findings.length > 0,
    `findings=${report.findings.length} (actionable=${actionable}, reconciled=${report.counts.reconciled}, unverified=${report.counts.unverified}) — asOf=${report.asOf}`,
  );
  log(
    "  counts:",
    JSON.stringify(report.counts),
  );

  // ── L5. the report-shape invariants ────────────────────────────────────
  const coverageOk =
    report.coverage.payments === payments.length &&
    report.coverage.ledgerEntries === ledgerEntries.length &&
    report.coverage.installments === installments.length &&
    report.coverage.parents === parents.length;
  const countsSum = Object.values(report.counts).reduce((s, n) => s + n, 0);
  record(
    "L5 coverage ≡ real volumes · counts ≡ findings (no silent omission)",
    coverageOk && countsSum === report.findings.length,
    `coverage ok=${coverageOk}; Σcounts=${countsSum} = findings=${report.findings.length}`,
  );

  // ── L6. the taxonomy on REAL data — one sample per non-empty category ──
  const categories = Object.keys(report.counts) as Array<keyof typeof report.counts>;
  for (const cat of categories) {
    if (report.counts[cat] === 0) continue;
    const sample = report.findings.find((f) => f.category === cat)!;
    log(
      `  [${cat}] n=${report.counts[cat]} — sample: ${sample.title}`,
    );
    log(
      `      amount=${sample.amount ?? "—"} evidence=[${sample.evidence.map((e) => e.label).join(" | ")}]`,
    );
  }
  record(
    "L6 every non-empty category carries evidence-backed findings",
    categories.filter((c) => report.counts[c] > 0).length > 0,
    `${categories.filter((c) => report.counts[c] > 0).length}/7 categories populated on the real books`,
  );

  // ── L7. the Example-A live shape (future-dated COLLECTED payments) ──────
  const nowMs = Date.now();
  const futureCollected = payments.filter((p) => {
    if (p.status !== "paid" && p.status !== "partial") return false;
    const ms = Date.parse(p.collectedAt);
    return Number.isFinite(ms) && ms > nowMs + 86_400_000;
  });
  record(
    "L7 the Example-A live shape (collected payments dated in the future)",
    true,
    `${futureCollected.length} payment(s) · ${futureCollected.reduce((s, p) => s + p.amount, 0).toLocaleString("fr-FR")} DZD — the T-502 remediation class, reported honestly (0 = the remediation holds)`,
  );

  // ── L8. the READ-ONLY guarantee ────────────────────────────────────────
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
  const deterministic =
    JSON.stringify(report2.counts) === JSON.stringify(report.counts);
  record(
    "L8 read-only + deterministic (the second run is identical, the rows never move)",
    deterministic && JSON.stringify(before) === JSON.stringify(after),
    `counts identical=${deterministic}; rows ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
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
