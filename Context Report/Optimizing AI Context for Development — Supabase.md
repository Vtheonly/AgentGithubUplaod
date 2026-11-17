## Executive Summary

The provided export contains **176 files** solely from `elimtiyaz-desktop/supabase/` (roughly **155 incremental migrations**, 1 outdated bootstrap script, 16 Edge Function folders, and `config.toml`). Roughly **75–85% of the token volume is historical noise, superseded function bodies, redundant policy re-declarations, one-time data fixes, and live-apply ceremony** rather than current system behavior.

More dangerously, the historical chain contains **multiple overwritten implementations and active contradictions**—meaning an AI reading the full export sequentially can easily invoke dropped RPCs (`collect_payment`, `refund_payment`, `promote_students`, `record_roll_call`), trust a broken bootstrap file (`9000_bootstrap_shared_schema.sql`), rely on deprecated tables (`grades`, `homework_assignments`, `academic_history`, `receipts`), or miss real bugs between Edge Functions, `config.toml`, and current SQL definitions.

Below is:
1. **Part 1 — Complete Context Audit** answering your five analytical questions with exact authoritative vs. obsolete mappings and discovered contradictions.
2. **Part 2 — Consolidated, Authoritative AI Context Specification** representing the actual current backend state as of migration `0157` (ready to replace the raw `supabase/` dump in AI prompts).

---

# Part 1: Context Audit

## 1. What Must Always Be Included

To modify or maintain the backend safely without breaking invariants, an AI **must** always have:

1. **Tenant, Identity, and RBAC Resolution Core**:
   - Multi-tenancy boundary (`tenants.id`, default tenant `00000000-0000-0000-0000-000000000001`).
   - User resolution chain: `auth.users` → `user_profiles` (`status`: `pending | active | suspended | deleted`) → `role_assignments` + `tenant_role_overrides` → 11 roles (9 staff, 2 web: `parent`, `student`) and 54 active permissions.
   - `SECURITY DEFINER` RLS helpers (`0099`/`0053`/`0067`/`0116`/`0135`): `current_user_profile_id()`, `current_tenant_id()`, `is_global_admin()`, `current_user_roles()`, `current_user_permissions()`, `has_role()`, `has_any_role()`, `has_permission()`, `profile_has_staff_role()`, `is_own_parent_via_student()`—including the **InitPlan `(select ...)` wrapping rule (`0126`)** and **`auth_user_id = auth.uid()` short-circuit (`0099`)** to prevent stack-depth recursion and statement timeouts.
2. **Current Authoritative Schema (Tables, Key Columns, FKs, Unique Indexes, Check Constraints)**:
   - Especially non-obvious uniqueness and constraint rules: `installments` (`tranche_number` nullable `IN (0,1,2,3)`, year-scoped partial unique index `0129`, 6-value `status` check `0034`/`0037`), `ledger_entries` (immutable, `ledger_entries_source_uidx` excludes `reversal`, `adjustment`/`reversal` require `description >= 3` chars `0069`), `assessments` (canonical `uq_assessments_canonical`), `attendance_records` (`uq_attendance_canonical`), `pricing_configs_one_active_per_tenant` (`0117`), `timetable_entries` (double-booking unique indexes + immutability when published `0109`), `chat_channels.scope` (`0135`), `onboarding_states` tenant singleton (`0142`), `personnel_active_account_uq` (`0097`).
3. **Authoritative Server-Side RPCs & Triggers (Only the Latest Active Versions)**:
   - Financial atomic RPCs (`collect_and_allocate_payment`, `revert_payment_allocation`, `mark_payment_cleared`, `mark_payment_bounced`, `compute_parent_summary`, `compute_account_balance`, `create_manual_debt`, `adjust_installment_amount`).
   - Financial & aging read RPCs (`read_*_collection`, `compute_debt_aging_summary`, `read_debt_aging_thresholds`, `30s` statement timeouts).
   - Sync & bulk import RPCs (`upsert_parent_from_import`, `upsert_student_from_import`, `upsert_payment_from_import`, `upsert_ledger_entry_from_import`, `upsert_installment_from_import`, `register_family_batch`, `pull_*_for_sync` with `0143` composite `(updated_at, id)` keyset).
   - CRM/Auth/Academic/Workforce/Expense/ER-PMAE RPCs & state-machine triggers (`handle_new_auth_user`, `approve_account_request`, `approve_student_application`, `admin_create_user_account`, `bind_activation_code`, `soft_delete_parent`/`student`, `set_current_academic_year`, `execute_batch_promotion`, `fn_finalize_class_placements`, promotion cycles, re-enrollments, `fn_timetable_publish`, `enforce_expense_workflow_rules`, `adjust_personnel_salary`, `record_salary_disbursement`, `record_auto_releve_entry`, `save_dashboard_layout`, `purge_student_parent_domain`, `fn_er_*`).
4. **Active RLS & Storage Bucket Boundaries**:
   - Which tables bypass standard `UPDATE` due to `deleted_at IS NULL` in `SELECT` policies (requiring `soft_delete_*` RPCs `0100`).
   - Column-guard triggers (`enforce_parent_self_update_columns`, `enforce_parent_attendance_update_columns`, `enforce_application_self_update_columns`, `enforce_chat_read_by_append_only`, `enforce_expense_workflow_rules`, `chat_channels_derive_scope`).
   - Private Storage buckets and path conventions (`<tenant_id>/<entity_id>/<filename>`).
5. **Edge Functions, Auth Gates & Shared Contracts**:
   - Which endpoints use user JWTs vs. `_shared/cron-auth.ts` (`CRON_SECRET` / `service_role`) vs. `service_role` only.
   - `_shared/supabase.ts` (`extractAuthContext`, `withAuditSurfacing`), `_shared/send-email.ts`, `workflow-execute/engine.ts` + `actions.ts`.
6. **Explicit System Boundaries Missing from This Export**:
   - Note explicitly that **client-side canonical engines** (Desktop TypeScript pricing/promotion/discount/timetable solver, Android Kotlin/Room offline store, Next.js Parent Portal) live outside this folder and share deterministic contracts with these RPCs (e.g., FNV-1a IDs, `deriveAccountId`, `compute_parent_summary` parity, DAG `engine.ts` parity).

---

## 2. What Can Be Unified or Consolidated

