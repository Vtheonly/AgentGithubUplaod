// ============================================================================
// run-overdue-scan/index.ts
// ============================================================================
// Scheduled Edge Function: Scan overdue installments + generate alerts
// ----------------------------------------------------------------------------
// Triggered daily at 08:00 UTC by Supabase Cron (see config.toml).
// Also callable manually via POST from the Installment Schedule tab's
// "Scan retards" button.
//
// CANONICAL ENGINE INVOCATION (Tier 3 fix, migration 0034 + 0035):
//   Previously this edge function called `public.run_overdue_scan(tenant_id,
//   as_of_date)` — a divergent SQL RPC that filtered installments by
//   `status IN ('unpaid', 'partial')` (excluding the canonical 'overdue'
//   status) and computed `amount_overdue = amount_due - amount_paid`
//   without considering parent_credit auto-absorb.
//
//   Migration 0034 dropped `run_overdue_scan` (correct signature) but
//   forgot to update this edge function — it would have failed at runtime
//   after 0034 was applied.
//
//   Tier 3 fix: this edge function now:
//     1. Fetches all parents in the tenant
//     2. For each parent, calls the canonical `compute_parent_summary` RPC
//     3. If `total_overdue > 0`, drills down to find the specific overdue
//        installments by querying the installments table directly using
//        the canonical overdue classification (balance > 0.001 DZD AND
//        due_date < as_of_date)
//     4. For each overdue installment, creates an idempotent notification
//
//   The canonical overdue rule (INV-4 in CANONICAL-FINANCIAL-LOGIC.md):
//     account is overdue iff
//       (balance > 0.001 DZD) AND
//       (latestCharge.at < now) AND
//       (overdueDueDate[accountId] < now)
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

    // ========================================================================
    // CANONICAL OVERDUE DETECTION (Tier 3 fix)
    // ========================================================================
    // Instead of calling the dropped `run_overdue_scan` RPC, we:
    //   1. Fetch all parents in this tenant
    //   2. For each parent, call the canonical `compute_parent_summary` RPC
    //   3. If `total_overdue > 0`, drill down to find the specific overdue
    //      installments by querying the installments table directly.
    //
    // This is the canonical rule (INV-4): an account is overdue iff
    //   (balance > 0.001 DZD) AND
    //   (latestCharge.at < now) AND
    //   (overdueDueDate[accountId] < now)
    //
    // `compute_parent_summary` already applies this rule and reports
    // `total_overdue` per parent. We drill down to installments whose
    // due_date < as_of_date AND amount_due > amount_paid — these are the
    // specific tranches that contribute to the parent's total_overdue.
    // ========================================================================

    const { data: parents, error: parentsError } = await supabase
      .from("parents")
      .select("id, first_name, last_name")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null);

    if (parentsError) {
      console.error(`[run-overdue-scan] Failed to fetch parents for tenant ${tenant.id}:`, parentsError);
      continue;
    }

    for (const parent of parents ?? []) {
      // Call the canonical compute_parent_summary RPC
      const { data: summaryRows, error: summaryError } = await supabase.rpc(
        "compute_parent_summary",
        { p_parent_id: parent.id, p_as_of: asOfDate },
      );

      if (summaryError) {
        console.error(`[run-overdue-scan] compute_parent_summary failed for parent ${parent.id}:`, summaryError);
        continue;
      }

      const parentSummary = summaryRows && summaryRows.length > 0 ? summaryRows[0] : null;
      if (!parentSummary) continue;

      const totalOverdue = Number(parentSummary.total_overdue ?? 0);
      if (totalOverdue <= 0.001) continue; // canonical threshold (INV-4)

      // Drill down: find the specific overdue installments for this parent.
      // Canonical rule: due_date < as_of_date AND amount_due > amount_paid
      // (matches the canonical engine's installment-level overdue classification).
      const { data: overdueInstallments, error: installmentsError } = await supabase
        .from("installments")
        .select("id, parent_id, due_date, amount_due, amount_paid, status, category")
        .eq("parent_id", parent.id)
        .lt("due_date", asOfDate)
        .order("due_date", { ascending: true });

      if (installmentsError) {
        console.error(`[run-overdue-scan] Failed to fetch installments for parent ${parent.id}:`, installmentsError);
        continue;
      }

      for (const ins of overdueInstallments ?? []) {
        const amountDue = Number(ins.amount_due ?? 0);
        const amountPaid = Number(ins.amount_paid ?? 0);
        const amountOverdue = amountDue - amountPaid;

        // Canonical rule: only flag if amount_overdue > 0.001 DZD
        if (amountOverdue <= 0.001) continue;

        // Skip if installment is already fully paid or cancelled
        if (ins.status === "paid" || ins.status === "cancelled") continue;

        summary.total_overdue_installments++;
        summary.total_overdue_amount += amountOverdue;

        // Determine priority based on days overdue
        const dueDate = new Date(ins.due_date);
        const asOf = new Date(asOfDate);
        const daysOverdue = Math.floor((asOf.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        let priority: "urgent" | "high" | "medium";
        if (daysOverdue > 90) {
          priority = "urgent";
          summary.by_priority.urgent++;
        } else if (daysOverdue > 30) {
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
          .eq("link_entity_id", ins.id)
          .eq("source", "system")
          .limit(1);

        if (existing && existing.length > 0) continue;

        const parentName = `${parent.last_name} ${parent.first_name}`;

        // Insert the notification
        const { error: notifError } = await supabase.from("notifications").insert({
          tenant_id: tenant.id,
          kind: "alert",
          title: `Retard de paiement — ${parentName}`,
          body: `Tranche en retard de ${daysOverdue} jours. Montant dû: ${amountOverdue.toLocaleString("fr-DZ")} DZD`,
          priority,
          source: "system",
          source_label: "Module Finances — Retards auto",
          target_role: "financial_officer",
          link_entity_type: "installment",
          link_entity_id: ins.id,
          triggered_at: new Date().toISOString(),
        });

        if (!notifError) {
          summary.alerts_created++;
        }
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
      { as_of: asOfDate, overdue_count: summary.total_overdue_installments, alerts_created: summary.alerts_created },
      `Automated overdue scan completed (canonical compute_parent_summary)`,
      requestId,
    );
  }

  return jsonOk(req, summary);
});
