/**
 * conflict-detector — T-298 (OFFLINE-400, 46th session, 2026-09-11).
 *
 * The production wiring of the 3-way no-silent-overwrite guard on the
 * sync-queue push path:
 *
 *   1. fetches the CURRENT server row for the entry's entity (the
 *      REMOTE/User-B side) through the same tables + unique keys the
 *      canonical `upsert_*_from_import` RPCs upsert on;
 *   2. projects the queue payload (domain camelCase) into the SERVER-ROW
 *      key space (the push handler already accepts both conventions —
 *      every field has the `?? snake_case` fallback);
 *   3. runs the PURE `computeThreeWay` engine (domain/calc/diff/three-way)
 *      over base / local / remote;
 *   4. returns a JSON-safe `SyncConflictRecord` when fields BOTH sides
 *      changed differ (the SyncService parks the entry in `conflict`
 *      status — never a silent overwrite), or null when the push may
 *      proceed.
 *
 * Entity kinds without a derivable single-row key (installment — resolved
 * through the ledger by the RPC; expense/invoice/personnel/... — no
 * canonical import path in the dispatcher) return null: no detection, the
 * push proceeds through its own RPC semantics. Documented honestly — the
 * guard covers every kind the dispatcher actually pushes with a table-level
 * conflict key.
 */

import type { SyncConflictRecord, SyncEntityKind, SyncQueueEntry } from "./sync-types";
import { computeThreeWay, type ThreeWayResult } from "../../domain/calc/diff/three-way";

/* ------------------------------------------------------------------ */
/*  Entity key mapping — the tables + unique keys the push RPCs use    */
/* ------------------------------------------------------------------ */

interface EntityMapping {
  readonly table: string;
  /** Build the unique-key WHERE filters from the queue payload. */
  readonly keyFilters: (payload: Record<string, unknown>) => Record<string, unknown> | null;
  /** camelCase payload key → server-row column. */
  readonly aliases: Record<string, string>;
}