| Scattered Across | Unified Into |
| :--- | :--- |
| **155 sequential SQL files (`0001`–`0157`)** patching tables with `ADD COLUMN`, replacing `CHECK` constraints 3–5×, and redefining RPCs up to 6× | **One current-state schema reference + one authoritative RPC/trigger inventory** grouped by domain (Auth/RBAC, CRM, Finance, Pricing, Academics, Workforce, Operations, Workflow/AI, Comms/Sync/Admin). |
| **Financial allocation/reversal history** across `0007`, `0022`, `0025`, `0026`, `0032`, `0033`, `0034`, `0035`, `0036`, `0039`, `0040`, `0042`, `0045`, `0055`, `0058`, `0087`, `0090`, `0115`, `0124`, `0127`, `0129`, `0137`, `0152` | **Single Financial Engine Spec**: current `installments`/`payments`/`ledger_entries`/`payment_allocations` rules + the 8 active financial RPCs + 4 read RPCs + debt-aging config (`0125`/`0133`/`0138`/`0150`). |
| **Sync & Import Upserts** spread across `0027`, `0028`, `0030`, `0031`, `0037`, `0055`, `0058`, `0102`, `0103`, `0107`, `0112`, `0127`, `0128`, `0129`, `0143` | **Single Sync Contract**: current parameter signatures, ref-resolution helpers (`resolve_*_ref`), idempotency keys, and `(updated_at, id)` pull pagination. |
| **Approval & Account Onboarding** across `0002`, `0005`, `0044`, `0047`, `0049`, `0054`, `0097`, `0116`, plus `approve-signup-request`, `bind-activation-code`, `create-user-account`, `delete-user-account`, `expire-pending-approvals` | **Single Account Lifecycle Spec**: self-signup (`parent`-hardcoded via trigger) → pending attachment → admin approval/reclassification or activation-code bind → staff account creation/employee link → deletion/expiration. |
| **Chat & Notifications** across `0010`, `0013`, `0019`, `0043`, `0048`, `0050`, `0051`, `0060`, `0061`, `0067`, `0075`, `0076`, `0077`, `0078`, `0085`, `0105`, `0106`, `0116`, `0135`, `0136`, `0147`, `0156`, `send-push-notification`, `run-overdue-scan` | **Single Messaging & Notification Spec**: `portal` vs `internal` chat scope (`0135`), DM/group/parent-admin rules, read receipts (`0051`), attachments (`0136`), in-app triggers (`0075`/`0078`), FCM lifecycle (`0050`/`0060`/`send-push-notification`), overdue scan (`run-overdue-scan`). |
| **Expense Rules** across `0008`, `0022`, `0056`, `0064`, `0153`, `0155` | **Single Expense Spec**: ticket + `expense_attachments` + `responsible_profile_id`, state machine + reviewer/actor triggers (`0155`), and `approve_expense`/`settle_expense` RPCs. |
| **Workflow DAG Engine** across `0012`, `0071`, `0081`, `0082`, `0088`, `workflow-execute/*`, `workflow-resume-scheduler` | **Single Workflow Spec**: DAG schema + publish gates (`0081`/`0082`) + runtime execution/parking (`engine.ts`/`actions.ts`/`workflow-resume-scheduler`). |

---

## 3. What Can Be Removed from AI Context

Remove these entirely from regular AI context (keep only in git history or an archive doc):

1. **`elimtiyaz-desktop/supabase/bootstrap/9000_bootstrap_shared_schema.sql`** — Completely obsolete (~`0028` era), **syntactically broken** (commas placed inside `--` comments on `students.enrollment_status` and `installments.status`), creates a trigger on nonexistent `ledger_entries.updated_at`, enables RLS with zero policies (blocking all access despite comments claiming RLS is disabled), and defines outdated sync RPC signatures.
2. **Dropped / Retired Functions (no longer exist in Postgres)**:
   - `0022`: `collect_payment`, `refund_payment`, `get_parent_summary`, `run_overdue_scan`, `promote_students`, `record_roll_call` (dropped in `0034`/`0035`/`0059`/`0144`).
   - `0025`: `allocate_payment_waterfall`, `compute_parent_outstanding_v2`, `reconcile_parent` (dropped in `0034`/`0035`).
   - `0007`: `compute_parent_balance`, `compute_parent_outstanding`, `compute_overdue_amount`, 1-arg `compute_account_balance(text)` (dropped in `0034`/`0035`/`0036`).
   - `0029`: `fn_current_tenant_id()` (dropped in `0057`).
   - `0052`: `_eq_test_fn()`, `_eq_test_fn2()`.
3. **Dropped / Retired Schema Objects & Permissions**:
   - `receipts` table + `receipts` storage bucket/policies (dropped in `0079`; PDF receipts are client-generated).
   - `access_driver_mode` and `view_routing` permissions (retired in `0157` — GPS Tournee feature removed).
   - Broken triggers `grade_level_tuition_touch_updated_at` and `transport_destinations_touch_updated_at` (`0006`, dropped in `0086`), `installments_update_status` (`0007`, dropped in `0032`/`0034`), `rls_*_tenant` policies (`0029`, dropped in `0041`/`0057`).
4. **One-Time Data Reconciliation / Incident Repair DMLs**:
   - `0052` (test residue cleanup), `0062` (finance reconciliation), `0063` (390-row Excel corpus dump & alignment), `0066` (parent `first_name` backfill), `0068` (parent `display_name` repair), `0101` (restore soft-deleted SIDI family), `0114 §3` (`academic_years.code` backfill), `0124` bulk-import installment cleanup. Keep only the resulting **behavioral invariants** (e.g., "historical overpayers pre-0062 have no `parent_credit` adjustment rows; `bulk_import` ledger entries use `source_id='<student>:V2'`"), not thousands of lines of literal student rows (`_t105_corpus` in `0063`).
5. **Migration Boilerplate & Historical Prose**:
   - Dozens of `INSERT INTO supabase_migrations.schema_migrations ... ON CONFLICT DO NOTHING` blocks (`0066`, `0070`–`0084`, `0088`, `0091`–`0096`, `0100`–`0108`, `0111`–`0112`, `0115`, `0117`, `0119`–`0121`, `0123`–`0147`, `0150`–`0157`).
   - Session-number changelogs, Management-API `COMMENT ON` caveats, `DO $drop...$` constraint-drop loops, and `REVOKE`/`GRANT` repetitions across superseded versions.

---

## 4. What Is Already Covered Elsewhere (Redundant Repetition)

- **Repeated full-body function dumps**:
  - `upsert_student_from_import` appears in full 6 times (`9000`, `0027`, `0028`, `0031`, `0037`, `0107`, `0128`).
  - `collect_and_allocate_payment` appears in full 6 times (`0026`, `0034`, `0039`, `0040`, `0042`, `0087`, `0115`, `0127`).
  - `revert_payment_allocation` appears 5 times (`0026`, `0034`, `0041`, `0042`, `0055`, `0087`).
  - `compute_parent_summary` and the 4 materialized views (`mv_dashboard_kpis`, `mv_debt_aging`, `mv_top_debtors`, `mv_revenue_by_month`) are repeated verbatim across `0021`, `0034`, `0041`, `0042`, `0049`, `0111`.
  - `compute_debt_aging_rows` is pasted in full 3 times (`0111`, `0126`, `0127`), and `compute_debt_aging_summary` 3 times (`0111`, `0125`, `0133`).
  - `register_family_batch` appears 3 times (`0102`, `0103`, `0112`, `0128`) and `batch_register_family` twice (`0022`, `0065`).
  - `validate_workflow_dag` (`0081`, `0088`), `purge_student_parent_domain` (`0120`, `0121`), `read_debt_aging_thresholds` (`0133`, `0138`, `0150`), `open_parent_admin_channel` (`0067`, `0116`), `create_direct_channel` (`0061`, `0105`), `enforce_expense_workflow_rules` (`0008`, `0064`, `0155`), and `register_fcm_token` (`9000`, `0027`, `0050`, `0060`) are all repeated in full.
- **Repeated validation rules**:
  - Workflow DAG validation is implemented in both SQL (`validate_workflow_dag` in `0088`) and TypeScript (`validateWorkflowDefinition` in `workflow-execute/engine.ts`).
  - Payment proof rules appear in `collect-payment/index.ts` and `enforce_payment_proof` trigger (`0045`).
  - `touch_updated_at()` trigger attachments and standard tenant-scoped `RLS` boilerplate appear across ~60 tables.

