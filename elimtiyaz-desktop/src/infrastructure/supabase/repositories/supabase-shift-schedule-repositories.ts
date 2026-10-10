/**
 * SupabaseShiftRepository + SupabaseScheduleRepository — the canonical 0010
 * `shifts` / `schedules` tables' adapters (T-484, 140th session, 2026-10-04 —
 * the T-477 audit's "shifts/schedules mock slots", the WORKFORCE-102 standing
 * list's last two desktop slots).
 *
 * BEFORE this: the `shifts`/`schedules` slots stayed on mockRepositories even
 * in Supabase mode — the drawer's "Horaires & Shifts" tab rendered mock seeds
 * (and the domain's pre-T-484 shapes — weekday/shiftType weekly templates +
 * weekStart+shiftIds[] chunks — could not even be STORED in the 0010 tables).
 * The domain model is now aligned to the canonical schema; these adapters are
 * the persistence path.
 *
 * MAPPING NOTES (documented):
 *   Shift ↔ shifts (0010 §2): code / name / start_time / end_time /
 *   grace_period_minutes / color_hex (nullable) / is_active. The
 *   (tenant_id, code) unique surfaces as the create()'s conflict; the CHECK
 *   (end_time > start_time) is the server's backstop — the client validates
 *   first for the honest French message.
 *   Schedule ↔ schedules (0010 §3): personnel_id / shift_id (nullable, SET
 *   NULL on template delete) / date / start_time+end_time (nullable
 *   day-overrides) / note. The (tenant_id, personnel_id, date) unique is the
 *   upsert conflict target — a second assignment for the same day UPDATES
 *   the row (never a duplicate).
 *
 * RLS (0019): shifts_select/schedules_select = tenant-wide reads for the
 * authenticated; shifts_admin/schedules_admin = writes for the staff quartet
 * (super_admin/support_staff/manager). The RLS refusal surfaces honestly.
 *
 * Reactive reads: SubjectBehavior cache + T-034/CACHE-103 freshness policy +
 * refresh after every successful write (the T-239..T-481 port pattern).
 *
 * The T-373 non-uuid guard: a personnel-keyed read with a non-UUID key
 * ("" / a mock-era id) returns a STABLE EMPTY stream — no server round-trip,
 * no 22P02 HTTP 400 (the ACAD-501 lesson).
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `shifts`/`schedules` entries with these classes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type {
  ShiftRepository,
  ScheduleRepository,
} from "../../../domain/repository/workforce-repository";
import type { Shift, Schedule } from "../../../domain/model/workforce";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { getTenantId, writeAuditMirror } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types
// ============================================================================

interface ShiftRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_period_minutes: number | null;
  color_hex: string | null;
  is_active: boolean;
}

interface ScheduleRow {
  id: string;
  tenant_id: string;
  personnel_id: string;
  shift_id: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
}

function mapShiftRow(row: ShiftRow): Shift {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    gracePeriodMinutes: row.grace_period_minutes ?? 0,
    colorHex: row.color_hex,
    isActive: row.is_active,
  };
}

function mapScheduleRow(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personnelId: row.personnel_id,
    shiftId: row.shift_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    note: row.note,
  };
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const HH_MM = /^\d{2}:\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The [weekStart, weekStart+6] date window (weekStart = ISO Monday). */
export function weekWindow(weekStart: string): { from: string; to: string } {
  const from = new Date(`${weekStart}T00:00:00Z`);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 6);
  return { from: weekStart, to: to.toISOString().slice(0, 10) };
}

// ============================================================================
// ShiftRepository
// ============================================================================

export class SupabaseShiftRepository implements ShiftRepository {
  private readonly cache = new SubjectBehavior<Shift[] | null>(null);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<Shift[]> {
    this.seed();
    return {
      subscribe: (fn: (value: Shift[]) => void) =>
        this.cache.subscribe((v) => fn(v ?? [])),
      get: (): Shift[] => this.cache.get() ?? [],
    };
  }

