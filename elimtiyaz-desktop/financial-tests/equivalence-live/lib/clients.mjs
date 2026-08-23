// ============================================================================
// lib/clients.mjs — Client adapters: Desktop & Mobile execution paths.
// ----------------------------------------------------------------------------
// Each adapter executes the SAME canonical input through the API-call pattern
// its real counterpart uses (encoded from the actual source code):
//
//  DESKTOP  (src/infrastructure/supabase/repositories/supabase-shared-repositories.ts)
//    - amounts in DZD (decimal) end-to-end
//    - upsert_parent_from_import / upsert_student_from_import (UUID refs)
//    - ledger via upsert_ledger_entry_from_import (p_metadata JSON object)
//    - payments via upsert_payment_from_import (p_status null → engine derives)
//    - installments via upsert_installment_from_import (bulk import contract)
//    - account ids: parent:{id}:category:{cat}[:student:{sid}]
//
//  MOBILE   (app/.../infrastructure/sync/SyncQueueDispatcher.kt)
//    - amounts stored in CENTIMES locally, converted with `/100.0` before RPC
//    - parent reference prefers parent_code (migration 0037 ref-tolerance),
//      falls back to UUID when the 0037 contract is not deployed
//    - identical RPC family, Android payload key conventions
//    - source_type "android_sync" for sync-pushed rows
//
// The adapters deliberately produce observable differences ONLY where the real
// clients differ (amount rounding path, reference style, metadata). Everything
// else must converge to identical normalized DB state.
// ============================================================================

import { env } from "./env.mjs";
import { rpc } from "./rest.mjs";

const T = () => env.tenantId;

export class DesktopClient {
  constructor(probe) {
    this.name = "desktop";
    this.probe = probe; // capability probe result
  }

  async upsertParent(p) {
    return rpc("upsert_parent_from_import", {
      p_tenant_id: T(),
      p_parent_code: p.parentCode,
      p_first_name: p.firstName,
      p_last_name: p.lastName,
      p_display_name: p.displayName,
      p_primary_phone: p.primaryPhone,
      p_secondary_phone: null,
      p_email: p.email,
      p_is_active: true,
    });
  }

  async upsertStudent(s, parentId /* UUID */) {
    return rpc("upsert_student_from_import", {
      p_tenant_id: T(),
      p_student_code: s.studentCode,
      p_parent_id: parentId,
      p_first_name: s.firstName,
      p_last_name: s.lastName,
      p_display_name: s.displayName,
      p_date_of_birth: s.dateOfBirth || null,
      p_grade_level_code: s.gradeLevelCode,
      p_payment_plan: s.paymentPlan,
      p_enrollment_status: "active",
      p_is_active: true,
    });
  }

  async pushCharge({ parentId, studentId, category, amount, description, sourceId, entryNumber }) {
    return rpc("upsert_ledger_entry_from_import", {
      p_tenant_id: T(),
      p_entry_number: entryNumber,
      p_parent_id: parentId,
      p_student_id: studentId,
      p_account_id: accountId(parentId, category, studentId),
      p_entry_type: "charge",
      p_amount: amount, // DZD, signed (charge positive)
      p_category: category,
      p_description: description,
      p_source_type: "manual_entry",
      p_source_id: sourceId,
      p_method: null,
      p_receipt_number: null,
      p_payment_status: null,
      p_reverses_id: null,
      p_actor_id: env.actorId,
      p_actor_name: env.actorName,
      p_at: new Date().toISOString(),
      p_metadata: { client: "desktop", source: "equivalence-live" },
    });
  }