---

## 5. Contradictions, Outdated Elements & Bugs Found (Authoritative Rulings)

The audit revealed both **superseded historical designs** and **active bugs/contradictions currently present in the latest files**:

### A. Superseded vs. Authoritative Elements

| Topic | Outdated / Superseded | Authoritative Current Implementation |
| :--- | :--- | :--- |
| **Bootstrap / Setup** | `bootstrap/9000_bootstrap_shared_schema.sql` | Apply `migrations/0001`–`0157` in order (except note below on active bugs). |
| **Academic Grades** | `0004.grades`, `0022.compute_gpa`, `0021/0041.mv_grade_summary` | `assessments` (`0029`/`0041`/`0094`) + `fn_calculate_student_term_gpa` (`0029`) + `subject_configurations` (`0094`). |
| **Academic History** | `0004.academic_history`, `0022.promote_students` (dropped) | `student_academic_histories` (`0029`/`0107`) + `execute_batch_promotion` (`0107`) + `promotion_cycles` (`0108`). |
| **Homework** | `0004.homework_assignments` | `homework` (`0029`) + `notify_parents_on_homework` trigger (`0078`). |
| **Student Documents** | `0038` `students.documents_json` (forensic archive only) | `student_documents` table (`0005` + `0043` RLS + `0098` backfill) + `student-documents` bucket. |
| **Tuition & Discounts** | `0023` seed ("Prices.md"), `pricing_configs.registration_fee`, `passage_palier` / `highest_average` / `seniority_5y`, 10% `full_annual` | `0089` workbook pricing: per-grade `grade_level_tuition.registration_fee` (FI), `full_annual` = 5% tuition only, `sibling_fixed` active, 20+ towns in `transport_destinations`, `0117` one active `pricing_config` per tenant. |
| **Installment Tranches** | `0090` 4-tranche BON structure (`tranche 1 = FI .. tranche 4`) | `0124` + `0137`: `tranche_number` `0` = FI, `1..3` = V1/2V/v3, `NULL` = non-wave manual debt (`0137`). |
| **Debt Aging Model** | `0111` active-payer masking (`inactivity <= 60 => green`) | `0125`/`0133`/`0138`/`0150`: 4-tier due-date aging (`grace`, `yellow`, `red`) + separate amount thresholds + `severe_debt_dzd` + per-level message templates (`compute_debt_aging_summary`, `read_debt_aging_thresholds`). |
| **Receipts** | `0007.receipts` table, `0018.receipts` bucket, `generate-receipt-pdf` in `config.toml` | Retired (`0079`, ADR-014). Receipt number lives on `payments.receipt_number`; PDFs are rendered client-side. |
| **Push Config** | `FCM_SERVER_KEY` / `FCM_SENDER_ID` in `0024` & `update-server-secret` | `FIREBASE_SERVICE_ACCOUNT_JSON` + `FIREBASE_PROJECT_ID` (FCM HTTP v1 in `send-push-notification`). |
| **Staff Chat Eligibility** | `0067` 5-role office list | `0105`/`0135`/`0156`: all 9 employee roles; channels strictly separated by `scope` (`internal` vs `portal`, `0135`). |
| **Driver Tournee** | `0023` `access_driver_mode`, `view_routing` | Retired (`0157`); `deliveries` + `driver` role remain. |

### B. Active Cross-File Bugs & Contradictions in Current Code (Critical Warnings for AI)

1. **`register_family_batch` (`0128`) silently dropped `0103`'s `source_id` token replacement**:
   - `0103` added `v_student_codes` and substituted code tokens → resolved UUIDs in ledger/installment `source_id`s so re-registrations converge with the legacy client path.
   - `0112` copied `0102` instead of `0103`, wiping out that replacement; `0128` copied `0112`. Currently `register_family_batch` inserts `r.source_id` verbatim.
2. **`create_manual_debt` (`0137`) omits `academic_year_id` on `installments` insert**:
   - It computes `v_year_id`, puts it in `audit_logs`, and returns it, yet `INSERT INTO public.installments (...)` omits the `academic_year_id` column (leaving it `NULL` on manual debt rows, forcing fallback to `INV-14`).
3. **`purge_student_parent_domain` (`0121`) uses `v_auth_ids` instead of `v_profile_ids` for `notifications` and `device_tokens`**:
   - Both `notifications.target_user_id` (`0077`) and `device_tokens.user_id` (`0027`/`0050`) store `user_profiles.id`, NOT `auth.users.id`. Deleting with `= any(v_auth_ids)` leaves purged users' notifications and device tokens orphaned.
4. **`collect-payment/index.ts` fails on non-cash payments and references nonexistent fields**:
   - Validates `check_number`/`check_bank_name`/`transfer_reference` in TS, but **does not pass them** to `collect_and_allocate_payment`, causing `enforce_payment_proof` (`BEFORE INSERT`) to fail on every check/transfer via the Edge Function.
   - References `ctx.userDisplayName`, which does not exist on `AuthContext` in `_shared/supabase.ts` (same in `refund-payment/index.ts`).
   - `refund-payment/index.ts` also double-writes `payment.refund` audit log (`revert_payment_allocation` already writes it).
5. **`revert_payment_allocation` (`0087`) gaps vs. `0115` & `0062`/`0063`**:
   - Does not update/delete `payment_allocations` rows created by `collect_and_allocate_payment` (`0115`).
   - Looks up `ledger_entries` by `source_type = 'payment' AND source_id = p_payment_id::TEXT`, which cannot match `0062`/`0063` bulk-imported payments (`source_type = 'bulk_import'`), causing status flips to `'refunded'` without ledger reversal or LIFO rollback (as documented in `0101`).
   - Also `mark_payment_cleared` (`0115`) and `mark_payment_bounced` (`0042`) still write audit entries only to `diff`, leaving `before_json`/`after_json` `NULL`.
6. **`ai-proxy/index.ts` vs. `0012` CHECK & `_shared/cors.ts`**:
   - `ai_request_logs.feature` `CHECK` only permits `'narrative' | 'drafting' | 'anomaly'`. `ai-proxy`'s `logAgentRequest()` inserts `feature: 'copilot'`, failing the constraint silently (caught by `try/catch`)—so copilot calls are unlogged and bypass rate-limit counts.
   - Line 213 calls `corsHeaders(req)` instead of `corsHeaders(req.headers.get("origin"))`.
7. **Workflow DAG Validator Divergence (`0088` vs `workflow-execute/engine.ts`)**:
   - `0088` SQL `validate_workflow_dag` accepts condition subtype `has_medical_justification`, while `engine.ts` (`SUBTYPES_BY_TYPE.condition`) omits it and will fail those nodes at execution time.
   - `engine.ts` supports `edge.source_handle` (`"true" | "false"`), whereas `0088` ignores `source_handle`.
8. **`attendance_records` RLS Leak (`0126` vs `0041`)**:
   - `0041` added `attendance_parent_own_select` to restrict parents/students to their own children, but `attendance_select` (`0019`, recreated in `0126`) still includes `'parent'` and `'student'` in its tenant-wide `has_any_role(...)` list. Because permissive `SELECT` policies OR together, parents/students still have tenant-wide `SELECT` on `attendance_records` (same for `0019` `academic_history_select`).
