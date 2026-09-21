/**
 * SupabaseLeaveRequestRepository — Supabase-backed implementation of the
 * `LeaveRequestRepository` domain contract (plan §10.07).
 *
 * Task: T-178 (28th session, 2026-09-05) — the T-047 `leaveRequests` port
 * (priority #3 in the T-160 scoping: the worker/manager/administrator
 * dashboards are built on it). Pre-T-178 the slot stayed on
 * mockRepositories even in Supabase mode — leave/absence/overtime requests
 * submitted by workers lived in memory only and were wiped on restart,
 * while the canonical `leave_requests` table (migration 0010) sat empty.
 *
 * Table (migration 0010 + 0072 + 0095):
 *   `leave_requests` — personnel_id (FK), leave_type (0072-widened + 0095
 *   adding spending_reimbursement: the domain RequestType union + the legacy
 *   categories), start_date, end_date, reason, status (0095-widened:
 *   +clarification_requested), reviewed_by (uuid, no FK), reviewed_by_name
 *   (0072), reviewed_at, decision_note, amount_requested +
 *   clarification_request + clarification_response (0095 — the two-way
 *   clarification loop + the reimbursement amount), created_at, updated_at.
 *
 * MAPPING NOTES (documented):
 *   1. `type` (domain RequestType) is stored DIRECTLY as `leave_type` —
 *      0072 widened the CHECK for exactly this union; legacy-category rows
 *      read back with their category string, which the UI labels through
 *      REQUEST_TYPE_LABELS_FR (unknown keys fall back to the raw label).
 *   2. `personnelName` is not a column — resolved via the PostgREST embed
 *      `personnel(first_name,last_name)` on every read (the FK exists).
 *      submit()'s personnelName input is intentionally not persisted
 *      (the embed is the truth; a deleted personnel renders
 *      "Personnel inconnu").
 *   3. `decidedByName` IS persisted (0072 `reviewed_by_name`) — reviewed_by
 *      has no FK, so the name cannot be joined; it is stamped at decision
 *      time (the 0070 calendar assigned_to_* precedent).
 *   4. `fromDate`/`toDate` ↔ `start_date`/`end_date` (the table CHECK
 *      end_date >= start_date mirrors the domain validation).
 *   5. RLS posture (0019, deliberately NOT widened): INSERT is allowed for
 *      any authenticated tenant member (the worker submit path); UPDATE is
 *      manager/super_admin only (the decide path). The mock's cancel() has
 *      NO UI caller — a worker-side cancel would surface the RLS forbidden
 *      error (honest) rather than silently bypass the server semantics.
 *   6. The clarification loop (0095): requestClarification (manager) →
 *      status clarification_requested + clarification_request;
 *      respondClarification (worker) → status pending +
 *      clarification_response. The 0019 UPDATE policy is manager-only — the
 *      WORKER's respondClarification write is honestly RLS-rejected today
 *      (documented divergence; widening it needs its own registered task
 *      with a role-scoped policy — see WORKFORCE-500 resolution notes).
 *   7. `amountRequested` ↔ `amount_requested` (0095) — persisted for the
 *      spending_reimbursement kind.
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache +
 * T-034/CROSS-104 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `leaveRequests` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { LeaveRequestRepository } from "../../../domain/repository/workforce-repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type { LeaveRequest, RequestType, RequestStatus } from "../../../domain/model/workforce";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types
// ============================================================================

interface PersonnelEmbed {
  first_name: string | null;
  last_name: string | null;
}

interface LeaveRequestTableRow {
  id: string;
  tenant_id: string;
  personnel_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  amount_requested: number | null;
  clarification_request: string | null;
  clarification_response: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
  personnel: PersonnelEmbed | null;
}

const REQUEST_STATUSES: readonly string[] = [
  "pending",
  "approved",
  "rejected",
  "clarification_requested",
  "cancelled",
];

function mapRow(row: LeaveRequestTableRow): LeaveRequest {
  const embed = row.personnel;
  const personnelName = embed
    ? `${embed.first_name ?? ""} ${embed.last_name ?? ""}`.trim() || "Personnel inconnu"
    : "Personnel inconnu";
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personnelId: row.personnel_id,
    personnelName,
    type: row.leave_type as RequestType,
    status: (REQUEST_STATUSES.includes(row.status) ? row.status : "pending") as RequestStatus,
    fromDate: row.start_date,
    toDate: row.end_date,
    amountRequested: row.amount_requested != null ? Number(row.amount_requested) : null,
    reason: row.reason ?? "",
    createdAt: row.created_at,
    decidedAt: row.reviewed_at,
    decidedBy: row.reviewed_by,
    decidedByName: row.reviewed_by_name,
    decisionNote: row.decision_note,
    clarificationRequest: row.clarification_request ?? null,
    clarificationResponse: row.clarification_response ?? null,
  };
}

const SELECT = "*, personnel(first_name, last_name)";

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseLeaveRequestRepository implements LeaveRequestRepository {
  private readonly cache = new SubjectBehavior<LeaveRequest[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<LeaveRequest[]> {
    this.seed();
    return this.cache;
  }

  observeByPersonnel(personnelId: string): Observable<LeaveRequest[]> {
    this.seed();
    return derived([this.cache], () => this.cache.get().filter((r) => r.personnelId === personnelId));
  }

  observePending(): Observable<LeaveRequest[]> {
    this.seed();
    return derived([this.cache], () => this.cache.get().filter((r) => r.status === "pending"));
  }

  async submit(input: {
    personnelId: string;
    personnelName: string;
    type: RequestType;
    fromDate: string;
    toDate: string;
    amountRequested?: number | null;
    reason: string;
  }): Promise<Result<LeaveRequest>> {
    if (!isUuid(input.personnelId)) {
      return Err(Errors.validation(
        "leaveRequests.submit requires a personnel UUID (the Supabase personnel table key)",
        "Profil personnel introuvable — reconnectez-vous.",
      ));
    }
    if (!input.fromDate || !input.toDate || input.toDate < input.fromDate) {
      return Err(Errors.validation(
        "Leave request dates are invalid (toDate must be >= fromDate)",
        "Dates de demande invalides.",
      ));
    }
    const { data, error } = await this.client
      .from("leave_requests")
      .insert({
        tenant_id: getTenantId(),
        personnel_id: input.personnelId,
        // 0072: the domain RequestType union is stored directly.
        leave_type: input.type,
        start_date: input.fromDate,
        end_date: input.toDate,
        reason: input.reason.trim() || null,
        // 0095: the reimbursement amount (spending_reimbursement kind).
        amount_requested: input.amountRequested ?? null,
        status: "pending",
      })
      .select(SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapRow(data as unknown as LeaveRequestTableRow));
  }

  async decide(
    id: string,
    status: RequestStatus,
    decidedBy: string,
    decidedByName: string,
    note?: string,
  ): Promise<Result<LeaveRequest>> {
    if (status === "rejected" && !note?.trim()) {
      // 0010 comment: decision_note is mandatory when rejected (app layer).
      return Err(Errors.validation(
        "A rejection note is required",
        "Un motif de refus est requis.",
      ));
    }
    const { data, error } = await this.client
      .from("leave_requests")
      .update({
        status,
        reviewed_by: isUuid(decidedBy) ? decidedBy : null,
        reviewed_by_name: decidedByName,
        reviewed_at: nowIso(),
        decision_note: note?.trim() || null,
        updated_at: nowIso(),
      })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select(SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("LeaveRequest", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as LeaveRequestTableRow));
  }

  async cancel(id: string): Promise<Result<LeaveRequest>> {
    // Mock parity (system actor + fixed note). NOTE: the 0019 UPDATE policy
    // is manager/super_admin only — a worker-side cancel is honestly
    // rejected by RLS (the UI exposes no worker-cancel button today).
    return this.decide(id, "cancelled", "system", "Système", "Annulé par l'employé");
  }

  async requestClarification(
    id: string,
    question: string,
    requestedBy: string,
  ): Promise<Result<LeaveRequest>> {
    void requestedBy; // audit trail is server-side (0014); the actor reaches the DB through the session JWT.
    if (!question.trim()) {
      return Err(Errors.validation(
        "A clarification question is required",
        "Une question de clarification est requise.",
      ));
    }
    const { data, error } = await this.client
      .from("leave_requests")
      .update({
        status: "clarification_requested",
        clarification_request: question.trim(),
        updated_at: nowIso(),
      })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select(SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("LeaveRequest", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as LeaveRequestTableRow));
  }

  async respondClarification(
    id: string,
    response: string,
  ): Promise<Result<LeaveRequest>> {
    if (!response.trim()) {
      return Err(Errors.validation(
        "A clarification response is required",
        "Une réponse est requise.",
      ));
    }
    const { error } = await this.client.rpc("respond_leave_clarification", {
      p_request_id: id,
      p_response: response.trim(),
    });
    if (error) return Err(supabaseErrorToAppError(error));

    const { data, error: readError } = await this.client
      .from("leave_requests")
      .select(SELECT)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .single();
    if (readError) return Err(supabaseErrorToAppError(readError));
    if (!data) return Err(Errors.notFound("LeaveRequest", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as LeaveRequestTableRow));
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("leave_requests")
        .select(SELECT)
        .eq("tenant_id", getTenantId())
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapRow(row as unknown as LeaveRequestTableRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }
}
