/**
 * SupabaseCalendarRepository — Supabase-backed implementation of the
 * `CalendarRepository` domain contract (iteration 9 / plan §15).
 *
 * Task: T-175 (28th session, 2026-09-05) — the T-047 `calendar` port
 * (priority #1 in docs/architecture/t-047-repository-migration-scoping.md:
 * the website already reads `calendar_events`; before this port the desktop
 * wrote to the in-memory mock store, so desktop-created events never
 * reached the shared table and restarts wiped them — the ARCH-006 "mock
 * leak" pattern).
 *
 * Table (migration 0013 + 0070):
 *   `calendar_events` — kind / title / description / start_at / end_at /
 *   all_day / location / attendee_count / target_entity_{type,id} /
 *   target_name / target_phone / created_by / priority / assigned_to_user_id /
 *   assigned_to_role / is_deleted.
 *
 * READ MODEL (mirrors the mock's derivation, but from the REAL tables —
 * pre-T-175 the mock derived payment/audit/expense events from in-memory
 * SEED data even in Supabase mode, so the daily activity log showed
 * fictional events while real payments lived server-side):
 *   - `observeForDate` / `observeForMonth` seed a month-bucketed cache:
 *     one query per source for the whole month range.
 *   - Manual events: `calendar_events` rows (is_deleted = false) mapped
 *     through `mapManualRow`.
 *   - Derived events: `payments` (status paid/partial, collected in range,
 *     joined to `parents` for the display name), `audit_logs` (occurred in
 *     range, auth noise skipped) and `expense_tickets` (submitted / approved
 *     / disbursed timestamps in range) — the same three derivations the mock
 *     performs, in the same sort order (timed events first, then all-day).
 *
 * WRITE MODEL:
 *   - `create` inserts a manual event row; `update` patches mutable fields;
 *     `delete` soft-deletes (is_deleted = true) — 0013 semantics: deleted
 *     events are filtered out by default.
 *   - Auto-generated kinds (payment_received / audit_log / expense_event)
 *     are read-only in the domain contract: `update`/`delete` reject them
 *     with a Conflict error, exactly like the mock.
 *
 * MAPPING NOTES (documented, lossless after 0070):
 *   1. `date` + `time` ↔ `start_at` (timestamptz). All-day events store
 *      midnight local-of-UTC-ISO `date` and set `all_day = true` (the 0013
 *      comment's convention). Round-trip: date = start_at.slice(0,10),
 *      time = all_day ? null : start_at.slice(11,16).
 *   2. `priority` / `assignedToUserId` / `assignedToRole` — migration 0070
 *      columns (pre-0070 rows default to medium / null / null).
 *   3. Reminder `linkedEntityType` / `linkedEntityId` map onto the
 *      polymorphic `target_entity_type` / `target_entity_id` columns
 *      (0013's intended purpose); follow-up-call `targetType`/`targetId`
 *      use the same columns — the kind discriminator disambiguates.
 *   4. `sourceLabel` is derived from the kind via the canonical domain
 *      labels (CALENDAR_EVENT_KIND_LABELS_FR) — the column does not exist
 *      in the table (the mock derived it the same way).
 *
 * Reactive reads follow the shared Supabase pattern
 * (`supabase-notification-repository.ts`): SubjectBehavior caches seeded on
 * first subscription + re-seeded on the T-034/CROSS-104 freshness policy,
 * refreshed after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `calendar` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CalendarRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type {
  CalendarEvent,
  CreateCalendarEventInput,
  CalendarEventBase,
  FollowUpCallCalendarEvent,
  ReminderCalendarEvent,
  MeetingCalendarEvent,
  CustomCalendarEvent,
  PaymentCalendarEvent,
  AuditCalendarEvent,
  ExpenseCalendarEvent,
  CalendarEventKind,
} from "../../../domain/model/calendar";
import {
  CALENDAR_EVENT_KIND_LABELS_FR,
} from "../../../domain/model/calendar";
import type { AlertPriority } from "../../../domain/model/operations";
import type { PaymentMethod, PaymentCategory } from "../../../domain/model/payment";
import { parentDisplayName } from "../../../domain/model/parent";
import type { Role } from "../../../core/rbac/roles";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types (local — the calendar table is not in the shared types.ts yet)
// ============================================================================

interface CalendarEventTableRow {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  attendee_count: number;
  target_entity_type: string | null;
  target_entity_id: string | null;
  target_name: string | null;
  target_phone: string | null;
  created_by: string | null;
  priority: string | null;
  assigned_to_user_id: string | null;
  assigned_to_role: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

/** Payments joined with the parent display columns (PostgREST embedded row). */
interface PaymentJoinedRow {
  id: string;
  receipt_number: string | null;
  payment_number: string;
  parent_id: string;
  amount: number;
  method: "cash" | "check" | "transfer";
  category: string;
  status: string;
  collected_at: string;
  collected_by: string | null;
  created_at: string;
  parents: { display_name: string | null; first_name: string | null; last_name: string | null } | null;
}

