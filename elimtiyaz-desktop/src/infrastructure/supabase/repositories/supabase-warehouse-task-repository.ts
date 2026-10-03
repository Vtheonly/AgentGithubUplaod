/**
 * SupabaseWarehouseTaskRepository — Supabase-backed implementation of the
 * `WarehouseTaskRepository` domain contract (plan §11.07/§11.08).
 *
 * Task: T-479 (139th session, 2026-10-04) — the WORKFORCE-507 fix (the
 * T-477 Personnel-page audit). BEFORE this, the `warehouseTasks` slot stayed
 * on MockWarehouseTaskRepository even in Supabase mode — the warehouse
 * dashboard's "Réceptions attendues" / "Expéditions à préparer" cards
 * rendered the hard-coded SEED_RECEIPTS/SEED_DISPATCHES ("Fournitures
 * Scolaires Oran", "Site annexe Hydra", …) and every "Réceptionner" /
 * "Expédier" click mutated in-memory arrays only, wiped on restart, while
 * the canonical tables (migration 0011) sat empty since 2026-08-31.
 *
 * Tables (migration 0011 + 0139):
 *   `pending_receipts` — purchase_request_id (FK) / supplier_id (FK) /
 *   expected_at / received_at / received_by (user_profiles.id, no FK by
 *   convention) / items_json [{sku, name, expected_qty, received_qty,
 *   condition}] / status CHECK ('pending','partial','received','cancelled')
 *   — the domain ReceiptStatus union VERBATIM.
 *   `pending_dispatches` — destination / items_json [{sku, name, quantity,
 *   note}] / scheduled_at (not null) / dispatched_at / dispatched_by
 *   (user_profiles.id) / delivery_id (FK, nullable) / status CHECK
 *   ('pending','preparing' [0139],'dispatched','delivered','cancelled').
 *
 * MAPPING NOTES (documented):
 *   1. supplierName ↔ suppliers.name via the PostgREST `suppliers(name)`
 *      embed (the FK exists — the SCHED-103 lesson does not apply); a NULL
 *      supplier_id degrades to "—".
 *   2. purchaseRequestCode ↔ purchase_requests.request_number via the
 *      `purchase_requests(request_number)` embed; NULL → null.
 *   3. expectedQuantity/receivedQuantity ↔ Σ over items_json lines
 *      (expected_qty / received_qty). An empty items_json is honest 0 (the
 *      mock's flat fields have no per-line representation — the sums are
 *      the row-level truth).
 *   4. Dispatch statuses: DB 'delivered' folds to domain 'dispatched' on
 *      read (the domain union has no post-dispatch state; dispatched is
 *      terminal for every UI). 'preparing' persists thanks to 0139 (the
 *      domain's transient state — the reason the migration exists).
 *   5. requestedAt (dispatch) ↔ created_at (the row's creation moment);
 *      scheduled_at is the planned fulfilment time (not exposed by the
 *      domain contract).
 *   6. receiveReceipt is a FULL receipt (mock parity): every items_json
 *      line's received_qty := its expected_qty + status 'received' +
 *      received_at/received_by stamped. Read-modify-write on items_json in
 *      one UPDATE (the SupabaseInventoryRepository.transact single-warehouse
 *      precedent — a concurrent receipt would need the RPC pattern).
 *   7. Actor ids are UUID-guarded BEFORE the round-trip (T-178 precedent:
 *      a mock-era id must never reach a uuid column).
 *   8. createReceipt/createDispatch have NO UI callers today (contract
 *      completeness); the name-typed inputs resolve to FKs by lookup
 *      (supplier by name, purchase request by number) and an unresolvable
 *      name degrades to a NULL FK + the raw name preserved in `note`
 *      (honest, never silent data loss).
 *   9. deleteReceipt/deleteDispatch are HARD deletes (mock parity).
 *
 * RLS (0019): SELECT tenant-wide; receipt writes =
 * super_admin/warehouse_worker/buyer/manager; dispatch writes =
 * super_admin/warehouse_worker/manager. A rejected write surfaces as the
 * repository's Err (never swallowed).
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior caches +
 * T-034/CROSS-104 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `warehouseTasks` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { WarehouseTaskRepository } from "../../../domain/repository/operations-repository";
import type {
  PendingReceipt,
  PendingDispatch,
  ReceiptStatus,
  DispatchStatus,
} from "../../../domain/model/operations-workforce";
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

interface ReceiptItemJson {
  sku?: string;
  name?: string;
  expected_qty?: number;
  received_qty?: number;
  condition?: string;
}

interface DispatchItemJson {
  sku?: string;
  name?: string;
  quantity?: number;
  note?: string;
}

interface ReceiptRow {
  id: string;
  tenant_id: string;
  purchase_request_id: string | null;
  supplier_id: string | null;
  expected_at: string | null;
  received_at: string | null;
  received_by: string | null;
  items_json: ReceiptItemJson[] | null;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: { name: string | null } | null;
  purchase_requests?: { request_number: string | null } | null;
}

interface DispatchRow {
  id: string;
  tenant_id: string;
  destination: string;
  items_json: DispatchItemJson[] | null;
  scheduled_at: string;
  dispatched_at: string | null;
  dispatched_by: string | null;
  delivery_id: string | null;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const RECEIPT_STATUS_SET: ReadonlySet<string> = new Set([
  "pending", "partial", "received", "cancelled",
]);

function sumReceiptQty(
  items: ReceiptItemJson[] | null,
  key: "expected_qty" | "received_qty",
): number {
  return (items ?? []).reduce((sum, line) => sum + (Number(line[key]) || 0), 0);
}

function mapReceiptRow(row: ReceiptRow): PendingReceipt {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    supplierName: row.suppliers?.name ?? "—",
    purchaseRequestCode: row.purchase_requests?.request_number ?? null,
    expectedQuantity: sumReceiptQty(row.items_json, "expected_qty"),
    receivedQuantity: sumReceiptQty(row.items_json, "received_qty"),
    status: (RECEIPT_STATUS_SET.has(row.status) ? row.status : "pending") as ReceiptStatus,
    expectedAt: row.expected_at ?? row.created_at,
    receivedAt: row.received_at,
  };
}

function mapDispatchRow(row: DispatchRow): PendingDispatch {
  // Mapping note 4: DB 'delivered' folds to 'dispatched' (the domain union's
  // terminal state); unknown statuses fold to 'pending'.
  let status: DispatchStatus;
  if (row.status === "delivered" || row.status === "dispatched") {
    status = "dispatched";
  } else if (row.status === "preparing" || row.status === "cancelled") {
    status = row.status;
  } else {
    status = "pending";
  }
  const lines = row.items_json ?? [];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    destination: row.destination,
    itemLabel: lines[0]?.name ?? row.destination,
    quantity: lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    status,
    requestedAt: row.created_at,
    dispatchedAt: row.dispatched_at,
  };
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseWarehouseTaskRepository implements WarehouseTaskRepository {
  private readonly receiptsCache = new SubjectBehavior<PendingReceipt[]>([]);
  private readonly dispatchesCache = new SubjectBehavior<PendingDispatch[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observeReceipts(): Observable<PendingReceipt[]> {
    this.seed();
    return this.receiptsCache;
  }

  observeDispatches(): Observable<PendingDispatch[]> {
    this.seed();
    return this.dispatchesCache;
  }

  async receiveReceipt(
    id: string,
    actorId: string,
    _actorName: string,
  ): Promise<Result<PendingReceipt>> {
    if (!isUuid(actorId)) {
      return Err(Errors.validation("Compte invalide (identifiant non synchronisé)"));
    }
    // Read-modify-write on items_json (mapping note 6) — one tenant-scoped
    // UPDATE with the recomputed lines.
    const { data: current, error: fetchError } = await this.client
      .from("pending_receipts")
      .select("id, status, items_json")
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .maybeSingle();
    if (fetchError) return Err(supabaseErrorToAppError(fetchError));
    if (!current) return Err(Errors.notFound("receipt", id));
    const row = current as { id: string; status: string; items_json: ReceiptItemJson[] | null };
    if (row.status === "received") {
      return Err(Errors.validation("Cette réception est déjà validée."));
    }
    if (row.status === "cancelled") {
      return Err(Errors.validation("Cette réception est annulée."));
    }
    const lines = (row.items_json ?? []).map((line) => ({
      ...line,
      received_qty: Number(line.expected_qty) || 0,
      condition: line.condition ?? "ok",
    }));

    const { data, error } = await this.client
      .from("pending_receipts")
      .update({
        items_json: lines,
        status: "received",
        received_at: nowIso(),
        received_by: actorId,
        updated_at: nowIso(),
      })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*, suppliers(name), purchase_requests(request_number)")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapReceiptRow(data as unknown as ReceiptRow));
  }

  async prepareDispatch(
    id: string,
    actorId: string,
    _actorName: string,
  ): Promise<Result<PendingDispatch>> {
    if (!isUuid(actorId)) {
      return Err(Errors.validation("Compte invalide (identifiant non synchronisé)"));
    }
    const { data, error } = await this.client
      .from("pending_dispatches")
      .update({ status: "preparing", updated_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .in("status", ["pending", "preparing"])
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("dispatch", id));
    await this.refresh();
    return Ok(mapDispatchRow(data as unknown as DispatchRow));
  }

  async dispatchDispatch(
    id: string,
    actorId: string,
    _actorName: string,
  ): Promise<Result<PendingDispatch>> {
    if (!isUuid(actorId)) {
      return Err(Errors.validation("Compte invalide (identifiant non synchronisé)"));
    }
    const { data, error } = await this.client
      .from("pending_dispatches")
      .update({
        status: "dispatched",
        dispatched_at: nowIso(),
        dispatched_by: actorId,
        updated_at: nowIso(),
      })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .in("status", ["pending", "preparing"])
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("dispatch", id));
    await this.refresh();
    return Ok(mapDispatchRow(data as unknown as DispatchRow));
  }

  async createReceipt(
    input: Omit<PendingReceipt, "id" | "tenantId" | "receivedQuantity" | "status" | "receivedAt">,
  ): Promise<Result<PendingReceipt>> {
    // Mapping note 8: resolve the name-typed inputs to FKs; unresolvable
    // names degrade to NULL FK + the raw name preserved in `note`.
    const supplierId = await this.resolveSupplierId(input.supplierName);
    const purchaseRequestId = input.purchaseRequestCode
      ? await this.resolvePurchaseRequestId(input.purchaseRequestCode)
      : null;
    const noteParts: string[] = [];
    if (input.supplierName && !supplierId) {
      noteParts.push(`Fournisseur : ${input.supplierName}`);
    }
    if (input.purchaseRequestCode && !purchaseRequestId) {
      noteParts.push(`Demande : ${input.purchaseRequestCode}`);
    }

    const { data, error } = await this.client
      .from("pending_receipts")
      .insert({
        tenant_id: getTenantId(),
        purchase_request_id: purchaseRequestId,
        supplier_id: supplierId,
        expected_at: input.expectedAt || null,
        items_json: [
          {
            sku: null,
            name: input.supplierName,
            expected_qty: input.expectedQuantity,
            received_qty: 0,
            condition: null,
          },
        ],
        status: "pending",
        note: noteParts.length > 0 ? noteParts.join(" · ") : null,
      })
      .select("*, suppliers(name), purchase_requests(request_number)")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapReceiptRow(data as unknown as ReceiptRow));
  }

  async createDispatch(
    input: Omit<PendingDispatch, "id" | "tenantId" | "status" | "dispatchedAt">,
  ): Promise<Result<PendingDispatch>> {
    const { data, error } = await this.client
      .from("pending_dispatches")
      .insert({
        tenant_id: getTenantId(),
        destination: input.destination,
        items_json: [
          { sku: null, name: input.itemLabel, quantity: input.quantity, note: null },
        ],
        scheduled_at: input.requestedAt || nowIso(),
        status: "pending",
      })
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapDispatchRow(data as unknown as DispatchRow));
  }

  async deleteReceipt(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("pending_receipts")
      .delete()
      .eq("id", id)
      .eq("tenant_id", getTenantId());
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  async deleteDispatch(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("pending_dispatches")
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

  private async resolveSupplierId(name: string): Promise<string | null> {
    if (!name.trim()) return null;
    const { data } = await this.client
      .from("suppliers")
      .select("id")
      .eq("tenant_id", getTenantId())
      .ilike("name", name.trim())
      .limit(1);
    return data?.[0]?.id ?? null;
  }

  private async resolvePurchaseRequestId(code: string): Promise<string | null> {
    if (!code.trim()) return null;
    const { data } = await this.client
      .from("purchase_requests")
      .select("id")
      .eq("tenant_id", getTenantId())
      .eq("request_number", code.trim())
      .limit(1);
    return data?.[0]?.id ?? null;
  }

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const receiptsPromise = this.client
        .from("pending_receipts")
        .select("*, suppliers(name), purchase_requests(request_number)")
        .eq("tenant_id", getTenantId())
        .order("created_at", { ascending: false })
        .limit(500);
      const dispatchesPromise = this.client
        .from("pending_dispatches")
        .select("*")
        .eq("tenant_id", getTenantId())
        .order("created_at", { ascending: false })
        .limit(500);
      const [receiptsRes, dispatchesRes] = await Promise.all([
        receiptsPromise,
        dispatchesPromise,
      ]);
      if (receiptsRes.error) throw receiptsRes.error;
      if (dispatchesRes.error) throw dispatchesRes.error;
      this.receiptsCache.set(
        (receiptsRes.data ?? []).map((row: Record<string, unknown>) =>
          mapReceiptRow(row as unknown as ReceiptRow),
        ),
      );
      this.dispatchesCache.set(
        (dispatchesRes.data ?? []).map((row: Record<string, unknown>) =>
          mapDispatchRow(row as unknown as DispatchRow),
        ),
      );
    } catch {
      // Silently degrade to the current caches.
    }
  }
}
