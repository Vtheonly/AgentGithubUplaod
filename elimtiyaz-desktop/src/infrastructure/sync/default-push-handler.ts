/**
 * defaultPushHandler — the desktop's canonical sync-queue push dispatcher.
 *
 * T-022 (SYNC-100/101): every SyncEntityKind is either pushed through its
 * canonical server path or FAILS LOUD — no silent no-ops. Extracted from
 * sync-provider.tsx (it was module-private and untestable there); the
 * provider wires it into initialiseSyncService unchanged.
 *
 * Canonical paths per kind:
 *   parent        → upsert_parent_from_import      (migration 0027/0037)
 *   student       → upsert_student_from_import     (migration 0027/0037)
 *   payment       → upsert_payment_from_import     (migration 0027/0031/0055/0058)
 *   ledger_entry  → upsert_ledger_entry_from_import(migration 0027/0037)
 *   installment   → upsert_installment_from_import(migration 0037)   — T-022
 *   attendance    → upsert_attendance_from_import (migration 0041)   — T-022
 *   grade         → upsert_assessment_from_import  (migration 0041)   — T-022
 *   homework      → direct `homework` table upsert (mirrors the Android
 *                   SyncQueueDispatcher.pushHomework — no import RPC exists)
 *   everything else → throws (the entry is marked failed, never silently
 *                   "synced").
 */
import type { SyncQueueEntry } from "./sync-types";

/**
 * Default push handler — calls the appropriate Supabase upsert RPC for the
 * entity kind. Each RPC is SECURITY DEFINER + idempotent (declared in
 * migration `0027_shared_unification.sql`), so re-pushing the same queue
 * entry is safe and never creates duplicates.
 *
 * Flow:
 *   1. Look up the entity kind (`parent` | `student` | `payment` |
 *      `ledger_entry` | ...).
 *   2. Map the queue `payload` to the RPC argument shape.
 *   3. Call the corresponding `upsert_*_from_import` RPC.
 *   4. On success, also upsert the queue row into `sync_queue` (for audit)
 *      and call `mark_sync_queue_processed(id, 'synced')`.
 *   5. On failure, call `mark_sync_queue_processed(id, 'failed', error)`
 *      so the next drain attempt respects backoff.
 */
