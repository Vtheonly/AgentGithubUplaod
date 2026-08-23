// ============================================================================
// lib/env.mjs — Environment configuration for the live equivalence suite.
// ----------------------------------------------------------------------------
// Credentials are read from environment variables ONLY (never hardcoded):
//   SUPABASE_URL                 e.g. https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service-role JWT (bypasses RLS; required)
//   EQUIVALENCE_TENANT_ID        defaults to the El-Imtiyaz tenant
//   EQUIVALENCE_DRY_RUN=1        report what would run, touch nothing
// ============================================================================

export const env = {
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  tenantId:
    process.env.EQUIVALENCE_TENANT_ID ||
    "00000000-0000-0000-0000-000000000001",
  dryRun: process.env.EQUIVALENCE_DRY_RUN === "1",
  actorId: process.env.EQUIVALENCE_ACTOR_ID || null, // user_profiles.id if set
  actorName: "equivalence-live-suite",
};

export function assertEnv() {
  const missing = [];
  if (!env.supabaseUrl) missing.push("SUPABASE_URL");
  if (!env.serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}.\n` +
        `Set them (never commit them) before running the equivalence suite.`,
    );
  }
}
