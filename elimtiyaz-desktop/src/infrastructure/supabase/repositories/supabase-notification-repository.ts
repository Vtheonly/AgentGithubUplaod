/**
 * SupabaseNotificationRepository — Supabase-backed implementation of the
 * `NotificationRepository` domain contract (plan §13.02 — Notifications).
 *
 * Table (source of truth = `supabase/migrations/0013_calendar_notifications_backup.sql`):
 *   `notifications` — kind / priority / source / source_label / target_user_id /
 *   target_role / is_read / read_at / dismissed_at / triggered_at / expires_at /
 *   link_entity_type / link_entity_id / created_by.
 *
 * Reactive reads follow the same pattern as the other Supabase repositories
 * (`supabase-shared-repositories.ts`): an in-memory `SubjectBehavior` cache is
 * seeded on first subscription and refreshed after every successful write, so
 * React's `useSyncExternalStore`-based `useObservable` hook keeps working.
 *
 * MAPPING NOTES (documented limitations):
 *   1. `kind` vs domain `type` — the DB `kind` column is a coarse visual
 *      category (alert/info/warning/success/error/system) while the domain
 *      `NotificationType` is finer-grained (payment_overdue, homework, …).
 *      The mapping below is lossy in both directions; a future migration
 *      adding a `domain_type` column would make it 1:1.
 *   2. `dismissed_at` — dismissed notifications are hidden from the feed
 *      (soft-dismiss) instead of hard-deleted, matching the migration comment
 *      ("dismissed hides it permanently"). `clear()` soft-dismisses every
 *      visible notification of the tenant.
 *   3. `triggered_at` — NOT NULL in the DB. When it equals `created_at`
 *      (both default to the same transaction `now()`) the notification is
 *      considered immediate and the domain `triggeredAt` is reported as null,
 *      matching the mock behaviour (no "Déclencheur" line in the UI).
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides the
 * mock `notifications` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NotificationRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type { Role } from "../../../core/rbac/roles";
import type {
  AppNotification,
  CreateAlertInput,
  NotificationType,
} from "../../../domain/model/operations";
import { isAlertVisibleTo } from "../../../domain/model/operations";
import type { NotificationRow } from "../types";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Domain type ↔ DB kind mapping (lossy — see header note 1)
// ============================================================================

const TYPE_TO_KIND: Record<NotificationType, NotificationRow["kind"]> = {
  payment_overdue: "alert",
  expense_pending: "warning",
  attendance_alert: "warning",
  homework: "info",
  audit: "system",
  system: "system",
  message: "info",
  custom: "alert",
};

const KIND_TO_TYPE: Record<NotificationRow["kind"], NotificationType> = {
  alert: "custom",
  // "warning" is produced by payment_overdue (most common) and
  // expense_pending — we resolve to the dominant producer.
  warning: "payment_overdue",
  info: "message",
  success: "message",
  error: "message",
  system: "system",
};

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Row → domain mapper
// ============================================================================

function mapNotificationRow(row: Record<string, any>): AppNotification {
  const kind = (row.kind ?? "system") as NotificationRow["kind"];
  const targetRole = row.target_role as Role | null;
  // triggered_at === created_at ⇔ immediate notification (see header note 3).
  const isImmediate = row.triggered_at === row.created_at;

  return {
    id: row.id,
    title: row.title,
    body: row.body ?? "",
    type: KIND_TO_TYPE[kind] ?? "custom",
    priority: row.priority,
    source: row.source,
    sourceLabel: row.source_label ?? "",
    entityType: row.link_entity_type ?? null,
    entityId: row.link_entity_id ?? null,
    targetUserId: row.target_user_id ?? null,
    targetRole,
    triggeredAt: isImmediate ? null : (row.triggered_at ?? null),
    readAt: row.is_read ? (row.read_at ?? null) : null,
    createdAt: row.created_at,
    createdBy: row.created_by ?? "system",
  };
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseNotificationRepository implements NotificationRepository {
  private readonly cache = new SubjectBehavior<AppNotification[]>([]);
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  /**
   * Seed the reactive cache from the `notifications` table. Dismissed
   * notifications are permanently hidden (migration 0013 semantics).
   */
  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("notifications")
        .select("*")
        .eq("tenant_id", getTenantId())
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      this.cache.set((data ?? []).map(mapNotificationRow));
    } catch {
      // Silently degrade to the current cache — the alerts tab shows
      // "no notifications" rather than crashing.
    }
  }

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  observe(): Observable<AppNotification[]> {
    this.seed();
    return this.cache;
  }

  /**
   * Session-filtered stream — broadcast + user-targeted + role-targeted
   * alerts, using the canonical domain predicate `isAlertVisibleTo`.
   */
  observeForSession(session: {
    userId: string;
    role: Role;
  }): Observable<AppNotification[]> {
    this.seed();
    return derived([this.cache], () =>
      this.cache.get().filter((n) => isAlertVisibleTo(n, session)),
    );
  }

  async markRead(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("notifications")
      .update({ is_read: true, read_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId());

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  async markAllRead(): Promise<Result<void>> {
    const { error } = await this.client
      .from("notifications")
      .update({ is_read: true, read_at: nowIso() })
      .eq("tenant_id", getTenantId())
      .is("dismissed_at", null)
      .eq("is_read", false);

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  /**
   * Clear the feed. The mock implementation hard-deletes every row; here we
   * soft-dismiss (set `dismissed_at`) so the append-only-ish history stays in
   * Postgres for audit purposes while disappearing from every client.
   */
  async clear(): Promise<Result<void>> {
    const { error } = await this.client
      .from("notifications")
      .update({ dismissed_at: nowIso() })
      .eq("tenant_id", getTenantId())
      .is("dismissed_at", null);

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  async dismiss(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("notifications")
      .update({ dismissed_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId());

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  /**
   * Manually create a custom alert (Alert Creator modal). Mirrors the mock:
   * source is always "manual", optional fields default to null.
   */
  async create(input: CreateAlertInput): Promise<Result<AppNotification>> {
    const createdAt = nowIso();
    const { data, error } = await this.client
      .from("notifications")
      .insert({
        tenant_id: getTenantId(),
        kind: TYPE_TO_KIND[input.type] ?? "alert",
        title: input.title,
        body: input.body,
        priority: input.priority,
        source: "manual",
        source_label: input.sourceLabel || "Alerte manuelle",
        target_user_id: isUuid(input.targetUserId) ? input.targetUserId : null,
        target_role: input.targetRole ?? null,
        // triggered_at NOT NULL — same value as created_at marks "immediate".
        triggered_at: input.triggeredAt ?? createdAt,
        link_entity_type: input.entityType ?? null,
        link_entity_id: isUuid(input.entityId) ? input.entityId : null,
        created_by: isUuid(input.createdBy) ? input.createdBy : null,
      })
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    const notification = mapNotificationRow(data);
    this.cache.set([notification, ...this.cache.get()]);
    return Ok(notification);
  }

  async update(
    id: string,
    updates: Partial<Omit<AppNotification, "id" | "createdAt">>,
  ): Promise<Result<AppNotification>> {
    const patch: Record<string, unknown> = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.body !== undefined) patch.body = updates.body;
    if (updates.type !== undefined) patch.kind = TYPE_TO_KIND[updates.type];
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.sourceLabel !== undefined)
      patch.source_label = updates.sourceLabel;
    if (updates.targetUserId !== undefined)
      patch.target_user_id = isUuid(updates.targetUserId)
        ? updates.targetUserId
        : null;
    if (updates.targetRole !== undefined) patch.target_role = updates.targetRole;
    if (updates.entityType !== undefined)
      patch.link_entity_type = updates.entityType;
    if (updates.entityId !== undefined)
      patch.link_entity_id = isUuid(updates.entityId) ? updates.entityId : null;
    if (updates.triggeredAt !== undefined)
      patch.triggered_at = updates.triggeredAt ?? nowIso();
    if (updates.readAt !== undefined) {
      patch.is_read = updates.readAt !== null;
      patch.read_at = updates.readAt;
    }

    if (Object.keys(patch).length === 0) {
      const current = this.cache.get().find((n) => n.id === id);
      if (!current) return Err(Errors.notFound("Notification", id));
      return Ok(current);
    }

    const { data, error } = await this.client
      .from("notifications")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    const notification = mapNotificationRow(data);
    this.cache.set(
      this.cache
        .get()
        .map((n) => (n.id === id ? notification : n)),
    );
    return Ok(notification);
  }
}