export async function defaultPushHandler(entry: SyncQueueEntry): Promise<void> {
  // We use the dynamic import so the renderer doesn't crash when
  // Supabase isn't configured (the import would throw).
  const { getSupabaseClient } = await import("../supabase/supabase-client");
  const { deterministicActivationCode } = await import("../../core/format/id");
  const client = getSupabaseClient();
  const p = entry.payload ?? {};

  // Persist the queue row (audit trail — idempotent by primary key `id`).
  // SYNC-101 fix: ignoreDuplicates — a RE-drain (retry after failure) must
  // NOT overwrite the row's status back to "pending" or clear its
  // last_error; the first insert wins and mark_sync_queue_processed()
  // records each attempt's outcome. Previously every drain reset the
  // server-side audit trail to "pending".
  const { error: queueErr } = await client
    .from("sync_queue")
    .upsert(
      {
        id: entry.id,
        entity: entry.entity,
        operation: entry.operation,
        tenant_id: entry.tenantId,
        actor_id: entry.actorId,
        payload: p,
        source_file: entry.sourceFile ?? null,
        import_run_id: entry.importRunId ?? null,
        queued_at: entry.queuedAt,
        status: "pending",
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (queueErr) throw queueErr;

  try {
    switch (entry.entity) {
      case "parent": {
        const parentCode =
          (p.code as string) ??
          (p.parent_code as string) ??
          `PAR-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const { error } = await client.rpc("upsert_parent_from_import", {
          p_tenant_id: entry.tenantId,
          p_parent_code: parentCode,
          p_first_name: (p.firstName as string) ?? (p.first_name as string) ?? "",
          p_last_name: (p.lastName as string) ?? (p.last_name as string) ?? "",
          p_display_name: (p.displayName as string) ?? (p.display_name as string) ?? null,
          p_primary_phone: (p.phone as string) ?? (p.primary_phone as string) ?? "(inconnu)",
          p_secondary_phone: (p.whatsapp as string) ?? (p.secondary_phone as string) ?? null,
          p_email: (p.email as string) ?? null,
          p_occupation: (p.occupation as string) ?? null,
          p_address: (p.address as string) ?? null,
          p_relationship: null,
          p_preferred_language: (p.preferredLanguage as string) ?? "fr",
          p_is_active: true,
          // Migration 0028 — pass transport_destination + city_tier so the
          // queue safety-net path persists the same fields as the importer.
          p_transport_destination: (p.transportDestination as string) ?? (p.transport_destination as string) ?? null,
          p_city_tier: (p.cityTier as string) ?? (p.city_tier as string) ?? null,
          // Migration 0037 / vault §02.08 — deterministic activation code
          // (mirrors the Android SyncQueueDispatcher, which always sends
          // p_activation_code when pushing parents).
          p_activation_code: deterministicActivationCode(parentCode, entry.tenantId),
        });
        if (error) throw error;
        break;
      }
      case "student": {
        const { error } = await client.rpc("upsert_student_from_import", {
          p_tenant_id: entry.tenantId,
          p_student_code: (p.code as string) ?? (p.student_code as string) ?? `ELV-${new Date().getFullYear()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`,
          p_parent_id: (p.parentId as string) ?? (p.parent_id as string),
          p_first_name: (p.firstName as string) ?? (p.first_name as string) ?? "",
          p_last_name: (p.lastName as string) ?? (p.last_name as string) ?? "",
          p_display_name: (p.displayName as string) ?? (p.display_name as string) ?? null,
          p_middle_name: null,
          p_date_of_birth: (p.birthDate as string) ?? (p.date_of_birth as string) ?? null,
          p_gender: (p.gender as string) === "unspecified" ? null : (p.gender as string) ?? null,
          p_grade_level_id: null,
          p_class_id: (p.classId as string) ?? (p.class_id as string) ?? null,
          p_enrollment_date: null,
          p_enrollment_status: "active",
          p_medical_notes: (p.medicalNotes as string) ?? (p.medical_notes as string) ?? null,
          p_is_active: true,
          // Migration 0028 — pass grade_level_code + transport_tier +
          // payment_plan so the queue safety-net path persists the same
          // fields as the importer.
          p_grade_level_code: (p.gradeLevel as string) ?? (p.grade_level_code as string) ?? null,
          p_transport_tier: (p.transportTier as string) ?? (p.transport_tier as string) ?? null,
          p_payment_plan: (p.paymentPlan as string) ?? (p.payment_plan as string) ?? "tranches",
        });
        if (error) throw error;
        break;
      }
      case "payment": {
        const { error } = await client.rpc("upsert_payment_from_import", {
          p_tenant_id: entry.tenantId,
          // T-015 / DRIFT-011 — receipt numbers are SERVER-AUTHORITATIVE
          // (ADR-004): when a queued payment carries no number we pass NULL
          // and migration 0058's upsert_payment_from_import generates a
          // canonical REC-YYYY-NNNNNN. The old client-side random
          // `PAY-YYYY-NNNNNN` fallback was collision-prone and broke the
          // sequential-receipt invariant.
          p_payment_number: (p.receiptNumber as string) ?? (p.payment_number as string) ?? null,
          p_parent_id: (p.parentId as string) ?? (p.parent_id as string),
          p_student_id: (p.studentId as string) ?? (p.student_id as string) ?? null,
          p_amount: (p.amount as number) ?? 0,
          p_method: (p.method as string) ?? "cash",
          p_category: (p.category as string) ?? "other",
          p_status: (p.status as string) ?? null,
          p_proof_path: (p.proofUrl as string) ?? (p.proof_path as string) ?? null,
          p_collected_at: (p.collectedAt as string) ?? (p.collected_at as string) ?? null,
          p_collected_by: (p.collectedBy as string) ?? (p.collected_by as string) ?? null,
          p_notes: (p.notes as string) ?? null,
        });
        if (error) throw error;
        break;
      }
      case "ledger_entry": {
        const { error } = await client.rpc("upsert_ledger_entry_from_import", {
          p_tenant_id: entry.tenantId,
          p_entry_number: (p.id as string) ?? (p.entry_number as string) ?? null,
          p_parent_id: (p.parentId as string) ?? (p.parent_id as string),
          p_student_id: (p.studentId as string) ?? (p.student_id as string) ?? null,
          p_account_id: (p.accountId as string) ?? (p.account_id as string) ?? null,
          p_entry_type: (p.type as string) ?? (p.entry_type as string) ?? "charge",
          p_amount: (p.amount as number) ?? 0,
          p_category: (p.category as string) ?? "other",
          p_description: (p.description as string) ?? null,
          p_source_type: (p.sourceType as string) ?? (p.source_type as string) ?? "bulk_import",
          p_source_id: (p.sourceId as string) ?? (p.source_id as string) ?? null,
          p_method: (p.method as string) ?? null,
          p_receipt_number: (p.receiptNumber as string) ?? (p.receipt_number as string) ?? null,
          p_payment_status: (p.paymentStatus as string) ?? (p.payment_status as string) ?? null,
          p_reverses_id: (p.reversesId as string) ?? (p.reverses_id as string) ?? null,
          p_actor_id: (p.actorId as string) ?? (p.actor_id as string) ?? entry.actorId,
          p_actor_name: (p.actorName as string) ?? (p.actor_name as string) ?? "System",
          p_at: (p.at as string) ?? null,
          p_metadata: (p.metadata as Record<string, unknown>) ?? null,
        });
        if (error) throw error;
        break;
      }
      case "installment": {
        // SYNC-100 fix: migration 0037 added the idempotent
        // upsert_installment_from_import RPC for exactly this gap — the
        // desktop dispatcher was never updated (only Android's was), so
        // Excel-import installment entries were silently dropped while the
        // queue reported them "synced".
        const { error } = await client.rpc("upsert_installment_from_import", {
          p_tenant_id: entry.tenantId,
          p_parent_id: (p.parentId as string) ?? (p.parent_id as string),
          p_installment_ref: (p.id as string) ?? (p.installment_ref as string) ?? null,
          p_student_id: (p.studentId as string) ?? (p.student_id as string) ?? null,
          p_category: (p.category as string) ?? "tuition",
          p_label: (p.label as string) ?? null,
          p_amount_due: (p.amountDue as number) ?? (p.amount_due as number) ?? null,
          p_amount_paid: (p.amountPaid as number) ?? (p.amount_paid as number) ?? null,
          p_amount_pending: (p.amountPending as number) ?? (p.amount_pending as number) ?? null,
          p_due_date: (p.dueDate as string) ?? (p.due_date as string) ?? null,
          p_paid_date: (p.paidDate as string) ?? (p.paid_date as string) ?? null,
          p_status: (p.status as string) ?? "unpaid",
          p_academic_cycle: (p.academicCycle as string) ?? (p.academic_cycle as string) ?? null,
          p_academic_year: (p.academicYear as string) ?? (p.academic_year as string) ?? null,
        });
        if (error) throw error;
        break;
      }
      case "attendance": {
        // SYNC-100 fix: canonical roll-call upsert (migration 0041) —
        // conflict key (tenant_id, student_id, record_date, session).
        const { error } = await client.rpc("upsert_attendance_from_import", {
          p_tenant_id: entry.tenantId,
          p_student_id: (p.studentId as string) ?? (p.student_id as string),
          p_record_date: (p.recordDate as string) ?? (p.record_date as string) ?? (p.date as string),
          p_status: (p.status as string) ?? "present",
          p_class_id: (p.classId as string) ?? (p.class_id as string) ?? null,
          p_session: (p.session as string) ?? "morning",
          p_arrival_time: (p.arrivalTime as string) ?? (p.arrival_time as string) ?? null,
          p_note: (p.note as string) ?? null,
          p_recorded_by: (p.recordedBy as string) ?? (p.recorded_by as string) ?? entry.actorId,
        });
        if (error) throw error;
        break;
      }
      case "grade": {
        // SYNC-100 fix: canonical assessment upsert (migration 0041) —
        // conflict key (student, subject, term, academic_year).
        const { error } = await client.rpc("upsert_assessment_from_import", {
          p_tenant_id: entry.tenantId,
          p_student_id: (p.studentId as string) ?? (p.student_id as string),
          p_subject_id: (p.subjectId as string) ?? (p.subject_id as string),
          p_term: (p.term as number) ?? 1,
          p_academic_year: (p.academicYear as string) ?? (p.academic_year as string) ?? "",
          p_class_id: (p.classId as string) ?? (p.class_id as string) ?? null,
          p_devoir1: (p.devoir1 as number) ?? null,
          p_devoir2: (p.devoir2 as number) ?? null,
          p_examen: (p.examen as number) ?? null,
          p_coefficient: (p.coefficient as number) ?? 1,
          p_entered_by: entry.actorId,
        });
        if (error) throw error;
        break;
      }
      case "homework": {
        // SYNC-100 fix: ported VERBATIM from the Android SyncQueueDispatcher
        // pushHomework (android commit history; the `homework` table is the
        // canonical one — migration 0027/0029 — and has no dedicated import
        // RPC, both clients upsert the table directly, matched by PK).
        const id = p.id as string;
        const classId = (p.classId as string) ?? (p.class_id as string);
        const subjectId = (p.subjectId as string) ?? (p.subject_id as string);
        if (!id || !classId || !subjectId) {
          throw new Error("defaultPushHandler(homework): id, classId and subjectId are required");
        }
        const attachmentsRaw = p.attachments as string | null | undefined;
        let attachments: unknown = undefined;
        if (typeof attachmentsRaw === "string" && attachmentsRaw.trim() !== "") {
          try {
            attachments = JSON.parse(attachmentsRaw);
          } catch {
            attachments = undefined;
          }
        }
        const { error } = await client.from("homework").upsert({
          id,
          tenant_id: entry.tenantId,
          class_id: classId,
          subject_id: subjectId,
          subject_name: (p.subjectName as string) ?? (p.subject_name as string) ?? null,
          teacher_id: (p.teacherId as string) ?? (p.teacher_id as string) ?? null,
          teacher_name: (p.teacherName as string) ?? (p.teacher_name as string) ?? null,
          title: (p.title as string) ?? "Devoir",
          description: (p.description as string) ?? "",
          due_date: (p.dueDate as string) ?? (p.due_date as string) ?? "",
          academic_year: (p.academicYear as string) ?? (p.academic_year as string) ?? null,
          pushed_at: (p.pushedAt as string) ?? null,
          created_at: (p.createdAt as string) ?? (p.created_at as string) ?? null,
          ...(attachments !== undefined ? { attachments } : {}),
        });
        if (error) throw error;
        break;
      }
      default: {
        // SYNC-100 fix: NO silent no-ops. Kinds with a canonical server RPC
        // are handled above / below; everything else FAILS LOUD so the entry
        // is marked failed (with this error) instead of being silently
        // marked "synced" without any server-side write ever happening.
        throw new Error(
          `defaultPushHandler: no canonical push path for entity kind "${entry.entity}" — ` +
            "l'entrée reste en échec (aucune perte silencieuse).",
        );
      }
    }

    // Mark the queue row as synced.
    await client.rpc("mark_sync_queue_processed", {
      p_id: entry.id,
      p_status: "synced",
      p_error: null,
    });
  } catch (err) {
    // Mark as failed so the next drain attempt respects exponential backoff.
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await client.rpc("mark_sync_queue_processed", {
        p_id: entry.id,
        p_status: "failed",
        p_error: msg,
      });
    } catch { /* swallow — the original error is the one we throw */ }
    throw err;
  }
}
