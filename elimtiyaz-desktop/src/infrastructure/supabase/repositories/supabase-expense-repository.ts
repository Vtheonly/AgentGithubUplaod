/**
 * SupabaseExpenseRepository — T-093 (DRIFT-013).
 *
 * DRIFT-013: the desktop previously had NO Supabase expenses repository —
 * the `expenses` slot stayed on `MockExpenseRepository` even in Supabase
 * mode, and the (T-088-era) dashboard KPI code that DID query the backend
 * used the domain's table name `expenses`, which does not exist. The
 * canonical table is `expense_tickets` (migration 0008) with different
 * status values and a `category_id` FK instead of a category code.
 *
 * This file ports the repository to the canonical table with an EXPLICIT,
 * CENTRALISED translation layer (status/category/field mapping below) so
 * the divergence is visible in one place instead of scattered across call
 * sites. The mock + UI keep the domain values.
 *
 * MAPPING NOTES (documented divergences — see problem-registry DRIFT-013):
 *   1. STATUS — domain `ExpenseStatus`
 *      (draft|submitted|approved|rejected|disbursed|settled) vs DB
 *      `expense_tickets.status`
 *      (draft|pending_approval|approved_funds_released|rejected|disbursed|
 *      settled_and_closed). 1:1 mapping, no loss. Aligning the domain enum
 *      to the DB values (AGENTS.md §15.9-preferred) is registered as
 *      follow-up work in the task entry — it touches the mock store, the
 *      UI switch statements and the seed data, deliberately out of T-093's
 *      first pass.
 *   2. CATEGORY — domain `ExpenseCategory`
 *      (utilities|supplies|maintenance|transport|event|salary|tax|rent|
 *      other) vs `expense_categories.code`
 *      (maintenance|office_supplies|educational_material|utilities|
 *      transport|it|facilities|medical|other). Lossy in places —
 *      documented per-code below. A future alignment (extend the domain
 *      union to the DB codes) would make it 1:1.
 *   3. PAYEE — the DB had NO payee column (the UI requires it; the mock
 *      stores it). Migration 0056 added `expense_tickets.payee` so the
 *      required business data survives the Supabase path.
 *   4. JUSTIFICATION — `expense_tickets.justification` is NOT NULL (0008)
 *      but the domain submit input has no separate justification field;
 *      the write path copies `description` into it (same text the staff
 *      typed — no invented data). Reads return `description`.
 *   5. URGENCY — domain low|medium|high vs DB low|medium|high|critical.
 *      A DB `critical` reads as domain `high` (the domain enum has no
 *      critical; the anomaly display still shows the raw urgency through
 *      the status/urgency labels elsewhere).
 *   6. NO-SELF-APPROVAL — enforced client-side here (mock parity). The DB
 *      RLS (0008) scopes writes to the tenant but does NOT enforce the
 *      approval rule server-side; that server-side gap is registered in
 *      the problem registry as part of this task's discovery.
 *   7. TICKET NUMBER — generated client-side (`EXP-<year>-<6 base36>`,
 *      collision-checked against the table; retry ×5). Server-authoritative
 *      numbering (ADR-004 philosophy) is registered as follow-up work.
 *
 * Reactive reads follow the repository-adapter pattern used by every
 * Supabase repository: a `SubjectBehavior` cache seeded on first
 * subscription and refreshed after every successful write.
 *
 * T-521 (issue #29) ADDITIONS:
 *   8. ATTACHMENTS — `expense_attachments` (migration 0153) is the canonical
 *      metadata store; the bytes go through the ONE media vault
 *      (`uploadPrivateMedia` with the "expense-receipts" bucket — media-vault.ts,
 *      the §6 reuse rule) with the `<tenant>/<expense>/<file>` path canon
 *      (§15.28). `receipt_path` (the legacy single-proof column) stays
 *      written at settle for backward compatibility with deployed clients.
 *   9. RESPONSIBLE PERSON — `responsible_profile_id` (migration 0153) is a
 *      distinct nullable FK; historical rows keep NULL (flagged in the UI,
 *      never fabricated).
 *  10. EDIT — `update()` patches the editable fields while the ticket is
 *      still draft/submitted (the pre-approval window); the SAME row is
 *      updated, never duplicated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExpenseRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { uploadPrivateMedia } from "../../storage/media-vault";
import type {
  Expense,
  ExpenseAttachment,
  ExpenseAttachmentFile,
  ExpenseAttachmentSource,
  ExpenseCategory,
  ExpenseStatus,
  ExpenseUrgency,
  SubmitExpenseInput,
  UpdateExpenseInput,
} from "../../../domain/model/expense";
import { EXPENSE_STATUS_LABELS_FR } from "../../../domain/model/expense";
import type { ExpenseTicketRow, ExpenseAttachmentRow } from "../types";
import { getTenantId, requireTenantId, isUuid } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Translation layer — status (see header note 1)
// ============================================================================

const STATUS_TO_DB: Record<ExpenseStatus, ExpenseTicketRow["status"]> = {
  draft: "draft",
  submitted: "pending_approval",
  approved: "approved_funds_released",
  rejected: "rejected",
  disbursed: "disbursed",
  settled: "settled_and_closed",
};

const STATUS_FROM_DB: Record<ExpenseTicketRow["status"], ExpenseStatus> = {
  draft: "draft",
  pending_approval: "submitted",
  approved_funds_released: "approved",
  rejected: "rejected",
  disbursed: "disbursed",
  settled_and_closed: "settled",
};

// ============================================================================
// Translation layer — category (see header note 2)
// ============================================================================

const CATEGORY_TO_DB: Record<ExpenseCategory, string> = {
  utilities: "utilities",
  supplies: "office_supplies",
  maintenance: "maintenance",
  transport: "transport",
  // No DB equivalent — the closest neutral bucket is `other`.
  event: "other",
  // No DB equivalent — payroll is not an expense_categories code.
  salary: "other",
  // No DB equivalent.
  tax: "other",
  // `facilities` ("Locaux") is the DB bucket covering premises costs.
  rent: "facilities",
  other: "other",
};

const CATEGORY_FROM_DB: Record<string, ExpenseCategory> = {
  maintenance: "maintenance",
  office_supplies: "supplies",
  educational_material: "supplies", // lossy — closest domain bucket
  utilities: "utilities",
  transport: "transport",
  it: "other", // lossy — no IT bucket in the domain
  facilities: "rent",
  medical: "other", // lossy — no medical bucket in the domain
  other: "other",
};

// ============================================================================
// State machine (mock parity — transitionExpense, expense-ops.ts)
// ============================================================================

const ALLOWED_TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  draft: ["submitted"],
  submitted: ["approved", "rejected"],
  approved: ["disbursed"],
  rejected: [],
  disbursed: ["settled"],
  settled: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Generate a tenant-unique ticket number (see header note 7). */
