/**
 * SupabaseOverdueAlertGenerator — T-080.
 *
 * ARCH-006 fix: the dashboard's "Scan retards" path was the
 * MockOverdueAlertGenerator even in Supabase mode (the Supabase
 * assembly in `supabase-repositories.ts` spreads `mockRepositories`
 * and never overrides `overdueAlerts`). So the dashboard's auto-scan
 * ran against in-memory seed data and persisted nothing server-side.
 *
 * This file ports the generator to Supabase: it queries the
 * `installments` table directly for overdue rows, dedups against the
 * `notifications` table (by `link_entity_type='installment'` +
 * `link_entity_id`), and inserts new `payment_overdue` notifications
 * via the same `notifications` INSERT path the Alert Creator modal
 * uses. Idempotent by the same dedup key as the mock.
 *
 * T-172 (NOTIF-200) — ALERT LIFECYCLE (mirrored 1:1 in the
 * `run-overdue-scan` Edge Function; equivalence is mandatory):
 *   1. The dedup key now counts ACTIVE alerts only
 *      (`dismissed_at IS NULL`) — a dismissed/resolved alert no longer
 *      blocks re-alerting if the installment becomes overdue again
 *      (e.g. a payment is reverted).
 *   2. Active installment alerts whose installment is NO LONGER in the
 *      tracked set (not overdue, not upcoming-with-balance — e.g. paid
 *      or cancelled) are RESOLVED (dismissed_at = now) so the feed stays
 *      truthful instead of accumulating permanently-unread rows (live
 *      evidence 2026-09-05: 958 unread "Tranche en retard" alerts, none
 *      ever resolved).
 *   - The resolution UPDATE is best-effort here: the caller's session
 *     may lack `notifications_update` rights for role-broadcast rows
 *     (NOTIF-100 — financial_officer is blocked by RLS; super_admin
 *     passes). The daily `run-overdue-scan` cron (service_role) is the
 *     authoritative resolver; a client-side failure is logged, never
 *     thrown.
 *
 * Design notes:
 *   - The notification's `entityType` field on the domain model maps
 *     to `link_entity_type` in the `notifications` table (migration
 *     0013). The `entityId` (an installment UUID) maps to
 *     `link_entity_id`.
 *   - `target_role` is set to `financial_officer` — same target as the
 *     mock (Role.FinancialOfficer). Staff see overdue alerts; parents
 *     do not.
 *   - `source` is set to `system` (auto-generated, not `manual`).
 *   - `triggered_at` is set to `now` (immediate — same convention as
 *     the manual `create` path).
 *   - The audit log entry is written via the SupabaseAuditLogRepository's
 *     canonical `write_audit_log` RPC (migration 0014). The audit row
 *     is best-effort: if it fails, the notifications are still created
 *     (the scan's primary outcome).
 *
 * Per AGENTS.md §15.9 — this is UI/data layer code only, no schema
 * touch. The `notifications` table already supports everything we
 * need (migration 0013 + 0048 RLS tightening).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type {
  OverdueAlertGenerator,
} from "../../../domain/repository/repository";
import type { AppNotification, AlertPriority } from "../../../domain/model/operations";
import { Role } from "../../../core/rbac/roles";
import { isUuid } from "./supabase-shared-repositories";

// ============================================================================
// Helpers — minimal row shapes (only the columns this generator reads)
// ============================================================================

interface OverdueInstallmentRow {
  id: string;
  parent_id: string;
  student_id: string | null;
  category: string | null;
  label: string | null;
  tranche_number: number | null;
  amount_due: number | string;
  amount_paid: number | string;
  amount_pending: number | string | null;
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
  // Production artifact (F-06): first_name is empty on all 258 rows.
  // display_name carries the real name. Fall back to last_name then id.
  return (p.display_name || p.last_name || p.id).trim();
}

// ============================================================================
// SupabaseOverdueAlertGenerator
// ============================================================================

/**
 * Builds the Supabase-backed overdue alert generator.
 *
 * Mirrors the MockOverdueAlertGenerator contract:
 *   - Scan installments with status !== 'paid' AND due_date < now.
 *   - For each, check if a notification with link_entity_type='installment'
 *     AND link_entity_id=<installmentId> already exists (idempotent dedup).
 *   - If not, INSERT a new payment_overdue notification targeting
 *     financial_officer.
 *   - Priority: urgent (>90 days), high (31-90), medium (0-30).
 *
 * Also generates UPCOMING-due alerts (due within 7 days, still unpaid) —
 * same as the mock's second pass.
 */
