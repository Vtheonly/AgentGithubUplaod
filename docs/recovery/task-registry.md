# Task Registry — Master Recovery Task List

> **This is the authoritative todo list for all remaining work.** Agents must not create separate task lists, TODO files, or progress notes anywhere. Status transitions follow `definition-of-done.md`; completion evidence goes to `change-log.md`.
>
> **Evidence base:** every task below was derived from the problem registry, which consolidates the two archived audit reports in [`docs/audits/`](../audits/README.md) (86 + 99 findings). When a task's problem entry is not detailed enough, read the raw finding in the audit files — full end-to-end traces and git forensics live there.
> **Commit rule (AGENTS.md §14):** every commit must state the task completed, what is left, what was changed, what was verified, and the next task.
>
> Statuses: `Not Started` · `Needs Investigation` · `Ready` (understood, dependencies cleared) · `In Progress` · `Blocked` · `Deferred`. Within `Ready`, work P0 → P1 → P2 → P3. Pick tasks via `next-task.md`.

## Progress summary (2026-08-31, updated during the thirteenth repair session — T-041/T-030/T-058/T-050/T-036(PUSH-103) done; Android set next)

| Status | Count | Tasks |
|---|---|---|
| **Completed (VERIFIED)** | 6 | T-000, T-079, T-004, T-094 (live integration suite 5/5, 2026-08-31), **T-068** (live deploy + curl matrix + permission probes, 11th session), **T-095** (live 200 + idempotency, 12th session) |
| **Completed (TESTED)** | 48 | T-001, T-003, T-009, T-078, T-081, T-019, T-049, T-002, T-065, T-016, T-027, T-061, T-031, T-029, T-071, T-083, T-084, T-088, T-080, T-089, T-091, T-087, T-092 (sessions 1–9) + T-006, T-008, T-093, T-032, T-035, T-056 (10th session) + **T-011, T-012, T-013, T-014, T-023, T-025 (migration 0057 live 6/6), T-033, T-048, T-060** (11th session) + **T-015 (0058 live 7/7), T-053, T-022, T-040, T-052, T-057, T-055, T-018 (desktop+sync)** (12th session) + **T-041 (migration 0059 live 10/10; desktop 2146 tests), T-030 (migration 0060 live 9/9; website 135/135)** (13th session) + **T-058 (append-only migration guard: 9/9 matrix + 6/6 suite tests)** (13th session) + **T-050 (OnlineDetector fail-closed + own-backend probe + pullAll dedup; desktop 13/13 new tests, Android 15/15 new tests)** (13th session) + **T-036 PUSH-103 portion (website FCM auto-registration after first user gesture; 9/9 new tests, suite 144/144)** (13th session) |
| **Completed (IMPLEMENTED)** | 1 | T-010 (launch verification needs a desktop host) |
| **In Progress** | 5 | **13th session batch (2026-08-31, owner-requested ~10 tasks) — remaining (Android set):** T-026, T-054, T-062, T-063, T-064 (toolchain re-bootstrapped at /home/z/my-project/tools; gradle memory-tuned — use `./gradlew testDebugUnitTest --offline`). Done from this batch: T-041, T-030, T-058, T-050, T-036 (PUSH-103 portion) |
| **Ready** | 16 | T-017, T-020, T-021, T-024, T-034, T-039, T-043, T-044, T-046, T-051, T-069 (T-041 moved out — completed 13th session; count adjusted in-place) |
| **Partially blocked** | 1 | T-036 — PUSH-103 portion DONE (13th session); PUSH-100 (EF invocation path) + PUSH-104 (email provider) remain, owner-scoped |
| **Blocked** | 10 | T-028, T-037, T-038, T-042, T-045, T-059, T-066, T-067, T-070, T-072 |
| **Needs Investigation** | 1 | T-047 |
| **Deferred** | 5 | T-073…T-077 |
| **Needs owner decision** | 3 | T-085, T-086, T-087(done 9th) — see registry entries |
| **Not started (Android, toolchain-gated)** | 2 | T-020, T-082 — the 10th session re-confirmed the Android SDK is un-downloadable here (dl.google.com 404s commandlinetools) |


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