interface AuditLogCalendarRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  occurred_at: string;
  created_at: string;
}

interface ExpenseCalendarRow {
  id: string;
  ticket_number: string;
  title: string;
  requested_amount: number;
  status: string;
  submitted_by: string;
  submitted_at: string;
  approved_by: string | null;
  approved_at: string | null;
  disbursed_at: string | null;
  created_at: string;
}

// ============================================================================
// Helpers
// ============================================================================

const MANUAL_KINDS: ReadonlySet<string> = new Set([
  "follow_up_call",
  "reminder",
  "meeting",
  "custom",
]);

function nowIso(): string {
  return new Date().toISOString();
}

/** "2026-09" → inclusive [startIso, nextMonthStartIso) ISO bounds (UTC). */
function monthBounds(yearMonth: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function isoDateOf(ts: string): string {
  return ts.slice(0, 10);
}

function timeOf(ts: string): string {
  return ts.slice(11, 16) || "";
}

function toRole(value: string | null): Role | null {
  if (!value) return null;
  return value as Role;
}

// ============================================================================
// Row → domain mappers
// ============================================================================

function baseOf(row: CalendarEventTableRow): CalendarEventBase {
  return {
    id: row.id,
    kind: row.kind,
    date: isoDateOf(row.start_at),
    time: row.all_day ? null : timeOf(row.start_at) || null,
    title: row.title,
    description: row.description ?? null,
    sourceLabel: CALENDAR_EVENT_KIND_LABELS_FR[row.kind] ?? "Événement",
    priority: (row.priority ?? "medium") as AlertPriority,
    createdBy: row.created_by ?? "system",
    assignedToUserId: row.assigned_to_user_id ?? null,
    assignedToRole: toRole(row.assigned_to_role),
    createdAt: row.created_at,
  };
}

/** A manual row → the kind-specific domain event. */
function mapManualRow(row: CalendarEventTableRow): CalendarEvent {
  const base = baseOf(row);
  switch (row.kind) {
    case "follow_up_call":
      return {
        ...base,
        kind: "follow_up_call",
        targetType: (row.target_entity_type ?? "other") as FollowUpCallCalendarEvent["targetType"],
        targetId: row.target_entity_id ?? null,
        targetName: row.target_name ?? "",
        phone: row.target_phone ?? null,
      } satisfies FollowUpCallCalendarEvent;
    case "reminder":
      return {
        ...base,
        kind: "reminder",
        linkedEntityType: row.target_entity_type ?? null,
        linkedEntityId: row.target_entity_id ?? null,
      } satisfies ReminderCalendarEvent;
    case "meeting":
      return {
        ...base,
        kind: "meeting",
        location: row.location ?? null,
        attendeeCount: row.attendee_count ?? 0,
      } satisfies MeetingCalendarEvent;
    case "custom":
    default:
      return { ...base, kind: "custom" } satisfies CustomCalendarEvent;
  }
}

function mapPaymentRow(row: PaymentJoinedRow, date: string): PaymentCalendarEvent {
  const parent = row.parents;
  const parentName = parent
    ? parentDisplayName({
        firstName: parent.first_name ?? "",
        lastName: parent.last_name ?? "",
        displayName: parent.display_name ?? "",
      })
    : row.parent_id;
  return {
    id: `cal-pay-${row.id}`,
    kind: "payment_received",
    date,
    time: timeOf(row.collected_at) || null,
    title: `Paiement — ${parentName}`,
    description: `${row.receipt_number ?? row.payment_number} · ${row.method}`,
    sourceLabel: "Module Finances",
    priority: "low",
    createdBy: row.collected_by ?? "system",
    assignedToUserId: null,
    assignedToRole: null,
    createdAt: row.created_at,
    paymentId: row.id,
    receiptNumber: row.receipt_number ?? row.payment_number,
    parentId: row.parent_id,
    parentName,
    amount: row.amount,
    method: row.method as PaymentMethod,
    category: row.category as PaymentCategory,
    collectedBy: row.collected_by ?? "system",
  };
}

function mapAuditRow(row: AuditLogCalendarRow, date: string): AuditCalendarEvent {
  return {
    id: `cal-aud-${row.id}`,
    kind: "audit_log",
    date,
    time: timeOf(row.occurred_at) || null,
    title: `${row.action} — ${row.entity_type}`,
    description:
      row.note ?? `${row.actor_name ?? "Système"} a modifié ${row.entity_type}/${row.entity_id ?? "?"}`,
    sourceLabel: "Journal d'audit",
    priority: "low",
    createdBy: row.actor_id ?? "system",
    assignedToUserId: null,
    assignedToRole: null,
    createdAt: row.occurred_at,
    auditEntryId: row.id,
    action: row.action,
    actorName: row.actor_name ?? "Système",
    entityType: row.entity_type,
    entityId: row.entity_id ?? "",
  };
}

type ExpenseMilestone = "submit" | "approve" | "disburse";

const EXPENSE_MILESTONE_LABELS: Record<ExpenseMilestone, string> = {
  submit: "Soumission",
  approve: "Approbation",
  disburse: "Décaissement",
};

function mapExpenseRow(
  row: ExpenseCalendarRow,
  milestone: ExpenseMilestone,
  ts: string,
  date: string,
): ExpenseCalendarEvent {
  const createdBy =
    milestone === "submit"
      ? row.submitted_by
      : milestone === "approve"
        ? (row.approved_by ?? "system")
        : "system";
  const actorName =
    milestone === "submit" ? "Soumetteur" : milestone === "approve" ? "Approbateur" : "Caissier";
  return {
    id: `cal-exp-${row.id}-${milestone}`,
    kind: "expense_event",
    date,
    time: timeOf(ts) || null,
    title: `${EXPENSE_MILESTONE_LABELS[milestone]} — ${row.title}`,
    description: `${row.ticket_number} · ${row.requested_amount.toLocaleString("fr-FR")} DZD`,
    sourceLabel: "Module Dépenses",
    priority: milestone === "submit" ? "low" : "medium",
    createdBy,
    assignedToUserId: null,
    assignedToRole: null,
    createdAt: ts,
    expenseId: row.id,
    expenseStatus: row.status,
    amount: row.requested_amount,
    actorName,
  };
}

/** Domain input → insert row (manual kinds only). */
function insertRowOf(input: CreateCalendarEventInput): Record<string, unknown> {
  const time = input.time ?? null;
  // All-day convention (0013): start_at = date@00:00, all_day = true.
  const startAt = time ? `${input.date}T${time}:00` : `${input.date}T00:00:00`;
  const row: Record<string, unknown> = {
    tenant_id: getTenantId(),
    kind: input.kind,
    title: input.title,
    description: input.description ?? null,
    start_at: startAt,
    all_day: time === null,
    priority: input.priority,
    assigned_to_user_id: isUuid(input.assignedToUserId ?? "") ? (input.assignedToUserId ?? null) : null,
    assigned_to_role: input.assignedToRole ?? null,
    created_by: isUuid(input.createdBy) ? input.createdBy : null,
  };
  if (input.kind === "follow_up_call") {
    row.target_entity_type = input.targetType ?? "other";
    row.target_entity_id = isUuid(input.targetId ?? "") ? (input.targetId ?? null) : null;
    row.target_name = input.targetName ?? "";
    row.target_phone = input.phone ?? null;
  } else if (input.kind === "meeting") {
    row.location = input.location ?? null;
    row.attendee_count = input.attendeeCount ?? 0;
  } else if (input.kind === "reminder") {
    row.target_entity_type = input.linkedEntityType ?? null;
    row.target_entity_id = isUuid(input.linkedEntityId ?? "") ? (input.linkedEntityId ?? null) : null;
  }
  return row;
}

// ============================================================================
// Repository
// ============================================================================

/**
 * Month-bucketed reactive cache. Key = "YYYY-MM". Each bucket holds the
 * merged + sorted event list for that month (the same ordering the mock
 * produced: timed events first chronologically, then all-day by createdAt).
 */
export class SupabaseCalendarRepository implements CalendarRepository {
  private readonly buckets = new Map<string, SubjectBehavior<CalendarEvent[]>>();
  /** Buckets that have been seeded at least once (per-instance). */
  private readonly seededBuckets = new Set<string>();
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observeForDate(date: string): Observable<CalendarEvent[]> {
    const yearMonth = date.slice(0, 7);
    const month$ = this.bucketFor(yearMonth);
    return derived(
      [month$],
      () => month$.get().filter((e) => e.date === date),
    );
  }

  observeForMonth(yearMonth: string): Observable<CalendarEvent[]> {
    return this.bucketFor(yearMonth);
  }

  async create(input: CreateCalendarEventInput): Promise<Result<CalendarEvent>> {
    if (!MANUAL_KINDS.has(input.kind)) {
      return Err(Errors.conflict(`Kind ${input.kind} is auto-generated — cannot create manually`));
    }
    if (!input.title.trim()) {
      return Err(Errors.validation("Le titre est requis"));
    }
    const { data, error } = await this.client
      .from("calendar_events")
      .insert(insertRowOf(input))
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshBucket(input.date.slice(0, 7));
    return Ok(mapManualRow(data as unknown as CalendarEventTableRow));
  }

  async update(
    id: string,
    updates: Partial<CreateCalendarEventInput>,
  ): Promise<Result<CalendarEvent>> {
    const existing = await this.fetchRow(id);
    if (!existing) return Err(Errors.notFound("CalendarEvent", id));
    if (!MANUAL_KINDS.has(existing.kind)) {
      return Err(Errors.conflict("Cannot update auto-generated calendar event"));
    }
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    const newTime = updates.time !== undefined ? updates.time : existing.all_day ? null : timeOf(existing.start_at) || null;
    const newDate = updates.date ?? isoDateOf(existing.start_at);
    if (updates.date || updates.time !== undefined) {
      patch.start_at = newTime ? `${newDate}T${newTime}:00` : `${newDate}T00:00:00`;
      patch.all_day = newTime === null;
    }
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.description !== undefined) patch.description = updates.description ?? null;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.assignedToUserId !== undefined) {
      patch.assigned_to_user_id = isUuid(updates.assignedToUserId ?? "") ? (updates.assignedToUserId ?? null) : null;
    }
    if (updates.assignedToRole !== undefined) patch.assigned_to_role = updates.assignedToRole ?? null;
    if (existing.kind === "meeting" && (updates.location !== undefined || updates.attendeeCount !== undefined)) {
      if (updates.location !== undefined) patch.location = updates.location ?? null;
      if (updates.attendeeCount !== undefined) patch.attendee_count = updates.attendeeCount ?? 0;
    }
    if (existing.kind === "follow_up_call" && (updates.targetName !== undefined || updates.phone !== undefined)) {
      if (updates.targetName !== undefined) patch.target_name = updates.targetName ?? "";
      if (updates.phone !== undefined) patch.target_phone = updates.phone ?? null;
    }

    const { data, error } = await this.client
      .from("calendar_events")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .is("is_deleted", false)
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshBucket(isoDateOf(existing.start_at).slice(0, 7));
    if (updates.date && updates.date !== isoDateOf(existing.start_at)) {
      await this.refreshBucket(updates.date.slice(0, 7));
    }
    return Ok(mapManualRow(data as unknown as CalendarEventTableRow));
  }

  async delete(id: string): Promise<Result<void>> {
    const existing = await this.fetchRow(id);
    if (!existing) return Err(Errors.notFound("CalendarEvent", id));
    if (!MANUAL_KINDS.has(existing.kind)) {
      return Err(Errors.conflict("Cannot delete auto-generated calendar event"));
    }
    const { error } = await this.client
      .from("calendar_events")
      .update({ is_deleted: true, updated_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId());
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshBucket(isoDateOf(existing.start_at).slice(0, 7));
    return Ok(undefined);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private bucketFor(yearMonth: string): SubjectBehavior<CalendarEvent[]> {
    let bucket = this.buckets.get(yearMonth);
    if (!bucket) {
      bucket = new SubjectBehavior<CalendarEvent[]>([]);
      this.buckets.set(yearMonth, bucket);
    }
    // Seed once per bucket per instance; the global TTL/focus policy
    // (T-034/CROSS-104) re-seeds lazily on the next access after expiry.
    if (this.freshness.shouldReseed() || !this.seededBuckets.has(yearMonth)) {
      this.seededBuckets.add(yearMonth);
      this.freshness.markSeeded();
      void this.refreshBucket(yearMonth);
    }
    return bucket;
  }

  private async fetchRow(id: string): Promise<CalendarEventTableRow | null> {
    const { data, error } = await this.client
      .from("calendar_events")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .maybeSingle();
    if (error) return null;
    return (data ?? null) as CalendarEventTableRow | null;
  }

  /** Re-query every source for the month and re-emit the merged bucket. */
  private async refreshBucket(yearMonth: string): Promise<void> {
    const bucket = this.buckets.get(yearMonth);
    if (!bucket) return;
    const bounds = monthBounds(yearMonth);
    if (!bounds) {
      bucket.set([]);
      return;
    }
    try {
      const [manual, payments, audit, expenses] = await Promise.all([
        this.fetchManualEvents(bounds),
        this.fetchPayments(bounds),
        this.fetchAudit(bounds),
        this.fetchExpenses(bounds),
      ]);
      const events = [...manual, ...payments, ...audit, ...expenses].sort(compareEvents);
      bucket.set(events);
    } catch {
      // Silently degrade to the current cache (shared pattern).
    }
  }

  private async fetchManualEvents(bounds: { start: string; end: string }): Promise<CalendarEvent[]> {
    const { data, error } = await this.client
      .from("calendar_events")
      .select("*")
      .eq("tenant_id", getTenantId())
      .is("is_deleted", false)
      .gte("start_at", bounds.start)
      .lt("start_at", bounds.end)
      .order("start_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, any>) => mapManualRow(row as unknown as CalendarEventTableRow));
  }

  private async fetchPayments(bounds: { start: string; end: string }): Promise<CalendarEvent[]> {
    const { data, error } = await this.client
      .from("payments")
      .select(
        "id, receipt_number, payment_number, parent_id, amount, method, category, status, collected_at, collected_by, created_at, parents(display_name, first_name, last_name)",
      )
      .eq("tenant_id", getTenantId())
      .in("status", ["paid", "partial"])
      .gte("collected_at", bounds.start)
      .lt("collected_at", bounds.end)
      .order("collected_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, any>) =>
      mapPaymentRow(row as unknown as PaymentJoinedRow, isoDateOf(row.collected_at)),
    );
  }

  private async fetchAudit(bounds: { start: string; end: string }): Promise<CalendarEvent[]> {
    const { data, error } = await this.client
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, actor_id, actor_name, note, occurred_at, created_at")
      .eq("tenant_id", getTenantId())
      .gte("occurred_at", bounds.start)
      .lt("occurred_at", bounds.end)
      .order("occurred_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    return (data ?? [])
      .filter((row: Record<string, any>) => row.action !== "auth.login" && row.action !== "auth.password_reset")
      .map((row: Record<string, any>) => mapAuditRow(row as unknown as AuditLogCalendarRow, isoDateOf(row.occurred_at)));
  }

  private async fetchExpenses(bounds: { start: string; end: string }): Promise<CalendarEvent[]> {
    const { data, error } = await this.client
      .from("expense_tickets")
      .select(
        "id, ticket_number, title, requested_amount, status, submitted_by, submitted_at, approved_by, approved_at, disbursed_at, created_at",
      )
      .eq("tenant_id", getTenantId())
      .order("submitted_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    const events: CalendarEvent[] = [];
    for (const row of (data ?? []) as Record<string, any>[]) {
      const milestones: Array<{ ts: string | null; kind: ExpenseMilestone }> = [
        { ts: row.submitted_at, kind: "submit" },
        { ts: row.approved_at, kind: "approve" },
        { ts: row.disbursed_at, kind: "disburse" },
      ];
      for (const { ts, kind } of milestones) {
        if (!ts) continue;
        if (ts < bounds.start || ts >= bounds.end) continue;
        events.push(
          mapExpenseRow(row as unknown as ExpenseCalendarRow, kind, ts, isoDateOf(ts)),
        );
      }
    }
    return events;
  }
}

// ============================================================================
// Small utilities
// ============================================================================

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.time) return -1;
  if (b.time) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}