  async createShift(input: Omit<Shift, "id" | "tenantId">): Promise<Result<Shift>> {
    if (!input.code?.trim()) {
      return Err(Errors.validation("Le code du shift est requis."));
    }
    if (!HH_MM.test(input.startTime) || !HH_MM.test(input.endTime)) {
      return Err(Errors.validation("Horaires invalides (format attendu : HH:MM)."));
    }
    if (input.endTime <= input.startTime) {
      return Err(Errors.validation("L'heure de fin doit être après l'heure de début."));
    }
    const { data, error } = await this.client
      .from("shifts")
      .insert({
        tenant_id: getTenantId(),
        code: input.code.trim(),
        name: input.name,
        start_time: input.startTime,
        end_time: input.endTime,
        grace_period_minutes: input.gracePeriodMinutes ?? 0,
        color_hex: input.colorHex ?? null,
        is_active: input.isActive ?? true,
      })
      .select()
      .single();
    if (error) {
      // The (tenant_id, code) unique + the CHECK + the RLS refusal all
      // surface here with the server's message.
      return Err(supabaseErrorToAppError(error));
    }
    await this.refresh();
    // AUDIT-505 (T-502): shift.create — the mock's mirror.
    await writeAuditMirror(this.client, {
      action: "shift.create",
      entityType: "shift",
      entityId: (data as Record<string, unknown>).id as string,
      after: { code: input.code.trim(), startTime: input.startTime, endTime: input.endTime },
    });
    return Ok(mapShiftRow(data as unknown as ShiftRow));
  }

  async updateShift(id: string, updates: Partial<Shift>): Promise<Result<Shift>> {
    if (!isUuid(id)) {
      return Err(Errors.validation("Shift invalide (identifiant non synchronisé)."));
    }
    const patch: Record<string, unknown> = {};
    if (updates.code !== undefined) patch["code"] = updates.code;
    if (updates.name !== undefined) patch["name"] = updates.name;
    if (updates.startTime !== undefined) patch["start_time"] = updates.startTime;
    if (updates.endTime !== undefined) patch["end_time"] = updates.endTime;
    if (updates.gracePeriodMinutes !== undefined) {
      patch["grace_period_minutes"] = updates.gracePeriodMinutes;
    }
    if (updates.colorHex !== undefined) patch["color_hex"] = updates.colorHex;
    if (updates.isActive !== undefined) patch["is_active"] = updates.isActive;
    const { data, error } = await this.client
      .from("shifts")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    // AUDIT-505 (T-502): shift.update — the mock's mirror.
    await writeAuditMirror(this.client, {
      action: "shift.update",
      entityType: "shift",
      entityId: id,
      after: { changed: Object.keys(patch) },
    });
    return Ok(mapShiftRow(data as unknown as ShiftRow));
  }