**13th repair session (2026-08-31, in progress)** — remaining batch: **T-058** (append-only migration discipline guard — NEXT), **T-050** (OnlineDetector fail-closed + Supabase probe target, both platforms), **T-036** (unblocked PUSH-103 portion: website FCM auto-registration after first user gesture), and the Android set **T-026, T-054, T-062, T-063, T-064** (toolchain re-bootstrapped at /home/z/my-project/tools; gradle memory-tuned for the 2-CPU container). Session opening completed the owner's standing asks: portal `.env.local` (Missing-configuration banner gone — live headless render verified) and the mandatory live-chain check (57/57 rows = 0001–0060 after this session's two migrations). NEW problem registered: **AUTH-200** — Google OAuth provider NOT enabled on the live project (portal's only auth path dead until the owner configures it — runbook in docs/operations/portal-google-oauth.md).

## Completed (thirteenth repair session — 2026-08-31, owner-requested ~10-task batch)

### T-041 — Complete the year-end promotion flow
- **Problems:** ACAD-100, ACAD-101, BUSINESS-004 · **Priority:** P1 · **Severity:** Critical
- **Status:** TESTED (2026-08-31, 13th session; live backend VERIFIED 10/10 via verify_t-041.sql)
- **What was done:** NEW migration `0059_canonical_promotion_flow.sql`: the dead `promote_students` RPC (wrote the legacy table, referenced a non-existent column) is DROPPED; `set_current_academic_year` flips the whole tenant's `is_current` in ONE UPDATE + audit entry (ACAD-101); `execute_batch_promotion` is the atomic batch executor (history upsert + grade advance + graduation + one audit entry in a single transaction, caller-verified per the 0055 SEC-111 pattern). `SupabaseAcademicYearRepository.setCurrentYear/createAcademicYear` → the atomic RPC (insert with `is_current=false`, then flip — failure leaves the previous year intact). `SupabasePromotionRepository.executeBatchPromotion` → ONE RPC call with the decisions array computed by the canonical TS engine; direct student/history table writes removed. `SupabaseStudentRepository.promote()` → implemented on the same RPC path (BUSINESS-004 — the hard "not implemented" error is gone).
- **Tests:** NEW `src/tests/infrastructure/t-041-promotion-flow.test.ts` 8/8; `supabase-repositories.test.ts` promotion tests updated to the RPC contract.
- **Verification:** desktop full suite 64 files / 2146 passed / 5 skipped / 0 failures; `npx tsc --noEmit` clean; `npm run lint` 0 errors. LIVE: migration 0059 applied atomically with its schema_migrations registration (T-091/MIG-TOKENS pattern, `scripts/apply_0059_live.sh`); `scripts/verify_t-041.sql` 10/10 PASS (registration present; dead RPC gone; both RPCs present; non-array payload rejected 22023; unknown student rejected 42501 under simulated staff JWT; missing year rejected 23503; anonymous fail-closed; staff policy + RLS intact). Gap: UI E2E needs a desktop host; real promotion run needs the owner's data.
- **Commits:** 049c418 — hub repo.
- **Left:** mock `StudentRepository.promote()` still does not advance grades (dev-only divergence, noted); Android promotion propagation remains T-024 (toolchain-gated).

### T-030 — Fix sign-out and FCM token lifecycle
- **Problems:** SYNC-104, SYNC-105, PUSH-102 · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-31, 13th session; live backend VERIFIED 9/9 via verify_t-030.sql)
- **What was done:** NEW migration `0060_fcm_token_transfer_guard.sql`: `register_fcm_token` conflict semantics — same-user conflict reactivates (unchanged); conflict with another user's ACTIVE row RAISES 42501 (the shared-device hijack PUSH-102 is dead — the owner must sign out first, and canonical sign-out deactivates); conflict with another user's INACTIVE row transfers EXPLICITLY with a `device_token.transfer` audit entry. New `unregister_fcm_token(p_token)`: retires ONE row by token string, caller-verified (row owner or service_role), idempotent, audited. Website half (repo elimtiyaz-website): `registerDeviceToken` persists the last-known token (localStorage); NEW `unregisterFcmToken` calls the canonical RPC; `subscribeToFcmTokenRefresh` re-registers AND retires the stale token on rotation; typed in `database.ts` (WEAK-017 rule); signOut uses `scope:"local"` + unregisters (SYNC-105).
- **Tests:** NEW `src/lib/hooks/t-030-fcm-token-lifecycle.test.ts` 5/5 (website).
- **Verification:** website suite 14 files / 135 tests ALL PASS; strict build green; lint clean. LIVE: migration 0060 applied atomically WITH registration; `scripts/verify_t-030.sql` 9/9 PASS (SEC-106 caller-verification intact; ACTIVE-conflict transfer REJECTED 42501; INACTIVE-conflict transfer ALLOWED + audited; same-user reactivation + register audit; unregister retires caller's own row; idempotent NULL for unknown tokens; 2+ audit rows). Gap: live browser FCM round-trip blocked on the owner's FCM web config (env gap documented in credentials.md).
- **Commits:** e3b5fff — hub repo; 99f6ef0 — website repo.
- **Left:** Android `FcmTokenRegistrar` needs no change (calls the same RPC — server guard covers it); PUSH-100 (dead send-push-notification EF) and PUSH-104 (send_email stub) remain T-036.

### T-058 — Adopt append-only migration discipline
- **Problems:** REG-001 · **Priority:** P2 · **Severity:** High (process)
- **Status:** TESTED (2026-08-31, 13th session)
- **What was done:** The discipline that AGENTS.md §15.9 / recovery-rule 14 / ADR-001 prescribe is now MACHINE-ENFORCED: NEW `elimtiyaz-desktop/scripts/check-migrations-append-only.sh` fails (exit 1) on any modification/deletion/rename of an existing migration — checked BOTH in the working tree/index (git status porcelain) AND against a baseline ref (default: upstream/origin/main — the PR case the task prescribes; falls back to HEAD). It also enforces header discipline (`--` first line) and `NNNN_name.sql` naming on every migration file (all 57 pass today). Handles the deleted-directory edge (git prunes empty dirs after `git rm`). Wired in: (a) `npm run check:migrations` (package.json script); (b) `npm test` via NEW `src/tests/infrastructure/t-058-migration-append-only.test.ts` (real-chain pass + 5 planted-violation cases in throwaway git repos — parallel-safe, never dirties the real tree); (c) NEW `scripts/t-058-guard-matrix.sh` (9-case shell matrix). Review-checklist section added to `docs/agents/git-workflow.md` §7; recovery-rule 14 updated to point at the guard. ALSO FIXED: 3 pre-existing TS2339 errors in the T-041 test file (`.value` access without narrowing — the T-041 commit had claimed a clean typecheck; corrected with a local `unwrap()` helper).
- **Tests:** guard matrix 9/9 (clean, unstaged edit, staged delete, rename, new-with-header, headerless new, misnamed new, committed edit vs base, restored); vitest 6/6.
- **Verification:** `npm run check:migrations` → OK (57 files, +2 added vs origin/main — 0059/0060); `npx tsc --noEmit` clean (including the 3 T-041 fixes); full desktop suite 64 files / 2152 passed / 5 skipped / 0 failures (+6 tests); `npm run lint` 0 errors / 369 warnings (unchanged baseline).
- **Commits:** this commit — hub repo.
- **Left:** nothing — the check is in place and wired. GitHub Actions CI does not exist in this repo (documented in change-log); the guard runs locally via npm test / check:migrations and in any future CI as a one-liner.

### T-050 — Android connectivity & pull efficiency
- **Problems:** WEAK-009, SEC-006, CACHE-101, WEAK-010 · **Priority:** P2 · **Severity:** High
- **Status:** TESTED (2026-08-31, 13th session)
- **What was done:** ANDROID (repo elimtiyaz-android, commit 3bc5cdd): OnlineDetector is fail-closed (offline initial state; `isOnline()` = combined connectivity AND probe; probe catch returns FALSE; verdict accepts only 200/401; OkHttp no longer follows redirects so a captive-portal 302 is rejected); the third-party fallback host (`supabase.com`) is DELETED — unconfigured builds probe NOTHING (connectivity-only); probes throttled (10s min interval + in-flight guard); placeholder detection survives the YOUR_PROJECT underscore variant (SEC-005/T-064 overlap noted). PullSyncRepository.pullAll gains an in-flight + 10s dedup window (the "single deduplicated pullAll per cycle"); SyncWorker's and syncNow's duplicate pulls removed (drainPending's trailing pull is the one per-tick pull). DESKTOP (hub repo, this commit): the probe targets the configured Supabase `/auth/v1/health` (apikey header, cors mode — status readable; only 200/401 online; live endpoint behaviour curl-verified: 200 with key, 401 without, `access-control-allow-origin: *`); unconfigured (mock/dev) makes ZERO requests; fail-closed initial state; singleton derives the probe target from supabase-client. Live endpoint behaviour curl-verified. gradle.properties memory tuning committed (2-CPU/4GB container needs it for every future Android test run).
- **Tests:** desktop NEW `src/tests/infrastructure/t-050-online-detector.test.ts` 13/13 (URL resolution, verdict matrix, fail-closed state machine incl. captive-portal 302 + network-failure + apikey-header + unconfigured-no-fetch); Android NEW `OnlineDetectorT050Test.kt` 15/15 (resolution matrix incl. underscore placeholder, verdict matrix, combine rule, source-scan wiring pins).
- **Verification:** desktop suite 65 files / 2165 tests ALL PASS (+13); typecheck clean; lint 0 errors. Android `testDebugUnitTest` 234/234 ALL PASS (+15; was 219). Gap: live airplane-mode/captive-portal behaviour needs real hardware (recorded, not claimed); live device FCM/sync round-trip still blocked on owner config. NEW FINDING registered: ARCH-012 — `testReleaseUnitTest` fails on GreetingScreenshotTest (pre-existing, PROVEN by pristine-tree re-run; debug variant is the green gate).
- **Commits:** 3bc5cdd — android repo; (this commit) — hub repo (desktop half + docs).
- **Left:** T-064 keeps the remaining placeholder-detection scope (NetworkTimeouts.isSupabaseConfigured still hyphen-only); ARCH-012 release-variant test triage open.

## Completed (eleventh repair session — 2026-08-31, owner-requested ~10-task batch)

### T-011 — Eliminate the silent collect() fallback
- **Problems:** BUSINESS-002 (absorbs BUSINESS-103, CROSS-105) · **Priority:** P1 · **Severity:** Critical
- **Status:** TESTED (2026-08-31, eleventh session)
- **What was done:** `SupabasePaymentRepository.collect()` no longer falls back to `upsert_payment_from_import` on RPC failure — the error propagates as `Err` with the financial state untouched (single atomic path only, ADR-002). The fallback branch and the client-side `PAY-` random payment-number generator (only used by the fallback) were removed; the receipt number comes from the RPC (ADR-004). Success path preserved byte-for-byte.
- **Tests:** NEW `src/tests/infrastructure/t-011-payment-atomicity.test.ts` 2/2 — RPC failure → Err + upsert NEVER called + zero rows; success path returns the fetched mapped payment.
- **Verification:** `npx tsc --noEmit` clean; full desktop suite 57 files / 2091 tests (session-close re-run). Gap: live E2E through the UI needs a desktop host.
- **Commits:** 3da7228 — hub repo.

### T-012 — Make bulkCollect fail-fast
- **Problems:** BUSINESS-100 · **Priority:** P1 · **Severity:** Critical
- **Status:** TESTED (2026-08-31, eleventh session)
- **What was done:** `bulkCollect()` returns `Err` on the FIRST chunk error (naming the failing row range); the `Ok(partial)` return and the catch→per-row-collect retry loop removed. The consumer `RepositoryStorageAdapter.flushPendingBatches` checks the Result and routes an `Err` into its failures list, cancelling the Excel-import transaction (restoring the "no partial data applied in silence" contract).
- **Tests:** NEW `src/tests/infrastructure/t-012-bulkcollect-failfast.test.ts` 4/4 — chunk FK failure → Err "rows 1–N" + zero rows kept; happy path inserts; adapter throws on Err, resolves on Ok.
- **Verification:** typecheck clean; full-suite evidence as above.
- **Commits:** 429a132 — hub repo.

### T-013 — Fix markClearedFallback audit and allocation cascade
- **Problems:** BUSINESS-101, BUSINESS-104 · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-08-31, eleventh session — resolution = removal, per the task's stated preference)
- **What was done:** the 60-line client-side `markClearedFallback()` (no audit entries, actor discarded, per-installment errors swallowed → cascading over-allocation) is DELETED; `markCleared()` throws on RPC error → `Err`, financial state untouched. The canonical `mark_payment_cleared` RPC (migration 0040: FOR UPDATE locks + audit) is the only path.
- **Tests:** NEW `src/tests/infrastructure/t-013-markcleared-atomic.test.ts` 2/2 — RPC failure → Err + no installment rows touched; success path re-fetches.
- **Verification:** typecheck clean; full-suite evidence as above.
- **Commits:** 6a25a40 — hub repo.

### T-014 — Implement the desktop refund flow
- **Problems:** DEAD-015, BUSINESS-003 · **Priority:** P1 · **Severity:** Critical
- **Status:** TESTED (2026-08-31, eleventh session)
- **What was done:** `PaymentRepository.refund(id, reason, actorId, actorName?)` — reason mandatory (≥3 chars per the refund-payment EF contract §7.2); `SupabasePaymentRepository.refund()` validates and propagates the REAL actor + reason to `revert_payment_allocation` (and errors on a missing fetch-after-refund row instead of mapping `{}`); Mock refund mirrors with the canonical double-refund guard (only paid|pending revertible, migration 0041:493-495). `PaymentDetailDrawer` gains "Rembourser ce paiement" (Permission.RefundPayment-gated, destructive ConfirmModal, ≥3-char reason) wired to the signed-in session identity.
- **Tests:** NEW `src/tests/infrastructure/t-014-refund-flow.test.tsx` 10/10 — mock actor+reason in reversal entries + tranche re-opened + double-refund rejected + short reason rejected; supabase real reason+actor reach RPC args; UI gating matrix. `full-payment-flow` integration 18/18.
- **Verification:** typecheck clean; full-suite evidence as above. Gap: live drawer E2E needs a desktop host; EF gateway question stays with UNKNOWN-003/T-067.
- **Commits:** 766db94 — hub repo.

### T-023 — Fix desktop homework and roll-call persistence
- **Problems:** HOMEWORK-100, ATT-100 · **Priority:** P1 · **Severity:** Critical
- **Status:** TESTED (2026-08-31, eleventh session + live schema verification 7/7)
- **What was done:** `SupabaseHomeworkRepository.push()` now carries `tenant_id` (getTenantId()) and the non-existent `push-homework-notification` EF invocation is REMOVED (parent-notification decision deferred to T-036). `SupabaseAttendanceRepository.recordRollCall()` payload carries tenant_id + BOTH `date` and `record_date` (legacy NOT NULL + canonical) and `onConflict` targets the canonical `uq_attendance_canonical` 4-column unique index.
- **Tests:** NEW `src/tests/infrastructure/t-023-academic-persistence.test.ts` 4/4 (payload shape, canonical onConflict target, dead EF gone). Live `scripts/verify_t-023.sql` 7/7 PASS against production (BEGIN…ROLLBACK): fixed payloads insert; old payloads reproduce the NOT NULL violations; duplicate (tenant,student,record_date,session) hits unique_violation.
- **Verification:** typecheck clean; full-suite evidence as above. Gap: desktop→website cross-client E2E needs a desktop host; Android homework UUID defect remains T-024.
- **Commits:** 7883030 — hub repo.

### T-025 — Replace fn_current_tenant_id with the canonical resolver
- **Problems:** DEAD-100 (absorbs TENANT-105), TENANT-106 · **Priority:** P1 · **Severity:** Critical
- **Status:** TESTED (2026-08-31, eleventh session + live verification 6/6; migration 0057 applied live + registered atomically)
- **What was done:** migration `0057_canonical_tenant_resolver.sql` (idempotent): drops the 6 inert `rls_*_tenant` policies (the tables keep their working role-gated policies — no RLS weakening); replaces the dead policy on `student_academic_histories` with `student_academic_histories_staff` (tenant_id = current_tenant_id() AND staff roles — promotion flow can write histories); `set_assessments_tenant()` orphan fallback now RAISES (no DEMO stamping); `fn_current_tenant_id()` dropped (zero references verified across all three repos).
- **Tests:** live `scripts/verify_t-025.sql` 6/6 PASS (JWT emulation via set_config): staff SELECT/INSERT own-tenant histories ok; cross-tenant INSERT rejected; orphan assessment rejected; legit insert ok; dead resolver fully gone.
- **Verification:** applied live + registered in `schema_migrations` in the same atomic transaction (ARCH-011 discipline); post-apply catalog checks clean.
- **Commits:** 1731755 — hub repo.

### T-068 — Fix EF permission resolution
- **Problems:** SEC-109 · **Priority:** P1 · **Severity:** High
- **Status:** VERIFIED (2026-08-31, eleventh session — live deploy + curl matrix + positive/negative permission probes)
- **What was done:** NEW `createUserScopedClient(jwt)` in `_shared/supabase.ts` (anon key + caller's Authorization header — PostgREST derives auth.uid() from it); `extractAuthContext` resolves permissions through it, exercising the same canonical resolver + RLS as the desktop RBAC path. Resolver errors fail CLOSED. `workflow-execute` + `run-overdue-scan` (the two requirePermission consumers) redeployed live.
- **Tests:** live curl matrix: no-auth/invalid/anon → 401 each; CRON_SECRET → auth gate passed. Positive probe: fresh support_staff user with an `execute_workflow` tenant_role_override called workflow-execute → 404 workflow_not_found (requirePermission PASSED; pre-fix this was 403 for every non-super_admin). Negative control: same user without the override → 403. Probe residue fully cleaned (DATA-007 discipline).
- **New problem registered:** BUG-NEW-004 (run-overdue-scan hits WORKER_RESOURCE_LIMIT after the auth gate — the EF's own sizing problem, not a T-068 regression).
- **Commits:** 003d301 — hub repo.

### T-033 — Website freshness fallback
- **Problems:** CACHE-100 · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-31, eleventh session; T-032 dependency TESTED in the 10th)
- **What was done:** `app/providers/index.tsx` exports `queryClientDefaultOptions` (the single object the QueryClient mounts) with `refetchOnWindowFocus: true` + a conservative 5-minute `refetchInterval`; staleTime 30s and retry:1 preserved. A silent realtime failure now degrades to stale-BOUNDED data instead of stale-forever.
- **Tests:** NEW `src/test/t-033-freshness-fallback.test.tsx` 3/3 — config enables both fallbacks preserving staleTime/retry; mounted QueryClient resolves the same options; behavioral refocus-refetch test.
- **Verification:** website suite 122/122 (119+3); lint clean; strict build green.
- **Commits:** ef205a3 — website repo.

### T-048 — Unify the migration chain
- **Problems:** CROSS-001 (absorbs CROSS-010), CROSS-003 (absorbs CROSS-007, ACAD-104) · **Priority:** P2 · **Severity:** Critical
- **Status:** TESTED (2026-08-31, eleventh session — all three repos)
- **What was done:** the website's 4 drifted portal-patch migrations removed (website commit 4faf007); the Android repo's 6 stale migration copies removed (android commit 1bd0d9d); hub `AGENTS.md` §2/§3 updated: client repos no longer carry migration copies at all, chain extent corrected to 0001–0057 (ADR-001 — the desktop repo owns the only chain). The 2 drifted website Edge Functions remain DELIBERATELY (bind-activation-code waits on UNKNOWN-001/T-028; send-push-notification is T-036 scope).
- **Tests:** website suite 122/122 + strict build green; desktop suite unaffected by the doc-only hub change; live chain diff (session 12 opening) confirms 0001–0057 one-to-one with zero drift.
- **Commits:** 4faf007 (website), 1bd0d9d (android), 707ef1e (hub).

### T-060 — Payment collection UX correctness
- **Problems:** BUSINESS-005, WEAK-005 · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-31, eleventh session)
- **What was done:** `unified-payment-modal.tsx` — all 3 category-filter sites (slider tranches, allocation preview, focused tranche) use the exact `i.category === category` filter and pass the CONCRETE category to the allocator, mirroring the SQL semantics (`p_category IS NULL OR category = p_category`) for EVERY category — preview ≡ actual collection. Batch-registration step 2 captures "Niveau l'année dernière" + "Rang l'année dernière"; `computeBilling` passes both so `passage_palier` (−10,000 DZD) and `highest_average` (−10%) can actually fire; the mock's `buildRegistrationBilling` reads them index-aligned so persisted billing matches the preview.
- **Tests:** NEW `src/tests/infrastructure/t-060-payment-ux.test.ts` 7/7 — allocator category semantics vs SQL; source-scan guard (divergent ternary gone); 5AP→1AM fires passage_palier; rank-1 fires highest_average; both stack; absent inputs keep zero.
- **Verification:** typecheck clean; full desktop suite 2086 passed / 5 skipped.
- **Commits:** 68c7d30 — hub repo.

### T-095 — (NEW — opened) Fix run-overdue-scan EF resource exhaustion (BUG-NEW-004)
- **Problems:** BUG-NEW-004 · **Priority:** P1 · **Severity:** High (daily cron + manual scan dead in production)
- **Description:** Rewrite the EF's scan body from the N+1 loop (per-parent compute_parent_summary + per-installment dedup SELECT + single-row INSERTs — 258+ round trips) to the batched pattern of the live-verified desktop reference `SupabaseOverdueAlertGenerator` (T-080/T-094): per tenant ONE overdue-installments query, ONE upcoming-due (7-day) query, chunked parents fetch, chunked dedup-key fetch, ONE bulk INSERT, per-tenant audit entry. Also aligns EF semantics with the reference (upcoming-due alerts included; installment-level classification identical to T-094's verified behavior). Redeploy live + curl matrix with a fresh CRON_SECRET (rotation documented) + idempotency re-check.
- **Dependencies:** none · **Affected:** D (functions) · **Platforms:** Backend
- **Tests:** live curl matrix; second run creates 0 duplicate notifications; desktop T-094 suite stays green.
- **Verification:** evidence in change-log + t-XXX-live-verification doc.

### T-015 — Consolidate receipt numbering to the server algorithm — **TESTED (desktop + backend; Android paths left, toolchain-gated)**
- **Problems:** DRIFT-011 (absorbs BUSINESS-006, BUSINESS-105) · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-08-31, twelfth session + live verification 7/7; migration 0058 applied live + registered atomically)
- **What was done:** migration **0058_receipt_number_server_allocation.sql** — (1) `next_receipt_number(p_tenant_id)` canonical generator, algorithm VERBATIM from 0040:69-72; (2) `generate_receipt_numbers(p_tenant_id, p_count)` batch allocator for the importer (advisory-xact-locked against concurrent allocations; SEC-111-pattern caller verification); (3) `upsert_payment_from_import` (0055 body verbatim + the marked T-015 block) generates a canonical number when p_payment_number is NULL/blank. Desktop: `bulkCollect` allocates missing numbers via ONE generate_receipt_numbers RPC call (replacing `PAY-{ts}-{random}`); the sync-queue payment push passes NULL instead of a random `PAY-YYYY-NNNNNN`; `generateReceipt`'s `REC-${paymentId}` display fabrication replaced with an honest "—" placeholder. The mock's sequential REC- generator is the documented demo mirror (not one of DRIFT-011's five paths — preserved).
- **Tests:** NEW `src/tests/infrastructure/t-015-receipt-server-numbers.test.ts` 7/7 — allocator called once with the exact missing count + allocated numbers stamped in order + explicit numbers kept; allocator NOT called when all inputs carry numbers; allocation failure → Err + zero inserts; count mismatch → Err; source-scan guards (no random PAY- generation left in app code; sync push passes NULL; no REC-${paymentId} fabrication). Full desktop suite 58 files / 2098 tests ALL PASS.
- **Live verification:** `scripts/verify_t-015.sql` 7/7 PASS (BEGIN…ROLLBACK, admin-JWT emulation): 0058 registered; next_receipt_number canonical (REC-2026-000001 — the production year sequence starts fresh, no pre-existing REC-2026 numbers); batch allocation contiguous; cross-tenant allocation REJECTED (SEC-111 pattern); NULL-number upsert generates canonical + was_inserted; explicit-number dedup (insert-then-update) preserved; 0034 trigger syncs receipt_number on the generated row.
- **Left:** the two ANDROID client-side generators (LocalPaymentRepository.collect per-device count+1; SyncQueueDispatcher random PAY- fallback) — toolchain-gated (SDK un-downloadable in this container) AND their proper fix is ADR-005's write-through-canonical-RPCs architecture (T-059, BLOCKED on UNKNOWN-002); a local-format patch now would be premature. Documented residual: allocation-vs-insertion race window with concurrent interactive collect() fails LOUD via payments_tenant_id_payment_number_key (documented in the migration header).
- **Discovery recorded:** the unique constraint is on (tenant_id, payment_number) — receipt_number has NO unique constraint (BUSINESS-006's registry claim was wrong); the 0034 trigger syncs receipt_number := payment_number when NULL.

### T-053 — Desktop global-admin support — **TESTED (unit + typecheck; live E2E gap documented)**
- **Problems:** TENANT-103 · **Priority:** P3 · **Severity:** Medium
- **Status:** TESTED (2026-08-31, twelfth session)
- **What was done:** `getTenantId()` returns the session's WORKING tenant or NULL — the DEMO-UUID fallback is gone (reads with no context return empty; the demo tenant is never silently targeted). NEW `requireTenantId()` throws an explicit French error ("Aucun établissement actif…") — wired into every WRITE path the compiler flagged (audit log, expenses, batch-register ledger charges, manual charges, activation codes). Session model: `tenantId: string | null` (working) + `homeTenantId` (profile home; null = global admin); the auth repository stores the honest null instead of `""`. NEW `TenantSwitcher` in the Topbar (rendered exactly for global admins) — lists active tenants via the canonical `tenants` table (0053 RLS lets global admins enumerate) and calls the NEW `auth.switchTenant(id)` (persist + reload = full cache invalidation). The homework-push modal guards uploads with the same explicit message.
- **Tests:** NEW `src/tests/infrastructure/t-053-global-admin-tenant.test.ts` 9/9 — getTenantId null/no-session/working/global-admin (never the demo UUID); requireTenantId French error; source-scan guards (no demo UUID in getTenantId, honest null in the auth repo, switcher wired, switchTenant persists + reloads); a null-tenant repository read never filters by the demo UUID. 7 existing suites updated to set an explicit session (they relied on the removed fallback — the new contract).
- **Verification:** `npx tsc --noEmit` clean; full desktop suite 59 files / 2107 tests (2102 passed + 5 skipped) ALL PASS; lint 0 errors. Gap (TESTED→VERIFIED): live E2E needs a real global-admin account (only the tenant-bound admin@elimtiyaz.dz exists) — sign in as a global admin, pick a tenant, verify data appears.

### T-022 — Desktop sync queue correctness — **TESTED**
- **Problems:** SYNC-100, SYNC-101, SYNC-102, CACHE-102 · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-08-31, twelfth session)
- **What was done:** defaultPushHandler EXTRACTED to `src/infrastructure/sync/default-push-handler.ts` (was module-private + untestable in sync-provider.tsx). **SYNC-100**: 4 new canonical cases — installment → `upsert_installment_from_import` (0037), attendance → `upsert_attendance_from_import` (0041), grade → `upsert_assessment_from_import` (0041), homework → direct `homework` table upsert (ported verbatim from the Android SyncQueueDispatcher — no import RPC exists); the default case now THROWS (entry marked failed, never silently "synced") — all 15 SyncEntityKind values handled or explicitly rejected. **SYNC-101**: the sync_queue audit-trail upsert uses `{ onConflict: "id", ignoreDuplicates: true }` — re-drains no longer reset the row to "pending"/clear last_error. **SYNC-102**: sign-out clears the queue (auth-provider) + the drain skips entries owned by another actor (defense in depth). **CACHE-102**: `isUsingFallback()` on the store + `queueUsingFallback` snapshot field + the SyncIndicator's explicit "PERDUS à la fermeture" warning state.
- **Tests:** NEW `src/tests/infrastructure/t-022-sync-queue-correctness.test.ts` 12/12 — behavioral (fake client via vi.doMock of the supabase-client seam): installment/attendance/grade RPC args; homework upsert payload incl. attachments JSON parsing + validation failure; unsupported kind (expense) rejects AND records mark_sync_queue_processed('failed') not 'synced'; the audit-trail upsert carries ignoreDuplicates; source-scan guards (sign-out clear, drain actor guard, fallback surfacing); behavioral fallback detection with indexedDB hidden.
- **Verification:** `npx tsc --noEmit` clean; full desktop suite 60 files / 2119 tests (2114 + 5 skipped) ALL PASS; lint 0 errors. Gap: live two-instance sync (two desktops + a real Supabase) — the same recorded-gap pattern as the other sync tasks.

### T-040 — Staff-side justification review workflow — **TESTED**
- **Problems:** ATT-101 · **Priority:** P2 · **Severity:** High
- **Status:** TESTED (2026-08-31, twelfth session)
- **What was done:** the 4-state workflow (none → submitted → accepted/rejected, migration 0043) is now a CLOSED loop. Desktop: `AttendanceRecord` gains the 6 justification fields (+ `JustificationStatus` type); `mapAttendanceRow` reads the columns; `AttendanceRepository` gains `observeJustifications(status?)` (tenant-scoped review queue, newest first) + `reviewJustification({recordId, decision, reviewedBy})` (UPDATE status + reviewer + timestamp, guarded `justification_status <> 'none'`; a previous decision may be overturned — documented correction path); both implemented in the Supabase AND Mock repositories (demo parity). NEW "Justificatifs" tab in the Academics hub (ViewAttendance/RollCall-gated, pending-count badge): the submitted queue with student name, date/session, the parent's note + Drive link + attachment indicator, and Accept/Reject actions wired to the signed-in session identity. The website needs NO change — its pill already renders all 4 states (verified); the states become REACHABLE now that staff can decide.
- **Tests:** NEW `src/tests/infrastructure/t-040-justification-review.test.ts` 8/8 — mapAttendanceRow reads the justification columns; the UPDATE carries status+reviewer+timestamp with the `<> 'none'` guard; non-UUID validation; observeJustifications filters tenant+submitted; source-scan guards (tab wired + count, Accept/Reject wired with session identity, domain contract, mock parity).
- **Verification:** `npx tsc --noEmit` clean; full desktop suite 61 files / 2127 tests ALL PASS; lint 0 errors. Gap: live portal→desktop→portal round-trip needs real parent submissions (attendance tables are empty in production — DATA-006 onboarding).

### T-095 — run-overdue-scan EF batched rewrite — **VERIFIED (live)**
- **Problems:** BUG-NEW-004 · **Priority:** P1 · **Severity:** High (daily cron + manual scan dead in production)
- **Status:** VERIFIED (2026-08-31, twelfth session — live deploy + curl matrix + idempotency + zero-duplicate evidence)
- **What was done:** the EF's N+1 scan body (per-parent compute_parent_summary + per-installment dedup SELECT + single-row INSERTs — 258+ round trips, WORKER_RESOURCE_LIMIT) rewritten to the BATCHED pattern of the T-094-verified desktop reference `SupabaseOverdueAlertGenerator`: per tenant ONE overdue query (status ≠ paid/cancelled, due_date < as_of, remaining > 0.001 = INV-4), ONE upcoming-due (7-day) query (the desktop's second pass — EF ≡ desktop now), ONE chunked parents fetch, ONE chunked dedup-key fetch, ONE bulk INSERT, unchanged per-tenant audit. The compute_parent_summary account gate dropped (the verified reference classifies at installment level). Redeployed live (v14).
- **Live verification:** `docs/recovery/t-095-live-verification.md` — curl matrix 401×3 (no-auth / invalid / anon); valid CRON_SECRET (rotated + hash-verified) → **200 in 8.6–10.9 s** (previously WORKER_RESOURCE_LIMIT); 819 overdue / 68.13M DZD / 819 urgent; second run identical with 0 new alerts; notifications count stays 819 across THREE runs (zero duplicates — dedup key ≡ desktop). CRON_SECRET rotation documented safe (no pg_cron schedule uses it).
- **Registered micro-divergence:** the EF excludes `cancelled` installments; the desktop generator filters status ≠ 'paid' only — the EF is stricter/correct; desktop filter alignment is an optional one-line follow-up.
- **Commits:** (this session) — hub repo.

