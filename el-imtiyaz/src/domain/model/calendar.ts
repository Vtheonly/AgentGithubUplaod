/**
 * Calendar events — daily activity log + interactive scheduling.
 *
 * Iteration 9 — Integrated Calendar View (plan §15 expansion).
 *
 * The calendar shows what happened on any given day:
 *   - Payments received (who paid, how much, by which agent)
 *   - Operational logs (audit events, expense approvals…)
 *   - Custom scheduled events (follow-up calls, reminders, meetings)
 *
 * It does NOT list unpaid / overdue debt balances — those live in the
 * Financials → Debt tab. The calendar is a forward-looking + same-day
 * operational tool, not a debt collector.
 *
 * The CalendarEvent union is intentionally narrow so the UI can switch
 * on `kind` without parsing free-form strings.
 */
import type { AlertPriority } from "./operations";
import type { PaymentMethod, PaymentCategory } from "./payment";

export type CalendarEventKind =
  | "payment_received"
  | "audit_log"
  | "expense_event"
  | "follow_up_call"
  | "reminder"
  | "meeting"
  | "custom";

export interface CalendarEventBase {
  readonly id: string;
  readonly kind: CalendarEventKind;
  /** ISO date (YYYY-MM-DD) the event lands on. */
  readonly date: string;
  /** Optional time-of-day (HH:mm) for timed events. Null = all-day. */
  readonly time: string | null;
  readonly title: string;
  readonly description: string | null;
  /** Origin label (e.g. "Module Finances", "Personnel"). */
  readonly sourceLabel: string;
  /** For scheduled events: priority for color-coding. */
  readonly priority: AlertPriority;
  /** Actor who created the event (system userId for auto-generated events). */
  readonly createdBy: string;
  /** For manually scheduled events: the user/role this is assigned to. */
  readonly assignedToUserId: string | null;
  readonly assignedToRole: import("../../core/rbac/roles").Role | null;
  readonly createdAt: string;
}

/** Payment received on this date — derived from `Payment.collectedAt`. */
export interface PaymentCalendarEvent extends CalendarEventBase {
  readonly kind: "payment_received";
  readonly paymentId: string;
  readonly receiptNumber: string;
  readonly parentId: string;
  readonly parentName: string;
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly category: PaymentCategory;
  readonly collectedBy: string;
}

/** Audit log entry on this date — derived from `AuditEntry.at`. */
export interface AuditCalendarEvent extends CalendarEventBase {
  readonly kind: "audit_log";
  readonly auditEntryId: string;
  readonly action: string;
  readonly actorName: string;
  readonly entityType: string;
  readonly entityId: string;
}

/** Expense event (submission, approval, disbursement) on this date. */
export interface ExpenseCalendarEvent extends CalendarEventBase {
  readonly kind: "expense_event";
  readonly expenseId: string;
  readonly expenseStatus: string;
  readonly amount: number;
  readonly actorName: string;
}

/** Manually scheduled follow-up call. */
export interface FollowUpCallCalendarEvent extends CalendarEventBase {
  readonly kind: "follow_up_call";
  readonly targetType: "parent" | "personnel" | "student" | "vendor" | "other";
  readonly targetId: string | null;
  readonly targetName: string;
  readonly phone: string | null;
}

/** Manually scheduled reminder. */
export interface ReminderCalendarEvent extends CalendarEventBase {
  readonly kind: "reminder";
  readonly linkedEntityType: string | null;
  readonly linkedEntityId: string | null;
}

/** Manually scheduled meeting. */
export interface MeetingCalendarEvent extends CalendarEventBase {
  readonly kind: "meeting";
  readonly location: string | null;
  readonly attendeeCount: number;
}

/** Free-form custom event. */
export interface CustomCalendarEvent extends CalendarEventBase {
  readonly kind: "custom";
}

export type CalendarEvent =
  | PaymentCalendarEvent
  | AuditCalendarEvent
  | ExpenseCalendarEvent
  | FollowUpCallCalendarEvent
  | ReminderCalendarEvent
  | MeetingCalendarEvent
  | CustomCalendarEvent;

/** Input for creating a manually scheduled event (follow-up call, reminder, meeting, custom). */
export interface CreateCalendarEventInput {
  readonly kind: "follow_up_call" | "reminder" | "meeting" | "custom";
  readonly date: string;
  readonly time: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly priority: AlertPriority;
  readonly assignedToUserId?: string | null;
  readonly assignedToRole?: import("../../core/rbac/roles").Role | null;
  readonly createdBy: string;
  // Follow-up call extras
  readonly targetType?: "parent" | "personnel" | "student" | "vendor" | "other";
  readonly targetId?: string | null;
  readonly targetName?: string;
  readonly phone?: string | null;
  // Meeting extras
  readonly location?: string | null;
  readonly attendeeCount?: number;
  // Reminder extras
  readonly linkedEntityType?: string | null;
  readonly linkedEntityId?: string | null;
}

export const CALENDAR_EVENT_KIND_LABELS_FR: Record<CalendarEventKind, string> = {
  payment_received: "Paiement encaissé",
  audit_log: "Journal d'audit",
  expense_event: "Dépense",
  follow_up_call: "Appel de suivi",
  reminder: "Rappel",
  meeting: "Réunion",
  custom: "Événement",
};

export const CALENDAR_EVENT_KIND_ICON: Record<CalendarEventKind, string> = {
  payment_received: "Wallet",
  audit_log: "ScrollText",
  expense_event: "Receipt",
  follow_up_call: "Phone",
  reminder: "Bell",
  meeting: "Users",
  custom: "Calendar",
};
