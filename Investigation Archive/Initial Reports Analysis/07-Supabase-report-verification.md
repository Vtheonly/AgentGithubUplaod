# Verification Report — 'Optimizing AI Context for Development — Supabase.md'

**Investigator:** Agent SB (Task RPT-7) · **Mode:** read-only source audit · **Scope:** `elimtiyaz-desktop/supabase/` (migrations, functions, config, bootstrap) + `elimtiyaz-desktop/src/infrastructure/supabase/` + related client domain code.

## 1. Report summary

- The context report is **structurally accurate and remarkably current**: of ~45 discrete factual claims checked, **~40 verified exactly**, 3 needed corrections (file counts, one line number), and 0 were rejected outright.
- **Inventory**: `supabase/` contains exactly **176 files** = **152 migrations** (not "155"; numbers 0015–0017, 0118, 0122 never existed as files) + 1 bootstrap + **16 function folders / 22 .ts files** + `config.toml`.
- **All 11 "active bugs" in report §5B are real and still present**: `register_family_batch` source_id regression (0128), `create_manual_debt` missing `academic_year_id` (0137), purge ID-domain bug (0121), `collect-payment` EF proof-field bug + phantom `ctx.userDisplayName`, `revert_payment_allocation` gaps (0087), `ai-proxy` 'copilot' CHECK violation + `corsHeaders(req)` misuse, workflow validator divergence (0088 vs `engine.ts`), `attendance_select` parent/student leak (0126), `mv_grade_summary` refresh breakage (0041), `config.toml` phantom/missing functions + `verify_jwt` mismatch, and `update-server-secret`'s out-of-tree import.
- The **bootstrap `9000_bootstrap_shared_schema.sql` is verifiably broken** (two comma-in-comment syntax errors at lines 152/262, RLS enabled with zero policies at lines 322–330, trigger on a column that only exists since 0143).
- **Schema/RBAC facts check out**: 11 roles (9 staff + 2 web, 0023:32–43), 56 seeded permissions − 2 retired in 0157 = **54 active**, default tenant `…000001`, InitPlan `(select …)` hoisting (0126:211–212), `auth.uid()` short-circuit (0099).
- **Financial engine facts check out**: tranche model (0=FI, 1–3=tranches, NULL=non-wave; 0124/0137), `ledger_entries_source_uidx` excluding reversals (0037:875), 0117 single-active pricing config, 0129 year-scoped partial unique index, 30s `statement_timeout` (0151:64–73), debt thresholds 5/15/60 days + 20 000/60 000/40 000 DZD (0150:153–169).
- The report's **duplication census is directionally right but understated**: `collect_and_allocate_payment` is redefined in **8** files (report: "6 times" while listing 8), `revert_payment_allocation` in 6 (report: 5), `register_family_batch` in 4 (report: 3), `upsert_student_from_import` in 7 incl. bootstrap (report: 6).
- **Independent census**: 100 distinct tables ever created by the chain (only `receipts` dropped, in 0079); ~331 `CREATE POLICY` statements across 17 files; 106 `ENABLE ROW LEVEL SECURITY` statements. `AGENTS_supabase.md` records the live project at "83 tables / 226 policies" at the 0099 era — evidence of chain↔live drift.
- **Client RPC usage**: 54 distinct `.rpc()` names in desktop `src/`; **all 54 exist in migrations**. `pull_*_for_sync` RPCs are Android-consumed (declared in `types.ts:918–922`, not called by the desktop).
- **`types.ts` is hand-written and stale**: header says "deliberately hand-written (not generated)"; the `Database` interface covers only 23 tables; every post-0103 domain except `expense_attachments` (0153) is missing.
- **Workflow logic exists in three places** (SQL `validate_workflow_dag` 0081/0088, EF `engine.ts`, client `dry-run.ts`+`condition-evaluator.ts`), with the EF engine explicitly ported from the client and re-imported by desktop vitest (`src/tests/infrastructure/workflow-engine.test.ts:31`).
- **New divergences the report missed**: (a) `run-overdue-scan` EF's overdue filter omits `amount_pending` while the desktop generator subtracts it (DATA-033/INV-4); (b) `update-server-secret`'s secret allowlist still offers deprecated `FCM_SERVER_KEY`/`FCM_SENDER_ID` and lacks the FCM-v1 `FIREBASE_*` keys; (c) the desktop `Permission` enum (71 codes) and SQL-seeded permissions (54 active) share only ~30 codes.
- **Migration hygiene**: append-only guard exists, but git history shows **22 migration files were modified after their initial commit** (0004, 0022, 0024–0036, 0039/0040, 0096, 0104, 0138…).

