/**
 * ============================================================================
 * delta-cache.ts — T-592 (E7A-3 / ROADMAP 6.5) — the incremental delta cache
 * ============================================================================
 *
 * THE PROBLEM (OPS-015 class 1 / ARCH-049): the desktop's Supabase-backed
 * repositories keep SubjectBehavior caches re-seeded under a freshness
 * policy (CacheFreshness — a 30 s TTL + the window-focus trigger). Every
 * tick re-downloaded the WHOLE collection (~13,000+ rows per cycle across
 * the cached tables: installments 5,963 · ledger 3,342 · payments 2,198 ·
 * students 1,137 · parents 741 on the live census) — the re-seed volley.
 *
 * THE FIX — the 0143 (SYNC-304) composite keyset cursor per table: the
 * warm re-seed pulls ONLY the rows changed since the cursor
 * (`(updated_at, id)` composite — resumable without duplicates or skips);
 * the cold start (a fresh repository instance / a manual refresh) walks
 * the full set through the SAME primitive and initializes the cursor.
 *
 * THE SERVER SURFACE (the pull_*_for_sync family):
 *   - payments       → pull_payments_for_sync        (0001; p_since epoch default)
 *   - ledger_entries → pull_ledger_entries_for_sync (0001; p_since epoch default)
 *   - parents        → pull_parents_for_sync        (0001; p_since NULL = full walk)
 *   - students       → pull_students_for_sync       (0001; p_since NULL = full walk)
 *   - installments   → pull_installments_for_sync   (0004 — T-592's own migration;
 *                                                      the family's absent leg)
 *
 * THE CURSOR LIFETIME COUPLING (the design decision): the cursor is held
 * ON THE REPOSITORY INSTANCE (the cache's own object) — NOT in
 * localStorage. The SubjectBehavior caches are memory-only and die with
 * the process; a cursor that outlived its cache would let a restarted app
 * delta-patch an EMPTY cache and never see the full collection. A fresh
 * instance therefore always cold-starts (the same full re-seed a restart
 * performs today — the volley this task kills is the PERIODIC one, not the
 * boot one). The Stage B local-IPC lane (E7B) revisits persistence when
 * the cache itself persists.
 *
 * THE DELETION SEMANTICS: the canonical streams are soft-delete-first
 * (0011 — deleted_at + updated_at), so a deletion PROPAGATES as a delta
 * row carrying the soft-delete marker (updated_at bumps); `splitSoftDeletes`
 * routes those ids to the patch's removal set. Hard deletes require the
 * manual refresh (the documented cold path).
 *
 * THE ONE-COHERENT-CACHING-ARCHITECTURE DECISION (ARCH-020 / F-U4 / L-13):
 * the observable + delta-cache architecture is THE architecture — the
 * `QueryClientProvider` phantom mount (main.tsx) is PRUNED together with
 * its `@tanstack/react-query` dependency (zero code usage anywhere; the
 * useObservable data layer is the one caching stack). The E4.8 ADR lands
 * in its own lane.
 *
 * Version skew: a database without the pull RPC for a table (or a client
 * without the .rpc surface) answers the unavailable class — `pullTableDelta`
 * returns null and the caller keeps its legacy full-seed path (§15.62c).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isRpcUnavailableError } from "./repositories/supabase-shared-repositories";

// ============================================================================
// The table registry
// ============================================================================

export type DeltaTable = "payments" | "installments" | "ledger_entries" | "parents" | "students";

interface PullConfig {
  /** The RPC name. */
  readonly rpc: string;
  /**
   * The p_since value that means "walk everything" for THIS RPC: the
   * payments/ledger/installments legs take the epoch default (a NULL
   * p_since answers an empty set there — the predicate compares
   * `updated_at > NULL`), the parents/students legs take NULL (their
   * predicate has the explicit `p_since IS NULL` full-walk branch).
   */
  readonly coldSince: string | null;
}

const TABLE_PULLS: Record<DeltaTable, PullConfig> = {
  payments: { rpc: "pull_payments_for_sync", coldSince: "1970-01-01T00:00:00Z" },
  installments: { rpc: "pull_installments_for_sync", coldSince: "1970-01-01T00:00:00Z" },
  ledger_entries: { rpc: "pull_ledger_entries_for_sync", coldSince: "1970-01-01T00:00:00Z" },
  parents: { rpc: "pull_parents_for_sync", coldSince: null },
  students: { rpc: "pull_students_for_sync", coldSince: null },
};

/** The page size the pull loop requests (the PostgREST/house convention). */
const PULL_PAGE = 1000;

// ============================================================================
// The cursor
// ============================================================================

/** The composite `(updated_at, id)` cursor position. */
export interface DeltaCursor {
  readonly since: string;
  readonly lastId: string | null;
}

/** A raw pull row (every pull RPC returns updated_at + id). */
export interface DeltaPullRow {
  readonly id: string;
  readonly updated_at?: string | null;
  readonly [key: string]: unknown;
}

