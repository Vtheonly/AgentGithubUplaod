/**
 * SupabaseAuditLogRepository — Supabase-backed implementation of the
 * `AuditRepository` domain contract (plan §12 — Universal Action Traceability).
 *
 * Tables / functions (source of truth = `supabase/migrations/`):
 *   - `audit_logs` table — migration 0014_audit.sql (append-only,
 *     UPDATE/DELETE blocked by trigger `audit_logs_block_update/delete`).
 *   - `write_audit_log(p_tenant_id, p_action, p_entity_type, …)` RPC —
 *     migration 0014, SECURITY DEFINER (bypasses RLS so every authenticated
 *     actor can append; only SELECT is RLS-gated by 0019).
 *
 * WRITE PATH: `log()` calls the canonical `write_audit_log` RPC first and
 * falls back to a direct table INSERT when the RPC is unavailable (e.g. the
 * function was dropped or the role lacks EXECUTE). Both paths produce the
 * same row shape.
 *
 * READ PATH: `query()` implements the full `AuditLogFilter` contract —
 * action / entityType / entityId / actorId / actorNameContains (ILIKE) /
 * date range — with server-side pagination via PostgREST `range()` and an
 * exact `count` so `hasMore` is computed without over-fetching.
 *
 * NOTE on `entityId`: the DB column `entity_id` is a UUID. Domain ids coming
 * from mock-era call sites (e.g. "per-001") are NOT UUIDs — they are stored
 * as NULL and the raw id is preserved inside the JSON note so the entry
 * remains traceable. Real Supabase entities always have UUID ids.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides the
 * mock `audit` entry with this class, so Settings → Journal d'audit reads the
 * real `audit_logs` table in Supabase mode.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import type {
  AuditRepository,
} from "../../../domain/repository/repository";
import type {
  AuditEntry,
  AuditLogFilter,
  AuditLogQueryResult,
} from "../../../domain/model/audit";
import type { AuditLogRow } from "../types";
import { getTenantId, isUuid } from "./supabase-shared-repositories";

// ============================================================================
// Row → domain mapper
// ============================================================================

/**
 * Map an `audit_logs` row (snake_case) to the domain `AuditEntry` (camelCase).
 *
 * The domain carries a single `diff: string | null` field (a JSON string),
 * while the DB stores the complete `before_json` / `after_json` snapshots
 * (plan §12: NEVER truncated). The mapper re-serializes both snapshots into
 * the domain `diff` shape `{ before, after }` so the Journal d'audit diff
 * drawer keeps working unchanged.
 */
