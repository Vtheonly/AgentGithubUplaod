# T-482..T-484 Delivery — The 140th Session: The Audit's Remaining List Resolved (the auto-Relevé ruling + the onboarding persistence + the shifts/schedules port)

**Hub main @ `f80f7f5`** · **Android @ `75377c7`** (unchanged this session — delivered for the "zip all the systems" mandate)

## What this delivery contains

The owner's "read the full audit and fix what was listed in this audit" mandate (the 139th session's remaining list), delivered as three branch-per-task ADR-028 merges on hub main (each pushed before the next began), plus the registration commit (`docs/t482-t484-registration` → `2506eff`):

| Task | Branch → merge | What it delivered |
|---|---|---|
| **T-482** — the auto-Relevé server design | `feat/t482-auto-releve-server-design` → `f5f3333` | **UNKNOWN-030 RESOLVED** (the audit's #1 remaining item, owner-gated): **ADR-034** + **migration 0141** (applied LIVE, verified **9/9**) — the exempted auto entry kind (`entry_source`/`auto_kind`, CHECK-coupled), the `prevent_self_releve_entry` trigger re-scoped to manual rows (the §09.05 ban PRESERVED — the live C5 probe proves the raise still fires), and the `record_auto_releve_entry` SECURITY DEFINER RPC. The desktop's three classroom write paths (grade entry/batch, roll call, homework push) call it through the fail-safe bridge (a releve failure never breaks the primary write). The Relevé tab's existing "auto" badge now lights up on RPC-written rows. |
| **T-483** — the onboarding persistence port | `feat/t483-onboarding-supabase-port` → `2ef643c` | The audit's #2 (the "persists nothing" mock slot): **migration 0142** (applied LIVE, verified **9/9**) — the tenant-singleton ruling (`onboarding_states.personnel_id` NULLable + the partial unique index; the per-personnel semantics kept) + `SupabaseOnboardingRepository` (the wizard's full lifecycle persists; the Postgres NULL-on-conflict trap documented — start() is read-then-write). |
| **T-484** — the shifts/schedules port | `feat/t484-shifts-schedules-supabase-port` → `f80f7f5` | The audit's #3 (the WORKFORCE-102 standing list's last two desktop slots): the domain `Shift`/`Schedule` types ALIGNED to the canonical 0010 schema (the pre-T-484 shapes were a parallel imagination the tables cannot store) + `SupabaseShiftRepository`/`SupabaseScheduleRepository` + the employee drawer's "Horaires & Shifts" tab re-based onto the per-day model ("Planification de la semaine"). NO migration (the 0010 tables exist live) — `verify_t-484.sql` **12/12 LIVE**. |

## The verification spine

- The full battery went **4 727 → 4 738 → 4 748 → 4 761 passed / 0 failed / 5 skipped** (275 → 278 files), each move registered in `scripts/test-baseline.json` in the SAME commit as its change (§15.84c).
- Three new suites (34 tests total): `supabase-auto-releve.test.ts` (11), `supabase-onboarding-repository.test.ts` (10), `supabase-shift-schedule-repository.test.ts` (13).
- Two migrations applied to the LIVE database through the Management-API SQL endpoint (env-gated scripts; the token never committed): `verify_t-482.sql` **9/9**, `verify_t-483.sql` **9/9**; the no-migration T-484 verified against the live 0010 contract **12/12**.
- `tsc` 0 errors and eslint 0 errors on the changed files at every step; the append-only migration guard OK at every step; the opening live-chain census clean (136 live = the local 135 + the documented stray 0118 row).

## The session's discoveries (all documented)

1. **The vacuous-pass class (verify_t-482's first run):** the live personnel table has **ZERO user_id bindings** (14 rows, 0 bound) — the C5/C6 runtime probes passed VACUOUSLY (an INSERT…SELECT with no source rows never fires the trigger). Repaired with a synthetic bound row inside BEGIN…ROLLBACK. A runtime probe must pin its row source, not just the absence of an exception.
2. **The Postgres NULL-on-conflict trap (T-483):** `ON CONFLICT (tenant_id, personnel_id)` can NEVER match a NULL column — a naive upsert would insert a second singleton row and die on the partial unique index. start() is read-then-write.
3. **The domain-model alignment regressed nothing (T-484):** the pre-change blast-radius census predicted exactly one consumer (the drawer) — the full battery confirmed it (the DUP-001 class avoided by the census-first discipline).

## The zips

- `AgentGithubUplaod-T482-T484.zip` — the hub tree (the desktop app + the docs system + the migrations + the scripts), no `.git`, no `node_modules` contents (empty placeholder), no env files.
- `elimtiyaz-android-T482-T484-session.zip` — the Android tree, unchanged this session (the desktop's 0141 columns are additive/nullable — a future Android releve pull needs no migration), delivered for completeness.

## What is left (the honest list)

- **The trigger-based auto-Relevé hardening (registered, non-blocking):** moving the auto-recording into server-side triggers on the classroom tables (the 0078 precedent) once a batch/submission boundary exists server-side — ADR-034's Consequences; the RPC stays as the compat path.
- **The remaining mock slots (beyond the Personnel page):** performanceReviews, aiConfig, clubs, psychology, orthophonie — the ARCH-001 census (all outside the Personnel page's scope).
- **The shift-template editor / schedule-planner UI:** no surface today (the drawer tab is the only consumer); the repositories carry the full CRUD contract on the canonical tables.
- **The owner's eyeball pass (now six surfaces):** this session's three (the auto-Relevé badges on a teacher's ledger · the persisted onboarding wizard surviving a restart · the drawer's per-day schedule list) + the 139th session's three (the Relevé admin form · the warehouse dashboard's honest empty states · the chat deep link).