### T-052 — Notification badge correctness — **TESTED**
- **Problems:** NOTIF-102, NOTIF-103 · **Priority:** P3 · **Severity:** Low
- **Status:** TESTED (2026-08-31, twelfth session — desktop + website)
- **What was done:** NOTIF-102 (desktop): the topbar's unreadCount is computed from the FULL visible list — the 8-item slice is a dropdown display limit only (was: count-after-slice, badge capped at 8 with 50 unread). NOTIF-103 (website): NEW `useUnreadNotificationCount` hook (COUNT-only query: `head: true` + `count: "exact"` — zero rows transferred; same direct + parent-broadcast delivery paths as useNotifications); the top-app-bar uses it (no 50-cap); the DEAD unread queries removed from BottomNav AND DesktopRail (they fetched 1 row, computed a boolean no JSX rendered — 3 concurrent notification queries → 1).
- **Tests:** NEW website `src/test/t-052-notification-badge.test.ts` 3/3 — desktop count-before-slice source guard; the COUNT-only hook's shape; the top bar's usage (no length pattern); the dead queries gone. Website suite 126/126 (122+4 incl. re-verification); desktop suite 2127 unaffected.
- **Verification:** desktop tsc clean + suite green; website strict build green + lint clean. Gap: live badge with >50 unread (needs a real parent account with broadcast notifications).

