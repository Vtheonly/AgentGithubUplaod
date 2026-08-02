/**
 * Mock calendar repository — combines auto-generated events with manually
 * scheduled events.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including the iteration 9 logic
 * for auto-generating events from payments, audit entries, and expense
 * lifecycle events, plus the immutability of auto-generated events.
 */
import type {
  CalendarRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { SubjectBehavior } from "../subject-behavior";
import type {
  CalendarEvent,
  CreateCalendarEventInput,
  CalendarEventBase,
} from "../../../domain/model/calendar";
import { store, appendAudit, nowIso, delay } from "./mock-store";

export class MockCalendarRepository implements CalendarRepository {
  observeForDate(date: string): Observable<CalendarEvent[]> {
    return new SubjectBehavior<CalendarEvent[]>(this.getEventsForDate(date));
  }

  observeForMonth(yearMonth: string): Observable<CalendarEvent[]> {
    return new SubjectBehavior<CalendarEvent[]>(this.getEventsForMonth(yearMonth));
  }

  async create(input: CreateCalendarEventInput): Promise<Result<CalendarEvent>> {
    await delay(150);
    const id = `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const base: CalendarEventBase = {
      id,
      kind: input.kind,
      date: input.date,
      time: input.time,
      title: input.title,
      description: input.description ?? null,
      sourceLabel:
        input.kind === "follow_up_call"
          ? "Appel de suivi"
          : input.kind === "reminder"
            ? "Rappel"
            : input.kind === "meeting"
              ? "Réunion"
              : "Événement",
      priority: input.priority,
      createdBy: input.createdBy,
      assignedToUserId: input.assignedToUserId ?? null,
      assignedToRole: input.assignedToRole ?? null,
      createdAt: nowIso(),
    };
    let event: CalendarEvent;
    if (input.kind === "follow_up_call") {
      event = {
        ...base,
        kind: "follow_up_call",
        targetType: input.targetType ?? "other",
        targetId: input.targetId ?? null,
        targetName: input.targetName ?? "",
        phone: input.phone ?? null,
      };
    } else if (input.kind === "reminder") {
      event = {
        ...base,
        kind: "reminder",
        linkedEntityType: input.linkedEntityType ?? null,
        linkedEntityId: input.linkedEntityId ?? null,
      };
    } else if (input.kind === "meeting") {
      event = {
        ...base,
        kind: "meeting",
        location: input.location ?? null,
        attendeeCount: input.attendeeCount ?? 0,
      };
    } else {
      event = { ...base, kind: "custom" };
    }
    store.calendarEvents = [event, ...store.calendarEvents];
    store.notifyCalendarEvents();
    appendAudit({
      action: "calendar.event.create",
      entityType: "calendar_event",
      entityId: id,
      actorId: input.createdBy,
      actorName: "Session courante",
      diff: { before: null, after: { kind: input.kind, title: input.title } },
    });
    return Ok(event);
  }

  async update(id: string, updates: Partial<CreateCalendarEventInput>): Promise<Result<CalendarEvent>> {
    await delay(120);
    const idx = store.calendarEvents.findIndex((e) => e.id === id);
    if (idx < 0) return Err(Errors.notFound("CalendarEvent", id));
    const before = store.calendarEvents[idx];
    // Manual events only — auto-generated events are immutable.
    if (before.kind === "payment_received" || before.kind === "audit_log" || before.kind === "expense_event") {
      return Err(Errors.conflict("Cannot update auto-generated calendar event"));
    }
    const updated: CalendarEvent = {
      ...before,
      ...(updates.date ? { date: updates.date } : {}),
      ...(updates.time !== undefined ? { time: updates.time } : {}),
      ...(updates.title ? { title: updates.title } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.priority ? { priority: updates.priority } : {}),
      ...(updates.assignedToUserId !== undefined ? { assignedToUserId: updates.assignedToUserId } : {}),
      ...(updates.assignedToRole !== undefined ? { assignedToRole: updates.assignedToRole } : {}),
    } as CalendarEvent;
    store.calendarEvents[idx] = updated;
    store.notifyCalendarEvents();
    appendAudit({
      action: "calendar.event.update",
      entityType: "calendar_event",
      entityId: id,
      actorId: "system",
      actorName: "Session courante",
      diff: { before: { title: before.title }, after: updates },
    });
    return Ok(updated);
  }

  async delete(id: string): Promise<Result<void>> {
    await delay(100);
    const event = store.calendarEvents.find((e) => e.id === id);
    if (!event) return Err(Errors.notFound("CalendarEvent", id));
    if (event.kind === "payment_received" || event.kind === "audit_log" || event.kind === "expense_event") {
      return Err(Errors.conflict("Cannot delete auto-generated calendar event"));
    }
    store.calendarEvents = store.calendarEvents.filter((e) => e.id !== id);
    store.notifyCalendarEvents();
    appendAudit({
      action: "calendar.event.delete",
      entityType: "calendar_event",
      entityId: id,
      actorId: "system",
      actorName: "Session courante",
    });
    return Ok(undefined);
  }

  /**
   * Build the full event list for a date (YYYY-MM-DD).
   *
   * Combines:
   *   - Payments collected on that date (auto)
   *   - Audit entries on that date (auto)
   *   - Expense events on that date (auto)
   *   - Manually scheduled events on that date
   */
  private getEventsForDate(date: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];

    // Payments received
    for (const p of store.payments) {
      if (p.collectedAt.slice(0, 10) !== date) continue;
      if (p.status !== "paid" && p.status !== "partial") continue;
      const parent = store.parents.find((par) => par.id === p.parentId);
      const parentName = parent ? `${parent.firstName} ${parent.lastName}` : p.parentId;
      events.push({
        id: `cal-pay-${p.id}`,
        kind: "payment_received",
        date,
        time: p.collectedAt.slice(11, 16) || null,
        title: `Paiement — ${parentName}`,
        description: `${p.receiptNumber} · ${p.method}`,
        sourceLabel: "Module Finances",
        priority: "low",
        createdBy: p.collectedBy,
        assignedToUserId: null,
        assignedToRole: null,
        createdAt: p.createdAt,
        paymentId: p.id,
        receiptNumber: p.receiptNumber,
        parentId: p.parentId,
        parentName,
        amount: p.amount,
        method: p.method,
        category: p.category,
        collectedBy: p.collectedBy,
      });
    }

    // Audit entries (non-trivial mutations only — skip login/logout noise)
    for (const a of store.audit) {
      if (a.at.slice(0, 10) !== date) continue;
      if (a.action === "auth.login" || a.action === "auth.password_reset") continue;
      events.push({
        id: `cal-aud-${a.id}`,
        kind: "audit_log",
        date,
        time: a.at.slice(11, 16) || null,
        title: `${a.action} — ${a.entityType}`,
        description: a.note ?? `${a.actorName} a modifié ${a.entityType}/${a.entityId}`,
        sourceLabel: "Journal d'audit",
        priority: "low",
        createdBy: a.actorId,
        assignedToUserId: null,
        assignedToRole: null,
        createdAt: a.at,
        auditEntryId: a.id,
        action: a.action,
        actorName: a.actorName,
        entityType: a.entityType,
        entityId: a.entityId,
      });
    }

    // Expense events (submission, approval, disbursement)
    for (const e of store.expenses) {
      const dates: Array<{ ts: string; kind: "submit" | "approve" | "disburse" }> = [
        { ts: e.submittedAt, kind: "submit" },
        ...(e.approvedAt ? [{ ts: e.approvedAt, kind: "approve" as const }] : []),
        ...(e.disbursedAt ? [{ ts: e.disbursedAt, kind: "disburse" as const }] : []),
      ];
      for (const { ts, kind } of dates) {
        if (ts.slice(0, 10) !== date) continue;
        events.push({
          id: `cal-exp-${e.id}-${kind}`,
          kind: "expense_event",
          date,
          time: ts.slice(11, 16) || null,
          title: `${kind === "submit" ? "Soumission" : kind === "approve" ? "Approbation" : "Décaissement"} — ${e.title}`,
          description: `${e.requestCode} · ${e.amount.toLocaleString("fr-FR")} DZD`,
          sourceLabel: "Module Dépenses",
          priority: kind === "submit" ? "low" : "medium",
          createdBy:
            kind === "submit"
              ? e.submittedBy
              : kind === "approve"
                ? (e.approvedBy ?? "system")
                : (e.disbursedBy ?? "system"),
          assignedToUserId: null,
          assignedToRole: null,
          createdAt: ts,
          expenseId: e.id,
          expenseStatus: e.status,
          amount: e.amount,
          actorName:
            kind === "submit" ? "Soumetteur" : kind === "approve" ? "Approbateur" : "Caissier",
        });
      }
    }

    // Manually scheduled events
    for (const e of store.calendarEvents) {
      if (e.date !== date) continue;
      events.push(e);
    }

    // Sort: timed events first (chronological), then all-day.
    return events.sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  private getEventsForMonth(yearMonth: string): CalendarEvent[] {
    // yearMonth format: "YYYY-MM"
    const [year, month] = yearMonth.split("-").map((s) => parseInt(s, 10));
    if (!year || !month) return [];
    const startDate = new Date(year, month - 1, 1).getTime();
    const endDate = new Date(year, month, 1).getTime();
    const allDates: string[] = [];
    for (let t = startDate; t < endDate; t += 86_400_000) {
      allDates.push(new Date(t).toISOString().slice(0, 10));
    }
    const all: CalendarEvent[] = [];
    for (const d of allDates) {
      all.push(...this.getEventsForDate(d));
    }
    return all;
  }
}

/** Singleton — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockCalendarRepository: CalendarRepository = new MockCalendarRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
