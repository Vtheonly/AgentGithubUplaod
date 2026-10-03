# T-477..T-481 Delivery — The 139th Session: The Personnel Page Full Audit + Fixes

**Hub main @ `e690f3b`** · **Android @ `75377c7`** (unchanged this session — delivered for the "zip all the systems" mandate)

## What this delivery contains

The owner's Personnel-page full-audit mandate, delivered as five branch-per-task ADR-028 merges on hub main (each pushed before the next began):

| Task | Branch → merge | What it delivered |
|---|---|---|
| **T-477** — the audit | `docs` commit `600e483` | Every Personnel page tab traced UI → repository → table/mock. Six problems registered BEFORE any fix: WORKFORCE-507 (warehouse fake seed data), WORKFORCE-508 (the Relevé mock island + wrong key + contract violation), WORKFORCE-509 (two assignee-ID split-brains), WORKFORCE-510 (three swallowed errors), CHAT-301 (the dead chat deep link), DEAD-202 (539 unreachable lines). UNKNOWN-030 registered for the auto-Relevé owner question. |
| **T-478** — the removal mandate | `fix/t478-remove-recent-activity` → `90d954a` | The "Activité récente" (Recent Activity) section deleted from every staff dashboard: the shared layout's feed mechanism + all seven dashboards' feed builders + the administrator's feed-only audit fetch. A removal-guard pin keeps it gone. |
| **T-479** — the warehouseTasks port | `feat/t479-warehouse-supabase-port` → `90c6346` | `SupabaseWarehouseTaskRepository` onto the canonical `pending_receipts`/`pending_dispatches` tables (empty since 0011 — the dashboard previously rendered hard-coded mock seeds). **Migration 0139** (the dispatch CHECK widened with 'preparing') applied LIVE + verified 7/7. |
| **T-480** — the wiring repairs | `fix/t480-personnel-wiring-repairs` → `e267071` | CHAT-301: the worker's "Envoyer un message" now opens the supervisor's DM through the canonical idempotent RPC (the placeholder toast deleted; the internal deep link un-deadened). WORKFORCE-509: both assignee filters fixed on the account-id join. WORKFORCE-510: the three swallowed Results surfaced. DEAD-202: the dead drawer deleted after the reachability proof. |
| **T-481** — the Relevé port | `feat/t481-releve-supabase-port` → `aca2649` | `SupabaseReleveRepository` onto `releve_entries` + the tab redesigned to the §09.05 contract (admins record FOR a selected staff member; teachers read-only on their PERSONNEL key). **Migration 0140 — the port's discovery:** the 0009 CHECK admitted only the French 'surveillance' while BOTH clients' shared wire code is 'supervision' — every client Surveillance entry would have been rejected; widened LIVE + verified 6/6. |

## The verification spine

- The full battery went **4 699 → 4 711 → 4 717 → 4 727 passed / 0 failed / 5 skipped** (272 → 275 files), each move registered in `scripts/test-baseline.json` in the SAME commit as its change (§15.84c).
- Three new suites: `supabase-warehouse-task-repository.test.ts` (12), `t-480-personnel-wiring-repairs.test.ts` (6), `supabase-releve-repository.test.ts` (10); the primitives test re-pinned as a removal guard.
- Two migrations applied to the LIVE database through the Management-API SQL endpoint (env-gated scripts; the token never committed): `verify_t-479.sql` **7/7**, `verify_t-481.sql` **6/6**.
- `tsc` 0 errors and eslint 0 errors on the changed files at every step; the append-only migration guard OK.

## The zips

- `AgentGithubUplaod-T477-T481.zip` (8.9 MB, 1964 entries) — the hub tree (the desktop app + the docs system + the migrations + the scripts), no `.git`, no `node_modules` contents (empty placeholder), no env files.
- `elimtiyaz-android-T477-T481-session.zip` (3.9 MB, 506 entries) — the Android tree, unchanged this session (the desktop now shares its `releve_entries` table), delivered for completeness.

## What is left (the honest list)

- **UNKNOWN-030 (owner-gated):** the auto-Relevé ruling — the canonical contract forbids teacher-self-recorded auto entries; a server-side auto-tracking design needs an ADR, not a client patch.
- **The onboarding mock slot (owner-gated):** the wizard is reachable only via the admin "Réinitialiser Onboarding" button and persists nothing; `onboarding_states` is per-personnel while the domain state is a tenant singleton — a model decision.
- **The shifts/schedules mock slots:** the employee drawer's "Horaires & Shifts" tab renders an honest empty state (no fake data displayed); owned by the WORKFORCE-102 standing list.
- **The owner's eyeball pass:** the redesigned Relevé tab, the warehouse dashboard's real (empty, honest) receipts/dispatches, and the chat deep link.
