// ============================================================================
// purge-expired-backups/index.ts
// ============================================================================
// Scheduled Edge Function: Mark expired encrypted backup archives as 'purged'
// ----------------------------------------------------------------------------
// Triggered weekly on Sunday at 03:00 UTC by Supabase Cron (see config.toml).
// Also callable manually via POST (with CRON_SECRET) for ops/debugging.
//
// USE CASE (Plan §13.03 — Encrypted Backup Rotation):
//   The Desktop app uploads encrypted (client-side) SQLite backups to Supabase
//   Storage. Each backup row in `backup_archives` has an `expires_at` field
//   (typically +90 days). Once expired, the metadata row must be marked
//   'purged' so the Desktop app knows to delete the corresponding ciphertext
//   blob from its local IndexedDB vault.
//
//   IMPORTANT: This function does NOT delete the actual ciphertext blobs from
//   Supabase Storage or from the client's IndexedDB. It only flips the
//   metadata row's status to 'purged'. The actual deletion happens in:
//     - Supabase Storage: handled by a separate storage lifecycle rule
//     - IndexedDB vault:  handled by the Electron app on next sync, using the
//       list of purged archive IDs returned by this function
//
// BEHAVIOR:
//   1. Fetch all active tenants
//   2. For each tenant, call `public.purge_expired_backups(p_tenant_id)` RPC
//      which returns a list of purged archive IDs (rows updated from
//      status='active' AND expires_at < now() to status='purged')
//   3. Aggregate per-tenant results
//   4. Write one audit log entry per affected tenant with action='backup.purge_batch'
//   5. Return the full list of purged archive IDs so the desktop app can sync
//
// SECURITY (SEC-105 fix, task T-004 — shared guard _shared/cron-auth.ts):
//   - A request with NO Authorization header is DENIED (401). It used to be
//     treated as a cron invocation, which made this EF publicly invokable.
//   - Authorised callers: `Authorization: Bearer <CRON_SECRET>` (operator
//     secret, `supabase secrets set CRON_SECRET=…`), or the project's
//     service_role key (Supabase's managed scheduler injects it).
//   - Deployment note: any SQL-level cron schedule (pg_cron + pg_net) MUST
//     send `Authorization: Bearer <CRON_SECRET>` in its http_post headers.
//   - service_role key performs the actual DB writes (bypasses RLS)
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { isCronInvocation } from "../_shared/cron-auth.ts";
import { createServiceRoleClient, withAuditSurfacing, writeAuditLog } from "../_shared/supabase.ts";

interface PurgeResult {
  tenant_id: string;
  archive_ids: string[];
}

Deno.serve(withAuditSurfacing(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // SEC-105 (T-004): deny by default. Cron and manual invocations MUST
  // present `Authorization: Bearer <CRON_SECRET>` (the managed scheduler's
  // service_role key is also accepted — see _shared/cron-auth.ts).
  // A MISSING Authorization header is no longer treated as a cron invocation.
  if (!isCronInvocation(req)) {
    return jsonError(req, 401, "unauthorized", "Cron secret required");
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use GET or POST");
  }

  const supabase = createServiceRoleClient();
  const runStartedAt = new Date().toISOString();

  // 1. Fetch all active tenants
  const { data: tenants, error: tenantsError } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("is_active", true)
    .is("deleted_at", null);

  if (tenantsError) {
    console.error("[purge-expired-backups] Failed to fetch tenants:", tenantsError);
    return jsonError(req, 500, "tenants_fetch_failed", tenantsError.message);
  }

  const perTenantResults: PurgeResult[] = [];
  const allPurgedArchiveIds: string[] = [];
  let tenantsProcessed = 0;
  let tenantsWithPurges = 0;

  // 2. Iterate all tenants and purge their expired backups
  for (const tenant of tenants ?? []) {
    tenantsProcessed++;

    const { data: purgedIds, error: purgeError } = await supabase.rpc(
      "purge_expired_backups",
      { p_tenant_id: tenant.id }
    );

    if (purgeError) {
      console.error(
        `[purge-expired-backups] Purge failed for tenant ${tenant.id} (${tenant.name}):`,
        purgeError
      );
      // Continue with other tenants — one failure should not abort the batch
      perTenantResults.push({ tenant_id: tenant.id, archive_ids: [] });
      continue;
    }

    const archiveIds: string[] = Array.isArray(purgedIds)
      ? (purgedIds as string[]).filter(Boolean)
      : [];

    perTenantResults.push({ tenant_id: tenant.id, archive_ids: archiveIds });

    if (archiveIds.length > 0) {
      tenantsWithPurges++;
      allPurgedArchiveIds.push(...archiveIds);

      // 3. Audit log per affected tenant
      await writeAuditLog(
        tenant.id,
        "backup.purge_batch",
        "backup_archive",
        null,
        null,
        "system",
        null,
        {
          purged_count: archiveIds.length,
          purged_archive_ids: archiveIds,
          run_at: runStartedAt,
        },
        `Purged ${archiveIds.length} expired backup archive(s) — awaiting client-side IndexedDB sync`,
        requestId
      );
    }
  }

  const archivesPurged = allPurgedArchiveIds.length;

  console.info(
    `[purge-expired-backups] Processed ${tenantsProcessed} tenant(s); ` +
    `${tenantsWithPurges} had purges; ${archivesPurged} archive(s) marked 'purged'.`
  );

  return jsonOk(req, {
    tenants_processed: tenantsProcessed,
    tenants_with_purges: tenantsWithPurges,
    archives_purged: archivesPurged,
    purged_archive_ids: allPurgedArchiveIds,
    per_tenant: perTenantResults,
    run_at: runStartedAt,
    message:
      archivesPurged > 0
        ? `Marked ${archivesPurged} expired backup archive(s) as 'purged' across ${tenantsWithPurges} tenant(s). Desktop apps should sync their IndexedDB vaults.`
        : "No expired backup archives found this run.",
  });
}));
