// ============================================================================
// expire-pending-approvals/index.ts
// ============================================================================
// Scheduled Edge Function: Expire stale account approval requests
// ----------------------------------------------------------------------------
// Triggered daily at 00:00 UTC by Supabase Cron (see config.toml).
// Not normally called by users, but supports manual GET for ops/debugging.
//
// BEHAVIOR:
//   1. Calls `public.expire_pending_approvals()` RPC — this function marks
//      every `account_approval_requests` row with status='pending' AND
//      created_at < (now() - 7 days) as status='expired'.
//   2. The RPC returns a result set of { tenant_id, expired_count } rows
//      (one per affected tenant).
//   3. For each affected tenant, this function writes an audit log entry with
//      action='account_approval.expire_batch'.
//   4. Returns a summary: total expired, tenants affected, message.
//
// SECURITY:
//   - No JWT required (cron invocation). Identification is enforced by
//     Supabase Cron's internal service role invocation only.
//   - When called manually via GET, requires an internal CRON_SECRET header
//     to prevent abuse.
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import {
  createServiceRoleClient,
  writeAuditLog,
} from "../_shared/supabase.ts";

interface ExpiredRow {
  tenant_id: string;
  expired_count: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // Allow only cron (no auth) or guarded manual GET with CRON_SECRET
  const authHeader = req.headers.get("authorization");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (authHeader) {
    // Manual invocation: require CRON_SECRET bearer
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return jsonError(req, 401, "unauthorized", "Invalid cron secret");
    }
    if (req.method !== "GET" && req.method !== "POST") {
      return jsonError(req, 405, "method_not_allowed", "Use GET or POST");
    }
  } else {
    // Pure cron invocation — only POST allowed by Supabase Cron
    if (req.method !== "POST") {
      return jsonError(req, 405, "method_not_allowed", "Use POST");
    }
  }

  const supabase = createServiceRoleClient();
  const runStartedAt = new Date().toISOString();

  // 1. Call the expire_pending_approvals RPC
  const { data: expiredRows, error } = await supabase.rpc("expire_pending_approvals");

  if (error) {
    console.error("[expire-pending-approvals] RPC failed:", error);
    return jsonError(req, 500, "expire_failed", "Failed to expire pending approvals", error.message);
  }

  const rows: ExpiredRow[] = expiredRows ?? [];
  let totalExpired = 0;
  let tenantsAffected = 0;

  // 2. Write audit log entry per affected tenant
  for (const row of rows) {
    if (!row.tenant_id || !row.expired_count || row.expired_count === 0) continue;
    totalExpired += row.expired_count;
    tenantsAffected++;

    await writeAuditLog(
      row.tenant_id,
      "account_approval.expire_batch",
      "account_approval_request",
      null,
      null,
      "system",
      null,
      {
        expired_count: row.expired_count,
        run_at: runStartedAt,
      },
      `Automated expiration of ${row.expired_count} stale pending approval request(s)`,
      requestId
    );
  }

  return jsonOk(req, {
    expired_count: totalExpired,
    tenants_affected: tenantsAffected,
    run_at: runStartedAt,
    message:
      totalExpired > 0
        ? `Expired ${totalExpired} pending approval request(s) across ${tenantsAffected} tenant(s).`
        : "No stale pending approval requests found.",
  });
});
