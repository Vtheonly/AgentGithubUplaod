# T-525 — Live Verification Evidence (the 169th session, 2026-10-13)

> **Task:** T-525 — the exam & homework calendar-visibility fix (the owner's calendar mandate)
> **Problems:** UI-343 · CROSS-201 · SEC-117 · DATA-063 (docs/recovery/problem-registry.md)
> **Environment:** the LIVE production Supabase `vebfehrpzajhstyhinnw` (eu-west-1) — the Management-API SQL endpoint (§11.1), the §15.39 jwt-claims impersonation convention, every payload wrapped `BEGIN → ROLLBACK` (zero residue, §15.38; all seeds T-525-FAKE-marked).
> **Scripts:** `elimtiyaz-desktop/scripts/verify_t-525.sql` (V1–V11, EXECUTE-mode) · `elimtiyaz-desktop/scripts/apply_0154_live.sh` (the migration apply + census).

## Live actors (resolved 2026-10-13)

| Actor | Identity | Why |
|---|---|---|
| PARENT | auth.users `ae39dade-91d1-48a5-a3d0-4d2872e8e156` (parent ABADA `a4098565-602f-425e-8614-4a9811082962`, tenant `…0001`) | the ONLY live parent with a portal account; her child YAHIA ABADA is in class `3db1e709` (5AP — Section A) — the exact class the owner's homework test targeted |
| STAFF | auth.users `a148fe34-98e3-422a-bf42-91da094e270c` (profile `admin@elimtiyaz.dz`, super_admin — the T-510 actor) | the desktop session's RLS posture |
| Live data | homework "dddddd" (Langue arabe, due **2026-10-13**, class `3db1e709`); homework "erty" (due 2026-10-12, class Bouzid `1cf24f60`); calendar_events = **0 rows** pre-task | the owner's own test scenario |

## The diagnosis chain (all probes real, this session)

1. **The homework data path WORKS** — the parent-JWT read of `homework` for the child's class returns the owner's test row (probe P2 / V6). The visibility defect was the WEBSITE calendar's UTC date-key shift: `day.date.toISOString().slice(0, 10)` on local-midnight Dates keys every cell to the PREVIOUS day in UTC+ zones (Africa/Algiers = UTC+1) — the homework due 13/10 rendered on the 14/10 cell and clicking the 13th showed nothing (UI-343, fixed in website commit `0b959c2`).
2. **The exam data path did not exist** — no scheduling surface anywhere, `calendar_events` EMPTY (0 rows), the portal's documented read contract (event-kind.ts) had no producer (CROSS-201; the desktop producer landed in hub commit `1d3aff72`).
3. **A NEW security defect surfaced by the probe** — `calendar_events_admin` (0019) is a FOR ALL policy with NO role check: parents could READ the whole tenant's events AND INSERT/UPDATE/soft-DELETE staff events (live P1/P4/P5 pre-fix). Every sibling 0019 `_admin` policy carries a role check — the omission was an oversight (SEC-117, fixed by migration 0154).

## Migration 0154 — the apply ladder (all GREEN, 2026-10-13)

- `bash scripts/apply_0154_live.sh` → **HTTP 201**, census: `registered = 1` (schema_migrations `0154`), `calendar_events_select` carries the `has_role('parent')` exam branch, `calendar_events_admin` carries the staff `has_any_role` list (both policy texts fetched live via `pg_policies` and matched — no drift).
- Chain state: live `schema_migrations` = 150 rows incl. `0154` (the documented stray-0118 posture intact).
- **Pre-apply baseline (the honest red):** V2/V3/V4/V5/V7 FAILED — the parent saw another class's exam (V2=1), saw staff follow-up-call rows (V3=1), INSERTED a calendar event (V4), soft-deleted a staff event (V5), and V7 counted 4 probe rows (the parent's rogue insert included). **Post-apply: 8/8 GREEN** (see the matrix).

## The EXECUTE-mode matrix (post-fix, `verify_t-525.sql` — 11/11 PASS)

