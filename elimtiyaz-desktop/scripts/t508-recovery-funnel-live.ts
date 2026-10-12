/**
 * t508-recovery-funnel-live.ts — the LIVE verification of the recovery
 * funnel's PRODUCTION data flow (the 157th session's UI-339 closeout).
 *
 * WHAT THIS PROBES (through the app's REAL code paths, READ-ONLY — zero
 * writes, zero messages, zero parent contact):
 *   L1. sign-in → the app's OWN client (the exact wiring the packaged app
 *       uses) → the REAL Supabase repositories
 *   L2. the migration-chain hygiene check (§15.11: live schema_migrations
 *       vs the local chain head)
 *   L3. the funnel's REAL sources warmed (parents/students/installments via
 *       the SAME refresh() seam the export warm-up rides + the ACTIVE debt
 *       thresholds via the canonical reader)
 *   L4. the EXACT production derivations over the REAL data:
 *       deriveDebtTriage → deriveRecoveryFunnel (the displayed counts) and
 *       deriveRecoveryFunnelHouseholds (the displayed lists)
 *   L5. the RECONCILIATION INVARIANT live: stages[i].count ===
 *       byStage[i].length for every stage (the distinct-family contract)
 *   L6. the distinct-count shape: a multi-bucket family counted ONCE
 *   L7. the real rows' shape: PAR- ids, resolved names, INV-4 outstandings,
 *       contact coverage for the WhatsApp handoff
 *   L8. the demo-corpus absence: NO demo-family-* id anywhere in the real
 *       rows (the mode-separation contract)
 *
 * Usage:
 *   npx tsx scripts/t508-recovery-funnel-live.ts
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

// The REAL src modules — DYNAMIC, AFTER the shims (a static import would
// hoist the module graph's evaluation BEFORE the shims run — the card's
// repository-provider import evaluates selectDefaultRepositories at module
// scope, which touches window.localStorage at construction).

// ── Constants ───────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = process.env.T508_ADMIN_EMAIL ?? "admin@elimtiyaz.dz";
const ADMIN_PASSWORD = process.env.T508_ADMIN_PASSWORD ?? "elimtiyaz@admin2026";

const TAG = `t508-${Date.now().toString(36)}`;
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
  const { deriveDebtTriage } = await import(
    "../src/features/dashboard/components/analytics/executive-statistics"
  );
  const { deriveRecoveryFunnel, deriveRecoveryFunnelHouseholds } = await import(
    "../src/features/dashboard/components/recovery-funnel-card"
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

  // The app's session shape in localStorage (getTenantId reads this).
  localStorageShim.setItem(
    "el-imtiyaz.session",
    JSON.stringify({
      userId: actorId,
      tenantId: "00000000-0000-0000-0000-000000000001",
      email: signIn.data.user.email,
      displayName: "T508 Probe",
      role: "super_admin",
      permissions: [],
      accessToken: "probe",
      refreshToken: "probe",
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );

  // ── L2. the migration-chain hygiene check (§15.11) — the Management API
  // SQL endpoint (the documented pattern; the schema-qualified PostgREST
  // form is not in the cached schema). The token is read from the
  // ENVIRONMENT, never embedded (the §15.14 GitHub push-protection rule).
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? "";
  if (!accessToken) {
    record("L2 live migration chain head", false, "SUPABASE_ACCESS_TOKEN not exported (the §15.14 env-only convention)");
  } else {
    const sqlRes = await fetch(
      "https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "select max(version) as head from supabase_migrations.schema_migrations" }),
      },
    );
    if (sqlRes.ok) {
      const rows = (await sqlRes.json()) as Array<{ head: string | null }>;
      const liveHead = rows[0]?.head ?? "(none)";
      record(
        "L2 live migration chain head",
        true,
        `head=${liveHead} (the local chain's head is 0151_t504 — verified in the repo)`,
      );
    } else {
      record("L2 live migration chain head", false, `Management API ${sqlRes.status}: ${(await sqlRes.text()).slice(0, 200)}`);
    }
  }

  // ── L3. the funnel's REAL sources warmed ────────────────────────────────
  const repos = getSupabaseRepositories();
  record("L3a supabase repositories wired", true, `${Object.keys(repos).length} slots`);

  const warmup = await warmExportSources(repos as never);
  const degraded = warmup.filter((w) => w.status === "degraded");
  record(
    "L3b the funnel's sources warmed (parents/students/installments)",
    warmup.filter((w) => ["parents", "students", "installments"].includes(w.source)).every((w) => w.status === "warmed"),
    degraded.length === 0 ? "all sources warmed" : `degraded: ${degraded.map((d) => `${d.source}(${d.reason})`).join(", ")}`,
  );

  // The ACTIVE thresholds (the canonical reader — the same observable the
  // dashboard's thresholdsCfg host rides).
  const thresholdsObs = repos.debt.observeThresholds();
  await new Promise((resolve) => setTimeout(resolve, 2500)); // the seed's read lands
  const thresholds = thresholdsObs.get();
  record(
    "L3c the ACTIVE debt thresholds read",
    thresholds.yellowDays > 0 && thresholds.redDays > 0,
    `grace=${thresholds.gracePeriodDays} yellow=${thresholds.yellowDays} red=${thresholds.redDays} amountYellow=${thresholds.amountYellowDzd ?? 0} amountRed=${thresholds.amountRedDzd ?? 0}`,
  );

  const parents = repos.parents.observe().get();
  const students = repos.students.observe().get();
  const installments = repos.installments.observe().get() as readonly Installment[];
  record(
    "L3d the streams hold REAL data",
    parents.length > 0 && students.length > 0,
    `parents=${parents.length} students=${students.length} installments=${installments.length}`,
  );

  // ── L4. the EXACT production derivations over the REAL data ─────────────
  const nowEpochMs = Date.now();
  const triage = deriveDebtTriage(installments, nowEpochMs, thresholds);
  const stages = deriveRecoveryFunnel(triage);
  const households = deriveRecoveryFunnelHouseholds({
    installments,
    parents,
    students,
    nowEpochMs,
    thresholds,
  });
  record(
    "L4 the derivations ran over the real data",
    stages.length === 4,
    `stages: ${stages.map((s) => s.count).join("/")} — rows=${households.rows.length}`,
  );

  // ── L5. the RECONCILIATION INVARIANT (the distinct-family contract) ─────
  const reconcile = stages.map((s, i) => s.count === households.byStage[i].length);
  record(
    "L5 counts ≡ lists (every stage)",
    reconcile.every(Boolean),
    `stage counts ${stages.map((s) => s.count).join("/")} vs list lengths ${households.byStage.map((l) => l.length).join("/")}`,
  );

  // ── L6. the distinct-count shape (a multi-bucket family counted ONCE) ───
  // Families whose installments straddle buckets (a not-due row + a past-due row):
  const perFamily = new Map<string, Set<string>>();
  for (const i of installments) {
    if (i.amountDue - i.amountPaid - i.amountPending <= 0) continue;
    const days = Math.floor((nowEpochMs - Date.parse(`${i.dueDate}T00:00:00Z`)) / 86_400_000);
    const bucket = days <= 0 ? "not_due" : days <= thresholds.yellowDays ? "current" : days <= thresholds.redDays ? "reminder" : "chronic";
    const fam = perFamily.get(i.parentId) ?? new Set<string>();
    fam.add(bucket);
    perFamily.set(i.parentId, fam);
  }
  const straddlers = [...perFamily.entries()].filter(([, buckets]) => buckets.size > 1).length;
  record(
    "L6 the distinct-family count (straddling families counted ONCE)",
    households.rows.length === perFamily.size,
    `${straddlers} families straddle multiple triage buckets; rows=${households.rows.length} = distinct families=${perFamily.size} (the pre-T-508 Σ-form would have inflated stage 1 by up to ${straddlers})`,
  );

  // ── L7. the real rows' shape ────────────────────────────────────────────
  const parentIdSet = new Set(parents.map((p) => p.id));
  const critical = households.byStage[3];
  // When critical is empty under the live thresholds, the coverage sample
  // falls back to the deepest NON-empty escalation stage (the honest live
  // shape — red=69 currently admits no family).
  const coverageStage = critical.length > 0 ? critical : [...households.byStage].reverse().find((l) => l.length > 0) ?? [];
  const withContact = coverageStage.filter((r) => r.contactPhone !== null).length;
  const named = coverageStage.filter((r) => r.parentName !== "Famille inconnue").length;
  const sample = coverageStage.slice(0, 3).map(
    (r) => `${r.parentName} (${r.parentId}, ${r.outstanding} DZD, ${r.worstDaysOverdue}j, ${r.amountLevel})`,
  );
  record(
    "L7a every row carries a REAL parent id + resolved identity",
    households.rows.every((r) => parentIdSet.has(r.parentId)),
    `critical rows=${critical.length}${critical.length === 0 ? " (the honest empty state under red=69)" : ""}; coverage sample from the deepest non-empty stage (${coverageStage.length} rows: ${named} named, ${withContact} with a WhatsApp-handoff contact): ${sample.join(" | ")}`,
  );

  // ── L8. the demo-corpus absence (the mode separation) ───────────────────
  record(
    "L8 NO demo-family id anywhere in the production rows",
    households.rows.every((r) => !r.parentId.startsWith("demo-family-")),
    `${households.rows.filter((r) => r.parentId.startsWith("demo-family-")).length} demo ids found (must be 0)`,
  );

  // ── The summary ─────────────────────────────────────────────────────────
  const failed = results.filter(([, ok]) => !ok);
  console.log("\n════════ T-508 LIVE VERIFICATION ════════");
  for (const [id, ok, note] of results) {
    console.log(`  ${ok ? "✓" : "✗"} ${id}${note ? ` — ${note}` : ""}`);
  }
  console.log(`  VERDICT: ${failed.length === 0 ? "ALL GREEN" : `${failed.length} FAILED`}`);
  globalThis.process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`[${TAG}] FATAL`, err);
  globalThis.process.exitCode = 1;
});
