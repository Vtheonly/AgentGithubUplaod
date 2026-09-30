/**
 * Dashboard layout repository interface — T-448 (UI-326, 125th session,
 * 2026-09-30): the owner's dedicated dashboard-layout-configuration store.
 *
 * ONE CLEAR RESPONSIBILITY: persisting and restoring the user's dashboard
 * layout configuration. Nothing else belongs on this interface — it is
 * deliberately NOT part of `DashboardRepository` (that contract computes
 * KPIs/revenue/debt metrics; mixing layout persistence into it would couple
 * a personal UI preference to unrelated application data, which the owner's
 * mandate explicitly forbids).
 *
 * THE CONTRACT (the owner's acceptance words):
 *   - `load` — read the SAVED layout for a view (null when the user never
 *     saved one). Called when the application starts or the relevant page
 *     is (re)opened, so the exact same saved layout is reused without
 *     configuring it again.
 *   - `save` — persist a layout. ONLY the editor's EXPLICIT save action
 *     calls this: the saved configuration is updated when — and only when —
 *     the user intentionally changes and saves it (an upsert on
 *     `(tenant, user, view)`; last explicit save wins).
 *   - `clear` — remove the saved layout for a view (the editor's
 *     Réinitialiser action: back to defaults, server row included).
 *
 * STORAGE:
 *   - Supabase implementation → the DEDICATED `dashboard_layouts` table
 *     (migration 0134; RLS pins every row to its owner; the ONE write path
 *     is the `save_dashboard_layout` RPC which resolves the caller's
 *     identity server-side).
 *   - Mock implementation → localStorage, the SAME key the editor's
 *     offline cache uses (`el-imtiyaz:dashboard-layout:<viewKey>`) — mock
 *     mode keeps full parity (§15.70: per-desktop-local storage stays the
 *     only safe home when there is no server).
 *
 * The layout payload is the editor's StoredLayout verbatim —
 * `Record<itemId, {x,y,w,h}>` — defined here ONCE so the editor and both
 * repository twins share the single source of truth (no parallel shape).
 */
import type { Result } from "../../core/result";

/** One widget's grid rectangle — the editor's LayoutRect. */
export interface DashboardLayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The serializable saved layout: one rect per widget id. */
export type StoredDashboardLayout = Record<string, DashboardLayoutRect>;

/**
 * Defensive parse of a stored payload (jsonb from the table / JSON from
 * localStorage) into a StoredDashboardLayout — defined ONCE here so the
 * editor, the Supabase twin and the mock twin share it (no parallel
 * shape/parse — §6). Each value's four numeric fields are re-validated: a
 * stale or malformed rect must never crash the editor; it is dropped and
 * re-derived from the item defaults (the load-time healing the editor's
 * `buildInitialLayout` already applies to MISSING ids).
 */
export function parseStoredDashboardLayout(
  value: unknown,
): StoredDashboardLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: StoredDashboardLayout = {};
  for (const [id, rect] of Object.entries(value as Record<string, unknown>)) {
    if (!rect || typeof rect !== "object" || Array.isArray(rect)) continue;
    const candidate = rect as Record<string, unknown>;
    if (
      typeof candidate.x === "number" &&
      typeof candidate.y === "number" &&
      typeof candidate.w === "number" &&
      typeof candidate.h === "number" &&
      Number.isFinite(candidate.x) &&
      Number.isFinite(candidate.y) &&
      Number.isFinite(candidate.w) &&
      Number.isFinite(candidate.h)
    ) {
      result[id] = {
        x: candidate.x,
        y: candidate.y,
        w: candidate.w,
        h: candidate.h,
      };
    }
  }
  return result;
}

export interface DashboardLayoutRepository {
  /**
   * The SAVED layout for a view key, or null when none was ever saved.
   * Implementations must sanitize defensively (a stored rect can be stale
   * or malformed — the editor's load-time healing handles the rest).
   */
  load(viewKey: string): Promise<Result<StoredDashboardLayout | null>>;

  /**
   * Persist the layout for a view key (upsert — the explicit save).
   * Returns the saved-at ISO timestamp on success.
   */
  save(viewKey: string, layout: StoredDashboardLayout): Promise<Result<string>>;

  /** Remove the saved layout for a view key (Réinitialiser). */
  clear(viewKey: string): Promise<Result<void>>;
}
