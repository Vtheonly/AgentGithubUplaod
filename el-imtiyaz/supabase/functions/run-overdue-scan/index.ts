// ============================================================================
// run-overdue-scan/index.ts
// ============================================================================
// Scheduled Edge Function: Scan overdue installments + generate alerts
// ----------------------------------------------------------------------------
// Triggered daily at 08:00 UTC by Supabase Cron (see config.toml).
// Also callable manually via POST from the Installment Schedule tab's
// "Scan retards" button.
//
// BEHAVIOR:
//   1. Calls `public.run_overdue_scan(tenant_id, as_of_date)` for every tenant
//   2. For each overdue installment:
//      a) Computes days_overdue + amount_overdue
//      b) Determines priority: >90 days → urgent, 31-90 → high, 0-30 → medium
//      c) Inserts a notification (idempotent on (target_role=financial_officer,
//         link_entity_type=installment, link_entity_id=installment_id))
//      d) Writes an audit log entry
//   3. Returns a summary: total_scanned, total_overdue_amount, alerts_created
//
// SECURITY:
//   - When triggered by cron: no JWT (uses service_role key directly)
//   - When triggered manually: requires JWT + view_financials permission
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import {
  createServiceRoleClient,
  extractAuthContext,
  requirePermission,
  writeAuditLog,
} from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const supabase = createServiceRoleClient();

  // Determine if this is a cron invocation (no auth header) or manual call
  const authHeader = req.headers.get("authorization");
  const isCron = !authHeader;

  let tenantFilter: string | null = null;
  let asOfDate = new Date().toISOString().slice(0, 10);

  if (!isCron) {
    if (req.method !== "POST") {
      return jsonError(req, 405, "method_not_allowed", "Use POST");
    }
    const ctx = await extractAuthContext(req);
    if (!ctx) return jsonError(req, 401, "unauthorized", "Authentication required");
    if (!requirePermission(ctx, "view_financials")) {
      return jsonError(req, 403, "forbidden", "view_financials permission required");
    }
    tenantFilter = ctx.tenantId;

    // Optional body: { as_of?: 'YYYY-MM-DD' }
    try {
      const body = await req.json();
      if (body.as_of) asOfDate = body.as_of;
    } catch { /* empty body is fine */ }
  }

  // Fetch all active tenants (or just the caller's tenant for manual invocation)
  let tenantQuery = supabase.from("tenants").select("id, name").eq("is_active", true).is("deleted_at", null);
  if (tenantFilter) {
    tenantQuery = tenantQuery.eq("id", tenantFilter);
  }
  const { data: tenants, error: tenantsError } = await tenantQuery;

  if (tenantsError) {
    console.error("[run-overdue-scan] Failed to fetch tenants:", tenantsError);
    return jsonError(req, 500, "tenants_fetch_failed", tenantsError.message);
  }

  const summary = {
    tenants_scanned: 0,
    total_overdue_installments: 0,
    total_overdue_amount: 0,
    alerts_created: 0,
    by_priority: { urgent: 0, high: 0, medium: 0 },
    as_of: asOfDate,
  };

  for (const tenant of tenants ?? []) {
    summary.tenants_scanned++;

    // Call the run_overdue_scan RPC
    const { data: overdueItems, error: scanError } = await supabase.rpc("run_overdue_scan", {
      p_tenant_id: tenant.id,
      p_as_of: asOfDate,
    });

    if (scanError) {
      console.error(`[run-overdue-scan] Scan failed for tenant ${tenant.id}:`, scanError);
      continue;
    }

    for (const item of overdueItems ?? []) {
      summary.total_overdue_installments++;
      summary.total_overdue_amount += parseFloat(item.amount_overdue);

      // Determine priority based on days overdue
      let priority: "urgent" | "high" | "medium";
      if (item.days_overdue > 90) {
        priority = "urgent";
        summary.by_priority.urgent++;
      } else if (item.days_overdue > 30) {
        priority = "high";
        summary.by_priority.high++;
      } else {
        priority = "medium";
        summary.by_priority.medium++;
      }

      // Idempotency check: skip if a notification already exists for this installment
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("link_entity_type", "installment")
        .eq("link_entity_id", item.installment_id)
        .eq("source", "system")
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Fetch parent info for the notification title
      const { data: parent } = await supabase
        .from("parents")
        .select("first_name, last_name")
        .eq("id", item.parent_id)
        .single();

      const parentName = parent ? `${parent.last_name} ${parent.first_name}` : "Famille";

      // Insert the notification
      const { error: notifError } = await supabase.from("notifications").insert({
        tenant_id: tenant.id,
        kind: "alert",
        title: `Retard de paiement — ${parentName}`,
        body: `Tranche en retard de ${item.days_overdue} jours. Montant dû: ${parseFloat(item.amount_overdue).toLocaleString("fr-DZ")} DZD`,
        priority,
        source: "system",
        source_label: "Module Finances — Retards auto",
        target_role: "financial_officer",
        link_entity_type: "installment",
        link_entity_id: item.installment_id,
        triggered_at: new Date().toISOString(),
      });

      if (!notifError) {
        summary.alerts_created++;
      }
    }

    // Audit log per tenant
    await writeAuditLog(
      tenant.id,
      "overdue_scan.run",
      "tenant",
      tenant.id,
      null,
      "system",
      null,
      { as_of: asOfDate, overdue_count: overdueItems?.length ?? 0 },
      `Automated overdue scan completed`,
      requestId
    );
  }

  return jsonOk(req, summary);
});
