/**
 * SupabaseReleveRepository — Supabase-backed implementation of the
 * `ReleveRepository` domain contract (plan §09.05).
 *
 * Task: T-481 (139th session, 2026-10-04) — the WORKFORCE-508 fix (the
 * T-477 Personnel-page audit). BEFORE this, the `releve` slot stayed on
 * MockReleveRepository even in Supabase mode — the "Relevé d'Activité"
 * tab's entries were in-memory only (wiped on restart) AND keyed by the
 * ACCOUNT id (session.userId) where the canonical table's personnel_id is
 * an FK to personnel(id), so even the mock's own self-view and the
 * per-personnel views could never intersect. Meanwhile the Android app
 * reads REAL releve_entries rows (Room + sync) — the two platforms showed
 * different universes.
 *
 * Table (migration 0009):
 *   `releve_entries` — personnel_id (FK personnel, cascade) / activity_type
 *   CHECK ('course','meeting','surveillance','correction','task',
 *   'delivery','warehouse','admin','other') / class_id (FK classes) /
 *   class_subject_id (FK class_subjects) / description / clock_in_at
 *   (timestamptz NOT NULL) / clock_out_at / duration_minutes (GENERATED) /
 *   recorded_by (user_profiles.id, NOT NULL — "NOT the personnel
 *   themselves per §09.05") / recorded_at.
 *
 * MAPPING NOTES (documented):
 *   1. date + hoursIn/hoursOut (decimal hours) ↔ clock_in_at /
 *      clock_out_at timestamptz, built in Africa/Algiers (+01:00, no DST).
 *      Read-side: the date and decimal hours are derived back in the same
 *      zone (an entry written here reads back identically).
 *   2. The domain activity union (8 values) is a SUBSET of the DB CHECK
 *      after 0140 (which widened it with 'supervision' — the two clients'
 *      shared wire code; the 0009 CHECK had the French 'surveillance'
 *      spelling and would have rejected every client "Surveillance"
 *      entry — the discovery of this port); writes are safe verbatim; a
 *      historical DB 'surveillance' row folds to domain 'supervision' on
 *      read (the same activity), and the DB-only 'admin' folds to 'other'.
 *   3. personnelName ↔ resolved through the `personnel(first_name,
 *      last_name)` embed (the FK exists) — "Prénom Nom", "—" fallback.
 *   4. subjectId: the 0009 table has NO subject_id column (it models the
 *      subject through the class_subjects junction id, which the manual
 *      path never carries — the tab passes classId/subjectId null). A
 *      non-null subjectId is folded into the description (" · Matière :
 *      <id>") — never silently dropped (no live caller passes one today;
 *      documented for the mock-parity contract).
 *   5. recordedById ↔ recorded_by (UUID-guarded BEFORE the round-trip —
 *      the T-178 precedent). The 0009 RLS allows INSERT only for
 *      super_admin/financial_officer/support_staff/manager, and the
 *      prevent_self_releve_entry trigger raises when recorded_by equals
 *      the target personnel's bound user_id — a rejected write surfaces
 *      as the repository's Err with the server's userMessage (the UI's
 *      admin form records FOR a selected staff member; the teacher view
 *      is read-only).
 *   6. autoKind ↔ auto_kind (T-482/ADR-034/migration 0141): rows written by
 *      the canonical `record_auto_releve_entry` RPC carry entry_source=
 *      'auto' + their kind; the manual rows written by logEntry keep the
 *      'manual' default (auto_kind stays null — the coupling CHECK
 *      enforces it server-side). The Relevé tab's existing "auto" badge
 *      renders these with zero UI change. The 0009-era note that auto
 *      entries "cannot exist under the canonical contract" was resolved
 *      by UNKNOWN-030's ruling (ADR-034).
 *   7. duration_minutes is GENERATED server-side — never written.
 *
 * RLS (0019): SELECT = the staff quartet OR own-personnel (the teacher
 * sees their own ledger); INSERT = the staff quartet only (the trigger is
 * the self-entry backstop).
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache
 * + T-034/CROSS-104 freshness policy + refresh after every successful
 * write. The cache is keyed by personnel id (one subject per requested
 * member; the tab views ONE member at a time).
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `releve` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { ReleveRepository } from "../../../domain/repository/repository";
import type { ReleveActivity, ReleveEntry } from "../../../domain/model/personnel";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { getTenantId } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types
// ============================================================================

interface ReleveRow {
  id: string;
  tenant_id: string;
  personnel_id: string;
  activity_type: string;
  class_id: string | null;
  class_subject_id: string | null;
  description: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  duration_minutes: number | null;
  recorded_by: string;
  recorded_at: string;
  created_at: string;
  // T-482 (ADR-034 / migration 0141): present on rows written after 0141;
  // older rows (and the fake-client fixtures) may omit them.
  entry_source?: string | null;
  auto_kind?: string | null;
  personnel?: { first_name: string | null; last_name: string | null } | null;
}

const DOMAIN_ACTIVITIES: ReadonlySet<string> = new Set([
  "course", "meeting", "supervision", "correction",
  "task", "delivery", "warehouse", "other",
]);

/** The migration-0141 §09.06 auto kinds (mapping note 6's fold guard). */
const AUTO_KINDS: ReadonlySet<string> = new Set([
  "grade_entry", "homework_push", "roll_call",
]);

