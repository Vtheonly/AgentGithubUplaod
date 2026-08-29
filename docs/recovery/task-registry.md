# Task Registry — Master Recovery Task List

> **This is the authoritative todo list for all remaining work.** Agents must not create separate task lists, TODO files, or progress notes anywhere. Status transitions follow `definition-of-done.md`; completion evidence goes to `change-log.md`.
>
> **Evidence base:** every task below was derived from the problem registry, which consolidates the two archived audit reports in [`docs/audits/`](../audits/README.md) (86 + 99 findings). When a task's problem entry is not detailed enough, read the raw finding in the audit files — full end-to-end traces and git forensics live there.
> **Commit rule (AGENTS.md §14):** every commit must state the task completed, what is left, what was changed, what was verified, and the next task.
>
> Statuses: `Not Started` · `Needs Investigation` · `Ready` (understood, dependencies cleared) · `In Progress` · `Blocked` · `Deferred`. Within `Ready`, work P0 → P1 → P2 → P3. Pick tasks via `next-task.md`.

## Progress summary (2026-08-29, updated after the sixth repair session — T-002)

| Status | Count | Tasks |
|---|---|---|
| **Completed (VERIFIED)** | 1 | T-000 |
| **Completed (TESTED)** | 10 | T-001, T-003, T-004, T-009, T-078, T-079 (regression-tested; live-environment verification pending — see change-log), T-081, T-019, T-049 (fifth session 2026-08-29), T-002 (sixth session 2026-08-29 — live sign-in matrix pending) |
| **Completed (IMPLEMENTED)** | 1 | T-010 (launch verification needs a desktop host) |
| **In Progress** | 0 | — |
| **Ready** (understood, dependencies cleared) | 56 | T-005…T-008, T-011…T-027, T-029…T-035, T-039…T-041, T-043, T-044, T-046, T-048…T-058, T-060…T-065, T-068, T-069, T-071, T-080, T-082 (new — Android lint-gate baseline, ARCH-008) |
| **Partially blocked** | 1 | T-036 (EF-internal fixes unblocked; wiring pending provider/scope decisions) |
| **Blocked** | 10 | T-028, T-037, T-038, T-042, T-045, T-059, T-066, T-067, T-070, T-072 — see `unknowns.md` |
| **Needs Investigation** | 1 | T-047 |
| **Deferred** | 5 | T-073…T-077 |

**Recommended next task:** T-005 — tenant-scoped RBAC resolver + admin policies (TENANT-100/101, P0 Critical, dependency-free): a new migration (0045+); SQL-level behaviour is fully specified in the problem entries; implementation + migration review are headless-feasible, with live two-tenant tests as the recorded gap (same pattern as T-004). Alternatives: T-082 (Android lint-gate baseline — restores the last inoperable AGENTS.md §6 gate, same pattern as T-078) for a low-risk client-side session; T-079's backend deploy + T-004's curl matrix + T-005's two-tenant tests can share one deployment when a live Supabase environment appears.

---

## Completed

### T-000 — Documentation reset & unified governance system
- **Problem IDs:** — (system-level; resolves WEAK-021)
- **Description:** Remove all 56 legacy `.md` files across the three repos; consolidate two audit passes (185 findings) into a 145-problem registry; establish this documentation/control system (AGENTS.md ×3, architecture, domain, ADR-001…007, recovery, testing, agents). Amendment (same day): archived both audit reports verbatim under `docs/audits/` and added the mandatory commit-content rule (Task/Left/Change/Verified/Next) to `AGENTS.md` §14 and `docs/agents/git-workflow.md`.
- **Priority:** P0 · **Severity:** — · **Dependencies:** none
- **Affected:** all three repos (documentation only)
- **Status:** VERIFIED (2026-08-29)
- **Required tests:** n/a (no code change)
- **Verification criteria:** file inventory shows zero legacy `.md`; IDs unique; cross-references valid — recorded in `change-log.md`.
- **Related ADRs:** ADR-007 · **Commits:** see change-log entry.

---

## Completed (beyond VERIFIED — evidence in change-log.md)

