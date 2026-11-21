/**
 * T-552 (ARCH-019) — the app-facing backend access surface.
 *
 * THE RULE this module installs: application code (features, shared, app,
 * non-supabase infrastructure) may reach the Supabase client module ONLY
 * through this re-export surface — never by importing `supabase-client`
 * directly. `repository-provider.tsx` (the composition root that builds the
 * 54-slot repository composite) remains the one file allowed to import the
 * client module directly; everything else routes here. The gate that enforces
 * it: `src/tests/infrastructure/t-552-bypass-routing.test.ts` (the census
 * walks the whole non-supabase src tree).
 *
 * This is the registered T-552 scope: the 17 bypass files' IMPORT SEAMS ONLY,
 * behavior-preserving. Every binding below is a VERBATIM re-export from
 * `supabase-client` — the same singletons, the same functions, the same
 * module-init resolution; zero behavior change at any call site. The deeper
 * routing ARCH-019 asked for (parent-detail-drawer through the repositories;
 * the DiagnosticsPort/StoragePort adapters for the settings tooling) lands
 * with the Stage B port implementations (T-599+) and the E-lane work — this
 * module is the seam those lanes replace, not the end state.
 *
 * Census of what the 17 files actually consume (the only symbols re-exported):
 *   - status/config reads: `isSupabaseConfigured`, `useSupabase`,
 *     `supabaseUrl`, `supabaseAnonKey`
 *   - the client handle: `getSupabaseClient` (the canonical singleton —
 *     never a second client)
 *   - diagnostics: `describeSupabaseConnection`
 *   - the pure URL helper: `normalizeSupabaseUrl` (no SDK state — the OPS-318
 *     shared normalization seam)
 *
 * Tests that mock `supabase-client` (vi.mock/vi.doMock by path) keep working
 * unchanged: module interception is by resolved path, so the re-export chain
 * here delivers the mocked bindings to every consumer.
 */

export {
  getSupabaseClient,
  isSupabaseConfigured,
  useSupabase,
  supabaseUrl,
  supabaseAnonKey,
  describeSupabaseConnection,
  normalizeSupabaseUrl,
} from "./supabase-client";
