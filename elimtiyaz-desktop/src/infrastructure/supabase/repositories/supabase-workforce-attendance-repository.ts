/**
 * SupabaseWorkforceAttendanceRepository — Supabase-backed implementation of
 * the `AttendanceRepository` domain contract (plan §10.05).
 *
 * Task: T-217 (32nd session, 2026-09-07) — the T-047 `workforceAttendance`
 * port (the LAST open member of the T-160 scoping's priority-3 dashboards
 * trio "tasks / workforceAttendance / leaveRequests — the dashboards").
 * Pre-T-217 the slot stayed on mockRepositories even in Supabase mode: the
 * worker dashboard's clock punches (clock in / break / clock out), the
 * manager dashboard's daily attendance feed and the employee profile
 * drawer's attendance history all lived in memory only (wiped on restart)
 * while the canonical `workforce_attendance_events` table (migration 0010)
 * sat empty.
 *
 * T-369 (68th session, 2026-09-14) — the ABSENCE & JUSTIFICATION loop
 * (the 74d3ebb Personnel & Workforce UI commit): `observeAbsences` /
 * `requestAbsenceJustification` / `submitAbsenceJustification` /
 * `reviewAbsenceJustification` on the canonical `staff_absences` table
 * (migration 0095). The DB's state-transition trigger
 * (enforce_staff_absence_justification_flow) enforces the loop
 * none→requested→submitted→accepted|rejected server-side; the repository
 * maps each domain call onto exactly one legal transition.
 *
 * Table (migration 0010 + 0095):
 *   `workforce_attendance_events` — personnel_id (FK) / event_type (CHECK:
 *   clock_in|break_start|break_end|clock_out — the domain union VERBATIM,
 *   no fold needed) / event_at (timestamptz, default now()) / latitude /
 *   longitude (numeric(9,6)) / note / recorded_by (user_profiles.id by
 *   convention, no FK) / created_at.
 *   `staff_absences` (0095) — personnel_id (FK) / date / duration_hours /
 *   is_excused / justification_status (none|requested|submitted|accepted|
 *   rejected — the DB trigger enforces the loop) / admin_request_note /
 *   requested_at / requested_by / worker_explanation / worker_submitted_at /
 *   document_ref / decision_note / decided_at / decided_by.
 *
 * MAPPING NOTES (documented):
 *   1. `eventType` ↔ `event_type` — domain union verbatim (0010 CHECK).
 *   2. `timestamp` ↔ `event_at`; `date` = the UTC calendar date of
 *      `event_at` (slice 0..10). The mock stamped date + timestamp
 *      independently; here both derive from the ONE server-side instant —
 *      there is no client-supplied clock punch time (the UI passes today
 *      for `date`, which is advisory only; the insert never sends a date).
 *   3. `metadata.lat/lng` ↔ `latitude`/`longitude` columns.
 *      `metadata.ip` has NO column — dropped (documented divergence; the
 *      UI never sets it, the mock always left it null).
 *   4. `recorded_by` = the session's user_profiles.id when the input
 *      supplies a UUID (getActorId), else null — the 0010 "no FK by
 *      convention" comment.
 *   5. `recordEvent` validates personnelId is a UUID BEFORE hitting the
 *      table (mock-era ids like "per-001" → validation error — the T-178
 *      precedent).
 *   6. `latestFor` stays SYNCHRONOUS (mock parity): the worker dashboard's
 *      clock-state memo reads it without awaiting. It peeks the local
 *      reactive cache, which every observe* seeds and every successful
 *      write appends to.
 *
 * Reactive reads follow the shared Supabase pattern (T-178/T-180):
 * SubjectBehavior cache + CacheFreshness reseed throttle + refresh after
 * every successful write. The cache is a rolling window (500 rows,
 * event_at DESC) — punch events are low-volume per tenant.
 *
 * RLS (0019 + 0095): SELECT requires tenant + (staff roles OR own-personnel);
 * INSERT requires tenant (attendance events) / staff roles (absences — the
 * admin records an observed absence); UPDATE for staff roles OR the worker's
 * own absence (the justification submit path). The 0010 audit trail note
 * applies — audit is server-side (0014); the actor reaches the DB through
 * recorded_by / requested_by / decided_by.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `workforceAttendance` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { AttendanceRepository } from "../../../domain/repository/workforce-repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type {
  AttendanceEvent,
  AttendanceEventType,
  StaffAbsenceRecord,
  StaffJustificationStatus,
} from "../../../domain/model/workforce";
import { getTenantId, isUuid, getActorId } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

interface AttendanceEventTableRow {
  id: string;
  tenant_id: string;
  personnel_id: string;
  event_type: string;
  event_at: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

/** Canonical CHECK values (0010) — unknown rows fold to clock_in (never
 *  reached in practice: the CHECK rejects anything else at insert time). */
const EVENT_TYPES: readonly string[] = ["clock_in", "break_start", "break_end", "clock_out"];