function mapAuditRow(row: Record<string, any>): AuditEntry {
  const hasBefore = row.before_json != null;
  const hasAfter = row.after_json != null;
  const diff =
    hasBefore || hasAfter
      ? JSON.stringify({ before: row.before_json ?? null, after: row.after_json ?? null })
      : null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? "",
    actorId: row.actor_id ?? "",
    actorName: row.actor_name ?? "",
    diff,
    note: row.note ?? null,
    ipAddress: row.ip_address ?? null,
    userAgent: row.user_agent ?? null,
    at: row.occurred_at ?? row.created_at,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseAuditLogRepository implements AuditRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Multi-column filtered query with pagination.
   * Mirrors the mock implementation's filter semantics exactly, but evaluates
   * them server-side (PostgREST) instead of in-memory.
   */
  async query(filter: AuditLogFilter): Promise<Result<AuditLogQueryResult>> {
    try {
      let qb = this.client
        .from("audit_logs")
        .select("*", { count: "exact" })
        .eq("tenant_id", getTenantId());

      if (filter.action) qb = qb.eq("action", filter.action);
      if (filter.entityType) qb = qb.eq("entity_type", filter.entityType);
      // entity_id is a UUID column — only filter when the value is a valid
      // UUID (mock-era ids can never match a UUID row anyway).
      if (filter.entityId && isUuid(filter.entityId)) {
        qb = qb.eq("entity_id", filter.entityId);
      }
      if (filter.actorId && isUuid(filter.actorId)) {
        qb = qb.eq("actor_id", filter.actorId);
      }
      if (filter.actorNameContains) {
        qb = qb.ilike("actor_name", `%${filter.actorNameContains}%`);
      }
      if (filter.from) qb = qb.gte("occurred_at", filter.from);
      if (filter.to) qb = qb.lte("occurred_at", filter.to);

      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 50;
      qb = qb
        .order("occurred_at", { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error, count } = await qb;
      if (error) return Err(supabaseErrorToAppError(error));

      const entries = (data ?? []).map(mapAuditRow);
      const total = count ?? entries.length;
      return Ok({
        entries,
        total,
        hasMore: offset + limit < total,
      });
    } catch (e) {
      return Err(
        Errors.server(
          `Échec de la requête du journal d'audit: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  /**
   * Everything that happened to one entity (entity-centric audit trail).
   */
  async byEntity(
    entityType: string,
    entityId: string,
  ): Promise<Result<AuditEntry[]>> {
    try {
      // Non-UUID entity ids (mock-era) can never match the uuid column.
      if (!isUuid(entityId)) return Ok([]);

      const { data, error } = await this.client
        .from("audit_logs")
        .select("*")
        .eq("tenant_id", getTenantId())
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("occurred_at", { ascending: false })
        .limit(200);

      if (error) return Err(supabaseErrorToAppError(error));
      return Ok((data ?? []).map(mapAuditRow));
    } catch (e) {
      return Err(
        Errors.server(
          `Échec de la requête d'audit par entité: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  /**
   * Most recent entries (used by the Topbar recent-activity feed and the
   * administrator dashboard).
   */
  async recent(limit = 50): Promise<Result<AuditEntry[]>> {
    try {
      const { data, error } = await this.client
        .from("audit_logs")
        .select("*")
        .eq("tenant_id", getTenantId())
        .order("occurred_at", { ascending: false })
        .limit(limit);

      if (error) return Err(supabaseErrorToAppError(error));
      return Ok((data ?? []).map(mapAuditRow));
    } catch (e) {
      return Err(
        Errors.server(
          `Échec de la requête des entrées récentes: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  /**
   * Append a new audit entry — the canonical write path for plan §12.
   *
   * Strategy:
   *   1. `write_audit_log` RPC (migration 0014, SECURITY DEFINER) — the
   *      canonical entry point used by every other platform component.
   *   2. Direct INSERT into `audit_logs` as a fallback when the RPC is not
   *      callable (missing function, revoked EXECUTE, …).
   */
  async log(input: {
    action: string;
    entityType: string;
    entityId: string;
    actorId: string;
    actorName: string;
    tenantId: string;
    diff?: { before?: unknown; after?: unknown } | null;
    note?: string | null;
  }): Promise<Result<AuditEntry>> {
    const entityId = isUuid(input.entityId) ? input.entityId : null;
    const actorId = isUuid(input.actorId) ? input.actorId : null;
    const tenantId = isUuid(input.tenantId) ? input.tenantId : getTenantId();
    // Preserve mock-era (non-UUID) entity ids inside the note so the entry
    // stays traceable even though the uuid column cannot hold them.
    const note =
      input.note ??
      (entityId === null && input.entityId
        ? `entityId=${input.entityId}`
        : null);

    // ---- Path 1: canonical RPC -------------------------------------------------
    const { data: rpcId, error: rpcError } = await this.client.rpc(
      "write_audit_log",
      {
        p_tenant_id: tenantId,
        p_action: input.action,
        p_entity_type: input.entityType,
        p_entity_id: entityId,
        p_actor_id: actorId,
        p_actor_name: input.actorName,
        p_before_json: input.diff?.before ?? null,
        p_after_json: input.diff?.after ?? null,
        p_note: note,
      },
    );

    if (!rpcError && typeof rpcId === "string") {
      // Re-read the inserted row so timestamps come from the DB clock.
      const { data: row, error: fetchError } = await this.client
        .from("audit_logs")
        .select("*")
        .eq("id", rpcId)
        .maybeSingle();
      if (!fetchError && row) return Ok(mapAuditRow(row));

      // Row not readable (RLS on SELECT is admin-only) — synthesize the entry
      // from the input instead of failing the write.
      return Ok(synthesizeEntry({ ...input, tenantId }, entityId));
    }

    // ---- Path 2: direct table insert (fallback) --------------------------------
    const { data, error } = await this.client
      .from("audit_logs")
      .insert({
        tenant_id: tenantId,
        action: input.action,
        entity_type: input.entityType,
        entity_id: entityId,
        actor_id: actorId,
        actor_name: input.actorName,
        before_json: (input.diff?.before ?? null) as Record<string, unknown> | null,
        after_json: (input.diff?.after ?? null) as Record<string, unknown> | null,
        note,
      })
      .select()
      .single();

    if (error) {
      // Both paths failed — surface the RPC error (the canonical path).
      return Err(
        supabaseErrorToAppError(
          rpcError ?? {
            code: (error as { code?: string }).code,
            message: error.message,
          },
        ),
      );
    }
    return Ok(mapAuditRow(data as AuditLogRow));
  }
}

/** Build a domain AuditEntry from the caller's input when the row cannot be re-read. */
function synthesizeEntry(
  input: {
    action: string;
    entityType: string;
    entityId: string;
    actorId: string;
    actorName: string;
    tenantId: string;
    diff?: { before?: unknown; after?: unknown } | null;
    note?: string | null;
  },
  entityId: string | null,
): AuditEntry {
  return {
    id: `aud-${Date.now()}`,
    tenantId: input.tenantId,
    action: input.action,
    entityType: input.entityType,
    entityId: entityId ?? input.entityId,
    actorId: input.actorId,
    actorName: input.actorName,
    diff: input.diff ? JSON.stringify(input.diff) : null,
    note: input.note ?? null,
    ipAddress: null,
    userAgent: "El-Imtiyaz-Desktop",
    at: new Date().toISOString(),
  };
}