  async pushPayment({ parentId, studentId, paymentNumber, amount, method, category, description, collectedAt, status }) {
    // Desktop contract: p_status null → DB derives status from method
    const r = await rpc("upsert_payment_from_import", {
      p_tenant_id: T(),
      p_payment_number: paymentNumber,
      p_parent_id: parentId,
      p_student_id: studentId,
      p_amount: amount, // DZD decimal
      p_method: method,
      p_category: category || "tuition",
      p_status: status ?? null,
      p_proof_path: null,
      p_collected_at: collectedAt || new Date().toISOString(),
      p_collected_by: env.actorId,
      p_notes: description,
    });
    // Desktop also appends the canonical payment ledger entry (negative).
    let ledger = null;
    if (r.ok) {
      ledger = await rpc("upsert_ledger_entry_from_import", {
        p_tenant_id: T(),
        p_entry_number: `led-${paymentNumber}`,
        p_parent_id: parentId,
        p_student_id: studentId,
        p_account_id: accountId(parentId, category || "tuition", studentId),
        p_entry_type: "payment",
        p_amount: -amount, // payments are negative on the ledger
        p_category: category || "tuition",
        p_description: description,
        p_source_type: "manual_entry",
        p_source_id: `payment-${paymentNumber}`,
        p_method: method,
        p_receipt_number: paymentNumber,
        p_payment_status: status ?? (method === "cash" ? "paid" : "pending"),
        p_reverses_id: null,
        p_actor_id: env.actorId,
        p_actor_name: env.actorName,
        p_at: collectedAt || new Date().toISOString(),
        p_metadata: { client: "desktop", paymentNumber },
      });
    }
    return { payment: r, ledger };
  }

  async pushAdjustment({ parentId, studentId, amount, reason, description, sourceId, entryNumber }) {
    return rpc("upsert_ledger_entry_from_import", {
      p_tenant_id: T(),
      p_entry_number: entryNumber,
      p_parent_id: parentId,
      p_student_id: studentId ?? null,
      p_account_id: accountId(parentId, "tuition", studentId),
      p_entry_type: "adjustment",
      p_amount: amount, // signed
      p_category: "tuition",
      p_description: description,
      p_source_type: "manual_entry",
      p_source_id: sourceId,
      p_method: null,
      p_receipt_number: null,
      p_payment_status: null,
      p_reverses_id: null,
      p_actor_id: env.actorId,
      p_actor_name: env.actorName,
      p_at: new Date().toISOString(),
      p_metadata: { client: "desktop", reason },
    });
  }

  async pushInstallment(inst) {
    if (!this.probe.has.upsert_installment_from_import) {
      return { ok: false, skipped: true, error: "upsert_installment_from_import not deployed (pre-0037)" };
    }
    // 0037 ref-based contract: label drives tranche_number derivation; the
    // ref provides sync identity. Amounts DZD.
    return rpc("upsert_installment_from_import", {
      p_tenant_id: T(),
      p_parent_id: inst.parentId,
      p_installment_ref: inst.sourceId,
      p_student_id: inst.studentId,
      p_category: inst.category || "tuition",
      p_label: inst.label ?? `Tranche ${inst.trancheNumber}`,
      p_amount_due: inst.amountDue,
      p_amount_paid: inst.amountPaid ?? 0,
      p_amount_pending: inst.amountPending ?? 0,
      p_due_date: inst.dueDate,
      p_paid_date: null,
      p_status: inst.status || "unpaid",
      p_academic_cycle: inst.academicCycle || null,
      p_academic_year: inst.academicYear || null,
    });
  }

  async updateStudentGrade(canon, parentId, gradeLevelCode) {
    // Desktop edits re-push the full student entity through the idempotent
    // upsert contract (same RPC, matched by student_code).
    return rpc("upsert_student_from_import", {
      p_tenant_id: T(),
      p_student_code: canon.studentCode,
      p_parent_id: parentId,
      p_first_name: canon.firstName,
      p_last_name: canon.lastName,
      p_display_name: canon.displayName,
      p_date_of_birth: canon.dateOfBirth || null,
      p_grade_level_code: gradeLevelCode,
      p_payment_plan: canon.paymentPlan,
      p_enrollment_status: "active",
      p_is_active: true,
    });
  }

  async updateParentPhone(canon, phone) {
    // Desktop edits re-push the full parent entity (idempotent by parent_code).
    return rpc("upsert_parent_from_import", {
      p_tenant_id: T(),
      p_parent_code: canon.parentCode,
      p_first_name: canon.firstName,
      p_last_name: canon.lastName,
      p_display_name: canon.displayName,
      p_primary_phone: phone,
      p_email: canon.email,
      p_is_active: true,
    });
  }
}