## 2. Claim-by-claim verification table (abridged to significant rows)

| # | Claim | Classification | Evidence | Notes |
|---|---|---|---|---|
| 1 | Export = 176 files: ~155 migrations, 1 bootstrap, 16 EF folders, config.toml | VERIFIED (count corrected) | 152 migrations; gaps 0015, 0016, 0017, 0118, 0122; functions/ = 16 folders / 22 .ts files; 152+1+22+1 = 176 | 0118 gap explained by `0120_purge_student_parent_domain.sql:24–31` ("live registry carries 0118 … with NO repo file") |
| 2 | Dropped RPCs: `collect_payment`, `refund_payment`, `get_parent_summary`, `run_overdue_scan` (0034/0035), `promote_students` (0059), `record_roll_call` (0144) | VERIFIED | `0034:73–86`; `0035:61–134`; `0059:65`; `0144:68–74` | Also `allocate_payment_waterfall`, `compute_parent_outstanding_v2`, `reconcile_parent` etc. dropped in 0034:79–86 |
| 3 | Bootstrap 9000 syntactically broken: commas inside `--` comments | VERIFIED | bootstrap `:151–153` and `:262` | Missing comma → PostgreSQL 42601 parse error |
| 4 | Bootstrap creates trigger on nonexistent `ledger_entries.updated_at` | VERIFIED | bootstrap `:208–238`, trigger at `:355–357`; `0143:240–257` confirms the column was only added in 0143 | |
| 5 | Bootstrap enables RLS with zero policies | VERIFIED | bootstrap `:322–330` (9 × ENABLE RLS), zero `CREATE POLICY`; header claim at `:32` | Blocking-all-access consequence follows |
| 6 | Deprecated tables `grades`, `homework_assignments`, `academic_history`, `receipts` | VERIFIED (nuance) | `receipts` dropped `0079:52`; others still exist (0004) but unused legacy | |
| 7 | 0157 retires `access_driver_mode`/`view_routing` but keeps `driver` role | VERIFIED | `0157:34–43`, header `:14–20`; client companion removal at `permissions.ts:88,402` | |
| 8 | 11 roles; 54 active permissions | VERIFIED | `0023:32–43`, `:49–119`; only 0023 and 0157 touch `permissions` | |
| 9 | Bug 1: `register_family_batch` (0128) dropped 0103's `source_id` code→UUID substitution | VERIFIED | `0103:236–239`; `0112:229,303` and `0128:447,521` insert `r.source_id` verbatim | Also affects 0128's re-enrollment billing leg (`:1123,1185`) |
| 10 | Bug 2: `create_manual_debt` (0137) omits `academic_year_id` in the `installments` INSERT | VERIFIED | `0137:172–184`, `:151–153`, `:240`, `:227` | |
| 11 | Bug 3: `purge_student_parent_domain` (0121) deletes `notifications`/`device_tokens` by `v_auth_ids` though both store `user_profiles.id` | VERIFIED | `0121:364–377`, `:406–412`; `0013:109,137`; `0027:316` | Bug already present in 0120 |
| 12 | Bug 4: `collect-payment` EF validates check/transfer fields but doesn't pass them; `ctx.userDisplayName` nonexistent; refund EF double-writes audit | VERIFIED | EF `collect-payment/index.ts:95–111`, `:147–159`; RPC sig `0127:152–159`; trigger `0045:68–79`; `AuthContext` `_shared/supabase.ts:52–60`; `refund-payment/index.ts:104` + `:126–146` | Desktop client passes them correctly (`supabase-shared-repositories.ts:2491–2496`) — EF-only defect |
| 13 | Bug 5: `revert_payment_allocation` (0087) doesn't touch `payment_allocations` and can't match `bulk_import` ledger rows | VERIFIED | `0087:321`; zero `payment_allocations` references; allocations written by `0115:186,238` and `0127:292,348`; `0062:144` | |
| 14 | Bug 6: `ai_request_logs.feature` CHECK rejects `'copilot'`; `corsHeaders(req)` wrong signature "line 213" | VERIFIED (line corrected) | `0012:171` CHECK; `ai-proxy/index.ts:507`, `:530–532`, `:225–234`; no migration widens the CHECK. `corsHeaders(req)` is at **line 286** | Runtime effect: `allowOrigin` degrades to `allowedOrigins[0] ?? "*"` |
| 15 | Bug 7: DAG validator divergence — 0088 accepts `has_medical_justification`, engine.ts doesn't; engine.ts supports `source_handle`, 0088 ignores it | VERIFIED | `0088:37`; `engine.ts:95–98`, `:176`, `:70,218–228,581–587` | engine.ts:109 says it mirrors **0081**, not 0088 — the divergence's origin. `has_medical_justification` exists nowhere in desktop `src/` |
| 16 | Bug 8: `attendance_select` (0126) still includes 'parent'/'student' tenant-wide | VERIFIED | `0019:258–263`; `0041:174–183`; `0126:207–213` | Permissive SELECT policies OR together; leak persists |
| 17 | Bug 9: `mv_grade_summary` recreated (0041) without unique index → `REFRESH … CONCURRENTLY` fails | VERIFIED | `0021:122,136`; `0041:51–67`; `0022:797`; `0036:151–154` | `refresh-materialized-views` EF header still lists it |
| 18 | Bug 10: config.toml phantom/missing functions; `[auth.hooks]` mismatch; `run-overdue-scan verify_jwt=true` blocks CRON_SECRET | VERIFIED | `config.toml:134–138` (phantom); `:91–138` (missing); `:82–84`; `approve-signup-request/index.ts:91` (support_staff — an admin API, not a signup hook); `config.toml:106–107` vs `_shared/cron-auth.ts:94–99` | Signup rows actually come from `handle_new_auth_user()` (`0054:54`), self-signup hardcodes 'parent' (`0054:122–128`) |
| 19 | Bug 11: `writeAuditLog` pre-stringifies jsonb params; `update-server-secret` imports outside functions/ | VERIFIED | `_shared/supabase.ts:206–207`; `0014:96–97`; `update-server-secret/index.ts:38` | |
| 20 | Debt-aging config values | VERIFIED | `0150:153–169`; TS mirror `debt-aging.ts:51–100` | |
| 21 | Installments: nullable `tranche_number` CHECK (0,1,2,3); 0=FI; 0129 year-scoped partial unique index | VERIFIED | `0124:73–75`; `0137:63–69`; `0129:52` | |
| 22 | Pricing: `full_annual` 5% tuition-only, `sibling_fixed` −5 000 DZD, 3 fictional discounts deactivated, one active config | VERIFIED | `0089:26–30`, `:231–247`, `:260–265`; `0117:63`; desktop mirror `school-price-matrix.ts:100–102,265–268` | |
| 23 | Receipt numbers: one-way trigger + `REC-{YYYY}-{6-digit}` | VERIFIED | `0034:113–137`; `0058:55–68` | |
| 24 | Push config moved to FCM HTTP v1; legacy keys outdated | VERIFIED | `send-push-notification/index.ts:182–191`, `:281`; legacy keys still in `update-server-secret/index.ts:55–56` allowlist | |
| 25 | EF auth gates (cron-auth for 5 EFs; super_admin user-account management; owner-pinned admin protected; bind-activation pending JWT) | VERIFIED | `_shared/cron-auth.ts:81–99`; EF files as cited | |
| 26 | Function-redefinition counts | CORRECTED (lists right, counts low) | `upsert_student_from_import` **7**; `collect_and_allocate_payment` **8**; `revert_payment_allocation` **6**; `register_family_batch` **4**; MVs: `mv_dashboard_kpis` 4×, `mv_debt_aging` 4×, `mv_top_debtors` 4×, `mv_revenue_by_month` 4×, `mv_grade_summary` 2× | "Repeated verbatim" is imprecise (bodies evolve) |
| 27 | "155 sequential SQL files" | CORRECTED | 152 files; 5 numbers never existed | |
| 28 | Sync contract: 0143 composite `(updated_at, id)` keyset | VERIFIED | `0143:77–121`, `:240–257`, `:269–309` | |
| 29 | `expire_pending_approvals()` return shape | VERIFIED | `0036:106`; `0049:45` | |
| 30 | RLS helpers `SECURITY DEFINER`, InitPlan-safe; `auth.uid()` short-circuit (0099) | VERIFIED | `0099:3–26`; `0126:211–212` | 54001 incident documented in AGENTS_supabase.md §2–3 |
| 31 | 0090 4-tranche BON superseded by 0124+0137 3-tranche model | VERIFIED | `0090`; `0124:32,73–77`; TS `tranche-waves.ts:16–22` | |
| 32 | Staff chat eligibility widened; scope forced by trigger (0135) | VERIFIED (spot) | `0135`; `0156`; `0105` | |
| 33 | 0054 admin-invite caveat re GoTrue `raw_app_meta_data` timing | UNRESOLVED | `0054:105–112` | Runtime behavior not provable from source |
| 34 | Live/registry drift artifacts (0146/0147) imply chain↔live reconciliation churn | VERIFIED | File names + AGENTS_supabase.md census | |

