/**
 * SupabasePurchaseRequestRepository — Supabase-backed implementation of the
 * `PurchaseRequestRepository` domain contract (plan §11).
 *
 * Task: T-238 (35th session, 2026-09-07) — the T-047 Group-A port #7. The
 * owner's Personnel-overhaul mandate: the Buyer dashboard's procurement
 * pipeline must be production-grade (persisted, tenant-scoped, RLS-gated) —
 * the mock layer reset on every reload while the canonical table sat empty.
 *
 * Table (migration 0011 + 0084):
 *   `purchase_requests` — request_number (PR-YYYY-NNNN, unique/tenant) /
 *   title / description / requester_id (user_profiles.id) + requested_by_name
 *   (0084, frozen) / department_id / status CHECK (draft→submitted→approved
 *   →rejected→ordered→received→cancelled) / priority CHECK (low/medium/high
 *   /urgent) / total_amount numeric(12,2) / lines jsonb / approved_by +
 *   approved_by_name (0084) / approved_at / rejected_reason / supplier_id /
 *   ordered_at / received_at.
 *
 * MAPPING NOTES (documented):
 *   1. requestCode ↔ request_number, generated deterministically:
 *      PR-<currentYear>-<zero-padded count+1> is NOT safe under concurrent
 *      writes, so the pattern is count-then-insert with a 23505 retry that
 *      re-counts (bounded, honest; ADR-003: no random codes).
 *   2. requestedBy ↔ requester_id — the domain passes the session profile
 *      id (mock parity); UUID-guarded (mock-era ids rejected BEFORE the
 *      round-trip, T-178 precedent).
 *   3. requestedByName / approvedByName ↔ the 0084 frozen-name columns
 *      (0074 tasks precedent; requester_id has no FK so embeds are not
 *      detectable — frozen names also survive profile renames).
 *   4. Domain status union == the 0011 CHECK union verbatim
 *      (draft/submitted/approved/rejected/ordered/received/cancelled).
 *   5. cancel() delegates to updateStatus('cancelled') with the reason in
 *      rejected_reason (mock parity: the domain folds the reason into the
 *      status change).
 *
 * RLS (0019): SELECT = staff trio (super_admin/financial_officer/manager)
 * OR own requests (requester_id = current_user_profile_id()); INSERT any
 * tenant member; UPDATE the admin/manager/buyer set. The buyer dashboard's
 * own-request feed and the approval pipeline both pass through cleanly.
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache +
 * T-034/CROSS-104 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `purchaseRequests` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { PurchaseRequestRepository } from "../../../domain/repository/operations-repository";
import type { PurchaseRequestStatus } from "../../../domain/model/operations-workforce";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type {
  PurchaseRequest,
  PurchaseRequestLine,
  PurchaseRequestPriority,
} from "../../../domain/model/operations-workforce";
import { getTenantId } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types
// ============================================================================

interface PurchaseRequestRow {
  id: string;
  tenant_id: string;
  request_number: string;
  title: string;
  description: string | null;
  requester_id: string;
  requested_by_name: string | null;
  department_id: string | null;
  status: string;
  priority: string;
  expected_delivery_date: string | null;
  total_amount: number | string;
  lines: LineJson[] | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  supplier_id: string | null;
  ordered_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LineJson {
  id?: string;
  description?: string;
  quantity?: number | string;
  unit?: string;
  estimatedUnitPrice?: number | string;
}

const STATUS_SET: ReadonlySet<string> = new Set([
  "draft", "submitted", "approved", "rejected", "ordered", "received", "cancelled",
]);
const PRIORITY_SET: ReadonlySet<string> = new Set(["low", "medium", "high", "urgent"]);

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "string" ? Number(v) || 0 : v;
}

function mapRow(row: PurchaseRequestRow): PurchaseRequest {
  const lines: PurchaseRequestLine[] = (row.lines ?? []).map((l, i) => ({
    id: l.id ?? `line-${i}`,
    description: l.description ?? "",
    quantity: toNum(l.quantity),
    unit: l.unit ?? "",
    estimatedUnitPrice: toNum(l.estimatedUnitPrice),
  }));
  // Unknown DB statuses fold to 'draft' (never crash — a future status value
  // in the DB must not break the client; documented degrade).
  const status = STATUS_SET.has(row.status) ? (row.status as PurchaseRequestStatus) : "draft";
  const priority = PRIORITY_SET.has(row.priority)
    ? (row.priority as PurchaseRequestPriority)
    : "medium";
  return {
    id: row.id,
    tenantId: row.tenant_id,
    requestCode: row.request_number,
    title: row.title,
    description: row.description ?? "",
    priority,
    status,
    supplierId: row.supplier_id,
    departmentId: row.department_id,
    lines,
    totalAmount: toNum(row.total_amount),
    requestedBy: row.requester_id,
    requestedByName: row.requested_by_name ?? "—",
    requestedAt: row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    approvalNote: row.rejected_reason,
    orderedAt: row.ordered_at,
    receivedAt: row.received_at,
    cancelledAt: null,
    cancellationReason: row.status === "cancelled" ? row.rejected_reason : null,
  };
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function computeTotal(lines: readonly PurchaseRequestLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.quantity * l.estimatedUnitPrice, 0) * 100) / 100;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Repository
// ============================================================================

export class SupabasePurchaseRequestRepository implements PurchaseRequestRepository {
  private readonly cache = new SubjectBehavior<PurchaseRequest[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<PurchaseRequest[]> {
    this.seed();
    return this.cache;
  }

  observeByRequester(userId: string): Observable<PurchaseRequest[]> {
    this.seed();
    return derived([this.cache], () => this.cache.get().filter((r) => r.requestedBy === userId));
  }

  observeByStatus(status: PurchaseRequestStatus): Observable<PurchaseRequest[]> {
    this.seed();
    return derived([this.cache], () => this.cache.get().filter((r) => r.status === status));
  }

  observeById(id: string): Observable<PurchaseRequest | null> {
    this.seed();
    return derived([this.cache], () => this.cache.get().find((r) => r.id === id) ?? null);
  }

  async createPurchaseRequest(input: {
    title: string;
    description: string;
    priority: PurchaseRequestPriority;
    supplierId: string | null;
    departmentId: string | null;
    lines: readonly PurchaseRequestLine[];
    requestedBy: string;
    requestedByName: string;
  }): Promise<Result<PurchaseRequest>> {
    // Validation mirrors the DB CHECK constraints (fast feedback, no
    // pointless round-trip) + the T-178 UUID guard (mock-era ids).
    if (!input.title.trim()) {
      return Err(Errors.validation("Le titre de la demande est requis"));
    }
    if (!isUuid(input.requestedBy)) {
      return Err(Errors.validation("Identifiant du demandeur invalide (compte non synchronisé)"));
    }
    if (input.supplierId && !isUuid(input.supplierId)) {
      return Err(Errors.validation("Fournisseur invalide"));
    }
    if (input.departmentId && !isUuid(input.departmentId)) {
      return Err(Errors.validation("Département invalide"));
    }
    if (!PRIORITY_SET.has(input.priority)) {
      return Err(Errors.validation(`Priorité inconnue : ${input.priority}`));
    }
    if (input.lines.length === 0) {
      return Err(Errors.validation("La demande doit contenir au moins une ligne"));
    }

    const row = await this.insertWithUniqueNumber(input, 0);
    if (!row.ok) return row;
    await this.refresh();
    return Ok(mapRow(row.value));
  }

  async updateStatus(
    id: string,
    status: PurchaseRequestStatus,
    actorId: string,
    actorName: string,
    note?: string,
  ): Promise<Result<PurchaseRequest>> {
    if (!STATUS_SET.has(status)) {
      return Err(Errors.validation(`Statut inconnu : ${status}`));
    }
    const patch: Record<string, unknown> = { status, updated_at: nowIso() };
    if (status === "approved") {
      patch.approved_by = actorId;
      patch.approved_at = nowIso();
      patch.approved_by_name = actorName;
      patch.rejected_reason = note ?? null;
    } else if (status === "rejected" || status === "cancelled") {
      // The 0011 rejected_reason column doubles as the cancellation reason
      // (mock parity: cancel() folds the reason into the status change).
      patch.rejected_reason = note ?? "—";
    } else if (status === "ordered") {
      patch.ordered_at = nowIso();
    } else if (status === "received") {
      patch.received_at = nowIso();
    }

    const { data, error } = await this.client
      .from("purchase_requests")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("purchase_request", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as PurchaseRequestRow));
  }

  async assignSupplier(id: string, supplierId: string, actorId: string): Promise<Result<PurchaseRequest>> {
    if (!isUuid(supplierId)) {
      return Err(Errors.validation("Fournisseur invalide"));
    }
    const { data, error } = await this.client
      .from("purchase_requests")
      .update({ supplier_id: supplierId, updated_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("purchase_request", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as PurchaseRequestRow));
  }

  async cancel(id: string, reason: string, actorId: string, actorName: string): Promise<Result<PurchaseRequest>> {
    return this.updateStatus(id, "cancelled", actorId, actorName, reason);
  }

  async deletePurchaseRequest(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("purchase_requests")
      .delete()
      .eq("id", id)
      .eq("tenant_id", getTenantId());
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * PR-<year>-<NNNN>: count the tenant's rows for the year, insert, and on a
   * 23505 unique collision re-count and retry once (concurrent inserts are
   * rare in a single-buyer workflow; bounded and honest).
   */
  private async insertWithUniqueNumber(
    input: Parameters<SupabasePurchaseRequestRepository["createPurchaseRequest"]>[0],
    attempt: number,
  ): Promise<Result<PurchaseRequestRow>> {
    const year = new Date().getFullYear();
    const { count, error: countError } = await this.client
      .from("purchase_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", getTenantId())
      .gte("created_at", `${year}-01-01T00:00:00.000Z`);
    if (countError) return Err(supabaseErrorToAppError(countError));
    const requestNumber = `PR-${year}-${String((count ?? 0) + 1 + attempt).padStart(4, "0")}`;

    const { data, error } = await this.client
      .from("purchase_requests")
      .insert({
        tenant_id: getTenantId(),
        request_number: requestNumber,
        title: input.title.trim(),
        description: input.description.trim() || null,
        requester_id: input.requestedBy,
        requested_by_name: input.requestedByName.trim() || null,
        department_id: input.departmentId,
        supplier_id: input.supplierId,
        status: "draft",
        priority: input.priority,
        total_amount: computeTotal(input.lines),
        lines: input.lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          estimatedUnitPrice: l.estimatedUnitPrice,
        })),
      })
      .select("*")
      .single();

    if (error) {
      if ((error as { code?: string }).code === "23505" && attempt < 3) {
        return this.insertWithUniqueNumber(input, attempt + 1);
      }
      return Err(supabaseErrorToAppError(error));
    }
    return Ok(data as unknown as PurchaseRequestRow);
  }

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("purchase_requests")
        .select("*")
        .eq("tenant_id", getTenantId())
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapRow(row as unknown as PurchaseRequestRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }
}
