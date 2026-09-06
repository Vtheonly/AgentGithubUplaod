# Task Registry — Master Recovery Task List

> **This is the authoritative todo list for all remaining work.** Agents must not create separate task lists, TODO files, or progress notes anywhere. Status transitions follow `definition-of-done.md`; completion evidence goes to `change-log.md`.
>
> **Evidence base:** every task below was derived from the problem registry, which consolidates the two archived audit reports in [`docs/audits/`](../audits/README.md) (86 + 99 findings). When a task's problem entry is not detailed enough, read the raw finding in the audit files — full end-to-end traces and git forensics live there.
> **Commit rule (AGENTS.md §14):** every commit must state the task completed, what is left, what was changed, what was verified, and the next task.
>
> Statuses: `Not Started` · `Needs Investigation` · `Ready` (understood, dependencies cleared) · `In Progress` · `Blocked` · `Deferred`. Within `Ready`, work P0 → P1 → P2 → P3. Pick tasks via `next-task.md`.

## Progress summary (2026-09-07, updated at the 33rd repair session CLOSE — owner mandate "fix the payment-modal UI that gets cut off / goes outside the form boundaries (wider ≈16:9 form, responsive) + show WHO issued each payment and WHEN in the payments tab instead of only a serial number + FULLY implement the DAG automations": T-219..T-222 (a focused 4-task set, desktop-hub scope) — T-219 (UI-305: the payment dialog was `grid … flex-col` with NO height cap, so the body's `flex-1` was inert and tall single-column forms grew past the viewport, pushing the footer off-screen; fixed at the DESIGN-SYSTEM level: dialogs are now flex columns capped at `max-h-[88vh]` + a NEW `2xl` wide-form tier (max-w-6xl ≈ 1152px ≈ 16:9 stage) + the UnifiedPaymentModal restructured into a responsive 12-col two-column form (7 = target/summary/slider/waterfall preview, 5 = method/structured check-wire fields/proof/debt meter/notes) with the payer+amount recap pinned in the always-visible footer) + T-220 (the payments journal's opaque serial-number column replaced by the ISSUER identity — parent avatar + full name + family code + linked student, the receipt demoted to a secondary line under the collector attribution, and the EXACT transaction timestamp dd/MM/yyyy HH:mm + relative time; search now spans payer/student/family-code/receipt/method/category) + T-221 (DAG-100 CLOSED — the workflow builder is now a functional automation system: node subtype registry 17 → 29 with the high-value educational set [grade_below_threshold, payment_cleared_or_bounced, document_expiration, calendar_cron_event, stock_level_critical, time_window, route_switch, send_whatsapp, restrict_account, dispatch_task, generate_document, account_adjustment]; NEW NodeInspectorDrawer with per-type parameter forms + the visual predicate builder (rows of Champ/Opérateur/Valeur + ET/OU/NON compiled into the canonical ConditionNode tree) + switch-route editor + test-payload preview; NEW dry-run simulator (PURE topological engine, branch-aware: failing conditions close only their own branch, route_switch opens only the first passing route, missing fields → false + §10.05 warning) wired to the canvas "Tester" button with green taken-path animation + per-node status rings + warning banner; NEW canvas UX: zoom (buttons + Ctrl-wheel anchored at cursor), pan (drag background), minimap with viewport rect + click-to-jump, snap-to-grid, and topological auto-layout ("Réorganiser"); NEW 3 one-click educational templates [Pack Relance Impayés Échelonné, Alerte Assiduité & Retards, Clôture Trimestrielle] wired into the Nouveau workflow picker with templateIsValid guarding; the mock executor upgraded from the linear single-flag walk to the SAME dry-run engine (single source of truth — visual and execution semantics can no longer diverge; runs recorded in topological order with per-branch skip reasons)) + T-222 (closeout). Suite: desktop **100 files / 2513 / 0** (was 94/2439; +6 test files / +74 tests: dry-run 9, auto-layout 8, templates 11, subtype-registry 7, source guards 13, executor branches 4) + typecheck clean + eslint 0 errors (401 warnings, NET −3 vs HEAD 404 — new files lint-clean). Registry: +2 problems (UI-305, DAG-100 — both TESTED) — 201 detailed entries; T-218's registry status flip (In Progress → Completed) truth-synced (the 32nd closeout commit missed it). No backend/website/Android changes this session — desktop-scope mandate; the live chain is UNTOUCHED (still 77/77 = 0001–0080). Owner residuals unchanged.)

## Progress summary (2026-09-06, updated at the 31st repair session CLOSE — owner mandate "fix the website UI (overflow/fit/responsive, mobile-first but desktop-safe), fix the underlying problems across the stack incl. the Supabase backend, verify the migration tokens consistent everywhere": T-199..T-208 (a balanced 10-task set) — the portal's layout was LIVE-MEASURED at real phone widths for the first time (seeded UI-TEST family + @supabase/ssr cookie sign-in + DOM-geometry probes; recipe persisted in strategy §6): five NEW defect families registered AND fixed same-session with source-scan guards — UI-300 dashboard grid blowout (Critical, 935px@320 → 0), UI-301 unbreakable Intl currency KPI values (High, 108px@375 → 0), UI-302 four non-wrapping header rows (Medium, up to 163px@320 → 0), UI-303 financial tab-label clipping (Medium, 54px cells vs 58–84px labels → scrollable row), UI-304 raw English kind enums (Low → localized via the extracted shared map) — viewport matrix 36/36 GREEN (9 views × 320/375/768/1280 all 0px; sub-tabs + chat conversation clean); website suite 30/496 → 35 files / 514 / 0 (+5 guard files) + lint + strict build; desktop parity per §10 (18 latent bare responsive grids + debt-KPI break-words, 92/2422/0 + typecheck + lint 0 err; the T-205 guard caught 12 instances the manual grep missed); Android scanned — structurally immune to the family (Compose constrained layout + weight(1f)), zero commits; T-204 live consistency round ALL GREEN: chain 76/76 = 0001–0079 zero drift, dual-key health per ADR-009, EF fleet 13/13 ACTIVE = the hub's 13 function dirs (the older "14/14" figure was STALE — discovery persisted), ALLOWED_ORIGINS canonical 4-origin set echoing (ACT-203 intact), anonymous EF → 401; UI-TEST family cleaned from the live DB (0 residuals; audit rows kept); harness recipe + the two CSS defect-family rules persisted (strategy §6 + AGENTS.md §15 #21/#22 + website AGENTS.md §5). Registry: +5 problems (UI-300..304, all TESTED) — 198 detailed entries. Owner-gated residuals unchanged: FIREBASE_SERVICE_ACCOUNT_JSON, RESEND_API_KEY, web-push env vars, AUTH-200's Google OAuth client.)

## Progress summary (2026-09-05, updated at the 30th repair session CLOSE — owner mandate "fix the MESSAGING system (not the chat UI) across mobile/website/desktop + the Supabase backend end to end + every broken PDF generation; apply the migration tokens; keep consistent everywhere": T-189 (the migration tokens — 0072/0073/0074 applied live atomically [the 28th session's gated applies], ALLOWED_ORIGINS canonical 4-origin set deployed via CLI + ACT-203 VERIFIED + the script repaired for the dead PATCH/PUT + masked-GET secrets API, FIREBASE_PROJECT_ID set live, §7 checklist re-run all green, chain 76/76 = 0001–0079 zero drift) + T-190 (MSG-200 — migration 0075 chat→notification fan-out trigger; verify 8/8; FULL live two-user round-trip 10/10: staff channel → parent message → staff notification via RLS → symmetric reply fan-out → parent markRead persists) + T-191 (REG-004 — live-drifted notifications_select [using (true) — data leak] restored to the canonical 0019 policy by migration 0076; round-trip 9/10→10/10) + T-192 (MSG-101 — the desktop debt reminders that never delivered: migration 0077 canonical notify_parent_user RPC [staff-gated, server-side parent→account resolution, NULL = undeliverable] + SupabaseDebtRepository sendReminder/broadcastReminders/lockDelinquentAccounts repaired + write_audit_log; round-trip 7/7; suite 10/10) + T-193 (MSG-201 — migration 0078 homework→parent-notification fan-out with dedup; verify 6/6; the desktop modal's "notifié aux parents" promise is now true) + T-194/T-195 (CROSS-101/UNKNOWN-004/T-066 — ADR-014 client-side PDF generation: website receipt + account-statement pdf-lib ports of the desktop reference layout, download buttons wired per-payment + per-family, dead receipts hooks + typed row removed, migration 0079 drops the orphaned table [0 rows] + bucket [via Storage API — SQL is blocked] + policies; website 496/496 + lint + strict build; suite t-194 8/8) + T-196 (Android 'chat_channel' deep-link route to ChatDetail + the message/chat FCM type → Dashboard tab mapping documented; Android suite re-run with re-provisioned JDK21+SDK35) + T-197/T-198 (registry truth-sync + zip + push). Registry: +4 NEW problems (MSG-101, MSG-200, MSG-201, REG-004 — all TESTED with live evidence) — 193 detailed entries. STILL owner-gated after this session: FIREBASE_SERVICE_ACCOUNT_JSON (real FCM sends), RESEND_API_KEY (workflow emails), the website web-push Firebase env vars, AUTH-200's Google OAuth client.)

## Progress summary (2026-09-05, updated at the 28th repair session CLOSE — mandate "Finish all the remaining tasks" + the mid-session URGENT queue-jump "the activation code is not working — fix both the desktop app and the website, then push": T-184 (ACT-201 Critical — the production portal's `/undefined/functions/v1/bind-activation-code` 404: a DIRECT build-time env read in a client component inlined `undefined` on the Vercel project that sets NO NEXT_PUBLIC_* vars; fixed via the `@/lib/env` T-096 fallback chain + a whole-src regression scan + the AGENTS.md rule; ACT-202 desktop — bindActivationCode now surfaces the EF's structured errors parsed off FunctionsHttpError.context; URL-routing live-verified: the fixed client's exact request reaches the REAL EF [structured 401]; website 28/483 + lint + strict build, desktop 89 files/2404 + tsc + lint 0 err; owner must REDEPLOY the portal) + the T-047 port batch: T-176/T-177 (workflows + workflowRuns + migration 0071 + the canonical execute EF path; 13/13), T-178 (leaveRequests + migration 0072 [RequestType-widened CHECK + reviewed_by_name]; 11/11), T-179 (suppliers + migration 0073 [category + fractional rating]; 10/10), T-180 (tasks/task_comments/task_attachments + migration 0074 [display names]; 12/12) — the desktop suite grew 2336→2404 across the batch and the chain 0001–0068→0001–0074 (0071–0074 committed with embedded registrations; LIVE application owner-token-gated this session — the sbp_ access token was not re-supplied after the context handoff; apply_00XX_live.sh scripts ready) + T-181 (Android Room dismissedAt migration v13→v14 + the server-dismissed pull eviction — T-173 part b CLOSED; 48 files/410/0 + lint + schema 14.json; part a [alert VOLUME, UNKNOWN-020] remains owner-gated). All three repos PUSHED to GitHub with the owner's PAT (this session: hub 232ea0d..98b9b36+T-182/T-183, website d5df9f5..f5dc55b, android bfe7411..4589a19). Registry: +ACT-201/ACT-202 (185 detailed, 145 TESTED). Suites at close: desktop 89 files / 2404 / 0 + tsc + lint 0 err; website 28 files / 483 / 0 + lint + strict build; Android 48 files / 410 / 0 + lintDebug.)

## Progress summary (2026-09-04, updated at the 25th repair session CLOSE — mandate "keep going": continuation session run as one of ~10 concurrent agents on the shared repos; selected + executed the coordination-safe set T-155..T-163 — T-157 debt-meter ADR-010 wiring, T-158 exhaustive-deps 4→0 (lint baseline re-pinned 384→379), T-159 Android toolchain re-provision (+ the secrets-plugin ROOT-.env discovery), T-044 pass 3a the DS ElScrollableTabRow (additive prerequisite, 5 semantic tests, suite 45/377/0), T-160 the T-047 scoping doc (23 mock-backed slots; 19 need adapters only — canonical tables already exist; verified cross-platform drift: website reads calendar_events vs desktop mock calendar, Android pull-syncs workflow_runs vs desktop mock workflows), T-161 website full verification (26/457 + lint + strict build, zero drift), T-162/T-163 closeout; suites at close: desktop 82 files / 2286 +5s + typecheck + lint 0 err/379 warn, Android debug 45 files / 377 tests / 0 failures + lintDebug, website 26 files / 457 tests + lint + strict build — all green. No Supabase credentials this session → live chain check owner-token-gated; LOCAL chain integrity verified (65 files 0001–0068, no gaps/dups, append-only guard OK). No push credentials → commits on branch `session25-agent-work` in each repo; the zip-for-push handoff applies.)

## Progress summary (2026-09-03, at the 24th repair session CLOSE — owner mandate "fix the 3 owner-reported issues (activation rejected as already-used / parent→admin-only messenger / children showing the parent's name) + apply the migration tokens + verify everywhere + zip": T-145..T-154 COMPLETE — activation round-trip live 19/19 (ADR-011, EF consolidated, phantom codes dead), migration 0067 parent→admin chat live 14/14 (ADR-012), migration 0068 parent-name repair live 11/11 (zero parents display a child's name); chain now 65/65 = 0001–0068 zero drift; suites: desktop 82 files / 2284, website 25 files / 457, EF fleet 14/14 ACTIVE — all green)