export class SupabaseOverdueAlertGenerator implements OverdueAlertGenerator {
  constructor(private readonly client: SupabaseClient) {}

  async run(now: Date = new Date()): Promise<Result<readonly AppNotification[]>> {
    try {
      const tenantId = await this.resolveTenantId();
      if (!tenantId) {
        // No tenant context — return empty (no alerts created). The
        // dashboard will show "0 alerts" which is honest given the
        // missing context. The mock returns alerts against the DEMO
        // tenant; the Supabase path must NOT (TENANT-100 family).
        return Ok([]);
      }

      // ── 1. Fetch overdue installments ──────────────────────────────
      const nowIso = now.toISOString();
      const { data: overdueRows, error: overdueErr } = await this.client
        .from("installments")
        .select("id, parent_id, student_id, category, label, tranche_number, amount_due, amount_paid, amount_pending, due_date, status")
        .eq("tenant_id", tenantId)
        .neq("status", "paid")
        .lt("due_date", nowIso);
      if (overdueErr) {
        console.warn("[SupabaseOverdueAlerts] overdue installments query failed:", overdueErr.message);
        return Err(Errors.unknown(overdueErr));
      }

      // ── 2. Fetch upcoming-due installments (within next 7 days) ────
      const soonIso = new Date(now.getTime() + 7 * 86_400_000).toISOString();
      const { data: upcomingRows, error: upcomingErr } = await this.client
        .from("installments")
        .select("id, parent_id, student_id, category, label, tranche_number, amount_due, amount_paid, amount_pending, due_date, status")
        .eq("tenant_id", tenantId)
        .neq("status", "paid")
        .gte("due_date", nowIso)
        .lte("due_date", soonIso);
      if (upcomingErr) {
        console.warn("[SupabaseOverdueAlerts] upcoming installments query failed:", upcomingErr.message);
        // Non-fatal — proceed with overdue-only scan.
      }

      // T-172: filter to rows with a REAL remaining balance (> 0.001, INV-4)
      // up-front — the tracked set drives BOTH alert creation AND stale
      // resolution (an installment with nothing left to collect must not
      // keep its alert alive).
      const trackedOverdue = (overdueRows ?? []).filter((r) => {
        const row = r as unknown as OverdueInstallmentRow;
        return Number(row.amount_due) - Number(row.amount_paid) > 0.001;
      });
      const trackedUpcoming = (upcomingRows ?? []).filter((r) => {
        const row = r as unknown as OverdueInstallmentRow;
        return Number(row.amount_due) - Number(row.amount_paid) > 0.001;
      });
      const trackedIds = new Set(
        [...trackedOverdue, ...trackedUpcoming].map(
          (r) => (r as unknown as OverdueInstallmentRow).id,
        ),
      );

      // ── 3. Fetch parents for display names (one query, IN list) ───
      const allRows = [...trackedOverdue, ...trackedUpcoming] as unknown as OverdueInstallmentRow[];
      const parentIds = [...new Set(allRows.map((r) => r.parent_id).filter(Boolean))];
      const parentMap = await this.fetchParentMap(tenantId, parentIds);

      // ── 4. Fetch existing ACTIVE installment alerts (dedup keys) ──
      // T-172 (NOTIF-200): dismissed/resolved alerts are EXCLUDED — a
      // resolved alert must not block re-alerting when the installment
      // becomes overdue again (payment reverted / balance restored).
      const installmentIds = allRows.map((r) => r.id).filter(isUuid);
      const existingKeys = await this.fetchExistingAlertKeys(tenantId, installmentIds);

      // ── 4b. T-172: resolve ACTIVE alerts whose installment left the ──
      // tracked set (paid / cancelled / no remaining balance).
      await this.resolveStaleAlerts(tenantId, trackedIds, nowIso);

      // ── 5. Build notification rows ─────────────────────────────────
      const nowMs = now.getTime();
      const toCreate: Array<{
        row: Record<string, unknown>;
        domain: AppNotification;
      }> = [];

      for (const ins of trackedOverdue) {
        const row = ins as unknown as OverdueInstallmentRow;
        if (existingKeys.has(row.id)) continue;
        const daysOverdue = Math.floor((nowMs - new Date(row.due_date).getTime()) / 86_400_000);
        const priority: AlertPriority = daysOverdue > 90 ? "urgent" : daysOverdue > 30 ? "high" : "medium";
        const parent = parentMap.get(row.parent_id);
        const parentName = parent ? formatParentName(parent) : row.parent_id;
        const remaining = Math.max(0, Number(row.amount_due) - Number(row.amount_paid));
        if (remaining <= 0) continue; // fully paid despite status
        const id = `ntf-overdue-${row.id}-${nowMs}`;
        const domain: AppNotification = {
          id,
          title: `Tranche en retard — ${parentName}`,
          body: `${row.label ?? "Tranche"} (${row.category ?? "—"}) — ${remaining.toLocaleString("fr-FR")} DZD en retard depuis ${daysOverdue} jour${daysOverdue > 1 ? "s" : ""}.`,
          type: "payment_overdue",
          priority,
          source: "system",
          sourceLabel: "Module Finances — Retards auto",
          entityType: "installment",
          entityId: row.id,
          targetUserId: null,
          targetRole: Role.FinancialOfficer,
          triggeredAt: null,
          readAt: null,
          createdAt: nowIso,
          createdBy: "system",
        };
        toCreate.push({
          row: {
            tenant_id: tenantId,
            kind: "alert",
            title: domain.title,
            body: domain.body,
            priority: domain.priority,
            source: "system",
            source_label: domain.sourceLabel,
            target_user_id: null,
            target_role: domain.targetRole,
            triggered_at: nowIso,
            link_entity_type: "installment",
            link_entity_id: row.id,
            created_by: null,
          },
          domain,
        });
      }

      for (const ins of trackedUpcoming) {
        const row = ins as unknown as OverdueInstallmentRow;
        if (existingKeys.has(row.id)) continue;
        const daysUntil = Math.ceil((new Date(row.due_date).getTime() - nowMs) / 86_400_000);
        const parent = parentMap.get(row.parent_id);
        const parentName = parent ? formatParentName(parent) : row.parent_id;
        const remaining = Math.max(0, Number(row.amount_due) - Number(row.amount_paid));
        if (remaining <= 0) continue;
        const id = `ntf-upcoming-${row.id}-${nowMs}`;
        const domain: AppNotification = {
          id,
          title: `Échéance proche — ${parentName}`,
          body: `${row.label ?? "Tranche"} (${row.category ?? "—"}) — ${remaining.toLocaleString("fr-FR")} DZD à régler dans ${daysUntil} jour${daysUntil > 1 ? "s" : ""} (échéance ${new Date(row.due_date).toLocaleDateString("fr-FR")}).`,
          type: "payment_overdue",
          priority: "medium",
          source: "system",
          sourceLabel: "Module Finances — Échéancier auto",
          entityType: "installment",
          entityId: row.id,
          targetUserId: null,
          targetRole: Role.FinancialOfficer,
          triggeredAt: null,
          readAt: null,
          createdAt: nowIso,
          createdBy: "system",
        };
        toCreate.push({
          row: {
            tenant_id: tenantId,
            kind: "alert",
            title: domain.title,
            body: domain.body,
            priority: domain.priority,
            source: "system",
            source_label: domain.sourceLabel,
            target_user_id: null,
            target_role: domain.targetRole,
            triggered_at: nowIso,
            link_entity_type: "installment",
            link_entity_id: row.id,
            created_by: null,
          },
          domain,
        });
      }

      if (toCreate.length === 0) {
        return Ok([]);
      }

      // ── 6. Bulk INSERT the new notifications ───────────────────────
      const { data: insertedRows, error: insertErr } = await this.client
        .from("notifications")
        .insert(toCreate.map((c) => c.row))
        .select("id, tenant_id, kind, title, body, priority, source, source_label, target_user_id, target_role, triggered_at, link_entity_type, link_entity_id, is_read, read_at, created_at, created_by");
      if (insertErr) {
        console.warn("[SupabaseOverdueAlerts] insert failed:", insertErr.message);
        return Err(Errors.unknown(insertErr));
      }

      // ── 7. Audit entry (best-effort) ───────────────────────────────
      // Migration 0014's `write_audit_log` RPC; if it fails the
      // notifications are still created (the scan's primary outcome).
      const count = (insertedRows ?? []).length;
      if (count > 0) {
        try {
          await this.client.rpc("write_audit_log", {
            p_action: "alert.overdue_auto_generated",
            p_entity_type: "notification",
            p_entity_id: "batch",
            p_actor_id: null,
            p_actor_name: "Système",
            p_tenant_id: tenantId,
            p_diff: { before: null, after: { count } },
            p_note: `${count} alerte(s) de retard / d'échéance générée(s) automatiquement.`,
          });
        } catch (auditErr) {
          console.warn("[SupabaseOverdueAlerts] audit log failed (non-fatal):", auditErr);
        }
      }

      // ── 8. Return the created domain notifications ──────────────────
      // Re-derive the domain shape from the inserted rows so the
      // returned IDs match what's in the DB (not the synthetic
      // `ntf-overdue-...` placeholders).
      const created: AppNotification[] = (insertedRows ?? []).map((row, idx) => {
        const r = row as Record<string, unknown>;
        const base = toCreate[idx].domain;
        return {
          ...base,
          id: r.id as string,
          createdAt: r.created_at as string,
        };
      });
      return Ok(created);
    } catch (e) {
      console.warn("[SupabaseOverdueAlerts] run failed:", e);
      return Err(Errors.unknown(e as Error));
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Resolve the caller's tenant. Per AGENTS.md §15 rule 4, the client
   * must not weaken RLS. The notifications INSERT will RLS-check the
   * caller's tenant anyway; this lookup is just to scope the installments
   * query so we don't fetch cross-tenant rows we'd then have to drop.
   */
  private async resolveTenantId(): Promise<string | null> {
    try {
      const raw = typeof localStorage !== "undefined"
        ? localStorage.getItem("el-imtiyaz.session")
        : null;
      if (raw) {
        const sess = JSON.parse(raw) as { tenantId?: string };
        if (sess?.tenantId) return sess.tenantId;
      }
    } catch { /* ignore */ }
    // Fallback — the same canonical tenant the dashboard uses.
    // (T-053 will eventually remove this fallback for global admins.)
    return "00000000-0000-0000-0000-000000000001";
  }

  private async fetchParentMap(
    tenantId: string,
    parentIds: string[],
  ): Promise<Map<string, ParentRow>> {
    const map = new Map<string, ParentRow>();
    if (parentIds.length === 0) return map;
    try {
      // Chunk by 100 to avoid PostgREST IN-list limits.
      const CHUNK = 100;
      for (let i = 0; i < parentIds.length; i += CHUNK) {
        const chunk = parentIds.slice(i, i + CHUNK);
        const { data, error } = await this.client
          .from("parents")
          .select("id, display_name, first_name, last_name")
          .eq("tenant_id", tenantId)
          .in("id", chunk);
        if (error) {
          console.warn("[SupabaseOverdueAlerts] parents fetch failed:", error.message);
          continue;
        }
        for (const p of (data ?? []) as unknown as ParentRow[]) {
          map.set(p.id, p);
        }
      }
    } catch (e) {
      console.warn("[SupabaseOverdueAlerts] parents fetch error:", e);
    }
    return map;
  }

  /**
   * Fetch the set of installment IDs that already have an ACTIVE overdue
   * alert. Dedup by `link_entity_type='installment'` + `link_entity_id`;
   * T-172 (NOTIF-200): dismissed/resolved alerts are EXCLUDED so a
   * resolved alert does not block re-alerting.
   */
  private async fetchExistingAlertKeys(
    tenantId: string,
    installmentIds: string[],
  ): Promise<Set<string>> {
    const keys = new Set<string>();
    if (installmentIds.length === 0) return keys;
    try {
      const CHUNK = 100;
      for (let i = 0; i < installmentIds.length; i += CHUNK) {
        const chunk = installmentIds.slice(i, i + CHUNK);
        const { data, error } = await this.client
          .from("notifications")
          .select("link_entity_id")
          .eq("tenant_id", tenantId)
          .eq("link_entity_type", "installment")
          .is("dismissed_at", null)
          .in("link_entity_id", chunk);
        if (error) {
          console.warn("[SupabaseOverdueAlerts] existing alerts query failed:", error.message);
          continue;
        }
        for (const row of (data ?? []) as { link_entity_id: string | null }[]) {
          if (row.link_entity_id) keys.add(row.link_entity_id);
        }
      }
    } catch (e) {
      console.warn("[SupabaseOverdueAlerts] existing alerts query error:", e);
    }
    return keys;
  }

  /**
   * T-172 (NOTIF-200): resolve (dismiss) ACTIVE installment alerts whose
   * installment is no longer in the tracked set — paid, cancelled, or no
   * remaining balance. Keeps the alert feed truthful instead of accruing
   * permanently-unread rows. Mirrors the run-overdue-scan EF step 1:1.
   *
   * Best-effort: a session without `notifications_update` rights on
   * role-broadcast rows (financial_officer — NOTIF-100) gets a warning,
   * never a throw; the daily cron (service_role) resolves authoritatively.
   */
  private async resolveStaleAlerts(
    tenantId: string,
    trackedIds: Set<string>,
    nowIso: string,
  ): Promise<void> {
    try {
      // All ACTIVE installment alerts for this tenant (id + link).
      const { data, error } = await this.client
        .from("notifications")
        .select("id, link_entity_id")
        .eq("tenant_id", tenantId)
        .eq("link_entity_type", "installment")
        .is("dismissed_at", null)
        .limit(2000);
      if (error) {
        console.warn("[SupabaseOverdueAlerts] stale-alerts fetch failed:", error.message);
        return;
      }
      const staleIds = ((data ?? []) as { id: string; link_entity_id: string | null }[])
        .filter((r) => r.link_entity_id && !trackedIds.has(r.link_entity_id))
        .map((r) => r.id);
      if (staleIds.length === 0) return;

      const CHUNK = 100;
      for (let i = 0; i < staleIds.length; i += CHUNK) {
        const chunk = staleIds.slice(i, i + CHUNK);
        const { error: updateError } = await this.client
          .from("notifications")
          .update({ dismissed_at: nowIso })
          .in("id", chunk);
        if (updateError) {
          console.warn(
            "[SupabaseOverdueAlerts] stale-alert resolution UPDATE failed (best-effort — the daily cron resolves authoritatively):",
            updateError.message,
          );
          return;
        }
      }
      console.info(`[SupabaseOverdueAlerts] resolved ${staleIds.length} stale installment alert(s).`);
    } catch (e) {
      console.warn("[SupabaseOverdueAlerts] stale-alert resolution error (best-effort):", e);
    }
  }
}