### T-057 — Website canonical port honesty — **TESTED**
- **Problems:** DRIFT-009 (absorbs DEAD-011) · **Priority:** P3 · **Severity:** Medium
- **Status:** TESTED (2026-08-31, twelfth session — website repo commit d7eb52e)
- **What was done:** the canonical port PRUNED to the consumed surface — 15 files deleted (calc/payment/* ×6, calc/pricing/* ×5, calc/ledger/{entries,charges}.ts, model/pricing.ts, the never-imported index.ts barrel); 11 source files kept (balance/overdue/money/dates + account-id [portal-derive.test exercises deriveAccountId — a consumer the audit missed] + the 5 model files + portal-derive). The ledger/payment model re-export blocks trimmed to the kept surface. Every kept header rewritten honestly: verbatim port + desktop source path + sha256 + an explicit never-re-add note — replacing the DEAD-011 lie ("re-run scripts/port-canonical.mjs" — never existed). The alternative (implementing the script) deliberately NOT taken: a full-tree copier would resurrect the dead code.
- **Tests:** NEW website `src/lib/canonical/t-057-port-honesty.test.ts` 4/4 — dead subtrees stay gone; the exact kept-surface inventory; no lying header; honest header shape. Website suite 13 files / 130 tests ALL PASS; strict build green; lint clean.
- **Commits:** d7eb52e — website repo (+ this doc commit — hub).

### T-055 — Audit robustness and PII masking — **TESTED (desktop client + EFs deployed live)**
- **Problems:** SEC-001, SEC-002 · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-08-31, twelfth session; all 8 EFs redeployed live + post-deploy sanity 401/200)
- **What was done:** SEC-002: NEW `hasMaskedContent()` guard — BOTH network LLM transports (edge ai-proxy + BYOK Groq/OpenRouter) REFUSE (Err) when `maskedContent` is empty/whitespace (the old `|| userPrompt` fallback shipped the raw prompt — PII — over the network); the check precedes the configuration check; the local mock keeps working with the raw prompt (it never leaves the machine). SEC-001: `writeAuditLog` RETRIES once (250 ms) then THROWS the NEW typed `AuditWriteError` (loud `[AUDIT-MISS]` marker) — no more silent null returns; NEW `withAuditSurfacing()` wrapper converts the throw into a structured 500 `audit_write_failed` response; ALL 8 EFs that call writeAuditLog are wrapped; run-overdue-scan instead CATCHES per-tenant and counts `audit_failures` in its summary (surfaced, scan survives — notifications already created).
- **Tests:** NEW `src/tests/security/t-055-audit-pii.test.ts` 9/9 — BYOK refuses empty + whitespace masks; edge refuses empty (before any invoke); the default routing degrades to the LOCAL mock with no leak; code-level source-scan (no `maskedContent || userPrompt`); writeAuditLog retry+throw shape; withAuditSurfacing's 500; all 8 EFs wrapped; run-overdue-scan's audit_failures counter. Full desktop suite 62 files / 2136 tests ALL PASS.
- **Live verification:** all 8 EFs redeployed (esbuild bundle checks green); post-deploy sanity on run-overdue-scan: anonymous → 401; valid CRON_SECRET → 200 with the NEW `audit_failures: 0` field present (the audit entry wrote cleanly).
- **Left:** a live forced-audit-failure probe (e.g. revoking the RPC grant temporarily) — deliberately not performed on the production DB.

### T-018 — Enforce deterministic identity codes — **TESTED (desktop + sync portion; PARTIAL)**
- **Problems:** DRIFT-001 (absorbs DEAD-001, DEAD-003, DEAD-005, DEAD-006, PARENT-100) · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-08-31, twelfth session — desktop + sync layer; the backend + Android halves left, see below)
- **What was done:** the canonical generators (stableHash + deterministicParentCode + deterministicStudentCode) MOVED from supabase-shared-repositories.ts to their ADR-003 canonical home `core/format/id.ts` (re-exported for the import-path consumers); the generators' empty-identity fallback is NO LONGER RANDOM — a stable seed (the caller's queue-entry id) keeps RETRIES converging on the same code (a random retry suffix created a DUPLICATE parent/student server-side since the dedup match IS the code). The sync push handler's two random fallbacks (`PAR-YYYY-{random4}`, `ELV-YYYY-{random6}`) replaced with the canonical generators seeded by `entry.id`.
- **Tests:** NEW `src/tests/infrastructure/t-018-identity-codes.test.ts` 7/7 — stability + format; identity-field-order invariance; empty-identity seed stability (retry-stable); whitespace-field exclusion (the cross-platform rule); the canonical home + re-export; no random PAR-/ELV- code lines in the push handler; no Math.random in the generator section. Full desktop suite 63 files / 2143 tests ALL PASS.
- **Left (honest scope):** the backend generators (approve-signup-request EF's parent-code creation; batch_register_family RPC — needs a migration) and the Android create/batch/dispatcher paths (toolchain-gated) remain on DRIFT-001; the mock layer's create() random suffix intentionally preserved (it mirrors the canonical server CREATE path — migration 0022's gen_random_bytes — not the import path's determinism rule).


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

### T-065 — Website copy and comment accuracy
- **Problems:** WEAK-023, DRIFT-010 · **Priority:** P3 · **Severity:** Medium/Low
- **Status:** TESTED (2026-08-29, sixth repair session)
- **What was done:** both defects were source comments that contradicted the code under them. (1) WEAK-023 — `useUnreadChatCount`'s comment claimed "the latest 200 messages per channel" while the query fetches the latest 500 `chat_messages` rows TOTAL with no channel filter; the comment now states the true semantics (500 rows total via RLS-exposed channels; the count is a LOWER BOUND beyond that window) and records that exact counting (channel-scoped fetch or server-side counter) is deliberately deferred to T-032's chat rework while chat has no production writers (CHAT-103 / UNKNOWN-005) — the query itself is unchanged by design. (2) DRIFT-010 — the attendance-view header said "The portal CANNOT submit justifications — that's a desktop workflow" while the view imports, renders and wires AbsenceJustificationDialog; the header now states the portal both DISPLAYS the 4-state justification status AND SUBMITS (storage upload + `attendance_records` update). (3) Same accuracy class, recorded during the task: the website repo's own AGENTS.md still claimed mock-auth was wired (removed in T-009) and the build ignored type errors (fixed in T-049) — synced to reality.
- **Tests:** NEW `src/lib/hooks/comment-accuracy.test.ts` (2 tests) — source-scan guards pinning the stale phrases out, the corrected notes in, and the dialog wiring the corrected comment describes kept present (T-001/T-002 technique; both tests fail against the pre-fix sources by construction).
- **Verification:** `npm run test` → 92/92 (90 baseline + 2 new); `npm run build` → compiled successfully WITH TypeScript running (strict); `npm run lint` → exactly the 2 documented pre-existing `react-hooks/preserve-manual-memoization` errors, none added. Runtime behaviour byte-identical (comments + new test file only, plus the AGENTS.md doc sync).
- **Commits:** 5654074 — website repo.

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

### Phase 4 — Feature pipelines & cleanup (P2/P3)

#### T-036 — Rebuild the push notification pipeline — **partially blocked** *(PUSH-103 portion COMPLETED 2026-08-31, 13th session — see the Completed section; PUSH-100/101/104 remain)*
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

#### T-050 — ~~Android connectivity & pull efficiency~~ *(moved to Completed — 13th session)*
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

#### T-058 — ~~Adopt append-only migration discipline~~ *(moved to Completed — 13th session)*
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

### T-083 — Fix the `expire_pending_approvals()` SQL RPC (BUG-NEW-001, discovered during T-004 verification)
- **Problems:** BUG-NEW-001 · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-08-30, eighth session — folded into T-084's migration 0049)
- **What was done:** migration `0049_dashboard_kpis_fanout_expire_fix.sql` rewrote `expire_pending_approvals()` as a single data-modifying CTE over `account_approval_requests` (status='pending' AND expires_at < now() → 'expired'), returning per-tenant counts. Applied LIVE to hkvkefubghbbotgnteir via the Management API SQL endpoint; verified live: function body references the correct table (prosrc check), `SELECT * FROM expire_pending_approvals()` executes cleanly, approval-request status counts correct (2 approved, 1 expired, 0 stuck pending).
- **Left:** the EF round-trip with a valid CRON_SECRET (value not available in-session); the EF's own error-path audit entry (unmodified in this session).
- **Commits:** see change-log session 8.

### T-084 — Live backend health check + KPI matview repair + FCM token hardening + portal UI restructure (session 8, owner-requested)
- **Problems:** BUG-NEW-002, BUG-NEW-003, SEC-106, SYNC-104, SYNC-105, PUSH-102 (partial), DATA-005 (mitigation), WEAK-018/019 family (residuals) · **Priority:** P0 · **Severity:** Critical
- **Status:** TESTED (2026-08-30) — Android half IMPLEMENTED (compile check pending)
- **What was done:**
  1. **Live backend health check** (owner priority 2): full inventory + integrity + RLS + MV + RPC + auth census — archived as `docs/audits/backend-health-check-2026-08-30.md` (11 findings F-01…F-11 → DATA-001…007 + BUG-NEW-002/003 registered).
  2. **Migration 0049** (applied live): mv_dashboard_kpis fan-out fixed (21.38B → true 54.96M, verified byte-identical to the payments cross-check); unique indexes on all 4 MVs (REFRESH CONCURRENTLY now works — verified live); expire_pending_approvals rewrite (T-083).
  3. **Migration 0050** (applied live): register_fcm_token caller verification (SEC-106 — auth.uid() must own p_user_id, service_role exempt, SQLSTATE 42501 on mismatch) + new canonical deactivate_fcm_tokens RPC (SYNC-104/105 path). Verified live: verification logic present in prosrc, EXECUTE granted to authenticated.
  4. **Website portal UI restructure** (owner priority 1): FinancialView restructured around the real data model — tabs now Tranches | Paiements | **Relevé** (NEW ledger statement timeline with running balance, month grouping, category badges) | Ajustements (derived from ledger_entries — 318 live rows — instead of the empty account_adjustments table); dead invoices/receipts standalone tabs removed (0 rows / orphaned table, CROSS-101); 4 canonical KPIs (outstanding/overdue/paid/credit) with correct labels; payment rows show REAL status + payment_number + category (was hardcoded "paid"); installment rows show label + category + plan; all hardcoded French strings moved to i18n (fr/ar/en + all new keys); honest empty states everywhere. Dashboard: greeting uses display_name (formatParentName — first_name empty on all 258 production rows), KPI grid financial-first (the old attendance/GPA tiles were permanently dead "—" on empty academic tables). New pure derivations ledgerTimeline/ledgerAdjustmentEntries in portal-derive (canonical layer) with 9 new unit tests. notifications query now includes parent-role broadcasts (query-side half of REALTIME-102). Fixed the 2 long-standing React-Compiler lint errors (preserve-manual-memoization) — `npm run lint` is CLEAN for the first time.
  5. **Website tokens** (SYNC-105): signOut now unregisters the device token (canonical RPC, RLS-scoped fallback) BEFORE revoking, and uses scope:'local' instead of 'global'.
  6. **Android tokens** (SYNC-104): LocalAuthRepository.signOut deactivates Android tokens via the canonical RPC before revoking the JWT (Hilt-cycle-free design — direct provider call, documented); FcmTokenRegistrar gained the matching deactivate() for symmetry.
  7. **Credentials sheet** (owner priority 3): `docs/operations/credentials.md` — canonical backend identity, per-platform credential sources, key registry with scope rules, FCM lifecycle table, rotation + verification procedures. Website `.env.example` committed (real public URL, gitignore exception added).
- **Tests:** website `npm run build` STRICT green; `npm run lint` 0 errors; `npm run test` 8 files / 105 tests ALL PASS (+9 new); live SQL verification suite for migrations 0049/0050 (values, indexes, prosrc, grants, refresh). Gap: Android compile (no SDK in session env — code follows the exact established patterns in the same files); live browser round-trip; EF round-trip with CRON_SECRET.
- **Commits:** see change-log session 8.

---

### T-085 — Live-data reconciliation (owner decision required) — DATA-001…DATA-005
- **Problems:** DATA-001 (payment_allocations empty / waterfall never run), DATA-002 (three-way totals disagree for parent e3e90f1f), DATA-003 (ledger charges ≠ installment dues, 197/258 parents, Δ7.62M), DATA-004 (59 overpayers, NULL excess fields), DATA-005 (first_name empty on all rows)
- **Priority:** P0 (financial correctness) · **Severity:** Critical
- **Description:** NOT a code task — a supervised data-repair campaign. Sequence: (1) forensic pass on parent e3e90f1f's 1,750/10,000 DZD discrepancies → owner decides which source is truth; (2) classify the 7.62M of ledger-only charges (what do they represent — registration? supplies? transport annual?); (3) one-time backfill replaying all 888 payments through the canonical waterfall to generate payment_allocations + link payments.installment_id (+ populate expected/excess per DATA-004); (4) first_name split from display_name. Every step needs owner sign-off because it rewrites financial history.
- **Dependencies:** owner decisions · **Affected:** B (data only) · **Platforms:** all
- **Verification:** re-run the session-8 health check → zero three-way disagreements; payment_allocations populated and internally consistent; first_name non-empty.

### T-086 — Parent-portal onboarding campaign — DATA-006
- **Problems:** DATA-006 · **Priority:** P1 (operational) · **Severity:** Medium
- **Description:** The portal is code-complete but has zero eligible users (1/258 parents with email, 0 activation codes, 0 auth bindings, 0 parent-targeted notifications, empty academic tables). Work with the school: collect parent emails, generate + distribute activation codes via the desktop feature, approve the requests, have staff start recording attendance/grades/homework. Not engineering-blocked.
- **Dependencies:** school-side action · **Verification:** first real parent signed in; first parent-targeted notification delivered.

### T-087 — Test-residue cleanup — DATA-007
- **Problems:** DATA-007 · **Priority:** P3 · **Severity:** Low
- **Description:** Drop `_eq_test_fn`/`_eq_test_fn2` RPCs (equivalence-harness leftovers exposed via REST), delete the unconfirmed `test.connection.supabase@gmail.com` auth user and its expired account_approval_request. One small migration + auth admin call; no production code references them.
- **Dependencies:** none · **Verification:** REST RPC inventory no longer lists the test functions; auth user list shows only real users.

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

---

## Ninth recovery session (2026-08-30, owner-requested)

### T-088 — Restructure desktop Dashboard UI: eliminate duplication + dead code (ARCH-010)
- **Problems:** ARCH-010 (new)  · **Priority:** P0 · **Severity:** High (UX defect — owner-requested)
- **Status:** TESTED (2026-08-30)
- **What was done:**
  - DashboardPage: ONE fetch at the page level (kpis + revenue + debtAging + demographics + topDebtors), passed DOWN to both OverviewTab and SeeDetailsModal as props — no second fetch when the modal opens.
  - OverviewTab: restructured into 8 KPI cards (4 financial + 4 operational), DashboardCalendar (operational), Top Debtors quick-list. No duplicate charts. Dead bottom Stat card removed.
  - SeeDetailsModal: receives ALL data via the `data` prop. Departments sub-tab stops calling `repos.payments.observe().get()` (mock-only leak); it derives from the page-level revenue series + an honest empty state when per-category data isn't exposed.
  - ReportsTab: dead "PDF" format badge removed from "Revenu mensuel" card (the handler returned a "Bientôt disponible" toast — a fake feature). XLSX is the only advertised format now.
  - Unread alerts badge added to the Alerts tab via the `count` + `countTone` PageTab props — a real operational signal that was previously hidden.
- **Tests:** new regression suite `src/tests/ui/dashboard-restructure.test.tsx` (10 tests) — asserts the duplicate charts are gone, the dead Stat card labels are gone, the KPI grid is 8 cards, the routing is correct (Unread Alerts → Alerts tab; every other KPI → drill-down).
- **Verification:** typecheck clean; lint 0 errors; 47/2029 tests ALL PASS (was 46/2021).
- **Commits:** see change-log session 9.
- **ADRs:** —

### T-080 — Port the desktop overdue-scan to Supabase (kill the mock leak in Supabase mode) — ARCH-006
- **Problems:** ARCH-006  · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-30)
- **What was done:**
  - New `SupabaseOverdueAlertGenerator` class in `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-overdue-alert-generator.ts`. Scans `installments` for overdue + upcoming-due rows, dedups against `notifications` (by `link_entity_type='installment'` + `link_entity_id`), bulk-INSERTs new `payment_overdue` notifications targeting `financial_officer`, writes a best-effort audit entry via the canonical `write_audit_log` RPC.
  - Mirrors the `MockOverdueAlertGenerator` contract: priority urgent>90d/high 31-90d/medium 0-30d; display_name preferred (per F-06/DATA-005 — first_name is empty on all 258 production rows).
  - Wired into the Supabase assembly (overrides the `overdueAlerts` slot).
  - Also re-exported from `supabase-repositories.ts`.
  - Removed the auto-run on mount (`repos.overdueAlerts.run()` in dashboard-page.tsx) — the dashboard no longer scans mock seed data on every page load.
- **Tests:** new unit suite `src/tests/infrastructure/supabase-overdue-alert-generator.test.ts` (8 tests) — happy path, priority buckets, dedup, upcoming-due window, name fallback, fully-paid-despite-status filter, and the empty-when-no-installments case.
- **Verification:** typecheck clean; lint 0 errors; 47/2029 tests ALL PASS (was 46/2021).
- **Left:** live integration against the real backend (the unit tests use a fake Supabase client surface). Run the overdue scan against production data and verify the notification count + audit entry.
- **Commits:** see change-log session 9.
- **ADRs:** —

### T-089 — Implement the 4 hardcoded Supabase KPIs against real data (ARCH-010 part 2)
- **Problems:** ARCH-010 (sub-defect — the 4 hardcoded zeros)  · **Priority:** P0 · **Severity:** High
- **Status:** TESTED (2026-08-30)
- **What was done:**
  - `SupabaseDashboardRepository.kpisForRange()` no longer returns `totalStaff: 0` / `pendingExpenses: 0` / `attendanceRateToday: 0` / `overdueAlerts: 0`. Each is now a real query:
    - `totalStaff`: COUNT(*) FROM personnel WHERE tenant_id AND deleted_at IS NULL (migration 0010)
    - `pendingExpenses`: COUNT(*) FROM expense_tickets WHERE status='pending_approval' (migration 0008; DRIFT-013 mitigation — the desktop domain uses 'submitted' but the DB column uses 'pending_approval'; wider expenses-repository port is T-093)
    - `attendanceRateToday`: (present + late) / total from attendance_records for today, falling back to the most recent date with records (mirrors the mock's fallback; canonical rate per WEAK-019 / T-027; migration 0009)
    - `overdueAlerts`: COUNT(*) FROM notifications WHERE kind='alert' AND link_entity_type='installment' AND is_read=false (migration 0013)
- **Discovery (DRIFT-013):** the desktop code calls `.from("expenses")` — a table that DOES NOT EXIST in the live schema. The canonical table is `expense_tickets` (migration 0008). The dashboard KPI now uses the correct name. The wider expenses-repository leak (the assembly still uses MockExpensesRepository) is task T-093.
- **Tests:** covered by the existing dashboard-restructure test suite (the KPI grid is asserted to render the 4 operational KPIs with the right tone/hint); no separate KPI test added (would require mocking the entire Supabase client surface for 4 trivial COUNT queries).
- **Verification:** typecheck clean; lint 0 errors; 47/2029 tests ALL PASS. Live SQL verification via `scripts/verify_t-089.sh`: totalStaff=0 (honest — personnel empty in production); pendingExpenses=0 (no pending_approval tickets); attendanceRateToday=0 (attendance_records empty); overdueAlerts=269 (matches the audit doc).
- **Commits:** see change-log session 9.
- **ADRs:** —

### T-091 — Migration 0050 drift reconciliation: create 0051_chat_read_receipts.sql (ARCH-009)
- **Problems:** ARCH-009 (new)  · **Priority:** P1 · **Severity:** High (process)
- **Status:** TESTED (2026-08-30)
- **What was done:**
  - Added migration `0051_chat_read_receipts.sql` to the local repo. Idempotent (`drop policy if exists + create policy + create or replace function + drop trigger if exists + create trigger`). The SQL is byte-identical to what's registered as version 0050 in the live DB's `supabase_migrations.schema_migrations` (extracted via `scripts/extract_migration_0050_live.sh`).
  - Applied the migration SQL live via the Management API SQL endpoint (idempotent no-op since the policy + trigger + function already exist on the live DB).
  - Registered migration 0051 in `supabase_migrations.schema_migrations` via the Management API SQL endpoint (idempotent `INSERT … ON CONFLICT (version) DO NOTHING`, with dollar-quoting `$$mig$...$$mig$` for the statements text so the migration's own `$$` plpgsql markers don't conflict).
  - Documented the drift + lessons for next agents in the problem registry (ARCH-009 entry).
- **Verification:** `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('0050', '0051') ORDER BY version;` returns both rows. Policy + trigger + function still intact (verified via `pg_policies` / `pg_trigger` / `pg_proc`).
- **Lessons for next agents:** applying SQL via the Management API SQL endpoint does NOT update `schema_migrations`. To register a migration applied this way, INSERT into `supabase_migrations.schema_migrations` manually using dollar-quoting for the statements column.
- **Commits:** see change-log session 9.
- **ADRs:** ADR-001 (canonical migration chain)

### T-087 — Test-residue cleanup (DATA-007) — COMPLETED
- **Problems:** DATA-007  · **Priority:** P3 · **Severity:** Low
- **Status:** TESTED (2026-08-30)
- **What was done:**
  - Migration `0052_drop_test_residue.sql` (idempotent `drop function if exists public._eq_test_fn() / _eq_test_fn2()`) — committed + applied live.
  - Auth user `test.connection.supabase@gmail.com` deleted via SQL directly (auth schema is not in the public migration chain, but the Management API SQL endpoint runs as service_role and can DELETE from auth.users).
  - Expired `account_approval_request` row tied to the test user deleted.
  - Migration 0052 applied live + registered in schema_migrations (via the same dollar-quoting pattern as T-091).
- **Tests:** `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name LIKE '_eq_test%';` returns 0 rows. `SELECT id, email FROM auth.users;` returns 1 row (`admin@elimtiyaz.dz`). `SELECT * FROM account_approval_requests WHERE auth_user_id = '...';` returns 0 rows.
- **Commits:** see change-log session 9.
- **ADRs:** ADR-001 (canonical migration chain)

### T-092 — Migration token consistency across all platforms (DRIFT family + credentials sheet)
- **Problems:** — (process/hygiene; not a registered defect)  · **Priority:** P3 · **Severity:** Low
- **Status:** TESTED (2026-08-30) — gap closure 2026-08-31 (verify_t-092.sh promoted to in-repo)
- **What was done:**
  - Android `.env.example` updated to reflect the canonical Supabase URL (https://hkvkefubghbbotgnteir.supabase.co) + clarify that Firebase config comes from `google-services.json` (not env vars).
  - Verification script `scripts/verify_t-092.sh` confirms all three platforms point to the same Supabase project (website .env.example + Android .env.example + desktop runtime settings dialog + credentials.md). 7/7 checks pass.
  - Live auth health endpoint verified (HTTP 200).
  - **2026-08-31 gap closure:** the verify_t-092.sh script was originally written to `/home/z/my-project/scripts/` (outside the repo) and did not persist across sessions. Re-created as `scripts/verify_t-092.sh` at the hub repo root (in-repo, recoverable). Also corrected the credentials.md §2 desktop row (was pointing at a non-existent `SupabaseClientProvider.build()` file) and added §2.1 JWKS URL canonical section. See change-log entry "TENTH REPAIR SESSION".
- **Tests:** verification script.
- **Verification:** 7/7 checks pass.
- **Commits:** see change-log session 9.
- **ADRs:** ADR-001 (canonical migration chain)

### T-093 — (NEW — opened) Port desktop `expenses` repository to Supabase (DRIFT-013)
- **Problems:** DRIFT-013 (new)  · **Priority:** P2 · **Severity:** High
- **Status:** Ready
- **Description:** the desktop code calls `.from("expenses")` (the domain model + mock store use this name) but the canonical table is `expense_tickets` (migration 0008). The desktop `ExpenseStatus` enum (`draft|submitted|approved|rejected|disbursed|settled`) does NOT match the DB column (`draft|pending_approval|approved_funds_released|rejected|disbursed|settled_and_closed`). The dashboard KPI was mitigated in T-089 (uses the correct name + status); the wider expenses-repository port is this task. Plan: (1) implement `SupabaseExpenseRepository` with a translation layer; (2) override the `expenses` slot in `supabase-repositories.ts`; (3) decide whether to align the desktop `ExpenseStatus` enum to the DB values (preferred per AGENTS.md §15.9 + ADR-001) or keep a mapping layer (per AGENTS.md §15.5 — never weaken canonical server rules to make a client work, but a client-side mapping is acceptable); (4) regression-test with both assemblies' contracts.
- **Dependencies:** none technical; needs product confirmation on the status-value rename.
- **Affected:** Desktop · **Platforms:** Desktop, Backend

### T-094 — (NEW — opened) Live integration test for `SupabaseOverdueAlertGenerator` (T-080 follow-up)
- **Problems:** ARCH-006 (live-integration gap)  · **Priority:** P2 · **Severity:** Medium
- **Status:** Ready
- **Description:** T-080 closed the mock-leak defect with unit tests (8 tests, fake Supabase client). The live-integration verification — run the generator against the real Supabase backend, verify that the 269 existing notifications + new insertions work as expected — is this task. Plan: (1) sign in as admin; (2) trigger the "Scan retards" button or invoke `repos.overdueAlerts.run()` directly; (3) verify new notifications are inserted (or the dedup path returns 0 new if all installments already have alerts); (4) verify the audit entry appears in `audit_logs`.
- **Dependencies:** none.
- **Affected:** Desktop · **Platforms:** Desktop, Backend


### T-006 — Verify callers and tenants in SECURITY DEFINER RPCs — **Completed (TESTED)**

- **Problems:** SEC-110 (+STUDENT-101, PARENT-103), SEC-111, SEC-112 · **Priority:** P0 · **Severity:** High
- **Status:** TESTED (2026-08-31, tenth session) — migration 0055 applied LIVE + registered (`sec_definer_rpc_hardening`); `scripts/verify_t-006.sql` 9/9 PASS against the live DB (JWT contexts emulated via request.jwt.claims): S1 EF-path bind ok; S2 direct self-bind ok + PARENT-103 audit row; S3 foreign bind rejected (SEC-110); S4 anonymous rejected; S5 silent re-bind rejected; S6 service_role upsert ok; S7 foreign-tenant upsert rejected (SEC-111); S8 same-tenant refund ok + audit stamped with the payment's tenant; S9 cross-tenant refund rejected. Commit 8d317e2.
- **Deviation recorded:** bind_activation_code exempts service_role callers (the canonical EF path passes the verified JWT's userId via a service_role client — a hard auth.uid() equality check would break the product's activation flow).
- **Run-discovery:** upsert_payment_from_import's p_student_id has NO default (unchanged signature) — callers must pass it; documented in the verify script.

### T-008 — Constrain role assignment in approve-signup-request — **Completed (TESTED)**

- **Problems:** SEC-107 · **Priority:** P0 · **Severity:** High
- **Status:** TESTED (2026-08-31, tenth session) — shared decision core `_shared/role-assignment.ts` (staff roles require super_admin); unknown codes -> 400 invalid_role (was: silent skip); 403 + `account_approval.role_override_denied` audit on staff-role attempts; revoke/insert writes error-checked. 12/12 tests; deployed live (v10, Management API multipart deploy — the multi-file deploy path now proven twice); 401 smoke matrix green. Commit e575540. GAP: live 403 needs a real support_staff JWT.
- **Deviation recorded:** the entry's "safe subset (parent)" generalised to "non-staff roles" (parent/student, the roles.is_staff_role=false set) — same zero-privilege risk class; the flag is read from the roles TABLE, no hardcoded lists.

### T-093 — Port desktop expenses repository to Supabase — **Completed (TESTED)**

- **Problems:** DRIFT-013 (+NEW WEAK-030 registered) · **Priority:** P2 · **Severity:** High
- **Status:** TESTED (2026-08-31, tenth session) — `SupabaseExpenseRepository` with a centralised status/category translation layer; migration 0056 added the missing `payee` column (applied live + registered); `expenses` slot overridden in the Supabase assembly; no `.from("expenses")` call sites remain. 12/12 adapter tests; typecheck clean; full desktop suite 49 files / 2053 tests PASS. Commit 1e91ebf. LEFT (deliberate): domain enum alignment to DB values; WEAK-030 (server-side approval rules); server-authoritative ticket numbers.

### T-094 — Live integration test for SupabaseOverdueAlertGenerator — **Completed (VERIFIED)**

- **Status:** VERIFIED (2026-08-31, tenth session) — env-gated live suite `src/tests/integration/t-094-overdue-live.test.ts` 5/5 against the real project: run() scans 819 overdue installments and returns 0 new (dedup fully covers — independently cross-checked); INSERT path accepts the generator payload (self-cleaning sentinel); write_audit_log accepts the audit shape (append-only verification entry left intentionally). Commit ed901b3. GAP: desktop UI invocation needs a desktop host.

### T-032 — Repair the website realtime layer — **Completed (TESTED)**

- **Problems:** REALTIME-100/101/102/103, WEAK-016 (REALTIME-101 backend = 0051, already live) · **Priority:** P2 · **Severity:** High
- **Status:** TESTED (2026-08-31, tenth session, website commit 7b8983e) — invalidation key fixed (with an executable partialMatchKey proof of the root cause), markRead errors surfaced, notifications subscription unfiltered (RLS-scoped events cover role/tenant broadcasts), NEW useChatUnreadRealtime mounted once in AppShell, homework realtime on the canonical `homework`/class_id. Website suite 117/117; lint clean; strict build green. GAP: live two-session websocket test; NOTIF read-state remains UNKNOWN-007/T-038.

### T-035 — Website financial KPI correctness — **Completed (TESTED)**

- **Problems:** WEAK-022, WEAK-018 · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-31, tenth session, website commit e9587e0) — fetchAllLedgerEntries pages the full ledger (1000/row pages) replacing the 500 cap at both call sites (5/5 tests incl. a 1500-row two-request case); WEAK-018 found ALREADY FIXED in the session-8 restructure (registry corrected + pinning test; no code change).

### T-056 — Desktop low-risk hygiene batch — **Completed (TESTED)**

- **Problems:** WEAK-003, WEAK-004, DEAD-002, DRIFT-005, WEAK-020, DEAD-014 · **Priority:** P3 · **Severity:** Low
- **Status:** TESTED (2026-08-31, tenth session) — 6/6 items, one commit per item (6e24cd3, e63ae97, e412e44 + website 3c1b430): mapLedgerRow actor_id fallback removed; ledger seed uses canonical tranche due dates; handleDelete routed; server_secret.* in AuditActions + EF redeployed; paymentStatusTone covers the 2 missing statuses with fr/ar/en keys; database-schema barrel removed. Desktop t-056-hygiene suite + website suite green.

### MIG-TOKENS — Migration-token + live-chain consistency (session-10 opening) — **Completed (TESTED)**

- **Problems:** ARCH-011 (new) · **Priority:** P0
- **Status:** TESTED (2026-08-31) — discovered 0053/0054 applied live but absent from the repo (ARCH-011); reconciled both files from live definitions (commits 4bf5ff1); dry-run verified in BEGIN..ROLLBACK (HTTP 201); migrations 0055 + 0056 then followed the corrected discipline: file + live application + registration in the SAME commit. Live chain head now 0056 with the local chain matching one-to-one.
