/**
 * t-396-crud-live-e2e.ts — the LIVE end-to-end run of the T-396 CRUD
 * integration suite against the real backend (the same runner the Settings
 * « Tests CRUD » tab executes — imported directly, driven with the canonical
 * client, signed in as the documented admin).
 *
 * This is the live-verification leg for the task registry evidence
 * (docs/recovery/t-396-live-verification.md): the suite's 27 checks must
 * come back with the exact PASS/FAIL matrix, and the DB must show zero live
 * probe residue at the end.
 *
 * Usage (from elimtiyaz-desktop/):
 *   npx tsx scripts/t-396-crud-live-e2e.ts
 *
 * The publishable key is the public identifier (credentials.md §9.1); the
 * admin password is the owner-pinned credential (credentials.md §1).
 */
import { createClient } from "@supabase/supabase-js";
import { runCrudIntegrationTests, expectedCrudCheckCount } from "../src/features/settings/supabase-diagnostics/crud-test-runner";
import { formatDiagnosticsReportText } from "../src/features/settings/supabase-diagnostics/diagnostics-runner";

const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";

async function main(): Promise<number> {
  console.log("t-396-crud-live-e2e — the CRUD integration suite against the LIVE backend\n");
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Sign in as the documented admin (the desktop's own path).
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (signInErr || !signIn.session) {
    console.error(`FATAL: sign-in failed: ${signInErr?.message ?? "no session"}`);
    return 1;
  }
  console.log(`signed in as ${ADMIN_EMAIL} (user ${signIn.user!.id.slice(0, 8)}…)\n`);

  // The suite (the EXACT code the Settings tab runs).
  const report = await runCrudIntegrationTests({
    client,
    domainSession: { userId: signIn.user!.id, email: ADMIN_EMAIL },
  });

  // Print the full matrix.
  for (const c of report.checks) {
    const badge =
      c.status === "pass" ? "PASS" : c.status === "fail" ? "FAIL" : "NON TESTÉ";
    const ms = c.durationMs !== null ? ` (${c.durationMs} ms)` : "";
    console.log(`  [${badge}]${ms} ${c.category} — ${c.label}`);
    if (c.status !== "pass" || process.env.VERBOSE) {
      console.log(`         ${c.detail}`);
    }
  }

  console.log(
    `\nSummary: ${report.summary.pass} PASS / ${report.summary.fail} FAIL / ${report.summary.notTested} NON TESTÉ` +
      ` (expected total ${expectedCrudCheckCount()}, got ${report.checks.length})`,
  );

  // Export the full text form (the clipboard export shape).
  if (process.env.VERBOSE) {
    console.log("\n--- report text (clipboard form) ---\n" + formatDiagnosticsReportText(report));
  }

  const ok = report.summary.fail === 0 && report.summary.notTested === 0;
  console.log(`\n${ok ? "ALL GREEN — the CRUD suite is fully functional against the live backend." : "FAILURES DETECTED — see the matrix above."}`);
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
