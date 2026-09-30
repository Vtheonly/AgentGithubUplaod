/**
 * SupabaseDashboardLayoutRepository — the DEDICATED dashboard-layout store
 * (T-448 / UI-326, migration 0134).
 *
 * Table (migration 0134 — the owner's "completely separate from unrelated
 * application data" mandate):
 *   `dashboard_layouts` — tenant_id / user_profile_id / view_key / layout
 *   (jsonb, the StoredLayout verbatim) — ONE row per (tenant, user, view).
 *
 * ACCESS MODEL:
 *   - `load` — RLS-scoped SELECT by view_key (the policies pin every row to
 *     `current_user_profile_id()`, so no identity is sent or trusted from
 *     the client on this path).
 *   - `save` — the `save_dashboard_layout(p_view_key, p_layout)` RPC: the
 *     caller's profile + tenant are resolved SERVER-SIDE from the JWT (the
 *     client never sends identity columns — it cannot forge another user's
 *     row), the shape is validated in SQL, and the row is upserted on the
 *     identity triple. This is the EXPLICIT save path — nothing else may
 *     write the table.
 *   - `clear` — RLS-scoped DELETE by view_key (Réinitialiser).
 *
 * ERROR MODEL: every failure propagates as an Err (fail-loud, never a
 * silent fallback — the BUSINESS-002 lesson); the CALLER decides the
 * degradation (the editor falls back to its localStorage offline cache).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseStoredDashboardLayout,
  type DashboardLayoutRepository,
  type StoredDashboardLayout,
} from "../../../domain/repository/dashboard-layout-repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { supabaseErrorToAppError } from "../supabase-client";

/** The dashboard_layouts row shape (the columns the repository touches). */
interface DashboardLayoutRow {
  layout: unknown;
}

export class SupabaseDashboardLayoutRepository implements DashboardLayoutRepository {
  constructor(private readonly client: SupabaseClient) {}

  async load(viewKey: string): Promise<Result<StoredDashboardLayout | null>> {
    try {
      const { data, error } = await this.client
        .from("dashboard_layouts")
        .select("layout")
        .eq("view_key", viewKey)
        .limit(1)
        .maybeSingle();

      if (error) return Err(supabaseErrorToAppError(error));
      if (!data) return Ok(null);
      const parsed = parseStoredDashboardLayout((data as DashboardLayoutRow).layout);
      return Ok(parsed);
    } catch (err) {
      return Err(
        supabaseErrorToAppError({
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async save(
    viewKey: string,
    layout: StoredDashboardLayout,
  ): Promise<Result<string>> {
    try {
      // The RPC resolves the caller's profile + tenant from the JWT
      // server-side — no identity columns are sent from the client.
      const { data, error } = await this.client.rpc("save_dashboard_layout", {
        p_view_key: viewKey,
        p_layout: layout,
      });

      if (error) return Err(supabaseErrorToAppError(error));
      // The RPC returns the saved-at timestamptz (a string over PostgREST).
      const savedAt =
        typeof data === "string" ? data : new Date(0).toISOString();
      return Ok(savedAt);
    } catch (err) {
      return Err(
        supabaseErrorToAppError({
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async clear(viewKey: string): Promise<Result<void>> {
    try {
      const { error } = await this.client
        .from("dashboard_layouts")
        .delete()
        .eq("view_key", viewKey);

      if (error) return Err(supabaseErrorToAppError(error));
      return Ok(undefined);
    } catch (err) {
      return Err(
        supabaseErrorToAppError({
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
