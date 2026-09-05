/**
 * SupabaseSupplierRepository — Supabase-backed implementation of the
 * `SupplierRepository` domain contract (plan §11).
 *
 * Task: T-179 (28th session, 2026-09-05) — the T-047 `suppliers` port
 * (Group A per the T-160 scoping). Pre-T-179 the slot stayed on
 * mockRepositories even in Supabase mode — the supplier list the buyer
 * dashboard renders (name lookups for purchase requests + the KPI count)
 * came from the mock SEED data, not the canonical `suppliers` table
 * (migration 0011), which sat empty.
 *
 * Table (migration 0011 + 0073):
 *   `suppliers` — code (SUP-…, unique per tenant) / name / category (0073) /
 *   contact_name / phone / email / address / tax_id / payment_terms /
 *   rating (0073: numeric(3,1) 0.0–5.0) / is_active / created_at /
 *   updated_at / deleted_at (soft delete).
 *
 * MAPPING NOTES (documented):
 *   1. `category` (domain free text) ↔ the 0073 column.
 *   2. `rating` — the domain's fractional 0–5 is stored directly (0073
 *      recast; the 0011 smallint could not hold 3.8/4.5). Values are
 *      clamped to [0,5] on write as a belt-and-braces guard.
 *   3. `archivedAt` ↔ `deleted_at` (the 0011 soft-delete convention):
 *      archiveSupplier() stamps deleted_at; the 0019 suppliers_select
 *      policy filters `deleted_at is null` server-side, so archived
 *      suppliers disappear from every read — the same observable effect
 *      as the mock's archivedAt. `is_active` stays at its default (the
 *      domain has no such field; documented, not mapped).
 *   4. `code` (NOT NULL, unique per tenant): derived deterministically
 *      from the name (slug + stable hash — the departments/workflows
 *      pattern; ADR-003: no random, no sequences) with a 23505 retry.
 *   5. deleteSupplier(): HARD delete (mock parity — the domain contract's
 *      delete). Every supplier FK is ON DELETE SET NULL (purchase_requests,
 *      purchase_orders), so history rows survive with a null supplier.
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache +
 * T-034/CROSS-104 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `suppliers` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { SupplierRepository } from "../../../domain/repository/operations-repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type { Supplier } from "../../../domain/model/operations-workforce";
import { getTenantId } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types
// ============================================================================

interface SupplierTableRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  category: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  rating: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapRow(row: SupplierTableRow): Supplier {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    category: row.category ?? "",
    contactName: row.contact_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? null,
    address: row.address ?? null,
    paymentTerms: row.payment_terms ?? "",
    rating: row.rating ?? 0,
    createdAt: row.created_at,
    archivedAt: row.deleted_at,
  };
}

/** Deterministic code: slug + stable hash (departments/workflows pattern; ADR-003). */
function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-4);
}

function codeFor(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
  return `SUP-${base || "SUPPLY"}-${stableHash(name)}`;
}

function clampRating(rating: number): number {
  return Math.min(5, Math.max(0, Math.round(rating * 10) / 10));
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseSupplierRepository implements SupplierRepository {
  private readonly cache = new SubjectBehavior<Supplier[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<Supplier[]> {
    this.seed();
    return this.cache;
  }

  observeById(id: string): Observable<Supplier | null> {
    this.seed();
    return derived([this.cache], () => this.cache.get().find((s) => s.id === id) ?? null);
  }

  async createSupplier(
    input: Omit<Supplier, "id" | "tenantId" | "createdAt" | "archivedAt">,
  ): Promise<Result<Supplier>> {
    if (!input.name.trim()) {
      return Err(Errors.validation("Le nom du fournisseur est requis"));
    }
    let inserted: SupplierTableRow | null = null;
    for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
      const code = attempt === 0
        ? codeFor(input.name)
        : `${codeFor(input.name)}-${Date.now().toString(36).toUpperCase().slice(-3)}`;
      const { data, error } = await this.client
        .from("suppliers")
        .insert({
          tenant_id: getTenantId(),
          code,
          name: input.name.trim(),
          category: input.category.trim() || null,
          contact_name: input.contactName.trim() || null,
          phone: input.phone.trim() || null,
          email: input.email?.trim() || null,
          address: input.address?.trim() || null,
          payment_terms: input.paymentTerms.trim() || null,
          rating: clampRating(input.rating),
        })
        .select("*")
        .single();
      if (error) {
        // unique (tenant_id, code) collision — retry with a distinct suffix.
        if ((error as { code?: string }).code === "23505" && attempt === 0) continue;
        return Err(supabaseErrorToAppError(error));
      }
      inserted = data as unknown as SupplierTableRow;
    }
    if (!inserted) {
      return Err(Errors.conflict("Could not derive a unique supplier code"));
    }
    await this.refresh();
    return Ok(mapRow(inserted));
  }

  async updateSupplier(id: string, updates: Partial<Supplier>): Promise<Result<Supplier>> {
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (updates.name !== undefined) patch.name = updates.name.trim();
    if (updates.category !== undefined) patch.category = updates.category.trim() || null;
    if (updates.contactName !== undefined) patch.contact_name = updates.contactName.trim() || null;
    if (updates.phone !== undefined) patch.phone = updates.phone.trim() || null;
    if (updates.email !== undefined) patch.email = updates.email?.trim() || null;
    if (updates.address !== undefined) patch.address = updates.address?.trim() || null;
    if (updates.paymentTerms !== undefined) patch.payment_terms = updates.paymentTerms.trim() || null;
    if (updates.rating !== undefined) patch.rating = clampRating(updates.rating);
    // archivedAt writes go through archiveSupplier() (deleted_at); an explicit
    // null clears the soft delete (un-archive).
    if (updates.archivedAt !== undefined) patch.deleted_at = updates.archivedAt;

    const { data, error } = await this.client
      .from("suppliers")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("Supplier", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as SupplierTableRow));
  }

  async archiveSupplier(id: string): Promise<Result<Supplier>> {
    // 0011 soft-delete convention: deleted_at = now. The 0019 select policy
    // filters deleted_at IS NULL server-side — archived suppliers vanish
    // from every read (the mock's archivedAt observable semantics).
    const { data, error } = await this.client
      .from("suppliers")
      .update({ deleted_at: nowIso(), updated_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!data) return Err(Errors.notFound("Supplier", id));
    await this.refresh();
    return Ok(mapRow(data as unknown as SupplierTableRow));
  }

  async deleteSupplier(id: string): Promise<Result<void>> {
    // HARD delete (mock parity). All supplier FKs are ON DELETE SET NULL —
    // purchase history survives with a null supplier.
    const { error } = await this.client
      .from("suppliers")
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

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      // deleted_at IS NULL is enforced by the 0019 suppliers_select policy;
      // the explicit filter documents the intent and guards non-RLS contexts.
      const { data, error } = await this.client
        .from("suppliers")
        .select("*")
        .eq("tenant_id", getTenantId())
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapRow(row as unknown as SupplierTableRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }
}
