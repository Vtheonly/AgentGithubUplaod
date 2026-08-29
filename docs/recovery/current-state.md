# Current State — Project Snapshot (2026-08-29)

> Answers: "What is the state of the project RIGHT NOW?" Update this file whenever the recovery state materially changes. CURRENT facts only; targets live in `docs/architecture/system-map.md` §5 and in ADRs marked Proposed.

## 1. Architecture status

- Three repositories operate against **one Supabase backend** whose canonical schema is the desktop repo's migration chain 0001–0043 (ADR-001). No active migration work is in flight; all 40 migrations are committed and considered applied.
- **Desktop** (Electron/React): functional as the staff operations app for CRM + financials + academics, with a partial Supabase migration — 26 of ~45 repository slots still run on mocks in "Supabase mode" (`ARCH-001`). Payment cache is seed-once with no refresh (`CROSS-104`). There is **no refund UI** (`DEAD-015`).
- **Android** (Kotlin/Compose): offline-first, Room-backed, fully functional locally, but its server write path bypasses every canonical financial RPC (`ARCH-003`, `CROSS-005`) and swallows sync errors (`CROSS-200`). Authentication has two Critical bypasses (`SEC-101`, `SEC-102`).
- **Website** (Next.js parent portal): read paths work (balances, installments, attendance, bulletins) with some non-canonical KPIs; chat is permanently empty (`CHAT-103`); push notifications are non-functional end-to-end (`PUSH-100` family); a mock-admin authentication bypass is still wired (`SEC-007`).
- **Homework and desktop roll-call are broken end-to-end** (`HOMEWORK-100/101`, `ATT-100`); **year-end promotion fails on every platform** (`TENANT-106`, `STUDENT-100`, `BUSINESS-004`).

## 2. Major known problems (top of the risk stack)

- 24 Critical / 43 High problems are registered (145 total). The five most dangerous:
  1. `SEC-100` — desktop ships 9 staff credentials in the client bundle.
  2. `SEC-101`/`SEC-102` — any failed Android login yields a 24h SUPER_ADMIN session.
  3. `BUSINESS-002` — desktop payment collection silently degrades to a non-atomic path (no ledger/waterfall/audit) on any RPC failure.
  4. `CROSS-200` — Android sync marks server-rejected writes as "synced" (silent data loss).
  5. `TENANT-100`/`TENANT-101` — the RBAC role resolver ignores tenants, making every per-tenant super_admin a global super_admin in several policies.

## 3. Source-of-truth decisions in force

Canonical writers = SQL RPCs; desktop TS engine = reference; deterministic identity codes; server-authoritative receipt numbers (ADR-002/003/004, Accepted). Android's target write architecture (ADR-005) and the single-equivalence-framework consolidation (ADR-006) are **Proposed** — direction set, implementation not started.

## 4. Active migrations

None in flight. Historical note: migrations 0034–0043 were a 10-migration fix-up chain after the "unification" of 0026–0028 (REG-001) — treat the chain as settled and append-only from here.

## 5. Completed recovery work

- **2026-08-29 — Documentation reset & governance system (T-000, VERIFIED):** 56 legacy markdown files removed across the three repos; unified documentation + control system established (this tree); two audit passes consolidated into one 145-problem registry; task registry, unknowns, ADRs and workflows created. No application source code was modified.
- **2026-08-29 — T-000 amendment (VERIFIED):** both audit reports archived **verbatim** under `docs/audits/` (read-only evidence, with an index explaining the ID mapping to the registry); mandatory commit-content rule (task completed / what is left / what was changed / what was verified / next task) added to `AGENTS.md` §14, `docs/agents/git-workflow.md` and `docs/agents/workflow.md`.
- **Pre-existing (historical, from git history):** the 0034–0043 canonical-engine unification chain; migration 0042's overdue-rule alignment; migration 0043's absorption of the website's portal patches; the mock-auth default-on regression (REG-003, absorbed into SEC-007) was reverted in website commit `03f6365`.
- Nothing else has been fixed or verified since the audits. All 144 other problems remain OPEN (126), BLOCKED (13) or DEFERRED (5).

## 6. Remaining high-risk work (recommended order)

Phase 0 security hotfixes (T-001…T-010) → financial integrity (T-011…T-018) → sync correctness (T-019…T-027) → account flows & realtime (T-028…T-035) → feature completion decisions (mostly blocked on unknowns) → architecture cleanup. See `task-registry.md`.

## 7. Blocked work

13 problems are BLOCKED, all on business/product decisions recorded in `unknowns.md` — most notably the activation-bind contract (`UNKNOWN-001`, blocks the EF consolidation), the Android write architecture confirmation (`UNKNOWN-002`, blocks the largest remediation), and the payment-EF gateway decision (`UNKNOWN-003`).

## 8. Current test coverage

- Desktop: vitest suites incl. cross-platform equivalence (`npm test`), ~80 financial-test files, but four competing frameworks (DUP-001) and a stale Kotlin mirror (DUP-002).
- Android: unit + Robolectric tests (`./gradlew test`); equivalence test requires the desktop repo as a sibling checkout.
- Website: 87 vitest tests across 5 files — but `vitest.config.ts` references a missing setup file (`DEAD-012`), and the build ignores TypeScript errors (`ARCH-005`), so "green" is weaker than it looks.
- No E2E, no API-contract tests, no migration-level fresh-schema tests, no cross-platform CI. Strategy defined in `docs/testing/strategy.md`.

## 9. Known cross-platform divergences (summary)

Payment write paths ×3, receipt numbering ×5 algorithms, overdue rule ×3 variants, attendance rate ×2 formulas, notification unread counts ×3 behaviours, freshness models ×3 (seed-once / 15-min pull / realtime+30s), sign-out semantics ×3. Full list: `problem-registry.md` (CROSS-*, DRIFT-*, WEAK-019).

## 10. Known dead / obsolete code (summary)

Payment EFs never invoked (`DEAD-016`), desktop refund path unreachable (`DEAD-015`), legacy `homework_assignments` table + subscriptions (`WEAK-016`), dead SQL `promote_students` RPC (`ACAD-100`), `parent_student_links` table with zero writers (`DEAD-200`), unused canonical-port files on the website (`DRIFT-009`), legacy Android Room cache layer + design system (`DUP-005`, `DUP-003/004`), orphaned `receipts` table (`CROSS-101`). Removal requires the reachability checks in `recovery-rules.md`.

## 11. Known unknowns

11 open questions block 13 problems — see `unknowns.md`. No agent may resolve them by assumption.