## 3. Missed discoveries

1. **`run-overdue-scan` EF vs desktop overdue filter divergence (`amount_pending`)** — the EF computes `remaining = amount_due − amount_paid` and never subtracts `amount_pending` (`functions/run-overdue-scan/index.ts:164,200–207`), while the desktop reference it claims to mirror uses the full INV-4 formula (`src/infrastructure/supabase/repositories/supabase-overdue-alert-generator.ts:161–173`, "DATA-033 (T-411)"). A tranche fully covered by uncleared (pending) funds is classified overdue by the EF but not by the desktop.
2. **`update-server-secret` allowlist is stale for FCM v1** — `ALLOWED_SECRET_KEYS` (`functions/update-server-secret/index.ts:49–61`) still contains deprecated `FCM_SERVER_KEY`/`FCM_SENDER_ID` and does NOT contain `FIREBASE_SERVICE_ACCOUNT_JSON`/`FIREBASE_PROJECT_ID`, so the "configure everything from the GUI" EF cannot set the push secrets the platform now needs.
3. **`types.ts` is hand-written and materially stale** — `Database` interface covers 23 tables; `student_narratives` (0148), `re_enrollments` (0128), `dashboard_layouts` (0134), `timetable_*` (0109), `promotion_cycles` (0108), `er_*` (0130), `onboarding_states`, `workflow_pending_resumes` all absent; `pull_*` signatures lack 0143's `p_after_id`.
4. **Desktop `Permission` enum vs SQL permission seeds diverge heavily** — client enum 71 codes (`permissions.ts:15`ff), SQL seeds 56 (54 active); intersection ≈ 30. The server's `current_user_permissions()` returns a vocabulary the client enum only partially models (and vice versa).
5. **22 migration files were modified after their first commit** — `git log --diff-filter=M` shows in-place edits to 0004, 0022, 0024–0036, 0039, 0040, 0096, 0104, 0138, plus a since-deleted `migrations/9000_…` and `20260805_academics_module.sql`. The append-only guard only guards working-tree/baseline-diff, not history.
6. **OPS-313 was already fixed in-place** — `AGENTS_supabase.md` §5.2 lists "0096 line 302" as open, but `0096:302–309` now carries the terminator plus a comment documenting the owner-sanctioned edit (the AGENTS file is stale).
7. **engine.ts's mirror target is 0081, not 0088** — `engine.ts:109`; 0088 was a live-reconstruction afterthought, which is why the SQL registry accepts `has_medical_justification` that no runtime supports.
8. **Cross-testing seam** — desktop vitest imports the EF engine directly (`workflow-engine.test.ts:31`); `cron-auth.ts`/`send-email.ts`/`role-assignment.ts` are deliberately Deno-free for the same reason.
9. **`refresh-materialized-views` EF advertises `mv_grade_summary`** in its KNOWN VIEWS list, compounding the refresh breakage.
10. **Client stale doc-comment on the collect path** — `supabase-shared-repositories.ts:2457` cites "0026, extended by 0039/0040" while the operative definition is 0127.