9. **`mv_grade_summary` Refresh Broken (`0041` vs `0022`/`0036`)**:
   - `0041` recreated `mv_grade_summary` without its unique index, breaking `REFRESH MATERIALIZED VIEW CONCURRENTLY` in `refresh_all_materialized_views()` (`0022`), and `refresh_materialized_view(text)` (`0036`) rejects `'mv_grade_summary'`.
10. **`config.toml` vs Edge Functions**:
    - Lists nonexistent `generate-receipt-pdf` and `export-data`; omits `create-user-account`, `delete-user-account`, `send-push-notification`.
    - Sets `[auth.hooks] send_confirmation = "approve-signup-request"` (in reality `approve-signup-request` is an admin API requiring `support_staff` JWT, and signup rows are created by `handle_new_auth_user()` DB trigger).
    - Sets `[functions.run-overdue-scan] verify_jwt = true`, which blocks `CRON_SECRET` callers at the gateway before `_shared/cron-auth.ts` runs.
11. **`_shared/supabase.ts` `writeAuditLog` & `update-server-secret`**:
    - `writeAuditLog` passes `JSON.stringify(before/after)` for `jsonb` parameters; via PostgREST RPC JSON serialization, passing pre-stringified JSON can store a `jsonb` string scalar rather than a structured `jsonb` object.
    - `update-server-secret/index.ts` imports `../../../src/core/audit-actions.ts` outside `supabase/functions/`, which breaks standalone Edge Function deploys.

---

# Part 2: Consolidated AI Context (Authoritative Current State — `elimtiyaz-desktop/supabase` as of `0157`)

*Use everything below as the clean, non-contradictory backend reference replacing `bootstrap/`, `config.toml` noise, and migrations `0001`–`0157`.*

---

## 1. Platform Topology & Boundaries
- **Scope of this layer**: PostgreSQL schema (`public`, private `storage` buckets, `auth.users` trigger) + Deno Edge Functions (`supabase/functions/`).
- **External Clients (not in this directory)**:
  - **Desktop (Electron/React/TS)**: Staff operations; owns client-side calculations for pricing quotes, sibling/annual discounts, GPA/promotion suggestions, timetable solving, receipt PDFs (`pdf-lib`), PII masking before AI, and local SQLite/sync queue.
  - **Mobile (Android/Kotlin/Room)**: Staff offline-first client; pushes/pulls via `upsert_*_from_import`, `pull_*_for_sync`, `register_fcm_token`.
  - **Web Portal (Next.js)**: Parent/student portal; self-signup/OAuth (`pending`), activation code binding, read own children/finances/timetables/grades, submit absence justifications, upload student docs, 1:1 `portal` chat to admin.
- **Default seeded tenant**: `00000000-0000-0000-0000-000000000001` (`elimtiyaz-boumerdes`, Algeria/`DZ`, `DZD`, `fr`, `Africa/Algiers`).
- **Owner-pinned admin**: `admin@elimtiyaz.dz` (protected against deletion in `delete-user-account`).

---

## 2. Identity, Auth, Tenancy & RBAC

### Core Tables
- `tenants`: `id`, `slug` (unique), `name`, `default_locale`, `default_currency`, `timezone`, `is_active`, `settings jsonb`, `deleted_at`.
- `user_profiles`: `id`, `auth_user_id` (unique), `tenant_id` (nullable = global admin), `email`, `display_name`, `avatar_url`, `phone`, `locale`, `status` (`pending | active | suspended | deleted`), `approval_request_id`.
- `account_approval_requests`: `id`, `tenant_id`, `auth_user_id` (unique), `email`, `requested_role` (`parent | student | staff`), `activation_code`, `national_id`, `phone`, `full_name`, `notes_from_user`, `target_parent_id`, `target_student_id`, `student_application jsonb` (`0116`), `status` (`pending | approved | rejected | expired`), `reviewed_by`, `reviewed_at`, `decision_note`, `expires_at` (`+7d`).
- `sessions`: telemetry + force revocation (`revoked_at`).
- `roles` (11 seeded):
  - **9 Staff roles** (`is_staff_role=true`): `super_admin`, `financial_officer`, `teacher`, `support_staff`, `manager`, `buyer`, `driver`, `warehouse_worker`, `worker`.
  - **2 Web roles** (`is_web_role=true`): `parent`, `student`.
- `permissions` (54 active codes across domains; `access_driver_mode`/`view_routing` retired in `0157`), `role_permissions`, `tenant_role_overrides` (`grant | deny`, deny wins), `role_assignments` (partial unique active `(user_profile_id, tenant_id, role_id) WHERE revoked_at IS NULL`).

### Auth & RBAC Mechanics
- **Signup Trigger (`on_auth_user_created` → `handle_new_auth_user()` `0054`)**:
  - `created_by_admin = 'true'` in `raw_app_meta_data` uses EF-supplied `tenant_id` & `requested_role`. *(Caveat: GoTrue `admin.createUser` may not populate `raw_app_meta_data` before the `AFTER INSERT` trigger fires, so admin invites can initially land as `parent/pending` before `admin_create_user_account` or reclassification resolves them.)*
  - Self-signup ignores client metadata, binds to first active tenant, and hardcodes `requested_role = 'parent'`.
- **Self-Service Student Application Attach (`0116`)**:
  - Pending users can `SELECT`/`UPDATE` their own pending `account_approval_requests` row; `account_approval_self_update_guard` restricts non-staff updates strictly to `student_application`.
- **RLS Helper Functions (`SECURITY DEFINER`, `search_path='public'`, InitPlan-safe — wrap hot policy calls in `(select ...)` per `0126`)**:
  - `current_user_profile_id()`, `current_tenant_id()`, `is_global_admin()`, `current_user_roles()` (tenant-scoped), `current_user_permissions()` (tenant-scoped + overrides), `has_role()`, `has_any_role()`, `has_permission()`, `profile_has_staff_role()` (9 staff roles), `profile_has_staff_role_in_tenant()`, `is_own_parent_via_student()`.
  - `user_profiles_select_own` short-circuits `auth_user_id = auth.uid()` first to avoid recursion (`0099`).
- **Account RPCs**:
  - `approve_account_request(request_id, reviewer_profile_id, target_parent_id?, target_student_id?, decision_note?)` (`0047`): activates user, assigns role, binds parent/student with re-bind rejection (`parent.bind` / `student.bind` audit).
  - `approve_student_application(request_id, reviewer_profile_id, decision_note?, target_student_id?, target_parent_id?, new_parent?, new_student?)` (`0116`, `service_role` only): composite onboarding—creates deterministic parent if needed, creates `ELV` student + current-year `student_academic_histories`, calls `approve_account_request`.
  - `reject_account_request(request_id, reviewer_profile_id, decision_note)` (`0005`): marks rejected + suspends `user_profiles`.
  - `admin_create_user_account(auth_user_id, role_code, tenant_id, reviewer_profile_id, decision_note?, personnel_id?, email?)` (`0097`, `service_role` only): activates, grants role, resolves approval request, optionally links `personnel.user_id` (enforced 1:1 via `personnel_active_account_uq`).
  - `bind_activation_code(tenant_id, code, auth_user_id)` (`0055`): verifies caller `auth.uid() = p_auth_user_id` unless `service_role`; guards against re-binding bound parent; binds `activation_codes` + `parents.auth_user_id`.
  - `expire_pending_approvals()` (`0049`): expires stale `pending` requests, returns `TABLE(tenant_id, expired_count)`.

