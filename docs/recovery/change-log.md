# Recovery Change Log

> Chronological record of significant recovery changes. This file — not chat transcripts, not DONE/TODO notes — is the history of what has been fixed and how it was verified. Append one entry per completed task, using the template below.

## Template

```
### YYYY-MM-DD — <Task ID> — <short title>
- **Problem IDs:** ...
- **What changed:** ...
- **Why:** ...
- **Affected components:** ...
- **Tests:** (names / commands)
- **Verification:** (command + result, or explicit gap)
- **Commit:** <hash>
- **Notes:** (preserved behaviour, deviations, follow-ups)
```

---

## Entries

### 2026-08-31 — T-026 — Align the overdue rule on Android (DRIFT-006, WEAK-007, BUSINESS-007)
- **Problem IDs:** DRIFT-006, WEAK-007 (Critical, user-facing), BUSINESS-007.
- **What changed:** `LedgerEngine.maxDaysOverdueFromLedger` re-derived per the canonical INV-4 rule: days-overdue is measured from the account's DUE DATE (via `buildOverdueDueDateMap`), counting only accounts with balance > 0 whose due date is past — NOT from the oldest charge's creation date (a charge created today for next year's tuition used to read as "~365 days overdue"). EVERY production `computeParentSummary` call site in `LocalRepositories2.kt` now builds and passes the due-date map — including the balance-only reads (the debt-dashboard `totalOutstanding` KPI loop and `sendReminder`) — so no future edit can silently reintroduce the empty-map default that kept "Créances en Retard" permanently 0 DZD (WEAK-007).
- **Why:** the overdue KPI and the days-overdue number were wrong in opposite directions (0 vs ~1-year) and both diverged from the desktop's canonical rule; the empty-map default made the wrongness invisible.
- **Affected components:** Android `LedgerEngine.kt`, `LocalRepositories2.kt`. No SQL, no API contracts, no desktop change (the desktop was already canonical).
- **Tests:** NEW `app/src/test/java/com/example/core/OverdueRuleT026Test.kt` 10/10 (due-date map builder, INV-4 classification, creation-vs-due-date distinction, flooring, settled-account exclusion, max-across-accounts, totalOverdue ≡ maxDaysOverdueFromLedger consistency, call-site map pins).
- **Verification:** Android `testDebugUnitTest` 275/275 (29 files, 0 failures / 0 errors / 0 skipped; +10 tests); full compile of main + test sources; `assembleDebug` green (29.8 MB).
- **Commit:** 3462a38 (android) + docs in the hub repo (this change).
- **Notes:** the source-scan pin caught 2 remaining bare call sites during this session's final run — the pin is the reason the rule cannot regress silently.

### 2026-08-31 — T-054 — Android hollow implementations made real (WEAK-006, WEAK-008)
- **Problem IDs:** WEAK-006 (Critical — the audit log lied that regeneration happened), WEAK-008.
- **What changed:** WEAK-006: `LocalInstallmentRepository.regenerateForCycle` now mirrors the desktop `SupabaseInstallmentRepository.regenerateForCycle` — non-paid tranches re-derived to the official schedule (Sept 15 / Dec 15 / Mar 15 via `officialTuitionDueDates(year)`, tranche from the label's first digit), custom-schedule flags reset, `academic_cycle` stamped, each patched row enqueued through `SyncSupport.enqueueOnly` (idempotent `upsert_installment_from_import` path), paid tranches preserved, audit row records the REAL rederived count; return contract matches the desktop (patched first, untouched after). WEAK-008: `WorkflowRunEntity` gains the `trigger` column — `MIGRATION_11_12` (v11→v12, `ALTER TABLE workflow_runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'`), registered in `DatabaseModule`; `WorkflowRunDto.toEntity()` keeps the server's real trigger; `toDomain()` maps it via `WorkflowTrigger.fromCode(trigger)` — the hardcoded "manual" (every run displayed "Manuel") is gone.
- **Why:** one method wrote an audit row and returned the data UNCHANGED (the audit trail claimed work that never happened); the other displayed a wrong label for every non-manual run in history.
- **Affected components:** Android `LocalRepositories.kt` (installments), `LocalEntities.kt` + `ElImtiyazDatabase.kt` (Room v12), `SharedDtoMappers.kt`, `LocalRepositories2.kt` (toDomain), `DatabaseModule.kt`. No SQL, no API contracts.
- **Tests:** NEW `app/src/test/java/com/example/infrastructure/local/HollowImplementationsT054Test.kt` 7/7 (DTO→entity trigger mapping, null→manual default, constructor default = migration default, enum wire-code resolution, source-scan pins for the toDomain mapping / migration DDL / regenerate contract incl. hollow-pattern-gone).
- **Verification:** Android `testDebugUnitTest` 275/275; compile clean; debug APK assembles.
- **Commit:** 3462a38 (android) + docs in the hub repo (this change).
- **Notes:** on-device Room 11→12 migration smoke test needs real hardware (recorded, not claimed); the default 'manual' deliberately preserves existing rows' historical meaning.

### 2026-08-31 — T-062 — Android dead-code removal (DEAD-007/008/009, DRIFT-007)
- **Problem IDs:** DEAD-007, DEAD-008, DEAD-009, DRIFT-007.
- **What changed:** `infrastructure/stub/StubRepositories.kt` (2-line comment-only stub) deleted; the 833-line design-system gallery showcase deleted (ElGalleryActivity + ElGalleryScreen + GallerySection + 5 tab files — unreachable from production and never in the manifest; deletion chosen over dev-only registration per the reachability rule); `AuditActions.kt` trimmed from 80+ constants to the 12 the app ACTUALLY writes (76 never-referenced constants removed after a per-constant reachability scan — the file now documents the declare-at-write-time rule and points at the desktop's full registry); `SupabaseModule` KDoc corrected (remote sync is ALREADY wired via `SyncSupport.enqueueOnly` + `SyncQueueDispatcher`'s canonical RPCs — the "swap @Binds" promise removed); bonus: unused private `SyncService.isSupabaseConfigured()` (a hyphen-only duplicate of the NetworkTimeouts gate) deleted. Net across this task: ~973 lines removed.
- **Why:** dead code that PROMISES behaviour (stub file, wrong KDoc) misleads every future contributor; unreachable showcases inflate the APK and the review surface.
- **Affected components:** Android core/di/infrastructure/ui files listed above. No SQL, no API contracts, no runtime behaviour change.
- **Tests:** NEW `app/src/test/java/com/example/core/DeadCodeT062Test.kt` 5/5 (StubRepositories absent, gallery directory absent, AuditActions contains only referenced constants + no removed family, SupabaseModule KDoc describes the real wiring).
- **Verification:** Android `testDebugUnitTest` 275/275; grep over main+test sources → zero references to any deleted symbol (only the T-062 absence pins); manifest has no gallery entry; `assembleDebug` green — APK size note: 29.8 MB debug (no pre-change baseline APK exists; debug is unshrunk so the line-count reduction dominates).
- **Commit:** 3462a38 (android) + docs in the hub repo (this change).
- **Notes:** none — all four problem entries closed.

### 2026-08-31 — T-063 — Android absence-alert threshold (ATT-103)
- **Problem IDs:** ATT-103.
- **What changed:** NEW `core/Terms.kt` — the Kotlin mirror of the desktop's `src/domain/calc/academics/terms.ts` (T1 Sep 1–Dec 15 / T2 Dec 16–Mar 15 / T3 Mar 16–Jun 30; Jan–Aug reads as the previous school year's T3 tail; label format byte-identical cross-platform). `alertAbsences` (in `LocalRepositories2.kt`) adopts the desktop rule: only students with ≥3 absences (absent_unexcused + absent_excused, LATE excluded) within the CURRENT TERM are flagged — previously Android alerted for EVERY student in the input (effective threshold 1). The notification body now carries the real count + term label, mirroring the desktop message.
- **Why:** effective threshold 1 produced alert fatigue for teachers and diverged from the desktop's rule; the term window prevents last-year's absences from triggering this-year's alerts.
- **Affected components:** Android `core/Terms.kt` (new), `LocalRepositories2.kt` (alertAbsences). No SQL, no API contracts.
- **Tests:** NEW `app/src/test/java/com/example/core/TermsT063Test.kt` 10/10 (term-window boundaries per month, year-boundary spans, Jan–Aug previous-year rule, label format, threshold boundary 2-vs-3, late exclusion, out-of-term exclusion, input-order preservation).
- **Verification:** Android `testDebugUnitTest` 275/275; production wiring scan-verified (currentTermWindow + absenceAlertThreshold are called from alertAbsences).
- **Commit:** 3462a38 (android) + docs in the hub repo (this change).
- **Notes:** the threshold constant (3) is shared semantics, not shared code — the desktop keeps its own; equivalence is pinned by the mirrored term windows + rule, tested on both sides.

### 2026-08-31 — T-064 — Android config-dialog security + complete placeholder detection (SEC-004, SEC-005)
- **Problem IDs:** SEC-004, SEC-005 (+ the residual placeholder-detection scope T-050 had left open).
- **What changed:** SEC-004: the `SupabaseConfigDialog` anon-key field is masked by default (`PasswordVisualTransformation` + show/hide `IconButton` — the JWT was rendered in plain text); the helper text no longer leaks the build toolchain ("Google AI Studio" → .env guidance only). SEC-005: `SupabaseClientProvider` no longer falls back to the PUBLIC `https://demo.supabase.co` + `demo-key` on ANY path (URL normalization AND the exception handler) — the inert fallback is `https://supabase.unconfigured.invalid` (RFC-2606 reserved TLD, can never resolve) + `inert-unconfigured-key`, so unconfigured builds make ZERO network calls to any real host. RESIDUAL SCOPE CLOSED: `NetworkTimeouts.isSupabaseConfigured`'s placeholder detection (hyphen-only, missed the `.env.example` values) extracted into the pure, unit-testable `looksLikePlaceholderConfig(url, key)` — catches `YOUR_PROJECT` (underscore), `your-anon-key-here` (suffix), hyphen/underscore variants, demo/inert literals, quoted values, blank and non-https pairs.
- **Why:** an unconfigured app pinged a live third-party endpoint on every cold start; a shoulder-surfer could read the anon key; a unit-test build with unedited `.env.example` values reported "configured".
- **Affected components:** Android `SupabaseConfigDialog.kt`, `SupabaseClientProvider.kt`, `NetworkTimeouts.kt`. No SQL, no API contracts.
- **Tests:** NEW `app/src/test/java/com/example/infrastructure/supabase/SupabaseConfigSecurityT064Test.kt` 9/9 (inert host is RFC-2606 reserved + no real-host reference, inert key is not a credential, demo endpoint gone incl. the exception path, dialog mask + toggle, no toolchain leak, .env guidance, env-example placeholder pair detected, real credentials pass, blank/non-https/demo/inert pairs unconfigured, quoted values unwrapped).
- **Verification:** Android `testDebugUnitTest` 275/275; compile clean; the T-050 OnlineDetector placeholder handling and this detection now agree on the YOUR_PROJECT variant (the T-050 "left" note is superseded).
- **Commit:** 3462a38 (android) + docs in the hub repo (this change).
- **Notes:** `NetworkTimeouts.looksLikePlaceholderConfig` is the single canonical pure function future checks should reuse.

### 2026-08-31 — T-036 (PUSH-103 portion) — Website FCM auto-registration after the first user gesture
- **Problem IDs:** PUSH-103 (the unblocked portion of T-036; PUSH-100/101/104 remain).
- **What changed:** NEW `autoRegisterFcmAfterFirstGesture(userProfileId)` in `fcm-registration.ts`: waits for the FIRST pointerdown/keydown after a profile is available, then — permission "granted" → register immediately (no prompt; covers returning users whose device_tokens row was deactivated on sign-out); "default" → `Notification.requestPermission()` called FROM the gesture handler (browser-legal) and registration only on grant; "denied" → never. ONE attempt per browser profile (localStorage `el-imtiyaz.fcm-autoreg` — dismissed prompts never nag; Chrome auto-blocks repeats anyway). Returns a teardown; the auth-provider re-wires it on profile change (`useEffect [user?.id]`). The Profile toggle remains the explicit re-enable path, unchanged.
- **Why:** the only registration path was a hidden manual toggle — most parents never enabled push, so the server had no token for them and no notification could ever be delivered; browsers forbid the permission prompt without a user gesture, so plain sign-in auto-registration is impossible.
- **Affected components:** website `fcm-registration.ts` + `auth-provider.tsx`. No backend change (the register RPC + transfer guard already exist — migrations 0027/0060).
- **Tests:** NEW `src/lib/hooks/t-036-fcm-auto-register.test.ts` 9/9 (decision map; granted → immediate register without prompt; default → prompt-from-gesture + register; dismissed/denied → no registration + no auto-retry; denied → never; one-shot; teardown; once-guard; auth-provider wiring source-scan).
- **Verification:** website suite 15 files / 144 tests ALL PASS (+9); strict build green (`npm run build` — compiled successfully); lint clean. Gap: live push delivery still needs the owner's FCM web config AND a real send-push-notification EF invocation path (PUSH-100 — still open, owner-scoped).
- **Commit:** (website repo, this change) + docs in the hub repo.
- **Notes:** the PUSH-103 fix deliberately preserves the manual toggle's semantics (the toggle reads `Notification.permission === "granted"` for its UI state — auto-registration only ADDS the missing path, it does not change the toggle's behaviour).

### 2026-08-31 — T-050 — OnlineDetector fail-closed + own-backend probe + pullAll dedup (WEAK-009, SEC-006, CACHE-101, WEAK-010)
- **Problem IDs:** WEAK-009 (Android always-online detector), SEC-006 (third-party probe leak + battery), CACHE-101 (desktop Google probe + broken captive-portal detection), WEAK-010 (pullAll ×6 call sites, 2×/tick).
- **What changed:** Android (commit 3bc5cdd): OnlineDetector fail-closed semantics end-to-end — offline initial state, combined `isOnline()`, catch→false, 200/401-only verdict, redirects not followed, no third-party fallback (unconfigured = zero probes), probe throttling (10s + in-flight guard), underscore-placeholder detection fixed; PullSyncRepository.pullAll in-flight + 10s dedup gate; SyncWorker + syncNow duplicate pulls removed; gradle.properties memory tuning committed. Desktop (this commit): probe = configured Supabase `/auth/v1/health` with apikey (cors, status readable), 200/401-only, fail-closed initial state, unconfigured = zero requests; `resolveProbeUrl`/`probeAccepts` exported and tested; the module contains no third-party host reference (source-scanned).
- **Why:** the detector's fail-open design let SyncWorker drain into dead networks (queue pollution + battery); the Google/supabase.com probes leaked metadata from a school financial app; six pull call sites double-pulled every cycle.
- **Affected components:** Android OnlineDetector/PullSyncRepository/SyncWorker/SyncService; desktop online-detector.ts + singleton wiring. No SQL, no API contracts.
- **Tests:** desktop t-050-online-detector.test.ts 13/13; Android OnlineDetectorT050Test 15/15.
- **Verification:** desktop 65 files / 2165 tests ALL PASS; typecheck clean; lint 0 errors. Android testDebugUnitTest 234/234 (was 219). Live endpoint behaviour verified by curl (200 with apikey / 401 without / CORS allow-all). Gaps (recorded, not claimed): airplane-mode + captive-portal behaviour needs real hardware; `testReleaseUnitTest` fails on GreetingScreenshotTest — PROVEN pre-existing via pristine-tree re-run (log: /home/z/my-project/.t050-pristine.log) → registered as ARCH-012.
- **Commit:** 3bc5cdd (android); this commit (hub — desktop half + docs).
- **Notes:** the SEC-005/T-064 placeholder-underscore weakness was fixed HERE for the detector's URL resolution (verified by tests); NetworkTimeouts.isSupabaseConfigured still has the hyphen-only check — remains T-064's scope. Desktop `start()` no-ops the interval when unconfigured; the first configured-mode drain waits for the first probe (fail-closed by design — the 30s poll catches up).

### 2026-08-31 — T-058 — Append-only migration discipline guard (REG-001)
- **Problem IDs:** REG-001 (process enforcement; the historical fix-up chain itself is the audit record).
- **What changed:** the discipline is MACHINE-ENFORCED now. NEW `elimtiyaz-desktop/scripts/check-migrations-append-only.sh`: (1) rejects any modification/deletion/rename of an existing migration in working tree AND index; (2) rejects any non-addition in `git diff --name-status <base> -- supabase/migrations/` (base defaults to the upstream/origin/main — the PR check the task prescribes; falls back to HEAD); (3) enforces the `--` header + `NNNN_name.sql` naming on every migration file; handles the git-prunes-empty-dirs edge after `git rm`. Wired in three ways: `npm run check:migrations`; `npm test` via NEW `src/tests/infrastructure/t-058-migration-append-only.test.ts` (real-chain check + planted violations in throwaway repos — parallel-safe); NEW `scripts/t-058-guard-matrix.sh` (9-case matrix). `docs/agents/git-workflow.md` gains §7 "Review checklist"; recovery-rule 14 points at the guard. ALSO FIXED: 3 pre-existing TS2339 errors in `t-041-promotion-flow.test.ts` (un-narrowed `.value` — the T-041 commit's "typecheck clean" claim was wrong; `unwrap()` helper added).
- **Why:** editing an applied migration silently desyncs the live DB from the committed chain (ARCH-011) and is how the REG-001 fix-up spiral (0034–0043) happened; a rule that is only prose gets violated under context pressure — this session's own T-041/T-030 docs debt proves it.
- **Affected components:** desktop scripts + test pipeline (package.json), governance docs. No product code, no SQL.
- **Tests:** guard matrix 9/9; vitest t-058 6/6.
- **Verification:** `npm run check:migrations` OK (57 files, +2 vs origin/main); `npx tsc --noEmit` clean (incl. 3 T-041 fixes); full suite 64 files / 2152 passed / 5 skipped / 0 failures; lint 0 errors / 369 warnings (baseline unchanged). No GitHub Actions CI exists in the repo (documented; the guard is a one-liner to add when the owner wants CI).
- **Commit:** (this commit) — hub repo.
- **Notes:** the guard deliberately treats NEW files (staged-A/`??`) as legal — append-only means additions are always fine; untracked new migrations are still header/naming-checked. The baseline check vs origin/main only works when the remote ref exists locally (fresh clone, post-fetch, or post-push); otherwise HEAD keeps at least the working-tree guard active.

### 2026-08-31 — T-030 — FCM token lifecycle: transfer guard + single-token unregister (PUSH-102, SYNC-104, SYNC-105)
- **Problem IDs:** PUSH-102 (shared-device token hijack), SYNC-104 (no unregister RPC / stale rotated tokens), SYNC-105 (website global signOut + orphaned token).
- **What changed:** NEW migration `0060_fcm_token_transfer_guard.sql` (live, registered): `register_fcm_token` conflict semantics — same-user conflict reactivates; conflict with another user's ACTIVE row RAISES 42501 (hijack dead); conflict with another user's INACTIVE row transfers explicitly with a `device_token.transfer` audit entry; registrations audit `device_token.register`. NEW `unregister_fcm_token(p_token)` RPC — retires ONE row by token string, caller-verified (owner or service_role), idempotent, audited. Website (`elimtiyaz-website`): last-known token persisted (localStorage `el-imtiyaz.fcm-token`); `unregisterFcmToken` calls the canonical RPC; `subscribeToFcmTokenRefresh` re-registers AND retires the stale token on rotation; typed in `database.ts`.
- **Why:** the 0027 upsert assumed a single-owner device model; the 0050 caller verification never revisited the conflict branch; no inverse RPC ever existed, so rotated tokens stayed permanently active.
- **Affected components:** backend `device_tokens` lifecycle (migration 0060), website `fcm-registration.ts` + typed schema, Android covered server-side (no change needed).
- **Tests:** website NEW `src/lib/hooks/t-030-fcm-token-lifecycle.test.ts` 5/5.
- **Verification:** website suite 14 files / 135 tests ALL PASS; strict build green; lint clean. LIVE: 0060 applied atomically WITH registration; `scripts/verify_t-030.sql` 9/9 PASS (SEC-106 intact; ACTIVE-conflict rejected 42501; INACTIVE-conflict transfer allowed + audited; same-user reactivation audited; unregister retires own row; idempotent NULL; 2+ audit rows). Gap: live browser FCM round-trip blocked on the owner's FCM web config.
- **Commit:** e3b5fff (hub — backend), 99f6ef0 (website — client half).
- **Notes:** `deactivate_fcm_tokens` (0050) unchanged — still the sign-out path. PUSH-100/PUSH-104 remain with T-036. Registry note claiming the overwrite was "blocked" was INACCURATE — corrected (verified live).

### 2026-08-31 — T-041 — Canonical atomic year-end promotion flow (ACAD-100, ACAD-101, BUSINESS-004)
- **Problem IDs:** ACAD-100 (dead `promote_students` RPC writing the legacy table + non-existent column), ACAD-101 (non-atomic two-step `setCurrentYear`), BUSINESS-004 (`promote()` "not implemented" in production).
- **What changed:** NEW migration `0059_canonical_promotion_flow.sql` (live, registered): dead `promote_students` RPC DROPPED; `set_current_academic_year` — ONE UPDATE flips the whole tenant's `is_current` + audit entry; `execute_batch_promotion` — atomic batch executor (history upsert + grade advance + graduation + one audit entry in a single transaction, caller-verified per the 0055 SEC-111 pattern, runs under caller RLS). Desktop: `setCurrentYear`/`createAcademicYear` → the atomic RPC (insert `is_current=false`, then flip — failure leaves the previous year intact); `executeBatchPromotion` → ONE RPC call with the canonical TS-engine decisions array (direct table writes removed); `SupabaseStudentRepository.promote()` implemented on the same RPC path.
- **Why:** the canonical 0029 history table arrived after the 0022 RPC; the repository was rewritten but the dead RPC was never dropped and no atomic server-side executor was ever built.
- **Affected components:** backend (migration 0059), desktop academic/student/promotion repositories. Website: none (read-side unaffected).
- **Tests:** NEW `src/tests/infrastructure/t-041-promotion-flow.test.ts` 8/8; `supabase-repositories.test.ts` promotion tests updated to the RPC contract.
- **Verification:** desktop full suite 64 files / 2146 passed / 5 skipped / 0 failures; `npx tsc --noEmit` clean; lint 0 errors. LIVE: 0059 applied atomically WITH registration (`scripts/apply_0059_live.sh`); `scripts/verify_t-041.sql` 10/10 PASS. Gap: UI E2E needs a desktop host.
- **Commit:** 049c418 (hub).
- **Notes:** decision computation stays client-side (canonical TS engine — no SQL duplicate of the progression map); `repeated`/`transferred` decisions archive history only; legacy `academic_history` TABLE kept (separate reachability decision); mock promote divergence noted; Android propagation remains T-024.

### 2026-08-31 — T-018 — Deterministic identity codes (DRIFT-001 → PARTIAL; desktop + sync)
- **Problem IDs:** DRIFT-001 (PARTIAL — desktop + sync layer).
- **What changed:** the canonical generators moved to core/format/id.ts (ADR-003 home, re-exported); empty-identity fallback seeded + stable (never random); the sync push handler's random PAR-/ELV- fallbacks replaced with the seeded canonical generators.
- **Why:** a random retry suffix created DUPLICATE parents/students server-side (the dedup match IS the code); the generators lived in the infrastructure layer instead of the canonical core.
- **Affected components:** desktop core/format/id.ts, supabase-shared-repositories (re-export), default-push-handler.
- **Tests:** t-018-identity-codes.test.ts 7/7; full suite 63 files / 2143 tests ALL PASS.
- **Left:** backend generators (approve EF, batch_register_family RPC) + Android paths.
- **Commit:** (this commit).

---

### 2026-08-31 — T-055 — Audit robustness + PII masking (SEC-001, SEC-002)
- **Problem IDs:** SEC-001 (TESTED), SEC-002 (TESTED).
- **What changed:** hasMaskedContent guards on both network LLM transports (empty mask → Err, raw prompt never leaves the machine); writeAuditLog retry + typed AuditWriteError throw + withAuditSurfacing (structured 500 audit_write_failed) on all 8 EFs; run-overdue-scan counts audit_failures.
- **Why:** audit failures were silently swallowed (canonical §7.6 violated invisibly); an empty PII mask silently leaked raw prompts to Groq/OpenRouter.
- **Affected components:** desktop llm-adapter; EF _shared/supabase.ts + 8 EFs (all redeployed live).
- **Tests:** t-055-audit-pii.test.ts 9/9; full suite 62 files / 2136 tests ALL PASS.
- **Verification:** esbuild bundles green; live redeploy of all 8 EFs; post-deploy sanity on run-overdue-scan (401 deny + 200 valid with audit_failures present).
- **Commit:** (this commit).

---

### 2026-08-31 — T-057 — Website canonical port honesty (DRIFT-009/DEAD-011)
- **Problem IDs:** DRIFT-009 (TESTED; absorbs DEAD-011).
- **What changed:** the canonical port pruned to the consumed surface (15 files deleted, 11 kept); model re-export blocks trimmed; headers rewritten honestly (source + sha + never-re-add note; the promised-but-nonexistent port-canonical.mjs reference removed).
- **Why:** ~20 dead functions in a read-only portal = drift surface; headers instructed maintainers to run a script that never existed.
- **Affected components:** website src/lib/canonical only.
- **Tests:** t-057-port-honesty.test.ts 4/4; site suite 13 files / 130 tests; strict build green; lint clean.
- **Commits:** d7eb52e (website) + this doc commit (hub).

---

### 2026-08-31 — T-052 — Notification badge correctness (NOTIF-102/103)
- **Problem IDs:** NOTIF-102 (TESTED), NOTIF-103 (TESTED).
- **What changed:** desktop — badge counts ALL unread (count before the 8-item display slice); website — useUnreadNotificationCount COUNT-only hook, top bar uses it, dead 1-row queries removed from bottom-nav ×2.
- **Why:** the badge lied in both directions (desktop capped at 8, website at 50) and the website fired 3 concurrent notification queries with one dead.
- **Affected components:** desktop topbar; website portal-queries + top-app-bar + bottom-nav.
- **Tests:** website t-052-notification-badge.test.ts 3/3 (both platforms covered via source guards); website 126/126; desktop 2127 green.
- **Verification:** desktop tsc + suite; website strict build + lint + suite.
- **Commits:** (this session) — hub + website repos.

---

### 2026-08-31 — T-095 — run-overdue-scan EF batched rewrite (BUG-NEW-004 → VERIFIED)
- **Problem IDs:** BUG-NEW-004 (VERIFIED — live).
- **What changed:** the EF's N+1 scan body replaced with the batched pattern of the T-094-verified desktop reference (1 overdue query + 1 upcoming-due query + chunked parents/dedup + 1 bulk INSERT per tenant); compute_parent_summary account gate dropped (installment-level classification ≡ desktop); redeployed live v14.
- **Why:** 258+ sequential round trips exceeded the edge worker budget — the daily cron and the manual scan were dead in production.
- **Affected components:** supabase/functions/run-overdue-scan (EF only; no migration, no client change).
- **Tests:** esbuild bundle check; live curl matrix + idempotency (see t-095-live-verification.md); desktop suite 2127 unaffected.
- **Verification:** LIVE — 401×3 deny matrix; valid CRON_SECRET → 200 in 8.6–10.9s (was WORKER_RESOURCE_LIMIT); 819 overdue / 68.13M DZD / 819 urgent; 3 runs → zero duplicate alerts (819 before and after).
- **Commit:** (this commit).
- **Notes:** CRON_SECRET rotated for the verification (hash-verified; no pg_cron consumer — safe). Micro-divergence registered: EF excludes cancelled installments, desktop filters status≠paid only.

---

### 2026-08-31 — T-040 — Staff-side justification review workflow (ATT-101)
- **Problem IDs:** ATT-101 (TESTED).
- **What changed:** desktop justification read/write end-to-end (domain fields, mapAttendanceRow, observeJustifications + reviewJustification on Supabase + Mock, Justificatifs review tab in the Academics hub with Accept/Reject).
- **Why:** the 4-state workflow was a one-way valve — parents submitted, staff could never review, accepted/rejected unreachable.
- **Affected components:** desktop domain model + academic repositories (supabase + mock) + academics UI.
- **Tests:** t-040-justification-review.test.ts 8/8.
- **Verification:** tsc clean; full suite 61 files / 2127 tests ALL PASS; lint 0 errors. Gap: live portal round-trip (empty attendance tables).
- **Commit:** (this commit).

---

### 2026-08-31 — T-022 — Desktop sync queue correctness (SYNC-100/101/102, CACHE-102)
- **Problem IDs:** SYNC-100 (TESTED), SYNC-101 (TESTED), SYNC-102 (TESTED), CACHE-102 (TESTED).
- **What changed:** defaultPushHandler extracted to its own module + 4 new canonical entity cases (installment/attendance/grade RPCs, homework table upsert per Android parity) + loud-fail default; sync_queue audit upsert ignoreDuplicates; sign-out clears the queue + drain actor guard; fallback state surfaced (store + snapshot + indicator warning).
- **Why:** 11 of 15 entity kinds were silent no-ops marked "synced" (data loss); the audit trail was clobbered each drain; the queue leaked across users on shared desktops; the in-memory fallback lied to the user.
- **Affected components:** desktop sync layer (handler module, service, store, indicator, auth-provider).
- **Tests:** t-022-sync-queue-correctness.test.ts 12/12 (behavioral via the doMock seam + source-scan guards + behavioral fallback detection).
- **Verification:** tsc clean; full suite 60 files / 2119 tests ALL PASS; lint 0 errors. Gap: live two-instance sync.
- **Commit:** (this commit).

---

### 2026-08-31 — T-053 — Desktop global-admin support (TENANT-103)
- **Problem IDs:** TENANT-103 (TESTED).
- **What changed:** getTenantId() string|null (no demo fallback) + requireTenantId() on write paths; Session gains working tenantId (nullable) + homeTenantId; auth repo stores honest null; TenantSwitcher in the Topbar + auth.switchTenant (persist + reload); homework-push upload guard.
- **Why:** global admins got the demo tenant silently + RLS denials — the desktop was unusable for them; pre-login code also targeted the demo tenant.
- **Affected components:** desktop session model, auth provider, supabase repositories (write guards), topbar/switcher, homework modal.
- **Tests:** t-053-global-admin-tenant.test.ts 9/9; 7 existing suites updated to set an explicit session (new contract).
- **Verification:** tsc clean; full suite 59 files / 2107 tests ALL PASS; lint 0 errors. Gap: live global-admin E2E (no such account exists).
- **Commit:** (this commit).

---

### 2026-08-31 — T-015 — Server-authoritative receipt numbers (migration 0058) — desktop + backend
- **Problem IDs:** DRIFT-011 → PARTIAL (desktop paths fixed; Android paths toolchain-gated/ADR-005).
- **What changed:** migration 0058 — `next_receipt_number` (0040 algorithm verbatim), `generate_receipt_numbers` batch allocator (advisory-xact-lock, SEC-111-pattern caller verification), `upsert_payment_from_import` NULL-number server-side generation (0055 body verbatim + marked block). Desktop: bulkCollect allocates via ONE RPC call (random PAY-{ts} gone); sync push passes NULL; generateReceipt placeholder honest. Applied LIVE + registered atomically (ARCH-011 discipline).
- **Why:** ADR-004 makes receipt numbers sequential + server-authoritative; three client-side random/per-device generators broke the invariant and were collision-prone.
- **Affected components:** backend (0058), desktop bulkCollect/sync-provider/generateReceipt. Android generators deliberately untouched (T-059/ADR-005).
- **Tests:** `t-015-receipt-server-numbers.test.ts` 7/7 (allocation call/count/assignment, no-alloc path, fail-fast ×2, 3 source-scan guards); full suite 58 files / 2098 ALL PASS.
- **Verification:** LIVE `scripts/verify_t-015.sql` 7/7 (registration; canonical format REC-2026-000001; contiguous batch; cross-tenant REJECTED; NULL→canonical+inserted; explicit-number dedup; trigger syncs receipt_number). Gap: live desktop-UI import E2E needs a host.
- **Commit:** (this commit).
- **Notes:** DISCOVERY — the unique constraint is on (tenant_id, payment_number); receipt_number has NO unique constraint (BUSINESS-006's registry claim corrected). The allocation-vs-insertion race window fails LOUD via the unique index (documented in the migration header). The mock's sequential REC- generator preserved (demo mirror, not one of the five DRIFT-011 paths).

---

### 2026-08-31 — ELEVENTH REPAIR SESSION — T-011, T-012, T-013, T-014, T-023, T-025, T-068 (VERIFIED), T-033, T-048, T-060 — 10-task owner-requested batch
- **Problem IDs:** BUSINESS-002 (TESTED), BUSINESS-100 (TESTED), BUSINESS-101/104 (TESTED), DEAD-015 + BUSINESS-003 (TESTED), HOMEWORK-100 + ATT-100 (TESTED + live 7/7), DEAD-100 + TENANT-105/106 (TESTED + live 6/6, migration 0057), SEC-109 (VERIFIED — live deploy + probes), CACHE-100 (TESTED), CROSS-001/003 (TESTED), BUSINESS-005 + WEAK-005 (TESTED); NEW discovery BUG-NEW-004 (→ T-095, registered by session 12's closeout).
- **Registry closeout note:** the 11th session's code + live work all landed and was PUSHED, but its session ended before the registry/change-log sweep; the 12th session performed that closeout (this entry + registry flips + full-suite re-run evidence below), per the session-11 close-out commit's own `Left:` note.
- **T-011 What changed (hub 3da7228):** `collect()` silent fallback to `upsert_payment_from_import` REMOVED — RPC failure now surfaces `Err` with the financial state untouched; the fallback-only client-side `PAY-` number generator deleted (receipt from the RPC, ADR-004). Tests: `t-011-payment-atomicity.test.ts` 2/2. Preserved: success path byte-for-byte.
- **T-012 What changed (hub 429a132):** `bulkCollect` fails fast (Err on FIRST chunk error, naming the row range); `RepositoryStorageAdapter.flushPendingBatches` honors the Err → import transaction cancelled (restores the no-partial-application contract). Tests: `t-012-bulkcollect-failfast.test.ts` 4/4.
- **T-013 What changed (hub 6a25a40):** the 60-line `markClearedFallback()` DELETED (no audit, actor discarded, per-installment swallow → cascading over-allocation); `markCleared()` = canonical `mark_payment_cleared` RPC only. Tests: `t-013-markcleared-atomic.test.ts` 2/2.
- **T-014 What changed (hub 766db94):** refund flow implemented end-to-end — `refund(id, reason, actorId, actorName?)` contract (reason ≥3 chars), REAL actor+reason propagate to `revert_payment_allocation`, mock mirrors with the canonical double-refund guard (0041:493-495), `PaymentDetailDrawer` "Rembourser ce paiement" (Permission.RefundPayment-gated destructive ConfirmModal) wired to the session identity. Tests: `t-014-refund-flow.test.tsx` 10/10 + full-payment-flow 18/18.
- **T-023 What changed (hub 7883030):** homework push carries tenant_id + the non-existent push-homework-notification EF invocation removed (deferred to T-036); roll-call payload carries tenant_id + BOTH date & record_date with onConflict → canonical `uq_attendance_canonical`. Tests: `t-023-academic-persistence.test.ts` 4/4 + LIVE `verify_t-023.sql` 7/7 (old payloads reproduce the NOT NULL violations; duplicate → unique_violation).
- **T-025 What changed (hub 1731755):** migration **0057_canonical_tenant_resolver.sql** (idempotent, applied LIVE + registered in the same atomic transaction): drops the 6 inert rls_*_tenant policies (working role-gated policies preserved — no RLS weakening); `student_academic_histories_staff` policy replaces the dead one (staff can finally write histories — T-041 unblocked); `set_assessments_tenant()` orphan fallback → RAISE; `fn_current_tenant_id()` dropped. Tests: LIVE `verify_t-025.sql` 6/6 (JWT-emulation: own-tenant SELECT/INSERT ok; cross-tenant rejected; orphan rejected; resolver fully gone).
- **T-068 What changed (hub 003d301):** `createUserScopedClient(jwt)` in `_shared/supabase.ts` — EF permission resolution now runs through the caller's JWT (anon key + Authorization header → PostgREST derives auth.uid()), exercising the same canonical resolver + RLS as the desktop; resolver errors fail CLOSED. workflow-execute + run-overdue-scan redeployed live. Verification (VERIFIED): curl matrix (no-auth/invalid/anon → 401); positive probe — support_staff + execute_workflow tenant_role_override called workflow-execute → 404 workflow_not_found (requirePermission PASSED; pre-fix every non-super_admin got 403); negative control without the override → 403; probe residue fully cleaned. NEW: BUG-NEW-004 — run-overdue-scan then hit WORKER_RESOURCE_LIMIT (the EF's own N+1 sizing problem, NOT a T-068 regression) → T-095.
- **T-033 What changed (website ef205a3):** `queryClientDefaultOptions` exported (single source the QueryClient mounts) with refetchOnWindowFocus:true + 5-min refetchInterval; staleTime 30s / retry:1 preserved — realtime failure degrades to stale-BOUNDED data. Tests: `t-033-freshness-fallback.test.tsx` 3/3; site suite 122/122 (119+3).
- **T-048 What changed (website 4faf007, android 1bd0d9d, hub 707ef1e):** migration chain unified — the website's 4 drifted portal-patch migrations and the Android repo's 6 stale migration copies REMOVED; hub AGENTS.md records the desktop chain 0001–0057 as the ONLY chain (ADR-001). The 2 drifted website EFs deliberately remain (UNKNOWN-001/T-028 + T-036).
- **T-060 What changed (hub 68c7d30):** UnifiedPaymentModal preview ≡ actual collection for EVERY category (exact `i.category === category` at all 3 filter sites, mirroring the SQL `p_category IS NULL OR category = p_category` semantics); batch-registration captures previousGradeLevel + previousRank so passage_palier (−10,000) and highest_average (−10%) actually fire; mock billing index-aligned with the preview. Tests: `t-060-payment-ux.test.ts` 7/7.
- **Session verification (re-run by session 12 for the closeout):** desktop — `npm run typecheck` clean, `npm test` **57 files / 2091 tests (2086 passed + 5 skipped, 0 failed)**, `npm run lint` 0 errors / 357 baseline warnings; website — `npm run test` **122/122**, `npm run lint` clean; live chain — session-12 opening diff confirms 0001–0057 applied one-to-one with ZERO drift (verify_s12_chain_consistency.sql 12/12). Android: not re-runnable in this container (SDK un-downloadable — dl.google.com 404s, sessions 9–11 evidence); session-11's Android change (T-048's file removal) is doc/file-only.
- **Commits:** 3da7228, 429a132, 6a25a40, 766db94, 7883030, 1731755, 003d301, 707ef1e, 68c7d30, 4b0dc6d (hub) · ef205a3, 4faf007 (website) · 1bd0d9d (android). All pushed.
- **Notes (left for session 12):** registry/change-log sweep (done — this entry); BUG-NEW-004 registration (done); T-041 now unblocked end-to-end; T-015 unblocked (T-011 done); T-053 unblocked (T-005 VERIFIED via 0053).

---

### 2026-08-29 — SIXTH REPAIR SESSION — T-002 (Android auth bypasses) + CROSS-100 closure
- **Problem IDs:** SEC-101 (TESTED), SEC-102 (TESTED), WEAK-101 (TESTED), CROSS-100 (TESTED — both halves now closed), WEAK-023 (TESTED), DRIFT-010 (TESTED); NEW discovery ARCH-008 (→ T-082).
- **Health check of the fifth session first:** all three repos clean at HEAD and up to date; the Android toolchain bootstrapped in the fifth session (/home/z/my-project/tools: JDK 17 + Android SDK 35 + `android-env.sh` + `local.properties`) PERSISTS in this environment, so the fifth session's 207/207 baseline gate is runnable — T-081's work is confirmed valid. Website strict-build state intact.
- **T-002 What changed (android commit 1aa34a7):** (1) `signIn` FAIL-CLOSED — configured build + failed/empty sign-in returns `Result.Err` (LoginViewModel already renders it); no session minted from a failure, ever. The demo fallback survives ONLY behind `AuthEnvironment.isDemoFallbackAllowed()` = unconfigured AND debug build; unconfigured release fails closed with a config-pointer message. (2) ALL email-substring role inference DELETED (signIn Stage 1, Stage 2, refreshSession's direct SUPER_ADMIN fallback); roles resolve exclusively from `role_assignments` via the canonical `current_user_roles()` RPC (migration 0003) through the pure `resolveRoleFromAssignments()` — first recognisable code wins, empty/unrecognisable → least-privilege SUPPORT_STAFF (mirrors the desktop reference client's SupportStaff fallback). (3) `signIn`/`refreshSession` restore the SDK's REAL `UserSession` (`currentSessionOrNull()`); `Session.accessToken` = the real JWT (WEAK-101), `refreshToken`/`expiresAt` (epoch-ms via `toEpochMilliseconds()`) from the SDK session; the pure `buildServerSession()` assembles the session and never expands unknown roles to all-permissions (empty-set fallback). The debug demo sandbox role is the FIXED `DEMO_SANDBOX_ROLE` — its token is not a JWT and authenticates nowhere. (4) CROSS-100 Android half (android commit 89eec61): the login screen's 9 demo-account chips + `fillDemoAccount()` removed — roles no longer derive from emails, the shared "demo1234" password never worked against a configured server, and the debug sandbox signs in with ANY typed credentials, so the chips were misleading UI.
- **T-002 Why:** SEC-101/102 were the two most dangerous client defects in the system (any failed Android login = 24h SUPER_ADMIN session; roles inferred from email substrings defaulting to SUPER_ADMIN even on success) — the registry's recommended next task, unblocked by the fifth session's toolchain work.
- **Affected components:** Android only — `LocalRepositories.kt` (LocalAuthRepository signIn/signInInternal/demoSandboxSignIn/refreshSession + the pure helpers `resolveRoleFromAssignments`/`buildServerSession`/`AuthEnvironment`/`DEMO_SANDBOX_ROLE`), `LoginScreen.kt` + `LoginViewModel.kt` (demo chips). NO backend, desktop or website changes; no migration; RepositoryModule untouched (ARCH-003/ADR-005 out of scope); profile-identity fallbacks and tenant fallback UUID untouched (T-051 scope); changePassword/signOut untouched (already fail-closed from earlier sessions).
- **Tests:** NEW `LocalAuthRepositoryTest` — 12 tests: fail-closed on configured-build failure (drives the REAL provider under Robolectric; every possible outcome — wrong password, unreachable server, no session — lands Err with no session); unconfigured RELEASE fails closed; debug sandbox FIXED role with NO email inference ("finance.admin@"/"teacher@" no longer yield FINANCIAL_OFFICER/TEACHER); role-resolution matrix (empty → support_staff; first-valid wins; legacy aliases via Role.fromCode; unrecognisable never escalates); buildServerSession real-JWT/refresh/expiry passthrough verbatim; no-assignments → support_staff defaults only (no MANAGE_SETTINGS/MANAGE_TENANTS/MANAGE_PERSONNEL); unknown role ≠ all-permissions; AuthEnvironment policy matrix; source-level guard against re-introducing email-substring inference (T-001 technique — scans LocalRepositories.kt for `contains("…")` role patterns and a `?: Role.SUPER_ADMIN` fallback).
- **Verification:** `./gradlew :app:testDebugUnitTest` BUILD SUCCESSFUL — **219/219** (207 baseline + 12 new); `./gradlew :app:compileDebugKotlin` and `./gradlew :app:assembleDebug` green. GAPS (why TESTED, not VERIFIED): live sign-in matrix — real wrong-password 401 round-trip, real role_assignments-backed session, server-side JWT validation — needs a live Supabase project (same recorded-gap pattern as T-004/T-079).
- **Commits:** 1aa34a7 (auth rework + tests) · 89eec61 (CROSS-100 demo chips) — android repo; docs commit (this entry + registries + next-task + current-state) — hub repo.
- **Notes (preserved/deviations):** supabase-kt 3.1.1 API verified from the pinned artifact's bytecode before use (`currentSessionOrNull(): UserSession?`, `UserSession.user` NULLABLE → refreshSession fails closed Ok(null) on a stored session without a user — compile-checked). The T-019 discovery (`.env.example` placeholders PASS isSupabaseConfigured) noted: tests therefore drive `signInInternal` with explicit `AuthEnvironment` values instead of `fromBuildConfig()`, keeping them deterministic regardless of `.env` state. Demo-sandbox retention (debug+unconfigured only) is the problem entry's own sanctioned option ("restrict to debug builds with unconfigured Supabase only") — not a scope invention. Deviation from CROSS-100's registry note: the note anticipated closure by removing the demo LIST (done) — the sandbox itself remains, as SEC-101's entry explicitly allows.
- **T-065 What changed (website commit 5654074):** two source comments that contradicted their code, both fixed with zero runtime change. (1) WEAK-023 — `useUnreadChatCount`'s "latest 200 messages per channel" claim corrected to the true semantics (latest 500 rows TOTAL via RLS-exposed channels; the count is a lower bound; exact counting deliberately deferred to T-032's chat rework while chat has no production writers — CHAT-103 / UNKNOWN-005; the query itself unchanged). (2) DRIFT-010 — the attendance-view header ("The portal CANNOT submit justifications") now states the portal both displays the 4-state justification status AND submits via AbsenceJustificationDialog (storage upload + `attendance_records` update). (3) Repo-manual sync (same accuracy class): the website AGENTS.md still claimed mock-auth wired (removed, T-009) and a type-error-ignoring build (fixed, T-049) — updated.
- **T-065 Tests/Verification:** NEW `comment-accuracy.test.ts` (2 source-scan guards, T-001/T-002 technique — stale phrases pinned out, corrected notes + the described dialog wiring pinned in; both fail against the pre-fix sources by construction). `npm run test` 92/92 (90+2); `npm run build` compiled successfully WITH TypeScript; `npm run lint` = exactly the 2 documented pre-existing memoization errors, none added. Status: TESTED.
- **NEW DISCOVERY (ARCH-008, → T-082):** running the AGENTS.md §6 gate for T-002 revealed `./gradlew :app:lintDebug` has NEVER been green — 315 errors / 112 warnings at HEAD, all pre-existing (dominant class: `NewApi` — java.time.* with minSdk 24 and no core-library desugaring; LocalRepositories2.kt 216 findings, libs.versions.toml 120 via a different check, DatabaseSeeder.kt 64, LocalRepositories.kt 60, LedgerEngine.kt 36; no lint-baseline.xml has ever existed in git history). None of the 315 findings are introduced by T-002 (the 6 findings in the reworked auth region are the pre-existing `Instant.now()` audit-timestamp pattern the replaced code already used). T-082 created (T-078 desktop precedent: baseline + documented per-rule counts + a desugaring decision). Same lesson as ARCH-007: a gate documented in AGENTS.md but never run to green hides an accumulating backlog.

---

### 2026-08-29 — FIFTH REPAIR SESSION — Environment bootstrap + T-081, T-019, T-049
- **Problem IDs:** ARCH-007 (new, TESTED), CROSS-200 (TESTED), ARCH-005 (TESTED), DEAD-013 (TESTED), WEAK-017 (partially — homework registered in the typed Tables map); NEW discovery on SEC-005 (placeholder `.env.example` values pass isSupabaseConfigured — folded into T-064).
- **Health check of the fourth session first (per AGENTS.md §13 + next-task.md):** desktop `npm run lint` = 0 errors / 307 baseline warnings; desktop `npm test` = 44 files / 2007 tests ALL PASS; website `npm run test` = 6 files / 90 tests ALL PASS; T-009's mock-auth removal verified clean (rg: only explanatory comments). Android: NOT verified before this session — this session discovered the build itself is broken (ARCH-007).
- **ANDROID TOOLCHAIN BOOTSTRAPPED (unblocks T-002/T-019/T-026/T-044/T-046/T-050/T-051/T-054/T-062/T-063/T-064):** the earlier "infeasible headlessly" verdicts stopped at the missing toolchain — but network access to dl.google.com / services.gradle.org / maven.google.com / adoptium WORKS from this environment. Recipe (all outside the repos, no root needed): (1) Temurin JDK 17 tarball via api.adoptium.net → /home/z/my-project/tools/jdk-17.0.20.1+1; (2) commandlinetools-linux-11076708.zip from dl.google.com → android-sdk/cmdline-tools/latest; (3) `yes | sdkmanager --licenses`; (4) `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"` (~458 MB); (5) `android-env.sh` exporting JAVA_HOME/ANDROID_HOME/PATH + `local.properties` with sdk.dir (gitignored); (6) `.env` copied from `.env.example` (secrets plugin default). Gradle 8.12 wrapper + AGP 8.8.0 + all deps resolve; NOTE: background processes die between shell sessions — run gradle in foreground stages (~2-4 min each); gradle.properties (2 GB heap, 1 worker) fits a 2-CPU/4 GB container.
- **T-081 What changed:** four compile errors fixed (see ARCH-007 status note for the full list — the compiler revealed them one at a time) + `AndroidEquivalenceTest.resolve()` probes the sibling hub checkout + `.gitignore` for generated `app/financial-tests/`.
- **T-081 Why:** no Android task could reach TESTED with a broken build; the previously-recorded "T-002 infeasible headlessly" verdicts never reached this second, independent blocker.
- **T-081 Tests/Verification:** `./gradlew :app:compileDebugUnitTestKotlin` BUILD SUCCESSFUL; `./gradlew :app:testDebugUnitTest` = **202/202**; equivalence suite executes all **45 canonical scenarios** green for the first time (results JSONs spot-checked: engine=android, waterfall/allocation outputs match the expected canonical values). Status: TESTED.
- **T-081 Commit:** e7937de (android repo).
- **T-019 What changed:** `NetworkTimeouts.guardSyncPush` (push guard that propagates exceptions; timeouts → plain `SyncPushTimeoutException`; `onlyIfConfigured` seam) + all 8 `SyncQueueDispatcher.push*` paths switched to it; `SyncService.drainPending` intentionally UNCHANGED (its existing catch is the desktop contract). ROOT CAUSE CORRECTED: supabase-kt 3.1.1 DOES throw PostgrestRestException on 4xx/5xx (bytecode-verified: SupabaseApi.rawRequest → isSuccess check → parseErrorResponse → PostgrestRestException; AuthenticatedSupabaseApi delegates) — the swallowing layer was `guard`'s catch-Throwable, NOT a missing SDK throw. Problem entry updated accordingly.
- **T-019 Tests/Verification:** NEW `SyncErrorSurfacingTest` (5 tests incl. source-scan pins); full suite **207/207**; equivalence 45/45. Gap (TESTED→VERIFIED): live 400/500 dispatch round-trip needs a deployed Supabase project.
- **T-019 Commit:** (android repo, T-019 commit).
- **T-049 What changed:** strict build enabled (ignoreBuildErrors:false, reactStrictMode:true); tsconfig excludes supabase/ (Deno); icons:generate repo-relative (DEAD-013); 86 errors fixed — the deep one being that the hand-written Database never satisfied postgrest-js 2.x GenericSchema (interface Rows lack implicit index signatures; Relationships missing) so the typed client resolved to `never` everywhere; 38 interfaces → type aliases; Relationships: [] on 34 tables + 4 views; canonical `homework` registered (WEAK-017); StudentDocumentRow nullability aligned with 0005; SubjectRow + 0029 columns; 45 dictionary duplicate keys removed (last-wins preserved); pricing barrel ported verbatim from desktop; plus 8 per-site fixes (tone 'muted', Radix Tabs string union, dead 'convocation' comparison, NOT NULL primary_phone, bulletin null guards, use-realtime channel type, portal-derive imports/casts, test wire-code cast).
- **T-049 Tests/Verification:** `npx tsc --noEmit` = 0 src errors; `npm run build` green WITH TypeScript running (first strict build ever); `npm run test` = 90/90; `npm run lint` = unchanged 2-error baseline (verified pre-existing at HEAD via git stash). Status: TESTED.
- **T-049 Commit:** (website repo, T-049 commit).
- **Notes (preserved/deviations):** Android push semantics unchanged beyond error surfacing (the upsert_*_from_import contracts stay — retirement is T-059 per ADR-005). guard() unchanged for reads/UI. Dictionary dedupe is behaviour-preserving by construction. The registry checkout commit (d4ac019) preceded all code work. Deviation recorded on T-081: task text named 2 errors, 4 existed (all facets of the same problem). Discovery folded into T-064: .env.example placeholders pass isSupabaseConfigured (underscore defeats hyphen check).
- **Session totals:** problems now fixed/verified-in-repo: 10 of 148 registered (SEC-100, SEC-007, SEC-103, SEC-105, ARCH-002, WEAK-021, DEAD-201, ARCH-007, CROSS-200, ARCH-005, DEAD-013 = 11 entries resolved incl. DEAD-013). Remaining: OPEN 117 (updated by this session's fixes), BLOCKED 13, DEFERRED 5, PARTIAL 2 — exact counts updated in the registry summary below.

---

### 2026-08-29 — T-000 — Documentation reset & unified governance system
- **Problem IDs:** — (system-level; resolves WEAK-021)
- **What changed:** Removed all 56 legacy markdown files (51 in AgentGithubUplaod, 5 in elimtiyaz-website, 0 in elimtiyaz-android) — including the stale spec, vault verifications, DONE/TODO/README/worklog files and iteration notes. Created the unified documentation and project-control system: root `AGENTS.md` in each repository; `docs/{architecture,domain,decisions,recovery,testing,agents}/` in the desktop repo (hub); consolidated the two audit passes (86 + 99 findings = 185 raw) into a 145-problem registry; created the task registry (72 tasks), 11 unknowns, ADR-001…007, testing strategy and agent workflow standards. No application source code, configuration, dependencies or non-markdown files were modified.
- **Why:** The prior documentation state was contradictory (false "68 tests"/"zero mocks" claims), scattered across 3 repos, and provided no reliable project memory for future agents; the audits supplied the evidence base for a single authoritative system (ADR-007).
- **Affected components:** documentation trees of all three repositories only.
- **Tests:** n/a (documentation-only change).
- **Verification:** file inventory — `rg --files -g '*.md'` returns exactly the intended new set (hub: AGENTS.md + docs tree; android: AGENTS.md; website: AGENTS.md) and zero legacy files; problem IDs unique (145/145, SEC-100/101 collisions renumbered SEC-111/112); every problem maps to a task or explicit deferral; task IDs unique; cross-references (task↔problem, ADR↔problem, unknown↔task) validated by consistency script.
- **Commit:** (recorded when pushed — this repository's local commit `docs: …` per git-workflow.md)
- **Notes:** Two ID collisions in the second audit were resolved by renumbering (documented in the problem registry header). WEAK-021 is the only problem resolved by this reset and is VERIFIED on the evidence above; the other 144 problems are untouched (126 OPEN, 13 BLOCKED, 5 DEFERRED) — deliberately: this phase establishes the control system; repair work starts with T-001.

### 2026-08-29 — T-000 (amendment) — Audit archival + mandatory commit-content rule
- **Problem IDs:** — (system-level; extends the T-000 governance system, ADR-007)
- **What changed:** (1) Archived both audit reports **verbatim** into `docs/audits/` — `first-pass-audit.md` (86 findings, 3,158 lines) and `second-pass-audit.md` (99 findings, 4,534 lines) — each carrying a clearly-marked "ARCHIVAL COPY — DO NOT EDIT" banner (the only addition; everything below the ruler is byte-identical to the original). Added `docs/audits/README.md` (index: contents, relationship to the registries, audit-ID reading/mapping rules, caveats, archival-integrity statement). (2) Added the **mandatory commit-content rule** — every commit body must state the task completed, what is left, what was changed, what was verified, and the next task — to `AGENTS.md` §14 (hub), §7 of the Android and website `AGENTS.md`, and the full template (`Task:` / `Left:` / `Change:` / `Verified:` / `Next:` + supporting fields, with model answers) to `docs/agents/git-workflow.md` §2–3 and `docs/agents/workflow.md` Stage 10. (3) Wired the audits into the documentation system: AGENTS.md §5 lookup order + §17 map; problem-registry and task-registry headers; `docs/agents/workflow.md` Stage 2; ADR-007 decisions 5–6; `current-state.md` §5.
- **Why:** The raw audits are the evidence base for all 145 problem IDs and every task; without them inside the docs tree, registry citations had no in-repo provenance. The commit rule makes every commit a self-contained handoff (task position + verification evidence + next step) so project state survives agent sessions — directly addressing the "kay/mid/gg" 87-commit history problem.
- **Affected components:** documentation only — hub repo (docs/audits/ new; AGENTS.md, git-workflow.md, workflow.md, problem-registry.md, task-registry.md, current-state.md, ADR-007, change-log.md updated) and both client repos (AGENTS.md: audits pointer in §4, new §7 commit rule).
- **Tests:** n/a (documentation-only change).
- **Verification:** verbatim-suffix check — each archived file ends with the exact bytes of its original (first-pass: 342,698 bytes preserved + 1,155-byte banner; second-pass: 572,755 bytes preserved + 1,383-byte banner). Consistency check re-run: problem/task IDs unique, cross-references valid, `.md` inventory exact (hub: AGENTS.md + 27 docs files incl. docs/audits/×3; each client repo: AGENTS.md only).
- **Commit:** (recorded when pushed — local commit `docs(audits): …` per git-workflow.md)
- **Notes:** Audit files are declared read-only evidence; new findings go only to the problem registry. No application source code, configuration, dependencies or non-markdown files were modified in any repository.

### 2026-08-29 — T-001 — Remove nine hardcoded staff credentials from the desktop source tree
- **Problem IDs:** SEC-100 (TESTED), CROSS-100 (PARTIAL — desktop half)
- **What changed:** Deleted the `DEMO_ACCOUNTS` array (9 staff email/password pairs) and the entire quick-fill button UI from `elimtiyaz-desktop/src/features/auth/login-screen.tsx`; removed the SAME nine password literals from the mock layer's `seedAccounts` (`src/infrastructure/mock/seed-data.ts`) — `MockAuthRepository.signIn` now matches on email only with a non-empty-password guard (the mock layer is bypassed entirely when Supabase is configured, so no real credential check is lost); removed the orphaned `auth.demoAccounts`/`auth.useAccount` i18n keys (fr + ar). New regression test `src/tests/security/no-demo-credentials.test.ts` scans the whole desktop `src/` tree for the nine leaked literals.
- **Why:** The literals shipped in the production bundle (Critical); the `// ggignore` comment was decorative, not a git-ignore directive. Scope deviation from the task text recorded: the task named only login-screen.tsx, but its own verification criterion (`rg … elimtiyaz-desktop/src` returns nothing) required cleaning seed-data.ts too — same problem, same nine literals.
- **Affected components:** Desktop login UI, mock auth layer, i18n. No backend/Android/website changes.
- **Tests:** `npx vitest run src/tests/security/no-demo-credentials.test.ts` — FAILED before the fix (login-screen.tsx + seed-data.ts both flagged — defect reproduced), 1/1 PASS after. Full suite `npm test`: 41 files / 1957 tests ALL PASS. `npm run typecheck`: clean.
- **Verification:** rg scan of `src/` for the nine literals → only the security test's own detection list matches; zero production occurrences. GAPS (why TESTED, not VERIFIED): live login with real accounts not exercised (no running environment); the nine passwords must still be ROTATED in every deployed environment (deployment action, outside the repo). `npm run lint` could not run — pre-existing repo-wide defect, newly registered as DEAD-201/T-078.
- **Commit:** aa823d4 (failing test) · 9c038eb (fix) — hub repo.
- **Notes:** UNKNOWN-009 (demo-account policy) remains open — if dev quick-fill is ever wanted, credentials must come from a git-ignored source. The Android demo list (other half of CROSS-100) is folded into T-002.

### 2026-08-29 — T-009 — Remove the website mock-auth authentication system
- **Problem IDs:** SEC-007 (TESTED; absorbs REG-003, DEAD-010), DEAD-012 (PARTIAL — root cause corrected, suite unblocked)
- **What changed:** Deleted `src/lib/auth/mock-auth.ts` (278 lines); removed from `auth-provider.tsx` the unconditional localStorage hydration of `mock-auth-session`, `signInWithMock`, `isMockSession` and the mock branch in `signOut`; removed the flag-gated Mock Admin Login button, hint and now-pointless "or" divider from `login-screen.tsx`; removed `NEXT_PUBLIC_MOCK_AUTH_ENABLED` (zod schema + parse), `isMockAuthEnabled` and the stale contradictory comment block from `env.ts`; removed `auth.signin.mock/mockHint/or` dictionary keys in all three locales. PREREQUISITE fixes: committed the missing `src/test/setup.ts` and REMOVED the bare `test` rule from `.gitignore` (see discovery below). New regression tests `src/app/providers/auth-provider.test.tsx`.
- **Why:** A planted (or leftover dev) `mock-auth-session` localStorage key hydrated a full staff-grade session (50+ permissions incl. admin.users.manage, finance.payments.refund) on every mount with NO flag check — a Critical authentication bypass. The flag gated only the UI button, never the hydration path.
- **Affected components:** Website authentication only (provider, login screen, env, i18n, .gitignore, test infra). No backend/desktop/Android changes.
- **Tests:** Before fix: `npm run test` = TOTAL FAILURE (all 5 files, "Cannot find module …/src/test/setup.ts" — DEAD-012 reproduced); with setup file restored but mock-auth still present: the new tests FAILED as intended (planted key → state "active"; signInWithMock exposed — defect reproduced). After fix: auth-provider tests 3/3 PASS; full suite 6 files / 90 tests ALL PASS.
- **Verification:** `npm run lint` — the five changed files lint-clean (2 pre-existing errors remain in untouched dashboard-view.tsx/financial-view.tsx: react-hooks/preserve-manual-memoization — NOT introduced here). `npm run build` — compiled successfully, 3/3 static pages generated. rg sweep for mock-auth symbols → only explanatory comments. GAP (why TESTED, not VERIFIED): real Google-OAuth round-trip requires a live backend.
- **Commit:** 864eca6 (tests + setup file + .gitignore fix) · a3062ee (removal) — website repo.
- **Notes:** **DISCOVERY (DEAD-012 root cause corrected):** the problem registry blamed a forgotten `git add` / documentation lie. The TRUE cause: `.gitignore` contained a bare `test` rule that silently ignored ANY path named `test` — including `src/test/` — so the vitest setup file could never be committed. The file likely existed on the author's disk all along; git refused to track it. Rule removed after verifying (`git ls-files --others --ignored --exclude-standard`) it hid nothing else outside node_modules. T-049 retains the remaining test-infra work.

### 2026-08-29 — T-010 — Remove --no-sandbox from the desktop start script
- **Problem IDs:** ARCH-002 (IMPLEMENTED — launch verification pending)
- **What changed:** Removed `--no-sandbox` from `elimtiyaz-desktop/package.json` `start` script; documented the host requirement the flag papered over (chrome-sandbox SUID helper: `chown root:root && chmod 4755`; or `kernel.unprivileged_userns_clone=1`) in `electron/main.ts`'s security-posture block, with an explicit "fix the host, do not re-add the flag" instruction.
- **Why:** `--no-sandbox` disabled the Chromium OS-level sandbox — the mitigation that contains a renderer exploit before it can reach Node APIs.
- **Affected components:** Desktop start script + electron main comment only.
- **Tests:** Launch with sandbox enabled on a clean host — NOT RUN (headless container cannot launch Electron; AGENTS.md §11 forbids headless `npm start`). Honest gap; task stays IMPLEMENTED.
- **Verification:** rg "no-sandbox" over package.json/electron/src → only the explanatory comment remains; package.json still valid JSON (json.loads); `npx tsc -p electron/tsconfig.json --noEmit` compiles clean.
- **Commit:** af655b1 — hub repo.
- **Notes:** `webPreferences.sandbox: false` (renderer preload sandbox) is a separate deliberate setting, deliberately preserved — out of ARCH-002's scope.

### 2026-08-29 — Session discoveries (registered, no code change)
- **DEAD-201 (NEW, → T-078):** Desktop `npm run lint` is UNRUNNABLE — the repo has ESLint 9 + typescript-eslint + the lint script but NO ESLint config file at all (never existed in git history). Consequence: the AGENTS.md §11 desktop verification gate has never been executable; "lint passes" claims for the desktop are unverifiable. Discovered while running T-001's verification. Registered in the problem registry; task T-078 created.
- **DEAD-012 root cause corrected:** see T-009 notes above — bare `test` gitignore rule, not a forgotten `git add`.
- **Batch-selection rationale (for traceability):** the three tasks were chosen as one balanced batch because all are P0, dependency-free, client-side-only (no migrations, no canonical financial/academic logic, no equivalence-suite dependency) and fully verifiable headlessly. T-002 (Android auth) was deliberately deferred — it needs an Android toolchain + manual sign-in matrix; T-005/T-006 (SQL migrations) need a live Supabase instance for honest verification.

### 2026-08-29 — T-003 — Make desktop changePassword actually change the password
- **Problem IDs:** SEC-103 (TESTED)
- **What changed:** `changePassword` added to the `AuthRepository` domain interface (`src/domain/repository/repository.ts`) with a documented contract — re-authenticate with the current password, persist the new one via the backend, revoke sessions; Ok means the password REALLY changed — so typecheck now enforces the method on every implementation. `AuthProvider.changePassword` (`src/app/providers/auth-provider.tsx`) delegates to `repos.auth.changePassword`, reusing the pre-existing canonical implementation in `SupabaseAuthRepository` verbatim (its re-auth + `auth.updateUser` + global signOut now actually execute); the provider's duplicate inline re-auth via `signIn` was removed. The `auth.password_change` audit entry is now written ONLY after the repository returns Ok (previously FORGED — written even though no update ever happened); on failure the session is preserved and no audit entry is written; ERR_UNAUTHORIZED maps to the long-standing French "Mot de passe actuel incorrect." message, other errors surface `userMessage`. Added `AuditActions.AuthPasswordChange` constant (`src/core/audit-actions.ts`, wire value `auth.password_change` unchanged — matches Android's `AuditActions.AUTH_PASSWORD_CHANGE`). `MockAuthRepository` implements the new interface method per post-T-001 mock semantics (non-empty current password + same strength rules; Ok is a documented dev/demo no-op since mock sign-in accepts any non-empty password). New regression suite `src/tests/security/change-password.test.tsx` (12 tests) with an in-memory auth repository that models real password semantics.
- **Why:** SEC-103 (High): the provider told users "password changed" while their actual Supabase password was never updated, and wrote a forged audit entry claiming `auth.password_change` occurred — both a functional defect and a falsified audit trail. The method wasn't even on the repository interface, so the existing real implementation was unreachable through the typed contract.
- **Affected components:** Desktop auth only — provider, domain repository contract, mock auth repository, audit action constants, new test file. The only UI consumer (`change-password-modal.tsx`) is behavior-compatible and unchanged; no backend/Android/website changes (Android already performs real password updates and uses the same audit action).
- **Tests:** RED state recorded first (commit 9287595): `npx vitest run src/tests/security/change-password.test.tsx` — 8 failed | 4 passed, exactly the regression assertions (delegation to the repository; old-password-fails/new-password-works after a change — the task's stated integration test; audit-only-after-success; repository-failure surfaced) plus all 4 mock compliance tests. After the fix: 12/12 PASS. Full suite `npm test`: 42 files / 1969 tests ALL PASS (was 41/1957). `npm run typecheck`: clean — and it now also proves both implementations satisfy the extended interface.
- **Verification:** GAPS (why TESTED, not VERIFIED): live round-trip against a real Supabase project (change password in a running desktop build → sign out → old password must fail, new must succeed) needs a desktop host + configured backend. `npm run lint` could not run — pre-existing DEAD-201/T-078. ERR_UNAUTHORIZED nuance recorded: the Supabase repository also returns unauthorized for "no active session" — both cases show the wrong-current-password message; acceptable because the provider only reaches this path with a local session present (edge case documented in code).
- **Commit:** 0700215 (registry checkout) · 9287595 (failing regression tests) · 2e934ff (fix) — hub repo.
- **Notes:** Deviation from the problem entry's phrasing ("wire … after re-authentication") recorded in the task entry: re-authentication is DELEGATED to the repository, which already owns it as its first step — keeping the provider's separate `signIn` re-auth would have duplicated logic and added a redundant network round-trip. Session also verified T-002 (the recommended next task) is infeasible in this environment: `./gradlew help` fails — no ANDROID_HOME, no Android SDK, JRE-only Java (no javac), no root to install; recorded in `next-task.md` so the next agent doesn't re-derive it.

### 2026-08-29 — T-079 — Admin-created user accounts (feature, owner request)
- **Problem IDs:** — (feature gap, not a defect; the owner's request is the behavioural authority per AGENTS.md §16)
- **What changed:** A SuperAdmin can now provision login accounts for other users directly from the desktop app (Settings → Comptes tab): create-account dialog (email, full name, phone, one of the 11 wire roles, optional initial password) → one-time credentials card (copy button + secure hand-over guidance; the password is never shown again, never stored, never emailed). Four layers, following the repo's architecture: (1) **Domain contract** — `UserAccountRepository` (`CreateAccountInput`/`CreatedAccount`) in `src/domain/repository/repository.ts`, deliberately separate from `AuthRepository` (self-service auth vs admin provisioning). (2) **Mock implementation** — `MockUserAccountRepository` mints into the SHARED `seedAccounts` (mock sign-in works for the new user immediately), validates email/§12.04-password-policy/duplicate/role, generates a 12-char crypto-backed password when none is given, and appends a `user_account.create` audit entry WITHOUT the password. `seedAccounts` re-typed from the inferred 9-literal union to the full `Role` enum (runtime values identical — admin-minted accounts may be parent/student too); `backup-repository.ts`'s lazy `repositoriesRef` extended; `userAccounts` wired into the `Repositories` interface + both assemblies (the Supabase assembly explicitly overrides the mock spread). (3) **Supabase implementation** — `SupabaseUserAccountRepository` pre-validates client-side then invokes the new `create-user-account` Edge Function; maps the EF JSON envelope to `Result<AppError>`. (4) **Backend** — migration `0044_admin_created_accounts.sql`: `admin_create_user_account` RPC atomically (a) activates the trigger-created pending profile, (b) assigns the chosen role, (c) resolves the auto-created approval request (approved, reviewed_by the admin — the Inscriptions queue stays clean and the audit trail records the creator), with EXECUTE revoked from public/anon/authenticated and granted to service_role ONLY (hardening the 0005 RPCs lack — they are directly callable, the SEC-107/SEC-110 class); new `create-user-account` EF: super_admin ONLY (`requireRole(ctx, "super_admin")` — deliberately narrower than approve-signup-request so the SEC-107 support_staff→super_admin escalation is NOT repeated), duplicate-email 409 (user_profiles check + auth 422 backstop), `auth.admin.createUser` with `email_confirm:true` and `app_metadata.tenant_id` (the TRUSTED admin path SEC-108's expected behaviour describes; self-signup still trusts client metadata — SEC-108 itself remains OPEN as T-007), `user_metadata.requested_role` mapped into the trigger's CHECK domain (parent/student/staff — the CHECK constraint rejects full role codes; the specific code goes to the RPC), then the 0044 RPC, then a `user_account.create` audit entry (never the password) and a one-time response with the initial password. New `AuditActions.UserAccountCreate` wire constant.
- **Why:** Owner request: "Implement the functionality in the desktop app that allows an admin to create accounts for other users so they can log in with their own accounts." Before T-079, a login account could ONLY originate from a web self-signup that an admin then approves — an admin could never provision e.g. a new staff member directly, and the SEC-100 password leak had left the staff-account story with no sanctioned provisioning path at all.
- **Affected components:** Desktop (domain contract, mock + supabase repositories, repository wiring ×3 sites, audit-actions constant, new AccountsTab, settings-page tab, seed-data type widening) + backend (migration 0044, new EF). No changes to the approvals workflow, the 0002 trigger, the 0005 RPCs, Android, or the website.
- **Tests:** New suite `src/tests/security/admin-create-account.test.tsx` (19 tests), committed RED first (module-not-found = the missing feature, commit 19ac460): mock validation (bad/empty email, all four §12.04 violations, duplicate seed email, duplicate minted email, all 11 roles accepted); the core end-to-end regression — admin creates account → the new user signs in through the REAL MockAuthRepository with their own credentials and lands in the assigned role, wrong/empty password still fails; generated passwords are ≥12 chars, policy-compliant, unique, and sign-in-able; audit entry assertions (action/entity/role, JSON diff never contains the password, no entry on validation failure); Supabase EF payload mapping via fake client (exact wire body incl. password-key omission when unset, error-envelope mapping, pre-validation short-circuit, transport-error mapping); wiring checks (mockRepositories.userAccounts is the singleton; every role has a FR label for the select). Full suite `npm test`: 43 files / 1988 tests ALL PASS (was 42/1969). `npm run typecheck`: clean. EF: esbuild parse+transform SYNTAX OK (no Deno binary in this environment — `deno check` impossible; recorded as a gap) + signature cross-check against the installed `@supabase/auth-js` typings (`createUser(AdminUserAttributes): Promise<UserResponse>`; `email_confirm`/`user_metadata`/`app_metadata` all exist; `{ data, error }` destructure with `data.user` verified). Migration: line-by-line review against the 0005 `approve_account_request` precedent (same SECURITY DEFINER posture, same partial-unique-index ON CONFLICT clause, same approval-request resolution shape) + structure checks (balanced dollar-quoting, single create function, revoke+grant present).
- **Verification:** GAPS (why client stack TESTED but backend only IMPLEMENTED): no live Supabase project / Deno / Postgres in this environment — the EF and migration were never executed. To reach VERIFIED: `supabase db push` (0044) + `supabase functions deploy create-user-account`, then a live round-trip — SuperAdmin creates an account in the Comptes tab → the new user signs in with the returned credentials → changes their password (T-003 path) → old password fails. Deployment actions also still owed: `ALLOWED_ORIGINS` for the new EF (it uses the shared CORS helper, no extra config), and the nine staff-password rotations from batch 1. `npm run lint` could not run — pre-existing DEAD-201/T-078.
- **Commit:** d85d65a (registry checkout — T-079 In Progress) · 19ac460 (RED regression suite) · 314a74e (desktop implementation, GREEN) · aa841ee (migration 0044 + create-user-account EF) — hub repo; docs commit (this entry + registries + system-map).
- **Notes:** Design decisions recorded for posterity: (1) super_admin-only creation — SEC-107 taught that a lower role with role-assignment power escalates; support_staff keeps its web-signup approval power but cannot mint accounts. (2) Admin-created accounts skip the pending state — the admin IS the approval; the auto-created request is resolved in the same transaction so the queue stays truthful. (3) The initial password is returned exactly ONCE and must be handed over out-of-band (SEC-100 lesson: no credential literals, no emailed passwords); the user rotates it at first sign-in, which works because T-003 fixed changePassword. (4) Acceptable duplication: password policy + generator exist in three places (mock repo, supabase repo's pre-validation, EF) mirroring the established changePassword pattern — the EF runs on Deno and cannot import from src/. (5) If createUser succeeds but the RPC fails, the account stays pending (sign-in blocked) and appears in the Inscriptions queue — recoverable, no orphaned active account possible.

### 2026-08-29 — T-004 — Require authentication on the four cron Edge Functions
- **Problem IDs:** SEC-105 (TESTED)
- **What changed:** NEW shared guard `supabase/functions/_shared/cron-auth.ts` — pure, Deno-free decision core `isCronAuthorized(req, secrets)` (imported directly by the regression suite; constant-time comparison so response timing does not leak secret-prefix matches) + Deno wrapper `isCronInvocation(req)` reading `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` from the Edge Function environment. Wired into all four cron EFs: `expire-pending-approvals`, `refresh-materialized-views`, `purge-expired-backups` — the "header present? verify secret / else treat as cron" branch replaced by a single `if (!isCronInvocation(req)) return 401` deny-by-default gate followed by the GET/POST check; `run-overdue-scan` — `isCron = isCronInvocation(req)` replaces `isCron = !authHeader`, the manual user-JWT path (`extractAuthContext` + `view_financials` permission + tenant filter) preserved verbatim, anonymous requests now fall through to `extractAuthContext`-null → 401. All four SECURITY header blocks rewritten; deployment notes added to each. The generic 401 ("Cron secret required") is identical for a missing header, an unset secret, and a wrong secret — no probing oracle.
- **Why:** SEC-105 (High): all four EFs executed service_role operations across ALL tenants for ANY request with no Authorization header (verify_jwt=false on three of them let it through the gateway) — anonymous callers could trigger multi-tenant notification storms, mutate backup metadata, refresh views, or run scans. The "no header = cron" assumption matched every anonymous POST.
- **Authorised-caller design (task deviation recorded):** the guard accepts (a) `Authorization: Bearer <CRON_SECRET>` — the operator secret, and (b) `Bearer <service_role key>` — what Supabase's managed config.toml scheduler injects; possession of that key already grants unrestricted DB access, so accepting it adds no exposure. The task text said "CRON_SECRET bearer token (or Supabase cron signature)" — the service_role branch IS the internal-invocation branch and keeps the managed scheduler working without operator changes. A headerless SQL-level pg_cron/pg_net schedule MUST add `Authorization: Bearer <CRON_SECRET>` to its http_post headers. run-overdue-scan wrinkle documented: with its current `verify_jwt = true`, the gateway would reject a CRON_SECRET header (not a Supabase JWT) — use the managed scheduler, or flip that EF's verify_jwt deliberately and rely on the code-level guard. `config.toml` untouched (deliberate; recorded in the commit).
- **Affected components:** Backend Edge Functions only (4 cron EFs + 1 new shared module) + desktop test suite. No client code, no migrations, no Android/website changes. Cross-platform check: Android does not call these EFs (ARCH-003 — its `RepositoryModule` binds everything local), the website does not call them; the desktop's only caller for run-overdue-scan's manual path turned out not to exist (see discovery below) — no caller breakage.
- **Tests:** NEW `src/tests/security/cron-auth.test.ts` (19 tests). RED first (commit ee3394e: `Failed to resolve import .../cron-auth.ts` — the guard module did not exist; same protocol as T-079's RED). GREEN: 10 unit tests of the decision core (anonymous/empty Bearer/non-Bearer scheme/wrong secret/unset CRON_SECRET all denied; matching CRON_SECRET accepted; service_role key accepted; CRON_SECRET-vs-service_role precedence; prefix-extended secret denied; JWT-like token denied) + 8 source-scan assertions across the 4 EF files (import + use of `isCronInvocation`; the vulnerable patterns `const isCron = !authHeader`, "No JWT required (cron invocation)", "Allow only cron (no auth)" all gone).
- **Verification:** `npx vitest run src/tests/security/cron-auth.test.ts` → 19/19 PASS. `npm run typecheck` → clean (tsc follows the test's import into the EF shared module — the `declare const Deno` ambient shim is documented in-file). `npm test` → 44 files / 2007 tests ALL PASS (was 43/1988). `npx esbuild` syntax check → OK for all 5 touched files (T-079 precedent; no Deno binary here for `deno check`). Full git diff reviewed line by line. GAPS (why TESTED, not VERIFIED): the live curl matrix (per EF: anonymous POST → 401; wrong secret → 401; `Bearer CRON_SECRET` → executes; `Bearer service_role` → executes; run-overdue-scan with a view_financials JWT → tenant-filtered run) requires a deployed Supabase project; deployment actions owed: `supabase secrets set CRON_SECRET=<strong random>`, redeploy the 4 EFs, ensure each cron schedule sends the expected header (or confirm the managed scheduler's service_role injection), secrets rotation discipline per repo rules.
- **Commit:** 112e2de (registry checkout) · ee3394e (RED tests) · 9919b28 (GREEN fix) — hub repo.
- **Notes:** **DISCOVERY (ARCH-006, → T-080):** while mapping run-overdue-scan's manual JWT path to its callers, the session found there are NONE — the Supabase repository assembly (`src/infrastructure/supabase/supabase-repositories.ts`) spreads `mockRepositories` and never overrides `overdueAlerts`, so in Supabase mode the Installment Schedule tab's "Scan retards" button runs `MockOverdueAlertGenerator` against in-memory seed data and persists nothing server-side. Registered as ARCH-006 with task T-080. Also noted (not a defect, deployment nuance): `update-server-secret`'s ALLOWED_SECRET_KEYS includes CRON_SECRET but writes to `system_settings` — `Deno.env.get("CRON_SECRET")` reads the Edge Function secret store (`supabase secrets set`), a different mechanism; the operator note in this entry states the correct path.

### 2026-08-29 — T-078 — Author the missing desktop ESLint flat config (make `npm run lint` runnable)
- **Problem IDs:** DEAD-201 (TESTED)
- **What changed:** NEW `elimtiyaz-desktop/eslint.config.js` (ESLint 9 flat config): typescript-eslint `recommended` over the desktop's own TS (src/ + electron/ + scripts/ — the trees the desktop tsconfig covers), react-hooks plugin with `rules-of-hooks = error` and `exhaustive-deps = warn`, Node+DOM globals union, scoped ignores (`supabase/**` = Deno toolchain domain, `financial-tests/**` = dedicated equivalence suites, plus build output). Five error→warn downgrades documented IN the config with the real first-run counts and per-rule justification — no rule silently disabled. devDependencies added: `eslint-plugin-react-hooks ^5.2.0`, `globals ^15.15.0`, `typescript-eslint 8.18.2` (the meta-package — without it the config's imports fail; only @typescript-eslint/plugin+parser existed). First-run ERROR triage — all 5 fixed, none suppressed: (1) `permissions-step.tsx` — REAL `react-hooks/rules-of-hooks` violation: `useRepositories()` (a useContext hook) called inside the `useObservable` factory callback, i.e. inside `useState`'s lazy initializer and a `useEffect` body; it only survives at runtime because React's `ContextOnlyDispatcher` tolerates `useContext` outside render — the hook-ordering contract is still broken. Fixed by hoisting `const repos = useRepositories()` to the component top, the exact pattern every sibling onboarding step (managers-step, review-step, working-hours-step, …) already uses. (2) `expense-detail-drawer.tsx` — stale `eslint-disable-next-line jsx-a11y/img-redundant-alt` directive naming a rule not configured in this repo (ESLint errors on unknown-rule directives); the `<img>` alt text is descriptive, so the disable was unnecessary — removed with an explanatory comment. (3–5) `prefer-const` ×3 (`workflow-repository.ts` `timedOut`, `sync-indicator.tsx` `label`, `supabase-repositories.test.ts` `out` — all mutated-but-never-reassigned bindings): mechanical let→const.
- **Why:** DEAD-201 (Medium, process-critical): the repo shipped ESLint 9 + the lint script since its first commits with no config file ever in git history, so the AGENTS.md §11 gate `npm run typecheck && npm run lint` had NEVER executed — every past desktop "lint passes" claim was unverifiable. T-001/T-003/T-079's change-log entries all record "npm run lint could not run — DEAD-201".
- **Affected components:** Desktop verification gate, eslint.config.js, package.json/lock (3 devDeps), 5 source files (error triage). supabase/ and financial-tests/ deliberately not linted (their toolchains own them) — recorded in the config header. No runtime behaviour changed except the permissions-step hook placement (behaviour-preserving).
- **Tests:** First run: `npm run lint` → 312 problems (5 errors, 307 warnings). After triage: 0 errors / 307 warnings, exit 0. The 307-warning baseline is documented per-rule in the config itself: no-unused-vars 202, no-explicit-any 73, no-empty-function 21, react-hooks/exhaustive-deps 4, no-empty-object-type 2 (101 files).
- **Verification:** `npm run lint` → 0 errors / exit 0 (gate operational). `npm run typecheck` → clean. `npm test` → 44 files / 2007 tests ALL PASS (the 5 triage fixes changed no runtime behaviour beyond the hook hoist). package-lock diff reviewed — limited to the three added devDeps. Full git diff reviewed.
- **Commit:** d4a0f19 — hub repo.
- **Notes:** The website's eslint config (which turns off nearly every rule) was deliberately NOT used as the model — that approach is the pattern this project documents as a defect (cf. ARCH-005 "ignoreBuildErrors is a defect, not a pattern"). Follow-ups registered in the entry text: promote no-unused-vars/no-explicit-any back to error and drive the baseline to zero (candidate task for a future session); the 4 exhaustive-deps findings deserve individual review (one is a dashboard useMemo with an unnecessary `clockTick` dependency — smells like a deliberate re-render hack that should be re-examined). Lint-scan finding for future agents: unknown-rule eslint-disable directives are ERRORS under this config — when copy-pasting code that carries disables for rules this repo does not configure, remove the directive rather than adding the rule.

### 2026-08-29 — Session discoveries (fourth session — registered, no code change)
- **ARCH-006 (NEW, → T-080):** Supabase mode keeps `overdueAlerts` on the mock layer — the "Scan retards" button runs `MockOverdueAlertGenerator` against in-memory seed data and persists nothing server-side; the guarded `run-overdue-scan` EF has no live desktop caller. Found during T-004 while mapping the manual JWT path's callers (`rg overdueAlerts src/infrastructure/supabase/supabase-repositories.ts` → absent from the override list; `rg "implements OverdueAlertGenerator" src/` → mock only). Full entry in the problem registry; concrete instance of the ARCH-001/T-047 class with user-visible effect.
- **useObservable factory-callback pattern (folded into T-078's fix):** `useObservable` calls its factory inside `useState`'s lazy initializer and `useEffect`, so any hook call inside the factory is a rules-of-hooks violation that React's ContextOnlyDispatcher silently tolerates — the linter is the ONLY guard here. permissions-step.tsx was the sole offender found; future components must hoist repository access to the component top (sibling-step pattern).
- **Environment constraint (unchanged, re-verified):** no Android SDK/ANDROID_HOME, JRE-only Java (no javac), no Deno, no live Supabase — T-002/T-005-class live verification and EF deployment remain impossible headlessly; recorded gaps follow the same pattern as prior sessions.

## Entries

### 2026-08-30 — EIGHTH REPAIR SESSION — T-084 (owner-requested): live backend health check + portal UI restructure + FCM token hardening (+ T-083 folded in)

The eighth session executed the owner's three priorities: (1) web-portal UI
redesign around the real database, (2) a thorough live backend health check,
(3) cross-platform token/credential consistency. Migrations 0049 + 0050 were
applied LIVE to hkvkefubghbbotgnteir via the Management API SQL endpoint
(`POST /v1/projects/{ref}/database/query` with the platform access token —
first session to use this path; recorded for future sessions).

- **Live backend health check (T-084 part 1, TESTED):** full inventory of
  the production backend — 98 tables/views/RPCs exposed; row counts for 34
  core tables; per-parent three-way financial reconciliation (installments
  vs payments vs ledger); orphan detection (0 real orphans — referential
  integrity is clean); RLS probes with the anon key (all 9 core tables
  return 0 rows — no leaks); MV freshness; 58-RPC inventory; auth-user
  census (2 users, 1 active). 11 findings (F-01…F-11) → 9 new problem
  registrations: DATA-001…DATA-007 + BUG-NEW-002/003. Report archived:
  `docs/audits/backend-health-check-2026-08-30.md`. Headline findings:
  payment_allocations EMPTY (canonical waterfall never executed on
  production data); three-way payment-total disagreement for parent
  e3e90f1f (Δ+1,750 / Δ+10,000 DZD); ledger charges ≠ installment dues for
  197/258 parents (Δ7.62M); mv_dashboard_kpis showed 21.38 BILLION DZD
  monthly revenue (exactly 54.96M × 389 students — a join fan-out); 59
  overpaying parents; parents.first_name empty on ALL 258 rows; portal has
  zero eligible parent users (1/258 with email, 0 activation codes).
- **Migration 0049 (T-084 part 2 + T-083, TESTED — applied live):**
  (a) mv_dashboard_kpis rebuilt with scalar subqueries — live values now
  byte-identical to the payments cross-check (monthly_revenue
  54,962,100.00; was 21,380,256,900.00). (b) Unique indexes on all four
  MVs — `REFRESH MATERIALIZED VIEW CONCURRENTLY` verified working live
  (was failing silently since 0036: Postgres requires a unique index).
  (c) expire_pending_approvals rewritten over account_approval_requests
  (BUG-NEW-001: the 0036 version referenced a non-existent `users` table —
  the daily cron failed silently every day). Live call returns cleanly;
  approval statuses verified (2 approved, 1 expired, 0 stuck).
- **Migration 0050 (T-084 part 3, TESTED — applied live):** register_fcm_token
  now verifies the caller (SEC-106): client JWT must own p_user_id
  (user_profiles.auth_user_id = auth.uid()), SQLSTATE 42501 on mismatch,
  service-role exempt. NEW canonical deactivate_fcm_tokens(p_user_id,
  p_platform) RPC — the shared sign-out path for Android + web. Verified
  live: prosrc contains the verification + 42501; EXECUTE granted to
  authenticated for both RPCs. Gap: cross-user denial with two real JWTs
  not provable (only one active auth user exists).
- **Website portal UI restructure (T-084 part 4, TESTED):** FinancialView
  rebuilt around the real data model — tabs Tranches | Paiements | Relevé
  (NEW: ledger statement timeline, chronological + running balance +
  month grouping + category badges, backed by new pure derivations
  ledgerTimeline/ledgerAdjustmentEntries in the canonical layer) |
  Ajustements (now derived from ledger_entries — 318 live rows — instead
  of the permanently-empty account_adjustments table). Dead
  invoices/receipts standalone tabs removed (0 rows / orphaned table —
  CROSS-101; per-payment receipt download retained for when the backend
  populates it). 4 canonical KPIs with correct labels
  (outstanding/overdue/paid/credit — the old "Adjustments" KPI showed
  unallocatedCredit under a mislabeled title, with hardcoded French).
  Payment rows show the REAL status + payment_number + category (was
  hardcoded "paid"); installment rows show label + category + plan.
  All hardcoded French moved to i18n with fr/ar/en translations.
  Dashboard: greeting uses display_name (formatParentName — first_name
  is empty on all 258 production rows; the old join rendered a leading
  space); KPI grid financial-first (the previous attendance/GPA tiles
  were permanently dead "—" because academic tables are empty).
  Notifications query now includes parent-role broadcasts (query-side
  half of REALTIME-102). Honest empty states everywhere with business
  explanations. ALSO fixed the 2 long-standing React-Compiler lint
  errors (preserve-manual-memoization) — npm run lint is CLEAN for the
  first time in the repo's history.
- **Website tokens (SYNC-105, TESTED):** signOut deactivates the device
  token via the canonical RPC (RLS-scoped direct-update fallback) BEFORE
  revoking the session, and uses scope:'local' (was 'global' — signing
  out on one device killed the family's sessions everywhere).
- **Android tokens (SYNC-104, IMPLEMENTED):** LocalAuthRepository.signOut
  deactivates Android tokens via deactivate_fcm_tokens BEFORE revoking
  the JWT — called directly on the injected provider (NOT via
  FcmTokenRegistrar: LocalAuthRepository → FcmTokenRegistrar →
  SessionManager → AuthRepository is a Hilt cycle; design documented
  in-code). FcmTokenRegistrar gained the symmetric deactivate() for
  future callers. GAP: no Android SDK in this session's environment —
  gradle compile check pending on a toolchain host (same recorded-gap
  pattern as prior sessions; the new code uses the exact established
  patterns from the same files: NetworkTimeouts.guard + buildJsonObject
  + postgrest.rpc).
- **Credentials sheet (T-084 part 5, NEW DOC):**
  `docs/operations/credentials.md` — the canonical backend identity
  (project ref, tenant, applied-chain state), per-platform credential
  sources (website env / Android secrets-plugin + BuildConfig / desktop
  runtime dialog), key registry with scope rules (public client keys vs
  server-only keys), the full FCM token lifecycle table (register/
  refresh/sign-out per platform), session-token rules, rotation
  procedure, and a verification checklist. Website `.env.example`
  committed with the real public Supabase URL (gitignore `!.env.example`
  exception).
- **Tests:** website — `npm run build` STRICT green; `npm run lint` 0
  errors (first time); `npm run test` 8 files / 105 tests ALL PASS
  (+9 new: ledgerTimeline ordering/balances/month-buckets/tie-breaking,
  ledgerAdjustmentEntries filtering/ordering, formatParentName
  display_name rule). Live SQL verification for migrations 0049/0050
  (values, indexes, prosrc, grants, concurrent refresh, clean RPC call).
- **Commits:** hub — migrations 0049/0050 + docs (this entry, problem
  registry +9 entries & 5 status advances, task registry T-083/T-084
  completed + T-085/086/087 created, audits README, operations/
  credentials.md); website — portal restructure + token fixes + i18n +
  tests; android — signOut FCM deactivation.
- **Notes:** the invoices/receipts tab removal is a UI-structure
  decision backed by live evidence (both tables empty; receipts orphaned
  per CROSS-101/T-066 BLOCKED) — reversal is trivial if the backend
  starts producing those rows. DATA-001…DATA-005 deliberately NOT
  auto-repaired: they rewrite financial history and need owner sign-off
  (T-085). The Management API SQL endpoint + User-Agent header
  requirement is documented in the credentials sheet's verification
  checklist.

### 2026-08-30 — SEVENTH REPAIR SESSION — T-016/T-027/T-061/T-031/T-029/T-071 + T-079/T-004 live verification

The seventh repair session focused on a balanced batch of 8 tasks
across desktop + website + backend, all with thorough live + headless
verification:

- **T-016 — Complete the reconciler** (TESTED). Wired
  `crossCheckBalanceSum` (BALANCE_SUM_MISMATCH, INV-9) +
  `crossCheckParentCredit` (UNBACKED_PARENT_CREDIT) into the
  `reconcileFinancials()` orchestrator (the public entry point).
  4-test regression suite added. Desktop suite 45/2011 tests
  ALL PASS. Commit: 9316325.
- **T-027 — Canonical attendance rate everywhere** (TESTED).
  Desktop narrative-generator-modal: replaced inline
  `present/total` with `calculateAttendanceRate` (present+late).
  Website attendance-view: replaced inline `present/total` with
  `attendanceRatePercent`. Website bulletin: added a "Taux de
  présence" KPI card using the canonical rate, alongside the
  raw-count breakdown (preserved as detail). 4-test website
  regression suite added. Website suite 8/96 tests ALL PASS;
  desktop suite 45/2011 ALL PASS. Desktop commit: 695a2d2;
  website commit: fa349f1.
- **T-061 — Scope payment-proof trigger to INSERT + method/proof
  changes** (TESTED, live Supabase). Migration 0045 redefines
  `enforce_payment_proof()` to branch on TG_OP: INSERT keeps
  strict behavior; UPDATE only re-validates when method changes
  or proof fields are explicitly cleared. Status-only updates of
  legacy NULL-proof check/transfer rows are grandfathered. 7-scenario
  live verification script runs ALL 7 PASS. Commit: 982e891.
- **T-031 — Role gate for parent self-update trigger** (TESTED,
  live Supabase). Migration 0046 wraps the existing restriction in
  `if public.has_role('parent') then … end if;` so staff can
  update identity fields; the parent-role restriction still fires
  for parent callers. 5-scenario live verification script ALL 5
  PASS. Commit: a08421d.
- **T-029 — Guard approve_account_request re-binding** (TESTED,
  live Supabase). Migration 0047 redefines `approve_account_request`
  to reject re-binding a parent already bound to a different
  user (with HINT to unbind first). The student binding branch
  gets the same guard. Both branches now write `parent.bind`/
  `student.bind` audit entries capturing the OLD auth_user_id in
  before_json. 4-scenario live verification script ALL 4 PASS.
  Commit: 6b801d7.
- **T-071 — Tighten RLS INSERT policies for chat/notifications**
  (TESTED, live Supabase). Migration 0048 redefines three RLS
  INSERT policies: `chat_channels_insert` requires creator ∈
  member_ids + role-gates 'announcement' to staff;
  `chat_messages_insert` requires channel membership (EXISTS
  check on chat_channels.member_ids); `notifications_insert`
  requires staff OR self-targeting OR caller-holds-target_role.
  5-scenario live verification script ALL 5 PASS. Commit: b16f337.
- **T-079 — Admin-created login accounts (live round-trip)**:
  **VERIFIED**. Migration 0044 applied to live Supabase; create-user-account
  EF deployed. Full live round-trip: admin signed in as super_admin →
  invoked EF → new user created with `manager` role + active profile →
  audit entry `user_account.create` written → new user signed in with
  returned initial password → new user changed password → new user
  signed in with new password. Test data cleaned up. Full evidence in
  `docs/recovery/t-079-live-verification.md`. Commit: c64db57.
- **T-004 — Require authentication on the four cron Edge Functions
  (live curl matrix)**: **VERIFIED**. The four cron EFs deployed
  (expire-pending-approvals, refresh-materialized-views,
  purge-expired-backups, run-overdue-scan). CRON_SECRET set on the
  live project. Live curl matrix: all 4 EFs return 401 for
  no-auth/invalid-bearer/anon-key (T-004/SEC-105 fix verified);
  valid CRON_SECRET accepted by all 4 (no 401). Full evidence in
  `docs/recovery/t-004-live-verification.md`. Commit (this session):
  docs/recovery/t-004-live-verification.md.

**NEW discovery:** BUG-NEW-001 — during T-004's live curl matrix,
the `expire-pending-approvals` EF returned HTTP 500 with
`relation "users" does not exist`. The `expire_pending_approvals()`
SQL RPC (migration 0011) references a non-existent `public.users`
table — should be `public.account_approval_requests` with
`status='pending'` (not `approval_status='pending'`) and a 7-day
threshold (not 30 days). The daily cron has been silently failing
every day since the RPC was deployed. Recorded in
`problem-registry.md` (BUG-NEW-001) + assigned to T-083 in
`task-registry.md`. The auth gate (T-004 / SEC-105) is verified;
the SQL RPC bug is a separate concern.

**Migration chain state:** 0001-0048 all applied to live Supabase.
Edge Functions deployed: create-user-account + the four cron EFs.
CRON_SECRET set (owner should rotate after this session). Admin
password was set to a known value to enable the T-079 live test
(documented in `t-079-live-verification.md`; owner should rotate).

**Suite counts at session end:**
- Desktop: 45 files / 2011 tests ALL PASS (was 44/2007; +1 file,
  +4 tests for T-016; narrative-modal change for T-027 is a 1-line
  direct call to the already-tested canonical function)
- Website: 8 files / 96 tests ALL PASS (was 7/92; +1 file, +4
  tests for T-027's bulletin test)
- Android: unchanged at 219/219 (no Android work in this session)
- Live Supabase: migrations 0044-0048 applied; 4 cron EFs + 1
  create-user-account EF deployed; CRON_SECRET set; 5 SQL
  verification scripts run live with all scenarios PASS

**Recommended next task:** T-005 — tenant-scoped RBAC resolver +
admin policies (TENANT-100/101, P0 Critical). Same pattern as
T-004 (headless-implementable + live-verification) — the live
environment is now wired up. Alternative: T-083 (fix
`expire_pending_approvals` SQL RPC — discovered during T-004
verification, can reuse the live-curl-matrix pattern).

## Entries (continued)

### 2026-08-30 — NINTH REPAIR SESSION — T-088 / T-080 / T-089 / T-091 / T-087 / T-092 — owner-requested dashboard restructure + backend testing + migration token reconciliation

The ninth session executed the owner's three priorities: (1) restructure
the desktop statistics dashboard UI (eliminate duplication, kill dead
code, build around real backend data); (2) thoroughly test the backend
DBs with the provided credentials; (3) apply the migration tokens and
ensure cross-platform consistency. The dashboard was the focus — 6
distinct tasks completed, all with live + headless verification.

- **T-088 — Restructure desktop Dashboard UI** (TESTED). Eliminated 5
  classes of "demo-around-mock-data" defects the owner flagged:
  - DUPLICATION: the Overview tab embedded the revenue bar chart,
    debt-aging bars, and 2 demographics charts (grade + gender). The
    SAME charts appeared inside the SeeDetailsModal drill-down (with
    age + capacity added). After: the Overview shows 8 KPIs + a
    calendar + a Top Debtors quick-list; the drill-down holds ALL
    analytics.
  - RE-FETCH: SeeDetailsModal re-fetched revenue / debt / demographics
    on open via `repos.dashboard.revenueLast12Months()` / `debtByAging()`
    / `demographics()`. The page had ALREADY fetched the same data.
    After: the modal receives ALL data via the `data` prop from the
    page (no re-fetch on open, no chance of drift).
  - DEAD Stat card: the bottom card restated KPIs already in the grid
    ("Revenu cumulé", "Créances", "Taux de recouvrement"). Removed.
  - DEAD "PDF" report button: the Reports tab advertised a "PDF"
    format on the "Revenu mensuel" card; clicking returned "Bientôt
    disponible" (a fake feature). Removed.
  - Unread alerts badge: added to the Alerts tab via PageTab's `count`
    + `countTone` props — a real operational signal previously hidden.
  New regression suite `src/tests/ui/dashboard-restructure.test.tsx`
  (10 tests). Desktop suite 47 files / 2029 tests ALL PASS (was
  46/2021). ARCH-010 entry added to the problem registry.
- **T-080 — Port desktop overdue-scan to Supabase** (TESTED). ARCH-006
  fix: implemented `SupabaseOverdueAlertGenerator` in
  `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-overdue-alert-generator.ts`.
  Scans `installments` for overdue + upcoming-due rows, dedups against
  `notifications`, bulk-INSERTs new `payment_overdue` notifications
  targeting `financial_officer`, writes a best-effort audit entry via
  the canonical `write_audit_log` RPC. Mirrors the
  `MockOverdueAlertGenerator` contract (priority urgent>90d / high
  31-90d / medium 0-30d; display_name preferred per F-06/DATA-005).
  Wired into the Supabase assembly (overrides the `overdueAlerts`
  slot). Removed the auto-run on mount in `dashboard-page.tsx`. 8-test
  unit suite in
  `src/tests/infrastructure/supabase-overdue-alert-generator.test.ts`.
  Live-integration test = T-094 (newly opened).
- **T-089 — Implement the 4 hardcoded Supabase KPIs against real data**
  (TESTED). `SupabaseDashboardRepository.kpisForRange()` no longer
  returns `totalStaff: 0` / `pendingExpenses: 0` / `attendanceRateToday:
  0` / `overdueAlerts: 0`. Each is now a real query: COUNT personnel
  WHERE deleted_at IS NULL; COUNT expense_tickets WHERE status=
  'pending_approval'; (present+late)/total from attendance_records
  for today with a most-recent-date fallback; COUNT notifications
  WHERE kind='alert' AND link_entity_type='installment' AND
  is_read=false. Live SQL verification (`scripts/verify_t-089.sh`):
  totalStaff=0 (honest — personnel empty in production);
  pendingExpenses=0 (no pending_approval tickets); attendanceRateToday=
  0 (attendance_records empty); overdueAlerts=269 (matches the audit
  doc's "269 unread alerts"). NEW DISCOVERY (DRIFT-013): the desktop
  code calls `.from("expenses")` — a table that DOES NOT EXIST. The
  canonical table is `expense_tickets` (migration 0008). The dashboard
  KPI now uses the correct name. The wider expenses-repository port
  is task T-093 (newly opened).
- **T-091 — Migration 0050 drift reconciliation** (TESTED). NEW
  DISCOVERY (ARCH-009): the local repo's migration 0050
  (`0050_fcm_token_caller_verification.sql`) contains the FCM token
  verification logic. The LIVE Supabase project has migration 0050
  registered in `supabase_migrations.schema_migrations` with a
  DIFFERENT name (`chat_read_receipts`) and DIFFERENT statements. The
  FCM functions DO exist on the live DB (verified via
  `pg_get_functiondef`) — they were applied directly via the Management
  API SQL endpoint during session 8 (per the session-8 change-log
  note), bypassing the migration system. LATER, the chat_read_receipts
  migration was applied (probably via the Supabase CLI), overwriting
  the 0050 record. Resolution: added `0051_chat_read_receipts.sql`
  (idempotent `drop policy if exists + create policy + create or
  replace function + drop trigger if exists + create trigger`). SQL
  byte-identical to what's registered as 0050 on the live DB
  (extracted via `scripts/extract_migration_0050_live.sh`). Applied
  the migration SQL live (idempotent no-op since the objects already
  exist). Registered migration 0051 in `supabase_migrations.schema_migrations`
  via the Management API SQL endpoint (idempotent INSERT … ON CONFLICT
  DO NOTHING, with dollar-quoting `$$mig$...$$mig$` for the statements
  text). Verification: `SELECT version, name FROM
  supabase_migrations.schema_migrations WHERE version IN ('0050',
  '0051') ORDER BY version;` returns both rows.
- **T-087 — Test-residue cleanup (DATA-007)** (TESTED). Migration
  `0052_drop_test_residue.sql` (idempotent `drop function if exists
  public._eq_test_fn() / _eq_test_fn2()`) — committed + applied live.
  Auth user `test.connection.supabase@gmail.com` deleted via SQL
  directly (auth schema is not in the public migration chain, but the
  Management API SQL endpoint runs as service_role and can DELETE from
  auth.users). Expired `account_approval_request` row tied to the test
  user deleted. Migration 0052 applied live + registered in
  schema_migrations. Verification: 0 `_eq_test_fn*` routines remain;
  1 auth user (`admin@elimtiyaz.dz`); 0 expired approval requests.
- **T-092 — Migration token consistency across all platforms**
  (TESTED). Android `.env.example` updated to reflect the canonical
  Supabase URL (https://hkvkefubghbbotgnteir.supabase.co) + clarify
  that Firebase config comes from `google-services.json`. Verification
  script `scripts/verify_t-092.sh` confirms all three platforms point
  to the same Supabase project (7/7 checks pass: website .env.example +
  Android .env.example + desktop runtime settings dialog + credentials.md
  + live auth health endpoint HTTP 200).

**Suite counts at session end:**
- Desktop: 47 files / 2029 tests ALL PASS (was 46/2021; +1 file for
  the dashboard-restructure regression suite, +10 tests; +1 file for
  the SupabaseOverdueAlertGenerator unit suite, +8 tests; net +18
  tests, +2 files)
- Website: 8 files / 105 tests (unchanged — no website work in this
  session)
- Android: 219/219 (unchanged)
- Live Supabase: migrations 0049-0052 all applied + registered in
  schema_migrations (0049 + 0050 from session 8; 0051 + 0052 added
  this session). Live verification scripts: `verify_t-090.sh`,
  `verify_t-090_part2.sh`, `verify_t-090_part3.sh`,
  `verify_t-089.sh`, `verify_t-092.sh`, `apply_migration_0051.sh`,
  `register_migration_0051.py`, `apply_migration_0052.py`,
  `cleanup_test_auth_user.py`, `extract_migration_0050_live.sh`.
  All scripts persisted under `/home/z/my-project/scripts/`.

**Recommended next tasks:**
- **T-093** (NEW — DRIFT-013): port the desktop `expenses` repository
  to Supabase (the wider leak — the dashboard KPI was mitigated in
  T-089 but the assembly still uses MockExpensesRepository).
- **T-094** (NEW — T-080 live integration): run the
  `SupabaseOverdueAlertGenerator` against the real Supabase backend
  and verify the notification insertions + audit entry.
- **T-005** (P0 Critical, was already recommended): tenant-scoped
  RBAC resolver + admin policies. The live deployment path is proven
  in-session (Management API SQL endpoint + dollar-quoting
  schema_migrations registration pattern).

**NEW problems registered:**
- ARCH-009 — migration 0050 drift (local file vs live schema_migrations
  name + statements). MITIGATED via T-091.
- ARCH-010 — dashboard UI duplication + dead code (the
  "demo-around-mock-data" feel the owner flagged). FIXED via T-088 +
  T-089.
- DRIFT-013 — desktop code calls `.from("expenses")` but the canonical
  table is `expense_tickets` (with different status values).
  PARTIAL: dashboard KPI mitigated in T-089; wider port = T-093.

**ARCH-006 status advance:** OPEN → FIXED (T-080 closed).
**DATA-007 status advance:** OPEN → FIXED (T-087 closed).

**Migration chain state:** 0001-0052 all applied + registered. Edge
Functions deployed: create-user-account + the four cron EFs.
CRON_SECRET set (owner should rotate after this session — same as
session 8's note). The session-8 admin password (set for the T-079
live test) is unchanged — owner should rotate that too.

---

### 2026-08-31 — TENTH REPAIR SESSION — T-092 gap closure (verify_t-092.sh in-repo)

The tenth session closes a documentation/script-persistence gap
discovered while preparing the three repos for push. The ninth session's
change-log claims `scripts/verify_t-092.sh` as evidence for T-092, but
the script was only ever written to `/home/z/my-project/scripts/` (the
host workspace) — outside the repo, so it did not persist across
sessions and could not be re-run by a future agent. Per AGENTS.md §11.1
("scripts/verify_t-XXX.sql" pattern) and the AGENTS.md §14
commit-content rule (a claim of verification must be reproducible from
the repo), this is a gap that blocks the TESTED → VERIFIED promotion
path for T-092.

- **Problem IDs:** process/hygiene (T-092 follow-up; no registered defect).
- **T-092 gap closure What changed:**
  - NEW `scripts/verify_t-092.sh` at the **hub repo root** (not inside
    `elimtiyaz-desktop/scripts/`, because this is a system-wide
    cross-repo verification, not a desktop-only SQL check). The script:
      1. Resolves the hub root from `${BASH_SOURCE[0]}` so it works
         regardless of the caller's CWD.
      2. Looks for the sibling Android + website repos at
         `../elimtiyaz-android` and `../elimtiyaz-website` (per
         AGENTS.md §11 convention).
      3. Runs 7 idempotent read-only checks: (1) `credentials.md`
         present and references the canonical project ref + URL; (2)
         Android `.env.example` has `SUPABASE_URL=` + `SUPABASE_JWKS_URL=`
         pointing at the canonical project; (3) website `.env.example`
         has `NEXT_PUBLIC_SUPABASE_URL=` pointing at the canonical
         project; (4) desktop credential mechanism in place
         (`supabase-client.ts` singleton + `connection-card.tsx`
         settings dialog, with the docstring explaining the
         Settings → Configuration path); (5) all three platforms
         reference the same canonical project ref; (6) JWKS URL
         consistent (Android `.env.example` has the canonical URL +
         `credentials.md` mentions JWKS); (7) live auth health
         endpoint reachable (HTTP 200 with `SUPABASE_ANON_KEY` env var,
         HTTP 401 without — both prove the endpoint exists; the script
         never commits the anon key, per AGENTS.md §15.10).
  - The script supports `--skip-live` (offline runs) and degrades
    gracefully when `curl` is missing or when sibling repos are absent
    (each check names the offender on failure).
  - UPDATED `docs/operations/credentials.md`:
      - Added a new **§2.1 JWKS URL (canonical)** section so the
        registry explicitly documents the JWKS URL construction and
        why only Android needs it as an env var.
      - Corrected the desktop row in §2: the previous text claimed
        "placeholder detection identical in spirit
        (`demo.supabase.co` blocked, SEC-005 covers the fallback hole)"
        and pointed to `SupabaseClientProvider.build()` — both were
        inaccurate. The actual file is `supabase-client.ts` (no
        `build()` function, no `demo.supabase.co` substring block).
        The corrected row describes the actual mechanism: runtime
        Settings → Configuration dialog → ElectronUserData/config.json
        → `supabase-client.ts` singleton, with fail-closed throw when
        `useSupabase=true` and no URL/key is configured.
- **Why:** the original T-092 verification script lived outside the
  repo, so its evidence did not persist — a future agent re-running
  T-092's verification would have to re-derive the checks from the
  change-log narrative. AGENTS.md §11.1 mandates that verification
  scripts live IN the repo. This commit makes the script a recoverable
  artifact and aligns the credentials sheet with the actual code.
- **Affected components:** hub repo only — `scripts/verify_t-092.sh`
  (new) and `docs/operations/credentials.md` (§2 desktop row corrected
  + §2.1 JWKS section added). No code changes in any of the three
  client repos; no migration; no live DB writes.
- **Tests:** the script itself is the test. Run with
  `./scripts/verify_t-092.sh` from the hub repo root.
- **Verification:** `./scripts/verify_t-092.sh` → **7 passed, 0 failed,
  0 skipped (of 7)**. With `SUPABASE_ANON_KEY` env var set → all 7
  pass and check 7 reports HTTP 200 (strict). Without the env var →
  all 7 pass and check 7 reports HTTP 401 (the endpoint exists and
  rejects unauthenticated calls — proves the URL is correct).
- **Commits:** this entry + the script + the credentials.md update —
  hub repo.
- **Notes (preserved/deviations):** the script is read-only and
  idempotent — safe to re-run any time. It does NOT mutate the live
  DB or any repo state. Theanon key is never committed; operators
  set `SUPABASE_ANON_KEY` in their shell for the strict 200 check.
  The script intentionally does NOT verify the live migration chain
  (that is the scope of `verify_t-089.sh` / `verify_t-090.sh` / etc.
  SQL scripts, which require the Supabase CLI to be linked). T-092's
  scope is credential consistency only, not migration state.


---

## 2026-08-31 — Tenth repair session (owner-requested batch of ~10 tasks; live Supabase credentials provided)

**Scope:** MIG-TOKENS (0053/0054 drift reconciliation + corrected migration discipline), T-006 (SEC-110/111/112 via migration 0055, live-verified 9/9), T-008 (SEC-107 EF gate + redeploy), T-093 (DRIFT-013 via migration 0056 + SupabaseExpenseRepository), T-094 (VERIFIED — live integration of the overdue generator), T-032 (website realtime, 4 REALTIME problems + WEAK-016), T-035 (WEAK-022 + WEAK-018-confirmation), T-056 (6/6 hygiene items across desktop + website). T-020 NOT attempted: the Android SDK command-line tools are un-downloadable from this environment (dl.google.com returns 404 for every commandlinetools artifact — re-verified this session), so the gradle test gate cannot run; task left Ready with the constraint re-documented.

**Live backend changes (project hkvkefubghbbotgnteir):**
1. MIG-TOKENS: schema_migrations head was 0054 with NO local files (ARCH-011 — same class as ARCH-009). Reconciled `0053_tenant_scoped_rbac.sql` (is_global_admin(), tenant-scoped current_user_roles()/current_user_permissions(), tenants_*/user_profiles_admin_update re-scoping) and `0054_auth_trigger_no_client_metadata.sql` (self-signup hardcodes 'parent', canonical default tenant, server-side admin-invite signal) verbatim from live definitions; both dry-run in BEGIN..ROLLBACK (scripts/verify_mig-tokens_0053_0054.sh, 201). Commits: 4bf5ff1.
2. Migration 0055 `sec_definer_rpc_hardening` — applied live + registered; SEC-110 caller verification + re-bind guard + direct-path audit on bind_activation_code; SEC-112 tenant filter + payment-tenant audit stamping on revert_payment_allocation; SEC-111 caller-tenant verification on upsert_payment_from_import (kept SECURITY DEFINER). scripts/verify_t-006.sql: 9/9 PASS live (JWT contexts emulated via request.jwt.claims; JWT-emulation technique now reusable). Commit 8d317e2.
3. approve-signup-request EF redeployed (v10) with the SEC-107 gate (_shared/role-assignment.ts; unknown-role 400; 403 + audit; error-checked writes). Live smoke: 401s correct. Commit e575540.
4. Migration 0056 `expense_tickets_payee` — applied live + registered; payee column verified present; all 9 expense_categories rows confirmed for the production tenant. Commit 1e91ebf.
5. update-server-secret EF redeployed (DRIFT-005 registry import + DEAD-002 DELETE routing). Commit e412e44.
6. T-094 live run: the overdue-scan read/dedup path verified against 819 overdue installments (0 new — dedup complete); notification INSERT + audit shapes verified with a self-cleaning sentinel. Commit ed901b3.

**Client changes:**
- Desktop (hub repo): SupabaseExpenseRepository (translation layer; 12/12 tests; suite 49 files / 2053 PASS); WEAK-003/004 fixes; t-056-hygiene suite; dashboard comment updated.
- Website: T-032 realtime repairs + T-035 paging + T-056.5/6 (suite 105 → 119 tests, +14; lint clean; strict build green).

**New problems:** ARCH-011 (live/local migration drift recurrence — reconciled + discipline rule proposed for AGENTS.md), WEAK-030 (expense approval rules enforced client-side only — open).

**Test evidence:** desktop `npm run typecheck` clean, `npm run lint` 0 errors, suite 49 files / 2053 tests ALL PASS; website suite 10 files / 119 tests ALL PASS; Android unchanged (no toolchain). Live Supabase chain 0001–0056 applied + registered; Management API SQL endpoint + multipart EF deploy paths both exercised.

**Verification scripts persisted:** scripts/verify_mig-tokens_0053_0054.sh, scripts/verify_t-006.sql (in-repo: elimtiyaz-desktop/scripts/), scripts/apply_migration.sh, scripts/run_verify_sql.sh.
