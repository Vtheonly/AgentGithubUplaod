/**
 * MockDataFlag — centralised flag indicating whether the app is
 * currently running in mock mode (no Supabase configured).
 *
 * The sync layer uses this to stamp every queued entry with `isMock`.
 * Mock entries are NEVER pushed to Supabase — they're auto-marked
 * `skipped_mock` at queue time and re-checked at drain time as
 * defense in depth.
 *
 * Why a separate module? Two reasons:
 *   1. Avoids a circular import between `repository-provider` and
 *      `sync-provider` (both want to know about mock mode).
 *   2. Gives us a single seam to mock in tests.
 */

import { isSupabaseConfigured, useSupabase } from "../supabase/supabase-client";

/**
 * Returns true when the app is running in mock mode.
 *
 * Mock mode means: the user has NOT configured Supabase (URL + anon key)
 * in Settings → Configuration. All data shown in the UI is seed/mock
 * data — none of it should be pushed to Supabase.
 *
 * Note: when Supabase IS configured but the user is signed out, we
 * still return false (not mock mode) — the data layer will simply
 * not have any data to push until the user signs in.
 */
export function isMockMode(): boolean {
  // We're in mock mode if either:
  //   - The useSupabase flag is false (user hasn't enabled Supabase), OR
  //   - The useSupabase flag is true but URL/key are missing (config
  //     incomplete — the repository provider falls back to mock).
  return !useSupabase || !isSupabaseConfigured();
}

/**
 * Returns the source label to stamp on sync entries.
 * Useful for debugging — appears in the queue table.
 */
export function dataSourceLabel(): "excel" | "mock" | "manual" {
  return isMockMode() ? "mock" : "manual";
}
