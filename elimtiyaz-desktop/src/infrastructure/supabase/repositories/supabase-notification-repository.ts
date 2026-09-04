/**
 * SupabaseNotificationRepository — notification & alert store backed by Supabase.
 *
 * Implements NotificationRepository with safe error recovery, statement-timeout
 * protection, and local cache fallback when the remote table or RLS hangs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { Ok, Err, type Result } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type { NotificationRepository, Observable } from "../../../domain/repository/repository";
import type {
  AppNotification,
  CreateAlertInput,
  NotificationType,
  AlertPriority,
  AlertSource,
} from "../../../domain/model/operations";
import type { Role } from "../../../core/rbac/roles";
import { isAlertVisibleTo } from "../../../domain/model/operations";
import { CacheFreshness } from "../cache-freshness";

const SESSION_DISABLED_KEY = "el-imtiyaz.notifications.disabled";

export class SupabaseNotificationRepository implements NotificationRepository {
  private cache: AppNotification[] = [];
  private readonly listeners = new Set<(items: AppNotification[]) => void>();
  private readonly freshness = new CacheFreshness();
  private remoteDisabled = false;
  private isSeeding = false;

  constructor(private readonly client: SupabaseClient) {
    // If previous queries timed out in this session, stay on local cache to prevent server hangs
    try {
      if (sessionStorage.getItem(SESSION_DISABLED_KEY) === "true") {
        this.remoteDisabled = true;
      }
    } catch {
      /* ignore */
    }
  }

  private getTenantId(): string {
    try {
      const raw = localStorage.getItem("el-imtiyaz.session");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.tenantId) return s.tenantId;
      }
    } catch {
      /* ignore */
    }
    return "00000000-0000-0000-0000-000000000001";
  }

  private emit(): void {
    const copy = [...this.cache];
    for (const l of this.listeners) {
      l(copy);
    }
  }

  private async seed(): Promise<void> {
    if (this.remoteDisabled || this.isSeeding || !this.freshness.shouldReseed()) {
      return;
    }
    this.isSeeding = true;
    this.freshness.markSeeded();

    const tenantId = this.getTenantId();
    try {
      // Abort controller with 2.5s timeout prevents hanging on Postgres statement timeouts
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const queryPromise = this.client
        .from("notifications")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100)
        .abortSignal(controller.signal);

      const { data, error } = await queryPromise;
      clearTimeout(timeoutId);

      if (error) {
        console.warn("[SupabaseNotification] Remote query error, disabling remote polling for this session:", error.message);
        this.disableRemote();
        return;
      }

      if (data && Array.isArray(data)) {
        this.cache = data.map((r: any) => ({
          id: r.id,
          title: r.title ?? "Alerte",
          body: r.body ?? "",
          type: (r.kind ?? r.type ?? "custom") as NotificationType,
          priority: (r.priority ?? "medium") as AlertPriority,
          source: (r.source ?? "system") as AlertSource,
          sourceLabel: r.source_label ?? "Système",
          entityType: r.link_entity_type ?? r.entity_type ?? null,
          entityId: r.link_entity_id ?? r.entity_id ?? null,
          targetUserId: r.target_user_id ?? null,
          targetRole: (r.target_role ?? null) as Role | null,
          triggeredAt: r.triggered_at ?? null,
          readAt: r.read_at ?? (r.is_read ? r.updated_at ?? r.created_at : null),
          createdAt: r.created_at ?? new Date().toISOString(),
          createdBy: r.created_by ?? "Système",
        }));
        this.emit();
      }
    } catch (err: any) {
      console.warn("[SupabaseNotification] Remote notification fetch timed out or failed. Falling back to local cache.");
      this.disableRemote();
    } finally {
      this.isSeeding = false;
    }
  }

  private disableRemote(): void {
    this.remoteDisabled = true;
    try {
      sessionStorage.setItem(SESSION_DISABLED_KEY, "true");
    } catch {
      /* ignore */
    }
  }

  observe(): Observable<AppNotification[]> {
    void this.seed();
    return {
      subscribe: (fn) => {
        this.listeners.add(fn);
        fn([...this.cache]);
        return () => {
          this.listeners.delete(fn);
        };
      },
      get: () => [...this.cache],
    };
  }

  observeForSession(session: { userId: string; role: Role }): Observable<AppNotification[]> {
    void this.seed();
    return {
      subscribe: (fn) => {
        const listener = (all: AppNotification[]) => {
          fn(all.filter((n) => isAlertVisibleTo(n, session)));
        };
        this.listeners.add(listener);
        listener(this.cache);
        return () => {
          this.listeners.delete(listener);
        };
      },
      get: () => this.cache.filter((n) => isAlertVisibleTo(n, session)),
    };
  }

  async markRead(id: string): Promise<Result<void>> {
    const now = new Date().toISOString();
    this.cache = this.cache.map((n) => (n.id === id ? { ...n, readAt: now } : n));
    this.emit();

    if (!this.remoteDisabled) {
      try {
        await this.client
          .from("notifications")
          .update({ is_read: true, read_at: now, updated_at: now })
          .eq("id", id);
      } catch {
        /* ignore */
      }
    }
    return Ok(undefined);
  }

  async markAllRead(): Promise<Result<void>> {
    const now = new Date().toISOString();
    this.cache = this.cache.map((n) => ({ ...n, readAt: n.readAt ?? now }));
    this.emit();

    if (!this.remoteDisabled) {
      try {
        const tenantId = this.getTenantId();
        await this.client
          .from("notifications")
          .update({ is_read: true, read_at: now, updated_at: now })
          .eq("tenant_id", tenantId)
          .eq("is_read", false);
      } catch {
        /* ignore */
      }
    }
    return Ok(undefined);
  }

  async clear(): Promise<Result<void>> {
    this.cache = [];
    this.emit();
    return Ok(undefined);
  }

  async dismiss(id: string): Promise<Result<void>> {
    this.cache = this.cache.filter((n) => n.id !== id);
    this.emit();

    if (!this.remoteDisabled) {
      try {
        await this.client.from("notifications").delete().eq("id", id);
      } catch {
        /* ignore */
      }
    }
    return Ok(undefined);
  }

  async create(input: CreateAlertInput): Promise<Result<AppNotification>> {
    const now = new Date().toISOString();
    const newAlert: AppNotification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: input.title,
      body: input.body,
      type: input.type,
      priority: input.priority,
      source: "manual",
      sourceLabel: input.sourceLabel,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      targetUserId: input.targetUserId ?? null,
      targetRole: input.targetRole ?? null,
      triggeredAt: input.triggeredAt ?? null,
      readAt: null,
      createdAt: now,
      createdBy: input.createdBy,
    };

    this.cache = [newAlert, ...this.cache];
    this.emit();

    if (!this.remoteDisabled) {
      try {
        await this.client.from("notifications").insert({
          id: newAlert.id,
          tenant_id: this.getTenantId(),
          title: newAlert.title,
          body: newAlert.body,
          kind: newAlert.type,
          priority: newAlert.priority,
          source: newAlert.source,
          source_label: newAlert.sourceLabel,
          link_entity_type: newAlert.entityType,
          link_entity_id: newAlert.entityId,
          target_user_id: newAlert.targetUserId,
          target_role: newAlert.targetRole,
          triggered_at: newAlert.triggeredAt ?? now,
          is_read: false,
          created_by: newAlert.createdBy,
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        console.warn("[SupabaseNotification] remote insert failed, preserved locally:", err);
      }
    }

    return Ok(newAlert);
  }

  async update(
    id: string,
    updates: Partial<Omit<AppNotification, "id" | "createdAt">>,
  ): Promise<Result<AppNotification>> {
    const existing = this.cache.find((n) => n.id === id);
    if (!existing) return Err(Errors.notFound("Notification", id));

    const updated = { ...existing, ...updates };
    this.cache = this.cache.map((n) => (n.id === id ? updated : n));
    this.emit();

    return Ok(updated);
  }
}