  async deleteShift(id: string): Promise<Result<void>> {
    if (!isUuid(id)) {
      return Err(Errors.validation("Shift invalide (identifiant non synchronisé)."));
    }
    const { error } = await this.client.from("shifts").delete().eq("id", id);
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    // AUDIT-505 (T-502): shift.delete — the mock's mirror.
    await writeAuditMirror(this.client, {
      action: "shift.delete",
      entityType: "shift",
      entityId: id,
    });
    return Ok(undefined);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private seed(): void {
    if (!this.freshness.shouldReseed() && this.cache.get() !== null) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("shifts")
        .select("*")
        .eq("tenant_id", getTenantId())
        .order("code");
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapShiftRow(row as unknown as ShiftRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }
}

// ============================================================================
// ScheduleRepository
// ============================================================================

export class SupabaseScheduleRepository implements ScheduleRepository {
  private readonly cache = new SubjectBehavior<Schedule[] | null>(null);
  private readonly freshness = new CacheFreshness();
  private cachedPersonnelId = "";

  constructor(private readonly client: SupabaseClient) {}

  observeByPersonnel(personnelId: string): Observable<Schedule[]> {
    // The T-373 guard: a non-UUID key ("" while the drawer is closed, or a
    // mock-era id) never reaches the UUID column — a stable empty stream.
    if (!isUuid(personnelId)) {
      this.cache.set(null);
      this.cachedPersonnelId = "";
      return {
        subscribe: (fn: (value: Schedule[]) => void) =>
          this.cache.subscribe((v) => fn(v ?? [])),
        get: (): Schedule[] => [],
      };
    }
    if (personnelId !== this.cachedPersonnelId) {
      this.cache.set(null);
      this.cachedPersonnelId = personnelId;
    }
    this.seed(personnelId);
    return {
      subscribe: (fn: (value: Schedule[]) => void) =>
        this.cache.subscribe((v) => fn(v ?? [])),
      get: (): Schedule[] => this.cache.get() ?? [],
    };
  }

  observeByWeek(weekStart: string): Observable<Schedule[]> {
    // The week view is a read-side window over the per-day rows: the window
    // filter is applied client-side over the (tenant-wide) cache — a
    // dedicated per-week cache would multiply server round-trips for a view
    // the drawer does not open.
    const window = weekWindow(weekStart);
    this.seedWeek();
    return {
      subscribe: (fn: (value: Schedule[]) => void) =>
        this.cache.subscribe((v) =>
          fn(
            (v ?? []).filter(
              (s) => s.date >= window.from && s.date <= window.to,
            ),
          ),
        ),
      get: (): Schedule[] =>
        (this.cache.get() ?? []).filter(
          (s) => s.date >= window.from && s.date <= window.to,
        ),
    };
  }

  async upsertSchedule(
    input: Omit<Schedule, "id" | "tenantId"> & { id?: string },
  ): Promise<Result<Schedule>> {
    if (!isUuid(input.personnelId)) {
      return Err(Errors.validation("Membre du personnel invalide (fiche non synchronisée)."));
    }
    if (input.shiftId != null && !isUuid(input.shiftId)) {
      return Err(Errors.validation("Shift lié invalide (fiche non synchronisée)."));
    }
    if (!ISO_DATE.test(input.date)) {
      return Err(Errors.validation("Date invalide (format attendu : AAAA-MM-JJ)."));
    }
    const { data, error } = await this.client
      .from("schedules")
      .upsert(
        {
          tenant_id: getTenantId(),
          personnel_id: input.personnelId,
          shift_id: input.shiftId ?? null,
          date: input.date,
          start_time: input.startTime ?? null,
          end_time: input.endTime ?? null,
          note: input.note ?? null,
        },
        // The 0010 unique (tenant_id, personnel_id, date): the same day's
        // assignment is UPDATED, never duplicated.
        { onConflict: "tenant_id,personnel_id,date" },
      )
      .select()
      .single();
    if (error) {
      // The CHECK (overrides must be a valid window), the unique, and the
      // RLS refusal all surface here with the server's message.
      return Err(supabaseErrorToAppError(error));
    }
    await this.refresh(input.personnelId);
    // AUDIT-505 (T-502): schedule.upsert rides ONE audit row — the mock
    // distinguishes schedule.create vs schedule.update by path; the
    // PostgREST upsert is a single statement, so the id presence tells
    // which arm fired (an explicit id = the update arm).
    await writeAuditMirror(this.client, {
      action: input.id ? "schedule.update" : "schedule.create",
      entityType: "schedule",
      entityId: (data as Record<string, unknown>).id as string,
      after: { personnelId: input.personnelId, date: input.date, shiftId: input.shiftId ?? null },
    });
    return Ok(mapScheduleRow(data as unknown as ScheduleRow));
  }

  async deleteSchedule(id: string): Promise<Result<void>> {
    if (!isUuid(id)) {
      return Err(Errors.validation("Planification invalide (identifiant non synchronisé)."));
    }
    const { error } = await this.client.from("schedules").delete().eq("id", id);
    if (error) return Err(supabaseErrorToAppError(error));
    if (this.cachedPersonnelId) await this.refresh(this.cachedPersonnelId);
    // AUDIT-505 (T-502): schedule.delete — the mock's mirror.
    await writeAuditMirror(this.client, {
      action: "schedule.delete",
      entityType: "schedule",
      entityId: id,
    });
    return Ok(undefined);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private seed(personnelId: string): void {
    if (!this.freshness.shouldReseed() && this.cache.get() !== null) return;
    this.freshness.markSeeded();
    void this.refresh(personnelId);
  }

  private seedWeek(): void {
    // The week view piggybacks on the personnel cache when one is loaded;
    // otherwise it loads the tenant-wide window (the honest fallback).
    if (!this.freshness.shouldReseed() && this.cache.get() !== null) return;
    this.freshness.markSeeded();
    void this.refresh("");
  }

  private async refresh(personnelId: string): Promise<void> {
    try {
      let query = this.client
        .from("schedules")
        .select("*")
        .eq("tenant_id", getTenantId());
      if (personnelId) query = query.eq("personnel_id", personnelId);
      const { data, error } = await query.order("date", { ascending: false }).limit(500);
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapScheduleRow(row as unknown as ScheduleRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }
}