/**
 * The per-repository cursor holder — the cursor lives as long as the
 * cache it serves (see the lifetime-coupling note in the header).
 */
export class TableDeltaCursor {
  private cursor: DeltaCursor | null = null;

  constructor(readonly table: DeltaTable) {}

  get(): DeltaCursor | null {
    return this.cursor;
  }

  set(next: DeltaCursor | null): void {
    this.cursor = next;
  }

  /** The manual-refresh / forced-re-seed path: back to the cold walk. */
  reset(): void {
    this.cursor = null;
  }
}

// ============================================================================
// The pull
// ============================================================================

export interface DeltaPullOutcome {
  /** The changed rows (the full set on a cold walk), in cursor order. */
  readonly rows: readonly DeltaPullRow[];
  /** The advanced cursor (null when nothing was ever pulled — stays cold). */
  readonly cursor: DeltaCursor | null;
  /** True when this pull walked from the cold position (no prior cursor). */
  readonly isColdStart: boolean;
}

/**
 * Pull the delta for one table through its 0143-family RPC. Returns null
 * on the unavailable class (version skew — the DB without the pull RPC,
 * a permission-deny shape, a client without the .rpc surface): the caller
 * falls back to its legacy full-seed path. Every OTHER error THROWS (the
 * caller's retry ladder owns the transient-failure policy).
 */
export async function pullTableDelta(
  client: SupabaseClient,
  table: DeltaTable,
  opts: { tenantId: string; cursor: DeltaCursor | null },
): Promise<DeltaPullOutcome | null> {
  const config = TABLE_PULLS[table];
  const rows: DeltaPullRow[] = [];
  // The cold start: no cursor → the table's full-walk position; the warm
  // pull continues strictly after the cursor.
  let since: string | null = opts.cursor ? opts.cursor.since : config.coldSince;
  let afterId: string | null = opts.cursor ? opts.cursor.lastId : null;
  for (;;) {
    let res: Awaited<ReturnType<SupabaseClient["rpc"]>>;
    try {
      res = await client.rpc(config.rpc, {
        p_tenant_id: opts.tenantId,
        p_since: since,
        p_after_id: afterId,
        p_limit: PULL_PAGE,
      });
    } catch (e) {
      if (isRpcUnavailableError(e as { message?: string })) return null;
      throw e;
    }
    if (res.error) {
      if (isRpcUnavailableError(res.error as { code?: string; message?: string })) {
        return null;
      }
      throw res.error;
    }
    const page = ((res.data ?? []) as DeltaPullRow[]);
    rows.push(...page);
    if (page.length < PULL_PAGE) break;
    // Continue the walk at the page's last composite position.
    const last = page[page.length - 1];
    since = String(last.updated_at ?? "");
    afterId = last.id;
  }
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const cursor: DeltaCursor | null = lastRow
    ? { since: String(lastRow.updated_at ?? ""), lastId: lastRow.id }
    : null;
  return {
    rows,
    // An empty pull keeps the caller's cursor (null when it started cold —
    // an empty table stays cheap-cold; a warm cursor at the head is proof
    // the position is current).
    cursor: cursor ?? opts.cursor,
    isColdStart: opts.cursor === null,
  };
}

// ============================================================================
// The patch
// ============================================================================

/**
 * Split a pull's raw rows into the alive set and the soft-deleted id set
 * (the 0011 convention: deleted_at set + updated_at bumped — the deletion
 * propagates as a delta row carrying the marker).
 */
export function splitSoftDeletes(
  rows: readonly DeltaPullRow[],
): { alive: DeltaPullRow[]; deadIds: Set<string> } {
  const alive: DeltaPullRow[] = [];
  const deadIds = new Set<string>();
  for (const row of rows) {
    if (row["deleted_at"] != null) {
      deadIds.add(row.id);
    } else {
      alive.push(row);
    }
  }
  return { alive, deadIds };
}

/**
 * The id-keyed patch: incoming rows REPLACE or APPEND their entries;
 * removeIds (the soft-deleted set) DROP theirs. The current array's order
 * is preserved for surviving rows; replacements keep their position;
 * appends go to the tail (the callers restore their display orders).
 */
export function applyRowsById<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
  opts?: { removeIds?: ReadonlySet<string> },
): T[] {
  const removeIds = opts?.removeIds;
  const byId = new Map(current.map((row) => [row.id, row] as const));
  const order = current.map((row) => row.id);
  const known = new Set(order);
  for (const row of incoming) {
    if (removeIds?.has(row.id)) {
      continue;
    }
    if (!known.has(row.id)) {
      order.push(row.id);
      known.add(row.id);
    }
    byId.set(row.id, row);
  }
  if (removeIds && removeIds.size > 0) {
    for (const id of removeIds) {
      if (!known.has(id)) continue;
      known.delete(id);
      byId.delete(id);
    }
  }
  return order.filter((id) => known.has(id)).map((id) => byId.get(id)!);
}