| Status | Count | Tasks |
|---|---|---|
| **Completed (VERIFIED)** | 10 | T-000, T-079, T-004, T-094 (live integration suite 5/5, 2026-08-31), **T-068** (live deploy + curl matrix + permission probes, 11th session), **T-095** (live 200 + idempotency, 12th session), **T-103** (15th session — finance reconciliation + read consistency, live 8/8), **T-147** + **T-150** + **T-152** (24th session — live round-trips: activation 19/19, chat 14/14, name repair 11/11) |
| **Completed (TESTED)** | 95 | The 64 prior-session tasks + **23rd session: T-140 (opening live verification), T-141 (AUTH-200 close — Google OAuth ENABLED), T-142 (all-three pristine baselines), T-143 (T-043 COMPLETE — equivalence consolidation, 4 passes), T-144 (T-044 passes 1–2 — DUP-004 closed, settings module migrated, 37→29 legacy importers)** + T-139, T-138, T-135, T-136, T-137, T-130..T-134 (22nd session) + **24th session: T-145, T-146, T-148, T-149, T-151, T-153, T-154 (7 TESTED)** + **32nd session: T-209..T-218 (10 TESTED — T-218's flip truth-synced in the 33rd session; the 32nd closeout commit had left it In Progress)** + **33rd session: T-219 (UI-305 modal), T-220 (payments issuer/timestamp), T-221 (DAG-100 full builder), T-222 (closeout)** |
| **Completed (IMPLEMENTED)** | 1 | T-010 (launch verification needs a desktop host) |
| **In Progress (23rd session close)** | 1 | **T-044** (Android design-system consolidation) — passes 1–2 complete (see T-144); 29 legacy importers remain; the next pass needs a scrollable DS tab component first |
| **Ready** | 0 | ~~T-043~~ COMPLETED 2026-09-03 (23rd session — T-143, 4 passes). ~~T-044~~ IN PROGRESS (T-144: passes 1–2 done; the remaining migration passes are the next picks). T-102-follow-up was COMPLETED in the 21st session (T-129 — Android chat v1: read-side + online sends, 21 new tests) — this row is now empty: the actionable set is T-044's remaining passes + owner-gated/device-gated/decision-blocked items only |
| **Partially blocked** | 1 | T-036 — PUSH-103 portion DONE (13th session); PUSH-100 (EF invocation path) + PUSH-104 (email provider) remain, owner-scoped |
| **Blocked** | 10 | T-028, T-037, T-038, T-042, T-045, T-059, T-066, T-067, T-070, T-072 |
| **Needs Investigation** | 1 | T-047 |
| **Deferred** | 5 | T-073…T-077 |
| **Needs owner decision** | ~~2~~ **1** | T-086 — ~~"only DATA-005 (first_name split) remains of T-085"~~ **stale: DATA-005's backfill was EXECUTED** as migration 0066 (T-139, 22nd session — live-verified 6/6; 258/259 parents carry a populated first_name). T-087(done 9th) stays done. The only owner decision left in this row is the DATA-006 onboarding campaign itself (operational, not code). |
| **Not started (Android, toolchain-gated)** | ~~2~~ **0** | ~~T-020, T-082~~ — **both COMPLETED** (T-020 TESTED 17th session — SyncErrorClassifier, requeue-transient/fail-fast-4xx; T-082 TESTED 18th session — desugaring enabled, lint gate restored, baseline committed). Row kept as a tombstone because the 24th session's summary still carried it stale; the toolchain-gating note applies to the *verification* of device-gated residuals only (T-159, 25th session, re-provisions the toolchain + recipe). |


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

**24th repair session (2026-09-03) — CLOSED: owner mandate COMPLETE ("finish all the remaining tasks: fix the 3 owner-reported issues — account activation rejected as 'already used', messenger must be parent→Administrator only, children showing the parent's name — apply the migration tokens, verify everywhere, zip for push").** Session-opening ritual: chain check **63/63 = 0001–0066 ZERO DRIFT** (fresh sbp_ token; live census `activation_codes=0`, `parents=260`, `auth_users=3` — two NEW parent signups on 2026-09-03, evidence the owner is actively testing the portal). **LIVE-DATA DIAGNOSIS (the 3 issues are ALL verified against the live DB):** (1) **ACTIVATION** — the desktop issued 5 codes today (audit_logs: YOUCEFI AYA ×3, ABADA YAHIA ×2) yet `activation_codes` holds **0 rows**: `SupabaseApprovalRepository.generateActivationCode` INSERTs without `tenant_id` (NOT NULL, no default → guaranteed NOT NULL violation) and `issueActivationCode` then SILENTLY falls back to `deterministicActivationCode` — a phantom code that can never validate; the deployed hub EF additionally 401s every `pending` profile via `extractAuthContext` (status !== 'active' → null) and never flips status; the website maps the EF's `{error:{code,message}}` OBJECT with regex tests that never match → always the generic "Code d'activation invalide ou déjà utilisé." string (the owner's exact symptom). (2) **MESSENGER** — parents cannot start any conversation (create_direct_channel is staff-only per ADR-008), `chat_channels` = 0 rows live → the portal messenger is dead; nothing structurally forbids parent↔parent posting. (3) **PARENT/CHILD NAMES** — live students are correct, but **259/260 parents carry their FIRST CHILD's full name as display_name** (corpus predates the importer's "Famille {lastName}" PARENT-AS-STUDENT FIX) → the Enfants list shows a child named identically to the parent. Batch (10 tasks, balanced P0→P3): **T-145** (issuance persistence), **T-146** (EF consolidation + ADR-011 resolving UNKNOWN-001), **T-147** (live round-trip), **T-148** (0067 parent→admin RPC + post tightening + ADR-012), **T-149** (website "Contacter l'administration"), **T-150** (0067 live apply + verify), **T-151** (0068 parent display-name repair), **T-152** (0068 live apply + verify), **T-153** (activation-screen precise error mapping), **T-154** (registries + suites + zip closeout).

### T-145 — Desktop activation-code issuance persistence (tenant_id + failure surfacing) — **Completed (TESTED — 5/5 unit suite + typecheck clean; live issuance confirmation owner-gated on the next staff click)**

- **Problems:** NEW ACT-200 (activation codes never persist — root cause of the owner's "already been used" report; registered this session) · **Priority:** P0 · **Severity:** Critical (user-facing blocker)
- **Scope:** `SupabaseApprovalRepository.generateActivationCode` (missing `tenant_id` on INSERT) + `issueActivationCode` in parent-detail-drawer.tsx (silent phantom-code fallback in Supabase mode).
- **Plan:** capture tenant_id once (already fetched via `current_tenant_id`), include it in the INSERT, use `issued_by` from the same RPC batch, and return Err with the real message on failure; in the drawer, show the error toast and DO NOT hand out the deterministic fallback code when Supabase mode is configured (mock mode keeps the fallback — there is no server to validate against).

### T-146 — Consolidate bind-activation-code EF: activation semantics into the canonical hub version — **Completed (TESTED — 8/8 source-scan suite + esbuild + website 5/5 guard; live deploy + round-trip via T-147)**

- **Problems:** CROSS-004, CROSS-009, BUSINESS-008, SEC-104 (all close via this task + ADR-011); UNKNOWN-001 RESOLVED by owner mandate · **Priority:** P0 · **Severity:** Critical
- **Scope:** `elimtiyaz-desktop/supabase/functions/bind-activation-code/index.ts` (canonical, deployed) + DELETE `elimtiyaz-website/supabase/functions/bind-activation-code/` (drifted duplicate — T-126 pattern).
- **Plan:** ADR-011 records the owner decision (binding a code ACTIVATES the account). The hub EF: (a) authenticate the caller WITHOUT extractAuthContext's active-only gate (verify JWT → fetch profile directly; allow `pending`; REJECT `suspended`/`deleted`); (b) keep both body keys + audit log; (c) after a successful bind, grant the `parent` role + flip `user_profiles.status='active'` + clear `approval_request_id` (the website version's logic, ported to shared helpers, hardened per SEC-104: only `pending`→`active`, never suspended/deleted); (d) idempotent 409 `account_already_active` for already-active callers.

### T-147 — Live deploy + live round-trip verification of the activation flow — **Completed (VERIFIED — 19/19 live checks, evidence: docs/recovery/t-147-live-verification.md)**

- **Problems:** ACT-200 verification half · **Priority:** P0 · **Severity:** Critical
- **Plan:** deploy the consolidated EF live (CLI v2.116.0, `--no-verify-jwt` like the current deploy), then a REAL end-to-end round-trip: create a test parent + activation code (service-role SQL), create a test auth user via the admin API, sign in via REST to get a real JWT, call the EF with the pending user's JWT → assert code bound, `parents.auth_user_id` set, profile active, `parent` role assigned, audit row written; re-call with the same code → 404 already-used; anonymous → 401. Clean up test rows. Evidence → `docs/recovery/t-147-live-verification.md`.

### T-148 — Migration 0067: parent→Administrator channel RPC + parent-post RLS tightening — **Completed (TESTED — migration authored + applied live atomically; the live verification is T-150)**

- **Problems:** NEW CHAT-200 (messenger dead for parents; nothing forbids parent↔parent) — registered this session; amends ADR-008 via ADR-012 · **Priority:** P1 · **Severity:** High
- **Plan:** (a) `open_parent_admin_channel()` SECURITY DEFINER RPC with caller verification: caller must hold the `parent` role; resolves the tenant's `super_admin` profile (fallback `support_staff`) as the counterpart; idempotent deterministic DM code (same pair-algorithm as 0061); audit row. (b) tighten `chat_messages_insert`: non-staff authors may ONLY insert into `direct` channels whose OTHER member holds a staff role — parent↔parent posting becomes structurally impossible; staff authors unchanged (full member rule preserved).

### T-149 — Website: "Contacter l'administration" (parent-initiated admin channel) — **Completed (TESTED — 6/6 suite + full website 25 files / 447 tests + lint + strict build; live click device-gated)**

- **Problems:** CHAT-200 website half · **Priority:** P1 · **Severity:** High
- **Plan:** MessagesView gains a contact-admin action (shown for parents; calls `open_parent_admin_channel` via `supabase.rpc`, invalidates the channels query, selects the channel). i18n fr/ar/en strings. Vitest coverage per the t-101 pattern. ADR-008's "no channel-creation UI" note is superseded by ADR-012 (owner mandate 2026-09-03) — website AGENTS.md section 3 note updated.

### T-150 — Live apply 0067 + SQL verification matrix — **Completed (VERIFIED — atomic MIG-TOKENS apply; verify_t-148.sql 14/14; chain 64/64)**

- **Plan:** atomic MIG-TOKENS apply (file + `BEGIN; sql; registration; COMMIT;` one Management-API call), then `scripts/verify_t-148.sql` (BEGIN/ROLLBACK): parent can open/return the admin channel (idempotent ×2), non-parent caller rejected, parent insert into a parent-only channel REJECTED, parent insert into the admin DM ACCEPTED, staff insert unaffected, chain 64/64.

### T-151 — Migration 0068: parents display-name data repair ("Famille {lastName}" convention) — **Completed (TESTED — migration authored + applied live atomically; the live verification is T-152)**

- **Problems:** NEW DATA-012 (parents display_name = first child's name; the corpus predates the importer's PARENT-AS-STUDENT FIX) — registered this session · **Priority:** P1 · **Severity:** Medium (owner-visible)
- **Plan:** idempotent UPDATE: for every parent with ≥1 non-deleted student whose `display_name` (whitespace-normalized, case-insensitive) equals one of their children's display names (or first+last join), set `display_name = 'Famille ' || <family last name>` (family name = the parent's current `last_name`, which equals the children's shared family name), `first_name = ''` (the real given name is UNKNOWN in the Excel — a child's name must not masquerade as the parent's), keep `last_name`. Parents without children / non-matching display names untouched (incl. approval-created rows). All renderers already prefer display_name (desktop `parentDisplayName`, website `formatParentName`, Android `fullName`).

### T-152 — Live apply 0068 + SQL verification — **Completed (VERIFIED — atomic MIG-TOKENS apply; verify_t-151.sql 11/11 incl. students-untouched checksum; chain 65/65)**

- **Plan:** atomic MIG-TOKENS apply + `scripts/verify_t-151.sql`: after repair, zero parents display a child's name; children rows untouched (count + checksum before/after); 0066 split semantics intact for non-repaired rows; chain 65/65.

### T-153 — Website activation-screen: precise EF error mapping — **Completed (TESTED — 10/10 suite + full website 25 files / 457 tests + lint + strict build)**

- **Problems:** ACT-200 UX half · **Priority:** P2 · **Severity:** Medium
- **Plan:** the screen currently regex-tests `data?.error` — an OBJECT under the hub EF's `{error:{code,message}}` shape, so every failure shows the generic "invalide ou déjà utilisé" string. Map by `error.code` (string-shape tolerated for safety): `code_not_found` → invalid/used message, `code_expired` → expired, `account_already_active` → success refresh path, `account_suspended`/`account_rejected` → actionable localized message, `auth_failed` → session message. Dictionary entries fr/ar/en. Vitest unit tests for the mapping.

### T-154 — Session closeout: registries + full suites + zip packaging — **Completed (TESTED — registry entries + statuses + change-log + next-task + current-state + ADR-011/012 + unknowns; full suites re-run; EF curl matrix; chain 65/65; zips produced)**

- **Plan:** problem-registry entries (ACT-200, CHAT-200, DATA-012) with resolution evidence; task-registry statuses + summary; change-log append; next-task.md rewrite; current-state.md refresh; ADR-011/012; website AGENTS.md sync; unknowns.md UNKNOWN-001 closed. Full verification: desktop typecheck+lint+suite, website lint+suite+strict build, EF curl matrix, chain 65/65. Zip the three repos for the owner.

**22nd repair session (2026-09-03) — CLOSED: owner mandate COMPLETE (fresh-token MIG-TOKENS + all-platforms verification + chain consistency; 10 tasks: T-130..T-139).** Opening: chain 62/62 ZERO DRIFT + EF census 13/13. Closeout: **chain 63/63 = 0001–0066 ZERO DRIFT** (0066 = the owner's live-applied backfill, reconstructed + committed by T-139/ARCH-014 — caught ONLY because the closeout re-ran the matrix). Suites at close: desktop 79/2271/0 (+3 suites: t-131 12, t-132 7, t-134 8) + typecheck + lint-delta-0; website 24/440/0 + strict build + live render 200; Android debug 44/372/0 + release 42/367/0 + lintDebug green. Live: 3 EF deploys (workflow-execute, approve-signup-request ×2 rounds), 34/34 MIG-TOKENS matrix, 13/13 anonymous-deny. Registry: OPEN 62→12, stale rows synced, duplicates removed, next-task corruption repaired. Owner residuals unchanged: RESEND_API_KEY + from-domain (emails), FIREBASE_SERVICE_ACCOUNT_JSON (pushes), Google OAuth client (AUTH-200).

### T-130 — MIG-TOKENS session verification with the fresh access token ("apply the migration tokens, consistent everywhere") — **Completed (TESTED — script matrix 34/34 PASS + secrets census + NOTIF-101 policy probe)**

- **Problems:** (verification ritual — ARCH-009/ARCH-011/ARCH-013 prevention; KEYMIG-300 re-check) · **Priority:** P0 (owner mandate) · **Severity:** —
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** the T-122 matrix re-run with the owner's fresh `sbp_…` access token: chain 62/62 zero drift (2 known cosmetic name quirks); EF census 13/13 ACTIVE (hub ↔ deployed one-to-one); dual-key auth health 200 ×2; RLS anon/publishable → empty on 5 core tables ×2; JWKS 200; key consistency vs committed values (website public-config publishable key, Android .env.example URL+JWKS — byte-identical); auth-user census 1 (admin@elimtiyaz.dz, confirmed, active); anonymous-deny sweep on ALL 13 EFs (13×401); live `pg_policies` probe of `notifications_insert` (0048's tightened with_check IS deployed — evidence for T-133's NOTIF-101 flip); live secrets census (11 secrets; **RESEND_API_KEY and FIREBASE_SERVICE_ACCOUNT_JSON NOT set** — owner residuals for T-131/T-126). Script outside the repo: `/home/z/my-project/scripts/verify_t-130_mig_tokens.sh`.
- **Result:** **34/34 PASS.** The migration tokens are applied and consistent everywhere; no drift anywhere in the chain, the EF fleet, or the key registry.

### T-131 — PUSH-104 close: real Resend send for workflow `send_email` + hardened shared email helper — **Completed (TESTED — 12/12 suite + live deploy of both EFs + 401 curl matrix; real sends owner-gated on RESEND_API_KEY)**

- **Problems:** PUSH-104 (High, OPEN→TESTED — the send_email half of T-036) · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** (a) NEW `supabase/functions/_shared/send-email.ts` — the ONE Resend integration (extracted from approve-signup-request's inline fetch per the Existing-Implementation-First rule, hardened): `resolveEmailConfig` (blank/absent RESEND_API_KEY → null → honest not_configured), `sendEmailWithResend` (NEVER throws; **`resp.ok` IS checked** — the original defect; http_error carries status + body excerpt; network_error carries the error text), Deno-free core importable by the desktop vitest suite (ambient Deno declaration per the cron-auth pattern) + `sendEmailFromEnv` Edge wrapper; `PORTAL_URL` constant = the production origin. (b) workflow-execute `send_email` action: stub → real send with explicit `to`/`subject`/`html|body`; missing fields or template-only configs honestly SKIP with the reason recorded (no server-side template registry exists — business content is an owner decision); provider failures recorded in the node output, never thrown (the T-126 honest-outcome contract); header comments updated (push_notification + send_email REAL, the rest still stubs). (c) approve-signup-request: uses the shared helper; the response payload now carries the structured `email` outcome; failures console.warn'd with reason; **NEW DISCOVERY fixed: the confirmation email linked the DEAD `portal.elimtiyaz.dz` origin — now `PORTAL_URL` (elimtiyaz-website.vercel.app, credentials §2.2)**. (d) NEW suite `src/tests/security/t-131-email-ef.test.ts` (RED first — commit 6fe451f: import resolution failure with the helper missing): 8 unit tests of the pure core (config resolution ×2; not_configured no-fetch; success request-shape with Bearer/from/to/subject/html; http_error 402 with body excerpt; network_error never-throws) + 6 source scans (helper is the ONLY api.resend.com implementation under functions/; wired into both EFs; STUB send_email strings gone; dead URL gone everywhere). (e) Both EFs deployed live (CLI v2.116.0; verify_jwt settings preserved: workflow-execute True / approve-signup-request False) + anonymous-deny curl matrix 401 ×4 + EF census 13/13 ACTIVE re-confirmed.
- **Owner residuals:** RESEND_API_KEY secret NOT set live (T-130 census) — sends honestly report not_configured until set; the `from` domain must be verified in the owner's Resend account; template-based configs need the business-content decision; live E2E needs the owner's admin password (out-of-band).

### T-132 — PARENT-102 close: reject approve-without-target-parent — **Completed (TESTED — 7/7 suite + live redeploy + 401 sanity; live 400-branch round-trip owner-gated)**

- **Problems:** PARENT-102 (Medium, OPEN→TESTED) · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** the approve path of `approve-signup-request` now guards the "active but unbound" limbo: a PARENT-role approve with NEITHER `target_parent_id` NOR `create_new_parent` → 400 `missing_target_parent` + an `account_approval.missing_target_parent_denied` audit entry (denied-by evidence). The guard sits BEFORE any state change (6a's parent creation + 6b's RPC call). Escape hatch: an explicit `assign_role` override to a STAFF role (looked up against `roles.is_staff_role`; unknown codes → 400 invalid_role) legitimately produces a staff account with no binding; staff-role requests (`requested_role='staff'`) never need one. DEVIATION recorded: the SQL RPC `approve_account_request` was deliberately NOT hardened (a migration rejecting `p_target_parent_id IS NULL` would break the legitimate staff-approval semantics the RPC also serves — the EF owns the caller-facing contract); the problem entry's "migration-level test" verification note does not apply to an EF-only guard. Regression safety proven by caller census: the EF's ONLY client is the desktop (`supabase-approval-repository.ts` — approveWithExistingParent/approveWithNewParent ALWAYS carry a binding); website + Android have ZERO callers (rg-verified). Suite: `src/tests/security/t-132-approve-binding-guard.test.ts` (RED first — commit 2875634): 7/7 (the 400 + error code, parent-role scoping, both escape routes, staff-override escape, denial audit, guard-before-RPC order, the PARENT-102 comment contract). Deployed live (verify_jwt=False preserved) + anonymous-deny 401 ×2.
- **Gap to VERIFIED:** a live staff-JWT round-trip exercising the 400 branch + the audit row (needs the owner's admin password — out-of-band since T-106's reset).

### T-133 — Registry truth-sync + doc-structure repair — **Completed (TESTED — 25+4 summary rows flipped to evidenced states; 3 duplicated blocks removed; live probes recorded)**

- **Problems:** NOTIF-101 (stale header → TESTED), registry duplication, next-task.md corruption · **Priority:** P2 · **Severity:** Medium (registry trust)
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** (a) NOTIF-101 flipped OPEN→TESTED with T-130's LIVE pg_policies evidence (the deployed `notifications_insert` with_check IS 0048's staff-or-self-or-own-role-broadcast tightening — the T-125 flip had missed both the detailed header AND the table row); (b) the problem-registry's verbatim-duplicate entries removed (ARCH-011 ×2 and WEAK-030 ×2 in the "NEW ENTRIES" region — 30 duplicated lines); (c) next-task.md's corrupted duplicated block removed (lines 72–120 repeated the 16th-session history verbatim after the file's real content); (d) the stale "Current recommendation" (still recommending T-104/T-024/T-017/T-020/T-021 — ALL completed in the 17th/18th sessions) rewritten to the current truth (T-043 + T-044 remain the Ready set; the actionable OPEN set is exhausted — what remains is owner-gated, device-gated, or blocked-on-decisions); (e) **25 MORE stale summary-table rows flipped** to their detailed entries' evidenced states (SEC-107/108/110/111/112, TENANT-100/101, CROSS-103/200, SYNC-101/102, HOMEWORK-101, STUDENT-100, PUSH-100/101, ARCH-006→VERIFIED, ARCH-012, DRIFT-001, DRIFT-005, WEAK-003/004/016/018/022, DEAD-014 — the T-125 flip had synced the detailed headers but NOT the index table); (f) the Totals line recounted from the authoritative detailed headers (180 entries: 12 OPEN / 134 TESTED / 12 VERIFIED / 11 BLOCKED / 5 DEFERRED / 6 micro-states). Every flip cross-checked against the detailed entry's own status note (the T-117/T-125 discipline).
- **Verification:** programmatic table-vs-detail cross-check after the flips → ZERO meaningful mismatches (the only remaining OPEN rows are CROSS-004, ARCH-001, DRIFT-011-family, DUP-001..004, REG-002, WEAK-100, DATA-006, AUTH-200 — all documented as blocked/owner-gated/consolidation).

### T-139 — ARCH-014: reconstruct + commit the live-only migration 0066 (parent first_name backfill) — **Completed (TESTED — live verification 6/6; append-only guard OK; the 10th reserved task slot)**

- **Problems:** ARCH-014 (new), DATA-005 (data-repair half — CLOSED) · **Priority:** P0 (live↔repo drift) · **Severity:** High
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** the closeout MIG-TOKENS re-run caught a NEW live-only migration (63 live rows vs 62 at session open — applied by an outside actor DURING this session, ARCH-014): `0066/parent_first_name_backfill` = DATA-005's owner-gated data repair executed live with no committed file. Closed the T-115 way: (a) the DML's exact text is unrecoverable (UPDATE, not a function), so `0066_parent_first_name_backfill.sql` is a SEMANTIC RECONSTRUCTION pinned to the observed live state — header documents the provenance + the reconstruction method; (b) committed WITH the registration statement (live row already exists; ON CONFLICT DO NOTHING); (c) NEW `scripts/verify_t-139_data005_backfill.sql` (BEGIN/ROLLBACK convention) — **live 6/6**: C1 registration row exact · C2 only the 1 single-token name remains empty · C3 split semantics btrim-consistent (258) · C4 display_name + last_name intact · C5 idempotent (0 rows would change) · C6 every parent renders; (d) append-only guard OK (63 files, +1 new in worktree); t-058 guard suite 6/6. **LESSON persisted in AGENTS.md §15 context + ARCH-014: re-run the chain check at session CLOSEOUT, not only at open — the live project has another active actor.**
- **Left:** the 12 cosmetic double-space display_name rows (pre-existing, left untouched by design); nothing else.

### T-134 — DATA-005 desktop residual: parent-name render sites canonicalized — **Completed (TESTED — 8/8 suite + full desktop suite 2271/2271 + typecheck + lint-delta-0)**

- **Problems:** DATA-005 (PARTIAL — agent-side residual closed; data repair remains owner-gated) · **Priority:** P3 · **Severity:** Medium (UX, 258 live rows affected)
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** the initial audit found 4 sites; the RED suite's tree-wide guard scan (the `parent.`-variable convention) then exposed the FULL extent — **18 composition sites across 15 files**, all fixed mechanically to the canonical `parentDisplayName()` helper (domain/model/parent.ts — prefers displayName, falls back to first+last): student-detail/info-tab + payments-tab (the audited pair), search-index parent label, financials receipts-tab / installment-schedule-tab (×3) / payment-detail-drawer, dashboard alert-detail-modal (×2), **the PDF receipts** (payment-receipt.ts + account-statement.ts — user-facing printed "Nom:"/"Parent:" lines — their Pick<Parent> parameter types extended with "displayName"), and the mock layer (parent-repository search-match + create-audit, ledger-repository summary, calendar-repository, notification-alerts (×2), debt-ops (×5)). The mock parent search also gained the displayName match term the Supabase search already had (parity). Students/personnel compositions preserved (correct for them). Android audited CLEAN (all render sites use `fullName`). SCOPE NOTE: the tree guard pins the `parent.`-variable convention only — `p.`-named loop variables are usually students/personnel; the genuine parent `p.`-sites (installment-schedule, alert-detail, debt-ops) are individually pinned by the other tests. Suite: `src/tests/security/t-134-parent-name-rendering.test.ts` 8/8 (RED first — commit 8219dcf: 6 failing). Data repair (splitting display_name into first/last, 258 rows) remains owner-gated (T-085).

### T-135 — Android toolchain re-provision + full-suite baseline — **Completed (TESTED — debug 44 files/372/0, release 42/367/0, lintDebug green)**

- **Problems:** (session infrastructure — AGENTS.md §11 Android recipe) · **Priority:** P1 · **Severity:** —
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** the full toolchain re-provisioned after the container reset (Temurin JDK 21 javac 21.0.12.1; cmdline-tools + platforms;android-35 + build-tools;35.0.0; local.properties; `.env` with ALL keys non-empty). TWO discoveries persisted: (a) the bare `commandlinetools-linux-<V>.zip` URLs 404 from this container — the **`_latest` suffix variant resolves 200** (added to AGENTS.md §11 + the re-created `/home/z/my-project/scripts/android-env.sh`); (b) the `.env` secrets-plugin quirk's precise mechanism re-confirmed: the plugin merges `.env.example` as DEFAULTS, so any key listed there with an EMPTY value (SUPABASE_ANON_KEY= / SUPABASE_PUBLISHABLE_KEY=) must be overridden non-empty in `.env` — my first .env defined only 3 of the 4 keys and the build failed with the blank-literal error exactly as documented; `.env` now defines all four (anon JWT + publishable key + URL + JWKS). Verification: `./gradlew test --no-daemon` → BUILD SUCCESSFUL — **debug 44 files / 372 tests / 0 failures / 0 errors; release 42 files / 367 tests / 0 failures** (release = debug − 5, exactly ARCH-012's two documented exclusions: GreetingScreenshotTest 1 + RoomSchemaUpgradeT046GapTest 4; file-count delta +2 matches the two excluded classes); `./gradlew lintDebug --no-daemon` → BUILD SUCCESSFUL (the T-082 baseline holding). No regressions found — no Android code changes this session.

### T-136 — Website platform baseline verification — **Completed (TESTED — lint 0 / 24 files × 440 tests / strict build green / live render 200)**

- **Problems:** (session verification — owner's "everything works across all platforms") · **Priority:** P1 · **Severity:** —
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** fresh `npm install` (400 packages) then the full verification battery on the HEAD tree (a77e40e): `npm run lint` → 0 errors, 0 warnings output; `npm run test` (vitest) → **24 files / 440 tests / 0 failures** (20th-session baseline 23/436 + the 21st session's t-126-hub-owned-edge-functions guard suite 1 file / 4 tests — arithmetic checks out); strict `npm run build` → compiled successfully (static prerender + middleware); live production-render smoke test (`next start -p 3100` + curl) → HTTP 200, `<title>El-Imtiyaz Portal — Espace Parent & Élève</title>`, NO "Missing configuration" banner (the T-096 committed public defaults working). No regressions found — nothing to fix.

### T-137 — Desktop platform baseline verification — **Completed (TESTED — typecheck clean, lint 0 errors/warning-delta-0, 79 files × 2271 tests ALL PASS)**

- **Problems:** (session verification) · **Priority:** P1 · **Severity:** —
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** the full desktop battery on the tree WITH this session's changes (T-131/T-132/T-134 suites + the parentDisplayName canonicalization): `npm run typecheck` → clean; `npm run lint` → 0 errors with **warning-delta vs HEAD = 0** (stash round-trip: 384 → 384 — the documented 307-warning T-078 baseline is simply old; the delta proves this session's code adds nothing); `npm test` (vitest) → **79 files / 2271 tests / 0 failures** (20th-session baseline 75/2236 + this session's three new suites: t-131-email-ef 12, t-132-approve-binding-guard 7, t-134-parent-name-rendering 8 = +27; +4 files). No regressions found. A final pristine-tree re-run happens at T-138 closeout (TEST-300 discipline).

### T-138 — Session closeout: pristine-tree full re-run + zip packaging — **Completed (TESTED — the closeout re-run caught ARCH-014; all suites green on the final tree; zips produced)**

- **Problems:** (session close — TEST-300 lesson) · **Priority:** P1 · **Severity:** —
- **Status:** TESTED (2026-09-03, 22nd session)
- **What was done:** the pristine-tree re-runs on the final committed tree: desktop typecheck clean + **79 files / 2271 tests / 0 failures**; website lint clean + **440/440**; the closeout MIG-TOKENS re-run (34/34) — **which CAUGHT the live-only 0066** (→ T-139, the reserved 10th slot) and re-verified 63/63 zero drift after the reconstruction commit; current-state.md + next-task.md + this registry updated; the three repos zipped for the owner to push (with the batch's 12 commits in the hub, 0 in website/Android).

### T-140 — 23rd-session opening MIG-TOKENS + live health verification (the fresh token re-run) — **Completed (TESTED — 63/63 zero drift; EF fleet 13/13 ACTIVE + 26-probe anonymous-deny matrix all 401)**

- **Problems:** (session ritual — AGENTS.md §15 rule 11; owner mandate "apply the migration tokens / everything works across all platforms") · **Priority:** P0 · **Severity:** —
- **Status:** TESTED (2026-09-03, 23rd session)
- **What was done:** the full opening verification with the owner's fresh access token: (1) live chain 63/63 = 0001–0066 **ZERO DRIFT** vs the committed chain; (2) EF census 13/13 ACTIVE with names matching the hub's `supabase/functions/` set one-to-one; (3) the anonymous-deny curl matrix on ALL 13 EFs × 2 probes (no-auth + anon-key) — **26/26 = 401**; (4) auth health 200 on both key formats + JWKS 200; (5) RLS anon-deny 0-rows × 5 core tables; (6) production portal render HTTP 200 with the correct title; (7) auth census 1 user; (8) live secrets census (11 present; RESEND_API_KEY + FIREBASE_SERVICE_ACCOUNT_JSON still absent — unchanged owner residuals); (9) the Google-OAuth config re-read that DISCOVERED the owner's between-sessions credentials (→ T-141). Scripts persisted at `/home/z/my-project/scripts/{check_live_chain.sh,t140_ef_fleet.sh,t140_ef_matrix.sh,t140_health.sh}` (outside the repo — they carry the access token).
- **Result:** the 22nd-session close state fully preserved; the migration tokens applied + consistent everywhere.

### T-141 — AUTH-200 close: Google OAuth provider enabled — **Completed (TESTED — live PATCH + authorize-endpoint 302 to Google; the #1 Critical user-facing blocker closed agent-side)**

- **Problems:** AUTH-200 (Critical, OPEN→TESTED) · **Priority:** P0 · **Severity:** Critical
- **Status:** TESTED (2026-09-03, 23rd session)
- **What was done:** the session-opening check (T-140 probe 9) found the owner had completed runbook steps 1–2 between sessions (client_id 72 chars + secret 64 chars SET, toggle still off) — the ARCH-014 "owner is an active actor" lesson extended to auth config. The agent ran runbook step 3: the **enable-only PATCH** `{"external_google_enabled": true}` (200; credentials/site_url/uri_allow_list preserved — partial-body PATCH is the safe shape). Live-verified step 4: GET enabled=true; `authorize?provider=google&redirect_to=<production>` → **HTTP 302 → accounts.google.com** with the owner's client `259221439109-hp67…` (was `400 Unsupported provider` since 2026-08-31). Docs: NEW `docs/recovery/t-141-live-verification.md`; runbook status header; problem registry (detailed entry + index row + totals 12→11 OPEN).
- **Left:** VERIFIED awaits the first real browser sign-in (one click on the production portal; Google consent screen TESTING-mode = parents must be test users, runbook step 1.2). If authorize ever 400s again, re-run the step-3 PATCH.

### T-142 — 23rd-session platform baselines (all three pristine) — **Completed (TESTED — desktop 79/2271 + typecheck + lint-delta 0; website 24/440 + lint + strict build; Android 44/372 + 42/367 + lint)**

- **Problems:** (session verification — TEST-300 lesson; the owner's "everything works across all platforms") · **Priority:** P1 · **Severity:** —
- **Status:** TESTED (2026-09-03, 23rd session)
- **What was done:** after the container reset, the full toolchains were re-provisioned (npm installs; Temurin JDK 21 + SDK 35 + the .env secrets-plugin quirk per AGENTS.md §11 — recipe re-created at `/home/z/my-project/scripts/android-env.sh` with a NEW retry-loop quirk: the container network stalls on large transfers, so the JDK download needs `curl -C - --speed-limit 10240 --speed-time 30` in a retry loop). Baselines on the pristine HEAD trees: desktop `npm run typecheck` clean + `npm run lint` 0 errors/384 warnings (delta-0) + `npm test` **79 files / 2271 tests / 0 failures**; website `npm run lint` clean + `npm run test` **24 files / 440 / 0** + strict `npm run build` green; Android `./gradlew testDebugUnitTest` **44/372/0** + `testReleaseUnitTest` **42/367/0** + `lint` BUILD SUCCESSFUL. All three match the 22nd-session close EXACTLY (zero regressions at open).

### T-143 — T-043 COMPLETE: equivalence-framework consolidation (ADR-006) — **Completed (TESTED — 4 scoped passes; 3 trees + 1 mirror deleted; single framework; corpus access documented)**

- **Problems:** DUP-001 (absorbs DEAD-004, CROSS-002, CROSS-008; OPEN→TESTED), DUP-002 (OPEN→TESTED) · **Priority:** P2 · **Severity:** High
- **Status:** TESTED (2026-09-03, 23rd session)
- **What was done (4 commits, one per pass):**
  - **Pass 1 (DUP-002):** deleted `src/test/cross-platform/_tier4/kotlin_mirror_engine.ts` (the drifted copy that keeps empty strings in the parent-code identity join); repointed all **7** consumers (6 Tier4 test files + `vault-compliance-architecture.test.tsx` — the 7th was discovered via typecheck, not grep: it lives under `src/tests/integration/` with a different relative path) to import `financial-tests/equivalence/android_mirror/`. **NEW DISCOVERY:** the canonical mirror was NEVER in the typecheck graph (nothing under src/ imported it) — repointing surfaced 2 latent type defects (maxOf's narrowed `b: string` vs a `string|null` call site at line 354; the `as const` RECONCILE_CODES index) — both fixed type-only. 810 Tier4 tests + 34 vault tests green against the canonical engine.
  - **Pass 2 (DEAD-004):** deleted `financial-tests/scenarios/` (8 .yml files, never read by any runner — both runners HARDCODE their scenario sets). Unique-scenario coverage report (ADR-006 requirement): all 8 scenarios live on in the JSON corpus (001/003/004/005/006/008/012) and/or the hardcoded runners (the fromCode-totality block in the Android runner). Both runner headers corrected (desktop + Android commits).
  - **Pass 3 (CROSS-002):** deleted `financial-tests/cross-platform-v2/` (7 files — an empty scaffold: no scenario corpus, zero inbound references, its probe subject was resolved by migration 0040 long ago).
  - **Pass 4:** deleted `financial-tests/equivalence-live/` (21 .mjs files — never wired to run; live verification is de-facto owned by the scripts/verify_t-XXX.sql convention per AGENTS.md §11.1). Documented the Android corpus access (ADR-006 decision 4) in `docs/testing/cross-platform.md` §2.1 (the T-081 resolution order: system properties → module dir → repo root → sibling hub → sibling standalone; no copy step). ADR-006 status: Proposed → **Implemented**, with the decision-2 DEVIATION recorded (the "live-DB layers as a runner mode" was NOT ported as code — porting 21 unwired .mjs files would recreate the parallel-path anti-pattern; the role is owned by the verify-script convention; the concept survives in the ADR text + git history).
- **Verified:** full desktop suite re-run after each pass — **79 files / 2271 tests / 0 failures** every time; typecheck clean; lint 0 errors. The 304-scenario JSON corpus untouched. `financial-tests/` now contains exactly ONE tree (`equivalence/`).
- **Left:** nothing — T-043 complete.

### T-144 — T-044 passes 1–2: Android design-system consolidation (DUP-004 closed; DUP-003 partial) — **Completed (TESTED — pass 1: theme duplicate + 3 dead files removed, screenshot test migrated; pass 2: the settings module fully migrated, 37→29 legacy importers)**

- **Problems:** DUP-004 (Medium, OPEN→TESTED; absorbs WEAK-013), DUP-003 (High, OPEN→PARTIAL) · **Priority:** P3 · **Severity:** High (maintenance)
- **Status:** TESTED (2026-09-03, 23rd session)
- **What was done:**
  - **Pass 1 (DUP-004, Android commit "T-044 pass 1"):** deleted the dead legacy `ui/theme/ElImtiyazTheme.kt` + its only-consumers-become-dead companions `Type.kt` (ElImtiyazTypography) + `ColorSchemes.kt` (Dark/LightColorScheme) + the dead `ElShapes` Material scale (Shapes.kt kept — its semantic constants have 20+ live importers). `GreetingScreenshotTest` migrated to the PRODUCTION theme (`designsystem.theme.ElImtiyazTheme`) — WEAK-013 closed. **NEW DISCOVERY:** roborazzi's `captureRoboImage` does NOT write the PNG in the repair container (verified: deleted greeting.png, forced a fresh 8.9s test run — PASSED, no file created anywhere on the filesystem). The committed greeting.png is a historical artifact; do NOT interpret an unchanged PNG as "the render is byte-identical".
  - **Pass 2 (DUP-003, Android commit "T-044 pass 2"):** the ENTIRE settings module (8 files: ActionRow, SecuritySection, ProfileCard, DiagnosticsSection, SyncSection, SettingsScreen, AuditLogScreen, PreferencesSection) migrated to `ui.designsystem.*` — zero legacy imports remain under features/settings. Parameter mappings: ElButtonStyle→ElButtonVariant; ElAvatar size=56→ElAvatarSize.L; ElTag color→tone via a NEW roleTone() helper (replacing roleColor, its only consumer); ElDropdown to the ElDropdownOption API (selectedValue matches option.VALUE not the label — the language dropdown now passes the ISO code; the label↔code helpers became dead and were removed); ElScaffold's content lambda now applies the PaddingValues the DS scaffold contract requires. Legacy importers: **37 → 29**.
  - **Documented blockers for the remaining screens:** the 4 hub screens use the SCROLLABLE `ModernSecondaryTabRow` while the DS `ElTabRow` is a segmented control (6-tab FinancialsHub would squeeze — a scrollable DS tab component must be added to the design system FIRST, per the no-parallel-implementations rule); MainScreen's `ModernBottomNavBar` is index-based while the DS `ElBottomBar` is route-based (a model rewrite, not a re-import).
- **Verified:** `./gradlew compileDebugKotlin` + `compileReleaseKotlin` BUILD SUCCESSFUL; `testDebugUnitTest` **44 files / 372 / 0**; `testReleaseUnitTest` **42 files / 367 / 0**; `lint` BUILD SUCCESSFUL — identical to the session-opening baseline after BOTH passes.
- **Left:** 29 legacy importers remain (DUP-003 stays PARTIAL): dashboard 9, crm 6, academics 5, financials 6, personnel 3, chat 2, routing 2, navigation/MainScreen 1 (+ PermissionDeniedScreen). The settings module is the reference pattern for the next passes.

**21st repair session (2026-09-02) — owner mandate: apply fixes to the existing checkouts (no re-clone), balanced batch.** Session-opening ritual: live chain check **62/62 = 0001–0065, ZERO DRIFT**; MIG-TOKENS condensed re-verification **11/11** (auth health both key formats, RLS anon→0, JWKS, key-consistency vs committed values, census 1). Evidence pass found **20 stale detailed-entry Status headers** (fixes documented in status notes but headers never flipped) → T-125. Batch selected (balanced importance/risk/feasibility): **T-125** (registry truth-sync), **T-126** (PUSH-100 substantial close: fix WEAK-014 `user_profile_id` column bug + WEAK-015 PEM parser bug in the EF source, consolidate the EF source into the hub — NEW FINDING: the live-deployed EF's only source lives in the website repo while credentials.md claims the hub owns it — wire the workflow-execute `push_notification` stub to actually invoke it, redeploy live), **T-127** (PUSH-101 Android half: FCM receiver field reads + click_action intent filter), **T-128** (CROSS-103: Android refund enqueues installment sync pushes after the local waterfall revert), **T-102-follow-up** (Android chat read-side + online sends — 5th attempt, this session commits to it), **T-044** (Android design-system consolidation, if context budget allows). Owner residual recorded: FIREBASE service-account secret is NOT set live (secrets list lacks it) — even with the code fixed, real FCM sends need the owner to set it; AUTH-200 unchanged (Google OAuth client is owner-only).

### T-125 — Registry truth-sync (21st session) — **Completed (TESTED — commit b78fc3b)**

- **What:** 20 detailed-entry Status headers flipped OPEN→TESTED with this session's live-DB/code probes as evidence (SEC-008, SEC-106, PARENT-101, WEAK-200, BUG-NEW-001 live-verified; BUSINESS-001, WEAK-011/012/017/019, SYNC-103/106/107, ARCH-004/008, HOMEWORK-103, NOTIF-105, DEAD-013, BUSINESS-102, CROSS-102 code-verified); index-table rows + summary counts recomputed from the authoritative detailed headers (OPEN 62→19, TESTED 86→129).
- **Why:** future agents reading "OPEN" re-fix fixed problems — the exact waste this registry exists to prevent.

### T-126 — PUSH-100 substantial close: fix + canonicalize + wire the send-push-notification EF — **Completed (TESTED — live deploy + curl matrix + 8/8 source scans; real E2E send owner-gated on the Firebase secret)**

- **What:** (a) WEAK-014: `.eq("user_profile_id", …)` → `user_id` (the device_tokens query ONLY — the notification_preferences query on `user_profile_id` is CORRECT per 0043 and preserved); (b) WEAK-015: registry correction — byte-level verification shows the current source ALREADY strips BEGIN+END+whitespace (the registry text was corrupted by a redaction artifact); hardened to the idempotent regex form anyway; (c) propagate `priority`+`type` into the FCM `data` field (PUSH-101 part 1); (d) move the source to the hub canonical `elimtiyaz-desktop/supabase/functions/send-push-notification/` + remove the website's drifted copy (guard: website `t-126-hub-owned-edge-functions.test.ts` 4/4); (e) replace the workflow-execute `push_notification` STUB with a real invoke (role/user recipient resolution + honest per-recipient failure recording); (f) deploy both EFs live (CLI v2.116.0) + curl matrix; (g) document the owner residual (Firebase service-account secret) + the sb_secret-vs-legacy-JWT discovery.
- **Verified:** hub source-scan suite `src/tests/security/t-126-push-ef-canonical.test.ts` 8/8; website guard suite 4/4; live curl matrix — send-push-notification: no-auth 401 / invalid-bearer 401 / anon 401 / legacy-service-JWT 401 / sb_secret → honest 500 naming the missing FIREBASE_SERVICE_ACCOUNT_JSON secret (auth PASSED, the guard fired); workflow-execute: no-auth 401 / anon 401. Desktop full-suite re-run + website lint/test/build at session close.

### T-127 — PUSH-101 Android half: FCM receiver + deep links — **Completed (TESTED — 14 new tests; live device round-trip remains, needs a real FCM delivery)**

- **What:** (a) ElImtiyazMessagingService: content resolution extracted into pure functions (data first — the canonical EF's routing fields — then the `notification` payload for title/body); the priority default now matches the EF's ("high", was "medium"); a contentIntent carries the click action + routing extras (type, url). (b) AndroidManifest: `${applicationId}.NOTIFICATION_CLICK` intent-filter with CATEGORY_DEFAULT on MainActivity (matches the EF's androidClickAction — three-sided wire contract: hub EF / manifest / service constant). (c) MainActivity: onCreate + onNewIntent publish the deep-link to the NotificationDeepLink bus (survives Splash→Login→Main). (d) MainScreen: acts once on the pending link, selecting the matching hub tab via a permission-keyed map (financial types → Finances, academic → Pédagogie, unknown → first tab; RBAC matrix stays authoritative — an invisible target hub degrades to the first tab). Deeper per-entity routing (e.g. PaymentDetail by id) is the documented follow-up.
- **Verified:** `PushNotificationRoutingTest` 11/11 (content resolution, channel mapping, deep-link hub mapping incl. permission-filtered degradation, one-shot bus) + `PushDeepLinkWiringScanTest` 3/3 (manifest filter + DEFAULT category, service contentIntent constants, MainActivity cold+warm wiring). Full-suite re-run at session close. GAP: a real FCM delivery round-trip needs the owner's Firebase secret + a device.

### T-128 — CROSS-103: Android refund installment sync pushes — **Completed (TESTED — 4 new source-scan tests + full-suite re-run)**

- **What:** after the local waterfall revert in `LocalPaymentRepository.refund`, each reverted installment is enqueued as an `installment` sync entity (operation `update`, payload built from the SAME `reverted` entity that Room persists — byte-identical shape to the batch-registration contract). The dispatcher pushes via the idempotent `upsert_installment_from_import` RPC (TIER 4, migration 0037:741). Safety verified against the migration chain: `upsert_ledger_entry_from_import` explicitly SKIPS reversal entries for waterfall application (0037:653-657) and no server-side auto-revert exists on the payment-status upsert — so this push is the ONLY propagation path; no double-revert risk. The stale comment at LocalRepositories.kt:1015 ("installment is not in the SyncQueueDispatcher's switch statement yet" — false since TIER 4) corrected. DEVIATION recorded: the T-017 entry framed the installment enqueue as T-059/ADR-005 territory — this fix does NOT rewire the write architecture, it extends the EXISTING sanctioned import-RPC path (the same one batch-registration uses), which is how the interim architecture converges.
- **Verified:** `RefundInstallmentSyncT128Test` 4/4 (enqueue present, payload carries the reverted values, enqueue inside the revert loop after the local write, dispatcher still owns the push path). The T-017 guard suite still passes (a second refund enqueues nothing). Live E2E (Android refund → server installments converge) needs a device + session; recorded as the gap to VERIFIED.

### T-129 — T-102-follow-up: Android chat read-side + online sends (ANDR-CHAT-200) — **Completed (TESTED — 21 new tests; live device/websocket round-trip pending)**

- **What:** the 5th-attempt flagship, delivered. (1) Domain: `ChatChannel`/`ChatMessage` models + `ChatRepository` interface (channels by membership / messages asc / unreadCount / send / markRead). (2) Infrastructure: `SupabaseChatRepository` — a VERBATIM port of the website MessagesView's query semantics (member_ids CS filter, archived hidden, last_message_at ordering [CHAT-104/0061], deleted_at hidden, sent_at ASC, send = direct insert with own read-receipt pre-seeded, markRead = append own read_by entry [0051 contract]); DTOs mirror the SQL columns snake_case; malformed read_by degrades to unread, never crashes. (3) Realtime: T-069's RealtimeSyncManager extended — chat_channels/chat_messages subscribed (empty pull lists: chat is online-only v1) + a `tableEvents` SharedFlow the ViewModels collect for refresh. (4) UI: ChatScreen (channel list, empty-state explains staff-opened conversations [ADR-008]) + ChatDetailScreen (bubbles, auto-scroll, auto-mark-incoming-read, 5000-char composer ceiling, announcements read-only). (5) Wiring: Routes.Chat + Routes.ChatDetail RBAC-gated on USE_CHAT; rbacGate in AppNavHost; Messagerie quick action on the Dashboard hub; DI binds ChatRepository → SupabaseChatRepository (online-only, NOT the Local* layer). SCOPE DECISIONS recorded: NO Room cache (a schema bump v11→v12 + migration + MigrationTestHelper is deferred to a v2 session), NO channel creation (ADR-008: staff create channels from the desktop), online-only sends (fail visibly via userMessage).
- **Verified:** `ChatModelsTest` 5/5 (channel mapping, announcement flags, read_by parsing incl. null + malformed degradation); `ChatWiringScanTest` 6/6 (routes gated, nav wiring, DI binding, Messagerie action, NO channel-creation UI, canonical query semantics); RealtimeSyncT069Test extended — the 6-table subscription set + 2 new tests (chat events emit on tableEvents, NO Room pulls triggered). :app:compileDebugKotlin green. Full-suite re-run at session close. GAP: live websocket round-trip + a real send on a device.

**20th repair session (2026-09-02) — owner mandate: "fix this auth thing or tell me what to do" + "apply the migration tokens, consistent everywhere" + a balanced ~10-task batch.** Session-opening ritual: live chain check **62/62 = 0001–0065, ZERO drift** (fresh script pattern); toolchain RE-provisioned after the container reset (JDK 21 Temurin + SDK 35 + the `.env` secrets-plugin quirk discovered and documented in AGENTS.md §11). Completed this session: **T-119** (AUTH-200 agent-side production config: site_url + uri_allow_list now carry `https://elimtiyaz-website.vercel.app`, live-verified; the runbook + credentials sheet updated; the provider itself remains owner-only), **T-120** (AUTH-201: the pre-sign-in "Auth session missing!" alert + console noise eliminated — getSession-first), **T-121** (AUTH-202: the FCM env warning now names the exact missing vars + where to set them), **T-122** (MIG-TOKENS verification: 15/15 live matrix — dual key formats, RLS, JWKS, chain, key consistency vs owner-supplied values, auth-user census), **T-069** (REALTIME-104 closed: Android realtime subscriptions — the freshness backbone), **T-124** (registry hygiene: DEAD-012 closed with evidence, 3 stale REALTIME summary rows, stale AGENTS.md notes, AUTH rows added to the summary table). Baselines: desktop 75/2236, website 23/436, Android re-run this session. Deferred with reasons: **T-102-follow-up** (Android chat read-side — needs T-069's infrastructure landed first; a full feature build for a dedicated session) and **T-043** (equivalence consolidation per ADR-006 — explicitly "schedule a full session").

### T-119 — AUTH-200 production redirect configuration (agent-side half) — **Completed (TESTED — live config verified; the round-trip itself is owner-gated)**

- **Problems:** AUTH-200 (the agent-side half; owner step remains) · **Priority:** P0 (the owner's "fix this auth thing") · **Severity:** Critical
- **Status:** TESTED (2026-09-02, 20th session)
- **What was done:** live evidence first: the production deployment EXISTS (`redirect_to=https://elimtiyaz-website.vercel.app/` in the owner's pasted error URL) but the live auth config still had `site_url=http://localhost:3000` and `uri_allow_list` without the production origin — meaning even AFTER the provider is enabled, the OAuth redirect would have bounced to localhost (non-allowed redirect_to falls back to site_url). PATCHed via the Management API (comma-separated-string format per the 14th-session discovery): `site_url=https://elimtiyaz-website.vercel.app`, `uri_allow_list=http://localhost:3000,http://localhost:3100,https://elimtiyaz-website.vercel.app` (localhost origins preserved). GET-verified after PATCH (values persisted). Runbook (`docs/operations/portal-google-oauth.md`) updated: status header, step-1 note (Firebase config has NO usable OAuth client — `oauth_client: []`), step-2 JavaScript origins now name the production origin, step-4 probe uses the production redirect_to, a "Production web-push env vars" section, and the 20th-session discoveries (provider-check-before-redirect-validation; the missing /users REST path). Credentials sheet: new §2.2 Production deployment (values table + the Android applicationId discovery).
- **Verification:** apply script `/home/z/my-project/scripts/apply_t-119_auth_production_config.sh` (BEFORE/PATCH-200/AFTER output preserved; kept outside the repo — carries the access token). Live probes: authorize endpoint with bogus vs production redirect_to (both return the provider-disabled 400 — proving the provider check precedes redirect validation; recorded in the runbook). Full round-trip verification remains owner-gated (needs the provider enabled).
- **Left:** the OWNER step (runbook step 1: create the Google Cloud OAuth client + step 3 PATCH, or hand the client id/secret to the next agent session).

### T-120 — AUTH-201: eliminate the pre-sign-in "Auth session missing!" alert + console noise — **Completed (TESTED)**

- **Problems:** AUTH-201 (new) · **Priority:** P1 (owner-pasted production console evidence) · **Severity:** Medium
- **Status:** TESTED (2026-09-02, 20th session)
- **What was done:** `loadProfile()` (auth-provider.tsx) called `getUser()` unconditionally — the NORMAL signed-out state threw `AuthSessionMissingError` → `console.error` + `setError("Auth session missing!")` → the raw English string rendered in the login screen's red alert on EVERY fresh visit (the owner's pasted console). Now: `getSession()` (local, never throws) first; `getUser()` only when a session exists (server-side validation); validation failure → `console.warn` + unauthenticated, NO error state (supabase-js fires SIGNED_OUT itself on refresh failure). Genuine profile/parent fetch failures still set the error state. The T-116 contract (provider_disabled mapping, raw passthrough for other OAuth classes) preserved untouched.
- **Tests:** NEW `src/app/providers/t-auth201-session-noise.test.tsx` (4/4: no-session → no error + getUser NOT called; failed validation → warn not error + no error state; active-profile flow preserved; real fetch errors still surfaced). Existing SEC-007 suite updated for the getSession-first contract (3/3). Website: lint 0, suite 23 files / 436 tests ALL PASS, strict `next build` green.
- **Commits:** website repo + hub (problem entry AUTH-201).

### T-121 — AUTH-202: make the FCM env warning actionable — **Completed (TESTED)**

- **Problems:** AUTH-202 (new) · **Priority:** P2 · **Severity:** Low
- **Status:** TESTED (2026-09-02, 20th session)
- **What was done:** the generic `[env] Firebase env vars are incomplete.` warning (owner's pasted console) named nothing. It now lists the exact missing variables (`NEXT_PUBLIC_FIREBASE_APP_ID (the WEB app id, 1:<project>:web:…)`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY`), says where to set them (Vercel → Project → Settings → Environment Variables), and stays silent when FCM is fully configured or Firebase is intentionally unconfigured. Runbook gained the matching "Production web-push env vars" section (the owner's second 10-minute step).
- **Tests:** NEW `src/lib/t-121-fcm-env-warning.test.ts` (3/3). Website: lint 0, suite 23 files / 436 tests ALL PASS, strict build green.
- **Commits:** website repo + hub (problem entry AUTH-202 + runbook).

### T-069 — Android realtime subscriptions — **Completed (TESTED)**

- **Problems:** REALTIME-104 (OPEN → TESTED) · **Priority:** P2 · **Severity:** High
- **Status:** TESTED (2026-09-02, 20th session — unit-level evidence; the live "server write → UI within seconds" round-trip needs a real device/emulator)
- **What was done:** `RealtimeSyncManager` (new, infrastructure/sync) + `SupabaseRealtimeEventSource` (new, infrastructure/supabase) + the `RealtimePullTarget` seam (PullSyncRepository implements it with its EXISTING granular pulls — no second pull implementation; Hilt binding in SupabaseModule) + an `OnlineGate` fun-interface adapter over OnlineDetector. Subscriptions activate reactively when a session appears and deactivate on sign-out (the FCM-topic pattern; wired in ElImtiyazApplication.onCreate — `realtimeSyncManager.start()`). One realtime channel per table (`android-realtime-<table>`, postgres changes, event `*`, NO column filter — RLS scopes events, the REALTIME-102 lesson; the supabase-kt Realtime plugin auto-provides the session JWT via disconnectOnSessionLoss). Events route to the granular pulls with the website's cross-invalidation semantics (an installment event refreshes installments AND payments — the waterfall can move payments); bursts debounce to one pull pass per table (2s default); online gate fail-closed; pull failures never kill a subscription; the 15-min SyncWorker cycle REMAINS the fallback (pinned by test). DEVIATION from the task text (recorded here per the workflow): `chat_messages` is NOT subscribed yet — Android has no chat read-side (T-102-follow-up, deferred); subscribing with no consumer would be dead traffic. The routing map makes it a one-line addition when T-102 lands.
- **Tests:** NEW `RealtimeSyncT069Test` (11/11: reactive lifecycle ×4 [sign-in activates the 4-table set, sign-out deactivates, idempotent start, unconfigured → zero subscriptions], routing + debounce ×3 [burst → ONE pull; installment → installments AND payments; notification/homework → own pulls only], online gate ×1, production wiring source-scans ×3 [Application start, SDK source filter-free + no setAuth, periodic fallback preserved]). Full Android suite: 39 files / 342 tests / 0 failures (baseline 38/331).
- **Commits:** Android repo (manager + source + seam + DI + wiring + suite) + hub (REALTIME-104 + this entry).

### T-122 — MIG-TOKENS session verification ("apply the migration tokens, consistent everywhere") — **Completed (TESTED)**

- **Problems:** (verification ritual — ARCH-009/ARCH-011 prevention; KEYMIG-300 re-check) · **Priority:** P0 (owner mandate) · **Severity:** —
- **Status:** TESTED (2026-09-02, 20th session)
- **What was done:** the owner's mandate re-executed with the freshly supplied keys: (1) live chain vs local files — 62/62 = 0001–0065, ZERO drift; (2) dual-key matrix — `auth/v1/health` 200 with BOTH the legacy anon JWT and the `sb_publishable_…` key; (3) RLS — anon/publishable REST queries return 200 + `[]` on parents/students/payments/ledger_entries/installments; (4) JWKS 200; (5) key consistency — every owner-supplied public value is byte-identical to the committed values (website `public-config.ts` + `.env.example`; Android `.env.example` URL+JWKS; Firebase API key); (6) auth-user census (SQL endpoint): 1 user — `admin@elimtiyaz.dz`, confirmed, active (the `/v1/users` REST path does not exist — AGENTS.md §11.1 quirk #4). Script: `/home/z/my-project/scripts/verify_t-122_mig_tokens.sh` — **15/15 PASS**.
- **Commits:** hub repo (AGENTS.md §11.1 + this entry + credentials sheet).

### T-123 — Android lint-baseline "unmatched" AGP entries — **Completed (TESTED — investigation; NO change warranted)**

- **Problems:** (lint-backlog hygiene) · **Priority:** P3 · **Severity:** Low
- **Status:** TESTED (2026-09-02, 20th session — investigation closed with a documented discovery)
- **What was found:** lint reported 3 `AndroidGradlePluginVersion` baseline entries "not found" — apparent stale entries. Empirical sequence: prune to 0 → ONE live warning appeared; restore 1 → TWO live warnings appeared; the emission count is network-nondeterministic (lint's version check fires 0–2 identical warnings per run). The 3 committed entries are a deliberate allowance for that variance; `LintBaselineFixed` is informational-only (does not fail the gate).
- **What was done:** NOTHING to the baseline (restored byte-identical: 116 entries, 3 AGP); the discovery documented in change-log T-123 so no future agent "prunes" them and reintroduces intermittent live warnings. `lintDebug` BUILD SUCCESSFUL with the committed baseline (113–114 warnings filtered depending on the run's emission count).
- **Commits:** none needed (no change) — documentation only.

### T-124 — Registry + documentation hygiene (DEAD-012 close, stale rows, AGENTS notes) — **Completed (TESTED)**

- **Problems:** DEAD-012 (closed), summary-table staleness (REALTIME-101/102/103), AGENTS.md §11 stale note, AUTH family absent from the summary table · **Priority:** P2 · **Severity:** Medium (registry trust)
- **Status:** TESTED (2026-09-02, 20th session)
- **What was done:** (a) DEAD-012 CLOSED with evidence (setup.ts exists since the 2026-08-29 root-cause fix; T-049 completed the cleanup; today: 23 files / 436 tests; the stale "missing" note in hub AGENTS.md §11 removed); (b) three summary-table rows whose detailed entries say TESTED but whose table rows said OPEN flipped (REALTIME-101/102/103) + REALTIME-104 row updated; (c) AUTH-200/201/202 rows added to the summary table (the AUTH family had NO summary rows at all — the 14th session's registration gap, now closed); (d) AGENTS.md §11.1 quirk #4 (missing /users REST path) + the Android toolchain note (JRE-only system java; the `.env` empty-value compilation quirk).
- **Verification:** every flip cross-checked against the detailed entry's own status note (the T-117 discipline).
- **Commits:** hub repo.

**19th repair session (2026-09-02) — owner-mandated: "fix the auth thing" + "apply the migration tokens, ensure everything works across all platforms and the migration is properly applied and consistent everywhere".** Session-opening chain check found **LIVE DRIFT**: 62 live rows vs 61 committed files — live-only `0065/canonical_identity_codes` (applied by an actor outside the repos after the 18th-session close; registered as ARCH-013). Completed this session: **T-115** (migration 0065 reconstructed + committed + applied atomically + live-verified 19/19; TS↔SQL equivalence pinned 9/9; typed RPCs registered desktop+website), **T-118** (DRIFT-001 closed: mock layer + approve-signup-request EF aligned to the deterministic server contract, EF redeployed live), **T-116** (AUTH-200 client-side UX mitigated + fresh live evidence + owner instructions refreshed; the provider itself remains owner-action-required), **T-117** (registry hygiene: 12 stale headers flipped; t-052 test portability fixed), **T-107-follow-through** (credentials sheet refreshed + §7 live checklist re-run, both key formats verified; committed values match the owner-supplied keys), **ARCH-012** (release-variant screenshot test scoped with documented exclusion). Deferred with reasons: T-069 + T-102-follow-up (full feature builds — unchanged from the 18th-session deferral; this session's mandate consumed the context budget).

### T-115 — Reconstruct, commit and verify migration 0065 (canonical identity codes at the DB layer) — **Completed (VERIFIED live)**

- **Problems:** ARCH-013 (new) · **Priority:** P0 (owner mandate: "apply the migration tokens … consistent everywhere") · **Severity:** Critical (live↔repo schema drift)
- **Status:** VERIFIED (2026-09-02, 19th session — file==live 5/5 byte-identical; verify_t-115.sql 19/19 live; desktop suite 2236)
- **What was done:** the live-only migration (4 new canonical functions + batch_register_family rewrite, applied to the live DB by an outside actor after the 18th-session close) was reconstructed verbatim from the live catalog via pg_get_functiondef, committed as `0065_canonical_identity_codes.sql` with a full reconstruction-note header, applied live atomically via `apply_0065_live.sh` (MIG-TOKENS: BEGIN + file + registration ON CONFLICT DO NOTHING + COMMIT; the pre-existing row preserved), and verified live (presence, registration, unique constraint, 10 deterministic-generator vectors pinned to the desktop TS engine, the full RPC contract: empty-identity rejection / deterministic codes / duplicate refusal / audit tagging). Typed RPC signatures registered in desktop `types.ts` + website `database.ts`. NEW suite `t-115-sql-identity-equivalence.test.ts` (9) pins the TS↔SQL equivalence permanently + the EF source contract. Full evidence: `docs/recovery/t-115-live-verification.md`.
- **Discoveries persisted:** the Management API SQL endpoint silently DROPS `COMMENT ON` statements (AGENTS.md §11.1 + the live-verification doc); batch_register_family REQUIRES date_of_birth in student JSON (students.date_of_birth NOT NULL, no RPC default); pg_get_functiondef is the only reliable reconstruction source.
- **Commits:** hub repo.

### T-118 — Close DRIFT-001: mock layer + approve-signup-request EF aligned to the deterministic server contract — **Completed (TESTED)**

- **Problems:** DRIFT-001 (OPEN → TESTED/CLOSED) · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-09-02, 19th session)
- **What was done:** (a) `MockParentRepository.createParent` switched from `randomParentSuffix()` (which mirrored 0022's gen_random_bytes — a DEAD server behavior since 0065) to the canonical `deterministicParentCode` + duplicate-identity refusal mirroring the server's unique (tenant_id, parent_code) constraint; the dead `randomParentSuffix` copies deleted from `core/format/id.ts` and `supabase-shared-repositories.ts`. (b) `approve-signup-request/index.ts`'s `Math.random()` parent-code creation replaced with a call to the `fn_deterministic_parent_code` RPC (fail-closed error path `parent_code_failed`); the EF was deployed live 2026-09-02 (anonymous POST → 401 sanity verified).
- **Tests:** NEW `t-018-mock-canonical-create.test.ts` (4/4 — deterministic code equals the canonical generator; duplicate identity refused with ERR_CONFLICT; whitespace-trim equivalence; dead-code scans). Full desktop suite 75 files / 2236 tests ALL PASS; typecheck clean; lint 0 errors.
- **Commits:** hub repo (mock + EF + suite).

### T-116 — AUTH-200 client-side mitigation + fresh live evidence + owner instructions — **Completed (TESTED; the provider itself remains owner-action-required)**

- **Problems:** AUTH-200 (OPEN → OPEN-with-mitigation; owner action still required) · **Priority:** P0 (the owner's "fix this auth thing") · **Severity:** Critical
- **Status:** TESTED (2026-09-02, 19th session — portal UX verified; provider enablement is owner-only)
- **What was done:** live re-verification (Management API): `external_google_enabled: false`, client_id/secret STILL EMPTY; the authorize endpoint's exact failure captured (`400 validation_failed / "Unsupported provider: provider is not enabled"`). Website: `signInWithGoogle` maps that error class to the stable code `provider_disabled`; the login screen renders a localized, actionable message (fr/ar/en `auth.signin.providerDisabled` — "contact the school administration") instead of the raw English server error; raw errors still pass through for other classes. The runbook (`docs/operations/portal-google-oauth.md`) remains the owner's step-by-step (create the Google OAuth client ~10 min + the PATCH; the uri_allow_list quirk documented).
- **Tests:** NEW `src/test/t-auth200-provider-disabled-ux.test.ts` (4/4 — detection pattern, code mapping, dictionary keys in every locale, single assignment site). Website suite 21 files / 429 tests ALL PASS; `next build` green.
- **Commits:** website repo (UX) + hub repo (problem-entry evidence).

### T-117 — Registry hygiene + test portability — **Completed (TESTED)**

- **Problems:** (documentation-consistency class; plus the t-052 portability defect — new discovery) · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-09-02, 19th session)
- **What was done:** (a) 12 problem-registry entries whose HEADER said OPEN while their in-body Status note said FIXED/TESTED/VERIFIED were flipped to match (SEC-001, SEC-002, TENANT-103, SYNC-100, SYNC-101, SYNC-102, CACHE-102, ATT-101, NOTIF-102, NOTIF-103, DRIFT-009, BUG-NEW-004 → TESTED/VERIFIED; the hygiene-fix note is on each header line) — a registry whose header contradicts its body misleads the next agent's problem selection. (b) the committed `t-052-notification-badge.test.ts` had a HARDCODED absolute path to the desktop checkout (`/home/z/my-project/repos/…`) — it failed with ENOENT on any other machine/CI; replaced with a sibling-relative probe (the Android equivalence-runner convention) + `describe.skip` when the hub repo is absent.
- **Tests:** t-052 suite 4/4 on the standard layout; the skip path simulated (missing sibling → skip, no ENOENT). Full website suite green.
- **Commits:** website repo (t-052) + hub repo (registry headers).

### T-106 — Fix the desktop sign-in blocker (owner-reported, DESK-LOGIN-200) — **Completed (VERIFIED live)**

- **Problems:** AUTH-300 (new) · **Priority:** P0 (owner blocker) · **Severity:** Critical
- **Status:** VERIFIED (2026-09-01, 17th session) — root cause diagnosed live (client path clean; both key formats healthy; single confirmed auth user; dummy-grant reproduces `invalid_credentials` 400) → admin credential reset via the auth admin API (owner-supplied service_role authorization) → sign-in verified HTTP 200 with BOTH key formats and `current_user_roles()` → `["super_admin"]` through the new session. Evidence: `scripts/desk_login_200.sh`; problem entry AUTH-300 carries the full probe matrix and the recovery procedure for future agents. The new password was delivered to the owner out-of-band ONLY (never in git, per AGENTS.md §15.12).
- **Commits:** hub-repo docs commit (this entry + AUTH-300 + credentials sheet + change-log).

### T-107 — Apply the new-format Supabase API keys consistently on all three platforms (MIG-KEYS-201, owner mandate) — **Completed (TESTED + live-verified)**

- **Problems:** KEYMIG-300 (new) · **Priority:** P1 (owner mandate) · **Severity:** Medium
- **Status:** TESTED (2026-09-01, 17th session) — ADR-009 written (dual acceptance, publishable-preferred, no destructive switch while legacy keys are active). Website: committed public default (public-config.ts) + .env.example switched to `sb_publishable_…` with the legacy JWT retained in-document as the rollback value; 4-test guard suite `src/test/t-107-api-key-migration.test.ts` (new-format pinned, JWT confined to the rollback comment, placeholder detection accepts the new format, configured state preserved); T-096's fresh-clone format pin updated to the sanctioned new reality (its intent — configured-on-fresh-clone — unchanged). Desktop: Configuration tab guidance now names both formats (label, placeholder, help text, dashboard pointer) + `src/tests/security/api-key-format-acceptance.test.ts` 4/4 (client constructs under EITHER key from local config; SEC guard for the service_role/sb_secret wording). Android: runtime already dual-accepts (`BuildConfig.SUPABASE_ANON_KEY.ifBlank { SUPABASE_PUBLISHABLE_KEY }` — credentials sheet documented this in session 8); .env.example comment updated to point the owner at the preferred publishable value; keys stay OUT of the Android repo per T-064/SEC-005 (no committed APK-path credentials). Backend/Edge Functions: no change — EFs consume the platform-injected `SUPABASE_SERVICE_ROLE_KEY` env name; the `sb_secret_` key is the documented successor when Supabase retires legacy JWTs (runbook note in the credentials sheet).
- **Verification:** website `bun run test` 19 files / 419 tests ALL PASS (+4) and `bun run build` compiled successfully; desktop `npm run typecheck` clean, `npm run lint` 0 errors, `npm test` 69 files / 2196 ALL PASS (+4); LIVE dual-key matrix on hkvkefubghbbotgnteir: auth/health 200 ×2, REST query processed ×2, password-grant 200 ×2 (T-106's verification reused as the auth leg). Gap (why TESTED, not VERIFIED): no deployed portal instance was re-rendered against the new default after the build (headless environment); the owner's next `npm run build` + portal load closes it.
- **Commits:** website commit (public-config + env.example + suites), desktop/hub commit (connection-card + supabase-client + suite + ADR-009 + credentials sheet + registries), android commit (.env.example guidance).

### T-104 — parent_credit balance semantics decision (ADR-010) — **Completed (TESTED)**

- **Problems:** DATA-009 (OPEN → TESTED) · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-09-01, 17th session) — ADR-010 written choosing option (b) (writer preserved; display convention standardized). Desktop: `displayParentCredit` helper in the canonical balance module + `ParentFinancialProfile.totalUnallocatedCredit` fed by both profile builders + dossier "Crédit parent" card renders the derived value. Website: `displayCredit` verbatim port + Finance-tab credit KPI. 8 desktop tests + 6 website tests pin every population (canonical double-count, unmaterialized historical, goodwill, mixed, clamps) and guard the call sites.
- **Verification:** desktop suite 2204 passed (+8, equivalence suites pinning the unchanged writer still green), typecheck clean; website suite 425 passed (+6), build green. ADR-010 carries the population matrix + implementation map (incl. the Android port note and the dormant debt-meter prop).
- **Commits:** hub repo + website repo.

### T-034 — Desktop cache refresh strategy — **Completed (TESTED)**

- **Problems:** CROSS-104 (TESTED), CROSS-104b (definition half — ADR-005 amendment) · **Priority:** P2 · **Severity:** High
- **Status:** TESTED (2026-09-01, 17th session) — DESIGN CHOICE (documented per the task's own requirement): TTL + window-focus freshness policy, explicitly NOT realtime for this pass (one small testable mechanism across all 9 affected caches vs per-table channel/reconnect lifecycle; realtime stays layerable later — the website's useFinancialRealtime is the in-repo reference). NEW `src/infrastructure/supabase/cache-freshness.ts` (`CacheFreshness`: 30s TTL, focus-forced refresh, deterministic test seams); all NINE one-shot `seeded` boolean sites swapped (parents/students/ledger/installments/payments + expense + personnel ×2 + notifications) — cross-client writes now surface within the freshness budget without a restart, and a failed seed retries after the TTL instead of caching [] for the whole session. CROSS-104b: ADR-005 amendment defines the shared sync_queue audit-trail semantics (field table + the sync_queue-is-never-business-data non-goal); Android implementation remains T-059.
- **Tests:** NEW `src/tests/infrastructure/t-034-cache-freshness.test.ts` 7/7 (defect reproduction against a counting fake client: stale-inside-TTL / fresh-after-TTL; focus-force; no server hammering; failed-seed recovery; boundary + one-shot-force + listener unit semantics).
- **Verification:** `npm run typecheck` clean; `npm run lint` 0 errors; full desktop suite green (counts in change-log). Gap: the two-instance realtime E2E named in the original verification criterion needs a desktop host (headless container) — the counting-fake tests stand in for the freshness budget.
- **Commits:** hub repo.

### T-108 — Electron renderer CSP hardening (DESK-CSP-202, owner-pasted evidence) — **Completed (TESTED)**

- **Problems:** SEC-113 (new) · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-09-01, 17th session) — CSP meta added to `index.html` (dev + packaged): `script-src 'self'` (no unsafe-eval/inline), hardened object/frame-ancestors/base-uri/form-action, with documented functional allowances (Google Fonts, inline style attributes for the design system, blob: worker/img for the media vault + exports, user-configured Supabase connect-src TLS-only). NEW `src/tests/security/csp-policy.test.ts` 4/4 pins the security-critical properties. Launch-verified: production under Xvfb (25s alive) and dev against the Vite server (30s) — ZERO "Insecure Content-Security-Policy" warnings and zero CSP violations in both modes (the owner's pasted warning class). Typecheck clean, lint 0 errors, full suite green.
- **Commits:** hub repo.

### 17th session — Android batch + T-017 (T-020, T-021, T-046, T-051, T-017) — all **Completed (TESTED)**

- **T-020 (SYNC-103):** NEW `SyncErrorClassifier` — tryThenEnqueue requeues transient failures (offline/transport/5xx), fail-fast for 4xx. `SyncRequeueT020Test` 6/6. Status TESTED.
- **T-021 (SYNC-106/107):** `syncNow` suspend + awaits drain (honest Result); `DrainResult.remainingPending` + SyncWorker retry/failure/success mapping. `SyncCompletionT021Test` 5/5. Status TESTED.
- **T-046 (ARCH-004):** destructive-migration fallback REMOVED; loud failure pinned by Robolectric (write→reopen data preservation; unresolvable transition throws) + chain scans. `DatabaseMigrationDisciplineT046Test` 3/3. Gap: MigrationTestHelper needs exportSchema=true (follow-up; T-045 first). Status TESTED.
- **T-051 (WEAK-011, TENANT-104, WEAK-012):** NEW `AuditContext` (Lazy<SessionManager> breaks the DI cycle) — all 17 repository classes session-aware; ZERO demo-tenant literals left in LocalRepositories*; pull fallback pulls nothing when signed out. `TenantStampingT051Test` 7/7. Status TESTED.
- **T-017 (BUSINESS-102, CROSS-102 — interim):** already-refunded terminal-state guard (no double refund) + reason in the refund sync payload; installment-convergence enqueue stays ADR-005/T-059-gated. `RefundCorrectnessT017Test` 3/3. Status TESTED.
- **Android suite:** 34 files / 298 tests / 0 failures (275 baseline + 23). Toolchain re-provisioned in-session (JDK 21 + SDK 35; recipe in change-log).

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

### T-026 — Align the overdue rule on Android
- **Problems:** DRIFT-006, WEAK-007, BUSINESS-007 · **Priority:** P1 · **Severity:** Critical (WEAK-007 user-facing)
- **Status:** TESTED (2026-08-31, 13th session)
- **What was done:** `LedgerEngine.maxDaysOverdueFromLedger` re-derived per the canonical INV-4 rule: days-overdue is measured from the account's DUE DATE (latest charge `at` per account via `buildOverdueDueDateMap`), only for accounts with balance > 0 whose due date is past — NOT from the oldest charge's creation date (the old code read a charge created today for next year's tuition as "~365 days overdue"). EVERY production `computeParentSummary` call site in `LocalRepositories2.kt` now builds and passes the due-date map (including balance-only reads — the debt-dashboard `totalOutstanding` KPI loop and `sendReminder` — so no future edit can silently reintroduce the empty-map default that kept "Créances en Retard" permanently 0 DZD). A source-scan pin test enforces this permanently.
- **Tests:** NEW `app/src/test/java/com/example/core/OverdueRuleT026Test.kt` 10/10 (due-date map builder, INV-4 overdue classification, creation-vs-due-date distinction, days-overdue flooring, settled-account exclusion, max-across-accounts, INV-4 consistency totalOverdue ≡ maxDaysOverdueFromLedger, call-site map pins).
- **Verification:** Android `testDebugUnitTest` 275/275 (0 failures / 0 errors / 0 skipped across 29 files; +41 tests this batch, 10 of them this task); full compile of main + test sources; `assembleDebug` green (APK 29.8 MB). Cross-platform equivalence is pinned by the shared INV-4 semantics + desktop-side equivalence cases already in the desktop suite.
- **Commits:** 3462a38 — android repo.
- **Left:** nothing for T-026; the 0.001 DZD threshold alignment note (BUSINESS-007) is closed by the same canonical-rule adoption.

### T-054 — Android hollow implementations
- **Problems:** WEAK-006, WEAK-008 · **Priority:** P2 · **Severity:** Critical (WEAK-006 user-facing lie)
- **Status:** TESTED (2026-08-31, 13th session)
- **What was done:** WEAK-006: `LocalInstallmentRepository.regenerateForCycle` now REALLY re-derives due dates (mirrors the desktop `SupabaseInstallmentRepository.regenerateForCycle`): non-paid tranches get the official schedule (Sept 15 / Dec 15 / Mar 15 via `officialTuitionDueDates(year)`, tranche number from the label's first digit), custom-schedule flags reset, `academic_cycle` stamped, each patched row enqueued to the sync queue (idempotent `upsert_installment_from_import` path), paid tranches preserved, audit row records the REAL rederived count — the old implementation wrote an audit row and returned the installments UNCHANGED. WEAK-008: `WorkflowRunEntity` gains the `trigger` column (`MIGRATION_11_12`, v11→v12, `DEFAULT 'manual'` preserving historical rows' meaning), `WorkflowRunDto.toEntity()` keeps the server's real trigger, `toDomain()` maps it via `WorkflowTrigger.fromCode(trigger)` — the hardcoded "manual" is gone (every pulled run used to display "Manuel" regardless of how it started).
- **Tests:** NEW `app/src/test/java/com/example/infrastructure/local/HollowImplementationsT054Test.kt` 7/7 (trigger survives DTO→entity mapping; null trigger defaults to manual; entity constructor default matches migration default; wire-code enum resolution incl. unknown fallback; source-scan pins for the toDomain mapping, the migration, and the regenerate contract: official schedule, paid-skip, flag reset, cycle stamp, sync enqueue, hollow-pattern-gone).
- **Verification:** Android `testDebugUnitTest` 275/275; `MIGRATION_11_12` registered in `DatabaseModule`'s migration list; full compile; debug APK assembles.
- **Commits:** 3462a38 — android repo.
- **Left:** on-device Room migration smoke test (12→12) needs real hardware (recorded, not claimed).

### T-062 — Android dead-code removal
- **Problems:** DEAD-007, DEAD-008, DEAD-009, DRIFT-007 · **Priority:** P3 · **Severity:** Low
- **Status:** TESTED (2026-08-31, 13th session)
- **What was done:** DEAD-008: `infrastructure/stub/StubRepositories.kt` (2-line comment-only stub) DELETED. DEAD-009: the 833-line design-system gallery showcase DELETED (ElGalleryActivity + ElGalleryScreen + GallerySection + 5 tab files — unreachable from production, never registered in the manifest; deletion chosen over dev-only registration per the reachability rule). DEAD-007: `AuditActions.kt` trimmed from 80+ constants to the 12 the app ACTUALLY writes (76 never-referenced constants removed after a per-constant reachability scan; the file now documents the rule: declare new constants here at write time, full registry lives in the desktop). DRIFT-007: the `SupabaseModule` KDoc corrected — remote sync is ALREADY wired via `SyncSupport.enqueueOnly` + `SyncQueueDispatcher`'s canonical RPCs (the old comment promised a `@Binds` swap that was never needed). Bonus: unused private `SyncService.isSupabaseConfigured()` (hyphen-only duplicate of the NetworkTimeouts gate) removed.
- **Tests:** NEW `app/src/test/java/com/example/core/DeadCodeT062Test.kt` 5/5 (StubRepositories absent, gallery directory absent, AuditActions contains only referenced constants + no removed family, SupabaseModule KDoc describes the real wiring).
- **Verification:** Android `testDebugUnitTest` 275/275; grep over main+test sources shows zero references to any deleted symbol (the only mentions are the T-062 test's own absence pins); manifest has no gallery entry; `assembleDebug` green — APK size note: **29.8 MB debug APK** after removing ~973 lines (no baseline APK exists from before; the debug build is unshrunk so the line-count reduction dominates).
- **Commits:** 3462a38 — android repo.
- **Left:** nothing — all four problem entries closed.

### T-063 — Android absence-alert threshold
- **Problems:** ATT-103 · **Priority:** P3 · **Severity:** Low
- **Status:** TESTED (2026-08-31, 13th session)
- **What was done:** NEW `core/Terms.kt` — Kotlin mirror of the desktop's `src/domain/calc/academics/terms.ts` (T1 Sep 1–Dec 15 / T2 Dec 16–Mar 15 / T3 Mar 16–Jun 30, Jan–Aug reads as the previous school year's T3 tail; label format byte-identical to the desktop so notification text matches cross-platform). `alertAbsences` adopts the desktop rule: only students with ≥3 absences (absent_unexcused + absent_excused, LATE excluded) within the CURRENT TERM are flagged (previously Android alerted for EVERY student in the input — effective threshold 1, alert fatigue + cross-platform divergence); the notification body now carries the count + term label mirroring the desktop message.
- **Tests:** NEW `app/src/test/java/com/example/core/TermsT063Test.kt` 10/10 (term-window boundaries for every month, year-boundary spans, Jan–Aug previous-year rule, label format, threshold boundary at 2 vs 3, late-exclusion, out-of-term exclusion, input-order preservation).
- **Verification:** Android `testDebugUnitTest` 275/275; wired in production via `LocalRepositories2.kt` `alertAbsences` (currentTermWindow + absenceAlertThreshold call the pure functions, scan-verified).
- **Commits:** 3462a38 — android repo.
- **Left:** nothing.

### T-064 — Android config dialog security
- **Problems:** SEC-004, SEC-005 · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-31, 13th session)
- **What was done:** SEC-004: the SupabaseConfigDialog anon-key field is masked by default (`PasswordVisualTransformation` + show/hide `IconButton`) — the JWT was previously rendered in plain text; the helper text no longer leaks the internal toolchain ("Google AI Studio" → .env guidance only). SEC-005: `SupabaseClientProvider` no longer falls back to the PUBLIC `https://demo.supabase.co` + `demo-key` in ANY path (URL normalization AND the exception handler) — the inert fallback is `https://supabase.unconfigured.invalid` (RFC-2606 reserved TLD, can never resolve) + `inert-unconfigured-key`, so unconfigured builds make ZERO network calls to any real host. RESIDUAL SCOPE CLOSED (noted as left by T-050): `NetworkTimeouts.isSupabaseConfigured`'s placeholder detection was hyphen-only — now extracted into a pure, unit-testable `looksLikePlaceholderConfig(url, key)` catching the `.env.example` values (`YOUR_PROJECT` underscore, `your-anon-key-here` suffix), hyphen/underscore variants, demo/inert literals, quoted env values, and blank/non-https pairs. The unconfigured check therefore fails closed on every known template shape.
- **Tests:** NEW `app/src/test/java/com/example/infrastructure/supabase/SupabaseConfigSecurityT064Test.kt` 9/9 (inert host RFC-2606 + no real supabase.co reference, inert key is not a real credential, demo endpoint gone from provider incl. exception path, dialog masks key + has toggle, no toolchain leak, .env guidance present, env-example placeholder pair detected, real credentials pass, blank/non-https/demo/inert pairs unconfigured, quoted values unwrapped).
- **Verification:** Android `testDebugUnitTest` 275/275; compile clean; the T-050 OnlineDetector placeholder handling and this detection now agree on the YOUR_PROJECT variant.
- **Commits:** 3462a38 — android repo.
- **Left:** nothing for the dialog/provider; NetworkTimeouts detection is now complete (the T-050 "left" note is superseded by this entry).

## Completed (eleventh repair session — 2026-08-31, owner-requested ~10-task batch)

### T-096 — Durable out-of-the-box portal configuration (14th session)
- **Problems:** ENV-300 (new, discovered+fixed), owner-facing "Missing configuration" recurrence · **Priority:** P0 · **Severity:** High (owner-blocking)
- **Status:** TESTED (2026-08-31)
- **What was done:** public client identifiers (Supabase URL + anon key + Firebase web config sans VAPID/web-app-id) committed as code-level defaults in `src/lib/public-config.ts` (classified public per `docs/operations/credentials.md`); `env.ts` falls back to them when env vars are absent (`.env.local` still overrides). ROOT-CAUSE FIX: unset `NEXT_PUBLIC_DEFAULT_LOCALE` fed "" into the zod enum → the WHOLE parse failed → every env value reset to "" (ENV-300 — the banner could appear even with env vars set); empty/unknown locales now resolve to undefined so `.default("fr")` applies. `.env.example` completed with the real public values. 5 regression tests (fresh-clone configured, FCM truthfully disabled, env override wins, placeholder detection intact, no server secrets committed).
- **Tests:** `src/lib/t-096-portal-default-config.test.ts` 5/5; suite 16→17 files / 153 tests ALL PASS; lint clean; strict build green.
- **Verification (live):** fresh-clone render with NO `.env.local` (`next dev` :3100 + agent-browser): "Bienvenue sur le portail El-Imtiyaz" + Google button ENABLED; "Configuration manquante"/"Missing configuration" programmatic check = BANNER ABSENT; screenshot `download/portal-verification/portal-fresh-clone-no-env.png`. This fix SURVIVES a clone/push cycle (values are in the repo, not in gitignored files).
- **Commits:** website repo `fix(config): T-096 …`.

### T-097 — Fix the desktop Electron ESM start failure (14th session)
- **Problems:** owner-blocking (error archived in commit 3f7ec01's message: `ReferenceError: exports is not defined in ES module scope` at dist-electron/main.js) · **Priority:** P0 · **Severity:** Critical (app would not start)
- **Status:** TESTED (2026-08-31)
- **What was done:** `package.json` has `"type": "module"` while the electron tsconfig emits CommonJS — `dist-electron/main.js` was loaded as ESM and crashed at startup. Fix: rename sources to TypeScript's CommonJS-extension form — `electron/main.cts` / `electron/preload.cts` → emit `dist-electron/main.cjs` / `preload.cjs` (Node/Electron always treat `.cjs` as CommonJS regardless of package `type`); `package.json.main` → `dist-electron/main.cjs`; all scripts de-mv'd (the owner's partial workaround `tsconfig.preload.json` + mv chain REMOVED — superseded); preload path in main → `preload.cjs`. ALSO: `npm start` used to launch DEV mode unpackaged (ERR_CONNECTION_REFUSED on localhost:5173, empty window) — isDev now respects `NODE_ENV=production` and `start` sets it, so `npm start` is a true standalone production launch (build + load `dist/index.html`).
- **Tests:** `npm run typecheck` clean; `tsc -p electron/tsconfig.json` emits .cjs; `npm run lint` 0 errors (warning baseline unchanged in kind).
- **Verification (launch):** `DISPLAY=:99 Xvfb` + `NODE_ENV=production electron .` — exit 124 (30s timeout kill = app stayed alive), NO "exports is not defined", NO "Failed to load URL" (renderer `dist/index.html` loaded; only cosmetic container dbus/GPU errors). Log: `download/portal-verification/desktop-launch-t097.log`.

### T-098 — Chat backend completion: migration 0061 (14th session)
- **Problems:** CHAT-103 (creation path), CHAT-104 (last-message ordering), chat_channels UPDATE-policy gap · **Priority:** P0 · **Severity:** High (owner-requested chat)
- **Status:** TESTED (2026-08-31 — applied live + registered atomically per the MIG-TOKENS pattern)
- **What was done:** `0061_chat_channel_completion.sql`: (1) chat_channels completion columns (description, department_id, archived_at, last_message_at, last_message_preview); (2) `chat_channels_update` policy (staff/creator-gated — enables desktop updateChannel/archiveChannel/addMembers); (3) `touch_chat_channel_on_message()` SECURITY DEFINER trigger on chat_messages INSERT (CHAT-104 — rationale in the migration header: the UPDATE must run for ANY author incl. parents while the update policy is staff-gated; only denormalized preview columns are touched); (4) canonical idempotent `create_direct_channel(p_other_profile_id, p_name)` RPC — SECURITY DEFINER with full caller verification (staff gate + target-exists + fixed 'direct'; the 0050/0055 hardened pattern — INVOKER was impossible because `user_profiles_select_own` RLS hides other profiles from manager/teacher callers); audits channel creation. Session-opening chain check FIRST (57/57 == 0001–0060, zero drift — script persisted). Applied via `scripts/apply_0061_live.sh` (atomic BEGIN…registration…COMMIT).
- **Tests:** live `scripts/verify_t-098.sql` — **15/15 PASS** (registration, 5 columns, update policy, trigger, happy path with deterministic DM code, idempotency, staff gate, self-rejection, fabricated-profile rejection, trigger-fires, non-member invisible, anon invisible, non-staff update blocked 0-rows + name intact, staff update allowed, audit rows). REST layer: anonymous rpc() → 401. Append-only migration guard green (58 files, +1 new).
- **Commits:** hub `fix(chat): T-098 …`.

### T-099 — Desktop SupabaseChatRepository (14th session)
- **Problems:** CHAT-105 (chat stays on the mock in Supabase mode) · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-08-31)
- **What was done:** `src/infrastructure/supabase/repositories/supabase-chat-repository.ts` — full ChatRepository implementation on chat_channels/chat_messages: realtime subscriptions (postgres_changes on both tables), personnel-id→user_profiles.id translation on every write (the UI mixes session.userId [profile id] with personnel picker ids — header note documents the two ID spaces), direct channels via the canonical RPC, markRead preserving existing read_by entries byte-identically (the 0051 append-only guard checks jsonb containment — regenerating read_at fails), soft delete, authorName resolution via user_profiles then personnel, CHAT-104 ordering. Wired into `getSupabaseRepositories()` (the `chat` slot no longer falls through to the mock).
- **Tests:** `src/tests/infrastructure/t-099-supabase-chat-repository.test.ts` — 12/12 (RPC routing + translation, unlinked-personnel error, group insert shape, sendMessage read_by seeding + attachments mapping, markRead append-only contract, soft delete, edit, observeChannels filter/sort, deleted filtering + name resolution). Full desktop suite 66 files / 2177 tests ALL PASS; typecheck clean.

### T-100 — Staff↔parent channel creation entry point (14th session)
- **Problems:** CHAT-103 (the parent-facing half) · **Priority:** P1 · **Severity:** High
- **Status:** TESTED (2026-08-31)
- **What was done:** `openParentChannel(parentId, displayName)` added to the ChatRepository contract (+ mock parity impl): resolves parents.auth_user_id → user_profiles.id, then calls the canonical idempotent RPC (caller resolved server-side). Parent-detail-drawer gained the "Messager" action (MessagesSquare icon) with toasts; clear validation errors when the parent has no portal account yet (activation-code first) or the profile is pending.
- **Tests:** 3 dedicated tests in the t-099 suite (RPC called with the resolved profile id + name; no linked account → clear error, no RPC; unknown parent → not-found). Typecheck clean; full suite green.

### T-101 — Website chat readiness on the completed backend (14th session)
- **Problems:** CHAT-104 (portal half), WEAK-023 note accuracy · **Priority:** P2 · **Severity:** Medium
- **Status:** TESTED (2026-08-31)
- **What was done:** `ChatChannelRow` typed with the 0061 completion columns (no `as unknown as` — WEAK-017 rule); `useChatChannels` hides archived channels and orders by `last_message_at desc nulls last`; ChannelListItem renders the denormalized last-message preview + relative time; the unread-count accuracy note corrected (chat now HAS production writers — the old "no writers" justification is gone; the 500-row lower-bound caveat itself remains true). The read/reply/markRead side was already correct (T-032 + 0051 policy) — verified, not changed.
- **Tests:** `src/test/t-101-portal-chat-readiness.test.ts` 4/4; suite 17 files / 153 tests ALL PASS; lint clean; strict build green.

### T-102 — Android chat scope gap: document + register (14th session)
- **Problems:** ANDR-CHAT-200 (new) · **Priority:** P3 · **Severity:** Medium (scope gap, not a regression)
- **Status:** TESTED (2026-08-31 — documentation task complete; the implementation decision is the follow-up)
- **What was done:** repo-wide search confirmed Android has ZERO chat code (only USE_CHAT/MANAGE_CHAT_CHANNELS permission constants in core/Rbac.kt). Registered ANDR-CHAT-200 + this task: next agent either builds the Android chat screen on the canonical tables (read-side + online sends feasible now; offline queueing depends on ADR-005) or prunes the dead permission codes. ADR-008 records the cross-platform decision. This keeps "fix the chat in all platforms" honest: desktop + website + backend are done and verified; Android chat is a NEW feature request, not a fix.

---

### T-103 — Financial data reconciliation + cross-view read consistency (owner-reported Finance-tab vs dossier divergence)
- **Problems:** DATA-008 (new, the owner report), DATA-001, DATA-002, DATA-003, DATA-004, DATA-009 (new discovery) · **Priority:** P0 (owner-mandated) · **Severity:** Critical
- **Status:** VERIFIED (2026-09-01, 15th session — live 8/8 + desktop 2187/2187)
- **What was done (data layer — migration 0062, applied live atomically with registration, MIG-TOKENS):**
  1. DATA-002 fix: payments-table row `IMP-2a049159…-V2_ALT` corrected 90,000 → 100,000 DZD (ledger + source Excel row 235 both say 100,000; the second import run mis-read the 2V column — same-name row 242 has 2V=90,000).
  2. DATA-003 fix: 54 missing transport charges inserted (34 parents, +2,064,000 — the import wrote transport payments but never the charges); 2 "Dettes antérieures" charges folded into Tranche 1 with traceability notes (METAH NADA 7,000 / DAHMANI FARES 8,000); SIDI MAMER's overstated schedule reduced to the Excel devis net (T3 63,000 → 26,500, −36,500).
  3. DATA-001/004 fix: installments reset and ALL 888 payments replayed through the canonical waterfall (parent + category, chronological, oldest-due-first) → 1,310 payment_allocations; payments.installment_id linked for single-target payments; expected/excess/remark populated on every payment. No parent_credit entries materialized for the 59 historical overpayers (deliberate — see DATA-009).
- **What was done (code layer — desktop read paths):**
  1. `installmentRemaining`/`totalOutstanding` now subtract `amountPending` (INV-4 family; new `sumInstallmentsPending`) — desktop aligned with backend/website/Android.
  2. Finance "Tranches" tab: "Reste" column, collect preset, disabled predicate, due-date modal → all via `installmentRemaining` (inline formula removed).
  3. Student payments tab lineItems → `installmentRemaining`.
  4. Parent profile (Supabase + mock): `totalDue` = charges + adjustments (net), `totalPaid` = all payment entries (both modes identical); dossier renders negative balance as a positive "Crédit parent" card.
  5. `mapPaymentRow` surfaces expected/excess/remark (PaymentBreakdownCard now works live); `PaymentRow` typed for the 0033 columns.
- **Tests:** NEW `src/tests/domain/calc/t-103-finance-consistency.test.ts` 10/10 (INV-4 formula ×3, totalOutstanding ×3, pending-sum helper, hint-field mapping ×2, net-profile derivation).
- **Verification:** full desktop suite **67 files / 2187 tests ALL PASS**; typecheck clean; lint 0 errors; append-only migration guard green (59 files, +1 = 0062); live chain 59/59 (local files == live registrations, JSON-diffed); LIVE reconciliation verification 8/8 via `scripts/verify_t-103.sql` (C1 allocations consistent, C2 payments==ledger, C3 due==charges+adj, C4 no over-applied tranche, C5 debtors remaining==balance, C6 overpayers 0 remaining, C7 expected/excess populated, C8 transport charges present) with 0/258 residual mismatches on every pair; owner's parent spot-check (e3e90f1f: due 337,000 / paid 493,500 / remaining 0 / credit 156,500). Full matrix: `docs/recovery/t-103-live-verification.md`.
- **Left:** DATA-005 (first_name split) remains open under T-085; DATA-009 (parent_credit double-count) registered as T-104 decision task; the reconciliation's dry-run/full-run scripts persisted under `elimtiyaz-desktop/scripts/` + `/home/z/my-project/scripts/`.
- **Commits:** see change-log entry (15th session).

---

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

### T-104 — parent_credit balance semantics decision (ADR) — **Completed (TESTED, 17th session — ADR-010 Accepted + implemented + pinned; the Ready listing was stale, corrected by T-156, 25th session)**
- **Problems:** DATA-009 (new — discovered by T-103, live-verified empirically) · **Priority:** P2 · **Severity:** Medium (design decision; no current data corruption)
- **Status:** TESTED (2026-09-01, 17th session) — ADR-010 (option b: keep the canonical writer, standardize the display-level derivation `displayParentCredit`) implemented on desktop (dossier card) AND website (`displayCredit` port), pinned by `t-104-display-credit.test.ts` (desktop 8 tests + website 6). The 25th session (T-157) wired ADR-010's last noted residual — the unified-payment-modal debt-meter's dormant `unallocatedCredit` prop — through the same derivation, +2 more guards.
- ~~Description: the canonical writer `collect_and_allocate_payment` books the FULL payment entry (−amount) AND a parent_credit adjustment (−unallocated) on overpayment... Decide + write an ADR~~ → DECIDED: **ADR-010, docs/decisions/ADR-010-parent-credit-display-convention.md** (read it for the derivation, the population table, and the consequences).
- ~~Dependencies: none (ADR-002 context; do not implement without the ADR)~~ → none remain.
- ~~Verification: ADR written + whichever convention chosen is equivalence-tested across desktop/SQL/Android/website.~~ → ADR-010 written; desktop + website suites pin the derivation; the canonical writer is untouched so the equivalence suites stayed green.
- **Task T-156 correction note (2026-09-04, 25th session):** this entry sat in "Ready" across three session closeouts (23rd/24th summaries kept listing it) although ADR-010 shipped it in the 17th session. LESSON: a session completing a task whose entry lives in a section header (Ready/Blocked) must REMOVE the entry from that section in the same session — a status note inside the entry is not enough.

---

### T-105 — Excel-corpus cross-platform equivalence + full financial reconciliation to the source workbook (owner-mandated)
- **Problems:** DATA-010 (new), DATA-011 (new), DATA-008 (extension → corpus-level closure), DATA-003 (classification correction), DATA-009 (impact re-scope) · **Priority:** P0 (owner-mandated: "fully test this problem against all the other platforms using the real Excel spreadsheet sample … and make sure there is equivalence in the calculations across all 3 platforms in all the users in the spreadsheet and it is synced when someone does it in the supabase db") · **Severity:** Critical
- **Status:** VERIFIED (2026-09-01, 16th session — live 259/259 × 6 + ops 14/14 + three-platform 259/259 each)
- **What was done (discovery — the workbook as oracle):**
  1. Extracted the FULL corpus of the real workbook (`Suivis clients  2026_2027.xlsx`, sheet ETAT 20262027, rows 2-391 = 390 students / 247 phone-grouped parents / 259 DB parents) with an independent Python reference calculator; proved the workbook is internally consistent: P = Σ payment columns 390/390, Q = L − P 390/390, and **L is already NET of remise** (raw formulas read: `=25000+205000+35000-J2`, `=300000-J235`).
  2. Live three-way diagnostic (Excel ↔ payments ↔ ledger ↔ installments, name+phone join): M1 paid 258/259 (one missing family), netdue matched only 61/258 — 223 parents matched the DOUBLE-REMISE hypothesis (DATA-010, Σ −9,709,700 DZD), ~35 matched neither (schedule-vs-devis residuals); identified row 242 as never imported (DATA-011).
- **What was done (data layer — migration 0063_excel_corpus_alignment.sql, applied live atomically with registration, MIG-TOKENS):**
  1. STEP 1 — compensating +|J| adjustments for every imported "Remise sur devis" −J entry (append-only, idempotent source_ids) → kills the double discount.
  2. STEP 2 — creates the missing row-242 family (parent 0554288142, student, 3 tranches 102,000/76,500/76,500, devis charge 255,000 NET, 3 payments 255,000, audit entry) exactly per the workbook.
  3. STEP 3 — per-student alignment: target = devis + dettes (− remboursement); ledger adjustment ±delta + installment absorption via the last-tranche rule (0062 precedent) with negative-delta cascade + status recompute.
  4. STEP 4 — full waterfall replay (DELETE allocations → reset → replay all payments) so payment_allocations / expected / excess / installment links match the new totals.
  5. Idempotency (double-run dry-run verified identical) + fresh-deployment no-op guards + audit summary marker.
- **What was done (code layer — desktop importer, so a re-import cannot reintroduce the bugs):**
  1. `repository-adapter.ts buildFinancialEntries` — NO ledger entry for the remise (the devis charge from L is already net; comment cites the formula evidence).
  2. `buildInstallmentRows` — NEW C3 reconciliation: Σ tranches due ← devis + dettes − remboursement (last-tranche absorption, cascade, status recompute; immutable Installment rebuilt by index).
  3. NEW regression suite `src/tests/integration/t-105-import-shape.test.ts` (real-workbook import): 5/5.
- **Cross-platform equivalence (the owner's core ask):**
  1. Generated 259 canonical `computeParentSummary` scenarios from the POST-0063 live corpus (real ledger entries + tranches per parent) into `financial-tests/equivalence/scenarios/t105_*.json`, with `then` = the live `compute_parent_summary` SQL RPC values (the backend leg).
  2. Desktop TS runner: **259/259 == backend**; Android Kotlin runner (gradle, JDK 21 + SDK 35 installed in-session): **259/259 == backend** (304/304 scenarios incl. the original 45; the only ✗ is the pinned zero-payment all-engine error case); website port (portal-derive): NEW `src/test/t-105-corpus-equivalence.test.ts` — **262/262** (259 parents + aggregate + INV-4); triple comparator: **304/304 equivalent, 0 discrepant**.
- **Live write-path sync test (`scripts/verify_t-105-ops.sql`, rolled back):** OP-A payment (cash 20,000) → payment+ledger+waterfall+summary ±20,000 exactly, I1 payments==ledger, I3 due==charges+adj; OP-B registration (`batch_register_family` + FI Tranche-1 payment 25,000) → clean zero state, allocated=25,000 on T1, I1/I3 hold; OP-C pending check → amount_pending (INV-4), remaining non-negative; OP-D revert → refunded payment excluded, I1 holds with reversed-originals-excluded. **14/14 TRUE.**
- **Verification:** `scripts/verify_t-105.sql` live — M1 paid 259/259, M2 netdue 259/259, M3 balance 259/259, C3 259/259, C4 259/259, C5 259/259 (before 0063: 61/258 on M2/M3); `verify_t-103.sql` re-run 8/8 still TRUE; chain 60/60 (0001-0063, JSON-diffed zero drift); desktop suite 69 files / 2192 tests ALL PASS + typecheck clean + lint 0 errors; website 18 files / 415 tests + lint clean + build green; spot checks: ZIREG LEA (devis 239,500 = paid, créance 0 — was fake −25,500 credit), MAMER A (463,500 due / 493,500 paid / −30,000 credit per the workbook's own Q), MAMER B (255,000/255,000/0). Full matrix: `docs/recovery/t-105-live-verification.md`.
- **Left:** T-104 (DATA-009 ADR — now affects only NEW overpayments); the corpus scenarios are pinned fixtures — regenerate if the corpus changes materially; Android needs a local JDK+SDK to run the suite in this container (installed under /home/z/my-project/bin — NOT part of the repo).
- **Commits:** see change-log entry (16th session).

---

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

#### T-082 — Restore the Android lint gate (baseline or fix the NewApi backlog) — **Completed (TESTED, 18th session)**
- **Problems:** ARCH-008 (new — discovered during T-002, 2026-08-29) · **Priority:** P1 · **Severity:** High
- **Description:** `./gradlew :app:lintDebug` aborts with 315 pre-existing errors / 112 warnings (dominant class: `NewApi` — java.time.* with minSdk 24 and no core-library desugaring; worst files LocalRepositories2.kt 216, DatabaseSeeder.kt 64, LocalRepositories.kt 60, LedgerEngine.kt 36, libs.versions.toml 120 via a different check). Follow the T-078 desktop precedent: (1) decide the desugaring question — enabling core-library desugaring genuinely fixes the NewApi class and is the correct long-term fix; (2) whichever path is chosen, create `app/lint-baseline.xml` pinning the remaining backlog to exact per-rule counts, documented in the build config like T-078 did; (3) fix any NEW findings the baseline surfaces (none should be suppressed silently).
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** `./gradlew :app:lintDebug` green with the baseline (or zero errors after desugaring); per-rule counts documented; the existing 219-test suite stays green.
- **Verification:** evidence in change-log.
- **ADRs:** —
- **Result (2026-09-01, 18th session):** the desugaring question DECIDED — core-library desugaring enabled (desugar_jdk_libs 2.1.5): lint's own "or core library desugaring" annotation on all 313 API-26 findings confirmed it as the root fix (NewApi 337 → 0). The 2 SuspiciousIndentation errors fixed IN CODE (LocalRepositories.kt parent-credit + reversal paths re-indented). `app/lint-baseline.xml` committed pinning the 117 pre-existing WARNING findings (GradleDependency 90, UnusedResources 8, …) with abortOnError=true — any NEW finding fails the gate; the backlog shrinks by editing the baseline, never widening it. lintDebug GREEN (was 339 errors / 115 warnings abort); full suite 38/331/0 (desugaring re-verified runtime); assembleDebug green (APK 30.7 MB, +0.9 MB desugar runtime). Android commit 01d679f. ARCH-012 (release-variant screenshot test) remains separate/open.

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

#### T-024 — Fix Android homework id and promotion propagation — **Completed (TESTED, 18th session)**
- **Problems:** HOMEWORK-101, STUDENT-100 · **Priority:** P1 · **Severity:** Critical
- **Description:** Android homework entities use real UUIDs (drop the `hwk-` prefix before upsert); promotion sync propagates `grade_level_code` (extend the RPC or use the direct update path).
- **Dependencies:** T-025 for the promotion server path · **Affected:** A · **Platforms:** Android, Backend
- **Tests:** homework push persists; promoted student's server-side grade advances and survives a pull sync.
- **Verification:** integration tests.
- **ADRs:** —
- **Result (2026-09-01, 18th session):** homework entities now created with a bare UUID; dispatcher strips the legacy `hwk-` prefix defensively (queued legacy rows reach the server on the same server id — idempotent). `pushStudent` sends `p_grade_level_code` (the RPC has had the param since 0037 — audit text corrected; verified live via pg_get_functiondef). HomeworkPromotionT024Test 6/6; full Android suite 35 files / 304 / 0 failures; live `scripts/verify_t-024.sql` 5/5 (H1 bare-UUID insert ok, H2 `hwk-` still rejected, S1–S3 grade propagation + pull roundtrip — rolled back, no data mutated). Android commit 7bd43e1.

#### T-025 — Replace fn_current_tenant_id with the canonical resolver
- **Problems:** DEAD-100 (absorbs TENANT-105), TENANT-106 · **Priority:** P1 · **Severity:** Critical
- **Description:** New migration: rewrite the 0029-era policies and `set_assessments_tenant` trigger to use `current_tenant_id()`; drop `fn_current_tenant_id()`; `student_academic_histories` becomes accessible to tenant staff.
- **Dependencies:** none · **Affected:** D (migrations) · **Platforms:** Backend
- **Tests:** staff can select/upsert `student_academic_histories` for their tenant; cross-tenant denied; orphan assessment inserts FAIL (no DEMO fallback).
- **Verification:** migration-level tests on a fresh schema.
- **ADRs:** —

#### T-026 — ~~Align the overdue rule on Android~~ *(moved to Completed — 13th session)*
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

#### T-039 — Android pull-sync completeness — **Completed (TESTED, 18th session)**
- **Problems:** HOMEWORK-103, NOTIF-105 · **Priority:** P2 · **Severity:** High
- **Description:** `pullAll` also pulls homework/attendance/assessments; notification pull filters by current user/role and evicts stale rows; batch upsert instead of per-row loop.
- **Dependencies:** T-023/T-024 (server must actually hold academic rows) · **Affected:** A · **Platforms:** Android
- **Tests:** desktop-created homework/attendance appears on Android within one sync cycle; role-changed user sees no stale broadcasts.
- **Verification:** cross-device integration test.
- **ADRs:** —
- **Result (2026-09-01, 18th session):** pullAll pulls homework (0029) + attendance_records/assessments (0041) with canonical mappers; every pull path batch-upserts; pulled homework rows delete their legacy `hwk-` local twins (T-024 interplay). pullNotifications mirrors the 0019 `notifications_select` RLS branch-for-branch: roles re-resolved FRESH via `current_user_roles()` (multi-role users keep every held role's broadcasts — the Session models only one role), staff trio sees NULL/NULL tenant broadcasts; `evictNotVisibleTo` applies the same predicate to the Room cache (Room v13: notifications.targetRole). PullCompletenessT039Test 16/16 (mappers, eviction matrix on real SQLite, RLS-mirror scans); Android suite 38/331/0. Cross-device live round-trip (the registry's verification bar) still needs two live devices. Android commit dd2988d.

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

#### T-043 — Consolidate the equivalence test frameworks — **Completed (TESTED 2026-09-03, 23rd session — see T-143; ADR-006 Implemented)**
- **Problems:** DUP-001 (absorbs DEAD-004, CROSS-002, CROSS-008), DUP-002 · **Priority:** P2 · **Severity:** High
- **Description:** Per ADR-006: single framework (`financial-tests/equivalence/`), port unique scenarios, delete the other three trees and the stale `_tier4` mirror, document Android corpus access.
- **Dependencies:** none · **Affected:** D, A · **Platforms:** Desktop, Android
- **Tests:** consolidated suite green; unique-scenario coverage report shows nothing lost.
- **Verification:** `npm test` + `./gradlew test` (Android runner) green.
- **ADRs:** ADR-006
- **Execution record:** 4 scoped passes — see the T-143 entry (2026-09-03). Desktop 79/2271 after each pass; the unique-scenario coverage report is in the T-143 entry + change-log.

#### T-044 — Consolidate the Android design system — **IN PROGRESS (passes 1–2 COMPLETE 2026-09-03, 23rd session — see T-144; 29 of 37 screens remain)**
- **Problems:** DUP-003, DUP-004 (absorbs WEAK-013) · **Priority:** P3 · **Severity:** High (maintenance)
- **Description:** Migrate the 37 legacy-importing screens to `ui.designsystem.*`; delete the legacy components/theme; migrate the screenshot test to the production theme.
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** screenshot test against the production theme; zero `import com.example.ui.components` remaining.
- **Verification:** grep + tests green.
- **ADRs:** —
- **Execution record:** pass 1 removed the legacy theme family (DUP-004 CLOSED + WEAK-013); pass 2 migrated the settings module (8 files). Next passes: extend the design system with a SCROLLABLE tab-row component (the 6-tab FinancialsHub prerequisite), then migrate feature-by-feature using the settings module as the reference pattern; the bottom-nav route-model rewrite is the last step. Final pass deletes the legacy `ui/components/` tree.

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

#### T-047 — Scope and complete the desktop Supabase repository migration — **In Progress (scoping delivered — owner decision reduced to 3 tabs + 1 ADR)**
- **Problems:** ARCH-001 · **Priority:** P2 · **Severity:** Critical
- **Description:** Inventory the 26 mock-backed repository slots; classify each as (a) port to Supabase (used in production flows), (b) label as demo-only in the UI, or (c) remove. Port the (a) set module by module (chat handled by T-037).
- **2026-09-04 (25th session) — agent-side scoping DELIVERED:** see `docs/architecture/t-047-repository-migration-scoping.md`. Fresh code-verified inventory: 23 slots remain mock-backed (not 26 — T-080/T-093/T-099 closed three). KEY: the canonical chain already has tables for 19 of the 23 → those need only adapter work, no schema; port order recommended: calendar (website reads `calendar_events` while desktop writes mock) → workflows/workflowRuns (Android pull-syncs `workflow_runs`) → tasks/workforceAttendance/leaveRequests → pricing → rest. Product decision now scoped to exactly: clubs/psychology/orthophonie (no table — port/demote/remove?) + teachers (modeling ADR: personnel-role view vs table).
- **Dependencies:** owner input ONLY for the 3 therapy/club tabs + teachers ADR; the 19 adapter ports can start without it · **Affected:** D · **Platforms:** Desktop
- **Tests:** per ported module: persistence across restart + equivalence where financial.
- **Verification:** per module; statuses tracked here.
- **ADRs:** — (teachers port will need one)

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

#### T-054 — ~~Android hollow implementations~~ *(moved to Completed — 13th session)*
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

#### T-062 — ~~Android dead-code removal~~ *(moved to Completed — 13th session)*
- **Problems:** DEAD-007, DEAD-008, DEAD-009, DRIFT-007 · **Priority:** P3 · **Severity:** Low
- **Description:** Remove `StubRepositories.kt`; either register `ElGalleryActivity` in the manifest (dev-only) or delete the gallery; correct the misleading `SupabaseModule` KDoc; trim unused `AuditActions` constants (keep wire-protocol comment pointing to the desktop registry).
- **Dependencies:** reachability check per recovery rules · **Affected:** A · **Platforms:** Android
- **Tests:** build + tests green; APK size note.
- **Verification:** grep clean.
- **ADRs:** —

#### T-063 — ~~Android absence-alert threshold~~ *(moved to Completed — 13th session)*
- **Problems:** ATT-103 · **Priority:** P3 · **Severity:** Low
- **Description:** `alertAbsences` adopts the desktop rule (≥3 absences, current term).
- **Dependencies:** none · **Affected:** A · **Platforms:** Android
- **Tests:** threshold behaviour matches desktop for same input.
- **Verification:** unit test.
- **ADRs:** —

#### T-064 — ~~Android config dialog security~~ *(moved to Completed — 13th session)*
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

## 25th session (2026-09-04, concurrent multi-agent batch — branch `session25-agent-work`, ALL REPOS)

> Session context: ran as one of ~10 agents working the same repos concurrently. No Supabase credentials were provided this session → the opening ritual's LIVE chain check was NOT possible; the chain check was performed LOCALLY (append-only guard + numbering + registration-in-file checks) and the live check remains owner-token-gated. No push credentials either → commits live on branch `session25-agent-work` in each repo; the established zip-for-push handoff applies. Coordination claim: this session took T-044's ADDITIVE pass 3a prerequisite ONLY (the DS scrollable tab-row component) and explicitly leaves the hub-screen migration passes + the MainScreen route-model rewrite + the legacy-tree deletion to other concurrent agents (they are the contested recommendations; two agents editing the same hub screens simultaneously would collide).

### T-155 — Session-opening verification, credential-less adaptation — **Completed (TESTED)**
- **Problems:** — (process; the opening ritual under no-credentials conditions) · **Priority:** P0
- **Status:** TESTED (2026-09-04)
- **What was done:** desktop `npm ci` + `npm run typecheck` (clean) + `npm run lint` (0 errors / 384 warnings at open) + full suite (82 files / 2286 passed + 5 skipped); website `npm ci` + `npm run lint` (clean) + suite (26 files / 457 passed) + strict build (green, "Compiled successfully"); LOCAL migration-chain integrity: 65 files = 0001–0068 contiguous, no duplicate numbers, `scripts/check-migrations-append-only.sh` OK (+0 vs origin/main), registration statements present inside 0066/0067/0068 files per the MIG-TOKENS atomic-apply convention.
- **NOT done (honestly):** the LIVE `schema_migrations` diff (needs the owner's sbp_ token — not provided this session). The 24th session closed at 65/65 zero drift; any live drift since then is invisible here. Next session WITH a token must re-run the live chain check FIRST (ARCH-014 lesson).
- **Baseline note:** desktop suite grew 2284 → 2286 (T-157's +2 guards); website 25 → 26 files (t-149 follow-up file present at HEAD; verified green).

### T-156 — Registry truth-sync (stale rows from sessions 17–24) — **Completed (TESTED)**
- **Problems:** — (process hygiene; the T-117/T-125 discipline) · **Priority:** P1
- **Status:** TESTED (2026-09-04)
- **What was fixed (each flip cites its evidence):**
  1. **T-104 sat in "Ready" although ADR-010 shipped it in the 17th session** (three session closeouts kept the listing). Entry corrected; LESSON recorded: a completing session must REMOVE the entry from the section header, not just note it inside.
  2. **"Not started (Android, toolchain-gated): T-020, T-082" row** — both completed (T-020 TESTED 17th; T-082 TESTED 18th); row flipped to a tombstone.
  3. **"only DATA-005 (first_name split) remains of T-085"** — stale: DATA-005's backfill was EXECUTED as migration 0066 (T-139, 22nd session, live-verified 6/6).
  4. **CROSS-004 problem header OPEN** → TESTED (its own T-146 status note already recorded the closure; header was left stale).
  5. **REG-002 problem header OPEN** → TESTED (mirrors REG-001's "process guard landed" treatment: T-046 removed the destructive fallback + Robolectric-pinned; T-046-gap landed exportSchema + committed history + MigrationTestHelper upgrade test).
  6. **DATA-009** — added the T-157 status note (debt-meter wiring complete; every desktop credit display now on the ADR-010 derivation).
- **Verified:** every flip cross-checked against the detailed entry's own status note + commits (T-117/T-125 discipline); no entry flipped without a cited closure record.

### T-157 — Wire the debt-meter's dormant Crédit parent row (ADR-010 residual) — **Completed (TESTED)**
- **Problems:** DATA-009 display surface · **Priority:** P2
- **Status:** TESTED (2026-09-04) — hub commit a02edd7.
- **What was done:** `unified-payment-modal.tsx` observes `repos.debt.observeParentProfile` and passes `displayParentCredit(totalOutstanding, totalUnallocatedCredit)` to the DebtMeter (the raw balance double-counts canonical overpayments; the raw unallocated Σ is wrong for 0062-era overpayers); `debt-meter.tsx` prop doc corrected to the ADR-010 magnitude contract (the old doc self-contradicted: "always <= 0" vs "positive = magnitude"); `t-104-display-credit.test.ts` +2 source-scan guards pinning the wiring and the contract (10/10).
- **Verified:** typecheck clean; t-104 suite 10/10; navigation-context 7/7; full desktop suite 82 files / 2286 passed + 5 skipped; lint 0 errors.
- **Preserved:** DebtMeter rendering logic; the dossier card wiring; the canonical writer; all equivalence-pinned shapes.

### T-158 — Desktop lint exhaustive-deps review + baseline re-documentation — **Completed (TESTED)**
- **Problems:** DEAD-201 follow-up class (the 4 findings T-078 flagged for individual review) · **Priority:** P3
- **Status:** TESTED (2026-09-04) — hub commit 9e1c974.
- **What was done:** (1) `auth-provider.tsx` — the 4 provider actions wrapped in useCallback with explicit deps; the context-value useMemo lists them (behavior-preserving: repos is a module-stable context value; the previous hand-written `[session, isLoading]` array silently captured stale repos if the provider value ever changed identity); (2) `sync-provider.tsx` — stale unused eslint-disable directive removed (empty deps genuinely correct — session read via ref; reasoning now a comment, not a suppression); (3) `worker-dashboard.tsx` — `clockTick` kept as the INTENTIONAL post-punch recompute trigger, made lint-visible via `void clockTick` + comment; dead `REQUEST_TONE` removed; (4) `page-tabs.tsx` — complex dependency expression extracted to `dataValue`; dead `s`/`ctxSize` removed (`size` stays destructured so it never leaks into the DOM).
- **DISCOVERY (new):** the desktop lint warning baseline drifted 307 (T-078, 2026-08-29) → 384 (this session open) with no per-session lint-delta discipline — ~77 warnings accumulated silently across 20 sessions of new code. The config's documented baseline is now re-pinned (379 after T-158) and the exhaustive-deps class is at ZERO: any new finding is a regression to fix, not to baseline. RECOMMENDATION: record the lint warning count in every session closeout (as the suites are recorded) so drift is caught within one session.
- **Verified:** typecheck clean; lint 0 errors / 379 warnings (exhaustive-deps 4 → 0); change-password suite 12/12; full desktop suite green.

### T-159 — Android toolchain re-provisioning + android-env.sh recipe re-creation — **Completed (TESTED)**
- AGENTS.md §11 points at `/home/z/my-project/scripts/android-env.sh`; the container reset wiped JDK 21 + SDK 35 + the recipe. This session re-provisioned both: JDK 21 (javac 21.0.12.1) + SDK 35, recipe re-created at `/home/z/my-project/scripts/android-env.sh` (now also auto-creates the ROOT `.env` — see §8.1 in AGENTS.md for the secrets-plugin rootProject resolution quirk that motivates it). Verification evidence: full Android unit suite 44 files / 372 tests ALL PASS + lintDebug GREEN (== 24th-session baseline) before any new work. Android commit 1d1e07d.

### T-044 — Android design-system consolidation — pass 3a (additive prerequisite) — **Completed (TESTED)**
- **Claimed scope (25th session):** ONLY the additive prerequisite — extend the design system with the scrollable tab-row component (+ tests), which the 23rd/24th sessions documented as the blocker for the 6-tab FinancialsHub. **NOT claimed (left for other agents / next session):** the hub-screen migration passes, the MainScreen bottom-nav route-model rewrite, the final legacy-tree deletion. Reason: ~10 concurrent agents were pointed at the same recommendations; the component addition is collision-safe (new file), screen migrations are not.
- **Status:** TESTED (2026-09-04) — Android commit 49b83aa on `session25-agent-work`.
- **What was done:** `ElScrollableTabRow` added to `ui/designsystem/components/tabs/ElTabs.kt` (+100 lines, purely additive — no legacy file touched, no call site migrated): LazyRow of `ElPillShape` pills on a `surfaceVariant` track, behaviour-parity with the legacy `ui.components.ModernSecondaryTabRow` (programmatic-selection auto-scroll via `LaunchedEffect` + `animateScrollToItem`, out-of-range guard, single-line labels) using only DS tokens. Items carry `Role.Tab` + semantics `Selected`; the row exposes stable `testTag("el_scrollable_tab_row")` for UI tests.
- **Two live-discovered pitfalls (recorded for future DS work):** (1) inside `semantics { … }`, a parameter named `selected` collides with the receiver's extension var — `selected = selected` compiles as a val reassignment; fixed by naming the item parameter `isSelected`; (2) LazyRow composes ONLY visible pills — off-screen labels do not exist in the semantics tree, so every per-label ui-test assertion must `performScrollToNode` via the row's test tag first; also `setContent` is once-per-test (state flips via `mutableStateOf`, not re-setContent).
- **Verified:** new `ElScrollableTabRowTest` (5 semantic tests, Robolectric sdk34 w411dp — no screenshots per ARCH-012): 5/5 PASS; full suite 45 files / 377 tests / 0 failures (baseline 44/372); lintDebug GREEN.

## 26th session (2026-09-05 — the "financial transparency" patch hardening, ALL REPOS)

> Session context: the owner accepted an AI-generated patch (unregistered, junk-named commits "jjj"/"o"/"k"/"mid"/"it jsut happen" + one essay-message commit, HEAD 8644719) that visualized the parent financial breakdown inside `parent-detail-drawer.tsx` and asked for a full safety review + native re-integration across desktop/website/Android/backend. Session verdict: the UX direction was right, the implementation violated the architecture (financial logic in a presentation component — DATA-008/DUP class), masked two REAL repository-layer root causes (DATA-013), and shipped 8 broken tests (2 files) plus a silently weakened CSP. Live-DB evidence (read-only audit with the owner's sbp_ token): the `installments` table holds 1 276 rows covering 259/259 charged parents — the "missing tranches" diagnosis in the patch's own essay was FALSE; the tranches existed all along and the Supabase debt-profile contract simply never shipped them.

### T-164 — Desktop: canonical parent billing breakdown (domain extraction + drawer refactor + root-cause repository fix) — **Completed (TESTED)**

- **Problems:** DATA-013 (new), DATA-008 class, DUP (inline waterfall), DESK-CSP-202 regression, notification-contract regression, T-145 audit branch loss · **Priority:** P0
- **Status:** TESTED (2026-09-05)
- **What was done:**
  1. **Root cause fixed (DATA-013):** `SupabaseDebtRepository.refreshProfile` — (a) the ledger query selected only 6 columns, so `mapLedgerRow` produced entries with `description: ""`, `actorId: "system"`, `studentId: undefined` (the source of the owner-visible "blank adjustment reasons" + "Auteur: system" + lost per-child attribution — the DB rows carry all of it); (b) the profile hardcoded `installments: []` (the source of "Aucune tranche"). Now: `select("*")` (mirrors the ledger repo seed) + a real `installments` query mapped with `mapInstallmentRow` (contract parity with the mock repo, which always populated them).
  2. **Domain extraction:** new canonical module `src/domain/calc/payment/billing-breakdown.ts` (exported via the payment barrel): `computeParentBillingBreakdown` (itemized per-child charges, per-service consolidation, REAL tranche coverage rendered verbatim from the server waterfall, INV-4 remaining via `installmentRemaining`, display-only 40/30/30 synthesis via `splitNetTuitionByOfficialSchedule` + `getOfficialTuitionDueDates` + one global `allocatePaymentToInstallments` run over synthetic tranches — chronologically ordered, residual-cleared-pool so real-row money is never double-counted), `resolveBillingAcademicYear`, `describeAdjustment` (credit/debit badge + shared diagnostic fallback for blank reasons).
  3. **Drawer refactor (`parent-detail-drawer.tsx` FinancesTab):** consumes the canonical module via `useMemo`; now observes `repos.installments.observeByParent` (the same stream the UnifiedPaymentModal reads — cashier slider and drawer can no longer disagree); the synthetic-schedule state renders an explicit warning banner; tranche cards show due dates + pending funds + coverage progress; `Par Enfant` / `Par Service` toggle, itemized list, reconciliation footer and adjustment diagnostics preserved from the patch's UX but now fed by canonical numbers.
  4. **Patch regressions repaired:** `index.html` CSP restored `frame-ancestors 'none'` (DESK-CSP-202 — the patch deleted it; csp-policy test was failing); `supabase-notification-repository.ts` restored to the 99bd956 implementation (the patch's rewrite broke 7 contract tests with an unregistered "local cache fallback"); the T-145 `issueActivationCode` failure path re-added its audit log entry (`parent.activation_code_issuance_failed`) that the patch dropped.
- **Verified:** `npm run typecheck` clean; `npm run lint` 0 errors / 378 warnings (baseline 379 — net −1); FULL suite 83 files / 2302 passed + 5 skipped, 0 failures (was 8 failures at session open, all introduced by the unregistered patch — both files re-verified green on the pre-patch baseline worktree to attribute them correctly); new `src/tests/domain/payment/billing-breakdown.test.ts` 16/16 including the owner-reported headline vector (285 000 → T1 114 000 fully covered, T2 85 500 with 11 000 → 74 500 remaining, T3 85 500 untouched, Σ remaining 160 000).
- **Preserved:** `displayParentCredit` balance cards (ADR-010/T-157 wiring), the UnifiedPaymentModal/DebtMeter contract, the AdjustAccountModal, all T-100/T-104/T-014 comment contracts.

### T-165 — Backend: migration 0069 — adjustment description guard — **Completed (TESTED)**

- **Problems:** DATA-014 (new — silent system adjustments prevention) · **Priority:** P1
- **Status:** TESTED (2026-09-05) — APPLIED LIVE + verified.
- **What was done:** migration `0069_adjustment_description_guard.sql` (chain 66 files, append-only guard OK): CHECK constraint `ledger_entries_adjustment_description_guard` requiring every `adjustment`/`reversal` ledger entry to carry `description IS NOT NULL AND length(btrim(description)) >= 3`. Added NOT VALID (brief ACCESS EXCLUSIVE, no full scan) then VALIDATE (SHARE UPDATE EXCLUSIVE — concurrent writes continue). NO backfill was needed — the patch's "database lacks tranches" diagnosis was disproven by live read-only audit (1 276 installment rows, 259/259 charged parents covered, 0 blank descriptions across 690 adjustment rows; ledger↔installments reconcile — top divergences are only negative-balance overpayers where remaining is correctly 0).
- **Verified:** live pre-checks (0 violations), BEGIN…ROLLBACK probe suite — blank insert REJECTED (23514, the exact guard error), documented insert accepted (probe2_inserted=1 then rolled back); applied live: `convalidated = true`, post-check 0 violating rows. Evidence scripts: `scripts/verify_t165_curl.sh`.
- **Writer contract:** `upsert_ledger_entry_from_import` / adjust() / refund compensation paths must keep sending real sentences ("Annulation de remise lors du ré-import Excel du …"); the DB now rejects silence.

### T-166 — Website: Facturation tab (itemized billing parity) — **Completed (TESTED)**

- **Problems:** CROSS platform parity gap · **Priority:** P1
- **Status:** TESTED (2026-09-05) — website repo commit (this session).
- **What was done:** new canonical read-side derivation `src/lib/canonical/billing-breakdown.ts` (`parentBillingBreakdown` — per-child itemized charges + per-service totals + REAL tranche coverage from physical rows only, INV-4 via `installmentRemainingAmount`; `describeAdjustment`; `resolveBillingAcademicYear`; `SERVICE_LABELS_FR` canonical wording). FinancialView gains a 5th tab "Facturation" (billing toggle Par enfant / Par service, academic year header, per-child charge items + tranche coverage cards, reconciliation footer); the Adjustments tab now uses `describeAdjustment` (blank legacy reasons render the shared diagnostic, styled italic). i18n keys added in FR/AR/EN. NO pricing/waterfall engine ported (T-057/ADR-002: the portal renders what the server produced — it never synthesizes).
- **Verified:** `npx vitest run` 27 files / 468 tests passed (was 26/457; +11 new parity vectors incl. the 285 000/100 000 headline case + "portal never synthesizes" pin); tsc clean on changed files; eslint clean on changed files; T-057 port-honesty registry updated to declare the 2 new canonical files (the guard test itself enforces declaration).

### T-167 — Android: billing breakdown mirror + ParentDetailScreen card — **Completed (TESTED)**

- **Problems:** CROSS platform parity gap · **Priority:** P1
- **Status:** TESTED (2026-09-05) — Android repo commit (this session).
- **What was done:** new canonical mirror `core/BillingBreakdown.kt` (mirror of the desktop module — same invariants, centimes: real rows authoritative, INV-4 remaining, 40/30/30 display synthesis via the existing `splitNetTuitionByOfficialSchedule` + `officialTuitionDueDates` + `allocatePaymentToInstallments`, residual-pool double-count guard, `describeAdjustment`, `SERVICE_LABELS_FR`). `ParentDetailViewModel` observes the ledger stream and derives `billingBreakdown` (recomputed on every stream emission; `BillingInstallmentRow` projection keeps `core/` free of domain imports). `ParentDetailScreen` renders a "Prestations facturées" card (per child: itemized charges + tranche coverage with Payée/Partielle/En attente/Due statuses + pending display + synthetic warning banner).
- **Verified:** `:app:compileDebugKotlin` BUILD SUCCESSFUL; new `BillingBreakdownTest` 11/11 (same vectors as desktop/website); FULL unit suite 46 classes / 388 tests / 0 failures (baseline 45/377 at the 25th session — suite grew with the new test class). Baseline re-provisioned per T-159 recipe (JDK 21.0.12.1 + SDK 35 + root `.env`).

### T-168 — Desktop: itemized shopping list completion + adjustment provenance classification + reconciliation equation — **Completed (TESTED)**

- **Problems:** DATA-015 (new — single-child family-level charges dropped from the itemization), owner transparency ask ("is this actual content, a trap, a mistake, or something revealing?") · **Priority:** P0
- **Status:** TESTED (2026-09-05, 27th session)
- **What was done:**
  1. **Engine (`domain/calc/payment/billing-breakdown.ts`):** `classifyAdjustmentHistory` — provenance classification of every adjustment with the SAME pairing algorithm on every platform (chronological FIFO per |amount|, opposite-sign matching only, zero amounts skip): `documented` (actual operator content) / `reversal_pair` (net-zero +X/−X counter-pass — the re-import flip-flop pattern) / `undocumented` (legacy blank row to audit), each with a full FR meaning sentence. `BillingReconciliation` — the adjustment-aware account equation (grossBilled − credits + debits = netDue; netDue − cleared − pending = derivedRemaining; explicit `bridge` reconciling to the server balance so no displayed number is unexplained). `ServiceTotalNode` gains `sharePct` + `childAttribution` (per-child amounts inside each service); `unattributedItems`/`unattributedTotal` surface multi-child family-level charges explicitly.
  2. **DATA-015 fix:** a single-child family's family-level (null `student_id`) charges now join the child's shopping list (childBilledTotal === totalBilled) instead of silently disappearing; `sumPendingPayments` added to `sums.ts` (status-strict, mirrors `sumPaidPayments`).
  3. **UI (`parent-detail-drawer.tsx` FinancesTab):** drawer widened `max-w-2xl` → `max-w-4xl`; 4 balance cards (Brut facturé / Net à payer / Payé / Reste-Crédit, with sub-labels); per-child shopping list with service icons (lucide per category) + per-child subtotal; "Famille — éléments non rattachés" block in BOTH views; Par Service view with share bars + per-child attribution lines; full reconciliation footer (ledger-style equation + bridge warning + server balance check icon); adjustments history consumes `classifyAdjustmentHistory` — provenance chips (Documenté / Contrepassation / Non documenté) with tooltips, meaning sentences, cross-pair links ("Contrepassée par l'écriture … du …"), and an upgraded legend explaining content vs trap vs mistake.
- **Verified:** `npm run typecheck` clean; `npm run lint` 0 errors / 378 warnings (baseline 378); FULL suite 83 files / 2314 passed + 5 skipped / 0 failures (was 2302 — +12 T-168 tests: the 700 000 DZD 2-child shopping list with 40 000 family-level row, share % (81/13/6, Σ=100), attribution parity, single-child fold, full reconciliation equation with bridge and overpayer credit, provenance classification incl. the owner's exact +71k/−71k +50k/−50k shuffled flip-flop, same-sign never pairs, zero-amount skip, order preservation).

### T-169 — Website: Facturation parity — provenance pills + reconciliation + i18n — **Completed (TESTED)**

- **Problems:** cross-platform parity gap (T-168 features) · **Priority:** P1
- **Status:** TESTED (2026-09-05, 27th session) — website repo commit.
- **What was done:** `src/lib/canonical/billing-breakdown.ts` gains `classifyAdjustmentRows` (identical algorithm + FR wording to the desktop), `BillingReconciliationInput` (adjustmentRows / clearedPaid / pendingPaid / serverOutstanding), `sharePct` + `childAttribution` on services, `unattributedItems`, and the DATA-015 single-child fold fix. `financial-view.tsx`: the billing memo feeds the reconciliation from `portalFinancialSummary` (cleared = paid − pending; server balance = outstanding); BillingTab renders service share bars + child attribution + family blocks + the full equation footer (i18n keys `finance.billing.recon.*` in FR/AR/EN); AdjustmentsTab renders provenance pills + meaning lines + pair links. NO synthesis added (ADR-002 preserved).
- **Verified:** `npx vitest run` 27 files / 476 passed / 0 failures (was 468 — +8 T-168 parity vectors: 700k shopping list, share %, single-child fold, reconciliation with bridge, flip-flop pairs, documented vs undocumented, same-sign no-pair); tsc on changed files clean (total project tsc error count identical to the pre-change stash — pre-existing test-file errors only); eslint clean on changed files.

### T-170 — Android: provenance + reconciliation mirror + Prestations card upgrade — **Completed (TESTED)**

- **Problems:** cross-platform parity gap (T-168 features) · **Priority:** P1
- **Status:** TESTED (2026-09-05, 27th session) — Android repo commit.
- **What was done:** `core/BillingBreakdown.kt` gains `classifyAdjustmentHistory` + `BillingAdjustment`/`ClassifiedAdjustment`/`AdjustmentProvenance` (same algorithm, same FR wording), `BillingReconciliation` (new `parentBillingBreakdown` params: adjustments / pendingPaidTotal / serverOutstanding), `ServiceChildAttribution` + `sharePct` (rounded via `Math.round` to match the TS engines — integer division would truncate 12.857→12 vs 13), `unattributedItems`, and the DATA-015 single-child fold. `ParentDetailViewModel` maps ledger adjustment rows (reversals excluded) and exposes `classifiedAdjustments`; `ParentDetailScreen` Prestations card adds the family block, "Par service" recap (share % + attribution) and the reconciliation footer (`ReconLine` composable); a new "Ajustements" card shows provenance tags + reason + meaning.
- **Verified:** `:app:testDebugUnitTest` 46+ classes / **396 tests / 0 failures** (was 388 — +8 T-168 vectors incl. the 700k list, share parity 81/13/6, bridge, flip-flop pairs, same-sign no-pair); `:app:compileDebugKotlin` BUILD SUCCESSFUL (JDK 21.0.12.1 + SDK 35).

## 27th session (2026-09-05 — owner-reported sync + notification flood, ALL REPOS)

> Session context: the owner reported with a screenshot — "I don't think the syncing is working. Also, the notifications here are weird. Why are there 1,000 notifications? Is all of this happening because I synced three Excel spreadsheets?" Live-DB forensics + code analysis identified two compounding root causes: SYNC-200 (1 170 terminal-failed mock-era queue entries stuck forever with no recovery path — the visible red badge; 1 170 = 390 students × 3 imports, data confirmed safe server-side) and NOTIF-200 (overdue-alert flood, 958 unread never resolved). Fixed as T-171 (desktop sync-queue recovery) + T-172 (alert lifecycle, EF≡desktop + Android pull parity); the notification VOLUME design decision is deferred to T-173 with UNKNOWN-020.

### T-171 — Desktop: sync-queue recovery (retry/discard + legacy tenant re-scope + persisted lastSyncAt + honest status) — **Completed (TESTED)**

- **Problems:** SYNC-200 (new — registered this session with live forensics) · **Priority:** P0 (owner-reported blocker)
- **Status:** TESTED (2026-09-05, 27th session)
- **What was done:**
  1. `SyncService.retryFailed()` — re-queues every terminal-failed entry (status→pending, attempts→0, lastAttemptAt→null: full fresh backoff budget; lastError kept as history) + schedules an immediate debounced drain.
  2. `SyncService.discardFailed()` — removes terminal-failed residue via the new `SyncQueueStore.deleteMany` (single IndexedDB transaction; the synced entries' local audit history survives — unlike `clear()`).
  3. Drain-time legacy tenant RE-SCOPE: entries carrying a non-UUID placeholder tenant ("default" — baked in by mock-mode `enqueue()` before Supabase was wired) are re-scoped to the current session's real tenant before the push (safe: this user imported this data on this machine). Foreign-UUID tenants are now SKIPPED locally (never pushed — server RLS would reject them anyway; no more futile attempt-burn) and foreign-ACTOR entries stay skipped (SYNC-102 semantics preserved).
  4. `lastSyncAt` persisted to localStorage (`el-imtiyaz.sync.lastSyncAt`), restored at construction (corrupt values degrade to null), and set after EVERY completed online drain — a healthy no-op drain counts; offline drains never touch it. Kills "Dernière synchro: Jamais" despite 3 544 synced rows.
  5. UI: SyncTab gains "Réessayer les échecs (N)" + "Supprimer les échecs" (destructive, confirmed) + a guidance banner + per-row lastError tooltips; the "Synchroniser maintenant" toast now tells the truth when failed entries exist (pre-T-171: "Aucune entrée à synchroniser" — a lie by omission); the SyncIndicator tooltip gains a retry action for the failure badge.
  6. SyncActions contract extended with retryFailed/discardFailed (provider wired; source-scanned).
- **Verified:** NEW suite `src/tests/infrastructure/t-171-sync-recovery.test.ts` **17/17** (fresh retry budget incl. the fail→retry→fail→fix→succeed cycle; residue-only discard; placeholder re-scope with durable store patch; foreign-tenant skip; foreign-actor skip preserved; persisted lastSyncAt across restart + no-op drain + corrupted degradation; provider/tab/indicator source-scans; deleteMany single-transaction semantics); t-022 source-scan updated for the `entryToPush` rename (semantics unchanged, behaviorally re-pinned); FULL suite **83 files / 2 336 / 0 failures**; typecheck clean; lint 0 errors (warnings 381 vs baseline 378 — +3 empty-stub-function warnings, same class/pattern as the pre-existing sync-batch test).
- **Left:** the OWNER must click "Supprimer les échecs" once on their desktop to purge the 1 170 mock-era entries (their payloads carry local-store parent IDs that fail server FK validation — retry alone cannot succeed; the data is confirmed already server-side). No code left.

### T-172 — Overdue-alert lifecycle: active-only dedup + stale resolution (EF ≡ desktop) + Android pull parity — **Completed (TESTED, live-verified)**

- **Problems:** NOTIF-200 (new — registered this session with live evidence: 958 unread, 0 dismissed) · **Priority:** P1 (owner-reported "weird notifications")
- **Status:** TESTED (2026-09-05, 27th session; live run recorded in docs/recovery/t-172-live-verification.md)
- **What was done:**
  1. `run-overdue-scan` EF: the dedup fetch counts ACTIVE alerts only (`.is("dismissed_at", null)`) — a resolved alert no longer blocks re-alerting after a revert; NEW step 4b resolves (dismissed_at = now, chunked) active installment alerts whose installment left the tracked set (paid/cancelled/no remaining balance); summary + audit entry gained `alerts_resolved`. Service-role context = the authoritative resolver.
  2. Desktop `SupabaseOverdueAlertGenerator`: identical semantics (active-only dedup + `resolveStaleAlerts`, best-effort — NOTIF-100 RLS blocks financial_officer sessions on the UPDATE; super_admin passes; failures log a warning, never throw). EF≡desktop equivalence preserved.
  3. Android `PullSyncRepository.pullNotifications`: gained the top-level `dismissed_at IS NULL` filter (AND-of-OR structure) — read-path parity with the desktop's `SupabaseNotificationRepository.refresh()`; resolved rows stop entering Room.
  4. Deployed the EF live and invoked it (cron-style, sb_secret key): **alerts_resolved=267**, active alerts 958→691, and a SQL cross-check proves every remaining active alert maps to a genuinely-overdue installment (`active_without_live_overdue=0`).
- **Verified:** EF auth curl matrix 401/401/401/200 (no-auth/invalid/anon/sb_secret); desktop `supabase-overdue-alert-generator.test.ts` **13/13** (+5 lifecycle tests, FakeQuery extended with `.is()`/`.update()`/`.limit()`); Android `PullCompletenessT039Test` **17/17** (+1 source-scan with the AND-of-OR structural assertion); full suites: desktop 2 336/0, Android 46 files / 397/0, website 476/0 (untouched — parents never see financial_officer-targeted alerts; baseline re-run green for the zip handoff).
- **Left:** T-173 (volume/digest decision + the Android Room `dismissedAt` gap — local copies of a server-resolved alert linger until role eviction; needs a Room migration). NOTIF-100/NOTIF-104 remain the pre-existing blockers.

### T-173 — Overdue-alert volume policy (digest vs per-installment) + Android Room dismissedAt — **Not started**

- **Problems:** NOTIF-200 residual (volume half), Android Room dismissedAt gap · **Priority:** P2 · **Severity:** Medium
- **Description:** (a) With a 691-overdue corpus the feed holds 691 unread alerts — one per genuinely overdue installment (all truthful post-T-172). Whether the scan should instead emit ONE digest alert (+ top-N detail) is a PRODUCT decision needing an ADR (UNKNOWN-020) — implement on BOTH the EF and the desktop generator (equivalence) if accepted. (b) Android Room has no `dismissedAt` column — rows resolved server-side linger locally until role eviction; needs a Room migration (v14?) + pull-side eviction.
- **Dependencies:** UNKNOWN-020 (digest shape + N cap decision); NOTIF-100/NOTIF-104 context.
- **Verification:** EF≡desktop equivalence suite + a live re-run of the scan before/after; Android unit suite + migration test.

## 28th session (2026-09-05 — owner mandate: "finish the remaining tasks; apply the migration tokens; everything works across all platforms; migration applied + consistent everywhere; zip + push", ALL REPOS)

> Session context: fresh sbp_ access token supplied by the owner (MIG-TOKENS re-verification mandated). Opening ritual found the live chain at 65 rows (0001–0068) vs 66 committed files — migration 0069's DDL was live but its registration row was missing (ARCH-015, 4th ARCH-011-class event). Session batch: T-174 (token mandate + registration repair) + the T-047 desktop Supabase-repository ports (calendar → workflows/workflowRuns → leaveRequests/suppliers/tasks per the T-160 scoping's recommended execution order) + the T-173(b) Android Room dismissedAt migration + closeout/handoff.

### T-174 — MIG-TOKENS 28th-session re-verification + 0069 live registration repair (ARCH-015) — **Completed (VERIFIED)**

- **Problems:** ARCH-015 (new — registered this session) · **Priority:** P0 (owner token mandate)
- **Status:** VERIFIED (2026-09-05, 28th session)
- **What was done:**
  1. Fresh sbp_ token: Supabase CLI 2.116.0 re-provisioned, project re-linked; opening chain check discovered the 0069 applied-without-registration drift (ARCH-015).
  2. Registered the 0069 row live atomically (`scripts/apply_0069_registration_live.sh` — T-091/MIG-TOKENS pattern, env-token, ON CONFLICT DO NOTHING). The committed 0069 file NOT edited (append-only guard; fresh CLI deployments register automatically).
  3. EF fleet census via Management API: 13/13 ACTIVE (all local function dirs; `_shared/` is a module, not a function — earlier "14/14" counts included it).
  4. §7 credentials checklist re-run: 17/17 (auth health both key formats, RLS anon/publishable deny ×5 core tables, publishable key/URL/JWKS byte-identical to committed values, JWKS 200).
  5. Baselines: desktop full suite + website full suite re-run on the pristine clone (results in the change-log entry); Android toolchain re-provisioned per AGENTS.md §11.
- **Verified:** `scripts/verify_t-174.sql` live 5/5 (chain=66, 0069 row shape exact, constraint convalidated, unique index → idempotent, 690 adjustment rows untouched); chain check 66/66 = 0001–0069 ZERO DRIFT; §7 checklist 17/17.
- **Left:** nothing — the registration repair is complete. Owner-gated residuals unchanged (AUTH-200 first sign-in, RESEND_API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON, the T-171 "Supprimer les échecs" click).

### T-175 — Desktop: calendar port → calendar_events (T-047 port #1) — **Completed (TESTED, live-verified backend)**

- **Problems:** ARCH-001 (T-047's #1 port priority per the T-160 scoping) · **Priority:** P1
- **Status:** TESTED (2026-09-05, 28th session; backend live-verified via verify_t-175.sql 5/5)
- **What was done:**
  1. Migration **0070** (`0070_calendar_priority_assignment.sql`): added `priority` (text NOT NULL default 'medium', alert-priority CHECK) + `assigned_to_user_id` (uuid) + `assigned_to_role` (text) to `calendar_events` — the T-160 scoping's "no schema work needed" held at TABLE granularity but NOT at COLUMN granularity: the desktop domain contract (creator modal's Priorité select + assignment fields) had no columns. Applied live atomically (apply_0070_live.sh, T-091/MIG-TOKENS pattern): chain now 67/67 = 0001–0070.
  2. `SupabaseCalendarRepository` (`src/infrastructure/supabase/repositories/supabase-calendar-repository.ts`): month-bucketed reactive cache (SubjectBehavior per YYYY-MM, T-034/CROSS-104 freshness policy, per-bucket seed); observeForDate/observeForMonth merge manual `calendar_events` rows + DERIVED payments (paid/partial, joined `parents` display name) + audit_logs (auth noise skipped) + expense milestones (submit/approve/disburse) — pre-T-175 the mock derived these from in-memory SEED data even in Supabase mode (the ARCH-006 pattern); create/update/delete write manual rows (soft-delete = 0013 semantics; auto-generated kinds rejected = mock parity); date+time↔start_at/all_day mapping per the 0013 convention.
  3. Wired into `getSupabaseRepositories()` (the `calendar` slot overrides the mock spread).
  4. NEW suite `src/tests/infrastructure/supabase-calendar-repository.test.ts` — 12 tests: full create mapping (follow_up_call/meeting/reminder/custom), all-day convention, auto-kind rejection, update re-derivation, soft-delete + bucket eviction, four-source merge + sort order + derived shapes, status/date filtering, expense milestone month-splitting, persistence-across-restart, wiring source-scan, cross-platform kind parity (domain union == migration 0013 CHECK == website CalendarEventRow).
- **Verified:** suite 12/12; FULL suite **84 files / 2348 / 0 failures** (baseline 83/2336 + this suite); typecheck clean; lint 0 errors (392 warnings vs 381 baseline — +11 same-class `no-explicit-any` warnings in the new repo + its test fake, matching the existing T-093/T-080 test-fake pattern). Live: verify_t-175.sql **5/5** (chain 67 + 0070 registered; the 3 columns with correct types/defaults; priority CHECK == alert-priority union; RLS enabled; existing rows backfill-safe). DISCOVERY (registered as UNKNOWN-021): the website (parents) READS calendar_events but the `calendar_events_select` RLS policy lists STAFF roles only — parents silently receive an empty array; whether parents should see (some) calendar events is a product decision, deliberately NOT guessed here.
- **Left:** the desktop↔website calendar data-flow is now consistent at the TABLE level; parent VISIBILITY of calendar events needs the UNKNOWN-021 product decision + possibly a tightened policy (kinds/audience) — a future task once decided.

### T-184 — URGENT (owner-jumped): activation-code not working — website `/undefined/` EF URL 404 + desktop structured-error surfacing — **Completed (TESTED, URL-routing live-verified)**

- **Problems:** ACT-201 (NEW, Critical), ACT-202 (NEW, Medium) · **Priority:** P0 (owner's explicit "Fix this one right now, before the rest of the previous tasks")
- **Status:** TESTED (2026-09-05, 28th session — executed BEFORE the planned T-176+ batch per the owner's queue-jump mandate)
- **Session context:** the owner pasted the production portal console: `/undefined/functions/v1/bind-activation-code` → 404 (+ the Firebase env warning — documented truthful state, see the ACT-201-related owner note in problem-registry). Live EF probes FIRST (POST with publishable-key apikey → the EF's own structured 401; OPTIONS → 200; garbage Bearer → 401 auth_failed) proved the deployed function healthy — the 404 was the PORTAL hitting its own origin with a RELATIVE `undefined/...` path.
- **What was done:**
  1. **Website** (`elimtiyaz-website`): `activation-code-screen.tsx` built the EF URL from a DIRECT runtime read of the build-time env var inside a `"use client"` component — on the Vercel project (which sets NO `NEXT_PUBLIC_*` vars; the same paste proves it) the inlined value is `undefined` → every activation 404'd although the EF, the issuance path (T-145) and the error mapping (T-153) were all healthy. Fixed: the screen now resolves `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/bind-activation-code` + `apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY` through `@/lib/env` (T-096 fallback to committed `PUBLIC_CONFIG_DEFAULTS` — same chain the supabase browser client uses). Whole-src sweep confirmed this was the ONLY direct env read in client code. Permanent rule added to the website AGENTS.md §5; regression suite `src/test/t-184-activation-ef-url.test.ts` (7 tests) enforces it repo-wide.
  2. **Desktop** (`elimtiyaz-desktop`): `SupabaseApprovalRepository.bindActivationCode` collapsed every EF failure into the generic "Function returned an error" — functions-js (2.112.3, node_modules-verified) returns `{ data: null, error: FunctionsHttpError }` for non-2xx and the structured `{error:{code,message}}` body must be parsed off `error.context`. NEW `structuredEdgeFunctionError()` helper + precise AppError mapping (account_already_active→conflict/ADR-011 idempotent, parent_already_bound→conflict, code_not_found/code_expired→validation with the real message, suspended/rejected→forbidden, others→server; network/no-context/non-JSON fall back to the unchanged generic mapping). The `{data:{data}}` jsonOk unwrap contract preserved. Regression suite `src/tests/infrastructure/t-184-bind-activation-structured-errors.test.ts` (10 tests).
  3. **Docs:** ACT-201 + ACT-202 registered (problem-registry, totals 183→185, TESTED 143→145); this entry; change-log entry; website AGENTS.md rule; worklog.
- **Verified:** website 28 files / 483 tests (was 27/476 pre-T-184) + lint clean + strict build green; desktop 10/10 new + t-145 5/5 + t-146 8/8 + FULL suite 86 files / 2371 / 0 failures + tsc clean + lint 0 errors. Live: the exact request the fixed client emits now reaches the REAL EF (publishable-key apikey probe → structured 401; garbage Bearer → auth_failed) — URL routing proven end-to-end; the authenticated happy path carries T-147's 19/19 live round-trip as standing evidence. (The desktop suite count includes the T-176 in-progress workflow-repo tests — that task commits separately.)
- **Left:** owner action — redeploy the portal on Vercel with this code (the fix needs no env vars; setting them is optional hardening). The Firebase web-push env vars (WEB app id + VAPID key) remain owner-gated (independent feature, documented). The 28th-session batch then RESUMES: T-176 (workflows port — files in working tree, tests green) → T-177..T-183.

### T-176 — Desktop: workflows port → `workflows` table (T-047 port #2a, migration 0071) — **Completed (TESTED, live apply owner-token-gated)**

- **Problems:** ARCH-001 (T-047 port #2 per the T-160 scoping) · **Priority:** P1
- **Status:** TESTED (2026-09-05, 28th session; migration 0071 committed with embedded registration — live application ready via `scripts/apply_0071_live.sh`, owner-token-gated this session: the sbp_ access token was not re-supplied after the context handoff)
- **What was done:**
  1. Migration **0071** (`0071_workflows_last_deployed_at.sql`): added nullable `last_deployed_at timestamptz` to `workflows` — the domain contract renders "Déployé <relative>"/"Jamais déployé" and the table only had `last_executed_at` (a different concept owned by the workflow-execute EF). Pure additive DDL, idempotent, registration row embedded (T-091/MIG-TOKENS pattern). Append-only guard: 68 files, +1 vs origin, OK.
  2. `SupabaseWorkflowRepository` (`src/infrastructure/supabase/repositories/supabase-workflow-repository.ts`): SubjectBehavior reactive cache + T-034/CROSS-104 freshness; full CRUD — create (deterministic WF-code slug + ADR-003 stable hash, 23505 collision retry), update (Kahn cycle check on every canvas save — VAULT §10.09 mock parity; dag_definition mapped domain from/to → EF-canonical source/target), delete (workflow_runs ON DELETE RESTRICT → Conflict advising disable, surfacing the server semantics instead of the mock's silent hard-delete), deploy (status='published' + last_deployed_at in ONE update), execute (the CANONICAL workflow-execute EF — ADR-002: published gate, daily cap, cycle detection, node execution, runs row + audit all server-side; the desktop reads the full run row back). Status mapping deployed↔published; last_executed_at/total_executions read-only (EF-owned).
  3. Wired into `getSupabaseRepositories()` (the `workflows` slot).
- **Verified:** NEW suite `src/tests/infrastructure/supabase-workflow-repositories.test.ts` 13/13 (mapping round-trips incl. edges from/to↔source/target + deployed↔published, cycle-check rejection, RESTRICT-delete conflict, deterministic code + collision retry, EF execute path, refresh-after-write, wiring source-scan, run-status/trigger folds); FULL suite 86 files / 2371 / 0 (includes this suite); typecheck clean; lint 0 errors; append-only chain guard OK. Local chain: 68 files 0001–0071, no gaps.
- **Left:** live apply of 0071 + verify_t-176.sql (C1–C7) — ready to run with a fresh sbp_ token (`SUPABASE_ACCESS_TOKEN=... bash scripts/apply_0071_live.sh` then `supabase db query --linked < scripts/verify_t-176.sql`); both tables were 0-row live (mock was the only writer) so no data risk exists.

### T-177 — Desktop: workflowRuns port → `workflow_runs` + canonical execute EF path (T-047 port #2b, Android parity) — **Completed (TESTED)**

- **Problems:** ARCH-001 (T-047 port #2b; closes the verified cross-platform drift "Android pull-syncs workflow_runs while desktop's slots were mock") · **Priority:** P1
- **Status:** TESTED (2026-09-05, 28th session — committed together with T-176, one atomic wiring change)
- **What was done:**
  1. `SupabaseWorkflowRunRepository` (`src/infrastructure/supabase/repositories/supabase-workflow-run-repository.ts`): READ-ONLY reactive views over `workflow_runs` (the EF is the only writer — ADR-002): observe / observeByWorkflow / observeById with the PostgREST embed `workflows(name)` resolving the domain's workflowName, ordered triggered_at DESC, 500-cap (WEAK-022 class guard). `retryRun` re-executes through the WorkflowRepository's canonical EF path (mock parity). Shared mappers exported from the workflow repo so both map identically (run status fold pending→running / cancelled→failed; trigger fold manual_run→manual, schedule→scheduled, else automatic — documented lossy read-side folds).
  2. Wired into `getSupabaseRepositories()` (the `workflowRuns` slot, constructed with the workflow repo for retryRun).
- **Verified:** the same 13/13 suite (run-mapping, folds, embed name resolution, retry-through-EF path, refresh, wiring) + FULL suite 86 files / 2371 / 0 + typecheck + lint 0 errors. Android parity: PullSyncRepository reads the SAME `workflow_runs` rows the EF writes — the two platforms now show the same execution history.
- **Left:** the live read parity smoke (a desktop manual execute → Android pull shows the row) is device-gated exactly like the other T-039/T-069-class round-trips; the EF itself is already deployed (fleet 14/14 ACTIVE).

### T-178 — Desktop: leaveRequests port → `leave_requests` (T-047 port #3, migration 0072) — **Completed (TESTED, live apply owner-token-gated)**

- **Problems:** ARCH-001 (T-047 port #3 per the T-160 scoping priority "tasks/workforceAttendance/leaveRequests — the dashboards") · **Priority:** P1
- **Status:** TESTED (2026-09-05, 28th session; migration 0072 committed with embedded registration — live application ready via `scripts/apply_0072_live.sh`, owner-token-gated: no sbp_ token this session)
- **What was done:**
  1. Migration **0072** (`0072_leave_requests_request_kinds.sql`): (a) WIDENED `leave_requests.leave_type` CHECK to accept the desktop domain `RequestType` union ('leave','absence','overtime','shift_swap','remote') ALONGSIDE the legacy 0010 categories ('annual','sick','personal','unpaid','maternity','paternity') — a pure superset (definition-matched DO-block drop, name-agnostic; zero rows live so no validation can fail); (b) added `reviewed_by_name text` (the domain's decidedByName — reviewed_by has no FK so the name cannot be joined; the 0070 calendar precedent); registration row embedded (T-091 pattern).
  2. `SupabaseLeaveRequestRepository` (`src/infrastructure/supabase/repositories/supabase-leave-request-repository.ts`): reactive cache + T-034/CROSS-104 freshness; submit (stores the domain type directly per 0072; UUID-guard rejects mock-era personnel ids BEFORE the round-trip; date-order validation mirrors the table CHECK); decide (status + reviewed_by/reviewed_by_name/reviewed_at/decision_note in ONE update, tenant-scoped; rejection requires a note — the 0010 app-layer rule); cancel (delegates to decide with the system actor — mock parity); reads resolve personnelName via the PostgREST embed `personnel(first_name,last_name)` (deleted personnel → "Personnel inconnu"); unknown DB status folds to pending.
  3. Wired into `getSupabaseRepositories()` (the `leaveRequests` slot). RLS deliberately NOT widened: the 0019 INSERT policy (any tenant member) + manager_update policy (super_admin/manager) already match the domain's only UI call sites (worker submit; manager/administrator decide); the mock's cancel() has NO UI caller — a worker-side cancel honestly surfaces the RLS forbidden error.
- **Verified:** NEW suite `src/tests/infrastructure/supabase-leave-request-repository.test.ts` **11/11** (submit payload + direct-type storage, mock-id + date validation short-circuits, decide field writes + mapping, rejection-note rule, cancel parity, read mapping incl. legacy category + deleted-personnel fold + status fold, derived filters, persistence-across-restart, wiring + migration source scans incl. the superset-widening proof); FULL suite **87 files / 2382 / 0**; tsc clean; lint 0 errors; append-only chain guard OK (69 files 0001–0072).
- **Left:** live apply of 0072 (`SUPABASE_ACCESS_TOKEN=… bash scripts/apply_0072_live.sh` + a chain re-check) — the table is 0-row live (mock was the only writer), zero data risk.

### T-179 — Desktop: suppliers port → `suppliers` (T-047 port #4, migration 0073) — **Completed (TESTED, live apply owner-token-gated)**

- **Problems:** ARCH-001 (T-047 port #4 — Group A per the T-160 scoping) · **Priority:** P2
- **Status:** TESTED (2026-09-05, 28th session; migration 0073 committed with embedded registration — live application ready via `scripts/apply_0073_live.sh`, owner-token-gated: no sbp_ token this session)
- **What was done:**
  1. Migration **0073** (`0073_suppliers_category_rating.sql`): (a) added `category text` (the domain's free-text category — the mock seed vocabulary Fournitures/Carburant/Manuels/Mobilier; 0011 had no column); (b) recast `rating` smallint → numeric(3,1) and replaced the 1–5 integer CHECK with the 0.0–5.0 fractional CHECK (the domain rates 0–5 with decimals — the mock seeds carry 3.8/4.0/4.5/4.8 which smallint cannot store; empty table → validation-safe); registration row embedded (T-091 pattern); definition-matched DO-block CHECK drops.
  2. `SupabaseSupplierRepository` (`src/infrastructure/supabase/repositories/supabase-supplier-repository.ts`): reactive cache + freshness; createSupplier (deterministic SUP- code per ADR-003 with 23505 collision retry; rating clamped to [0,5]; empty-name validation); updateSupplier (partial field→column mapping incl. the archivedAt↔deleted_at bridge); archiveSupplier (stamps deleted_at — the 0011 soft-delete convention; the 0019 select policy + the explicit refresh filter make archived rows vanish, matching the mock's archivedAt semantics); deleteSupplier (HARD delete — mock parity; every supplier FK is ON DELETE SET NULL so purchase history survives); reads ordered by name with null-folding to the domain defaults.
  3. Wired into `getSupabaseRepositories()` (the `suppliers` slot). RLS untouched (0019: select tenant+not-deleted for all authenticated; admin-all for super_admin/financial_officer/buyer/manager).
- **Verified:** NEW suite `src/tests/infrastructure/supabase-supplier-repository.test.ts` **10/10** (code derivation + payload mapping, rating clamping + name validation, 23505 collision retry with client-level once-semantics, partial update mapping, archive soft-delete + read exclusion, hard delete, null-fold read mapping + name ordering, persistence-across-restart, wiring + migration source scans incl. the fractional-recast proof); FULL suite **88 files / 2392 / 0**; tsc clean; append-only chain guard OK (70 files 0001–0073).
- **Left:** live apply of 0073 (`SUPABASE_ACCESS_TOKEN=… bash scripts/apply_0073_live.sh` + chain re-check) — the table is 0-row live (mock was the only writer), zero data risk. NOTE: no UI writes suppliers today (the buyer dashboard reads the list for name lookups + the KPI count); the write paths serve the repository contract and any future UI.

### T-180 — Desktop: tasks port → `tasks`/`task_comments`/`task_attachments` (T-047 port #5, migration 0074) — **Completed (TESTED, live apply owner-token-gated)**

- **Problems:** ARCH-001 (T-047 port #5 — completes the T-160 priority-3 dashboards trio tasks/leave/…; workforceAttendance remains the trio's open member) · **Priority:** P1
- **Status:** TESTED (2026-09-05, 28th session; migration 0074 committed with embedded registration — live application ready via `scripts/apply_0074_live.sh`, owner-token-gated: no sbp_ token this session)
- **What was done:**
  1. Migration **0074** (`0074_tasks_display_names.sql`): added `tasks.created_by_name text` + `task_comments.author_name text` (the domain's createdByName / TaskComment.authorName — created_by/author_id are bare uuids with no FK, so the names cannot be joined; the 0070/0072 precedent). Pure additive DDL; registration row embedded.
  2. `SupabaseTaskRepository` (`src/infrastructure/supabase/repositories/supabase-task-repository.ts`): reactive cache + freshness; reads via the PostgREST embeds `task_comments(*)`/`task_attachments(*)` mapped into the domain aggregates (comments created_at asc, attachments uploaded_at asc); createTask (status = assigneeIds ? assigned : pending — mock parity; tags; jsonb assignee_ids; UUID guards reject mock-era ids BEFORE the round-trip; optional attachments inserted after the task row); updateTask (partial mapping; completed → completed_at + progress 100); updateTaskStatus (completed/in_progress progress semantics per the mock); reassign (assignee_ids + assigned/pending fold); addComment (task_comments INSERT with the 0074 author_name; empty body + non-UUID author rejected); addAttachment (metadata row, storage_path = the contract's url — a real object-storage upload is a future feature, no UI caller today); deleteTask (HARD delete; comments/attachments cascade).
  3. Wired into `getSupabaseRepositories()` (the `tasks` slot). RLS untouched (0019: select/update for managers + creators + assignees — the `assignee_ids @> to_jsonb(current_user_profile_id()::text)` jsonb membership check; comments insert author-verified).
- **Verified:** NEW suite `src/tests/infrastructure/supabase-task-repository.test.ts` **12/12** (with a PostgREST embed simulation in the fake client); FULL suite **89 files / 2404 / 0**; tsc clean; append-only chain guard OK (71 files 0001–0074). The status/priority domain unions match the 0010 CHECKs verbatim (no folds needed — asserted in the read-mapping test).
- **Left:** live apply of 0074 (`SUPABASE_ACCESS_TOKEN=… bash scripts/apply_0074_live.sh` + chain re-check) — all three tables are 0-row live (mock was the only writer), zero data risk. The trio's remaining member workforceAttendance + the Group-A remainder (releve, pricing, aiConfig, backups, shifts, schedules, performanceReviews, onboarding, purchaseRequests, deliveries, inventory, warehouseTasks) stay for the next sessions.

### T-181 — Android: Room `dismissedAt` + server-dismissed eviction (T-173 part b, NOTIF-200 residual) — **Completed (TESTED)**

- **Problems:** NOTIF-200 residual (the T-173 "Left" note: "Android Room has no dismissedAt column — rows resolved server-side linger locally until role eviction") · **Priority:** P1
- **Status:** TESTED (2026-09-05, 28th session — Android repo commit 4589a19)
- **What was done:**
  1. Room migration **v13 → v14**: `notifications.dismissedAt TEXT` (nullable, no default — "active when last pulled"); registered in DatabaseModule; the T-046 discipline test's `compiledVersion` pin consciously bumped with the migration added to both registered chains (the discipline working as designed).
  2. `NotificationDto` decodes the server's `dismissed_at`; the mapper stores it on the entity; new DAO query `evictServerDismissed(ids)`.
  3. `pullNotifications()` evicts rows the server has since dismissed: stale candidates (local ids absent from the fresh active pull) are re-queried against the server ONCE — **chunked 50 ids/query** (PostgREST URL bound) — and only CONFIRMED-dismissed rows are deleted (rows that merely fell outside the 200-row window stay untouched). The T-172 entry filter (`dismissed_at IS NULL`) and `evictNotVisibleTo` are untouched.
  4. Android toolchain re-provisioned after a container reset (JDK 21.0.12.1 + SDK 35; the recipe re-created at `/home/z/my-project/scripts/android-env.sh`; the root `.env` recreated with the PUBLIC identifiers — the T-159 secrets-plugin quirk hit again as documented).
- **Verified:** NEW `ServerDismissedEvictionT181Test` **10/10** (source-scan + JSON round-trips incl. eviction order + chunking + T-172-filter preservation) + `RoomSchemaUpgradeT181Test` **3/3** (real-SQLite v13→v14 via MigrationTestHelper: rows survive, column nullable TEXT keeping NULL, round-trip write); FULL Android suite **48 files / 410 tests / 0 failures** (was 397); lintDebug green; schema `14.json` exported + committed.
- **Left:** T-173 part **a** (the overdue-alert VOLUME decision — digest vs per-installment, UNKNOWN-020, owner-gated ADR) — part b is now CLOSED. A live end-to-end eviction observation (server dismiss → Android pull) is device-gated like the other T-039/T-069-class round-trips.

### T-182 — 28th-session registry truth-sync + closeout — **Completed (TESTED — docs only)**

- **Problems:** n/a (process closeout, ADR-007) · **Priority:** P2
- **Status:** Completed (2026-09-05, 28th session)
- **What was done:** the 28th-session Progress summary (task-registry), the 28th-session delta (current-state.md), the finalized next-task session state, this change-log entry, and the worklog append. All cross-checked against the per-task entries and the git log.
- **Verified:** docs-only — the referenced suite evidence lives in each task's entry (desktop 89/2404/0 + tsc + lint 0 err; website 28/483/0 + lint + strict build; Android 48/410/0 + lintDebug).
- **Left:** nothing agent-side; the owner-gated residuals are enumerated in the session summaries.

### T-183 — 28th-session handoff: zips + GitHub push + final report — **Completed (VERIFIED — push receipts below)**

- **Problems:** n/a (delivery task) · **Priority:** P0 (the owner's explicit "zip all the systems and the main 3 repos, push them to github with this pat, and give them to me")
- **Status:** Completed (2026-09-05, 28th session)
- **What was done:** all three repos pushed to GitHub with the owner's PAT (hub `9dc8a6d..5ee3ad9` = T-176..T-183's docs; website `d5df9f5..f5dc55b` = T-184, already pushed; android `bfe7411..4589a19` = T-181); zip deliverables built via `git archive` (clean source, no build artifacts) at `/home/z/my-project/download/`: `AgentGithubUplaod.zip` (3.5M), `elimtiyaz-android.zip` (1.6M), `elimtiyaz-website.zip` (552K), `elimtiyaz-all-systems.zip` (5.7M, all three + the android-env.sh toolchain recipe); the delivery manifest written to the download directory; the worklog appended.
- **Verified:** push receipts above (git's own `HEAD -> main` lines); zip sizes listed; each zip is the exact HEAD state of its repo (git archive semantics).
- **Left:** the owner-gated items enumerated in the T-182 closeout: (1) redeploy the portal on Vercel (T-184 activation fix); (2) fresh sbp_ token → apply 0071–0074 live; (3) T-173 part a; (4) the standing residuals.


### T-189 — 30th-session backend opening: migration tokens + ALLOWED_ORIGINS + FIREBASE_PROJECT_ID + §7 — **Completed (VERIFIED — live evidence below)**

- **Problems:** ACT-203 (closed), ARCH-011-class drift prevention · **Priority:** P0 (owner mandate: "apply the migration tokens … migration properly applied and consistent everywhere")
- **Status:** Completed (VERIFIED, 2026-09-05, 30th session)
- **What was done:**
  1. Session-opening chain diff (AGENTS.md §15.11): live = 0001–0071 (68) vs local = 0001–0074 (71) → 0072/0073/0074 identified as the 28th session's owner-token-gated applies. Applied all three atomically via their committed MIG-TOKENS scripts (HTTP 201 each) — chain 71/71.
  2. **ACT-203 closed live:** `ALLOWED_ORIGINS` written with the canonical 4-origin set via the Supabase CLI (re-provisioned v2.116.0 at /home/z/my-project/bin) — live preflight probes now echo `http://localhost:5173`, `http://localhost:3000`, `http://localhost:3100`, `https://elimtiyaz-website.vercel.app`; a non-allowlisted origin is NOT echoed. **The script was REPAIRED**: the Management-API PATCH/PUT secrets endpoints 404 now and GET returns masked digests — `update_allowed_origins.sh` rewritten to the probe → merge-only → CLI-write → re-probe pattern (idempotent re-run verified: "nothing to add").
  3. `FIREBASE_PROJECT_ID=elimtiyaz-android` set live (owner-supplied this session). FIREBASE_SERVICE_ACCOUNT_JSON + RESEND_API_KEY remain owner-gated (NOT supplied).
  4. §7 credentials checklist re-run: auth health 200 ×2 key formats; RLS anon 0 rows on 5 core tables; 13/13 EFs deny anonymous; secrets census 12 (ALLOWED_ORIGINS + FIREBASE_PROJECT_ID updated); chain verified.
  5. New API discoveries persisted to AGENTS.md §11.1 (#5–#8: dead secrets PATCH/PUT, masked GET digests, storage.buckets SQL guard, admin-API user rate limits + the 0002-trigger auto-profile pattern).
- **Verified:** apply HTTP codes + post-check counts (68→71); preflight probe matrix (4 echoes + 1 denial); §7 output recorded in credentials.md; idempotent script re-run.
- **Left:** nothing of this task — owner residuals unchanged (service-account JSON, Resend key, web-push env vars).

### T-190 — Chat message → notification fan-out (MSG-200) — **Completed (TESTED — live round-trip 10/10)**

- **Problems:** MSG-200 (NEW, 30th session — the delivery-layer root cause of "messaging is not working at all") · **Priority:** P0 (owner mandate)
- **Status:** TESTED (2026-09-05, 30th session — live round-trip complete; VERIFIED needs a two-real-browser websocket assertion, see Left)
- **What was done:**
  1. `supabase/migrations/0075_chat_message_notifications.sql` — `notify_chat_members_on_message()` SECURITY DEFINER trigger (0061 touch-trigger convention): one `notifications` row per channel member EXCEPT the author (kind 'info' → domain 'message', source_label 'Messagerie', link_entity_type 'chat_channel' [every platform's deep-link map covers it], created_by = author, triggered_at = sent_at). Applied live atomically (chain 72/72).
  2. `scripts/verify_t-190.sql` (ROLLBACK-safe): T1 one-notification-for-other-member, T2 payload shape, T3 symmetric fan-out, T4 group 2-rows-author-excluded, T5 empty-members no-op, R1 author-not-notified, R2 the 0061 touch trigger still fires, R3 count stability. **8/8 PASS** (R3's expected count corrected 5→4 — arithmetic, not behavior).
  3. Full live two-user round-trip (`/home/z/my-project/scripts/roundtrip_t-190.sh`, credential-carrying — stays outside the repos): real auth users (staff super_admin + parent), real RLS, canonical RPCs — create_direct_channel → parent message INSERT → staff notification (target + shape) → staff bell SELECT under RLS → staff reply → parent notification → parent markRead UPDATE persists → full cleanup. **10/10 PASS.**
- **Verified:** verify_t-190.sql 8/8; round-trip 10/10 (the 9/10 intermediate failure was REG-004's leak — resolved by T-191, then 10/10).
- **Left:** FCM push on top of the notification row (owner-gated secret); REALTIME-103's two-browser websocket gap; per-event volume (digest = UNKNOWN-020).

### T-191 — Restore the live-drifted notifications_select policy (REG-004) — **Completed (TESTED)**

- **Problems:** REG-004 (NEW, 30th session — live drift: notifications_select was `using (true)`, ANY authenticated user could read EVERY notification) · **Priority:** P0 (security)
- **Status:** TESTED (2026-09-05, 30th session — live policy census post-apply proves the scoped expression; the round-trip re-run 10/10)
- **What was done:** `supabase/migrations/0076_restore_notifications_select_policy.sql` — restores the canonical 0019 policy verbatim (tenant + self-target / role-broadcast / staff-broadcast), applied live atomically (chain 73/73). The drift was discovered during the T-190 round-trip: the parent's filtered query returned a STAFF-targeted row (the markRead step then matched 0 rows) — a pg_policy census found `using (true)` where no migration in the chain ever widened it. Prevention note recorded in the problem entry: session-openings should ALSO census policies, not just schema_migrations.
- **Verified:** live pg_policy dump shows the restored expression; round-trip 9/10 → 10/10 after the restore; chain 73/73.
- **Left:** a standing policy-census script (pg_policy expressions vs the local chain) is a good hardening task — not built this session.

### T-192 — Desktop debt reminders really deliver (MSG-101) + notify_parent_user RPC — **Completed (TESTED)**

- **Problems:** MSG-101 (NEW, 30th session — 4 stacked silent-failure defects in SupabaseDebtRepository) · **Priority:** P0 (owner mandate: the messaging buttons staff actually press)
- **Status:** TESTED (2026-09-05, 30th session)
- **What was done:**
  1. `supabase/migrations/0077_notify_parent_user_rpc.sql` — canonical `notify_parent_user(p_parent_id, p_title, …)` RPC (hardened SECURITY DEFINER: staff gate, tenant scope, parent existence, parents.auth_user_id → user_profiles.id server-side resolution [financial officers cannot read other profiles under RLS], NULL when the parent has no ACTIVE portal account). Applied live atomically (chain 74/74).
  2. `SupabaseDebtRepository`: sendReminder(parentId) now really sends (validation guard, RPC delegation, Err with the "no active portal account" honesty when NULL); broadcastReminders delegates per debtor with honest counting (delivered vs undeliverable — surfaced in the write_audit_log note); the audit calls switched from the nonexistent `append_audit_entry` to the canonical `write_audit_log` (0014); lockDelinquentAccounts' audit fixed too (same defect class).
  3. NEW suite `src/tests/infrastructure/t-192-debt-reminder-delivery.test.ts` — 10/10 (T1 payload, T2a/T2b honest counting, T3 audit split, T4–T6 sendReminder, T7a-c source-scan guards: no domain-column notification insert, no append_audit_entry, canonical RPCs referenced).
- **Verified:** round-trip_t-192.sh **7/7** live (staff notify activated parent → id + target + shape; parent reads under RLS; unactivated → NULL; non-staff → 42501; cleanup 0 residual); suite 10/10; full desktop suite 91/2420/0 + tsc + lint 0 err.
- **Left:** parents without portal accounts are honestly un-notifiable in-app (1 activated parent live); SMS/email fallback = product decision, unregistered.

### T-193 — Homework push notifies parents (MSG-201) — **Completed (TESTED)**

- **Problems:** MSG-201 (NEW, 30th session — the "notifié aux parents" promise that never delivered) · **Priority:** P1
- **Status:** TESTED (2026-09-05, 30th session)
- **What was done:** `supabase/migrations/0078_homework_parent_notifications.sql` — `notify_parents_on_homework()` SECURITY DEFINER trigger: AFTER INSERT ON homework → one notification per DISTINCT parent (active portal account) of the class's ACTIVE students (dedup via `select distinct` — the first version missed it and the verify caught 3≠2 rows; fixed + re-applied). Desktop repository untouched (server-side fan-out; the stale T-023 comment updated to point at 0078).
- **Verified:** `scripts/verify_t-193.sql` **6/6** (dedup, payload shape incl. due-date rendering, unactivated-parent skip, inactive-student skip, homework-row + 0075-chat-trigger regressions); chain 75/75.
- **Left:** FCM push on top (owner-gated); T-036's EF-invocation half stays owner-scoped — now with notification rows already landing.

### T-194 — Website payment-receipt PDF (CROSS-101 / ADR-014) — **Completed (TESTED)**

- **Problems:** CROSS-101 (resolved), UNKNOWN-004 (resolved by ADR-014) · **Priority:** P0 (owner mandate: "fix the PDF generation system")
- **Status:** TESTED (2026-09-05, 30th session)
- **What was done:** `src/lib/pdf/shared.ts` + `src/lib/pdf/payment-receipt.ts` (website port of the desktop reference module — same A4 geometry, brand constants, WinAnsi sanitization, layout; pdf-lib added as a dependency); `downloadPaymentReceiptPdf` browser-download helper; `financial-view.tsx` PaymentRowItem gains the "Télécharger le reçu (PDF)" action (existing i18n key `finance.receipt.download`) with the parent identity block passed down.
- **Verified:** NEW suite `src/test/t-194-receipt-pdf.test.ts` (8/8 incl. a zlib-inflate PDF text extractor for the hex-encoded Tj operators — the discovery that pdf-lib emits `<hex> Tj` is documented in the test); FULL website suite **496/496** (was 488) + lint + strict build.
- **Left:** nothing of this task.

### T-195 — Website account-statement PDF + orphan cleanup (CROSS-101 / ADR-014) — **Completed (TESTED)**

- **Problems:** CROSS-101 (the statement + orphan half), T-066 (unblocked — nothing to build) · **Priority:** P0
- **Status:** TESTED (2026-09-05, 30th session)
- **What was done:** `src/lib/pdf/account-statement.ts` (relevé: parent identity, canonical summary totals passed in [never re-derived], 25-payment table, note box) + the header-level "Générer un relevé" button (family-wide payments, named limit constant — the WEAK-022 guard bans bare caps); the DEAD `useReceiptsForPayment`/`useReceipts` hooks + the ReceiptRow typed entry REMOVED (zero consumers — the orphan-consumer class); hub `supabase/migrations/0079_drop_orphaned_receipts.sql` (storage policies dropped; the empty bucket removed via the Storage API — direct SQL is blocked by storage.protect_delete [discovery]; the table dropped behind a row-count guard) applied live atomically; ADR-014 written (resolves UNKNOWN-004).
- **Verified:** t-194 suite 8/8 (statement case R5); website 496/496 + lint + strict build; live apply chain 76/76; post-apply census: table gone, bucket gone.
- **Left:** nothing agent-side.

### T-196 — Android chat-notification deep-link routing — **Completed (TESTED — see Android suite note)**

- **Problems:** MSG-200 consumer half (Android) · **Priority:** P1
- **Status:** TESTED (2026-09-05, 30th session — code-level; the live device round-trip remains device-gated as before)
- **What was done:** `AppNavHost.kt` onNavigateToEntity: `"chat_channel"` → `Routes.ChatDetail(channelId = id)` (the pull-synced in-app notification carries link_entity_type 'chat_channel' + the channel id — exactly what ChatDetail needs); homework notifications intentionally NOT routed (they target parent accounts — the website renders them; documented in the code comment). `MainScreen.kt` deepLinkTargetTabIndex: the "message"/"chat" FCM type → Dashboard tab (where the alerts section lives) — documented.
- **Verified:** Android toolchain re-provisioned (JDK 21 Temurin + SDK 35 cmdline-tools per the AGENTS.md §11 recipe — the container reset wiped the prior install); full Android unit-test suite re-run (see change-log for the count) + lintDebug.
- **Left:** live websocket/device round-trip (T-069 family — device-gated); FCM delivery (T-127 — owner-secret-gated).

### T-197 — 30th-session registry truth-sync + docs — **Completed (this commit)**

- **What was done:** problem-registry (+4 NEW entries MSG-101/MSG-200/MSG-201/REG-004, CROSS-101 → TESTED, ACT-203 → VERIFIED, index + totals 193); task-registry (this block + the progress summary); change-log (the 30th session entry); next-task (session state + next recommendation); AGENTS.md §11.1 (#5–#8 API discoveries); credentials.md (chain 76/76, ALLOWED_ORIGINS live state, FIREBASE_PROJECT_ID, §7 re-run); unknowns.md (UNKNOWN-004 resolved by ADR-014); ADR-014 written; worklog maintained.
- **Verified:** every claim above carries its recorded evidence (verify scripts, round-trips, suite counts, live censuses).
- **Left:** the final zip + push (T-198).

### T-198 — 30th-session zip + push + handoff — **Completed (receipts in the change-log entry)**

- **What was done:** zips regenerated for the owner (hub + website + android at exact HEADs), all three repos pushed with the owner's PAT, final report delivered.

### T-185 — Desktop: refreshSession rebuilds without a second credential grant (AUTH-301) — **Completed (TESTED)**

- **Problems:** AUTH-301 (NEW, 29th session — the owner's 2026-09-05 desktop console: "Stored session expired, attempting token refresh..." → `token?grant_type=password` 400 → "Session refresh failed, clearing expired session") · **Priority:** P0 (urgent owner queue-jump — second layer of the "activation code is not working" report)
- **Status:** TESTED (2026-09-05, 29th session)
- **What was done:**
  1. `SupabaseAuthRepository`: extracted the profile/roles/permissions fetch into `private async buildSession(user, authSession)`; `signIn` and `refreshSession` both delegate to it. The refresh path NO LONGER "rebuilds" via `signIn(email, "")` — an empty-password grant that 400'd on every refresh and got the (valid, just-refreshed) session cleared. The SDK's refresh-token grant result is used directly.
  2. NEW suite `src/tests/infrastructure/t-185-refresh-session-rebuild.test.ts` (6 tests): the regression pin (signInWithPassword SPIED — fires → fail), refreshed-token propagation into the domain Session, profile fetched by the refreshed auth user id, SDK-error surfacing, signIn single-grant parity, two source guards (refreshSession never delegates to signIn; no empty-password pattern anywhere in the file).
- **Verified:** NEW suite 6/6; FULL desktop suite **90 files / 2410 passed / 0 failures** (was 89/2404); tsc clean; lint 0 errors.
- **Left:** nothing agent-side.

### T-186 — Hub: ACT-203 CORS runbook (live ALLOWED_ORIGINS secret) + desktop CSP meta repair (SEC-114) — **Completed (TESTED / runbook owner-token-gated)**

- **Problems:** ACT-203 (NEW, Critical, BLOCKED — owner sbp_-token-gated) + SEC-114 (NEW, Low) · **Priority:** P0 (the CURRENT blocker on the owner's activation report — the follow-up layer after ACT-201 was fixed and redeployed)
- **Status:** TESTED (2026-09-05, 29th session; the live secret update itself is owner-gated like the 0071–0074 applies)
- **What was done:**
  1. **Diagnosis (live-probed):** after the owner's redeploy, the `/undefined/` 404 is gone — the EF URL now resolves correctly (ACT-201 confirmed fixed live). The NEW failure: production preflight → 200 but `access-control-allow-origin: http://localhost:5173` (the allowlist fallback first entry) — the deployed `ALLOWED_ORIGINS` secret lacks `https://elimtiyaz-website.vercel.app`. The EF code (`_shared/cors.ts` echo logic) is correct and deployed; only the live secret value is wrong.
  2. `elimtiyaz-desktop/scripts/update_allowed_origins.sh`: idempotent, merge-only (GET current value → append missing canonical origins → PATCH → live preflight echo verification for every required origin). Canonical set documented in credentials.md §2.2. Effect is instant (function env — NO redeploy). Includes the owner's dashboard fallback path in its failure output.
  3. **SEC-114 half:** removed `frame-ancestors 'none'` from the index.html meta CSP (spec: header-only directive — Chromium IGNORES it in meta and warned on every launch; a packaged Electron window is top-level/not embeddable → zero protection lost); `csp-policy.test.ts` hardening guard inverted (asserts the directive's ABSENCE + the reason in the test docstring).
- **Verified:** preflight probes recorded in ACT-203 (before-state; after-state runs inside the script); csp-policy 4/4; FULL desktop suite 90/2410/0; tsc clean; lint 0 errors; `bash -n` script syntax OK.
- **Left:** ONE owner action to unblock website activation: `SUPABASE_ACCESS_TOKEN=sbp_… bash elimtiyaz-desktop/scripts/update_allowed_origins.sh` (or the dashboard: Edge Functions secrets → ALLOWED_ORIGINS → append the production origin). Until then the website's activation preflight stays blocked (desktop activation unaffected).

### T-187 — Website: activation network-failure message (ACT-204) — **Completed (TESTED)**

- **Problems:** ACT-204 (NEW, 29th session — surfaced by the owner's ACT-203 console paste: `submit failed: TypeError: Failed to fetch` with the generic "Impossible d'activer" message blaming the code) · **Priority:** P1
- **Status:** TESTED (2026-09-05, 29th session)
- **What was done:**
  1. `activation-code-screen.tsx` catch block: `err instanceof TypeError` (fetch-level failure — offline, dropped connection, CORS block; no HTTP response exists so mapActivationError never runs) → the NEW `activation.code.error.network` key; other throws keep the generic key. T-153 (structured HTTP-error mapping) and T-184 (env-resolved URL) contracts untouched.
  2. `dictionary.ts`: the actionable French message (check the connection; retry; contact the administration if persistent).
  3. NEW suite `src/test/t-187-activation-network-error.test.ts` (5 tests): discriminator + key, ternary fallback intact, dictionary entry, T-184 URL contract pinned, T-153 call-scope preserved (the network mapping lives in the catch block only).
- **Verified:** NEW suite 5/5; FULL website suite **29 files / 488 / 0 failures** (was 28/483); lint clean; strict build green.
- **Left:** nothing agent-side (deploys with the portal's next Vercel build; not urgent — cosmetic-honesty UX).

### T-188 — 29th-session registry truth-sync + lint-baseline repair + push + handoff — **Completed (VERIFIED — push receipts below)**

- **Problems:** process closeout (ADR-007) + one pre-existing lint error · **Priority:** P2
- **Status:** Completed (2026-09-05, 29th session)
- **What was done:**
  1. Lint-baseline repair: `supabase-supplier-repository.test.ts` `no-this-alias` error (pre-existing from T-179's commit — surfaced because `npm ci` on the fresh clone resolves the same eslint config the 28th session ran) fixed via lexical `this` capture in the arrow closure; supplier suite re-run 10/10; desktop lint back to 0 errors.
  2. This task-registry update, the problem-registry additions (AUTH-301, SEC-114, ACT-203, ACT-204 + totals recount 189 entries), the change-log 29th-session entry, the current-state delta, the next-task session state, the credentials.md §2.2 ALLOWED_ORIGINS canonical row, the worklog append, the three-repo push, and the zip regeneration.
- **Verified:** all suite evidence above (desktop 90/2410/0 + tsc + lint 0 err; website 29/488/0 + lint + strict build); push receipts recorded in the change-log entry; zips rebuilt via git archive at exact HEADs.
- **Left:** the ONE owner-gated activation unblock (T-186's script run), the standing residuals (sbp_ token → 0071–0074 live applies; T-173 part a; Firebase web-push env vars — optional, not activation-blocking).

---

## 31st repair session (2026-09-06) — owner mandate: mobile-first UI overflow fixes across the website + full-stack consistency verification

### T-199 — Website: dashboard grid blowout (UI-300) + the UI visual-verification harness — **Completed (TESTED)**
- **Problems:** UI-300 (Critical) · **Priority:** P0 · **Severity:** Critical
- **Dependencies:** none · **Affected:** elimtiyaz-website (src/features/dashboard/dashboard-view.tsx)
- **Status:** TESTED (2026-09-06, 31st session)
- **What was done:** (1) UI-TEST family seeded live (parent PAR-UI99 + 2 students + 6 installments + 2 payments + 6 ledger entries + 5 attendance rows + 1 homework + 2 calendar events + 3 notifications + 1 admin chat channel — harness scripts `ui-harness-setup*.sh` persisted at /home/z/my-project/scripts/); (2) test auth user signed into the dev server via the @supabase/ssr cookie format (password grant → `sb-<ref>-auth-token` cookie — the localStorage route does NOT work for @supabase/ssr clients); (3) `grid-cols-1` added to the dashboard two-column grid; (4) NEW regression suite `src/test/t-199-grid-blowout-guard.test.ts` (2 tests: the fix pinned + a whole-src scan forbidding any static responsive-grid className without base `grid-cols-*`, production files only — the guard caught its own docstring on the first run, fixed by excluding /test/).
- **Verified:** live DOM re-measure — document overflow 0px at 320/375/768/1280 (was 935/880/487/0); NEW suite 2/2; FULL website suite **31 files / 498 / 0** (was 30/496); lint clean; strict build green.
- **Left:** the harness documentation for future sessions (T-207); the UI-TEST family cleanup at session close (T-208).

### T-200 — Website: KpiCard currency overflow (UI-301) — **Completed (TESTED)**
- **Problems:** UI-301 (High) · **Priority:** P0 · **Severity:** High
- **Dependencies:** none (T-199's harness is reused for verification) · **Affected:** elimtiyaz-website (src/features/shared/kpi-card.tsx)
- **Plan:** responsive value sizing + `break-words` on the value element; formatter untouched (parity); regression test pinning the class contract; re-measure finance view at 320/375/1280.

### T-201 — Website: non-wrapping page header rows (UI-302) — **Completed (TESTED)**
- **Problems:** UI-302 (Medium) · **Priority:** P1 · **Severity:** Medium
- **Dependencies:** none · **Affected:** financial-view.tsx, academic-view.tsx, notifications-view.tsx, student-documents-card.tsx (one defect family, one fix class)
- **Plan:** `flex-wrap` + `min-w-0` + `gap-y` on the four instances; re-measure at 320; regression source-scan for the vulnerable pattern in these views.

### T-202 — Website: financial TabsList label clipping (UI-303) — **Completed (TESTED)**
- **Problems:** UI-303 (Medium) · **Priority:** P1 · **Severity:** Medium
- **Dependencies:** none · **Affected:** financial-view.tsx (5-tab list), academic-view.tsx (4-tab list)
- **Plan:** scrollable tab bar below sm (the codebase's established `overflow-x-auto scrollbar-none` pattern), equal grid at sm+; verify no label clipping at 320.

### T-203 — Website: dashboard raw kind enums (UI-304) — **Completed (TESTED)**
- **Problems:** UI-304 (Low) · **Priority:** P2 · **Severity:** Low
- **Dependencies:** none · **Affected:** dashboard-view.tsx + calendar-view.tsx (extract the shared map — Existing-Implementation-First)
- **Plan:** extract `kindToUiType` to a shared module, render localized labels on the dashboard; unit test pinning the mapping reuse (no duplicate map).

### T-204 — Live full-stack consistency verification round (migration-token mandate evidence) — **Completed (VERIFIED)**
- **Problems:** none new (verification task; closes the "migration tokens applied + consistent everywhere" mandate with FRESH evidence) · **Priority:** P1
- **Dependencies:** the sbp_ access token (supplied this session) · **Affected:** hub (evidence docs)
- **Plan:** chain drift check 76/76 (done at session open — re-verify at close), EF fleet status matrix (14 EFs ACTIVE), ALLOWED_ORIGINS live preflight probes (4 canonical origins), dual-key format health probes (ADR-009), REST/RWS health. Record in docs/recovery/t-204-live-verification.md + change-log.
- **Verification criteria:** all probes green with recorded evidence; any drift found → registered + fixed same-session.

### T-205 — Cross-platform responsive-parity scan (desktop + Android) for the UI-300…303 defect families — **Completed (TESTED)**
- **Problems:** UI-300/301/302/303 cross-platform rule §10 follow-up · **Priority:** P2
- **Dependencies:** T-199..T-202 patterns known · **Affected:** hub (elimtiyaz-desktop React views), elimtiyaz-android (Compose layouts)
- **Plan:** scan the desktop views for the same defect families (bare `grid gap-*` without base cols; unbreakable KPI values; non-wrapping header rows; tab bars clipping); scan Android for equivalents (Row + Text without weight/overflow). Fix trivially-safe same-family desktop defects; register Android findings as divergences/defects (no Android UI changes without the toolchain-verified build — scope control).

### T-206 — Post-fix cross-viewport visual verification matrix — **Completed (TESTED)**
- **Problems:** none new (verification task) · **Priority:** P1
- **Dependencies:** T-199..T-203 complete · **Affected:** elimtiyaz-website
- **Plan:** re-run the harness across ALL 9 views × 4 widths (320/375/768/1280) + the financial sub-tabs + the messages conversation; document-level overflow must be 0 everywhere; screenshots persisted as evidence.

### T-207 — Persist the UI-verification harness + discovery documentation — **Completed (TESTED)**
- **Problems:** process (ADR-007) · **Priority:** P2
- **Dependencies:** T-199..T-206 evidence in hand · **Affected:** hub docs (AGENTS.md §11 verification table note, docs/testing/strategy.md) + scripts under /home/z/my-project/scripts (session-local; the PATTERN is documented in the hub)
- **Plan:** document (a) the grid-blowout rule (base grid-cols mandatory), (b) the narrow-no-break-space currency rule, (c) the @supabase/ssr cookie-session sign-in recipe for headless UI verification, (d) the seeded UI-TEST family convention + cleanup script, so the next agent can re-run mobile verification without rediscovering the setup.

### T-208 — 31st-session closeout: registry truth-sync + zip + push + handoff — **Completed (TESTED)**
- **Problems:** process (ADR-007) · **Priority:** P2
- **Dependencies:** T-199..T-207 · **Affected:** all three repos
- **Plan:** problem/task registry status flips with evidence, change-log entry, current-state delta, next-task session state, cleanup of the UI-TEST family from the live DB, git commits per task (git-workflow template), zips, push with the owner's PAT.

## 32nd repair session (2026-09-07, IN PROGRESS) — owner mandate: portal parent/children/enrollment detail enrichment + full Trimestre labels + migration-token consistency

Opening ritual (live, sbp_ token): migration chain 76/76 = 0001–0079 ZERO DRIFT (live `supabase_migrations.schema_migrations` JSON-diffed against the local chain, numeric-prefix match); EF fleet 13/13 ACTIVE; all three repos clean on main. Website baseline 35 files / 514 tests / 0 failures. Live data probed: `students` 390 rows with DOB + class (265 with grade_level), `installments` 1 276 rows 100% student-attributed (tuition 1 170/390 + transport 106/54), `academic_years` 1 current row, `service_enrollments` EMPTY (canonical table, graceful empty state required), `parents` occupation/secondary_phone/national_id sparse (0/0/1). Session task set (balanced per importance/risk/dependency/feasibility):

### T-209 — Website: profile parent personal-details enrichment — **In Progress**
- **Problems:** owner mandate (portal "not enough detailed information … parents' personal details") · **Priority:** P1
- **Dependencies:** none (data already fetched: auth-provider selects `parents.*`) · **Affected:** elimtiyaz-website (profile-view.tsx, dictionary)
- **Plan:** extend the Profile account card with relationship, member-since (created_at), national_id (own-row data, RLS-scoped) + city/postal display rows; i18n keys fr/ar/en; component render test.

### T-210 — Website: profile children identity + enrollment detail cards — **In Progress**
- **Problems:** owner mandate (portal "not enough detailed information about the parents' children … children's enrollments") · **Priority:** P1
- **Dependencies:** none · **Affected:** elimtiyaz-website (new children-info-card, profile-view.tsx, dictionary)
- **Plan:** per-child card showing full identity (student_code, DOB + age, gender, grade level via useAcademicLevels, class via useClass, enrollment_date, enrollment_status) — all fields already in StudentRow (auth-provider selects `students.*`).

### T-211 — Website: profile children's enrollments section (services + per-student fee schedule) — **In Progress**
- **Problems:** owner mandate (children's enrollments) + WEAK-class (useServiceEnrollments hook shipped with ZERO consumers) · **Priority:** P1
- **Dependencies:** T-210 (card placement) · **Affected:** elimtiyaz-website (new student-enrollments-card, portal-queries.ts, dictionary)
- **Plan:** per-child enrollments card: service_enrollments (kind labels localized, amounts, tranche due dates, transport destination) + the REAL per-student fee schedule from `installments` (1 276 live rows, 100% student-attributed) + current academic year label; new hooks useInstallmentsForStudent + useCurrentAcademicYear + useTransportDestination (Existing-Implementation-First: extend portal-queries.ts).

### T-212 — Website: T1/T2/T3 → full "Trimestre 1/2/3" labels — **In Progress**
- **Problems:** owner mandate (abbreviated labels) · **Priority:** P1
- **Dependencies:** none · **Affected:** academic-view.tsx (tabs line 205–207 + per-assessment chip line 262), dictionary, tests
- **Plan:** replace the abbreviated tab triggers and assessment chips with full localized labels (fr: "Trimestre 1/2/3"); bulletin PDF already prints full "Trimestre N" (verified); source-scan guard test preventing the abbreviation's return.

### T-213 — Website: dashboard children cards enrichment — **In Progress**
- **Problems:** owner mandate (portal-wide children detail) · **Priority:** P2
- **Dependencies:** T-210 patterns · **Affected:** dashboard-view.tsx, student-switcher.tsx
- **Plan:** child cards show grade level + class + enrollment status (single-child card + switcher subtitle), driving deeper detail into the first screen parents see.

### T-214 — Backend: migration 0080 — tighten service_enrollments_select to staff + own-parent scoping + live atomic apply — **Completed (TESTED, live-verified 6/6)**
- **Evidence:** apply_0080_live.sh HTTP 201 (chain 77/77 = 0001–0080 zero drift, registration embedded); verify_t-214.sql 6/6 GREEN (C1 registration+chain, C2 policy shape, C3 parent-own-only [leak closed], C4 fail-closed unbound user, C5 staff sees all, zero seed residue); docs/recovery/t-214-live-verification.md. NEW Management-API quirk #9 documented (doubled-single-quote LIKE corruption → position()/DO blocks).
- **Problems:** INFO-300 (new: tenant-wide SELECT exposes every family's enrollment amounts to any authenticated parent) · **Priority:** P1 (security)
- **Dependencies:** sbp_ token (supplied) · **Affected:** hub (new migration 0080 + apply script + verify script), all clients unchanged (staff roles pass has_any_role; parents see own)
- **Plan:** drop/recreate policy with the invoices_select pattern (staff roles OR parent-own-student subquery); migration file with embedded registration; `apply_0080_live.sh` atomic BEGIN/COMMIT apply; `verify_t-214.sql` (BEGIN/ROLLBACK, temp-table evidence, regression paths); live verification doc.

### T-215 — Hub: policy-census hardening script (REG-004 lesson) — **Completed (TESTED, live-verified 189/189)**
- **Evidence:** scripts/policy_census.sh live run (chain=189 live=189 live_only=0 chain_only=0, exit 0 — ZERO policy drift incl. the 0080 re-creation); parser pinned by src/tests/infrastructure/t-215-policy-census.test.ts 5/5 (real-chain shape incl. the 0079 DROP TABLE cascade + LAST-creator-wins, storage-schema exclusion, throwaway-dir drop/recreate/table-drop/comment probes); desktop suite 92/2422/0 baseline re-run green + typecheck clean.
- **Problems:** REG-004 class (unregistered live policy drift compounds silently) · **Priority:** P1
- **Dependencies:** none · **Affected:** hub scripts/ (new policy_census.sh)
- **Plan:** machine-check the live pg_policy set (policy names per table) against the local chain's cumulative CREATE/DROP POLICY statements; run at session openings; evidence in change-log. Small, high-value, recommended by the 31st-session next-task note.

### T-216 — Hub: MIG-TOKENS full consistency re-verification round (close) — **Completed (VERIFIED, 10/10 probe families GREEN)**
- **Evidence:** /home/z/my-project/scripts/t-216-live-verification.sh (probes-only, persisted outside the repos per the T-140 convention) + docs/recovery/t-216-live-verification.md: chain 77/77 = 0001–0080 ZERO DRIFT (incl. 0080), policy census 189/189 zero drift, auth health 200 × both key regimes (ADR-009), REST 200 × both, EF fleet 13/13 ACTIVE 1:1 with the hub source, ALLOWED_ORIGINS 4-origin canonical set all echoing + non-allowlisted NOT echoed (ACT-203 intact), anonymous EF → 401, 0080 policy live (n=1 with has_role).
- **Problems:** none new (verification; closes the owner's "apply the migration tokens + consistent everywhere" mandate with fresh evidence incl. 0080) · **Priority:** P1
- **Dependencies:** T-214 applied · **Affected:** hub evidence docs
- **Plan:** chain drift check 77/77 = 0001–0080, EF fleet matrix, dual-key health, ALLOWED_ORIGINS probe, anonymous-deny matrix; record in t-216-live-verification.md + change-log.

### T-217 — Desktop: T-047 port #6 — workforceAttendance → workforce_attendance_events — **Completed (TESTED)**
- **Evidence:** src/tests/infrastructure/supabase-workforce-attendance-repository.test.ts 12/12 (union verbatim + server-side punch instant, UUID/tenant validation, lat/lng mapping + ip drop, recorded_by, read mapping, cache filtering, SYNCHRONOUS latestFor incl. the just-punched reflection, persistence-across-restart, 3 source scans); full desktop suite 94 files / 2439 / 0 + typecheck clean + eslint 0 errors on the touched files. The dashboards trio (tasks / workforceAttendance / leaveRequests) is now FULLY Supabase-backed.
- **Problems:** ARCH-001 (T-047 Group-A remainder; the dashboards trio's open member) · **Priority:** P2
- **Dependencies:** none (table + RLS exist since 0010/0019) · **Affected:** hub (new SupabaseWorkforceAttendanceRepository, wiring, tests)
- **Plan:** port observeByPersonnel/observeByDate/latestFor/recordEvent over the canonical table (T-178/T-180 adapter pattern: SubjectBehavior cache + refresh-after-write); unit tests incl. persistence + source scans.

### T-218 — 32nd-session closeout: registry truth-sync + zip + push + handoff — **Completed (TESTED)**
- **Problems:** process (ADR-007) · **Priority:** P2
- **Dependencies:** T-209..T-217 · **Affected:** all three repos
- **Plan:** problem/task registry status flips with evidence, change-log entry, current-state delta, next-task session state, git commits per task (git-workflow template), zips, push with the owner's PAT.
- **Evidence:** change-log 32nd-session section (T-218 closeout entry — registries synced, all three repos pushed with the owner's PAT, 4 zips in download/); suites at close: website 40/544/0 + lint + strict build; desktop 94/2439/0 + typecheck + lint 0 err. The registry's own status line was left "In Progress" by the closeout commit — flipped Completed here (33rd session, T-222 truth-sync).

### T-219 — Desktop: 16:9 wide-form payment modal — no cut-off, footer always visible (UI-305) — **Completed (TESTED)**
- **Problems:** UI-305 · **Priority:** P1 · **Severity:** High (owner-reported)
- **Dependencies:** none · **Affected:** hub (shared modal design system + UnifiedPaymentModal)
- **What was wrong:** the owner reported the payment form "getting cut off and going outside the form boundaries". Root cause (two layers): (1) the UnifiedModal dialog variant rendered as `grid … flex-col` with only a `max-w-*` cap and NO height cap — grid rows size to content, so the body's `flex-1 overflow-y-auto` was INERT and tall forms grew the dialog past the viewport (the footer with Annuler/Encaisser became unreachable); (2) the payment form was a single long column (size lg = max-w-2xl = 672px), far too narrow for a two-pane collection workflow.
- **What was changed:** dialog shells are now real flex columns capped at `max-h-[88vh]` (the body scrolls, the footer is pinned — matching the drawer variant, which was already correct); NEW `2xl` wide-form tier (max-w-6xl ≈ 1152px; on a 1080p display the stage lands ≈ 1152×648 — an approximately 16:9 form); the UnifiedPaymentModal body restructured into a responsive `lg:grid-cols-12` two-column split (LEFT 7: parent/student identification, line-item summary, payment slider, waterfall allocation preview; RIGHT 5: category, method selector, structured check/wire fields, proof upload, DebtMeter, notes, status preview); the form footer leads with the payer + amount recap and keeps the actions right; the success stage polished into a two-column receipt summary (issuer, receipt, amount, method, category, date & time, collector, status).
- **Verified:** source-scan guards (t-219-t-220-t-221-source-guards.test.ts): size="2xl", max-w-6xl registered, `flex max-h-[88vh] w-full … flex-col` present, the old `grid w-full …` dialog layout forbidden, the 12-col split with col-span-7/5 present, size="lg" absent from the modal; full suite 100 files / 2513 / 0 + typecheck clean + eslint 0 errors (touched files).
- **Left / notes:** visual eyeballing in the running Electron app is host-gated (per AGENTS.md §11 desktop note); the geometric fix is structural (viewport-relative cap) and source-guarded. No other dialog consumers regressed — every dialog now benefits from the bounded body (see the full-suite pass).

### T-220 — Desktop: payments journal shows the ISSUER + exact date/time instead of a bare serial number — **Completed (TESTED)**
- **Problems:** UI-305 (companion surface) · **Priority:** P1 · **Severity:** High (owner-reported)
- **Dependencies:** T-219 (same surface family) · **Affected:** hub (financials-page PaymentsTab)
- **What was wrong:** the payments journal's first column showed only the receipt serial number (REC-…) and the date column showed only a fuzzy relative time ("il y a X jours") — no WHO issued the payment, no clock time, no collector attribution.
- **What was changed:** PaymentsTab rows are enriched with the resolved issuer identity (parent avatar + full name + family code + linked student via repos.parents/repos.students observables, memoized); NEW column set: Émetteur (Payeur) / Reçu + Encaissé par (collector attribution as a secondary line) / Date & Heure (exact dd/MM/yyyy HH:mm + relative secondary line) / Méthode (with check number or wire reference) / Catégorie / Montant / Statut; search spans parentName, studentName, parentCode, receiptNumber, method, category.
- **Verified:** source guards in the same test file (Émetteur (Payeur), parentDisplayName, Date & Heure + formatDateTime + formatRelative, "Par :" collector line, search fields incl. parentCode, parents/students observe wiring); full suite green.
- **Left / notes:** the enrichment resolves from the observable caches (no extra fetch); payments whose parent is missing render "Parent non répertorié" instead of an empty cell.

### T-221 — Desktop: FULL DAG automation system (DAG-100) — inspector + predicate builder + dry-run + templates + canvas UX + branch-aware executor — **Completed (TESTED)**
- **Problems:** DAG-100 · **Priority:** P1 · **Severity:** High (owner mandate "fully fully fully do the dag automations")
- **Dependencies:** none (kahn.ts + condition-evaluator.ts pre-existing) · **Affected:** hub (domain model, domain/calc/workflow, features/workflow, mock executor, tests)
- **What was wrong:** the DAG builder existed visually (canvas + palette + runs monitor, iteration 7) but was NOT a functional automation system: node `config` was always `{}` with NO editing UI (the condition evaluator existed but nothing could AUTHOR conditions); no dry-run/test mode; no templates; no zoom/pan/minimap/auto-layout; the mock executor walked the node ARRAY linearly with one global conditionFailed flag (parallel branches could not diverge); the palette lacked the school's high-value triggers/actions.
- **What was changed:** (1) domain model: 17 → 29 subtypes (+12: grade_below_threshold, payment_cleared_or_bounced, document_expiration, calendar_cron_event, stock_level_critical, time_window, route_switch, send_whatsapp, restrict_account, dispatch_task, generate_document, account_adjustment) with labels + descriptions + palette grouping; (2) NEW `domain/calc/workflow/dry-run.ts` — PURE topological simulator with branch semantics (failing condition closes only its branch; route_switch opens only the first passing route; convergence executes once; cycles rejected; missing fields → false + §10.05 warning; time_window guard vs the context instant) + generic topologicalOrder; (3) NEW `domain/calc/workflow/auto-layout.ts` — layered layout from the topological depth, 20px-grid-snapped (gaps are grid multiples — 110px would snap ragged); (4) NEW `domain/calc/workflow/templates.ts` — the 3 owner-specified one-click recipes (Relance échelonnée / Alerte assiduité / Clôture trimestrielle) with REAL condition trees, acyclic by construction, templateIsValid + collision-proof instantiateTemplate; (5) NEW `features/workflow/node-inspector-drawer.tsx` — per-subtype parameter forms + the visual predicate builder (Champ/Opérateur/Valeur rows × ET/OU/NON compiled into ConditionNode trees via the canonical parser) + switch-route editor mapped to outgoing edges + test-payload preview; (6) dag-canvas upgraded — zoom (buttons + Ctrl-wheel anchored), pan, minimap (viewport rect + click-to-jump + dry-run status opacity), snap-to-grid, "Réorganiser" auto-layout, "Tester" dry-run (green taken edges + animated pulse + per-node rings + skipped fade + warning banner), double-click / ⋯-menu → inspector; (7) the mock executor now runs THROUGH the dry-run engine (single source of truth) — run records list nodes in topological order with per-branch skip reasons; durations + 90% action-failure + daily cap + audit preserved; (8) node palette carries descriptions; the Nouveau workflow modal offers the template picker.
- **Verified:** 4 NEW domain test files (dry-run 9 tests: branch divergence, switch routing incl. no-match, convergence-once, cycle, missing-field warning, time_window vs fixed instants, kahn consistency; auto-layout 8: layer gaps, fan-out same-x, diamond convergence, identity/config preservation, grid snapping, cycle refusal; templates 11: the 3 recipes acyclic + edge-complete + ≥1 trigger + parseable conditions + dry-run green + meaningful branch decisions + instantiation disjointness; subtype-registry 7: label/description/mapping completeness + no strays/dups + T-221 expansion spot-check) + 1 executor test file (4 tests through the REAL repository: failing-condition skips only its branch while the parallel branch runs — the old executor could not do this; topological result order; run persistence) + 13 source-guard assertions. Full suite 100/2513/0 + typecheck + lint.
- **Left / unresolved:** (a) the Supabase EF `workflow-execute` still executes the SERVER-side engine — the dry-run semantics are pinned on the client/mock side only; porting branch-aware execution into the EF is the next backend task (registered as the follow-up in next-task.md); (b) action nodes are still simulated (mock 90% success) — real action executors (WhatsApp URL building, notifications insert, tasks insert, account restriction) need per-action implementation once the EF side is upgraded; (c) RESEND_API_KEY (send_email) and FIREBASE_SERVICE_ACCOUNT_JSON (push delivery) remain owner-gated residuals.

### T-222 — 33rd-session closeout: registry truth-sync + zip + push + handoff — **Completed (TESTED)**
- **Problems:** process (ADR-007) · **Priority:** P2
- **Dependencies:** T-219..T-221 · **Affected:** all three repos (hub only receives commits; website/android untouched this session)
- **Plan:** registry entries + counts (TESTED 81→95), problem-registry totals 199→201 (+UI-305, +DAG-100), change-log 33rd-session section, current-state snapshot, next-task 34th-session recommendation, 4 detailed commits on main, zips, push with the owner's PAT.
- **Evidence:** this change-log entry + the git log; suite evidence in T-219..T-221.

---

## 34th repair session (2026-09-07) — owner mandate: "Fully solve the DAG automation system — complete, production-ready automation pipeline from the visual builder through persistence and execution"

Opening ritual (live, sbp_ token): migration chain 77/77 = 0001–0080 ZERO DRIFT (live `supabase_migrations.schema_migrations` JSON-diffed against the local chain); EF fleet 13/13 ACTIVE incl. workflow-execute v21 (2026-09-02); live `workflows` = 0 rows, `workflow_runs` = 0 rows (the server path has NEVER produced a run); desktop baseline 100 files / 2513 tests / 0 failures. Opening audit findings (see DAG-100 residual + NEW discovery): the deployed workflow-execute EF selects non-existent columns (`definition`, `version` — the table has `dag_definition`, no version) → every call 404s; it inserts non-existent columns (workflow_version/triggered_by_profile_id/actor_note/request_id) → PGRST 204; its node dispatch uses flat legacy type strings while the desktop persists `{type, subtype}` nodes → every action/delay/transform node would throw "Unknown node type"; condition evaluation is stubbed (`_stub_*` config values); any action failure skips ALL remaining nodes (diverges from the T-221 branch semantics); `workflow_runs.trigger_type` CHECK (0012) lacks the T-221 trigger subtypes; no server-side publish validation (a cyclic workflow can be published via direct table write); no event-driven trigger path (run-overdue-scan never invokes workflows); wait_duration capped at 5s inline (not persistent/resumable); the EF never updates last_executed_at/total_executions; the Android workflow_runs DTO expects wrong column names. Session task set (10 tasks, DAG-only scope per the owner's instruction to ignore all other platform work):

### T-223 — Backend: migration 0081 — workflow_runs/workflows schema alignment + server-side DAG validation (publish gate) — **Completed (TESTED, live-verified 25/25)**
- **Problems:** DAG-100 (residual: server-side validation), NEW discovery (EF↔schema column drift) · **Priority:** P0 · **Severity:** Critical (the live execution path is dead)
- **Dependencies:** none · **Affected:** hub (supabase/migrations/0081, scripts)
- **Plan:** workflow_runs + actor_note/request_id/workflow_version/resumed_at; trigger_type CHECK extended with the T-221 trigger subtypes; workflows.version + publish-increment trigger; workflow_pending_resumes table (persistent delay/resume, unique pending per run+node); `validate_workflow_dag(jsonb, strict)` SQL function (duplicate node/edge ids, missing refs, self-edges, Kahn cycle detection with involved-node list, type/subtype whitelist mirroring the 29-subtype registry, trigger in-degree rule, strict-mode ≥1 trigger, condition-tree validation, wait_duration config) + BEFORE UPDATE publish-gate trigger on workflows (a cyclic/invalid DAG can never be published through ANY writer — the server-side requirement the client-side Kahn guard could not enforce); atomic live apply (MIG-TOKENS pattern); verify_t-223.sql regression script; desktop source-guard test pinning the SQL subtype whitelist == the TS registry.
- **Status:** In Progress

### T-224 — Backend: pure server execution engine (engine.ts) + desktop unit/equivalence tests — **Completed (TESTED)**
- **Problems:** DAG-100 (residual: branch-aware server engine) · **Priority:** P0
- **Dependencies:** T-223 · **Affected:** hub (supabase/functions/workflow-execute/engine.ts, src/tests)
- **Plan:** dependency-free pure TypeScript engine INSIDE the EF folder (no Deno imports → vitest-importable, tsc-strict-clean): definition parsing (string-or-jsonb, {nodes,edges} with source/target edges), full validation (TS mirror of the SQL rules), the condition evaluator ported VERBATIM from domain/calc/workflow/condition-evaluator.ts, branch-aware topological execution (per-branch closure, route_switch first-passing-route, convergence-once, §10.05 missing-field→false+warning, time_window vs context instant), injectable ActionHandler interface (the EF index wires real executors; tests wire fakes), deadline/timeout + max-node guards. Tests import the engine directly from src/tests (real unit tests of the server engine — not source guards) + an equivalence corpus vs the desktop dry-run engine (branch divergence, switch routing, convergence parity).
- **Status:** In Progress

### T-225 — Backend: rewrite workflow-execute EF on the engine + correct persistence + deploy — **Completed (TESTED, live-verified 33/33)**
- **Problems:** NEW discovery (EF dead against the real schema) · **Priority:** P0
- **Dependencies:** T-223, T-224 · **Affected:** hub (supabase/functions/workflow-execute/index.ts + live deploy)
- **Plan:** read dag_definition (correct column; string-or-object), version (new column); write the REAL workflow_runs columns (actor_id, actor_note, request_id, workflow_version); dispatch through the 29-subtype registry (unknown subtype → failed node with a diagnosable error, not a silent skip); per-branch failure semantics (a failed action closes only its downstream — parallel branches continue; final status failed if any node failed); run finalization updates workflows.last_executed_at + total_executions; execution deadline → status 'timeout'; daily cap preserved; deployed live (functions deploy).
- **Status:** In Progress

### T-226 — Backend: real action executors in the EF — **In Progress**
- **Problems:** DAG-100 (residual: simulated actions) · **Priority:** P0
- **Dependencies:** T-225 · **Affected:** hub (EF action layer)
- **Plan:** push_notification → REAL in-app notification (parent target via the canonical 0077 notify_parent_user RPC; staff target via role-assignment resolution + notifications insert with target_role) + FCM delivery via the canonical send-push-notification EF (honest per-recipient failures); dispatch_task → REAL tasks insert (title/description/priority/due_date/department/assignee resolution); restrict_account → REAL parents.is_financially_restricted update with audit entry; send_whatsapp → honest wa.me deep-link preparation (recorded as a prepared link, never a fake delivery claim); extract_field → real context dot-path extraction; send_email/log_audit stay real (T-126/T-131); apply_discount/create_invoice/generate_document/account_adjustment → honest `skipped` outputs naming the missing canonical RPC (NO fake success, NO silent stubs).
- **Status:** In Progress

### T-227 — Backend: real execution context builder (entity loading) — **In Progress**
- **Problems:** DAG-100 (residual: stubbed condition inputs) · **Priority:** P0
- **Dependencies:** T-225 · **Affected:** hub (EF context layer)
- **Plan:** build the ConditionContext from REAL data for the triggered entity (body parent_id/student_id/installment_id): parent financials via the canonical compute_parent_summary RPC (outstanding/overdue/flags), student status + absence counts from attendance_records (absent_unexcused), latest payment method/status, oldest-overdue days; merge node.config._context overrides (desktop parity); conditions then evaluate against real values (debt_over_threshold etc. no longer read _stub_*).
- **Status:** In Progress

### T-228 — Backend: persistent delay/resume (workflow_pending_resumes + scheduler EF) — **In Progress**
- **Problems:** DAG-100 (delay not persistent/resumable) · **Priority:** P1
- **Dependencies:** T-223 (table), T-225 (engine) · **Affected:** hub (EF workflow-execute + NEW workflow-resume-scheduler EF + config.toml)
- **Plan:** wait_duration > inline cap (10s) parks the run: status stays 'running', a workflow_pending_resumes row (run, node, resume_after, serialized engine state) is written, the EF returns the pause honestly; NEW workflow-resume-scheduler EF (CRON_SECRET/service-role auth, cron +10min) claims due rows (atomic UPDATE...WHERE status='pending' → 'claimed', the unique index blocks double-claims), re-enters the engine at the parked node, runs to completion or parks again; execution state survives process death (it is a row, not memory); inline waits ≤10s still supported for short delays.
- **Status:** In Progress

### T-229 — Backend: EF dry-run mode (safe test execution) — **In Progress**
- **Problems:** DAG-100 (no server-side test execution) · **Priority:** P1
- **Dependencies:** T-225, T-226, T-227 · **Affected:** hub (EF)
- **Plan:** body flag dry_run:true + optional entity ids → the engine runs with action handlers in SIMULATE mode (no notifications/emails/tasks/mutations — outputs record what WOULD happen), real entity context (T-227), conditions really evaluated, branch path + per-node outputs/errors returned; NO workflow_runs row (test runs never pollute the execution history); one write_audit_log entry (workflow.dry_run) keeps the test traceable; duplicate protection (daily cap does NOT consume on dry runs).
- **Status:** In Progress

### T-230 — Desktop: manual Execute button + server dry-run (Tester) + server validation surfacing — **In Progress**
- **Problems:** DAG-100 (UX wiring to the real server path) · **Priority:** P1
- **Dependencies:** T-225, T-229 · **Affected:** hub (features/workflow, domain repository contract, mock + supabase implementations)
- **Plan:** editor toolbar "Exécuter" (published workflows only) → repos.workflows.execute → the canonical EF path (completes the manual trigger path — previously retry-on-existing-run only); Tester gains a Serveur mode with an entity picker (parents observable) invoking a NEW dryRun repository method (mock: local dry-run engine; supabase: the EF dry_run call) with the server-predicted path rendered on the canvas; server-side validation errors (publish gate) surfaced through the existing error path (supabaseErrorToAppError userMessage); i18n keys.
- **Status:** In Progress

### T-231 — Android: workflow_runs DTO contract fix (real column names + node_results decode) — **In Progress**
- **Problems:** NEW cross-platform drift (Android DTO vs the real workflow_runs schema) · **Priority:** P1
- **Dependencies:** T-225 (the EF now writes the canonical shape) · **Affected:** elimtiyaz-android (SharedDtos, Room mapping, monitor display)
- **Plan:** WorkflowRunDto field names fixed to the REAL table (trigger_type/actor_id/completed_at/node_results/duration_ms/workflow_id/started_at/status/error_message); node_results decoded into the WorkflowNodeResult model (node_id/node_label/status/started_at/completed_at/output/error); unit tests decoding the exact JSON shape the EF writes; monitor surfaces real trigger labels. Gradle run attempted per the documented JDK/SDK recipe; if the container blocks it, the suite run is reported BLOCKED (honestly) while the code+tests land.
- **Status:** In Progress

### T-232 — Live end-to-end DAG verification matrix + closeout — **In Progress**
- **Problems:** DAG-100 (final closure evidence) · **Priority:** P0 (owner's core demand)
- **Dependencies:** T-223..T-231 · **Affected:** hub (docs, registries) + live backend
- **Plan:** full live matrix with a real staff JWT: create → save → publish (version=1) → cyclic publish REJECTED server-side → execute (branch semantics on real debt data: >threshold vs ≤threshold branches) → node_results/audit/duration verified → actions really fire (in-app notification row, task row, parent restriction + audit) → delay workflow parks + scheduler resumes → dry-run leaves workflow_runs untouched + audit entry → daily cap enforced (429 on the second run) → malformed definitions rejected → full evidence to docs/recovery/t-232-live-verification.md; problem-registry DAG-100 → VERIFIED (residuals honestly listed); change-log 34th-session section; next-task 35th-session recommendation; zips + push.
- **Status:** In Progress
