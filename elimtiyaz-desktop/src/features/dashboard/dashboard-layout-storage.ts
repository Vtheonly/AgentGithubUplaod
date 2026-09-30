// ============================================================================
// FILE: src/features/dashboard/dashboard-layout-storage.ts
// ============================================================================
// T-448 (UI-326): the ONE canonical definition of the dashboard layout's
// LOCAL offline-cache key. The editor's localStorage path, the mock
// repository twin, and the Supabase repository's offline fallback all
// import from HERE — before this module the prefix string was private to
// the editor, which would have forced every consumer to duplicate it
// (the §6/§9 no-parallel-implementation rule).
//
// SEMANTICS (the owner's mandate): localStorage is the OFFLINE CACHE and
// the mock-mode store — the AUTHORITATIVE saved layout is the Supabase
// `dashboard_layouts` row (migration 0134). When a server row exists it
// wins on load and refreshes this cache; when it does not, this cache is
// the user's last known layout (and is promoted to the server once).
// ============================================================================

export const DASHBOARD_LAYOUT_STORAGE_PREFIX = "el-imtiyaz:dashboard-layout:";

export function dashboardLayoutCacheKey(viewKey: string): string {
  return DASHBOARD_LAYOUT_STORAGE_PREFIX + viewKey;
}

export function readDashboardLayoutCache(viewKey: string): string | null {
  try {
    return localStorage.getItem(dashboardLayoutCacheKey(viewKey));
  } catch {
    return null;
  }
}

export function writeDashboardLayoutCache(viewKey: string, raw: string): void {
  try {
    localStorage.setItem(dashboardLayoutCacheKey(viewKey), raw);
  } catch {
    // The editor remains usable when local persistence is unavailable.
  }
}

export function removeDashboardLayoutCache(viewKey: string): void {
  try {
    localStorage.removeItem(dashboardLayoutCacheKey(viewKey));
  } catch {
    // Ignore persistence failures.
  }
}
