/**
 * Mock notification repository + overdue alert generator.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including the iteration 9
 * session-filtered stream and the idempotent overdue alert generator.
 */
import type {
  NotificationRepository,
  OverdueAlertGenerator,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { Role } from "../../../core/rbac/roles";
import { SubjectBehavior } from "../subject-behavior";
import type {
  AppNotification,
  CreateAlertInput,
  AlertPriority,
} from "../../../domain/model/operations";
import { store, appendAudit, nowIso, delay } from "./mock-store";
import { mockInstallmentRepository } from "./financial-repository";

export class MockNotificationRepository implements NotificationRepository {
  observe(): Observable<AppNotification[]> {
    return store.notifications$;
  }

  /**
   * Iteration 9 — session-filtered stream.
   *
   * Returns only alerts the given session is allowed to see:
   *   - Broadcast alerts (no targetUserId, no targetRole)
   *   - Alerts explicitly targeted at this user
   *   - Alerts targeted at this user's role
   */
  observeForSession(session: { userId: string; role: Role }): Observable<AppNotification[]> {
    const filtered = store.notifications.filter((n) => {
      if (n.targetUserId && n.targetRole) {
        return n.targetUserId === session.userId || n.targetRole === session.role;
      }
      if (n.targetUserId) return n.targetUserId === session.userId;
      if (n.targetRole) return n.targetRole === session.role;
      return true;
    });
    return new SubjectBehavior<AppNotification[]>(filtered);
  }

  async markRead(id: string): Promise<Result<void>> {
    store.notifications = store.notifications.map((n) =>
      n.id === id ? { ...n, readAt: nowIso() } : n,
    );
    store.notifyNotifications();
    return Ok(undefined);
  }

  async markAllRead(): Promise<Result<void>> {
    store.notifications = store.notifications.map((n) => ({ ...n, readAt: nowIso() }));
    store.notifyNotifications();
    return Ok(undefined);
  }

  async clear(): Promise<Result<void>> {
    store.notifications = [];
    store.notifyNotifications();
    return Ok(undefined);
  }

  async dismiss(id: string): Promise<Result<void>> {
    store.notifications = store.notifications.filter((n) => n.id !== id);
    store.notifyNotifications();
    return Ok(undefined);
  }

  /**
   * Iteration 9 — manually create a custom alert.
   *
   * Generates a stable id, applies default values for optional fields,
   * and appends to the reactive stream. Writes an audit entry so manual
   * alerts are traceable to their creator.
   */
  async create(input: CreateAlertInput): Promise<Result<AppNotification>> {
    await delay(150);
    const notification: AppNotification = {
      id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: input.title,
      body: input.body,
      type: input.type,
      priority: input.priority,
      source: "manual",
      sourceLabel: input.sourceLabel || "Alerte manuelle",
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      targetUserId: input.targetUserId ?? null,
      targetRole: input.targetRole ?? null,
      triggeredAt: input.triggeredAt ?? null,
      readAt: null,
      createdAt: nowIso(),
      createdBy: input.createdBy,
    };
    store.notifications = [notification, ...store.notifications];
    store.notifyNotifications();
    appendAudit({
      action: "alert.create",
      entityType: "notification",
      entityId: notification.id,
      actorId: input.createdBy,
      actorName: "Session courante",
      diff: { before: null, after: { title: input.title, priority: input.priority } },
      note: input.body.slice(0, 120),
    });
    return Ok(notification);
  }

  async update(id: string, updates: Partial<Omit<AppNotification, "id" | "createdAt">>): Promise<Result<AppNotification>> {
    await delay(120);
    const idx = store.notifications.findIndex((n) => n.id === id);
    if (idx < 0) return Err(Errors.notFound("Notification", id));
    const after: AppNotification = { ...store.notifications[idx], ...updates };
    store.notifications[idx] = after;
    store.notifyNotifications();
    appendAudit({
      action: "alert.update",
      entityType: "notification",
      entityId: id,
      actorId: "system",
      actorName: "Session courante",
      diff: { before: store.notifications[idx], after: updates },
    });
    return Ok(after);
  }
}

/**
 * Iteration 9 — automated overdue alert generator.
 *
 * Scans installments whose due date has passed without payment
 * confirmation and emits `payment_overdue` alerts. Idempotent: re-running
 * does NOT create duplicate alerts for the same installment — dedup key
 * is `entityType=installment` + `entityId=<installmentId>`.
 *
 * Priority rules:
 *   - >90 days overdue → urgent
 *   - 31–90 days → high
 *   - 0–30 days → medium
 */
export class MockOverdueAlertGenerator implements OverdueAlertGenerator {
  async run(now: Date = new Date()): Promise<Result<readonly AppNotification[]>> {
    const overdueResult = await mockInstallmentRepository.findOverdue(now);
    if (!overdueResult.ok) return overdueResult;
    const overdue = overdueResult.value;
    const created: AppNotification[] = [];

    // Build a set of installment IDs that already have an overdue alert.
    const existingAlertKeys = new Set(
      store.notifications
        .filter((n) => n.type === "payment_overdue" && n.entityType === "installment")
        .map((n) => n.entityId),
    );

    const nowMs = now.getTime();
    for (const ins of overdue) {
      if (existingAlertKeys.has(ins.id)) continue;
      const daysOverdue = Math.floor((nowMs - new Date(ins.dueDate).getTime()) / 86_400_000);
      const priority: AlertPriority = daysOverdue > 90 ? "urgent" : daysOverdue > 30 ? "high" : "medium";
      const parent = store.parents.find((p) => p.id === ins.parentId);
      const parentName = parent ? `${parent.firstName} ${parent.lastName}` : ins.parentId;
      const remaining = Math.max(0, ins.amountDue - ins.amountPaid);
      const notification: AppNotification = {
        id: `ntf-overdue-${ins.id}-${Date.now()}`,
        title: `Tranche en retard — ${parentName}`,
        body: `${ins.label} (${ins.category}) — ${remaining.toLocaleString("fr-FR")} DZD en retard depuis ${daysOverdue} jour${daysOverdue > 1 ? "s" : ""}.`,
        type: "payment_overdue",
        priority,
        source: "system",
        sourceLabel: "Module Finances — Retards auto",
        entityType: "installment",
        entityId: ins.id,
        targetUserId: null,
        targetRole: Role.FinancialOfficer,
        triggeredAt: null,
        readAt: null,
        createdAt: nowIso(),
        createdBy: "system",
      };
      store.notifications = [notification, ...store.notifications];
      created.push(notification);
    }
    if (created.length > 0) {
      store.notifyNotifications();
      appendAudit({
        action: "alert.overdue_auto_generated",
        entityType: "notification",
        entityId: "batch",
        actorId: "system",
        actorName: "Système",
        diff: { before: null, after: { count: created.length } },
        note: `${created.length} alerte(s) de retard générée(s) automatiquement.`,
      });
    }
    return Ok(created);
  }
}

// ============================================================================
// Singletons — exported for the barrel re-export in `mock-repositories.ts`.
// ============================================================================

export const mockNotificationRepository: NotificationRepository = new MockNotificationRepository();
export const mockOverdueAlertGenerator: OverdueAlertGenerator = new MockOverdueAlertGenerator();

// Re-export Observable + Role so consumers of this file don't need second imports.
export type { Observable };
