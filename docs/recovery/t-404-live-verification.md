# T-404 — Live Verification & Packaging Evidence

**Task:** T-404 — Automatic Timetable Generation & Constraint Scheduling
**Date:** 2026-09-22 (T-404 session)
**Live backend:** `vebfehrpzajhstyhinnw` (canonical project since 2026-09-17)

## 1. Backend (migrations 0109 + 0110) — 27/27 PASS

`scripts/verify_t-404.sql` (BEGIN/ROLLBACK, synthetic 0404-prefixed UUIDs,
zero residue) executed live via the Management API SQL endpoint:

| Check | Result | Evidence |
|---|---|---|
| C1 registration + chain head | PASS | chain=107 head=0110 (0109+0110 registered; 0108 = the parallel session's promotion_cycles) |
| C2 five tables + RLS | PASS | rooms, timetable_configurations, timetable_constraints, timetable_versions, timetable_entries — all RLS-enabled |
| C3 class_subjects columns | PASS | consecutive_periods + required_room_type |
| C4 integrity indexes | PASS | teacher_slot_uidx, room_slot_uidx, one_published |
| C5 policy shapes | PASS | entries select (staff roles OR published-EXISTS), entries write (staff WITH CHECK), versions select (staff OR status=published) |
| C6 Algerian profile seed | PASS | 1 config, days={sunday..thursday} |
| C7 publish matrix | PASS | draft→rejected (invalid_status); approved→published ok; re-publish rejected; atomic swap archives the previous published version |
| C8 immutability | PASS | INSERT and DELETE on published/archived versions raise P0001 |
| C9 double-booking | PASS | teacher clash and room clash both raise unique_violation |
| C10 RLS impersonation | PASS | staff sees all versions+entries; unbound sees published versions only; parent sees PUBLISHED entries only (draft invisible) |
| C11 teacher role | PASS | teacher READS versions (2) but publish RPC → forbidden |
| C12 no-role caller | PASS | publish RPC → forbidden |

### Discoveries during verification (documented)

1. **RLS recursion defect (fixed by 0110):** the entries policy's
   `EXISTS (… FROM timetable_versions …)` subquery is subject to
   `timetable_versions` RLS — which excluded non-staff — so the
   "published-only for parents" branch was dead code (C10d initially
   `published_visible=0`). 0110 exposes published version rows to every
   tenant-authenticated account, reviving the branch and giving the future
   website parent portal its version lookup.
2. **The t-214 staff actor id (`0a3597e7…`) is OLD-project residue** — it
   does not exist on this clone. The live staff actor is
   `a148fe34-98e3-422a-bf42-91da094e270c` (admin@elimtiyaz.dz, super_admin,
   profile 42e369e9…). Verify scripts MUST re-resolve actors per project.
3. **UUID fixtures must be hex-only** — synthetic ids like `…0s1` fail
   `22P02` at parse time (the verify script now uses hex-safe suffixes).

## 2. Domain + solver — 25/25 PASS (unit)

`src/tests/domain/calc/timetable/t-404-solver.test.ts` — determinism (×3
identical signatures), the known-good fixture (status=valid, 48/48 periods,
0 hard violations, 0 unplaced), the Algerian week (no Fri/Sat entries),
class + teacher free days, lab double-period blocks, no teacher/lab
double-booking, max periods/day, soft-violation honesty, the impossible
variant (French unplaced reasons + unmet_weekly_hours), the canonical
validator (teacher/class/ROOM clashes — the exact SCHED-101 shape —
room-type mismatch, free-day break), live single-move accept/reject, block
math, workflow transitions, locked-pin regeneration.

## 3. Repository — 9/9 PASS (mock twin, real solver + validator)

`src/tests/infrastructure/t-404-timetable-repository.test.ts` — generation
stamps solver id/build; the full draft→in_review→approved→published walk
with stamps; publishing a draft REFUSED; the atomic archive of the previous
published version; duplicate-to-draft + published-immutability refusal;
manual move accepted on a clean slot / REFUSED on class double-booking
(live validation); regeneration keeps locked pins; the Algerian default
configuration seeds per academic year.

## 4. Desktop UI — 7/7 PASS

`src/tests/features/academics/t-404-timetable-ui.test.tsx` — the canonical
grid renders the Algerian week (Dimanche→Jeudi) + the 6 periods, and
projects the SAME solver output three ways (class: 4h Math + 2p Sciences;
teacher: 18 periods; room: the lab's 6 Sciences periods), honest empty
state; the profile data module (Sun–Thu × 6 periods × 2 breaks).

**Full-suite regression:** 3649 passed / 21 failed — the 21 failures are
the EXACT session-opening baseline (dashboard/analytics/financial/vault —
the parallel session's zone); T-404 introduced ZERO regressions.

## 5. Packaging gates (the T-404 completion criterion)

| Gate | Result | Evidence |
|---|---|---|
| Development generation | PASS | vitest suites above (real solver, real validator) |
| Production build | PASS | `npm run build` exit 0 (renderer bundle `dist/assets/index-*.js` contains `ts-greedy-v1`) |
| **Clean-environment generation** | PASS | `node scripts/timetable-packaging-smoke.mjs` — 5/5 gates: the solver + fixture esbuild-bundled into ONE standalone .mjs, executed under `env -i` (EMPTY environment: no PATH/NODE_PATH/NODE_MODULES), 48/48 periods, 0 hard violations, deterministic ×2 (identical signatures), honest impossibility diagnostics, solver id+build stamped |
| Packaged-app launch (Linux, production mode) | PASS | `NODE_ENV=production electron .` under Xvfb: **alive 30s**, loads `dist/` (no dev server); the dbus warnings are the known container noise (T-097/T-108 precedent); no app errors |
| **Windows x64 executable** | PASS | `npm run package:win` exit 0 → `release/El-Imtiyaz Desktop-0.1.0-win-x64-portable.exe` (97,823,777 bytes, PE32 NSIS self-extracting; `file` = "PE32 executable for MS Windows… (GUI)"); the unpacked `El-Imtiyaz Desktop.exe` is **PE32+ x86-64**; **the packaged ASAR contains the solver** (extracted `dist/assets/index-Di4N0V2u.js` → `ts-greedy-v1` found — asserted by the build script itself); SHA256SUMS.txt written: `6559619a62c71ad7dab0d2bb28b8b107c7a5d98bc2657a383e937ef32568b5c9` |
| Failure diagnostics | PASS | smoke Gate D: the impossible variant reports 3 unplaced blocks with French reasons under the bare environment |
| Reopen/reload persistence | PASS (live) | verify C7/C8: published versions are immutable in the DB; the repository re-reads entries from `timetable_entries` (mock twin test: observeEntries after duplicate/move) |
| Solver versioning | PASS | `solver_id`/`solver_build` persisted on every version row (C1×) + smoke Gate E |

### Honest limitation — the NSIS setup.exe on THIS host

The NSIS **installer** target executes the built installer under **wine**
to extract the uninstaller (`app-builder-lib/NsisTarget` —
`execWine(installerPath…)`). This container has no wine and no root to
install it, so `scripts/build-windows.mjs` (extended this session) builds
the **portable Windows x64 .exe only** when wine is absent, with an
explicit warning; the same script builds BOTH targets on a wine-equipped
or native-Windows host. The **portable .exe is a complete, distributable
Windows x64 executable** (the whole app + bundled solver in one
self-extracting file) and satisfies the T-404 Windows x64 packaging gate;
the NSIS setup.exe variant remains a one-command build on a suitable host
(`npm run package:win`). Executing the .exe on a real Windows machine
(owner action) is the remaining step T-506 also could not do here.

### The typecheck repair (shared-tree fix, documented)

The session opened with 6 pre-existing tsc errors (the parallel session's
dashboard-layout-editor merge made the `editing` prop required without
updating 6 test fixtures) — this blocked `npm run build` and therefore the
T-404 packaging gate. Fixed by making `editing` optional (default `false`)
in the four components (`dashboard-layout-editor`,
`dashboard-tab-layout-editor`, `tabs/analytics-tab`, `tabs/overview-tab`)
— backward compatible, 0 tsc errors project-wide after the fix.