---

## 3. CRM & Family Entities

- **`parents`**: `parent_code` (unique per tenant; deterministic `PAR-{YYYY}-{6-hex}` via `fn_deterministic_parent_code` `0065`), `first_name`, `last_name`, `display_name` (authoritative UI label), `primary_phone`, `secondary_phone`, `email`, `national_id`, `occupation`, `address`, `city`, `postal_code`, `transport_destination`, `city_tier`, `relationship`, `is_active`, `is_financially_restricted`, `auth_user_id`, `deleted_at`.
  - RLS: Staff read (`super_admin`, `financial_officer`, `support_staff`, `manager`; `teacher` excluded `0083`); parent self-read + student own-parent read (`0116`); `parents_self_update` restricted to contact columns for `parent` role (`0046` fixed trigger so staff can edit identity columns).
- **`students`**: `parent_id` (NOT NULL FK `RESTRICT`), `student_code` (`ELV-{YYYY}-{6-digit}` or deterministic), `first_name`, `middle_name`, `last_name`, `display_name`, `date_of_birth`, `gender`, `grade_level_id`, `grade_level_code`, `class_id`, `filiere_code`, `specialite_code` (`0107`), `transport_tier`, `payment_plan` (`tranches | full_annual`), `enrollment_date`, `enrollment_status` (`inquiry | quoted | enrolled | active | suspended | transferred | withdrawn | graduated`), `origin_type` (`new_admission | transfer | continuation | other`), `previous_school_name`, `previous_school_level`, `previous_academic_year`, `origin_notes` (`0128`), `is_active`, `auth_user_id`, `deleted_at`.
  - *Deprecated*: `students.documents_json` (`0038`) is archive-only; use `student_documents` (`0098`).
  - RLS: Admin roles read all; `teacher` reads ONLY assigned homeroom or subject classes (`0083`); `students_update` excludes `teacher` (`0083`); parent sees own children; student sees self.
