# Current State — Project Snapshot (2026-08-30, end of ninth session)

> Answers: "What is the state of the project RIGHT NOW?" Update this file whenever the recovery state materially changes. CURRENT facts only; targets live in `docs/architecture/system-map.md` §5 and in ADRs marked Proposed.

## 1. Architecture status

- Three repositories operate against **one Supabase backend** whose canonical schema is the desktop repo's migration chain 0001–0052 (ADR-001). Migrations 0001–0052 are committed AND applied to the live Supabase project (hkvkefubghbbotgnteir) AND registered in `supabase_migrations.schema_migrations` — verified live via the Management API SQL endpoint (T-090, T-091, T-087). The migrations 0049-0052 are: T-083/0049 (`expire_pending_approvals` rewrite + mv_dashboard_kpis fan-out fix + MV unique indexes), T-084/0050 (FCM token caller verification + canonical `deactivate_fcm_tokens` RPC), T-091/0051 (chat_read_receipts reconciliation — local file added to match what's already on the live DB), T-087/0052 (`_eq_test_fn`/`_eq_test_fn2` test-residue functions dropped).
- **Desktop** (Electron/React): functional as the staff operations app for CRM + financials + academics, with a partial Supabase migration — `overdueAlerts` is now Supabase-backed (T-080, ARCH-006 closed 2026-08-30); ~25 of ~45 repository slots still run on mocks in "Supabase mode" (`ARCH-001`; the `expenses` slot is the next P2 target — DRIFT-013, T-093). The Dashboard UI is now restructured around the real backend data model (T-088 — 5 duplication/dead-code defects fixed). All 8 KPIs read real Supabase data (T-089 — was 4 hardcoded zeros before). Payment cache is seed-once with no refresh (`CROSS-104`). There is **no refund UI** (`DEAD-015`).
- **Android** (Kotlin/Compose): offline-first, Room-backed, fully functional locally, but its server write path bypasses every canonical financial RPC (`ARCH-003`, `CROSS-005`). Sync errors SURFACE (CROSS-200 fixed 2026-08-29); authentication is fail-closed (2026-08-29, T-002); build/test gate OPERATIONAL (ARCH-007 fixed): baseline 219/219 unit tests incl. 45/45 equivalence scenarios; lint gate NOT green (ARCH-008/T-082 — 315 pre-existing errors).
- **Website** (Next.js parent portal): read paths work with canonical KPIs (T-084 session 8); chat is permanently empty (`CHAT-103`); push notifications non-functional end-to-end (`PUSH-100` family). Mock-admin auth removed 2026-08-29 (T-009). Strict build (ARCH-005 fixed 2026-08-29, T-049). The Financial view was restructured around the real data model in session 8 (ledger replay, real payment statuses, display_name greeting, fr/ar/en i18n).
- **Homework and desktop roll-call are broken end-to-end** (`HOMEWORK-100/101`, `ATT-100`); **year-end promotion fails on every platform** (`TENANT-106`, `STUDENT-100`, `BUSINESS-004`).

## 2. Major known problems (top of the risk stack)

153 total problems after the 2026-08-30 ninth session (ARCH-009, ARCH-010, DRIFT-013 added; ARCH-006 + DATA-007 fixed). The most dangerous remaining:
1. ~~`SEC-100`~~ **FIXED 2026-08-29 (T-001)** — desktop credentials removed.
2. ~~`SEC-101`/`SEC-102`~~ **FIXED 2026-08-29 (T-002)** — Android auth fail-closed.
3. `BUSINESS-002` — desktop payment collection silently degrades to a non-atomic path on RPC failure.
4. ~~`CROSS-200`~~ **FIXED 2026-08-29 (T-019)** — Android sync surfaces 4xx/5xx.
5. `TENANT-100`/`TENANT-101` — RBAC role resolver ignores tenants.
6. ~~`ARCH-006`~~ **FIXED 2026-08-30 (T-080)** — `SupabaseOverdueAlertGenerator` wired into the assembly (8-test unit suite). Live integration = T-094.
7. ~~`ARCH-010`~~ **FIXED 2026-08-30 (T-088 + T-089)** — dashboard restructured (10-test regression suite); 4 hardcoded KPIs backfilled against real data.
8. ~~`ARCH-009`~~ **MITIGATED 2026-08-30 (T-091)** — `0051_chat_read_receipts.sql` added + applied live + registered in schema_migrations.
9. ~~`DATA-007`~~ **FIXED 2026-08-30 (T-087)** — test residue dropped via migration 0052 + test auth user + approval request deleted.
10. **`DRIFT-013` (NEW 2026-08-30)** — desktop code calls `.from("expenses")` but the canonical table is `expense_tickets` (with different status values). Dashboard KPI mitigated; wider port = T-093.

