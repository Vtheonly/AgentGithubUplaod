# Problem Registry — Consolidated & Authoritative

> **Purpose:** single authoritative registry of every known defect, drift and risk in the El-Imtiyaz system (desktop, Android, website, backend).
> **Source material:** [first-pass audit](../audits/first-pass-audit.md) (86 findings) + [second-pass audit](../audits/second-pass-audit.md) (99 findings) = 185 raw findings — both archived verbatim in [`docs/audits/`](../audits/README.md) — consolidated into 145 unique problems. Duplicates and overlaps were merged; contradictions were resolved against repository evidence; unresolvable questions moved to `docs/recovery/unknowns.md`.
> **Do not** create problem lists anywhere else. New problems get a new ID here (next free number in the category prefix). Do not write new findings into the audit files — they are read-only evidence.

## Consolidation rules applied

1. **ID collisions resolved** — second-pass agent 3-A reused `SEC-100`/`SEC-101` (already taken by agent 3-B). The 3-A findings were renumbered `SEC-111` (upsert_payment_from_import SECURITY DEFINER) and `SEC-112` (revert_payment_allocation tenant check). See [`docs/audits/README.md`](../audits/README.md) for the full reading/mapping rules for audit IDs.
2. **Extend-chains merged** — findings explicitly marked *extends* in the second pass were absorbed into their first-pass parent (e.g. `TENANT-105` → `DEAD-100`, `PARENT-100` → `DRIFT-001`). Absorbed IDs redirect to the surviving entry; they are listed under *Consolidated from* and *Absorbed findings*.
3. **Same-root families merged** — e.g. the five receipt-numbering algorithms (`DRIFT-011`), the four equivalence test frameworks (`DUP-001`), the non-deterministic identity-code generators (`DRIFT-001`).
4. **Nothing was dropped silently** — every absorbed ID appears in this file; every surviving ID keeps its original evidence.

## Status vocabulary

`OPEN` · `INVESTIGATING` · `READY` · `IN_PROGRESS` · `BLOCKED` · `IMPLEMENTED` · `TESTED` · `VERIFIED` · `DEFERRED` · `WONT_FIX` · `DUPLICATE` · `UNKNOWN`

Status may only advance with evidence (see `docs/recovery/definition-of-done.md`). Nothing in this registry is `IMPLEMENTED` or beyond unless this repository's git history shows the change **and** `docs/recovery/change-log.md` records the verification evidence.

## Summary

| Severity | Count | | Status | Count |
|---|---|---|---|---|
| Critical | 30 | | OPEN | 62 |
| High | 54 | | BLOCKED | 11 |
| Medium | 70 | | DEFERRED | 5 |
| Low | 20 | | VERIFIED | 5 |
| | | | TESTED | 86 |
| | | | IMPLEMENTED | 1 |
| | | | PARTIAL | 2 |
| | | | FIXED/MITIGATED | 3 |

**Totals:** 174 registered problems (145 consolidated from 185 audit findings + 29 discovered during repair sessions) · 62 OPEN · 11 BLOCKED on unresolved decisions (see `unknowns.md`) · 5 DEFERRED · 5 VERIFIED (WEAK-021; ARCH-006 — live integration T-094; SEC-109 — live probes T-068; DATA-010; DATA-011) · 86 TESTED (sessions 1–10 + the 11th session 2026-08-31: BUSINESS-002/003/005/100/101/104, DEAD-015, HOMEWORK-100, ATT-100, DEAD-100 + TENANT-105/106 via migration 0057 live 6/6, CACHE-100, CROSS-001/003, WEAK-005; 12th session: see change-log; 13th session: ACAD-100, ACAD-101, BUSINESS-004, PUSH-102, SYNC-104, SYNC-105, REG-001, WEAK-009, SEC-006, CACHE-101, WEAK-010, PUSH-103, DRIFT-006, WEAK-007, BUSINESS-007, WEAK-006, WEAK-008, DEAD-007, DEAD-008, DEAD-009, DRIFT-007, ATT-103, SEC-004, SEC-005; 16th session 2026-09-01: DATA-008 extended to corpus-level VERIFIED) · NEW session 11: BUG-NEW-004 (run-overdue-scan EF hits WORKER_RESOURCE_LIMIT — registered by session 12's closeout from the T-068 commit evidence; the 11th session's commit named it but never registered it). Evidence: change-log sessions 10–13 + 15–16. Counts synced to the detailed entries (authoritative) this session.

> NOTE: the index table rows are kept in sync opportunistically — the DETAILED entries (`### ID`) are the authoritative status records. If a row and its entry disagree, trust the entry.

## Index (by ID)

| ID | Sev | Status | Task | Title |
|---|---|---|---|---|
| SEC-001 | High | TESTED | T-055 | Edge Functions swallow audit-log write failures silently |
| SEC-002 | High | TESTED | T-055 | `defaultLLMAdapter` falls back from edge function → BYOK → mock, silently leaking user prompts to Groq/OpenRouter if Edge Function is down |
| SEC-003 | Low | DEFERRED | T-076 | Committed `google-services.json` contains a real Firebase API key + project number |
| SEC-004 | Medium | TESTED | T-064 | `SupabaseConfigDialog` displays the Supabase anon key in plain text + references "Google AI Studio" secrets panel in user-facing text — FIXED 2026-08-31 (T-064): key masked + no toolchain leak |
| SEC-005 | Medium | TESTED | T-064 | `SupabaseClientProvider.build()` falls back to `https://demo.supabase.co` with key `"demo-key"` when unconfigured — real network requests go out to that public endpoint — FIXED 2026-08-31 (T-064): inert .invalid fallback, zero real-host calls; placeholder detection complete |
| SEC-006 | Medium | TESTED | T-050 | `OnlineDetector` probed `https://supabase.com/auth/v1/health` every 30 seconds when unconfigured — FIXED 2026-08-31 (T-050, 13th session): no third-party fallback exists anymore; unconfigured = NO probe at all (connectivity-only); probes throttled (10s min interval + in-flight guard); Android suite 234/234 |
| SEC-007 | Critical | TESTED | T-009 | Mock-auth hydration runs unconditionally on every mount; bypasses the `NEXT_PUBLIC_MOCK_AUTH_ENABLED` feature flag |
| SEC-008 | Critical | OPEN | T-031 | `enforce_parent_self_update_columns` trigger has no `has_role('parent')` check — blocks ALL staff updates to parent identity fields |
| SEC-100 | Critical | TESTED | T-001 | Desktop login screen ships 9 hardcoded staff credentials as quick-fill buttons (in git) |
| SEC-101 | Critical | TESTED | T-002 | Android LocalAuthRepository grants SUPER_ADMIN on ANY failed/empty Supabase login (offline fallback) — FAIL-CLOSED 2026-08-29 (T-002) |
| SEC-102 | Critical | TESTED | T-002 | Android infers role from email substring EVEN WHEN Supabase auth succeeds; defaults to SUPER_ADMIN if role lookup fails — server-side role resolution 2026-08-29 (T-002) |
| SEC-103 | High | TESTED | T-003 | Desktop auth-provider.changePassword is a NO-OP — never calls Supabase to update the password |
| SEC-105 | High | TESTED | T-004 | Anonymous invocation of 4 cron EFs (no auth check when no Authorization header) — fixed 2026-08-29, live curl matrix pending |
| SEC-106 | High | TESTED | T-084 | register_fcm_token RPC accepts p_user_id parameter without verifying caller identity (push notification interception) — caller verification added by migration 0050 (applied live 2026-08-30); cross-user denial with real JWTs still to be proven (single auth user exists) |
| SEC-107 | High | OPEN | T-008 | approve-signup-request EF allows support_staff → super_admin role escalation |
| SEC-108 | High | OPEN | T-007 | handle_new_auth_user trigger trusts raw_app_meta_data.tenant_id and raw_user_meta_data.requested_role (multi-tenant injection + role escalation at signup) |
| SEC-109 | High | VERIFIED | T-068 | extractAuthContext calls current_user_permissions() via service_role — permissions array is always empty in EFs (RBAC broken for non-super_admin) |
| SEC-110 | High | OPEN | T-006 | bind_activation_code RPC is SECURITY DEFINER + accepts p_auth_user_id parameter without verifying caller (direct RPC account takeover) |
| SEC-111 | High | OPEN | T-006 | `upsert_payment_from_import` is SECURITY DEFINER (RLS-bypassed); canonical payment RPCs are not |
| SEC-112 | High | OPEN | T-006 | `revert_payment_allocation` SQL RPC has no tenant_id verification; cross-tenant refund possible |
| TENANT-100 | Critical | OPEN | T-005 | `current_user_roles()` ignores tenant_id → cross-tenant role inheritance |
| TENANT-101 | Medium | OPEN | T-005 | `user_profiles_admin_update` RLS policy has no tenant_id check → cross-tenant user modification |
| TENANT-103 | Medium | TESTED | T-053 | Desktop's `getTenantId()` falls back to DEMO UUID when session is missing or user is a global admin |
| TENANT-106 | Critical | TESTED | T-025 | `student_academic_histories` table is INACCESSIBLE to authenticated users; desktop's batch promotion flow fails at the history upsert (extends DEAD-100 with concrete user-facing breakage) |
| BUSINESS-001 | Critical | OPEN | T-016 | `reconcileFinancials()` runs only 4 of 6 canonical cross-checks |
| BUSINESS-002 | Critical | TESTED | T-011 | `SupabasePaymentRepository.collect()` silently falls back to non-atomic upsert on RPC failure |
| BUSINESS-003 | High | TESTED | T-014 | `SupabasePaymentRepository.refund()` hardcodes `"Manual refund"` as the reason, drops user's reason + actor identity |
| BUSINESS-004 | High | TESTED | T-041 | `SupabaseStudentRepository.promote()` returns "not implemented" error in production — FIXED 2026-08-31 (T-041, 13th session): promote() implemented on the canonical `execute_batch_promotion` RPC path (migration 0059, live 10/10); desktop suite 2146 green |
| BUSINESS-005 | Medium | TESTED | T-060 | `UnifiedPaymentModal` defaults `category` to "tuition" for the waterfall preview when input is null |
| BUSINESS-007 | Medium | TESTED | T-026 | `LedgerEngine.maxDaysOverdueFromLedger` uses charge's `at` (creation date) instead of due date — inconsistent with canonical overdue rule — FIXED 2026-08-31 (T-026): due-date based |
| BUSINESS-100 | Critical | TESTED | T-012 | `bulkCollect` silently drops failed chunks; Excel importer thinks everything succeeded |
| BUSINESS-101 | High | TESTED | T-013 | `markClearedFallback` produces NO audit log entries and discards actor identity |
| BUSINESS-102 | High | OPEN | T-017 | Android refund has no idempotency check; re-refunding an already-refunded payment creates duplicate reversal entries and double-reverts installments |
| BUSINESS-104 | Medium | TESTED | T-013 | `markClearedFallback` uses sequential `await` per installment; swallows per-installment errors causing cascading over-allocation |
| CROSS-001 | Critical | TESTED | T-048 | Migration numbering conflict between desktop and website Supabase folders |
| CROSS-003 | High | TESTED | T-048 | Android repo's supabase/migrations folder is a partial copy missing the base schema |
| CROSS-004 | Low | OPEN | T-028 | `bind-activation-code` Edge Function had to be patched to accept both `code` and `activation_code` body keys |
| CROSS-005 | Critical | BLOCKED | T-059 | Android `LocalPaymentRepository.collect()` bypasses the canonical `collect_payment` RPC |
| CROSS-009 | High | BLOCKED | T-028 | Website's `bind-activation-code` Edge Function is a drifted duplicate of the desktop's canonical version (no shared helpers, no audit log, different body key handling) |
| CROSS-100 | Medium | TESTED | T-001/T-002 | Demo account emails and passwords diverge between Desktop and Android (financial@ vs finance@) — both demo lists removed 2026-08-29 |
| CROSS-101 | Critical | BLOCKED | T-066 | `receipts` table is orphaned; website's receipt download is permanently broken |
| CROSS-102 | High | OPEN | T-017 | Android refund sync payload drops the user's refund reason; server audit log has no reason |
| CROSS-103 | High | OPEN | T-017 | Android refund sync does NOT push installment state changes; server-side installments stay stale |
| CROSS-104 | High | OPEN | T-034 | Desktop SupabasePaymentRepository cache never re-seeds from server; no realtime, no manual refresh |
| CROSS-104b | Medium | OPEN | T-034 | Desktop defaultPushHandler persists `sync_queue` row in Supabase for audit trail; Android SyncQueueDispatcher does not |
| CROSS-200 | Critical | OPEN | T-019 | Android sync dispatcher swallows RPC errors silently; desktop sync dispatcher throws and retries |
| SYNC-100 | High | TESTED | T-022 | Desktop defaultPushHandler silently drops installment / homework / grade / attendance entity kinds |
| SYNC-101 | Medium | OPEN | T-022 | Desktop defaultPushHandler overwrites sync_queue row status="pending" on every drain, clobbering audit history |
| SYNC-102 | Medium | OPEN | T-022 | Desktop sync queue persists across logout/login; user A's pending entries stuck as "failed" under user B's session |
| SYNC-103 | High | OPEN | T-020 | Android tryThenEnqueue only enqueues on network/offline/timeout errors; server 500s and validation errors lose the mutation |
| SYNC-104 | Medium | TESTED | T-030 | Android FCM token never unregistered on signOut; device_tokens row stays active for the old user — Android half fixed 2026-08-30 (T-084: deactivate_fcm_tokens on signOut); server residue closed 2026-08-31 (T-030, 13th session): canonical `unregister_fcm_token(p_token)` RPC + rotation-retire on the website (migration 0060, live 9/9) |
| SYNC-105 | Medium | TESTED | T-084 | Website signOut uses scope:"global" (revokes ALL sessions across ALL devices) AND does not unregister FCM tokens — fixed 2026-08-30: unregisterDeviceToken() (canonical RPC) + scope:'local'; build green, 105/105 tests; live browser round-trip pending |
| SYNC-106 | Medium | OPEN | T-021 | Android SyncWorker always returns Result.success() regardless of drainPending/pullAll failures; WorkManager retry escalation bypassed |
| SYNC-107 | Medium | OPEN | T-021 | Android SyncService.syncNow is fire-and-forget; UI thinks sync completed immediately |
| CACHE-100 | Medium | TESTED | T-033 | Website TanStack Query config (staleTime 30s + refetchOnWindowFocus false + retry 1) leaves data stale indefinitely when realtime is broken |
| CACHE-101 | Medium | TESTED | T-050 | Desktop OnlineDetector probed Google with `mode: "no-cors"` every 30s — FIXED 2026-08-31 (T-050, 13th session): probe targets the configured Supabase `/auth/v1/health` (apikey header, cors mode, status readable); unconfigured = zero requests; only 200/401 count as online; desktop suite 2165 green (13/13 new T-050 tests) |
| CACHE-102 | Medium | TESTED | T-022 | Desktop IndexedDB sync queue store silently falls back to in-memory when IndexedDB is unavailable; "sync queued" UI lies to user |
| REALTIME-100 | Medium | OPEN | T-032 | Website messages-view invalidates wrong queryKey prefix; unread badge stays stale forever |
| REALTIME-101 | Medium | OPEN | T-032 | Website markRead UPDATE on chat_messages is RLS-denied for incoming messages; read receipts NEVER persist server-side; errors silently swallowed |
| REALTIME-102 | Medium | OPEN | T-032 | Website useNotificationsRealtime filter `target_user_id=eq.${user.id}` misses role-broadcast notifications |
| REALTIME-103 | Medium | OPEN | T-032 | Website useChatMessagesRealtime(activeChannelId) only subscribes to the open channel; messages in OTHER channels don't trigger unread badge update |
| REALTIME-104 | High | OPEN | T-069 | Android has ZERO Supabase realtime subscriptions; relies entirely on 15-min pullAll cycle for freshness |
| PARENT-101 | High | OPEN | T-029 | `approve_account_request` SQL function silently OVERWRITES `parents.auth_user_id` on re-bind (no orphan check, no audit trail) |
| PARENT-102 | Medium | OPEN | T-008 | Approval-without-target-parent creates "active but unbound" user with no escape path |
| ACAD-100 | High | TESTED | T-041 | Two parallel promotion paths: dead SQL `promote_students` RPC writes to legacy `academic_history` — FIXED 2026-08-31 (T-041, 13th session): dead RPC DROPPED by migration 0059; single canonical atomic `execute_batch_promotion` path (live 10/10) |
| ACAD-101 | Medium | TESTED | T-041 | Academic-year `setCurrentYear` is a non-atomic two-step UPDATE — FIXED 2026-08-31 (T-041, 13th session): atomic `set_current_academic_year` RPC (ONE UPDATE + audit entry, migration 0059, live 10/10); createAcademicYear inserts `is_current=false` then flips |
| ACAD-102 | Medium | DEFERRED | T-073 | `class_subjects.teacher_id` is single-UUID; co-teaching (multiple teachers per subject per class) is structurally unsupported |
| ACAD-103 | Medium | DEFERRED | T-074 | Mid-term section moves have no audit trail; `students.class_id` is updated in place, no `class_transfers` or `enrollment_history` table |
| ATT-100 | Critical | TESTED | T-023 | Desktop roll call upsert is triple-broken (missing tenant_id, missing date, wrong onConflict) |
| ATT-101 | High | TESTED | T-040 | Absence-justification 4-state workflow is structurally broken: no desktop code to review justifications (extends DRIFT-010) |
| ATT-103 | Low | TESTED | T-063 | Android `alertAbsences` has no threshold; alerts for every student in the input (divergence from desktop's 3-absence threshold) — FIXED 2026-08-31 (T-063): ≥3 absences, current term |
| GRADE-100 | Low | DEFERRED | T-075 | `homework.acknowledged_count` column is permanently 0; no code increments it |
| HOMEWORK-100 | Critical | TESTED | T-023 | Desktop homework push omits `tenant_id`; INSERT always fails NOT NULL (extends WEAK-017) |
| HOMEWORK-101 | Critical | OPEN | T-024 | Android homework sync push uses invalid UUID `"hwk-{uuid}"` as `homework.id` |
| HOMEWORK-103 | High | OPEN | T-039 | Android `pullAll` doesn't pull homework/attendance/assessments; cross-platform visibility is one-way only |
| SCHED-100 | Medium | BLOCKED | T-042 | Timetable (Emploi du Temps) feature is structurally unimplemented: domain model + UI KPI exist but no DB table, no Supabase repository, no migration |
| SCHED-101 | Low | BLOCKED | T-042 | `detectTimetableConflict` checks teacher/class overlaps but NOT room conflicts (different teachers, different classes, same room, same time) |
| STUDENT-100 | Critical | OPEN | T-024 | Android promotion sync push silently DROPS grade_level_code (RPC has no such parameter) |
| CHAT-100 | Medium | TESTED | T-071 | `chat_channels_insert` RLS allows any authenticated user to create a channel with arbitrary `member_ids` (no membership validation on insert) |
| CHAT-101 | Medium | TESTED | T-071 | `chat_messages_insert` RLS has no channel-membership check; any user can spam any channel_id they know |
| CHAT-103 | High | TESTED | T-037 | No production code anywhere creates `chat_channels` rows; the website's MessagesView is permanently empty for parents |
| CHAT-104 | Low | TESTED | T-037 | `chat_channels.updated_at` never updates when a new chat_message is INSERTed; channel list is sorted by CREATION time, not last-message time |
| NOTIF-100 | Medium | BLOCKED | T-038 | `notifications_update` RLS blocks recipients from marking role-broadcast notifications as read; bulk mark-read silently no-ops (extends REALTIME-101 from chat_messages to notifications) |
| NOTIF-101 | Medium | OPEN | T-071 | `notifications_insert` RLS allows any authenticated user to INSERT a notification addressed to ANY user_id (notification spam / injection) |
| NOTIF-102 | Low | TESTED | T-052 | Desktop topbar bell `unreadCount` is computed AFTER slicing to 8 items; badge caps at 8 even when actual unread is 50 |
| NOTIF-103 | Low | TESTED | T-052 | Website bottom-nav fetches 1 unread notification but never renders it (dead query); top-app-bar bell caps unread at 50 |
| NOTIF-104 | Medium | BLOCKED | T-038 | Android `NotificationDao.markRead/markAllRead/dismiss` only update LOCAL Room; server's `notifications.is_read` / `dismissed_at` stays at original values forever (silent desync) |
| NOTIF-105 | Medium | OPEN | T-039 | Android `pullNotifications` pulls ALL server-visible notifications (limit:200) with no per-user filter; stale role-broadcasts persist in Room across role changes |
| PUSH-100 | Critical | OPEN | T-036 | NO production code anywhere invokes the `send-push-notification` Edge Function (extends WEAK-014/WEAK-015 to a 3rd compounding bug) |
| PUSH-101 | Medium | OPEN | T-036 | Android `ElImtiyazMessagingService.onMessageReceived` reads `data["type"]` and `data["priority"]` from the wrong field; AndroidManifest has NO deep-link intent filter for `click_action` URLs |
| PUSH-102 | Medium | TESTED | T-030 | `register_fcm_token` RPC had no inverse and silently overwrote `user_id` on shared devices — FIXED 2026-08-31 (T-030, 13th session): migration 0060 conflict-guard (ACTIVE-conflict → 42501; INACTIVE-conflict → explicit audited transfer) + `unregister_fcm_token(p_token)` RPC (live 9/9). The 0050 note claiming the overwrite was already blocked was INACCURATE (register's ON CONFLICT branch was untouched until 0060) |
| PUSH-103 | Medium | TESTED | T-036 | Website's FCM token registration was OPT-IN only — FIXED 2026-08-31 (T-036, 13th session, the unblocked portion): auto-registration after the FIRST user gesture (pointerdown/keydown) — granted → immediate register; default → prompt from the gesture; denied → never; ONE attempt per browser profile (no nagging); the Profile toggle remains the explicit control. Website suite 144/144 (+9). LIVE push delivery still requires the owner's FCM web config + PUSH-100's EF invocation path |
| PUSH-104 | High | OPEN | T-036 | Workflow `send_email` action is a STUB; only `approve-signup-request` EF actually sends email (conditional on RESEND_API_KEY secret); all workflow-driven transactional emails NEVER send |
| ARCH-001 | Critical | OPEN | T-047 | Massive partial migration: 25+ repositories still mock-backed in "Supabase mode" |
| ARCH-002 | Medium | IMPLEMENTED | T-010 | Electron main process registered with `--no-sandbox` in the start script |
| ARCH-003 | High | BLOCKED | T-059 | `RepositoryModule` binds ALL repositories to `Local*Repository` (Room-first) — canonical Supabase RPCs (`collect_payment`, `refund-payment`, `bind-activation-code`, `run-overdue-scan`, `refresh-materialized-views`, `update-server-secret`) are NEVER called from Android |
| ARCH-004 | High | OPEN | T-046 | `fallbackToDestructiveMigration(true)` on production Room database — user data silently wiped on any future schema bump |
| ARCH-005 | Medium | TESTED | T-049 | `next.config.ts` has `typescript.ignoreBuildErrors: true` AND `reactStrictMode: false` — type errors silently shipped to production, React strict-mode bugs hidden — strict builds green 2026-08-29 (T-049) |
| ARCH-006 | Medium | OPEN | T-080 | NEW (2026-08-29): Supabase mode keeps `overdueAlerts` on the mock layer — the "Scan retards" button runs the mock generator against in-memory seed data; the guarded run-overdue-scan EF has no live caller |
| ARCH-007 | High | TESTED | T-081 | NEW (2026-08-29): Android repo does not compile at HEAD — the `./gradlew test` verification gate is broken — gate restored 2026-08-29 (T-081) |
| ARCH-008 | High | OPEN | T-082 | NEW (2026-08-29): the Android lint gate is inoperable — `./gradlew :app:lintDebug` fails with 315 pre-existing NewApi errors; no lint baseline has ever existed |
| ARCH-012 | Medium | OPEN | T-082-adjacent | NEW (2026-08-31, 13th session): `testReleaseUnitTest` fails on `GreetingScreenshotTest` ("Unable to resolve activity" — Robolectric cannot resolve the release-variant launcher activity, applicationId `com.aistudio.elimtiyazstaff.bxmzlx`). PROVEN pre-existing (pristine-tree re-run fails identically) and unrelated to any 13th-session change. The Android `./gradlew test` gate is green only via the DEBUG variant until this is fixed |
| BUG-NEW-001 | High | TESTED | T-083 | NEW (2026-08-30): the `expire_pending_approvals()` SQL RPC references a non-existent `public.users` table; the daily cron EF has been silently failing every day since the RPC was deployed — rewritten by migration 0049 (applied live 2026-08-30, verified: correct table + clean call); EF round-trip with CRON_SECRET pending |
| BUG-NEW-002 | Critical | TESTED | T-084 | NEW (2026-08-30): `mv_dashboard_kpis` join fan-out multiplied every payment by the student count — monthly_revenue showed 21.38 BILLION DZD (true: 54.96M); rebuilt with scalar subqueries by migration 0049 (applied live, values verified) |
| BUG-NEW-003 | High | TESTED | T-084 | NEW (2026-08-30): zero indexes on all four MVs — every scheduled `REFRESH MATERIALIZED VIEW CONCURRENTLY` failed; unique indexes added by migration 0049 (applied live, concurrent refresh verified) |
| BUG-NEW-004 | High | VERIFIED | T-095 | run-overdue-scan EF hits WORKER_RESOURCE_LIMIT after the auth gate — N+1 per-parent compute_parent_summary + per-installment dedup queries (258+ round trips) exceed the edge worker budget; the daily overdue scan cannot complete |
| DATA-001 | Critical | VERIFIED | T-085/T-103 | FIXED 2026-09-01 (T-103, migration 0062): waterfall backfill replayed all 888 payments → 1,310 payment_allocations, 860 payments linked; live verify 8/8 (`scripts/verify_t-103.sql`) |
| DATA-002 | Critical | VERIFIED | T-085/T-103 | FIXED 2026-09-01 (T-103): payments-table V2_ALT row corrected 90,000→100,000 to match the ledger + source Excel (row 235, col 2V); 0 residual disagreements |
| DATA-003 | High | VERIFIED | T-085/T-103 | FIXED 2026-09-01 (T-103): root cause fully classified — missing transport charges (34 parents, +2.06M), dettes charges without tranches (2 parents), one overstated schedule (36,500) + −9.71M remise adjustments; all repaired; 0/258 residual mismatch |
| DATA-004 | Medium | VERIFIED | T-085/T-103 | FIXED 2026-09-01 (T-103): expected_amount/excess_amount/excess_remark populated on all 888 payments from the waterfall replay; desktop mapPaymentRow surfaces them (10-test suite) |
| DATA-005 | Medium | PARTIAL | T-085 | NEW (2026-08-30): parents.first_name empty string on ALL 258 rows (names only in display_name/last_name) — portal mitigated via formatParentName; data repair open |
| DATA-006 | Medium | OPEN | T-086 | NEW (2026-08-30): parent portal has zero eligible real users (1/258 parents with email, 0 activation codes, 0 auth bindings) — onboarding campaign needed |
| DATA-007 | Low | OPEN | T-087 | NEW (2026-08-30): test residue live — `_eq_test_fn`/`_eq_test_fn2` RPCs exposed, unconfirmed test auth user, expired approval request |
| DATA-008 | High | VERIFIED | T-103/T-105 | NEW (2026-09-01, owner-reported): Finance tab vs parent dossier financial divergence (owner report: "paid 100k" vs "30k paid / 40k remaining / 30k créance") — read surfaces used divergent sources + installments data corrupt; FIXED by 0062 reconciliation + canonical INV-4-family helpers; EXTENDED (T-105, 2026-09-01): corpus-level equivalence proven against the source workbook — 259/259 parents × 6 checks (`scripts/verify_t-105.sql`) after migration 0063 closed the residual DATA-010/011 data-layer defects |
| DATA-009 | Medium | OPEN | T-104 | NEW (2026-09-01, T-103 discovery): canonical writer double-counts parent_credit in the raw ledger balance (charge 100k + payment −150k + credit −50k → totalOutstanding −100k for a 50k overpayment); historical corpus deliberately NOT back-filled with credit entries; NOTE (T-105): the corpus is now aligned to the workbook, where only 2 parents hold a genuine credit (−30,000 / −22,000) — the shape question remains open for NEW overpayments only |
| DATA-010 | Critical | VERIFIED | T-105 | NEW (2026-09-01, T-105 discovery): DOUBLE-REMISE — the Excel import wrote the DEVIS charge from column L (ALREADY net of remise: L's formula is `components − J`, verified 390/390) and THEN a separate "Remise sur devis" −J adjustment — 223 parents double-discounted, Σ −9,709,700 DZD; parents who paid their exact devis showed fake credits. FIXED by migration 0063 (compensating adjustments) + the importer fix (no REMISE ledger entry + tranche-to-ledger reconciliation); live 259/259 |
| DATA-011 | Critical | VERIFIED | T-105 | NEW (2026-09-01, T-105 discovery): workbook row 242 (SIDI MAMER SAMYI, phone 0554288142, devis 255,000, versements 255,000, créance 0) was NEVER imported — same-name identity collision with row 235's student under parent 0550067500; the family (parent + student + tranches + charge + 3 payments) is created by migration 0063 exactly per the workbook; live balance 0 ✓ |
| DRIFT-001 | High | PARTIAL | T-018 | Mock parent repository uses `Math.random()` for `parent_code`, violating canonical §7.1 |
| DRIFT-003 | Medium | DEFERRED | T-077 | Repository selection happens at module load; config changes require app restart |
| DRIFT-005 | Low | OPEN | T-056 | `update-server-secret` uses audit action `server_secret.update`/`.delete` not in canonical `AuditActions` registry |
| DRIFT-006 | Medium | TESTED | T-026 | Multiple iterations of "canonical overdue" rule across desktop engine, SQL function, and equivalence framework — RESOLVED 2026-08-31 (T-026): canonical INV-4 rule on Android |
| DRIFT-007 | Low | TESTED | T-062 | `SupabaseModule.kt` comment is outdated — claims "future remote sync can push local Room writes to Supabase by swapping @Binds" but SyncSupport already does the push — FIXED 2026-08-31 (T-062): KDoc describes real wiring |
| DRIFT-009 | Medium | TESTED | T-057 | Canonical engine port ships ~20 calc files but only ~6 functions are used; `canonical/index.ts` barrel is never imported |
| DRIFT-010 | Low | TESTED | T-065 | `attendance-view.tsx` comment says "The portal CANNOT submit justifications — that's a desktop workflow" but the code imports, renders, and wires the AbsenceJustificationDialog |
| DRIFT-011 | High | PARTIAL | T-015 | Receipt-number generation logic is duplicated across 5 code paths with 5 different algorithms |
| DUP-001 | High | OPEN | T-043 | Four parallel cross-platform equivalence test frameworks |
| DUP-002 | High | OPEN | T-043 | Duplicate `kotlin_mirror_engine.ts` in two locations with drifted logic |
| DUP-003 | High | OPEN | T-044 | Two parallel Compose design systems with 18 same-named duplicate component classes |
| DUP-004 | Medium | OPEN | T-044 | Two `ElImtiyazTheme` composables with the same name in different packages |
| DUP-005 | High | BLOCKED | T-045 | Two parallel Room entity / DAO / mapper layers coexist in the same database (partial migration) |
| REG-001 | High | TESTED | T-058 | Chain of 9 "canonical engine unification" fix-up migrations — GUARD IN PLACE 2026-08-31 (T-058, 13th session): scripts/check-migrations-append-only.sh machine-enforces the append-only rule (working tree + baseline diff + header/naming discipline), wired into npm test + npm run check:migrations; matrix 9/9, suite 6/6 |
| REG-002 | High | OPEN | T-046 | 8 Room migrations are fix-up migrations for previous regressions — same iterative bug-fix pattern as desktop's REG-001 |
| WEAK-003 | Medium | OPEN | T-056 | `mapLedgerRow` falls back from `entry_type` to `actor_id` for the entry type |
| WEAK-004 | Low | OPEN | T-056 | `ledger-seed.ts` computes `dueDate` then discards it (`void dueDate;`) |
| WEAK-005 | Medium | TESTED | T-060 | Mock `student-repository.batchRegister` uses the deterministic discount engine but ignores `previousGradeLevel` and `previousRank` |
| WEAK-006 | Critical | TESTED | T-054 | `LocalInstallmentRepository.regenerateForCycle()` is hollow — only writes audit log, doesn't actually regenerate installments — FIXED 2026-08-31 (T-054): real re-derivation |
| WEAK-007 | Critical | TESTED | T-026 | Dashboard "Créances en Retard" KPI + Debt Dashboard overdue amount are PERMANENTLY 0 (missing `overdueCategoryDueDates` map) — FIXED 2026-08-31 (T-026): map passed at every call site |
| WEAK-008 | Medium | TESTED | T-054 | `LocalWorkflowRepository.toDomain()` hardcodes `trigger = WorkflowTrigger.fromCode("manual")` for every run — FIXED 2026-08-31 (T-054): real trigger column |
| WEAK-009 | High | TESTED | T-050 | `OnlineDetector` always reported "online" — FIXED 2026-08-31 (T-050, 13th session): fail-closed initial state; isOnline() = combined connectivity AND probe; probe catch returns false; verdict 200/401 only; redirects not followed (captive portal rejected) |
| WEAK-010 | Medium | TESTED | T-050 | `pullAll()` fired from 6 call sites, SyncWorker TWICE per tick — FIXED 2026-08-31 (T-050, 13th session): in-flight + 10s dedup window gate in pullAll; SyncWorker/syncNow duplicate pulls removed (drainPending's trailing pull is the single per-tick pull) |
| WEAK-011 | Medium | OPEN | T-051 | `audit()` helper hardcodes demo tenant ID + never captures actor role |
| WEAK-012 | High | OPEN | T-051 | `PullSyncRepository.pullParents` / `pullStudents` fallback table select has NO tenant filter — multi-tenant data leak risk |
| WEAK-016 | High | OPEN | T-032 | `useHomeworkRealtime` subscribes to the LEGACY `homework_assignments` table with a `target_class_id` filter; the canonical table is `homework` (migration 0029) using `class_id` — realtime is silently broken |
| WEAK-017 | Medium | OPEN | T-057 | Typed `Database` interface has `homework_assignments` (legacy 0004) but NOT `homework` (canonical 0029) — queries use `as unknown as` cast, no type-checking |
| WEAK-018 | Medium | OPEN | T-035 | Dashboard "next installment" KPI uses non-canonical `amount_due - amount_paid` (cleared-only); financial-view uses canonical `installmentRemainingAmount` (due - paid - pending) — cross-view inconsistency |
| WEAK-019 | Medium | OPEN | T-027 | `attendance-view.tsx` computes attendance rate as `present / total` (excludes late); canonical rule (per portal-derive.ts) is `(present + late) / total` — dashboard uses canonical, attendance-view doesn't |
| WEAK-020 | Low | OPEN | T-056 | `paymentStatusTone` doesn't handle `cancelled` or `pending_clearance` statuses — renders the raw status string instead of a translated label |
| WEAK-021 | Low | VERIFIED | — | README claims "68 tests passing" and DONE.md claims "68/68" but the actual count is 87 (after commit 03f6365 added 19 new tests) |
| WEAK-022 | Medium | OPEN | T-035 | `useLedgerEntries` fetches with `.limit(500)`; `portalFinancialSummary` replays ONLY 500 entries — balance computation is WRONG for parents with > 500 ledger entries |
| WEAK-023 | Medium | TESTED | T-065 | `useUnreadChatCount` fetches 500 messages across ALL channels (no channel filter in query), counts client-side — comment claims "200 per channel" |
| WEAK-100 | Medium | OPEN | T-072 | Activation codes use Postgres random() (non-cryptographic); 7-digit space is brute-forceable; no rate limit on website activation endpoint |
| WEAK-101 | Medium | TESTED | T-002 | Android LocalAuthRepository stores user UUID as accessToken (fake JWT that doesn't validate server-side) — real JWT stored 2026-08-29 (T-002) |
| WEAK-200 | Medium | OPEN | T-061 | `enforce_payment_proof` trigger runs on EVERY payment INSERT/UPDATE; Android refund sync triggers re-validation of unchanged proof fields |
| DEAD-002 | Medium | OPEN | T-056 | `update-server-secret` Edge Function exports a `handleDelete` that is never wired |
| DEAD-007 | Low | TESTED | T-062 | `AuditActions.kt` contains many audit action constants that the Android app never invokes — FIXED 2026-08-31 (T-062): 76 constants removed |
| DEAD-008 | Low | TESTED | T-062 | `StubRepositories.kt` is a 2-line stub file with only a comment — FIXED 2026-08-31 (T-062): file deleted |
| DEAD-009 | Low | TESTED | T-062 | `ElGalleryActivity` (833 lines across gallery files) is NOT declared in `AndroidManifest.xml` — unreachable in production — FIXED 2026-08-31 (T-062): gallery deleted, APK 29.8 MB |
| DEAD-012 | High | PARTIAL | T-049 | `vitest.config.ts` references `./src/test/setup.ts` which DOES NOT EXIST; DONE.md and worklog.md both claim it was created |
| DEAD-013 | Low | OPEN | T-049 | `package.json` `icons:generate` script hardcodes path `/home/z/my-project/scripts/generate-pwa-icons.py` (OUTSIDE the repo) — broken on any other machine/CI |
| DEAD-014 | Low | OPEN | T-056 | `database-schema.ts` barrel is imported by only ONE file (`supabase/client.ts`); all other 14 files import directly from `@/lib/types/database` |
| DEAD-015 | Critical | TESTED | T-014 | Desktop refund flow is completely dead UI; no refund button exists anywhere |
| DEAD-016 | Critical | BLOCKED | T-067 | `collect-payment` and `refund-payment` Edge Functions are never invoked by any client |
| DEAD-100 | Medium | TESTED | T-025 | Migration 0029 RLS policies use fn_current_tenant_id() (never-set session setting) — dead code that does nothing |
| DEAD-200 | Medium | BLOCKED | T-070 | `parent_student_links` table is unused; multi-guardian family feature is structurally unimplemented |
| DEAD-201 | Medium | TESTED | T-078 | Desktop `npm run lint` is UNRUNNABLE — repo has no ESLint config file at all (ESLint 9 requires `eslint.config.js`); documented verification gate in AGENTS.md §11 cannot execute — fixed 2026-08-29, 307-warning baseline documented |

---

## Security & Access Control

### SEC-001 — Edge Functions swallow audit-log write failures silently

- **Category:** SEC  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop, Website
- **Task:** T-055 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-055, 12th session): writeAuditLog retries once then throws the typed AuditWriteError (loud [AUDIT-MISS] marker) — no silent nulls; withAuditSurfacing converts the throw into a structured 500 audit_write_failed; all 8 EFs calling writeAuditLog are wrapped; run-overdue-scan catches per-tenant and counts audit_failures in its response. EFs redeployed live; post-deploy sanity green.
- **Consolidated from:** first-pass SEC-001
- **Description:** The shared helper `writeAuditLog()` in `_shared/supabase.ts:90-121` calls the `write_audit_log` RPC. If the RPC fails, it `console.error`s the error and returns `null` — it does NOT throw. Every caller (collect-payment, refund-payment, bind-activation-code, update-server-secret, etc.) `await`s `writeAuditLog()` but never checks the return value. The canonical spec §7.6 mandates "Every mutation MUST emit at least one audit entry." If the audit write fails, the mutation still succeeds — the audit entry is silently missing. This breaks the canonical audit-trail invariant.
- **Location:** `elimtiyaz-desktop/supabase/functions/_shared/supabase.ts:90-121`
- **Evidence:** Audit evidence (Confirmed). Git: `_shared/supabase.ts` last modified in `9e1e774` (2026-08-12 "kay"). The `console.error` + return null pattern has been there since the file was created.
- **Root cause:** The helper was written defensively (never throw on audit failure, to avoid breaking the main operation). But the design decision means audit failures are silently swallowed — the canonical invariant is violated without anyone noticing.
- **Current behavior:** The canonical RPC's audit log (inside the transaction) succeeds atomically with the mutation. The edge function's separate audit log (outside the transaction) can fail silently — producing a partial audit trail (the canonical entry from inside the RPC + the missing entry from the edge function's belt-and-suspenders call).
- **Expected behavior:** The canonical RPCs (`collect_and_allocate_payment`, `revert_payment_allocation`, etc.) write audit logs INSIDE the same transaction — atomic. The edge function's "belt-and-suspenders" audit log (per `refund-payment/index.ts:124-126`) is a SEPARATE write that can fail without affecting the RPC.
- **Proposed resolution:** The canonical RPCs (`collect_and_allocate_payment`, `revert_payment_allocation`, etc.) write audit logs INSIDE the same transaction — atomic. The edge function's "belt-and-suspenders" audit log (per `refund-payment/index.ts:124-126`) is a SEPARATE write that can fail without affecting the RPC.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-002 — `defaultLLMAdapter` falls back from edge function → BYOK → mock, silently leaking user prompts to Groq/OpenRouter if Edge Function is down

- **Category:** SEC  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-055 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-055, 12th session): hasMaskedContent guard — both network transports (edge ai-proxy + BYOK) REFUSE empty/whitespace maskedContent (Err before any network call); the local mock may still use the raw prompt (never leaves the machine). 9-test suite incl. the routing-degrades-to-mock case.
- **Consolidated from:** first-pass SEC-002
- **Description:** The `defaultLLMAdapter.generate()` routing logic (`llm-adapter.ts:453-468`) tries the `ai-proxy` Edge Function first; on failure, falls back to `byokLLMAdapter` (direct call to Groq/OpenRouter with the admin's API keys); on failure, falls back to `mockLLMAdapter`. The canonical spec §11.02 says "PII is masked BEFORE the call: only `AIRequest.maskedContent` crosses the network". The BYOK adapter does use `request.maskedContent || request.userPrompt` (line 370) — but if `maskedContent` is empty/null (e.g., the caller didn't set it), the raw `userPrompt` (which may contain PII) is sent directly to Groq/OpenRouter. The edge function path also has the same fallback (`edgeLLMAdapter` line 271). So if the masking step is skipped by the caller, the raw prompt leaks.
- **Location:** `elimtiyaz-desktop/src/infrastructure/ai/llm-adapter.ts:453-468` (routing) + `:362-437` (BYOK adapter)
- **Evidence:** Audit evidence (Likely). Git: `llm-adapter.ts` last modified in `84dd13f` (2026-08-27 "okay") — the vault §02 verification added the BYOK + edge paths.
- **Root cause:** The `||` operator's truthy-check treats empty string as falsy — a `maskedContent` of `""` (which could happen if the PII-mask step produced an empty result, e.g., the entire prompt was PII) falls back to the raw `userPrompt`. The developer didn't use a stricter null-check (`request.maskedContent !== null && request.maskedContent.length > 0`).
- **Current behavior:** If `maskedContent` is set: PII-safe. If `maskedContent` is empty/null: raw `userPrompt` (potentially containing student names, parent phones, financial details) is sent to Groq/OpenRouter.
- **Expected behavior:** The canonical spec says PII masking must happen before the call; the `||` fallback allows bypassing.
- **Proposed resolution:** The canonical spec says PII masking must happen before the call; the `||` fallback allows bypassing.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-003 — Committed `google-services.json` contains a real Firebase API key + project number

- **Category:** SEC  |  **Severity:** Low  |  **Status:** DEFERRED
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-076 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass SEC-003
- **Description:** The committed `app/google-services.json` contains a real Firebase API key (`AIzaSyAzDjnuF7QMh3jWZAoJYiIxohfAD7Ba3_8`) and project number (`259221439109`) and project ID (`elimtiyaz-android`) and storage bucket (`elimtiyaz-android.firebasestorage.app`) and mobilesdk_app_id (`1:259221439109:android:601b499c8bf53e24fa1fec`). While Firebase Android API keys are technically "public" (they ship in the APK), they're not typically committed to version control — anyone with the file can send push notifications to the project's devices (if they have the FCM server key, which they don't from this file alone).
- **Location:** `elimtiyaz-android/app/google-services.json`
- **Evidence:** Audit evidence (Confirmed). Git: File committed in `9c19424` "mid" (2026-08-14); never modified since
- **Root cause:** The `google-services.json` is required by the Google Services Gradle plugin at build time. The developer committed it to make `./gradlew assembleDebug` work out of the box without requiring each developer to download their own `google-services.json` from the Firebase console. This is a common but discouraged practice.
- **Current behavior:** N/A
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Status note:** Firebase Android API keys are public by design (they ship in every APK). Rotation is a hygiene measure, not a vulnerability fix; requires Firebase console access the repo cannot provide.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-004 — `SupabaseConfigDialog` displays the Supabase anon key in plain text + references "Google AI Studio" secrets panel in user-facing text

- **Category:** SEC  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-064, 13th session): the anon-key field is masked by default (PasswordVisualTransformation + show/hide IconButton); the helper text no longer mentions "Google AI Studio" (.env guidance only). Pinned by SupabaseConfigSecurityT064Test source-scan pins.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-064 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass SEC-004
- **Description:** The `SupabaseConfigDialog` composable accepts `currentKey: String` and renders it in an `OutlinedTextField` with NO `visualTransformation` (no Password visual) — the anon key is shown in plain text on the screen. Anyone shoulder-surfing or screen-recording can read it. Additionally, the dialog's helper text says "💡 Vous pouvez aussi configurer SUPABASE_URL et SUPABASE_ANON_KEY directement dans le panneau Secrets de Google AI Studio." — this leaks the build/deploy toolchain (Google AI Studio) to end users.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/ui/features/settings/SupabaseConfigDialog.kt:36-105`
- **Evidence:** Audit evidence (Confirmed). Git: `SupabaseConfigDialog.kt` last touched in `176f5d2` "mid" (2026-08-21)
- **Root cause:** The dialog was built for technical staff who need to enter the Supabase URL + anon key. The anon key is technically "public" (it's the publishable key, used in client-side Supabase calls) but it shouldn't be displayed in plain text — it should use `visualTransformation = PasswordVisualTransformation()` with a show/hide toggle.
- **Current behavior:** N/A
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Status note:** Fix is local and safe (PasswordVisualTransformation + copy change).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-005 — `SupabaseClientProvider.build()` falls back to `https://demo.supabase.co` with key `"demo-key"` when unconfigured — real network requests go out to that public endpoint

- **Category:** SEC  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-064, 13th session): NO code path builds a client against demo.supabase.co anymore (URL normalization AND the exception handler) — the inert fallback is https://supabase.unconfigured.invalid (RFC-2606 reserved TLD, can never resolve) + inert-unconfigured-key, so unconfigured builds make ZERO network calls to any real host. Residual scope from T-050 also closed: NetworkTimeouts.isSupabaseConfigured's placeholder detection extracted into the pure, unit-tested looksLikePlaceholderConfig() (hyphen AND underscore variants, "-here" suffixes, quoted values, demo/inert literals). 9/9 tests.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-064 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass SEC-005
- **Description:** When the Supabase URL/key are blank or placeholder, `SupabaseClientProvider.build()` falls back to `supabaseUrl = "https://demo.supabase.co"` and `supabaseKey = "demo-key"` (line 137-142) and constructs a real SupabaseClient against that endpoint. So when the app is "unconfigured", every Supabase SDK call (auth, postgrest, realtime, storage, functions) actually hits `demo.supabase.co` — a public Supabase demo project. The fallbacks to `demo.supabase.co` and `demo-key` are also in the exception handler at line 159-168.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/supabase/SupabaseClientProvider.kt:131-169`
- **Evidence:** Audit evidence (Confirmed). Git: `SupabaseClientProvider.kt` last touched in `dd4c7dc` "kk" (2026-08-26); the SECURITY FIX comment at line 69-72 says "no hardcoded production fallback" but then line 137-142 hardcodes `demo.supabase.co` — a partial security fix that closed the production-leak hole but left the demo-leak hole open.
- **Root cause:** The Supabase Kotlin SDK requires a non-empty URL and key to construct a client. The developer chose `demo.supabase.co` as a "neutral public endpoint" rather than throwing or returning null. The intent was to make the client constructible in any state, but it leaks metadata (the app pings demo.supabase.co on every cold start).
- **Current behavior:** N/A
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Status note:** Fix is local and safe (fail closed when unconfigured instead of demo endpoint).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

- **Discovery note (2026-08-29, T-019 session):** the `.env.example` placeholder values PASS `NetworkTimeouts.isSupabaseConfigured` — `https://YOUR_PROJECT.supabase.co` contains `YOUR_PROJECT` with an UNDERSCORE, which defeats the `your-project` hyphen check, and `your-anon-key-here` is not caught by the `your-anon-key` equality check. An app left on example values therefore reports 'configured' and attempts real network calls. Folded into T-064's fix scope (fail-closed detection must catch the example values too).

### SEC-006 — `OnlineDetector` probes `https://supabase.com/auth/v1/health` every 30 seconds when unconfigured — metadata leak + battery drain

- **Category:** SEC  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-050, 13th session): the third-party fallback host is DELETED. Unconfigured builds make ZERO network probes (connectivity-only mode); configured builds probe their OWN `/auth/v1/health` at most every 30s, throttled to 10s minimum spacing + an in-flight guard (ConnectivityManager callback storms can no longer multiply probes). Placeholder detection now survives the YOUR_PROJECT underscore variant (the SEC-005/T-064 weakness — verified by the new unit tests).
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-050 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass SEC-006
- **Description:** `OnlineDetector` runs a 30-second periodic HTTP probe (line 98-103). The probe URL is derived from `BuildConfig.SUPABASE_URL` when configured, or falls back to `https://supabase.com/auth/v1/health` when unconfigured (line 56-67). So a fresh-checkout Android app pings `supabase.com` every 30 seconds forever — leaking the user's IP address and the fact that "this device runs an app that knows about Supabase" to Supabase Inc.'s servers. The probe also fires on every `onAvailable`/`onCapabilitiesChanged` ConnectivityManager callback (line 73, 83) — could be dozens per minute on a flaky network.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/OnlineDetector.kt:56-68, 87-105, 118-130`
- **Evidence:** Audit evidence (Confirmed). Git: `OnlineDetector.kt` last touched in `cfac666` "suace" (2026-08-17)
- **Root cause:** The probe was designed to confirm the device has REAL internet (not just a ConnectivityManager "active" state which can be a captive portal). The fallback to `supabase.com` was chosen as a "neutral public endpoint" but leaks the device's IP to Supabase Inc. every 30 seconds.
- **Current behavior:** N/A
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-007 — Mock-auth hydration runs unconditionally on every mount; bypasses the `NEXT_PUBLIC_MOCK_AUTH_ENABLED` feature flag

- **Category:** SEC  |  **Severity:** Critical  |  **Status:** TESTED (fixed 2026-08-29, task T-009)
- **Status note:** RESOLVED — entire mock-auth system deleted (mock-auth.ts 278 lines, signInWithMock, isMockSession, mount hydration, env flag, i18n keys). Regression tests: `src/app/providers/auth-provider.test.tsx` (planted `mock-auth-session` key → NO authenticated state; no mock API on the context) — failed before the fix (state 'active'), 3/3 pass after. Suite 90/90, build green. Google OAuth is the only auth path. Remaining gap (why TESTED not VERIFIED): real OAuth round-trip needs a live backend. Evidence: change-log 2026-08-29 / website commits 864eca6, a3062ee.
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Backend/DB, Website
- **Task:** T-009 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass SEC-007, first-pass REG-003, first-pass DEAD-010
- **Description:** The AuthProvider's `useEffect` on mount calls `getMockSession()` and, if a `mock-auth-session` key exists in localStorage, hydrates the auth state to a full mock administrator session — without checking `isMockAuthEnabled`. The visible "Mock Admin Login" button on the LoginScreen IS gated by `isMockAuthEnabled`, but the underlying `signInWithMock()` function and the localStorage hydration are NOT. The auth-provider's own header comment confirms this: *"This is ALWAYS functional (no feature-flag gating) so testers can use the app immediately."* — directly contradicting the env.ts comment that claims *"Mock admin auth is OPT-IN: it only activates when `NEXT_PUBLIC_MOCK_AUTH_ENABLED === 'true'"*.
- **Location:** `elimtiyaz-website/src/app/providers/auth-provider.tsx` ;; [REG-003] `elimtiyaz-website/src/lib/env.ts:79-90` ;; [DEAD-010] `elimtiyaz-website/src/lib/auth/mock-auth.ts` (entire file, 278 lines)
- **Evidence:** Audit evidence (Confirmed). Git: `auth-provider.tsx` introduced in commit `e90dbf7` "mid" (2026-08-01) with the unconditional hydration. The `isMockAuthEnabled` flag was added to `env.ts` in commit `89cc19d` "fkniga" (2026-08-01 17:39). Commit `7ee2457` "kay" (2026-08-01 18:18) inverted the flag to default-on. Commit `03f6365` (2026-08-28) reverted the flag to opt-in but did NOT touch `auth-provider.tsx` — the unconditional hydration remains.
- **Root cause:** The auth-provider was written before the env-flag was added; the author assumed the flag would gate the UI button and didn't think to gate the underlying hydration. The "kay" commit then inverted the flag to default-on (a separate regression — see REG-003). The "fix(portal)" commit reverted the flag but missed the auth-provider.
- **Current behavior:** Production-deployed portal with `NEXT_PUBLIC_MOCK_AUTH_ENABLED` unset (the documented "opt-in" state) STILL hydrates a planted mock session. The flag is a UI-visibility gate, not a security gate.
- **Expected behavior:** N/A — this is a unique bypass.
- **Proposed resolution:** Delete src/lib/auth/mock-auth.ts, the signInWithMock path, and the unconditional hydration in auth-provider.tsx. Keep the real Google OAuth flow only. Test: a planted 'mock-auth-session' localStorage key yields no authenticated state.
- **Dependencies:** none recorded
- **Absorbed findings:** REG-003: The `isMockAuthEnabled` flag in `env.ts` was changed from `env.NEXT_PUBLIC_MOCK_AUTH_ENABLED === "true"` (opt-in) to `env.NEXT_PUBLIC_MOCK_AUTH_ENABLED !== "false"` (default-on) in commit `7ee2457` "kay" (2026-08-01 18:18). With the default-on logic, ANY environment that didn't explicitly set `NEXT_PUBLIC_MOCK_AUTH_ENABLED=false` would have the "Mock Admin Login" button visible on the production login screen — granting full staff permissions (50+ permissions including `admin.users.manage`, `finance.payments.refund`) to anyone who could click a button. The latest commit `03f6365` (2026-08-28) reverted the flag to opt-in with a comment *"The previous default-on behavior shipped a staff-grade bypass on the production login screen."* — confirming this was a recognized regression. However, the OLD misleading comment block *"ENABLED by default in ALL environments (temporary testing phase) ... Set NEXT_PUBLIC_MOCK_AUTH_ENABLED=false to disable"* was NOT removed and still sits directly above the corrected code, contradicting it. | DEAD-010: The file `src/lib/auth/mock-auth.ts` (278 lines) defines a complete mock authentication system: `MOCK_ADMIN_PROFILE` with `status: "active"`, `MOCK_ADMIN_PARENT`, two `MOCK_ADMIN_STUDENTS`, a 50-item `MOCK_ADMIN_PERMISSIONS` array (including `admin.users.manage`, `admin.roles.manage`, `finance.payments.refund`), `MOCK_ADMIN_ROLES = ["admin", "super_admin"]`, `saveMockSession()`/`getMockSession()`/`clearMockSession()` localStorage helpers, and `isMockUser()` sentinel check. The file's own header says *"This entire file (`src/lib/auth/mock-auth.ts`) can be deleted once production authentication (Google via Supabase) is implemented."* — and production auth IS implemented (the AuthProvider uses Supabase Google OAuth). Yet the file remains, is imported by `auth-provider.tsx`, `login-screen.tsx`, and `env.ts`, and the `signInWithMock` function is exposed on the auth context. The DONE.md (line 97) claims *"No mock implementations remaining"* and TODO.md (line 4) claims *"zero mock implementations"* — both FALSE.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-008 — `enforce_parent_self_update_columns` trigger has no `has_role('parent')` check — blocks ALL staff updates to parent identity fields

- **Category:** SEC  |  **Severity:** Critical  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-031 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass SEC-008
- **Description:** The BEFORE UPDATE trigger `enforce_parent_self_update_columns` (migration 0027) raises an exception if ANY of `id, tenant_id, parent_code, first_name, last_name, national_id, relationship, notes, is_active, is_financially_restricted, auth_user_id, deleted_at` changes. Unlike the parallel `enforce_parent_attendance_update_columns` trigger (which gates its restriction on `public.has_role('parent')`), this trigger has NO role check — it fires for EVERY UPDATE to the `parents` table, regardless of who is calling. This means a staff member using the desktop's `SupabaseParentRepository.updateParent()` (which sends `first_name`, `last_name`, `parent_code`, `is_active`, `is_financially_restricted`, `deleted_at` patches) would have EVERY such update rejected with *"Parents can only update contact fields (phone, email, address, occupation)"*.
- **Location:** `elimtiyaz-website/supabase/migrations/0027_portal_parent_rls_policies.sql:147-172` — the trigger function and trigger definition. Verbatim-copied into `elimtiyaz-desktop/supabase/migrations/0043_portal_alignment.sql:258-283`.
- **Evidence:** Audit evidence (Confirmed). Git: Migration 0027 introduced in commit `e90dbf7` "mid" (2026-08-01). The trigger function has no `has_role('parent')` guard. The parallel attendance trigger `enforce_parent_attendance_update_columns` (0027:55-87) DOES have `select public.has_role('parent') into is_parent; if is_parent then ...` — proving the author knew the pattern but didn't apply it to the parents trigger.
- **Root cause:** The author wrote the attendance trigger first (with the role check), then wrote the parents trigger by copying the structure but forgot to add the role check. The trigger was designed assuming only parents would UPDATE the parents table — forgetting that staff (super_admin, support_staff) also UPDATE parents via the desktop. SECURITY DEFINER on the trigger function doesn't help — it just means the trigger EXECUTES with postgres privileges, but the trigger body still runs.
- **Current behavior:** Pre-trigger: staff can freely update any parent field. Post-trigger: staff can ONLY update `primary_phone, secondary_phone, email, address, city, postal_code, occupation` — every other field change raises an exception. The desktop's edit-parent-modal would fail on every save that changes a name, the parent_code, the active flag, or the deleted_at timestamp.
- **Expected behavior:** The website's 0027 is the original; desktop's 0043 absorbed it verbatim.
- **Proposed resolution:** Add the has_role('parent') gate to enforce_parent_self_update_columns so staff updates to parent identity columns are permitted while parent self-updates remain restricted to contact fields. Deploy as a new migration (0044+). Test: staff rename succeeds; parent self-update of first_name still raises.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-100 — Desktop login screen ships 9 hardcoded staff credentials as quick-fill buttons (in git)

- **Category:** SEC  |  **Severity:** Critical  |  **Status:** TESTED (fixed 2026-08-29, task T-001)
- **Status note:** RESOLVED — DEMO_ACCOUNTS array + quick-fill UI deleted from login-screen.tsx; the SAME nine password literals in the mock layer's seedAccounts (seed-data.ts) also removed (mock sign-in now matches on email only — mock layer is bypassed when Supabase is configured); orphaned auth.demoAccounts/useAccount i18n keys removed. Regression test `src/tests/security/no-demo-credentials.test.ts` scans the whole src tree for the nine literals — failed before (both files flagged), passes after. Suite 1957/1957, typecheck clean. Remaining gap (why TESTED not VERIFIED): live login with real accounts needs a running environment; ALSO passwords must still be ROTATED in every deployed environment (deployment action, outside the repo). Evidence: change-log 2026-08-29 / hub commits aa823d4, 9c038eb.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-001 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-100
- **Description:** The production login screen renders a `DEMO_ACCOUNTS` array containing 9 staff email/password pairs in plain text, exposed as one-tap "Comptes démo" buttons that auto-fill the login form.
- **Location:** `elimtiyaz-desktop/src/features/auth/login-screen.tsx`, lines 24-34
- **Evidence:** Audit evidence (Confirmed (file is git-tracked; verified via `git ls-files --error-unmatch`)). Git: Commit `63704051` (2026-08-27, "gg") — most recent touch; `b25e6ca` (2026-08-04, "FKFKFK") — initial commit. File IS tracked in git (the `// ggignore` comment on line 23 is decorative, not a real ignore directive).
- **Root cause:** The DEMO_ACCOUNTS array was meant for local dev convenience but was never stripped before commit. The `// ggignore` comment was misread as a git-ignore directive.
- **Current behavior:** Desktop ships `admin@/admin123`, `financial@/fin123`, `teacher@/teach123`, etc. — 9 unique passwords. Android ships `finance@/demo1234` etc. — single shared password.
- **Expected behavior:** Demo accounts are typically a dev-only convenience. Production should never ship real staff credentials in the client bundle.
- **Proposed resolution:** Remove the DEMO_ACCOUNTS array from the production bundle: gate demo quick-fill behind a dev-only flag (e.g. import.meta.env.DEV) or move credentials out of source control entirely. Rotate all nine passwords in every environment where they exist. Add a unit test asserting the production build ships no credential arrays (grep the built bundle).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-101 — Android LocalAuthRepository grants SUPER_ADMIN on ANY failed/empty Supabase login (offline fallback)

- **Category:** SEC  |  **Severity:** Critical  |  **Status:** TESTED (2026-08-29, T-002)
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-002 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-101
- **Description:** When Supabase auth fails (wrong password, timeout, OR any exception), the Android app falls back to a "demo/offline" mode that creates a valid 24-hour session with the role INFERRED FROM THE EMAIL — defaulting to `Role.SUPER_ADMIN` for any email that doesn't match a known pattern.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt`, lines 74-182
- **Evidence:** Audit evidence (Confirmed (verified `NetworkTimeouts.guard` catches Throwable and returns null at line 83-86 of NetworkTimeouts.kt; verified the Stage 2 fallback fires unconditionally when `userInfo == null`)). Git: Commit `f227de98` (2026-08-14, "Connect mobile app to Supabase") — initial wiring; commits through `08b1d45b` (2026-08-25, "ddd") — most recent touch.
- **Root cause:** The Stage 2 fallback was added as an "offline demo" convenience but the guard condition only checks `if (userInfo != null)` (Stage 1 succeeded), NOT `if (userInfo != null || isSupabaseConfigured)`. So Stage 2 fires whenever Stage 1 returns null — including credential failures, not just unconfigured builds.
- **Current behavior:** Desktop fails closed on bad credentials. Website fails closed. Android grants SUPER_ADMIN on any failure.
- **Expected behavior:** Stage 2 was meant as a "resilient demo / offline fallback" per the comment on line 141. The intended behavior is to fall back ONLY when Supabase is unconfigured (placeholder URL), not when login fails.
- **Proposed resolution:** Remove the Stage-2 offline fallback in LocalAuthRepository.signIn, or restrict it to the case where Supabase is genuinely unconfigured AND the build is a debug build. Fail closed on credential errors. Role must come from role_assignments via RPC, never from email substrings. Add tests: wrong password yields failure; unconfigured+release yields failure.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.
- **Resolution (2026-08-29, T-002 — TESTED):** `signIn` is fail-closed: a configured build + failed/empty sign-in returns `Result.Err` (no session minted). The demo fallback is gated by `AuthEnvironment.isDemoFallbackAllowed()` — unconfigured AND debug build ONLY; release without configuration fails closed. 12-test `LocalAuthRepositoryTest` regression suite (fail-closed on configured failure; no demo session on unconfigured release; fixed demo role with no email inference; source-level guard). Evidence: android commits `1aa34a7` (auth rework) + `89eec61` (demo chips); hub change-log sixth session. Owed for VERIFIED: live sign-in matrix (real wrong-password 401 round-trip + role_assignments-backed session).

---

### SEC-102 — Android infers role from email substring EVEN WHEN Supabase auth succeeds; defaults to SUPER_ADMIN if role lookup fails

- **Category:** SEC  |  **Severity:** Critical  |  **Status:** TESTED (2026-08-29, T-002)
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-002 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-102
- **Description:** Even when Stage 1 (Supabase auth) succeeds, the Android app overrides the role from the database by inferring it from the email's substring, and falls back to `Role.SUPER_ADMIN` if the inference doesn't match.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt`, lines 101-106
- **Evidence:** Audit evidence (Confirmed). Git: Commit `f227de98` (2026-08-14, "Connect mobile app to Supabase")
- **Root cause:** The email-substring role inference was a transitional hack when role_assignments wasn't yet populated for all users. The fallback `else -> Role.SUPER_ADMIN` was meant as a temporary dev convenience but ships in production.
- **Current behavior:** Desktop falls back to SupportStaff (least privilege). Website doesn't derive role client-side. Android falls back to SUPER_ADMIN (max privilege).
- **Expected behavior:** The role should come from `role_assignments` table via a JOIN or RPC, not from email substring matching.
- **Proposed resolution:** Delete the email-substring role inference. Resolve role exclusively from role_assignments (current_user_roles RPC) with least-privilege fallback (e.g. parent / support_staff), never SUPER_ADMIN. Regression test: a signed-in user with no role assignments receives no staff UI.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.
- **Resolution (2026-08-29, T-002 — TESTED):** ALL email-substring role inference deleted (signIn Stage 1, Stage 2, refreshSession). Roles resolve via the canonical `current_user_roles()` RPC (migration 0003 — role_assignments) through the pure `resolveRoleFromAssignments()`: first recognisable code wins, empty/unrecognisable → LEAST-PRIVILEGE support_staff (mirrors the desktop reference client's `Role.SupportStaff` fallback); refreshSession's direct SUPER_ADMIN fallback also removed. Tests pin: no assignments → support_staff + its default permissions only (no MANAGE_SETTINGS/MANAGE_TENANTS/MANAGE_PERSONNEL); a source-level scan forbids re-introducing `contains("…")` role inference (T-001 technique). Evidence: android commit `1aa34a7`; hub change-log sixth session. Owed for VERIFIED: live role_assignments-backed sign-in.

---

### SEC-103 — Desktop auth-provider.changePassword is a NO-OP — never calls Supabase to update the password

- **Category:** SEC  |  **Severity:** High  |  **Status:** TESTED (fixed 2026-08-29, task T-003)
- **Status note:** RESOLVED — `changePassword` added to the `AuthRepository` interface (documented contract: re-authenticate, persist via backend, revoke sessions — Ok means the password REALLY changed), so typecheck now enforces it on every implementation; `AuthProvider.changePassword` delegates to `repos.auth.changePassword` (the pre-existing canonical implementation — reused verbatim, not rewritten); the audit entry is written ONLY after the repository returns Ok (no longer forged); on failure the session is preserved and no audit entry is written; ERR_UNAUTHORIZED maps to the specific French "Mot de passe actuel incorrect." message; mock implements the method per post-T-001 semantics; `AuditActions.AuthPasswordChange` constant added matching Android's wire value. Regression suite `src/tests/security/change-password.test.tsx` (12 tests) — 8 failed before the fix (incl. the task's stated integration test: after a change the old password no longer signs in and the new one does), 12 pass after. Full suite 1969/1969, typecheck clean. Remaining gap (why TESTED not VERIFIED): live round-trip against a real Supabase project from a running desktop build — needs a desktop host + configured backend. Evidence: change-log 2026-08-29 / hub commits 9287595, 2e934ff.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-003 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-103
- **Description:** The desktop's `AuthProvider.changePassword` re-authenticates with the current password and writes an audit log entry, but NEVER calls `repos.auth.changePassword` (which has a real implementation that calls `auth.updateUser({password})`). The user is shown a "password changed" success but their actual Supabase password is unchanged.
- **Location:** `elimtiyaz-desktop/src/app/providers/auth-provider.tsx`, lines 99-149 (the changePassword function)
- **Evidence:** Audit evidence (Confirmed (verified by reading both files in full; the provider never references `repos.auth.changePassword`)). Git: Commit `b25e6ca` (2026-08-04, "FKFKFK") — both auth-provider.tsx and supabase-auth-repository.ts have the same initial commit
- **Root cause:** The provider was implemented before the repository's changePassword was added (or the wiring was forgotten). The provider has its own inline re-auth + audit + clear-session logic that mimics what the repository would do — except it skips the actual password update.
- **Current behavior:** Desktop: silent no-op, user told "success". Android: real password update. Mock: would crash. The audit log entry on desktop is FORGED — it claims `auth.password_change` happened but the password didn't change.
- **Expected behavior:** Per the function's docstring (lines 88-98), it should call `repos.auth.changePassword` after re-authenticating. The docstring even says "Modifying a password automatically revokes all active JWT tokens and terminates active sessions across all devices for that user account. → we clear the local session and write an audit entry." — but the audit entry says "session revoked" while no actual revocation happens.
- **Proposed resolution:** Wire AuthProvider.changePassword to repos.auth.changePassword (which calls auth.updateUser) after re-authentication; only then write the audit entry. Remove the forged 'session revoked' claim or actually revoke sessions. Test: change password, sign out, old password must fail and new password must succeed.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-105 — Anonymous invocation of 4 cron EFs (no auth check when no Authorization header)

- **Category:** SEC  |  **Severity:** High  |  **Status:** TESTED (2026-08-29)
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-004 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-105
- **Description:** `expire-pending-approvals`, `refresh-materialized-views`, `purge-expired-backups`, and `run-overdue-scan` EFs all treat requests with NO `Authorization` header as legitimate cron invocations and execute service_role operations across ALL tenants. The "security" is the assumption that "Supabase Cron's internal service role invocation only" — but the EFs don't actually verify this; anyone can POST without an Authorization header.
- **Location:** - `elimtiyaz-desktop/supabase/functions/expire-pending-approvals/index.ts` lines 42-59 - `elimtiyaz-desktop/supabase/functions/refresh-materialized-views/index.ts` lines 57-72 - `elimtiyaz-desktop/supabase/functions/purge-expired-backups/index.ts` lines 55-70 - `elimtiyaz-desktop/supabase/functions/run-overdue-scan/index.ts` lines 56-78
- **Evidence:** Audit evidence (Confirmed (verified config.toml lines 92, 111, 115, 119 all set `verify_jwt = false`)). Git: Commit `b25e6ca` (2026-08-04, "FKFKFK")
- **Root cause:** The cron EFs were designed to be invokable by Supabase's pg_cron scheduler (which doesn't send a JWT). The author assumed that `verify_jwt = false` + the lack of an Authorization header would only match cron invocations. In reality, ANY external request without an Authorization header matches the same condition.
- **Current behavior:** The 4 cron EFs accept anonymous requests; the others don't.
- **Expected behavior:** Cron EFs should require either (a) a CRON_SECRET bearer token, or (b) a verified internal Supabase cron signature. The comment on line 19-23 of each EF says "Identification is enforced by Supabase Cron's internal service role invocation only." — but Supabase's pg_cron doesn't actually send a service_role key in the Authorization header; it sends a normal HTTP request that the gateway verifies_jwt=false lets through.
- **Proposed resolution:** Require a shared CRON_SECRET bearer token (or verify Supabase's internal cron signature) in expire-pending-approvals, refresh-materialized-views, purge-expired-backups, run-overdue-scan before any service_role operation. Deny by default when the header is absent. Test: anonymous POST returns 401; valid secret executes.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.
- **Status note (2026-08-29, T-004):** RESOLVED in code — new shared guard `supabase/functions/_shared/cron-auth.ts` (pure `isCronAuthorized` + Deno wrapper `isCronInvocation`): accepts `Authorization: Bearer <CRON_SECRET>` or the project's service_role key (managed scheduler), denies EVERYTHING else incl. a missing header; constant-time compare; generic 401 (no probing oracle). All four EFs wired; run-overdue-scan's manual user-JWT path preserved verbatim. Tests: `src/tests/security/cron-auth.test.ts` 19/19 (RED first — import failure before the guard existed); full suite 44 files / 2007 tests; typecheck clean; esbuild syntax-check OK on all 5 files. GAPS (why TESTED, not VERIFIED): live curl matrix (anonymous→401, wrong secret→401, valid secret→executes, per EF) needs a deployed Supabase project; operator must `supabase secrets set CRON_SECRET=…` and ensure each schedule sends the expected header (run-overdue-scan's verify_jwt=true means a CRON_SECRET header would be rejected by the gateway — use the managed scheduler or deliberately flip that setting). New discovery during this task: ARCH-006 (the EF's manual JWT path has no live desktop caller — overdueAlerts stayed on the mock layer).

---

### SEC-106 — register_fcm_token RPC accepts p_user_id parameter without verifying caller identity (push notification interception)

- **Category:** SEC  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-006 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-106
- **Description:** The `register_fcm_token(p_user_id, p_token, p_platform)` SQL function is `SECURITY DEFINER` and accepts `p_user_id` as a parameter. It does NOT verify that the caller's `auth.uid()` matches `p_user_id`. Any authenticated user can register an FCM device token under ANY other user's `user_id`.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql`, lines 344-384
- **Evidence:** Audit evidence (Confirmed (read the function body; no `auth.uid()` check anywhere)). Git: Commit `9e1e7741` (2026-08-12, "kay") for migration 0027
- **Root cause:** The function was designed to be invokable by the Android app via postgrest RPC. The author trusted the caller to pass their own user_id. The SECURITY DEFINER attribute bypasses RLS, so the self-only RLS policy on device_tokens doesn't apply.
- **Current behavior:** Direct INSERTs via `supabase.from('device_tokens').insert(...)` are blocked by RLS (user_id must match). RPC calls bypass RLS and accept any user_id.
- **Expected behavior:** The function should verify `p_user_id = current_user_profile_id()` (or `auth.uid()`) before inserting. The RLS policy `device_tokens_self_insert` (lines 1031-1036) DOES enforce this for direct INSERTs — but the SECURITY DEFINER RPC bypasses RLS, so the policy doesn't apply.
- **Proposed resolution:** The function should verify `p_user_id = current_user_profile_id()` (or `auth.uid()`) before inserting. The RLS policy `device_tokens_self_insert` (lines 1031-1036) DOES enforce this for direct INSERTs — but the SECURITY DEFINER RPC bypasses RLS, so the policy doesn't apply.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-107 — approve-signup-request EF allows support_staff → super_admin role escalation

- **Category:** SEC  |  **Severity:** High  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-008): approve-signup-request EF gates assign_role via the shared decision core _shared/role-assignment.ts (staff roles require super_admin; parent/student overridable by support_staff); unknown role codes -> 400 invalid_role (previously the override was SILENTLY SKIPPED); denied attempts audited as account_approval.role_override_denied; the revoke/insert writes are error-checked. Deployed live via the Management API multipart deploy (v10) — 401 smoke matrix green. 12/12 unit+source-scan tests. GAP: live 403 needs a real support_staff JWT.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-008 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-107
- **Description:** The `approve-signup-request` EF requires only `support_staff` role to call (line 74), but accepts an `assign_role` body parameter that can override the auto-assigned role to ANY role code — including `super_admin`. A support_staff user can escalate themselves or others to super_admin via a pending approval.
- **Location:** `elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts`, lines 213-238
- **Evidence:** Audit evidence (Confirmed). Git: Commit `b25e6ca` (2026-08-04, "FKFKFK")
- **Root cause:** The `assign_role` parameter was added to allow admins to "refine" the role (e.g., assign `financial_officer` instead of `parent` for a staff signup). But there's no validation that `assign_role` is in a safe subset — any role code is accepted.
- **Current behavior:** Desktop UI gates role management behind super_admin. EF allows support_staff.
- **Expected behavior:** Role assignment should be a separate admin-only operation. `support_staff` should be able to approve/reject pending requests but NOT assign arbitrary roles.
- **Proposed resolution:** Validate assign_role against a safe subset (parent) for support_staff callers; require super_admin for any staff role assignment. Reject unknown role codes. Test: support_staff attempting assign_role=super_admin receives 403.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-108 — handle_new_auth_user trigger trusts raw_app_meta_data.tenant_id and raw_user_meta_data.requested_role (multi-tenant injection + role escalation at signup)

- **Category:** SEC  |  **Severity:** High  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved by migration 0054 (auth_trigger_no_client_metadata) — applied live AND registered; reconciled into the local chain 2026-08-31 (see ARCH-011). handle_new_auth_user() now distinguishes admin-invite (app_metadata.created_by_admin, set server-side by the create-user-account EF) from self-signup; self-signup hardcodes requested_role='parent', uses the canonical default tenant, and NULLs client-supplied personal fields. Verified live via pg_get_functiondef (matches the reconciled file).
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-007 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-108
- **Description:** The `handle_new_auth_user()` trigger (migration 0002) reads `tenant_id` from `new.raw_app_meta_data->>'tenant_id'` and `requested_role` from `new.raw_user_meta_data->>'requested_role'`. Both come from the signup request — an attacker can set them to ANY value during Google OAuth sign-up (via the `app_metadata` and `user_metadata` fields).
- **Location:** `elimtiyaz-desktop/supabase/migrations/0002_tenants_and_users.sql`, lines 166-216
- **Evidence:** Audit evidence (Confirmed). Git: Commit `b25e6ca` (2026-08-04, "FKFKFK")
- **Root cause:** The trigger was designed to support admin-invited users (where `app_metadata.tenant_id` is set by the admin) AND self-signup users (where it falls back to the first tenant). But the trigger doesn't distinguish between these paths — it always trusts `raw_app_meta_data`. Supabase's Google OAuth flow lets the client set `user_metadata` freely; admin-only fields like `app_metadata` should be set via admin API only, but the trigger treats them the same.
- **Current behavior:** N/A
- **Expected behavior:** `tenant_id` should be derived from a trusted source (admin invitation, default tenant for self-signup). `requested_role` for self-signup should be hardcoded to `'parent'` (the only self-service role per plan §02.08).
- **Proposed resolution:** Stop trusting raw_app_meta_data/raw_user_meta_data in handle_new_auth_user for self-signups: derive tenant from admin invitation or the configured default, hardcode requested_role to 'parent' for the self-service path. Test: signup with injected metadata cannot select tenant or staff role.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-109 — extractAuthContext calls current_user_permissions() via service_role — permissions array is always empty in EFs (RBAC broken for non-super_admin)

- **Category:** SEC  |  **Severity:** High  |  **Status:** VERIFIED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-068 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-068, 11th session): extractAuthContext now resolves permissions via createUserScopedClient(jwt) — anon key + caller Authorization header so PostgREST derives auth.uid(); resolver errors fail CLOSED. Live-verified: curl matrix (no-auth/invalid/anon → 401), positive probe (support_staff + execute_workflow override → requirePermission PASSED), negative control (without override → 403). workflow-execute + run-overdue-scan redeployed.
- **Consolidated from:** second-pass SEC-109
- **Description:** The shared `extractAuthContext` helper used by all EFs calls `current_user_permissions()` RPC via the `profileClient` (service_role client). Since `current_user_permissions()` uses `auth.uid()` to look up the caller's profile, and service_role has no `auth.uid()`, the RPC returns an empty array. The `requirePermission(ctx, ...)` helper then returns `false` for ALL non-super_admin users — even those with the actual permission in the database.
- **Location:** `elimtiyaz-desktop/supabase/functions/_shared/supabase.ts`, lines 41-89
- **Evidence:** Audit evidence (Confirmed (read current_user_permissions definition in 0003_rbac.sql lines 144-175 — uses `current_user_profile_id()` which uses `auth.uid()`)). Git: Commit `b25e6ca` (2026-08-04, "FKFKFK") for _shared/supabase.ts
- **Root cause:** The `extractAuthContext` helper was written to populate both `roles` and `permissions` for EF use. The author used `profileClient.rpc("current_user_permissions")` thinking it would work the same as the user-scoped call. But `current_user_permissions` is designed to be called by the authenticated user (where auth.uid() resolves), not by service_role.
- **Current behavior:** EFs using `requirePermission`: workflow-execute, run-overdue-scan — block all non-super_admin users. EFs using `requireRole`: approve-signup-request, update-server-secret — work correctly.
- **Expected behavior:** `extractAuthContext` should use a client scoped to the caller's JWT (not service_role) when calling `current_user_permissions`. Or `requirePermission` should re-fetch the permission via a direct query using the user's JWT. Or the helper should query `role_permissions` directly via service_role using the `user_profile_id` it already resolved.
- **Proposed resolution:** `extractAuthContext` should use a client scoped to the caller's JWT (not service_role) when calling `current_user_permissions`. Or `requirePermission` should re-fetch the permission via a direct query using the user's JWT. Or the helper should query `role_permissions` directly via service_role using the `user_profile_id` it already resolved.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-110 — bind_activation_code RPC is SECURITY DEFINER + accepts p_auth_user_id parameter without verifying caller (direct RPC account takeover)

- **Category:** SEC  |  **Severity:** High  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved by migration 0055 (sec_definer_rpc_hardening), applied live + registered 2026-08-31. bind_activation_code now rejects any direct PostgREST caller whose p_auth_user_id != auth.uid() (service_role EF path exempt — it passes the verified JWT's userId; anonymous rejected). Live verification scripts/verify_t-006.sql 9/9 PASS incl. S3 (foreign bind rejected with SEC-110) and S4 (anonymous rejected).
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-006 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-110, second-pass STUDENT-101, second-pass PARENT-103
- **Description:** The `bind_activation_code(p_tenant_id, p_code, p_auth_user_id)` SQL function (migration 0005) is `SECURITY DEFINER` and accepts `p_auth_user_id` as a parameter. It does NOT verify that `p_auth_user_id = auth.uid()` (the caller's actual auth user ID). Any authenticated user can call this RPC directly via postgrest and bind ANY auth_user_id to ANY activation code (if they know the code), enabling account takeover.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0005_crm.sql`, lines 191-243 ;; [STUDENT-101] `elimtiyaz-desktop/supabase/migrations/0005_crm.sql:191-243` (function body — no `WHERE parents.auth_user_id IS NULL` check). ;; [PARENT-103] `elimtiyaz-desktop/supabase/migrations/0005_crm.sql:191-243`. Audit-log infrastructure: `elimtiyaz-desktop/supabase/migrations/0014_audit.sql` (defines `audit_logs` table + `write_audit_log` RPC).
- **Evidence:** Audit evidence (Confirmed). Git: Commit `b25e6ca` (2026-08-04, "FKFKFK") for 0005_crm.sql
- **Root cause:** The function was designed to be called by the EF (which authenticates the caller). The author didn't anticipate direct postgrest invocation. SECURITY DEFINER bypasses RLS so the parents table UPDATE succeeds regardless of who calls it.
- **Current behavior:** EF path: secure (passes JWT user_id). Direct RPC path: insecure (caller supplies any user_id).
- **Expected behavior:** The function should verify `p_auth_user_id = auth.uid()` (the JWT caller) before binding. The EF wraps this correctly (passes `ctx.userId`), but the RPC is also exposed via postgrest and callable directly.
- **Proposed resolution:** Add caller verification to bind_activation_code (assert p_auth_user_id = auth.uid()), guard against silent re-binding (reject or explicitly invalidate the previous binding), and write an audit_logs entry for every bind/rebind. Regression tests: direct RPC call with a foreign user id fails; rebind attempt audited.
- **Dependencies:** UNKNOWN-001 (bind semantics) for the activation side-effects; caller verification itself is independent
- **Absorbed findings:** STUDENT-101: The `bind_activation_code(p_tenant_id, p_code, p_auth_user_id)` SQL function (0005 line 191-243) checks `bound_to_auth_user_id IS NULL` on the activation code row (line 209) — but does NOT check whether the parent's `auth_user_id` is already set to a DIFFERENT user. So if a new activation code is issued for a parent who is already bound to user A, the new code can bind user B — silently overwriting A's binding on the parent. The function silently transfers ownership of the parent record. | PARENT-103: The `bind_activation_code(p_tenant_id, p_code, p_auth_user_id)` SQL function (0005 line 191-243) marks the activation code as bound and updates `parents.auth_user_id` for the bound parent. It does NOT write to `audit_logs`. There's no audit trail for: who bound the code, when, to which parent, for which user. Combined with SEC-110 (the function accepts any `p_auth_user_id` without verifying caller), an attacker who brute-forces an activation code can bind any auth_user_id to any parent — and the audit log shows nothing.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-111 — `upsert_payment_from_import` is SECURITY DEFINER (RLS-bypassed); canonical payment RPCs are not

- **Category:** SEC  |  **Severity:** High  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved by migration 0055: upsert_payment_from_import (kept SECURITY DEFINER deliberately — retirement is UNKNOWN-002/ADR-005 territory) now rejects non-service_role, non-global-admin callers whose p_tenant_id != current_tenant_id(). Live verification verify_t-006.sql S6 (service_role ok) + S7 (foreign-tenant injection rejected with SEC-111). Run-discovery documented in the script: p_student_id has NO default in the (unchanged) signature.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-006 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-111 (was SEC-100)
- **Description:** The `upsert_payment_from_import` SQL RPC (migration 0027:601-691) is declared `SECURITY DEFINER` (line 626) — it executes as the function owner (postgres superuser) and bypasses all RLS policies on `payments`. The canonical RPCs `collect_and_allocate_payment` (migration 0040:46-197) and `revert_payment_allocation` (migration 0041:460-643) are declared `LANGUAGE plpgsql` WITHOUT `SECURITY DEFINER` — they execute as the caller, with full RLS enforcement. The Android sync dispatcher ONLY calls `upsert_payment_from_import` (SyncQueueDispatcher.kt:238). The desktop's SupabasePaymentRepository.collect() calls `collect_and_allocate_payment` (RLS-enforced) on the canonical path — but `upsert_payment_from_import` (RLS-bypassed) on the fallback path (line 1092-1118). The desktop's defaultPushHandler for "payment" entity (sync-provider.tsx:166-183) also calls `upsert_payment_from_import`. No GRANT/REVOKE statements restrict who can call these RPCs — PostgreSQL defaults to PUBLIC EXECUTE on functions in the public schema.
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:626` (SECURITY DEFINER clause) - `elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:197` (canonical RPC — no SECURITY DEFINER) - `elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:643` (canonical refund RPC — no SECURITY DEFINER)
- **Evidence:** Audit evidence (Confirmed). Git: Migration 0027 dated 2026-08-XX; migration 0040 commit `eeb82db 2026-08-21 right`.
- **Root cause:** `upsert_payment_from_import` was designed as a "bulk import" helper for the Excel importer and sync queue — both server-trusted paths where RLS was considered redundant. But it's now used by the Android sync (over which the server has no trust) and as the desktop's collect fallback. The SECURITY DEFINER flag was never revisited when the call sites expanded.
- **Current behavior:** The Android path and the desktop fallback path bypass RLS. A malicious Android client could pass `p_tenant_id` = any other tenant's UUID and inject a payment into that tenant's books.
- **Expected behavior:** All payment writes should be RLS-enforced so a parent (or attacker with a leaked anon key + hijacked JWT) cannot write to another tenant's payments table.
- **Proposed resolution:** All payment writes should be RLS-enforced so a parent (or attacker with a leaked anon key + hijacked JWT) cannot write to another tenant's payments table.
- **Dependencies:** SEC-112-style tenant verification pattern; coordinate with ADR-002
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SEC-112 — `revert_payment_allocation` SQL RPC has no tenant_id verification; cross-tenant refund possible

- **Category:** SEC  |  **Severity:** High  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved by migration 0055: revert_payment_allocation's payment lookup is now tenant-scoped (AND tenant_id = p_tenant_id) and the audit/reversal entries are stamped with the PAYMENT's tenant. Live verification verify_t-006.sql S8 (same-tenant refund ok, audit tenant = payment tenant) + S9 (cross-tenant attempt -> 'Payment not found').
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-006 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SEC-112 (was SEC-101)
- **Description:** The canonical `revert_payment_allocation` SQL RPC (migration 0041:460-643) takes `p_tenant_id` as a parameter and uses it for the audit_log INSERT (line 626: `gen_random_uuid(), p_tenant_id, ...`). However, the payment lookup at line 489 is `SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE` — NO `tenant_id` filter. So a caller from tenant A can pass `p_payment_id` = a payment ID from tenant B, and the RPC will refund it — writing the audit log entry under tenant A (the caller's tenant). The EF `refund-payment` (line 77-86) DOES verify tenant scope (`eq("tenant_id", ctx.tenantId)`) — but the EF is never called (DEAD-016). The desktop's `SupabasePaymentRepository.refund()` (line 1151) calls the RPC directly with `p_tenant_id = getTenantId()` — but if `getTenantId()` returns the wrong value (e.g., a stale session, a config bug like DRIFT-003), the RPC will use the wrong tenant_id for the audit log while refunding a payment from any tenant.
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:489` (payment lookup without tenant filter) - `elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:626` (audit_log uses p_tenant_id, not the payment's actual tenant_id)
- **Evidence:** Audit evidence (Confirmed (the SQL is unambiguous).). Git: migration 0041 commit `eeb82db 2026-08-21 right`.
- **Root cause:** The `revert_payment_allocation` function was first written in migration 0026 (line 298) without a tenant filter. Migration 0034 rewrote it (canonical). Migration 0041 fixed a uuid cast bug but kept the same body. The tenant filter was never added — unlike `mark_payment_cleared`/`mark_payment_bounced` which were added in 0040 with the tenant filter from the start.
- **Current behavior:** The RPC trusts the caller's `p_tenant_id` for the audit log but doesn't verify it matches the payment's actual `tenant_id`. Cross-tenant refund is possible if the caller knows a payment_id from another tenant.
- **Expected behavior:** The RPC should verify that the payment being refunded belongs to the caller's tenant. Cross-tenant refunds should be blocked.
- **Proposed resolution:** The RPC should verify that the payment being refunded belongs to the caller's tenant. Cross-tenant refunds should be blocked.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### TENANT-100 — `current_user_roles()` ignores tenant_id → cross-tenant role inheritance

- **Category:** TENANT  |  **Severity:** Critical  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved by migration 0053 (tenant_scoped_rbac) — applied live AND registered in schema_migrations; reconciled into the local chain 2026-08-31 (see ARCH-011). current_user_roles()/current_user_permissions() now filter role_assignments by current_tenant_id() with the is_global_admin() path. Verified live: function definitions dumped via pg_get_functiondef match the reconciled 0053 file; the 0053+0054 files dry-run clean inside BEGIN..ROLLBACK against the live DB (scripts/verify_mig-tokens_0053_0054.sh, HTTP 201).
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-005 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass TENANT-100
- **Description:** The `current_user_roles()` SQL function (0003 line 132-142) queries `role_assignments WHERE user_profile_id = current_user_profile_id() AND revoked_at IS NULL` — with NO `tenant_id` filter. All roles a user holds across ALL tenants are merged into a single text[]. RLS policies that check `has_role('super_admin')` or `has_any_role([...])` cannot distinguish which tenant the role applies to. The companion `current_user_permissions()` (0003 line 144-175) has the same flaw — it queries role_assignments by user_profile_id only.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0003_rbac.sql:132-142` (function definition). Consumers include: `0019_rls_policies.sql:46` (tenants_select), `:51` (tenants_update), `:55` (tenants_insert), `:60` (tenants_delete), `:71` (user_profiles_select_own), `:79-82` (user_profiles_admin_update), `:120` (sessions_select_own), `:354` (parents_delete), `:398` (students_delete), `0043_portal_alignment.sql:146` (attendance_parent_update_justification), `:213` (student_documents_parent_select), `:247` (parents_self_update).
- **Evidence:** Audit evidence (Confirmed (read function body, verified no tenant_id predicate)). Git: 0003_rbac.sql introduced in commit `b25e6ca` (2026-08-04, "FKFKFK").
- **Root cause:** The function was written assuming a 1:1 user-tenant mapping (user_profiles.tenant_id is fixed at signup). The function never anticipated per-tenant role switching; the schema's `role_assignments.tenant_id` column was intended to support multi-tenant roles but the resolver ignored it.
- **Current behavior:** Returns the union of all roles across all tenants. A super_admin in tenant A is super_admin everywhere RLS checks the role.
- **Expected behavior:** Per the 0003 comment line 14 ("a user may hold different roles across tenants"), the function should filter role_assignments by the current operating tenant. But `current_tenant_id()` returns the user's `user_profiles.tenant_id` (a single fixed value) — there's no concept of "operating tenant" the user can switch between.
- **Proposed resolution:** Scope current_user_roles() and current_user_permissions() to the caller's active tenant (current_tenant_id()), matching the schema's per-tenant role_assignments design. Add a regression test with two tenants asserting a tenant-A super_admin holds no roles in tenant B's context.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### TENANT-101 — `user_profiles_admin_update` RLS policy has no tenant_id check → cross-tenant user modification

- **Category:** TENANT  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved by migration 0053: user_profiles_admin_update now requires is_global_admin() OR (row tenant = current_tenant_id() AND super_admin); tenants_update/insert/delete now require is_global_admin() (closing TENANT-102's cascade-delete exploit). Verified live via pg_policies (definitions match the reconciled 0053 file exactly).
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-005 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass TENANT-101, second-pass TENANT-102
- **Description:** The RLS policy `user_profiles_admin_update` (0019 line 79-82) is `USING (public.has_role('super_admin')) WITH CHECK (public.has_role('super_admin'))` — neither clause constrains by `tenant_id`. Combined with TENANT-100 (current_user_roles ignores tenant), any user with `super_admin` role in ANY tenant can UPDATE any user_profiles row across ALL tenants.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:79-82`. Same no-tenant-check pattern on `tenants_update` (line 49-52), `tenants_insert` (line 54-56), `tenants_delete` (line 58-60). ;; [TENANT-102] `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:42-60`.
- **Evidence:** Audit evidence (Confirmed). Git: 0019_rls_policies.sql introduced in commit `b25e6ca` (2026-08-04).
- **Root cause:** The author intended `user_profiles_admin_update` to be the "global admin bypass" — for global admins whose user_profiles.tenant_id IS NULL. They forgot that `has_role('super_admin')` returns true for ANY per-tenant super_admin (per TENANT-100).
- **Current behavior:** A tenant-scoped super_admin has god-level UPDATE access to every user_profiles row in the database. They can: (1) suspend any user in any tenant; (2) change any user's email (breaks Google OAuth sign-in for them); (3) MOVE a user to a different tenant (`UPDATE user_profiles SET tenant_id = 'tenant-A' WHERE id = '<victim>'` — tenant-hopping exploit); (4) detach a user's auth_user_id (`UPDATE user_profiles SET auth_user_id = '<random_uuid>'` — severs the link between the auth user and the user_profiles row).
- **Expected behavior:** Per the 0019 comment line 20-21 ("user_profiles: tenant_id may be NULL for global admins; reads check `tenant_id IS NULL OR tenant_id = current_tenant_id()`"), the policy was meant for global admins (user_profiles.tenant_id IS NULL). But it doesn't restrict to global admins — it allows any super_admin.
- **Proposed resolution:** Per the 0019 comment line 20-21 ("user_profiles: tenant_id may be NULL for global admins; reads check `tenant_id IS NULL OR tenant_id = current_tenant_id()`"), the policy was meant for global admins (user_profiles.tenant_id IS NULL). But it doesn't restrict to global admins — it allows any super_admin.
- **Dependencies:** TENANT-100 (role resolver must be tenant-scoped or the policy fix is ineffective)
- **Absorbed findings:** TENANT-102: The RLS policy `tenants_select` (0019 line 42-47) is `USING (id = current_tenant_id() OR has_role('super_admin'))`. Combined with TENANT-100, any super_admin in any tenant can SELECT ALL tenant rows — names, slugs, addresses, emails, logos, default_locale, etc. The sister policies `tenants_update` (line 49-52), `tenants_insert` (line 54-56), `tenants_delete` (line 58-60) all use `has_role('super_admin')` without tenant check — a per-tenant super_admin can UPDATE/INSERT/DELETE tenant rows in any tenant, with `tenants_delete` cascading to ALL of that tenant's data via `on delete cascade` FKs.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### TENANT-103 — Desktop's `getTenantId()` falls back to DEMO UUID when session is missing or user is a global admin

- **Category:** TENANT  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-053 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-053, 12th session): the DEMO-UUID fallback is GONE — getTenantId() returns the working tenant or null (reads empty, writes throw via requireTenantId with a French message); the Session model gained tenantId (working, nullable) + homeTenantId (profile home); the auth repository stores the honest null; global admins pick a working tenant via the new Topbar TenantSwitcher (auth.switchTenant persists + reloads). 9-test suite + 7 suites migrated off the implicit fallback; full suite 2107 green. Live E2E gap: no global-admin account exists yet (only the tenant-bound admin@elimtiyaz.dz).
- **Consolidated from:** second-pass TENANT-103
- **Description:** The desktop's `getTenantId()` (supabase-shared-repositories.ts line 132-140) returns `TENANT_FALLBACK = "00000000-0000-0000-0000-000000000001"` whenever localStorage has no session OR the session has no `tenantId`. The fallback fires for two cases: (1) pre-login (no session yet) — every desktop query targets the demo tenant; (2) a global admin whose `user_profiles.tenant_id IS NULL` — `session.tenantId` is null, so `getTenantId()` returns the demo UUID. The desktop cannot support global admins.
- **Location:** `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:120-140` (constant + function); 22 call sites in the same file (lines 413, 483, 635, 686, 882, 922, 955, 1001, 1045, 1150, 1183, 1288, 1322, 1403, 1504, 1566, 1600, 1658, 1925, 2216, 2272, 2396, 2489, 2581).
- **Evidence:** Audit evidence (Confirmed). Git: supabase-shared-repositories.ts last touched `84dd13f` (2026-08-27, "okay"); the constant introduced in `b25e6ca` (2026-08-04).
- **Root cause:** The author assumed every user has a non-null tenant_id. The global-admin concept (per 0002 line 20-21) was never wired into the desktop client. The fallback was a dev convenience (default to the seed tenant) that ships in production.
- **Current behavior:** Global admins see the demo tenant's data (via the fallback). RLS denies access (because `current_tenant_id()` returns NULL for them). The desktop's UI is unusable for global admins.
- **Expected behavior:** Per the 0002 comment line 20-21 ("user_profiles: tenant_id may be NULL for global admins"), global admins are an intended concept. The desktop should support them — either by letting them switch tenants or by aggregating across all tenants.
- **Proposed resolution:** Per the 0002 comment line 20-21 ("user_profiles: tenant_id may be NULL for global admins"), global admins are an intended concept. The desktop should support them — either by letting them switch tenants or by aggregating across all tenants.
- **Dependencies:** TENANT-100 (global-admin concept depends on tenant-scoped roles)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### TENANT-106 — `student_academic_histories` table is INACCESSIBLE to authenticated users; desktop's batch promotion flow fails at the history upsert (extends DEAD-100 with concrete user-facing breakage)

- **Category:** TENANT  |  **Severity:** Critical  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-025 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-025, 11th session, migration 0057): dead policy replaced with student_academic_histories_staff (tenant_id = current_tenant_id() AND staff roles). Live verify_t-025.sql 6/6 — staff SELECT/INSERT own-tenant ok; cross-tenant INSERT rejected. Promotion flow (T-041) unblocked.
- **Consolidated from:** second-pass TENANT-106
- **Description:** Migration 0029 (line 117-133) creates `public.student_academic_histories` with `tenant_id UUID NOT NULL` and NO trigger to auto-populate tenant_id. Migration 0029 (line 204-206) creates the ONLY RLS policy on this table: `rls_student_academic_histories_tenant FOR ALL USING (tenant_id = public.fn_current_tenant_id())`. Since `fn_current_tenant_id()` always returns NULL (DEAD-100), the policy's USING clause evaluates to NULL → DENY for every operation (SELECT, INSERT, UPDATE, DELETE). Authenticated users (the desktop's signed-in admin) CANNOT read or write this table at all. The desktop's batch promotion (`SupabasePromotionRepository.executeBatchPromotion`) tries to upsert into this table, gets the RLS denial, and aborts the entire promotion flow.
- **Location:** Schema: `elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:117-133` (table), `:163` (RLS enable), `:204-206` (broken policy). Consumer: `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1172-1178` (`SupabasePromotionRepository.executeBatchPromotion` upserts into this table — and aborts the entire promotion on error).
- **Evidence:** Audit evidence (Confirmed (extends DEAD-100 with concrete end-to-end user-facing breakage)). Git: 0029 introduced in commit `9e1e7741` (2026-08-12, "kay"). supabase-academic-repository.ts last touched `2e2b21a` (2026-08-28).
- **Root cause:** The migration author introduced `fn_current_tenant_id()` (new helper using `current_setting`) without realizing the existing `current_tenant_id()` (using `auth.uid()`) was the canonical resolver. The new helper requires the app to set `app.current_tenant_id` per-connection, which no one does. The desktop's promotion repo was written assuming the table is writable, didn't notice the dead RLS policy.
- **Current behavior:** The policy is dead code (always denies). The desktop's promotion flow hits the denial, aborts, and the user sees an error toast. NO student is promoted via the desktop. The Android path (STUDENT-100 below) silently drops the grade_level_code on sync push — also no promotion on the server.
- **Expected behavior:** The 0029 migration intends the `student_academic_histories` table to be the permanent record of each student's year-end promotion decision (per the table comment line 115: "Append-only record of year-end student promotion/retention decisions"). RLS policy intends tenant isolation. The desktop's promotion flow intends to write history BEFORE advancing the student.
- **Proposed resolution:** Fixed by the DEAD-100 migration: after replacing the resolver, an authenticated staff user can upsert student_academic_histories. Add an integration test executing a full batch promotion against a fresh schema with all migrations applied.
- **Dependencies:** DEAD-100 (root cause: fn_current_tenant_id never set)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Financial & Business Logic

### BUSINESS-001 — `reconcileFinancials()` runs only 4 of 6 canonical cross-checks

- **Category:** BUSINESS  |  **Severity:** Critical  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-016 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass BUSINESS-001
- **Description:** `CANONICAL-FINANCIAL-LOGIC.md §4 INV-9` states "The reconciler MUST run all 6 cross-checks. A reconciler that runs only 3 is broken." The 6 checks are: `crossCheckPayments`, `crossCheckInstallments`, `crossCheckBalanceSum`, `crossCheckInstallmentPayments`, `crossCheckClearedBalance`, `crossCheckParentCredit`. The orchestrator `reconcileFinancials()` in `src/domain/calc/reconcile/reconciliation.ts` only runs 4 of these — it omits `crossCheckBalanceSum` and `crossCheckParentCredit`. They are imported and re-exported (line 63) but never invoked in the function body. The desktop_runner.ts (test harness) explicitly notes "Always run crossCheckBalanceSum (it only needs entries)" (line 560) — implying the production code does NOT always run it, and the test runner has to compensate.
- **Location:** `elimtiyaz-desktop/src/domain/calc/reconcile/reconciliation.ts:20-39`
- **Evidence:** Audit evidence (Confirmed). Git: `src/domain/calc/reconcile/reconciliation.ts` last modified in `badeae9` (2026-08-15 "mm") — predates the canonical logic doc (2026-08-20) and the cross-platform equivalence work. Never updated to add the missing 2 checks.
- **Root cause:** The orchestrator was written before the 3 new cross-checks (crossCheckInstallmentPayments, crossCheckClearedBalance, crossCheckParentCredit) were added in the financial refactor. The first 2 were wired in; the third + the older BalanceSum were not. The re-export at the bottom was added "for completeness" without wiring it into the orchestrator.
- **Current behavior:** Production reconciliations will NOT detect `BALANCE_SUM_MISMATCH` (sum of entries ≠ sum of account balances) or `UNBACKED_PARENT_CREDIT` (negative balance on a non-parent-credit account). These are exactly the invariants that catch silent data corruption from sync drift or partial RPC failures.
- **Expected behavior:** The cross-platform test runner at `financial-tests/equivalence/desktop/desktop_runner.ts:560-620` runs all 6 checks correctly.
- **Proposed resolution:** Wire crossCheckBalanceSum and crossCheckParentCredit into reconcileFinancials() so all 6 canonical cross-checks run (INV-9). Unit test: a ledger with a balance-sum mismatch and an unbacked parent credit both produce violations.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-002 — `SupabasePaymentRepository.collect()` silently falls back to non-atomic upsert on RPC failure

- **Category:** BUSINESS  |  **Severity:** Critical  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-011 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-011, 11th session): silent fallback REMOVED — collect() calls the atomic RPC only; error → Err, zero rows written; client-side PAY- number generator deleted (receipt from the RPC, ADR-004). t-011-payment-atomicity.test.ts 2/2. Live E2E on a desktop host remains the residual gap.
- **Consolidated from:** first-pass BUSINESS-002, second-pass BUSINESS-103, second-pass CROSS-105
- **Description:** When the canonical `collect_and_allocate_payment` RPC fails for any reason (network glitch, RLS policy, schema drift, migration not yet applied), the desktop's `SupabasePaymentRepository.collect()` silently falls back to calling `upsert_payment_from_import` — a simple INSERT helper that does NOT run the waterfall, does NOT create the `parent_credit` adjustment for overpayments, and does NOT pass the structured check/transfer fields (p_check_number, p_check_bank_name, etc.). The fallback also uses the random `paymentNumber` (`PAY-YYYY-{random}`) instead of the canonical `REC-YYYY-{6-digit-seq}` format that the atomic RPC generates. The user sees "Payment collected" success toast while the financial state is silently broken (installments never move toward paid, overpayment never becomes parent_credit).
- **Location:** `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1086-1118` ;; [BUSINESS-103] - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1086-1118` (fallback branch) - `elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:46-197` (canonical RPC — 5 writes) - `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:601-691` (fallback RPC — 1 write) ;; [CROSS-105] - `elimtiyaz-desktop/src/features/financials/unified-payment-modal.tsx:414-424` (success toast — shows "Paiement encaissé" even when ledger was skipped) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1086-1118` (fallback) - `elimtiyaz-desktop/src/domain/calc/ledger/balance.ts` (computes balance from ledger_entries)
- **Evidence:** Audit evidence (Confirmed). Git: `supabase-shared-repositories.ts` last modified in `84dd13f` (2026-08-27 "okay"). The fallback comment "Falls back to the simple upsert RPC if the function doesn't exist (older Supabase deployments that haven't run migration 0026 yet)" suggests it was meant for migration-not-applied scenarios, but the fallback triggers on ANY error (not just "function does not exist").
- **Root cause:** The fallback was added as a backward-compat shim for "older Supabase deployments" but the catch is too broad — it catches ALL errors, including transient ones, and silently downgrades the operation.
- **Current behavior:** Atomic path: payment + ledger entry + waterfall allocation + parent_credit adjustment + audit — all atomic. Fallback path: payment row INSERT only — no ledger entry, no waterfall, no parent_credit, no audit. The two paths produce wildly different state for the same input.
- **Expected behavior:** The atomic RPC `collect_and_allocate_payment` (migration 0034+0035+0039) is canonical. The fallback `upsert_payment_from_import` is the simple Excel-import helper RPC, never intended for interactive collections.
- **Proposed resolution:** Remove the silent fallback to upsert_payment_from_import in SupabasePaymentRepository.collect(): when the canonical RPC fails, surface the error to the user and leave the financial state untouched. Keep a single, atomic write path. Regression test: RPC failure produces a user-visible error and zero payments rows.
- **Dependencies:** none recorded
- **Absorbed findings:** BUSINESS-103: First-pass BUSINESS-002 noted the silent fallback. The deeper trace: the canonical `collect_and_allocate_payment` SQL RPC (migration 0040:46-197) writes FIVE things atomically — (1) payment row, (2) ledger entry for the payment, (3) waterfall installment updates (amount_paid/amount_pending/status), (4) optional parent_credit ledger entry for overpayments, (5) audit_log entry `payment.collect`. The fallback `upsert_payment_from_import` (migration 0027:601-691) writes ONLY the payment row — NO ledger entry, NO waterfall, NO parent_credit, NO audit_log. So when the canonical RPC is unavailable (e.g., migration 0040 not yet applied), the desktop's `SupabasePaymentRepository.collect()` produces a payment row with NO corresponding ledger entry. The parent's balance — which the canonical engine computes by replaying `ledger_entries` — does NOT decrease. The desktop UI shows the payment as collected, but the parent's outstanding balance is unchanged. Silent financial data corruption. | CROSS-105: This is the consumer-side trace of BUSINESS-103. When the desktop's canonical `collect_and_allocate_payment` RPC is unavailable and `SupabasePaymentRepository.collect()` falls back to `upsert_payment_from_import` (lines 1092-1118), the desktop UI shows the payment as collected. However, the canonical `compute_parent_summary` SQL RPC (migration 0041:662+) and the desktop's `computeParentSummary` (calc/ledger/balance.ts) both compute the parent's balance by replaying `ledger_entries`. The fallback didn't write a ledger entry. So the parent's balance shows the OLD value (before this payment). The desktop's `UnifiedPaymentModal` then calls `repos.payments.generateReceipt(result.value.id, session.userId)` which fetches the payment row (succeeds) and returns Ok. The user sees a success toast, the receipt PDF is generated, and they move on. But the parent's outstanding balance is unchanged. The next time the user views the parent's record (e.g., in the parent-detail-drawer), the balance is wrong.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-003 — `SupabasePaymentRepository.refund()` hardcodes `"Manual refund"` as the reason, drops user's reason + actor identity

- **Category:** BUSINESS  |  **Severity:** High  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-014 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-014, 11th session): refund(id, reason, actorId, actorName?) — reason mandatory ≥3 chars, REAL actor + reason propagate to revert_payment_allocation; mock mirrors with double-refund guard. t-014-refund-flow.test.tsx 10/10.
- **Consolidated from:** first-pass BUSINESS-003
- **Description:** The desktop's `SupabasePaymentRepository.refund(id)` calls the canonical `revert_payment_allocation` RPC with `p_reason: "Manual refund"` — a hardcoded string. The user's actual refund reason from the UI (which the canonical spec §7.2 + the edge function both require to be ≥3 chars and meaningful) is never propagated. Worse: the actor identity is `getActorId()` / `getActorName()` which read from `localStorage` and fall back to `"excel-import"` / `"Excel Import"` when no session is loaded. So a manual refund performed by a financial officer named "Brahim Souilah" is recorded in the audit log as performed by "Excel Import" with reason "Manual refund" — completely useless for audit trail.
- **Location:** `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1148-1157`
- **Evidence:** Audit evidence (Confirmed). Git: `supabase-shared-repositories.ts` last modified in `84dd13f` (2026-08-27). The refund method signature `refund(id: string)` doesn't even accept a reason parameter — the API surface itself is broken.
- **Root cause:** The refund method was written before the canonical §7.2 rule was finalized. The signature `refund(id)` doesn't accept a reason; the implementation hardcodes one to satisfy the RPC's NOT NULL constraint.
- **Current behavior:** Edge function path: real user + real reason. Direct Supabase path: "Excel Import" + "Manual refund". Same operation, two completely different audit records.
- **Expected behavior:** The `refund-payment` Edge Function (`refund-payment/index.ts:60-73`) correctly requires `body.reason` with ≥3 chars and passes it through.
- **Proposed resolution:** The `refund-payment` Edge Function (`refund-payment/index.ts:60-73`) correctly requires `body.reason` with ≥3 chars and passes it through.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-004 — `SupabaseStudentRepository.promote()` returns "not implemented" error in production

- **Category:** BUSINESS  |  **Severity:** High  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-041, 13th session): promote() implemented on the canonical `execute_batch_promotion` RPC path (migration 0059, applied live + registered; verify_t-041.sql 10/10). Desktop suite 64 files / 2146 tests green. Full evidence: change-log 2026-08-31 T-041.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-041 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass BUSINESS-004
- **Description:** The Supabase-backed student repository's `promote()` method (line 982-984) returns `Err(Errors.server("promote not implemented for Supabase repository"))`. The mock repository has a working implementation (`student-repository.ts:318-332` — promotes students by incrementing their grade). The canonical batch promotion flow is a critical end-of-year operation (vault §06.04: "One-click batch promotion, 4-step flow, admin overrides, atomic execution"). In Supabase mode (production), clicking "Promote" returns an error. The feature silently breaks when Supabase is enabled.
- **Location:** `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:982-984`
- **Evidence:** Audit evidence (Confirmed). Git: `supabase-shared-repositories.ts` last modified in `84dd13f` (2026-08-27). The `promote()` stub has been there since the file was created.
- **Root cause:** The Supabase student repository was ported for CRUD operations (create/update/batchRegister) but the `promote()` method was left as a stub. The vault §06 verification claims "batch promotion already existed" but didn't notice the Supabase path was stubbed.
- **Current behavior:** Mock mode: promotion works (updates in-memory). Supabase mode: promotion returns an error. The user sees an error toast and cannot promote students.
- **Expected behavior:** Mock `student-repository.ts:318-332` implements promotion by mapping over students and updating `updatedAt`. The canonical batch promotion flow (vault §06.04) involves 4 steps with admin overrides + atomic execution.
- **Proposed resolution:** Mock `student-repository.ts:318-332` implements promotion by mapping over students and updating `updatedAt`. The canonical batch promotion flow (vault §06.04) involves 4 steps with admin overrides + atomic execution.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-005 — `UnifiedPaymentModal` defaults `category` to "tuition" for the waterfall preview when input is null

- **Category:** BUSINESS  |  **Severity:** Medium  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-060 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-060, 11th session): all 3 preview sites use the exact category match mirroring the SQL semantics — preview ≡ actual collection for every category. t-060-payment-ux.test.ts 7/7.
- **Consolidated from:** first-pass BUSINESS-005
- **Description:** The `UnifiedPaymentModal`'s allocation preview at `unified-payment-modal.tsx:269-282` filters installments by `category === "tuition" || category === "transport" ? i.category === category : true`. When the user picks a category other than tuition/transport (e.g., canteen, uniform, books, therapy_psychology), the filter is `true` (no filter) — meaning the preview shows the waterfall across ALL outstanding installments, not just the chosen category. But when the modal calls `repos.payments.collect()` (line 387-403), it passes `category` directly (which could be `"canteen"`). The Supabase `collect()` then passes `p_category: input.category ?? "tuition"` (BUSINESS-002 / DRIFT-004) — so if `category` is "canteen", the waterfall is filtered by canteen; if `category` is null, it defaults to "tuition". So the preview shows ALL categories, but the actual collection uses tuition-only or the specified category. The preview lies to the user.
- **Location:** `elimtiyaz-desktop/src/features/financials/unified-payment-modal.tsx:269-296`
- **Evidence:** Audit evidence (Likely). Git: `unified-payment-modal.tsx` last modified in `b5a84cd` (2026-08-26 "kay"). The preview logic was written for the Epic 5.3 implementation.
- **Root cause:** The preview was written to handle the common case (tuition + transport = ~95% of payments) by filtering; for other categories it fell back to "no filter" which was assumed to be safe. The actual collection path has a different default (`"tuition"`), causing the divergence.
- **Current behavior:** Preview shows payment spread across all categories. Actual collection: if category is tuition/transport, filtered; if category is null/other, defaults to tuition-only. The user sees a preview that doesn't match what actually happens.
- **Expected behavior:** The canonical waterfall (`allocatePaymentToInstallments` in `waterfall-allocator.ts:33-103`) accepts `categoryFilter?: Installment["category"]` — undefined means no filter.
- **Proposed resolution:** The canonical waterfall (`allocatePaymentToInstallments` in `waterfall-allocator.ts:33-103`) accepts `categoryFilter?: Installment["category"]` — undefined means no filter.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-007 — `LedgerEngine.maxDaysOverdueFromLedger` uses charge's `at` (creation date) instead of due date — inconsistent with canonical overdue rule

- **Category:** BUSINESS  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-026, 13th session): maxDaysOverdueFromLedger measures from the account's DUE DATE (buildOverdueDueDateMap; balance > 0 AND due date past), not the oldest charge creation date. 10/10 new tests (OverdueRuleT026Test).
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-026 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass BUSINESS-007
- **Description:** `maxDaysOverdueFromLedger` (line 168-173) computes "days overdue" as the age of the OLDEST CHARGE entry, where age = `now - charge.at`. But `charge.at` is the CREATION timestamp of the charge entry, not its DUE date. A charge created today (e.g. for next year's tuition) is not overdue today — but `maxDaysOverdueFromLedger` returns ~365 days for it. This is a DIFFERENT definition of "overdue" than `computeParentSummary.totalOverdue` (which uses `overdueCategoryDueDates` due-date map) and the SQL function `compute_parent_summary` (which uses MAX(charge.at) filtered by `p_as_of` and joined to installments' due_date — per migration 0042's comment).
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/core/LedgerEngine.kt:168-173`
- **Evidence:** Audit evidence (Confirmed). Git: `LedgerEngine.kt` last touched in `94471e8` (2026-08-28)
- **Root cause:** The function was written before the canonical overdue rule (INV-4) was defined. It uses the charge's `at` field as a proxy for "overdue since" — which is wrong because `at` is the creation date, not the due date. The function was never refactored when the canonical rule was introduced.
- **Current behavior:** A parent whose tuition charge was created on 2026-09-15 (the academic year start) shows as "X days overdue" where X = today - 2026-09-15, even if the charge's due date (e.g. tranche 1 due 2026-12-15) hasn't passed yet. The aging bucket would put them in "0-30 days" or "31-60 days" depending on when they're viewed, despite the charge not being overdue yet.
- **Expected behavior:** Desktop's `computeParentSummary.totalOverdue` uses `overdueCategoryDueDates` map (due dates). Migration 0042's canonical rule uses MAX(charge.at) across ALL entries with no as-of filter (per the migration's KDoc). Neither matches `maxDaysOverdueFromLedger`'s definition.
- **Proposed resolution:** Desktop's `computeParentSummary.totalOverdue` uses `overdueCategoryDueDates` map (due dates). Migration 0042's canonical rule uses MAX(charge.at) across ALL entries with no as-of filter (per the migration's KDoc). Neither matches `maxDaysOverdueFromLedger`'s definition.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-100 — `bulkCollect` silently drops failed chunks; Excel importer thinks everything succeeded

- **Category:** BUSINESS  |  **Severity:** Critical  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-012 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-012, 11th session): bulkCollect returns Err on the first chunk error naming the row range; adapter routes Err into failures and cancels the import transaction. t-012-bulkcollect-failfast.test.ts 4/4.
- **Consolidated from:** second-pass BUSINESS-100
- **Description:** `SupabasePaymentRepository.bulkCollect()` inserts payments in chunks of 500. If a chunk fails (FK violation, NOT NULL, trigger rejection), it `console.warn`s the error and `continue`s to the next chunk. After all chunks, it returns `Ok(inserted)` containing only the successfully-inserted rows. The Excel importer's `commitTransaction` calls `bulkCollect` inside a try/catch — but `bulkCollect` never throws (it returns Ok), so the catch never fires. The adapter then proceeds to flush ledger entries + installments. The final "no partial data was applied silently" guard (line 266) is BYPASSED because `bulkCollect` returned Ok.
- **Location:** - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1346-1361` (bulkCollect chunk loop) - `elimtiyaz-desktop/src/infrastructure/excel/import-engine/storage/repository-adapter.ts:230-244` (commitTransaction payments flush — only catches thrown errors)
- **Evidence:** Audit evidence (Confirmed). Git: supabase-shared-repositories.ts: `84dd13f okay` (latest).
- **Root cause:** The chunked-insert optimization was added for performance ("~100x faster than looping collect()", line 1313), but the error handling was copied from a "best-effort" pattern without considering that the upstream adapter relies on throw-on-error semantics.
- **Current behavior:** `bulkCollect` partially applies financial data silently when chunks fail. The importer reports success.
- **Expected behavior:** `commitTransaction`'s comment (line 266) explicitly says "L'import a été annulé : aucune donnée financière n'a été partiellement appliquée en silence." (The import was canceled: no financial data was partially applied silently.) `bulkCollect` violates this contract.
- **Proposed resolution:** Make bulkCollect fail-fast: collect per-chunk errors, abort the import transaction, and report the failing rows to the Excel importer (which already claims 'no partial data applied'). Test: import containing one invalid payment rolls back completely and reports the row.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-101 — `markClearedFallback` produces NO audit log entries and discards actor identity

- **Category:** BUSINESS  |  **Severity:** High  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-013 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-013, 11th session): markClearedFallback DELETED — canonical mark_payment_cleared RPC is the only path (audit + atomic). t-013-markcleared-atomic.test.ts 2/2.
- **Consolidated from:** second-pass BUSINESS-101
- **Description:** When the canonical `mark_payment_cleared` SQL RPC is unavailable (older Supabase deployment that hasn't run migration 0039/0040), `SupabasePaymentRepository.markCleared()` falls back to `markClearedFallback()` (lines 1217-1274). The fallback updates `payments.status` directly, then loops installments updating `amount_paid`/`amount_pending`/`status`/`paid_date`. It writes NO audit log entries — neither a `payment.mark_cleared` audit entry nor per-installment `installment.clear_funds` audit entries. The canonical RPC writes BOTH (migration 0040 lines 267-298). The fallback also explicitly discards the actor identity via `void actorId; void actorName;` (line 1272-1273) — even if it wanted to write audit entries, it couldn't attribute them.
- **Location:** `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1217-1274`
- **Evidence:** Audit evidence (Confirmed). Git: supabase-shared-repositories.ts commit `84dd13f okay`.
- **Root cause:** The fallback was written as a "row-update shim" to keep the desktop working on pre-0039 databases, but the audit-log writes were deemed "too complex to replicate client-side" and skipped. The `void actorId; void actorName;` lines suggest the developer explicitly acknowledged the parameters were unused.
- **Current behavior:** The fallback produces the state changes (payment status + installment amounts) but skips the audit log entirely. Actor identity is discarded.
- **Expected behavior:** When the canonical RPC is unavailable, the fallback should produce the same observable state changes — including audit log entries — so the audit trail is preserved across deployments.
- **Proposed resolution:** When the canonical RPC is unavailable, the fallback should produce the same observable state changes — including audit log entries — so the audit trail is preserved across deployments.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-102 — Android refund has no idempotency check; re-refunding an already-refunded payment creates duplicate reversal entries and double-reverts installments

- **Category:** BUSINESS  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-017 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass BUSINESS-102
- **Description:** `LocalPaymentRepository.refund()` (lines 1092-1168) does NOT check `existing.status` before refunding. If a payment is already `refunded`, the method: (1) re-updates the payment row to `refunded` (no-op for the payment), (2) creates ANOTHER reversal ledger entry (duplicate — the original reversal entry is still in the ledger), (3) re-runs `revertPaymentAllocation` against installments that have already been reverted. Since `revertPaymentAllocation` subtracts from `amount_paid` (or `amount_pending`), the second refund subtracts the same amount again — driving `amount_paid` NEGATIVE and re-marking tranches as "unpaid" even though they were already unpaid. The SQL RPC `revert_payment_allocation` (migration 0041:493-495) blocks this with `IF v_payment.status NOT IN ('paid', 'pending') THEN RAISE EXCEPTION '... cannot revert'` — but the Android path bypasses the SQL RPC entirely. The EF `refund-payment` (line 88-90) checks `if (originalPayment.status === "refunded") return 409` — but the EF is never called (DEAD-016).
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1092-1098` (refund start — no status check) - `elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:493-495` (SQL RPC blocks re-refund)
- **Evidence:** Audit evidence (Confirmed (logic) / Likely (UI re-trigger — would need to verify the button is shown after refund)). Git: LocalRepositories.kt: `94471e8 2026-08-28`.
- **Root cause:** The Android `LocalPaymentRepository.refund()` was modeled on the local-mutation pattern (update + sync enqueue) without copying the SQL RPC's status-guard. The author assumed the UI would prevent re-refunds, but the UI guard is separate from the data-layer guard.
- **Current behavior:** The Android refund method is non-idempotent — calling it twice for the same payment creates a second reversal ledger entry and double-subtracts from installments.
- **Expected behavior:** A second refund call for an already-refunded payment should be rejected with a "payment already refunded" error (parallel to the EF's 409 response and the SQL RPC's RAISE EXCEPTION).
- **Proposed resolution:** A second refund call for an already-refunded payment should be rejected with a "payment already refunded" error (parallel to the EF's 409 response and the SQL RPC's RAISE EXCEPTION).
- **Dependencies:** CROSS-200
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### BUSINESS-104 — `markClearedFallback` uses sequential `await` per installment; swallows per-installment errors causing cascading over-allocation

- **Category:** BUSINESS  |  **Severity:** Medium  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-013 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-013, 11th session): resolved by the same removal — no client-side installment cascade exists anymore; the RPC aborts atomically on the first error.
- **Consolidated from:** second-pass BUSINESS-104
- **Description:** `SupabasePaymentRepository.markClearedFallback()` (lines 1217-1274) loops installments in a `for...of` with sequential `await` calls: `await this.client.from("installments").update({...}).eq("id", raw.id)`. If installment A's update fails (RLS denial, network blip, CHECK constraint), the error is caught at line 1269 with `if (uErr) console.warn(...)` and the loop CONTINUES to installment B. Critically, the `remaining` variable is decremented at line 1270 (`remaining -= moved`) based on the ASSUMPTION that A's update succeeded. When the loop reaches B, `remaining` still includes A's amount → B gets over-allocated (the engine allocates `min(remaining, B.amount_pending)` which is now too large). The canonical `mark_payment_cleared` SQL RPC (migration 0040:202-303) uses `FOR v_ins IN ... FOR UPDATE` (PostgreSQL row locks) within a single transaction — if any installment update fails, the entire transaction rolls back; no cascading over-allocation is possible.
- **Location:** - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1244-1271` (sequential loop with swallowed errors) - `elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:238-284` (canonical RPC with FOR UPDATE + transaction)
- **Evidence:** Audit evidence (Confirmed). Git: supabase-shared-repositories.ts: `84dd13f okay`.
- **Root cause:** The fallback was written as a sequential async loop (TypeScript `for...of await`) without wrapping in a Supabase transaction (`db.tx()` API). Row-level error handling was added as a defensive afterthought (`if (uErr) console.warn`) without considering the cascading effect on `remaining`.
- **Current behavior:** Failed updates are logged and skipped; `remaining` is decremented as if they succeeded; subsequent installments get over-allocated.
- **Expected behavior:** When an installment update fails, the loop should ABORT and the entire operation should fail (or roll back). The `remaining` budget should only decrement for successfully-updated installments.
- **Proposed resolution:** When an installment update fails, the loop should ABORT and the entire operation should fail (or roll back). The `remaining` budget should only decrement for successfully-updated installments.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Cross-Platform Consistency

### CROSS-001 — Migration numbering conflict between desktop and website Supabase folders

- **Category:** CROSS  |  **Severity:** Critical  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-048 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-048, 11th session): the website 4 portal-patch migrations REMOVED (commit 4faf007); hub AGENTS.md records the desktop chain 0001–0057 as the only chain (ADR-001). Session-12 live diff: versions match one-to-one, zero drift.
- **Consolidated from:** first-pass CROSS-001, first-pass CROSS-010
- **Description:** The desktop repo's `supabase/migrations/` uses a sequence starting at 0001 and going to 0043. The website repo's `supabase/migrations/` uses the SAME numbering scheme but for DIFFERENT content: desktop 0025 = `waterfall_allocation`, website 0025 = `device_tokens`; desktop 0027 = `shared_unification`, website 0027 = `portal_parent_rls_policies`; desktop 0028 = `shared_schema_extensions`, website 0028 = `notification_preferences`. Supabase migration filenames are globally unique per project — if both sets are applied to the same Supabase project, the second `supabase migration apply` would either skip them (treating them as already-applied) or fail.
- **Location:** Desktop: `elimtiyaz-desktop/supabase/migrations/0025..0028_*.sql`. Website: `elimtiyaz-website/supabase/migrations/0025..0028_*.sql` ;; [CROSS-010] `elimtiyaz-website/supabase/migrations/0025_device_tokens.sql:1-33` (rewrite note) + `0026-0028` (the other three patches)
- **Evidence:** Audit evidence (Confirmed). Git: Cross-repo ls confirmed the website folder has 4 migrations with conflicting numbers. The desktop's migration set was created 2026-08-04 to 2026-08-28.
- **Root cause:** Each repo independently numbered its migrations starting at 0001 (the Supabase convention), without coordinating with the other repos that share the same Supabase project.
- **Current behavior:** If the website's `0025_device_tokens.sql` is applied first, the desktop's `0025_waterfall_allocation.sql` is silently skipped (Supabase tracks applied migrations by filename). Result: the desktop's waterfall allocator RPC is never created, but the desktop's code assumes it exists.
- **Expected behavior:** The desktop's migrations are the "canonical" financial/CRM/academic schema (0001-0043). The website's are portal-specific patches (device tokens, attendance justification, portal RLS, notification preferences).
- **Proposed resolution:** Declare the desktop repo's supabase/migrations the single canonical chain (ADR-001). Website/Android repos must not carry independent migration files; the four website patches (0025-0028) are already absorbed by desktop 0043 - delete the duplicates or replace them with a README-pointer note (non-.md). Verification: fresh database provisioned from the desktop chain alone passes all equivalence layers.
- **Dependencies:** none recorded
- **Absorbed findings:** CROSS-010: The website's `supabase/migrations/` folder has `0025_device_tokens.sql`, `0026_attendance_justification_columns.sql`, `0027_portal_parent_rls_policies.sql`, `0028_notification_preferences.sql`. The desktop's `supabase/migrations/` folder has `0025_waterfall_allocation.sql`, `0026_unified_financial.sql`, `0027_shared_unification.sql`, `0028_shared_schema_extensions.sql`. The migration VERSION NUMBERS COLLIDE. The website's 0025 was REWRITTEN (per its own header comment) to assume the canonical desktop 0027 has already run: *"The canonical backend chain (desktop repo, migration 0027_shared_unification.sql) already defines `public.device_tokens` with `user_id` — so on any database provisioned from the canonical chain this migration's CREATE TABLE IF NOT EXISTS was a no-op and every subsequent statement FAILED with 'column user_profile_id does not exist'."* The website's migrations are now idempotent patches that "collapse to no-ops when applied after" the desktop's 0043_portal_alignment.sql (which absorbed them). The README (line 51) STILL says *"A Supabase project with the migrations from the desktop repo applied (0001–0024)"* — out of date; the website now requires at least desktop…
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-003 — Android repo's supabase/migrations folder is a partial copy missing the base schema

- **Category:** CROSS  |  **Severity:** High  |  **Status:** TESTED
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-048 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-048, 11th session): the Android repo 6 stale migration copies REMOVED (commit 1bd0d9d); pointer notes in the client AGENTS.md files.
- **Consolidated from:** first-pass CROSS-003, first-pass CROSS-007, second-pass ACAD-104
- **Description:** The Android repo (`/home/z/my-project/repos/elimtiyaz-android/supabase/migrations/`) contains only 6 migration files: `0034_canonical_engine_unification.sql`, `0035_tier3_drop_signature_fixes.sql`, `0036_tier4_backend_hardening.sql`, `0040_cross_platform_rpc_unification.sql`, `0041_canonical_academic_flow.sql`, `0042_canonical_overdue_asof_equivalence.sql`. These are the "canonical fix-up" migrations (0034-0042) that DROP and RECREATE SQL functions. They depend on the base schema (0001-0028) and the original RPC definitions (0022 `collect_payment`, 0025 `allocate_payment_waterfall`, etc.) to drop. If the Android repo's migrations are applied to a fresh database, the DROP statements would no-op (functions don't exist) and the CREATE statements would create the canonical functions in an empty schema (no `payments`, `ledger_entries`, etc. tables) → runtime errors.
- **Location:** `elimtiyaz-android/supabase/migrations/` (6 files) vs `elimtiyaz-desktop/supabase/migrations/` (43 files) ;; [CROSS-007] `elimtiyaz-android/supabase/migrations/0034_canonical_engine_unification.sql` (5 functions affected) + `0036_tier4_backend_hardening.sql` (2 functions) + `0040_cross_platform_rpc_unification.sql` (3 functions) + `0041_canonical_academic_flow.sql` (2 functions) ;; [ACAD-104] - `elimtiyaz-android/supabase/migrations/` (6 migration files) - `elimtiyaz-desktop/supabase/migrations/` (44 migration files including the base 0001-0033)
- **Evidence:** Audit evidence (Confirmed (ls confirmed)). Git: The Android repo's migrations were likely copied from the desktop after 0034-0042 were authored, without including the base.
- **Root cause:** The Android team copied the "latest canonical fix" migrations to their repo, assuming the desktop would handle the base schema. But Supabase migrations are tracked per-project per-repo — there's no concept of "base from another repo".
- **Current behavior:** Desktop migrations: complete schema + canonical fixes. Android migrations: canonical fixes only (depend on desktop's base). Website migrations: portal patches only (collide with desktop's base).
- **Expected behavior:** The desktop repo's full migration set (0001-0043) is canonical.
- **Proposed resolution:** The desktop repo's full migration set (0001-0043) is canonical.
- **Dependencies:** none recorded
- **Absorbed findings:** CROSS-007: The Android repo carries 6 of the desktop's migrations (0034, 0035, 0036, 0040, 0041, 0042). Of these, migrations 0034, 0036, 0040, 0041 DIFFER from the desktop's canonical versions: the desktop's versions have `LANGUAGE plpgsql SET search_path = public, extensions;` on SECURITY DEFINER functions (protection against search_path hijacking), but the Android's versions have just `LANGUAGE plpgsql;` (no search_path pinning). Migration 0042 is byte-identical; migration 0035 is byte-identical. | ACAD-104: The Android repo's `supabase/migrations/` directory contains only 6 files: `0034_canonical_engine_unification.sql`, `0035_tier3_drop_signature_fixes.sql`, `0036_tier4_backend_hardening.sql`, `0040_cross_platform_rpc_unification.sql`, `0041_canonical_academic_flow.sql`, `0042_canonical_overdue_asof_equivalence.sql`. These migrations ALTER existing tables (`attendance_records`, `homework`, `assessments`, `grades`, `class_subjects`) and CREATE functions that reference other tables (`students`, `parents`, `user_profiles`, `tenants`, `ledger_entries`, `installments`, `payments`). The base schema (migrations 0001-0033) is NOT in the Android repo — they live only in the desktop repo. Applying Android migrations to a fresh database fails immediately: migration 0034 ALTERs tables that don't exist yet, migration 0041 ALTERs `attendance_records` (created in 0004) and `homework` (created in 0029) — both tables are missing if 0004 + 0029 haven't run.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-004 — `bind-activation-code` Edge Function had to be patched to accept both `code` and `activation_code` body keys

- **Category:** CROSS  |  **Severity:** Low  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Desktop, Website
- **Task:** T-028 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass CROSS-004
- **Description:** The `bind-activation-code` Edge Function accepts both `body.activation_code` (desktop/Android) and `body.code` (Next.js portal) body keys. The function comment at lines 63-66 explains: "CROSS-PLATFORM COMPATIBILITY (vault §02.08): the same deployed function serves both the Web Portal (body key `code`) and the desktop/Android clients (body key `activation_code`). Accept either key — no behavioral difference." This is a documented fix for a regression: the original function only accepted `activation_code`, so when the Next.js portal was deployed calling with `code`, the portal's parent-binding flow was broken. The fix was applied after-the-fact.
- **Location:** `elimtiyaz-desktop/supabase/functions/bind-activation-code/index.ts:34-39, 63-67`
- **Evidence:** Audit evidence (Confirmed). Git: The function comment references "vault §02.08" which was verified in `vault-compliance-verification-3.md` (commit `2e2b21a` 2026-08-28).
- **Root cause:** The original function was written for the desktop/Android without coordinating with the website team. The website was deployed later with a different body key, breaking the flow. The fix accepts both keys as a workaround.
- **Current behavior:** Before the fix: portal calls failed silently (body.activation_code undefined → 400 missing_code). After: both keys accepted.
- **Expected behavior:** N/A — this IS the canonical fix.
- **Proposed resolution:** N/A — this IS the canonical fix.
- **Dependencies:** none recorded
- **Status note:** The dual body-key acceptance is the current cross-platform contract; it will be simplified to one key when T-028 consolidates the activation EF.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-005 — Android `LocalPaymentRepository.collect()` bypasses the canonical `collect_payment` RPC

- **Category:** CROSS  |  **Severity:** Critical  |  **Status:** BLOCKED
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-059 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass CROSS-005, first-pass CROSS-006
- **Description:** Android's payment write path is: write Payment + LedgerEntry + Adjustment entries to Room locally → enqueue `payment/create` + `ledger_entry/create` + (optionally) `ledger_entry/create` (parent_credit) sync entries → `SyncQueueDispatcher.pushPayment` later calls `upsert_payment_from_import` (non-atomic idempotent upsert) instead of the desktop's canonical `collect_payment` atomic RPC. The desktop audit's BUSINESS-002 finding flagged the desktop's `SupabasePaymentRepository.collect()` for silently falling back to `upsert_payment_from_import` on RPC failure — but the Android ALWAYS uses `upsert_payment_from_import` and never even attempts the canonical `collect_payment` RPC.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:942-1090` (LocalPaymentRepository.collect) + `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:193-240` (pushPayment) ;; [CROSS-006] `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1092-1168` (LocalPaymentRepository.refund) + `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:193-287`
- **Evidence:** Audit evidence (Confirmed). Git: `LocalRepositories.kt` history shows `94471e8` (2026-08-28) "fix(core): pending-waterfall capacity subtracts existing uncleared funds" — most recent commit, indicates the waterfall allocation logic was just patched
- **Root cause:** The Android was originally designed as offline-first with local Room as source of truth. The canonical RPC pattern (desktop) requires online-first semantics. Rather than bridge the two (e.g. call `collect_payment` when online, fall back to local write when offline), the Android bypassed the canonical RPC entirely and uses the import-upsert RPC as the only push path — which is non-atomic and lacks the canonical RPC's invariants.
- **Current behavior:** (1) Android computes waterfall allocation LOCALLY via `allocatePaymentToInstallments` then pushes the resulting installments via `upsert_installment_from_import` — the desktop's `collect_payment` RPC computes waterfall SERVER-SIDE in a single atomic transaction. (2) Android's `receipt = "REC-$year-$seq"` is generated LOCALLY (see BUSINESS-006) — desktop's RPC generates the receipt server-side. (3) Android's path is non-atomic: if the network fails after writing Payment but before writing LedgerEntry, the local Room has inconsistent state and the sync queue has orphan entries. (4) Android's path doesn't respect any server-side CHECK constraints until the queue drains — invalid payments land locally first, then fail on push.
- **Expected behavior:** Desktop's canonical `collect-payment` Edge Function (`/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/collect-payment/index.ts`) — atomic, server-side, includes waterfall allocation + receipt generation + audit trail
- **Proposed resolution:** Desktop's canonical `collect-payment` Edge Function (`/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/collect-payment/index.ts`) — atomic, server-side, includes waterfall allocation + receipt generation + audit trail
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-002 / ADR-005 (Android target write architecture).
- **Absorbed findings:** CROSS-006: Android's refund path is: update Payment status to REFUNDED in Room → enqueue `payment/refund` sync entry → locally create `createReversalEntry` in ledger → enqueue `ledger_entry/reverse` sync entry → locally call `revertPaymentAllocation` to revert installment allocations. The `SyncQueueDispatcher` later calls `upsert_payment_from_import` with `status=refunded` for the payment row and `upsert_ledger_entry_from_import` for the reversal entry. The desktop's canonical `refund-payment` Edge Function (`/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/refund-payment/index.ts`) is NEVER called from Android.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-009 — Website's `bind-activation-code` Edge Function is a drifted duplicate of the desktop's canonical version (no shared helpers, no audit log, different body key handling)

- **Category:** CROSS  |  **Severity:** High  |  **Status:** BLOCKED
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-028 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass CROSS-009, first-pass BUSINESS-008, second-pass SEC-104
- **Description:** The website has its own `supabase/functions/bind-activation-code/index.ts` (216 lines) that is a STANDALONE, OLDER, less-featured duplicate of the desktop's canonical version (133 lines). Differences: (1) Website's version has inline CORS headers, inline Supabase client construction, inline JWT verification — desktop's version uses shared `_shared/cors.ts` (`corsHeaders`, `handleOptions`, `jsonError`, `jsonOk`) and `_shared/supabase.ts` (`createServiceRoleClient`, `extractAuthContext`, `writeAuditLog`). (2) Website's version reads ONLY `body.code` (line 105: `let body: { code?: string }`); desktop's version reads BOTH `body.activation_code ?? body.code` (line 67). (3) Website's version has NO audit log write; desktop's version writes `activation_code.bind` audit log via `writeAuditLog` (lines 108-124). (4) Website's version has DIFFERENT business logic (activates the user — see BUSINESS-008); desktop's version does not. Per the desktop audit's CROSS-004, the desktop's version is canonical.
- **Location:** `elimtiyaz-website/supabase/functions/bind-activation-code/index.ts` (entire file) ;; [BUSINESS-008] `elimtiyaz-website/supabase/functions/bind-activation-code/index.ts:174-205` (activation logic). Compare: `elimtiyaz-desktop/supabase/functions/bind-activation-code/index.ts:78-133` (no activation logic — just RPC + audit log). ;; [SEC-104] `elimtiyaz-website/supabase/functions/bind-activation-code/index.ts`, lines 97-205
- **Evidence:** Audit evidence (Confirmed (verified via `diff` — 2/3 of lines differ)). Git: Website's version introduced in commit `e90dbf7` "mid" (2026-08-01). Desktop's version is more recent (per CROSS-004, the dual-key patch was in commit `2e2b21a` 2026-08-28). The website's local copy was never reconciled with the desktop's canonical version.
- **Root cause:** The two Edge Functions were written independently by different teams/agents. The website's version was written first (2026-08-01) for the Path A self-service activation flow. The desktop's version was written/refactored later with shared helpers, the dual-key compatibility patch, and audit logging. Neither team noticed the other's version.
- **Current behavior:** See BUSINESS-008 for the activation-logic divergence. Additionally: the website's version doesn't write an audit log (so binds are invisible in the audit trail), and doesn't use the shared helpers (so any future fix to `_shared/supabase.ts` wouldn't propagate to the website's version).
- **Expected behavior:** Desktop's `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/bind-activation-code/index.ts` is canonical (per CROSS-004: uses shared helpers, accepts both body keys, writes audit logs, has the vault §02.08 cross-platform compatibility comment).
- **Proposed resolution:** After UNKNOWN-001 is decided: keep exactly one bind-activation-code Edge Function (the desktop's shared-helper version), move the decided activation semantics into it (or into the SQL RPC), delete the website's standalone copy, and cover both body keys until all clients are aligned. Test: bind from desktop, Android, and website all produce identical server-side state and one audit entry.
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-001 (activation-bind contract). The two Edge Functions cannot be consolidated until it is decided whether binding an activation code activates the user account.
- **Absorbed findings:** BUSINESS-008: The website's local copy of the `bind-activation-code` Edge Function, after calling the canonical `bind_activation_code()` SQL RPC, ALSO (a) upserts a `role_assignments` row granting the `parent` role, AND (b) flips `user_profiles.status` to `'active'` and clears `approval_request_id`. The desktop's canonical version of the same Edge Function does NEITHER — it just calls the RPC and writes an audit log. The SQL RPC `bind_activation_code()` itself (migration 0005_crm.sql) only updates `parents.auth_user_id` and marks the code as bound — it does NOT touch `user_profiles` or `role_assignments`. So the website's Edge Function has unique post-binding activation logic that the desktop's version lacks. Depending on which Edge Function is deployed, the same activation code either: (a) activates the user immediately (website version) → user lands on the dashboard; OR (b) leaves the user in `pending` status (desktop version) → user sees the pending screen again after refresh. | SEC-104: The website's `bind-activation-code` EF (1) flips `user_profiles.status` from any non-active state to `'active'` — including suspended and deleted users; (2) upserts a `role_assignments` row granting the `'parent'` role with `assigned_by = profile.id` (self-assignment); (3) sets `approval_request_id = null` — severing the link to the original approval request.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-100 — Demo account emails and passwords diverge between Desktop and Android (financial@ vs finance@)

- **Category:** CROSS  |  **Severity:** Medium  |  **Status:** TESTED (2026-08-29 — desktop half T-001, Android half T-002)
- **Status note:** The DESKTOP demo-account list was deleted entirely (T-001), removing the desktop side of the divergence. The ANDROID demo list (LoginViewModel.kt, single shared password) was deleted 2026-08-29 (T-002 session, android commit `89eec61`): with roles no longer derived from emails (SEC-102) and the shared "demo1234" password never valid against a configured server, the chips were misleading UI; the debug demo sandbox (unconfigured + debug builds only) still signs in with any typed credentials. No demo credentials ship in either client any more.
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-001 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CROSS-100
- **Description:** The desktop and Android login screens ship with different demo account emails and passwords for the same roles. Desktop uses `financial@elimtiyaz.dz` / `fin123`; Android uses `finance@elimtiyaz.dz` / `demo1234`. The Android role inference (SEC-101, SEC-102) uses substring matching on "finance" so both emails match — but the desktop mock seed accounts only recognize `financial@elimtiyaz.dz`.
- **Location:** - Desktop: `elimtiyaz-desktop/src/features/auth/login-screen.tsx` lines 24-34 - Android: `elimtiyaz-android/app/src/main/java/com/example/ui/features/auth/LoginViewModel.kt` lines 77-91
- **Evidence:** Audit evidence (Confirmed). Git: Desktop commit `63704051` (2026-08-27, "gg"); Android commit `c207dca6` (2026-08-02, "mid")
- **Root cause:** Two independent implementations of the demo-account list — no shared constant.
- **Current behavior:** 9 different passwords (desktop) vs 1 shared password (android). Email prefixes differ ("financial" vs "finance"). Role names: desktop uses French labels; Android uses English role codes.
- **Expected behavior:** Demo accounts should be consistent across platforms (single source of truth).
- **Proposed resolution:** Demo accounts should be consistent across platforms (single source of truth).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-101 — `receipts` table is orphaned; website's receipt download is permanently broken

- **Category:** CROSS  |  **Severity:** Critical  |  **Status:** BLOCKED
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-066 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CROSS-101
- **Description:** Migration 0007 (lines 205-217) creates a `receipts` table with `pdf_path`, `receipt_kind`, `payment_id`, `receipt_number`, `generated_by`. The old `collect_payment` SQL RPC (migration 0022:204-212) inserted into `receipts` after every payment. Migration 0034/0035 DROPPED `collect_payment` and replaced it with `collect_and_allocate_payment` — which does NOT insert into `receipts` (it only sets `receipt_number` on the `payments` row). The desktop's `SupabasePaymentRepository.generateReceipt()` (lines 1459-1485) fetches from `payments` and returns a domain object with `pdfUrl: null` — does NOT insert into `receipts`. Its comment (line 1460) literally says "There is no `receipts` table" — FALSE. The desktop's `ReceiptsTab` (receipts-tab.tsx:50-72) generates PDFs client-side via `generatePaymentReceiptPdf(payment, parent)` and never queries the `receipts` table. The website's `useReceiptsForPayment` (portal-queries.ts:263-280) queries `receipts` by `payment_id` — ALWAYS returns null. The website's `PaymentRowItem.downloadReceipt` (financial-view.tsx:333-356) shows "indisponible" toast because `receipt?.pdf_path` is null.
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0007_financial.sql:205-217` (table definition) - `elimtiyaz-desktop/supabase/migrations/0022_functions.sql:204-212` (old collect_payment inserted into receipts) - `elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:46-197` (canonical RPC, NO receipts insert) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1459-1485` (generateReceipt — doesn't insert) - `elimtiyaz-website/src/lib/hooks/portal-queries.ts:263-280` (useReceiptsForPayment — queries empty table) - `elimtiyaz-website/src/features/financial/financial-view.tsx:333-356` (downloadReceipt — always fails)
- **Evidence:** Audit evidence (Confirmed). Git: Migration 0040 (last canonical RPC rewrite) commit history matches the desktop's main branch.
- **Root cause:** When migration 0034 dropped `collect_payment` and replaced it with `collect_and_allocate_payment`, the receipt-table insert was dropped too — the new RPC's author considered `payments.receipt_number` sufficient. The desktop's `generateReceipt` method was rewritten as a no-op that just reads back the payment. The website's queries were never updated to read from `payments` instead. The comment "There is no `receipts` table" was added to justify the simplification — but the table still exists in the schema and the website still queries it.
- **Current behavior:** The `receipts` table is empty. No production code writes to it. The website's receipt download UI is permanently broken.
- **Expected behavior:** The `receipts` table should store PDF receipts (one per payment, plus account statements) with their storage paths, so parents can re-download them from the website portal without staff intervention.
- **Proposed resolution:** The `receipts` table should store PDF receipts (one per payment, plus account statements) with their storage paths, so parents can re-download them from the website portal without staff intervention.
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-004 (server-side receipt storage requirement).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-102 — Android refund sync payload drops the user's refund reason; server audit log has no reason

- **Category:** CROSS  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-017 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CROSS-102
- **Description:** When Android issues a refund, `LocalPaymentRepository.refund()` enqueues a `payment` sync entry with the payload `{ id, status: "refunded", receiptNumber, updatedAt }` (lines 1102-1105). The `reason` parameter — which the user typed into the mandatory reason field (PaymentDetailScreen.kt:362-368, validated to be >= 3 chars at line 378) — is NOT included in the payload. The local audit log entry (line 1165-1166) captures the reason as `{"reason":"$reason"}` in its `afterJson`, but the audit_log entity is in the SyncQueueDispatcher's "local-only else branch" (line 90-93) — it's never pushed to the server. The server's `audit_logs` table (when the refund sync pushes the payment status update via `upsert_payment_from_import`) has NO record of the refund at all (the upsert RPC doesn't write audit logs). The desktop's parallel path `SupabasePaymentRepository.refund()` hardcodes `"Manual refund"` as the reason (BUSINESS-003). So across all platforms, the server's audit trail for refunds is either missing (Android) or generic (desktop fallback "Manual refund").
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1099-1107` (Android refund sync payload — no reason) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1165-1166` (local audit log — captures reason but never synced) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:90-93` (audit_log entity is local-only)
- **Evidence:** Audit evidence (Confirmed). Git: LocalRepositories.kt refund method last touched `94471e8 2026-08-28`; SyncQueueDispatcher.kt last touched `94471e8 2026-08-28`.
- **Root cause:** The Android sync enqueue was scoped to "what the server needs to update the row" (status + receiptNumber) — the reason was considered "extra metadata" that lives in the local audit log. The local audit log was then categorized as "local-only" because audit_logs sync wasn't a priority, decoupling the reason from the server entirely.
- **Current behavior:** The server has no record of the refund reason for Android-initiated refunds. The reason exists only in the Android device's local Room audit_logs table — which is wiped if the user clears app data or reinstalls.
- **Expected behavior:** The server's audit trail should record WHY each refund was issued (compliance requirement for financial auditing — typically "Dispute", "Bounced check after clearance", "Duplicate entry", etc.).
- **Proposed resolution:** The server's audit trail should record WHY each refund was issued (compliance requirement for financial auditing — typically "Dispute", "Bounced check after clearance", "Duplicate entry", etc.).
- **Dependencies:** CROSS-200 (dispatcher must surface errors before payload gaps can be verified)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-103 — Android refund sync does NOT push installment state changes; server-side installments stay stale

- **Category:** CROSS  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-017 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CROSS-103
- **Description:** When Android issues a refund, `LocalPaymentRepository.refund()` (lines 1153-1162) reverts the installment allocations locally via `installmentDao.update(...)` (subtracting from `amount_paid` or `amount_pending` per the LIFO `revertPaymentAllocation` engine). But the method does NOT call `syncSupport?.enqueueOnly(entity = "installment", ...)` for the affected installments. The sync queue contains entries for `payment` (status update) and `ledger_entry` (reversal entry), but NOT for `installment`. The server-side installments table retains the pre-refund `amount_paid` / `amount_pending` / `status` values.
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1145-1162` (installment revert loop — no sync enqueue)
- **Evidence:** Audit evidence (Confirmed). Git: LocalRepositories.kt: `94471e8 2026-08-28`.
- **Root cause:** The `syncSupport` was wired into collect/refund for the `payment` and `ledger_entry` entities (the "obvious" financial records), but the `installment` entity was overlooked — possibly because the installments table was historically a "derived" view computed by triggers, and only later (migration 0025_waterfall_allocation) became a first-class table that needed explicit sync.
- **Current behavior:** The installment changes stay local to the Android device. The server-side installments are permanently stale until the desktop independently re-runs the canonical refund RPC (which it can't — DEAD-015).
- **Expected behavior:** The installment state changes from a refund should propagate to the server so the website (and any other client) sees the reverted tranche statuses.
- **Proposed resolution:** The installment state changes from a refund should propagate to the server so the website (and any other client) sees the reverted tranche statuses.
- **Dependencies:** CROSS-200
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-104 — Desktop SupabasePaymentRepository cache never re-seeds from server; no realtime, no manual refresh

- **Category:** CROSS  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-034 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CROSS-104, second-pass CACHE-103
- **Description:** The desktop's `SupabasePaymentRepository` uses a `SubjectBehavior<Payment[]>` in-memory cache. The `seed()` method (lines 997-1012) is gated by a `seeded` boolean flag — once `seeded = true` (line 999), subsequent `seed()` calls return immediately without re-fetching. There are NO Supabase Realtime subscriptions anywhere in `supabase-shared-repositories.ts` (grep for `channel`/`subscribe`/`realtime` returns 0 hits). The desktop's SyncService is push-only (it drains outbound queue entries); it has no pull-from-server logic. The website's `useFinancialRealtime` (use-realtime.ts:114-131) DOES use realtime for payments+installments. So when Android collects a payment and pushes it to Supabase, the website sees it via realtime, but the desktop's cache stays stale until the desktop app is restarted (which re-creates the repository and re-seeds).
- **Location:** - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:997-1012` (seed method with seeded flag) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1014-1033` (observe methods — all call seed once) - `elimtiyaz-desktop/src/infrastructure/supabase/supabase-client.ts:104-106` (realtime config exists but unused) ;; [CACHE-103] - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:54-160` (SupabaseAcademicYearRepository — Subject + refresh-on-write pattern) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:997-1012` (SupabasePaymentRepository — same pattern, already documented in CROSS-104)
- **Evidence:** Audit evidence (Confirmed). Git: supabase-shared-repositories.ts: `84dd13f okay`. The comment "Realtime subscriptions can be layered on later" has been there since initial authoring.
- **Root cause:** The SubjectBehavior pattern was inherited from the mock repository (which doesn't need realtime — it's the source of truth). When the Supabase-backed repository was implemented, the same pattern was copied with a TODO comment for realtime. The TODO was never addressed.
- **Current behavior:** The cache is seeded once per app session. Subsequent writes from other clients (Android, website, other desktop instances, server-side EFs) are invisible until restart.
- **Expected behavior:** Per the comment at line 21: "Realtime subscriptions can be layered on later." — the design called for realtime to keep the cache fresh. The "later" never happened.
- **Proposed resolution:** Per the comment at line 21: "Realtime subscriptions can be layered on later." — the design called for realtime to keep the cache fresh. The "later" never happened.
- **Dependencies:** none recorded
- **Absorbed findings:** CACHE-103: The desktop's `SupabaseAcademicYearRepository` (supabase-academic-repository.ts:54-160) uses a `SubjectBehavior<AcademicYear[]>` cache (line 55), populated once in the constructor via `this.refresh()` (line 58). Local writes (`createAcademicYear`, `updateAcademicYear`, `setCurrentYear`) call `await this.refresh()` after the write to update the cache. But there is NO Supabase Realtime subscription. When another client (another desktop instance, the Android app, the website, or a server-side EF) modifies the `academic_years` table, this desktop's cache stays stale. This is the SAME pattern as the payment repository (CROSS-104) but for academic data — which has more conflict potential because the `is_current` flag is a singleton (only one academic year can be current per tenant). Two desktop admins concurrently setting different years as current → both call `setCurrentYear` → both unset the flag on others, both set the flag on theirs → the LAST WRITE WINS, the first admin's choice is silently overwritten. Neither admin sees the other's change until they restart their app.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-104b — Desktop defaultPushHandler persists `sync_queue` row in Supabase for audit trail; Android SyncQueueDispatcher does not

- **Category:** CROSS  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-034 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CROSS-104b
- **Description:** The desktop's `defaultPushHandler` (sync-provider.tsx:92-103) upserts a row into the Supabase `sync_queue` table for every pushed entry — providing a server-side audit trail of sync attempts. The Android's `SyncQueueDispatcher.pushEntry` (lines 52-98) calls `pushPayment`/`pushParent`/etc directly — no `sync_queue` row persisted server-side. The Android's only audit trail is in local Room (`SyncQueueEntity`) and the local `audit_logs` table (which is never synced, per SyncQueueDispatcher line 90-93).
- **Location:** - `elimtiyaz-desktop/src/app/providers/sync-provider.tsx:92-103` (desktop persists sync_queue row) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:52-98` (Android does not persist sync_queue row)
- **Evidence:** Audit evidence (Confirmed). Git: sync-provider.tsx: `84dd13f okay`. SyncQueueDispatcher.kt: `94471e8 2026-08-28`.
- **Root cause:** The desktop's sync was built around the `sync_queue` table as the audit trail (per migration 0027's design). The Android's sync was built around local Room + WorkManager — the server-side sync_queue table was considered desktop-specific and not adopted.
- **Current behavior:** Desktop leaves a sync_queue row server-side. Android leaves no server-side trace of its sync attempts — only local Room records (which are wiped on app reinstall).
- **Expected behavior:** Both platforms should leave a server-side audit trail of sync attempts (who pushed what, when, with what payload, success/failure).
- **Proposed resolution:** Both platforms should leave a server-side audit trail of sync attempts (who pushed what, when, with what payload, success/failure).
- **Dependencies:** none recorded
- **Status note:** Server-side sync_queue audit trail divergence; folds into the sync architecture work under ADR-005.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CROSS-200 — Android sync dispatcher swallows RPC errors silently; desktop sync dispatcher throws and retries

- **Category:** CROSS  |  **Severity:** Critical  |  **Status:** TESTED (2026-08-29)
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-019 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CROSS-200
- **Description:** The Android `SyncQueueDispatcher.pushPayment` (and `pushParent`/`pushStudent`/`pushLedgerEntry`/`pushInstallment`) wrap the `supabaseProvider.postgrest.rpc(...)` call inside `NetworkTimeouts.guard { ... }` and DISCARD the result. The Kotlin Supabase SDK's `rpc()` returns an `HttpResponse` whose body/error must be explicitly read; the dispatcher doesn't read either. If the server returns 400 (FK violation, NOT NULL constraint, RLS denial, trigger exception) or 500, the SDK doesn't throw — the response is silently dropped. The SyncService then marks the entry as "synced". By contrast, the desktop's `defaultPushHandler` does `const { error } = await client.rpc(...); if (error) throw error;` — propagates to SyncService.drain which marks as failed and retries with backoff.
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:237-239` (pushPayment) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:162-164` (pushParent) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:188-190` (pushStudent) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:284-286` (pushLedgerEntry) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:321-323` (pushInstallment) - `elimtiyaz-desktop/src/app/providers/sync-provider.tsx:166-183` (desktop payment push — checks error)
- **Evidence:** Audit evidence (Confirmed). Git: SyncQueueDispatcher.kt last touched `94471e8 2026-08-28 fix(core): pending-waterfall capacity subtracts existing uncleared funds`. sync-provider.tsx in desktop commit `84dd13f okay`.
- **Root cause:** The Kotlin Supabase SDK's API surface returns an `HttpResponse` rather than throwing on 4xx/5xx; the desktop's JS SDK returns `{ data, error }` which forces the caller to handle the error. The Android developer mirrored the desktop's structural pattern but missed the SDK's error-handling semantic difference.
- **Current behavior:** The Android sync push reports success for any non-throwing response, including 4xx/5xx with error payloads. The local Room cache and the server drift apart silently.
- **Expected behavior:** The Android sync push should fail loudly when the server rejects the write — same as the desktop path — so the entry stays pending and retries.
- **Proposed resolution:** Read the HttpResponse body/status in every SyncQueueDispatcher.push* method and throw on 4xx/5xx so the entry stays pending and retries - mirroring the desktop defaultPushHandler contract. Test: server 400 leaves the entry pending with lastError set.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.
- **Status note (2026-08-29, T-019):** RESOLVED — with a CORRECTED root cause. The entry above claims "the SDK returns an HttpResponse and doesn't throw"; that does NOT hold for the pinned supabase-kt 3.1.1: bytecode verification of the actual artifact shows `SupabaseApi.rawRequest` checks `!status.isSuccess() && parseErrorResponse != null` and throws (PostgrestImpl wires `parseErrorResponse` = `PostgrestRestException`; `AuthenticatedSupabaseApi.rawRequest` delegates to `SupabaseApi.rawRequest`). The REAL swallowing layer is `NetworkTimeouts.guard`: its `catch (e: Throwable) → null` converted the SDK's exception into a null return the dispatcher discarded, so `pushEntry` returned normally and SyncService marked rejected writes "synced". FIX: new `NetworkTimeouts.guardSyncPush` (propagates block exceptions; converts timeouts into a plain `SyncPushTimeoutException`) + all 8 dispatcher push paths switched to it; `SyncService.drainPending` unchanged — its existing catch already implements the desktop contract (pending + lastError + backoff; audit + failed at maxAttempts). Regression suite `SyncErrorSurfacingTest` (5 tests: propagation, timeout→RuntimeException, success passthrough, source-scan pins on all 8 paths + no catch-Throwable in guardSyncPush). `./gradlew :app:testDebugUnitTest` = 207/207. LESSON for future agents: when an audit claims an SDK "doesn't throw", verify against the PINNED artifact's bytecode before designing the fix — the real defect was one layer higher than described. Gap for VERIFIED: live 400/500 round-trip vs a deployed backend.

---

## Synchronization & Offline

### SYNC-100 — Desktop defaultPushHandler silently drops installment / homework / grade / attendance entity kinds

- **Category:** SYNC  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-022 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-022, 12th session): defaultPushHandler extracted to src/infrastructure/sync/default-push-handler.ts; installment/attendance/grade push through their canonical RPCs (0037/0041), homework upserts the canonical table (Android parity), and EVERY other kind throws — the entry is marked failed with an explicit error, never silently 'synced'. 12-test suite behavioral + source-scan.
- **Consolidated from:** second-pass SYNC-100
- **Description:** The desktop's `defaultPushHandler` (sync-provider.tsx:107-213) only handles 4 entity kinds in its switch statement: `parent`, `student`, `payment`, `ledger_entry`. The `SyncEntityKind` union (sync-types.ts:11-26) declares 15 kinds: parent, student, payment, **installment**, expense, invoice, ledger_entry, personnel, **attendance**, **grade**, **homework**, audit_log, notification, calendar_event, other. The remaining 11 kinds all fall through to the `default:` branch (line 209-212) which is a NO-OP — the queue entry is marked as "synced" by SyncService.drain (sync-service.ts:357-364) WITHOUT any server-side upsert having happened. The desktop's Excel importer (excel-import-modal.tsx:260-281) DOES enqueue entries with `entity: "installment"` (the type assertion at line 261 explicitly includes "installment" as a possible kind) when running in mock mode. So installment sync entries from Excel imports are silently dropped — the local mock store has them, the server never gets them, and the queue reports them as "synced".
- **Location:** - `elimtiyaz-desktop/src/app/providers/sync-provider.tsx:107-213` (switch with only 4 cases; default is silent no-op) - `elimtiyaz-desktop/src/infrastructure/sync/sync-types.ts:11-26` (SyncEntityKind declares 15 kinds) - `elimtiyaz-desktop/src/features/crm/excel-import-modal.tsx:260-281` (enqueues "installment" entities in mock mode) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:69-98` (Android handles 7 entity kinds: parent/student/payment/ledger_entry/installment/homework/grade/attendance)
- **Evidence:** Audit evidence (Confirmed). Git: sync-provider.tsx last touched `84dd13f okay` (2026-08-27). Migration 0037 introduced `eeb82db right` (2026-08-21) — the migration is OLDER than the latest sync-provider touch, so the dispatcher could have been updated but wasn't.
- **Root cause:** Migration 0037 was authored as part of the "TIER 4 cross-platform sync hardening" wave that focused on Android. The desktop's defaultPushHandler predates the migration and was never updated. The migration's header comment explicitly enumerates the Android-only fix scope ("Android enqueues installment mutations but the SyncQueueDispatcher had no case for them") without mentioning the desktop dispatcher's parallel gap.
- **Current behavior:** The desktop's defaultPushHandler silently drops any entry whose entity isn't one of the 4 explicitly-handled kinds. The desktop's `SyncEntityKind` type advertises 15 kinds; only 4 work. The 11 unhandled kinds silently lose data.
- **Expected behavior:** Per migration 0037 (line 15-18): *"NO INSTALLMENT PUSH — Android enqueues installment mutations but the SyncQueueDispatcher had no case for them (silent no-op). The server never learns Android-side waterfall results. Fix: new idempotent `upsert_installment_from_import` RPC."* The migration explicitly addresses the "silent no-op" anti-pattern — but only the Android dispatcher was updated. The desktop was never updated to call the new RPC.
- **Proposed resolution:** Per migration 0037 (line 15-18): *"NO INSTALLMENT PUSH — Android enqueues installment mutations but the SyncQueueDispatcher had no case for them (silent no-op). The server never learns Android-side waterfall results. Fix: new idempotent `upsert_installment_from_import` RPC."* The migration explicitly addresses the "silent no-op" anti-pattern — but only the Android dispatcher was updated. The desktop was never updated to call the new RPC.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SYNC-101 — Desktop defaultPushHandler overwrites sync_queue row status="pending" on every drain, clobbering audit history

- **Category:** SYNC  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-022 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-022, 12th session): the sync_queue audit-trail upsert now uses { onConflict: 'id', ignoreDuplicates: true } — the first insert wins; re-drains never reset status to 'pending' or clear last_error; mark_sync_queue_processed records each attempt's outcome.
- **Consolidated from:** second-pass SYNC-101
- **Description:** The desktop's `defaultPushHandler` (sync-provider.tsx:92-103) upserts a row into the server-side `sync_queue` table with `status: "pending"` BEFORE attempting the entity-specific RPC push. The upsert is keyed on the queue entry's `id` (primary key) and uses the default `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` semantics. On every drain attempt — including retries after a previous failure — this upsert OVERWRITES the row's `status` back to "pending" and zeroes out the previous `last_error` (it isn't sent in the upsert, so it gets set to NULL by the conflict-update if the column is nullable, or stays untouched if the upsert doesn't include the column — but the status field is definitely reset). The previous attempt's "failed" status + error message are lost from the server-side audit trail. Only the latest attempt's status survives.
- **Location:** `elimtiyaz-desktop/src/app/providers/sync-provider.tsx:92-104`
- **Evidence:** Audit evidence (Confirmed). Git: sync-provider.tsx last touched `84dd13f okay` (2026-08-27).
- **Root cause:** The upsert was written to ensure the queue row exists before the RPC push (idempotent audit trail). The developer didn't consider that re-draining the same entry would overwrite the previous "failed" state. A cleaner pattern would be to (a) only upsert the queue row if it doesn't already exist, OR (b) upsert with `status: EXCLUDED.status` only when the new status is "synced"/"failed" — not when re-attempting as "pending".
- **Current behavior:** The audit trail is incomplete — it captures only the LATEST attempt's status. The history of prior attempts (their timestamps, their error messages, the count of retries) is overwritten on every drain. An admin querying `SELECT * FROM sync_queue WHERE id = '...'` sees only the current state, not the full retry history.
- **Expected behavior:** Per the function's header comment (sync-provider.tsx:78-82): *"Persist the queue row (audit trail — idempotent by primary key `id`)."* The intent is to leave a server-side audit trail of every sync attempt's outcome.
- **Proposed resolution:** Per the function's header comment (sync-provider.tsx:78-82): *"Persist the queue row (audit trail — idempotent by primary key `id`)."* The intent is to leave a server-side audit trail of every sync attempt's outcome.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SYNC-102 — Desktop sync queue persists across logout/login; user A's pending entries stuck as "failed" under user B's session

- **Category:** SYNC  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-022 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-022, 12th session): sign-out clears the local queue (auth-provider calls getSyncQueueStore().clear()) AND the drain skips entries whose actorId ≠ the current session's user (defense in depth) — no more confused-deputy pushes under user B's JWT.
- **Consolidated from:** second-pass SYNC-102
- **Description:** The desktop's IndexedDB sync queue store (sync-queue-store.ts) is a process-level singleton (`getSyncQueueStore()` returns the singleton `_store`). The store is NEVER cleared on logout. When user A signs out and user B signs in on the same desktop, user A's pending queue entries remain in IndexedDB with their original `tenantId` (user A's tenant) and `actorId` (user A's id). On the next drain attempt (auto or manual), `defaultPushHandler` (sync-provider.tsx:92-104) calls `client.from("sync_queue").upsert({ id, ..., tenant_id: entry.tenantId, ... })` — but the active Supabase session now belongs to user B. The RLS policy on `sync_queue` (migration 0027:1005-1020) is `tenant_id = public.current_tenant_id()`. If user A and user B are in different tenants, the upsert's INSERT fails RLS — `queueErr` is non-null → throw → entry marked as failed. If they're in the SAME tenant, the upsert succeeds, but then the entity RPC (e.g. `upsert_payment_from_import`) runs with user B's session, potentially writing data attributed to user A's actor_id into user A's tenant — a confused audit trail.
- **Location:** - `elimtiyaz-desktop/src/infrastructure/sync/sync-queue-store.ts:181-185` (singleton, never cleared on logout) - `elimtiyaz-desktop/src/app/providers/sync-provider.tsx:92-104` (upsert with stale entry.tenantId) - `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:1005-1020` (RLS requires tenant_id match)
- **Evidence:** Audit evidence (Likely (the queue persistence + RLS denial logic is verified; the actual frequency of shared-desktop cross-tenant use is unknown but plausible for a school frontend).). Git: sync-queue-store.ts last touched in initial commit batch; never had a "clear on logout" hook added. sync-provider.tsx: `84dd13f okay`.
- **Root cause:** The sync layer was designed for a single-user desktop (the typical case). Multi-user shared-desktop scenarios weren't considered. The SyncProvider's `useMemo` (sync-provider.tsx:242-252) constructs the SyncService ONCE and never re-initializes on session change — so the queue + tenantId/actorId callbacks keep their initial bindings (though sessionRef.current is updated, the queue itself is shared).
- **Current behavior:** The queue is process-global. Once user A enqueues entries, they belong to the desktop process — not to user A's session. User B inherits them but can't push them (RLS).
- **Expected behavior:** A user's pending sync queue should be PER-USER — cleared on logout, or scoped so that only the original user's session can drain it.
- **Proposed resolution:** A user's pending sync queue should be PER-USER — cleared on logout, or scoped so that only the original user's session can drain it.
- **Dependencies:** SYNC-101 (queue semantics redesigned together)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SYNC-103 — Android tryThenEnqueue only enqueues on network/offline/timeout errors; server 500s and validation errors lose the mutation

- **Category:** SYNC  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-020 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SYNC-103
- **Description:** Android's `SyncSupport.tryThenEnqueue` (SyncSupport.kt:165-198) wraps a mutation in a try/catch. On exception, it inspects the error code: only `CODE_NETWORK`, `CODE_OFFLINE`, and `CODE_TIMEOUT` trigger the enqueue path. All other error codes (including `CODE_SERVER` / 5xx HTTP responses, `CODE_VALIDATION` / 4xx, `CODE_UNAUTHORIZED` / 401, `CODE_FORBIDDEN` / 403, `CODE_NOT_FOUND` / 404) return the original `Result.Err(error)` WITHOUT enqueuing the operation for later retry. The comment at line 153-154 explicitly says *"For online errors (validation, server, etc.) the original error is returned without enqueuing."* — which is the wrong policy for 5xx errors, which are typically transient (server overload, restart, deployment in progress, DB failover).
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncSupport.kt:165-198`
- **Evidence:** Audit evidence (Confirmed). Git: SyncSupport.kt last touched `94471e8 2026-08-28`.
- **Root cause:** The policy was written to avoid queueing mutations that would NEVER succeed (e.g., validation errors, 401s). But the developer conflated "non-network errors" with "permanent errors" — without distinguishing 5xx (transient) from 4xx (often permanent). The list `CODE_NETWORK, CODE_OFFLINE, CODE_TIMEOUT` is too narrow.
- **Current behavior:** Only network/offline/timeout are enqueued. 5xx server errors return immediately with no enqueue. The mutation is lost from the queue. The user sees a generic "Erreur" toast and must manually retry. If they don't, the data (payment, parent edit, homework push) is gone.
- **Expected behavior:** The boundary between "transient" (should enqueue) and "permanent" (should not enqueue) should be based on whether retrying LATER could succeed. 5xx errors are transient. Validation errors (4xx) are permanent. Auth errors (401/403) require re-auth, not retry.
- **Proposed resolution:** The boundary between "transient" (should enqueue) and "permanent" (should not enqueue) should be based on whether retrying LATER could succeed. 5xx errors are transient. Validation errors (4xx) are permanent. Auth errors (401/403) require re-auth, not retry.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SYNC-104 — Android FCM token never unregistered on signOut; device_tokens row stays active for the old user → notifications delivered to "signed-out" device

- **Category:** SYNC  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** Android half FIXED 2026-08-30 (T-084: signOut calls deactivate_fcm_tokens before revoking the JWT). Server residue CLOSED 2026-08-31 (T-030, 13th session): canonical `unregister_fcm_token(p_token)` RPC (migration 0060, live, verify_t-030.sql 9/9) + website rotation-retire of stale tokens. Live browser/device round-trip pending the owner's FCM web config.
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-030 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SYNC-104
- **Description:** Android's `LocalAuthRepository.signOut` (LocalRepositories.kt:184-206) calls `supabaseProvider.auth.signOut()`, writes a local `auth.logout` audit log entry, and clears `_sessionState`. It does NOT call any FCM token unregistration. The `device_tokens` row for the active FCM token (written by `FcmTokenRegistrar.register` on app startup / session change) stays with `user_id = old_user, is_active = true`. The server's `send-push-notification` EF (elimtiyaz-website/supabase/functions/send-push-notification/index.ts:208-212) queries `device_tokens WHERE user_id = target_user_id AND is_active = true` (modulo the broken `user_profile_id` column noted in WEAK-014) — so notifications addressed to the old user continue to be sent to the FCM token of the device the old user just signed out of. On a shared device (e.g., a teacher hands a tablet to a substitute), the substitute sees the original teacher's notifications.
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:184-206` (signOut without FCM unregister) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/notifications/ElImtiyazMessagingService.kt:73-77` (onNewToken — only registers, never unregisters) - `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:344-384` (register_fcm_token RPC — has no inverse "unregister_fcm_token" RPC)
- **Evidence:** Audit evidence (Confirmed). Git: LocalRepositories.kt:184-206 last touched in `dd4c7dc kk` (2026-08-26). ElImtiyazMessagingService.kt touched in same commit. The signOut method has never called any FCM unregister.
- **Root cause:** The Android's `signOut` was written before FCM was integrated. FCM was added later (ElImtiyazMessagingService + FcmTokenRegistrar) but the signOut flow wasn't updated to call a new unregister method. There's no `unregister_fcm_token` SQL RPC — only `register_fcm_token` (which has `ON CONFLICT DO UPDATE SET is_active=true` — there's no path to set is_active=false via this RPC).
- **Current behavior:** The device_tokens row stays active. The server keeps sending notifications to the device. The Android FCM service still receives them and displays them on the lock screen — even though the user is "signed out" of the app.
- **Expected behavior:** On sign-out, the device's FCM token for the previous user should be deactivated (set `is_active=false`) so the server stops sending them notifications.
- **Proposed resolution:** On sign-out, the device's FCM token for the previous user should be deactivated (set `is_active=false`) so the server stops sending them notifications.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SYNC-105 — Website signOut uses scope:"global" (revokes ALL sessions across ALL devices) AND does not unregister FCM tokens — orphaned token + cross-device session kill

- **Category:** SYNC  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-30 (T-084: signOut uses scope:'local' + unregisterDeviceToken; 105/105 tests). Rotation residue CLOSED 2026-08-31 (T-030, 13th session): last-known token persisted; FCM_TOKEN_REFRESH re-registers AND retires the stale token via the new `unregister_fcm_token` RPC (migration 0060, live 9/9); website suite 135/135. Live browser round-trip pending the owner's FCM web config.
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-030 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SYNC-105
- **Description:** The website's `auth-provider.signOut` (auth-provider.tsx:279-302) calls `supabase.auth.signOut({ scope: "global" })`. The `scope: "global"` option revokes the user's session across ALL devices — including the user's phone browser, tablet, and Android app (which uses the same Supabase Auth). So a user signing out of their work laptop signs out their phone too. Additionally, the signOut flow does NOT call `unregisterDeviceToken` — the FCM token registered for this browser (via `registerDeviceToken` in profile-view's `togglePush(true)`) stays active in the `device_tokens` table. If a different user signs into the same shared browser without first toggling push off, the previous user's notifications continue to flow to the browser (because the FCM service worker is still installed and the token is still active for the previous user_id).
- **Location:** - `elimtiyaz-website/src/app/providers/auth-provider.tsx:279-302` (signOut with scope: "global" + no FCM unregister) - `elimtiyaz-website/src/lib/hooks/fcm-registration.ts:65-79` (unregisterDeviceToken exists but is only called from profile-view's togglePush(false)) - `elimtiyaz-website/src/features/profile/profile-view.tsx:128` (the ONLY call site of unregisterDeviceToken — manual push toggle, not signOut)
- **Evidence:** Audit evidence (Confirmed). Git: auth-provider.tsx:279-302 last touched in `03f6365 vitest 87/87` (2026-08-28, latest commit).
- **Root cause:** The developer used `scope: "global"` for security theater ("really sign me out everywhere"). They didn't realize the cross-device impact (the user might be signed into the same Supabase project on their phone). The lack of FCM unregister on signOut is a missed wiring — the unregister function exists but is only called from the manual push-toggle UI, not from the signOut flow.
- **Current behavior:** Sign-out revokes ALL the user's sessions globally (cross-device impact) AND leaves the FCM token active (orphaned token leak to next user of the shared browser).
- **Expected behavior:** Signing out of one device should sign out ONLY that device's session (scope: "local") AND deactivate that device's FCM token (so notifications stop flowing to the signed-out browser).
- **Proposed resolution:** Signing out of one device should sign out ONLY that device's session (scope: "local") AND deactivate that device's FCM token (so notifications stop flowing to the signed-out browser).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SYNC-106 — Android SyncWorker always returns Result.success() regardless of drainPending/pullAll failures; WorkManager retry escalation bypassed

- **Category:** SYNC  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-021 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SYNC-106
- **Description:** Android's `SyncWorker.doWork` (SyncWorker.kt:44-56) wraps both `syncService.drainPending()` and `pullSyncRepository.pullAll()` in `runCatching { ... }` blocks. If either throws, runCatching swallows the exception. The function then returns `Result.success()` unconditionally — never `Result.retry()` (which would tell WorkManager to retry the worker with backoff) or `Result.failure()` (which would mark the work as permanently failed and surface it in WorkManager's diagnostic UI). WorkManager's built-in retry mechanism (`Result.retry()` triggers exponential backoff up to `MAX_RUN_ATTEMPT_COUNT` = 5 by default) is completely bypassed. Persistent failures (e.g., schema mismatch, RLS denial on every drain) never surface to the operator — the worker silently fires every 15 minutes, fails every time, and reports success every time.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncWorker.kt:44-56`
- **Evidence:** Audit evidence (Confirmed). Git: SyncWorker.kt last touched in `94471e8` (2026-08-28).
- **Root cause:** The developer wrapped the calls in `runCatching` to prevent the worker from crashing the app — but didn't realize that swallowing the exception + returning success means WorkManager has no signal that anything went wrong. A safer pattern: `try { ...; Result.success() } catch (e: transient) { Result.retry() } catch (e: permanent) { Result.failure() }`.
- **Current behavior:** Always `Result.success()`. WorkManager's retry/diagnostic mechanisms are bypassed. The only way to detect persistent failures is to inspect the app's own SyncService snapshot StateFlow — which requires opening the app's Settings sync tab.
- **Expected behavior:** `CoroutineWorker.doWork` should return `Result.retry()` for transient failures (network, 5xx, timeout) and `Result.failure()` for permanent failures (validation, schema mismatch). WorkManager's `Result.retry()` triggers exponential backoff: 10s, 20s, 40s, 80s, 160s, then permanent failure (with `MAX_RUN_ATTEMPT_COUNT` = 5 by default). The worker's failure would surface in WorkManager's diagnostic UI (`adb dumpsys jobscheduler`).
- **Proposed resolution:** `CoroutineWorker.doWork` should return `Result.retry()` for transient failures (network, 5xx, timeout) and `Result.failure()` for permanent failures (validation, schema mismatch). WorkManager's `Result.retry()` triggers exponential backoff: 10s, 20s, 40s, 80s, 160s, then permanent failure (with `MAX_RUN_ATTEMPT_COUNT` = 5 by default). The worker's failure would surface in WorkManager's diagnostic UI (`adb dumpsys jobscheduler`).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SYNC-107 — Android SyncService.syncNow is fire-and-forget; UI thinks sync completed immediately

- **Category:** SYNC  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-021 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SYNC-107
- **Description:** Android's `SyncService.syncNow` (SyncService.kt:144-150) launches a coroutine via `scope.launch { runCatching { drainPending() }; runCatching { pullSyncRepository.pullAll() } }` and immediately returns `Result.Ok(Unit)` WITHOUT awaiting the launched coroutine. The scope is `CoroutineScope(SupervisorJob() + Dispatchers.IO)` (line 48) — owned by the SyncService singleton. The caller (typically SettingsViewModel or a UI "Sync now" button) gets `Result.Ok` back instantly, before the drain has even started. The UI then displays a "synced" checkmark or "lastSyncAt = now" — but the actual drain may still be running (or may have just started, or may fail). If the user closes the app immediately after tapping "Sync now", the SupervisorJob is canceled when the app process dies, the drain is interrupted, and pending entries stay pending — but the UI showed "synced".
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncService.kt:144-150`
- **Evidence:** Audit evidence (Confirmed). Git: SyncService.kt last touched `94471e8` (2026-08-28).
- **Root cause:** `syncNow` was originally a non-suspend function that wrapped a fire-and-forget launch — likely to avoid making callers await. The caller ergonomics favored quick feedback, but the implementation threw away the actual completion signal.
- **Current behavior:** The function returns instantly. The UI shows "Synced ✓" before the drain has done any work. The user is misled.
- **Expected behavior:** `syncNow()` should be `suspend fun` and await the drain. The caller should display "Syncing..." while the drain is in flight, then "Synced ✓" only after it completes.
- **Proposed resolution:** `syncNow()` should be `suspend fun` and await the drain. The caller should display "Syncing..." while the drain is in flight, then "Synced ✓" only after it completes.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Realtime & Freshness

### CACHE-100 — Website TanStack Query config (staleTime 30s + refetchOnWindowFocus false + retry 1) leaves data stale indefinitely when realtime is broken

- **Category:** CACHE  |  **Severity:** Medium  |  **Status:** TESTED
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-033 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-033, 11th session): refetchOnWindowFocus:true + 5-min refetchInterval via the single queryClientDefaultOptions export — realtime failure now degrades to stale-bounded data. t-033-freshness-fallback.test.tsx 3/3; site suite 122/122.
- **Consolidated from:** second-pass CACHE-100
- **Description:** The website's TanStack Query config (app/providers/index.tsx:22-30) sets `staleTime: 30_000` (30s), `refetchOnWindowFocus: false`, `retry: 1` as global defaults. This config is fine WHEN realtime subscriptions work — TanStack Query marks data as stale after 30s, and the realtime invalidation triggers an immediate refetch. But when realtime is broken (which it is — per WEAK-016 `useHomeworkRealtime` subscribes to the wrong table; per REALTIME-100 the chat unread invalidation key is wrong; per REALTIME-101 the chat read receipts never persist; per REALTIME-102 role-broadcast notifications are missed; per REALTIME-103 unread badge for other channels is missed), the website has NO fallback path to freshness. After the initial fetch, data is cached. After 30s, it's marked "stale" but not refetched (no trigger). The user sees stale data indefinitely within a single session — until they navigate away and back (remount triggers refetch via refetchOnMount which defaults to true).
- **Location:** - `elimtiyaz-website/src/app/providers/index.tsx:22-30` (global QueryClient config) - `elimtiyaz-website/src/lib/hooks/use-realtime.ts` (4 hooks, of which 2 are broken: WEAK-016 + REALTIME-100/101/102/103)
- **Evidence:** Audit evidence (Confirmed). Git: providers/index.tsx last touched `aebc58d first commit` (2026-07-31).
- **Root cause:** The config was set when the website was first built — assuming realtime would work for everything. The `refetchOnWindowFocus: false` was likely set to reduce server load ("we have realtime, why bother with window focus"). Then realtime broke for several tables (homework, chat) but the config wasn't revisited. The fragile "realtime-only freshness" architecture is the systemic issue.
- **Current behavior:** Realtime is the ONLY freshness mechanism. When realtime breaks, data is stale forever within a session. The config's `refetchOnWindowFocus: false` is the key bad setting — turning it back on would provide a fallback.
- **Expected behavior:** The config should provide a SAFETY NET: if realtime breaks, polling or refetchOnWindowFocus should keep data fresh. The current config puts ALL the freshness eggs in the realtime basket — with no fallback.
- **Proposed resolution:** The config should provide a SAFETY NET: if realtime breaks, polling or refetchOnWindowFocus should keep data fresh. The current config puts ALL the freshness eggs in the realtime basket — with no fallback.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CACHE-101 — Desktop OnlineDetector probes Google (`https://www.google.com/generate_204`) with `mode: "no-cors"` every 30s — privacy leak + captive portal detection broken

- **Category:** CACHE  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-050, 13th session): the probe now targets the CONFIGURED Supabase project's `/auth/v1/health` (resolved from supabase-client; apikey header sent → healthy 200; without key 401 still proves reachability); `mode: "cors"` makes the STATUS readable — only 200/401 count as online, so a captive portal's redirect/login page (opaque or 302) is OFFLINE; unconfigured (mock/dev) makes ZERO network requests (navigator-only); the singleton's probe target is derived at construction; fail-closed initial state until the first probe. Live endpoint behaviour verified with curl (200 with apikey, 401 without, `access-control-allow-origin: *`). Desktop suite 65 files / 2165 tests green incl. 13/13 new t-050 tests.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-050 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CACHE-101
- **Description:** The desktop's `OnlineDetector` (online-detector.ts) probes `https://www.google.com/generate_204` every 30 seconds (DEFAULT_PROBE_INTERVAL_MS = 30_000) using `fetch(probeUrl, { method: "HEAD", mode: "no-cors", cache: "no-store", signal })`. Two compounding issues: (1) **Privacy leak**: the desktop app makes a HEAD request to Google every 30s for the entire duration the app is running. Google's server logs see the user's IP + frequency + duration of use. For a financial app used by school staff, this is an unnecessary third-party metadata leak. (2) **Captive portal detection broken**: with `mode: "no-cors"`, the JavaScript code CANNOT read the response status — any non-throwing response (including a 302 redirect to a captive portal login page, or a 200 with HTML) is treated as "online" (line 90: `probeOk = true`). A captive portal that intercepts the request and returns its login page will NOT throw → probeOk = true → "online" reported → SyncService attempts to drain → all Supabase RPCs fail (DNS likely broken, or the captive portal blocks them) → entries marked failed after 5 retries → queue fills with failed entries → user confused.
- **Location:** `elimtiyaz-desktop/src/infrastructure/sync/online-detector.ts:24,81-94`
- **Evidence:** Audit evidence (Confirmed). Git: online-detector.ts last touched in initial commit batch `b25e6ca FKFKFK` (2026-08-04).
- **Root cause:** The developer copied a "network connectivity check" pattern from a public tutorial (google.com/generate_204 is the canonical example). `no-cors` was likely added because Supabase's auth endpoint doesn't return CORS headers for arbitrary origins, and the developer wanted to avoid CORS errors in the console. They didn't realize `no-cors` strips the ability to read the status, defeating the probe's purpose.
- **Current behavior:** The detector probes Google with no-cors. Privacy leak + broken captive portal detection.
- **Expected behavior:** The OnlineDetector should: (a) probe the Supabase instance itself (the actual server the app talks to — if Supabase is reachable, we're truly online), and (b) read the response status so captive portals can be detected (a 302 redirect or a 200 with non-empty HTML body is suspicious).
- **Proposed resolution:** The OnlineDetector should: (a) probe the Supabase instance itself (the actual server the app talks to — if Supabase is reachable, we're truly online), and (b) read the response status so captive portals can be detected (a 302 redirect or a 200 with non-empty HTML body is suspicious).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CACHE-102 — Desktop IndexedDB sync queue store silently falls back to in-memory when IndexedDB is unavailable; "sync queued" UI lies to user

- **Category:** CACHE  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-022 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-022, 12th session): the store exposes isUsingFallback(); the snapshot carries queueUsingFallback; the SyncIndicator renders an explicit warning state ('File d'attente EN MÉMOIRE … PERDUS à la fermeture') instead of a lying 'synced' indicator.
- **Consolidated from:** second-pass CACHE-102
- **Description:** The desktop's `IndexedDBQueueStore` (sync-queue-store.ts:35-63) attempts to open IndexedDB on `init()`. If `typeof indexedDB === "undefined"` (private mode, restricted Electron context, old browser), it sets `this.usingFallback = true` and uses an in-memory `Map<string, SyncQueueEntry>`. The fallback is logged via `console.warn` (line 38) but NOT surfaced to the UI. The user enqueues mutations (Excel import) → entries are stored in-memory → the topbar sync indicator shows "X pending" → user closes the app → process exits → in-memory store is wiped → all pending entries are LOST. On next launch, IndexedDB might still be unavailable → the queue is empty → the user thinks their data was synced (because the indicator showed "synced" before they closed) but the server has nothing.
- **Location:** `elimtiyaz-desktop/src/infrastructure/sync/sync-queue-store.ts:35-63, 181-185`
- **Evidence:** Audit evidence (Confirmed (the fallback path is verified; the frequency of private-mode use is unknown but plausible for shared/kiosk scenarios).). Git: sync-queue-store.ts last touched in initial commit batch.
- **Root cause:** The fallback was added defensively to prevent the app from crashing when IndexedDB isn't available. The developer added a `console.warn` as a debugging aid but didn't surface the state to the UI. The assumption was that IndexedDB is "always available in modern Electron" — true for normal use, false for private mode and some kiosk scenarios.
- **Current behavior:** The fallback is silent. The user is misled. Data loss.
- **Expected behavior:** The fallback should be surfaced to the UI — a banner saying "Sync queue is running in-memory; pending changes will be lost on app close. Restore IndexedDB to fix." OR the queue should refuse to operate in fallback mode (return an error on enqueue) so the user knows the data isn't being persisted.
- **Proposed resolution:** The fallback should be surfaced to the UI — a banner saying "Sync queue is running in-memory; pending changes will be lost on app close. Restore IndexedDB to fix." OR the queue should refuse to operate in fallback mode (return an error on enqueue) so the user knows the data isn't being persisted.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### REALTIME-100 — Website messages-view invalidates wrong queryKey prefix; unread badge stays stale forever

- **Category:** REALTIME  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-032, website commit 7b8983e): messages-view invalidates ['chat-unread-count']; the executable proof via TanStack's own partialMatchKey pins the root cause (['chat-unread'] provably does not match ['chat-unread-count', id]). Source scans in realtime-wiring.test.ts (7/7).
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-032 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass REALTIME-100
- **Description:** In `messages-view.tsx:177`, after the `markRead` effect updates incoming messages' `read_by`, the code calls `queryClient.invalidateQueries({ queryKey: ["chat-unread"] })`. But the actual TanStack Query key for the unread-count hook is `["chat-unread-count", userProfileId]` (portal-queries.ts:488). TanStack v5 partial-match semantic: `["chat-unread"]` matches queries whose key STARTS with the element `"chat-unread"` (exact string). The actual key's first element is `"chat-unread-count"` (a different string — `"chat-unread"` is NOT a prefix of `"chat-unread-count"` in the element-wise partial-match sense; they're different first elements). So the invalidation matches NOTHING. The unread badge query is never invalidated by the markRead effect. Combined with the global `refetchOnWindowFocus: false` (providers/index.tsx:26), the unread badge stays stale until the user navigates away and back (remount triggers refetch) — which can be hours in a single session.
- **Location:** - `elimtiyaz-website/src/features/messages/messages-view.tsx:177` (wrong invalidation key) - `elimtiyaz-website/src/lib/hooks/portal-queries.ts:488` (actual query key) - `elimtiyaz-website/src/app/providers/index.tsx:25-26` (global config that makes this breakage fatal — staleTime 30s + refetchOnWindowFocus false)
- **Evidence:** Audit evidence (Confirmed). Git: messages-view.tsx:177 last touched in commit `e90dbf7 mid` (2026-08-01).
- **Root cause:** The developer wrote `["chat-unread"]` thinking TanStack would match any key starting with the string "chat-unread" — but TanStack v5's partial match is ELEMENT-WISE, not string-prefix. They confused the queryKey prefix-match semantic with a string-startsWith semantic.
- **Current behavior:** The invalidation is a no-op. The unread badge stays at the old value. Even if the markRead UPDATE succeeded server-side, the badge wouldn't update.
- **Expected behavior:** After marking messages as read, the unread badge should refresh immediately to reflect the new count.
- **Proposed resolution:** After marking messages as read, the unread badge should refresh immediately to reflect the new count.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### REALTIME-101 — Website markRead UPDATE on chat_messages is RLS-denied for incoming messages; read receipts NEVER persist server-side; errors silently swallowed

- **Category:** REALTIME  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Backend half: migration 0051 (already applied live, T-091) authorizes channel members to append their own read_by via chat_messages_update_read_by + the append-only guard trigger. Website half (T-032): markRead now checks the update results and console.errors any server rejection. GAP: live two-browser read-receipt round-trip.
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-032 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass REALTIME-101, second-pass CHAT-102
- **Description:** The website's `messages-view.tsx` `Conversation` component has a `useEffect` (lines 157-180) that "marks incoming messages as READ" by calling `supabase.from("chat_messages").update({ read_by: [...(m.read_by ?? []), { user_id, read_at }] }).eq("id", m.id)` for every message where `m.author_id !== user.id` (i.e., incoming messages, NOT the user's own messages). However, the RLS policy `chat_messages_update_own` (migration 0019:857-860) restricts UPDATE to rows where `author_id = current_user_profile_id()` — i.e., a user can ONLY update their OWN messages. For incoming messages authored by someone else, the USING clause evaluates to false → PostgREST's UPDATE filters to 0 rows → the `read_by` column is NEVER updated server-side. The website's code does NOT check `error` on the returned Supabase result (it just `await Promise.all(...)` with no `.error` check, no try/catch). So the silent RLS denial is invisible to the UI. The user thinks "I read this message" but the server still has `read_by = []` → the unread badge never clears. The comment at line 154-156 explicitly says *"VAULT §05 — mark incoming messages as READ when the channel is open. Without this, read_by is only ever writte…
- **Location:** - `elimtiyaz-website/src/features/messages/messages-view.tsx:157-180` (markRead effect) - `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:857-860` (chat_messages_update_own policy) - `elimtiyaz-desktop/supabase/migrations/0010_workforce.sql:340,357` (read_by column definition) ;; [CHAT-102] `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:857-860`; effect at `elimtiyaz-website/src/features/messages/messages-view.tsx:158-180`
- **Evidence:** Audit evidence (Confirmed). Git: messages-view.tsx:157-180 touched in `e90dbf7 mid` (2026-08-01). The RLS policy was authored in 0019 (initial RBAC migration). The "VAULT §05" comment was added when the developer realized the issue — but the fix was incomplete.
- **Root cause:** The RLS policy was written with strict "users can only modify their own messages" semantics — appropriate for body/edited_by, but wrong for read_by. Read receipts are a separate concern that needs its own RLS policy OR a SECURITY DEFINER RPC. The website's frontend dev tried to fix it client-side without realizing RLS would block them.
- **Current behavior:** The current `chat_messages_update_own` policy denies the UPDATE for incoming messages. Read receipts never persist. The unread badge never clears via the markRead path. The comment in the code acknowledges the broken state ("Without this, read_by is only ever written for one's OWN messages, so unread badges never clear until the parent replies.") — but the attempted fix doesn't work.
- **Expected behavior:** The RLS policy SHOULD allow users to update `read_by` on messages in channels they're a member of (regardless of who authored the message). Read receipts are a fundamental chat feature. A separate RLS policy like `chat_messages_update_read_by` should exist that allows the UPDATE only when (a) the user is a member of the message's channel AND (b) the UPDATE only touches the `read_by` column (not `body`, `edited_at`, etc.).
- **Proposed resolution:** Add an RLS policy (or SECURITY DEFINER RPC) allowing channel members to append their own read_by entry to chat_messages they did not author; then let the website markRead effect succeed. Test: recipient marks a message read; read_by persists; unread count drops.
- **Dependencies:** none recorded
- **Absorbed findings:** CHAT-102: The only UPDATE policy on `chat_messages` is `chat_messages_update_own` (0019 line 857-860): `for update to authenticated using (tenant_id = current_tenant_id() and author_id = current_user_profile_id()) with check (tenant_id = current_tenant_id() and author_id = current_user_profile_id())`. There is NO policy allowing a RECIPIENT to UPDATE the `read_by` jsonb array of a message they did NOT author. The website's `markRead` effect (messages-view.tsx:158-180) attempts `supabase.from('chat_messages').update({ read_by: [...existing, {user_id, read_at}] }).eq('id', m.id)` for incoming messages (m.author_id ≠ user.id) — PostgREST's USING clause evaluates `author_id = current_user_profile_id()` as FALSE for those rows → 0 rows updated → response is `{ data: null, error: null, count: 0 }` (NO error) → the optimistic UI closes the conversation, the unread count is invalidated (but per REALTIME-100 the invalidation key is wrong, so the badge stays) → the message stays UNREAD server-side forever.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### REALTIME-102 — Website useNotificationsRealtime filter `target_user_id=eq.${user.id}` misses role-broadcast notifications

- **Category:** REALTIME  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-032): useNotificationsRealtime dropped the direct-target-only filter — postgres_changes events are RLS-scoped by the caller's JWT, so the user receives exactly the rows they can SELECT (direct + role + tenant broadcasts). Source scan pins the fix.
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-032 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass REALTIME-102
- **Description:** The website's `useNotificationsRealtime` hook (use-realtime.ts:82-93) subscribes to Supabase realtime `postgres_changes` events on the `notifications` table with the filter `target_user_id=eq.${user.id}`. This filter ONLY catches INSERT/UPDATE/DELETE events on rows where `target_user_id` equals the current user's id. But per the canonical schema (migration 0013:96-138), the `notifications` table supports THREE targeting modes: (1) direct user (`target_user_id` set, `target_role` NULL); (2) role broadcast (`target_user_id` NULL, `target_role` set e.g. 'parent'); (3) tenant broadcast (`target_user_id` NULL, `target_role` NULL, visible only to staff per RLS). The realtime filter only catches mode 1. Mode 2 (role-broadcasts) and mode 3 (tenant-broadcasts) never trigger the realtime invalidation → the user doesn't see them in real-time → they only appear on next page reload or remount. The RLS policy at 0019:1023-1032 DOES allow users to SELECT role-broadcast notifications (clause 2: `target_role is not null and target_role = any(public.current_user_roles())`), so the user CAN see them when the query refetches — but the realtime filter prevents the refetch from being triggered.
- **Location:** - `elimtiyaz-website/src/lib/hooks/use-realtime.ts:82-93` (useNotificationsRealtime) - `elimtiyaz-desktop/supabase/migrations/0013_calendar_notifications_backup.sql:96-138` (notifications schema with target_role) - `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:1023-1032` (notifications RLS with role-broadcast clause)
- **Evidence:** Audit evidence (Confirmed). Git: use-realtime.ts last touched `e90dbf7 mid` (2026-08-01).
- **Root cause:** The developer assumed `target_user_id` was always set — didn't consider role-broadcasts. The notifications schema supports both, but the realtime hook only handles one.
- **Current behavior:** Only direct-targeted notifications trigger the realtime invalidation. Role-broadcasts and tenant-broadcasts are invisible to realtime.
- **Expected behavior:** The realtime filter should catch all notifications visible to the current user — direct-targeted (target_user_id = user.id), role-broadcast (target_role matches user's roles), and (for staff) tenant-broadcast.
- **Proposed resolution:** The realtime filter should catch all notifications visible to the current user — direct-targeted (target_user_id = user.id), role-broadcast (target_role matches user's roles), and (for staff) tenant-broadcast.
- **Dependencies:** NOTIF-100 read-state model decision affects the correct filter
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### REALTIME-103 — Website useChatMessagesRealtime(activeChannelId) only subscribes to the open channel; messages in OTHER channels don't trigger unread badge update

- **Category:** REALTIME  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-032): NEW useChatUnreadRealtime() subscribes to chat_messages across ALL channels (RLS-scoped) and invalidates ['chat-unread-count']; mounted once in AppShell. GAP: live websocket assertion with two sessions.
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-032 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass REALTIME-103
- **Description:** The website's `useChatMessagesRealtime(channelId)` (use-realtime.ts:98-107) subscribes to Supabase realtime events on `chat_messages` filtered by `channel_id=eq.${channelId}`. This filter ONLY catches events for the currently-open channel. When a message arrives in a DIFFERENT channel (e.g., a staff member sends the parent a new message while the parent is viewing a different conversation), the realtime event for that message has `channel_id = the_other_channel`, which doesn't match the active channel's filter → the event is silently dropped by Supabase Realtime → the website's `useChatMessages` refetch doesn't fire (correctly — we don't need to refetch the active channel) → but ALSO the `useUnreadChatCount` query (which counts unread across ALL channels) doesn't refetch (because it has NO realtime subscription of its own — it relies on refetchOnWindowFocus=true override and manual invalidation from the markRead path, which is also broken per REALTIME-100). The bottom-nav unread badge doesn't update in real-time when a new message arrives in a non-active channel.
- **Location:** - `elimtiyaz-website/src/lib/hooks/use-realtime.ts:98-107` (useChatMessagesRealtime — active channel only) - `elimtiyaz-website/src/lib/hooks/portal-queries.ts:484-518` (useUnreadChatCount — NO realtime subscription, only refetchOnWindowFocus)
- **Evidence:** Audit evidence (Confirmed). Git: use-realtime.ts last touched `e90dbf7 mid` (2026-08-01).
- **Root cause:** The `useChatMessagesRealtime` hook was designed to refresh the open conversation — the right scope for that specific concern. But no parallel hook was added for the unread count. The two concerns (active conversation refresh vs. unread badge refresh) need separate subscriptions.
- **Current behavior:** Only messages in the currently-active channel trigger a refetch. Messages in other channels wait for window focus or remount.
- **Expected behavior:** The unread badge should update in real-time when new messages arrive in ANY of the user's channels.
- **Proposed resolution:** The unread badge should update in real-time when new messages arrive in ANY of the user's channels.
- **Dependencies:** REALTIME-101 (read receipts must persist before unread counts are meaningful)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### REALTIME-104 — Android has ZERO Supabase realtime subscriptions; relies entirely on 15-min pullAll cycle for freshness

- **Category:** REALTIME  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-069 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass REALTIME-104
- **Description:** A repo-wide grep on the Android codebase (`/home/z/my-project/repos/elimtiyaz-android`) for `channel(`, `realtime.channel`, `subscribe(` returns ZERO matches in production code. The Android `SupabaseClientProvider` (SupabaseClientProvider.kt:153) installs the Realtime plugin (`install(Realtime)`), but NO code in the app actually subscribes to any channel. The Android relies entirely on `PullSyncRepository.pullAll` (called by SyncWorker every 15 min, by SyncService.drainPending at the end of every drain, by app startup, by session change, and by pull-to-refresh). For a parent using the Android app, new homework/notifications/payments/chat messages appear at most 15 minutes late — UNLESS they manually pull-to-refresh. By contrast, the website has 4 realtime hooks (useNotificationsRealtime, useChatMessagesRealtime, useFinancialRealtime, useHomeworkRealtime — though 2 of them are broken per WEAK-016 and REALTIME-102). The desktop has 0 realtime hooks (all Subject-based caches, same broken pattern as CROSS-104).
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/supabase/SupabaseClientProvider.kt:153` (Realtime plugin installed) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncWorker.kt:36,54` (15-min periodic pullAll) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncService.kt:130` (pullAll at end of every drain)
- **Evidence:** Audit evidence (Confirmed). Git: No realtime code exists in the Android repo. The Realtime plugin is installed (line 153) but unused — installed likely "for future use" that never materialized.
- **Root cause:** The Android was designed as offline-first (Room is the source of truth, server is secondary). The pull-all pattern was considered sufficient. Realtime was added as a TODO that was never wired up. The complexity of integrating Supabase Realtime into Kotlin flows (vs TanStack Query's invalidate-on-event pattern on the website) likely deterred the developer.
- **Current behavior:** The Android polls every 15 minutes. The user sees stale data for up to 15 minutes. There's no realtime push.
- **Expected behavior:** The Android should subscribe to Supabase Realtime channels for the same tables the website does — at minimum, payments, installments, notifications, chat_messages — so the UI updates instantly when the server state changes.
- **Proposed resolution:** The Android should subscribe to Supabase Realtime channels for the same tables the website does — at minimum, payments, installments, notifications, chat_messages — so the UI updates instantly when the server state changes.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Parent & Account Flows

### PARENT-101 — `approve_account_request` SQL function silently OVERWRITES `parents.auth_user_id` on re-bind (no orphan check, no audit trail)

- **Category:** PARENT  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-029 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass PARENT-101
- **Description:** The `approve_account_request(p_request_id, p_reviewer_profile_id, p_target_parent_id, ...)` SQL function (0005 line 251-325) binds the request's `auth_user_id` to the target parent via `UPDATE public.parents SET auth_user_id = v_request.auth_user_id WHERE id = p_target_parent_id` (line 311-313). It does NOT check if the parent already has a different `auth_user_id` set. If it does, the previous user's binding is silently overwritten — the previous user can no longer sign in to see this parent. There's NO audit log write for this rebind.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0005_crm.sql:309-314` (the rebind block). Wrapping EF: `elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts:198-208` (calls the RPC) + `:252-260` (writes an audit log entry for "account_approval.approve" — but the entry's `before_json` doesn't capture the parent's old auth_user_id, so the rebind is invisible in the audit trail).
- **Evidence:** Audit evidence (Confirmed). Git: 0005_crm.sql introduced in `b25e6ca` (2026-08-04). The `approve_account_request` function's rebind block has been unchanged since.
- **Root cause:** The function was written assuming a 1:1 user-parent mapping where rebinds don't happen. The author didn't anticipate the case where an admin accidentally approves the wrong user for an already-bound parent.
- **Current behavior:** Silently overwrites. No orphan check. No audit log entry for the rebind (the EF writes an "account_approval.approve" audit entry but the `before_json` doesn't capture the old auth_user_id, so the rebind is invisible in the audit trail).
- **Expected behavior:** The rebind block should check `old.auth_user_id IS NULL` (only bind if the parent is unbound) OR raise an exception if the parent already has a different auth_user_id. The rebind should write an audit log entry like "parent.rebind: from user B to user A".
- **Proposed resolution:** The rebind block should check `old.auth_user_id IS NULL` (only bind if the parent is unbound) OR raise an exception if the parent already has a different auth_user_id. The rebind should write an audit log entry like "parent.rebind: from user B to user A".
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### PARENT-102 — Approval-without-target-parent creates "active but unbound" user with no escape path

- **Category:** PARENT  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-008 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass PARENT-102
- **Description:** The `approve-signup-request` Edge Function (line 146-208) handles the `action: "approve"` case. If the admin calls it with NEITHER `target_parent_id` NOR `create_new_parent=true`, the EF calls `approve_account_request(p_target_parent_id=null, ...)`. The SQL function (0005 line 309-314) skips the parent-binding block (because `p_target_parent_id IS NULL`). The user is activated (status='active'), gets a role_assignment, but `parents.auth_user_id` is NOT set anywhere. The user signs in via Google OAuth → website's auth-provider queries `parents WHERE auth_user_id = authUser.id` → returns null → `setParent(null); setState("pending")` (auth-provider.tsx line 159-165) → user sees "account not activated" screen despite being status='active' with a role.
- **Location:** `elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts:146-208` (EF doesn't validate target_parent_id is set); `elimtiyaz-desktop/supabase/migrations/0005_crm.sql:309-314` (SQL skips binding when target_parent_id is NULL); `elimtiyaz-website/src/app/providers/auth-provider.tsx:159-165` (treats active-but-unbound as pending).
- **Evidence:** Audit evidence (Likely (the EF doesn't validate; the SQL function skips the binding when target_parent_id is null; the auth-provider treats the unbound state as pending; no recovery flow exists)). Git: approve-signup-request/index.ts introduced in `b25e6ca` (2026-08-04). The EF body validation has been missing since.
- **Root cause:** The EF was written to a thin wrapper around the `approve_account_request` SQL function. The author didn't add input validation because the SQL function's `p_target_parent_id default null` made the parameter optional. The author didn't anticipate that "approved without binding" is an invalid state.
- **Current behavior:** The EF happily approves without binding. The user is in limbo — status='active' but no parent. The website treats them as 'pending' forever. There's no UI flow to recover: the bind-activation-code EF (line 97-102) rejects already-active users with 409 "Account is already active". The approve_account_request SQL function can't be re-called (the request is already status='approved' — line 270-271 `WHERE id = p_request_id AND status = 'pending' FOR UPDATE` won't find it). The user is permanently stuck.
- **Expected behavior:** The EF should validate that EITHER `target_parent_id` is set OR `create_new_parent=true` is set on approve actions. If neither, return 400 "missing target parent".
- **Proposed resolution:** The EF should validate that EITHER `target_parent_id` is set OR `create_new_parent=true` is set on approve actions. If neither, return 400 "missing target parent".
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Academic Features

### ACAD-100 — Two parallel promotion paths: dead SQL `promote_students` RPC writes to legacy `academic_history`, desktop writes to canonical `student_academic_histories`

- **Category:** ACAD  |  **Severity:** High  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-041, 13th session): migration 0059 DROPS the dead promote_students RPC and installs the single canonical atomic `execute_batch_promotion` path (history upsert + grade advance + graduation + audit in one transaction; live, verify_t-041.sql 10/10 — dead-RPC-gone check included). Desktop repositories now call the RPC; direct table writes removed. The legacy `academic_history` TABLE is kept (separate reachability decision).
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-041 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass ACAD-100
- **Description:** Two completely independent code paths implement year-end student promotion: (a) The SQL `promote_students` RPC (migration 0022 line 528-619) — `SECURITY DEFINER`, accepts `(p_tenant_id, p_academic_year_id, p_decisions jsonb, p_actor_profile_id)`, archives to the LEGACY `academic_history` table (migration 0004 line 207-221, schema: `subject_grades_json` + `attendance_summary` JSONB snapshots + `teacher_observations` text + `archived_at`); (b) The desktop's `SupabasePromotionRepository.executeBatchPromotion` (supabase-academic-repository.ts:1111-1246) — direct table operations, archives to the CANONICAL `student_academic_histories` table (migration 0029 line 117-133, schema: `gpa` + `rank` + `decision` + `narrative` separate columns). The SQL RPC is dead code (never called from any client), but the divergence means the academic history is split across two tables with two schemas depending on which path is used. The SQL RPC also has a critical bug: it references `v_student.grade_level_id` (line 562, 563, 575, 593) which is a column that DOES NOT EXIST on the `students` table — the canonical column is `grade_level_code` (TEXT, added in migration 0028). The SELECT INTO for `v_next_level…
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0022_functions.sql:528-619` (SQL `promote_students` RPC — dead but defined) - `AgentGithubUplaad/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1111-1246` (desktop's `executeBatchPromotion` — direct table ops, writes to canonical `student_academic_histories`) - `elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:207-221` (legacy `academic_history` table) - `elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:117-133` (canonical `student_academic_histories` table)
- **Evidence:** Audit evidence (Confirmed — the SQL RPC's `grade_level_id` reference and the academic_history-vs-student_academic_histories divergence are both empirically verifiable by reading the migrations.). Git: Migration 0022 (defining `promote_students` RPC) committed in early schema. Migration 0029 (canonical `student_academic_histories` table) in `b25e6ca mid` (2026-08-04). Desktop's `executeBatchPromotion` implemented same commit. The author's comment at line 1107-1110 says: "NOTE: the original implementation called an `execute_batch_promotion` RPC that does NOT exist in any migration — it would have failed with PGRST202 at runtime. The student updates are therefore issued directly." — but the author didn't notice that the SQL `promote_students` RPC (defined in 0022) ALMOST matches what they were trying to call, just under a different name.
- **Root cause:** The SQL `promote_students` RPC was written in early schema (before the canonical 0029 academic-history table existed). When the canonical table was added in 0029, the desktop's promotion repository was rewritten to target the new table — but the old SQL RPC was never dropped, leaving a dead function with divergent schema. The `grade_level_id` column reference in the SQL RPC is also a relic: pre-0028, the `students` table was spec'd to have a `grade_level_id` UUID FK to `academic_levels.id`, but 0028 replaced it with `grade_level_code` TEXT (the canonical grade code). The SQL RPC was never updated.
- **Current behavior:** Only the desktop's direct-table path runs (when it works — TENANT-106 already documented that the canonical `student_academic_histories` upsert fails because the table's RLS is broken via `fn_current_tenant_id()` which is never set). The SQL RPC is dead code that would archive to the WRONG table if it were ever wired up. The legacy `academic_history` table is permanently empty.
- **Expected behavior:** Provide a single canonical year-end promotion path that archives student decisions to a permanent academic history table.
- **Proposed resolution:** Provide a single canonical year-end promotion path that archives student decisions to a permanent academic history table.
- **Dependencies:** DEAD-100, TENANT-106; decide canonical promotion path (T-041)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ACAD-101 — Academic-year `setCurrentYear` is a non-atomic two-step UPDATE; failure leaves the tenant with no current year

- **Category:** ACAD  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-041, 13th session): atomic `set_current_academic_year` RPC (ONE UPDATE flips the whole tenant + audit entry; migration 0059, live 10/10). createAcademicYear now inserts `is_current=false` then flips via the RPC — failure leaves the previous current year intact. Desktop suite 2146 green.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-041 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass ACAD-101
- **Description:** `SupabaseAcademicYearRepository.setCurrentYear(id, ...)` (line 106-125) updates `is_current` in TWO separate PostgREST calls (no transaction, no RPC): (a) first unsets `is_current=false` for ALL other years of the tenant, (b) then sets `is_current=true` on the target year. If step (a) succeeds but step (b) fails (network error, RLS rejection, server timeout), the tenant has NO current academic year — multiple downstream features break: the desktop's `SupabaseHomeworkRepository.push()` derives `academic_year` from `.eq("is_current", true)` (line 1031); the website's bulletin generator and various dashboards rely on the current year being set. The `createAcademicYear(input)` method (line 127-160) has the same two-step pattern: unset `is_current=false` for all years of the tenant FIRST (line 137-141), then INSERT the new year with `is_current=true`. If the INSERT fails, the old current year has been unset. There's no audit log of who flipped the `is_current` flag (the `_actorId` and `_actorName` parameters are unused — they're prefixed with underscore to silence the linter).
- **Location:** - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:106-160` (both `setCurrentYear` and `createAcademicYear` two-step patterns)
- **Evidence:** Audit evidence (Confirmed). Git: Both `setCurrentYear` and `createAcademicYear` implemented in `b25e6ca mid` (2026-08-04). The `_actorId`/`_actorName` underscore-prefix (silencing unused-parameter linter) signals the author knew the audit-trail was missing but never wrote the `write_audit_log` RPC call.
- **Root cause:** The author wrote the simplest possible implementation (two sequential UPDATEs) without considering atomicity. The mock layer had the same pattern, and the Supabase port was a direct translation. No RPC was written to wrap the two UPDATEs in a transaction.
- **Current behavior:** Two non-atomic UPDATEs with a race window between them. Failure in the second step leaves the tenant with no current year. No audit log of the flag flip.
- **Expected behavior:** Atomically flip the `is_current` flag from year A to year B with no transient inconsistent state.
- **Proposed resolution:** Atomically flip the `is_current` flag from year A to year B with no transient inconsistent state.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ACAD-102 — `class_subjects.teacher_id` is single-UUID; co-teaching (multiple teachers per subject per class) is structurally unsupported

- **Category:** ACAD  |  **Severity:** Medium  |  **Status:** DEFERRED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-073 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass ACAD-102
- **Description:** The `class_subjects` table (migration 0004 line 99-110) has a single `teacher_id UUID` column per (class, subject) — there is NO `secondary_teacher_id` or many-to-many teacher-class-subject assignment table. The unique constraint `(tenant_id, class_id, subject_id)` (line 109) means each (class, subject) pair has exactly ONE row, with ONE teacher. Co-teaching (two teachers sharing the same subject for the same class — common in Algerian lycée where chapters rotate) is structurally unrepresentable at the DB level. Migration 0029 (line 49) added a `teacher_name TEXT` column (denormalized display name) but didn't add a `secondary_teacher_id`. The desktop's `ClassSubjectsTab.tsx` (verified by file listing in the academics directory) renders a single teacher-assignment dropdown per (class, subject) — the UI also doesn't support co-teaching.
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:99-110` (table schema — single `teacher_id`) - `elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:49` (added `teacher_name TEXT` but not a secondary teacher) - `AgentGithubUplaad/elimtiyaz-desktop/src/features/academics/class-subjects-tab.tsx` (UI: single-teacher dropdown per (class, subject))
- **Evidence:** Audit evidence (Confirmed). Git: Migration 0004 committed in initial schema. Migration 0029 line 49 added `teacher_name` but didn't add a secondary teacher column. No subsequent migration adds a join table.
- **Root cause:** The original schema was designed for the simple case (one teacher per class per subject). Co-teaching wasn't considered. The migration 0029 additions (teacher_name, weekly_hours) were cosmetic denormalizations — they didn't address the structural limit.
- **Current behavior:** Tracks exactly one teacher per (class, subject). Co-teaching is unrepresentable. If a school has two Math teachers for Class 1AM-A (one for algebra, one for geometry), the system can't model this — the operator must pick one and lose the other.
- **Expected behavior:** Track the teacher(s) assigned to each (class, subject) pair, including co-teaching arrangements.
- **Proposed resolution:** Track the teacher(s) assigned to each (class, subject) pair, including co-teaching arrangements.
- **Dependencies:** none recorded
- **Status note:** Product enhancement requiring schema design (join table) and business confirmation of co-teaching needs. No data-loss risk today.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ACAD-103 — Mid-term section moves have no audit trail; `students.class_id` is updated in place, no `class_transfers` or `enrollment_history` table

- **Category:** ACAD  |  **Severity:** Medium  |  **Status:** DEFERRED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-074 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass ACAD-103
- **Description:** When a student moves sections mid-term (e.g., from Class 1AM-A to Class 1AM-B), the desktop's `SupabaseStudentRepository.update()` (in `supabase-shared-repositories.ts` line ~639+) calls `client.from("students").update({ class_id: newClassId, updated_at: now }).eq("id", id)` — directly overwriting the `class_id` column. There is NO `class_transfers` or `enrollment_history` table to track the move. The previous `class_id` is silently overwritten — no audit trail of when the move happened, who authorized it, why it happened, or what the previous class was. The legacy `academic_history` table (migration 0004 line 207-221) captures YEAR-END snapshots (via `class_id`), not mid-term transfers. So mid-term section moves are invisible to history.
- **Location:** - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (around line 639 — `SupabaseStudentRepository.update` method that updates `class_id` in place) - `elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:207-221` (legacy `academic_history` table — year-end snapshots only, not mid-term transfers) - `AgentGithubUplaad/elimtiyaz-desktop/supabase/migrations/` — no `class_transfers` or `enrollment_history` migration exists (verified by grep)
- **Evidence:** Audit evidence (Confirmed — verified by grep that no `class_transfers` or `enrollment_history` migration exists across all 3 repos.). Git: No `class_transfers` migration exists. The `SupabaseStudentRepository.update` was written in `b25e6ca mid` (2026-08-04) without an audit-log call for class_id changes.
- **Root cause:** The author treated `class_id` as a simple scalar property of the student, not as a relationship that needs history. The legacy `academic_history` table was the only place that captured class assignments, and it was year-end-only by design.
- **Current behavior:** `students.class_id` is mutated in place. No history table records the transfer. The `updated_at` column tells you WHEN the row was last touched but not WHAT changed. The `audit_logs` table could in principle capture this, but the desktop's `update()` method doesn't call `write_audit_log` for the class_id change.
- **Expected behavior:** Maintain an audit trail of class transfers (when, who, why, from, to).
- **Proposed resolution:** Maintain an audit trail of class transfers (when, who, why, from, to).
- **Dependencies:** none recorded
- **Status note:** Product enhancement (class-transfer audit trail). Current in-place updates are functionally correct; only the historical record is missing.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ATT-100 — Desktop roll call upsert is triple-broken (missing tenant_id, missing date, wrong onConflict)

- **Category:** ATT  |  **Severity:** Critical  |  **Status:** TESTED
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-023 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-023, 11th session): roll-call payload carries tenant_id + date + record_date and onConflict targets uq_attendance_canonical. Live verify_t-023.sql 7/7 (old payload reproduces the NOT NULL violations; duplicate hits unique_violation).
- **Consolidated from:** second-pass ATT-100
- **Description:** `SupabaseAttendanceRepository.recordRollCall()` issues an upsert to `attendance_records` with three compounding bugs: (a) the payload omits `tenant_id` (NOT NULL per migration 0004 line 163); (b) the payload writes to `record_date` (0029-added nullable column) but omits the legacy `date` column (NOT NULL per migration 0004 line 167, never made nullable); (c) `onConflict: "student_id,record_date,session"` (3 columns) doesn't match either unique index — the legacy `attendance_records_unique_session_uidx` is on 5 cols `(tenant_id, student_id, class_id, date, coalesce(class_subject_id, ...))` and the canonical `uq_attendance_canonical` is on 4 cols `(tenant_id, student_id, record_date, session)`. PostgREST rejects the upsert with multiple compounding errors; the first to surface is the NOT NULL violation on `tenant_id` (since column evaluation order matches the table definition order).
- **Location:** - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:840-884` (recordRollCall method) - `elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:161-180` (attendance_records schema + unique index) - `elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:84-90` (record_date column added — nullable, NOT NULL on `date` untouched) - `elimtiyaz-android/supabase/migrations/0041_canonical_academic_flow.sql:163-164` (canonical unique index `uq_attendance_canonical` on 4 cols including `tenant_id`)
- **Evidence:** Audit evidence (Confirmed). Git: `recordRollCall` implemented in `b25e6ca mid` (2026-08-04). Migration 0041 added `uq_attendance_canonical` index — but the desktop's onConflict string was never updated to match the new 4-column canonical index.
- **Root cause:** The desktop's `recordRollCall` was written before migration 0041 added the canonical unique index — at the time, there was no canonical conflict key, so the author improvised a 3-column onConflict that didn't match any existing index either. The author also forgot to set `tenant_id` (likely copied the pattern from `recordRollCall` in the mock repository, where `tenantId = TENANT_ID` is hardcoded but the mock doesn't enforce NOT NULL). The author wrote to `record_date` (the 0029-added column) instead of `date` (the 0004 column) — they probably assumed `record_date` superseded `date`, but no migration dropped NOT NULL from `date`.
- **Current behavior:** Every roll call from the desktop fails. The `attendance_records` table on the live DB has zero rows from desktop roll calls. The website's `useAttendanceForStudent` returns an empty list. Parents see "Aucune absence enregistrée" forever.
- **Expected behavior:** Persist roll-call records to the canonical `attendance_records` table so the website's `useAttendanceForStudent` query can read them and parents can see their child's absences.
- **Proposed resolution:** Persist roll-call records to the canonical `attendance_records` table so the website's `useAttendanceForStudent` query can read them and parents can see their child's absences.
- **Dependencies:** none (standalone fix: tenant_id + date + onConflict)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ATT-101 — Absence-justification 4-state workflow is structurally broken: no desktop code to review justifications (extends DRIFT-010)

- **Category:** ATT  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Android, Desktop, Website
- **Task:** T-040 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-040, 12th session): the desktop reads/writes the justification columns end-to-end — AttendanceRecord + mapAttendanceRow extended; observeJustifications + reviewJustification on the repository contract (Supabase + Mock); a Justificatifs review tab in the Academics hub (Accept/Refuser with reviewer identity + timestamp). The website's 4-state pill was already complete — the states are now REACHABLE. 8-test suite; full suite 2127 green.
- **Consolidated from:** second-pass ATT-101
- **Description:** The website's `AbsenceJustificationDialog` lets parents submit a justification (note + file upload + Google Drive link) which UPDATEs `attendance_records` setting `justification_status='submitted'`. The DONE.md and migration comments explicitly say "Staff flip submitted→accepted/rejected from the desktop app." But the desktop has ZERO code that reads `justification_status`, `justification_note`, `justification_path`, `justification_drive_link`, `justification_reviewed_by`, or `justification_reviewed_at`. The desktop's `AttendanceRecord` domain model (`mapAttendanceRow` at line 1407-1422) doesn't include these fields. The 4-state workflow (`none` → `submitted` → `accepted`/`rejected`) is structurally unreachable past the `submitted` state.
- **Location:** - `elimtiyaz-website/src/features/attendance/absence-justification-dialog.tsx:77-130` (parent submits justification, sets status='submitted') - `elimtiyaz-website/src/features/attendance/attendance-view.tsx:141-153` (parent reads justification status to render the status pill — only `none`/`submitted` are ever observed) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1407-1422` (`mapAttendanceRow` doesn't read `justification_*` columns) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:841-872` (Android's `recordRollCall` doesn't read or write justification fields either) - `elimtiyaz-website/DONE.md:35` (claims "Staff flip submitted→accepted/rejected from the desktop app" — but no such code exists)
- **Evidence:** Audit evidence (Confirmed — EXTENDS DRIFT-010 (which said attendance-view.tsx's comment about "desktop workflow" was misleading). ATT-101 confirms: the desktop workflow is not just undocumented — it's structurally unimplemented.). Git: Migration 0026 (website) and 0043 (desktop re-bundle) committed in `b25e6ca mid` (2026-08-04). DONE.md claim of "staff flips from desktop app" same commit. No subsequent commit added desktop-side review code.
- **Root cause:** The migration + UI on the website side was built speculatively ahead of the desktop side. The DONE.md claim is aspirational ("will be done later") but committed as if done. The author never circled back to implement the desktop-side review UI/repository.
- **Current behavior:** The workflow is a one-way valve: parent can submit but staff can never review. Only `none` and `submitted` states are reachable. The `accepted`/`rejected` states are documented (migration comment, DONE.md) but unreachable.
- **Expected behavior:** The 4-state workflow (`none` → `submitted` → `accepted`/`rejected`) is a closed feedback loop: parent submits → staff reviews → parent sees the outcome.
- **Proposed resolution:** The 4-state workflow (`none` → `submitted` → `accepted`/`rejected`) is a closed feedback loop: parent submits → staff reviews → parent sees the outcome.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ATT-103 — Android `alertAbsences` has no threshold; alerts for every student in the input (divergence from desktop's 3-absence threshold)

- **Category:** ATT  |  **Severity:** Low  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-063, 13th session): alertAbsences flags only students with >=3 absences (absent_excused + absent_unexcused, LATE excluded) within the CURRENT TERM — new core/Terms.kt mirrors the desktop terms.ts (label byte-identical cross-platform). 10/10 new tests (TermsT063Test).
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-063 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass ATT-103
- **Description:** The desktop's `SupabaseAttendanceRepository.alertAbsences(studentIds)` (line 897-963) counts absences per student for the current term and alerts parents ONLY for students with ≥3 absences (line 899 `THRESHOLD = 3`). The Android's `LocalAttendanceRepository.alertAbsences(studentIds)` (`LocalRepositories2.kt:878-908`) alerts for EVERY student in the input list — no threshold check, no current-term windowing. The desktop's threshold is hardcoded `THRESHOLD = 3`; the Android's threshold is effectively 1.
- **Location:** - `AgentGithubUplaad/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:897-963` (desktop: threshold 3, current-term window) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:878-908` (Android: no threshold)
- **Evidence:** Audit evidence (Confirmed). Git: Both implementations committed in `b25e6ca mid` (2026-08-04). The desktop's THRESHOLD=3 hardcoded at line 899. The Android's implementation never had a threshold — the comment at line 874 says "FIX (hollow action): alertAbsences previously wrote ONLY audit rows — no parent was ever alerted. Now a real in-app notification is created per student (linked to the parent's record)..." — the "fix" was to add the notification but not the threshold.
- **Root cause:** The Android developer implemented the notification side but didn't carry over the desktop's threshold logic. The threshold check is a one-liner that was missed.
- **Current behavior:** Desktop: alerts only for ≥3 absences (correct). Android: would alert for every student in the input (1+ absences). The two platforms diverge on the threshold.
- **Expected behavior:** Notify parents when their child has accumulated a meaningful number of absences (3+ per term per the desktop's threshold). Avoid alert fatigue (don't alert for every single absence).
- **Proposed resolution:** Notify parents when their child has accumulated a meaningful number of absences (3+ per term per the desktop's threshold). Avoid alert fatigue (don't alert for every single absence).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### GRADE-100 — `homework.acknowledged_count` column is permanently 0; no code increments it

- **Category:** GRADE  |  **Severity:** Low  |  **Status:** DEFERRED
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-075 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass GRADE-100
- **Description:** The canonical `homework` table (migration 0029 line 110) has an `acknowledged_count INT NOT NULL DEFAULT 0` column. The desktop's `SupabaseHomeworkRepository.push()` (line 1002-1071) doesn't set this field on INSERT — Postgres DEFAULT kicks in, so new rows start at 0. No code path (no UI click handler, no SQL trigger, no RPC, no Edge Function) ever increments it. The website's `HomeworkView` (`homework-view.tsx`) does NOT display this count to parents and has no "Acknowledge" button. The field is structurally unreachable past its initial 0 value.
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:110` (`acknowledged_count INT NOT NULL DEFAULT 0`) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1039-1053` (INSERT omits the field; DEFAULT 0) - `elimtiyaz-website/src/features/homework/homework-view.tsx` (no "Acknowledge" button rendered) - `elimtiyaz-android/app/src/main/java/com/example/ui/features/academics/HomeworkPushScreen.kt` (Android homework-push UI — also doesn't acknowledge)
- **Evidence:** Audit evidence (Confirmed — verified across 3 platforms (desktop, Android, website) that no code increments the field.). Git: Migration 0029 committed in `b25e6ca mid` (2026-08-04). No subsequent migration adds a trigger to increment the count. No commit adds an "Acknowledge" button.
- **Root cause:** The author spec'd the column for a future "parent acknowledges homework" feature but never implemented the UI/trigger side.
- **Current behavior:** The field is permanently 0 for every homework. The intent is unimplemented.
- **Expected behavior:** Track how many parents/students have acknowledged a homework (so teachers can see "X of Y students have seen this homework").
- **Proposed resolution:** Track how many parents/students have acknowledged a homework (so teachers can see "X of Y students have seen this homework").
- **Dependencies:** none recorded
- **Status note:** Feature never specified beyond the column definition. Revisit with the homework acknowledgment feature.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### HOMEWORK-100 — Desktop homework push omits `tenant_id`; INSERT always fails NOT NULL (extends WEAK-017)

- **Category:** HOMEWORK  |  **Severity:** Critical  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-023 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-023, 11th session): homework push carries tenant_id; dead push-homework-notification EF invocation removed (decision deferred to T-036). t-023-academic-persistence.test.ts 4/4 + live verify 7/7.
- **Consolidated from:** second-pass HOMEWORK-100
- **Description:** `SupabaseHomeworkRepository.push()` constructs the homework INSERT payload without a `tenant_id` field, but the canonical `homework` table (migration 0029 line 95-111) requires `tenant_id UUID NOT NULL` (no DEFAULT, no `set_homework_tenant()` trigger to backfill). The PostgREST INSERT is sent to the server and Postgres returns 400 with `null value in column "tenant_id" of relation "homework" violates not-null constraint`. The desktop also invokes a non-existent Edge Function `push-homework-notification` (line 1064-1068) with `.catch(() => undefined)` — silently swallowed, so even when the homework INSERT is fixed, the parent-notification side-effect never fires.
- **Location:** - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1039-1071` (INSERT payload omits `tenant_id` + invokes non-existent EF) - `elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:95-111` (table requires `tenant_id UUID NOT NULL`) - `elimtiyaz-desktop/supabase/functions/` — directory listing has no `push-homework-notification` subdirectory (only `_shared`, `ai-proxy`, `approve-signup-request`, `bind-activation-code`, `collect-payment`, `expire-pending-approvals`, `purge-expired-backups`, `refresh-materialized-views`, `refund-payment`, `run-overdue-scan`, `update-server-secret`, `workflow-execute`)
- **Evidence:** Audit evidence (Confirmed — EXTENDS WEAK-017 (Database type missing canonical `homework` table) by tracing the actual runtime breakage. WEAK-017 said the typed `Database` interface omits the `homework` table (so queries use `as unknown as` casts). HOMEWORK-100 documents the deeper issue: even if the typing were fixed, the runtime INSERT fails because the payload is structurally incomplete.). Git: Migration 0029 committed in `b25e6ca mid` (2026-08-04). `SupabaseHomeworkRepository.push()` implemented same commit. No subsequent fix.
- **Root cause:** The author copy-pasted the pattern from `SupabaseAcademicYearRepository.createAcademicYear` (which does NOT pass `tenant_id` because academic_years has no RLS `tenant_id` check at insert — the policy `rls_academic_years_tenant USING (tenant_id = current_tenant_id())` runs but the column is set by the trigger on the table). The author forgot to add a `set_homework_tenant()` trigger (analogous to `set_assessments_tenant` added in migration 0041 for the `assessments` table) OR to explicitly pass `tenant_id: getTenantId()` in the INSERT payload. Every other Supabase repository in the codebase explicitly passes `tenant_id: tenantId` (see `supabase-shared-repositories.ts`, `supabase-notification-repository.ts:232`, `supabase-personnel-repository.ts:430,591,609`, etc.).
- **Current behavior:** Every homework push from the desktop fails with a NOT NULL violation; the `homework` table on the live DB has zero rows for desktop-originated pushes. The `push-homework-notification` EF invocation is dead-on-arrival (the EF is not deployed AND the catch swallows the error).
- **Expected behavior:** Persist the homework row in the canonical `homework` table so the website's `useHomeworkForClass` query can read it, then trigger a push notification to subscribed parents.
- **Proposed resolution:** Persist the homework row in the canonical `homework` table so the website's `useHomeworkForClass` query can read it, then trigger a push notification to subscribed parents.
- **Dependencies:** none (standalone fix: add tenant_id to INSERT payload)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### HOMEWORK-101 — Android homework sync push uses invalid UUID `"hwk-{uuid}"` as `homework.id`

- **Category:** HOMEWORK  |  **Severity:** Critical  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-024 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass HOMEWORK-101
- **Description:** `LocalHomeworkRepository.push()` (`LocalRepositories2.kt:1466`) creates a local Room `HomeworkEntity` with `id = "hwk-${UUID.randomUUID()}"`. The sync dispatcher's `pushHomework()` (`SyncQueueDispatcher.kt:109-138`) reads this ID verbatim and passes it to `supabaseProvider.postgrest.from("homework").upsert(row)` where `row.id = "hwk-{uuid}"`. The `homework.id` column is `UUID PRIMARY KEY` (migration 0029 line 96). Postgres rejects `"hwk-..."` with `invalid input syntax for type uuid: "hwk-..."` (PostgREST returns 400). The SyncService catches the exception, retries with exponential backoff, and after `maxAttempts` marks the entry as `failed` — the failure is only visible in the diagnostics UI, not surfaced as a user-visible error.
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1466` (entity ID generation with `hwk-` prefix) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:109-138` (`pushHomework` sends ID verbatim into UUID column) - `elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:96` (`id UUID PRIMARY KEY DEFAULT public.gen_uuid()`)
- **Evidence:** Audit evidence (Confirmed — the homework table's `id` column is unambiguously `UUID PRIMARY KEY` per migration 0029, and `"hwk-..."` is unambiguously not a valid UUID per Postgres syntax rules.). Git: `LocalHomeworkRepository.push()` and `SyncQueueDispatcher.pushHomework` both committed in `b25e6ca mid` (2026-08-04). The `hwk-` prefix matches the Android's local-UUID convention (`cls-`, `sub-`, `cls-sub-`, `att-`, `asm-`, `exp-`, `hwk-`) — every local entity uses a 3-4 letter prefix. Only `hwk-` collides with a UUID column on the server because homework is the only entity whose sync push goes directly to the table (not via an RPC).
- **Root cause:** The Android developer used the same local-ID convention for all entities (`hwk-`, `asm-`, `att-`, etc.) without realizing that the homework sync path is the only one that puts the local ID directly into a UUID column. The grade and attendance sync paths use RPCs that omit the ID parameter. The homework sync path was implemented to use a direct table upsert (per the dispatcher comment line 105-107: "Uses the postgrest table upsert (idempotent on the primary key) rather than an RPC — the `homework` table is part of the shared schema (migration 0027) and has no dedicated upsert RPC"). Without an RPC, the local ID leaks into the UUID column.
- **Current behavior:** Every homework sync push from Android fails with a UUID syntax error; the canonical `homework` table on the live DB has zero rows from Android. Local Room has the row, but no other platform can see it.
- **Expected behavior:** Push the locally-created homework to the canonical `homework` table on Supabase so parents/students see it via the website.
- **Proposed resolution:** Push the locally-created homework to the canonical `homework` table on Supabase so parents/students see it via the website.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### HOMEWORK-103 — Android `pullAll` doesn't pull homework/attendance/assessments; cross-platform visibility is one-way only

- **Category:** HOMEWORK  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-039 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass HOMEWORK-103
- **Description:** The Android's `PullSyncRepository.pullAll()` (`PullSyncRepository.kt:264-281`) fetches: parents, students, payments, ledger_entries, classes, subjects, installments, personnel, departments, notifications, workflow_runs. It does NOT pull: `homework`, `attendance_records`, `assessments`. So even if the Android's sync push worked (it doesn't, per HOMEWORK-101 / ATT-100), the Android would never SEE homework/attendance/grades created on the desktop or on the website (which is read-only). Cross-platform visibility is one-way only: Android pushes (when it works) but doesn't pull. Desktop writes directly to canonical tables but doesn't push at all (per HOMEWORK-100 / ATT-100 — desktop's direct INSERT fails too, but even when fixed, the desktop has no realtime subscription per CACHE-103).
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt:264-281` (pullAll method — no homework/attendance/assessments pull) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1439-1440` (`LocalHomeworkRepository.observeForClass` — only reads local Room, never Supabase) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:937-953` (`LocalGradeRepository.observeForStudent/observeForClass` — only reads local Room)
- **Evidence:** Audit evidence (Confirmed). Git: `PullSyncRepository.pullAll` committed in `b25e6ca mid` (2026-08-04). The list of pulled entities was written once and never extended to include academic tables.
- **Root cause:** The pull layer was built for the financial cluster (parents, students, payments, ledger, installments) — the entities the Excel importer touches. Academic entities (homework, attendance, assessments) were added later (migration 0029 + 0041) but the pull layer was never extended.
- **Current behavior:** Pull is partial — homework/attendance/assessments are not pulled. The Android only sees what it created locally. Cross-device visibility (Android A creates → Android B sees) is zero. Cross-platform visibility (desktop creates → Android sees) is zero. The website (which reads directly from Supabase, no pull needed) is the only platform that sees everything.
- **Expected behavior:** Sync bidirectionally: Android pushes local mutations to Supabase AND pulls remote mutations from Supabase into local Room. The 15-min `SyncWorker` cycle is the canonical freshness window.
- **Proposed resolution:** Sync bidirectionally: Android pushes local mutations to Supabase AND pulls remote mutations from Supabase into local Room. The 15-min `SyncWorker` cycle is the canonical freshness window.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SCHED-100 — Timetable (Emploi du Temps) feature is structurally unimplemented: domain model + UI KPI exist but no DB table, no Supabase repository, no migration

- **Category:** SCHED  |  **Severity:** Medium  |  **Status:** BLOCKED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-042 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SCHED-100
- **Description:** The desktop has a complete `TimetableEntry` domain model (`teacher.ts:180-224`), a `Timetable` read-model (line 220-224), a `TeacherRepository.observeTimetableForClass/observeTimetableForTeacher/observeTimetableByAcademicYear/createTimetableEntry/updateTimetableEntry/deleteTimetableEntry` contract (`teacher-repository.ts`), a `MockTeacherRepository` implementation with full CRUD + conflict detection (`teacher-repository.ts:336-478`), a `detectTimetableConflict` validation function (`validation.ts:283-313`), and a UI consumer in `academic-year-detail-drawer.tsx:180-227` that displays a "Timetable Coverage %" KPI. But there is (a) NO Supabase migration creating a `timetable_entries` table, (b) NO Supabase `TeacherRepository` implementation (the `teachers` repository in `getSupabaseRepositories()` falls back to `mockRepositories` per `supabase-repositories.ts:138`), (c) NO UI for creating/editing timetable entries.
- **Location:** - `elimtiyaz-desktop/src/domain/model/teacher.ts:132-224` (TimetableEntry + Timetable domain model) - `elimtiyaz-desktop/src/domain/repository/teacher-repository.ts` (TeacherRepository contract — observeTimetableForClass, createTimetableEntry, etc.) - `elimtiyaz-desktop/src/infrastructure/mock/repositories/teacher-repository.ts:336-478` (mock implementation with full CRUD + conflict detection) - `elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts:138` (`...mockRepositories` — teachers falls back to mock) - `elimtiyaz-desktop/src/features/academics/academic-year-detail-drawer.tsx:180-227` (UI consumer: "Timetable Coverage %" KPI calls `repos.teachers.observeTimetableByAcademicYear(year.id)`) - `elimtiyaz-desktop/supabase/migrations/` — directory listing has NO migration creating a `timetable_entries` table (verified by grep)
- **Evidence:** Audit evidence (Confirmed — verified across 6 files; no migration creates the table, no Supabase repository implements the contract, the only consumer is the academic-year-detail-drawer.). Git: Domain model + mock repository + academic-year-detail-drawer all committed in `b25e6ca mid` (2026-08-04). The supabase-repositories.ts comment at line 24 says "Personnel + Departments (DESKTOP-1): entity CRUD on `personnel` (0009) and `departments` (0010). Releve/timesheets, workforce tasks, chat, shifts, schedules and onboarding remain on the mock layer." — schedules explicitly listed as still-mock. The timetable (which is the academic counterpart to workforce `Schedule`) was never even spec'd for migration.
- **Root cause:** The author built the domain model + mock implementation + UI consumer as the first iteration of the timetable feature, planning to wire up the Supabase repository + migration later. The migration + Supabase repository were never written. The feature is half-built and shipped.
- **Current behavior:** The feature is a façade: the domain model exists, the contract exists, the mock implementation exists, the UI consumes the contract — but the persistence layer is missing. In production (Supabase mode), every query returns an empty list. The KPI is permanently 0%.
- **Expected behavior:** Maintain a per-class, per-academic-year timetable (Emploi du Temps) with conflict detection (no overlapping slots for the same teacher or class). Show coverage % (what % of classes have at least one timetable entry).
- **Proposed resolution:** Maintain a per-class, per-academic-year timetable (Emploi du Temps) with conflict detection (no overlapping slots for the same teacher or class). Show coverage % (what % of classes have at least one timetable entry).
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-011 (build-or-remove decision for the timetable feature).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### SCHED-101 — `detectTimetableConflict` checks teacher/class overlaps but NOT room conflicts (different teachers, different classes, same room, same time)

- **Category:** SCHED  |  **Severity:** Low  |  **Status:** BLOCKED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-042 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass SCHED-101
- **Description:** The `detectTimetableConflict` function (`validation.ts:283-313`) filters existing entries by: `if (e.teacherId !== teacherId && e.classId !== classId) return false;` (line 299). This means it only flags a conflict if EITHER the teacher OR the class matches. Two DIFFERENT teachers in TWO DIFFERENT classes assigned to the SAME PHYSICAL ROOM at overlapping times would NOT trigger a conflict — both entries pass validation and are persisted. The school would discover the room double-booking only when both teachers show up at the room at the same time.
- **Location:** - `elimtiyaz-desktop/src/domain/calc/teacher/validation.ts:283-313` (conflict detection logic) - `AgentGithubUplaad/elimtiyaz-desktop/src/infrastructure/mock/repositories/teacher-repository.ts:381-385` (caller — `MockTeacherRepository.createTimetableEntry`)
- **Evidence:** Audit evidence (Confirmed (in mock mode only — the Supabase timetable is unimplemented per SCHED-100) Stage Summary: - Total new findings: 14 (HOMEWORK-100, HOMEWORK-101, ATT-100, ATT-101, SCHED-100, ACAD-100, ACAD-101, HOMEWORK-102, GRADE-100, ATT-102, ACAD-102, ACAD-103, ATT-103, HOMEWORK-103, ACAD-104, GRADE-101, SCHED-101) — actually 17 findings; recount below - Recount: HOMEWORK-100, HOMEWORK-101, HOMEWORK-102, HOMEWORK-103, ATT-100, ATT-101, ATT-102, ATT-103, SCHED-100, SCHED-101, ACAD-100, ACAD-101, ACAD-102, ACAD-103, ACAD-104, GRADE-100, GRADE-101 = 17 findings - Severity breakdown: - Critical: 5 (HOMEWORK-100 desktop push always fails, HOMEWORK-101 Android push always fails, ATT-100 desktop roll call triple-broken, ATT-101 absence-justification workflow structurally unreachable past `submitted`, SCHED-100 timetable feature structurally unimplemented) - High: 6 (ACAD-100 two parallel promotion paths with dead SQL RPC, ACAD-101 non-atomic academic-year rollover, HOMEWORK-102 legacy table dead + realtime wasted, HOMEWORK-103 Android pull doesn't fetch academic tables, ATT-102 narrative-generator attendance rate divergence, ATT-103 Android alertAbsences no threshold) - Medium: 6 (GRADE-100 a…). Git: `validation.ts` committed in `b25e6ca mid` (2026-08-04). The conflict function was written to filter by teacher OR class — the author likely forgot that room is also a finite resource.
- **Root cause:** The author was focused on the teacher's schedule (don't double-book a teacher) and the class's schedule (don't double-book a class). They forgot that a room is also a finite resource that can't host two classes simultaneously.
- **Current behavior:** Detects teacher and class conflicts, misses room conflicts.
- **Expected behavior:** Detect all scheduling conflicts: teacher double-booked, class double-booked, AND room double-booked.
- **Proposed resolution:** Detect all scheduling conflicts: teacher double-booked, class double-booked, AND room double-booked.
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-011; only relevant if the timetable feature is completed.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### STUDENT-100 — Android promotion sync push silently DROPS grade_level_code (RPC has no such parameter)

- **Category:** STUDENT  |  **Severity:** Critical  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-024 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass STUDENT-100
- **Description:** When an Android user promotes a student (via `LocalPromotionRepository.promoteStudents` at LocalRepositories.kt line 855-900), the local Room entity's `gradeLevel` field is updated and a sync entry is enqueued with `entity="student", operation="promote"`. The `SyncQueueDispatcher.pushEntry` (line 52-98) routes by `entity` ONLY — it dispatches to `pushStudent` regardless of the `operation` field. `pushStudent` (line 167-191) constructs RPC params for `upsert_student_from_import`, but that RPC (0027 line 503-519) has NO `p_grade_level_code` parameter. So the new gradeLevel is silently dropped on sync push. The server-side `students.grade_level_code` column is NEVER updated by the Android path.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:855-900` (LocalPromotionRepository); `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:69-97` (pushEntry dispatch — ignores operation); `:167-191` (pushStudent — no grade_level_code); `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:503-519` (RPC signature — no p_grade_level_code param).
- **Evidence:** Audit evidence (Confirmed). Git: LocalRepositories.kt last touched `94471e8` (2026-08-28); SyncQueueDispatcher.kt last touched `94471e8` (2026-08-28); 0027_shared_unification.sql introduced in `b25e6ca` (2026-08-04).
- **Root cause:** The `upsert_student_from_import` RPC was written for Excel bulk import (where grade_level_code is set ONCE during initial creation, not changed). The promotion flow's need to UPDATE grade_level_code post-creation wasn't anticipated. The dispatcher's `when (entry.entity)` switch ignores `operation` entirely — treating all student sync entries as upserts.
- **Current behavior:** The promotion's grade_level_code change is local-only. The server student row keeps the old grade_level_code. The Android user sees the new grade locally; the desktop user (querying the server) sees the old grade. Cross-platform state drift.
- **Expected behavior:** The sync push should propagate the new gradeLevel to the server. Either: (a) the RPC should have a `p_grade_level_code` parameter, or (b) the dispatcher should detect `operation="promote"` and call a different RPC (e.g., a hypothetical `promote_student` RPC) or perform a direct table UPDATE on `students.grade_level_code`.
- **Proposed resolution:** The sync push should propagate the new gradeLevel to the server. Either: (a) the RPC should have a `p_grade_level_code` parameter, or (b) the dispatcher should detect `operation="promote"` and call a different RPC (e.g., a hypothetical `promote_student` RPC) or perform a direct table UPDATE on `students.grade_level_code`.
- **Dependencies:** TENANT-106 (server-side promotion path must be usable first)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Communication Features

### CHAT-100 — `chat_channels_insert` RLS allows any authenticated user to create a channel with arbitrary `member_ids` (no membership validation on insert)

- **Category:** CHAT  |  **Severity:** Medium  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-071 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CHAT-100
- **Description:** The RLS policy `chat_channels_insert` (0019 line 832-834) is `for insert to authenticated with check (tenant_id = public.current_tenant_id())`. The `with check` clause only verifies the tenant_id — there is NO check that `created_by = current_user_profile_id()`, NO check that `current_user_profile_id()` is in `member_ids`, NO check on `channel_type` (so a user can claim `channel_type='announcement'` even though announcements are supposed to be admin-only), and NO check that the inserter has any relationship to the user_profiles rows listed in `member_ids`. A parent can craft an INSERT with `member_ids = [their_own_id, principal_user_profile_id, financial_officer_user_profile_id]` and the row would be accepted.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:832-834`
- **Evidence:** Audit evidence (Confirmed). Git: Migration 0019 last touched in `b25e6ca` (2026-08-04, "FKFKFK"). The policy has been permissive since the original commit.
- **Root cause:** The author wrote the insert policy as a generic "tenant-bound INSERT" without considering the channel-membership semantics. The `member_ids` array was assumed to be populated by trusted code (e.g., an admin EF) — but the RLS layer doesn't enforce that assumption.
- **Current behavior:** Only `tenant_id` is checked. Membership, ownership, and channel_type authorization are all unchecked.
- **Expected behavior:** The insert policy should require `created_by = current_user_profile_id()` AND `current_user_profile_id() = ANY(member_ids)` (the creator must be a member) AND for `channel_type='announcement'` require `has_role('super_admin')` or similar.
- **Proposed resolution:** The insert policy should require `created_by = current_user_profile_id()` AND `current_user_profile_id() = ANY(member_ids)` (the creator must be a member) AND for `channel_type='announcement'` require `has_role('super_admin')` or similar.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CHAT-101 — `chat_messages_insert` RLS has no channel-membership check; any user can spam any channel_id they know

- **Category:** CHAT  |  **Severity:** Medium  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-071 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CHAT-101
- **Description:** The RLS policy `chat_messages_insert` (0019 line 851-856) is `for insert to authenticated with check (tenant_id = current_tenant_id() and author_id = current_user_profile_id())`. The check correctly enforces `author_id = current_user_profile_id()` (preventing authorship spoofing), but does NOT verify that the author is a MEMBER of `channel_id`. So a parent who knows (or guesses) a `channel_id` they are NOT a member of can still INSERT messages into it. The author_id would be their own, so the insert succeeds.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:851-856`
- **Evidence:** Audit evidence (Confirmed). Git: Migration 0019 last touched in `b25e6ca` (2026-08-04, "FKFKFK"). The policy has been missing the membership check since the original commit.
- **Root cause:** The author wrote the policy mirroring the `chat_messages_select` pattern but without the EXISTS subquery — they assumed the channel_id would always correspond to a channel the user is a member of (a valid assumption for the official UI, but RLS should enforce invariants, not trust client behavior).
- **Current behavior:** Only `tenant_id` + `author_id = current_user_profile_id()` are checked. Channel membership is NOT verified.
- **Expected behavior:** The insert policy should require `EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = chat_messages.channel_id AND c.member_ids @> ARRAY[current_user_profile_id()])` — i.e., the author must be a member of the target channel.
- **Proposed resolution:** The insert policy should require `EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = chat_messages.channel_id AND c.member_ids @> ARRAY[current_user_profile_id()])` — i.e., the author must be a member of the target channel.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CHAT-103 — No production code anywhere creates `chat_channels` rows; the website's MessagesView is permanently empty for parents

- **Category:** CHAT  |  **Severity:** High  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Desktop, Website
- **Task:** T-037 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CHAT-103, second-pass CHAT-105
- **Description:** A repo-wide grep for `from("chat_channels")` / `from('chat_channels')` returns only ONE match in production code: `portal-queries.ts:442` — and that line is a SELECT (`.from('chat_channels').select('*').contains('member_ids', [userProfileId])`). There is NO INSERT into `chat_channels` anywhere — not in the website, not in the desktop's Supabase repositories (the desktop uses a MOCK chat repository per `supabase-repositories.ts:137` `...mockRepositories` spread — the chat key is never overridden), not in any Edge Function, not in any SQL migration seed. The desktop's mock `createChannel` (`mock/workforce/index.ts:850-876`) writes to an in-memory `this.channels` array — never to Supabase. The Android has zero chat code at all (only RBAC permission codes `USE_CHAT` / `MANAGE_CHAT_CHANNELS` in `Rbac.kt:66`). Result: the `chat_channels` table is empty in production. The website's `useChatChannels` query returns `[]`. The MessagesView shows "Aucune conversation" forever. There is no path — UI button, EF, RPC, or DB trigger — by which a staff member could create a parent-facing channel.
- **Location:** - `elimtiyaz-website/src/lib/hooks/portal-queries.ts:434-451` (useChatChannels — only reads) - `elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts:137` (chat stays on mockRepositories — no Supabase override) - `elimtiyaz-desktop/src/infrastructure/mock/workforce/index.ts:850-876` (mock createChannel — in-memory only, never persists) ;; [CHAT-105] - `elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts:137-162` (mock fallback spread; no `chat` override) - `elimtiyaz-desktop/src/infrastructure/mock/workforce/index.ts:820-972` (mock chat implementation, in-memory only) - `elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx` (uses `repos.chat.*`)
- **Evidence:** Audit evidence (Confirmed). Git: Mock chat in `b25e6ca` (2026-08-04, "FKFKFK"). Website MessagesView in `e90dbf7 mid` (2026-08-01). Neither has ever had a production INSERT path.
- **Root cause:** The chat feature was spec'd in plan §10.09 and the schema was created in 0010 + 0019 — but the WRITE-side code was never written. The desktop's mock was a placeholder for a future Supabase port that never happened. The website's MessagesView was written assuming channels would exist (created by some other path).
- **Current behavior:** The `chat_channels` table is empty. No code writes to it. The website's chat UI is permanently empty.
- **Expected behavior:** Some code path should create a chat_channels row when (a) a staff member creates an announcement channel for a class, (b) a parent is linked to a staff member for 1:1 messaging, (c) an admin creates a department channel. None of these paths exist in production code.
- **Proposed resolution:** Some code path should create a chat_channels row when (a) a staff member creates an announcement channel for a class, (b) a parent is linked to a staff member for 1:1 messaging, (c) an admin creates a department channel. None of these paths exist in production code.
- **Dependencies:** none recorded
- **Status note (2026-08-31, 14th session):** RESOLVED. The owner decided chat IS a committed
  feature (UNKNOWN-005 resolved — ADR-008). Backend: migration 0061 (applied live + registered,
  atomic MIG-TOKENS apply) adds the canonical idempotent `create_direct_channel` RPC + completion
  columns + staff/creator UPDATE policy; live verification scripts/verify_t-098.sql 15/15
  (happy path, idempotency, staff gate, self/foreign rejection, RLS regressions, audit). Desktop:
  `SupabaseChatRepository` replaces the mock in the Supabase assembly (T-099 — CHAT-105 dead) +
  staff↔parent entry point on the parent-detail drawer (T-100) + ChatPanel persists staff↔staff.
  Website: read+reply side already correct; T-101 pinned ordering/previews/archived filter
  (4/4). Remaining gap: Android has NO chat UI (never existed — new problem ANDR-CHAT-200,
  task T-102). Full E2E device round-trip still needs AUTH-200 (Google OAuth enabled).
- **Absorbed findings:** CHAT-105: The desktop's `getSupabaseRepositories()` factory (`supabase-repositories.ts:79-172`) builds a `Repositories` object that OVERRIDES most mock repositories with Supabase-backed implementations — but the `chat` key is NOT in the override list. It falls through to `...mockRepositories` (line 138 spread). The mock chat repository (`mock/workforce/index.ts:820-972`) maintains in-memory `channels: ChatChannel[]` and `messages: ChatMessage[]` arrays. When the desktop app process exits (close window), all chat data is wiped. The desktop's ChatPanel UI (`features/personnel/management/chat-panel.tsx`) calls `repos.chat.observeChannels(currentUserId)`, `repos.chat.sendMessage(...)`, `repos.chat.editMessage(...)`, `repos.chat.deleteMessage(...)`, `repos.chat.markRead(...)` — all of which hit the mock, never Supabase. Result: staff-to-staff chat in the desktop is a sandboxed mock that no other platform can see, and parents (via the website) have no path to receive messages from staff.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### CHAT-104 — `chat_channels.updated_at` never updates when a new chat_message is INSERTed; channel list is sorted by CREATION time, not last-message time

- **Category:** CHAT  |  **Severity:** Low  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-037 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass CHAT-104
- **Description:** The `chat_channels_touch_updated_at` trigger (0010 line 404-405) is `before update on public.chat_channels` — it only fires when a chat_channels row is UPDATED, not when a chat_messages row is INSERTed. There is NO trigger `after insert on chat_messages` that would touch the parent channel's `updated_at` to reflect the new message's `sent_at`. The website's `useChatChannels` (portal-queries.ts:445) sorts channels by `updated_at desc` — so the channel list is sorted by when each channel was LAST UPDATED (i.e., when its metadata changed — name, member_ids), NOT by when the last message arrived. A channel that just received a new message stays at its old position in the list (sorted by creation time, since `updated_at` defaults to `created_at` and never changes after the channel is created).
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0010_workforce.sql:404-405` (only `before update` trigger — no `after insert on chat_messages`) - `elimtiyaz-website/src/lib/hooks/portal-queries.ts:445` (sort by `updated_at desc`) - `elimtiyaz-website/src/features/messages/messages-view.tsx:198-205` (send() INSERTs chat_message but does NOT update the channel's `updated_at`)
- **Evidence:** Audit evidence (Confirmed). Git: Mock sendMessage last touched in `b25e6ca` (2026-08-04). Website useChatChannels in `e90dbf7 mid` (2026-08-01). The trigger in 0010 in `b25e6ca`.
- **Root cause:** The author of the canonical schema (0010) forgot to add a `after insert on chat_messages` trigger that would touch the parent channel's `updated_at`. The mock's `lastMessageAt` column was supposed to mirror a real DB column — but there's no `last_message_at` column in the canonical `chat_channels` table either (only `updated_at`).
- **Current behavior:** `chat_channels.updated_at` only reflects metadata changes (name/member changes). The channel list looks permanently stale.
- **Expected behavior:** The channel list should be sorted by "last message time" — i.e., the `max(sent_at)` of the channel's chat_messages. Either via (a) a DB trigger that updates `chat_channels.updated_at` on chat_message INSERT, or (b) a separate `last_message_at` column maintained by the trigger, or (c) a JOIN/subquery in the SELECT that fetches the max sent_at.
- **Proposed resolution:** The channel list should be sorted by "last message time" — i.e., the `max(sent_at)` of the channel's chat_messages. Either via (a) a DB trigger that updates `chat_channels.updated_at` on chat_message INSERT, or (b) a separate `last_message_at` column maintained by the trigger, or (c) a JOIN/subquery in the SELECT that fetches the max sent_at.
- **Dependencies:** none recorded
- **Status note (2026-08-31, 14th session):** RESOLVED via migration 0061, resolution option (b):
  `chat_channels.last_message_at` + `last_message_preview` columns maintained by the
  `chat_messages_touch_channel` AFTER INSERT trigger (also bumps updated_at). The website now
  orders by `last_message_at desc nulls last` and hides archived channels; the desktop orders by
  `lastMessageAt ?? createdAt` desc. Live evidence: verify_t-098.sql C10 (trigger fires —
  last_message_at set, preview = body prefix, updated_at advanced).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### NOTIF-100 — `notifications_update` RLS blocks recipients from marking role-broadcast notifications as read; bulk mark-read silently no-ops (extends REALTIME-101 from chat_messages to notifications)

- **Category:** NOTIF  |  **Severity:** Medium  |  **Status:** BLOCKED
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-038 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass NOTIF-100
- **Description:** The `notifications_update` RLS policy (0019 line 1036-1042) is `for update to authenticated using (tenant_id = current_tenant_id() and (target_user_id = current_user_profile_id() or has_role('super_admin'))) with check (tenant_id = current_tenant_id())`. The USING clause only matches rows where `target_user_id = current_user_profile_id()` — i.e., DIRECT (user-targeted) notifications. For ROLE-BROADCAST notifications (`target_user_id IS NULL`, `target_role = 'parent'` etc.), the USING clause is FALSE (target_user_id ≠ current_user_profile_id() — it's NULL). PostgREST returns 0 rows updated, NO error. The website's `markAllRead` (`notifications-view.tsx:87-91`) runs `supabase.from('notifications').update({...}).eq('target_user_id', user.id).eq('is_read', false)` — but this filter explicitly excludes role-broadcasts (they have target_user_id NULL). The website's per-notification `markRead` (`notifications-view.tsx:108-111`) uses `.eq('id', n.id)` — for a role-broadcast, RLS denies → 0 rows updated → no error → UI optimistically refetches → role-broadcast comes back with `is_read: false` forever. The desktop's `markRead(id)` (supabase-notification-repository.ts:169-179) and `dismiss(id…
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:1036-1042` (UPDATE policy) - `elimtiyaz-website/src/features/notifications/notifications-view.tsx:87-117` (markAllRead + markRead) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-notification-repository.ts:169-179, 211-221` (desktop markRead + dismiss — both silently RLS-denied for role-broadcasts) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1525-1537` (Android markRead/markAllRead/dismiss — local-only, no server push)
- **Evidence:** Audit evidence (Confirmed — EXTENDS REALTIME-101 by showing the SAME RLS-denial pattern applies to the `notifications` table (not just `chat_messages`)). Git: 0019 RLS last touched in `b25e6ca` (2026-08-04). notifications-view markRead in `e90dbf7 mid` (2026-08-01). supabase-notification-repository in `b25e6ca`.
- **Root cause:** The notifications schema was designed assuming each notification has ONE recipient (target_user_id). The role-broadcast mode (target_role) was added later as an afterthought — the `is_read` column doesn't support per-recipient read state. The RLS policy correctly enforces "only the direct recipient can mark as read" — but there's no equivalent mechanism for role-broadcast recipients.
- **Current behavior:** Role-broadcast notifications can NEVER be marked as read or dismissed by recipients (only super_admin can update them). They stay in the unread state forever. The bell badge stays at the cumulative unread count indefinitely (until the notification's `expires_at` passes — and most notifications don't set `expires_at`).
- **Expected behavior:** A recipient (matching the target_role) should be able to mark their own VIEW of a role-broadcast notification as read. Either via a per-user-read-state table (e.g., `notification_reads(notification_id, user_profile_id, read_at)`) OR via the existing `is_read` column being interpreted per-user (which would require a different data model). The current single `is_read` column is shared across all recipients of a role-broadcast — even if one recipient could update it, doing so would mark it as read for ALL recipients.
- **Proposed resolution:** A recipient (matching the target_role) should be able to mark their own VIEW of a role-broadcast notification as read. Either via a per-user-read-state table (e.g., `notification_reads(notification_id, user_profile_id, read_at)`) OR via the existing `is_read` column being interpreted per-user (which would require a different data model). The current single `is_read` column is shared across all recipients of a role-broadcast — even if one recipient could update it, doing so would mark it as read for ALL recipients.
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-007 (per-recipient read-state model for role-broadcast notifications).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### NOTIF-101 — `notifications_insert` RLS allows any authenticated user to INSERT a notification addressed to ANY user_id (notification spam / injection)

- **Category:** NOTIF  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-071 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass NOTIF-101
- **Description:** The `notifications_insert` RLS policy (0019 line 1033-1035) is `for insert to authenticated with check (tenant_id = current_tenant_id())`. The `with check` clause ONLY verifies `tenant_id` — there is NO check that `target_user_id = current_user_profile_id()` (i.e., the inserter can only create notifications for themselves) OR that the inserter has an admin role. Any authenticated user in the tenant can INSERT a notification with `target_user_id` set to ANY other user's profile UUID. The recipient would see the notification in their bell (per `notifications_select` line 1023-1032, which allows `target_user_id = current_user_profile_id()`).
- **Location:** `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:1033-1035`
- **Evidence:** Audit evidence (Confirmed). Git: Migration 0019 in `b25e6ca` (2026-08-04). The policy has been permissive since the original commit.
- **Root cause:** Same as CHAT-100 — the author wrote a generic "tenant-bound INSERT" without considering the per-user authorization. The notifications table was assumed to be written only by trusted server-side code (EFs, triggers), but the RLS layer allows any client INSERT.
- **Current behavior:** Any authenticated user can INSERT a notification to any user_id in their tenant. The recipient sees it in their bell with the attacker's chosen title, body, priority, source_label.
- **Expected behavior:** Only authorized senders (super_admin, support_staff, system via SECURITY DEFINER RPC) should be able to INSERT notifications addressed to other users. A parent should NEVER be able to send a notification to another parent.
- **Proposed resolution:** Only authorized senders (super_admin, support_staff, system via SECURITY DEFINER RPC) should be able to INSERT notifications addressed to other users. A parent should NEVER be able to send a notification to another parent.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### NOTIF-102 — Desktop topbar bell `unreadCount` is computed AFTER slicing to 8 items; badge caps at 8 even when actual unread is 50

- **Category:** NOTIF  |  **Severity:** Low  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-052 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-052, 12th session): the desktop topbar computes unreadCount from the FULL visible list (allVisibleNotifications) — the 8-item slice is a dropdown display limit only. Source-guard test pins the pattern.
- **Consolidated from:** second-pass NOTIF-102
- **Description:** The desktop's topbar (topbar.tsx:107-118) computes `visibleNotifications = sortAlertsByPriority(visible).slice(0, 8)` — i.e., the top 8 alerts by priority. THEN computes `unreadCount = visibleNotifications.filter((n) => !n.readAt).length` — i.e., count of unread IN THE FIRST 8. If a user has 50 unread alerts, only the top 8 (by priority) are considered — the badge shows at most 8. The dropdown (line 236-241) shows "8 non lues" even though there are 50. The "Tout marquer comme lu" button (which appears in the AlertsTab, not the dropdown) DOES call markAllRead which would mark ALL 50 as read — but the bell badge never reflects the true count.
- **Location:** `elimtiyaz-desktop/src/shared/layout/topbar.tsx:107-118`
- **Evidence:** Audit evidence (Confirmed). Git: topbar.tsx last touched in `94471e8` (2026-08-28). The slice-then-count pattern has been there since the file's first commit.
- **Root cause:** The author conflated "what to display in the dropdown" (top 8 by priority) with "how many unread total" (the badge count). They reused the same array for both purposes. The slice is correct for the dropdown; it shouldn't be applied to the count.
- **Current behavior:** The badge shows ≤8. Users with >8 unread alerts see a misleading count.
- **Expected behavior:** The bell badge should show the user's TOTAL unread count, not the unread count of the first-8-sorted-by-priority. Either compute the count from the raw stream (before slicing) OR run a separate COUNT query.
- **Proposed resolution:** The bell badge should show the user's TOTAL unread count, not the unread count of the first-8-sorted-by-priority. Either compute the count from the raw stream (before slicing) OR run a separate COUNT query.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### NOTIF-103 — Website bottom-nav fetches 1 unread notification but never renders it (dead query); top-app-bar bell caps unread at 50

- **Category:** NOTIF  |  **Severity:** Low  |  **Status:** OPEN
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Desktop, Website
- **Task:** T-052 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-052, 12th session): NEW useUnreadNotificationCount COUNT-only hook (head:true + count exact — zero rows transferred); the top-app-bar uses it (no 50-cap); the dead 1-row unread queries removed from BottomNav + DesktopRail (3 concurrent notification queries → 1).
- **Consolidated from:** second-pass NOTIF-103
- **Description:** Two compounding UI bugs in the website's notification badge plumbing: (1) `bottom-nav.tsx:60-64` runs `useNotifications(user?.id, { unreadOnly: true, limit: 1 })` and computes `hasUnreadNotifications = Boolean(unreadNotifications && unreadNotifications.length > 0)` — but `hasUnreadNotifications` is NEVER referenced in the JSX that follows. The query fires on every render of BottomNav + DesktopRail (both components duplicate the query), loading 1 row from the server, but the boolean is never used. This is a dead query — wasted bandwidth + TanStack cache pollution. (2) `top-app-bar.tsx:50-54` runs `useNotifications(user?.id, { unreadOnly: true, limit: 50 })` and displays `unread?.length ?? 0` — so the bell badge caps at 50. A user with 200 unread notifications sees "50" in the bell. (3) The bottom-nav and top-app-bar run INDEPENDENT queries with different limits (1 vs 50) — TanStack treats them as different cache keys (because the limit is in the key) and stores them separately. So there are 3 concurrent notification queries on every page render (bottom-nav + desktop-rail + top-app-bar).
- **Location:** - `elimtiyaz-website/src/features/shared/bottom-nav.tsx:60-64, 124-128` (dead query duplicated in both BottomNav and DesktopRail) - `elimtiyaz-website/src/features/shared/top-app-bar.tsx:50-54` (caps at 50)
- **Evidence:** Audit evidence (Confirmed). Git: bottom-nav.tsx and top-app-bar.tsx both in `e90dbf7 mid` (2026-08-01). Both have been broken since first commit.
- **Root cause:** (1) The bottom-nav was originally intended to have a bell icon but was removed (per bottom-nav.tsx header comment line 18-19: "Notifications is reachable via the top app bar bell icon, not the bottom nav"). The query was left behind during the cleanup. (2) The top-app-bar's limit=50 was an arbitrary choice to avoid loading thousands of notifications — but using `.length` of a limited result as the count is the wrong pattern (should use a COUNT query or head(1) to check "any unread" + a separate "list" query).
- **Current behavior:** bottom-nav's query is dead (computed but never rendered). top-app-bar caps at 50.
- **Expected behavior:** The bottom-nav's `hasUnreadNotifications` should drive a notification bell badge somewhere (probably the bottom-nav's "messages" item or a dedicated bell). The top-app-bar should use the actual unread count without capping.
- **Proposed resolution:** The bottom-nav's `hasUnreadNotifications` should drive a notification bell badge somewhere (probably the bottom-nav's "messages" item or a dedicated bell). The top-app-bar should use the actual unread count without capping.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### NOTIF-104 — Android `NotificationDao.markRead/markAllRead/dismiss` only update LOCAL Room; server's `notifications.is_read` / `dismissed_at` stays at original values forever (silent desync)

- **Category:** NOTIF  |  **Severity:** Medium  |  **Status:** BLOCKED
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-038 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass NOTIF-104
- **Description:** Android's `LocalNotificationRepository` (LocalRepositories2.kt:1515-1538) wraps `NotificationDao` methods that only run SQL against the LOCAL Room database: - `markRead(id)` → `notificationDao.markRead(id)` → `UPDATE notifications SET isRead=1 WHERE id=:id` (LocalDaos.kt:521-522) — LOCAL only - `markAllRead()` → `notificationDao.markAllRead()` → `UPDATE notifications SET isRead=1 WHERE isRead=0` (LocalDaos.kt:524-525) — LOCAL only - `dismiss(id)` → `notificationDao.dismiss(id)` → `DELETE FROM notifications WHERE id=:id` (LocalDaos.kt:527-528) — LOCAL only (hard delete, not soft-dismiss) None of these methods call `supabase.from('notifications').update(...)` to push the read state to the server. Result: when an Android user marks a notification as read, the server's `notifications.is_read` stays `false`. When the next `pullNotifications()` (PullSyncRepository.kt:234-243) runs every 15 min, the server returns the notification with `is_read=false` — but Room uses `@Insert(onConflict = OnConflictStrategy.REPLACE)` (LocalDaos.kt:515-516) which OVERWRITES the local `isRead=true` with the server's `isRead=false`. The user's "read" state is silently REVERTED every 15 minutes.
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1515-1538` (LocalNotificationRepository) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/LocalDaos.kt:505-529` (NotificationDao) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt:234-243` (pullNotifications overwrites local state)
- **Evidence:** Audit evidence (Confirmed). Git: LocalRepositories2.kt last touched in `94471e8` (2026-08-28). The notification repository has been local-only since first commit. The comment at line 1527-1529 says "both methods previously returned Ok(Unit) without touching the database" — so the fix made them touch the LOCAL DB but didn't add server-push.
- **Root cause:** The Android's sync architecture was designed as PULL-dominant (PullSyncRepository) — push-side (SyncQueueDispatcher) only handles entity mutations (parents, students, payments), not notification state changes. Notification read/dismiss was considered a "client-side" concern — but this causes server desync.
- **Current behavior:** Only local Room is updated. The server's `notifications.is_read` and `dismissed_at` stay at their original values. The next pull OVERWRITES local state.
- **Expected behavior:** The Android's notification repository should push read/dismiss state to the server (e.g., call `supabase.from('notifications').update({ is_read: true, read_at: now }).eq('id', id)`) BEFORE updating local Room, OR enqueue an offline mutation that drains on next sync.
- **Proposed resolution:** The Android's notification repository should push read/dismiss state to the server (e.g., call `supabase.from('notifications').update({ is_read: true, read_at: now }).eq('id', id)`) BEFORE updating local Room, OR enqueue an offline mutation that drains on next sync.
- **Dependencies:** none recorded
- **Status note:** Depends on UNKNOWN-007 (read-state model) and on the Android sync-push scope decision (UNKNOWN-002).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### NOTIF-105 — Android `pullNotifications` pulls ALL server-visible notifications (limit:200) with no per-user filter; stale role-broadcasts persist in Room across role changes

- **Category:** NOTIF  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-039 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass NOTIF-105
- **Description:** Android's `PullSyncRepository.pullNotifications` (line 234-243) runs `provider.postgrest.from("notifications").select { limit(200) }` — NO filter by `target_user_id`, NO filter by `target_role`, NO filter by `tenant_id` (RLS scopes by tenant_id implicitly), NO filter by `is_read` or `dismissed_at`. The query returns whatever the server's RLS allows — for a parent, that's their direct notifications + role-broadcasts for `parent` role + tenant-broadcasts (which parents can't see per RLS). Then `db.notificationDao().upsertAll(listOf(dto.toEntity()))` (line 237) loops over the results ONE AT A TIME (O(N) Room round-trips — should be `upsertAll(dtoList.map { it.toEntity() })` for a single batch INSERT) and uses `@Insert(onConflict = OnConflictStrategy.REPLACE)` which OVERWRITES existing rows. The `NotificationEntity` doesn't track which user/role the notification was targeted to — so a notification stored today as a `parent` role-broadcast stays in Room forever. If the user's role later changes (e.g., they're promoted to staff), the OLD parent-role-broadcast notifications stay in Room — but `observeForUser(userId)` query (`WHERE targetUserId IS NULL OR targetUserId = :userId`) returns t…
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt:234-243` (no filter pull) - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/LocalDaos.kt:505-529` (NotificationDao — no eviction, no role filter)
- **Evidence:** Audit evidence (Confirmed). Git: PullSyncRepository.kt last touched in `94471e8` (2026-08-28). LocalDaos.kt in same commit.
- **Root cause:** The Android was designed with a "cache-then-observe" pattern — pull everything RLS allows, observe locally. The author didn't consider role CHANGES (which are rare but happen). The local cache has no time-to-live, no eviction, no role-based re-filtering.
- **Current behavior:** Pull fetches whatever RLS allows (which is role-dependent). The local cache never evicts — REPLICE strategy only updates existing rows; rows that EXIST in Room but are NOT in the pull result stay forever.
- **Expected behavior:** The pull should filter by the user's current role (and target_user_id) — only fetching notifications relevant to the CURRENT session. The local cache should evict notifications that no longer match the user's role on each pull.
- **Proposed resolution:** The pull should filter by the user's current role (and target_user_id) — only fetching notifications relevant to the CURRENT session. The local cache should evict notifications that no longer match the user's role on each pull.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### PUSH-100 — NO production code anywhere invokes the `send-push-notification` Edge Function (extends WEAK-014/WEAK-015 to a 3rd compounding bug)

- **Category:** PUSH  |  **Severity:** Critical  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-036 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass PUSH-100, first-pass WEAK-014, first-pass WEAK-015
- **Description:** A repo-wide grep for `functions.invoke("send-push-notification")` or `fetch(".../functions/v1/send-push-notification")` returns ZERO matches in production code. The EF header (`send-push-notification/index.ts:7-11`) claims "Invoked by: Workflow actions ... The notifications table INSERT trigger (via a Supabase webhook) ... Manual admin triggers from the desktop app". Each of these invocation paths is BROKEN: (1) The workflow `push_notification` action (workflow-execute/index.ts:307-316) is a STUB — it returns `{ output: { stub: true, target_role, title, provider: "fcm" }, auditNote: "STUB push_notification ..." }` without calling any EF. The TODO comment at line 308 says "Integrate FCM (Firebase Cloud Messaging) via service account" — never done. (2) There is NO database trigger on `notifications` INSERT that calls the EF — verified via `grep "trigger.*notifications|after insert on.*notifications" across migrations` returning only `notifications_touch_updated_at` (a metadata trigger, not a webhook). There is NO `pg_net` or `http_post` function in any migration. There is NO `supabase_functions.invoke` SQL function. (3) There is NO Supabase webhook configuration in any migration (web…
- **Location:** - `elimtiyaz-desktop/supabase/functions/workflow-execute/index.ts:307-316` (STUB push_notification action) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1060-1068` (non-existent push-homework-notification EF, swallowed error) - `elimtiyaz-website/supabase/functions/send-push-notification/index.ts:7-11` (false header comment about invocation paths) ;; [WEAK-014] `elimtiyaz-website/supabase/functions/send-push-notification/index.ts:208-219` ;; [WEAK-015] `elimtiyaz-website/supabase/functions/send-push-notification/index.ts:93-104`
- **Evidence:** Audit evidence (Confirmed — EXTENDS WEAK-014 + WEAK-015 by adding a THIRD compounding bug (no invocation path). The push notification system has THREE bugs that each independently make it non-functional.). Git: workflow-execute STUB in `b25e6ca` (2026-08-04). Desktop's push-homework-notification invoke in `94471e8` (2026-08-28). EF introduced in `e90dbf7 mid` (2026-08-01). None of these commits wired up a working invocation path.
- **Root cause:** The push notification feature was spec'd but only partially implemented. The EF was written (with two compounding bugs per WEAK-014/015). The workflow action was stubbed out as a TODO. The DB trigger / webhook was never configured. The desktop's manual trigger used a wrong EF name. The three layers were never integrated end-to-end.
- **Current behavior:** All three invocation paths are broken. The EF is dead code.
- **Expected behavior:** Workflow `push_notification` action should call the EF. Or a DB trigger on `notifications` INSERT should call the EF via a webhook. Or the desktop's manual triggers should call the correct EF name.
- **Proposed resolution:** Workflow `push_notification` action should call the EF. Or a DB trigger on `notifications` INSERT should call the EF via a webhook. Or the desktop's manual triggers should call the correct EF name.
- **Dependencies:** none recorded
- **Absorbed findings:** WEAK-014: The Edge Function looks up active device tokens with `.eq("user_profile_id", payload.target_user_id)` — but the canonical `device_tokens` table (created by desktop migration 0027_shared_unification.sql) uses the `user_id` column, NOT `user_profile_id`. The website's own migration 0025 (rewritten) explicitly documents this: *"The portal now registers tokens through the canonical `register_fcm_token(p_user_id, p_token, p_platform)` RPC (migration 0027) ... and reads/deactivates rows via the `user_id` column with the RLS policies installed by migration 0037."* The client-side `fcm-registration.ts` correctly uses `.eq("user_id", userProfileId)`, but the Edge Function uses the wrong column name. The query would fail with PostgREST 400 *"column user_profile_id does not exist"* → `error` is truthy → function returns HTTP 500 → NO push notification is ever sent. | WEAK-015: The `getFcmAccessToken()` function parses the Firebase service-account's `private_key` PEM by: (1) removing a literal `[REDACTED:ssh_private_key]` string (a redaction-tool artifact that never appears in real PEM keys), (2) removing `-----END PRIVATE KEY-----`, (3) removing all whitespace. Step (2) does NOT strip `-----BEGIN PRIVATE KEY-----`. After whitespace removal, the result starts with `-----BEGINPRIVATEKEY-----` followed by the actual base64 payload. `atob()` in Deno throws `InvalidCharacterError` on the dashes (`-` is not in the base64 alphabet). The OAuth2 token exchange never happens → `getFcmAccessToken` throws → the Edge Function returns HTTP 500 with `"FCM auth failed: ..."`.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### PUSH-101 — Android `ElImtiyazMessagingService.onMessageReceived` reads `data["type"]` and `data["priority"]` from the wrong field; AndroidManifest has NO deep-link intent filter for `click_action` URLs

- **Category:** PUSH  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, elimtiyaz-website
- **Platforms affected:** Android, Website
- **Task:** T-036 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass PUSH-101
- **Description:** Two compounding bugs in Android's push notification handling: (1) The EF (`send-push-notification/index.ts:254-290`) builds the FCM HTTP v1 message with `notification: { title, body }` (standard FCM notification payload), `android.notification.click_action = payload.data?.url ?? "/"` (a URL string, not an intent name), `android.notification.priority = "high"|"normal"`, and `data: payload.data ?? {}` (the caller-provided data field, which may or may not contain `priority`/`type`). The Android's `onMessageReceived` (ElImtiyazMessagingService.kt:41-71) reads `data["title"]`, `data["body"]`, `data["priority"]`, `data["type"]` — but the EF puts `title`/`body` in the `notification` field (NOT in `data`), and does NOT propagate `priority` to the `data` field (line 247 `priority = payload.priority ?? "high"` is a LOCAL variable in the EF, used to set `android.priority` and `android.notification.priority` but NOT added to `data`). Result: when the Android is in the FOREGROUND, `onMessageReceived` is called → `data["title"]` is null → falls back to `message.notification?.title` (correct) → `data["priority"]` is null → falls back to "medium" → channel is always CHANNEL_MEDIUM. When the Androi…
- **Location:** - `elimtiyaz-android/app/src/main/java/com/example/infrastructure/notifications/ElImtiyazMessagingService.kt:41-77` (onMessageReceived reads wrong fields) - `elimtiyaz-android/app/src/main/AndroidManifest.xml:40-43` (no deep-link intent filter) - `elimtiyaz-website/supabase/functions/send-push-notification/index.ts:254-290` (EF payload construction)
- **Evidence:** Audit evidence (Confirmed). Git: AndroidManifest.xml in `c207dca6` (2026-08-02, "mid") — never had a deep-link filter. ElImtiyazMessagingService.kt in `dd4c7dc kk` (2026-08-26). EF in `e90dbf7 mid` (2026-08-01). The payload-shape mismatch has been present since the EF's first commit.
- **Root cause:** (1) The EF author put `title`/`body` in the standard `notification` field (correct for FCM HTTP v1), but the Android author assumed they'd be in `data` (the legacy FCM legacy API put everything in `data`). They didn't coordinate on payload shape. (2) The Android author never added deep-link intent filters — probably because they didn't get to it, or because they assumed FCM would auto-open the launcher.
- **Current behavior:** (1) Android's `onMessageReceived` reads wrong fields → channel selection is always "medium" (foreground) or default (background). (2) No deep-link intent filter → tapping a notification opens the home screen, not the deep-linked view.
- **Expected behavior:** (1) The EF should add `priority` and `type` (or `link_entity_type`) to the `data` field (e.g., `data: { ...payload.data, priority, type: payload.category }`) so Android can route to the correct channel. (2) The AndroidManifest should declare deep-link intent filters matching the URLs the EF produces (e.g., for `click_action: "/finance"`, declare an intent filter for scheme `https`, host `portal.elimtiyaz.dz`, path `/finance`). Or, better, use FCM's `click_action` as an intent NAME (not a URL) and declare an intent filter for that name.
- **Proposed resolution:** (1) The EF should add `priority` and `type` (or `link_entity_type`) to the `data` field (e.g., `data: { ...payload.data, priority, type: payload.category }`) so Android can route to the correct channel. (2) The AndroidManifest should declare deep-link intent filters matching the URLs the EF produces (e.g., for `click_action: "/finance"`, declare an intent filter for scheme `https`, host `portal.elimtiyaz.dz`, path `/finance`). Or, better, use FCM's `click_action` as an intent NAME (not a URL) and declare an intent filter for that name.
- **Dependencies:** PUSH-100 (EF must be invoked at all before payload shape matters)
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### PUSH-102 — `register_fcm_token` SQL RPC has no inverse `unregister_fcm_token` RPC; the `ON CONFLICT (tenant_id, token) DO UPDATE` clause overwrites `user_id` on shared devices (extends SEC-106 + SYNC-104)

- **Category:** PUSH  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-030, 13th session; verified live — the earlier 0050 note claiming the overwrite was already blocked was INACCURATE: 0050 verified the CALLER's p_user_id but never touched register's ON CONFLICT branch): migration 0060 conflict-guard — same-user conflict reactivates; another user's ACTIVE row → RAISE 42501 (hijack dead); another user's INACTIVE row → explicit audited transfer. NEW `unregister_fcm_token(p_token)` (caller-verified, idempotent, audited). verify_t-030.sql 9/9 live. Website rotation-retire wired; Android covered server-side.
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-030 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass PUSH-102
- **Description:** The `register_fcm_token(p_user_id, p_token, p_platform)` SQL function (0027 line 344-384) upserts by `(tenant_id, token)` with `ON CONFLICT (tenant_id, token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, is_active = true, last_seen_at = now()`. There is NO `unregister_fcm_token` SQL RPC in any migration (verified via `grep "unregister_fcm_token\|FUNCTION.*unregister" across migrations`). The ONLY way to set `device_tokens.is_active = false` server-side is (a) the EF's auto-deactivation when FCM returns UNREGISTERED (send-push-notification/index.ts:306-311 — never fires because the EF is never invoked per PUSH-100), (b) direct SQL UPDATE by an admin, OR (c) the website's `unregisterDeviceToken` (fcm-registration.ts:65-79) — but this is a direct PostgREST UPDATE, not an RPC, and it filters by `platform='web'` so it doesn't touch Android tokens. Two compounding issues follow from the ON CONFLICT semantics: (1) When a shared Android device is signed into by user A then signed into by user B (without signOut unregistering per SYNC-104), the SECOND register call hits the conflict on `(tenant_id, T1)` and OVERWRITES the row to `user_id = B`. Now user A's notific…
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:344-384` (register_fcm_token — no inverse RPC exists) - `elimtiyaz-website/src/lib/hooks/fcm-registration.ts:65-79` (only `platform='web'` unregister via direct PostgREST UPDATE)
- **Evidence:** Audit evidence (Confirmed — EXTENDS SEC-106 (which documented that the RPC accepts any p_user_id without verification) and SYNC-104 (which documented that Android doesn't unregister on signOut) by tracing the actual user-facing data flow on shared devices (the silent user_id overwrite cuts off the previous user's notifications).). Git: Migration 0027 in `9e1e7741` (2026-08-12, "kay"). The unregister RPC has never existed.
- **Root cause:** The author wrote the register RPC with the assumption that "registering = upsert" — they didn't consider the un-register use case. The ON CONFLICT overwrite of user_id was intended to handle token reuse on shared devices (the new owner should get the notifications, not the old owner) — but this is silent and surprising.
- **Current behavior:** No unregister RPC exists. The ON CONFLICT clause silently transfers token ownership on shared devices.
- **Expected behavior:** An `unregister_fcm_token(p_token)` or `unregister_fcm_token(p_user_id, p_platform)` RPC should exist, callable by the client on signOut. It would set `is_active = false` for the matching row(s). The `register_fcm_token` RPC's ON CONFLICT clause should NOT overwrite `user_id` without auth verification (an authenticated user B shouldn't be able to claim a token that previously belonged to user A).
- **Proposed resolution:** An `unregister_fcm_token(p_token)` or `unregister_fcm_token(p_user_id, p_platform)` RPC should exist, callable by the client on signOut. It would set `is_active = false` for the matching row(s). The `register_fcm_token` RPC's ON CONFLICT clause should NOT overwrite `user_id` without auth verification (an authenticated user B shouldn't be able to claim a token that previously belonged to user A).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### PUSH-103 — Website's FCM token registration is OPT-IN only (Profile view manual toggle); no auto-registration on sign-in; most users never enable push

- **Category:** PUSH  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-036, 13th session — the unblocked portion of the task): `autoRegisterFcmAfterFirstGesture` (fcm-registration.ts) waits for the FIRST pointerdown/keydown after the profile is available — permission already granted → register immediately (no prompt; covers returning users whose row was deactivated on sign-out); default → `requestPermission()` FROM the gesture handler (browser-legal) and register only if granted; denied → never. ONE attempt per browser profile (localStorage `el-imtiyaz.fcm-autoreg` — a dismissed prompt must not nag; Chrome auto-blocks repeat prompts anyway). The auth-provider re-wires the listener on profile change. The Profile toggle remains the explicit re-enable path, unaffected. 9 new tests (t-036-fcm-auto-register.test.ts). Gap: live push delivery still needs the owner's FCM web config (env gap in credentials.md) AND a real invocation path for the send-push-notification EF (PUSH-100 — still open).
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-036 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass PUSH-103
- **Description:** The website's only path to register an FCM device token is the manual toggle in `ProfileView` (`profile-view.tsx:114-132`). When the user clicks the push switch to ON, `togglePush(true)` calls `registerDeviceToken(user.id)` which calls `initFcm()` (requests browser permission, gets FCM token, registers via the `register_fcm_token` RPC). When the user clicks OFF, `togglePush(false)` calls `unregisterDeviceToken(user.id)`. There is NO auto-registration on sign-in (`auth-provider.tsx:242-262` signInWithGoogle → no registerDeviceToken call; `auth-provider.tsx:209-240` useEffect on auth state change → no registerDeviceToken call). The `pushEnabled` state (line 79-83) is initialized from `Notification.permission === "granted"` — but this only reflects the browser permission, not the server-side device_tokens row. If a user grants browser permission but never toggles push in the Profile view (or never visits the Profile view at all), the server has no FCM token for them → no pushes can be sent to them. Conversely, if a user revokes browser permission via browser settings, the toggle UI still shows ON (because pushEnabled only updates from the toggle handler) — but the server still has the…
- **Location:** - `elimtiyaz-website/src/features/profile/profile-view.tsx:75-132` (the ONLY call to registerDeviceToken) - `elimtiyaz-website/src/app/providers/auth-provider.tsx:209-240, 242-262` (signInWithGoogle + onAuthStateChange — no FCM register call)
- **Evidence:** Audit evidence (Confirmed). Git: profile-view.tsx in `e90dbf7 mid` (2026-08-01). auth-provider.tsx in `03f6365 vitest 87/87` (2026-08-28). The opt-in pattern has been there since first commit.
- **Root cause:** Browsers require EXPLICIT user gesture to request notification permission — `Notification.requestPermission()` must be called from a user-initiated event (click/tap). The auto-registration on sign-in can't request permission without a user gesture. So the author put it behind a manual toggle. The proper pattern is: (a) on sign-in, ATTEMPT to register (call `initFcm()` which checks permission — if not granted, return null silently), (b) on a separate Profile view toggle, request permission via a user gesture. The website's current pattern doesn't even attempt (a).
- **Current behavior:** Auto-registration never happens. The user must manually opt-in via the Profile view. Most users never discover this toggle.
- **Expected behavior:** On successful sign-in, the website should auto-request FCM permission + register the device token. The user shouldn't have to find a hidden toggle in the Profile view to enable notifications.
- **Proposed resolution:** On successful sign-in, the website should auto-request FCM permission + register the device token. The user shouldn't have to find a hidden toggle in the Profile view to enable notifications.
- **Dependencies:** PUSH-100
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### PUSH-104 — Workflow `send_email` action is a STUB; only `approve-signup-request` EF actually sends email (conditional on RESEND_API_KEY secret); all workflow-driven transactional emails NEVER send

- **Category:** PUSH  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-036 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass PUSH-104
- **Description:** Two paths for sending email in the codebase, both broken: (1) The `workflow-execute` EF's `send_email` action (line 275-285) is a STUB — the TODO at line 276 says "Integrate Resend API", the code returns `{ output: { stub: true, to, subject, provider: "resend" }, auditNote: "STUB send_email to=..." }`. The actual Resend API call (line 278 `// await fetch("https://api.resend.com/emails", { ... })`) is COMMENTED OUT. No workflow that includes a `send_email` node actually sends an email — the audit log shows "STUB send_email" and the workflow continues. (2) The `approve-signup-request` EF (line 268-294) DOES attempt to send a confirmation email via Resend — BUT only if `Deno.env.get("RESEND_API_KEY")` is set (line 269). If the secret is not set (likely in dev/staging), the email is silently skipped. If the secret IS set, the email send is wrapped in try/catch with errors swallowed (line 291-293 `console.warn("[approve-signup] Failed to send confirmation email:", emailError)`). The Resend API's response status is NOT checked (line 273-290 — `await fetch(...)` is called but the `resp.ok` is never verified). If Resend returns 4xx (e.g., unverified domain, invalid API key), the email send…
- **Location:** - `elimtiyaz-desktop/supabase/functions/workflow-execute/index.ts:275-285` (STUB send_email action) - `elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts:268-294` (Resend integration — conditional + error swallowed + hardcoded URL)
- **Evidence:** Audit evidence (Confirmed Stage Summary: - Total new findings: 17 (CHAT-100, CHAT-101, CHAT-102, CHAT-103, CHAT-104, CHAT-105, NOTIF-100, NOTIF-101, NOTIF-102, NOTIF-103, NOTIF-104, NOTIF-105, PUSH-100, PUSH-101, PUSH-102, PUSH-103, PUSH-104) - Severity breakdown: - Critical: 5 (CHAT-103 no production code creates chat_channels, NOTIF-100 role-broadcasts can't be marked read, NOTIF-101 notification injection allowed, NOTIF-104 Android read state reverts every 15min, PUSH-100 no code invokes send-push-notification EF) - High: 8 (CHAT-100 chat_channels_insert RLS allows arbitrary member_ids, CHAT-101 chat_messages_insert RLS has no channel-membership check, CHAT-102 chat_messages_update RLS root cause of REALTIME-101, CHAT-105 desktop chat is mock-only, NOTIF-102 desktop bell caps at 8, NOTIF-105 Android stale role-broadcasts persist, PUSH-101 Android reads wrong fields + no intent filter, PUSH-104 workflow send_email is STUB) - Medium: 4 (CHAT-104 channel list stale ordering, NOTIF-103 website dead query + cap, PUSH-102 no inverse RPC + overwrite semantics, PUSH-103 website opt-in only FCM) - Low: 0 - Top 5 critical findings (one-line each): 1. **CHAT-103**: NO production code anywhere creates `cha…). Git: workflow-execute STUB in `b25e6ca` (2026-08-04). approve-signup-request Resend integration in same commit. Both have been broken since first commit.
- **Root cause:** Same as PUSH-100 — the email feature was spec'd but only partially implemented. The workflow action was stubbed as a TODO. The signup-approval email was added as a "best effort" with silent failure modes. The two layers were never integrated end-to-end.
- **Current behavior:** Workflow emails NEVER send (stub). The signup-approval email MAY send (conditional on RESEND_API_KEY + Resend's success), with no verification.
- **Expected behavior:** Workflow `send_email` should integrate Resend (or another email provider) to send transactional emails triggered by workflow events (overdue payments, absences, grade postings, etc.). The approve-signup-request email should be sent reliably and the response status verified.
- **Proposed resolution:** Workflow `send_email` should integrate Resend (or another email provider) to send transactional emails triggered by workflow events (overdue payments, absences, grade postings, etc.). The approve-signup-request email should be sent reliably and the response status verified.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Architecture & Boundaries

### ARCH-001 — Massive partial migration: 25+ repositories still mock-backed in "Supabase mode"

- **Category:** ARCH  |  **Severity:** Critical  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-047 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass ARCH-001
- **Description:** `supabase-repositories.ts:79-172` (`getSupabaseRepositories()`) builds a `Repositories` object by spreading `mockRepositories` and overriding only ~19 of the ~45 repository slots with Supabase-backed implementations. The remaining ~26 repositories (clubs, psychology, orthophonie, teachers, expenses, releve, pricing, workflows, workflowRuns, aiConfig, backups, shifts, schedules, tasks, workforceAttendance, leaveRequests, performanceReviews, chat, onboarding, suppliers, purchaseRequests, deliveries, inventory, warehouseTasks, calendar, overdueAlerts) still use mock implementations. A user who enables "Supabase mode" expects production persistence, but their clubs, expenses, teachers, workflows, backups, calendar, personnel tasks, chat, leave requests, performance reviews, onboarding, suppliers, purchase requests, deliveries, inventory, and warehouse tasks are still in-memory only — lost on app restart.
- **Location:** `elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts:79-172`
- **Evidence:** Audit evidence (Confirmed). Git: `supabase-repositories.ts` last modified in `84dd13f` (2026-08-27). The file accumulates incremental port-ins (latest adds academic + audit + notifications + personnel + departments).
- **Root cause:** The Supabase migration was done repository-by-repository. The financial + CRM + academic core was ported first; the workforce/operations/club/therapy/workflow repositories were never finished. The "incremental migration" plan in the file header was abandoned.
- **Current behavior:** Desktop "Supabase mode" vs Android: workflows, expenses, clubs, etc. persist on Android, vanish on desktop restart. Desktop "Supabase mode" vs mock mode: no difference for the 26 unported repositories — both are in-memory.
- **Expected behavior:** The mock implementations under `src/infrastructure/mock/repositories/*` are complete and feature-rich; the Supabase-backed ones are partial.
- **Proposed resolution:** Port the remaining mock-backed repositories (workforce, operations, clubs, therapy, workflows, chat, ...) to Supabase one module at a time, or explicitly mark them mock-only in the UI. Highest priority: anything users can write to believing it persists. Each port follows ADR-002 boundaries and adds persistence tests.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ARCH-002 — Electron main process registered with `--no-sandbox` in the start script

- **Category:** ARCH  |  **Severity:** Medium  |  **Status:** IMPLEMENTED (2026-08-29, task T-010 — launch verification pending)
- **Status note:** `--no-sandbox` removed from package.json start script; host requirement (chrome-sandbox SUID helper or kernel.unprivileged_userns_clone) documented in electron/main.ts with an explicit 'fix the host, not the flag' instruction. NOT yet TESTED/VERIFIED: launching the app with the sandbox enabled requires a desktop host (headless container cannot run Electron — AGENTS.md §11 forbids it). Advance to TESTED once a launch log exists. Evidence: change-log 2026-08-29 / hub commit af655b1.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-010 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass ARCH-002
- **Description:** The `package.json` start script (`npm start`) runs `electron . --no-sandbox`. The `--no-sandbox` flag disables Chromium's sandbox, which is a security mitigation against renderer-process exploits. The electron main.ts comment claims "contextIsolation: true + nodeIntegration: false (renderer never touches Node directly)" — but with the sandbox disabled, a renderer compromise (e.g., XSS via a malicious Excel file content or a malicious AI response rendered without sanitization) can escape into the renderer process and potentially reach Node APIs through the preload bridge or through Electron's internal IPC.
- **Location:** `elimtiyaz-desktop/package.json:22`
- **Evidence:** Audit evidence (Confirmed). Git: `package.json` last modified in `b5a84cd` (2026-08-26 "kay"). The `--no-sandbox` flag has been there since the Electron integration.
- **Root cause:** The `--no-sandbox` flag is often needed on Linux when running as root or in containers without SUID helper. The developer added it to make `npm start` work in their dev environment; it leaked into the production start script.
- **Current behavior:** With sandbox enabled, a renderer exploit is contained. Without sandbox, a renderer exploit can reach Node APIs.
- **Expected behavior:** N/A
- **Proposed resolution:** Remove --no-sandbox from the start script; fix the underlying environment issue ( Electron sandbox requires kernel flags on some hosts - document them) instead of disabling the sandbox. Verify app launches with sandbox enabled.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ARCH-003 — `RepositoryModule` binds ALL repositories to `Local*Repository` (Room-first) — canonical Supabase RPCs (`collect_payment`, `refund-payment`, `bind-activation-code`, `run-overdue-scan`, `refresh-materialized-views`, `update-server-secret`) are NEVER called from Android

- **Category:** ARCH  |  **Severity:** High  |  **Status:** BLOCKED
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Backend/DB
- **Task:** T-059 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass ARCH-003
- **Description:** `RepositoryModule.kt` has 25 `@Binds` declarations, every one binding a domain repository interface to a `Local*Repository` implementation (e.g. `bindPaymentRepository(impl: LocalPaymentRepository): PaymentRepository`). There is NO `Supabase*Repository` implementation on Android — the desktop's `SupabasePaymentRepository`, `SupabaseParentRepository`, etc. have NO Android counterparts. The Supabase SDK is wired only for: (1) Auth (`LocalAuthRepository` calls Supabase Auth when configured); (2) FCM token registration (`FcmTokenRegistrar.register` calls `register_fcm_token` RPC); (3) Pull sync (`PullSyncRepository` calls `pull_*_for_sync` RPCs); (4) Sync push dispatcher (`SyncQueueDispatcher.pushXxx` calls `upsert_*_from_import` RPCs); (5) Workflow retry (`LocalWorkflowRepository.retryRun` calls `workflow-execute` Edge Function).
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/di/RepositoryModule.kt:71-99`
- **Evidence:** Audit evidence (Confirmed). Git: `RepositoryModule.kt` last touched in `dd4c7dc` "kk" (2026-08-26)
- **Root cause:** Android was designed offline-first from day one. Rather than implement a Supabase-backed repository alongside the Local one and switch at runtime (like the desktop), the Android team wrote only the Local repository and used the sync queue to propagate writes. The canonical RPCs' invariants are bypassed.
- **Current behavior:** Desktop: `collect_payment` Edge Function (atomic, server-side validation, server-side receipt). Android: `upsert_payment_from_import` (non-atomic, no server-side validation, local receipt). Different invariants enforced.
- **Expected behavior:** Desktop's `repository-mode.ts` switches between `Mock*Repository` and `Supabase*Repository` based on config (per desktop ARCH-001/DRIFT-003 findings). Android has only `Local*Repository` — no mode switching, no Supabase implementation.
- **Proposed resolution:** Desktop's `repository-mode.ts` switches between `Mock*Repository` and `Supabase*Repository` based on config (per desktop ARCH-001/DRIFT-003 findings). Android has only `Local*Repository` — no mode switching, no Supabase implementation.
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-002 / ADR-005 (Android target write architecture). Remediation direction accepted at ADR level but not implemented; do NOT partially rewire bindings before ADR-005 is confirmed.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ARCH-004 — `fallbackToDestructiveMigration(true)` on production Room database — user data silently wiped on any future schema bump

- **Category:** ARCH  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Backend/DB
- **Task:** T-046 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass ARCH-004
- **Description:** `DatabaseModule.provideDatabase` calls `.fallbackToDestructiveMigration(true)` on the Room database builder. The comment admits: "Production deployments should add explicit migrations for every schema bump." But the build is `versionCode = 2`, `versionName = "2.0.0"` — this IS shipping to production (release build type with a real signing config). The database is at version 11 with 8 explicit migrations (3→4 through 10→11) — but any FUTURE schema bump that doesn't have an explicit migration will WIPE ALL local data (parents, students, payments, ledger_entries, installments, audit_logs, sync_queue — everything).
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/di/DatabaseModule.kt:90-95`
- **Evidence:** Audit evidence (Confirmed). Git: `DatabaseModule.kt` last touched in `dd4c7dc` "kk" (2026-08-26); `app/build.gradle.kts:28-29` shows `versionCode = 2, versionName = "2.0.0"` with a `release` build type and signing config
- **Root cause:** During development, `fallbackToDestructiveMigration` is convenient — schema changes don't require writing migrations. The developer left it on for the release build "in case a migration is missing" — accepting data loss as a fallback. The 8 explicit migrations cover v3→v11 (the versions where the schema was iterated during development), but any future v11→v12+ without an explicit migration triggers destruction.
- **Current behavior:** If a developer adds a column to an entity, forgets to add a `MIGRATION_11_12`, and ships — every Android user's local data is wiped on app update. They lose all pending sync queue entries → offline writes that never pushed to Supabase are LOST forever.
- **Expected behavior:** N/A — Android only
- **Proposed resolution:** N/A — Android only
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### ARCH-005 — `next.config.ts` has `typescript.ignoreBuildErrors: true` AND `reactStrictMode: false` — type errors silently shipped to production, React strict-mode bugs hidden

- **Category:** ARCH  |  **Severity:** Medium  |  **Status:** TESTED (2026-08-29)
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-049 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass ARCH-005
- **Description:** The Next.js config sets `typescript.ignoreBuildErrors: true` (line 6) which means `next build` will SUCCEED even if `tsc` reports type errors. Combined with `reactStrictMode: false` (line 8), the portal ships to production with: (a) no compile-time type safety guarantee; (b) React's strict-mode development checks (which surface double-render bugs, missing cleanup, etc.) disabled. The README claims the portal is production-ready with zero TypeScript errors, but the build config means type errors wouldn't be caught even if they existed.
- **Location:** `elimtiyaz-website/next.config.ts:5-8`
- **Evidence:** Audit evidence (Confirmed). Git: next.config.ts introduced in commit `aebc58d` "first commit" (2026-07-31). Never modified.
- **Root cause:** The author set `ignoreBuildErrors: true` to unblock a build that had type errors (rather than fixing the errors). `reactStrictMode: false` was likely set to suppress double-render warnings during development. Both are anti-patterns that ship to production.
- **Current behavior:** With `ignoreBuildErrors: false` (the default): `next build` fails on type errors. With `ignoreBuildErrors: true`: build succeeds silently. With `reactStrictMode: true` (the default): React double-invokes render/effects in dev to surface bugs. With `false`: bugs that would be caught by strict mode (e.g., useEffect with missing cleanup, side effects in render) are hidden.
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.
- **Status note (2026-08-29, T-049):** RESOLVED — `ignoreBuildErrors: false` + `reactStrictMode: true`; all 86 surfaced errors fixed. The deep root cause: postgrest-js 2.x `GenericTable`/`GenericView` require `Relationships` AND an index-signature-compatible Row; the hand-written Database used `interface` row types (no implicit index signatures) and omitted `Relationships`, so `Database['public']` never satisfied `GenericSchema`, `Schema` resolved to `never`, and EVERY typed supabase query silently degraded to never payloads — the entire typed-client layer was decorative. Fixed by converting the 38 row interfaces to type aliases (what `supabase gen types` emits) and adding `Relationships: []` to the 34 tables + 4 views; the canonical `homework` table was also missing from the Tables map (WEAK-017). First strict build: `next build` runs TypeScript and is GREEN; suite 90/90; lint baseline unchanged. LESSON: `ignoreBuildErrors: true` had hidden not just type errors but the fact that the whole typed-client layer did not typecheck — enabling strict checks first, THEN fixing, is the only order that exposes this class of defect.

---

### DRIFT-001 — Mock parent repository uses `Math.random()` for `parent_code`, violating canonical §7.1

- **Category:** DRIFT  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-018 (docs/recovery/task-registry.md)
- **Status note:** PARTIAL 2026-08-31 (T-018, 12th session — desktop + sync): the canonical generators moved to core/format/id.ts (ADR-003 home) with the empty-identity fallback made retry-STABLE (seeded, never random — a random retry suffix created server-side duplicates since the dedup match IS the code); the sync push handler's random PAR-/ELV- fallbacks replaced with the seeded canonical generators. 7-test suite. REMAINING on DRIFT-001: the backend generators (approve EF, batch_register_family RPC — needs a migration) + the Android paths (toolchain-gated); the mock's create() random suffix intentionally preserved (mirrors the canonical server CREATE path, migration 0022 gen_random_bytes).
- **Consolidated from:** first-pass DRIFT-001, first-pass DEAD-001, first-pass DEAD-003, first-pass DEAD-005, first-pass DEAD-006, second-pass PARENT-100
- **Description:** `CANONICAL-FINANCIAL-LOGIC.md §7.1` mandates that `parent_code` MUST be deterministic — derived from a FNV-1a hash of `(firstName, lastName, primaryPhone, year)`, formatted `PAR-{year}-{4-char-hash}`. The Supabase-backed parent repository correctly calls `deterministicParentCode()`. The MOCK parent repository still calls `randomParentSuffix()` which uses `Math.random()` to produce a 4-char suffix. This means the same parent input produces DIFFERENT parent codes on each create call in mock mode — breaking idempotency in dev/test. The two repositories (mock + Supabase) diverge on a canonical rule.
- **Location:** `elimtiyaz-desktop/src/infrastructure/mock/repositories/parent-repository.ts:61` (consumer) and `elimtiyaz-desktop/src/core/format/id.ts:34-42` (definition) ;; [DEAD-001] `elimtiyaz-desktop/src/core/format/id.ts:45-47` ;; [DEAD-003] `elimtiyaz-desktop/supabase/migrations/0036_tier4_backend_hardening.sql:18-23` (comment) + the `batch_register_family` function in 0022_functions.sql ;; [DEAD-005] `elimtiyaz-android/app/src/main/java/com/example/core/IdentityCodes.kt:107-125` (definition) + `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:497-498, 604-605` (call sites that should use it but don't) ;; [DEAD-006] `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:393-410` (helpers) + lines 147, 175, 209 (call sites) ;; [PARENT-100] `elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts:157`. Canonical reference: `elimtiyaz-desktop/src/core/format/id.ts:24-42` (`deterministicParentCode`); `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:489` (uses deterministicParentCode).
- **Evidence:** Audit evidence (Confirmed). Git: `src/core/format/id.ts` last modified in `84dd13f` (2026-08-27 "okay") — `deterministicActivationCode` was added but `randomParentSuffix` left in place. `mock/parent-repository.ts:61` last modified in `0f442a1` (2026-08-23 "mid") — never updated to use deterministic codes.
- **Root cause:** The canonical rule was added late (the supabase path got the fix in vault §02.08 verification, see `vault-compliance-verification-3.md`), but the mock path was never updated. The mock repo and the Supabase repo drift independently.
- **Current behavior:** Mock mode → random codes, no idempotency. Supabase mode → deterministic FNV-1a codes, idempotent. Re-importing the same Excel row in mock mode creates duplicates; in Supabase mode it correctly upserts.
- **Expected behavior:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:197-216` `deterministicParentCode(year, input)` — FNV-1a hash of trimmed non-empty identity fields joined by `|`.
- **Proposed resolution:** Replace every random/sequential identity-code generator with the canonical deterministic functions: mock parent-repository -> deterministicParentCode; approve-signup-request EF -> deterministicParentCode or upsert_parent_from_import; SyncQueueDispatcher fallbacks -> IdentityCodes.kt deterministic functions; Android createStudent/batchRegister -> deterministicStudentCode; delete dead random exports (activationCode, randomParentSuffix) or the batch_register_family random branch. Verify via existing IdentityCodes tests + cross-platform parent-code equivalence.
- **Dependencies:** none recorded
- **Absorbed findings:** DEAD-001: `src/core/format/id.ts:45-47` exports `activationCode()` which uses `Math.random()` to produce a 6-7 digit numeric code. The canonical spec §7.1 mandates that activation codes MUST also be deterministic — `deterministicActivationCode(parentCode, tenantId)` (FNV-1a over `tenantId|parentCode`, mapped to 6-digit range). The random version is no longer called by any production code (only imported as alias `randomActivationCode` in a single test that does string-snippet inspection, not actual generation). | DEAD-003: Migration 0036 (`0036_tier4_backend_hardening.sql`) finding #3 documents that the `batch_register_family` SQL RPC uses `gen_random_bytes(3)` to generate parent_code — violating canonical §7.1 which mandates the deterministic FNV-1a hash via the application layer. Migration 0036 only added a COMMENT warning ("Both apps now use the deterministic generator; this RPC remains as a backend fallback only") — it did NOT fix the function. The RPC remains callable and still produces random parent_codes. Any caller that invokes `batch_register_family` directly (bypassing the app layer) gets non-canonical codes that break idempotent upserts. | DEAD-005: `IdentityCodes.kt` defines `deterministicStudentCode(year, parentId, input)` which derives a student code from a stable FNV-1a hash of `(parentId, displayName, firstName, lastName)` — the canonical idempotency rule. But `LocalStudentRepository.createStudent` (line 497-498) generates the student code as `"ELV-$year-$seq"` where `seq = (studentDao.countActive() + 1).toString().padStart(6, '0')` — sequential numbering. Same for `batchRegister` (line 604). `deterministicStudentCode` is NEVER called anywhere in the production code (only in tests). | DEAD-006: `SyncQueueDispatcher` defines three private helpers — `generateParentCode()`, `generateStudentCode()`, `generatePaymentNumber()` — that generate codes via `chars.random()` and `(1..1_000_000).random()`. These are used as FALLBACKS when a sync payload lacks a code (e.g. `pushParent` line 147: `p.str("code") ?: p.str("parent_code") ?: generateParentCode()`). They bypass the canonical `deterministicParentCode` / `deterministicStudentCode` functions in `IdentityCodes.kt`. | PARENT-100: The `approve-signup-request` Edge Function (line 157) generates the parent_code for newly-created parents via `Math.random().toString(36).slice(2, 6).toUpperCase()` — a 4-character random alphanumeric. This VIOLATES the canonical rule §7.1 (deterministic FNV-1a hash of identity fields, see `deterministicParentCode` at `src/core/format/id.ts:24-42`). The desktop's `SupabaseParentRepository.createParent` uses the deterministic version. The EF uses the random version. The two paths produce DIFFERENT parent codes for the same parent identity.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DRIFT-003 — Repository selection happens at module load; config changes require app restart

- **Category:** DRIFT  |  **Severity:** Medium  |  **Status:** DEFERRED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop, Website
- **Task:** T-077 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DRIFT-003
- **Description:** `src/app/providers/repository-provider.tsx:230` computes `const defaultRepositories = selectDefaultRepositories();` at MODULE LOAD time. The function reads `useSupabase && isSupabaseConfigured()` which in turn reads `localStorage` synchronously. If the user opens Settings → Configuration and changes the Supabase URL/key, the change is persisted to `localStorage` but the React context's `defaultRepositories` is already bound to the previous value. The comment in `supabase-client.ts:40-42` confirms: "The Configuration tab will restart the app after saving new settings, so the next render picks up the new values." This is an architectural choice — no reactive repository swap.
- **Location:** `elimtiyaz-desktop/src/app/providers/repository-provider.tsx:230`
- **Evidence:** Audit evidence (Confirmed). Git: `repository-provider.tsx` last modified in `b5a84cd` (2026-08-26 "kay"). The `selectDefaultRepositories()` + module-level binding has been there since the file was created.
- **Root cause:** The Supabase client is a singleton (`let _client: SupabaseClient | null = null` in `supabase-client.ts:86`); re-initializing it requires clearing the singleton, which would invalidate all in-flight requests. The module-load pattern avoids this complexity but at the cost of requiring a restart.
- **Current behavior:** If a user toggles Supabase on in Settings, they must restart the app for it to take effect. If they toggle it off, same thing. The configuration UI claims the change is "saved" but nothing changes until restart.
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Status note:** Documented architectural choice (restart required after config change). The new AGENTS.md records this behaviour; revisit only if reactive config switching becomes a requirement.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DRIFT-005 — `update-server-secret` uses audit action `server_secret.update`/`.delete` not in canonical `AuditActions` registry

- **Category:** DRIFT  |  **Severity:** Low  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-056.3, hub commit e412e44): ServerSecretUpdate/ServerSecretDelete registered in the canonical AuditActions; the EF imports the registry (relative import verified in the esbuild bundle) — no ad-hoc literal survives (source scan).
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-056 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DRIFT-005
- **Description:** The `update-server-secret` Edge Function writes audit logs with action strings `"server_secret.update"` and `"server_secret.delete"`. The canonical `AuditActions` registry in `src/core/audit-actions.ts` does NOT include these actions — it has `auth.*`, `parent.*`, `student.*`, `payment.*`, `class.*`, etc., but no `server_secret.*` entry. The audit actions are ad-hoc strings invented by the edge function. The canonical spec §7.6 says audit entries capture `{action, entityType, entityId, actorId, ...}` — the action should be from a stable wire-protocol registry. Ad-hoc actions break the audit log filter UI (which expects known action prefixes).
- **Location:** `elimtiyaz-desktop/supabase/functions/update-server-secret/index.ts:171-181` and `:233-244`
- **Evidence:** Audit evidence (Confirmed). Git: `audit-actions.ts` last modified long before the edge function was added. The edge function was created without updating the registry.
- **Root cause:** The edge function was written independently of the desktop's audit-actions registry. The author didn't know the registry existed or didn't think to update it.
- **Current behavior:** Filter UI may not recognize the `server_secret.*` prefix; the actions appear in the "Other" bucket or not at all.
- **Expected behavior:** The `AuditActions` registry at `src/core/audit-actions.ts:9-133`.
- **Proposed resolution:** The `AuditActions` registry at `src/core/audit-actions.ts:9-133`.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DRIFT-006 — Multiple iterations of "canonical overdue" rule across desktop engine, SQL function, and equivalence framework

- **Category:** DRIFT  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** RESOLVED 2026-08-31 (T-026, 13th session): Android now runs the SAME canonical INV-4 overdue rule as the desktop (due-date map + per-account balance replay); the remaining SQL-function iteration is the documented server-side equivalent, not a divergence. Pinned by the OverdueRuleT026Test INV-4-consistency case.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-026 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DRIFT-006
- **Description:** The canonical overdue rule (INV-4) is `account is overdue iff (balance > 0.001 DZD) AND (latestCharge.at < now) AND (overdueDueDate[accountId] < now)`. This rule has been re-implemented and re-aligned at least 4 times: (1) Desktop `computeParentSummary` in `domain/calc/ledger/balance.ts:182-187` uses `balance > 0.001 && dueDate && dueDate.getTime() < now.getTime()` where `dueDate` comes from `buildOverdueDueDateMap` (MAX of charge `at`); (2) SQL `compute_parent_summary` (migration 0042) was REWRITTEN to mirror the desktop rule — previously it used `installment.due_date` JOIN + `at <= p_as_of` filter, diverging from the desktop; (3) The cross-platform equivalence framework (Tier 4) flagged 13 scenarios where the SQL and desktop diverged (A-0042-OVERDUE); (4) Migration 0042's comment says "INV-10 names the desktop implementation the single source of truth for the parent summary" — meaning the desktop is canonical, the SQL must mirror.
- **Location:** `elimtiyaz-desktop/src/domain/calc/ledger/balance.ts:182-187` + `elimtiyaz-desktop/supabase/migrations/0042_canonical_overdue_asof_equivalence.sql:7-19`
- **Evidence:** Audit evidence (Confirmed). Git: Migration 0042 introduced in `2e2b21a` (2026-08-28 — the latest commit). The header explicitly documents the 13 failing equivalence scenarios.
- **Root cause:** The overdue rule was implemented independently in 3 places (desktop TS, SQL, Android Kotlin). Each implementation made different assumptions. The cross-platform equivalence framework caught the divergence; migration 0042 aligned the SQL with the desktop. Android remains misaligned.
- **Current behavior:** Pre-migration 0042: SQL classified overdue using installment due_date JOIN + as-of filter; desktop used MAX(charge.at) with no as-of filter; Android used a 1000× larger threshold. Post-migration 0042: SQL mirrors desktop. Android still uses the wrong threshold.
- **Expected behavior:** Desktop `computeParentSummary` is canonical (per INV-10, named in migration 0042's header).
- **Proposed resolution:** Desktop `computeParentSummary` is canonical (per INV-10, named in migration 0042's header).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DRIFT-007 — `SupabaseModule.kt` comment is outdated — claims "future remote sync can push local Room writes to Supabase by swapping @Binds" but SyncSupport already does the push

- **Category:** DRIFT  |  **Severity:** Low  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-062, 13th session): the SupabaseModule KDoc now describes the REAL wiring (SyncSupport.enqueueOnly + SyncQueueDispatcher's canonical RPCs; PullSyncRepository pulls back); the "swap @Binds" promise removed. Pinned by DeadCodeT062Test.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-062 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DRIFT-007
- **Description:** The class-level KDoc on `SupabaseModule.kt` says: "Future remote sync can push local Room writes to Supabase by swapping the `@Binds` declarations in `RepositoryModule.kt`." But the sync push is ALREADY wired: `LocalPaymentRepository`, `LocalStudentRepository`, `LocalInstallmentRepository`, `LocalLedgerRepository`, `LocalGradeRepository`, `LocalAttendanceRepository`, `LocalHomeworkRepository` all inject `SyncSupport` and call `enqueueOnly(...)` to push to Supabase via `SyncQueueDispatcher`. No `@Binds` swap is needed.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/di/SupabaseModule.kt:13-33`
- **Evidence:** Audit evidence (Confirmed). Git: `SupabaseModule.kt` last touched in `176f5d2` "mid" (2026-08-21) — likely hasn't been updated since the SyncSupport wiring was added in TIER 4
- **Root cause:** The KDoc was written when sync wasn't yet wired (the original "Future remote sync" plan was to swap @Binds to a Supabase*Repository). When SyncSupport was added later (per the canonical §8.1 pattern in the inline comments at LocalRepositories.kt:470, 916-919, 1221-1223, 1383-1385), the SupabaseModule's KDoc was never updated.
- **Current behavior:** N/A — comment drift
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

- **Resolution (2026-08-29, T-065 — TESTED):** the misleading comment is corrected to the code's true semantics (latest 500 rows TOTAL via RLS-exposed channels; the count is a LOWER BOUND when volume exceeds the window; exact counting deliberately deferred to the chat rework T-032 while chat has no production writers — CHAT-103 / UNKNOWN-005). The QUERY itself is unchanged by design: a channel-scoped or server-side count belongs to T-032's scope. A source-scan regression test (`comment-accuracy.test.ts`) pins the stale phrase out and the accuracy note in. Evidence: website commit `5654074`; hub change-log sixth session.

---

### DRIFT-009 — Canonical engine port ships ~20 calc files but only ~6 functions are used; `canonical/index.ts` barrel is never imported

- **Category:** DRIFT  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Desktop, Website
- **Task:** T-057 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-057, 12th session, website commit d7eb52e): the port pruned to the consumed surface (15 files deleted; 11 kept — including account-id.ts, a consumer the audit missed: portal-derive.test exercises deriveAccountId). model re-export blocks trimmed; every kept header now states the verbatim-port source + sha + never-re-add note instead of the DEAD-011 lie (port-canonical.mjs never existed). t-057-port-honesty.test.ts 4/4 pins the surface; site suite 130/130.
- **Consolidated from:** first-pass DRIFT-009, first-pass DEAD-011
- **Description:** The latest commit `03f6365` added a 26-file "canonical engine port" under `src/lib/canonical/` (model files + calc/ledger/* + calc/payment/* + calc/pricing/* + calc/shared/* + portal-derive.ts + portal-derive.test.ts + index.ts). The port is a "byte-identical port of the desktop canonical implementation" per each file's header. However, the ONLY consumer is `portal-derive.ts` (which uses `computeParentSummary`, `buildOverdueDueDateMap`, `computeSubjectAverage`, `computeOverallGpa`, `calculateAttendanceRate`, `clampNonNegative`). The remaining ~20 functions are DEAD CODE in the website context: `allocatePaymentToInstallments`, `isOverpayment`, `computeAccountBalance`, `replayParentLedger`, `balanceForAccount`, `totalOutstandingAcrossAccounts`, `maxDaysOverdueFromLedger`, and all of `calc/payment/{lifo-reversal,clearance,queries,sums,revenue}.ts`, `calc/ledger/{entries,charges,account-id}.ts`, `calc/pricing/{discount-engine,discount-rules,transport,tuition}.ts`, `calc/shared/dates.ts`. The `canonical/index.ts` barrel (27 lines, 23 `export *`) is NEVER imported by any file outside the canonical folder.
- **Location:** `elimtiyaz-website/src/lib/canonical/` (entire folder, 26 files) ;; [DEAD-011] `elimtiyaz-website/src/lib/canonical/calc/ledger/balance.ts:2-8` (and every other file in `src/lib/canonical/calc/`)
- **Evidence:** Audit evidence (Confirmed (verified: `grep -rln "from \"@/lib/canonical\"" src/` returns 0 matches; `grep` for each canonical function name outside the canonical folder returns 0-1 matches, with only `calculateAttendanceRate` having 1 match — portal-derive.ts)). Git: The entire canonical port was added in commit `03f6365` (2026-08-28) — the latest commit. The port was added as a "byte-identical" copy without trimming to the website's actual needs.
- **Root cause:** The author copied the desktop's entire `src/domain/calc/` tree to ensure cross-platform equivalence, but didn't prune the unused functions. The website doesn't collect payments (it's a view-only parent portal), so the entire `calc/payment/` and `calc/pricing/` subtrees are unnecessary. The port is over-inclusive.
- **Current behavior:** N/A (dead code doesn't behave).
- **Expected behavior:** Desktop's `src/domain/calc/*` is the canonical source. The website's `src/lib/canonical/calc/*` is a verbatim port.
- **Proposed resolution:** Desktop's `src/domain/calc/*` is the canonical source. The website's `src/lib/canonical/calc/*` is a verbatim port.
- **Dependencies:** none recorded
- **Absorbed findings:** DEAD-011: Every file in `src/lib/canonical/calc/` has a header comment that says *"CANONICAL ENGINE PORT (website) — byte-identical port of the desktop canonical implementation. DO NOT edit by hand: re-run `scripts/port-canonical.mjs` from the repo root instead."* — but the script `scripts/port-canonical.mjs` does NOT exist (verified via `find` — the only file in `scripts/` is `generate-pwa-icons.py`). The comment is a lie: the port was hand-copied, not auto-generated. Future maintainers who try to re-run the script to refresh the port would discover it doesn't exist.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DRIFT-010 — `attendance-view.tsx` comment says "The portal CANNOT submit justifications — that's a desktop workflow" but the code imports, renders, and wires the AbsenceJustificationDialog

- **Category:** DRIFT  |  **Severity:** Low  |  **Status:** TESTED (2026-08-29, T-065)
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-065 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DRIFT-010
- **Description:** The attendance-view's header comment (lines 7-8) says: *"The portal CANNOT submit justifications — that's a desktop workflow. We only display the justification status (uploaded by staff or pending)."* But the code: (1) imports `AbsenceJustificationDialog` (line 28), (2) renders a "Justifier cette absence" button for any non-present record with `justification_status === "none"` (lines 162-170), (3) renders the dialog itself (lines 179-186). The comment is completely outdated — the portal DOES submit justifications (per DONE.md line 35: *"Absence justification status tracking — attendance records now display a 4-state status pill... The `submitted` state is set automatically by the parent's submit"*).
- **Location:** `elimtiyaz-website/src/features/attendance/attendance-view.tsx:7-8`
- **Evidence:** Audit evidence (Confirmed). Git: The comment was written in commit `e90dbf7` "mid" (2026-08-01) when the portal didn't submit justifications. The dialog + button were added in the SAME commit (or a later iteration) but the comment was never updated.
- **Root cause:** The feature was added without updating the file's header comment. The DONE.md documents the feature but the source comment was forgotten.
- **Current behavior:** Comment: portal can't submit. Code: portal CAN submit.
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

- **Resolution (2026-08-29, T-065 — TESTED):** the header comment now states the truth: the portal both DISPLAYS the 4-state justification status (staff uploads included) AND SUBMITS via AbsenceJustificationDialog (storage upload to `attendance-justifications` + `attendance_records` justification-field update). The source-scan test also pins that the dialog wiring the corrected comment describes stays present. Evidence: website commit `5654074`; hub change-log sixth session.

---

### DRIFT-011 — Receipt-number generation logic is duplicated across 5 code paths with 5 different algorithms

- **Category:** DRIFT  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-015 (docs/recovery/task-registry.md)
- **Status note:** PARTIAL 2026-08-31 (T-015, 12th session): the three DESKTOP paths fixed — the collect() fallback was already gone (T-011), bulkCollect now allocates server-side via generate_receipt_numbers (migration 0058, advisory-locked), the sync-queue push passes NULL so the server generates, and generateReceipt's REC-{paymentId} display fabrication is gone. Live-verified 7/7 (scripts/verify_t-015.sql): canonical format, contiguous batch allocation, cross-tenant rejection, NULL-number generation, dedup preserved. The two ANDROID paths (LocalPaymentRepository count+1, SyncQueueDispatcher random PAY-) remain — toolchain-gated + their proper fix is ADR-005/T-059 (UNKNOWN-002). DISCOVERY: the unique constraint is on (tenant_id, payment_number), NOT receipt_number — BUSINESS-006's claim was wrong; the 0034 trigger syncs receipt_number := payment_number when NULL.
- **Consolidated from:** second-pass DRIFT-011, first-pass BUSINESS-006, second-pass BUSINESS-105
- **Description:** The receipt number for a payment is generated by 5 different code paths with 5 different algorithms: 1. Canonical SQL RPC `collect_and_allocate_payment` (migration 0040:69-72): `REC-YYYY-NNNNNN` where NNNNNN = `MAX(SUBSTRING(receipt_number FROM '\d{6}$')) + 1` filtered by `tenant_id` and `LIKE 'REC-YYYY-%'`. Sequential, server-authoritative. 2. Desktop `SupabasePaymentRepository.collect()` fallback (line 1053-1054): `PAY-YYYY-NNNNNN` where NNNNNN = `Math.floor(Math.random() * 1_000_000) + 1`. Random, client-side, collision-prone. 3. Desktop `SupabasePaymentRepository.bulkCollect()` (line 1326): `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`. Timestamped random, client-side. 4. Android `LocalPaymentRepository.collect()` (line 948-950): `REC-YYYY-NNNNNN` where NNNNNN = `paymentDao.listAll().size + 1`. Per-device sequential, collision-prone across devices. 5. Android `SyncQueueDispatcher.generatePaymentNumber()` (line 406-410, fallback when payload lacks receiptNumber): `PAY-YYYY-NNNNNN` where NNNNNN = `(1..1_000_000).random()`. Random, collision-prone. 6. Desktop's `defaultPushHandler` (sync-provider.tsx:169): `PAY-YYYY-NNNNNN` where NNNNNN = `Math.floor(Math.random()…
- **Location:** - Migration 0040:69-72 (canonical) - supabase-shared-repositories.ts:1053-1054 (desktop fallback) - supabase-shared-repositories.ts:1326 (desktop bulkCollect) - LocalRepositories.kt:948-950 (Android collect) - SyncQueueDispatcher.kt:406-410 (Android sync fallback) - sync-provider.tsx:169 (desktop sync fallback) ;; [BUSINESS-006] `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:949-950` (collect) + `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1260-1262` (markPaid backing payment) — same pattern duplicated ;; [BUSINESS-105] - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1053-1054` (client-side PAY- generation) - `elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:69-72` (server-side REC- generation) - `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:144-159` (sync_payments_receipt_number trigger)
- **Evidence:** Audit evidence (Confirmed). Git: All six code paths have been touched in different commits over the past 3 weeks (`eeb82db 2026-08-21`, `84dd13f okay`, `94471e8 2026-08-28`).
- **Root cause:** Each path was added at a different time, by different authors, with different assumptions about whether the server or client should generate the receipt number. The canonical RPC was the LAST to be added (migration 0040) — by then, the 5 client-side paths were already in production and weren't refactored to delegate to it.
- **Current behavior:** 5 different algorithms, 4 client-side, only 1 sequential.
- **Expected behavior:** A single canonical algorithm (path 1) should generate all receipt numbers, server-side, atomically within the canonical RPC.
- **Proposed resolution:** A single canonical algorithm (path 1) should generate all receipt numbers, server-side, atomically within the canonical RPC.
- **Dependencies:** none recorded
- **Absorbed findings:** BUSINESS-006: `LocalPaymentRepository.collect` (line 949) generates the receipt number as `"REC-$year-$seq"` where `seq = (paymentDao.listAll().size + 1).toString().padStart(6, '0')`. Three problems: (1) Collision-prone — if a payment is deleted, countActive decreases, next call reuses a previously-issued receipt number; the canonical `payments.receipt_number` has a UNIQUE constraint server-side. (2) Race-condition-prone — two concurrent `collect` calls both read the same count, both generate the same seq, one fails with UNIQUE constraint violation. (3) Per-device — every Android device generates `"REC-2026-000001"` for the first payment of the year; on sync push, `upsert_payment_from_import` matches by `(tenant_id, payment_number)` and OVERWRITES the other device's payment (data loss). The desktop's canonical `collect-payment` Edge Function generates the receipt SERVER-SIDE in a single atomic transaction — guaranteed unique across devices. | BUSINESS-105: When the canonical `collect_and_allocate_payment` RPC succeeds, the server generates a sequential receipt number `REC-YYYY-NNNNNN` (migration 0040:69-72 — `MAX(SUBSTRING(receipt_number FROM '\d{6}$')) + 1` filtered by tenant+year, zero-padded 6 digits). When the canonical RPC fails and the desktop falls back to `upsert_payment_from_import`, the desktop generates a client-side receipt number `PAY-YYYY-${Math.floor(Math.random() * 1_000_000) + 1}` (line 1054) — RANDOM, no sequence guarantee, collision-prone across two concurrent desktop clients. The `sync_payments_receipt_number` trigger (migration 0027:144-159) then copies `payment_number` → `receipt_number`. So the same desktop, on the same day, can produce receipt numbers in two completely different formats depending on which RPC path was taken. Auditors cannot reconcile. Sequential receipt numbers are the canonical invariant (per migration 0040 comment); the fallback breaks it.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DUP-001 — Four parallel cross-platform equivalence test frameworks

- **Category:** DUP  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop, Website
- **Task:** T-043 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DUP-001, first-pass DEAD-004, first-pass CROSS-002, first-pass CROSS-008
- **Description:** The repo carries FOUR overlapping test frameworks that all verify the same thing — that the desktop, Android, website, and backend produce equivalent financial state for the same inputs. Each has its own scenario format, runner, comparator, and types. The 4 frameworks are: (1) `financial-tests/scenarios/*.yml` (8 hand-written YAML scenarios, run by `src/test/cross-platform/ScenarioRunner.test.ts`); (2) `financial-tests/equivalence/` (TS framework with 45 JSON scenarios + generator + desktop/android/backend runners + comparator + regression archive — committed regression JSON files include duplicates with two timestamps 2026-08-19 and 2026-08-27); (3) `financial-tests/equivalence-live/` (Node mjs framework with 11 "layers" + executor + cleanup + real-DB adapters, runs against live Supabase); (4) `financial-tests/cross-platform-v2/` (yet another TS framework with its own `types.ts`, `compare.ts`, `normalize.ts`, `adapters/backend/supabase-shim.sql`). The README of `equivalence-live` itself admits the three other frameworks and tries to position itself as complementary.
- **Location:** `elimtiyaz-desktop/financial-tests/{scenarios,equivalence,equivalence-live,cross-platform-v2}/` ;; [DEAD-004] `elimtiyaz-desktop/financial-tests/scenarios/*.yml` (8 files) + `elimtiyaz-desktop/financial-tests/README.md` ;; [CROSS-002] `elimtiyaz-desktop/financial-tests/equivalence-live/README.md:36-51` (table) vs `elimtiyaz-desktop/financial-tests/equivalence-live/layers/` (directory) ;; [CROSS-008] `elimtiyaz-android/app/src/test/java/com/example/equivalence/AndroidEquivalenceTest.kt:18-51`
- **Evidence:** Audit evidence (Confirmed). Git: `financial-tests/equivalence-live/README.md` introduced `02fa7825` (2026-08-23); `financial-tests/cross-platform-v2/types.ts` introduced `84dd13f` (2026-08-27 — the latest commit). Both post-date `financial-tests/equivalence/` which was introduced much earlier.
- **Root cause:** Each successive audit wave ("Tier 2", "Tier 3", "Tier 4", "live", "v2") introduced a new framework instead of extending the existing one. The docs in `docs/development/` reference 4 verification passes (`vault-compliance-verification.md`, `-2.md`, `-3.md`), each adding its own test scaffold.
- **Current behavior:** The yml DSL is the simplest (8 scenarios, only 5 operation kinds); `equivalence/` adds 45 scenarios with 11 categories and a comparator; `equivalence-live/` adds 11 layers (UI input, validation, business logic, financial, academic, CRM, API, DB, audit, document, sync) and runs against real DB; `cross-platform-v2/` adds academic/crm/aging/sync/backend_hidden domains and a 4-way comparator. Each has subtly different normalization rules.
- **Expected behavior:** `financial-tests/equivalence/` is the most complete (525 scenarios claimed, 45 committed regression cases, Android + desktop runners, generator). The other three are partial duplicates.
- **Proposed resolution:** Consolidate the four equivalence frameworks into financial-tests/equivalence/ (the most complete): port the unique scenarios from the YAML DSL and cross-platform-v2, then delete scenarios/*.yml, equivalence-live/, cross-platform-v2/, and the stale _tier4 mirror. Verification: single comparator, single scenario corpus, Android runner reads the shared corpus (copy step documented).
- **Dependencies:** none recorded
- **Absorbed findings:** DEAD-004: The `financial-tests/scenarios/` directory contains 8 hand-written YAML scenario files (`single_payment_partial.yml`, `overpayment_creates_parent_credit.yml`, `discount_engine_sibling_only.yml`, etc.). The README at `financial-tests/README.md` says "Two runners consume the same YAML: Android `app/src/test/.../CrossPlatformScenarioRunner.kt`, Desktop `src/test/cross-platform/ScenarioRunner.test.ts`". But the JSON-based `financial-tests/equivalence/scenarios/` (45 scenarios) is the framework actually used by the desktop's cross-platform tests (`src/test/cross-platform/*.test.ts` imports from the equivalence scenarios). The 8 YAML files appear to be the original DSL, now superseded. No active test runner reads them (the `ScenarioRunner.test.ts` file does exist but uses YAML scenarios only for the 8 originals; the 45 JSON scenarios are run by `equivalence/desktop/desktop_runner.ts`). | CROSS-002: The `equivalence-live/README.md` table at lines 36-51 lists 12 layers — `01 UI/Input` through `11 Sync` plus `12 Guard` ("Real-data isolation: the production corpus is snapshotted before/after and asserted byte-identical"). But the `layers/` directory only contains 11 files: `01_ui_input.mjs` through `11_sync.mjs`. There is no `12_guard.mjs`. The "Layer 12" guard functionality (asserting the real production corpus is untouched by the test run) appears to be implemented in `lib/scope.mjs` (`realCorpusSnapshot` + `assertNoRealDataTouched` per `run.mjs:24, 67-68`), but it's not exposed as a layer. The README misrepresents the architecture. | CROSS-008: `AndroidEquivalenceTest.runCanonicalScenarios()` resolves the scenarios directory via `resolve("androidEquivalence.scenariosDir", "financial-tests/equivalence/scenarios")` (line 22-29). The `resolve` helper probes the CWD then the CWD's parent (line 38-50). But the Android repo does NOT have a `financial-tests/` directory — only the desktop repo has it (`/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence/scenarios/`). So the test fails with "Scenarios directory not found" when run from a fresh checkout of just the Android repo.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DUP-002 — Duplicate `kotlin_mirror_engine.ts` in two locations with drifted logic

- **Category:** DUP  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-043 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DUP-002
- **Description:** A ~1300-line TypeScript port of the Android Kotlin financial engine exists in TWO places. The two copies have drifted: the `financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts` (1313 lines) has a "canonical" filter that drops both null AND empty strings before joining identity fields for the parent_code hash, mirroring a desktop fix. The `src/test/cross-platform/_tier4/kotlin_mirror_engine.ts` (1311 lines) is the older version — it filters null+undefined but keeps empty strings, producing different parent codes. Also: `maxOf(a, b)` accepts `b: string` in the older copy and `b: string | null` in the newer one.
- **Location:** `elimtiyaz-desktop/financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts` AND `elimtiyaz-desktop/src/test/cross-platform/_tier4/kotlin_mirror_engine.ts`
- **Evidence:** Audit evidence (Confirmed (diff confirmed via `diff -q`)). Git: Both files last touched in `2e2b21a` (2026-08-28 "fix(equivalence): canonical overdue mirror + as-of RPCs + pending-capacity fix (A-0042)")
- **Root cause:** The `_tier4/` copy was created when Tier 4 tests were added; later canonical fixes were applied to the `equivalence/android_mirror/` copy but not back-ported to the `_tier4/` copy.
- **Current behavior:** Empty-string identity fields produce different parent codes; the const assertion changes type strictness.
- **Expected behavior:** The `financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts` is canonical (newer, has the fix). The `src/test/cross-platform/_tier4/kotlin_mirror_engine.ts` is the stale duplicate.
- **Proposed resolution:** The `financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts` is canonical (newer, has the fix). The `src/test/cross-platform/_tier4/kotlin_mirror_engine.ts` is the stale duplicate.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DUP-003 — Two parallel Compose design systems with 18 same-named duplicate component classes

- **Category:** DUP  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Desktop, Website
- **Task:** T-044 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DUP-003
- **Description:** The Android repo ships TWO complete Compose design systems side-by-side: the legacy `com.example.ui.components.El*` (26 files in `app/src/main/java/com/example/ui/components/`) and the new `com.example.ui.designsystem.components.*/El*` (60+ files across `app/src/main/java/com/example/ui/designsystem/components/{button,card,data,display,nav,feedback,input,tabs}/`). 18 classes share the SAME simple name (e.g. `ElButton`, `ElCard`, `ElTextField`, `ElTopBar`, `ElStatCard`, `ElEmptyState`, `ElFab`, `ElIconButton`, `ElDropdown`, `ElSectionHeader`, `ElInfoRow`, `ElTag`, `ElAvatar`, `ElBadge`, `ElAlertBanner`, `ElDivider`, `ElScaffold`, `ElGradientStatCard`) in different packages — importing the wrong one in a feature file silently picks the wrong implementation.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/ui/components/` (legacy) + `elimtiyaz-android/app/src/main/java/com/example/ui/designsystem/components/` (new)
- **Evidence:** Audit evidence (Confirmed). Git: Legacy `ui/components/ElButton.kt` last modified in `6875ac3` "sauce" (2026-08-11); new `ui/designsystem/components/button/ElButton.kt` introduced later — both actively maintained
- **Root cause:** A new design system was scaffolded (`ui/designsystem/`) without deleting or wrapping the legacy `ui/components/`. The dashboard was migrated first as a "reference implementation"; the remaining 37 feature screens were never migrated.
- **Current behavior:** The legacy `ElButton` uses simple params (text, onClick, modifier); the new `ElButton` uses a `ButtonStyleResolver` + `ButtonTypes` enum + tokens. Same for `ElCard` (legacy plain Card vs new `CardStyleResolver`). UI rendered with the legacy components will not respect the new design tokens (spacing, motion, elevation, glass) that the new theme publishes via CompositionLocals.
- **Expected behavior:** The new design system (`ui.designsystem.components.*`) is intended canonical per `MainActivity` import; the legacy `ui.components.*` is the pre-redesign version
- **Proposed resolution:** The new design system (`ui.designsystem.components.*`) is intended canonical per `MainActivity` import; the legacy `ui.components.*` is the pre-redesign version
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DUP-004 — Two `ElImtiyazTheme` composables with the same name in different packages

- **Category:** DUP  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-044 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DUP-004, first-pass WEAK-013
- **Description:** There are TWO `@Composable fun ElImtiyazTheme(...)` functions in different packages: `com.example.ui.theme.ElImtiyazTheme` (legacy, 84 lines, publishes `LocalElDesignTokens` + `LocalSemanticColors`) and `com.example.ui.designsystem.theme.ElImtiyazTheme` (new, 85 lines, publishes `LocalElColors` + `LocalElSpacing` + `LocalElElevation` + `LocalElBorders` + `LocalElMotion` + `LocalElTextStyles` + `LocalElShadowColor`, also applies edge-to-edge). Both have the SAME signature. `MainActivity` imports the new one; the legacy one is dead in production.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/ui/theme/ElImtiyazTheme.kt` (legacy) + `elimtiyaz-android/app/src/main/java/com/example/ui/designsystem/theme/Theme.kt` (new) ;; [WEAK-013] `elimtiyaz-android/app/src/test/java/com/example/GreetingScreenshotTest.kt:15,48`
- **Evidence:** Audit evidence (Confirmed). Git: Both files have been touched in many commits — the new design system was added during the post-`6875ac3` (2026-08-11) iterations
- **Root cause:** The new design system theme was scaffolded to ship the new visual identity (edge-to-edge, Material 3 colors, 6 token systems), but the legacy theme was kept "for compatibility" — and the screenshot test was never migrated to validate the new theme.
- **Current behavior:** Legacy theme publishes `SemanticColors` (success/warning/info only) + `ElDesignTokens` (gradients, shimmerBase, glassTint). New theme publishes a full `ElColors` palette + 6 separate token systems (spacing, elevation, borders, motion, text styles, shadow). Screens using `ElTheme.colors.*` (the new accessor) will not work under the legacy theme, and vice versa for screens using `LocalElDesignTokens.current.*` (legacy accessor).
- **Expected behavior:** `com.example.ui.designsystem.theme.ElImtiyazTheme` is the canonical production theme (per `MainActivity.kt:17,30`)
- **Proposed resolution:** `com.example.ui.designsystem.theme.ElImtiyazTheme` is the canonical production theme (per `MainActivity.kt:17,30`)
- **Dependencies:** none recorded
- **Absorbed findings:** WEAK-013: `GreetingScreenshotTest` (the only screenshot test in the repo) imports `com.example.ui.theme.ElImtiyazTheme` (line 15) — the LEGACY theme. But production `MainActivity` imports `com.example.ui.designsystem.theme.ElImtiyazTheme` — the NEW theme. So the screenshot test validates a theme that's NOT what production uses. The committed `greeting.png` (86 KB) shows the legacy theme's rendering (PrimaryBlue, no edge-to-edge, no Material 3 dynamic colors).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DUP-005 — Two parallel Room entity / DAO / mapper layers coexist in the same database (partial migration)

- **Category:** DUP  |  **Severity:** High  |  **Status:** BLOCKED
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Desktop
- **Task:** T-045 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DUP-005, first-pass DRIFT-008
- **Description:** The Room database has TWO complete entity layers: the legacy `Entities.kt` (`ParentCacheEntity`, `StudentCacheEntity`, `PaymentCacheEntity`, `LedgerCacheEntity`, `SyncQueueEntity` — 5 "cache" entities, 134 lines, with comment "Room is NOT the primary store; it's a read cache + sync queue. Supabase is the source of truth.") and the new `LocalEntities.kt` (24 source-of-truth entities, 577 lines, with comment "Room is the PRIMARY store for this build. The mobile app is designed to work offline-first."). Mirrored by `Daos.kt` (5 legacy cache DAOs) + `LocalDaos.kt` (22 new DAOs) and `CacheMappers.kt` (122 lines) + `LocalMappers.kt` (359 lines). Both layers are wired into Hilt in `DatabaseModule.kt`.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/Entities.kt` + `elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/LocalEntities.kt`; `Daos.kt` + `LocalDaos.kt`; `CacheMappers.kt` + `LocalMappers.kt` ;; [DRIFT-008] `elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/Entities.kt:8-15` + `elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/LocalEntities.kt:7-19`
- **Evidence:** Audit evidence (Confirmed). Git: `Entities.kt` last touched in `c519643` "coool" (2026-08-23); `LocalEntities.kt` last touched in `dd4c7dc` "kk" (2026-08-26). Both files have been actively maintained in parallel.
- **Root cause:** The Android was originally built as "Supabase is canonical, Room is a cache" (matching desktop). Later, an offline-first rearchitecture converted Room to "primary store" with new entities (`Local*` prefix). The legacy cache layer was kept "for sync compatibility" but never deleted.
- **Current behavior:** The cache entities carry `syncedAt` (last fetch timestamp from Supabase); the source-of-truth entities don't. Pulls write to BOTH layers in some flows (e.g. `PullSyncRepository.pullParents` writes to `db.parentDao()` — the new layer — but `SyncSupport.upsertParents` writes to `parentCacheDao` — the legacy layer). Two layers can drift apart.
- **Expected behavior:** Unclear — the LEGACY `Entities.kt` says Supabase is the source of truth (matching the desktop's "Supabase is canonical" model); the NEW `LocalEntities.kt` says Room is the primary store (matching an offline-first rearchitecture). Both intentions coexist.
- **Proposed resolution:** Unclear — the LEGACY `Entities.kt` says Supabase is the source of truth (matching the desktop's "Supabase is canonical" model); the NEW `LocalEntities.kt` says Room is the primary store (matching an offline-first rearchitecture). Both intentions coexist.
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-002 / ADR-005: which Room layer survives depends on the target write architecture.
- **Absorbed findings:** DRIFT-008: The two entity files express contradictory architectural intent: `Entities.kt:8-15` says "Room cache entities — mirror the Supabase schema for offline reads. Room is NOT the primary store; it's a read cache + sync queue. Supabase is the source of truth." `LocalEntities.kt:7-19` says "Local source-of-truth entities — Room is the PRIMARY store for this build. The mobile app is designed to work offline-first." Both entity sets live in the SAME Room database (`ElImtiyazDatabase` at version 11) and both are exposed via Hilt.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### REG-001 — Chain of 9 "canonical engine unification" fix-up migrations after the "unification" was supposedly complete

- **Category:** REG  |  **Severity:** High  |  **Status:** TESTED
- **Status note:** PROCESS GUARD LANDED 2026-08-31 (T-058, 13th session): the historical fix-up chain stays as-is (it IS the audit record — the live DB is built on it); RECURRENCE is now prevented by scripts/check-migrations-append-only.sh (fails on any edit/delete/rename of an existing migration, in the working tree AND vs the upstream base; header + NNNN_name.sql discipline enforced), wired into npm test and git-workflow.md §7 review checklist. Matrix 9/9 + vitest 6/6.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-058 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass REG-001
- **Description:** The "Shared Unification" docs (`docs/development/shared-unification.md`) declared that migrations 0026 + 0027 + 0028 unified the desktop + Android on a single canonical schema. Yet migrations 0034 through 0043 (10 migrations) are ALL fix-ups to that "canonical" unification: 0034 "Canonical Engine Unification (Backend Third-Implementation Fix)" — drops 17 divergent SQL functions; 0035 "Tier 3 Drop Signature Fixes" — re-drops functions that 0034 failed to drop due to wrong signatures; 0036 "Tier 4 Backend Hardening" — drops a legacy 1-arg overload that 0034's CREATE OR REPLACE accidentally created; 0037 "Cross-Platform Sync Hardening"; 0040 "Cross-Platform RPC Unification"; 0041 "Canonical Academic Flow"; 0042 "Canonical Overdue As-Of Equivalence"; 0043 "Portal Alignment". Each migration's header documents bugs the previous "canonical" version missed.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0034_*.sql` through `0043_*.sql` (10 files, totaling ~6,400 lines of SQL)
- **Evidence:** Audit evidence (Confirmed). Git: 0034 introduced `5b0df5b` (2026-08-21 "kay") + `fb5dda8` (2026-08-23 "coool") + `b5a84cd` (2026-08-26 "kay") + `84dd13f` (2026-08-27 "okay"). 0042 introduced `2e2b21a` (2026-08-28 "fix(equivalence): canonical overdue mirror + as-of RPCs + pending-capacity fix (A-0042)") — the only commit with a descriptive message in the entire repo.
- **Root cause:** The original unification (0026/0027/0028) was done before the canonical spec was finalized. Each successive audit (Tier 2 → Tier 3 → Tier 4 → live → v2) found new divergences; each finding became its own migration rather than rolling back the original. The SQL layer accumulated 5+ competing implementations of the same financial logic before the fix-up chain consolidated them.
- **Current behavior:** Without migration 0042, the SQL `compute_parent_summary` classifies overdue using `latestCharge.at <= p_as_of` JOINed to `installment.due_date` — divergent from the desktop engine's `MAX(charge.at) < now` rule. Without 0035, the divergent legacy `collect_payment` and `allocate_payment_waterfall` RPCs remain callable, allowing callers to bypass the canonical waterfall.
- **Expected behavior:** N/A — this IS the chain of canonical fix-ups.
- **Proposed resolution:** N/A — this IS the chain of canonical fix-ups.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### REG-002 — 8 Room migrations are fix-up migrations for previous regressions — same iterative bug-fix pattern as desktop's REG-001

- **Category:** REG  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-046 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass REG-002
- **Description:** The Room database is at version 11 with 8 explicit migrations (v3→v4 through v10→v11). Each migration's KDoc documents a regression that the previous version had: - `MIGRATION_3_4` — adds `metadataJson` column to `ledger_entries` (metadata was silently dropped before) - `MIGRATION_4_5` — adds `paymentPlan` column to `students` (the 10% early-annual discount couldn't be evaluated without it) - `MIGRATION_5_6` — adds `finalSpentAmount` column to `expenses` (`settleProof()` accepted the parameter but silently dropped it because the column didn't exist) - `MIGRATION_6_7` — changes `subjects.coefficient` and `assessments.coefficient` from INTEGER to REAL (Int truncated decimal coefficients); adds `isExtracurricular` to assessments (canonical GPA exclusion rule); makes `classes.capacity` nullable; adds `parents.cityTier`; adds `payments.expectedAmount`/`excessAmount`/`excessRemark` (partial/overpayment tracking); adds `ledger_cache.metadataJson` - `MIGRATION_7_8` — adds `subjects.level` (was hardcoded "all" so every chip filter showed empty list); adds `subjects.passingGrade` (was hardcoded 10) - `MIGRATION_8_9` — adds `vehicles`, `routing_stops`, `class_subjects` tables (the routing fea…
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/ElImtiyazDatabase.kt:102-391`
- **Evidence:** Audit evidence (Confirmed). Git: Each migration was added in a different commit; the migrations file was last touched in `94471e8` (2026-08-28)
- **Root cause:** Each migration was added when a bug was discovered in production: metadata was dropped, paymentPlan was missing, settleProof() didn't persist, INTEGER coefficient truncated decimals, level hardcoded "all" broke filters, routing was stub, batch registration needed master info fields, subject-average formula changed. Each fix was a "we forgot this column" or "we had the wrong type" patch — the original schema was never designed correctly.
- **Current behavior:** N/A — each migration fixes a specific regression
- **Expected behavior:** Mirrors desktop's REG-001 finding (9 "canonical engine unification" fix-up migrations after the "unification" was supposedly complete)
- **Proposed resolution:** Mirrors desktop's REG-001 finding (9 "canonical engine unification" fix-up migrations after the "unification" was supposedly complete)
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Weak Implementations

### WEAK-003 — `mapLedgerRow` falls back from `entry_type` to `actor_id` for the entry type

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-056.1, hub commit 6e24cd3): mapLedgerRow's type fallback is (entry_type ?? 'charge') — actor_id is never consulted. Source-scan guard in t-056-hygiene.test.ts (4/4).
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-056 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-003
- **Description:** The ledger row mapper `mapLedgerRow` builds the domain `LedgerEntry.type` field with `type: (r.entry_type ?? r.actor_id ?? "charge") as LedgerEntry["type"]`. This is a logic error: if `entry_type` is null (which the schema says it shouldn't be, but defensive code shouldn't assume), the mapper falls back to `actor_id` — which is a user ID like "usr-adm-001" or a UUID. That value is then cast to `LedgerEntry["type"]` which is the union `"charge" | "payment" | "adjustment" | "refund" | "reversal" | "transfer"`. The cast is unsafe (the value "usr-adm-001" is not a valid entry type). The reconciler downstream would then misclassify this entry (it would not match any case in the switch statement in `computeAccountBalance`).
- **Location:** `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:383`
- **Evidence:** Audit evidence (Likely (the bug is dormant but real)). Git: `supabase-shared-repositories.ts` last modified in `84dd13f` (2026-08-27). The `r.entry_type ?? r.actor_id ?? "charge"` chain has been there since the file was created.
- **Root cause:** The developer confused `entry_type` (a column) with `actor_id` (a different column) while writing defensive null coalescing. The `actor_id` fallback is semantically meaningless for the entry type.
- **Current behavior:** Per the schema, `entry_type` is NOT NULL — the fallback should never trigger. But if a row is somehow inserted with NULL `entry_type` (e.g., by a buggy RPC or direct SQL), the desktop would silently treat the actor_id as the entry type.
- **Expected behavior:** The `LedgerEntryRow` type at `src/infrastructure/supabase/types.ts:336` marks `entry_type` as non-nullable: `entry_type: "charge" | "payment" | "adjustment" | "refund" | "reversal" | "transfer";`
- **Proposed resolution:** The `LedgerEntryRow` type at `src/infrastructure/supabase/types.ts:336` marks `entry_type` as non-nullable: `entry_type: "charge" | "payment" | "adjustment" | "refund" | "reversal" | "transfer";`
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-004 — `ledger-seed.ts` computes `dueDate` then discards it (`void dueDate;`)

- **Category:** WEAK  |  **Severity:** Low  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-056.2, hub commit e63ae97): tuition seed tranches stamp at = their canonical due date (Sept/Dec/Mar); `void dueDate` removed. NOTE (registered follow-up): the transport-tranche loop in the same seed uses the same daysAgo(60) stamp without a discarded variable — same class, deliberately left out of T-056's scope.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-056 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-004
- **Description:** The `buildSeedLedger()` function in `mock/ledger-seed.ts:139-171` computes `const dueDate = trancheDueDates[i];` inside a forEach loop, then immediately `void dueDate;` on the next line — explicitly discarding the value. All three tuition tranches get `at: daysAgo(60)` (the same timestamp for all three) instead of their canonical Sept 15 / Dec 15 / Mar 15 due dates. The seed data therefore does not reflect the canonical tranche schedule. If any code replays the ledger by `at` timestamp (instead of by installment `dueDate`), the chronological order of tranches is arbitrary (broken by id tiebreaker), not the canonical Sep → Dec → Mar order.
- **Location:** `elimtiyaz-desktop/src/infrastructure/mock/ledger-seed.ts:139-171`
- **Evidence:** Audit evidence (Confirmed). Git: `ledger-seed.ts` last modified in `b5a84cd` (2026-08-26 "kay"). The `void dueDate;` was introduced as part of the Tier 2 R17 single-pass discount refactor.
- **Root cause:** The refactor moved from "one charge per tranche with explicit dueDate" to "one charge per tranche with `at: daysAgo(60)` for all" but didn't remove the now-unused `dueDate` variable. The `void` was added to silence the linter.
- **Current behavior:** The seed ledger has 3 tuition tranches per student, all dated `daysAgo(60)`. The waterfall allocator (which sorts installments by `dueDate`) is unaffected (installments have their own `dueDate` field). But any direct ledger replay (e.g., for audit purposes) sees all tranches as simultaneous.
- **Expected behavior:** The canonical schedule is Sep 15 / Dec 15 / Mar 15 per `getOfficialTuitionDueDates()`. The seed uses `trancheDueDates` (computed at the top of the file) but doesn't apply them.
- **Proposed resolution:** The canonical schedule is Sep 15 / Dec 15 / Mar 15 per `getOfficialTuitionDueDates()`. The seed uses `trancheDueDates` (computed at the top of the file) but doesn't apply them.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-005 — Mock `student-repository.batchRegister` uses the deterministic discount engine but ignores `previousGradeLevel` and `previousRank`

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Desktop
- **Task:** T-060 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-060, 11th session): batch-registration captures previousGradeLevel + previousRank; computeBilling + mock buildRegistrationBilling pass both — passage_palier/highest_average fire when qualified. t-060-payment-ux.test.ts 7/7.
- **Consolidated from:** first-pass WEAK-005
- **Description:** The mock `student-repository.batchRegister` billing builder (`buildRegistrationBilling`, line 353+) and the UI's `computeBilling` both call `evaluateAllSystemDiscounts` with `previousGradeLevel: null` and `previousRank: null`. The canonical discount engine has 5 rules; 2 of them (`passage_palier` and `highest_average`) depend on `previousGradeLevel` and `previousRank` respectively. By passing null, those 2 rules always return 0 — silently disabled. The billing summary the user sees during batch registration never shows the `passage_palier` (−10,000 DZD) or `highest_average` (−10%) discount, even if the student qualifies. The comment says "Not tracked in the batch form yet" — meaning the UI doesn't capture these fields, so the engine can't apply them.
- **Location:** `elimtiyaz-desktop/src/features/crm/batch-registration/compute-billing.ts:64-75` and `elimtiyaz-desktop/src/infrastructure/mock/repositories/student-repository.ts:373-384`
- **Evidence:** Audit evidence (Confirmed). Git: `compute-billing.ts` last modified in `b5a84cd` (2026-08-26 "kay"). The null pass-through has been there since the file was created.
- **Root cause:** The batch registration form (`batch-registration/types.ts` `Step2Student`) doesn't have fields for `previousGradeLevel` or `previousRank`. The billing engine can't apply rules it doesn't have inputs for. The canonical spec mandates the rules; the UI doesn't capture the inputs.
- **Current behavior:** A student transitioning from `5ap` to `1am` (qualifying for `passage_palier` −10,000 DZD) sees no discount in the batch registration summary. A rank-1 student (qualifying for `highest_average` −10%) sees no discount. The parent is overcharged.
- **Expected behavior:** The canonical `evaluateAllSystemDiscounts` (in `discount-engine.ts:56-102`) correctly applies all 5 rules when given the inputs. The seed ledger (`ledger-seed.ts:120-131`) also passes null with the comment "not tracked in seed data".
- **Proposed resolution:** The canonical `evaluateAllSystemDiscounts` (in `discount-engine.ts:56-102`) correctly applies all 5 rules when given the inputs. The seed ledger (`ledger-seed.ts:120-131`) also passes null with the comment "not tracked in seed data".
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-006 — `LocalInstallmentRepository.regenerateForCycle()` is hollow — only writes audit log, doesn't actually regenerate installments

- **Category:** WEAK  |  **Severity:** Critical  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-054, 13th session): regenerateForCycle REALLY re-derives due dates from officialTuitionDueDates(year) for non-paid tranches (Sept 15 / Dec 15 / Mar 15), resets custom-schedule flags, stamps academic_cycle, and enqueues the sync pushes; the audit row records the REAL rederived count. 7/7 tests (HollowImplementationsT054Test, incl. source-scan pins).
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Desktop
- **Task:** T-054 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-006
- **Description:** The `regenerateForCycle` method is supposed to re-derive installment due dates for a new academic cycle (per CANONICAL-FINANCIAL-LOGIC.md §7.3). The desktop's `SupabaseInstallmentRepository.regenerateForCycle` (2138-2197 lines) actually fetches the parent's installments, computes new due dates via `getOfficialTuitionDueDates(year, cycle)`, calls `client.from("installments").update(...)` for each unpaid installment, and returns the patched list. The Android's version just writes an audit log entry and returns the existing installments UNCHANGED.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1360-1363`
- **Evidence:** Audit evidence (Confirmed). Git: Method touched in `dd4c7dc` "kk" (2026-08-26) — recent, but the hollow behavior wasn't fixed
- **Root cause:** The Android's `regenerateForCycle` was likely a stub that returned a successful Result to unblock UI development, and was never replaced with the real implementation. The audit log entry makes it LOOK like work happened.
- **Current behavior:** Desktop: installments' due dates are updated to the new cycle's official dates; `is_custom_schedule = false`, `custom_schedule_note = null`, `academic_cycle = cycle`. Android: nothing changes; the audit log lies that "installment.regenerate" happened.
- **Expected behavior:** Desktop's `SupabaseInstallmentRepository.regenerateForCycle` at `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:2138-2197`
- **Proposed resolution:** Desktop's `SupabaseInstallmentRepository.regenerateForCycle` at `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:2138-2197`
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-007 — Dashboard "Créances en Retard" KPI + Debt Dashboard overdue amount are PERMANENTLY 0 (missing `overdueCategoryDueDates` map)

- **Category:** WEAK  |  **Severity:** Critical  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-026, 13th session): EVERY production computeParentSummary call site now builds and passes the due-date map (including balance-only reads — the debt-dashboard totalOutstanding loop and sendReminder), so "Créances en Retard" computes the real overdue total. A source-scan pin test prevents the empty-map default from ever returning. 10/10 new tests.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Desktop
- **Task:** T-026 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-007
- **Description:** `LedgerEngine.computeParentSummary` takes an optional `overdueCategoryDueDates: Map<String, Instant> = emptyMap()` parameter. The function's overdue logic at line 148 is `if (dueDate != null && acc.balance > 0L && dueDate.isBefore(now)) totalOverdue += acc.balance`. Since the default is an empty map, `dueDate` is always null, so `totalOverdue` is ALWAYS 0 — UNLESS the caller explicitly builds and passes the overdue-due-dates map via `LedgerEngine.buildOverdueDueDateMap` (defined at line 163). The dashboard (`LocalDashboardRepository.observeKpis` lines 274-290), the debt dashboard (`LocalDebtRepository.observeSummary` lines 619-632), and the parent profile (`LocalDebtRepository.observeParentProfile` lines 644-670) ALL call `computeParentSummary(parentEntries, pid, parentName)` without the overdue map → `totalOverdue` is always 0.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:283-290, 619-632, 644-670, 687` (call sites) + `elimtiyaz-android/app/src/main/java/com/example/core/LedgerEngine.kt:109-161, 163-166` (function + builder)
- **Evidence:** Audit evidence (Confirmed). Git: `LocalRepositories2.kt` last touched in `94471e8` (2026-08-28); `LedgerEngine.kt` last touched in `94471e8`. The `buildOverdueDueDateMap` function EXISTS but is never called from production code (only in `ReconcileTest.kt`).
- **Root cause:** A "TIER 2 R16" fix (per the inline comment at LocalRepositories2.kt:279-282) replaced the previous "naive installment-filter" overdue computation with the canonical `computeParentSummary.totalOverdue`. But the developer didn't realize that `computeParentSummary` requires the caller to pass `overdueCategoryDueDates` — without it, `totalOverdue` is always 0. The fix replaced a working (naive) computation with a broken (canonical-but-misused) one.
- **Current behavior:** Android dashboard always shows "0 DZD" for "Créances en Retard" and "0 famille(s) en souffrance", even when there are overdue accounts. The debt dashboard's per-parent `overdueAmount` is always 0. Debt reminder notifications always have priority "medium" (never "high") regardless of overdue state.
- **Expected behavior:** Desktop's `debt-ops.ts:43-44` does `const dueDateMap = buildOverdueDueDateMap(parentEntries); const summary = computeParentSummary(parentEntries, p.id, name, dueDateMap);` — properly builds the map BEFORE calling computeParentSummary. Android skips this step.
- **Proposed resolution:** Build the overdueCategoryDueDates map via LedgerEngine.buildOverdueDueDateMap at every computeParentSummary call site (dashboard KPIs, debt summary, parent profile) exactly as the desktop's debt-ops.ts does. Test: seeded overdue ledger produces non-zero 'Creances en Retard' KPI.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-008 — `LocalWorkflowRepository.toDomain()` hardcodes `trigger = WorkflowTrigger.fromCode("manual")` for every run

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-054, 13th session): WorkflowRunEntity gains the trigger column (MIGRATION_11_12, v11->v12, DEFAULT 'manual' preserving historical rows), the DTO mapping keeps the server's real value, and toDomain() maps it — the hardcoded "manual" is gone. 7/7 tests.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-054 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-008
- **Description:** The `WorkflowRunEntity.toDomain()` extension hardcodes the trigger type to `"manual"` regardless of the actual trigger. The `WorkflowRunEntity` doesn't even HAVE a `trigger` column (verified at LocalEntities.kt:566-577) — so the trigger type is LOST on pull from Supabase. Every workflow run displayed in the Android UI shows "Manual" trigger.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1793`
- **Evidence:** Audit evidence (Confirmed). Git: `WorkflowRunEntity` defined in LocalEntities.kt; `LocalRepositories2.kt:1793` last touched in `dd4c7dc` "kk" (2026-08-26)
- **Root cause:** The `WorkflowRunEntity` was defined without a `trigger` column (the desktop's table has one). When the toDomain mapper was written, the developer hardcoded "manual" as a "safe default" instead of adding the column to the entity + migration + DTO mapper.
- **Current behavior:** A webhook-triggered workflow run shows "Manual" on Android and "Webhook" on desktop. A scheduled run shows "Manual" on Android and "Schedule" on desktop. Staff using Android to triage workflow failures can't distinguish manual retries from automatic triggers.
- **Expected behavior:** Desktop's `WorkflowRun` domain model carries the real trigger type (manual, webhook, schedule, data_event, retry). The Supabase `workflow_runs` table has a `trigger` column (per desktop migrations).
- **Proposed resolution:** Desktop's `WorkflowRun` domain model carries the real trigger type (manual, webhook, schedule, data_event, retry). The Supabase `workflow_runs` table has a `trigger` column (per desktop migrations).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-009 — `OnlineDetector` always reports "online" — `isOnline()` ignores probe results, probe catches all exceptions and returns `true`

- **Category:** WEAK  |  **Severity:** High  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-050, 13th session): initial state fail-closed (offline until evidence); `isOnline()` returns the COMBINED state (connectivityActive AND probeOk — `combineOnline`); `probe()`'s catch returns FALSE (DNS/timeout/refused → offline); verdict `probeAccepts` accepts only 200/401; the OkHttp client no longer follows redirects (captive-portal 302 → rejected). 15 new Android unit tests (OnlineDetectorT050Test) incl. source-scan pins; debug suite 234/234. Live airplane-mode/captive-portal behaviour is a hardware-note gap (not claimed).
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-050 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-009
- **Description:** Three compounding bugs make `OnlineDetector` permanently report "online": (1) Initial state defaults to `online = true` (line 38-40), so before the first probe completes, `isOnline()` returns `true`; (2) `isOnline()` returns `_state.value.connectivityActive` (line 132) — only checks if the device has ANY network, ignores `probeOk`; (3) `probe()` catches ALL exceptions and returns `true` (line 124-127) — if the HTTP request fails (e.g. DNS, timeout, connection refused), `probe()` returns `true` (claims "online"). Additionally `updateState` always sets `online = next.connectivityActive` (line 139) — `probeOk` is captured but never used to determine `online`.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/OnlineDetector.kt`
- **Evidence:** Audit evidence (Confirmed). Git: `OnlineDetector.kt` last touched in `cfac666` "suace" (2026-08-17)
- **Root cause:** The initial state was set optimistically to "online=true" so the first sync attempt wouldn't be blocked. The probe was designed to confirm online state, but the catch-all-returns-true behavior was a "fail-open" choice that defeats the probe's purpose. The `updateState` function forgot to incorporate `probeOk` into the `online` computation.
- **Current behavior:** The device can be offline (no internet, captive portal, DNS failing) but `OnlineDetector` reports "online". SyncWorker then fires, drains the queue (every entry fails after 5 retries over ~30 seconds), and the queue fills with `failed` entries. Battery drain + queue pollution.
- **Expected behavior:** N/A — this is an Android-only component
- **Proposed resolution:** N/A — this is an Android-only component
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-010 — `pullAll()` is called from 6 different call sites on startup / navigation / sync — wasteful duplication; SyncWorker calls it TWICE per tick

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-050, 13th session): `PullSyncRepository.pullAll` gains an atomic in-flight guard + a 10s dedup window (deduped calls return Ok(0) without touching the network — the "single deduplicated pullAll trigger per cycle" the task prescribes); SyncWorker's own duplicate pull REMOVED (drainPending's trailing pull is the one per-tick pull); syncNow's second pull REMOVED (same). Source-scan tests pin the wiring.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-050 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-010
- **Description:** `PullSyncRepository.pullAll()` fires 11 separate RPC calls (parents, students, payments, ledger_entries, classes, subjects, installments, personnel, departments, notifications, workflow_runs), each with a 2000-row limit. The function is invoked from 6 different call sites: (1) `ElImtiyazApplication.triggerInitialSupabasePull` (app startup); (2) `AppNavViewModel.init` line 27 (also app startup — same time as #1); (3) `AppNavViewModel.init` line 34 (session collector — fires on every session change); (4) `SyncService.drainPending` line 130 (at end of every drain); (5) `SyncService.syncNow` line 147 (when user taps "sync now"); (6) `SyncWorker.doWork` line 54 (every 15 minutes — but `drainPending` at line 48 ALREADY calls `pullAll` at line 130, so the SyncWorker fires pullAll TWICE per tick). Plus (7) `StudentRosterScreen` line 103 (pull-to-refresh).
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/ElImtiyazApplication.kt:104` + `elimtiyaz-android/app/src/main/java/com/example/ui/navigation/AppNavViewModel.kt:27,34` + `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncService.kt:130,147` + `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncWorker.kt:48,54` + `elimtiyaz-android/app/src/main/java/com/example/ui/features/crm/StudentRosterScreen.kt:103`
- **Evidence:** Audit evidence (Confirmed). Git: All cited files touched in recent commits; the duplicate calls in SyncWorker (line 48 drainPending + line 54 pullAll) were introduced when the "pull-side fix" was added — the comment at SyncService.kt:17-19 says "the worker is a thin wrapper around drainPending + pullAll" but drainPending ALREADY calls pullAll internally.
- **Root cause:** Each layer of the sync stack (Application, ViewModel, SyncService, SyncWorker) was written independently and each adds its own pullAll call as a "safety net" without realizing the other layers also call it. The SyncWorker's "ALSO pull after drain" was added when drainPending didn't yet call pullAll; when drainPending was later upgraded to also pull, the SyncWorker's direct call became redundant.
- **Current behavior:** On app cold-start, `pullAll` fires at least twice (Application + AppNavViewModel.init). Every 15-min SyncWorker tick fires it twice (drainPending + doWork). Every session change fires it once (AppNavViewModel.init collector). For a typical user signing in once and using the app for 1 hour, pullAll fires ~6 times (2 startup + 4 SyncWorker ticks × 2) → 66 RPC calls. With 2000-row limits per table, that's a lot of redundant network traffic.
- **Expected behavior:** Desktop uses TanStack Query's `cache-then-network` per-query (each entity type is its own query, with its own cache + invalidation). Android has a monolithic `pullAll` that re-fetches everything.
- **Proposed resolution:** Desktop uses TanStack Query's `cache-then-network` per-query (each entity type is its own query, with its own cache + invalidation). Android has a monolithic `pullAll` that re-fetches everything.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-011 — `audit()` helper hardcodes demo tenant ID + never captures actor role

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-051 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-011, second-pass TENANT-104
- **Description:** The `audit()` helper function in `LocalRepositories.kt:1544-1550` builds an `AuditLogEntity` with: (1) `tenantId = "00000000-0000-0000-0000-000000000001"` (hardcoded demo tenant); (2) `actorRole = null` (never captured); (3) `note = null` (never captured). Every audit log entry written by `LocalParentRepository`, `LocalStudentRepository`, `LocalPaymentRepository`, `LocalInstallmentRepository`, `LocalLedgerRepository` (and the `auditLog()` helper in LocalRepositories2.kt) uses this helper — so EVERY audit log entry in the app is tagged to the demo tenant and has null actor role, regardless of the actual session.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1544-1550` ;; [TENANT-104] `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:380, 384, 501, 576, 580, 608, 955, 1179, 1266, 1545, 1553`; `LocalRepositories2.kt:146, 693, 805, 852, 886, 976, 1055, 1150, 1198, 1272, 1408, 1466, 1570, 1735, 1954`. Also `DatabaseSeeder.kt:35`. Also `SharedDtoMappers.kt:144, 164, 185, 206, 218, 237, 254, 268, 295` (DTO-to-entity mappers default to demo UUID when DTO has null tenant_id).
- **Evidence:** Audit evidence (Confirmed). Git: `LocalRepositories.kt:1544-1550` last touched in `94471e8` (2026-08-28)
- **Root cause:** The `audit()` helper was written as a convenience to reduce boilerplate. The developer hardcoded the demo tenantId because the canonical tenant ID at the time was the demo value. The `actorRole` parameter was never threaded through because the helper's signature was kept short. Multi-tenant support and role-based audit queries were never a priority.
- **Current behavior:** Multi-tenant deployments are impossible (all audit logs are tagged to the demo tenant). Role-based audit queries (e.g. "show all actions by FINANCIAL_OFFICER role") return nothing (actorRole is always null).
- **Expected behavior:** Desktop's audit log captures `actorRole` per the desktop's BUSINESS-003 finding (which noted desktop's refund hardcodes "Manual refund" as reason and drops actor identity — Android has the same problem with actorRole).
- **Proposed resolution:** Desktop's audit log captures `actorRole` per the desktop's BUSINESS-003 finding (which noted desktop's refund hardcodes "Manual refund" as reason and drops actor identity — Android has the same problem with actorRole).
- **Dependencies:** none recorded
- **Absorbed findings:** TENANT-104: The Android's `LocalParentRepository.createParent` (LocalRepositories.kt line 380, 384) creates a `ParentEntity` with `tenantId = "00000000-0000-0000-0000-000000000001"` regardless of the signed-in user's actual tenant. The same hardcoding appears in `LocalStudentRepository.createStudent` (line 501, 576, 580, 608), `LocalPaymentRepository.collect` (line 955), the `audit()` helper (line 1545, 1553), and 30+ other sites in LocalRepositories.kt + LocalRepositories2.kt. The local cache rows are stamped with the DEMO tenant UUID even when the user is signed in to a different tenant.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-012 — `PullSyncRepository.pullParents` / `pullStudents` fallback table select has NO tenant filter — multi-tenant data leak risk

- **Category:** WEAK  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-051 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-012
- **Description:** `PullSyncRepository.pullParents` (line 57-68) tries the `pull_parents_for_sync` RPC first; if that fails, falls back to a direct `postgrest.from("parents").select { limit(2000) }` — NO tenant filter. Same for `pullStudents` (line 98-109), `pullPayments`, `pullLedgerEntries`. The fallback path pulls the FIRST 2000 rows from the table REGARDLESS of tenant — if Supabase RLS fails or is misconfigured, the app pulls OTHER TENANTS' parent/student/payment/ledger data into local Room storage.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt:57-68, 98-109, 132-139, 163-170`
- **Evidence:** Audit evidence (Confirmed). Git: `PullSyncRepository.kt` last touched in `dd4c7dc` "kk" (2026-08-26)
- **Root cause:** The fallback path was written as a "real table select" when the RPC failed, but the developer didn't replicate the RPC's `p_tenant_id` filter into the fallback query. The fallback was a defensive measure that introduced a multi-tenant leak.
- **Current behavior:** If the production Supabase has correct RLS, the fallback path is filtered by RLS and only returns the user's tenant. If RLS is misconfigured (e.g. the policy is ` USING (true)`), the fallback returns ALL tenants' data → leaks to local Room → displayed in the app's UI.
- **Expected behavior:** The RPC path `pull_parents_for_sync(p_tenant_id, ...)` correctly filters by tenant — the fallback path bypasses this filter.
- **Proposed resolution:** The RPC path `pull_parents_for_sync(p_tenant_id, ...)` correctly filters by tenant — the fallback path bypasses this filter.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-016 — `useHomeworkRealtime` subscribes to the LEGACY `homework_assignments` table with a `target_class_id` filter; the canonical table is `homework` (migration 0029) using `class_id` — realtime is silently broken

- **Category:** WEAK  |  **Severity:** High  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-032): useHomeworkRealtime subscribes to the CANONICAL `homework` table (0029) with class_id=eq.<id> instead of the unwritten legacy homework_assignments/target_class_id. Source scan pins it; the portal's useHomework query already read `homework`. GAP: live end-to-end with a desktop homework push.
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-032 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-016, second-pass HOMEWORK-102
- **Description:** The `useHomeworkRealtime` hook subscribes to Supabase Realtime `postgres_changes` events on table `homework_assignments` filtered by `target_class_id=eq.${classId}`. But: (1) the canonical homework table is `homework` (created by desktop migration 0029_academics_module.sql:95 `CREATE TABLE IF NOT EXISTS public.homework`) — the legacy `homework_assignments` table (from migration 0004) is *"no longer written by any platform"* per the website's own `database.ts:558-562` comment; (2) the canonical `homework` table uses the column `class_id`, NOT `target_class_id` (which was the legacy column name). The `useHomeworkForClass` data hook (portal-queries.ts:178) queries the CORRECT table (`homework`) but the realtime hook subscribes to the WRONG table with the WRONG column. No realtime events ever fire → the homework view NEVER receives live updates when staff pushes new homework.
- **Location:** `elimtiyaz-website/src/lib/hooks/use-realtime.ts:133-145` ;; [HOMEWORK-102] - `elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:185-202` (table definition) - `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:281-294` (RLS policies) - `elimtiyaz-desktop/supabase/migrations/0020_indexes.sql:45` (index) - `elimtiyaz-website/src/lib/hooks/use-realtime.ts:136-145` (realtime subscription to dead table — already documented as WEAK-016) - `elimtiyaz-website/src/features/calendar/calendar-view.tsx:103` (comment lies: says "from homework_assignments" but the actual query uses `useHomeworkForClass` which reads canonical `homework` table) - `elimtiyaz-website/src/lib/types/database.ts:560-596` (typed `HomeworkAssignmentRow` interface still defined — typed for a dead table) - `elimtiyaz-website/src/lib/types/database.ts:851` (Database interface still declares `homework_assignments` table)
- **Evidence:** Audit evidence (Confirmed). Git: The hook was written in commit `e90dbf7` "mid" (2026-08-01) when the schema was still assumed to be `homework_assignments` (legacy). The canonical `homework` table migration (0029) was already in the desktop repo, but the website's hook was not updated when the website's `useHomeworkForClass` was corrected to query `homework` (in the same commit `e90dbf7`, per the database.ts comment).
- **Root cause:** The author updated `useHomeworkForClass` to use the canonical `homework` table but forgot to update the parallel `useHomeworkRealtime` hook. The queryKey prefix was updated (to `["homework", classId]`) but the table name and filter column were not.
- **Current behavior:** Other realtime hooks (`useNotificationsRealtime`, `useChatMessagesRealtime`, `useFinancialRealtime`) correctly subscribe to their canonical tables. Only `useHomeworkRealtime` is broken.
- **Expected behavior:** N/A — this is a unique bug.
- **Proposed resolution:** Point useHomeworkRealtime at the canonical homework table with the class_id filter; drop the legacy homework_assignments subscription. Test: an insert into homework for the watched class triggers invalidation (supabase test harness or integration environment).
- **Dependencies:** none recorded
- **Absorbed findings:** HOMEWORK-102: The legacy `homework_assignments` table (migration 0004 line 185-202) is still in the DB schema with: RLS policies (migration 0019 line 281-294 — `homework_select`, `homework_teacher_write`, `homework_teacher_update`), indexes (migration 0020 line 45 — `ix_homework_due_active`), and a `touch_updated_at` trigger (migration 0004 line 244). No migration drops the table. But NO code anywhere writes to or reads from it (verified by `rg "from\(['\"]homework_assignments['\"]\)"` — zero matches across all 3 repos). The website's `useHomeworkRealtime` (`use-realtime.ts:136-145`) subscribes to this dead table with `target_class_id` filter — a wasted realtime channel that never fires (because no INSERT ever happens on the table).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-017 — Typed `Database` interface has `homework_assignments` (legacy 0004) but NOT `homework` (canonical 0029) — queries use `as unknown as` cast, no type-checking

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Backend/DB, Website
- **Task:** T-057 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-017
- **Description:** The typed `Database` interface in `src/lib/types/database.ts:851` declares `homework_assignments: { Row: HomeworkAssignmentRow; ... }` (the legacy table from migration 0004) but does NOT declare `homework` (the canonical table from migration 0029). The `useHomeworkForClass` hook (portal-queries.ts:178) queries `.from("homework")` (the canonical table) and casts the result with `as unknown as HomeworkRow[]` — bypassing type-checking. The `HomeworkAssignmentRow` type (database.ts:583-596) is dead — defined and registered in the Database interface but never queried by any hook. The `HomeworkRow` type (database.ts:564-581) is the canonical shape but is NOT registered in the Database interface.
- **Location:** `elimtiyaz-website/src/lib/types/database.ts:557-596` (both homework types) + `:851` (Database.Tables entry)
- **Evidence:** Audit evidence (Confirmed). Git: The `HomeworkAssignmentRow` and Database entry were introduced in commit `e90dbf7` "mid" (2026-08-01). The `HomeworkRow` (canonical) was added in the same commit but never registered in the Database interface.
- **Root cause:** The author updated the `useHomeworkForClass` hook to query the canonical `homework` table but forgot to update the typed Database interface to match. The `as unknown as HomeworkRow[]` cast was used to silence the type error instead of fixing the root cause (registering the canonical table in the Database interface).
- **Current behavior:** The typed Database reflects the LEGACY schema (homework_assignments) rather than the CANONICAL schema (homework). Any future type-safe query against `homework` would be rejected by the type system.
- **Expected behavior:** Desktop's migration 0029_academics_module.sql:95 `CREATE TABLE IF NOT EXISTS public.homework` is canonical.
- **Proposed resolution:** Desktop's migration 0029_academics_module.sql:95 `CREATE TABLE IF NOT EXISTS public.homework` is canonical.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-018 — Dashboard "next installment" KPI uses non-canonical `amount_due - amount_paid` (cleared-only); financial-view uses canonical `installmentRemainingAmount` (due - paid - pending) — cross-view inconsistency

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Found ALREADY FIXED in the sources during T-035 (2026-08-31): dashboard-view calls the canonical installmentRemainingAmount (the inline cleared-only formula from the audit no longer exists) — the fix landed with the session-8 portal restructure but this entry was never closed. Registry correction + pinning test added (ledger-paging.test.ts WEAK-018 case); no code change required.
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Desktop, Website
- **Task:** T-035 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-018
- **Description:** The dashboard's "next installment" KPI at line 192 displays `formatCurrency(nextInstallment.amount_due - nextInstallment.amount_paid)` — a CLEARED-ONLY remaining amount (ignores `amount_pending`). The financial-view's `InstallmentRowView` at line 272 uses `installmentRemainingAmount(inst)` which computes `clampNonNegative(amount_due - amount_paid - amount_pending)` — the CANONICAL INV-4 remaining (uncleared pending funds reduce what the parent owes). The dashboard IMPORTS `installmentRemainingAmount` (line 33) but NEVER CALLS IT — the import is dead. So the same parent, on the same day, sees TWO DIFFERENT "remaining" values for the same installment: a higher value on the dashboard (cleared-only), a lower value on the financial view (cleared - pending).
- **Location:** `elimtiyaz-website/src/features/dashboard/dashboard-view.tsx:33` (import) + `:192` (non-canonical inline formula)
- **Evidence:** Audit evidence (Confirmed). Git: The dashboard's inline formula was introduced in commit `e90dbf7` "mid" (2026-08-01). The `installmentRemainingAmount` import was added in commit `03f6365` (2026-08-28) when the canonical port was added — but the dashboard's inline formula was not refactored to use it.
- **Root cause:** The canonical port commit added the `installmentRemainingAmount` import to the dashboard (presumably intending to refactor the inline formula) but didn't actually replace the inline formula. The import is a leftover from an incomplete refactor.
- **Current behavior:** Dashboard: `remaining = amount_due - amount_paid` (cleared-only). Financial-view: `remaining = amount_due - amount_paid - amount_pending` (canonical INV-4). If a parent has a 5000 DZD installment with 3000 paid + 1500 pending (uncleared check), the dashboard shows 2000 DZD remaining; the financial view shows 500 DZD remaining.
- **Expected behavior:** `installmentRemainingAmount` in `portal-derive.ts:115-119` is canonical (matches the backend waterfall `amount_due - amount_paid - amount_pending` per migration 0034 and the Android `Installment.remaining`).
- **Proposed resolution:** `installmentRemainingAmount` in `portal-derive.ts:115-119` is canonical (matches the backend waterfall `amount_due - amount_paid - amount_pending` per migration 0034 and the Android `Installment.remaining`).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-019 — `attendance-view.tsx` computes attendance rate as `present / total` (excludes late); canonical rule (per portal-derive.ts) is `(present + late) / total` — dashboard uses canonical, attendance-view doesn't

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Desktop, Website
- **Task:** T-027 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-019, second-pass ATT-102, second-pass GRADE-101
- **Description:** The attendance-view's `stats.rate` at line 81 computes `Math.round((out.present / out.total) * 100)` — counting ONLY `present` as attended, excluding `late`. The canonical `calculateAttendanceRate` (per `portal-derive.ts:197` comment: *"present + late count as attended"*) counts BOTH `present` AND `late` as attended. The dashboard-view (line 116) uses `attendanceRatePercent(attendance.data)` which calls the canonical `calculateAttendanceRate`. So the same parent sees: dashboard KPI = (present + late) / total × 100; attendance view KPI = present / total × 100. If a student has 18 present, 2 late, 0 absent → dashboard shows 100%, attendance view shows 90%.
- **Location:** `elimtiyaz-website/src/features/attendance/attendance-view.tsx:81` ;; [ATT-102] - `elimtiyaz-desktop/src/features/academics/narrative-generator-modal.tsx:141-143` (wrong formula) - `AgentGithubUplaad/elimtiyaz-desktop/src/domain/model/academic.ts:279-294` (canonical `calculateAttendanceRate` — `(present + late) / total`) - `elimtiyaz-website/src/lib/canonical/portal-derive.ts:287-294` (canonical rule on the website) - `AgentGithubUplaad/elimtiyaz-desktop/src/features/crm/student-detail/academic-tab.tsx:293-294` (uses canonical function correctly — divergence within the same desktop app) ;; [GRADE-101] - `elimtiyaz-website/src/lib/bulletin.ts:153-158` (4 separate counts, no rate) - `elimtiyaz-website/src/lib/bulletin.ts:222-237` (KPI card shows `att.present` only) - `elimtiyaz-website/src/lib/canonical/portal-derive.ts:287-294` (canonical rate — not used by bulletin)
- **Evidence:** Audit evidence (Confirmed). Git: The attendance-view's inline formula was introduced in commit `e90dbf7` "mid" (2026-08-01). The canonical `attendanceRatePercent` was added in commit `03f6365` (2026-08-28) — but the attendance-view was not refactored to use it (only the dashboard was).
- **Root cause:** The canonical port commit added `attendanceRatePercent` and refactored the dashboard to use it, but didn't refactor the attendance-view (which has its own inline rate computation). The attendance-view's comment at line 7-8 also says *"The portal CANNOT submit justifications"* — outdated (see DRIFT-010) — suggesting the file wasn't reviewed during the canonical port.
- **Current behavior:** Attendance-view: `rate = present / total`. Dashboard: `rate = (present + late) / total`. The attendance-view UNDERREPORTS the attendance rate (late counts as absent).
- **Expected behavior:** `attendanceRatePercent` in `portal-derive.ts:199-213` is canonical (calls `calculateAttendanceRate` which counts present + late as attended).
- **Proposed resolution:** Use the canonical calculateAttendanceRate ((present + late) / total) in attendance-view.tsx, narrative-generator-modal.tsx, and the bulletin 'Presences' KPI (or relabel to raw counts explicitly). Cross-platform check: dashboard, attendance view, narrative, bulletin all agree for a student with late arrivals.
- **Dependencies:** none recorded
- **Absorbed findings:** ATT-102: `narrative-generator-modal.tsx` line 141-143 computes `attendanceRate = attendance.length === 0 ? 1.0 : attendance.filter((r) => r.status === "present").length / attendance.length`. This is `present / total` (excludes late). The canonical rule (per `portal-derive.ts:287-294` and the desktop's own `calculateAttendanceRate` in `domain/model/academic.ts:279`) is `(present + late) / total`. The wrong attendance rate is then sent to the AI narrative generator (line 159 `attendanceRate`) and persisted in `student_academic_histories.narrative` (canonical 0029 column) for the year-end promotion flow. | GRADE-101: The website's bulletin PDF generator (`bulletin.ts:153-158`) computes 4 separate attendance counts: `present`, `excused`, `unexcused`, `late`. The KPI card labeled "Présences" (line 224) shows `${att.present}` ONLY — the count of students with status `present` (on-time arrivals), NOT the canonical attendance rate `(present + late) / total` that `portal-derive.ts:287-294` defines. A student with 18 present + 2 late + 0 absent (out of 20 days) sees "Présences: 18" on the bulletin — but their canonical attendance rate is 100%. The bulletin has no rate KPI at all, only raw counts.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-020 — `paymentStatusTone` doesn't handle `cancelled` or `pending_clearance` statuses — renders the raw status string instead of a translated label

- **Category:** WEAK  |  **Severity:** Low  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-056.5, website commit 3c1b430): paymentStatusTone maps cancelled (muted) + pending_clearance (warning); fr/ar/en dictionary keys added. 119/119 website tests (2 new cases) + strict build green.
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-056 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-020
- **Description:** The `paymentStatusTone` function in `status-pill.tsx:53-70` handles only `paid`, `partial`, `pending`, `unpaid`, `overdue`, `refunded`. The canonical `PaymentStatus` enum (per `portal-derive.ts:235-244`) has 8 values: `pending, partial, paid, overdue, refunded, cancelled, pending_clearance, unpaid`. The two missing statuses (`cancelled`, `pending_clearance`) fall through to the `default` case which returns `{ tone: "muted", key: status }` — passing the raw status string as the i18n key. The `t("cancelled")` call returns the literal string "cancelled" (no translation), and `t("pending_clearance")` returns "pending_clearance". So a cancelled payment renders a "cancelled" pill (English, untranslated) and a pending-clearance payment renders "pending_clearance" (raw enum value).
- **Location:** `elimtiyaz-website/src/features/shared/status-pill.tsx:53-70`
- **Evidence:** Audit evidence (Confirmed). Git: `status-pill.tsx` introduced in commit `e90dbf7` "mid" (2026-08-01). The canonical enum was formalized in commit `03f6365` (2026-08-28) but `paymentStatusTone` was not updated.
- **Root cause:** The author wrote `paymentStatusTone` based on the statuses they encountered in practice (paid, partial, pending, unpaid, overdue, refunded) and didn't handle the rarer `cancelled` / `pending_clearance` cases. The default fallback (`key: status`) renders the raw string, which is a silent UX bug.
- **Current behavior:** `cancelled` and `pending_clearance` payments render with raw English enum values instead of translated French/Arabic labels.
- **Expected behavior:** The canonical `PaymentStatus` enum (portal-derive.ts:235-244) has 8 values.
- **Proposed resolution:** The canonical `PaymentStatus` enum (portal-derive.ts:235-244) has 8 values.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-021 — README claims "68 tests passing" and DONE.md claims "68/68" but the actual count is 87 (after commit 03f6365 added 19 new tests)

- **Category:** WEAK  |  **Severity:** Low  |  **Status:** VERIFIED
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** — (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-021
- **Description:** The README (line 224) says *"Current status: 68 tests passing, 0 lint errors, build succeeds."* The DONE.md (line 93) says *"Tests: 68/68 passing (no new tests added — the new features are mostly UI and require Supabase; documented in TODO.md as a future enhancement)"*. The worklog.md (line 91-96) lists 4 test files totaling 68 tests. But the latest commit `03f6365` added a 5th test file `portal-derive.test.ts` with 19 new tests. The actual count is now 87 (verified: format.test.ts=23 + dictionary.test.ts=11 + validation.test.ts=22 + status-pill.test.ts=12 + portal-derive.test.ts=19 = 87). The commit message itself says *"vitest 87/87"* — confirming the count is 87, not 68. The README and DONE.md were not updated.
- **Location:** `elimtiyaz-website/README.md:224` + `elimtiyaz-website/DONE.md:93`
- **Evidence:** Audit evidence (Confirmed). Git: The README/DONE.md claims were written in commit `e90dbf7` "mid" (2026-08-01) when there were 4 test files. Commit `03f6365` (2026-08-28) added `portal-derive.test.ts` with 19 tests but did NOT update the README or DONE.md.
- **Root cause:** The canonical port commit added tests but didn't update the docs. The commit message correctly says "87/87" but the human-readable docs were forgotten.
- **Current behavior:** Docs: 68 tests. Reality: 87 tests.
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Status note:** Resolved by the 2026-08-29 documentation reset: README.md/DONE.md/worklog.md (which carried the false 68-test claim) were deleted. The new documentation makes no test-count claims. Evidence: post-reset file inventory shows zero legacy .md files.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-022 — `useLedgerEntries` fetches with `.limit(500)`; `portalFinancialSummary` replays ONLY 500 entries — balance computation is WRONG for parents with > 500 ledger entries

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-035, website commit e9587e0): fetchAllLedgerEntries pages ledger_entries with .range() (1000/page) until a short page; useLedgerEntries delegates; both call sites dropped their { limit: 500 } cap. 5/5 tests incl. a 1500-row two-request fake-client case. GAP: live check with a real 500+-entry parent.
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-035 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-022
- **Description:** The `useLedgerEntries` hook (portal-queries.ts:344) fetches `ledger_entries` with `.limit(500)` (the `options.limit` default is 500 per the financial-view at line 103 and dashboard-view at line 95). The `portalFinancialSummary` function (portal-derive.ts:92-106) calls `parentSummaryFromLedger(rows, parentId, ...)` which calls `computeParentSummary(entries, ...)` which replays ALL `rows` to compute the balance. If a parent has > 500 ledger entries (charges + payments + adjustments + refunds + reversals + transfers over multiple years), the canonical balance computation only sees the FIRST 500 (ordered by `at ASC` per portal-queries.ts:343). The balance would be WRONG — missing the entries beyond the 500 limit. The desktop's `compute_parent_summary` SQL RPC has NO such limit (it queries the entire ledger).
- **Location:** `elimtiyaz-website/src/lib/hooks/portal-queries.ts:331-351` (useLedgerEntries) + `src/lib/canonical/portal-derive.ts:92-106` (portalFinancialSummary) + `src/features/financial/financial-view.tsx:103` (call site with `limit: 500`) + `src/features/dashboard/dashboard-view.tsx:95` (call site with `limit: 500`)
- **Evidence:** Audit evidence (Likely (the limit IS 500; whether any parent has > 500 entries depends on the school's size and history)). Git: `useLedgerEntries` introduced in commit `03f6365` (2026-08-28) as part of the canonical port. The `limit: 500` was chosen to keep the payload reasonable but wasn't validated against the canonical rule that balances must replay the ENTIRE ledger.
- **Root cause:** The author added the ledger-replay balance computation (replacing the previous installment-sum approach) but kept the `.limit(500)` from the previous fetch pattern, not realizing that balance computation requires the FULL ledger. The canonical INV-1 rule states *"balances are NEVER stored, always replayed"* — but replaying only 500 entries violates this.
- **Current behavior:** Parent with 600 ledger entries: desktop/SQL shows the correct balance (replays all 600). Website shows a balance computed from only the first 500 entries (missing the latest 100 — but ordered by `at ASC`, so the OLDEST 500 are kept and the NEWEST 100 are dropped — meaning recent payments are missed, inflating the outstanding balance).
- **Expected behavior:** The desktop's `compute_parent_summary` SQL RPC (migration 0042) has no row limit — it replays the entire parent ledger.
- **Proposed resolution:** The desktop's `compute_parent_summary` SQL RPC (migration 0042) has no row limit — it replays the entire parent ledger.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-023 — `useUnreadChatCount` fetches 500 messages across ALL channels (no channel filter in query), counts client-side — comment claims "200 per channel"

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** TESTED (2026-08-29, T-065)
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-065 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass WEAK-023
- **Description:** The `useUnreadChatCount` hook (portal-queries.ts:484-518) fetches up to 500 messages from `chat_messages` with NO channel filter in the query — it relies on RLS to return only messages from channels the user is a member of. Then it counts client-side how many are unread (author ≠ user AND no `read_by` entry for the user). The comment at lines 491-493 says *"We fetch the latest 200 messages per channel via a single query"* — but the actual query has `.limit(500)` TOTAL, not 200 per channel. The comment is wrong AND the approach is inefficient (loads messages from all channels, including ones the user doesn't care about) and incorrect (if total unread + read messages across all channels > 500, the count is wrong).
- **Location:** `elimtiyaz-website/src/lib/hooks/portal-queries.ts:484-518`
- **Evidence:** Audit evidence (Confirmed). Git: The hook was introduced in commit `e90dbf7` "mid" (2026-08-01). The comment and the code have been inconsistent since then.
- **Root cause:** The author wrote the comment describing the intended behavior (200 per channel) but implemented a simpler version (500 total). The comment was never updated to match the implementation.
- **Current behavior:** Comment claims "200 per channel" but code does "500 total". The count is a lower bound (if > 500 messages exist, only the latest 500 are considered).
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-100 — Activation codes use Postgres random() (non-cryptographic); 7-digit space is brute-forceable; no rate limit on website activation endpoint

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Backend/DB, Desktop, Website
- **Task:** T-072 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass WEAK-100
- **Description:** Activation codes are generated using Postgres `random()` (migration 0005 line 169) which is a non-cryptographic PRNG. The codes are 7 digits (10M combinations). The website's activation-code-screen.tsx has no rate limiting, no lockout after failed attempts, and no idempotency check — making brute-force feasible.
- **Location:** - Code generation: `elimtiyaz-desktop/supabase/migrations/0005_crm.sql` lines 159-183 (generate_activation_code function) - Website submission: `elimtiyaz-website/src/features/auth/activation-code-screen.tsx` lines 46-117
- **Evidence:** Audit evidence (Confirmed). Git: 0005_crm.sql commit `b25e6ca` (2026-08-04); activation-code-screen.tsx via website commit `e90dbf79` (2026-08-01)
- **Root cause:** Postgres `random()` was used for convenience; the 7-digit space was chosen for human-readability. No one added rate limiting because the assumption was that codes are single-use and bound quickly.
- **Current behavior:** N/A
- **Expected behavior:** Activation codes should be generated with `gen_random_bytes()` or `gen_random_uuid()`, should be longer (12+ alphanumeric chars), and the submission endpoint should rate-limit by IP + account.
- **Proposed resolution:** Activation codes should be generated with `gen_random_bytes()` or `gen_random_uuid()`, should be longer (12+ alphanumeric chars), and the submission endpoint should rate-limit by IP + account.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### WEAK-101 — Android LocalAuthRepository stores user UUID as accessToken (fake JWT that doesn't validate server-side)

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** TESTED (2026-08-29, T-002)
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-002 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass WEAK-101
- **Description:** Android's `LocalAuthRepository.signIn` sets `accessToken = userInfo.id` (the user's UUID) instead of the actual JWT access token returned by Supabase Auth. The `refreshSession` method does the same. This fake token doesn't validate anything — if the Android app sends it to EFs or uses it for direct Supabase calls, those calls fail.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt`, lines 111-122 (Stage 1) and 235-247 (refreshSession)
- **Evidence:** Audit evidence (Confirmed). Git: Commit `f227de98` (2026-08-14, "Connect mobile app to Supabase")
- **Root cause:** The author confused `userInfo.id` (user UUID) with the JWT access token. The Supabase Kotlin SDK's `Auth.signOut()` and other methods manage the JWT internally — the `Session.accessToken` field is just metadata for the app's own use. The author treated it as the actual token.
- **Current behavior:** Desktop + website use real JWT. Android uses user UUID as a fake token.
- **Expected behavior:** The Supabase Kotlin SDK's `auth.currentAccessTokenOrNull()` returns the real JWT. The Session should store that.
- **Proposed resolution:** The Supabase Kotlin SDK's `auth.currentAccessTokenOrNull()` returns the real JWT. The Session should store that.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.
- **Resolution (2026-08-29, T-002 — TESTED):** `signIn` and `refreshSession` now restore the SDK's real `UserSession` (`currentSessionOrNull()`); `Session.accessToken` = `UserSession.accessToken` (the real JWT), `refreshToken` = the SDK refresh token, `expiresAt` = `UserSession.expiresAt` converted to epoch-ms. The pure `buildServerSession()` passes these through verbatim — pinned by tests. Evidence: android commit `1aa34a7`; hub change-log sixth session. Owed for VERIFIED: a server-side validated call using the stored token.

---

### WEAK-200 — `enforce_payment_proof` trigger runs on EVERY payment INSERT/UPDATE; Android refund sync triggers re-validation of unchanged proof fields

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-061 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass WEAK-200
- **Description:** Migration 0007 (lines 142-171) declares the `enforce_payment_proof` trigger as `BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW`. The trigger function checks: if method=check → proof_path, check_number, check_bank_name must be non-null; if method=transfer → proof_path, transfer_reference must be non-null. When Android's refund sync pushes a payment status update via `upsert_payment_from_import` (migration 0027:644-667), the UPDATE branch sets `status`, `parent_id`, `student_id`, `installment_id`, `amount`, `method`, `category`, `proof_path`, `collected_at`, `collected_by`, `notes`, etc. The trigger fires on this UPDATE and re-validates the proof requirements. If the existing payment's `proof_path` was somehow NULL (e.g., it was inserted by an older code path that didn't enforce proof), the UPDATE will FAIL with "Proof upload is mandatory for check payments". The Android sync dispatcher swallows the error (CROSS-200) → entry marked "synced" → refund never actually persisted server-side.
- **Location:** - `elimtiyaz-desktop/supabase/migrations/0007_financial.sql:142-171` (trigger definition) - `elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:644-667` (UPDATE branch of upsert_payment_from_import)
- **Evidence:** Audit evidence (Likely (the trigger DOES fire on UPDATE per its declaration; the failure mode requires a pre-existing row with NULL proof_path, which shouldn't happen for valid check/transfer payments but CAN happen for legacy/corrupted data).). Git: migration 0007: initial schema.
- **Root cause:** The trigger was written to enforce proof at the database level (good defense in depth) but the `BEFORE INSERT OR UPDATE` clause was copy-pasted without considering that UPDATEs may be partial (status-only).
- **Current behavior:** The trigger re-validates proof on EVERY UPDATE — including status-only updates (refund status flip) that have nothing to do with proof.
- **Expected behavior:** The trigger should validate proof on INSERT only (when the payment is first created) and skip re-validation on UPDATE unless `method` is being changed.
- **Proposed resolution:** The trigger should validate proof on INSERT only (when the payment is first created) and skip re-validation on UPDATE unless `method` is being changed.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

## Dead & Unreachable Code

### DEAD-002 — `update-server-secret` Edge Function exports a `handleDelete` that is never wired

- **Category:** DEAD  |  **Severity:** Medium  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-056.4, hub commit e412e44): Deno.serve routes DELETE to handleDelete; 405 message updated. EF redeployed live via the Management API (update-server-secret vNEXT deploy 201, 401 smoke green). Source-scan guard in t-056-hygiene.test.ts.
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-056 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DEAD-002
- **Description:** The `update-server-secret/index.ts` file exports a `handleDelete(req)` function (line 195) intended to handle DELETE requests for clearing server secrets. But the `Deno.serve` handler (line 67) only handles POST (and OPTIONS via `handleOptions`). The DELETE handler is exported but never invoked — Deno.serve never routes DELETE requests to it. The DELETE functionality (clearing a secret via the Supabase Management API) is completely unreachable through the HTTP path.
- **Location:** `elimtiyaz-desktop/supabase/functions/update-server-secret/index.ts:195-247`
- **Evidence:** Audit evidence (Confirmed). Git: `update-server-secret/index.ts` last modified in `9e1e774` (2026-08-12 "kay"). The `handleDelete` was added with a comment "Also support DELETE (to clear a secret)" but never wired.
- **Root cause:** The developer wrote the DELETE logic as a separate exported function, intending to add a method dispatcher, but only finished the POST path. The Deno.serve entry never grew a switch on `req.method`.
- **Current behavior:** N/A
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-007 — `AuditActions.kt` contains many audit action constants that the Android app never invokes

- **Category:** DEAD  |  **Severity:** Low  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-062, 13th session): 76 never-referenced constants removed after a per-constant reachability scan; AuditActions now declares only the 12 actions the app actually writes, with the declare-at-write-time rule documented and the desktop registry referenced. Pinned by DeadCodeT062Test.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-062 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DEAD-007
- **Description:** `AuditActions.kt` defines 60+ audit action string constants for "wire-protocol compatibility" with the desktop. Many are NEVER invoked from Android code: - `ACCOUNT_APPROVAL_APPROVE`, `ACCOUNT_APPROVAL_REJECT`, `ACCOUNT_APPROVAL_EXPIRE_BATCH` — Android doesn't call `approve-signup-request` or `expire-pending-approvals` Edge Functions - `ACTIVATION_CODE_BIND`, `ACTIVATION_CODE_GENERATE` — Android doesn't call `bind-activation-code` Edge Function (the desktop does, per desktop CROSS-004) - `BACKUP_CREATED`, `BACKUP_RESTORED`, `BACKUP_PURGE` — Android has no backup feature - `WORKFLOW_PUBLISHED`, `WORKFLOW_TRIGGERED`, `WORKFLOW_RUN`, `WORKFLOW_RETRY` — Android only calls `workflow-execute` Edge Function for retry (line 1842-1850 of LocalRepositories2.kt); doesn't publish or trigger workflows - `OVERDUE_SCAN_RUN` — Android doesn't call `run-overdue-scan` Edge Function - `MATERIALIZED_VIEWS_REFRESH` — Android doesn't call `refresh-materialized-views` Edge Function - `SERVER_SECRET_UPDATE` — Android doesn't call `update-server-secret` Edge Function - `AI_NARRATIVE_DRAFTED`, `AI_NARRATIVE_APPROVED`, `AI_NARRATIVE_REJECTED`, `AI_DRAFT_GENERATED`, `AI_DRAFT_SENT`, `AI_ANOMALY_FLAGGED`, `AI_…
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/core/AuditActions.kt:8-116`
- **Evidence:** Audit evidence (Confirmed). Git: `AuditActions.kt` last touched in `176f5d2` "mid" (2026-08-21)
- **Root cause:** The Android file was copied verbatim from the desktop's `audit-action.ts` to ensure the wire-protocol strings match. But the desktop's set includes actions for features Android doesn't have (backups, AI, workflow publishing, account approval, etc.). The constants were left in for "completeness" — but they mislead maintainers into thinking Android implements these features.
- **Current behavior:** N/A
- **Expected behavior:** Desktop's `audit-actions.ts` (per the file's KDoc "mirrors the desktop `src/core/audit-actions.ts`")
- **Proposed resolution:** Desktop's `audit-actions.ts` (per the file's KDoc "mirrors the desktop `src/core/audit-actions.ts`")
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-008 — `StubRepositories.kt` is a 2-line stub file with only a comment

- **Category:** DEAD  |  **Severity:** Low  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-062, 13th session): StubRepositories.kt deleted — its absence is pinned by DeadCodeT062Test.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-062 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DEAD-008
- **Description:** `StubRepositories.kt` is 2 lines: a comment line `// Stub repositories removed — real Supabase implementations are in infrastructure/supabase/.` and a blank line. The file is a placeholder from when stub repositories were removed. No `package` declaration, no imports, no classes — Kotlin won't even compile this if it's listed in the source set without a package declaration... Actually wait, the file is just a comment, so it compiles to nothing. But the file exists.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/infrastructure/stub/StubRepositories.kt`
- **Evidence:** Audit evidence (Confirmed). Git: File last touched in `e9aa7a3` "first commit" (2026-07-25) — original commit; never modified since
- **Root cause:** The stub repositories were removed (per the comment), but the file was left as a "tombstone" marker. The comment is misleading — it claims "real Supabase implementations are in infrastructure/supabase/" but per ARCH-003, there are NO Supabase*Repository implementations on Android.
- **Current behavior:** N/A
- **Expected behavior:** N/A — file is a comment-only placeholder
- **Proposed resolution:** N/A — file is a comment-only placeholder
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-009 — `ElGalleryActivity` (833 lines across gallery files) is NOT declared in `AndroidManifest.xml` — unreachable in production

- **Category:** DEAD  |  **Severity:** Low  |  **Status:** TESTED
- **Status note:** FIXED 2026-08-31 (T-062, 13th session): the 833-line gallery showcase deleted (deletion chosen over dev-only manifest registration per the reachability rule); zero dangling references; manifest clean; debug APK assembles at 29.8 MB.
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-062 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DEAD-009
- **Description:** The design system gallery (`ElGalleryActivity` + `ElGalleryScreen` + `GallerySection` + 5 tabs) is 833 lines of code that showcases the new design system's components, foundations, and overlays. The KDoc at `ElGalleryActivity.kt:22-28` documents launching via `adb shell am start -n com.aistudio.elimtiyazstaff.bxmzlx/.ElGalleryActivity` — but the activity is NOT declared in `AndroidManifest.xml` (verified via grep — no "Gallery" in manifest). So the activity cannot be launched in production; `adb shell am start` would fail with "Activity not found".
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/ui/designsystem/gallery/ElGalleryActivity.kt:30` + 7 other gallery files (total 833 lines)
- **Evidence:** Audit evidence (Confirmed). Git: Gallery files last touched in `dd4c7dc` "kk" (2026-08-26); the manifest was last touched in `9c19424` "mid" (2026-08-14) — the gallery was added after the manifest was last edited, so the manifest entry was never added.
- **Root cause:** The gallery was built as a developer showcase for the new design system. The KDoc says it's launched via `adb shell am start` (a developer workflow), implying the developer didn't intend it for production users. But the manifest entry was never added, so even the `adb shell am start` workflow doesn't work without first editing the manifest.
- **Current behavior:** N/A
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-012 — `vitest.config.ts` references `./src/test/setup.ts` which DOES NOT EXIST; DONE.md and worklog.md both claim it was created

- **Category:** DEAD  |  **Severity:** High  |  **Status:** PARTIAL (unblocked 2026-08-29, task T-009 prerequisite — full cleanup remains T-049)
- **Status note:** ROOT CAUSE CORRECTED (discovered 2026-08-29, important): the registry blamed a forgotten `git add` / documentation lie. The TRUE cause: the website's `.gitignore` carried a bare `test` rule that silently ignored ANY path named `test` — including `src/test/` — so the setup file could never be committed (the author likely had it on disk; git refused to track it). Fix applied: bare `test` rule removed from .gitignore (verified it hid nothing else outside node_modules), minimal `src/test/setup.ts` committed — the entire website suite (90 tests) runs again. T-049 still owns the full cleanup (RTL setup, polyfills audit, strict build / ARCH-005). Evidence: change-log 2026-08-29 / website commit 864eca6.
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-049 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DEAD-012
- **Description:** The `vitest.config.ts` file at line 8 configures `setupFiles: ["./src/test/setup.ts"]` — but the file `src/test/setup.ts` does NOT exist in the repo (verified via `find` — no `src/test/` directory, no `setup.ts` file anywhere). The DONE.md (line 138) claims *"├── test/setup.ts # NEW — Vitest + RTL setup (was missing in iter 3)"* and the website's own worklog.md (line 178) claims *"Created src/test/setup.ts (was missing — vitest.config.ts referenced it but the file didn't exist)"* — both FALSE. The latest commit message `03f6365` claims *"vitest 87/87"* but if the setup file is missing, vitest would either error with "Cannot find module" or skip the polyfills (matchMedia, IntersectionObserver, ResizeObserver) that tests may depend on.
- **Location:** `elimtiyaz-website/vitest.config.ts:8` (references the file); `elimtiyaz-website/src/test/setup.ts` (DOES NOT EXIST)
- **Evidence:** Audit evidence (Confirmed (verified: `find /home/z/my-project/repos/elimtiyaz-website -name 'setup*'` returns nothing; `git log --all -- src/test/setup.ts` returns nothing — the file was NEVER committed)). Git: The vitest.config.ts was introduced in commit `e90dbf7` "mid" (2026-08-01) with the `setupFiles` reference. The DONE.md and worklog.md claims were in the SAME commit. The latest commit `03f6365` (2026-08-28) added 19 new tests but did NOT create the setup file.
- **Root cause:** The author wrote the vitest.config.ts with the intent to create the setup file, wrote the DONE.md/worklog.md entries claiming it was created, but forgot to actually `git add` the file. The setup file claim is a documentation lie. Alternatively, the file was created locally but never committed.
- **Current behavior:** Pre-bug (claimed): 68 tests passing with polyfills. Actual: 87 tests, setup file missing, polyfills undefined.
- **Expected behavior:** N/A
- **Proposed resolution:** N/A
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-013 — `package.json` `icons:generate` script hardcodes path `/home/z/my-project/scripts/generate-pwa-icons.py` (OUTSIDE the repo) — broken on any other machine/CI

- **Category:** DEAD  |  **Severity:** Low  |  **Status:** TESTED (2026-08-29)
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website
- **Task:** T-049 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DEAD-013
- **Description:** The `icons:generate` npm script in `package.json:13` is `"python3 /home/z/my-project/scripts/generate-pwa-icons.py"` — an ABSOLUTE path pointing OUTSIDE the repo. The actual script is at `/home/z/my-project/repos/elimtiyaz-website/scripts/generate-pwa-icons.py` (verified via `ls scripts/`). Running `bun run icons:generate` on any machine where `/home/z/my-project/scripts/generate-pwa-icons.py` doesn't exist (i.e., any machine that isn't the original developer's) would fail with "No such file or directory". The script is also referenced in the README (line 147) as `scripts/generate-pwa-icons.py` (the CORRECT relative path), contradicting the package.json absolute path.
- **Location:** `elimtiyaz-website/package.json:13`
- **Evidence:** Audit evidence (Confirmed). Git: The script path was added in commit `e90dbf7` "mid" (2026-08-01) when PWA icons were added. The absolute path was hardcoded (rather than `python3 ./scripts/generate-pwa-icons.py` or `python3 scripts/generate-pwa-icons.py`).
- **Root cause:** The author developed on the original machine where `/home/z/my-project/scripts/` existed (perhaps a shared scripts directory). They used the absolute path without considering portability. The relative path was used in README but not in package.json.
- **Current behavior:** Original developer's machine: works (the absolute path exists). Any other machine: fails.
- **Expected behavior:** The actual script lives at `./scripts/generate-pwa-icons.py` (relative to repo root).
- **Proposed resolution:** The actual script lives at `./scripts/generate-pwa-icons.py` (relative to repo root).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.
- **Status note (2026-08-29, T-049):** RESOLVED — `package.json` icons:generate now points at `python3 ./scripts/generate-pwa-icons.py` (the script exists in the repo and the path resolves on any machine).

---

### DEAD-014 — `database-schema.ts` barrel is imported by only ONE file (`supabase/client.ts`); all other 14 files import directly from `@/lib/types/database`

- **Category:** DEAD  |  **Severity:** Low  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-056.6, website commit 3c1b430): the unused database-schema.ts barrel deleted; supabase/client.ts imports '@/lib/types/database' directly like the other 14 files.
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Backend/DB, Website
- **Task:** T-056 (docs/recovery/task-registry.md)
- **Consolidated from:** first-pass DEAD-014
- **Description:** The file `src/lib/types/database-schema.ts` (13 lines) is a barrel that re-exports everything from `./database`: ```ts export * from "./database"; ``` Its header comment (lines 3-11) says: *"Importing from this file lets feature modules do: `import type { ParentRow, StudentRow, Database } from "@/lib/types";` instead of reaching into the internal file."* But a grep for `from "@/lib/types"` (without `/database`) returns ZERO matches. All 14 files that import types use `from "@/lib/types/database"` directly. The ONLY file that imports from the barrel is `src/lib/supabase/client.ts:27` (`import type { Database } from "@/lib/types/database-schema";`). So the barrel pattern is inconsistently applied — 1 file uses it, 14 bypass it.
- **Location:** `elimtiyaz-website/src/lib/types/database-schema.ts` (the barrel) + `elimtiyaz-website/src/lib/supabase/client.ts:27` (the sole importer)
- **Evidence:** Audit evidence (Confirmed (verified via `grep -rn "from \"@/lib/types" src/`)). Git: The barrel was introduced in commit `e90dbf7` "mid" (2026-08-01). The intent was to provide a clean import surface, but it was never adopted across the codebase.
- **Root cause:** The author created the barrel intending it to be the canonical import path, but other files were written (or refactored) to import directly from `./database`. The supabase/client.ts was the only file that adopted the barrel pattern.
- **Current behavior:** The barrel adds an indirection layer that 14/15 importers don't use.
- **Expected behavior:** The actual types live in `./database` (1009 lines).
- **Proposed resolution:** The actual types live in `./database` (1009 lines).
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-015 — Desktop refund flow is completely dead UI; no refund button exists anywhere

- **Category:** DEAD  |  **Severity:** Critical  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-014 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-014, 11th session): "Rembourser ce paiement" action in PaymentDetailDrawer, Permission.RefundPayment-gated, destructive ConfirmModal with ≥3-char reason, wired to the session identity.
- **Consolidated from:** second-pass DEAD-015
- **Description:** The desktop's `SupabasePaymentRepository.refund()` method (and the mock's `refundPayment()`) are NEVER called from any production UI component. The `payment-detail-drawer.tsx` only renders `handleMarkCleared` (pending→paid) and `handleMarkBounced` (pending→unpaid) buttons — there is NO refund button. The `Permission.RefundPayment` RBAC permission is defined and shown in the RBAC matrix editor, but no component checks it or wires a refund action to it. The `refund-payment` Edge Function's docstring claims "The Desktop app's Payment History tab or the Finance Officer's reversal modal calls this function" — but no such call site exists.
- **Location:** - `elimtiyaz-desktop/src/features/financials/payment-detail-drawer.tsx` (only markCleared + markBounced handlers, lines 69-119) - `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (refund method line 1148, never called from UI) - `elimtiyaz-desktop/supabase/functions/refund-payment/index.ts` (docstring line 10-11 claims desktop calls it; false)
- **Evidence:** Audit evidence (Confirmed). Git: Commit history on payment-detail-drawer.tsx: `6370405 gg`, `0f442a1 mid` — no refund-related commit.
- **Root cause:** The desktop financials module was built for the collect→clear→bounce lifecycle (cash positive flow), but the refund reversal flow was implemented at the repository layer and the UI button was never wired. The Edge Function's docstring was copied from a design doc that assumed the UI would call it.
- **Current behavior:** The refund path is unreachable from any desktop UI. Staff cannot refund via the desktop — only Android users can refund (and only via LocalPaymentRepository which bypasses the canonical SQL RPC).
- **Expected behavior:** Desktop staff with `Permission.RefundPayment` should be able to refund (cancel/reverse) a previously-collected payment via a UI button, with a reason prompt and confirmation modal (parallel to markBounced which has a reason prompt).
- **Proposed resolution:** Add a Refund action to payment-detail-drawer.tsx gated on Permission.RefundPayment, with a mandatory reason (>=3 chars) modal; route through SupabasePaymentRepository.refund() with the real actor identity and reason. Test: refund flow produces payment.refund audit entry with actor + reason; balances update.
- **Dependencies:** none recorded
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-016 — `collect-payment` and `refund-payment` Edge Functions are never invoked by any client

- **Category:** DEAD  |  **Severity:** Critical  |  **Status:** BLOCKED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Android, Backend/DB, Desktop
- **Task:** T-067 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass DEAD-016, first-pass WEAK-001, first-pass WEAK-002, first-pass DRIFT-002, first-pass DRIFT-004
- **Description:** A repo-wide search for `functions.invoke("collect-payment")` / `functions.invoke("refund-payment")` / `functions/v1/collect-payment` / `functions/v1/refund-payment` returns ZERO results in client code across all three platforms. The only Edge Functions actually invoked are: `ai-proxy`, `update-server-secret`, `push-homework-notification`, `approve-signup-request`, `bind-activation-code`, `workflow-execute`. The two payment EFs are 200+ lines of dead code including JWT extraction, permission checks, body validation, and audit-log writes — none of which ever runs.
- **Location:** - `elimtiyaz-desktop/supabase/functions/collect-payment/index.ts` (205 lines, never invoked) - `elimtiyaz-desktop/supabase/functions/refund-payment/index.ts` (153 lines, never invoked) ;; [WEAK-001] `elimtiyaz-desktop/supabase/functions/refund-payment/index.ts:88-90` ;; [WEAK-002] `elimtiyaz-desktop/supabase/functions/collect-payment/index.ts:147-159` ;; [DRIFT-002] `elimtiyaz-desktop/supabase/functions/refund-payment/index.ts:5-7` ;; [DRIFT-004] `elimtiyaz-desktop/supabase/functions/collect-payment/index.ts:145` vs `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1065`
- **Evidence:** Audit evidence (Confirmed). Git: collect-payment/index.ts last touched `eeb82db 2026-08-21 right`; refund-payment/index.ts touched in same commit. No client-side invocation has ever existed.
- **Root cause:** The EFs were authored as a server-side gateway per the original architecture plan, but the desktop's SupabasePaymentRepository was wired to call the SQL RPCs directly (simpler, no extra HTTP hop). The Android path followed the same pattern (Room-first + sync queue → upsert RPC). The EFs were left in place "for future use" — classic dead-by-design code.
- **Current behavior:** They sit idle. All their checks (auth, permission, validation, audit) are bypassed because clients call the SQL RPCs directly. The EFs' docstrings (e.g., "The desktop Counter Payment modal or the mobile Collect Payment screen calls this function") are FALSE — neither client calls them.
- **Expected behavior:** Per their docstrings, the EFs are the canonical server-side entry points for payment collection and refund, with JWT auth, permission checks (`collect_payment` / `refund_payment`), body validation (method-specific proof requirements, reason minimum length), and a second belt-and-suspenders audit log write.
- **Proposed resolution:** Per their docstrings, the EFs are the canonical server-side entry points for payment collection and refund, with JWT auth, permission checks (`collect_payment` / `refund_payment`), body validation (method-specific proof requirements, reason minimum length), and a second belt-and-suspenders audit log write.
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-003: decide whether the payment Edge Functions become the canonical gateway (then wire clients + fix latent defects) or are removed in favour of direct RPC calls.
- **Absorbed findings:** WEAK-001: The `refund-payment` Edge Function fetches the original payment and only checks `if (originalPayment.status === "refunded") return 409`. The canonical `PaymentStatus` enum has TWO terminal states besides `refunded`: `cancelled` (administrative void). Per `CANONICAL-FINANCIAL-LOGIC.md §7.2`: "A refunded payment cannot be un-refunded. To 'undo' a refund, write a new compensating payment + adjustment — never mutate the refund row." The same logic should apply to cancelled payments — they are terminal. The function does not check for `cancelled`, so a cancelled payment could be passed to `revert_payment_allocation` RPC, which may produce a reversal entry against a payment that was never collected (no ledger entries to reverse). | WEAK-002: The `collect-payment` Edge Function validates that `check_number` + `check_bank_name` are required for check payments (lines 95-102) and `transfer_reference` is required for transfer payments (lines 104-111). But the actual RPC call to `collect_and_allocate_payment` (lines 147-159) does NOT pass `p_check_number`, `p_check_bank_name`, `p_check_issue_date`, `p_check_clearance_date`, `p_transfer_reference`, or `p_transfer_source_bank`. Migration 0039 added these 6 params as optional (defaulting to NULL) "for backward compatibility" — but the edge function never actually sends them. Result: the user enters check #1234 + bank "BNP Paribas" in the desktop UI, the UI calls the edge function, the edge function validates the fields are present, then drops them and sends NULLs to the database. | DRIFT-002: The header comment block of `refund-payment/index.ts` (lines 5-7) says "Wraps the `public.refund_payment(p_tenant_id, p_payment_id, p_actor_profile_id, p_reason)` RPC function." But migration 0034 + 0035 DROPPED `refund_payment` from the database because it was a "divergent third implementation" (non-LIFO, single installment, broke paid_date). The function body actually calls `revert_payment_allocation` (line 100-106) — the canonical LIFO RPC. The stale header misleads anyone reading the code: they would expect `refund_payment` to exist in the database and might write SQL that calls it (which would fail with "function does not exist"). | DRIFT-004: The `collect-payment` Edge Function passes `p_category: categoryFilter` where `categoryFilter = body.category_filter ?? null`. The canonical RPC `collect_and_allocate_payment` interprets `p_category = NULL` as "no filter, all categories" — meaning the payment is allocated across ALL outstanding installments (tuition + transport + canteen + etc.). The desktop's direct Supabase path (`SupabasePaymentRepository.collect`) at `supabase-shared-repositories.ts:1065` passes `p_category: input.category ?? "tuition"` — DEFAULTING to "tuition" if no category is provided. These two paths diverge: the edge function allocates across all categories; the direct path allocates only against tuition installments. Same payment, same parent, different waterfall behavior.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-100 — Migration 0029 RLS policies use fn_current_tenant_id() (never-set session setting) — dead code that does nothing

- **Category:** DEAD  |  **Severity:** Medium  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** T-025 (docs/recovery/task-registry.md)
- **Status note:** FIXED 2026-08-31 (T-025, 11th session, migration 0057): fn_current_tenant_id() DROPPED; 6 inert policies removed (working role-gated policies preserved — no RLS weakening); set_assessments_tenant orphan fallback → RAISE. Live 6/6; zero references across all three repos.
- **Consolidated from:** second-pass DEAD-100, second-pass TENANT-105
- **Description:** Migration 0029 installs RLS policies on `academic_years`, `academic_levels`, `classes`, `subjects`, `class_subjects`, `student_academic_histories` using `public.fn_current_tenant_id()` which reads `current_setting('app.current_tenant_id', true)`. This Postgres session setting is NEVER SET anywhere in the codebase (no EF, no client, no trigger sets it). So `fn_current_tenant_id()` always returns NULL, and the policy `tenant_id = NULL` always evaluates to NULL (deny). These policies are dead code — they never grant access. The 0019 policies (which use `current_tenant_id()` that resolves via `auth.uid()`) still dominate via OR semantics, so the tables work correctly today.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql`, lines 165-206 ;; [TENANT-105] `elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:88-110` (function + trigger).
- **Evidence:** Audit evidence (Confirmed (grep'd for `app.current_tenant_id` across all repos — only the migration 0029 + 0041 mention it, and 0041 only uses it inside a trigger function to set NEW.tenant_id, not for RLS)). Git: Commit `9e1e7741` (2026-08-12, "kay") for 0029_academics_module.sql
- **Root cause:** The migration author introduced a new helper `fn_current_tenant_id()` (using `current_setting`) without realizing that the existing `current_tenant_id()` (using `auth.uid()`) was the canonical resolver. The new helper requires the app to set `app.current_tenant_id` per-connection, which no one does.
- **Current behavior:** N/A — 0029's policies are inert.
- **Expected behavior:** The 0029 migration intended to install tenant-isolation policies on the new tables it creates (homework, student_academic_histories) and replace 0019's role-based policies on academic_years etc. with simpler tenant-wide policies. The implementation is broken because the helper function relies on a session setting that no one sets.
- **Proposed resolution:** Replace fn_current_tenant_id() with current_tenant_id() (auth.uid()-based) in the 0029 RLS policies and the set_assessments_tenant trigger (or set the session GUC from the clients - rejected as fragile). Prefer: drop fn_current_tenant_id entirely in a new migration. Regression test: authenticated staff can select/insert student_academic_histories for their tenant only.
- **Dependencies:** none recorded
- **Absorbed findings:** TENANT-105: Migration 0041 (line 88-110) defines the trigger function `set_assessments_tenant()` which fires BEFORE INSERT on `public.assessments`. If `NEW.tenant_id IS NULL`, it tries to derive from `student_id` (via students table). If that also fails (student_id is NULL or doesn't exist), it falls back to `COALESCE(public.fn_current_tenant_id(), '00000000-0000-0000-0000-000000000001')`. Since `fn_current_tenant_id()` always returns NULL (DEAD-100 — never-set session setting), the trigger stamps the assessment with the DEMO tenant UUID whenever `student_id` is NULL or invalid.
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---

### DEAD-200 — `parent_student_links` table is unused; multi-guardian family feature is structurally unimplemented

- **Category:** DEAD  |  **Severity:** Medium  |  **Status:** BLOCKED
- **Repositories:** elimtiyaz-android, AgentGithubUplaod (desktop), elimtiyaz-website
- **Platforms affected:** Android, Backend/DB, Desktop, Website
- **Task:** T-070 (docs/recovery/task-registry.md)
- **Consolidated from:** second-pass DEAD-200
- **Description:** Migration 0005 (line 89-98) creates `public.parent_student_links` as a "junction for multi-guardian families" — the schema supports N parents per student (with `is_primary` flag, `relationship`, `tenant_id`, unique `(tenant_id, parent_id, student_id)`). Migration 0019 line 400-410 adds RLS policies on it. But ZERO client code across ALL 3 REPOS ever SELECTs, INSERTs, UPDATEs, or DELETEs from this table. The canonical parent-student linkage is `students.parent_id` (single FK, 0005 line 57). Multi-guardian families (mother + father + legal guardian all bound to one student) are structurally impossible.
- **Location:** Schema: `elimtiyaz-desktop/supabase/migrations/0005_crm.sql:89-101`. RLS: `elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:400-410`. Verified no consumers: grep for `parent_student_links|ParentStudentLink` across `elimtiyaz-website/src`, `elimtiyaz-android/app/src/main`, `elimtiyaz-desktop/src` returns ZERO matches (only the migration files themselves).
- **Evidence:** Audit evidence (Confirmed (grep returned no matches outside migration files)). Git: 0005_crm.sql introduced in `b25e6ca` (2026-08-04). 0019 in same commit. No later migration or client code wires up the table.
- **Root cause:** The schema was designed for multi-guardian families per plan §04, but the implementation never went beyond the single-FK shortcut. The table was left in place "for future use" — classic dead-by-design infrastructure.
- **Current behavior:** The table is empty in production. Every student has exactly one `parent_id` — the single canonical parent. There's no UI flow to add a second parent. The `parent_student_links_select` policy (0019 line 401-406) allows any 'parent' role user in the tenant to SELECT ALL links — but since the table is empty, this is harmless.
- **Expected behavior:** Per the 0005 comment line 87 ("parent_student_links — optional junction for multi-guardian families"), the table was meant to enable: (1) both mother and father bound to the same child; (2) legal guardian in addition to biological parent; (3) a child moving between custodial parents. The `is_primary` flag would distinguish the primary contact.
- **Proposed resolution:** Per the 0005 comment line 87 ("parent_student_links — optional junction for multi-guardian families"), the table was meant to enable: (1) both mother and father bound to the same child; (2) legal guardian in addition to biological parent; (3) a child moving between custodial parents. The `is_primary` flag would distinguish the primary contact.
- **Dependencies:** none recorded
- **Status note:** Blocked by UNKNOWN-010 (multi-guardian family requirement).
- **Verification:** Regression test reproducing the defect (fails before fix, passes after); migration-level test against a fresh schema with the full canonical chain applied; cross-platform equivalence check per docs/testing/cross-platform.md; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.

---
### DEAD-201 — Desktop `npm run lint` is UNRUNNABLE — no ESLint config file exists in the repo (ESLint 9 requires `eslint.config.js`)

- **Category:** DEAD  |  **Severity:** Medium  |  **Status:** TESTED (2026-08-29)
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-078 (docs/recovery/task-registry.md)
- **Consolidated from:** NEW — discovered during task T-001 (2026-08-29), not in either audit pass
- **Description:** `elimtiyaz-desktop/package.json` declares `eslint: ^9.17.0` and a `lint` script (`eslint . --ext ts,tsx`), and `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` are devDependencies — but the repo contains NO ESLint configuration file whatsoever (no `eslint.config.js|mjs|cjs`, no `.eslintrc*`). ESLint 9 refuses to run without a flat config: `npm run lint` aborts with "ESLint couldn't find an eslint.config.(js|mjs|cjs) file." Consequence: the verification gate documented in hub `AGENTS.md` §11 ("Desktop: npm run typecheck && npm run lint") has apparently NEVER been executable on this repo — every commit that claims "lint passes" without naming the config is unverifiable.
- **Location:** `elimtiyaz-desktop/package.json` (scripts.lint, devDependencies); missing: `elimtiyaz-desktop/eslint.config.*`
- **Evidence:** Runtime evidence (2026-08-29, this session): `cd elimtiyaz-desktop && npm run lint` → "Oops! Something went wrong! … ESLint couldn't find an eslint.config.(js|mjs|cjs) file." `git log --all -- eslint.config.* .eslintrc*` → empty (never existed in history). The lint script and ESLint 9 dependency were introduced together; the config was simply never written.
- **Root cause:** ESLint 9 (installed from the start) requires the new flat-config format; the author wired the script and plugins but never authored `eslint.config.js`. Nobody noticed because `npm test` (vitest) and `npm run typecheck` (tsc) gave enough signal to feel "green".
- **Current behavior:** `npm run lint` fails immediately on every machine; linting has never gated desktop commits.
- **Expected behavior:** `npm run lint` runs ESLint over the src tree with a TypeScript-aware flat config and passes (or reports real findings to be triaged).
- **Proposed resolution:** Author `elimtiyaz-desktop/eslint.config.js` (flat config: typescript-eslint recommended + react-hooks plugin, matching the website's ESLint 9 setup), fix or explicitly baseline the findings it reports, and only then treat "lint green" as a commit gate again. NOTE for the implementing agent: the first run after years without lint WILL surface findings — triage them, do not mass-disable rules to go green (AGENTS.md §15.6).
- **Dependencies:** none recorded
- **Verification:** `npm run lint` executes (no config error) and exits 0 after findings are triaged; evidence recorded in change-log.
- **Status note (2026-08-29, T-078):** RESOLVED — `elimtiyaz-desktop/eslint.config.js` authored (flat config: typescript-eslint recommended over src/ + electron/ + scripts/, react-hooks plugin with rules-of-hooks = error, scoped ignores: supabase/** = Deno toolchain, financial-tests/** = dedicated suites). Dependencies actually installed (they were missing even with a config: eslint-plugin-react-hooks ^5.2.0, globals ^15.15.0, typescript-eslint 8.18.2 meta-package). First run: 312 problems — all 5 ERRORS fixed (1 REAL react-hooks/rules-of-hooks violation: useRepositories() inside the useObservable factory callback in permissions-step.tsx, hoisted to match sibling steps; 1 stale eslint-disable directive naming unconfigured jsx-a11y/img-redundant-alt; 3 prefer-const), the 307 warnings baselined with per-rule counts documented in the config itself (no-unused-vars 202, no-explicit-any 73, no-empty-function 21, exhaustive-deps 4, no-empty-object-type 2) — no rule silently disabled, website's turn-everything-off config explicitly NOT copied (ARCH-005 defect pattern). Gate now: `npm run lint` = 0 errors / exit 0; typecheck clean; full suite 2007/2007.

---

### ARCH-006 — Supabase mode keeps `overdueAlerts` on the mock layer — the manual overdue-scan path never reaches the backend

- **Category:** ARCH  |  **Severity:** Medium  |  **Status:** VERIFIED
- **Status note (2026-08-31, tenth session):** Live integration verified 2026-08-31 (T-094, hub commit ed901b3): env-gated live suite (src/tests/integration/t-094-overdue-live.test.ts) 5/5 against the real project — run() scans 819 overdue installments, the dedup set provably covers every overdue row (0 new), the notification INSERT path accepts the generator's payload (self-cleaning sentinel) and write_audit_log accepts its audit shape.(2026-08-30 — T-080 closed)
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop
- **Task:** T-080 (TESTED 2026-08-30)
- **Consolidated from:** NEW — discovered during task T-004 (2026-08-29), not in either audit pass
- **Description:** The Supabase repository assembly (`src/infrastructure/supabase/supabase-repositories.ts`) builds its `Repositories` object by spreading `mockRepositories` and overriding only the Supabase-backed slots; `overdueAlerts` was NOT overridden, so in production ("Supabase configured") mode the "Scan retards" button (`src/features/financials/installment-schedule-tab.tsx`) executed `MockOverdueAlertGenerator.run()`, which reads the IN-MEMORY mock store (`mockInstallmentRepository.findOverdue` over `store` seed data) and writes notifications into the same in-memory store. Real overdue installments living in Supabase were never scanned; any "alerts generated" toast referred to mock seed rows; no `notifications` rows and no audit trail reached the server. The backend half (the `run-overdue-scan` Edge Function, incl. its manual JWT path with `view_financials` permission — guarded by T-004) had NO desktop caller.
- **Location:** `elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts` (repositories object spread, `overdueAlerts` absent from the override list); `elimtiyaz-desktop/src/features/financials/installment-schedule-tab.tsx` (`repos.overdueAlerts.run()`); `elimtiyaz-desktop/src/infrastructure/mock/repositories/notification-alerts-repository.ts` (the mock generator operating on `store`)
- **Evidence:** Runtime evidence (2026-08-29, T-004 session): `rg overdueAlerts src/infrastructure/supabase/supabase-repositories.ts` → no match (never overridden); `rg "implements OverdueAlertGenerator" src/` → only `MockOverdueAlertGenerator`. The Supabase wiring comment block ("Other repositories remain on the mock layer for now. They will be ported incrementally.") documents the general class; this entry pins the concrete instance with user-visible effect.
- **Root cause:** Incremental Supabase porting left the slot silently mock-backed; the component code is identical for both modes, so the gap is invisible from the UI code and only shows in the repository assembly. This is the exact class T-047 (ARCH-001) was created to inventory — registered separately because it is a concrete user-facing instance with a defined backend counterpart.
- **Resolution (T-080, 2026-08-30):** implemented `SupabaseOverdueAlertGenerator` in `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-overdue-alert-generator.ts`. It scans `installments` for overdue + upcoming-due rows, dedups against `notifications` (by `link_entity_type='installment'` + `link_entity_id`), bulk-INSERTs new `payment_overdue` notifications targeting `financial_officer`, and writes a best-effort `alert.overdue_auto_generated` audit entry via the canonical `write_audit_log` RPC (migration 0014). Mirrors the `MockOverdueAlertGenerator` contract (priority urgent>90d/high 31-90d/medium 0-30d; display_name preferred per F-06/DATA-005). Wired into the Supabase assembly (overrides the `overdueAlerts` slot). 8-test unit suite in `src/tests/infrastructure/supabase-overdue-alert-generator.test.ts` covers happy path, priority buckets, dedup, upcoming-due window, name fallback, and the fully-paid-despite-status filter.
- **What was verified:** typecheck clean; lint 0 errors; 47/2029 tests ALL PASS (was 46/2021 before this session). The SupabaseOverdueAlertGenerator unit suite (8 tests) passes. Live integration against the real backend is the next session's task — the unit tests use a fake Supabase client surface that mirrors the (small) PostgREST builder subset the generator uses.
- **Dependencies:** none recorded.

---

### ARCH-007 — Android repo does not compile at HEAD — the `./gradlew test` verification gate is broken

- **Category:** ARCH  |  **Severity:** High  |  **Status:** TESTED (2026-08-29)
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-081 (docs/recovery/task-registry.md — created 2026-08-29, fifth repair session)
- **Consolidated from:** NEW — discovered while bootstrapping an Android build environment (JDK 17 + Android SDK 35) for the Android tasks T-002/T-019 (2026-08-29), not in either audit pass
- **Description:** `elimtiyaz-android` HEAD (7159b53) fails to compile — `./gradlew :app:compileDebugKotlin` aborts with 2 unresolved references: (1) `app/src/main/java/com/example/ui/features/academics/ClassesDirectoryViewModel.kt:48` — the `canPromote` getter references `sessionManager`, but the constructor parameter (line 30) is declared WITHOUT the `private val` property modifier, so no property exists to reference; (2) `app/src/main/java/com/example/ui/navigation/AppNavHost.kt:344` — `PromotionReviewScreen(...)` is referenced but never imported (the composable exists at `app/src/main/java/com/example/ui/features/academics/PromotionReviewScreen.kt`, package `com.example.ui.features.academics`; AppNavHost imports five sibling academics screens but not this one). Consequence: NO Android verification command can run — `./gradlew test`, `./gradlew lint`, `./gradlew assembleDebug` all fail at compilation — so the per-repo `AGENTS.md` §6 gate has been inoperable since these files were last committed.
- **Location:** `elimtiyaz-android/app/src/main/java/com/example/ui/features/academics/ClassesDirectoryViewModel.kt:30,48` ;; `elimtiyaz-android/app/src/main/java/com/example/ui/navigation/AppNavHost.kt:13-17,344`
- **Evidence:** Runtime evidence (2026-08-29, fifth session): fresh clone of HEAD; toolchain = Temurin JDK 17.0.20.1+1 + Android SDK (platforms;android-35, build-tools;35.0.0, cmdline-tools) on a headless Linux container; `./gradlew :app:compileDebugUnitTestKotlin` → `e: ...ClassesDirectoryViewModel.kt:48:13 Unresolved reference 'sessionManager'` and `e: ...AppNavHost.kt:344:17 Unresolved reference 'PromotionReviewScreen'`; 17 actionable tasks executed, both errors reproduced on a second run. Last touches of both files belong to the "mid/kk/dd" commit batch.
- **Root cause:** Kotlin changes were committed without ever compiling. The per-repo AGENTS.md verification gate (§6) was only established on 2026-08-29 (T-000) — no automated or documented gate existed when these files were last edited. This also means the earlier sessions' "T-002 infeasible headlessly" verdicts stopped at the missing toolchain and never reached the second, independent blocker: the build itself is broken.
- **Current behavior:** Every `./gradlew` build/test/lint invocation fails with the two unresolved references; no Android test has demonstrably run since these commits.
- **Expected behavior:** HEAD compiles; `./gradlew test` is runnable; the AGENTS.md §6 gate is operative for all future Android tasks.
- **Proposed resolution:** Two minimal mechanical fixes, no behaviour change: (1) declare the constructor parameter as `private val sessionManager: SessionManager`; (2) add the missing `import com.example.ui.features.academics.PromotionReviewScreen` to AppNavHost.kt. Then run the full unit-test suite and record the count as the new Android baseline.
- **Dependencies:** none recorded
- **Verification:** `./gradlew :app:compileDebugKotlin` green; `./gradlew test` green with the passing-test count recorded in change-log; evidence recorded in docs/recovery/change-log.md before status moves past TESTED.
- **Status note (2026-08-29, T-081):** RESOLVED — and the problem was BIGGER than first recorded: the compiler surfaced FOUR errors, not two (each hidden until the previous one was fixed): (1) `ClassesDirectoryViewModel.kt` missing `private val` on `sessionManager`; (2) `AppNavHost.kt` missing `PromotionReviewScreen` import; (3) `SyncQueueDispatcher.kt` pushGrade — `Double? ?: JsonNull` infers `Any`, matching no `put` overload (fixed by wrapping in `JsonPrimitive`); (4) `PricingCalculationTest.kt` — `assertEquals(Double?, Double?, Double)` matches no JUnit overload (non-null assertions added). PLUS the equivalence harness could never find the canonical scenarios: `AndroidEquivalenceTest.resolve()` probed only `app/` and the repo root, while the scenarios live in the hub's `elimtiyaz-desktop/financial-tests/equivalence/scenarios` — the probe list now includes the sibling hub checkout, so the 45-scenario suite runs GREEN for the first time. The hub `AGENTS.md` §2 also misdocuments `financial-tests/` as being at the hub root (it is under `elimtiyaz-desktop/`). Baseline after the fix: `./gradlew :app:testDebugUnitTest` = 202/202, equivalence 45/45. NOTE for future agents: the Android build environment (Temurin JDK 17 + cmdline-tools + platforms;android-35 + build-tools;35.0.0) was bootstrapped OUTSIDE the repo at /home/z/my-project/tools — see change-log for the recipe; network access to dl.google.com/services.gradle.org/maven.google.com worked from this environment.

---

### ARCH-008 — The Android lint gate is inoperable — `./gradlew :app:lintDebug` fails with 315 pre-existing errors (no lint baseline has ever existed)

- **Category:** ARCH  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-082 (docs/recovery/task-registry.md — created 2026-08-29, sixth repair session)
- **Consolidated from:** NEW — discovered 2026-08-29 (sixth session) while running the AGENTS.md §6 verification gate for T-002; not in either audit pass
- **Description:** The per-repo `AGENTS.md` §6 gate lists `./gradlew lint` as REQUIRED before finishing, but `./gradlew :app:lintDebug` has never been green: at the post-T-002 HEAD it aborts with **315 errors / 112 warnings**. The dominant class is `NewApi` (java.time.* calls with `minSdk 24` and no core-library desugaring configured) — 216 findings in `LocalRepositories2.kt` alone, plus `DatabaseSeeder.kt` (64), `LocalRepositories.kt` (60), `LedgerEngine.kt` (36), `AndroidPdfRepository.kt`/`PdfGenerator.kt` (28+28), `libs.versions.toml` (120 — a different check), and more. There is no `lint-baseline.xml` anywhere in the repo's history, so these errors pre-date every session and lint has NEVER gated an Android commit.
- **Location:** repo-wide; worst files: `app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt`, `app/src/main/java/com/example/infrastructure/room/DatabaseSeeder.kt`, `app/src/main/java/com/example/core/LedgerEngine.kt`, `gradle/libs.versions.toml`
- **Evidence:** Runtime evidence (2026-08-29, sixth session): `./gradlew :app:lintDebug` on the post-T-002 HEAD → "Lint found 315 errors, 112 warnings. First failure: LocalRepositories2.kt:143 Error: Call requires API level 26, or core library desugaring (current min is 24): java.time.Instant#now [NewApi]". None of the 315 findings are introduced by T-002 (the 6 findings inside the reworked `LocalRepositories.kt` auth region are the pre-existing `Instant.now()` audit-timestamp pattern that the replaced code already used).
- **Root cause:** Same class as ARCH-007 — gates were documented (T-000, 2026-08-29) but never actually run to green. Lint was restored on the desktop (T-078) but the Android lint gate was never triaged: the error backlog predates the governance system and no baseline was ever created.
- **Current behavior:** `./gradlew :app:lintDebug` (and `./gradlew lint`) abort with 315 errors; the AGENTS.md §6 lint requirement cannot be satisfied by any agent.
- **Expected behavior:** Either (a) the error backlog is triaged and fixed to zero, or (b) a `lint-baseline.xml` pins the pre-existing debt to exact per-rule counts (the desktop T-078 pattern: baseline + documented per-rule justification) so the gate is green and only NEW findings fail.
- **Proposed resolution:** Follow the T-078 precedent: create `app/lint-baseline.xml` from the current 315-error backlog, document the per-rule counts and the desugaring decision in the build config, and decide separately (T-082) whether to enable core-library desugaring to genuinely fix the NewApi class (it is the correct long-term fix — java.time is already used pervasively).
- **Dependencies:** none recorded
- **Verification:** `./gradlew :app:lintDebug` green with the baseline (or zero errors after the desugaring fix); per-rule counts documented; evidence in change-log before status moves past TESTED.

---

### BUG-NEW-001 — `expire_pending_approvals()` SQL RPC references a non-existent `public.users` table

- **Category:** BUSINESS  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop — supabase migration chain)
- **Platforms affected:** Backend, Desktop
- **Task:** T-083 (docs/recovery/task-registry.md — created 2026-08-30)
- **Consolidated from:** NEW — discovered 2026-08-30 (seventh session) during T-004's live curl matrix; not in either audit pass
- **Description:** The `public.expire_pending_approvals()` SQL RPC (defined in migration 0011) references a `public.users` table that does not exist. The function body:

  ```sql
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM users WHERE approval_status = 'pending' LOOP
      UPDATE users
         SET approval_status = 'expired', updated_at = now()
       WHERE tenant_id = v_tenant
         AND approval_status = 'pending'
         AND created_at < now() - INTERVAL '30 days';
  ```

  The intended table is `public.account_approval_requests` (which has `status='pending'`, NOT `approval_status='pending'`). The 30-day threshold is also divergent from the EF's documentation comment that says "7 days" — so even if the table reference were corrected, the threshold would be wrong.

- **Location:** `elimtiyaz-desktop/supabase/migrations/0011_audit.sql` (function `public.expire_pending_approvals`); the EF that calls it is `elimtiyaz-desktop/supabase/functions/expire-pending-approvals/index.ts`
- **Evidence:** Runtime evidence (2026-08-30): T-004 live curl matrix on the live Supabase project (hkvkefubghbbotgnteir):
  ```
  POST .../functions/v1/expire-pending-approvals
  Authorization: Bearer <CRON_SECRET>
  → HTTP 500: {"error":{"code":"expire_failed","message":"Failed to expire pending approvals","details":"relation \"users\" does not exist"}}
  ```
  The auth gate (T-004 / SEC-105) ACCEPTED the bearer (no 401) — the failure is purely in the SQL RPC's broken table reference. The same RPC query via `supabase db query --linked "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='expire_pending_approvals';"` confirms the function body references `users` (no schema qualifier; even if it had one, no `users` table exists in `public` or `auth` schemas with an `approval_status` column).
- **Root cause:** The RPC was likely written before the schema stabilized around `account_approval_requests` (migration 0005) and was never reconciled. The function body has been silently failing every day since the daily cron schedule was first deployed — there is no audit log entry for failed runs because the RPC errors before any row is updated, and the EF's error path doesn't write an audit entry either.
- **Current behavior:** Every daily scheduled invocation of `expire-pending-approvals` EF fails silently: the EF accepts the cron bearer, calls the RPC, the RPC errors with "relation users does not exist", the EF returns 500. No pending approvals are expired; no audit entry is written. Pending approval requests older than 30 days (the EF's documented threshold is 7 days) accumulate forever.
- **Expected behavior:** The RPC operates on `account_approval_requests` with the correct `status` column ('pending' → 'expired') and the correct 7-day threshold (per the EF's documentation). The EF writes an audit entry per affected tenant.
- **Proposed resolution:** New migration 0049+ rewrites `public.expire_pending_approvals()` to:
  ```sql
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM public.account_approval_requests
                  WHERE status = 'pending' LOOP
      UPDATE public.account_approval_requests
         SET status = 'expired', updated_at = now()
       WHERE tenant_id = v_tenant
         AND status = 'pending'
         AND created_at < now() - INTERVAL '7 days';
      ...
  ```
  Plus: a regression test that creates a 7-day-old pending request, runs the RPC, and verifies the status transition. Plus: the EF's error path should write an `account_approval.expire_batch_failed` audit entry when the RPC errors, so silent failures are at least auditable.
- **Dependencies:** none recorded
- **Verification:** (1) live curl matrix against `expire-pending-approvals` EF → 200 with `expired_count >= 0` (no longer 500); (2) SQL-level test on a fresh schema: a 7-day-old pending request is expired; a 6-day-old one is not; (3) `supabase db query --linked "SELECT pg_get_functiondef(...) FROM pg_proc WHERE proname='expire_pending_approvals'"` shows the rewritten body referencing `account_approval_requests`.

---

### BUG-NEW-002 — `mv_dashboard_kpis` multiplies every payment by the tenant student count (54.96M reported as 21.38 BILLION)

- **Category:** BUSINESS  |  **Severity:** Critical  |  **Status:** TESTED (fixed live by migration 0049, 2026-08-30)
- **Repositories:** AgentGithubUplaod (desktop — supabase migration chain)
- **Platforms affected:** Backend, Desktop (dashboard KPIs), any MV consumer
- **Task:** T-084
- **Consolidated from:** NEW — discovered 2026-08-30 (eighth session) during the live backend health check (docs/audits/backend-health-check-2026-08-30.md, finding F-04)
- **Description:** The materialized view joins `tenants × parents × students × payments` and aggregates `SUM(pay.amount)` over the fanned-out row set. Every payment row is duplicated once per (parent × student) combination. Live evidence: `monthly_revenue = 21,380,256,900 DZD` — exactly the true monthly payments (54,962,100) × 389 (the tenant's student count). Additionally `overdue_debt` (55,089,700) EXCEEDED `outstanding_debt` (48,582,000) in the same row — mathematically impossible for a subset — because `total_outstanding` nets negative account balances (credits) into the total while `total_overdue` only sums positive overdue accounts (that second behaviour is the documented canonical engine semantics, INV-3; the first is the fan-out bug).
- **Location:** `elimtiyaz-desktop/supabase/migrations/0034_canonical_engine_unification.sql` (recreated verbatim in 0041 and 0042) — `CREATE MATERIALIZED VIEW public.mv_dashboard_kpis`
- **Evidence:** Live REST query of `mv_dashboard_kpis` (2026-08-30, service_role): `{"monthly_revenue": 21380256900.0, "outstanding_debt": 48582000.0, "overdue_debt": 55089700.0, ...}`; cross-check `SELECT SUM(amount) FROM payments WHERE status='paid' AND collected_at >= date_trunc('month', NOW())` = 54,962,100.00; 21,380,256,900 / 54,962,100 = 389.0 exactly = live student count.
- **Root cause:** Classic join-fan-out aggregation — the view's FROM clause joins parents and students for the COUNT columns but also SUMs the payment column on the same row set instead of using scalar subqueries.
- **Resolution (migration 0049, applied live 2026-08-30):** rebuilt the MV with scalar subqueries (each aggregate reads its base table exactly once); the per-parent outstanding/overdue columns keep the existing `compute_parent_summary` LATERAL pattern. Verified live: `monthly_revenue` now 54,962,100.00 (byte-identical to the cross-check), `today_revenue` 0 (correct — no payments collected today), counts 258/389.
- **Dependencies:** none
- **Verification:** live REST query of the rebuilt MV (values above) + `REFRESH MATERIALIZED VIEW CONCURRENTLY` succeeds (see BUG-NEW-003). Remaining gap: desktop dashboard consumption not re-screenshotted (no desktop host) — the values it reads are now correct at the source.

### BUG-NEW-003 — Zero indexes on all four MVs — every scheduled `REFRESH MATERIALIZED VIEW CONCURRENTLY` has been failing

- **Category:** BUSINESS  |  **Severity:** High  |  **Status:** TESTED (fixed live by migration 0049, 2026-08-30)
- **Repositories:** AgentGithubUplaod (desktop — supabase migration chain)
- **Platforms affected:** Backend (scheduled refresh EF), Desktop (stale KPIs)
- **Task:** T-084
- **Consolidated from:** NEW — discovered 2026-08-30 (eighth session) during the live backend health check
- **Description:** `refresh_materialized_view(p_name)` (migration 0036) executes `REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I`. PostgreSQL REQUIRES a unique index on the matview for CONCURRENTLY mode. Live check `pg_indexes WHERE tablename LIKE 'mv_%'` returned ZERO rows — so every per-view refresh call errored ("cannot refresh materialized view ... concurrently without a unique index" → the RPC returns FALSE), and the MVs only ever updated via plain (non-concurrent) refreshes or not at all.
- **Location:** `elimtiyaz-desktop/supabase/migrations/0036_tier4_backend_hardening.sql` (refresh RPC) + the four MV definitions (0021/0034/0041/0042)
- **Evidence:** live pg_indexes query returned `[]`; live execution of `REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_dashboard_kpis` pre-fix would fail; post-fix returns OK.
- **Resolution (migration 0049, applied live 2026-08-30):** added unique indexes on natural keys — `uq_mv_dashboard_kpis_tenant(tenant_id)`, `uq_mv_debt_aging_tenant_parent(tenant_id, parent_id)`, `uq_mv_top_debtors_tenant_parent(tenant_id, parent_id)`, `uq_mv_revenue_by_month_tenant_month(tenant_id, month)`. Verified live: all four indexes present + `REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_dashboard_kpis` → `refresh-ok`.
- **Dependencies:** none
- **Verification:** live SQL (index list + concurrent refresh execution). Gap: the refresh EF's scheduled invocation not re-triggered (needs CRON_SECRET) — but the SQL primitive it calls is now verified working.

### DATA-001 — `payment_allocations` is EMPTY: the canonical waterfall has never executed in production

- **Category:** BUSINESS  |  **Severity:** Critical  |  **Status:** VERIFIED (2026-09-01, T-103)
- **Repositories:** Backend (data state, not code)
- **Platforms affected:** all (canonical financial path ADR-002)
- **Task:** T-085/T-103 (data reconciliation — owner-authorized 2026-09-01)
- **Consolidated from:** NEW — discovered 2026-08-30 (eighth session) during the live backend health check (finding F-01)
- **Description:** All 888 production payments were written through the legacy `upsert_*_from_import` RPCs (Excel import path, migrations 0027+). `payments.installment_id` is NULL on every row and `payment_allocations` holds 0 rows. Consequences: no payment→installment traceability exists; `revert_payment_allocation` / `mark_payment_cleared` are inoperable on the existing corpus; the canonical `collect_and_allocate_payment` waterfall (migrations 0034–0043, the centerpiece of ADR-002) has never actually executed against production data.
- **Evidence:** live counts — payments 888 (all status='paid', all method='cash'), payment_allocations 0, `SELECT COUNT(*) FROM payments WHERE installment_id IS NOT NULL` = 0.
- **Expected behavior:** every cleared payment is linked to the installments it settles via payment_allocations rows produced by the canonical waterfall, so per-tranche "what did this payment pay for?" is answerable and refunds/reversions can be computed.
- **Proposed resolution:** one-time backfill — replay the existing payments through the canonical waterfall (or a purpose-built reconciliation migration) in chronological order per parent, generating payment_allocations + linking payments.installment_id. MUST be run under four-eyes supervision: it rewrites financial history. This is a DATA operation, not a code change — needs the owner's explicit sign-off (see DATA-002 first).
- **Dependencies:** DATA-002 (discrepancies must be resolved BEFORE the backfill, or the waterfall will bake them in)
- **Verification:** post-backfill — `payment_allocations` count ≥ payments count; Σ allocation amounts per payment = payment amount; Σ allocations per installment ≤ amount_due.
- **Status note (2026-09-01, T-103):** FIXED + VERIFIED. The owner explicitly authorized the full reconciliation ("Fix this issue completely… verify that the information is consistent everywhere"). Migration `0062_finance_reconciliation.sql` (applied live atomically with registration per MIG-TOKENS; `scripts/apply_0062_live.sh`) reset installments and replayed all 888 payments through the canonical waterfall order (per parent + category, payments chronological, tranches oldest-due-first). Live evidence: 1,310 payment_allocations rows covering 860 payments (the other 28 payments are pure-excess — zero allocations by design); Σ allocations per payment == amount − excess (verify_t-103.sql check C1 = true); no tranche has amount_paid > amount_due (C4 = true). The desktop Finance tab and parent dossier now agree for every parent (C5/C6 = true). Full matrix: `docs/recovery/t-103-live-verification.md`.

### DATA-002 — Three-way payment total disagreement (parent e3e90f1f: Δ+1,750 installments vs payments, Δ+10,000 ledger vs payments)

- **Category:** BUSINESS  |  **Severity:** Critical  |  **Status:** VERIFIED (2026-09-01, T-103)
- **Repositories:** Backend (data state)
- **Platforms affected:** all (any balance shown anywhere)
- **Task:** T-085/T-103 (data reconciliation)
- **Consolidated from:** NEW — discovered 2026-08-30 (eighth session), live health check finding F-02
- **Description:** Three independent sources disagree on total collected:
  - Σ installments.amount_paid = **54,960,350 DZD**
  - Σ payments.amount = **54,962,100 DZD** (Δ +1,750 — one payment of 1,750 DZD by parent e3e90f1f never applied to any installment)
  - Σ ledger payment entries = **54,972,100 DZD** (Δ +10,000 vs payments — the same parent's ledger holds 10,000 DZD of payment entries that do not exist in the payments table)

  Only 1 of 258 parents is affected, but that parent's balance is wrong in every system that computes it.
- **Evidence:** live per-parent reconciliation (health-check §I): `parent e3e90f1f: installments.amount_paid=481,750 vs payments=483,500 (Δ+1,750)` and `ledger payments=493,500 vs payments table=483,500 (Δ+10,000)`.
- **Expected behavior:** the three sources agree for every parent (ledger is authoritative per INV-1; payments table is the operational record; installments.amount_paid is a denormalized cache).
- **Proposed resolution:** forensic pass on parent e3e90f1f's rows (identify the 1,750 DZD unapplied payment and the orphaned ledger entries), decide with the school which is truth, repair the minority source, THEN run the DATA-001 backfill.
- **Dependencies:** none (blocks DATA-001)
- **Verification:** re-run the health-check per-parent reconciliation → 0 disagreements in all three pairs.
- **Status note (2026-09-01, T-103):** FIXED + VERIFIED. Forensics against the source workbook (`Suivis clients  2026_2027.xlsx`, sheet ETAT 20262027, rows 235/236) resolved the ambiguity: the LEDGER was right all along. The payments-table row `IMP-2a049159-ce2c-4f74-814d-2a133dd85334-V2_ALT` was imported as 90,000 DZD, but the Excel cell (row 235, column "2V") and the ledger entry both say 100,000 DZD — the payments-import run (run_msp7fbgz) mis-read the 2V column for this student (Excel row 242, a DIFFERENT parent's student with the identical name "SIDI MAMER SAMYI", carries 2V=90,000 — the confusion source). Migration 0062 corrected the payments row to 100,000 with a `payment.reconcile_fix` audit entry. The "Δ+1,750" leg was never a data row — it was the import's non-waterfall installment allocation (whole versements dumped onto single tranches); the 0062 waterfall replay re-derived installments.amount_paid correctly. Live verification: 0/258 parents with payments-vs-ledger disagreement (verify_t-103.sql C2 = true; spot-check e3e90f1f: ledger paid == payments == 493,500).

### DATA-003 — Ledger charges ≠ installment dues for 197/258 parents (Δ 7.62M DZD tenant-wide)

- **Category:** BUSINESS  |  **Severity:** High  |  **Status:** VERIFIED (2026-09-01, T-103)
- **Repositories:** Backend (data state)
- **Platforms affected:** all
- **Task:** T-085/T-103 (data reconciliation — owner-authorized)
- **Consolidated from:** NEW — 2026-08-30 live health check finding F-03
- **Description:** Σ ledger charges = 113,263,800 DZD (391 entries) vs Σ installments.amount_due = 105,639,600 DZD (1,273 rows) — 7,624,200 DZD of charges exist in the ledger with NO installment row. For 76% of parents the installment schedule cannot explain the ledger balance. Consequence: any UI that computes "what's left" from installments disagrees with the canonical balance — exactly why the portal (and desktop) must replay the ledger.
- **Evidence:** live health-check §E/§I totals + per-parent charge comparison (197/258 mismatch).
- **Expected behavior:** every charge entry corresponds to an installment row (source_type='installment', source_id = installment id) or is an explicitly-typed non-installment charge.
- **Proposed resolution:** classify the 391 charge entries by source_type/source_id; generate installment rows for un-linked charges or annotate them as direct ledger charges; document the business rule. Requires the owner's input on what the 7.62M represents (likely annual-supply/registration/transport charges the Excel import booked straight to the ledger).
- **Dependencies:** none
- **Verification:** per-parent ledger-vs-installment charge comparison → 0 unexplained rows.
- **Status note (2026-09-01, T-103):** FIXED + VERIFIED — the 7.62M is now fully classified (the original framing missed that Σ installments due must be compared to charges NET of the remise adjustments):
  1. **−9,709,700 DZD** = 318 `Remise sur devis` adjustments (Excel "REMISE" column) — CORRECT canonical form; discounts live as negative adjustments on the ledger and reduce the installment dues.
  2. **+2,064,000 DZD** = transport installments (34 parents, 106 tranches, fully paid) whose transport CHARGES were never written to the ledger — the import wrote transport payments but no transport charges. Fixed by 0062: one transport charge per student (54 charges, same account shape as the tuition import charges).
  3. **+21,500 DZD** = 3 parents' schedule-vs-devis gaps — METAH NADA (7,000 "Dettes antérieures" charge with no tranche) + DAHMANI FARES (8,000 same) + SIDI MAMER SAMYI (tranches generated from the price tables at 210,000 instead of the Excel devis net 173,500 = +36,500). Fixed by 0062: dettes folded into Tranche 1 with traceability notes; the overstated last tranche reduced to the devis net.
  Post-fix live verification: 0/258 parents with (Σ installments due) ≠ (Σ charges + Σ adjustments) — verify_t-103.sql C3 = true. The Excel's own "TOTAL*CREANCE" column is gross-of-remise by design; the system's canonical net semantics (INV-1 ledger) is the authority.
- **Status note (2026-09-01, T-105 — CORRECTION):** classification item 1 above was WRONG. The 318 "Remise sur devis" adjustments were NOT correct canonical form: the Excel devis (column L) is already net of the remise (L = components − J, formula-verified 390/390), so those adjustments double-discounted 223 parents — this is DATA-010, repaired by migration 0063. Classification item 3's SIDI MAMER correction was also computed against the wrong base (210,000 → 173,500 assumed devis GROSS; the workbook's L for row 235 is 236,750 NET) — 0063 re-aligned that student's tranches to 236,750 (+63,500 vs the 0062 state). The "TOTAL*CREANCE gross-of-remise" claim is likewise corrected: Q = L − P where L is NET — the workbook and the corpus now agree exactly (M2/M3 259/259, verify_t-105.sql).

### DATA-004 — 59 overpaying parents (credit up to 244,000 DZD) with NULL expected/excess payment fields

- **Category:** BUSINESS  |  **Severity:** Medium  |  **Status:** VERIFIED (2026-09-01, T-103)
- **Repositories:** Backend (data state)
- **Task:** T-085/T-103
- **Consolidated from:** NEW — 2026-08-30 live health check finding F-05
- **Description:** 59 parents paid more than their total dues (top overpayer: +244,000 DZD). The schema anticipated this (`payments.expected_amount` / `excess_amount`, migration 0033) but both columns are NULL on every row. The canonical tracking is the parent_credit ledger account (INV-7) — which the portal's new credit KPI surfaces — but the payment-level hint fields the desktop UI was built to show are unusable on the existing corpus.
- **Evidence:** live health-check §I overpayer ranking.
- **Proposed resolution:** during the DATA-001 backfill, populate expected_amount/excess_amount per payment from the waterfall result; keep the ledger account as the canonical source.
- **Dependencies:** DATA-001
- **Verification:** every payment where ledger balance goes negative post-payment has excess_amount > 0.
- **Status note (2026-09-01, T-103):** FIXED + VERIFIED. The 0062 waterfall replay populated expected_amount (allocated portion), excess_amount (unallocated portion) and excess_remark ('Réconciliation 0062 — excédent (crédit parent)') on all 888 payments (C7 = true). The desktop `mapPaymentRow` now maps the three columns into the domain `Payment` so the PaymentBreakdownCard renders on live data (regression-tested). The 59 overpayers keep balance = −excess (clean credit semantics); see DATA-009 for why parent_credit entries were deliberately NOT materialized for the historical corpus.

### DATA-005 — `parents.first_name` is an empty string on ALL 258 production rows (names live only in display_name/last_name)

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** PARTIAL (portal mitigated 2026-08-30 — formatParentName prefers display_name; data repair OPEN)
- **Repositories:** Backend (data state); website (mitigation)
- **Task:** T-085 (data repair), T-084 (portal mitigation — done)
- **Consolidated from:** NEW — 2026-08-30 live health check finding F-06
- **Description:** The Excel import populated `display_name` ("ZIREG LEA") + `last_name` and left `first_name` = ''. Any UI joining first_name + last_name renders a leading space and half-missing names (the portal's greeting did exactly that before session 8).
- **Resolution so far:** website `formatParentName()` prefers display_name with first/middle/last fallback (regression-tested); desktop/Android name rendering still to be audited.
- **Proposed resolution (data):** split display_name into first/last for rows where first_name is empty (one UPDATE with owner sign-off), keeping display_name untouched.
- **Verification:** `SELECT COUNT(*) FROM parents WHERE first_name = ''` → 0.

### DATA-006 — Parent portal has zero eligible real users (1/258 parents with email, 0 activation codes, 0 auth bindings)

- **Category:** BUSINESS  |  **Severity:** Medium  |  **Status:** OPEN (operational onboarding, not a code defect)
- **Repositories:** Backend (data state / operations)
- **Task:** T-086
- **Consolidated from:** NEW — 2026-08-30 live health check finding F-07
- **Description:** The portal's Google-OAuth activation flow is structurally ready but empty: 0 activation_codes rows, 0 parents.auth_user_id bindings, and only 1 of 258 parents has an email at all. The 269 live notifications all target financial_officer; parents receive none. The portal is effectively unlaunched for its intended audience.
- **Proposed resolution:** operational onboarding campaign — collect parent emails (via the school), generate activation codes from the desktop (the feature exists), distribute, approve the account_approval_requests. Academic tables (attendance/grades/homework: all 0 rows) need staff to start recording before those portal views carry content.
- **Dependencies:** none technical; requires school-side action.

### DATA-007 — Test residue in the live backend (`_eq_test_fn`/`_eq_test_fn2` RPCs, unconfirmed test auth user, expired approval request)

- **Category:** DEAD  |  **Severity:** Low  |  **Status:** FIXED (2026-08-30 — T-087 closed)
- **Repositories:** Backend
- **Task:** T-087 (TESTED 2026-08-30)
- **Consolidated from:** NEW — 2026-08-30 live health check finding F-09
- **Description:** The public schema exposes `_eq_test_fn` and `_eq_test_fn2` (equivalence-harness leftovers) via REST; an unconfirmed auth user `test.connection.supabase@gmail.com` with an expired account_approval_request remained. Harmless but pollutes the API surface and the auth list.
- **Resolution (T-087, 2026-08-30):** migration 0052 `drop_test_residue.sql` dropped both functions (`drop function if exists`); the auth user `test.connection.supabase@gmail.com` was deleted via SQL directly (auth schema is not in the public migration chain, but the Management API SQL endpoint runs as service_role and can DELETE from auth.users); the expired account_approval_request row was also deleted. Migration 0052 applied live + registered in schema_migrations.
- **Verification:** `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name LIKE '_eq_test%';` returns 0 rows. `SELECT id, email FROM auth.users;` returns 1 row (`admin@elimtiyaz.dz`). `SELECT * FROM account_approval_requests WHERE auth_user_id = '...';` returns 0 rows.
- **Dependencies:** none

---

### DATA-008 — Cross-view financial divergence: Finance tab, parent dossier and student payments read divergent sources with divergent formulas (owner-reported)

- **Category:** BUSINESS  |  **Severity:** High  |  **Status:** VERIFIED (2026-09-01, T-103)
- **Repositories:** desktop (read paths + helpers); backend (data state feeding them)
- **Platforms affected:** desktop primarily (Android/website were already canonical on the formula but consumed the same corrupt corpus)
- **Task:** T-103
- **Consolidated from:** NEW — 2026-09-01, owner report (15th session): "In the Finance tab, when I click on a person, it says that the person paid, for example, 100k. But when I open their dossier and look at their kids, I can see that they paid 30k, still have 40k remaining, and another 30k is in créance."
- **Description:** Two independent defect layers produced the divergence the owner saw:
  1. **Formula layer (code):** the desktop's canonical helpers `installmentRemaining` / `totalOutstanding` used the cleared-only formula `clampNonNegative(amount_due − amount_paid)`, violating the INV-4-family rule (`…− amount_pending`) that the backend waterfall (migrations 0034/0040), the website port (`installmentRemainingAmount`) and the Android mirror (`Installment.remaining`) all implement. The Finance "Tranches" tab additionally used an INLINE `amountDue - amountPaid` (bypassing even the helper), as did the student payments tab's line items and the parent-drawer profile's `totalDue` (`totalCharged` gross — ignoring remise adjustments, so "Total dû" overstated for every discounted parent and disagreed with Σ installments due).
  2. **Data layer:** installments.amount_paid was imported non-waterfall (whole versements dumped onto single tranches → over-applied tranches while earlier tranches sat unpaid — e.g. parent e3e90f1f: Tranche 2 shows 165,000 paid on a 63,000 tranche, Tranche 1 unpaid), and the three sources disagreed (DATA-001…004).
  Combined effect: the Finance tab (installments view), the payments tab (payments table) and the dossier (ledger replay) showed three different stories for the same parent.
- **Evidence:** owner report (above); live forensics 2026-09-01 (three-way diagnostic: 197/258 due mismatches, 181/258 remaining mismatches, 1 paid mismatch); desktop source inspection (queries.ts:16-23, installment-schedule-tab.tsx "Reste" accessor, payments-tab.tsx lineItems, supabase-shared-repositories.ts refreshProfile).
- **Expected behavior:** all read surfaces derive per-tranche remaining via the canonical INV-4-family formula, the parent profile's totalDue is the net obligation, and the underlying corpus satisfies the three-way equalities (payments == ledger; Σ due == charges + adjustments; waterfall-shaped allocations) so every view tells the same story.
- **Resolution (T-103, 2026-09-01):**
  1. Migration 0062 (data): see DATA-001/002/003/004 — the corpus now satisfies the equalities (live 8/8 checks).
  2. `installmentRemaining` + `totalOutstanding` now subtract `amountPending` (new `sumInstallmentsPending` helper) — desktop aligned with backend/website/Android.
  3. `installment-schedule-tab.tsx`: "Reste" column, "Encaisser" disabled predicate, collect preset and due-date modal all use `installmentRemaining` (no more inline formula).
  4. `student-detail/payments-tab.tsx`: lineItems `remainingAmount` uses `installmentRemaining`.
  5. Parent profile (Supabase + mock paths): `totalDue` = charges + adjustments (net), `totalPaid` = all payment entries (both modes identical); the drawer's Finances tab renders negative balance as a positive "Crédit parent" card instead of a confusing negative "Reste".
  6. `mapPaymentRow` surfaces expected/excess/remark (see DATA-004).
- **Verification:** 10-test regression suite `src/tests/domain/calc/t-103-finance-consistency.test.ts` (INV-4 formula, sum helper, hint-field mapping, net-profile derivation); full desktop suite 67 files / 2187 tests ALL PASS; typecheck clean; lint 0 errors; live three-way verification 8/8 (verify_t-103.sql) with the owner's exact parent (e3e90f1f) spot-checked: due 337,000 == charged+adj, paid 493,500 == payments == ledger, allocated 337,000, remaining 0, balance −156,500 == −excess.
- **Dependencies:** DATA-001…004 (data layer), none for the formula layer.

---

### DATA-009 — Canonical writer double-counts parent_credit in the raw ledger balance (design quirk; historical corpus deliberately not back-filled)

- **Category:** BUSINESS  |  **Severity:** Medium  |  **Status:** OPEN (registered; live path unchanged by design)
- **Repositories:** backend (canonical RPC semantics); all read surfaces
- **Platforms affected:** all
- **Task:** T-104 (decision task — needs an ADR before any change)
- **Consolidated from:** NEW — 2026-09-01, T-103 empirical discovery (live rollback test)
- **Description:** `collect_and_allocate_payment` writes the FULL payment entry (−amount) on the category account AND a parent_credit adjustment (−unallocated) on the parent_credit account when a payment over-satisfies the schedule. Verified live in a rolled-back transaction: charge +100k, payment −150k, credit −50k → `compute_parent_summary` returns totalOutstanding −100k for a 50k overpayment. The raw balance therefore double-counts the credit (once as the unallocated portion of the payment entry, once as the credit adjustment). `totalUnallocatedCredit` (−50k) carries the true credit value. Read surfaces that display `totalOutstanding` raw will show −2× the real credit for parents overpaid THROUGH THE CANONICAL PATH.
- **Evidence:** live test (rollback transaction) 2026-09-01: `SELECT * FROM collect_and_allocate_payment(…150000…)` against a 100k tranche; post-state `compute_parent_summary` → total_outstanding −100,000.00, total_unallocated_credit −50,000.00. Recorded in the 0062 migration header + t-103-live-verification.md.
- **Expected behavior:** UNRESOLVED — either (a) the payment entry should be written at the allocated amount only (breaking change to the canonical writer, needs ADR + equivalence re-run), or (b) read surfaces must always derive "credit" from `totalUnallocatedCredit` (display-level convention). The pinned equivalence suites currently accept the shape.
- **Resolution (T-103 decision, documented):** the 0062 backfill deliberately does NOT materialize parent_credit entries for the 59 historical overpayers: replaying the canonical shape would double their displayed credit (balance −2×excess) and worsen the divergence this task fixed. Historical overpayers keep balance = −excess (clean semantics: "the school owes exactly the overpayment"). New payments through the canonical RPC continue to produce the historical shape (credit entries exist; balance −2× for the fresh excess only). crossCheckParentCredit will surface UNBACKED_PARENT_CREDIT warnings for the 59 historical rows — known and accepted.
- **Status note (2026-09-01, T-105):** the corpus alignment to the workbook (migration 0063) eliminated the 57 fake historical "overpayers" that were artefacts of the double-remise (DATA-010) — the 0062-era 59 overpayers are now 2 (SIDI MAMER SAMYI parent A: −30,000 per the workbook's own Q column; one more genuine credit). The design question stays OPEN for NEW overpayments created through the canonical writer.
- **Dependencies:** none
- **Verification:** N/A (registered decision + discovery; no behaviour changed live).

---

### DATA-010 — Excel import DOUBLE-DISCOUNTS every remise: the DEVIS charge (column L, already net) + a separate "Remise sur devis" −J adjustment

- **Category:** DATA  |  **Severity:** Critical  |  **Status:** VERIFIED (2026-09-01, T-105)
- **Repositories:** backend (live corpus); desktop (import-engine writer — `repository-adapter.ts` `buildFinancialEntries`)
- **Platforms affected:** all (every read surface consumed the understated corpus)
- **Task:** T-105
- **Consolidated from:** NEW — 2026-09-01, T-105 Excel-corpus equivalence run (owner mandate: "test the problem against the real Excel spreadsheet and make sure there is equivalence across all platforms")
- **Description:** the workbook's `DEVIS ANNUEL` (column L) is **already net of the remise** — its formula is `components − J` (e.g. row 2: `=25000+205000+35000-J2`; row 235: `=300000-J235`), verified by reading the raw formulas and by the workbook's own consistency (P = R+S+T+U+W+X+Y for 390/390 rows; Q = L − P for 390/390 rows). The bulk import wrote the DEVIS charge **from L** (net) and **then** a separate "Remise sur devis" adjustment of **−J** — discounting every discounted parent TWICE. Live impact: 223 parents double-discounted, Σ −9,709,700 DZD; parents who paid their exact devis showed fake "credits" (e.g. ZIREG LEA: devis 239,500 paid 239,500, workbook créance 0 — corpus balance −25,500). This was the residual data-layer half of the owner's DATA-008 divergence: T-103 had aligned the read surfaces and the internal corpus invariants (payments == ledger, installments == charges+adj), but the corpus itself was still wrong versus the source of truth.
- **Evidence:** formula reads (openpyxl, `read_excel_formulas.py`); live three-way diagnostic (`diag_t-105-definitive.sql`): hB double-remise hypothesis matched 223/258 parents, Σ adjustments −9,709,700 vs Σ workbook remise 9,754,700; ZIREG LEA ledger (charge 239,500 + adjustment −25,500 + payments −239,500 → balance −25,500).
- **Expected behavior:** the corpus must satisfy, per parent: netdue (charges + adjustments) == Σ(DEVIS + DETTES − REGLEMENTS) and balance == the workbook's TOTAL*CREANCE semantics.
- **Resolution (T-105):**
  1. Migration `0063_excel_corpus_alignment.sql` STEP 1 — one compensating +|J| adjustment per imported REMISE entry (append-only: originals kept as forensic history; unique source_ids make the step idempotent).
  2. Importer fix (`repository-adapter.ts`) — NO ledger entry for the remise (comment explains the workbook formula evidence); `buildInstallmentRows` now reconciles Σ tranches due to the ledger target (devis + dettes − remboursement) with the 0062 last-tranche absorption rule, so a FRESH import cannot reintroduce the DATA-003-family schedule-vs-ledger gap.
  3. Regression suite `src/tests/integration/t-105-import-shape.test.ts` — real-workbook import asserting: zero "Remise sur devis" adjustments, no REMISE-sourced entries, Σ tranches == Σ(devis + dettes − remboursement), ledger net == Σ(devis + dettes), no negative tranches.
- **Verification:** live `scripts/verify_t-105.sql` — M2 netdue 259/259, M3 balance 259/259 (was 61/258 before 0063); cross-platform: desktop TS 259/259, Android Kotlin 259/259, website port 259/259 (262 tests) — all equal to the backend canonical `compute_parent_summary`; desktop suite 69 files / 2,192 tests green; t-103-live-verification + t-105-live-verification docs.
- **Dependencies:** DATA-003 (the "−9.71M remise adjustments (correct)" classification of the 12th session was WRONG — this entry corrects it: those adjustments were the double-discount).

---

### DATA-011 — Workbook row 242 (SIDI MAMER SAMYI, 0554288142) was never imported — a whole family missing from the corpus

- **Category:** DATA  |  **Severity:** Critical  |  **Status:** VERIFIED (2026-09-01, T-105)
- **Repositories:** backend (live corpus)
- **Platforms affected:** all
- **Task:** T-105
- **Consolidated from:** NEW — 2026-09-01, T-105 corpus equivalence run (the M1 payments check found exactly one parent with xl_paid 748,500 vs db_paid 493,500)
- **Description:** workbook row 242 — student SIDI MAMER SAMYI (5AP, phone 0554288142, devis 255,000 = `=300000-J242` with remise 45,000; versements 255,000 = V2 75,000 + 2V 90,000 + v3 90,000; créance 0) — was **never imported**: no parent with that phone exists (not even soft-deleted), and only 2 of the family's 3 students exist under parent A (0550067500). Root cause: the same-named student under parent A (row 235) satisfied the (NEM, NOM) identity lookup so row 242's family was silently dropped by the 2026-08-11 bulk import — the same name-collision class as DATA-002. The school was owed nothing (créance 0) but the parent's 255,000 of versements were missing from every financial aggregate.
- **Evidence:** `SELECT * FROM parents WHERE primary_phone LIKE '%54288142%'` → 0 rows; parent e3e90f1f's students' payments 226,750 + 266,750 = 493,500 vs the workbook's 748,500 (the 255,000 delta is exactly row 242's versements); corpus duplicate-name analysis: 'SIDI MAMER SAMYI' is the ONLY duplicated student name in the workbook.
- **Expected behavior:** every workbook row must exist in the corpus (390 students, 259 parents including this one).
- **Resolution (T-105):** migration 0063 STEP 2 creates the family exactly per the workbook — parent (PAR-2026-<md5>, phone 0554288142), student (5ap, mirrors the import's name split), 3 tuition tranches from the 5ap grid net of remise (102,000 / 76,500 / 76,500 = 255,000 exactly), the devis charge (NET — no remise adjustment), 3 payment rows + their ledger entries, all replayed by STEP 4's waterfall.
- **Verification:** live spot-check: parent 0554288142 → netdue 255,000, paid 255,000, balance 0 (workbook créance 0 ✓); M1 payments 259/259 after the fix (was 258/259).
- **Dependencies:** none.


### BUG-NEW-004 — run-overdue-scan EF exceeds the edge-worker resource budget (WORKER_RESOURCE_LIMIT); the daily overdue scan cannot complete

- **Category:** BUG  |  **Severity:** High  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop — supabase/functions)
- **Platforms affected:** Backend
- **Task:** T-095 (docs/recovery/task-registry.md)
- **Status note:** FIXED + VERIFIED 2026-08-31 (T-095, 12th session): the EF was rewritten to the batched pattern of the T-094-verified desktop reference (ONE overdue query + ONE 7-day upcoming query + chunked parents/dedup fetches + ONE bulk INSERT per tenant) and redeployed live. Live evidence (t-095-live-verification.md): 401 deny matrix intact; valid CRON_SECRET → 200 in 8.6–10.9s (was WORKER_RESOURCE_LIMIT); 819 overdue / 68.13M DZD; THREE runs → 819 alerts unchanged (zero duplicates; dedup key ≡ desktop). CRON_SECRET rotated (hash-verified; no pg_cron consumer). Micro-divergence registered: EF excludes cancelled; desktop filters status≠paid only.
- **Discovered:** 2026-08-31, eleventh session, during T-068's live curl matrix (run-overdue-scan with a valid CRON_SECRET PASSED the auth gate, then died with WORKER_RESOURCE_LIMIT). Named in the T-068 commit message; registered here by the twelfth session's closeout (the 11th session ran out of context before registering it).
- **Description:** the EF iterates EVERY parent in the tenant (258 in production) and calls the `compute_parent_summary` SQL RPC sequentially (each call replays that parent's whole ledger), then per overdue parent fetches installments, then per overdue installment runs a dedup SELECT before a single-row INSERT. That is 258+ sequential round trips plus hundreds of small queries — far beyond the edge worker's CPU/wall-time budget. The function is killed with WORKER_RESOURCE_LIMIT before writing the per-tenant audit entry, so the daily overdue scan (cron 08:00 UTC) and the manual "Scan retards" path through the EF are both dead in production.
- **Location:** `elimtiyaz-desktop/supabase/functions/run-overdue-scan/index.ts:119-265` (the per-tenant / per-parent / per-installment loop nest)
- **Root cause:** the Tier-3 rewrite (migration 0034 era) ported the per-parent drill-down pattern without a set-based/batched equivalent; no load test against production row counts (258 parents, 318 ledger rows… but the ledger replay per RPC is heavy).
- **Expected behavior:** the scan completes within the worker budget and produces the same overdue installment set + idempotent notifications as the DESKTOP reference implementation (`SupabaseOverdueAlertGenerator`, T-080/T-094 live-verified) — which already uses the batched pattern: ONE installments query + ONE batched parents fetch + ONE batched dedup-key fetch + ONE bulk INSERT.
- **Proposed resolution:** T-095 — rewrite the EF's scan body to the batched pattern of the T-094-verified desktop reference (reuse, not a parallel implementation): per tenant, one overdue-installments query (status ≠ paid/cancelled, due_date < as_of, amount_due − amount_paid > 0.001), one upcoming-due (7 days) query, chunked parents fetch, chunked dedup-key fetch, bulk INSERT, per-tenant audit entry. Redeploy + live curl verification with a fresh CRON_SECRET (rotation documented).
- **Dependencies:** none
- **Verification:** live curl matrix (401s + valid-secret 200 with a real summary payload); notification idempotency re-checked (second run creates 0 duplicates); the desktop T-094 suite stays green.

---

## NEW ENTRIES (2026-08-30 — ninth recovery session, owner-requested)

### ARCH-009 — Migration 0050 drift: local file is `fcm_token_caller_verification.sql`, live DB has `chat_read_receipts` registered as version 0050

- **Category:** ARCH  |  **Severity:** High (process)  |  **Status:** MITIGATED (T-091 — 0051_chat_read_receipts.sql added + applied + registered)
- **Repositories:** Backend (migration chain)
- **Platforms affected:** all (fresh DB deploys were missing the chat_read_receipts migration)
- **Task:** T-091
- **Consolidated from:** NEW — discovered 2026-08-30 during the 9th session's live backend health re-verification
- **Description:** Session 8's T-084 work applied migration 0050 (`fcm_token_caller_verification.sql`) DIRECTLY via the Management API SQL endpoint (per the change-log note: "POST /v1/projects/{ref}/database/query with the platform access token"). That bypassed the migration system — the schema_migrations table was NOT updated, so version 0050 had no entry. LATER, the chat_read_receipts migration was applied (probably via the Supabase CLI), registering itself as version 0050 in schema_migrations and overwriting any previous record. The FCM functions persisted (CREATE OR REPLACE FUNCTION) so they're still present on the live DB; but the chat_read_receipts migration had no representation in the local repo (the only 0050 file in the repo is the FCM one). Consequence: a FRESH database deploy applying the local migration chain would apply 0050_fcm_token_caller_verification.sql (FCM functions ✓) but SKIP the chat_read_receipts migration entirely (policy + trigger + function MISSING ✗).
- **Evidence:** `SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version='0050'` returned name='chat_read_receipts' and statements=[chat read receipts SQL], but the local file `elimtiyaz-desktop/supabase/migrations/0050_fcm_token_caller_verification.sql` contains the FCM verification SQL. The FCM functions register_fcm_token + deactivate_fcm_tokens exist on the live DB (verified via pg_get_functiondef) with the SEC-106 caller verification logic.
- **Root cause:** two independent application paths (Management API SQL endpoint vs Supabase CLI migration system) and no reconciliation check. The session-8 agent applied SQL via the API endpoint (the only path available at the time per the change-log) but didn't register the migration row; a later agent applied the chat_read_receipts migration via the CLI which DID register it, overwriting the empty 0050 slot.
- **Resolution (T-091):** added `0051_chat_read_receipts.sql` to the local repo with idempotent `drop policy if exists + create policy + create or replace function + drop trigger if exists + create trigger`. Applied it live (idempotent no-op since the objects already exist). Registered the migration row in schema_migrations via the Management API SQL endpoint (idempotent INSERT … ON CONFLICT DO NOTHING).
- **What's now true:** a fresh DB deploy applying the local migration chain produces the same schema state as the live DB (FCM functions from 0050 + chat read receipts from 0051). The live DB's schema_migrations row at version 0051 is "chat_read_receipts" (registered manually).
- **Lessons for next agents:**
  1. Applying SQL via the Management API SQL endpoint does NOT update `schema_migrations`. To register a migration applied this way, INSERT into `supabase_migrations.schema_migrations` manually (use dollar-quoting `$$mig$...$$mig$` for the statements text — the migration SQL contains `$$` plpgsql markers).
  2. After any migration application, ALWAYS verify `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN (...) ORDER BY version;` — don't assume the migration row exists just because the SQL succeeded.
  3. The session-8 "applied live via the Management API SQL endpoint" pattern in the change-log is correct but incomplete — it skipped the schema_migrations registration step. Future sessions using this path MUST do step 2.
- **Dependencies:** none.

### DRIFT-013 — Desktop code calls `.from("expenses")` but the canonical table is `expense_tickets` (with different status values)

- **Category:** DRIFT  |  **Severity:** High  |  **Status:** TESTED
- **Status note (2026-08-31, tenth session):** Resolved 2026-08-31 (T-093, hub commit 1e91ebf): SupabaseExpenseRepository backs the `expenses` slot on the canonical expense_tickets table with a centralised status/category translation layer; migration 0056 added the missing payee column (applied live + registered); no .from('expenses') call sites remain (rg-verified). Remaining divergence (enum alignment, server-side self-approval = WEAK-030, server-side ticket numbers) recorded in the task entry.(dashboard KPI mitigated 2026-08-30 in T-089 — wider expenses-repository leak OPEN)
- **Repositories:** Desktop (domain model vs schema); Backend (canonical table)
- **Platforms affected:** Desktop (Supabase mode)
- **Task:** T-089 (dashboard KPI fix), T-093 (wider expenses-repository port — NEW)
- **Consolidated from:** NEW — discovered 2026-08-30 during T-089's live verification
- **Description:** The desktop domain model (`src/domain/model/expense.ts`) defines `ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "disbursed" | "settled"`. The live `expense_tickets` table (migration 0008) uses `status = "draft" | "pending_approval" | "approved_funds_released" | "rejected" | "disbursed" | "settled_and_closed"`. AND the desktop code (e.g. reports-tab, dashboard) calls `.from("expenses")` — a table that DOES NOT EXIST in the live schema. The canonical table is `expense_tickets` (migration 0008). The Supabase assembly (`supabase-repositories.ts`) never overrides the `expenses` slot — it stays on `MockExpensesRepository` even in Supabase mode, which is the same mock-leak class as ARCH-006 / ARCH-001.
- **Evidence:** T-089's verification script (`scripts/verify_t-089.sh`) called `.from("expenses")` and got HTTP 400 with `relation "public.expenses" does not exist`. The correct table is `expense_tickets` (verified by `grep "create table" 0008_expenses.sql` → `expense_categories`, `expense_tickets`, `expense_state_transitions`).
- **Root cause:** the desktop domain model + mock store was authored from a planning spec, not from the actual migration. When migration 0008 was applied (commit history predates the recovery docs), the desktop mock was never reconciled. Same drift class as BUG-NEW-001 (the `users` table reference).
- **Mitigation (T-089):** the dashboard KPI for `pendingExpenses` now queries `expense_tickets` with `status='pending_approval'` (the live DB values). The wider expenses-repository port (the `expenses` slot in the assembly + the ExpenseStatus enum mapping) is task T-093.
- **Proposed resolution (T-093):** (1) implement `SupabaseExpenseRepository` that maps the desktop domain `ExpenseStatus` ↔ the DB `expense_tickets.status` (with a translation layer); (2) override the `expenses` slot in `supabase-repositories.ts`; (3) update the ExpenseStatus enum to align with the DB values OR add a mapping layer (per AGENTS.md §15.9 — prefer aligning the desktop enum to the canonical DB values, NOT the other way around, since the DB is the source of truth per ADR-001); (4) regression-test with the mock + supabase assembly contracts.
- **Dependencies:** none technical; needs product confirmation on the status-value rename if the desktop enum changes.

### ARCH-010 — Dashboard UI duplication + dead code (overview charts duplicated the SeeDetailsModal drill-down)

- **Category:** ARCH  |  **Severity:** Medium (UX defect)  |  **Status:** FIXED (T-088 — dashboard restructured 2026-08-30)
- **Repositories:** Desktop
- **Platforms affected:** Desktop
- **Task:** T-088
- **Consolidated from:** owner-requested 2026-08-30 — "the statistics dashboard portal is not very logical"
- **Description:** The desktop Dashboard had three classes of "demo-around-mock-data" defects the owner flagged:
  1. DUPLICATION — the Overview tab embedded the revenue bar chart, debt-aging bars, and 2 demographics charts (grade + gender). The SAME charts appeared inside the SeeDetailsModal drill-down (with age + capacity added). Clicking "Voir les détails" re-rendered the same pies with extras.
  2. RE-FETCH — SeeDetailsModal re-fetched revenue / debt / demographics on open via `repos.dashboard.revenueLast12Months()` / `debtByAging()` / `demographics()`. The page had ALREADY fetched the same data via `kpisForRange / revenueForRange / debtByAgingForRange / demographics`. Two HTTP round-trips per modal open, plus the modal's "last 12 months" data could drift from the page's "academic year to date" data.
  3. DEAD Stat CARD — the Overview's bottom card restated KPIs already in the grid above ("Revenu cumulé", "Créances", "Taux de recouvrement"). Pure dead UI.
  4. DEAD "PDF" REPORT BUTTON — the Reports tab advertised a "PDF" format on the "Revenu mensuel" card; clicking returned "Bientôt disponible" (a fake feature). The XLSX format was the only one actually implemented.
  5. HARDCODED ZEROS — 4 of the 8 KPIs in Supabase mode returned 0 (totalStaff, pendingExpenses, attendanceRateToday, overdueAlerts), making the dashboard blind to staff count, pending expenses, today's attendance, and unread overdue alerts.
- **Resolution (T-088 + T-089):**
  - OverviewTab restructured: 8 KPI grid (4 financial + 4 operational), calendar (operational), Top Debtors quick-list. No charts that duplicate the drill-down. Dead Stat card removed.
  - SeeDetailsModal restructured: receives ALL data via the `data` prop from the page (no re-fetch on open). Departments sub-tab stops calling `repos.payments.observe().get()` (the mock-only leak); it derives from the page-level revenue series + an honest empty state when per-category data isn't exposed.
  - ReportsTab: dead "PDF" button removed from the "Revenu mensuel" card (XLSX is the only advertised format now).
  - T-089 backfilled the 4 hardcoded Supabase KPIs to real queries against `personnel`, `expense_tickets`, `attendance_records`, `notifications`.
- **Tests:** new dashboard-restructure regression suite (10 tests in `src/tests/ui/dashboard-restructure.test.tsx`) — asserts the duplicate charts are gone, the dead Stat card labels are gone, the KPI grid is 8 cards, the routing (Unread Alerts → Alerts tab; every other KPI → drill-down) is correct.
- **Verification:** typecheck clean; lint 0 errors (311 baseline warnings unchanged); 47 test files / 2029 tests ALL PASS (was 46/2021 before this session). Live SQL verification for the 4 new KPIs (`scripts/verify_t-089.sh`) confirms: totalStaff=0 (honest — personnel empty in production), pendingExpenses=0 (no pending_approval tickets), attendanceRateToday=0 (attendance_records empty), overdueAlerts=269 (matches the audit doc).
- **Dependencies:** none.

### ARCH-011 — Live/local migration drift recurrence: 0053 + 0054 applied live but never committed to the repo

- **Category:** ARCH  |  **Severity:** High  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB
- **Task:** MIG-TOKENS (10th session, 2026-08-31)
- **Discovered:** opening live-DB inspection of the 10th session (schema_migrations head = 0054 while the local chain ended at 0052).
- **Description:** Migrations 0053 (`tenant_scoped_rbac`, = T-005/TENANT-100/101/102) and 0054 (`auth_trigger_no_client_metadata`, = T-007/SEC-108) were applied to the live project AND registered in `supabase_migrations.schema_migrations`, but the corresponding files did not exist in the local canonical chain — a fresh deployment would have MISSED both the tenant-scoped RBAC resolver/policies and the auth-trigger hardening. Same drift class as ARCH-009 (T-091's 0051 reconciliation): SQL applied directly via the Management API SQL endpoint by a previous actor, files never committed.
- **Root cause:** the Management-API application path bypasses the migration system unless the file is committed in the same step; no process rule forced the reconciliation until a later agent re-inspected the live chain.
- **Resolution:** reconciliation files `0053_tenant_scoped_rbac.sql` + `0054_auth_trigger_no_client_metadata.sql` added (definitions extracted verbatim from live `pg_get_functiondef`/`pg_policies`), both dry-run verified inside BEGIN..ROLLBACK against the live DB (`scripts/verify_mig-tokens_0053_0054.sh`, HTTP 201) — validity + idempotency on the real schema without mutation.
- **Rule (see AGENTS.md amendment):** every live SQL application MUST ship its migration file + registration in the SAME commit; a session opening backend work MUST diff `schema_migrations` against the local chain FIRST.

---

### WEAK-030 — Expense-approval state machine enforced client-side only (RLS has no self-approval or transition guard)

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** follow-up to T-093 (needs a new migration)
- **Discovered:** during T-093's SupabaseExpenseRepository port (2026-08-31).
- **Description:** the expense_tickets RLS policies (0008) scope writes by tenant + role/submitter but do NOT enforce (a) the no-self-approval rule (a submitter can approve their own ticket via direct PostgREST) nor (b) the status state machine (any allowed-role caller can jump the ticket to any status value). The desktop adapter and mock both enforce these rules client-side; a direct API caller bypasses them.
- **Proposed resolution:** a trigger (or 0057 migration) enforcing transitions + rejecting approver = submitter, mirroring enforce_payment_proof's style.
- **Verification:** migration-level test with the full canonical chain; regression test reproducing both bypasses.

---

### ARCH-011 — Live/local migration drift recurrence: 0053 + 0054 applied live but never committed to the repo

- **Category:** ARCH  |  **Severity:** High  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB
- **Task:** MIG-TOKENS (10th session, 2026-08-31)
- **Discovered:** opening live-DB inspection of the 10th session (schema_migrations head = 0054 while the local chain ended at 0052).
- **Description:** Migrations 0053 (`tenant_scoped_rbac`, = T-005/TENANT-100/101/102) and 0054 (`auth_trigger_no_client_metadata`, = T-007/SEC-108) were applied to the live project AND registered in `supabase_migrations.schema_migrations`, but the corresponding files did not exist in the local canonical chain — a fresh deployment would have MISSED both the tenant-scoped RBAC resolver/policies and the auth-trigger hardening. Same drift class as ARCH-009 (T-091's 0051 reconciliation): SQL applied directly via the Management API SQL endpoint by a previous actor, files never committed.
- **Root cause:** the Management-API application path bypasses the migration system unless the file is committed in the same step; no process rule forced the reconciliation until a later agent re-inspected the live chain.
- **Resolution:** reconciliation files `0053_tenant_scoped_rbac.sql` + `0054_auth_trigger_no_client_metadata.sql` added (definitions extracted verbatim from live `pg_get_functiondef`/`pg_policies`), both dry-run verified inside BEGIN..ROLLBACK against the live DB (`scripts/verify_mig-tokens_0053_0054.sh`, HTTP 201) — validity + idempotency on the real schema without mutation.
- **Rule (see AGENTS.md amendment):** every live SQL application MUST ship its migration file + registration in the SAME commit; a session opening backend work MUST diff `schema_migrations` against the local chain FIRST.

---

### WEAK-030 — Expense-approval state machine enforced client-side only (RLS has no self-approval or transition guard)

- **Category:** WEAK  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Backend/DB, Desktop
- **Task:** follow-up to T-093 (needs a new migration)
- **Discovered:** during T-093's SupabaseExpenseRepository port (2026-08-31).
- **Description:** the expense_tickets RLS policies (0008) scope writes by tenant + role/submitter but do NOT enforce (a) the no-self-approval rule (a submitter can approve their own ticket via direct PostgREST) nor (b) the status state machine (any allowed-role caller can jump the ticket to any status value). The desktop adapter and mock both enforce these rules client-side; a direct API caller bypasses them.
- **Proposed resolution:** a trigger (or 0057 migration) enforcing transitions + rejecting approver = submitter, mirroring enforce_payment_proof's style.
- **Verification:** migration-level test with the full canonical chain; regression test reproducing both bypasses.

---

---

### ARCH-012 — `testReleaseUnitTest` fails: GreetingScreenshotTest cannot resolve the release-variant launcher activity

- **Category:** ARCH  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android (test infrastructure)
- **Task:** registered 2026-08-31 (13th session); needs triage — likely T-082-adjacent (test-gate hygiene)
- **Discovered:** 2026-08-31, 13th session, during the T-050 full-suite verification run.
- **Description:** `./gradlew test` (both variants) fails on the RELEASE unit-test variant: `GreetingScreenshotTest > greeting_screenshot` → `java.lang.RuntimeException: Unable to resolve activity for Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=com.aistudio.elimtiyazstaff.bxmzlx/androidx.activity.ComponentActivity }` (Robolectric issue, see robolectric/robolectric#4736). The DEBUG variant of the exact same test passes (234/234). The release build's applicationId suffix (`.bxmzlx`) appears to defeat Robolectric's launcher-activity resolution.
- **Evidence (pre-existing, NOT caused by T-050):** the failure was reproduced on a PRISTINE tree — the 13th session's sync changes were stashed (`git stash push -- app/src/main/.../sync/` + the new test file moved aside) and `./gradlew testReleaseUnitTest --tests com.example.GreetingScreenshotTest` failed identically (log preserved at /home/z/my-project/.t050-pristine.log). No activity/manifest change exists in the 13th-session diff.
- **Root cause:** suspected: Robolectric + release applicationId suffix interaction; NOT yet investigated in depth (needs manifest merge inspection).
- **Current behavior:** the full `./gradlew test` task is red on the release variant; the debug variant (the variant every historical "219/219" / "234/234" claim actually exercised) is green.
- **Expected behavior:** both variants green, or the release screenshot test explicitly excluded with a documented reason.
- **Proposed resolution:** triage in a future session — either configure Robolectric's release-variant manifest handling or scope GreetingScreenshotTest to the debug variant with a documented note. Register as a task when picked up.
- **Dependencies:** none recorded
- **Verification:** fix must show BOTH variants green (or the documented exclusion) before status moves past TESTED.


---

### ENV-300 — Unset NEXT_PUBLIC_DEFAULT_LOCALE made the ENTIRE env parse fail, resetting every env value to ""

- **Category:** ENV  |  **Severity:** Medium  |  **Status:** TESTED
- **Repositories:** elimtiyaz-website
- **Platforms affected:** Website (configuration)
- **Task:** T-096 (fixed as part of the out-of-the-box config task, 14th session)
- **Discovered:** 2026-08-31, 14th session, while writing the T-096 regression tests (the module-level env parse produced empty strings even when public defaults were present).
- **Description:** `src/lib/env.ts` fed `process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? ""` into `z.enum(["fr","ar","en"])`. An UNSET locale therefore arrived as `""` — which is NOT `undefined`, so the zod `.default("fr")` never applied; the enum rejected `""`, `safeParse` FAILED for the whole object, and the fallback `envSchema.parse({})` reset EVERY value to the zod default `""` — including a correctly-set URL + anon key. The portal then showed "Missing configuration" even when the env vars were present.
- **Root cause:** the empty-string sentinel for "unset" collided with the enum validator; the failure mode (one invalid field nukes all fields) was never tested.
- **Resolution:** locales that are empty/unknown now resolve to `undefined` (so `.default("fr")` applies) and the parse succeeds; APP_NAME uses `||` with its default. Regression tests: `src/lib/t-096-portal-default-config.test.ts` (5/5).
- **Verification:** vitest 5/5 incl. the fresh-clone (no env vars) case; full suite 153/153; live headless render with no .env.local shows the Google button (no banner).

---

### TEST-300 — T-050 desktop test asserted the WRONG host (could never pass; session-13 "all pass" claim not reproducible)

- **Category:** TEST  |  **Severity:** Low  |  **Status:** TESTED
- **Repositories:** AgentGithubUplaod (desktop)
- **Platforms affected:** Desktop (test infrastructure / verification integrity)
- **Task:** fixed in the 14th session (2026-08-31)
- **Discovered:** 2026-08-31, 14th session, during the session-opening full-suite run (2 failures in `t-050-online-detector.test.ts` on a pristine tree with zero desktop src changes).
- **Description:** `t-050-online-detector.test.ts` compared `resolveProbeUrl("https://example.supabase.co")` against a constant `HEALTH = "https://acme-school.supabase.co/auth/v1/health"` — different host from the input. The implementation is CORRECT (it maps the INPUT host, per T-050's own semantics: probe YOUR backend); the test's constant was wrong, so the two assertions could never pass.
- **Root cause:** test-authoring slip in the 13th session (commit 0b37d13). IMPORTANT verification-integrity note: the 13th session's closeout claimed "desktop 65 files / 2165 tests ALL PASS" — that claim is NOT reproducible at HEAD as pushed; the next agent must treat per-file evidence (not only summary claims) as the verification record.
- **Resolution:** the constant is now host-consistent (`https://example.supabase.co/auth/v1/health`); 13/13 pass.
- **Verification:** `npx vitest run src/tests/infrastructure/t-050-online-detector.test.ts` — 13/13; full suite re-run this session.

---

### ANDR-CHAT-200 — Android has NO chat UI at all (scope gap exposed by the chat completion)

- **Category:** FEAT  |  **Severity:** Medium  |  **Status:** OPEN
- **Repositories:** elimtiyaz-android
- **Platforms affected:** Android
- **Task:** T-102 (registered 2026-08-31, 14th session)
- **Discovered:** 2026-08-31, 14th session, while executing the owner's "fix and test the chat in all platforms" instruction (repo-wide chat search on Android returned only `USE_CHAT` / `MANAGE_CHAT_CHANNELS` permission constants in `core/Rbac.kt:66`).
- **Description:** chat is now real end-to-end on desktop + website + backend (ADR-008), but the Android staff app has never had any chat screen, repository, or Room cache — "all platforms" cannot include Android chat until it is built. This is a scope gap (the feature was never started there), not a regression.
- **Expected behavior:** decision needed: build a chat screen (channels list + messages + read-receipts) against the same tables, or explicitly declare Android chat out of scope and prune the `USE_CHAT` permission constants.
- **Proposed resolution:** T-102 — implement the Android chat screen on the canonical tables (RLS already authorises staff), or prune the dead permission codes. Depends on ADR-005 (write architecture) only if chat writes must queue offline; read-only chat + online sends are feasible now.
- **Dependencies:** ADR-005 (offline write queueing) — read-side and online sends are unblocked.
- **Verification:** when built: same contract as desktop (channels where member, messages ordered by sent_at, read_by append-only) + `./gradlew test` green.


---

### AUTH-200 — Google OAuth provider not enabled on the live Supabase project (portal sign-in dead)

- **Category:** AUTH  |  **Severity:** Critical  |  **Status:** OPEN (owner action required)
- **Repositories:** backend (Supabase project config), elimtiyaz-website
- **Platforms affected:** Website (parent portal login)
- **Task:** owner runbook `docs/operations/portal-google-oauth.md`
- **Discovered:** 2026-08-31, 13th session (portal configured but sign-in failed); re-verified live 2026-08-31, 14th session via the Management API: `external_google_enabled: false`, `external_google_client_id: EMPTY`, `external_google_secret: EMPTY`.
- **Description:** the portal's ONLY auth path is Google OAuth (T-009 removed mock auth; SEC-100-class passwords are not a portal path). The provider is disabled server-side, so the Google button renders (and is enabled client-side since T-096) but the OAuth round-trip cannot start. NOTE: this entry was referenced by the 13th session's closeout (next-task, current-state) but was never actually registered here — fixed in the 14th session.
- **Root cause:** enabling the provider requires a Google Cloud OAuth client (client id + secret) that only the owner can create (school Google account, consent screen, callback `https://hkvkefubghbbotgnteir.supabase.co/auth/v1/callback`).
- **Resolution (owner):** follow `docs/operations/portal-google-oauth.md` steps 1-3 (~10 min in the Google Console + one PATCH call). The 14th session already set `uri_allow_list = http://localhost:3000,http://localhost:3100` (comma-separated STRING — the Management API rejects arrays; discovery documented in the runbook) so the local dev round-trip works once enabled.
- **Verification:** after the owner enables it: full browser sign-in round-trip on the portal + `external_google_enabled: true` via the API; then flip this entry to TESTED.

### AUTH-300 — Desktop sign-in returns 400 (admin credential invalid after the long idle gap)

- **Category:** AUTH  |  **Severity:** Critical  |  **Status:** VERIFIED-FIXED (2026-09-01, 17th session)
- **Repositories:** backend (Supabase auth), AgentGithubUplaod (desktop client)
- **Platforms affected:** Desktop (staff app sign-in)
- **Task:** T-106 (owner-reported blocker, 17th session)
- **Discovered:** 2026-09-01 — owner report: "the desktop doesn't want to login", renderer console showing repeated `POST /auth/v1/token?grant_type=password → 400`.
- **Diagnosis (evidence-based, no guessing):**
  1. The client path is clean — `SupabaseAuthRepository.signIn` calls `signInWithPassword` directly with no transformation.
  2. Both public key formats are accepted server-side: `auth/v1/health` 200 and REST queries process with the legacy anon JWT AND the new `sb_publishable_…` key (so the 400 was NOT an API-key problem).
  3. The auth user census (admin API, service_role): exactly one user — `admin@elimtiyaz.dz`, confirmed, not banned; `last_sign_in_at = 2026-08-30T01:28:59Z` (16th-session era).
  4. Reproducing the grant with a dummy password returns exactly the owner's symptom: `HTTP 400 {"error_code":"invalid_credentials"}` — i.e. the credentials being used no longer match. Server-side state was healthy; the shared secret was the failing part (SEC-100's 2026-08-29 password leak + rotation guidance made this the expected failure mode after an idle gap).
- **What was changed:** the admin password was RESET via the auth admin API (`PUT /auth/v1/admin/users/{id}` with the service_role key the owner supplied for this purpose) to a fresh 32-char random value, delivered out-of-band to the owner. NO client code was changed (there was nothing wrong client-side) and NO user rows / audit data were touched.
- **Verification (live, 2026-09-01):** `grant_type=password` → HTTP 200 with the legacy anon JWT as apikey; HTTP 200 with the new publishable key as apikey; the resulting session JWT successfully calls `current_user_roles()` → `["super_admin"]` (RLS path proven end-to-end). Script: `scripts/desk_login_200.sh` (idempotent re-runnable; the password value itself stays out of git per AGENTS.md §15.12).
- **Residual risk / owner guidance:** the desktop stores its URL+key locally (Settings → Configuration) — unchanged and still valid. If sign-in fails again after this reset, the error body (`error_code`) now distinguishes `invalid_credentials` (password) from `invalid_api_key` (config). T-106 also documents the recovery procedure below.
- **Recovery procedure (for future agents):** never guess a credential state from the 400 alone — (a) admin-API census, (b) dummy-grant probe for the error_code, (c) health+REST probe for key validity, (d) only then reset the credential with the owner's service_role authorization. Document the rotation OUT-OF-BAND only (credentials sheet records the EVENT, never the value).

### KEYMIG-300 — New-format Supabase API keys not yet adopted consistently across the three platforms

- **Category:** CONFIG  |  **Severity:** Medium  |  **Status:** TESTED (2026-09-01, 17th session — live dual-key verification)
- **Repositories:** AgentGithubUplaod (desktop + docs), elimtiyaz-website, elimtiyaz-android
- **Platforms affected:** All three clients + backend key policy
- **Task:** T-107 (owner mandate, 17th session: "apply the migration tokens… consistent everywhere")
- **Discovered:** 2026-09-01 — the owner supplied the project's new-format keys (`sb_publishable_…` / `sb_secret_…`); a per-platform audit showed the website committed only the legacy anon JWT as its public default, the desktop dialog documented only the legacy format, while Android (since session 8) already dual-accepted. No registered documentation covered the new keys at all.
- **Resolution:** ADR-009 — dual acceptance, publishable-preferred; full state table + live evidence in `docs/operations/credentials.md` §8; per-platform changes under task T-107.
- **Verification:** website 419/419 tests (+4 guards) + build green; desktop typecheck clean + lint 0 errors + 2196/2196 tests (+4 guards); live dual-key matrix (health/REST/password-grant × both formats) recorded in the credentials sheet. Residual: a deployed portal re-render against the new default (owner's next deploy) — recorded as T-107's gap.
