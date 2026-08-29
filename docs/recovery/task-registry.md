# Task Registry — Master Recovery Task List

> **This is the authoritative todo list for all remaining work.** Agents must not create separate task lists, TODO files, or progress notes anywhere. Status transitions follow `definition-of-done.md`; completion evidence goes to `change-log.md`.
>
> **Evidence base:** every task below was derived from the problem registry, which consolidates the two archived audit reports in [`docs/audits/`](../audits/README.md) (86 + 99 findings). When a task's problem entry is not detailed enough, read the raw finding in the audit files — full end-to-end traces and git forensics live there.
> **Commit rule (AGENTS.md §14):** every commit must state the task completed, what is left, what was changed, what was verified, and the next task.
>
> Statuses: `Not Started` · `Needs Investigation` · `Ready` (understood, dependencies cleared) · `In Progress` · `Blocked` · `Deferred`. Within `Ready`, work P0 → P1 → P2 → P3. Pick tasks via `next-task.md`.

## Progress summary (2026-08-29, updated after the second repair session — T-003)

| Status | Count | Tasks |
|---|---|---|
| **Completed (VERIFIED)** | 1 | T-000 |
| **Completed (TESTED)** | 3 | T-001, T-003, T-009 (regression-tested; live-environment verification pending — see change-log) |
| **Completed (IMPLEMENTED)** | 1 | T-010 (launch verification needs a desktop host) |
| **In Progress** | 0 | — |
| **Ready** (understood, dependencies cleared) | 57 | T-002, T-004…T-008, T-011…T-027, T-029…T-035, T-039…T-041, T-043, T-044, T-046, T-048…T-058, T-060…T-065, T-068, T-069, T-071, T-078 (new — desktop ESLint config, DEAD-201) |
| **Partially blocked** | 1 | T-036 (EF-internal fixes unblocked; wiring pending provider/scope decisions) |
| **Blocked** | 10 | T-028, T-037, T-038, T-042, T-045, T-059, T-066, T-067, T-070, T-072 — see `unknowns.md` |
| **Needs Investigation** | 1 | T-047 |
| **Deferred** | 5 | T-073…T-077 |

**Recommended next task:** T-004 for headless agents (T-002 still first choice with an Android build host — see `next-task.md`). **Dependency chains:** §Dependency graph at the end of this file.

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

## In Progress

*(none — T-003 completed 2026-08-29 by the second repair session; evidence in change-log.md.)*

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

#### T-078 — Author the missing desktop ESLint flat config (make `npm run lint` runnable)
- **Problems:** DEAD-201 (new — discovered during T-001, 2026-08-29) · **Priority:** P2 · **Severity:** Medium
- **Description:** `elimtiyaz-desktop` has ESLint 9 + the lint script + typescript-eslint packages but NO config file at all — `npm run lint` aborts with "couldn't find an eslint.config.js" (never existed in git history). Create `eslint.config.js` (flat config: typescript-eslint recommended + react-hooks, mirroring the website's ESLint 9 setup), run the first real lint over the desktop src tree, and triage findings honestly — do NOT mass-disable rules to go green (AGENTS.md §15.6). Until this lands, any "lint passes" claim for the desktop is unverifiable (AGENTS.md §11 gate is dead).
- **Dependencies:** none · **Affected:** D · **Platforms:** Desktop
- **Tests:** `npm run lint` executes without a config error; findings triaged or fixed.
- **Verification:** lint run + result recorded in change-log.
- **ADRs:** —

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