function mapRow(row: AttendanceEventTableRow): AttendanceEvent {
  const metadata =
    row.latitude != null || row.longitude != null
      ? {
          lat: row.latitude ?? undefined,
          lng: row.longitude ?? undefined,
        }
      : null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personnelId: row.personnel_id,
    // UTC calendar date of the server-side instant (mapping note 2).
    date: row.event_at.slice(0, 10),
    timestamp: row.event_at,
    eventType: (EVENT_TYPES.includes(row.event_type) ? row.event_type : "clock_in") as AttendanceEventType,
    metadata,
  };
}

const SELECT = "id, tenant_id, personnel_id, event_type, event_at, latitude, longitude, note, recorded_by, created_at";

// ---------------------------------------------------------------------------
// staff_absences (0095 — the absence & justification loop)
// ---------------------------------------------------------------------------

interface PersonnelEmbed {
  first_name: string | null;
  last_name: string | null;
}

interface StaffAbsenceRow {
  id: string;
  tenant_id: string;
  personnel_id: string;
  date: string;
  duration_hours: number;
  is_excused: boolean;
  justification_status: string;
  admin_request_note: string | null;
  requested_at: string | null;
  requested_by: string | null;
  worker_explanation: string | null;
  worker_submitted_at: string | null;
  document_ref: string | null;
  decision_note: string | null;
  decided_at: string | null;
  decided_by: string | null;
  personnel: PersonnelEmbed | null;
}

const JUSTIFICATION_STATUSES: readonly string[] = [
  "none",
  "requested",
  "submitted",
  "accepted",
  "rejected",
];

const ABSENCE_SELECT = "*, personnel(first_name, last_name)";

function mapAbsenceRow(row: StaffAbsenceRow): StaffAbsenceRecord {
  const embed = row.personnel;
  const personnelName = embed
    ? `${embed.first_name ?? ""} ${embed.last_name ?? ""}`.trim() || "Personnel inconnu"
    : "Personnel inconnu";
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personnelId: row.personnel_id,
    personnelName,
    date: row.date,
    durationHours: Number(row.duration_hours),
    isExcused: row.is_excused,
    justificationStatus: (JUSTIFICATION_STATUSES.includes(row.justification_status)
      ? row.justification_status
      : "none") as StaffJustificationStatus,
    adminRequestNote: row.admin_request_note ?? null,
    requestedAt: row.requested_at ?? null,
    requestedBy: row.requested_by ?? null,
    workerExplanation: row.worker_explanation ?? null,
    workerSubmittedAt: row.worker_submitted_at ?? null,
    documentRef: row.document_ref ?? null,
    decisionNote: row.decision_note ?? null,
    decidedAt: row.decided_at ?? null,
    decidedBy: row.decided_by ?? null,
  };
}

export class SupabaseWorkforceAttendanceRepository implements AttendanceRepository {
  private readonly cache = new SubjectBehavior<AttendanceEvent[]>([]);
  private readonly freshness = new CacheFreshness();
  private readonly absencesCache = new SubjectBehavior<StaffAbsenceRecord[]>([]);
  private readonly absencesFreshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observeByPersonnel(personnelId: string, fromDate: string, toDate: string): Observable<AttendanceEvent[]> {
    this.seed();
    return derived([this.cache], () =>
      this.cache
        .get()
        .filter((e) => e.personnelId === personnelId && e.date >= fromDate && e.date <= toDate),
    );
  }

  observeByDate(date: string): Observable<AttendanceEvent[]> {
    this.seed();
    return derived([this.cache], () => this.cache.get().filter((e) => e.date === date));
  }

  latestFor(personnelId: string, date: string): AttendanceEvent | null {
    // Synchronous cache peek (mapping note 6) — mock parity: the worker
    // dashboard's clock-state memo reads this without awaiting.
    const events = this.cache
      .get()
      .filter((e) => e.personnelId === personnelId && e.date === date);
    return events.length > 0 ? events[events.length - 1] : null;
  }

  async recordEvent(input: {
    personnelId: string;
    date: string;
    eventType: AttendanceEventType;
    metadata?: { lat?: number; lng?: number; ip?: string } | null;
  }): Promise<Result<AttendanceEvent>> {
    if (!isUuid(input.personnelId)) {
      // T-178 precedent: mock-era ids never reach the table.
      return Err(
        Errors.validation(
          "workforceAttendance.recordEvent requires a personnel UUID (the Supabase personnel table key)",
          "Profil personnel introuvable — reconnectez-vous.",
        ),
      );
    }
    const tenantId = getTenantId();
    if (!tenantId) {
      return Err(
        Errors.validation(
          "workforceAttendance.recordEvent requires an active tenant context",
          "Aucun établissement actif — reconnectez-vous.",
        ),
      );
    }
    // Mapping note 2: the punch instant is SERVER-side (now()); the input
    // `date` is advisory (mock parity) and is deliberately not persisted.
    void input.date;
    const { data, error } = await this.client
      .from("workforce_attendance_events")
      .insert({
        tenant_id: tenantId,
        personnel_id: input.personnelId,
        event_type: input.eventType,
        latitude: input.metadata?.lat ?? null,
        longitude: input.metadata?.lng ?? null,
        // Mapping note 3: metadata.ip has no column — dropped.
        recorded_by: isUuid(getActorId()) ? getActorId() : null,
      })
      .select(SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    const mapped = mapRow(data as unknown as AttendanceEventTableRow);
    // Append to the local cache so the SYNCHRONOUS latestFor peek (the
    // worker dashboard recomputes its clock state after every punch)
    // reflects the write without waiting for the reseed.
    const next = [...this.cache.get(), mapped].sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
    );
    this.cache.set(next.slice(-500));
    void this.refresh();
    return Ok(mapped);
  }

