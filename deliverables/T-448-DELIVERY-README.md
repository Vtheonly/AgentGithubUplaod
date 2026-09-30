# T-448 DELIVERY — the DEDICATED dashboard-layout-configuration table (migration 0134, applied live): configure once, save, never again

**Session:** 125th (2026-09-30) · **Task:** T-448 · **Merged at:** the
`merge: T-448 Phase 6` commit on main (`e74642e` — the documentation
closeout; the working-tree head when this zip was built is the delivery
commit on top of it).

## The mandate

The owner's issue: "create a **new dedicated Supabase table specifically
for storing dashboard layout configurations**… I want to configure the
layout **once**, save it, and never have to configure it again unless I
intentionally change it. When I open the application again, I should be
able to load the previously saved layout configuration and continue
using the exact same layout… **only update the saved configuration when
I explicitly change and save it**… keep this completely separate from
unrelated application data… one clear responsibility: **persisting and
restoring the user's layout configuration**."

## What was delivered (the six-phase sequence — each committed, pushed, merged --no-ff)

1. **Migration `0134_dashboard_layouts.sql`** (applied live, HTTP 201 —
   the chain head is now `0134 > 0133 > 0132 > 0131`): the DEDICATED
   `public.dashboard_layouts` table — ONE row per (tenant, user, view
   key); the `layout` jsonb carries the editor's StoredLayout verbatim;
   FOUR own-rows `to authenticated` RLS policies (no admin gate — a
   layout is a personal preference, deliberately NOT the 0024
   system_settings pattern); the `save_dashboard_layout(p_view_key,
   p_layout)` RPC — SECURITY INVOKER, the caller's identity resolved
   SERVER-SIDE from the JWT (the client cannot forge another user's
   row), shape validation, upsert on the identity triple; §15.34
   grants; the in-file self-registration (T-091/MIG-TOKENS).
2. **The repository layer:** the `DashboardLayoutRepository` domain
   interface (load / save / clear + the ONE shared defensive parser) +
   the Supabase twin (RLS-scoped SELECT/DELETE + the save RPC; every
   failure an Err — fail-loud) + the localStorage mock twin (mock-mode
   parity on the editor's OWN cache key) + the provider wiring (the
   `dashboardLayouts` slot — separate from the KPI-computing
   DashboardRepository; outside the backup's domain census).
3. **The editor integration:** load-on-mount SERVER-WINS (the offline
   cache paints instantly, then the saved row replaces any local
   residue and refreshes the cache); the ONE-TIME PROMOTION of a
   pre-T-448 local layout; the dirty-guard (mid-edit server applies
   skipped); the EXPLICIT Enregistrer as the ONLY server write;
   Réinitialiser clears the row; the honest inline outcome banner;
   StrictMode-safe exactly-once loading.
4. **The test battery:** 16/16 (the repository contract + the source
   guards) + 11/11 (the editor lifecycle) — RED-first: the suite
   caught the StrictMode cancelled-flag defect (AGENTS.md §15.80a),
   fixed in the same commit.
5. **The live verification:** `verify_t-448.sql` **18/18** (the catalog
   + the RLS isolation matrix under simulated JWTs — user B sees
   nothing of A, B's direct delete of A's row id affects 0 rows, a
   no-profile caller refused 42501) + the client-path E2E
   `t-448-live-e2e.sh` **9/9 ALL GREEN** (sign-in → load-empty → the
   explicit save → load-back-VERBATIM → a read-only reload
   byte-identical INCLUDING updated_at → the intentional change
   updates never duplicates → reset → zero residue → the anon key sees
   nothing). Zero residue after both probes.
6. **The closeout:** the registries truth-synced (UI-326
   RESOLVED — TESTED + LIVE-VERIFIED · T-448 DONE), the change-log
   entry, AGENTS.md §15.80 (four permanent discoveries), next-task +
   current-state, this delivery.

## Gates (all GREEN)

- `npm run typecheck` → tsc 0 errors · eslint 0 NEW errors on every
  changed file.
- The NEW suites: **27/27** (16 + 11).
- The FULL vitest: **4,594 passed / 17 failed / 5 skipped (4,616)** —
  BASELINE-MATCHED: the failing FILE set byte-identical to the
  documented baseline; the registered baseline move (+27 passing
  tests).
- The append-only migration guard: OK (+1 new migration, +0 modified).
- Live: apply HTTP 201 · verify_t-448 **18/18** · the client-path E2E
  **9/9** · zero residue.

## Registry

UI-326 RESOLVED — TESTED + LIVE-VERIFIED · T-448 DONE
(docs/recovery/task-registry.md). Knowledge: AGENTS.md §15.80 (the
sentinel/cancellation conflict · the shared-key extraction order · the
bash-JSON canonicalization rule · the baseline bookkeeping quirk) ·
docs/recovery/change-log.md (the 125th-session entry).

## What this means for the owner

- **Configure once:** drag/resize the dashboard, click Enregistrer —
  the layout is saved to the dedicated table under YOUR profile.
- **Never again:** reopening the app (or the page) loads the exact
  saved layout — on a new machine, a cleared profile, or a
  packaged-app reinstall (previously lost with the device).
- **Only on purpose:** editing without saving never touches the saved
  row; Réinitialiser clears it everywhere; a failed server save is
  shown inline and never loses local work.
- **Offline-safe:** the localStorage cache remains the instant/offline
  fallback.

## What remains (the honest Left list)

1. `dashboard-tab-layout-editor.tsx` (order+sizes) has NO consumer in
   the tree — left untouched (a TECHDEBT-family removal decision).
2. The UserPreferencesProvider (theme/locale/timezone/currency)
   remains localStorage-only — the same CLASS of gap, no owner mandate
   for it.
3. Android/website consume no dashboard layouts (the desktop is the
   only dashboard surface) — nothing to port.

## How to verify locally

```bash
cd elimtiyaz-desktop
npm ci
npm run typecheck                       # 0 errors
npx vitest run src/tests/infrastructure/t-448-dashboard-layout-repository.test.ts \
                src/tests/features/dashboard/t-448-layout-persistence.test.tsx   # 27/27
npm test                                # the unified runner — NO new regressions

# Live (needs the owner-pinned admin credential — docs/operations/credentials.md §1):
bash scripts/t-448-live-e2e.sh          # 9/9 ALL GREEN

# Live SQL contract (needs a working Management token):
SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-448.sql   # 18/18
```

## The zips

- `AgentGithubUplaod-T448.zip` — the hub (desktop + backend + docs)
  at the delivery commit.
- `elimtiyaz-website-T448.zip` — the website, carried forward
  byte-identical from T-440 (no website file changed since).
- `elimtiyaz-all-systems-T448.zip` — `repo/` (the hub) +
  `elimtiyaz-website/` (the combined tree).