/** The 0140 alias fold: the 0009 French spelling → the clients' wire code. */
function activityFromDb(dbValue: string): ReleveActivity {
  if (dbValue === "surveillance") return "supervision";
  return (DOMAIN_ACTIVITIES.has(dbValue) ? dbValue : "other") as ReleveActivity;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Decimal hours → "HH:MM" (Algiers wall clock input, e.g. 8.5 → "08:30"). */
function decimalHoursToHm(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Build an Algiers (+01:00) ISO timestamp from a YYYY-MM-DD + decimal hours. */
function algiersIsoFrom(date: string, hours: number): string {
  return `${date}T${decimalHoursToHm(hours)}:00+01:00`;
}

/** Derive { date, hours } back from an ISO timestamp in Africa/Algiers. */
function algoursPartsFromIso(iso: string): { date: string; hours: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Algiers",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const hours = Number(get("hour")) + Number(get("minute")) / 60;
    return { date, hours };
  } catch {
    return { date: iso.slice(0, 10), hours: 0 };
  }
}

function mapRow(row: ReleveRow): ReleveEntry {
  const inParts = algoursPartsFromIso(row.clock_in_at);
  const outHours = row.clock_out_at ? algoursPartsFromIso(row.clock_out_at).hours : null;
  const name = row.personnel
    ? `${row.personnel.first_name ?? ""} ${row.personnel.last_name ?? ""}`.trim()
    : "—";
  return {
    id: row.id,
    personnelId: row.personnel_id,
    personnelName: name,
    date: inParts.date,
    hoursIn: inParts.hours,
    hoursOut: outHours,
    activity: activityFromDb(row.activity_type),
    classId: row.class_id,
    subjectId: null, // mapping note 4 — no 0009 column; folded into description at write.
    autoKind:
      row.entry_source === "auto" && row.auto_kind && AUTO_KINDS.has(row.auto_kind)
        ? (row.auto_kind as ReleveEntry["autoKind"])
        : null, // mapping note 6 — T-482/ADR-034 (unknown kinds fold to null)
    note: row.description,
    recordedAt: row.recorded_at,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseReleveRepository implements ReleveRepository {
  private readonly cache = new SubjectBehavior<ReleveEntry[] | null>(null);
  private readonly freshness = new CacheFreshness();
  private cachedPersonnelId = "";

  constructor(private readonly client: SupabaseClient) {}

  observeByPersonnel(
    personnelId: string,
    from: string,
    to: string,
  ): Observable<ReleveEntry[]> {
    // The window filter is applied client-side (the cache is per-member;
    // PostgREST range filters on timestamptz would need the Algiers-day
    // boundary translation — the from/to contract is calendar-day based).
    if (personnelId !== this.cachedPersonnelId) {
      this.cache.set(null);
      this.cachedPersonnelId = personnelId;
    }
    this.seed(personnelId);
    return {
      subscribe: (fn: (value: ReleveEntry[]) => void) =>
        this.cache.subscribe((v) => fn(v ?? [])),
      get: (): ReleveEntry[] =>
        (this.cache.get() ?? []).filter((e) => e.date >= from && e.date <= to),
    };
  }

  async logEntry(input: {
    personnelId: string;
    personnelName: string;
    date: string;
    hoursIn: number;
    hoursOut: number | null;
    activity: ReleveActivity;
    classId: string | null;
    subjectId: string | null;
    recordedById: string;
  }): Promise<Result<ReleveEntry>> {
    // Mapping note 5: both ids are uuids (personnel FK + the recorded_by
    // account); a mock-era id must never reach either column.
    if (!isUuid(input.personnelId)) {
      return Err(Errors.validation("Membre du personnel invalide (fiche non synchronisée)"));
    }
    if (!isUuid(input.recordedById)) {
      return Err(Errors.validation("Compte enregistreur invalide (identifiant non synchronisé)"));
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      return Err(Errors.validation("Date invalide (format attendu : AAAA-MM-JJ)"));
    }
    if (input.hoursIn < 0 || input.hoursIn >= 24) {
      return Err(Errors.validation("Heure d'arrivée invalide"));
    }
    if (input.hoursOut != null && (input.hoursOut < 0 || input.hoursOut >= 24)) {
      return Err(Errors.validation("Heure de départ invalide"));
    }
    if (input.hoursOut != null && input.hoursOut <= input.hoursIn) {
      return Err(Errors.validation("L'heure de départ doit être après l'arrivée."));
    }
    if (input.classId != null && !isUuid(input.classId)) {
      return Err(Errors.validation("Classe liée invalide"));
    }

    // Mapping note 4: fold a non-null subjectId into the description.
    const descriptionParts: string[] = [];
    if (input.subjectId) descriptionParts.push(`Matière : ${input.subjectId}`);

    const { data, error } = await this.client
      .from("releve_entries")
      .insert({
        tenant_id: getTenantId(),
        personnel_id: input.personnelId,
        activity_type: input.activity,
        class_id: input.classId,
        description: descriptionParts.length > 0 ? descriptionParts.join(" · ") : null,
        clock_in_at: algiersIsoFrom(input.date, input.hoursIn),
        clock_out_at: input.hoursOut != null ? algiersIsoFrom(input.date, input.hoursOut) : null,
        recorded_by: input.recordedById,
      })
      .select("*, personnel(first_name, last_name)")
      .single();
    if (error) {
      // The 0009 trigger's §09.05 violation + the RLS refusal both surface
      // here with the server's message (never swallowed).
      return Err(supabaseErrorToAppError(error));
    }
    await this.refresh(input.personnelId);
    return Ok(mapRow(data as unknown as ReleveRow));
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private seed(personnelId: string): void {
    if (!this.freshness.shouldReseed() && this.cache.get() !== null) return;
    this.freshness.markSeeded();
    void this.refresh(personnelId);
  }

  private async refresh(personnelId: string): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("releve_entries")
        .select("*, personnel(first_name, last_name)")
        .eq("tenant_id", getTenantId())
        .eq("personnel_id", personnelId)
        .order("clock_in_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapRow(row as unknown as ReleveRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }
}
