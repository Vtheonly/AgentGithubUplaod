# Testing Strategy

> How the El-Imtiyaz system is tested today and how it must be tested during recovery. Business-critical functionality (payments, balances, refunds, promotion, attendance) gets the strongest guarantees. A change without its required test is not done (`definition-of-done.md`).

## 1. Current inventory (what exists)

| Layer | Desktop | Android | Website |
|---|---|---|---|
| Unit tests | vitest suites (`npm test`) incl. ~80 financial-test files, domain calc, repositories (mock + supabase via shims) | JUnit + Robolectric (`./gradlew test`) — engines, identity codes, mappers, session | vitest (`npm run test`) — 87 tests: formatting, dictionary, validation, status pills, `portal-derive` |
| Cross-platform equivalence | `financial-tests/equivalence/` (canonical corpus) + 3 competing frameworks (DUP-001 — to be consolidated, ADR-006) | `AndroidEquivalenceTest` (reads the desktop corpus — needs sibling checkout) | `portal-derive.test.ts` verifies the ported read-side computations |
| Integration / DB | equivalence-live (manual, live Supabase) | none against live backend | none (Supabase queries untested) |
| E2E / UI | none (component-level only) | screenshot test (validates the WRONG legacy theme — absorbed in DUP-004) | none |
| API / contract | none | none | none |
| Migration-level | none (no fresh-schema test) | n/a | n/a |

Known gaps registered as problems: missing `src/test/setup.ts` (DEAD-012), `ignoreBuildErrors: true` (ARCH-005), stale Kotlin mirror used by Tier-4 tests (DUP-002).

## 2. Required test types per change class

| Change class | Mandatory tests |
|---|---|
| Financial mutation (collect/refund/clear/bounce, RPC or client path) | (a) unit tests of the changed path; (b) regression test reproducing the defect; (c) cross-platform equivalence case; (d) audit-entry assertion (actor + reason + before/after) |
| Financial read-side (balances, overdue, waterfall preview, reconcile) | canonical-engine unit test + equivalence across desktop/SQL/Kotlin/website |
| Schema / migration | fresh-schema test: apply the FULL canonical chain to an empty database and assert the new state; migration-level test for the specific change (e.g. two-tenant isolation for T-005) |
| RLS / security policy | policy test per affected role × tenant matrix (allow/deny), including the attack case from the problem entry |
| Edge Function | auth matrix test (anonymous / wrong role / correct role / correct permission) + happy path + audit assertion |
| Sync (desktop or Android) | queued-entry lifecycle test (pending → pushed/failed with lastError) + rejected-write test (server 4xx/5xx must NOT be marked synced) |
| Academic (attendance, grades, promotion, homework) | write→read integration across platforms (desktop write appears on website/Android), canonical-formula assertions |
| Website KPI/view | unit test asserting the canonical formula, plus a cross-view consistency test when multiple views show the same number |

## 3. Platform-specific strategy

### Desktop (`elimtiyaz-desktop`)
- `npm run typecheck`, `npm run lint`, `npm test` before every commit.
- Financial domain changes: run the equivalence suite; add the scenario to the corpus (single framework per ADR-006).
- Excel import changes: fixture-driven tests for chunk failure rollback (T-012 pattern).
- Electron-specific: `--no-sandbox` removal (T-010) requires a launch smoke test on a clean host.

### Android (`elimtiyaz-android`)
- `./gradlew lint` + `./gradlew test` (Robolectric for anything touching Android frameworks).
- Engine changes: extend `IdentityCodes`/`LedgerEngine` tests and the equivalence runner.
- Sync changes: fake-postgrest dispatcher tests asserting response-code handling (T-019 pattern).
- Room schema changes: `MigrationTestHelper` upgrade test; NEVER ship a bump without it (T-046).

### Website (`elimtiyaz-website`)
- `npm run lint` + `npm run test` + `npm run build` (with type errors NOT ignored — T-049).
- KPI changes: `portal-derive.test.ts` extended; view-level consistency tests.
- Realtime fixes: integration test against a live/dev Supabase (insert → invalidation → refetch).

### Backend (migrations + EFs, in this repo)
- Every migration ships with a fresh-schema assertion (chain applies cleanly; new objects exist; dropped objects gone).
- Every RLS change ships with a role×tenant matrix test.
- Every EF change ships with an auth-matrix test.

## 4. Regression policy

- Every fixed defect adds a test that **fails before the fix** (name it after the problem ID, e.g. `regression_SEC_105_anonymous_cron`).
- Bugs discovered during work are not "noted" — they become problem-registry entries with their own tests when fixed.

## 5. CI (target — not yet configured)

1. Desktop: typecheck + lint + test + equivalence.
2. Android: lint + test (+ equivalence when the corpus access is documented — ADR-006).
3. Website: lint + test + build (strict).
4. Migration check: no modification to existing files under `supabase/migrations/` (T-058).
5. Cross-platform equivalence report artifact per run.

Until CI exists, the agent performing a change runs the suites locally and records the output in the change-log entry.