## 4. SQL-vs-TS duplicated business logic census

| Rule | SQL location | TS location (desktop) | Divergence notes |
|---|---|---|---|
| Payment waterfall (FIFO, INV-4 capacity, overflow) | `collect_and_allocate_payment` — 0127:152–348 (8 redefinitions) | `waterfall-allocator.ts:29–50` | Deliberate mirror; statuses aligned |
| Reversal / LIFO rollback | `revert_payment_allocation` — 0087:254–460 | `lifo-reversal.ts:1–40` | TS comment cites 0034; live SQL is 0087; SQL has the payment_allocations/bulk_import gaps — TS has no allocations concept |
| Ledger balance replay + parent summary | `compute_parent_summary`/`compute_account_balance` — 0042/0034 | `balance.ts:1–141`; `overdue.ts:29–64` | Mirrors pinned by parity tests |
| Debt aging 4-tier + amount bands + severe debt | `compute_debt_aging_rows` (0111/0126/0127), `compute_debt_aging_summary`, `read_debt_aging_thresholds` (0150) | `debt-aging.ts:1–100+` | Threshold defaults identical |
| Tranche-wave model | 0090→0124:73–77, 0137:63–69, 0129:52 | `tranche-waves.ts:16–56` | Aligned by T-447/T-424; SQL CHECK is the contract |
| Account-id derivation | inline in every financial RPC | `account-id.ts:20–39` | Identical format |
| Workflow DAG validation + branch execution | `validate_workflow_dag` — 0081/0088 | EF mirror `engine.ts:88–106,176,218–228`; client `dry-run.ts`+`condition-evaluator.ts` | **Active divergence**: `has_medical_justification` (SQL-only), `source_handle` (EF/TS-only, camelCase on the wire — converted in `supabase-workflow-repository.ts:150–151,186`) |
| Overdue-alert generation | EF `run-overdue-scan/index.ts:200–346` | `supabase-overdue-alert-generator.ts:157–293` | **Divergence**: EF omits `amount_pending`; desktop excludes only `status='paid'`, EF also excludes 'cancelled' |
| Pricing catalog + discounts | 0089:26–30, 231–265; 0117 | `school-price-matrix.ts`, `discount-engine.ts`/`discount-rules.ts`/`tuition.ts` | Same numbers; TS is the quoting engine, SQL the storage |
| Reconciliation cross-checks | one-shot DML in 0062/0063 | `cross-checks.ts:1–26` | TS is the live checker; SQL was a one-time repair |
| Payroll forecast | no SQL counterpart | `payroll-forecast.ts:1–30` | TS-only by design (ADR-024) |
| Receipt numbering | `next_receipt_number`/`generate_receipt_numbers` — 0058 | client displays/consumes | Server-authoritative (ADR-004) |
| GPA / subject averages | `assessments_compute_subject_average` + `fn_calculate_student_term_gpa` (0029/0094) | `src/domain/calc/academics/` | Kept equivalent by tests |
| Permission vocabulary | `permissions` seeds 0023:49–119 (54 active) | `permissions.ts:15+` (71 enum codes) | **Large set divergence** (~30 shared) |