### T-001 — Remove hardcoded staff credentials from the desktop login screen
- **Problems:** SEC-100, CROSS-100 · **Priority:** P0 · **Severity:** Critical
- **Status:** TESTED (2026-08-29)
- **What was done:** DEMO_ACCOUNTS array + quick-fill UI deleted from `login-screen.tsx`; the same nine password literals removed from the mock layer's `seedAccounts` (mock sign-in now matches on email only — it is bypassed entirely when Supabase is configured); orphaned `auth.demoAccounts`/`auth.useAccount` i18n keys removed. Deviation from the task text (which named only login-screen.tsx) recorded: the task's own verification criterion (rg over src/) required cleaning seed-data.ts too.
- **Tests:** NEW `src/tests/security/no-demo-credentials.test.ts` — scans the whole src tree for the nine leaked literals; failed before the fix (login-screen.tsx + seed-data.ts flagged), passes after.
- **Verification:** `npx vitest run src/tests/security/no-demo-credentials.test.ts` 1/1 pass; `npm run typecheck` clean; `npm test` 41 files / 1957 tests ALL PASS; rg scan clean (only the test's own detection list). Gaps (why TESTED, not VERIFIED): live login with real accounts untested (no running environment); the nine passwords must still be ROTATED in every deployed environment (deployment action). `npm run lint` could not run — pre-existing defect, now registered as DEAD-201 / T-078.
- **Commits:** aa823d4 (failing test), 9c038eb (fix) — hub repo.

### T-009 — Remove the website mock-auth system
- **Problems:** SEC-007 (absorbs REG-003, DEAD-010) · **Priority:** P0 · **Severity:** Critical
- **Status:** TESTED (2026-08-29)
- **What was done:** `src/lib/auth/mock-auth.ts` deleted (278 lines); mock imports/hydration/signInWithMock/isMockSession/mock signOut branch removed from `auth-provider.tsx`; mock button + hint + 'or' divider removed from `login-screen.tsx`; `NEXT_PUBLIC_MOCK_AUTH_ENABLED` flag, `isMockAuthEnabled` export and stale comment block removed from `env.ts`; `auth.signin.mock/mockHint/or` keys removed from all three dictionary locales. Google OAuth is the only auth path. PREREQUISITE work included: missing `src/test/setup.ts` committed + the bare `test` .gitignore rule that silently hid it removed (DEAD-012 root cause corrected — see problem registry).
- **Tests:** NEW `src/app/providers/auth-provider.test.tsx` — 3 tests incl. planted `mock-auth-session` key → NO authenticated state (failed before: state 'active'); passes after.
- **Verification:** `npm run test` 6 files / 90 tests ALL PASS (was: total suite failure via DEAD-012); `npm run lint` — changed files clean (2 pre-existing errors in dashboard-view.tsx/financial-view.tsx remain, not introduced here); `npm run build` compiles successfully. Gap (why TESTED, not VERIFIED): real Google-OAuth round-trip needs a live backend.
- **Commits:** 864eca6 (tests + test-infra fix + .gitignore fix), a3062ee (removal) — website repo.

### T-010 — Remove --no-sandbox from the desktop start script
- **Problems:** ARCH-002 · **Priority:** P0 · **Severity:** Medium
- **Status:** IMPLEMENTED (2026-08-29 — launch verification pending)
- **What was done:** `--no-sandbox` removed from the `package.json` `start` script; host requirement (chrome-sandbox SUID helper `chown root:root && chmod 4755`, or `kernel.unprivileged_userns_clone=1`) documented in `electron/main.ts` with an explicit 'fix the host, not the flag' instruction.
- **Tests:** Launch on a clean host — NOT YET RUN (headless container cannot launch Electron; AGENTS.md §11 forbids it). Honest gap.
- **Verification:** rg 'no-sandbox' → only the explanatory comment remains; package.json still valid JSON; `npx tsc -p electron/tsconfig.json --noEmit` compiles clean. Advance to TESTED once a sandboxed launch log is recorded on a desktop host.
- **Commits:** af655b1 — hub repo.

### T-003 — Make desktop changePassword actually change the password
- **Problems:** SEC-103 · **Priority:** P0 · **Severity:** High
- **Status:** TESTED (2026-08-29)
- **What was done:** `changePassword` added to the `AuthRepository` domain interface with a documented contract (re-authenticate, persist via backend, revoke sessions — Ok means the password REALLY changed), making typecheck enforce it on every implementation; `AuthProvider.changePassword` now delegates to `repos.auth.changePassword` — the pre-existing canonical implementation in `SupabaseAuthRepository` (reused verbatim per the Existing-Implementation-First rule; its inline re-auth + `auth.updateUser` + global signOut now actually run). The audit entry is written ONLY after the repository returns Ok (previously forged); on failure the session is preserved and no audit entry is written; ERR_UNAUTHORIZED maps to the existing French "Mot de passe actuel incorrect." message; `AuditActions.AuthPasswordChange` constant added (wire value `auth.password_change` unchanged, matches Android). `MockAuthRepository` implements the method per post-T-001 mock semantics (non-empty current password + strength rules; Ok is a documented dev/demo no-op). Deviation from the problem entry's phrasing ("after re-authentication") recorded: re-authentication is DELEGATED to the repository, which already owns it as its first step — the provider's duplicate inline re-auth was removed rather than kept.
- **Tests:** NEW `src/tests/security/change-password.test.tsx` (12 tests) — includes the task's stated integration test (after a change the old password no longer signs in and the new one does), the delegation regression, audit-only-after-success with real-actor attribution, wrong-current-password error + session preserved, repository-failure surfacing, success clears local session, strength fast-fails, no-session refusal, and 4 mock compliance tests. RED state recorded: 8 failed | 4 passed before the fix (commit 9287595).
- **Verification:** `npx vitest run src/tests/security/change-password.test.tsx` 12/12 pass after the fix; `npm run typecheck` clean (also proves both implementations satisfy the extended interface); `npm test` 42 files / 1969 tests ALL PASS (was 41/1957). Gap (why TESTED, not VERIFIED): live round-trip against a real Supabase project from a running desktop build — needs a desktop host + configured backend. `npm run lint` could not run — pre-existing defect DEAD-201 / T-078.
- **Commits:** 9287595 (failing regression tests), 2e934ff (fix), 0700215 (registry checkout) — hub repo.

---

### T-004 — Require authentication on the four cron Edge Functions
- **Problems:** SEC-105 · **Priority:** P0 · **Severity:** High
- **Status:** TESTED (2026-08-29, fourth repair session)
- **What was done:** NEW shared guard `supabase/functions/_shared/cron-auth.ts` — pure decision core `isCronAuthorized(req, secrets)` (Deno-free so the desktop vitest suite imports it directly; constant-time comparison; generic 401) + Deno wrapper `isCronInvocation(req)` reading `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`. All four cron EFs wired: `expire-pending-approvals`, `refresh-materialized-views`, `purge-expired-backups` (deny-by-default 401, then GET/POST allowed) and `run-overdue-scan` (`isCron = isCronInvocation(req)` instead of `!authHeader`; the manual user-JWT path with `extractAuthContext` + `view_financials` + tenant filter preserved verbatim; anonymous → 401). Authorised callers: `Authorization: Bearer <CRON_SECRET>` (operator secret) or the project's service_role key (Supabase's managed config.toml scheduler injects it; possession already grants full DB access, so no new exposure). All four SECURITY header blocks rewritten with deployment notes. Deviation from the task text recorded: the task named "verify a CRON_SECRET bearer token (or Supabase cron signature)" — the service_role-key acceptance IS the internal-invocation branch and keeps the managed scheduler working without operator changes; a headerless-scheduler operator MUST add the CRON_SECRET header to its SQL cron call (documented in each EF header + change-log).
- **Tests:** NEW `src/tests/security/cron-auth.test.ts` (19 tests) — RED first (commit ee3394e: import-resolution failure before the guard existed), 10 unit tests of the decision core (anonymous/empty Bearer/non-Bearer/wrong secret/unset CRON_SECRET denied; valid CRON_SECRET and service_role accepted; prefix-sharing and JWT-like tokens denied) + source scans asserting each EF imports/uses `isCronInvocation` and the vulnerable patterns (`const isCron = !authHeader`, "No JWT required (cron invocation)", "Allow only cron (no auth)") are gone.
- **Verification:** `npx vitest run src/tests/security/cron-auth.test.ts` 19/19 PASS; `npm run typecheck` clean (also type-checks the new EF module via the test import); `npm test` 44 files / 2007 tests ALL PASS (was 43/1988); `npx esbuild` syntax check OK on all 5 touched files; full diff reviewed. GAPS (why TESTED, not VERIFIED): live curl matrix (anonymous→401, wrong secret→401, valid secret→executes per EF) needs a deployed Supabase project; operator actions: `supabase secrets set CRON_SECRET=…` + ensure schedules send the expected header (run-overdue-scan's `verify_jwt=true` gateway would reject a CRON_SECRET header — use the managed scheduler or flip that setting deliberately). NEW DISCOVERY: ARCH-006 → T-080.
- **Commits:** 112e2de (registry checkout) · ee3394e (RED tests) · 9919b28 (fix, GREEN) — hub repo.

### T-078 — Author the missing desktop ESLint flat config (make `npm run lint` runnable)
- **Problems:** DEAD-201 · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-29, fourth repair session)
- **What was done:** `elimtiyaz-desktop/eslint.config.js` authored (flat, ESLint 9): typescript-eslint recommended over the desktop's own TS (src/ + electron/ + scripts/), react-hooks plugin (rules-of-hooks = **error**, exhaustive-deps = warn), Node+DOM globals, scoped ignores (supabase/** = Deno toolchain, financial-tests/** = dedicated suites, build output). Per-rule warn downgrades documented IN the config with real first-run counts — no rule silently disabled; the website's turn-everything-off config explicitly NOT used as the model (ARCH-005 defect pattern). devDeps added (were missing even for a config): eslint-plugin-react-hooks ^5.2.0, globals ^15.15.0, typescript-eslint 8.18.2 (the meta-package — only plugin+parser were installed before). First-run error triage (all 5 FIXED, none suppressed): (1) REAL react-hooks/rules-of-hooks violation — `useRepositories()` called inside the `useObservable` factory callback in `permissions-step.tsx` (survives at runtime only via React's ContextOnlyDispatcher tolerance); hoisted to the component top, matching every sibling onboarding step. (2) stale `eslint-disable-next-line jsx-a11y/img-redundant-alt` directive naming a rule not configured in this repo (expense-detail-drawer.tsx) — removed, the alt text is descriptive. (3–5) prefer-const ×3 (workflow-repository.ts, sync-indicator.tsx, supabase-repositories.test.ts) — mechanical let→const.
- **Tests:** gate-level, per the task's own definition: `npm run lint` executes with no config error. First run: 312 problems (5 errors, 307 warnings); after the 5 error fixes: 0 errors / 307 warnings, exit 0. The 307 warnings are the documented baseline (no-unused-vars 202, no-explicit-any 73, no-empty-function 21, react-hooks/exhaustive-deps 4, no-empty-object-type 2) — counts live in the config comments; a burn-down task is a candidate for the next session's registry work (the 4 exhaustive-deps findings are the most defect-like and deserve individual review).
- **Verification:** `npm run lint` 0 errors / 307 warnings; `npm run typecheck` clean; `npm test` 44 files / 2007 tests ALL PASS; full diff reviewed; package-lock diff limited to the three added devDeps.
- **Commits:** d4a0f19 (config + deps + 5 error fixes) — hub repo.

## In Progress

*(none — the sixth repair session (2026-08-29) completed T-002 (TESTED) and closed CROSS-100's Android half; evidence in change-log.md.)*

## Completed (fifth repair session — 2026-08-29)

### T-081 — Restore the Android build at HEAD (re-open the `./gradlew` verification gate)
- **Problems:** ARCH-007 (new — discovered 2026-08-29 while bootstrapping an Android build environment) · **Priority:** P0 · **Severity:** High
- **Status:** TESTED (2026-08-29, fifth repair session)
- **What was done:** four distinct compile errors fixed plus the equivalence-harness path resolution: (1) `ClassesDirectoryViewModel.kt` — constructor param `sessionManager` promoted to `private val` (the `canPromote` getter referenced it); (2) `AppNavHost.kt` — missing `PromotionReviewScreen` import added; (3) `SyncQueueDispatcher.kt` pushGrade — `Double? ?: JsonNull` inferred `Any` (no `put` overload) → values wrapped in `JsonPrimitive` so the elvis branch yields `JsonElement` (JSON null when absent — original intent); (4) `PricingCalculationTest.kt` — `assertEquals(Double?, Double?, Double)` matched no JUnit overload → `explicit!!`/`default!!` non-null assertions. PLUS `AndroidEquivalenceTest.resolve()` now probes the sibling hub checkout (`../AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence/scenarios`) and a standalone desktop sibling — the previous probe list (module dir + repo root only) never matched the real three-repo layout, so the equivalence suite aborted in EVERY documented checkout. `.gitignore` now excludes the generated `app/financial-tests/` runner output. Deviation from the task text: the task named 2 errors; the compiler surfaced 4 (the 3rd/4th only reachable once the first stopped masking them) plus the equivalence-path defect — all are facets of "HEAD does not compile / the gate is broken" and are recorded in ARCH-007.
- **Tests:** `./gradlew :app:compileDebugUnitTestKotlin` BUILD SUCCESSFUL; `./gradlew :app:testDebugUnitTest` BUILD SUCCESSFUL — **202 tests / 0 failures / 0 errors / 0 skipped** (new Android baseline), including the 45-scenario canonical equivalence suite running GREEN for the first time in this repo.
- **Verification:** evidence in change-log (fifth session). The equivalence results JSON files were spot-checked (engine=android, canonical waterfall/allocation outputs).
- **Commits:** e7937de — android repo.

### T-019 — Surface Android sync RPC errors
- **Problems:** CROSS-200 · **Priority:** P1 · **Severity:** Critical
- **Status:** TESTED (2026-08-29, fifth repair session)
- **What was done:** NEW `NetworkTimeouts.guardSyncPush` — the push-oriented counterpart of `guard` that PROPAGATES block exceptions (incl. the SDK's `PostgrestRestException`) and converts `TimeoutCancellationException` into a plain `SyncPushTimeoutException` (RuntimeException, so the drain loop records a retryable failure and coroutine-cancellation semantics stay untouched); `onlyIfConfigured` test seam mirrors `guard`'s existing parameter. All 8 dispatcher push paths (homework, parent, student, payment, ledger_entry, installment, grade, attendance) switched from the swallowing `guard<Unit>` to `guardSyncPush`. `SyncService.drainPending` UNCHANGED — its `catch (Exception)` already implements the desktop `defaultPushHandler` contract (attempts+1 → pending with lastError + backoff; audit + failed at maxAttempts) — it simply never saw failures before. ROOT CAUSE CORRECTED (recorded in the problem entry): supabase-kt 3.1.1 DOES throw `PostgrestRestException` on 4xx/5xx (verified in the pinned artifact's bytecode: `SupabaseApi.rawRequest` checks `!status.isSuccess() && parseErrorResponse != null`; Postgrest wires `parseErrorResponse`); the real swallowing layer was `guard`'s `catch (Throwable) → null`, not a missing SDK throw. The registry's original description ("the SDK returns an HttpResponse and doesn't throw") does not hold for the pinned version.
- **Tests:** NEW `SyncErrorSurfacingTest` (5 tests): guardSyncPush success/propagation/timeout contracts + source-scan pins (no `NetworkTimeouts.guard` left in the dispatcher; all 8 pushes on guardSyncPush; no catch-Throwable inside guardSyncPush).
- **Verification:** `./gradlew :app:testDebugUnitTest` — **207 tests / 0 failures** (202 baseline + 5 new); equivalence suite green. GAP (why TESTED, not VERIFIED): a live 400/500 round-trip against a deployed `upsert_*_from_import` RPC needs a real Supabase project (same recorded-gap pattern as T-004's curl matrix).
- **Commits:** (T-019 commit) — android repo.
- **NEW DISCOVERY registered:** `.env.example` placeholder values (`https://YOUR_PROJECT.supabase.co`, `your-anon-key-here`) PASS `NetworkTimeouts.isSupabaseConfigured` (the hyphen-based checks miss `YOUR_PROJECT`'s underscore and `your-anon-key-here` ≠ `your-anon-key`) — a unit-test build therefore reports "configured". Recorded as a note on SEC-005/T-064.

### T-049 — Website build hygiene
- **Problems:** ARCH-005, DEAD-013 (plus WEAK-017's homework-table registration) · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-29, fifth repair session)
- **What was done:** `next.config.ts` — `ignoreBuildErrors: false`, `reactStrictMode: true`; `tsconfig.json` excludes `supabase/` (Deno EFs, 9 false positives); `package.json` icons:generate path repo-relative (DEAD-013). All 86 surfaced errors fixed: (1) **the deep one** — postgrest-js 2.x `GenericTable`/`GenericView` require `Relationships` on every table/view AND an index-signature-compatible `Row`; all 38 row shapes were `interface`s (no implicit index signatures), so `Database['public']` never satisfied `GenericSchema`, `Schema` resolved to `never`, and EVERY typed supabase query degraded to never payloads — fixed by converting the 38 interfaces to type aliases (matching what `supabase gen types` emits) and adding `Relationships: []` to the 34 tables + 4 views; (2) canonical `homework` table registered in the Tables map (WEAK-017's registration half — it was queried but untyped, and two REAL masked bugs fell out: `tone="muted"` not in KpiCard's Tone union, and `primary_phone` nullable-send at a NOT NULL column); (3) `StudentDocumentRow` nullability aligned with 0005_crm.sql; (4) `SubjectRow` extended with 0029's `passing_grade`/`is_extracurricular`; (5) 45 earlier duplicate keys removed from dictionary.ts (last-occurrence-wins runtime semantics preserved); (6) pricing barrel (`calc/pricing/index.ts`) ported verbatim from the desktop (charges.ts imported a non-existent module); (7) individual fixes: financial-view tone `muted`→`default`, academic-view term-filter state typed as the string union Radix actually delivers, messages-view dead `channel_type === "convocation"` comparison removed (canonical check constraint forbids the value; name-based detection kept) + `supabase` captured locally for closure narrowing, parent-contact-edit-card NOT NULL `primary_phone` no longer falls back to null, bulletin null-safe grade rendering, use-realtime channel ref typed `RealtimeChannel`, portal-derive imports/casts, portal-derive.test unknown-wire-code cast.
- **Tests:** gate-level: `npx tsc --noEmit` → 0 errors in src/ (was 86 project-wide); `npm run build` → green WITH "Running TypeScript" — the first strict build in the repo's history; `npm run test` → 90/90; `npm run lint` → unchanged baseline (exactly the 2 pre-existing preserve-manual-memoization errors in dashboard-view.tsx + financial-view.tsx, verified identical at HEAD via git stash).
- **Verification:** evidence in change-log (fifth session). Runtime behaviour preserved everywhere (dedupe keeps last-wins; tone/convocation/primary_phone changes remove only provably-dead or provably-invalid paths).
- **Commits:** (T-049 commit) — website repo.

---

## Completed (sixth repair session — 2026-08-29)

### T-002 — Close Android authentication bypasses
- **Problems:** SEC-101, SEC-102, WEAK-101 (plus CROSS-100's Android half) · **Priority:** P0 · **Severity:** Critical
- **Status:** TESTED (2026-08-29, sixth repair session)
- **What was done:** (1) **SEC-101** — `signIn` is FAIL-CLOSED: a configured build + failed/empty sign-in returns `Result.Err` (the LoginViewModel already renders it); no session is ever minted from a failure. The demo fallback now exists ONLY via `AuthEnvironment.isDemoFallbackAllowed()` = unconfigured AND debug build; release without configuration fails closed. (2) **SEC-102** — ALL email-substring role inference deleted (signIn Stage 1 + Stage 2 + refreshSession's direct SUPER_ADMIN fallback); roles resolve EXCLUSIVELY from `role_assignments` via the canonical `current_user_roles()` RPC (migration 0003) through the pure `resolveRoleFromAssignments()` — first recognisable code wins, empty/unrecognisable → least-privilege SUPPORT_STAFF (mirrors the desktop reference client). (3) **WEAK-101** — `signIn`/`refreshSession` restore the SDK's REAL `UserSession` (`currentSessionOrNull()`); `Session.accessToken` = the real JWT, `refreshToken` + `expiresAt` (epoch-ms) from the SDK session; the pure `buildServerSession()` assembles it and never expands unknown roles to "all permissions" (empty-set fallback). The demo sandbox role is the FIXED `DEMO_SANDBOX_ROLE` (documented; its token is not a JWT and authenticates nowhere). (4) **CROSS-100 Android half** — the login screen's 9 demo-account chips + `fillDemoAccount()` removed (roles no longer derive from emails; the shared demo password never worked against a configured server; the sandbox works with any typed credentials).
- **Tests:** NEW `LocalAuthRepositoryTest` — 12 tests: fail-closed on configured-build failure (drives the real provider under Robolectric — every outcome is Err, no session); no demo session on unconfigured release; demo sandbox FIXED role with NO email inference ("finance.admin@" / "teacher@" sign-ins no longer yield FINANCIAL_OFFICER/TEACHER); role-resolution matrix (empty → support_staff; first-valid wins; legacy aliases; unrecognisable never escalates); buildServerSession real-JWT passthrough + no-assignments → support_staff defaults only (no MANAGE_SETTINGS/MANAGE_TENANTS/MANAGE_PERSONNEL); AuthEnvironment policy matrix; source-level guard against re-introducing email inference (T-001 technique).
- **Verification:** `./gradlew :app:testDebugUnitTest` BUILD SUCCESSFUL — **219 tests / 0 failures** (207 baseline + 12 new); `./gradlew :app:compileDebugKotlin` and `./gradlew :app:assembleDebug` green. GAP (why TESTED, not VERIFIED): live sign-in matrix (real wrong-password 401, role_assignments-backed session, server-side JWT validation) needs a live Supabase — same recorded-gap pattern as T-004/T-079. NEW DISCOVERY registered during verification: **ARCH-008** — `./gradlew :app:lintDebug` has never been green (315 pre-existing NewApi errors, no lint baseline ever existed) → T-082.
- **Commits:** 1aa34a7 (auth rework + tests), 89eec61 (CROSS-100 demo chips) — android repo.

---

## Ready

### Phase 0 — Security hotfixes (P0)

> T-001, T-009 and T-010 were completed by the 2026-08-29 batch session (see Completed above; evidence in change-log.md).

#### T-002 — Close Android authentication bypasses
- **Problems:** SEC-101, SEC-102, WEAK-101 · **Priority:** P0 · **Severity:** Critical
- **Description:** (1) Remove the Stage-2 offline fallback that grants a 24h session on ANY failed/empty Supabase login — fail closed (or restrict to debug builds with unconfigured Supabase only). (2) Delete email-substring role inference; resolve roles only from `role_assignments` with least-privilege fallback. (3) Store the real Supabase JWT in `Session.accessToken`, not the user UUID.
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** wrong password → failure (no session); signed-in user without role assignments → no staff UI; token validates server-side.
- **Verification:** all three behaviours covered by new unit tests; manual sign-in matrix documented in change-log.
- **ADRs:** —

#### T-004 — Require authentication on the four cron Edge Functions
- **Problems:** SEC-105 · **Priority:** P0 · **Severity:** High
- **Description:** `expire-pending-approvals`, `refresh-materialized-views`, `purge-expired-backups`, `run-overdue-scan` must verify a `CRON_SECRET` bearer token (or Supabase cron signature) before executing; deny anonymous requests.
- **Dependencies:** none (requires setting the secret in Supabase — deployment note) · **Affected:** D (functions) · **Platforms:** Backend
- **Tests:** anonymous POST → 401 for each EF; valid-secret POST executes.
- **Verification:** curl matrix recorded in change-log; secrets rotated post-merge.
- **ADRs:** —

#### T-005 — Scope the RBAC role resolver and admin RLS policies to tenants
- **Problems:** TENANT-100, TENANT-101 (absorbs TENANT-102) · **Priority:** P0 · **Severity:** Critical
- **Description:** New migration (0044+): filter `current_user_roles()`/`current_user_permissions()` by the caller's tenant; add tenant constraints to `user_profiles_admin_update` and the `tenants_*` policies (global admins = `tenant_id IS NULL` only).
- **Dependencies:** none (UNKNOWN-006 affects priority, not correctness) · **Affected:** D (migrations) · **Platforms:** Backend
- **Tests:** regression test with two tenants: tenant-A super_admin holds no roles in tenant B's context and cannot update tenant-B users or enumerate tenants.
- **Verification:** two-tenant test green; existing single-tenant flows unaffected.
- **ADRs:** —

#### T-006 — Verify callers and tenants in SECURITY DEFINER RPCs
- **Problems:** SEC-110 (absorbs STUDENT-101, PARENT-103), SEC-106, SEC-112, SEC-111 · **Priority:** P0 · **Severity:** High/Critical
- **Description:** New migration: (1) `bind_activation_code` asserts `p_auth_user_id = auth.uid()`, guards silent re-binding, writes an audit entry; (2) `register_fcm_token` asserts `p_user_id = auth.uid()`; (3) `revert_payment_allocation` verifies the payment's tenant matches the caller's; (4) `upsert_payment_from_import` either drops SECURITY DEFINER or validates `p_tenant_id` against the caller.
- **Dependencies:** coordinate with ADR-002 (no behavioural change to the canonical algorithms) · **Affected:** D (migrations) · **Platforms:** Backend
- **Tests:** direct RPC calls with foreign user/tenant ids fail; legitimate flows still pass; audit entries appear.
- **Verification:** SQL-level tests on a fresh schema; no client regression.
- **ADRs:** ADR-002

#### T-007 — Stop handle_new_auth_user from trusting signup metadata
- **Problems:** SEC-108 · **Priority:** P0 · **Severity:** High
- **Description:** New migration: derive `tenant_id` from a trusted source (invitation/default) instead of `raw_app_meta_data`; hardcode `requested_role = 'parent'` for the self-signup path; ignore client-supplied staff roles.
- **Dependencies:** none · **Affected:** D (migrations) · **Platforms:** Backend
- **Tests:** signup with injected `tenant_id`/`requested_role` lands in the default tenant as parent-pending.
- **Verification:** trigger-level regression test.
- **ADRs:** —

#### T-008 — Constrain role assignment in approve-signup-request
- **Problems:** SEC-107, PARENT-102 · **Priority:** P0 · **Severity:** High
- **Description:** `assign_role` restricted to a safe subset (`parent`) for `support_staff`; staff roles require super_admin; validate that approve actions carry either `target_parent_id` or `create_new_parent=true` (no "active but unbound" users).
- **Dependencies:** none · **Affected:** D (functions) · **Platforms:** Backend
- **Tests:** support_staff→super_admin attempt returns 403; approval without target returns 400.
- **Verification:** EF test matrix in change-log.
- **ADRs:** —

#### T-071 — Tighten RLS INSERT policies for chat and notifications
- **Problems:** CHAT-100, CHAT-101, NOTIF-101 · **Priority:** P0 · **Severity:** Medium/High
- **Description:** New migration: `chat_channels_insert` requires creator ∈ member_ids and role-gates `announcement`; `chat_messages_insert` requires channel membership; `notifications_insert` requires staff role or self-targeting.
- **Dependencies:** none (independent of the chat product decision) · **Affected:** D (migrations) · **Platforms:** Backend
- **Tests:** policy-level tests: parent cannot create channels for arbitrary members, cannot post into non-member channels, cannot address notifications to other users.
- **Verification:** tests green; existing official flows unaffected.
- **ADRs:** —

#### T-080 — Port the desktop overdue-scan to Supabase (kill the mock leak in Supabase mode)
- **Problems:** ARCH-006 (new — discovered during T-004, 2026-08-29) · **Priority:** P2 · **Severity:** Medium
- **Description:** In Supabase mode the `overdueAlerts` slot stays on `MockOverdueAlertGenerator` (the Supabase assembly spreads `mockRepositories` and never overrides `overdueAlerts`), so the "Scan retards" button scans in-memory seed data and persists nothing server-side; the guarded `run-overdue-scan` EF (T-004) has no live desktop caller. Implement `SupabaseOverdueAlertGenerator` (canonical `compute_parent_summary` drill-down mirroring the EF logic) OR an EF-invocation wrapper using the signed-in user's JWT (manual path, `view_financials`), override the slot in the Supabase assembly, and regression-test both assemblies' contracts.
- **Dependencies:** none (backend path already secured by T-004) · **Affected:** D · **Platforms:** Desktop
- **Tests:** mock vs supabase assembly contract tests; seeded Supabase ledger → scan creates real notifications (integration needs a live backend for VERIFIED).
- **Verification:** regression tests + change-log evidence.
- **ADRs:** —

#### T-082 — Restore the Android lint gate (baseline or fix the NewApi backlog)
- **Problems:** ARCH-008 (new — discovered during T-002, 2026-08-29) · **Priority:** P1 · **Severity:** High
- **Description:** `./gradlew :app:lintDebug` aborts with 315 pre-existing errors / 112 warnings (dominant class: `NewApi` — java.time.* with minSdk 24 and no core-library desugaring; worst files LocalRepositories2.kt 216, DatabaseSeeder.kt 64, LocalRepositories.kt 60, LedgerEngine.kt 36, libs.versions.toml 120 via a different check). Follow the T-078 desktop precedent: (1) decide the desugaring question — enabling core-library desugaring genuinely fixes the NewApi class and is the correct long-term fix; (2) whichever path is chosen, create `app/lint-baseline.xml` pinning the remaining backlog to exact per-rule counts, documented in the build config like T-078 did; (3) fix any NEW findings the baseline surfaces (none should be suppressed silently).
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** `./gradlew :app:lintDebug` green with the baseline (or zero errors after desugaring); per-rule counts documented; the existing 219-test suite stays green.
- **Verification:** evidence in change-log.
- **ADRs:** —

### Phase 1 — Financial integrity (P1)

#### T-011 — Eliminate the silent collect() fallback
- **Problems:** BUSINESS-002 (absorbs BUSINESS-103, CROSS-105) · **Priority:** P1 · **Severity:** Critical
- **Description:** Remove the `upsert_payment_from_import` fallback in `SupabasePaymentRepository.collect()`; RPC failure surfaces an error and writes nothing. Single atomic path only.
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop, Backend
- **Tests:** simulated RPC failure → user-visible error, zero rows written, no success toast; success path unchanged (ledger+waterfall+audit present).
- **Verification:** regression tests + reconciliation run on a seeded ledger shows no `PAYMENT_WITHOUT_LEDGER_ENTRY` after failures.
- **ADRs:** ADR-002

#### T-012 — Make bulkCollect fail-fast
- **Problems:** BUSINESS-100 · **Priority:** P1 · **Severity:** Critical
- **Description:** `bulkCollect` collects chunk errors, aborts, and reports failing rows so the Excel import transaction rolls back completely (matching its own "no partial data applied" guarantee).
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop
- **Tests:** import containing one invalid payment → full rollback + row reported.
- **Verification:** test green; importer UI shows the failing row.
- **ADRs:** —

#### T-013 — Fix markClearedFallback audit and allocation cascade
- **Problems:** BUSINESS-101, BUSINESS-104 · **Priority:** P1 · **Severity:** High
- **Description:** The fallback writes the same audit entries as the canonical RPC (or is removed entirely — prefer removal if T-011 pattern applies), and aborts on the first installment error instead of cascading over-allocation.
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop
- **Tests:** clearance on pre-0039 deployment leaves audit entries; simulated installment failure aborts the whole clearance.
- **Verification:** tests green.
- **ADRs:** —

#### T-014 — Implement the desktop refund flow
- **Problems:** DEAD-015, BUSINESS-003 · **Priority:** P1 · **Severity:** Critical
- **Description:** Add a Refund action to `payment-detail-drawer.tsx` gated on `Permission.RefundPayment`, mandatory reason (≥3 chars) modal; `SupabasePaymentRepository.refund()` propagates the real actor identity and reason to `revert_payment_allocation`.
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop
- **Tests:** refund produces `payment.refund` audit entry with actor+reason; balances/installments revert; double-refund blocked.
- **Verification:** E2E-style integration test on seeded data.
- **ADRs:** ADR-002

#### T-015 — Consolidate receipt numbering to the server algorithm
- **Problems:** DRIFT-011 (absorbs BUSINESS-006, BUSINESS-105) · **Priority:** P1 · **Severity:** High
- **Description:** Remove the four client-side numbering paths (desktop fallback, bulkCollect, Android local, Android dispatcher fallback); every receipt number comes from the canonical RPC (ADR-004). Import paths obtain numbers server-side.
- **Dependencies:** T-011 (fallback removal) for the desktop side · **Affected:** D, A · **Platforms:** Desktop, Android, Backend
- **Tests:** concurrent collections produce consecutive unique `REC-YYYY-NNNNNN`; grep shows no client-side receipt formatting.
- **Verification:** concurrency test + grep evidence.
- **ADRs:** ADR-004

#### T-016 — Complete the reconciler (6 of 6 cross-checks)
- **Problems:** BUSINESS-001 · **Priority:** P1 · **Severity:** Critical
- **Description:** Wire `crossCheckBalanceSum` and `crossCheckParentCredit` into `reconcileFinancials()` (INV-9).
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop
- **Tests:** seeded ledgers with balance-sum mismatch and unbacked parent credit both produce violations.
- **Verification:** unit tests + equivalence run.
- **ADRs:** —

#### T-017 — Make Android refunds correct and idempotent
- **Problems:** BUSINESS-102, CROSS-102, CROSS-103 · **Priority:** P1 · **Severity:** High
- **Description:** Add the already-refunded guard; include the refund reason in the sync payload; enqueue installment state changes so the server converges (or route through `revert_payment_allocation` per ADR-005 once accepted — interim fix acceptable).
- **Dependencies:** T-019 (error surfacing must exist to trust sync outcomes) · **Affected:** A · **Platforms:** Android, Backend
- **Tests:** double-refund rejected; server audit contains reason; server installments match post-refund state.
- **Verification:** integration test against a fresh schema.
- **ADRs:** ADR-002, ADR-005

#### T-018 — Enforce deterministic identity codes everywhere
- **Problems:** DRIFT-001 (absorbs DEAD-001, DEAD-003, DEAD-005, DEAD-006, PARENT-100) · **Priority:** P1 · **Severity:** High
- **Description:** Replace all random/sequential generators with the canonical deterministic functions (mock repo, approve EF, `batch_register_family`, Android create/batch, dispatcher fallbacks); delete dead random exports.
- **Dependencies:** none · **Affected:** D, A, DB · **Platforms:** All
- **Tests:** identity tests per location; re-import/re-push creates no duplicates.
- **Verification:** cross-platform parent-code equivalence case green; grep clean.
- **ADRs:** ADR-003

### Phase 2 — Sync & data propagation (P1)

#### T-019 — Surface Android sync RPC errors
- **Problems:** CROSS-200 · **Priority:** P1 · **Severity:** Critical
- **Description:** Every `SyncQueueDispatcher.push*` reads the HTTP response and throws on 4xx/5xx; entries stay pending with `lastError`; SyncService marks them failed for retry (desktop contract).
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** server 400 → entry pending with error; success → synced.
- **Verification:** dispatcher unit tests with mocked 400/500 responses.
- **ADRs:** —

#### T-020 — Re-queue transient server errors on Android
- **Problems:** SYNC-103 · **Priority:** P1 · **Severity:** High
- **Description:** `SyncSupport.tryThenEnqueue` enqueues on 5xx (transient) in addition to network/offline/timeout; permanent errors (4xx validation, 401) still fail fast.
- **Dependencies:** T-019 · **Affected:** A · **Platforms:** Android
- **Tests:** 500 during deployment → mutation queued and retried successfully.
- **Verification:** test green.
- **ADRs:** —

#### T-021 — Honest Android sync completion semantics
- **Problems:** SYNC-106, SYNC-107 · **Priority:** P1 · **Severity:** Medium
- **Description:** `SyncWorker` returns `Result.retry()` on transient failure / `Result.failure()` on permanent; `SyncService.syncNow` becomes suspend and awaits the drain; UI reflects real completion.
- **Dependencies:** T-019 · **Affected:** A · **Platforms:** Android
- **Tests:** WorkManager retry path exercised; syncNow does not report success before completion.
- **Verification:** instrumented test.
- **ADRs:** —

#### T-022 — Desktop sync queue correctness
- **Problems:** SYNC-100, SYNC-101, SYNC-102, CACHE-102 · **Priority:** P1 · **Severity:** High
- **Description:** `defaultPushHandler` handles (or explicitly rejects) all 15 entity kinds — no silent no-ops; `sync_queue` rows accumulate attempt history instead of being overwritten; the queue is cleared/scoped per user on logout; the IndexedDB→memory fallback is surfaced to the UI.
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop
- **Tests:** each entity kind either pushes or errors visibly; two-user logout/login scenario; fallback-mode banner test.
- **Verification:** unit + integration tests.
- **ADRs:** —

#### T-023 — Fix desktop homework and roll-call persistence
- **Problems:** HOMEWORK-100, ATT-100 · **Priority:** P1 · **Severity:** Critical
- **Description:** Homework INSERT includes `tenant_id` (or the table gains a safe tenant trigger); roll-call upsert includes tenant_id + legacy `date` + matches a real unique index for `onConflict`; remove/replace the invocation of the non-existent `push-homework-notification` EF.
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop, Backend
- **Tests:** homework push persists and appears in the website's `useHomeworkForClass`; roll call persists and appears in `useAttendanceForStudent`.
- **Verification:** cross-client integration test.
- **ADRs:** —

#### T-024 — Fix Android homework id and promotion propagation
- **Problems:** HOMEWORK-101, STUDENT-100 · **Priority:** P1 · **Severity:** Critical
- **Description:** Android homework entities use real UUIDs (drop the `hwk-` prefix before upsert); promotion sync propagates `grade_level_code` (extend the RPC or use the direct update path).
- **Dependencies:** T-025 for the promotion server path · **Affected:** A · **Platforms:** Android, Backend
- **Tests:** homework push persists; promoted student's server-side grade advances and survives a pull sync.
- **Verification:** integration tests.
- **ADRs:** —

#### T-025 — Replace fn_current_tenant_id with the canonical resolver
- **Problems:** DEAD-100 (absorbs TENANT-105), TENANT-106 · **Priority:** P1 · **Severity:** Critical
- **Description:** New migration: rewrite the 0029-era policies and `set_assessments_tenant` trigger to use `current_tenant_id()`; drop `fn_current_tenant_id()`; `student_academic_histories` becomes accessible to tenant staff.
- **Dependencies:** none · **Affected:** D (migrations) · **Platforms:** Backend
- **Tests:** staff can select/upsert `student_academic_histories` for their tenant; cross-tenant denied; orphan assessment inserts FAIL (no DEMO fallback).
- **Verification:** migration-level tests on a fresh schema.
- **ADRs:** —

#### T-026 — Align the overdue rule on Android
- **Problems:** DRIFT-006, WEAK-007, BUSINESS-007 · **Priority:** P1 · **Severity:** Critical (WEAK-007 user-facing)
- **Description:** Android `computeParentSummary` uses the 0.001 DZD threshold + the due-date map (built via `buildOverdueDueDateMap` at every call site); `maxDaysOverdueFromLedger` measures from due dates, not creation dates.
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** seeded overdue ledger → non-zero "Créances en Retard" KPI; days-overdue matches desktop for the same ledger.
- **Verification:** equivalence case for overdue added and green.
- **ADRs:** ADR-002

#### T-027 — Canonical attendance rate everywhere
- **Problems:** WEAK-019 (absorbs ATT-102, GRADE-101) · **Priority:** P1 · **Severity:** Medium
- **Description:** Use `calculateAttendanceRate` ((present+late)/total) in website attendance-view, desktop narrative-generator-modal, and the bulletin "Présences" KPI (or relabel as raw counts).
- **Dependencies:** none · **Affected:** D, W · **Platforms:** Desktop, Website
- **Tests:** a student with 18 present + 2 late shows 100% in every view.
- **Verification:** cross-view consistency test.
- **ADRs:** —

### Phase 3 — Account flows, realtime & website correctness (P2)

#### T-028 — Consolidate the bind-activation-code Edge Function — **BLOCKED**
- **Problems:** CROSS-009 (absorbs BUSINESS-008, SEC-104), CROSS-004 · **Priority:** P1 · **Severity:** Critical
- **Description:** Keep exactly one EF (the desktop's shared-helper version), move the decided activation semantics into it (or into the SQL RPC), delete the website's standalone copy; one body-key contract for all clients.
- **Dependencies:** **BLOCKED by UNKNOWN-001** (does binding activate the user?) · **Affected:** D, W, DB · **Platforms:** All
- **Tests:** bind from desktop/Android/website produces identical server state + one audit entry.
- **Verification:** cross-client integration test.
- **ADRs:** —

#### T-029 — Guard approve_account_request re-binding
- **Problems:** PARENT-101 · **Priority:** P1 · **Severity:** High
- **Description:** The rebind block rejects parents already bound to a different user (or explicitly invalidates + audits the previous binding); `before_json` captures the old `auth_user_id`.
- **Dependencies:** none · **Affected:** D (migrations) · **Platforms:** Backend
- **Tests:** rebind attempt rejected or audited with old/new binding.
- **Verification:** SQL-level test.
- **ADRs:** —

#### T-030 — Fix sign-out and FCM token lifecycle
- **Problems:** SYNC-104, SYNC-105, PUSH-102 · **Priority:** P2 · **Severity:** Medium
- **Description:** Add `unregister_fcm_token(p_token)` RPC; Android signOut deactivates its token; website signOut uses `scope:"local"` and unregisters its token; `register_fcm_token` no longer silently reassigns shared-device tokens (audit + explicit transfer).
- **Dependencies:** none · **Affected:** A, W, DB · **Platforms:** Android, Website, Backend
- **Tests:** sign-out on each platform deactivates the device row; website sign-out does not kill the phone session.
- **Verification:** integration tests.
- **ADRs:** —

#### T-031 — Add the role gate to the parent self-update trigger
- **Problems:** SEC-008 · **Priority:** P1 · **Severity:** Critical
- **Description:** New migration: `enforce_parent_self_update_columns` fires its restriction only for `has_role('parent')` callers, so staff updates to parent identity fields work again.
- **Dependencies:** none · **Affected:** D (migrations) · **Platforms:** Backend, Desktop
- **Tests:** staff rename succeeds; parent self-update of `first_name` still raises.
- **Verification:** trigger tests; desktop parent-edit modal E2E.
- **ADRs:** —

#### T-032 — Repair the website realtime layer
- **Problems:** WEAK-016 (absorbs HOMEWORK-102), REALTIME-100, REALTIME-101 (absorbs CHAT-102), REALTIME-102, REALTIME-103 · **Priority:** P2 · **Severity:** High
- **Description:** Subscribe `useHomeworkRealtime` to canonical `homework` with `class_id`; fix the unread invalidation key to `["chat-unread-count"]`; add an RLS policy/RPC letting recipients append `read_by`; notifications subscription covers role-broadcasts (or a documented fallback poll); unread badge reacts to all channels.
- **Dependencies:** NOTIF-100 read-state model (UNKNOWN-007) affects the notifications filter portion — the homework/chat/read-receipt fixes are unblocked · **Affected:** W, D (RLS migration) · **Platforms:** Website, Backend
- **Tests:** insert into `homework` → portal refreshes; markRead persists; badge drops; role-broadcast appears without reload.
- **Verification:** live integration tests.
- **ADRs:** —

#### T-033 — Website freshness fallback
- **Problems:** CACHE-100 · **Priority:** P2 · **Severity:** Medium
- **Description:** Re-enable `refetchOnWindowFocus` (and/or a conservative refetchInterval) so a broken realtime hook degrades to stale-bounded data instead of stale-forever.
- **Dependencies:** T-032 · **Affected:** W · **Platforms:** Website
- **Tests:** with realtime disabled, data refreshes on focus.
- **Verification:** manual + hook test.
- **ADRs:** —

#### T-034 — Desktop cache refresh strategy
- **Problems:** CROSS-104 (absorbs CACHE-103), CROSS-104b · **Priority:** P2 · **Severity:** High
- **Description:** Supabase-backed desktop repositories gain realtime subscriptions (or an explicit refresh action + TTL) so cross-client writes are visible without restart; define the sync_queue audit-trail semantics shared with Android.
- **Dependencies:** design choice realtime-vs-poll documented in the task's change-log entry · **Affected:** D · **Platforms:** Desktop
- **Tests:** second client's write appears in an open desktop within the freshness budget.
- **Verification:** two-instance integration test.
- **ADRs:** —

#### T-035 — Website financial KPI correctness
- **Problems:** WEAK-018, WEAK-022 · **Priority:** P2 · **Severity:** Medium
- **Description:** Dashboard "next installment" uses `installmentRemainingAmount` (delete the dead import vs inline formula divergence); ledger fetch paginates beyond 500 entries so balance replay is complete.
- **Dependencies:** none · **Affected:** W · **Platforms:** Website
- **Tests:** parent with 600 ledger entries sees the correct balance; KPI matches financial-view.
- **Verification:** unit tests with generated ledger.
- **ADRs:** —

#### T-039 — Android pull-sync completeness
- **Problems:** HOMEWORK-103, NOTIF-105 · **Priority:** P2 · **Severity:** High
- **Description:** `pullAll` also pulls homework/attendance/assessments; notification pull filters by current user/role and evicts stale rows; batch upsert instead of per-row loop.
- **Dependencies:** T-023/T-024 (server must actually hold academic rows) · **Affected:** A · **Platforms:** Android
- **Tests:** desktop-created homework/attendance appears on Android within one sync cycle; role-changed user sees no stale broadcasts.
- **Verification:** cross-device integration test.
- **ADRs:** —

#### T-040 — Staff-side justification review workflow
- **Problems:** ATT-101 · **Priority:** P2 · **Severity:** High
- **Description:** Desktop attendance review lists `justification_status='submitted'` records with accept/reject actions writing the reviewer + timestamp; the website 4-state pill becomes fully reachable.
- **Dependencies:** T-023 (roll call must persist first) · **Affected:** D, W · **Platforms:** Desktop, Website
- **Tests:** parent submits → staff accepts → parent sees accepted.
- **Verification:** E2E flow test.
- **ADRs:** —

#### T-041 — Complete the year-end promotion flow
- **Problems:** ACAD-100, ACAD-101, BUSINESS-004 · **Priority:** P1 · **Severity:** Critical
- **Description:** Drop the dead SQL `promote_students` RPC (writes legacy table); make `setCurrentYear` an atomic RPC; implement `SupabaseStudentRepository.promote()` (currently "not implemented"); full batch promotion through `student_academic_histories`.
- **Dependencies:** T-025 (history table accessible) · **Affected:** D, DB · **Platforms:** Desktop, Backend
- **Tests:** full batch promotion on a fresh schema: grades advance, histories written, atomic; failure leaves no partial state.
- **Verification:** integration test + audit entries present.
- **ADRs:** —

### Phase 4 — Feature pipelines & cleanup (P2/P3)

#### T-036 — Rebuild the push notification pipeline — **partially blocked**
- **Problems:** PUSH-100 (absorbs WEAK-014, WEAK-015), PUSH-101, PUSH-103, PUSH-104 · **Priority:** P2 · **Severity:** Critical (feature dead)
- **Description:** Fix the EF internals (correct `user_id` column; PEM parsing via a proper library or correct BEGIN/END handling); wire one real invocation path (workflow `push_notification` action, notifications trigger, or staff action); Android reads `notification` payload fields + adds deep-link intent filter; website auto-registers FCM after first user gesture; decide email provider integration for workflow `send_email` (currently a stub).
- **Dependencies:** T-030 (token lifecycle) for the registration side; provider decision for send_email is a scoping question, not an unknown · **Affected:** D, A, W, DB · **Platforms:** All
- **Tests:** staff action → push arrives on a registered Android device + browser; workflow email sends or is explicitly disabled.
- **Verification:** live device test recorded.
- **ADRs:** —

#### T-037 — Decide and implement the chat feature — **BLOCKED**
- **Problems:** CHAT-103 (absorbs CHAT-105), CHAT-104 · **Priority:** P2 · **Severity:** High
- **Description:** Decide product scope (UNKNOWN-005). If built: channel-creation paths (staff↔parent, announcements), desktop Supabase chat repository (replacing the mock), `chat_channels.updated_at` touch trigger on message insert. If not built: remove the website MessagesView and the mock chat panel.
- **Dependencies:** **BLOCKED by UNKNOWN-005** · **Affected:** D, W, DB · **Platforms:** All
- **Tests:** per scope decision.
- **Verification:** per scope decision.
- **ADRs:** —

#### T-038 — Per-recipient notification read state — **BLOCKED**
- **Problems:** NOTIF-100, NOTIF-104 · **Priority:** P2 · **Severity:** Medium
- **Description:** Introduce `notification_reads` (or equivalent) so role-broadcasts are per-recipient read/dismissible; Android read-state syncs to the server.
- **Dependencies:** **BLOCKED by UNKNOWN-007** (read-state model), Android push scope (UNKNOWN-002) · **Affected:** D, A, W, DB · **Platforms:** All
- **Tests:** broadcast marked read per user; badge drops.
- **Verification:** cross-platform test.
- **ADRs:** —

#### T-042 — Timetable: complete or remove — **BLOCKED**
- **Problems:** SCHED-100, SCHED-101 · **Priority:** P3 · **Severity:** Medium
- **Description:** Decide (UNKNOWN-011): build the `timetable_entries` migration + Supabase repository + room-aware conflict detection, or remove the mock implementation and the coverage KPI.
- **Dependencies:** **BLOCKED by UNKNOWN-011** · **Affected:** D · **Platforms:** Desktop
- **Tests:** per decision.
- **Verification:** per decision.
- **ADRs:** —

#### T-043 — Consolidate the equivalence test frameworks
- **Problems:** DUP-001 (absorbs DEAD-004, CROSS-002, CROSS-008), DUP-002 · **Priority:** P2 · **Severity:** High
- **Description:** Per ADR-006: single framework (`financial-tests/equivalence/`), port unique scenarios, delete the other three trees and the stale `_tier4` mirror, document Android corpus access.
- **Dependencies:** none · **Affected:** D, A · **Platforms:** Desktop, Android
- **Tests:** consolidated suite green; unique-scenario coverage report shows nothing lost.
- **Verification:** `npm test` + `./gradlew test` (Android runner) green.
- **ADRs:** ADR-006

#### T-044 — Consolidate the Android design system
- **Problems:** DUP-003, DUP-004 (absorbs WEAK-013) · **Priority:** P3 · **Severity:** High (maintenance)
- **Description:** Migrate the 37 legacy-importing screens to `ui.designsystem.*`; delete the legacy components/theme; migrate the screenshot test to the production theme.
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** screenshot test against the production theme; zero `import com.example.ui.components` remaining.
- **Verification:** grep + tests green.
- **ADRs:** —

#### T-045 — Consolidate the Android Room layers — **BLOCKED**
- **Problems:** DUP-005 (absorbs DRIFT-008) · **Priority:** P2 · **Severity:** High
- **Description:** Merge the legacy cache-entity layer and the source-of-truth layer into one, with one KDoc truth statement; delete the other DAO/mapper pair.
- **Dependencies:** **BLOCKED by UNKNOWN-002 / ADR-005** (which layer survives depends on the target write architecture) · **Affected:** A · **Platforms:** Android
- **Tests:** no orphaned DAOs; all repositories compile against the surviving layer.
- **Verification:** build + full test suite.
- **ADRs:** ADR-005

#### T-046 — Android database migration discipline
- **Problems:** ARCH-004, REG-002 · **Priority:** P2 · **Severity:** High
- **Description:** Remove `fallbackToDestructiveMigration(true)` from the release build; every schema bump ships an explicit migration (schema-export review in the task's commit).
- **Dependencies:** T-045 recommended first (fewer entity layers to migrate) · **Affected:** A · **Platforms:** Android
- **Tests:** schema bump without migration fails the build/test; upgrade path v11→v12 preserves data.
- **Verification:** migration test with Room's MigrationTestHelper.
- **ADRs:** —

#### T-047 — Scope and complete the desktop Supabase repository migration — **Needs Investigation**
- **Problems:** ARCH-001 · **Priority:** P2 · **Severity:** Critical
- **Description:** Inventory the 26 mock-backed repository slots; classify each as (a) port to Supabase (used in production flows), (b) label as demo-only in the UI, or (c) remove. Port the (a) set module by module (chat handled by T-037).
- **Dependencies:** needs product scoping (which workforce/operations modules are actually used by the school) · **Affected:** D · **Platforms:** Desktop
- **Tests:** per ported module: persistence across restart + equivalence where financial.
- **Verification:** per module; statuses tracked here.
- **ADRs:** —

#### T-048 — Unify the migration chain
- **Problems:** CROSS-001 (absorbs CROSS-010), CROSS-003 (absorbs CROSS-007, ACAD-104) · **Priority:** P2 · **Severity:** Critical
- **Description:** Per ADR-001: remove the website's 0025–0028 files and the Android's six stale copies (content already canonical in the desktop chain); leave a pointer note (non-markdown or in AGENTS.md) in each repo.
- **Dependencies:** confirm no CI/deployment references the removed files · **Affected:** D, A, W · **Platforms:** All
- **Tests:** fresh-DB provisioning from the desktop chain alone passes the equivalence suites.
- **Verification:** provisioning test.
- **ADRs:** ADR-001

#### T-049 — Website build hygiene
- **Problems:** ARCH-005, DEAD-012, DEAD-013 · **Priority:** P2 · **Severity:** Medium
- **Description:** Set `typescript.ignoreBuildErrors: false` and fix resulting errors; enable `reactStrictMode` and fix surfaced issues; create the missing `src/test/setup.ts`; fix the `icons:generate` path to `./scripts/…`.
- **Dependencies:** none · **Affected:** W · **Platforms:** Website
- **Tests:** `next build` + `npm run test` green with checks enabled.
- **Verification:** CI run.
- **ADRs:** —

#### T-050 — Android connectivity & pull efficiency
- **Problems:** WEAK-009, SEC-006, CACHE-101, WEAK-010 · **Priority:** P2 · **Severity:** High
- **Description:** `OnlineDetector.isOnline()` incorporates probe results (fail closed on probe failure); probe targets the configured Supabase URL (not supabase.com/Google); single deduplicated `pullAll` trigger per cycle.
- **Dependencies:** none · **Affected:** A, D (desktop OnlineDetector probe target) · **Platforms:** Android, Desktop
- **Tests:** airplane mode → offline; flaky network → probe-informed state; pullAll fires once per tick.
- **Verification:** unit tests + battery/network sanity note.
- **ADRs:** —

#### T-051 — Android tenant stamping and audit identity
- **Problems:** WEAK-011 (absorbs TENANT-104), WEAK-012 · **Priority:** P1 · **Severity:** High
- **Description:** All local writes stamp the session's real tenant (no DEMO UUID); the audit helper captures actor role; the pull fallback selects include the tenant filter.
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** created rows carry the signed-in tenant; audit entries carry actor + role; fallback query is tenant-filtered.
- **Verification:** unit tests with a second tenant configured.
- **ADRs:** —

#### T-052 — Notification badge correctness (desktop + website)
- **Problems:** NOTIF-102, NOTIF-103 · **Priority:** P3 · **Severity:** Low
- **Description:** Desktop badge counts unread before the 8-item slice; website removes the dead bottom-nav query and un-caps the top-bar count (or uses a COUNT query).
- **Dependencies:** none · **Affected:** D, W · **Platforms:** Desktop, Website
- **Tests:** 50 unread → badge shows 50 (or "50+").
- **Verification:** unit tests.
- **ADRs:** —

#### T-053 — Desktop global-admin support
- **Problems:** TENANT-103 · **Priority:** P3 · **Severity:** Medium
- **Description:** `getTenantId()` stops falling back to the DEMO UUID: pre-login queries are suppressed; global admins get a tenant switcher or an explicit empty state.
- **Dependencies:** T-005 · **Affected:** D · **Platforms:** Desktop
- **Tests:** global admin sees an explicit state, not demo-tenant RLS denials.
- **Verification:** unit test.
- **ADRs:** —

#### T-054 — Android hollow implementations
- **Problems:** WEAK-006, WEAK-008 · **Priority:** P2 · **Severity:** Critical (WEAK-006 user-facing lie)
- **Description:** `regenerateForCycle` actually re-derives due dates (mirror the desktop implementation); `WorkflowRunEntity` gains a trigger column + mapping (no hardcoded "manual").
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** regenerate changes installment dates; trigger labels match desktop for the same run.
- **Verification:** unit tests.
- **ADRs:** —

#### T-055 — Audit robustness and PII masking
- **Problems:** SEC-001, SEC-002 · **Priority:** P1 · **Severity:** High
- **Description:** EF `writeAuditLog` failures are surfaced (retry/throw per canonical §7.6 policy); LLM adapter uses masked content only — empty `maskedContent` blocks the BYOK path instead of sending raw prompts.
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop, Backend
- **Tests:** audit-write failure is observable; raw-PII prompt never reaches the BYOK adapter.
- **Verification:** unit tests + one live EF check.
- **ADRs:** —

#### T-056 — Desktop low-risk hygiene batch
- **Problems:** WEAK-003, WEAK-004, DEAD-002, DRIFT-005, WEAK-020, DEAD-014 · **Priority:** P3 · **Severity:** Low
- **Description:** One commit per item: `mapLedgerRow` no longer falls back to `actor_id`; ledger seed uses tranche due dates (remove `void dueDate`); wire or delete `handleDelete` in update-server-secret; add `server_secret.*` to `AuditActions`; `paymentStatusTone` handles `cancelled`/`pending_clearance`; remove the unused database-schema barrel (website).
- **Dependencies:** none · **Affected:** D, W · **Platforms:** Desktop, Website
- **Tests:** per-item unit tests.
- **Verification:** typecheck + tests green.
- **ADRs:** —

#### T-057 — Website canonical port honesty
- **Problems:** DRIFT-009 (absorbs DEAD-011), WEAK-017 · **Priority:** P3 · **Severity:** Medium
- **Description:** Prune unused ported calc files (keep the ~6 consumed functions) or implement the promised `port-canonical.mjs`; register the canonical `homework` table in the typed `Database` interface and remove the legacy `homework_assignments` typing.
- **Dependencies:** none · **Affected:** W · **Platforms:** Website
- **Tests:** typecheck green without `as unknown as` casts on homework queries.
- **Verification:** build + tests.
- **ADRs:** ADR-002

#### T-058 — Adopt append-only migration discipline
- **Problems:** REG-001 · **Priority:** P2 · **Severity:** High (process)
- **Description:** Process change (already encoded in AGENTS.md + recovery rules): schema changes are new migrations only; each migration's header documents what it changes and why; a review checklist item verifies no applied migration is edited (git diff on `supabase/migrations/` shows additions only).
- **Dependencies:** none · **Affected:** D · **Platforms:** Backend
- **Tests:** CI check: `git diff --name-only` against main shows no modifications under `supabase/migrations/` for PRs.
- **Verification:** check in place.
- **ADRs:** ADR-001

#### T-059 — Migrate Android writes to canonical RPCs — **BLOCKED**
- **Problems:** ARCH-003, CROSS-005 (absorbs CROSS-006) · **Priority:** P1 · **Severity:** Critical
- **Description:** Implement ADR-005 in phases: online path → canonical RPCs; offline queue replays the same RPCs; retire `upsert_*_from_import` from Android financial writes; consolidate Room layers (T-045 folds in).
- **Dependencies:** **BLOCKED by UNKNOWN-002** (owner confirmation of ADR-005); then T-019/T-020/T-021 first · **Affected:** A, D (RPC contract) · **Platforms:** Android, Backend
- **Tests:** equivalence suites: Android-collected payment ≡ desktop-collected payment (ledger/waterfall/audit/receipt parity); offline replay parity.
- **Verification:** phased equivalence runs recorded in change-log.
- **ADRs:** ADR-005

#### T-060 — Payment collection UX correctness
- **Problems:** BUSINESS-005, WEAK-005 · **Priority:** P2 · **Severity:** Medium
- **Description:** `UnifiedPaymentModal` preview and actual collection use the same category semantics (null = all categories); batch registration captures `previousGradeLevel`/`previousRank` so all 5 discount rules can evaluate.
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop
- **Tests:** preview ≡ actual allocation for every category choice; `passage_palier`/`highest_average` discounts appear when inputs qualify.
- **Verification:** unit tests.
- **ADRs:** —

#### T-061 — Scope the payment-proof trigger to INSERT
- **Problems:** WEAK-200 · **Priority:** P3 · **Severity:** Medium
- **Description:** `enforce_payment_proof` re-validates only when `method` changes (or proof fields are being set), so status-only updates (refunds, clearances) of legacy rows cannot fail.
- **Dependencies:** none · **Affected:** D (migrations) · **Platforms:** Backend
- **Tests:** status-only update of a NULL-proof legacy row succeeds; method change without proof still rejected.
- **Verification:** trigger test.
- **ADRs:** —

#### T-062 — Android dead-code removal
- **Problems:** DEAD-007, DEAD-008, DEAD-009, DRIFT-007 · **Priority:** P3 · **Severity:** Low
- **Description:** Remove `StubRepositories.kt`; either register `ElGalleryActivity` in the manifest (dev-only) or delete the gallery; correct the misleading `SupabaseModule` KDoc; trim unused `AuditActions` constants (keep wire-protocol comment pointing to the desktop registry).
- **Dependencies:** reachability check per recovery rules · **Affected:** A · **Platforms:** Android
- **Tests:** build + tests green; APK size note.
- **Verification:** grep clean.
- **ADRs:** —

#### T-063 — Android absence-alert threshold
- **Problems:** ATT-103 · **Priority:** P3 · **Severity:** Low
- **Description:** `alertAbsences` adopts the desktop rule (≥3 absences, current term).
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** threshold behaviour matches desktop for same input.
- **Verification:** unit test.
- **ADRs:** —

#### T-064 — Android config dialog security
- **Problems:** SEC-004, SEC-005 · **Priority:** P2 · **Severity:** Medium
- **Description:** Anon key masked (`PasswordVisualTransformation`); remove the "Google AI Studio" toolchain mention; unconfigured Supabase fails closed instead of hitting `demo.supabase.co`.
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** unconfigured app performs zero network calls to Supabase endpoints.
- **Verification:** unit test.
- **ADRs:** —

#### T-065 — Website copy and comment accuracy
- **Problems:** WEAK-023, DRIFT-010 · **Priority:** P3 · **Severity:** Low
- **Description:** Fix the unread-chat comment/query mismatch (channel-scoped fetch or corrected comment); update the attendance-view header comment to match reality (the portal DOES submit justifications).
- **Dependencies:** none · **Affected:** W · **Platforms:** Website
- **Tests:** n/a (comment/query accuracy) — code change for WEAK-023 covered by test.
- **Verification:** review.
- **ADRs:** —

#### T-066 — Decide the server-side receipt storage model — **BLOCKED**
- **Problems:** CROSS-101 · **Priority:** P2 · **Severity:** Critical (website feature dead)
- **Description:** Decide (UNKNOWN-004): persist receipt PDFs to Storage + `receipts` rows (restore website download), or remove the orphaned table + website Receipts tab (client-side PDF generation only).
- **Dependencies:** **BLOCKED by UNKNOWN-004** · **Affected:** D, W, DB · **Platforms:** All
- **Tests:** per decision.
- **Verification:** per decision.
- **ADRs:** —

#### T-067 — Decide the payment Edge Functions' role — **BLOCKED**
- **Problems:** DEAD-016 (absorbs WEAK-001, WEAK-002, DRIFT-002, DRIFT-004) · **Priority:** P1 · **Severity:** Critical
- **Description:** Decide (UNKNOWN-003): (a) make `collect-payment`/`refund-payment` the canonical gateway — wire clients, fix the absorbed latent defects (cancelled-payment guard, structured check/transfer fields, honest headers, category default); or (b) delete them and document direct-RPC as the contract (RLS+triggers carry the invariants).
- **Dependencies:** **BLOCKED by UNKNOWN-003**; interacts with ADR-005 (Android path) · **Affected:** D, A, W · **Platforms:** All
- **Tests:** per decision.
- **Verification:** per decision.
- **ADRs:** ADR-002

#### T-068 — Fix EF permission resolution
- **Problems:** SEC-109 · **Priority:** P1 · **Severity:** High
- **Description:** `extractAuthContext` resolves permissions with a caller-scoped client (or a direct query with the user's JWT) so `requirePermission` works for non-super_admin users of `workflow-execute`/`run-overdue-scan`.
- **Dependencies:** none · **Affected:** D (functions) · **Platforms:** Backend
- **Tests:** user with granted permission (not super_admin) can invoke; user without cannot.
- **Verification:** EF integration test.
- **ADRs:** —

#### T-069 — Android realtime subscriptions
- **Problems:** REALTIME-104 · **Priority:** P2 · **Severity:** High
- **Description:** Subscribe Android to realtime channels for payments/installments/notifications/chat_messages (mirroring the website's hooks) so freshness is push-based; 15-min pullAll becomes the fallback.
- **Dependencies:** T-050 (online state correctness) recommended first · **Affected:** A · **Platforms:** Android
- **Tests:** server-side write appears in the Android UI within seconds.
- **Verification:** instrumented test.
- **ADRs:** —

#### T-070 — Decide the multi-guardian model — **BLOCKED**
- **Problems:** DEAD-200 · **Priority:** P3 · **Severity:** Medium
- **Description:** Decide (UNKNOWN-010): implement `parent_student_links` (second parent portal access, custody, sibling-discount correctness) or drop the table.
- **Dependencies:** **BLOCKED by UNKNOWN-010** · **Affected:** DB · **Platforms:** Backend
- **Tests:** per decision.
- **Verification:** per decision.
- **ADRs:** —

#### T-072 — Harden activation codes — **BLOCKED**
- **Problems:** WEAK-100 · **Priority:** P1 · **Severity:** Medium
- **Description:** After UNKNOWN-008: generate codes with `gen_random_bytes()`/longer formats and rate-limit the binding endpoint (per-account + per-IP).
- **Dependencies:** **BLOCKED by UNKNOWN-008** (format/UX decision) · **Affected:** D (migrations), W · **Platforms:** Backend, Website
- **Tests:** brute-force simulation blocked by rate limit.
- **Verification:** security test.
- **ADRs:** ADR-003 (determinism scope)

#### T-079 — Admin-created user accounts (feature — owner request, 2026-08-29) — **Completed (TESTED client stack / IMPLEMENTED backend)**
- **Problems:** — (feature gap, not a registered defect; recorded per AGENTS.md §13) · **Priority:** P1 · **Severity:** —
- **Description:** Owner request: "Implement the functionality in the desktop app that allows an admin to create accounts for other users so they can log in with their own accounts." Today a login account can ONLY originate from a web self-signup (migration 0002 trigger + ApprovalsTab approval); an admin cannot provision accounts directly (e.g. a new staff member). Plan: new SQL RPC `admin_create_user_account` (migration 0044 — atomically activates the trigger-created profile, assigns the chosen role, resolves the auto-created approval request; EXECUTE revoked from anon/authenticated, granted to service_role only), new Edge Function `create-user-account` (super_admin ONLY — deliberately narrower than approve-signup-request to avoid repeating SEC-107's support_staff→super_admin escalation; uses auth.admin.createUser with email_confirm=true + app_metadata.tenant_id = the SEC-108 trusted admin path), desktop `UserAccountRepository` domain contract with Supabase + Mock implementations (mock inserts into seedAccounts so created users can sign in — headless e2e testable), `AccountsTab` in Settings (SuperAdmin-gated, French UI per existing tabs), `UserAccountCreate` audit action. Initial password: admin-provided (same policy as changePassword) or generated; returned ONCE to the admin (never stored, never emailed — SEC-100 lesson); user changes it at first login (works since T-003).
- **Dependencies:** none · **Affected:** D (migration 0044, EF, src) · **Platforms:** Desktop, Backend
- **Status:** client stack (domain contract + mock + supabase repositories + wiring + AccountsTab + audit action) TESTED 2026-08-29; migration 0044 + create-user-account EF IMPLEMENTED (esbuild syntax check + auth-js typings cross-check + SQL review vs the 0005 precedent; no Deno/Postgres/live Supabase in this environment — cannot execute).
- **Outcome:** Settings → Comptes tab (SuperAdmin): create-account dialog (email, name, phone, role, optional §12.04 password) → one-time credentials card. Supabase path: EF → auth.users (confirmed) → trigger (pending profile + request) → 0044 RPC (active + role + request resolved, atomic) → `user_account.create` audit (no password). Mock path: mints into seedAccounts → the new user signs in via MockAuthRepository immediately. seedAccounts typed to full Role enum (values unchanged); backup-repository repositoriesRef extended; userAccounts wired into BOTH assemblies (Supabase mode explicitly overrides the mock spread).
- **Tests:** `src/tests/security/admin-create-account.test.tsx` 19/19 PASS (RED first: module-not-found, commit 19ac460); `npm run typecheck` clean; full suite 43 files / 1988 tests ALL PASS (was 42/1969). EF/migration gaps recorded honestly.
- **Verification:** see change-log entry (T-079) — headless evidence complete; live round-trip (deploy 0044 + EF, create account, sign in, change password) still pending → backend stays IMPLEMENTED.
- **ADRs:** —
- **Commits:** d85d65a (registry checkout) · 19ac460 (RED tests) · 314a74e (desktop implementation) · aa841ee (migration 0044 + EF) · docs commit (this change).

---

## Not Started (sequencing notes)

All `Ready` tasks above have not yet been started. Two of them are called out for sequencing only (they are defined in their phase sections):

- **T-036** push pipeline — its EF-internal fixes (correct column, PEM parsing) are unblocked and can start; the invocation wiring waits on the token-lifecycle work (T-030) and provider scoping.
- **T-069** Android realtime — sequenced after T-050 (online-state correctness) to avoid building subscriptions on a broken connectivity signal.

## Needs Investigation

- **T-047** — desktop mock-repository completion (requires product scoping per module before implementation can be scheduled).

## Deferred

- **T-073** — Co-teaching schema support (`ACAD-102`): product enhancement; requires join-table design.
- **T-074** — Class-transfer audit trail (`ACAD-103`): product enhancement.
- **T-075** — Homework acknowledgment feature (`GRADE-100`): never specified beyond the column.
- **T-076** — Firebase key rotation + build-config documentation (`SEC-003`): hygiene; requires Firebase console access.
- **T-077** — Reactive Supabase configuration without restart (`DRIFT-003`): documented limitation for now.

---

## Dependency graph

```
T-005 (tenant RBAC) ──→ T-053 (global admin UX)
T-011 (collect fallback) ──→ T-015 (receipt consolidation, desktop side)
T-019 (sync errors) ──→ T-020 (5xx requeue) ──→ T-021 (worker semantics)
T-019 ──→ T-017 (Android refunds)
T-023 (desktop academic writes) ─┐
T-024 (Android academic writes) ─┼─→ T-039 (Android pull completeness) ──→ T-040 (justification review)
T-025 (tenant resolver fix) ─────┴─→ T-041 (promotion flow)
T-032 (website realtime) ──→ T-033 (freshness fallback)
UNKNOWN-001 ──→ T-028 (activation EF)
UNKNOWN-002 ──→ T-045 (Room layers), T-059 (Android canonical writes → T-017 interim, T-069)
UNKNOWN-003 ──→ T-067 (payment EFs)
UNKNOWN-004 ──→ T-066 (receipts)
UNKNOWN-005 ──→ T-037 (chat)
UNKNOWN-007 ──→ T-038 (notification read state) [partial: T-032's notifications filter]
UNKNOWN-008 ──→ T-072 (activation hardening)
UNKNOWN-010 ──→ T-070 (multi-guardian)
UNKNOWN-011 ──→ T-042 (timetable)
```

**Hard rule:** do not work a downstream task before its dependency is VERIFIED (or the blocking unknown is resolved) without a recorded reason in the task's entry.