const ENTITY_MAPPINGS: Partial<Record<SyncEntityKind, EntityMapping>> = {
  parent: {
    table: "parents",
    keyFilters: (p) => {
      const code = (p.code as string) ?? (p.parent_code as string);
      return code ? { parent_code: code } : null;
    },
    aliases: {
      code: "parent_code",
      parent_code: "parent_code",
      firstName: "first_name",
      first_name: "first_name",
      lastName: "last_name",
      last_name: "last_name",
      displayName: "display_name",
      display_name: "display_name",
      phone: "primary_phone",
      primary_phone: "primary_phone",
      whatsapp: "secondary_phone",
      secondary_phone: "secondary_phone",
      email: "email",
      occupation: "occupation",
      address: "address",
      preferredLanguage: "preferred_language",
      preferred_language: "preferred_language",
      transportDestination: "transport_destination",
      transport_destination: "transport_destination",
      cityTier: "city_tier",
      city_tier: "city_tier",
      isActive: "is_active",
      is_active: "is_active",
    },
  },
  student: {
    table: "students",
    keyFilters: (p) => {
      const code = (p.code as string) ?? (p.student_code as string);
      return code ? { student_code: code } : null;
    },
    aliases: {
      code: "student_code",
      student_code: "student_code",
      parentId: "parent_id",
      parent_id: "parent_id",
      firstName: "first_name",
      first_name: "first_name",
      lastName: "last_name",
      last_name: "last_name",
      displayName: "display_name",
      display_name: "display_name",
      birthDate: "date_of_birth",
      date_of_birth: "date_of_birth",
      gender: "gender",
      classId: "class_id",
      class_id: "class_id",
      medicalNotes: "medical_notes",
      medical_notes: "medical_notes",
      gradeLevel: "grade_level_code",
      grade_level_code: "grade_level_code",
      grade_level_id: "grade_level_id",
      transportTier: "transport_tier",
      transport_tier: "transport_tier",
      paymentPlan: "payment_plan",
      payment_plan: "payment_plan",
      isActive: "is_active",
      is_active: "is_active",
    },
  },
  payment: {
    table: "payments",
    keyFilters: (p) => {
      // A payload without a receipt number lets the SERVER allocate one
      // (migration 0058) — there is no pre-existing row to conflict with.
      const number = (p.receiptNumber as string) ?? (p.payment_number as string);
      return number ? { payment_number: number } : null;
    },
    aliases: {
      receiptNumber: "payment_number",
      payment_number: "payment_number",
      parentId: "parent_id",
      parent_id: "parent_id",
      studentId: "student_id",
      student_id: "student_id",
      amount: "amount",
      method: "method",
      category: "category",
      status: "status",
      proofUrl: "proof_path",
      proof_path: "proof_path",
      collectedAt: "collected_at",
      collected_at: "collected_at",
      collectedBy: "collected_by",
      collected_by: "collected_by",
      notes: "notes",
    },
  },
  ledger_entry: {
    table: "ledger_entries",
    keyFilters: (p) => {
      const number = (p.id as string) ?? (p.entry_number as string);
      return number ? { entry_number: number } : null;
    },
    aliases: {
      id: "entry_number",
      entry_number: "entry_number",
      parentId: "parent_id",
      parent_id: "parent_id",
      studentId: "student_id",
      student_id: "student_id",
      accountId: "account_id",
      account_id: "account_id",
      type: "entry_type",
      entry_type: "entry_type",
      amount: "amount",
      category: "category",
      description: "description",
      sourceType: "source_type",
      source_type: "source_type",
      sourceId: "source_id",
      source_id: "source_id",
      method: "method",
      receiptNumber: "receipt_number",
      receipt_number: "receipt_number",
      paymentStatus: "payment_status",
      payment_status: "payment_status",
      reversesId: "reverses_id",
      reverses_id: "reverses_id",
      actorId: "actor_id",
      actor_id: "actor_id",
      actorName: "actor_name",
      actor_name: "actor_name",
      at: "at",
      metadata: "metadata",
    },
  },
  homework: {
    table: "homework",
    keyFilters: (p) => (typeof p.id === "string" && p.id ? { id: p.id } : null),
    aliases: {
      id: "id",
      classId: "class_id",
      class_id: "class_id",
      subjectId: "subject_id",
      subject_id: "subject_id",
      subjectName: "subject_name",
      subject_name: "subject_name",
      teacherId: "teacher_id",
      teacher_id: "teacher_id",
      teacherName: "teacher_name",
      teacher_name: "teacher_name",
      title: "title",
      description: "description",
      dueDate: "due_date",
      due_date: "due_date",
      academicYear: "academic_year",
      academic_year: "academic_year",
      pushedAt: "pushed_at",
      pushed_at: "pushed_at",
      createdAt: "created_at",
      created_at: "created_at",
      attachments: "attachments",
    },
  },
  attendance: {
    table: "attendance_records",
    keyFilters: (p) => {
      const studentId = (p.studentId as string) ?? (p.student_id as string);
      const date = (p.recordDate as string) ?? (p.record_date as string) ?? (p.date as string);
      const session = (p.session as string) ?? "morning";
      if (!studentId || !date) return null;
      return { student_id: studentId, record_date: date, session };
    },
    aliases: {
      studentId: "student_id",
      student_id: "student_id",
      recordDate: "record_date",
      record_date: "record_date",
      date: "record_date",
      status: "status",
      classId: "class_id",
      class_id: "class_id",
      session: "session",
      arrivalTime: "arrival_time",
      arrival_time: "arrival_time",
      note: "note",
      recordedBy: "recorded_by",
      recorded_by: "recorded_by",
    },
  },
  grade: {
    table: "assessments",
    keyFilters: (p) => {
      const studentId = (p.studentId as string) ?? (p.student_id as string);
      const subjectId = (p.subjectId as string) ?? (p.subject_id as string);
      const term = (p.term as number) ?? 1;
      const year = (p.academicYear as string) ?? (p.academic_year as string);
      if (!studentId || !subjectId || !year) return null;
      return { student_id: studentId, subject_id: subjectId, term, academic_year: year };
    },
    aliases: {
      studentId: "student_id",
      student_id: "student_id",
      subjectId: "subject_id",
      subject_id: "subject_id",
      term: "term",
      academicYear: "academic_year",
      academic_year: "academic_year",
      classId: "class_id",
      class_id: "class_id",
      devoir1: "devoir1",
      devoir2: "devoir2",
      examen: "examen",
      coefficient: "coefficient",
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Payload projection (camelCase domain → server-row keys)            */
/* ------------------------------------------------------------------ */

/**
 * Project a queue payload into the SERVER-ROW key space for the entity.
 * Top-level keys with a known alias are renamed; everything else passes
 * through unchanged (extra payload fields must survive — the projection
 * must never drop data). Already-projected (snake_case) payloads project
 * to themselves (identity) — safe to call repeatedly.
 */
export function projectPayloadToRowShape(
  entity: SyncEntityKind,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const mapping = ENTITY_MAPPINGS[entity];
  if (!mapping) return { ...payload };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const alias = mapping.aliases[key];
    if (alias && !(alias in out)) out[alias] = value;
    else if (!alias && !(key in out)) out[key] = value;
  }
  return out;
}

/**
 * Compute the 3-way for a queue entry against a KNOWN remote row (or a
 * live fetch when omitted). Shared by detection AND resolution so both
 * sides see identical semantics (ADR-002 discipline — one derivation).
 */
export async function computeThreeWayForEntry(
  entry: Pick<SyncQueueEntry, "entity" | "payload" | "basePayload">,
  remoteOverride?: Record<string, unknown> | null,
): Promise<{ threeWay: ThreeWayResult; remote: Record<string, unknown> | null }> {
  const remote =
    remoteOverride !== undefined ? remoteOverride : await fetchRemoteRow(entry.entity, entry.payload);
  if (!remote) {
    // No server row (or no derivable key) → nothing to diverge from.
    return { threeWay: { merged: null, conflicts: [], autoMergedPaths: [] }, remote: null };
  }
  const base = entry.basePayload ?? null;
  const local = projectPayloadToRowShape(entry.entity, entry.payload);
  const threeWay = computeThreeWay(base, local, remote);
  return { threeWay, remote };
}

/**
 * The SYNCHRONOUS variant for a KNOWN remote row — the resolver modal's
 * render path (the remote is persisted on the conflict record; no fetch).
 */
export function computeThreeWayForEntrySync(
  entry: Pick<SyncQueueEntry, "entity" | "payload" | "basePayload">,
  remote: Record<string, unknown> | null,
): ThreeWayResult {
  if (!remote) return { merged: null, conflicts: [], autoMergedPaths: [] };
  const base = entry.basePayload ?? null;
  const local = projectPayloadToRowShape(entry.entity, entry.payload);
  return computeThreeWay(base, local, remote);
}

/* ------------------------------------------------------------------ */
/*  The guard (wired into SyncServiceOptions.conflictGuard)            */
/* ------------------------------------------------------------------ */

/**
 * The production conflict guard: fetch the remote row, run the 3-way,
 * return the conflict record when fields BOTH sides changed differ.
 */
export async function conflictGuard(entry: SyncQueueEntry): Promise<SyncConflictRecord | null> {
  const mapping = ENTITY_MAPPINGS[entry.entity];
  if (!mapping) return null; // No derivable key — documented no-detection.
  const { threeWay, remote } = await computeThreeWayForEntry(entry);
  if (!remote || threeWay.conflicts.length === 0) return null;

  return {
    detectedAt: new Date().toISOString(),
    remotePayload: remote,
    conflictPaths: threeWay.conflicts.map((c) => c.path),
    conflictPreviews: threeWay.conflicts.map((c) => ({
      path: c.path,
      base: c.baseDisplay,
      local: c.localDisplay,
      remote: c.remoteDisplay,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Remote row fetch                                                   */
/* ------------------------------------------------------------------ */

/**
 * Fetch the CURRENT server row for an entity's payload key. Returns null
 * when the kind has no mapping, the payload carries no derivable key, the
 * row does not exist, or the fetch errors (the guard treats a fetch error
 * as no-detection — the push RPCs stay authoritative on errors).
 */
export async function fetchRemoteRow(
  entity: SyncEntityKind,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const mapping = ENTITY_MAPPINGS[entity];
  if (!mapping) return null;
  const filters = mapping.keyFilters(payload);
  if (!filters) return null;
  try {
    const { getSupabaseClient } = await import("../supabase/supabase-client");
    const client = getSupabaseClient();
    let query = client.from(mapping.table).select("*");
    for (const [column, value] of Object.entries(filters)) {
      query = query.eq(column, value);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}
