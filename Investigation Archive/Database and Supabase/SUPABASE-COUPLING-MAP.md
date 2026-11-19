# Supabase Coupling Map — Session 3 (2026-11-19)

**Investigator:** Agent S3-A (Task 3-a) · **Mode:** read-only source audit · **Purpose:** a complete map of every place the codebase couples to Supabase, rated by coupling severity and migration risk, in preparation for the owner's local-first migration on Windows (local primary DB, multi-user sync without Supabase quota traps).
**Method:** every count below comes from a command this session actually ran (`rg` / `ls` / `wc` / `grep` / a Python census helper); file:line citations were read directly. Live-probe results in §6 were relayed by the session lead (this agent ran no network calls — read-only mandate). Cross-references: `Initial Reports Analysis/07-Supabase-report-verification.md` (the 54-RPC census, EF inventory, SQL-vs-TS table), `Database and Supabase/LIVE-CENSUS-2026-11-19.md` (100-table chain census), `Core Logic Unification/02-import-and-fetching-audit.md` (ARCH-019 list), `Findings and Hypotheses/FINDINGS_INDEX.md` (all IDs).

---

## 1. Executive summary

**Total coupling footprint (this session's counts):**

| Category | Files | Lines | Headline evidence |
|---|---|---|---|
| Supabase infrastructure layer (`src/infrastructure/supabase/`) | 42 | 26,684 | `find … | xargs wc -l` |
| — of which repository adapters (`repositories/`) | 37 | 24,277 | biggest: shared 5,250 · academic 2,622 · timetable 1,583 |
| Edge Functions (`supabase/functions/`) | 16 folders / 22 .ts | 7,284 | `wc -l supabase/functions/*/*.ts` |
| SQL migrations (`supabase/migrations/`) | 152 | 43,388 | + `bootstrap/9000_…sql` 1,070 lines + `config.toml` 141 |
| Feature/app/shared files importing `supabase-client` directly | 11 (9 features + 2 app/shared) | — | ARCH-019's 9 re-verified verbatim; 2 more outside `features/` |
| Infrastructure files outside `supabase/` importing it | 6 (system-config, media-vault, ai/llm-adapter, sync ×3) | — | §3h table |
| Scripts coupled to live Supabase | 292 in `elimtiyaz-desktop/scripts/` + 54 repo-root | — | 193 reference `SUPABASE_*` tokens; 75 `apply_*_live.sh` |
| Test files touching Supabase | 188 of 321 | — | 107 import `infrastructure/supabase`; 19 read EF source |
| Governance/docs referencing Supabase | 144 docs files incl. 19 of 30 ADRs | — | §3k |

**Runtime surface:** 56 distinct RPC names (multiline-aware Python census over non-test `src/`; 07-report headline said 54 — its own §6 table enumerates ~56), 89 `.rpc()` call sites in 20 files, 496 `.from()` table queries touching **73 of the 99 live chain tables** (26 chain tables are RPC/EF/trigger-only from the desktop's perspective), 7 edge functions invoked from the desktop, 5 private storage buckets, 1 realtime channel over 6 tables, GoTrue for the entire auth lifecycle.

**Biggest risks:** (1) packaged builds are **hard-locked** to the canonical project (`supabase-client.ts:35–38,148–157`) and `validateConnection` rejects any non-`*.supabase.co` URL (`system-config.ts:431–433`) — a local-first backend cannot even be pointed at without code changes; (2) **ADR-002 makes server-side SQL the authoritative financial engine** — the 56 RPCs are not data access, they *are* the business logic; (3) **authorization lives in 324 RLS policies** (my comment-aware census; 07-report: ~331) that evaporate the moment the PostgREST gateway is gone; (4) four platform services (GoTrue, Realtime, Storage, Edge Functions + Management API) have no local counterpart for account lifecycle, push, and secrets.

**Verdict.** The app is heavily but *orderly* entangled. The 54-slot repository interface with a mock twin (49 Supabase overrides, fail-closed, ARCH-005/006) is a genuinely good decoupling seam — features are almost entirely Supabase-ignorant (165 `useObservable` sites, 0 direct SDK use outside the 11 catalogued bypasses). But the seam decouples the *client* from the *protocol*, not the *system* from the *platform*: business logic (SQL RPCs + EFs), authorization (RLS), identity (GoTrue), freshness (Realtime) and files (Storage) all still live server-side. For a local-first migration the seam is the right foundation — roughly the data-plane half of the work — while the other half (auth, RLS re-homing, EF retirement/port, SQL logic re-homing into the TS engines that already mirror it, realtime replacement) is CRITICAL, high-effort, and almost entirely *outside* the existing seam.

---

## 2. Rating methodology

**Coupling severity (1–5):**

| Sev | Definition |
|---|---|
| 1 | Incidental mention (comment, doc, test fixture name); no runtime dependency. |
| 2 | Configuration/documentation coupling only — strings, env names, or docs that name Supabase but execute nothing against it. |
| 3 | Runtime dependency fully behind an existing port/seam (repository interface or adapter contract); swappable with bounded work. |
| 4 | Runtime dependency with no port — direct SDK use outside the seam, or server-side logic with only a partial local mirror. |
| 5 | Structural dependency — behavior cannot run without Supabase or a faithful reimplementation of a platform service (auth, realtime, storage, cron, Management API). |

**Migration risk:**

| Risk | Definition |
|---|---|
| L | Trivial: delete/replace; no data, behavior, or test surface at stake. |
| M | Bounded rework; a local counterpart or TS mirror already exists and is test-pinned. |
| H | Significant rework: multiple files, SQL logic to port, or a large test surface invalidated. |
| CRITICAL | Requires porting server-side business logic or replacing a platform service with no drop-in local equivalent; mistakes lose data, authorization integrity, or the ability to boot in production mode. |

---

## 3. Coupling map by category

### a. Client factory & config/env

| Path | Key symbols | Supabase surfaces | Sev | Risk | Decoupling note |
|---|---|---|---|---|---|
| `src/infrastructure/supabase/supabase-client.ts` (293 ln) | `getSupabaseClient`, `isSupabaseConfigured`, `useSupabase`, `supabaseUrl`, `supabaseAnonKey`, `normalizeSupabaseUrl`, `supabaseErrorToAppError` | createClient; GoTrue persistSession/autoRefresh/detectSessionInUrl (`:196–206`); Realtime `eventsPerSecond:10` (`:207–209`); Postgres/PostgREST error-code mapping 23505/23503/42501/PGRST116 (`:260–290`) | 5 | **CRITICAL** | THE seam-owner. Hard-locks production: canonical URL + publishable key at `:35–38`; `VITE_DESKTOP_PRODUCTION=true` ignores local config entirely (`:148–157,171–172`). Session `storageKey` pinned to project ref (`:205`). A local backend requires editing this file — and the PG error-code mapping is Postgres-specific (reusable if local DB stays Postgres). |
| `src/infrastructure/system-config.ts` (548 ln) | `SystemConfigService`, `LocalConfigService`, `validateConnection`, `saveConnectionAndRestart` | `system_settings` table read/write (`:204–303`); `update-server-secret` EF invoke (`:331`) + raw `fetch …/functions/v1/update-server-secret` DELETE (`:359–368`); REST probe `/rest/v1/tenants` (`:439`) | 4 | **CRITICAL** | `validateConnection` **rejects any URL that is not `https://…supabase.co`** (`:431–433`) — the Configuration tab cannot accept a local backend URL. Local config itself (Electron `userData/config.json` via IPC, localStorage fallback) is a clean pattern to keep. |
| `src/vite-env.d.ts` (`:62–79`) | `ImportMetaEnv` | Declares `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_USE_SUPABASE` | 2 | L | Typings only; no `.env` files are committed (verified: no `*.env*` in `elimtiyaz-desktop/` root). |
| `electron/main.cts`, `electron/preload.cts` (243 ln main) | `window.elImtiyaz.config` IPC bridge | **None** (verified: zero "supabase" hits in both files) | 1 | L | Electron main/preload are Supabase-clean — the entire coupling is renderer-side. Migration does not touch the process layer. |
| Env names (renderer) | — | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`, `VITE_USE_SUPABASE`, `VITE_DESKTOP_PRODUCTION` (`supabase-client.ts:112–121,170`) | 2 | M | 5 names, all read in exactly one file; a backend-agnostic config needs 2–3 (URL, key/mode). |

### b. Repository layer

37 adapter files + the factory = 24,277 + 532 lines. The 07-report's 54-RPC census (its §6) remains the authoritative call-site map — my re-census found **56 distinct names** (adds `create_pricing_config_for_year`, `generate_receipt_numbers`, `collect_and_allocate_payment` — multiline `.rpc(\n"…"` call shapes its single-line grep missed). Not re-derived here; see `07-Supabase-report-verification.md` §6 for the name→migration mapping.

| Path (all under `src/infrastructure/supabase/`, `repositories/` unless noted) | Key symbols (classes) | Supabase surfaces | Sev | Risk | Decoupling note |
|---|---|---|---|---|---|
| `supabase-repositories.ts` (532 ln) | `getSupabaseRepositories`, `RepositoriesWithApprovals` | Factory: spreads `mockRepositories` (54 slots) then overrides **49 slots** + `Object.assign(approvals)` (verified: 49 override keys at `:421–486`; ARCH-006's 5 mock-remaining slots: clubs, psychology, orthophonie, aiConfig, performanceReviews) | 4 | M | This IS the local-first injection point: a third factory (`getLocalRepositories`) slots in without touching features. The mock spread must be removed for production-local mode (ARCH-006 leak). |
| `supabase-shared-repositories.ts` (5,250 ln) | `SupabaseParentRepository`, `SupabaseStudentRepository`, `SupabasePaymentRepository`, `SupabaseLedgerRepository`, `SupabaseInstallmentRepository`, `SupabaseDebtRepository`, `writeAuditMirror`, `getTenantId/requireTenantId/getActorId`, `readWithSeedRetry`, `runGatedCollectionRead`, `paginateKeyset`, `callCollectionRpc`, `rpcWithIdempotentRetry` | Financial core RPCs (`collect_and_allocate_payment` :2505, `revert_payment_allocation` :2557, `mark_payment_cleared/bounced`, `create_manual_debt`, `adjust_installment_amount`, `compute_debt_aging_summary`, `read_debt_aging_thresholds`, `generate_receipt_numbers`, `notify_parent_user`, `soft_delete_*`); tenants read from localStorage session (`:166–186`) | 5 | **CRITICAL** | The financial write path is SQL-authoritative (ADR-002); the TS mirrors (`waterfall-allocator.ts`, `lifo-reversal.ts`, `balance.ts`, `debt-aging.ts`, `tranche-waves.ts`) exist and are parity-pinned (07 §4) — the port target. `getTenantId()` reading the domain session means tenant scoping is already client-managed (good for local). |
| `supabase-academic-repository.ts` (2,622 ln) | `SupabaseAcademicYearRepository`, `SupabaseAcademicLevelRepository`, `SupabaseClassRepository`, `SupabaseSubjectRepository`, `SupabaseGradeRepository`, `SupabaseAttendanceRepository`, `SupabaseHomeworkRepository`, `SupabasePromotionRepository`, `SupabaseClassPlacementRepository`, `SupabasePromotionCycleRepository`, `SupabaseReEnrollmentRepository` | 21 `fn_*` RPCs (promotion cycles 0108, re-enrollment 0128, placements 0096, batch promotion, timetable-independent academics); 26 `.from()` table queries | 5 | **CRITICAL** | Workflow-shaped business logic lives in SQL; no TS mirrors exist for promotion-cycle / re-enrollment state machines — must be ported or re-homed as local transactions. |
| `supabase-timetable-repository.ts` (1,583 ln) | `SupabaseTimetableRepository` | `fn_timetable_publish` (0109), 5 timetable tables | 4 | H | Publish atomicity is SQL; solver is client-side already. |
| `supabase-workflow-repository.ts` (634 ln) | `SupabaseWorkflowRepository` | `workflow-execute` EF invoke (execute `:391`, dryRun `:476`); workflows/workflow_runs tables | 4 | H | Desktop already owns a dry-run engine (`domain/calc/workflow/dry-run.ts` + `condition-evaluator.ts`); the EF engine was ported FROM the desktop (07 §5). Local execution = promote the dry-run engine to primary (watch the 0088 divergence). |
| `supabase-workflow-run-repository.ts` (129 ln) | `SupabaseWorkflowRunRepository` | workflow_runs table | 3 | M | Plain CRUD. |
| `workflow-dispatch.ts` (66 ln) | `setWorkflowDispatcher`, `dispatchWorkflowTriggerSafe` | None (late-bound seam) | 2 | L | Supabase-free by design; reusable verbatim. |
| `registration-billing-wires.ts` (326 ln) | `buildBillingWires` (pure) | None (pure wire-shape builder) | 2 | M | Amounts stay client-derived (§15.39b header) — good for local-first; only the wire *shapes* are Supabase-RPC-specific. |
| `auto-releve-bridge.ts` (62 ln) | `logAutoReleveSideEffect` | `record_auto_releve_entry` RPC (0141, SECURITY DEFINER) | 4 | M | Fail-safe side effect (never throws); local replacement is an in-process call to the same rule table. |
| `supabase-overdue-alert-generator.ts` (505 ln) | `SupabaseOverdueAlertGenerator` | notifications/debt-aging RPCs; INV-4 formula incl. `amount_pending` (`:161–173`) | 4 | H | Diverges from `run-overdue-scan` EF (07 §3.1) — local-first should canonize THIS one (it is the fuller formula) and delete the EF twin. |
| `supabase-pricing-repository.ts` (913 ln) | `SupabasePricingRepository` | pricing_configs/grade_level_tuition/discounts tables; `set_active_pricing_config`, `create_pricing_config_for_year`, `upsert_setting` | 3 | M | Pricing math already lives client-side (`school-price-matrix.ts`, `discount-engine.ts`); SQL is storage (07 §4). |
| `supabase-expense-repository.ts` (854 ln) | `SupabaseExpenseRepository` | expense_tickets/categories/attachments; `uploadPrivateMedia` (expense-receipts bucket); `current_user_profile_id` | 4 | M | State machine (expense_state_transitions) is trigger-written server-side — must be re-homed. |
| `supabase-personnel-repository.ts` (953 ln) | `SupabasePersonnelRepository`, `SupabaseDepartmentRepository`, `RoleLookup` | personnel/departments/salary_payments; `adjust_personnel_salary`, `record_salary_disbursement` (0095) | 4 | M | Salary ledger in SQL; payroll *forecast* is TS-only (ADR-024). |
| `supabase-chat-repository.ts` (646 ln) | `SupabaseChatRepository` | chat_channels/chat_messages; `create_direct_channel` (0061→0105); member-scoped RLS (0135/0156) | 4 | H | Channel-eligibility is enforced by SQL triggers (0135) — port required. |
| `supabase-approval-repository.ts` (585 ln) | `SupabaseApprovalRepository` | `approve-signup-request` EF ×5 (`:253,292,320,353,416`), `bind-activation-code` EF (`:469`), `generate_activation_code` RPC, account_approval_requests/activation_codes tables | 5 | **CRITICAL** | Approval + activation are EF+SQL flows (role escalation guards live server-side); see §3c/§3f. |
| `supabase-user-account-repository.ts` (276 ln) | `SupabaseUserAccountRepository` | `create-user-account` / `delete-user-account` EFs (`:116,243`) — GoTrue admin API | 5 | **CRITICAL** | No local counterpart: creating/deleting *auth* users is a platform operation (§3f). |
| `supabase-auth-repository.ts` (253 ln) | `SupabaseAuthRepository` | GoTrue: `signInWithPassword`, `signOut` (local + global `:230`), `refreshSession`, `updateUser` (password), `signInWithOAuth` google (`:240–252`); `user_profiles` read; `current_user_roles`/`current_user_permissions` RPCs; SuperAdmin permission repair `:129–133` (T-266) | 5 | **CRITICAL** | The GoTrue adapter. Desktop uses **no** `signUp`/`resetPasswordForEmail` (verified: 0 hits in non-test `src/`) — self-signup is website-side. Interface stays; implementation swaps to local auth. |
| `supabase-purge-repository.ts` (146 ln) | `SupabasePurgeRepository` | `purge_student_parent_domain` RPC (0120/0121) with server gate codes | 4 | H | Server-side gate (forbidden/tenant/confirmation) + known ID-domain bug (BUG-011 class, 07 §2 row 11); port with the bug fixed. |
| `supabase-identity-resolution-repository.ts` (429 ln) | `SupabaseIdentityResolutionRepository` | `fn_er_*` RPCs ×4 (0130–0132), 4 er_* tables | 4 | H | Experimental (ADR-032); could be deferred or ported as-is. |
| `supabase-teacher-repository.ts` (699 ln) | `SupabaseTeacherRepository` | personnel/class_subjects reads | 3 | L | Read-mostly. |
| `supabase-dashboard-repository.ts` (602 ln) + `supabase-dashboard-layout-repository.ts` (109 ln) | `SupabaseDashboardRepository`, `SupabaseDashboardLayoutRepository` | KPI aggregation queries; `save_dashboard_layout` RPC (0134) | 3 | M | KPIs recompute from tables; local DB recomputes identically. |
| `supabase-audit-log-repository.ts` (486 ln) | `SupabaseAuditLogRepository` | `write_audit_log` RPC (0014), audit_logs reads, `observeActivity()` (realtime fallback feed) | 4 | H | Audit triggers server-side; local needs an audit writer in the adapter layer (mock already has one). |
| `supabase-notification-repository.ts` (310 ln) | `SupabaseNotificationRepository` | notifications table, `notify_parent_user` | 3 | M | Straight port. |
| `supabase-calendar-repository.ts` (817 ln) | `SupabaseCalendarRepository` | calendar_events + derived views | 3 | M | Straight port. |
| `supabase-task-repository.ts` (592 ln), `supabase-warehouse-task-repository.ts` (463 ln), `supabase-inventory-repository.ts` (455 ln), `supabase-supplier-repository.ts` (265 ln), `supabase-purchase-request-repository.ts` (376 ln), `supabase-delivery-repository.ts` (391 ln) | Operations family | CRUD + `.from()` over operations tables (0007–0080 era) | 3 | M | Uniform observable-cache adapters; mechanical port. |
| `supabase-workforce-attendance-repository.ts` (540 ln), `supabase-shift-schedule-repositories.ts` (411 ln), `supabase-leave-request-repository.ts` (399 ln) | Workforce family | workforce_attendance_events, shifts/schedules (0010), leave_requests + `respond_leave_clarification` (0104) | 3 | M | Same pattern. |
| `supabase-releve-repository.ts` (308 ln), `supabase-student-narrative-repository.ts` (121 ln), `supabase-onboarding-repository.ts` (338 ln) | Releve/narrative/onboarding | releve_entries (0141), student_narratives (0148), onboarding_states singleton | 3 | M | Straight port. |
| `supabase-backup-repository.ts` (363 ln) | `SupabaseBackupRepository` | backup_archives **metadata mirror only**; ciphertext stays in IndexedDB vault (AES-256-GCM) | 3 | **L** | **The local-first precedent**: local vault is authoritative, server mirror is best-effort and failure-swallowed (`:20–27` header). Copy this pattern. |
| `cache-freshness.ts` (72 ln) | `CacheFreshness` (TTL 30 s + window-focus) | None (pure policy) | 2 | L | Supabase-free; used by 19 adapter files. Realtime only *invalidates* these caches — local-first keeps the mechanism, swaps the event source. |
| `types.ts` (925 ln) | Row interfaces, `Database` | Type mirror of schema | 2 | M | See §3k. |

### c. Auth & session (GoTrue dependency)

| Path | Key symbols | Supabase surfaces | Sev | Risk | Decoupling note |
|---|---|---|---|---|---|
| `supabase-auth-repository.ts` | (see §3b) | GoTrue grants; session persisted under `el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw` (client factory `:205`) | 5 | **CRITICAL** | Session JWT drives RLS; a local backend needs its own token model or none (local trust). Role mapping `mapRoleCode` (`:25–40`) is a clean 11-role table. |
| `src/app/providers/auth-provider.tsx` (362 ln) | `AuthProvider`, `useAuth`, session persistence `el-imtiyaz.session` | **None directly** (verified: zero supabase imports; goes through `repos.auth` — `:102` `repos.auth.refreshSession()`) | 1 | L | The provider is already port-shaped; auth-class vs network-class failure distinction (`:108–120`, AUTH-302) is reusable. |
| `supabase-approval-repository.ts` | Approval + activation flows | `approve-signup-request` EF (role-escalation guard server-side), `bind-activation-code` EF (ADR-011), `generate_activation_code` RPC | 5 | **CRITICAL** | Role assignment rules live in EF `_shared/role-assignment.ts` + SQL triggers (`handle_new_auth_user` 0054, self-signup hardcodes 'parent' `0054:122–128`). Local-first must reimplement the activation-code lifecycle (single-use codes, binding→parent role). |
| `supabase-user-account-repository.ts` | Staff account CRUD | `create-user-account`/`delete-user-account` EFs → GoTrue admin API + Management-API deletion (07 §5) | 5 | **CRITICAL** | Irreplaceable without *some* auth server (see §3f). |
| GoTrue surfaces census | — | Used by desktop: `signInWithPassword`, `signOut` (local/global), `refreshSession`, `updateUser`, `signInWithOAuth`(google), `getSession`, `onAuthStateChange` (financial-realtime.ts:565 only). NOT used: `signUp`, `resetPasswordForEmail`, OTP (verified by grep) | 5 | H | Smaller surface than feared: email+password + Google OAuth + refresh. |

### d. Realtime

| Path | Key symbols | Supabase surfaces | Sev | Risk | Decoupling note |
|---|---|---|---|---|---|
| `src/infrastructure/supabase/financial-realtime.ts` (586 ln) | `startFinancialRealtime`, `pauseFinancialRealtime`/`resumeFinancialRealtime`, `RealtimeFinancialDebtRepository`, `buildCanonicalDebtSummary`, `FINANCE_REALTIME_TABLES` | `client.channel().on("postgres_changes", …)` over **6 tables** (`:58–65,539–546`); `audit_logs` realtime stream fallback (`:554–559`); 30 s fallback poll (`:87,561`); `Object.defineProperty` debt-slot swap (`:379`); `onAuthStateChange` arm/disarm (`:565`) | 4 | H | Realtime only INVALIDATES caches (TTL+focus do the rest — cache-freshness.ts). Local-first: drop the channel, keep the poll+focus; multi-user desktops on a LAN need a lightweight invalidation bus (or accept 30 s staleness). The debt-facade swap and canonical replay stay. |
| `src/main.tsx:25,49` | boot | `void startFinancialRealtime()` at app start | 3 | L | Self-guards on `useSupabase`; no-op in local mode. |
| `src/features/crm/excel-import-modal.tsx:37–38,335,479` | PERF-504 pause seam | Pauses the bridge during bulk import | 3 | L | Becomes a no-op locally (the quota-trap this guards against is a Supabase transaction-pooler artifact — 159 timeouts + 166 504s, financial-realtime.ts:394–403). |
| `supabase-client.ts:207–209` | client options | `realtime: { params: { eventsPerSecond: 10 } }` | 3 | L | Client-side throttle; irrelevant post-migration. |

### e. Storage

| Path | Key symbols | Supabase surfaces | Sev | Risk | Decoupling note |
|---|---|---|---|---|---|
| `src/infrastructure/storage/media-vault.ts` (197 ln) | `uploadPrivateMedia`, `freshSignedMediaUrl`, `MediaBucket` (5 buckets: payment-proofs, student-documents, expense-receipts, homework-attachments, chat-attachments) | `client.storage.from(bucket).upload` (`:109–115`), `createSignedUrl` 300 s TTL (`:169–171`); buckets defined by migration 0018, chat policies 0136 | 4 | M | Easiest platform swap: local disk under `userData/media/<tenant>/<entity>/` + no signing (or local token). The mock object-URL registry (`:81–84,125–133`) already proves the interface works without Supabase. |
| Feature call sites (7) | — | `unified-payment-modal.tsx:74`, `expense-attachments-gallery.tsx:22,61`, `documents-tab.tsx:40–41,88,149`, `homework-push-modal.tsx:7,98`, `chat-panel.tsx:55–56,392,974,987`, plus repo sites `supabase-expense-repository.ts:81`, `supabase-shared-repositories.ts` (payment-proofs) | 3 | M | All behind the media-vault functions; one file to swap. |
| `diagnostics-runner.ts:527` | `listBuckets` | Storage bucket census in Settings tooling | 3 | L | Diagnostics-only. |

### f. Edge functions (16)

22 .ts files / 7,284 lines (verified `wc -l supabase/functions/*/*.ts`). Auth gates verified per file (see 07 §5 for the full analysis; gates re-checked this session).

| Function (files) | Auth gate (verified) | Purpose | Desktop-invoked? | Local counterpart | Sev | Risk | Note |
|---|---|---|---|---|---|---|---|
| `_shared/` (supabase.ts, cors.ts, cron-auth.ts, send-email.ts, role-assignment.ts) | — | Client factories, CORS, cron guard, Resend mailer, role-assignment rule | n/a (imported by EFs + desktop tests) | cron-auth/send-email/role-assignment cores are deliberately Deno-free and already imported by desktop vitest (`workflow-engine.test.ts:31`, `cron-auth.test.ts:32`) | 3 | L | The shared cores port as-is. |
| `ai-proxy` (533 ln) | JWT + `use_ai` (`:96`) | Groq/OpenRouter proxy, SSE agent stream | YES (`llm-adapter.ts:240`) | **EXISTS**: `byokLLMAdapter` direct-to-provider path (llm-adapter.ts:15–23) | 3 | M | Local-first just makes BYOK the primary (keys in local config instead of EF secrets). |
| `approve-signup-request` (656 ln) | JWT + support_staff (`:91`) | approve/reject account requests; Resend email; role-escalation guard | YES (×5) | In-process approval + local email queue | 5 | H | Approval UI already desktop-side; logic is portable but role-guard must move into the local engine. |
| `bind-activation-code` (343 ln) | JWT (pending allowed) | bind activation → parent role (ADR-011) | YES | Local activation-code table + same rule | 4 | M | Port as local logic; single-use semantics in SQL 0055. |
| `collect-payment` (205 ln) | JWT + `collect_payment` perm (`:70`) | wraps `collect_and_allocate_payment` | NO (desktop calls RPC directly) | The RPC body itself | 4 | L | EF is a broken second path (drops proof fields — BUG-007); local-first deletes it, ports the RPC. |
| `refund-payment` (152 ln) | JWT + `refund_payment` perm (`:55`) | wraps `revert_payment_allocation` | NO | The RPC body | 4 | L | Same — delete, port RPC. |
| `create-user-account` (365 ln) / `delete-user-account` (276 ln) | super_admin (`create:147`) / owner-pinned admin protection | GoTrue admin createUser; Management-API user deletion | YES (user-account-repo) | **NONE** | 5 | **CRITICAL** | Irreplaceable without an auth service; local-first needs a local identity provider design decision. |
| `update-server-secret` (248 ln) | super_admin (`:82`) | Management API PATCH secrets | YES (system-config) | Obsolete locally (secrets become local config file) | 4 | M | Stale FCM allowlist (BUG-007); in local mode the entire secret-management surface changes shape. |
| `workflow-execute` (index 650 + engine 1,079 + actions 661 ln) | JWT + `execute_workflow` (`:120`) | Kahn-topological DAG runner; parking; dry_run | YES (×2) | **EXISTS**: desktop dry-run engine + condition-evaluator (engine ported FROM desktop, 07 §5) | 4 | H | Promote the desktop engine to primary; resolve the 0088 validator divergence (`has_medical_justification` SQL-only, `source_handle` wire-side). |
| `run-overdue-scan` (392 ln) | cron-auth OR JWT + `view_financials` (`:109`) | batched overdue/upcoming scan | NO (cron) | **EXISTS**: `supabase-overdue-alert-generator.ts` (fuller INV-4 formula) | 3 | M | Canonize the desktop formula (EF omits `amount_pending` — 07 §3.1). |
| `workflow-resume-scheduler` (342 ln) | cron-auth (`:75`) | resume parked runs /10 min | NO (cron) | Local timer job | 3 | M | If workflow-execute becomes synchronous-local, parking may vanish entirely. |
| `expire-pending-approvals` (104 ln), `purge-expired-backups` (162 ln), `refresh-materialized-views` (160 ln) | cron-auth (each `:50/:61/:66`) | daily expiry, weekly purge, MV refresh | NO (cron) | Local scheduled tasks; MV refresh N/A (matviews → plain views or computed queries) | 3 | M | SQL bodies exist in-migrations (0036/0049, 0013/0119, 0022/0036); mv_grade_summary refresh is already broken (BUG-016 class). |
| `send-push-notification` (383 ln) | service_role only (`:171–172`) | FCM HTTP v1 fan-out | NO (called by workflow actions) | **NONE** (needs a server or FCM creds on device) | 5 | H | Push is inherently server-shaped; local-first either drops push or keeps one small always-on service. |

**Summary:** 7 of 15 callable EFs are desktop-invoked; 4 have real local counterparts (ai-proxy→BYOK, workflow-execute→dry-run engine, run-overdue-scan→desktop generator, update-server-secret→obsolete); 3 are platform-irreplaceable (create/delete-user-account, send-push-notification); 2 are broken wrappers to delete (collect-payment, refund-payment). `config.toml` declares 15 function blocks including 2 phantom (`generate-receipt-pdf`, `export-data` — no folders) and omits 3 deployed ones (create-user-account, delete-user-account, send-push-notification) — BUG-007, unchanged.

### g. SQL / migrations / RLS

| Path | Key facts | Sev | Risk | Decoupling note |
|---|---|---|---|---|
| `supabase/migrations/` — 152 files, 43,388 lines | 100 tables / 14 views / 5 matviews (LIVE-CENSUS §3); my comment-aware census: **324 CREATE POLICY in 40 files, 108 ENABLE ROW LEVEL SECURITY** (07-report methodology said ~331/106 — same order, method-dependent) | 5 | **CRITICAL** | The schema is the migration's starting asset (DDL ports to local Postgres nearly verbatim); the *procedural* layer does not. 22 files were edited post-commit (OPS-010). |
| Business logic in SQL (cross-ref 07 §4 table) | `collect_and_allocate_payment` ×8 redefinitions (0026→0127), `revert_payment_allocation` ×6 (→0087), `register_family_batch` ×4 (→0128), `upsert_student_from_import` ×7, debt-aging (0111/0133/0150), pricing (0089/0117), promotion/re-enrollment (0107/0108/0128), ER (0130–0132), receipt numbering (0058, ADR-004), GPA/averages (0029/0094) | 5 | **CRITICAL** | ADR-002 declares SQL authoritative with TS as "reference mirror". Local-first INVERTS this ADR: the TS engines (parity-pinned by tests) become primary and the SQL bodies are retired. Every rule in 07 §4 has a named TS mirror except promotion-cycle/re-enrollment state machines and receipt numbering (server-authoritative by ADR-004 — needs a local sequence design or the ADR is relaxed). |
| RLS policy set | 324 policies; helpers SECURITY DEFINER + `auth.uid()` short-circuit (0099); InitPlan hoisting (0126); known leak: `attendance_select` parent/student tenant-wide (0126:207–213, BUG-class) | 5 | **CRITICAL** | Authorization must be re-homed: either local Postgres RLS with a local JWT/role model (keeps the policy text, changes the identity source), or enforcement moves into the repository layer (the mock already has no RLS — its authorization is `Session`-based). The policy→role vocabulary also carries the ARCH-015 split (71 client enum codes vs 54 active server seeds). |
| `supabase/bootstrap/9000_bootstrap_shared_schema.sql` (1,070 ln) | Verified broken: 0 CREATE POLICY but 9 ENABLE RLS (`:322–330`) = lockout; commas absorbed into `--` comments (`:152, :262`); trigger on a column that only exists since 0143 | 4 | L | Do not attempt to reuse; the migration chain is the real schema source. |
| `supabase/config.toml` (141 ln) | project_id el-imtiyaz; Postgres 15; Google OAuth external provider with redirect to `https://api.elimtiyaz.dz/auth/v1/callback`; `[auth.hooks] send_confirmation = "approve-signup-request"` (mismatch — BUG-007); phantom/missing function blocks (§3f) | 3 | M | Replaced wholesale by local-first config; keep as historical reference for auth settings (email disabled signup, secure password change). |
| Triggers as hidden business logic | `handle_new_auth_user` (0054), receipt numbering (0034/0058), staff-chat eligibility scope (0135), audit triggers, expense state transitions | 5 | **CRITICAL** | Invisible to TS-side reasoning; each trigger must be inventoried and re-homed (the 07 §4 census is the checklist). |

### h. Feature-level direct usage (ARCH-019 re-verified)

Direct imports of `infrastructure/supabase/supabase-client` outside the infrastructure/supabase tree (grep this session):

| Path | Import | Sev | Risk | Note |
|---|---|---|---|---|
| `features/settings/configuration-tab.tsx:25` | `isSupabaseConfigured, useSupabase, getSupabaseClient` | 4 | H | Settings UI wiring (SystemConfigService). |
| `features/settings/backup-tab.tsx:60` | `isSupabaseConfigured, getSupabaseClient` | 4 | M | Same. |
| `features/settings/contextual-thresholds-config.tsx:77–78` | `getSupabaseClient, isSupabaseConfigured` | 4 | M | Same (debt thresholds → system_settings). |
| `features/settings/danger-zone-card.tsx:42` | `isSupabaseConfigured` | 3 | L | Mode check. |
| `features/settings/supabase-diagnostics/{supabase-diagnostics-tab:35, crud-test-tab:40, diagnostics-runner:33}` | `getSupabaseClient, isSupabaseConfigured, describeSupabaseConnection` | 4 | L | Platform tooling — legitimate, but should sit behind a `PlatformDiagnosticsPort` (F-U3). `crud-test-runner.ts` receives the client by parameter (no direct import). |
| `features/crm/parent-detail-drawer.tsx:99,331` | `isSupabaseConfigured` (mode check only) | 3 | M | The non-settings offender (ARCH-019); usage is a single `isSupabaseConfigured() && approvals` gate — cheaper to fix than feared. |
| `features/crm/excel-import-modal.tsx:35,375` | `isSupabaseConfigured` (mode check) | 3 | L | Also imports pause/resumeFinancialRealtime (§3d). |
| **Beyond ARCH-019's features/-scoped list:** `shared/layout/tenant-switcher.tsx:26,56–62` | `getSupabaseClient, isSupabaseConfigured` — runs a **direct PostgREST query** on `tenants` (`:56–62`) | 4 | H | The only data query outside the repository layer (ARCH-003 catalogued the import as layering; the *bypass* aspect is the new part — see §7 candidate 1). |
| `app/providers/sync-provider.tsx:27` | `isSupabaseConfigured` | 3 | L | Wiring gate only. |
| `app/providers/repository-provider.tsx:9` | `isSupabaseConfigured, useSupabase` | 3 | — | The seam itself (see §4). |

**Verdict:** ARCH-019's 9-file features/ list is **verbatim-current** (all 9 confirmed; note it is 7 settings + 2 crm files, not "6 of 9 settings surfaces" as the §2.3 phrasing implies). Two additional non-feature direct importers exist (`tenant-switcher`, `sync-provider`); the former is a genuine repository bypass, the latter a mode check.

### i. Scripts & tooling

| Path | Key facts | Sev | Risk | Decoupling note |
|---|---|---|---|---|
| `elimtiyaz-desktop/scripts/` — 292 files (94 sh, 48 py, 31 mjs/mts, 35 ts, rest json/sql) | 75 `apply_*_live.sh`; 67 `verify_*.sql` + 3 `verify_*.sh`; 119 filenames contain "live"; **193 reference `SUPABASE_*` tokens** (all counts by `ls`/`rg -l`) | 2 | L | Historical evidence, not runtime code. All apply scripts POST to `https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query` with `SUPABASE_ACCESS_TOKEN` (e.g. `apply_0157_live.sh:24–35`). OPS-003 (80 scripts, 30 targeting the dead project ref) and OPS-004 (script bugs incl. 3 hardcoded service-role JWTs) already register the hygiene debt. For local-first: one archive sweep retires the whole category. |
| `run_verify_sql_live.sh` | The §11.1 generic live-SQL runner (Management API; strips trailing ROLLBACK) | 2 | L | Superseded by local `psql`. |
| `check-supabase.mjs` / `check-supabase.ts` | Connectivity + RPC-arg-shape probes (`SUPABASE_URL`/`SUPABASE_ANON_KEY` env) | 2 | L | OPS-008: the .ts twin is stale. |
| Repo-root `scripts/` — 54 files | 41 `tNNN-build-zips.sh` + `t418-live-smoke.sh` (Management API + anon-key RLS probe, `scripts/t418-live-smoke.sh:8–18`), `verify_t-092.sh`, `website-branch-check.sh` | 2 | L | Same class. |

### j. Tests

| Measure | Count (method) | Sev | Risk | Decoupling note |
|---|---|---|---|---|
| Total test files (`src/tests/**/*.test.*`) | 321 | — | H | Largest hidden migration cost. |
| Files mentioning "supabase" | 188 (rg -L complement) | 3 | H | |
| Files importing `infrastructure/supabase` | 107 | 4 | H | Adapter unit tests (mock client construction). |
| Files importing `@supabase/supabase-js` | 74 | 4 | H | Mostly `createClient` mocks + type imports. |
| Files reading EF source (`supabase/functions` path refs / readFileSync) | 19 (e.g. `workflow-engine.test.ts:31` imports `engine.ts`; `cron-auth.test.ts:32`; `approve-signup-role-gate.test.ts:41`) | 4 | M | The cross-testing seam (07 §3.8): EF code is tested FROM the desktop suite — this is also the *porting* safety net; keep, re-point. |
| Files referencing `Supabase*Repository` classes | 77 | 4 | H | Renames/rewiring ripple. |
| Files importing `supabase-shared-repositories` | 40 | 4 | H | |
| LIVE-gated (`describe.skipIf`/LIVE patterns) | 22 (e.g. `t-094-overdue-live.test.ts:41`) | 3 | L | Env-gated by design; inert locally. |
| Hermeticity contract | `t-472-hermeticity.test.ts` scans every configured-path seam for pin markers (`:153,169`) | 3 | M | The contract survives; the "configured path" definition changes. |

### k. Governance/docs/env/types coupling

| Path | Key facts | Sev | Risk | Decoupling note |
|---|---|---|---|---|
| `AGENTS_supabase.md` (48 ln) | The clone-project post-mortem: 54001 recursion incident, 0099 fix, "83 tables / 226 policies" 0099-era census | 2 | L | Historical; its triage rules (§4) die with the platform. |
| `AGENTS.md` §11.1 (`:105–140`) + §15 | The live-verification ceremony: `supabase link`, `db push --include-all`, `functions deploy`, Management-API SQL quirks (COMMENT dropped, one-shot sessions) | 3 | M | The whole ceremony is replaced by local DB commands; the quirks documentation becomes obsolete. |
| `docs/operations/credentials.md` (282 ln) | Canonical credential sheet: project refs (current + old), publishable key, JWKS URL, owner-pinned admin credential, per-platform credential mechanisms, live-migration history | 4 | **CRITICAL** | Contains the owner-pinned live admin password (do not reproduce; `:18`) — a real secret committed in docs (see §7 candidate 6). Structurally: the "one backend every platform must point at" rule (ADR-001 family) is the governance embodiment of the hard lock. |
| `docs/decisions/` — 30 ADRs, 19 reference Supabase | ADR-001 (canonical migration chain), **ADR-002 (SQL is the authoritative financial engine)**, ADR-004 (server-authoritative receipts), ADR-005 (Android via canonical RPCs), ADR-009 (API-key migration), ADR-011 (binding activation), ADR-013 (overdue lifecycle) | 4 | **CRITICAL** | ADR-002 and ADR-004 must be formally *superseded* by local-first ADRs before the port starts, or the parity-test suite will fight the migration. |
| `docs/` overall — 144 files reference "supabase" | recovery/change-log, task-registry, live-verification records | 2 | L | Archive; no runtime effect. |
| `src/infrastructure/supabase/types.ts` (925 ln) | Hand-written; `Database` interface covers only **23 tables** (`:670–695`, counted this session); 25 `*Row` interfaces; `pull_*_for_sync` declared for Android (`:918–922`); **the `Database` generic is never used** — zero `SupabaseClient<Database>` constructions (verified); Row interfaces imported by 9 production files + 11 test files | 2 | M | Staleness (07 §3.3) is worse than reported: the umbrella type is dead code while the Row types are live. If local DB keeps Postgres, `supabase gen types` output still works; otherwise regenerate for the local driver. |
| Committed key material | `supabase-client.ts:36–37` canonical publishable key (public identifier by design, credentials.md); scripts carry 3 historical service-role JWTs (OPS-004) | 3 | M | Publishable key is not a secret; service-role JWTs in scripts are (already registered). |

---

## 4. The existing decoupling seam

**What the repository interface + dual-mode provider already achieve (verified):**

1. **54 typed slots** (`repository-provider.tsx:90–167`) consumed via `useRepositories()` — features never see the SDK (ARCH-005 service locator; the good kind).
2. **Dual-mode selection**: `selectDefaultRepositories()` (`:171–192`) — mock mode by flag; live mode via `getSupabaseRepositories()` = `{...mockRepositories, 49 overrides} + approvals` (override list counted at `supabase-repositories.ts:421–486`).
3. **Fail-closed**: live mode with no config **throws** rather than silently falling back to mock (`:174–179`); initialization failure propagates (`:181–191`). No fake-success decorators (T-313 pin `:203–212`).
4. **Observable-cache idiom shared by both twins**: `SubjectBehavior` in 26 Supabase adapters + the whole mock layer; `CacheFreshness` (TTL+focus) in 19 adapters — the freshness mechanism is platform-free; realtime only *pokes* it.
5. **Local-first precedents already shipping**: the sync layer (IndexedDB queue `sync-queue-store.ts`, replay via idempotent `upsert_*_from_import` RPCs in `default-push-handler.ts:73–105`); the backup vault (local ciphertext authoritative, server mirror best-effort); the AI adapter's 3-tier edge→BYOK→mock routing (`llm-adapter.ts:15–23`); the auth provider being port-shaped (§3c).

**Where the seam leaks / stops:**

| Leak | Evidence | Migration consequence |
|---|---|---|
| Mock slots in live mode | 5 slots (clubs, psychology, orthophonie, aiConfig, performanceReviews) write to in-memory stores that vanish on restart (ARCH-006) | Local-first must give these slots real persistence or delete the features (owner decision, open question 5). |
| Feature/shared bypasses | 9 features + `tenant-switcher.tsx` direct query + `system-config`/`media-vault`/`llm-adapter`/`sync×3` outside the seam (§3a/§3e/§3h) | ~14 files to route through ports before the backend swap is clean. |
| Auth behind the seam but GoTrue-shaped | `AuthRepository` interface is fine; the *Session* it returns carries GoTrue `accessToken/refreshToken/expiresAt` (`supabase-auth-repository.ts:148–150`) | A local auth twin must still satisfy the Session shape (or the interface gains a local variant). |
| Server-side business logic invisible to the seam | 56 RPCs + triggers + 324 RLS policies (§3g) — the repository *calls* logic that only exists in Postgres | The seam swaps the *transport*, not the *logic*. ADR-002 inversion + TS-engine promotion is the real port. |
| EF-only logic | workflow engine (portable), approval/role-assignment rules, account lifecycle (§3f) | 3 platform-irreplaceable EFs force an identity/design decision. |
| Realtime freshness | single channel + audit fallback + poll (§3d) | Poll+focus already suffice for a single user; multi-user needs a new event bus. |
| Storage signing | media-vault createSignedUrl (§3e) | Trivial local swap. |
| Fail-closed boot is import-time | `const defaultRepositories = selectDefaultRepositories()` runs at module load (`repository-provider.tsx:194`) | In local-first the "unconfigured" throw disappears; boot order simplifies. |
| Env/lock coupling in the client factory | canonical lock + `validateConnection` format check (§3a) | The very first migration blocker to remove. |

**Net assessment:** the seam covers the data plane for 49 of 54 slots and is genuinely dual-mode; it does NOT cover auth platform, authorization rules, business-logic authority, realtime, storage, or the 14 bypass files. Estimate: the seam removes ~50–60% of the mechanical migration work; the remainder is design work (auth, RLS, SQL logic) that no interface can absorb.

---

## 5. Migration-risk heat map (top 15)

| # | Area | Sev | Risk | Why it is risky |
|---|---|---|---|---|
| 1 | `supabase-client.ts` production lock (`:35–38,148–157`) | 5 | **CRITICAL** | Packaged builds hard-code URL+key and *ignore* local config (`VITE_DESKTOP_PRODUCTION=true`); no local backend is reachable without editing this file — the migration's step zero. |
| 2 | Financial SQL RPC set (ADR-002 authority) — `collect_and_allocate_payment`, `revert_payment_allocation`, debt-aging, `supabase-shared-repositories.ts` | 5 | **CRITICAL** | Money-handling logic lives in 8×/6×-redefined SQL bodies; TS mirrors exist and are parity-pinned, but making TS primary means superseding ADR-002 and re-validating every parity suite. |
| 3 | RLS policy estate — 324 policies / 108 ENABLE RLS / SECURITY DEFINER helpers | 5 | **CRITICAL** | All authorization evaporates with the gateway; re-homing to local-Postgres RLS (new identity model) or in-repo enforcement is the largest correctness surface; the attendance leak (0126) proves drift already exists. |
| 4 | GoTrue account lifecycle + `create/delete-user-account` EFs + approval/activation flows | 5 | **CRITICAL** | No local counterpart for auth-user management, Google OAuth, global signout, activation codes, `handle_new_auth_user` trigger; forces a local identity-provider decision before any port. |
| 5 | `system-config.ts` `validateConnection` `.supabase.co` format check (`:431–433`) + `update-server-secret`/delete-secret EF coupling | 4 | **CRITICAL** | The Configuration tab actively rejects local URLs; secrets management is EF+Management-API-shaped. |
| 6 | Promotion-cycle / re-enrollment / class-placement state machines (`supabase-academic-repository.ts`, 0107/0108/0128/0130 RPCs) | 5 | H | 21 `fn_*` RPCs with NO TS mirrors (unlike the financial core) — must be reimplemented as local transactions. |
| 7 | Audit + trigger web (`write_audit_log` 0014, audit triggers, expense_state_transitions, receipt numbering 0058, chat eligibility 0135) | 5 | H | Hidden invariants: every financial write expects an audit row; realtime fallback *depends* on the audit stream (`financial-realtime.ts:554–559`); receipt numbering is server-authoritative (ADR-004). |
| 8 | `financial-realtime.ts` channel + `Object.defineProperty` debt swap | 4 | H | The debt-slot mutation makes the repositories object non-obvious; local-first needs a replacement invalidation story for multi-user. |
| 9 | Permission vocabulary split (71 client enum vs 54 server seeds, ~30 shared — ARCH-015) + SuperAdmin client-side repair (`supabase-auth-repository.ts:129–133`) | 4 | H | Authorization semantics already forked; local-first must pick one vocabulary and one enforcement point. |
| 10 | EF fleet retirement matrix (§3f): 3 platform-irreplaceable, 2 broken wrappers, 1 push dependency | 4 | H | `send-push-notification` needs a server or FCM-on-device; user-account EFs need an auth service; the rest port or die. |
| 11 | Test surface: 188/321 files, 77 adapter-class references, 19 EF-source readers | 3 | H | The safety net is also the blast radius: rewiring invalidates more tests than application files. |
| 12 | The 14 seam bypass files (9 features + tenant-switcher + sync-provider + system-config + media-vault + llm-adapter + sync×3) | 4 | M | Bounded but mandatory; `tenant-switcher` hides a live data query. |
| 13 | Mock-slot persistence gaps (ARCH-006: 5 slots in-memory in live mode) | 3 | M | Local-first must not inherit silent data loss for clubs/therapy/aiConfig/performanceReviews. |
| 14 | `types.ts` staleness + dead `Database` generic | 2 | M | 23-table coverage of a 99-table schema; typing the local DB will surface every drift the hand-written types hid. |
| 15 | Governance: credentials.md committed secrets + 19 Supabase-shaped ADRs + §11.1 ceremony | 4 | M | ADR-002/004 supersession is a *precondition*; the committed owner-pinned admin credential is a live security liability independent of migration. |

**CRITICAL count: 5** (rows 1–5). Rows 2–4 are effort-CRITICAL; rows 1 and 5 are *blocking* but small.

---

## 6. Session 3 live re-test (2026-11-19)

Method note: results below were relayed by the session lead as this session's GET-only re-test; this agent performed no network calls (read-only mandate). Probes mirror Session 2's `LIVE-CENSUS-2026-11-19.md` §1 protocol.

| Probe | Result | vs Session 2 (2026-11-19) |
|---|---|---|
| REST root (`GET /rest/v1/`) with anon/publishable key | **HTTP 401 — restricted**, body: `exceed_egress_quota` — "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service." | S2 recorded **402** with the same restriction body — the status code shifted 402→401; the restriction itself persists |
| REST root with service/secret key | **HTTP 402** (same restriction message; restriction fires before key validation) | Unchanged |
| Management API (`sbp_` access token) on `/v1/projects/…` | **HTTP 401 `Invalid access token`** | Unchanged — token still invalid/revoked |
| GitHub PAT (clone/push) | **VERIFIED WORKING** | Unchanged |

**Conclusion:** OPS-011 stands — the live project remains restricted (`exceed_egress_quota`), the management token remains invalid, and no live-side verification (including the repo's own `run_verify_sql_live.sh` ceremony) is possible until the owner lifts the spend cap. The 401-vs-402 status-code drift on the anon-key probe is recorded here as a curiosity of the restriction gateway; the operative fact (restriction persists, owner action required) is identical. This is precisely the quota-trap class the local-first migration is intended to escape.

---

## 7. New finding candidates

Each marked **candidate — pending ID assignment** (next free IDs per handoff: DEAD-015, DUP-031, ARCH-022+, BUG-032+, OPS-012+). None of these are in FINDINGS_INDEX.md as of this session (checked against the full ID register and BUG-007/ARCH-003/ARCH-019/OPS-003/004/008 rows).

1. **Candidate — pending ID assignment (ARCH-class):** `shared/layout/tenant-switcher.tsx:56–62` issues a direct PostgREST query on the `tenants` table through `getSupabaseClient()` — a repository-layer *bypass* outside ARCH-019's features-scoped census (ARCH-003 catalogued only the import-direction violation). Extends the bypass inventory to the shared layer; should route through a tenant repository/port.
2. **Candidate — pending ID assignment (ARCH-class):** Production builds are hard-locked to the canonical project — `VITE_DESKTOP_PRODUCTION=true` ignores local config and pins URL+key (`supabase-client.ts:148–157,171–172`); session storage key is project-ref-scoped (`:205`) so sessions never survive a backend swap by design. Undocumented as a migration constraint; any local-first plan must start here.
3. **Candidate — pending ID assignment (BUG/ARCH-class):** `LocalConfigService.validateConnection` rejects every URL that is not `https://…supabase.co` (`system-config.ts:431–433`) — the supported configuration UI cannot accept a self-hosted/local backend, contradicting the runtime client's URL-agnostic normalization (`normalizeSupabaseUrl` accepts any http(s) origin).
4. **Candidate — pending ID assignment (ARCH-class):** `SyncService`'s online detection equates "online" with "the Supabase REST root answers with our apikey" (`sync/online-detector.ts:22,177–178`) — probe target and header are Supabase-specific; in a local/multi-user topology the online/offline/conflict semantics silently change meaning.
5. **Candidate — pending ID assignment (DEAD-class):** The `Database` interface in `types.ts:670–695` is dead code — zero `SupabaseClient<Database>` constructions anywhere (verified by grep); only the 25 individual `*Row` interfaces are imported (9 production files). The staleness finding (07 §3.3) understates it: the umbrella type is unused *and* stale.
6. **Candidate — pending ID assignment (OPS/security-class):** `docs/operations/credentials.md:18` carries the owner-pinned live admin credential (username + password) committed in the repository, while the investigation guardrails (handoff-session-02 §6) mandate never committing credentials and token-grep before every push. The publishable key in the same sheet is a public identifier; the admin password is not. Recommend owner decision: redact + rotate policy review (the owner's 2026-09-10 directive pinned it — this candidate only registers the tension, it does not overrule the owner).
7. **Candidate — pending ID assignment (ARCH-class, documentation-grade):** Coupling-visibility asymmetry: 26 of 99 live chain tables are never touched by desktop `.from()` (device_tokens, promotion_cycles, re_enrollments, permissions, role_permissions, parent_student_links, ai_request_logs, workflow_pending_resumes, account_adjustments, expense_state_transitions, grades, homework_assignments, academic_history, filieres, invoices, notification_preferences, performance_reviews, promotion_cycle_classes, salary_adjustments, service_enrollments, sessions, tenant_role_overrides, workflow_audit_links, exam_sessions, discount_applications, ai_provider_configs) — their logic is reached only via RPCs/EFs/triggers, so static `.from()` analysis systematically under-represents the true server dependency of those domains. (Method: Python census over non-test `src/`.) Relevant when scoping which tables a local DB actually needs on day one.

**Cross-references kept (not re-registered):** ARCH-005 (service locator), ARCH-006 (5 mock slots), ARCH-015 (permission vocabulary), ARCH-019 (9 bypasses — re-verified verbatim), ARCH-020 (TanStack phantom; note `main.tsx:36–45,58` does mount a `QueryClientProvider` — the "one main.tsx import" of ARCH-020), BUG-006/007 (EF bugs incl. config.toml phantom functions), OPS-003/004 (apply-live scripts), OPS-008 (check-supabase.ts), OPS-010 (migration edits), OPS-011 (live restriction), and the 07-report's four missed discoveries (overdue `amount_pending` divergence, stale FCM allowlist, stale types.ts, permission split) which map to existing BUG/ARCH registrations.

---

*End of map. One file written this session: `Investigation Archive/Database and Supabase/SUPABASE-COUPLING-MAP.md`. No application source, configuration, schema, or dependency was modified; no git-mutating command was run.*