async function generateTicketNumber(
  client: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `EXP-${year}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { data } = await client
      .from("expense_tickets")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("ticket_number", candidate)
      .limit(1);
    if ((data ?? []).length === 0) return candidate;
  }
  // Practically unreachable — 36^6 space with 5 retries.
  return `EXP-${year}-${Date.now().toString(36).toUpperCase()}`;
}

// ============================================================================
// Row → domain mapper
// ============================================================================

function mapTicketRow(row: ExpenseTicketRow, categoryCode: string | null): Expense {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    requestCode: row.ticket_number,
    title: row.title,
    description: row.description,
    amount: Number(row.requested_amount),
    category: (categoryCode && CATEGORY_FROM_DB[categoryCode]) || "other",
    urgency: (row.urgency === "critical" ? "high" : row.urgency) as ExpenseUrgency,
    payee: row.payee ?? "",
    status: STATUS_FROM_DB[row.status] ?? "draft",
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    // T-521 (WORKFORCE-520): the distinct accountable person (nullable —
    // historical rows stay NULL and are flagged in the UI, never fabricated).
    responsibleProfileId: row.responsible_profile_id ?? null,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    approvalNote: row.approval_note ?? row.rejected_reason,
    disbursedBy: null,
    disbursedAt: row.disbursed_at,
    proofUrl: row.receipt_path,
    proofUploadedBy: row.receipt_uploaded_by,
    proofUploadedAt: row.receipt_uploaded_at,
    finalSpentAmount:
      row.final_spent_amount === null ? null : Number(row.final_spent_amount),
    anomalyScore:
      row.anomaly_score === null ? null : Number(row.anomaly_score),
    anomalyNote:
      Array.isArray(row.anomaly_flags_json) && row.anomaly_flags_json.length > 0
        ? row.anomaly_flags_json
            .map((f) =>
              typeof f === "string"
                ? f
                : String((f as { explanation?: string })?.explanation ?? JSON.stringify(f)),
            )
            .join("\n")
        : null,
  };
}

// ============================================================================
// Row → domain mapper — attachments (T-521, migration 0153)
// ============================================================================

function mapAttachmentRow(row: ExpenseAttachmentRow): ExpenseAttachment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    expenseId: row.expense_id,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    source: row.source,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseExpenseRepository implements ExpenseRepository {
  private readonly cache = new SubjectBehavior<Expense[]>([]);
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();
  /** T-521: per-expense attachment caches (lazily created, TTL-fresh). */
  private readonly attachmentCaches = new Map<
    string,
    SubjectBehavior<ExpenseAttachment[]>
  >();
  private readonly attachmentFreshness = new Map<string, CacheFreshness>();

  constructor(private readonly client: SupabaseClient) {}

  /** Fetch the tenant's tickets (+ category codes) and refresh the cache. */
  async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("expense_tickets")
        .select("*, expense_categories(code)")
        .eq("tenant_id", getTenantId())
        .order("submitted_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      this.cache.set(
        (data ?? []).map((row: Record<string, any>) => {
          const categoryCode =
            (row.expense_categories as { code: string } | null)?.code ?? null;
          // The joined `expense_categories(code)` key rides along harmlessly;
          // mapTicketRow only reads the ExpenseTicketRow columns.
          return mapTicketRow(row as ExpenseTicketRow, categoryCode);
        }),
      );
    } catch {
      // Degrade to the current cache (same policy as the notifications repo).
    }
  }

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  observe(): Observable<Expense[]> {
    this.seed();
    return this.cache;
  }

  observeByStatus(status: string): Observable<Expense[]> {
    this.seed();
    const subject = new SubjectBehavior<Expense[]>([]);
    // Re-derive whenever the source cache changes.
    this.cache.subscribe(() => {
      subject.set(this.cache.get().filter((e) => e.status === status));
    });
    subject.set(this.cache.get().filter((e) => e.status === status));
    return subject;
  }

  observeById(id: string): Observable<Expense | null> {
    this.seed();
    const subject = new SubjectBehavior<Expense | null>(
      this.cache.get().find((e) => e.id === id) ?? null,
    );
    this.cache.subscribe(() => {
      subject.set(this.cache.get().find((e) => e.id === id) ?? null);
    });
    return subject;
  }

  async submit(
    input: SubmitExpenseInput,
    submittedBy: string,
  ): Promise<Result<Expense>> {
    const tenantId = requireTenantId();
    let ticketNumber: string;
    let categoryId: string;
    let profileId: string | null = null;
    try {
      ticketNumber = await generateTicketNumber(this.client, tenantId);
      categoryId = await this.categoryIdFor(CATEGORY_TO_DB[input.category]);
      try {
        profileId =
          (await this.client.rpc("current_user_profile_id")).data ?? null;
      } catch {
        profileId = null;
      }
    } catch (e) {
      return Err(
        Errors.validation(
          e instanceof Error
            ? e.message
            : "expense_tickets: préparation de l'insertion impossible",
        ),
      );
    }

    const { data, error } = await this.client
      .from("expense_tickets")
      .insert({
        tenant_id: tenantId,
        ticket_number: ticketNumber,
        title: input.title,
        description: input.description,
        // Header note 4: justification NOT NULL — carry the submitter's text.
        justification: input.description,
        category_id: categoryId,
        requested_amount: input.amount,
        urgency: input.urgency ?? "medium",
        status: STATUS_TO_DB.submitted, // mock parity: submit creates a pending_approval ticket
        submitted_by: profileId ?? (isUuid(submittedBy) ? submittedBy : null),
        payee: input.payee, // migration 0056 — header note 3
        // T-521 (WORKFORCE-520): the distinct accountable person — the
        // submitter's own profile when they are responsible, another staff
        // member's profile when they submit on someone's behalf; NULL when
        // unknown (flagged for review in the UI, never fabricated).
        responsible_profile_id:
          input.responsibleProfileId && isUuid(input.responsibleProfileId)
            ? input.responsibleProfileId
            : profileId,
      })
      .select("*, expense_categories(code)")
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    const categoryCode =
      (data.expense_categories as { code: string } | null)?.code ?? null;
    const expense = mapTicketRow(data as ExpenseTicketRow, categoryCode);

    this.cache.set([expense, ...this.cache.get()]);

    await this.writeAudit(AuditActions.ExpenseSubmit, expense.id, submittedBy, {
      before: null,
      after: {
        title: expense.title,
        amount: expense.amount,
        category: expense.category,
        urgency: expense.urgency,
        status: expense.status,
      },
    });

    return Ok(expense);
  }

  async approve(
    id: string,
    approver: string,
    note?: string,
  ): Promise<Result<Expense>> {
    const selfCheck = await this.guardSelfApproval(id, approver);
    if (selfCheck) return selfCheck;
    return this.transition(
      id,
      "approved",
      {
        approved_by: approver,
        approved_at: nowIso(),
        approval_note: note ?? null,
      },
      AuditActions.ExpenseApprove,
      approver,
    );
  }

  async reject(
    id: string,
    approver: string,
    note: string,
  ): Promise<Result<Expense>> {
    const selfCheck = await this.guardSelfApproval(id, approver, "rejeter");
    if (selfCheck) return selfCheck;
    return this.transition(
      id,
      "rejected",
      {
        approved_by: approver,
        approved_at: nowIso(),
        approval_note: note,
        rejected_reason: note,
      },
      AuditActions.ExpenseReject,
      approver,
    );
  }

  async disburse(id: string, disbursedBy: string): Promise<Result<Expense>> {
    return this.transition(
      id,
      "disbursed",
      { disbursed_at: nowIso() },
      AuditActions.ExpenseDisburse,
      disbursedBy,
    );
  }

  async settleProof(
    id: string,
    proofUrl: string,
    uploadedBy: string,
    finalSpentAmount?: number,
  ): Promise<Result<Expense>> {
    const current = this.cache.get().find((e) => e.id === id);
    if (!current) return Err(Errors.notFound("Expense", id));
    if (current.status !== "disbursed") {
      return Err(
        Errors.conflict(
          `Transition non autorisée: ${current.status} → settled`,
        ),
      );
    }
    if (!proofUrl) {
      return Err(
        Errors.validation(
          "Le justificatif (reçu) est obligatoire pour clôturer la dépense",
        ),
      );
    }
    return this.transition(
      id,
      "settled",
      {
        receipt_path: proofUrl,
        receipt_uploaded_by: uploadedBy,
        receipt_uploaded_at: nowIso(),
        settled_by: uploadedBy,
        settled_at: nowIso(),
        ...(finalSpentAmount !== undefined && finalSpentAmount > 0
          ? { final_spent_amount: finalSpentAmount }
          : {}),
      },
      AuditActions.ExpenseSettle,
      uploadedBy,
    );
  }

  // ==========================================================================
  // T-521 (issue #29) — edit, attachments, responsible person
  // ==========================================================================

  /**
   * T-521: edit an EXISTING expense — only while the ticket is still
   * draft/submitted (the pre-approval window; after approval the 0064 state
   * machine owns the lifecycle and the amounts are frozen). The SAME row is
   * updated, never duplicated.
   */
  async update(
    id: string,
    input: UpdateExpenseInput,
    actorId: string,
  ): Promise<Result<Expense>> {
    const before = this.cache.get().find((e) => e.id === id);
    if (!before) return Err(Errors.notFound("Expense", id));
    if (before.status !== "draft" && before.status !== "submitted") {
      return Err(
        Errors.conflict(
          `Modification impossible: la dépense est déjà ${EXPENSE_STATUS_LABELS_FR[before.status].toLowerCase()} — seules les dépenses en attente sont modifiables.`,
          `Modification impossible : la dépense est déjà ${EXPENSE_STATUS_LABELS_FR[before.status].toLowerCase()} — seules les dépenses en attente sont modifiables.`,
        ),
      );
    }

    // Build the DB-column patch (only the provided fields — a partial patch,
    // never a full-row clobber; §15.31a's granular-mutation discipline).
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) {
      patch.description = input.description;
      // Header note 4: justification NOT NULL carries the submitter's text.
      patch.justification = input.description;
    }
    if (input.amount !== undefined) patch.requested_amount = input.amount;
    if (input.payee !== undefined) patch.payee = input.payee;
    if (input.urgency !== undefined) patch.urgency = input.urgency;
    if (input.category !== undefined) {
      try {
        patch.category_id = await this.categoryIdFor(
          CATEGORY_TO_DB[input.category],
        );
      } catch (e) {
        return Err(
          Errors.validation(
            e instanceof Error ? e.message : "Catégorie introuvable",
          ),
        );
      }
    }
    if (input.responsibleProfileId !== undefined) {
      // null is EXPLICIT (clearing); a value must be a uuid.
      patch.responsible_profile_id =
        input.responsibleProfileId && isUuid(input.responsibleProfileId)
          ? input.responsibleProfileId
          : null;
    }

    const { data, error } = await this.client
      .from("expense_tickets")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*, expense_categories(code)")
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    const categoryCode =
      (data.expense_categories as { code: string } | null)?.code ?? null;
    const after = mapTicketRow(data as ExpenseTicketRow, categoryCode);
    this.cache.set(this.cache.get().map((e) => (e.id === id ? after : e)));

    await this.writeAudit(AuditActions.ExpenseUpdate, id, actorId, {
      before: {
        title: before.title,
        amount: before.amount,
        category: before.category,
        payee: before.payee,
        urgency: before.urgency,
      },
      after: {
        title: after.title,
        amount: after.amount,
        category: after.category,
        payee: after.payee,
        urgency: after.urgency,
      },
    });

    return Ok(after);
  }

  /**
   * T-521 (WORKFORCE-518): attach a supporting image — upload the bytes
   * through the ONE media vault (the private `expense-receipts` bucket, the
   * `<tenant>/<expense>/<file>` path canon) and register the canonical
   * `expense_attachments` metadata row. NEVER creates a separate expense.
   */
  async addAttachment(
    expenseId: string,
    file: ExpenseAttachmentFile,
    uploadedBy: string,
    source: ExpenseAttachmentSource = "desktop",
  ): Promise<Result<ExpenseAttachment>> {
    const expense = this.cache.get().find((e) => e.id === expenseId);
    if (!expense) return Err(Errors.notFound("Expense", expenseId));
    const tenantId = requireTenantId();

    // 1. The bytes → the private bucket (the ONE upload path; §6 reuse rule).
    let upload;
    try {
      upload = await uploadPrivateMedia({
        bucket: "expense-receipts",
        entityId: expenseId,
        // T-361/UPLOAD-102 compliance: the source guard requires the tenant
        // argument in explicit `tenantId: <variable>` form (the object
        // shorthand `tenantId,` is semantically identical but fails the
        // regex — expanded here so the merged battery stays green).
        tenantId: tenantId,
        file: file.blob as File,
      });
    } catch (e) {
      return Err(
        Errors.network(
          e instanceof Error
            ? `Échec du téléversement : ${e.message}`
            : "Échec du téléversement du justificatif",
        ),
      );
    }

    // 2. The canonical metadata row (duplicate-path guard = the DB UNIQUE).
    const { data, error } = await this.client
      .from("expense_attachments")
      .insert({
        tenant_id: tenantId,
        expense_id: expenseId,
        storage_bucket: "expense-receipts",
        storage_path: upload.path,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        uploaded_by: isUuid(uploadedBy) ? uploadedBy : null,
        source,
      })
      .select("*")
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    const attachment = mapAttachmentRow(data as ExpenseAttachmentRow);
    const cache = this.attachmentCaches.get(expenseId);
    if (cache) cache.set([attachment, ...cache.get()]);

    await this.writeAudit(AuditActions.ExpenseAttachmentAdd, expenseId, uploadedBy, {
      before: null,
      after: {
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        storagePath: attachment.storagePath,
        source: attachment.source,
      },
    });

    return Ok(attachment);
  }

  /** T-521: remove one attachment (the metadata row; the bytes stay in the
   *  bucket per the retention policy — orphaned bytes are a storage cleanup
   *  concern, never a data-integrity one). */
  async removeAttachment(
    attachmentId: string,
    actorId: string,
  ): Promise<Result<void>> {
    // Find the owning cache (for the reactive update) before the delete.
    let owningExpenseId: string | null = null;
    for (const [expenseId, cache] of this.attachmentCaches) {
      if (cache.get().some((a) => a.id === attachmentId)) {
        owningExpenseId = expenseId;
        break;
      }
    }

    const { data, error } = await this.client
      .from("expense_attachments")
      .delete()
      .eq("id", attachmentId)
      .eq("tenant_id", getTenantId())
      .select("*");

    // §15.30b: PostgREST returns 200 + EMPTY array when a DELETE matches
    // zero rows under RLS — assert the affected-row count, never the status.
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data || data.length === 0) {
      return Err(Errors.notFound("Attachment", attachmentId));
    }

    if (owningExpenseId) {
      const cache = this.attachmentCaches.get(owningExpenseId);
      if (cache) {
        cache.set(cache.get().filter((a) => a.id !== attachmentId));
      }
      await this.writeAudit(
        AuditActions.ExpenseAttachmentRemove,
        owningExpenseId,
        actorId,
        {
          before: { attachmentId },
          after: null,
        },
      );
    }

    return Ok(undefined);
  }

  /** T-521: the reactive attachment list for ONE expense. */
  observeAttachments(expenseId: string): Observable<ExpenseAttachment[]> {
    let cache = this.attachmentCaches.get(expenseId);
    if (!cache) {
      cache = new SubjectBehavior<ExpenseAttachment[]>([]);
      this.attachmentCaches.set(expenseId, cache);
      this.attachmentFreshness.set(expenseId, new CacheFreshness());
    }
    const freshness = this.attachmentFreshness.get(expenseId)!;
    if (freshness.shouldReseed()) {
      freshness.markSeeded();
      void this.refreshAttachments(expenseId);
    }
    return cache;
  }

  /** Fetch one expense's attachments and refresh its cache. */
  private async refreshAttachments(expenseId: string): Promise<void> {
    const cache = this.attachmentCaches.get(expenseId);
    if (!cache) return;
    try {
      const { data, error } = await this.client
        .from("expense_attachments")
        .select("*")
        .eq("tenant_id", getTenantId())
        .eq("expense_id", expenseId)
        .order("uploaded_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      cache.set((data ?? []).map((row) => mapAttachmentRow(row as ExpenseAttachmentRow)));
    } catch {
      // Degrade to the current cache (the repository-adapter convention).
    }
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /** Resolve the tenant's expense_categories id for a DB category code. */
  private async categoryIdFor(code: string): Promise<string> {
    const { data, error } = await this.client
      .from("expense_categories")
      .select("id")
      .eq("tenant_id", getTenantId())
      .eq("code", code)
      .single();
    if (error || !data) {
      throw new Error(
        `expense_categories: no row for code '${code}' (run migration 0023 seed)`,
      );
    }
    return data.id;
  }

  /** Mock parity — the requester cannot approve/reject their own ticket. */
  private async guardSelfApproval(
    id: string,
    approver: string,
    verb = "approuver",
  ): Promise<Result<Expense> | null> {
    const expense = this.cache.get().find((e) => e.id === id);
    if (!expense) return Err(Errors.notFound("Expense", id));
    if (expense.submittedBy === approver) {
      return Err(
        Errors.forbidden(
          `Un demandeur ne peut pas ${verb} sa propre dépense (règle d'auto-approbation)`,
        ),
      );
    }
    return null;
  }

  /**
   * Shared state-machine transition (mock parity with `transitionExpense`).
   * `patches` use DB column names — the DB enforces the status CHECK.
   */
  private async transition(
    id: string,
    toStatus: ExpenseStatus,
    patches: Partial<ExpenseTicketRow>,
    auditAction: string,
    actorId: string,
  ): Promise<Result<Expense>> {
    const before = this.cache.get().find((e) => e.id === id);
    if (!before) return Err(Errors.notFound("Expense", id));
    const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
    if (!allowed.includes(toStatus)) {
      return Err(
        Errors.conflict(
          `Transition non autorisée: ${before.status} → ${toStatus}`,
        ),
      );
    }

    const { data, error } = await this.client
      .from("expense_tickets")
      .update({ ...patches, status: STATUS_TO_DB[toStatus], updated_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*, expense_categories(code)")
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    const categoryCode =
      (data.expense_categories as { code: string } | null)?.code ?? null;
    const after = mapTicketRow(data as ExpenseTicketRow, categoryCode);

    this.cache.set(this.cache.get().map((e) => (e.id === id ? after : e)));

    await this.writeAudit(auditAction, id, actorId, {
      before: { status: before.status },
      after: { status: after.status },
    });

    return Ok(after);
  }

  /** Canonical audit write (write_audit_log RPC, migration 0014). */
  private async writeAudit(
    action: string,
    entityId: string,
    actorId: string,
    diff: unknown,
  ): Promise<void> {
    await this.client.rpc("write_audit_log", {
      p_tenant_id: getTenantId(),
      p_action: action,
      p_entity_type: "expense",
      p_entity_id: entityId,
      p_actor_id: isUuid(actorId) ? actorId : null,
      p_actor_name: null,
      p_before_json: JSON.stringify((diff as { before: unknown }).before),
      p_after_json: JSON.stringify((diff as { after: unknown }).after),
      p_note: null,
      p_request_id: null,
    });
  }
}