export class MobileClient {
  constructor(probe) {
    this.name = "mobile";
    this.probe = probe;
    // 0037 ref-tolerance: prefer parent_code when deployed.
    this.refMode = probe.has.upsert_student_from_import_text_parent ? "code" : "uuid";
  }

  /** Mobile stores centimes; converts with /100.0 before sending (faithful). */
  static dzd(centimes) {
    return centimes / 100.0;
  }

  async upsertParent(p) {
    return rpc("upsert_parent_from_import", {
      p_tenant_id: T(),
      p_parent_code: p.parentCode,
      p_first_name: p.firstName,
      p_last_name: p.lastName,
      p_display_name: p.displayName,
      p_primary_phone: p.primaryPhone,
      p_secondary_phone: null,
      p_email: p.email,
      p_is_active: true,
    });
  }

  async upsertStudent(s, parentRef /* code or uuid per refMode */) {
    return rpc("upsert_student_from_import", {
      p_tenant_id: T(),
      p_student_code: s.studentCode,
      p_parent_id: parentRef, // text (code) on 0037; uuid otherwise
      p_first_name: s.firstName,
      p_last_name: s.lastName,
      p_display_name: s.displayName,
      p_date_of_birth: s.dateOfBirth || null,
      p_grade_level_code: s.gradeLevelCode,
      p_payment_plan: s.paymentPlan,
      p_enrollment_status: "active",
      p_is_active: true,
    });
  }

  async pushCharge({ parentId, parentCode, studentId, category, amount, description, sourceId, entryNumber }) {
    const parentRef = this.refMode === "code" ? parentCode : parentId;
    // Mobile computes centimes locally then divides (float path):
    const amountViaCentimes = MobileClient.dzd(Math.round(amount * 100));
    return rpc("upsert_ledger_entry_from_import", {
      p_tenant_id: T(),
      p_entry_number: entryNumber,
      p_parent_id: parentRef,
      p_student_id: studentId,
      p_account_id: accountId(parentId, category, studentId),
      p_entry_type: "charge",
      p_amount: amountViaCentimes,
      p_category: category,
      p_description: description,
      p_source_type: "android_sync",
      p_source_id: sourceId,
      p_method: null,
      p_receipt_number: null,
      p_payment_status: null,
      p_reverses_id: null,
      p_actor_id: env.actorId ?? "android-sync",
      p_actor_name: "Android",
      p_at: new Date().toISOString(),
      p_metadata: { client: "android", source: "sync_queue" },
    });
  }

  async pushPayment({ parentId, parentCode, studentId, paymentNumber, amount, method, category, description, collectedAt, status }) {
    const parentRef = this.refMode === "code" ? parentCode : parentId;
    const amountViaCentimes = MobileClient.dzd(Math.round(amount * 100));
    const r = await rpc("upsert_payment_from_import", {
      p_tenant_id: T(),
      p_payment_number: paymentNumber,
      p_parent_id: parentRef,
      p_student_id: studentId,
      p_amount: amountViaCentimes,
      p_method: method,
      p_category: category || "tuition",
      p_status: status ?? (method === "cash" ? "paid" : "pending"),
      p_proof_path: null,
      p_collected_at: collectedAt || new Date().toISOString(),
      p_collected_by: env.actorId,
      p_notes: description,
    });
    let ledger = null;
    if (r.ok) {
      ledger = await rpc("upsert_ledger_entry_from_import", {
        p_tenant_id: T(),
        p_entry_number: `led-${paymentNumber}`,
        p_parent_id: parentRef,
        p_student_id: studentId,
        p_account_id: accountId(parentId, category || "tuition", studentId),
        p_entry_type: "payment",
        p_amount: -amountViaCentimes,
        p_category: category || "tuition",
        p_description: description,
        p_source_type: "android_sync",
        p_source_id: `payment-${paymentNumber}`,
        p_method: method,
        p_receipt_number: paymentNumber,
        p_payment_status: status ?? (method === "cash" ? "paid" : "pending"),
        p_reverses_id: null,
        p_actor_id: env.actorId ?? "android-sync",
        p_actor_name: "Android",
        p_at: collectedAt || new Date().toISOString(),
        p_metadata: { client: "android", paymentNumber },
      });
    }
    return { payment: r, ledger };
  }

