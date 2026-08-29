# Current State — Project Snapshot (2026-08-29)

> Answers: "What is the state of the project RIGHT NOW?" Update this file whenever the recovery state materially changes. CURRENT facts only; targets live in `docs/architecture/system-map.md` §5 and in ADRs marked Proposed.

## 1. Architecture status

- Three repositories operate against **one Supabase backend** whose canonical schema is the desktop repo's migration chain 0001–0044 (ADR-001). Migrations 0001–0043 are committed and considered applied everywhere; **0044 (admin-created accounts, T-079) is committed but NOT yet applied to the live project** — its deployment (`supabase db push` + `functions deploy create-user-account`) is the task's remaining step.
- **Desktop** (Electron/React): functional as the staff operations app for CRM + financials + academics, with a partial Supabase migration — 26 of ~45 repository slots still run on mocks in "Supabase mode" (`ARCH-001`). Payment cache is seed-once with no refresh (`CROSS-104`). There is **no refund UI** (`DEAD-015`).
- **Android** (Kotlin/Compose): offline-first, Room-backed, fully functional locally, but its server write path bypasses every canonical financial RPC (`ARCH-003`, `CROSS-005`). Sync errors now SURFACE (CROSS-200 fixed 2026-08-29 — server-rejected writes stay pending and retry); authentication still has two Critical bypasses (`SEC-101`, `SEC-102`). The build/test gate is OPERATIONAL since 2026-08-29 (ARCH-007 fixed; JDK 17 + Android SDK 35 bootstrapped headlessly — recipe in change-log): baseline 207/207 unit tests incl. 45/45 equivalence scenarios.
- **Website** (Next.js parent portal): read paths work (balances, installments, attendance, bulletins) with some non-canonical KPIs; chat is permanently empty (`CHAT-103`); push notifications are non-functional end-to-end (`PUSH-100` family). The mock-admin authentication bypass was **removed 2026-08-29** (`SEC-007` fixed, T-009 — Google OAuth is the only auth path); the website test suite runs again (DEAD-012 unblocked). The build is now STRICT (`ARCH-005` fixed 2026-08-29, T-049): `ignoreBuildErrors:false` + `reactStrictMode:true`, tsc clean, and the typed Supabase client actually typechecks (the postgrest-js 2.x GenericSchema conformance defect that degraded every query to `never` was fixed — 38 row interfaces → type aliases + `Relationships: []` + the canonical `homework` table registered, WEAK-017's registration half).
- **Homework and desktop roll-call are broken end-to-end** (`HOMEWORK-100/101`, `ATT-100`); **year-end promotion fails on every platform** (`TENANT-106`, `STUDENT-100`, `BUSINESS-004`).

## 2. Major known problems (top of the risk stack)

- 24 Critical / 43 High problems are registered (148 total after the 2026-08-29 fifth session — ARCH-007 added; ARCH-005/DEAD-013/ARCH-007/CROSS-200 resolved). The five most dangerous:
  1. ~~`SEC-100` — desktop ships 9 staff credentials in the client bundle.~~ **FIXED 2026-08-29 (T-001, TESTED)** — literals removed; passwords still need rotation in deployed environments.
  2. `SEC-101`/`SEC-102` — any failed Android login yields a 24h SUPER_ADMIN session.
  3. `BUSINESS-002` — desktop payment collection silently degrades to a non-atomic path (no ledger/waterfall/audit) on any RPC failure.
  4. ~~`CROSS-200` — Android sync marks server-rejected writes as "synced"~~ **FIXED 2026-08-29 (T-019, TESTED)** — pushes propagate 4xx/5xx; entries stay pending with lastError and retry (live-dispatch round-trip still owed).
  5. `TENANT-100`/`TENANT-101` — the RBAC role resolver ignores tenants, making every per-tenant super_admin a global super_admin in several policies.

## 3. Source-of-truth decisions in force

Canonical writers = SQL RPCs; desktop TS engine = reference; deterministic identity codes; server-authoritative receipt numbers (ADR-002/003/004, Accepted). Android's target write architecture (ADR-005) and the single-equivalence-framework consolidation (ADR-006) are **Proposed** — direction set, implementation not started.

## 4. Active migrations

**0044_admin_created_accounts.sql (T-079)** — committed 2026-08-29, NOT yet applied to the live Supabase project (no environment access in the implementing session). Adds the `admin_create_user_account` RPC (EXECUTE service_role-only). Historical note: migrations 0034–0043 were a 10-migration fix-up chain after the "unification" of 0026–0028 (REG-001) — treat the chain as append-only from here.

## 5. Completed recovery work

- **2026-08-29 — Documentation reset & governance system (T-000, VERIFIED):** 56 legacy markdown files removed across the three repos; unified documentation + control system established (this tree); two audit passes consolidated into one 145-problem registry; task registry, unknowns, ADRs and workflows created. No application source code was modified.
- **2026-08-29 — T-000 amendment (VERIFIED):** both audit reports archived **verbatim** under `docs/audits/` (read-only evidence, with an index explaining the ID mapping to the registry); mandatory commit-content rule (task completed / what is left / what was changed / what was verified / next task) added to `AGENTS.md` §14, `docs/agents/git-workflow.md` and `docs/agents/workflow.md`.
- **Pre-existing (historical, from git history):** the 0034–0043 canonical-engine unification chain; migration 0042's overdue-rule alignment; migration 0043's absorption of the website's portal patches; the mock-auth default-on regression (REG-003, absorbed into SEC-007) was reverted in website commit `03f6365`.
- **2026-08-29 — First repair batch (T-001, T-009 TESTED; T-010 IMPLEMENTED):** (1) T-001 — the nine leaked desktop staff credentials removed from BOTH the login screen and the mock seed data; regression test guards the whole src tree (hub commits aa823d4, 9c038eb). (2) T-009 — the website mock-auth system deleted entirely; Google OAuth is the only auth path; regression tests pin that a planted `mock-auth-session` key yields no session (website commits 864eca6, a3062ee). Prerequisite: the missing `src/test/setup.ts` committed and the bare `test` .gitignore rule (DEAD-012's true root cause) removed — the website suite (90 tests) runs again. (3) T-010 — `--no-sandbox` removed from the desktop start script; host requirement documented (hub commit af655b1); sandboxed launch log still pending. New discovery registered: DEAD-201 — the desktop `npm run lint` gate has never been runnable (no ESLint config exists) → task T-078.
- **2026-08-29 — Second repair session (T-003 TESTED):** the desktop self-service password change now actually changes the password (SEC-103 resolved): `changePassword` added to the `AuthRepository` interface (typecheck enforces it on every implementation), the provider delegates to the repository's canonical implementation, and the `auth.password_change` audit entry is written only after the change really happened (was forged). 12-test regression suite + full suite 1969/1969 (hub commits 0700215, 9287595, 2e934ff). Session also verified T-002 (Android auth bypasses) is infeasible in a headless environment — no Android SDK/JDK — so the headless fallback order is T-004 → T-078 (see `next-task.md`).
- **2026-08-29 — Third repair session (T-079 — feature, client stack TESTED / backend IMPLEMENTED):** admin-created login accounts (owner request): a SuperAdmin provisions accounts for other users from the new Settings → Comptes tab (email, name, phone, one of 11 roles, optional initial password → one-time credentials card). Domain `UserAccountRepository` contract + Mock (mints into seedAccounts so created users sign in immediately) + Supabase (invokes the new `create-user-account` EF) implementations; `user_account.create` audit action; migration 0044 `admin_create_user_account` RPC (atomic activate + role-assign + approval-resolve, EXECUTE service_role-only) and the super_admin-only EF (SEC-107 lesson applied; app_metadata.tenant_id = the SEC-108 trusted admin path; password returned once, never stored/emailed/audited — SEC-100 lesson). 19-test regression suite (incl. the create → sign-in round-trip); full suite 1988/1988; typecheck clean. Commits d85d65a, 19ac460, 314a74e, aa841ee. Remaining: deploy 0044 + EF and run a live round-trip.
- **2026-08-29 — Fourth repair session (T-004 + T-078, both TESTED):** (1) T-004/SEC-105 — the four cron Edge Functions deny anonymous invocation: new shared guard `supabase/functions/_shared/cron-auth.ts` (Bearer CRON_SECRET or the service_role key = the managed scheduler's injection; everything else — including a MISSING Authorization header — gets a generic 401; constant-time compare); run-overdue-scan's manual user-JWT path preserved. RED→GREEN 19-test suite; full suite 2007/2007 (commits 112e2de, ee3394e, 9919b28). Deployment owed: `supabase secrets set CRON_SECRET=…` + redeploy + per-schedule header check; live curl matrix is the recorded gap. (2) T-078/DEAD-201 — the desktop `npm run lint` gate is OPERATIONAL for the first time: `eslint.config.js` authored (typescript-eslint recommended + react-hooks; rules-of-hooks = error), 3 missing devDeps installed, all 5 first-run errors fixed (incl. a REAL rules-of-hooks violation in permissions-step.tsx: `useRepositories()` inside the useObservable factory callback — React's ContextOnlyDispatcher silently tolerates it at runtime, the linter is the only guard), 307 warnings baselined with per-rule counts documented in the config (commit d4a0f19). New discovery: ARCH-006 — Supabase mode keeps `overdueAlerts` on the mock layer ("Scan retards" scans seed data, persists nothing server-side; the guarded EF has no live desktop caller) → T-080.
- The remaining problems are OPEN (119), BLOCKED (13), DEFERRED (5), PARTIAL (2: CROSS-100, DEAD-012), plus ARCH-006 OPEN (T-080).

## 6. Remaining high-risk work (recommended order)

Phase 0 security hotfixes (T-001…T-010) → financial integrity (T-011…T-018) → sync correctness (T-019…T-027) → account flows & realtime (T-028…T-035) → feature completion decisions (mostly blocked on unknowns) → architecture cleanup. See `task-registry.md`.

## 7. Blocked work

13 problems are BLOCKED, all on business/product decisions recorded in `unknowns.md` — most notably the activation-bind contract (`UNKNOWN-001`, blocks the EF consolidation), the Android write architecture confirmation (`UNKNOWN-002`, blocks the largest remediation), and the payment-EF gateway decision (`UNKNOWN-003`).

## 8. Current test coverage

- Desktop: vitest suites incl. cross-platform equivalence (`npm test` — 44 files / 2007 tests as of 2026-08-29), plus a working ESLint gate since T-078 (`npm run lint` — 0 errors, 307 documented-baseline warnings); ~80 financial-test files, but four competing frameworks (DUP-001) and a stale Kotlin mirror (DUP-002).
- Android: unit + Robolectric tests (`./gradlew test`); equivalence test requires the desktop repo as a sibling checkout.
- Website: 90 vitest tests across 6 files (2026-08-29: suite RESTORED — the missing setup file was committed and the bare `test` .gitignore rule hiding it removed; DEAD-012 partially resolved, full cleanup = T-049). The build still ignores TypeScript errors (`ARCH-005`), so "green" is weaker than it looks. Two pre-existing lint errors remain in dashboard/financial views (react-hooks/preserve-manual-memoization).
- No E2E, no API-contract tests, no migration-level fresh-schema tests, no cross-platform CI. Strategy defined in `docs/testing/strategy.md`.

## 9. Known cross-platform divergences (summary)

Payment write paths ×3, receipt numbering ×5 algorithms, overdue rule ×3 variants, attendance rate ×2 formulas, notification unread counts ×3 behaviours, freshness models ×3 (seed-once / 15-min pull / realtime+30s), sign-out semantics ×3. Full list: `problem-registry.md` (CROSS-*, DRIFT-*, WEAK-019).

## 10. Known dead / obsolete code (summary)

Payment EFs never invoked (`DEAD-016`), desktop refund path unreachable (`DEAD-015`), legacy `homework_assignments` table + subscriptions (`WEAK-016`), dead SQL `promote_students` RPC (`ACAD-100`), `parent_student_links` table with zero writers (`DEAD-200`), unused canonical-port files on the website (`DRIFT-009`), legacy Android Room cache layer + design system (`DUP-005`, `DUP-003/004`), orphaned `receipts` table (`CROSS-101`). Removal requires the reachability checks in `recovery-rules.md`.

## 11. Known unknowns

11 open questions block 13 problems — see `unknowns.md`. No agent may resolve them by assumption.