## 5. Edge function inventory + overlap analysis

**Inventory (16 folders / 22 files):**

| Function | Auth gate | Purpose | Client overlap |
|---|---|---|---|
| `ai-proxy` | JWT + `use_ai` | Groq/OpenRouter proxy, single-shot + agent SSE stream | Desktop copilot (`executeOpenAIStream`); PII masked client-side |
| `approve-signup-request` | JWT + support_staff | approve/reject account requests; Resend email | Mirrors desktop approval UI; role-escalation guard |
| `bind-activation-code` | JWT (pending allowed) | bind activation code → parent role + activation (ADR-011) | Portal + desktop activation flows |
| `collect-payment` | JWT + `collect_payment` perm | wraps `collect_and_allocate_payment` (**buggy**: proof fields dropped) | Desktop calls the RPC directly and correctly — the EF is a divergent, broken second path |
| `refund-payment` | JWT + `refund_payment` perm | wraps `revert_payment_allocation` (**double audit**) | Desktop calls the RPC directly |
| `create-user-account` / `delete-user-account` | super_admin | `admin_create_user_account` (0044/0097); Management-API deletion; owner-pinned admin protected | Desktop admin UI |
| `update-server-secret` | super_admin | Management API PATCH secrets (**stale allowlist**, out-of-tree import) | Desktop settings UI |
| `workflow-execute` (+`engine.ts`, `actions.ts`) | JWT + `execute_workflow` | Kahn-topological DAG runner; `wait_duration>10s` parking; dry_run; 7 action kinds (financial/SQL actions `skippedByDesign`) | **Triple duplication** with SQL validator (0081/0088) and desktop `dry-run.ts`+`condition-evaluator.ts`; EF engine ported FROM desktop and re-tested BY desktop vitest |
| `run-overdue-scan` | cron-auth OR user JWT + `view_financials` | batched overdue/upcoming scan, dedup, stale-alert resolution | Explicitly "ports the BATCHED pattern of the desktop reference" — but diverges on `amount_pending` |
| `workflow-resume-scheduler` | cron-auth | resumes parked runs every 10 min | none |
| `expire-pending-approvals` / `purge-expired-backups` / `refresh-materialized-views` | cron-auth | daily expiry, weekly backup purge, MV refresh | none |
| `send-push-notification` | service_role only | FCM HTTP v1 fan-out | called by workflow actions |
| `_shared/{supabase,cors,cron-auth,send-email,role-assignment}.ts` | — | client factories/AuthContext/audit, CORS, cron guard, Resend, role-assignment rule | `cron-auth`/`send-email`/`role-assignment` cores are Deno-free so desktop vitest imports them directly |