## 3. Source-of-truth decisions in force

Canonical writers = SQL RPCs; desktop TS engine = reference; deterministic identity codes; server-authoritative receipt numbers (ADR-002/003/004, Accepted). Android's target write architecture (ADR-005) and the single-equivalence-framework consolidation (ADR-006) are **Proposed** — direction set, implementation not started.

## 4. Active migrations

**0044-0048** — committed + applied (sessions 5-7) + EFs deployed (create-user-account + 4 cron EFs). CRON_SECRET set.
**0049_dashboard_kpis_fanout_expire_fix.sql (T-084/T-083)** — committed + applied + registered (session 8).
**0050_fcm_token_caller_verification.sql (T-084)** — committed in local repo; FCM functions applied live via the Management API SQL endpoint (session 8). NOT registered under the FCM name (live schema_migrations has version 0050 = `chat_read_receipts` from a later separate application — see ARCH-009).
**0051_chat_read_receipts.sql (T-091, NEW this session)** — committed + applied + registered (session 9). Reconciles the ARCH-009 drift: the chat_read_receipts migration that's applied to the live DB but was missing from the local repo. Idempotent.
**0052_drop_test_residue.sql (T-087, NEW this session)** — committed + applied + registered (session 9). Drops `_eq_test_fn` / `_eq_test_fn2`. Test auth user + expired approval request deleted via SQL directly (auth schema not in public migration chain).

Historical note: migrations 0034–0043 were a 10-migration fix-up chain after the "unification" of 0026–0028 (REG-001) — treat the chain as append-only from here.

## 5. Completed recovery work (most recent first)

- **2026-08-30 — Ninth repair session (T-088, T-080, T-089, T-091, T-087, T-092 all TESTED):** owner-requested dashboard restructure + backend testing + migration token reconciliation. (1) Desktop Dashboard UI restructured (ARCH-010 — 5 duplication/dead-code defects fixed). (2) `SupabaseOverdueAlertGenerator` ported (ARCH-006 closed — 8-test unit suite). (3) Migration 0050 drift reconciled (ARCH-009 — `0051_chat_read_receipts.sql` added + applied live + registered). (4) Test-residue cleanup (DATA-007 closed — `0052_drop_test_residue.sql` applied live + test auth user deleted). (5) Cross-platform migration token consistency verified (7/7 checks pass). (6) 4 hardcoded Supabase KPIs backfilled against real data (T-089 — verified live: totalStaff=0/pendingExpenses=0/attendanceRateToday=0/overdueAlerts=269). 3 new problems registered (ARCH-009, ARCH-010, DRIFT-013); 2 new tasks opened (T-093 — port desktop `expenses` repository to Supabase; T-094 — live integration test for `SupabaseOverdueAlertGenerator`).
- **2026-08-30 — Eighth repair session (T-083, T-084 TESTED):** live backend health check (11 findings → DATA-001…007, BUG-NEW-002/003); migration 0049 applied live; migration 0050 applied live (FCM verification); website portal restructured around the real data model; FCM token lifecycle hardened cross-platform; credentials sheet written.
- **2026-08-30 — Seventh repair session (T-016, T-027, T-061, T-031, T-029, T-071 all TESTED; T-079, T-004 promoted to VERIFIED):** balanced batch of 8 tasks across desktop + website + backend.
- Earlier sessions: T-002 (Android auth bypasses), T-079 (admin accounts), T-004 (cron EF auth), T-078 (desktop ESLint), T-081 (Android build), T-019 (sync errors), T-049 (website strict build), T-001 (desktop credentials), T-009 (website mock-auth), T-010 (desktop --no-sandbox), T-003 (desktop changePassword), T-000 (documentation reset).

