# Current State — Project Snapshot (2026-08-31, end of eleventh session + session-12 opening verification)

> Answers: "What is the state of the project RIGHT NOW?" Update this file whenever the recovery state materially changes. CURRENT facts only; targets live in `docs/architecture/system-map.md` §5 and in ADRs marked Proposed.

## 1. Architecture status

- Three repositories operate against **one Supabase backend** whose canonical schema is the desktop repo's migration chain 0001–0057 (ADR-001). Migrations 0001–0057 are committed AND applied to the live project AND registered in schema_migrations (verified 2026-08-31, session-12 opening: version sets match one-to-one — 54 rows, the 0015–0017 gap is a pre-audit numbering gap, not drift; functional checks 12/12 in scripts/verify_s12_chain_consistency.sql). Session 11 added 0057 (canonical tenant resolver, live-verified 6/6). KNOWN cosmetic registry condition: live rows 0049/0050 carry names from the manual Management-API applications of earlier sessions ('expire_pending_approvals_fix', 'chat_read_receipts' ×2) that differ from the local filenames — the underlying SQL is verified functionally present (checks C2–C6); recorded here so the next agent does not misread it as drift.
- **Desktop** (Electron/React): the payment write paths are now single-atomic-RPC only (T-011/T-012/T-013 — the silent fallback family is gone), the refund flow exists end-to-end (T-014), homework/roll-call persistence is fixed (T-023), payment preview ≡ collection + batch discount inputs (T-060); the `expenses` repository is Supabase-backed (T-093); the overdue-scan is live-VERIFIED (T-094). 57 files / 2091 tests ALL PASS (2086 + 5 skipped); lint 0 errors.
- **Android** (Kotlin/Compose): unchanged this session (219/219 from session 5). The SDK bootstrap is IMPOSSIBLE in this container (dl.google.com 404s commandlinetools) — Android tasks need an SDK-equipped host.
- **Website** (Next.js parent portal): realtime layer repaired (T-032); ledger replay pages the FULL ledger (T-035); freshness fallback active (T-033 — refetchOnWindowFocus + 5-min interval); migration copies REMOVED (T-048 — the desktop repo owns the only chain). Suite 122/122; strict build green; lint clean.
- Desktop homework + roll-call persistence FIXED (T-023, live 7/7); year-end promotion is UNBLOCKED server-side (T-025/0057 — histories writable) but the desktop flow itself remains unimplemented (T-041: `promote()` still "not implemented", dead SQL `promote_students` RPC still present). Android homework UUID defect remains (T-024). The run-overdue-scan EF still cannot complete (BUG-NEW-004 → T-095).

## 2. Major known problems (top of the risk stack)

167 total problems after the 2026-08-31 eleventh session (+BUG-NEW-004 registered by session-12 closeout; 16 more flipped: 15 TESTED + SEC-109 VERIFIED). The most dangerous remaining:
1. ~~`SEC-100`~~ **FIXED 2026-08-29 (T-001)** — desktop credentials removed.
2. ~~`SEC-101`/`SEC-102`~~ **FIXED 2026-08-29 (T-002)** — Android auth fail-closed.
3. ~~`BUSINESS-002`~~ **FIXED 2026-08-31 (T-011)** — single atomic path only.
4. ~~`CROSS-200`~~ **FIXED 2026-08-29 (T-019)** — Android sync surfaces 4xx/5xx.
5. ~~`TENANT-100`/`TENANT-101`~~ **FIXED 2026-08-31 (0053 reconciliation)** — tenant-scoped resolvers live.
6. ~~`ARCH-006`~~ **FIXED 2026-08-30 (T-080)** — `SupabaseOverdueAlertGenerator` wired into the assembly (8-test unit suite). Live integration = T-094.
7. ~~`ARCH-010`~~ **FIXED 2026-08-30 (T-088 + T-089)** — dashboard restructured (10-test regression suite); 4 hardcoded KPIs backfilled against real data.
8. ~~`ARCH-009`~~ **MITIGATED 2026-08-30 (T-091)** — `0051_chat_read_receipts.sql` added + applied live + registered in schema_migrations.
9. ~~`DATA-007`~~ **FIXED 2026-08-30 (T-087)** — test residue dropped via migration 0052 + test auth user + approval request deleted.
10. **`DRIFT-013` (NEW 2026-08-30)** — desktop code calls `.from("expenses")` but the canonical table is `expense_tickets` (with different status values). Dashboard KPI mitigated; wider port = T-093.

## 3. Source-of-truth decisions in force

Canonical writers = SQL RPCs; desktop TS engine = reference; deterministic identity codes; server-authoritative receipt numbers (ADR-002/003/004, Accepted). Android's target write architecture (ADR-005) and the single-equivalence-framework consolidation (ADR-006) are **Proposed** — direction set, implementation not started.

## 4. Active migrations