**Overlap verdict:** workflow logic and overdue-alert logic are the two genuine three-way duplications (SQL + EF + client TS); payment collection exists in two client paths (EF wrapper broken, direct RPC correct); the rest are thin server-side wrappers with no client logic twin.

## 6. RPC usage census

All 54 distinct `.rpc()` names in desktop `src/` exist in migrations (definitions verified by case-insensitive grep). Key mappings:

| RPC | Client call sites | Defined in (first→last) |
|---|---|---|
| `collect_and_allocate_payment` | `supabase-shared-repositories.ts:2505` (+ EF collect-payment:147) | 0026→0127 |
| `revert_payment_allocation` | supabase-shared-repositories.ts (+ EF refund-payment:100) | 0026→0087 |
| `mark_payment_cleared` / `mark_payment_bounced` | supabase-shared-repositories.ts | 0039/0042→0115; 0042 |
| `create_manual_debt` / `adjust_installment_amount` | supabase-shared-repositories.ts | 0137 / 0152 |
| `compute_debt_aging_summary` / `read_debt_aging_thresholds` | supabase-shared-repositories.ts | 0111→0133 / 0133→0150 |
| `execute_batch_promotion` | supabase-shared-repositories.ts, supabase-academic-repository.ts | 0059→0107 |
| `fn_finalize_class_placements` | supabase-academic-repository.ts | 0096 |
| `fn_create/get/confirm/reopen/complete/cancel_promotion_cycle*` | supabase-academic-repository.ts | 0108 |
| `fn_generate/get_re_enrollment_candidates`, `fn_set_re_enrollment_decision`, `fn_re_enroll_student`, `fn_freeze_re_enrollments` | supabase-academic-repository.ts | 0128 |
| `fn_timetable_publish` | supabase-timetable-repository.ts | 0109 |
| `fn_er_decide_proposal / merge / unmerge / has_aggregation_state` | supabase-identity-resolution-repository.ts | 0130→0132 |
| `set_current_academic_year` | supabase-academic-repository.ts | 0059 |
| `set_active_pricing_config` / `create_pricing_config_for_year` / `upsert_setting` | supabase-pricing-repository.ts | 0117 / 0117 / 0024 |
| `soft_delete_parent` / `soft_delete_student` | supabase-shared-repositories.ts (+ diagnostics, tests) | 0100 |
| `purge_student_parent_domain` | supabase-purge-repository.ts | 0120→0121 |
| `register_family_batch` | not called via `.rpc(` in desktop src (Android is the primary consumer; invoked through registration-billing-wires/tests) | 0102→0128 |
| `upsert_{parent,student,payment,ledger_entry,installment,assessment,attendance}_from_import` | `default-push-handler.ts` (all), supabase-shared-repositories (ledger), diagnostics | 0027/0028/0030/0031/0037 → 0094/0107/0127/0128/0129 |
| `mark_sync_queue_processed` | default-push-handler.ts | 0027 |
| `pull_{parents,students,payments,ledger_entries,device_tokens}_for_sync` | declared in types.ts:918–922 for Android; no desktop call sites | 0027 / 0143 |
| `notify_parent_user` | supabase-shared-repositories.ts | 0077 |
| `write_audit_log` | 5 supabase repository files | 0014 |
| `current_tenant_id` / `current_user_profile_id` / `current_user_roles` / `current_user_permissions` | diagnostics-runner, approval/expense repos, supabase-auth-repository | 0003→0099 / 0003→0053 |
| `create_direct_channel` | supabase-chat-repository.ts | 0061→0105 |
| `save_dashboard_layout` | supabase-dashboard-layout-repository.ts (+ test) | 0134 |
| `adjust_personnel_salary` / `record_salary_disbursement` | supabase-personnel-repository.ts | 0095 |
| `record_auto_releve_entry` | auto-releve-bridge.ts | 0141 |
| `respond_leave_clarification` | supabase-leave-request-repository.ts | 0104 |
| `generate_activation_code` | supabase-approval-repository.ts | 0005 |
| `generate_receipt_numbers` | supabase-shared-repositories.ts | 0058 |

