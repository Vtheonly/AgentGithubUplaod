// ============================================================================
// run-overdue-scan/index.ts
// ============================================================================
// Scheduled Edge Function: Scan overdue installments + generate alerts
// ----------------------------------------------------------------------------
// Triggered daily at 08:00 UTC by Supabase Cron (see config.toml).
// Also callable manually via POST from the Installment Schedule tab's
// "Scan retards" button.
//
// T-095 / BUG-NEW-004 REWRITE (batched, 2026-08-31):
//   The previous body looped EVERY parent (258 in production) calling the
//   heavy per-parent compute_parent_summary SQL RPC, then per overdue
//   installment ran a dedup SELECT before a single-row INSERT — 258+
//   sequential round trips, far beyond the edge worker's budget. The daily
//   cron and the manual scan both died with WORKER_RESOURCE_LIMIT before
//   writing the per-tenant audit entry.
//
//   This rewrite ports the BATCHED pattern of the desktop reference
//   implementation (`SupabaseOverdueAlertGenerator`, T-080/T-094
//   live-verified) — reuse, not a parallel implementation:
//     1. ONE overdue-installments query per tenant
//        (status ≠ paid/cancelled, due_date < as_of, amount_due −
//        amount_paid > 0.001 — the canonical INV-4 threshold).
//     2. ONE upcoming-due query (next 7 days) — the desktop reference's
//        second pass, now EF≡desktop.
//     3. ONE chunked parents fetch (display names).
//     4. ONE chunked dedup-key fetch (existing ACTIVE installment alerts) →
//        an in-memory Set — idempotent by link_entity_type='installment' +
//        link_entity_id, same key as the desktop.
//     5. ONE bulk INSERT of the new notifications.
//     6. Per-tenant audit entry (unchanged).
//
// T-172 (NOTIF-200) — ALERT LIFECYCLE (mirrored 1:1 in the desktop
// reference `SupabaseOverdueAlertGenerator`; equivalence is mandatory):
//     - The dedup key (step 4) counts ACTIVE alerts only
//       (`dismissed_at IS NULL`) — a dismissed/resolved alert no longer
//       blocks re-alerting if the installment becomes overdue again
//       (e.g. a payment is reverted).
//     - NEW step 5b: active installment alerts whose installment is NO
//       LONGER in the tracked set (paid / cancelled / no remaining
//       balance) are RESOLVED (dismissed_at = now) — the feed stays
//       truthful instead of accumulating permanently-unread rows (live
//       evidence 2026-09-05: 958 unread "Tranche en retard" alerts, none
//       ever resolved). Runs under service_role here — the authoritative
//       resolver; the desktop's client-side mirror is best-effort
//       (NOTIF-100 RLS blocks financial_officer sessions).
//
//   Semantic notes:
//     - The per-parent compute_parent_summary account-level gate is GONE:
//       the T-094-verified desktop reference classifies at the installment
//       level (due_date + remaining balance), and the equivalence
//       requirement is EF ≡ desktop reference.
//     - The EF (like its previous version) excludes 'cancelled'
//       installments; the desktop reference queries status ≠ 'paid' only —
//       a registered micro-divergence (the EF's rule is the stricter,
//       more correct one; see DRIFT note in change-log).
//
// SECURITY (SEC-105 fix, task T-004 — shared guard _shared/cron-auth.ts):
//   - Cron/internal invocation: `Authorization: Bearer <CRON_SECRET>`
//     (operator secret) or the project's service_role key (Supabase's
//     managed scheduler injects it). Full multi-tenant scan.
//   - Manual invocation: a user JWT — requires an authenticated, active
//     profile with the view_financials permission (resolved through the
//     caller-scoped client since T-068); scans ONLY the caller's tenant.
//   - A request with NO Authorization header is DENIED (401).
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { isCronInvocation } from "../_shared/cron-auth.ts";
import { createServiceRoleClient, extractAuthContext, requirePermission, withAuditSurfacing, writeAuditLog } from "../_shared/supabase.ts";