**0001–0057 — ALL applied + registered (verified 2026-08-31, session-12 opening diff 12/12).** Session-11 addition: **0057_canonical_tenant_resolver.sql** (T-025 — inert policies dropped, histories staff policy, orphan assessments RAISE, fn_current_tenant_id gone). Session-10 additions:
- **0053_tenant_scoped_rbac.sql** — RECONCILIATION (ARCH-011): captures the T-005 SQL that was applied live but never committed (is_global_admin, tenant-scoped resolvers, tenants_*/user_profiles_admin_update re-scoping).
- **0054_auth_trigger_no_client_metadata.sql** — RECONCILIATION (ARCH-011): captures the T-007 handle_new_auth_user rewrite.
- **0055_sec_definer_rpc_hardening.sql (T-006)** — applied live + registered; verified by scripts/verify_t-006.sql (9/9).
- **0056_expense_tickets_payee.sql (T-093)** — applied live + registered; payee column confirmed via information_schema.

Historical note: migrations 0034–0043 were a 10-migration fix-up chain after the "unification" of 0026–0028 (REG-001) — treat the chain as append-only from here.

## 5. Completed recovery work (most recent first)

- **2026-08-31 — Eleventh repair session (T-011, T-012, T-013, T-014, T-023, T-025, T-068→VERIFIED, T-033, T-048, T-060):** owner-requested 10-task batch. The silent-fallback family eliminated from all desktop payment write paths; the refund flow implemented (UI + reason/actor propagation); homework + roll-call persistence fixed (live 7/7); migration 0057 applied live (canonical tenant resolver, histories writable — T-041 unblocked); EF permission resolution fixed + live-verified (SEC-109 → VERIFIED; BUG-NEW-004 discovered → T-095); website freshness fallback; migration chain unified across all three repos (client copies removed); payment preview ≡ collection + batch discount inputs. Registry sweep + this snapshot by session 12's opening (the 11th session ran out of context mid-closeout — its code was complete and pushed).
- **2026-08-31 — Tenth repair session (MIG-TOKENS, T-006, T-008, T-093, T-094, T-032, T-035, T-056):** owner-requested ~10-task batch with live Supabase credentials. (1) 0053/0054 live-drift reconciled (ARCH-011). (2) Migration 0055 applied live + registered — SEC-110/111/112 closed with a 9/9 live verification. (3) approve-signup-request redeployed (SEC-107). (4) Migration 0056 + SupabaseExpenseRepository (DRIFT-013 closed; WEAK-030 registered as the open follow-up). (5) T-094 live integration → ARCH-006 VERIFIED. (6) Website realtime + ledger paging + hygiene (suite 105→119). (7) Desktop hygiene batch 6/6. T-020 not attempted (SDK un-downloadable — documented).
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

- Desktop: 57 files / 2091 tests ALL PASS (+8 files, +38 tests vs session 10). Lint 0 errors / 357 baseline warnings.
- Android: 219/219 (unchanged — no SDK in this container).
- Website: 11 files / 122 tests ALL PASS (+3). Strict build green; lint clean.
- Live Supabase: migrations 0001–0057 all applied + registered (session-12 opening: version sets one-to-one, functional checks 12/12); 12 canonical EFs deployed ACTIVE (workflow-execute + run-overdue-scan redeployed with the T-068 user-scoped permission resolution); overdue-scan desktop generator live-verified (T-094). 1 auth user (`admin@elimtiyaz.dz`). Verification scripts persisted under `elimtiyaz-desktop/scripts/`.

## 9. Known cross-platform divergences (summary)

Payment write paths ×3, receipt numbering ×5 algorithms, overdue rule ×3 variants, attendance rate ×2 formulas, notification unread counts ×3 behaviours, freshness models ×3 (seed-once / 15-min pull / realtime+30s), sign-out semantics ×3. NEW this session: DRIFT-013 — desktop code calls `.from("expenses")` but the canonical table is `expense_tickets` (with different status values). Full list: `problem-registry.md` (CROSS-*, DRIFT-*, WEAK-019, DRIFT-013).

## 10. Known dead / obsolete code (summary)

Payment EFs never invoked (`DEAD-016`), desktop refund path unreachable (`DEAD-015`), legacy `homework_assignments` table + subscriptions (`WEAK-016`), dead SQL `promote_students` RPC (`ACAD-100`), `parent_student_links` table with zero writers (`DEAD-200`), unused canonical-port files on the website (`DRIFT-009`), legacy Android Room cache layer + design system (`DUP-005`, `DUP-003/004`), orphaned `receipts` table (`CROSS-101`). NEW this session: dead "PDF" report badge removed from the Reports tab (T-088); dead bottom Stat card removed from the Overview tab (T-088); dead auto-run `repos.overdueAlerts.run()` removed from `dashboard-page.tsx` (T-080); dead `_eq_test_fn` / `_eq_test_fn2` RPCs dropped via migration 0052 (T-087).

## 11. Known unknowns

11 open questions block 13 problems — see `unknowns.md`. No agent may resolve them by assumption.