**Not called by the desktop but defined** (Android/EF/cron consumers): `read_*_collection` (0123), `approve_account_request` (0047), `approve_student_application` (0116, service_role), `admin_create_user_account` (0097), `bind_activation_code` (0055), `expire_pending_approvals` (0036/0049), `purge_expired_backups` (0013/0119), `refresh_*` (0022/0036), `open_parent_admin_channel` (0067/0116).

## 7. Schema/table summary + RLS observations

**Table census:** **100 distinct tables** created across the chain (first-seen: 0002 4, 0003 5, 0004 12, 0005 5, 0006 7, 0007 8, 0008 3, 0009 2, 0010 13, 0011 6, 0012 5, 0013 3, 0014 1, 0024 1, 0027 2, 0029 2, 0033 1, 0043 1, 0081 1, 0094 2, 0095 4, 0107 1, 0108 2, 0109 5, 0128 1, 0130 4, 0134 1, 0148 1, 0153 1). Only `receipts` dropped (0079:52) → **99 live-by-chain**. `AGENTS_supabase.md` recorded live at "83 tables / 226 policies" (0099-era) — live↔chain drift is real.

**RLS observations:**
- **106** `ENABLE ROW LEVEL SECURITY` statements across 17 files; **331** `CREATE POLICY` statements — heavy re-declaration churn.
- Sample policies: (1) `attendance_select` — 0019:258–263, tenant + `has_any_role(super_admin, financial_officer, support_staff, teacher, manager, parent, student)` — **the leak** (ORs over 0041:174–183 `attendance_parent_own_select`); (2) `parents_select` — 0083:134–140, teacher removed; (3) `ledger_entries_select` — 0019:597–605; (4) `payment_allocations_staff_select` — 0041:302–311.
- RLS helper architecture (SECURITY DEFINER + `search_path=public`, InitPlan hoists in 0126, `auth.uid()` short-circuit in 0099) verified; the 54001 recursion incident is documented in `AGENTS_supabase.md` §2–3.

