// ============================================================================
// refresh-materialized-views/index.ts
// ============================================================================
// Scheduled Edge Function: Refresh all materialized views used by dashboards
// ----------------------------------------------------------------------------
// Triggered daily at 01:00 UTC by Supabase Cron (see config.toml).
// Also callable manually via POST (with CRON_SECRET) for ops/debugging.
//
// BEHAVIOR:
//   1. Attempts to call `public.refresh_all_materialized_views()` RPC first.
//      If the RPC exists and succeeds, returns the list of refreshed views.
//   2. As a fallback (and for per-view error isolation), iterates the known
//      view list and calls `public.refresh_materialized_view(p_name)` for
//      each one. Errors on a single view do NOT abort the others.
//   3. Records total duration_ms.
//   4. Writes a single audit log entry per run (under a system tenant).
//
// KNOWN VIEWS (Plan §12.10 — Dashboard KPIs):
//   - mv_dashboard_kpis    : per-tenant KPI snapshot (revenue, debt, students)
//   - mv_debt_aging        : debt aging buckets (0-30, 31-90, >90 days)
//   - mv_top_debtors       : top N debtors by outstanding amount
//   - mv_revenue_by_month  : monthly revenue trend (last 12 months)
//   - mv_grade_summary     : student count + avg grade per grade level
//
// SECURITY (SEC-105 fix, task T-004 — shared guard _shared/cron-auth.ts):
//   - A request with NO Authorization header is DENIED (401). It used to be
//     treated as a cron invocation, which made this EF publicly invokable.
//   - Authorised callers: `Authorization: Bearer <CRON_SECRET>` (operator
//     secret, `supabase secrets set CRON_SECRET=…`), or the project's
//     service_role key (Supabase's managed scheduler injects it).
//   - Deployment note: any SQL-level cron schedule (pg_cron + pg_net) MUST
//     send `Authorization: Bearer <CRON_SECRET>` in its http_post headers.
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { isCronInvocation } from "../_shared/cron-auth.ts";
import {
  createServiceRoleClient,
  writeAuditLog,
} from "../_shared/supabase.ts";

const KNOWN_VIEWS = [
  "mv_dashboard_kpis",
  "mv_debt_aging",
  "mv_top_debtors",
  "mv_revenue_by_month",
  "mv_grade_summary",
] as const;

interface ViewResult {
  view: string;
  status: "ok" | "failed";
  duration_ms: number;
  error?: string;
}

Deno.serve(async (req: Request) => {
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
  const runStartedAt = performance.now();
  const results: ViewResult[] = [];

  // 1. Try the bulk RPC first. If it succeeds, we still want per-view timing
  //    in the response, but we trust the DB-side bulk refresh. If it fails
  //    (e.g. RPC missing), fall back to the per-view loop below.
  const { error: bulkError } = await supabase.rpc("refresh_all_materialized_views");

  if (bulkError) {
    console.warn("[refresh-materialized-views] bulk RPC failed, falling back to per-view:", bulkError.message);

    // 2. Per-view fallback (isolates errors per view)
    for (const viewName of KNOWN_VIEWS) {
      const viewStart = performance.now();
      const { error: viewError } = await supabase.rpc("refresh_materialized_view", {
        p_name: viewName,
      });
      const viewDuration = Math.round(performance.now() - viewStart);

      if (viewError) {
        console.error(`[refresh-materialized-views] ${viewName} failed:`, viewError);
        results.push({
          view: viewName,
          status: "failed",
          duration_ms: viewDuration,
          error: viewError.message,
        });
      } else {
        results.push({
          view: viewName,
          status: "ok",
          duration_ms: viewDuration,
        });
      }
    }
  } else {
    // Bulk succeeded — populate results from the known list with ok status
    for (const viewName of KNOWN_VIEWS) {
      results.push({ view: viewName, status: "ok", duration_ms: 0 });
    }
  }

  const totalDurationMs = Math.round(performance.now() - runStartedAt);
  const refreshedViews = results.filter((r) => r.status === "ok").map((r) => r.view);
  const failedViews = results.filter((r) => r.status === "failed");

  // 3. Audit log — use a synthetic system tenant row
  //    (the audit_log table requires a tenant_id; we use a sentinel
  //    '00000000-0000-0000-0000-000000000000' for system-wide ops)
  const SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
  try {
    await writeAuditLog(
      SYSTEM_TENANT_ID,
      "materialized_views.refresh",
      "system",
      null,
      null,
      "system",
      null,
      {
        refreshed_views: refreshedViews,
        failed_views: failedViews,
        duration_ms: totalDurationMs,
        run_at: new Date().toISOString(),
      },
      `Refreshed ${refreshedViews.length}/${KNOWN_VIEWS.length} materialized views${failedViews.length > 0 ? ` (${failedViews.length} failed)` : ""}`,
      requestId
    );
  } catch (auditError) {
    // Audit log failure should not break the response
    console.warn("[refresh-materialized-views] audit log write failed:", auditError);
  }

  if (failedViews.length > 0) {
    console.error("[refresh-materialized-views] Some views failed:", failedViews);
  }

  return jsonOk(req, {
    refreshed_views: refreshedViews,
    failed_views: failedViews,
    message:
      failedViews.length === 0
        ? `Successfully refreshed ${refreshedViews.length} materialized views.`
        : `Refreshed ${refreshedViews.length}/${KNOWN_VIEWS.length} views; ${failedViews.length} failed (see logs).`,
    duration_ms: totalDurationMs,
  });
});