  async pushAdjustment({ parentId, parentCode, studentId, amount, reason, description, sourceId, entryNumber }) {
    const parentRef = this.refMode === "code" ? parentCode : parentId;
    const amountViaCentimes = MobileClient.dzd(Math.round(amount * 100));
    return rpc("upsert_ledger_entry_from_import", {
      p_tenant_id: T(),
      p_entry_number: entryNumber,
      p_parent_id: parentRef,
      p_student_id: studentId ?? null,
      p_account_id: accountId(parentId, "tuition", studentId),
      p_entry_type: "adjustment",
      p_amount: amountViaCentimes, // signed
      p_category: "tuition",
      p_description: description,
      p_source_type: "android_sync",
      p_source_id: sourceId,
      p_method: null,
      p_receipt_number: null,
      p_payment_status: null,
      p_reverses_id: null,
      p_actor_id: env.actorId ?? "android-sync",
      p_actor_name: "Android",
      p_at: new Date().toISOString(),
      p_metadata: { client: "android", reason },
    });
  }

  async pushInstallment(inst) {
    if (!this.probe.has.upsert_installment_from_import) {
      return { ok: false, skipped: true, error: "upsert_installment_from_import not deployed (pre-0037)" };
    }
    // 0037 ref-based contract; mobile path converts centimes -> DZD (/100.0)
    // exactly like SyncQueueDispatcher.kt, and pushes its local ref + code.
    return rpc("upsert_installment_from_import", {
      p_tenant_id: T(),
      p_parent_id: inst.parentCode ?? inst.parentId,
      p_installment_ref: inst.sourceId,
      p_student_id: inst.studentId,
      p_category: inst.category || "tuition",
      p_label: inst.label ?? `Tranche ${inst.trancheNumber}`,
      p_amount_due: MobileClient.dzd(Math.round(inst.amountDue * 100)),
      p_amount_paid: MobileClient.dzd(Math.round((inst.amountPaid ?? 0) * 100)),
      p_amount_pending: MobileClient.dzd(Math.round((inst.amountPending ?? 0) * 100)),
      p_due_date: inst.dueDate,
      p_paid_date: null,
      p_status: inst.status || "unpaid",
      p_academic_cycle: inst.academicCycle || null,
      p_academic_year: inst.academicYear || null,
    });
  }

  async updateStudentGrade(canon, parentRef, gradeLevelCode) {
    // Mobile edits re-push the full student entity through the sync queue
    // (SyncQueueDispatcher -> upsert_student_from_import).
    return rpc("upsert_student_from_import", {
      p_tenant_id: T(),
      p_student_code: canon.studentCode,
      p_parent_id: parentRef,
      p_first_name: canon.firstName,
      p_last_name: canon.lastName,
      p_display_name: canon.displayName,
      p_date_of_birth: canon.dateOfBirth || null,
      p_grade_level_code: gradeLevelCode,
      p_payment_plan: canon.paymentPlan,
      p_enrollment_status: "active",
      p_is_active: true,
    });
  }

  async updateParentPhone(canon, phone) {
    // Mobile edits re-push the full parent entity through the sync queue.
    return rpc("upsert_parent_from_import", {
      p_tenant_id: T(),
      p_parent_code: canon.parentCode,
      p_first_name: canon.firstName,
      p_last_name: canon.lastName,
      p_display_name: canon.displayName,
      p_primary_phone: phone,
      p_email: canon.email,
      p_is_active: true,
    });
  }
}

export function accountId(parentId, category, studentId) {
  return studentId
    ? `parent:${parentId}:category:${category}:student:${studentId}`
    : `parent:${parentId}:category:${category}`;
}