| # | Check | Result |
|---|---|---|
| V1 | parent sees the exam event for the CHILD'S class | **1 row — PASS** |
| V2 | parent does NOT see another class's exam event | **0 rows — PASS** (was 1 pre-fix) |
| V3 | parent does NOT see staff events (follow_up_call) | **0 rows — PASS** (was 1 pre-fix) |
| V4 | parent INSERT into calendar_events | **REJECTED by RLS — PASS** (was: SUCCEEDED — the SEC-117 proof) |
| V5 | parent soft-DELETE of a staff event | **REJECTED/touches 0 rows — PASS** (was: SUCCEEDED) |
| V6 | parent still reads the child-class homework (the UI-343 data side) | **1 row — PASS** |
| V7 | STAFF sees all three probe rows | **3/3 — PASS** |
| V8 | STAFF INSERT still works (the desktop T-175 write path) | **OK — PASS** |
| V9 | STAFF schedules an exam (the desktop repository's exact insert shape: kind='custom' + target_entity_type='exam' + class + room + invigilator) → the PARENT sees it through the website's EXACT `useEventsInRange` query shape | **1 row — PASS** |
| V10 | STAFF RESCHEDULES (the repository `update()` — the SAME row patched) → the parent sees exactly ONE row at the NEW date | **new-date rows = 1, total exam rows for the class = 1 — PASS (no duplicate)** |
| V11 | the PARENT's homework read through the website's EXACT `useHomeworkForClasses` shape (class_id IN the children's classes) | **1 row — PASS** |

## Persistence (the acceptance criterion 4)

Scheduled items live in `calendar_events` (exams) and `homework` (homework) — server-side rows, not client state. The portal refetches through TanStack Query on every mount (the `enabled` guards + query keys documented in portal-queries.ts); there is no session-local event store. Refresh/revisit visibility is therefore the same query path verified above (V9/V11), and the desktop's repository re-queries after every write (its bucket + exam-stream refresh, hub commit `1d3aff72`).

## Residue

Zero: every probe ran inside `BEGIN → ROLLBACK`; the FAKE-marked seeds (three probe events + the E2E exam) never persisted. No audit rows were written (no sanctioned RPC was invoked — direct RLS probes only). The pre-existing live business rows (the owner's two homework rows, the ABADA family) were never modified.

## The verified fix inventory (the complete chain)

| Layer | Commit | What it delivered |
|---|---|---|
| Backend | hub `83e3f0d7` — migration `0154` + apply/verify scripts | the parent exam-read window (scoped to the children's classes, the 0041 pattern) + the `calendar_events_admin` staff role check (SEC-117 closed) — applied LIVE, 8/8 then 11/11 |
| Desktop | hub `1d3aff72` | the Pedagogy "Examens" tab (schedule/list/reschedule/delete) through the CANONICAL `repos.calendar` (T-175), the 'exam' virtual kind adapter (kind='custom' + target_entity_type='exam', 0013's CHECK untouched), mock parity, 15 new tests |
| Website | website `0b959c2` | the LOCAL date keys (UI-343's four toISOString sites gone), the month-RANGE retrieval (`useEventsInRange` — the previously-unused hook), homework across ALL the parent's children's classes (`useHomeworkForClasses`), 10 regression tests |

## Local battery (this session's runs)

- Desktop: `tsc --noEmit` 0 errors · `npm run lint` 0 errors (993 warnings = the pre-existing baseline) · the full vitest suite in directory bands — **all green except ONE pre-existing failure observed mid-session** (t-361's tenantId source-scan vs the concurrent T-521 session's shorthand property) — **fixed by the concurrent session in hub `08deb6c0` before this session's closeout; re-verified 5/5 GREEN on the merged tree** · Layer 2 equivalence pipeline GREEN (desktop 810/0 · mirror 774/0 · tier-4 0 errors 784/820 KNOWN-PARITY-005 · sanity 820/820 + canonical 319/319).
- Website: `npm run lint` 0 errors · `npm run test` **58 files / 700 tests ALL GREEN** (baseline 57/690 + the t-525 suite) · `npm run build` STRICT-green.

## What remains (recorded in the registry entries)

- **DATA-063 (owner action):** 988+/1137 active students have `class_id` NULL — their parents see no homework on ANY portal surface until the placement/assignment flows run. Not compensable client-side (class-scoping is the contract; the sole live portal parent is NOT blocked — her child is assigned).
- The first REAL end-to-end pass (owner schedules an exam in the desktop Pedagogy UI → signs into the portal → sees it on the calendar) rides the owner's next session; the AUTH-401 sign-in blocker (T-522's server half — the Google client secret paste) still gates new portal sign-ins.
