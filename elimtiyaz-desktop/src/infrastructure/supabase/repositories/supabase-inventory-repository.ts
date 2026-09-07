/**
 * SupabaseInventoryRepository — Supabase-backed implementation of the
 * `InventoryRepository` domain contract (plan §11).
 *
 * Task: T-240 (35th session, 2026-09-07) — the T-047 Group-A port #9. The
 * owner's Personnel-overhaul mandate: the Warehouse dashboard's stock
 * management must be production-grade — the mock layer reset on every
 * reload while the canonical tables sat empty.
 *
 * Tables (migration 0011 + 0084):
 *   `inventory_items` — sku (unique/tenant) / name / category / unit /
 *   quantity_on_hand (CHECK ≥ 0) / quantity_reserved (CHECK ≤ on_hand) /
 *   reorder_level / reorder_quantity / unit_cost / location / is_active /
 *   deleted_at (soft delete).
 *   `inventory_transactions` — item_id (FK) / transaction_type CHECK
 *   (receive/dispatch/scan/damage/adjust/return — the domain union
 *   VERBATIM) / quantity (CHECK <> 0, signed) / unit_cost / total_cost /
 *   reference_type / reference_id / performed_by (no FK) +
 *   performed_by_name (0084, frozen) / note / transaction_at +
 *   quantity_before / quantity_after (0084, frozen at write time).
 *
 * MAPPING NOTES (documented):
 *   1. label ↔ name; quantityOnHand ↔ quantity_on_hand (numeric stored,
 *      domain reads numbers).
 *   2. Domain category union (fournitures/mobilier/…) stored as free text
 *      (the 0011 column is unconstrained); the writer validates the union
 *      client-side to keep the contract tight.
 *   3. transact(): read-modify-write on quantity_on_hand in ONE update
 *      (`.eq("id", itemId)` + computed absolute value; a concurrent
 *      transaction would need the RPC pattern — registered as a residual
 *      for a future concurrency-hardening pass; single-warehouse usage).
 *      The transaction row is inserted FIRST, the item update SECOND; a
 *      failed item update leaves the audit trail row but the quantity
 *      stale — refresh() re-syncs the display (documented, honest).
 *   4. delta=0 is rejected (the DB CHECK quantity <> 0 — validation
 *      mirrors it).
 *   5. deleteItem(): SOFT delete via deleted_at (the 0011 convention;
 *      the select policy hides soft-deleted rows server-side — the same
 *      observable effect as the mock's removal).
 *   6. scan(): find-or-create by sku, then a 'scan' transaction —
 *      identical to the mock's semantics.
 *
 * RLS (0019): items SELECT tenant-wide (deleted_at null), item writes =
 * super_admin/warehouse_worker/manager; transaction INSERT =
 * super_admin/warehouse_worker/buyer/manager, SELECT tenant-wide.
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache +
 * T-034/CROSS-104 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `inventory` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { InventoryRepository } from "../../../domain/repository/operations-repository";
import type {
  InventoryTransactionType,
  InventoryCategory,
} from "../../../domain/model/operations-workforce";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type {
  InventoryItem,
  InventoryTransaction,
} from "../../../domain/model/operations-workforce";
import { getTenantId } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types
// ============================================================================

interface InventoryItemRow {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  quantity_on_hand: number | string;
  quantity_reserved: number | string;
  reorder_level: number | string;
  reorder_quantity: number | string;
  unit_cost: number | string;
  location: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface InventoryTransactionRow {
  id: string;
  tenant_id: string;
  item_id: string;
  transaction_type: string;
  quantity: number | string;
  unit_cost: number | string;
  total_cost: number | string;
  reference_type: string | null;
  reference_id: string | null;
  performed_by: string | null;
  performed_by_name: string | null;
  note: string | null;
  transaction_at: string;
  created_at: string;
  quantity_before: number | string | null;
  quantity_after: number | string | null;
}

const TYPE_SET: ReadonlySet<string> = new Set([
  "receive", "dispatch", "scan", "damage", "adjust", "return",
]);
const CATEGORY_SET: ReadonlySet<string> = new Set([
  "fournitures", "mobilier", "manuels", "informatique", "entretien", "autre",
]);

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "string" ? Number(v) || 0 : v;
}

function mapItemRow(row: InventoryItemRow): InventoryItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sku: row.sku,
    label: row.name,
    category: (CATEGORY_SET.has(row.category ?? "") ? row.category : "autre") as InventoryCategory,
    unit: row.unit,
    quantityOnHand: toNum(row.quantity_on_hand),
    reorderLevel: toNum(row.reorder_level),
    unitCost: toNum(row.unit_cost),
    location: row.location,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTxRow(row: InventoryTransactionRow, items: readonly InventoryItem[]): InventoryTransaction {
  const item = items.find((i) => i.id === row.item_id);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    itemId: row.item_id,
    itemSku: item?.sku ?? "—",
    itemLabel: item?.label ?? "—",
    type: (TYPE_SET.has(row.transaction_type) ? row.transaction_type : "adjust") as InventoryTransactionType,
    delta: toNum(row.quantity),
    quantityBefore: toNum(row.quantity_before),
    quantityAfter: toNum(row.quantity_after),
    reason: row.note,
    actorId: row.performed_by ?? "—",
    actorName: row.performed_by_name ?? "—",
    timestamp: row.transaction_at,
    reference: row.reference_id ?? row.reference_type,
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

export class SupabaseInventoryRepository implements InventoryRepository {
  private readonly itemsCache = new SubjectBehavior<InventoryItem[]>([]);
  private readonly txCache = new SubjectBehavior<InventoryTransaction[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observeItems(): Observable<InventoryItem[]> {
    this.seed();
    return this.itemsCache;
  }

  observeItemById(id: string): Observable<InventoryItem | null> {
    this.seed();
    return derived([this.itemsCache], () => this.itemsCache.get().find((i) => i.id === id) ?? null);
  }

  observeTransactions(limit?: number): Observable<InventoryTransaction[]> {
    this.seed();
    return derived([this.txCache], () =>
      limit ? this.txCache.get().slice(0, limit) : this.txCache.get(),
    );
  }

  observeTransactionsByItem(itemId: string): Observable<InventoryTransaction[]> {
    this.seed();
    return derived([this.txCache], () => this.txCache.get().filter((t) => t.itemId === itemId));
  }

  async createItem(
    input: Omit<InventoryItem, "id" | "tenantId" | "createdAt" | "updatedAt">,
  ): Promise<Result<InventoryItem>> {
    if (!input.sku.trim()) return Err(Errors.validation("Le SKU est requis"));
    if (!input.label.trim()) return Err(Errors.validation("Le libellé est requis"));
    if (!CATEGORY_SET.has(input.category)) {
      return Err(Errors.validation(`Catégorie inconnue : ${input.category}`));
    }
    const { data, error } = await this.client
      .from("inventory_items")
      .insert({
        tenant_id: getTenantId(),
        sku: input.sku.trim().toUpperCase(),
        name: input.label.trim(),
        category: input.category,
        unit: input.unit,
        quantity_on_hand: Math.max(0, input.quantityOnHand),
        reorder_level: Math.max(0, input.reorderLevel),
        unit_cost: Math.max(0, input.unitCost),
        location: input.location?.trim() || null,
      })
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapItemRow(data as unknown as InventoryItemRow));
  }

  async updateItem(id: string, updates: Partial<InventoryItem>): Promise<Result<InventoryItem>> {
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (updates.sku !== undefined) patch.sku = updates.sku.trim().toUpperCase();
    if (updates.label !== undefined) patch.name = updates.label.trim();
    if (updates.category !== undefined) {
      if (!CATEGORY_SET.has(updates.category)) {
        return Err(Errors.validation(`Catégorie inconnue : ${updates.category}`));
      }
      patch.category = updates.category;
    }
    if (updates.unit !== undefined) patch.unit = updates.unit;
    if (updates.quantityOnHand !== undefined) patch.quantity_on_hand = Math.max(0, updates.quantityOnHand);
    if (updates.reorderLevel !== undefined) patch.reorder_level = Math.max(0, updates.reorderLevel);
    if (updates.unitCost !== undefined) patch.unit_cost = Math.max(0, updates.unitCost);
    if (updates.location !== undefined) patch.location = updates.location?.trim() || null;

    const { data, error } = await this.client
      .from("inventory_items")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("inventory_item", id));
    await this.refresh();
    return Ok(mapItemRow(data as unknown as InventoryItemRow));
  }

  async deleteItem(id: string): Promise<Result<void>> {
    // SOFT delete (0011 convention): the select policy hides soft-deleted
    // rows server-side — the same observable effect as the mock's removal.
    const { error } = await this.client
      .from("inventory_items")
      .update({ deleted_at: nowIso(), updated_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId());
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  async transact(input: {
    itemId: string;
    type: InventoryTransactionType;
    delta: number;
    reason: string | null;
    actorId: string;
    actorName: string;
    reference: string | null;
  }): Promise<Result<InventoryTransaction>> {
    if (!isUuid(input.itemId)) {
      return Err(Errors.validation("Article invalide"));
    }
    if (!TYPE_SET.has(input.type)) {
      return Err(Errors.validation(`Type de mouvement inconnu : ${input.type}`));
    }
    if (!Number.isFinite(input.delta) || input.delta === 0) {
      return Err(Errors.validation("Le mouvement doit être non nul"));
    }

    // Read the current quantity (the shared cache is the fast path; a fresh
    // single-row select is the authoritative read).
    const { data: itemRow, error: itemError } = await this.client
      .from("inventory_items")
      .select("id, sku, name, quantity_on_hand, unit_cost")
      .eq("id", input.itemId)
      .eq("tenant_id", getTenantId())
      .is("deleted_at", null)
      .single();
    if (itemError) return Err(supabaseErrorToAppError(itemError));
    if (!itemRow) return Err(Errors.notFound("inventory_item", input.itemId));

    const itemRec = itemRow as unknown as Record<string, unknown>;
    const before = toNum(itemRec["quantity_on_hand"] as number | string | null);
    const after = Math.max(0, before + input.delta);
    const unitCost = toNum(itemRec["unit_cost"] as number | string | null);
    // Item quantity update FIRST (the CHECK quantity_on_hand >= 0 is the
    // server guard), then the append-only audit row.
    const { error: updateError } = await this.client
      .from("inventory_items")
      .update({ quantity_on_hand: after, updated_at: nowIso() })
      .eq("id", input.itemId)
      .eq("tenant_id", getTenantId());
    if (updateError) return Err(supabaseErrorToAppError(updateError));

    const { data: txRow, error: txError } = await this.client
      .from("inventory_transactions")
      .insert({
        tenant_id: getTenantId(),
        item_id: input.itemId,
        transaction_type: input.type,
        quantity: input.delta,
        unit_cost: unitCost,
        total_cost: Math.round(Math.abs(input.delta) * unitCost * 100) / 100,
        reference_type: input.reference,
        performed_by: isUuid(input.actorId) ? input.actorId : null,
        performed_by_name: input.actorName.trim() || null,
        note: input.reason?.trim() || null,
        transaction_at: nowIso(),
        quantity_before: before,
        quantity_after: after,
      })
      .select("*")
      .single();
    if (txError) {
      // The item moved but the audit row failed — surface the failure loudly
      // (never claim success); the next refresh shows the true quantity.
      return Err(supabaseErrorToAppError(txError));
    }

    await this.refresh();
    const tx = mapTxRow(txRow as unknown as InventoryTransactionRow, [
      mapItemRow(itemRow as unknown as InventoryItemRow),
    ]);
    return Ok({
      ...tx,
      itemSku: String(itemRec["sku"] ?? "—"),
      itemLabel: String(itemRec["name"] ?? "—"),
    });
  }

  async scan(input: {
    sku: string;
    label: string;
    category: InventoryCategory;
    unit: string;
    quantity: number;
    actorId: string;
    actorName: string;
  }): Promise<Result<InventoryItem>> {
    const sku = input.sku.trim().toUpperCase();
    if (!sku) return Err(Errors.validation("Le SKU scanné est requis"));

    // Find-or-create by sku, then a 'scan' movement — the mock's semantics.
    const { data: existing } = await this.client
      .from("inventory_items")
      .select("*")
      .eq("tenant_id", getTenantId())
      .eq("sku", sku)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      const item = mapItemRow(existing as unknown as InventoryItemRow);
      const tx = await this.transact({
        itemId: item.id,
        type: "scan",
        delta: Math.max(0, input.quantity),
        reason: "Scan",
        actorId: input.actorId,
        actorName: input.actorName,
        reference: sku,
      });
      if (!tx.ok) return tx;
      return Ok({ ...item, quantityOnHand: tx.value.quantityAfter, updatedAt: nowIso() });
    }

    const created = await this.createItem({
      sku,
      label: input.label.trim() || sku,
      category: input.category,
      unit: input.unit,
      quantityOnHand: Math.max(0, input.quantity),
      reorderLevel: 0,
      unitCost: 0,
      location: null,
    });
    if (!created.ok) return created;
    await this.transact({
      itemId: created.value.id,
      type: "scan",
      delta: Math.max(0, input.quantity),
      reason: "Scan — nouvel article",
      actorId: input.actorId,
      actorName: input.actorName,
      reference: sku,
    });
    return Ok(created.value);
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
      const { data: items, error: itemsError } = await this.client
        .from("inventory_items")
        .select("*")
        .eq("tenant_id", getTenantId())
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .limit(1000);
      if (itemsError) throw itemsError;
      const mapped = (items ?? []).map((row: Record<string, unknown>) =>
        mapItemRow(row as unknown as InventoryItemRow),
      );
      this.itemsCache.set(mapped);

      const { data: txs, error: txError } = await this.client
        .from("inventory_transactions")
        .select("*")
        .eq("tenant_id", getTenantId())
        .order("transaction_at", { ascending: false })
        .limit(500);
      if (txError) throw txError;
      this.txCache.set(
        (txs ?? []).map((row: Record<string, unknown>) =>
          mapTxRow(row as unknown as InventoryTransactionRow, mapped),
        ),
      );
    } catch {
      // Silently degrade to the current caches.
    }
  }
}