interface InstallmentRow {
  id: string;
  parent_id: string;
  category: string | null;
  label: string | null;
  tranche_number: number | null;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  due_date: string;
  status: string | null;
}

interface ParentRow {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

function formatParentName(p: ParentRow): string {
  // Production artifact (F-06): first_name is empty on all 258 rows —
  // display_name carries the real name (same fallback chain as the desktop).
  return (p.display_name || p.last_name || p.id).trim();
}

Deno.serve(withAuditSurfacing(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const supabase = createServiceRoleClient();

  // Determine the invocation kind (SEC-105 fix):
  //   - cron/internal: Authorization matches CRON_SECRET or the service_role
  //     key (see _shared/cron-auth.ts) → full multi-tenant scan.
  //   - manual: any other Bearer token → treated as a user JWT below
  //     (extractAuthContext + view_financials permission, tenant-filtered).
  //   - NO Authorization header → 401 (anonymous requests never execute).
  const isCron = isCronInvocation(req);

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
    alerts_resolved: 0,
    by_priority: { urgent: 0, high: 0, medium: 0 } as { urgent: number; high: number; medium: number },
    upcoming_due_alerts: 0,
    audit_failures: 0,
    as_of: asOfDate,
  };

  const CHUNK = 100; // PostgREST IN-list safety (same chunk size as the desktop)

  for (const tenant of tenants ?? []) {
    summary.tenants_scanned++;

    // ── 1. ONE query: overdue installments (canonical INV-4 threshold) ──
    const { data: overdueRows, error: overdueError } = await supabase
      .from("installments")
      .select("id, parent_id, category, label, tranche_number, amount_due, amount_paid, due_date, status")
      .eq("tenant_id", tenant.id)
      .neq("status", "paid")
      .neq("status", "cancelled")
      .lt("due_date", asOfDate)
      .order("due_date", { ascending: true })
      .limit(2000);

    if (overdueError) {
      console.error(`[run-overdue-scan] overdue query failed for tenant ${tenant.id}:`, overdueError);
      continue;
    }

    // ── 2. ONE query: upcoming-due installments (next 7 days) ────────────
    const soonDate = new Date(new Date(asOfDate).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const { data: upcomingRows, error: upcomingError } = await supabase
      .from("installments")
      .select("id, parent_id, category, label, tranche_number, amount_due, amount_paid, due_date, status")
      .eq("tenant_id", tenant.id)
      .neq("status", "paid")
      .neq("status", "cancelled")
      .gte("due_date", asOfDate)
      .lte("due_date", soonDate)
      .limit(2000);

    if (upcomingError) {
      // Non-fatal — proceed with the overdue-only scan (same as the desktop).
      console.error(`[run-overdue-scan] upcoming query failed for tenant ${tenant.id}:`, upcomingError);
    }

    const overdue = (overdueRows ?? []) as unknown as InstallmentRow[];
    const upcoming = (upcomingRows ?? []) as unknown as InstallmentRow[];

    const asOfMs = new Date(asOfDate).getTime();

    // Filter to rows with a real remaining balance (> 0.001 DZD, INV-4).
    const overdueWithBalance = overdue.filter((r) => {
      const remaining = Number(r.amount_due ?? 0) - Number(r.amount_paid ?? 0);
      return remaining > 0.001;
    });
    const upcomingWithBalance = upcoming.filter((r) => {
      const remaining = Number(r.amount_due ?? 0) - Number(r.amount_paid ?? 0);
      return remaining > 0.001;
    });

    for (const r of overdueWithBalance) {
      summary.total_overdue_installments++;
      summary.total_overdue_amount += Number(r.amount_due ?? 0) - Number(r.amount_paid ?? 0);
      // by_priority counts ALL overdue installments (the original summary
      // semantic), regardless of whether an alert already exists for them.
      const days = Math.floor((asOfMs - new Date(r.due_date).getTime()) / 86_400_000);
      if (days > 90) summary.by_priority.urgent++;
      else if (days > 30) summary.by_priority.high++;
      else summary.by_priority.medium++;
    }

    // ── 3. ONE chunked fetch: parent display names ────────────────────────
    const parentIds = [...new Set([...overdueWithBalance, ...upcomingWithBalance].map((r) => r.parent_id).filter(Boolean))];
    const parentMap = new Map<string, ParentRow>();
    for (let i = 0; i < parentIds.length; i += CHUNK) {
      const chunk = parentIds.slice(i, i + CHUNK);
      const { data: parents, error: parentsError } = await supabase
        .from("parents")
        .select("id, display_name, first_name, last_name")
        .eq("tenant_id", tenant.id)
        .in("id", chunk);
      if (parentsError) {
        console.error(`[run-overdue-scan] parents fetch failed for tenant ${tenant.id}:`, parentsError);
        continue;
      }
      for (const p of (parents ?? []) as unknown as ParentRow[]) parentMap.set(p.id, p);
    }

    // ── 4. ONE chunked fetch: existing ACTIVE dedup keys ────────────────────
    // T-172 (NOTIF-200): dismissed/resolved alerts are EXCLUDED so a
    // resolved alert does not block re-alerting when the installment
    // becomes overdue again (payment reverted / balance restored).
    const installmentIds = [...overdueWithBalance, ...upcomingWithBalance].map((r) => r.id);
    const existingKeys = new Set<string>();
    for (let i = 0; i < installmentIds.length; i += CHUNK) {
      const chunk = installmentIds.slice(i, i + CHUNK);
      const { data: existing, error: existingError } = await supabase
        .from("notifications")
        .select("link_entity_id")
        .eq("tenant_id", tenant.id)
        .eq("link_entity_type", "installment")
        .is("dismissed_at", null)
        .in("link_entity_id", chunk);
      if (existingError) {
        console.error(`[run-overdue-scan] dedup fetch failed for tenant ${tenant.id}:`, existingError);
        continue;
      }
      for (const row of (existing ?? []) as { link_entity_id: string | null }[]) {
        if (row.link_entity_id) existingKeys.add(row.link_entity_id);
      }
    }

    // ── 4b. T-172 (NOTIF-200): resolve ACTIVE alerts whose installment left ──
    // the tracked set (paid / cancelled / no remaining balance). Mirrors the
    // desktop reference's resolveStaleAlerts 1:1. Service-role context here →
    // the authoritative resolver (RLS cannot block it).
    const trackedIds = new Set<string>(installmentIds);
    try {
      const { data: activeAlerts, error: activeAlertsError } = await supabase
        .from("notifications")
        .select("id, link_entity_id")
        .eq("tenant_id", tenant.id)
        .eq("link_entity_type", "installment")
        .is("dismissed_at", null)
        .limit(2000);
      if (activeAlertsError) {
        console.error(`[run-overdue-scan] stale-alerts fetch failed for tenant ${tenant.id}:`, activeAlertsError);
      } else {
        const staleIds = ((activeAlerts ?? []) as { id: string; link_entity_id: string | null }[])
          .filter((r) => r.link_entity_id && !trackedIds.has(r.link_entity_id))
          .map((r) => r.id);
        for (let i = 0; i < staleIds.length; i += CHUNK) {
          const chunk = staleIds.slice(i, i + CHUNK);
          const { error: dismissError } = await supabase
            .from("notifications")
            .update({ dismissed_at: new Date().toISOString() })
            .in("id", chunk);
          if (dismissError) {
            console.error(`[run-overdue-scan] stale-alert resolution failed for tenant ${tenant.id}:`, dismissError);
          } else {
            summary.alerts_resolved += chunk.length;
          }
        }
      }
    } catch (resolveErr) {
      console.error(`[run-overdue-scan] stale-alert resolution error for tenant ${tenant.id}:`, resolveErr);
    }

    // ── 5. Build the notification rows (desktop-reference message shape) ──
    const nowIso = new Date().toISOString();
    const toCreate: Record<string, unknown>[] = [];

    for (const ins of overdueWithBalance) {
      if (existingKeys.has(ins.id)) continue;
      const remaining = Number(ins.amount_due ?? 0) - Number(ins.amount_paid ?? 0);
      const daysOverdue = Math.floor((asOfMs - new Date(ins.due_date).getTime()) / 86_400_000);
      const priority: "urgent" | "high" | "medium" =
        daysOverdue > 90 ? "urgent" : daysOverdue > 30 ? "high" : "medium";
      const parent = parentMap.get(ins.parent_id);
      const parentName = parent ? formatParentName(parent) : ins.parent_id;
      toCreate.push({
        tenant_id: tenant.id,
        kind: "alert",
        title: `Tranche en retard — ${parentName}`,
        body: `${ins.label ?? "Tranche"} (${ins.category ?? "—"}) — ${remaining.toLocaleString("fr-FR")} DZD en retard depuis ${daysOverdue} jour${daysOverdue > 1 ? "s" : ""}.`,
        priority,
        source: "system",
        source_label: "Module Finances — Retards auto",
        target_user_id: null,
        target_role: "financial_officer",
        triggered_at: nowIso,
        link_entity_type: "installment",
        link_entity_id: ins.id,
        created_by: null,
      });
    }

    for (const ins of upcomingWithBalance) {
      if (existingKeys.has(ins.id)) continue;
      const remaining = Number(ins.amount_due ?? 0) - Number(ins.amount_paid ?? 0);
      const daysUntil = Math.ceil((new Date(ins.due_date).getTime() - asOfMs) / 86_400_000);
      const parent = parentMap.get(ins.parent_id);
      const parentName = parent ? formatParentName(parent) : ins.parent_id;
      toCreate.push({
        tenant_id: tenant.id,
        kind: "alert",
        title: `Échéance proche — ${parentName}`,
        body: `${ins.label ?? "Tranche"} (${ins.category ?? "—"}) — ${remaining.toLocaleString("fr-FR")} DZD à régler dans ${daysUntil} jour${daysUntil > 1 ? "s" : ""} (échéance ${ins.due_date}).`,
        priority: "medium",
        source: "system",
        source_label: "Module Finances — Échéancier auto",
        target_user_id: null,
        target_role: "financial_officer",
        triggered_at: nowIso,
        link_entity_type: "installment",
        link_entity_id: ins.id,
        created_by: null,
      });
    }

    // ── 6. ONE bulk INSERT ─────────────────────────────────────────────────
    if (toCreate.length > 0) {
      const { error: insertError } = await supabase.from("notifications").insert(toCreate);
      if (insertError) {
        console.error(`[run-overdue-scan] bulk insert failed for tenant ${tenant.id}:`, insertError);
      } else {
        const overdueCreated = toCreate.filter((n) => (n.title as string).startsWith("Tranche en retard")).length;
        summary.alerts_created += overdueCreated;
        summary.upcoming_due_alerts += toCreate.length - overdueCreated;
      }
    }

    // ── 7. Per-tenant audit entry (unchanged contract) ─────────────────────
    // T-055 (SEC-001): writeAuditLog now retries once and THROWS on final
    // failure. Here the failure is CAUGHT and COUNTED (audit_failures in the
    // response) instead of failing the whole scan AFTER the notifications
    // were created — surfaced, not swallowed, and the scan summary survives.
    try {
      await writeAuditLog(
        tenant.id,
        "overdue_scan.run",
        "tenant",
        tenant.id,
        null,
        "system",
        null,
        {
          as_of: asOfDate,
          overdue_count: summary.total_overdue_installments,
          alerts_created: summary.alerts_created,
          alerts_resolved: summary.alerts_resolved,
          upcoming_alerts: summary.upcoming_due_alerts,
        },
        `Automated overdue scan completed (batched, canonical installment classification, stale-alert resolution)`,
        requestId,
      );
    } catch (auditErr) {
      summary.audit_failures++;
      console.error(`[AUDIT-MISS] run-overdue-scan tenant ${tenant.id}:`, auditErr);
    }
  }

  return jsonOk(req, summary);
}));