- **`parent_student_links`**, **`activation_codes`** (single-use; deterministic default via `fn_deterministic_activation_code`), **`student_documents`** (canonical document metadata; staff + parent select/insert for own children `0043`).
- **Soft Delete RPCs (`0100`)**: `soft_delete_parent(parent_id)` & `soft_delete_student(student_id)` (`super_admin` only; required instead of PostgREST `UPDATE` because `deleted_at IS NULL` in `SELECT` policies breaks `UPDATE` visibility; `soft_delete_parent` refuses if active children exist).
- **Atomic Registration RPCs**:
  - `register_family_batch(p_tenant_id, p_parent, p_students, p_ledger_entries, p_installments)` (`0128`, `authenticated|service_role`): 1-RTT composite calling `upsert_parent_from_import` + `upsert_student_from_import` (`0128`), inserting ledger charges + installments (`ON CONFLICT DO NOTHING`), deriving `account_id`. *(Known bug: `0112`/`0128` overwrote `0103`'s `source_id` code→UUID replacement, so `source_id` currently lands literally as passed.)*
  - `batch_register_family` (`0065`): deterministic-code backend fallback.
- **Audit Triggers (`0086`)**: `audit_row_change()` logs full `before_json`/`after_json` on `INSERT`/`UPDATE`/`DELETE` (skipping touch-only updates) for `parents`, `students`, and all 6 pricing tables.

---

## 4. Pricing, Billing & Canonical Financial Engine

### Pricing Catalog (`0006`, `0089`, `0117`)
- **`pricing_configs`**: one per `(tenant_id, academic_year_id)`; **strictly one active per tenant** via `pricing_configs_one_active_per_tenant` (`0117`).
  - RPCs: `set_active_pricing_config(config_id)` and `create_pricing_config_for_year(academic_year_id, label, clone_from_active)` (`0117`, `super_admin | financial_officer`).
- **Child Grids** (all audited by `0086`):
  - `grade_level_tuition`: 14 levels; `registration_fee` (FI per student per grade, `0089` canonical over deprecated `pricing_configs.registration_fee`); `annual_amount = t1 + t2 + t3`.
  - `transport_destinations`: 4 zone codes + 20+ town codes (`0089`).
  - `complementary_services`: `psychology`, `speech_therapy`, `psychotherapy`.
  - `additional_services`: ETAT billable catalog (`psy1`, `psy2`, `orth1`, `orth2`, `e_plant`, `ratrapage`, `autiste`, `0089`).
  - `discounts` (`0086`/`0089`): 9 allowed codes; active real rules are `sibling_fixed` (−5,000 DZD) and `full_annual` (5% tuition-only, deadline June 30); `passage_palier`, `highest_average`, `seniority_5y` deactivated.
  - `discount_applications`: per-student discounts.

### Financial Tables & Invariants
- **`service_enrollments`**: per-student annual enrollments (`0080` scoped `SELECT` to staff + own children/self).
- **`invoices`**: parent/student invoices.
- **`installments`**:
  - `tranche_number`: nullable `CHECK (tranche_number IN (0,1,2,3))` (`0124`/`0137`). `0` = Registration Fee (FI), `1..3` = Official Tranches (V1/2V/v3), `NULL` = Non-wave manual debt.
  - `status`: `'unpaid' | 'partial' | 'paid' | 'overdue' | 'pending' | 'pending_clearance'` (`0034`/`0037`; trigger `installments_update_status` dropped—RPCs/clients set status explicitly).
  - `amount_paid` (cleared funds) & `amount_pending` (uncleared non-cash funds, INV-4: tranche is `'paid'` only when cleared `amount_paid >= amount_due`; remaining capacity = `GREATEST(0, amount_due - amount_paid - amount_pending)`).
  - `academic_year_id` (`0127`): charge-belonging year frozen at write time.
  - Unique identity (`0129`): `(tenant_id, parent_id, student_id, category, tranche_number, COALESCE(academic_year_id, zero_uuid))` where non-wave (`tranche_number IS NULL`) rows are excluded.
- **`payments`**:
  - `payment_number` (unique per tenant) & `receipt_number` (synced when null via `trg_sync_payments_receipt_number` `0034`; sequential `REC-{YYYY}-{6-digit}` via `next_receipt_number()` / `generate_receipt_numbers()` `0058`).
  - `method` (`cash | check | transfer`), `category` (nullable since `0115`: `NULL` = cross-category `"Multi-services"`), `status` (`paid | pending | unpaid | partial | overdue | refunded | cancelled | pending_clearance`), `academic_year_id` (`0127`), `expected_amount`, `excess_amount` (UI display only per `0036`!), `excess_remark`.
  - `payments_enforce_proof` (`0045`): enforces `proof_path`, `check_number`+`check_bank_name`, or `transfer_reference` on `INSERT` and when `method`/proof fields change on `UPDATE` (allows status-only updates on legacy proof-less rows).
  - *Note*: `receipts` table & bucket retired (`0079`).
- **`payment_allocations`** (`0033`, RLS `0041`, `academic_year_id` `0127`): links each payment to covered installments with concrete `category` and `academic_year_id` (populated by `collect_and_allocate_payment` since `0115` and `0062`/`0063` backfills).
- **`ledger_entries`** (IMMUTABLE):
  - `account_id`: `'parent:{p}:category:{cat|all}[:student:{s}]'` (or `'parent:{p}:category:parent_credit'`).
  - Signed `amount` (`>0` charge/reversal, `<0` payment/credit), `entry_type` (`charge | payment | adjustment | refund | reversal | transfer`), `source_type`, `source_id`, `reverses_id`, `reverses_entry_id`, `at` / `entry_date` (synced), `updated_at` (`0143` for sync cursor).
  - `ledger_entries_source_uidx` (`0037`): unique on `(tenant_id, source_type, source_id) WHERE entry_type <> 'reversal'`.
  - `ledger_entries_adjustment_description_guard` (`0069`): `adjustment` & `reversal` entries require `length(btrim(description)) >= 3`.
- **`account_adjustments`** (`0007`, parent self-select `0041`).

### Authoritative Financial & Debt RPCs
- **`collect_and_allocate_payment(...)` (`0127`)**: Atomic cash (`paid`) or non-cash (`pending`) collection, allocates FIFO by `due_date ASC, id ASC` using INV-4 capacity (`due - paid - pending`), writes `payment_allocations`, books cleared overpayment to `parent_credit` ledger adjustment (deferred until clearance for pending), stamps `payments.academic_year_id` & `payment_allocations.academic_year_id`, writes canonical `audit_logs`.
- **`revert_payment_allocation(...)` (`0087`)**: Tenant-scoped (`SEC-112`), flips payment to `refunded`, inserts reversal ledger entry, performs LIFO rollback on `amount_pending` (`originalWasPending`) or `amount_paid` (cleared), re-evaluates tranche status (`paid|partial|overdue|pending`), writes canonical `audit_logs`. *(Known gaps: does not update `payment_allocations`, and cannot match `0062`/`0063` `bulk_import` payment entries where `source_type='bulk_import'`.)*
- **`mark_payment_cleared(...)` (`0115`)**: `pending` → `paid`; moves `amount_pending` → `amount_paid` FIFO capped at `due - paid`; overflow becomes `parent_credit`.
- **`mark_payment_bounced(...)` (`0042`)**: `pending` → `unpaid`; writes reversal ledger entry + LIFO rollback of `amount_pending`.
- **`create_manual_debt(...)` (`0137`)**: Inserts non-wave installment (`tranche_number = NULL`, `source_type = 'manual_entry'`) + ledger `charge` + audit row. *(Known bug: omits `academic_year_id` in the `installments` `INSERT` column list despite resolving/returning `v_year_id`.)*
- **`adjust_installment_amount(installment_id, new_amount_due, reason, actor_id?, actor_name?)` (`0152`)**: Sets absolute `amount_due`, re-derives tranche status, inserts signed delta `adjustment` ledger entry on the tranche's account, allows/flags over-covered tranches (`overcovered=true, excess`), refuses `delta=0`, writes full before/after audit.
- **`compute_parent_summary(parent_id, as_of)` (`0042`)** & **`compute_account_balance(account_id, as_of)` (`0034`)**: Single canonical ledger replay; excludes reversed entries from typed totals; overdue iff `balance > 0.001` AND `MAX(charge.at) < p_as_of`.
- **High-Performance Staff Financial Read RPCs (`0123`, `0151` `statement_timeout='30s'`, `authenticated` staff-gated)**:
  - `read_payments_collection()`, `read_installments_collection()`, `read_ledger_entries_collection()`, `read_debt_summary_collection()` (return `jsonb` arrays bypassing PostgREST 1,000-row cap and per-row RLS).
- **Debt Aging & Configurable Risk Engine (`0111`, `0125`, `0126`, `0127`, `0133`, `0138`, `0150`, `0151`)**:
  - `attribute_academic_year(date, tenant_id)`, `resolve_academic_year_id_for_date(date, tenant_id)`, `academic_year_start(code)`.
  - `compute_debt_aging_rows(tenant_id, as_of)` (`0127`, `30s` timeout): installment-remaining (`INV-4`) obligations + non-reversed payment behavior + persisted-first/INV-14-fallback attribution.
  - `compute_debt_aging_summary(as_of)` (`0133`, `30s` timeout): staff-gated wrapper applying configurable 4-tier day thresholds (`gracePeriodDays=5`, `yellowDays=15`, `redDays=60`, removing active-payer status masking) and returning `applied_thresholds`.
  - `read_debt_aging_thresholds()` (`0150`): returns day thresholds, `activePayerGraceDays=15`, `amountYellowDzd=20000`, `amountRedDzd=60000`, `severeDebtDzd=40000`, and `levelMessages` (`green|yellow|orange|red`) from `system_settings` (`category='debt'`).
- **Materialized Views**: `mv_dashboard_kpis` (`0049`), `mv_debt_aging` (`0111`), `mv_top_debtors` (`0111`), `mv_revenue_by_month` (`0042`/`0049`), `mv_grade_summary` (`0041` — *legacy; lacks unique index*).

---

## 5. Academics, Curriculum, Promotion, Re-enrollment & Timetable

### Canonical vs. Legacy Academic Tables
- **Canonical**: `academic_years` (`set_current_academic_year` `0059`, `code` backfilled `0114`), `academic_levels` (14 grades: `prescolaire_1..2`, `1ap..5ap`, `1am..4am`, `1ere_annee..3eme_annee`), `classes` (with `filiere_code`, `specialite_code`, `notes` `0149`, FK `homeroom_teacher_id → personnel` `0113`), `subjects` (identity, 14 Algerian national subjects seeded `0114`), `subject_configurations` (`0094` — per-year/level/direction coefficients, `passing_grade`, `is_extracurricular`, `grading_recipe jsonb` with `devoir1/devoir2/examen/cc`), `class_subjects` (FK `teacher_id → personnel` `0113`, `weekly_hours`, `consecutive_periods`, `required_room_type`), `exam_sessions` (`0094`), `assessments` (`0029`/`0041`/`0094`), `attendance_records`, `homework` (`0029` + `0078` parent notification trigger), `student_academic_histories` (`0029`/`0091`/`0107`), `student_narratives` (`0148` — living per-year narrative table), `filieres` (`0107`), `promotion_cycles`/`promotion_cycle_classes` (`0108`), `re_enrollments` (`0128`), `rooms`/`timetable_*` (`0109`).
- **Legacy / Unused**: `grades` (`0004`), `compute_gpa` (`0022`), `mv_grade_summary` (`0041`), `academic_history` (`0004`), `homework_assignments` (`0004`). Do NOT build new features on them.

### Key Academic Rules & RPCs
- **Assessments (`0041`/`0094`)**:
  - Unique canonical key: `uq_assessments_canonical(student_id, subject_id, term, academic_year)`.
  - Triggers: `assessments_set_tenant` (`0057` fails loudly if unresolvable—no demo tenant fallback) and `assessments_compute_subject_average` (`0094`: recipe-weighted average over `devoir1`, `devoir2`, `examen`, `cc`; returns `NULL` if any positive-weight component mark is missing).
  - `fn_calculate_student_term_gpa(student_id, term, academic_year)` (`0029`): ignores extracurricular subjects.
  - `upsert_assessment_from_import` (`0094`).
- **Attendance (`0029`/`0041`/`0043`/`0144`)**:
  - Unique key: `uq_attendance_canonical(tenant_id, student_id, record_date, session)` (`0041`; legacy session-blind index & `record_roll_call` dropped in `0144`).
  - Parent justification workflow (`0043`/`0093`): `justification_note`, `justification_path`, `justification_drive_link`, `justification_status`, `attendance_records_enforce_parent_columns` trigger. *(Known RLS issue: `attendance_select` `0126` still contains `'parent'` and `'student'` tenant-wide.)*
  - `upsert_attendance_from_import` (`0041`).
- **Classification, Placement & Promotion (`0107`/`0108`)**:
  - `fn_track_compatible(...)`: untagged class or untagged student passes; differing stream conflicts only if applicable at target grade.
  - `fn_finalize_class_placements(...)` (`0107`): atomic year placement—creates classes (mapping `clientDraftId`), updates existing classes, validates grade & `fn_track_compatible`, assigns students & stamps `filiere_code`/`specialite_code`.
  - `execute_batch_promotion(decisions, actor_id, actor_name, tenant_id)` (`0107`): atomic archive to `student_academic_histories` + advances `grade_level_code`/clears `class_id` or marks `graduated`.
  - Promotion cycle workflow (`0108`): `fn_create_promotion_cycle`, `fn_get_promotion_cycles`, `fn_get_promotion_cycle_classes`, `fn_confirm_promotion_cycle_class` (requires all active students decided, enforces `[NOTES_INCOMPLETES]` two-phase ack, delegates to `execute_batch_promotion`), `fn_reopen_promotion_cycle_class`, `fn_complete_promotion_cycle`, `fn_cancel_promotion_cycle`.
- **Re-enrollment (`0128`)**:
  - `re_enrollments`: one row per `(tenant_id, student_id, target_academic_year_id)`.
  - RPCs: `fn_generate_re_enrollment_candidates`, `fn_get_re_enrollment_candidates`, `fn_set_re_enrollment_decision`, `fn_re_enroll_student` (updates existing `students` placement + writes target-year billing stamped `academic_year_id` via `0129` year-scoped index), `fn_freeze_re_enrollments`.
- **Timetable (`0109`/`0110`/`0114`)**:
  - `timetable_configurations` (seeded Algerian Sun–Thu 6 periods), `timetable_constraints` (11 kinds, hard/soft), `timetable_versions` (partial unique `one_published` per year), `timetable_entries` (partial unique `teacher_slot_uidx` + `room_slot_uidx` preventing double-booking; `timetable_entries_immutable` blocks edits on `published`/`archived`).
  - `fn_timetable_publish(version_id, actor_id, actor_name)` (`0109`), `v_timetable_published` view (`0114`, `authenticated`-readable published schedule with denormalized names).

---

## 6. Expenses, Personnel/Workforce & Operations

### Expenses (`0008`, `0056`, `0153`, `0155`)
- Tables: `expense_categories` (9 codes), `expense_tickets` (`payee` `0056`, `responsible_profile_id` `0153`), `expense_state_transitions`, `expense_attachments` (`0153`, multi-image metadata backed by `expense-receipts` bucket).
- **Trigger `enforce_expense_workflow_rules()` (`0155`)**:
  - Initial status: `draft | pending_approval`.
  - Transitions: `draft → pending_approval → approved_funds_released | rejected`; `approved_funds_released → disbursed | settled_and_closed`; `disbursed → settled_and_closed`.
  - Authenticated non-service callers moving to `approved_funds_released | rejected | disbursed` must hold `super_admin | financial_officer | manager`.
  - Entering `approved_funds_released` requires `approved_by ≠ submitted_by` AND (`approved_by = current_user_profile_id()` for non-service callers).
  - Settlement requires `receipt_path` & `final_spent_amount`; rejection requires `rejected_reason`.
- **RPCs (`0155`)**: `approve_expense` & `settle_expense` (enforce caller role + `current_user_profile_id()` actor binding; revoked from `anon, public`).

### Personnel, HR & Workforce (`0009`, `0010`, `0072`, `0074`, `0095`, `0097`, `0104`, `0140`–`0142`, `0145`, `0147`)
- `personnel` (`vw_personnel_directory` vs salary-restricted `vw_personnel_directory_restricted`; `personnel_active_account_uq` on `user_id`), `departments`, `shifts`, `schedules`, `performance_reviews`, `workforce_attendance_events` (`0147` insert policy: staff or own linked personnel), `onboarding_states` (`0142` supports `personnel_id IS NULL` tenant singleton).
- **`releve_entries` (`0009`/`0140`/`0141`)**:
  - `activity_type` allows both `'surveillance'` & `'supervision'` (`0140`).
  - `entry_source`: `'manual'` (self-entry forbidden by `prevent_self_releve_entry`, staff-only insert) vs `'auto'` (`auto_kind IN ('grade_entry','homework_push','roll_call')`, written ONLY via `record_auto_releve_entry()` RPC `0141`).
- **`staff_absences`, `salary_adjustments` (append-only trigger), `salary_payments` (`0095`)**:
  - `staff_absences`: justification loop `none → requested → submitted → accepted|rejected` enforced by `enforce_staff_absence_justification_flow`.
  - RPCs (`0095`): `adjust_personnel_salary` & `record_salary_disbursement` (`super_admin | financial_officer`, tenant-guarded).
- **`tasks` (`0010`/`0074`/`0095`/`0145`)**: statuses include `'needs_review'`; `tasks_delete` allows `super_admin | manager | created_by` (`0145`).
- **`leave_requests` (`0010`/`0072`/`0095`/`0104`)**: widened `leave_type` (`annual..paternity` + `leave|absence|overtime|shift_swap|remote|spending_reimbursement`) & `status` (+ `'clarification_requested'`); `financial_officer` added to select/update (`0104`); `respond_leave_clarification()` RPC (`0104`).

### Operations (`0011`, `0073`, `0084`, `0139`)
- `suppliers` (`category`, `rating numeric(3,1)` 0..5), `purchase_requests` (`requested_by_name`, `approved_by_name`), `deliveries` (`driver_name`, `new_eta`), `inventory_items` (`quantity_reserved <= quantity_on_hand`), `inventory_transactions` (`quantity_before/after`, `performed_by_name`), `pending_receipts`, `pending_dispatches` (status widened with `'preparing'` `0139`).

---

## 7. Chat, Notifications, Workflows, AI, Sync, Storage & Maintenance

### Chat (`0010`, `0048`, `0051`, `0061`, `0067`, `0105`, `0116`, `0135`, `0136`, `0156`)
- **`chat_channels.scope`** (`'internal' | 'portal'`): forced by `chat_channels_derive_scope` trigger (`0135`) using `profile_has_staff_role_in_tenant()`—`internal` iff ALL members hold one of the 9 employee roles; any non-staff member forces `portal`.
- **Channel/Message Rules**:
  - `create_direct_channel(other_profile_id, name?)` (`0105`): 9 staff roles.
  - `open_parent_admin_channel(name?)` (`0116`): `parent` or `student` only → 1:1 DM with oldest active `super_admin` (fallback `support_staff`).
  - `chat_channels_insert`: creator ∈ `member_ids`; `announcement` restricted to `super_admin | manager | support_staff`; non-staff creators can only add staff (`0067` + `0135` 9-role definition).
  - `chat_messages_insert` (`0156`): author ∈ `member_ids`; 9 staff roles post in any member channel; `parent`/`student` post ONLY in `'direct'` channels with ≥1 staff member.
  - Triggers: `touch_chat_channel_on_message` (`0061`), `notify_chat_members_on_message` (`0075`), `enforce_chat_read_by_append_only` (`0051`).

### Notifications & FCM (`0013`, `0043`, `0050`, `0060`, `0075`–`0078`, `0147`, `send-push-notification`)
- `notifications_select` (`0076`) & `notifications_insert` (`0147`): recipient/role-scoped reads; staff/self/own-role inserts *(note: direct cross-target inserts with `RETURNING` fail `notifications_select`, use `notify_parent_user` `0077`)*.
- `notify_parent_user(...)` (`0077`): resolves `parents.auth_user_id → active user_profiles.id`; returns `NULL` if unactivated.
- `notify_parents_on_homework` trigger (`0078`): fans out homework inserts to distinct active parent accounts of the class.
- `device_tokens` & `notification_preferences` (`0043`): `register_fcm_token` (`0060`, rejects hijacking active tokens of other users, audits transfers), `deactivate_fcm_tokens` (`0050`), `unregister_fcm_token` (`0060`).
- Realtime publication members (`0085`/`0095`/`0106`): `audit_logs`, `staff_absences`, `salary_payments`, `chat_channels`, `chat_messages`, `leave_requests`.

### Workflows & AI (`0012`, `0071`, `0081`, `0082`, `0088`, `ai-proxy`, `workflow-execute`, `workflow-resume-scheduler`)
- `workflows` (`version` bumped on publish via `workflows_version_on_publish`, validated by `workflows_publish_gate` & `workflows_publish_gate_insert` via `validate_workflow_dag` `0088`), `workflow_runs`, `workflow_audit_links`, `workflow_pending_resumes` (`0081` service-role-only delay parking).
- `workflow-execute`: runs pure `engine.ts` (topological Kahn walk, `source_handle` branching, `wait_duration > 10s` parking, `dry_run` mode) + `actions.ts` (`send_email` via Resend, `push_notification` via `notify_parent_user` or `send-push-notification`, `log_audit`, `dispatch_task`, `restrict_account`, `send_whatsapp` link prep, `extract_field`; financial/SQL actions honestly skipped) + `buildExecutionContext` (`compute_parent_summary`, `attendance_records`, `payments`, `installments`).
- `ai_provider_configs` & `ai_request_logs` (`0012`), `ai-proxy` EF (`use_ai` perm, rate limit, Groq `openai/gpt-oss-120b` / OpenRouter fallback). *(See §5B #6 for `copilot` CHECK constraint bug & `corsHeaders` bug.)*

### Sync, Backup, Settings, Purge, Layouts & ER-PMAE
- **Sync (`0027`, `0037`, `0058`, `0107`, `0127`–`0129`, `0143`)**:
  - `sync_queue` (tenant-scoped RLS).
  - Push RPCs: `upsert_parent_from_import`, `upsert_student_from_import`, `upsert_payment_from_import`, `upsert_ledger_entry_from_import`, `upsert_installment_from_import`, `mark_sync_queue_processed`.
  - Pull RPCs (`0143` composite `(updated_at, id)` keyset with `p_after_id`): `pull_parents_for_sync`, `pull_students_for_sync`, `pull_payments_for_sync`, `pull_ledger_entries_for_sync`, plus `pull_device_tokens_for_sync` (`0027`).
- **Backup (`0013`, `0119`)**: `backup_archives` stores metadata + SHA-256 only (ciphertext lives client-side in IndexedDB); `purge_expired_backups(tenant_id)` marks expired rows `'purged'`.
- **Settings (`0024`, `0125`, `0138`, `0150`)**: `system_settings` (categories: `connection`, `ai`, `email`, `push`, `storage`, `backup`, `system`, `feature_flags`, `debt`), `upsert_setting()`, `upsert_secret_setting()`.
- **Dashboard Layouts (`0134`)**: `dashboard_layouts` + `save_dashboard_layout(view_key, layout)` (user-scoped).
- **Domain Purge (`0121`)**: `purge_student_parent_domain(confirm_phrase='PURGER', dry_run=true, tenant_id?)` (`super_admin` or DB superuser only; clears CRM/finance/academic-student/portal-user rows while preserving staff accounts, backup archives, audit logs, academic catalog, workforce/operations). *(See §5B #3 for `v_auth_ids` vs `v_profile_ids` bug.)*
- **Experimental ER-PMAE (`0130`–`0132`)**: `er_source_observations`, `er_match_proposals`, `er_identity_edges`, `er_aggregation_events`; RPCs `fn_er_decide_proposal`, `fn_er_merge_parents`, `fn_er_unmerge_parents`, `fn_er_has_aggregation_state` (tenant-guarded via `fn_er_resolve_tenant` `0132`).

### Private Storage Buckets (Signed URLs only)
`payment-proofs`, `expense-receipts`, `student-documents`, `homework-attachments`, `task-attachments`, `chat-attachments` (member-scoped `0136`), `tenant-assets`, `ai-reports`, `import-reports`, `attendance-justifications` (`0092`). Path convention: `<tenant_id>/<entity_id>/<filename>`.

### Edge Functions Inventory (`supabase/functions/`)
- **Admin/User-JWT**: `ai-proxy`, `approve-signup-request` (`support_staff`+; calls `approve_student_application` or `approve_account_request`; Resend email), `bind-activation-code` (allows `pending` JWT directly; grants `parent` role + activates), `collect-payment` *(see §5B #4 bug)*, `refund-payment` *(see §5B #4)*, `create-user-account` (`super_admin`), `delete-user-account` (`super_admin`; protects `admin@elimtiyaz.dz` + self), `update-server-secret` (`super_admin`; Management API), `workflow-execute` (`execute_workflow`).
- **Cron/Internal (`_shared/cron-auth.ts`: `CRON_SECRET` or `service_role`)**: `expire-pending-approvals`, `purge-expired-backups`, `refresh-materialized-views`, `workflow-resume-scheduler`, `run-overdue-scan` (also manual POST with `view_financials` JWT; *note `config.toml` has `verify_jwt=true` mismatch*), `send-push-notification` (`service_role` only, FCM HTTP v1).

---

## Practical Recommendation for Your Context Export Tool

To prevent future context rot when generating exports for AI:
1. **Exclude `migrations/0001`–`0157` and `bootstrap/` from standard AI context**—instead, run `pg_dump --schema-only --schema=public` (plus `storage` policies / `auth.users` triggers) after migrations into a single generated `docs/schema.snapshot.sql` file, and feed **that snapshot + the Edge Functions + `src/`** to the AI.
2. Keep historical migrations in `supabase/migrations/` for `supabase db push`, but configure your merger tool to ignore `supabase/migrations/` and `supabase/bootstrap/` during feature-development prompts (only reading specific migrations when writing a new migration).
3. Fix or retire the 11 contradictions listed in **Part 1 §5B**—especially `bootstrap/9000`, `config.toml`, `collect-payment/index.ts`, `register_family_batch`, `create_manual_debt`, `purge_student_parent_domain`, and `attendance_select`.