**Auth model:** `auth.users` → `handle_new_auth_user()` trigger (0054:54; self-signup hardcodes 'parent' :122–128, admin-invite honors EF-supplied `requested_role`) → `user_profiles` → `role_assignments` + `tenant_role_overrides`; approval via `account_approval_requests`; activation via single-use `activation_codes` + `bind_activation_code` (0055); staff accounts via `admin_create_user_account` (0097); server secrets in `system_settings` + `update-server-secret` EF; cron auth via `CRON_SECRET`/service_role.

**Migration hygiene:** naming `NNNN_name.sql` uniformly followed; every file carries the T-091 registration block; append-only guard enforces no-modify/no-delete/no-rename + header + naming, but **22 files were historically edited post-commit** and 5 numbers never existed; duplicated full-body function redefinitions are pervasive.

## 8. Unresolved questions

1. **Live-database state**: the chain defines ~99 tables, but `AGENTS_supabase.md` says live had 83 at the 0099 era — the current live census cannot be confirmed without DB access (out of scope).
2. **`register_family_batch` consumers**: no desktop `.rpc(` call site found — is the 0128 `source_id` regression actually reachable from any current client (Android? tests?), or is it dead-code risk only?
3. **Permission vocabulary split**: which side is authoritative for UI gating when the client enum has 41 codes the server never seeds?
4. **`has_medical_justification`**: was it a website-only feature later removed, leaving 0088's registry permanently ahead of every runtime?
5. **`writeAuditLog` jsonb stringification**: confirming the actual stored rows requires DB access.
6. **GoTrue `admin.createUser` metadata timing**: runtime behavior that source reading cannot settle.
7. **0095's `IF` artifact**: suggests one more file worth a syntax sweep alongside the (now-fixed) 0096 OPS-313.

**Bottom line:** the Supabase context report is highly reliable — every one of its 11 critical bug warnings was confirmed against current source, and its consolidated "authoritative state" matches the migration chain through 0157. Its main weaknesses are cosmetic (understated duplication counts, "155 migrations" vs 152, one wrong line number) and it missed four genuinely new findings: the EF/desktop `amount_pending` overdue-filter divergence, the stale FCM secret allowlist, the materially stale hand-written `types.ts`, and the client/server permission-vocabulary split. Its top recommendations (fix the 11 contradictions; replace raw migration dumps with a generated schema snapshot) stand, and the newly found divergences should be added to that fix list.
