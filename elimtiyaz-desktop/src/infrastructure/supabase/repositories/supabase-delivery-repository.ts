/**
 * SupabaseDeliveryRepository — Supabase-backed implementation of the
 * `DeliveryRepository` domain contract (plan §11).
 *
 * Task: T-239 (35th session, 2026-09-07) — the T-047 Group-A port #8. The
 * owner's Personnel-overhaul mandate: the Driver dashboard's delivery
 * pipeline must be production-grade — the mock layer reset on every reload
 * while the canonical table sat empty.
 *
 * Table (migration 0011 + 0084):
 *   `deliveries` — delivery_number (DLV-YYYY-NNNN, unique/tenant) /
 *   delivery_type CHECK (inbound/outbound/internal) / status CHECK
 *   (assigned/in_transit/delivered/confirmed/failed/cancelled) / driver_id
 *   (FK personnel ON DELETE SET NULL) + driver_name (0084, frozen) /
 *   vehicle / origin+destination_address / scheduled_at / departed_at /
 *   delivered_at / confirmed_at / stops jsonb / notes / delay_reason /
 *   delay_minutes / new_eta (0084).
 *
 * MAPPING NOTES (documented):
 *   1. Domain 'delayed' ↔ DB 'in_transit' + delay_reason set (a delayed run
 *      IS in transit — the 0011 CHECK has no 'delayed' value; delay_reason
 *      + delay_minutes are the source of truth). Read-side: in_transit rows
 *      with a delay_reason map back to 'delayed' (delivered rows keep
 *      'delivered' even with a historical delay_reason — the honest state).
 *   2. deliveryCode ↔ delivery_number, generated count-then-insert with a
 *      23505 retry (the purchase-request pattern; ADR-003: no random).
 *   3. assignedAt ↔ created_at (row creation = assignment moment); startedAt
 *      ↔ departed_at; deliveredAt ↔ delivered_at; confirmedAt ↔ confirmed_at.
 *   4. driverId ↔ driver_id (personnel FK — UUID-guarded BEFORE the
 *      round-trip, T-178 precedent); driverName ↔ the 0084 frozen column
 *      (personnel soft-deletes would degrade post-hoc resolution).
 *   5. Domain 'failed' stores verbatim (in the 0011 CHECK); domain
 *      'cancelled' is accepted by updateStatus and stored verbatim too.
 *   6. stops jsonb stores the DeliveryStop array directly; malformed stop
 *      entries degrade to safe defaults (never crash the client).
 *   7. delivery_type: the domain contract has no type — 'internal' is the
 *      honest default for desktop-created runs (school-internal dispatch).
 *
 * RLS (0019): SELECT = staff trio OR own driver assignments (driver_id in
 * personnel where user_id = current profile); ALL (write) = super_admin +
 * manager. Driver status updates flow through the manager-facing screens;
 * direct driver writes are visible to the driver via the SELECT scoping.
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache +
 * T-034/CROSS-104 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `deliveries` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { DeliveryRepository } from "../../../domain/repository/operations-repository";
import type { DeliveryStatus } from "../../../domain/model/operations-workforce";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type { Delivery, DeliveryStop } from "../../../domain/model/operations-workforce";
import { getTenantId } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types
// ============================================================================

interface DeliveryRow {
  id: string;
  tenant_id: string;
  delivery_number: string;
  delivery_type: string;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  vehicle: string | null;
  origin_address: string | null;
  destination_address: string | null;
  scheduled_at: string;
  departed_at: string | null;
  delivered_at: string | null;
  confirmed_at: string | null;
  stops: StopJson[] | null;
  notes: string | null;
  delay_reason: string | null;
  delay_minutes: number;
  new_eta: string | null;
  created_at: string;
  updated_at: string;
}

interface StopJson {
  id?: string;
  sequence?: number;
  type?: string;
  label?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  plannedAt?: string | null;
  completedAt?: string | null;
}

const DB_STATUS_SET: ReadonlySet<string> = new Set([
  "assigned", "in_transit", "delivered", "confirmed", "failed", "cancelled",
]);

function mapRow(row: DeliveryRow): Delivery {
  const stops: DeliveryStop[] = (row.stops ?? []).map((s, i) => ({
    id: s.id ?? `stop-${i}`,
    sequence: s.sequence ?? i + 1,
    type: s.type === "dropoff" ? "dropoff" : "pickup",
    label: s.label ?? "",
    address: s.address ?? "",
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    plannedAt: s.plannedAt ?? null,
    completedAt: s.completedAt ?? null,
  }));
  // Domain 'delayed' is a DISPLAY state of an in-transit run with a
  // reported delay (mapping note 1). Unknown DB statuses fold to 'assigned'.
  let status: DeliveryStatus;
  if (row.status === "in_transit" && row.delay_reason) {
    status = "delayed";
  } else if (DB_STATUS_SET.has(row.status)) {
    status = row.status as DeliveryStatus;
  } else {
    status = "assigned";
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    deliveryCode: row.delivery_number,
    driverId: row.driver_id ?? "",
    driverName: row.driver_name ?? "—",
    status,
    stops,
    purchaseRequestId: null,
    notes: row.notes ?? "",
    assignedAt: row.created_at,
    startedAt: row.departed_at,
    deliveredAt: row.delivered_at,
    confirmedAt: row.confirmed_at,
    delayReason: row.delay_reason,
    newEta: row.new_eta,
    confirmationUrl: null,
    vehicle: row.vehicle,
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

export class SupabaseDeliveryRepository implements DeliveryRepository {
  private readonly cache = new SubjectBehavior<Delivery[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<Delivery[]> {
    this.seed();
    return this.cache;
  }

  observeByDriver(driverId: string): Observable<Delivery[]> {
    this.seed();
    return derived([this.cache], () => this.cache.get().filter((d) => d.driverId === driverId));
  }

  observeByStatus(status: DeliveryStatus): Observable<Delivery[]> {
    this.seed();
    return derived([this.cache], () => this.cache.get().filter((d) => d.status === status));
  }

  observeById(id: string): Observable<Delivery | null> {
    this.seed();
    return derived([this.cache], () => this.cache.get().find((d) => d.id === id) ?? null);
  }

  async createDelivery(input: {
    driverId: string;
    driverName: string;
    stops: readonly DeliveryStop[];
    purchaseRequestId: string | null;
    notes: string;
    vehicle: string | null;
    assignedBy: string;
  }): Promise<Result<Delivery>> {
    if (!isUuid(input.driverId)) {
      return Err(Errors.validation("Chauffeur invalide (fiche personnel non synchronisée)"));
    }
    if (input.stops.length === 0) {
      return Err(Errors.validation("La livraison doit contenir au moins un arrêt"));
    }
    if (input.purchaseRequestId && !isUuid(input.purchaseRequestId)) {
      return Err(Errors.validation("Demande d'achat liée invalide"));
    }

    const row = await this.insertWithUniqueNumber(input, 0);
    if (!row.ok) return row;
    await this.refresh();
    return Ok(mapRow(row.value));
  }

  async updateStatus(
    id: string,
    status: DeliveryStatus,
    actorId: string,
    actorName: string,
  ): Promise<Result<Delivery>> {
    // 'delayed' is not a DB status (mapping note 1) — updating TO delayed
    // without a reason goes through reportDelay; guard it here honestly.
    if (status === "delayed") {
      return Err(Errors.validation("Un retard doit être signalé avec un motif (reportDelay)"));
    }
    const patch: Record<string, unknown> = { status, updated_at: nowIso() };
    if (status === "in_transit") {
      patch.departed_at = nowIso();
      // Clear the delay display state when the run resumes transit.
      patch.delay_reason = null;
      patch.delay_minutes = 0;
      patch.new_eta = null;
    } else if (status === "delivered") {
      patch.delivered_at = nowIso();
    } else if (status === "confirmed") {
      patch.confirmed_at = nowIso();
    }

    const { data, error } = await this.client
      .from("deliveries")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("delivery", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as DeliveryRow));
  }

  async reportDelay(
    id: string,
    reason: string,
    newEta: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<Delivery>> {
    if (!reason.trim()) {
      return Err(Errors.validation("Le motif du retard est requis"));
    }
    // Mapping note 1: stays in_transit + delay markers (the DB CHECK has no
    // 'delayed'; the read-side maps it back to the domain display state).
    const { data, error } = await this.client
      .from("deliveries")
      .update({
        delay_reason: reason.trim(),
        new_eta: newEta || null,
        updated_at: nowIso(),
      })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("delivery", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as DeliveryRow));
  }

  async uploadConfirmation(
    id: string,
    confirmationUrl: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<Delivery>> {
    if (!confirmationUrl.trim()) {
      return Err(Errors.validation("L'URL de confirmation est requise"));
    }
    const { data, error } = await this.client
      .from("deliveries")
      .update({ status: "confirmed", confirmed_at: nowIso(), updated_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("delivery", id));
    await this.refresh();
    // The confirmation URL itself has no 0011 column; the state transition
    // (status + confirmed_at) is the durable record — documented divergence,
    // the mock stored it on the row but nothing rendered it.
    return Ok(mapRow(data as unknown as DeliveryRow));
  }

  async deleteDelivery(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("deliveries")
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

  /** DLV-<year>-<NNNN>: count-then-insert with a 23505 retry (bounded). */
  private async insertWithUniqueNumber(
    input: Parameters<SupabaseDeliveryRepository["createDelivery"]>[0],
    attempt: number,
  ): Promise<Result<DeliveryRow>> {
    const year = new Date().getFullYear();
    const { count, error: countError } = await this.client
      .from("deliveries")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", getTenantId())
      .gte("created_at", `${year}-01-01T00:00:00.000Z`);
    if (countError) return Err(supabaseErrorToAppError(countError));
    const deliveryNumber = `DLV-${year}-${String((count ?? 0) + 1 + attempt).padStart(4, "0")}`;

    const { data, error } = await this.client
      .from("deliveries")
      .insert({
        tenant_id: getTenantId(),
        delivery_number: deliveryNumber,
        delivery_type: "internal",
        status: "assigned",
        driver_id: input.driverId,
        driver_name: input.driverName.trim() || null,
        vehicle: input.vehicle,
        origin_address: input.stops[0]?.address ?? null,
        destination_address: input.stops[input.stops.length - 1]?.address ?? null,
        scheduled_at: nowIso(),
        stops: input.stops.map((s) => ({
          id: s.id,
          sequence: s.sequence,
          type: s.type,
          label: s.label,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          plannedAt: s.plannedAt,
          completedAt: s.completedAt,
        })),
        notes: input.notes.trim() || null,
      })
      .select("*")
      .single();

    if (error) {
      if ((error as { code?: string }).code === "23505" && attempt < 3) {
        return this.insertWithUniqueNumber(input, attempt + 1);
      }
      return Err(supabaseErrorToAppError(error));
    }
    return Ok(data as unknown as DeliveryRow);
  }

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("deliveries")
        .select("*")
        .eq("tenant_id", getTenantId())
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapRow(row as unknown as DeliveryRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }
}