  // --------------------------------------------------------------------------
  // Absence & Justification Loop (staff_absences, migration 0095)
  // --------------------------------------------------------------------------

  observeAbsences(personnelId?: string): Observable<StaffAbsenceRecord[]> {
    this.seedAbsences();
    if (personnelId) {
      return derived([this.absencesCache], () =>
        this.absencesCache.get().filter((a) => a.personnelId === personnelId),
      );
    }
    return this.absencesCache;
  }

  async requestAbsenceJustification(input: {
    absenceId: string;
    adminNote: string;
    requestedBy: string;
  }): Promise<Result<StaffAbsenceRecord>> {
    if (!input.adminNote.trim()) {
      return Err(
        Errors.validation(
          "An admin note is required when requesting a justification",
          "Un message est requis pour demander une justification.",
        ),
      );
    }
    // none → requested (the 0095 trigger enforces the transition server-side).
    const { data, error } = await this.client
      .from("staff_absences")
      .update({
        justification_status: "requested",
        admin_request_note: input.adminNote.trim(),
        requested_at: new Date().toISOString(),
        requested_by: isUuid(input.requestedBy) ? input.requestedBy : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.absenceId)
      .eq("tenant_id", getTenantId())
      .select(ABSENCE_SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("StaffAbsence", input.absenceId));
    await this.refreshAbsences();
    return Ok(mapAbsenceRow(data as unknown as StaffAbsenceRow));
  }

  async submitAbsenceJustification(input: {
    absenceId: string;
    workerExplanation: string;
    documentRef?: string | null;
  }): Promise<Result<StaffAbsenceRecord>> {
    if (!input.workerExplanation.trim()) {
      return Err(
        Errors.validation(
          "An explanation is required",
          "Une explication est requise.",
        ),
      );
    }
    // requested → submitted (the 0095 trigger enforces the transition).
    const { data, error } = await this.client
      .from("staff_absences")
      .update({
        justification_status: "submitted",
        worker_explanation: input.workerExplanation.trim(),
        worker_submitted_at: new Date().toISOString(),
        document_ref: input.documentRef?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.absenceId)
      .eq("tenant_id", getTenantId())
      .select(ABSENCE_SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("StaffAbsence", input.absenceId));
    await this.refreshAbsences();
    return Ok(mapAbsenceRow(data as unknown as StaffAbsenceRow));
  }

  async reviewAbsenceJustification(input: {
    absenceId: string;
    decision: "accepted" | "rejected";
    decisionNote: string;
    decidedBy: string;
  }): Promise<Result<StaffAbsenceRecord>> {
    if (!input.decisionNote.trim()) {
      return Err(
        Errors.validation(
          "A decision note is required",
          "Un motif de décision est requis.",
        ),
      );
    }
    // submitted → accepted|rejected (is_excused flips only on accepted —
    // the 0095 trigger enforces both invariants server-side).
    const { data, error } = await this.client
      .from("staff_absences")
      .update({
        justification_status: input.decision,
        is_excused: input.decision === "accepted",
        decision_note: input.decisionNote.trim(),
        decided_at: new Date().toISOString(),
        decided_by: isUuid(input.decidedBy) ? input.decidedBy : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.absenceId)
      .eq("tenant_id", getTenantId())
      .select(ABSENCE_SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("StaffAbsence", input.absenceId));
    await this.refreshAbsences();
    return Ok(mapAbsenceRow(data as unknown as StaffAbsenceRow));
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private seedAbsences(): void {
    if (!this.absencesFreshness.shouldReseed()) return;
    this.absencesFreshness.markSeeded();
    void this.refreshAbsences();
  }

  private async refreshAbsences(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("staff_absences")
        .select(ABSENCE_SELECT)
        .eq("tenant_id", getTenantId())
        .order("date", { ascending: false })
        .limit(500);
      if (error) throw error;
      this.absencesCache.set(
        ((data ?? []) as unknown as StaffAbsenceRow[]).map(mapAbsenceRow),
      );
    } catch {
      // Silently degrade to the current cache.
    }
  }

  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("workforce_attendance_events")
        .select(SELECT)
        .eq("tenant_id", getTenantId())
        .order("event_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      this.cache.set(
        ((data ?? []) as unknown as AttendanceEventTableRow[]).map(mapRow),
      );
    } catch {
      // Silently degrade to the current cache.
    }
  }
}
