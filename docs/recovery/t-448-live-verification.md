# T-448 — Live Verification (2026-09-30, 125th session)

**The task:** the owner's dedicated dashboard-layout-configuration table — "create a new dedicated Supabase table specifically for storing dashboard layout configurations… configure the layout once, save it, and never have to configure it again unless I intentionally change it… load the saved configuration when the application starts or when I reopen the relevant page… only update the saved configuration when I explicitly change and save it… keep this completely separate from unrelated application data."

**The deliverable:** migration `0134_dashboard_layouts.sql` — the dedicated `public.dashboard_layouts` table (ONE row per tenant + user + view key), four own-rows RLS policies (every authenticated user manages ONLY their own layouts — no admin gate: a layout is a personal preference), the `save_dashboard_layout(p_view_key, p_layout)` RPC (identity resolved SERVER-SIDE from the JWT; the client never sends tenant/profile columns), and the in-file self-registration (the T-091/MIG-TOKENS pattern). Client side: the `DashboardLayoutRepository` contract + the Supabase twin + the localStorage mock twin + the editor integration (load-on-mount server-wins, one-time promotion of a pre-T-448 local layout, explicit-save-only server writes, reset clears the row).

**The credentials this session:** the `sbp_` Management token **WORKED** (HTTP 200 on `/v1/projects/vebfehrpzajhstyhinnw` — the second live token after T-446's fourth-token breakthrough; the T-445/T-443/T-442 dead-token streak is over). The `sb_secret_` data-gateway key and the owner-pinned admin credential (credentials.md §1) worked for the client-path probes.

---

## 1. The application (Management-API SQL endpoint, the §11.1 convention)

```
SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0134_live.sh
→ HTTP 201 []
```

The live migration chain head is now **`0134 > 0133 > 0132 > 0131`** — verified:

```
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;
→ 0134 dashboard_layouts · 0133 debt_aging_thresholds_client_contract · 0132 er_rpc_tenant_guards
```

Pre-apply census (this session, before any DDL): the public schema had **zero** `%layout%` tables (110 tables total) — the table is genuinely NEW, nothing was repurposed.

## 2. The SQL-level contract — `verify_t-448.sql` → **18/18 PASS**

Run through the committed `scripts/run_verify_sql_live.sh` (the temp-table + trailing-ROLLBACK convention; the one-shot session's end provides the all-or-nothing rollback):

| Check | Verdict | Evidence |
|---|---|---|
| C1 columns | PASS | `created_at, id, layout, tenant_id, updated_at, user_profile_id, view_key` (7) |
| C2 identity unique | PASS | `unique (tenant_id, user_profile_id, view_key)` — the "ONE saved layout per user per view" identity |
| C3 RLS enabled | PASS | `row level security enabled` |
| C4 own-rows policies | PASS | 4/4 `to authenticated` policies, each pinned to `user_profile_id = current_user_profile_id()` |
| C4b no role gate | PASS | no role gate on any policy (a personal preference — NOT the 0024 admin pattern) |
| C5 RPC shape | PASS | `save_dashboard_layout(text, jsonb)`: SECURITY INVOKER, returns timestamptz |
| C6a anon ACL | PASS | anon + public lost EXECUTE |
| C6b authenticated ACL | PASS | authenticated keeps EXECUTE |
| C7 registration | PASS | `schema_migrations 0134 = dashboard_layouts` |
| C8 A saves via the RPC | PASS | `saved_at=2026-09-30 03:28:43+00` (the real admin profile, RLS enforced) |
| C9 A loads it back | PASS | 1 row, the layout jsonb VERBATIM (the editor's load path) |
| C10 the upsert | PASS | a second save → still ONE row, UPDATED (`kpi.w` 6→12) — never a duplicate |
| C11 no-profile caller | PASS | **42501** — identity is resolved server-side; an unregistered sub cannot save |
| C12 B sees nothing of A | PASS | user B (a synthetic profile created INSIDE the transaction) sees 0 rows while A owns 1 |
| C13 B saves their own | PASS | B's row under the SAME view key; B sees exactly their 1 row, `kpi.w=3` |
| C14 B cannot delete A's | PASS | B's direct DELETE on A's row id → **0 rows deleted** (the forged-identity guard) |
| C15 A's row survived | PASS | after B's delete + writes: A sees their 1 row with A's LAST save |
| C16 A resets | PASS | DELETE own row → A sees 0 rows |

Everything ran inside `BEGIN; … ROLLBACK;` under `set local role authenticated` with simulated JWT claims (the verify_t-432 C12 role-downgrade convention; the §15.27 GRANT on the temp table precedes the downgrade). **Zero live residue** — re-confirmed after the run: `select count(*) from public.dashboard_layouts` → **0**; no `t448%` probe profiles remain.

## 3. The client-path end-to-end — `t-448-live-e2e.sh` → **9/9 PASS (ALL GREEN)**

The exact wire calls the desktop makes (PostgREST + the auth gateway — no Management API; the verify_t-445 data-gateway discipline):

| Check | The owner's contract words | Evidence |
|---|---|---|
| E1 | (sign-in) | the owner-pinned admin credential → the staff JWT |
| E2 | "load the saved configuration when I reopen the page" | GET before any save → `[]` (a fresh view starts empty) |
| E3 | "save the layout configuration to the dedicated table" | POST `/rpc/save_dashboard_layout` → the saved-at timestamp |
| E4 | "reuse the exact same saved layout" | GET → ONE row, the layout jsonb **VERBATIM** (x/y/w/h exact) |
| E5 | "only update when I explicitly change and save it" | a read-only reload is byte-identical INCLUDING `updated_at` — reads never write |
| E6 | "unless I intentionally change it" | the second explicit save → the row UPDATED, still ONE row (never duplicated) |
| E7 | (Réinitialiser) | DELETE → 2xx |
| E8 | (zero residue) | GET after reset → `[]` |
| E9 | (separation/isolation) | the publishable key alone sees NOTHING (RLS: own-rows, `to authenticated`) |

## 4. The local gates (Phase 4, the same session)

- `npm run typecheck` → **tsc 0**.
- `npx eslint` on every changed/new file → **0 errors, 0 warnings**.
- The two NEW suites: `t-448-dashboard-layout-repository.test.ts` **16/16** + `t-448-layout-persistence.test.tsx` **11/11** (RED-first: the editor suite caught the StrictMode cancelled-flag defect — AGENTS.md §15.80a).
- The FULL vitest run: **4,616 tests — 4,594 passed / 17 failed / 5 skipped**; passed = the T-447 baseline's 4,567 + exactly the 27 new tests; the **failing FILE set diffed byte-identical** against `scripts/test-baseline.json` (every one of the 17 is pre-existing and unrelated to layouts). The registered baseline move cites T-448.

## 5. What this means for the owner

- **Configure once:** drag/resize the dashboard, click **Enregistrer** — the layout is saved to the dedicated table under YOUR profile.
- **Never again:** reopening the app (or the page) loads the exact saved layout — even on a new machine, a cleared profile, or a packaged-app reinstall (the previous localStorage-only behavior lost it).
- **Only on purpose:** editing without saving never touches the saved row; the next load still returns the last EXPLICIT save. Réinitialiser clears it everywhere.
- **Offline-safe:** the localStorage cache remains the instant/offline fallback; a failed server save is shown inline (« Serveur injoignable — conservé localement, réessayez ») and never loses the local work.
- **Separate by design:** the table holds NOTHING but layout configurations — no domain data reads or writes it, and it is not part of the backup's domain census.

## 6. Left / follow-ups

1. The `dashboard-tab-layout-editor.tsx` (order+sizes, the `…:tab:` prefix) has NO consumer in the tree — left untouched (dead code; registering its removal is a TECHDEBT-family decision, not T-448's).
2. The `UserPreferencesProvider` (theme/locale/timezone/currency) remains localStorage-only — the same CLASS of gap, but NO owner mandate covers it (registered as an observation in UI-326's cross-references, not as a problem).
3. Android/website do not consume dashboard layouts (the desktop is the only dashboard surface) — nothing to port; §10's cross-platform rule is satisfied vacuously.
4. The promotion upload happens on editor mount when no server row exists — a pre-T-448 localStorage layout migrates itself on first open after this change ships.
