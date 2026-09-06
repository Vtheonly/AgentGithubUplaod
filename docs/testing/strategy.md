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

## 6. Live mobile-viewport UI verification (added T-207, 31st session, 2026-09-06)

For website UI/layout changes, DOM-geometry verification against a REAL
signed-in session beats eyeballing: every UI defect found in the 31st
session was measured, not guessed (documentElement.scrollWidth −
clientWidth per viewport; per-element getBoundingClientRect /
scrollWidth-vs-clientWidth for clipped containers).

**The harness recipe (re-runnable, ~10 min):**

1. **Seed a UI-TEST family in the live DB** (service-role SQL via the
   Management API — the T-147 convention): a tagged parent
   (`PAR-UI99`, notes `UI-TEST …`), 2 students, installments (mixed
   statuses incl. overdue/pending/partial), payments (cash + transfer —
   the transfer NEEDS `proof_path` or the 0045 trigger rejects it),
   ledger entries (`account_id` is the composite
   `parent:<uuid>:category:<cat>:student:<uuid>`, `entry_number` is free
   text), attendance (`justification_status` ∈ none/submitted/accepted/
   rejected, status ∈ present/late/absent_excused/absent_unexcused),
   homework (needs a REAL `class_id` + `subject_id` + `teacher_id` —
   personnel is empty on this project, create a tagged test row),
   calendar_events, notifications (kind ∈ alert/info/warning/success/
   error/system), a `direct` chat channel with `member_ids` ARRAY of
   profile UUIDs. **Every live check constraint was discovered by trial —
   see the schema columns + `pg_constraint` before inserting.**
2. **Create the test auth user via the admin API** (`email_confirm: true`)
   and UPDATE (never INSERT) the auto-created `user_profiles` row to
   `status='active'`, bind `parents.auth_user_id`, grant the `parent`
   role (`role_assignments.assigned_by`, NOT `granted_by`).
3. **Sign the browser in via the @supabase/ssr cookie**: password-grant
   via `POST /auth/v1/token?grant_type=password`, then
   `document.cookie = 'sb-<ref>-auth-token=' + encodeURIComponent(JSON.stringify(session))`.
   **localStorage does NOT work** — `createBrowserClient` from
   `@supabase/ssr` stores sessions in COOKIES, not localStorage (the
   31st session burned time on this).
4. **Measure at 320/375/768/1280** (matrix script pattern:
   `/home/z/my-project/scripts/t-206-viewport-matrix.sh`): assert
   document overflow = 0 for every view; probe per-element
   `scrollWidth > clientWidth` for clipped content; the Next.js dev-tools
   `<nextjs-portal>` overlay can COVER click points — remove it via
   `document.querySelectorAll('nextjs-portal').forEach(p => p.remove())`
   before interacting; Radix tabs respond to focus + Enter, not
   el.click().
5. **Clean up**: delete the UI-TEST rows BY TAG (audit_logs is
   append-only — leave the verification rows; see T-147 discovery 4).

**The two CSS rules behind every 31st-session UI defect (both now
source-scan-guarded on website + desktop):**

- **Responsive grids MUST declare a base `grid-cols-*`** (Tailwind
  `grid-cols-1` = `repeat(1, minmax(0, 1fr))`). A bare `grid gap-*` that
  only gains columns at a breakpoint leaves an implicit `minmax(auto,
  auto)` track below it — the track sizes to the item's MAX-CONTENT
  (`.truncate` does NOT constrain a grid track), so the page scrolls
  horizontally. Guards: website `t-199`, desktop `t-205`.
- **Intl currency output is UNBREAKABLE** (fr-XX groups digits with
  U+202F narrow no-break space, the pre-currency separator is U+00A0).
  Any surface rendering formatted money in a width-constrained box needs
  a `break-words`-class safety net + a size step for mobile — the
  FORMATTERS are parity-pinned and must never be changed for display
  reasons (the t-200 test enforces this on the website).