## 6. Remaining high-risk work (recommended order)

Phase 0 security hotfixes (T-001…T-010) → financial integrity (T-011…T-018) → sync correctness (T-019…T-027) → account flows & realtime (T-028…T-035) → feature completion decisions (mostly blocked on unknowns) → architecture cleanup. See `task-registry.md`.

**Immediate next picks (per next-task.md):**
- T-093 (NEW, P2 High) — port desktop `expenses` repository to Supabase (DRIFT-013 wider port).
- T-094 (NEW, P2 Medium) — live integration test for `SupabaseOverdueAlertGenerator` (T-080 follow-up).
- T-005 (P0 Critical) — tenant-scoped RBAC resolver + admin policies (TENANT-100/101).

## 7. Blocked work

13 problems are BLOCKED, all on business/product decisions recorded in `unknowns.md` — most notably the activation-bind contract (`UNKNOWN-001`, blocks the EF consolidation), the Android write architecture confirmation (`UNKNOWN-002`, blocks the largest remediation), and the payment-EF gateway decision (`UNKNOWN-003`).

## 8. Current test coverage

- Desktop: 47 files / 2029 tests ALL PASS (was 46/2021 before session 9; +2 files, +18 tests). Includes the new dashboard-restructure regression suite (10 tests) and the SupabaseOverdueAlertGenerator unit suite (8 tests). Lint 0 errors (311 baseline warnings).
- Android: 219/219 (unchanged).
- Website: 8 files / 105 tests ALL PASS (unchanged).
- Live Supabase: migrations 0049-0052 all applied + registered in `supabase_migrations.schema_migrations`. RLS blocks anon reads on all 6 core tables. 1 auth user (`admin@elimtiyaz.dz`). 58 RPCs exposed. Verification scripts persisted under `/home/z/my-project/scripts/`.

## 9. Known cross-platform divergences (summary)

Payment write paths ×3, receipt numbering ×5 algorithms, overdue rule ×3 variants, attendance rate ×2 formulas, notification unread counts ×3 behaviours, freshness models ×3 (seed-once / 15-min pull / realtime+30s), sign-out semantics ×3. NEW this session: DRIFT-013 — desktop code calls `.from("expenses")` but the canonical table is `expense_tickets` (with different status values). Full list: `problem-registry.md` (CROSS-*, DRIFT-*, WEAK-019, DRIFT-013).

## 10. Known dead / obsolete code (summary)

Payment EFs never invoked (`DEAD-016`), desktop refund path unreachable (`DEAD-015`), legacy `homework_assignments` table + subscriptions (`WEAK-016`), dead SQL `promote_students` RPC (`ACAD-100`), `parent_student_links` table with zero writers (`DEAD-200`), unused canonical-port files on the website (`DRIFT-009`), legacy Android Room cache layer + design system (`DUP-005`, `DUP-003/004`), orphaned `receipts` table (`CROSS-101`). NEW this session: dead "PDF" report badge removed from the Reports tab (T-088); dead bottom Stat card removed from the Overview tab (T-088); dead auto-run `repos.overdueAlerts.run()` removed from `dashboard-page.tsx` (T-080); dead `_eq_test_fn` / `_eq_test_fn2` RPCs dropped via migration 0052 (T-087).

## 11. Known unknowns

11 open questions block 13 problems — see `unknowns.md`. No agent may resolve them by assumption.
