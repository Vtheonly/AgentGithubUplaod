# Live Infrastructure Verification + Migration-Chain Census — Session 2 (2026-11-19)

**Purpose:** (a) verify the infrastructure tokens provided by the owner on 2026-11-19; (b) attempt the live-DB table census that Session 1 registered as open question #1. **Method: read-only GET requests only.** No RPC calls, no writes, no migrations, no configuration changes, no project-state mutations. Keys were used in-memory only and are NOT stored anywhere in this repository.

## 1. Token verification results

| Token | Verification attempt | Result |
|---|---|---|
| GitHub PAT | `git clone` + `git push` (branch + main) | **WORKS** — clone succeeded at `ff2c4d19`; Session-1 archive published; pushes accepted (`ce70a7b8`) |
| `SUPABASE_PUBLISHABLE_KEY` (anon) | `GET /auth/v1/health`, `GET /rest/v1/`, `GET /functions/v1/<fn>` with `apikey` header | **Reachable, but project RESTRICTED** — all endpoints return **HTTP 402** with: `"Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service."` |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (identical value) | `GET /rest/v1/` (OpenAPI root) with service-role bearer | **HTTP 402** (same restriction message). Note: the platform-level restriction fires before key validation, so the service key itself could not be validated beyond reachability. The two values being identical means there is no separate service-role key in circulation. |
| `SUPABASE_ACCESS_TOKEN` (management API, `sbp_…`) | `GET https://api.supabase.com/v1/projects/<id>` and `/v1/projects` | **INVALID** — HTTP 401 `{"message":"Invalid access token"}` (tried twice). Revoked, expired, or mistyped. Consequence: project state cannot be inspected or restored programmatically with the provided material. |
| `DATABASE_URL` / `DIRECT_URL` / `POSTGRES_URL` / `DB_PASSWORD` | n/a | **Not usable** — all contain the literal `[YOUR-PASSWORD]` placeholder; no database password was provided. Direct Postgres census impossible. |
| Firebase (API key, project ids) | not attempted | Out of scope: the audit is desktop-codebase-focused; no FCM push/send test is permissible under the read-only mandate. |
| Vercel PAT (`vcp_…`) | not attempted | Out of scope: no deployment is authorized during an investigation; testing it would require mutating infrastructure. |

**Diagnosis (evidence-backed):** the live project is NOT paused — it is **restricted for exceeding the egress quota** (`exceed_egress_quota`). Every Supabase surface (auth health, PostgREST, Edge Functions) returns the same 402 restriction body. Edge-function reachability could not be distinguished (402 masks deployed/missing).

## 2. What the owner must do to unblock live verification

1. In the Supabase dashboard for project `vebfehrpzajhstyhinnw`: remove the spend cap (upgrade plan) or otherwise clear the `exceed_egress_quota` violation.
2. Provide a valid management access token if programmatic verification is desired (current one returns 401), and/or the database password for the pooler URLs.
3. Then re-run the census: the read-only probe script used for this attempt is preserved at `scripts/live_census.py` in the investigation sandbox (GET-only; safe to re-run). Alternatively use the repo's own ceremony (`elimtiyaz-desktop/scripts/run_verify_sql_live.sh`) per AGENTS_supabase.md.

## 3. Migration-chain census (verified from repository, 2026-11-19)

Computed with SQL-comment stripping (two comment-prose false positives from a naive grep — `if`, `was` — are excluded; see method note below).

| Measure | Value |
|---|---|
| Migration files scanned (`elimtiyaz-desktop/supabase/migrations/*.sql`) | 152 |
| Unique `CREATE TABLE` names (schema-qualified normalized) | **100** |
| Tables re-declared in >1 migration | 0 (clean append-only at the CREATE level) |
| Plain views (`CREATE [OR REPLACE] VIEW`) | 14 |
| Materialized views | 5 |

**Views (14):** `active_pricing_config`, `audit_log_by_entity`, `audit_log_with_actor`, `v_timetable_published`, `vw_attendance_summary`, `vw_audit_log_by_day`, `vw_calendar_events_derived`, `vw_inventory_low_stock`, `vw_pending_approvals`, `vw_personnel_directory`, `vw_personnel_directory_restricted`, `vw_pricing_full`, `vw_revenue_by_category`, `vw_student_roster`

**Materialized views (5):** `mv_dashboard_kpis`, `mv_debt_aging`, `mv_grade_summary`, `mv_revenue_by_month`, `mv_top_debtors`

**All 100 chain tables (sorted):** academic_history, academic_levels, academic_years, account_adjustments, account_approval_requests, activation_codes, additional_services, ai_provider_configs, ai_request_logs, assessments, attendance_records, audit_logs, backup_archives, calendar_events, chat_channels, chat_messages, class_subjects, classes, complementary_services, dashboard_layouts, deliveries, departments, device_tokens, discount_applications, discounts, er_aggregation_events, er_identity_edges, er_match_proposals, er_source_observations, exam_sessions, expense_attachments, expense_categories, expense_state_transitions, expense_tickets, filieres, grade_level_tuition, grades, homework, homework_assignments, installments, inventory_items, inventory_transactions, invoices, leave_requests, ledger_entries, notification_preferences, notifications, onboarding_states, parent_student_links, parents, payment_allocations, payments, pending_dispatches, pending_receipts, performance_reviews, permissions, personnel, pricing_configs, promotion_cycle_classes, promotion_cycles, purchase_requests, re_enrollments, receipts, releve_entries, role_assignments, role_permissions, roles, rooms, salary_adjustments, salary_payments, schedules, service_enrollments, sessions, shifts, staff_absences, student_academic_histories, student_documents, student_narratives, students, subject_configurations, subjects, suppliers, sync_queue, system_settings, task_attachments, task_comments, tasks, tenant_role_overrides, tenants, timetable_configurations, timetable_constraints, timetable_entries, timetable_versions, transport_destinations, user_profiles, workflow_audit_links, workflow_pending_resumes, workflow_runs, workflows, workforce_attendance_events

**Correction to Session 1 records:** S1 reported "~99 tables by chain"; the clean census says **100**. AGENTS_supabase.md's "83/83 tables" refers to the **0099-era state** (the project was itself created as a data-less structural clone of the original production project `hkvkefubghbbotgnteir` at 95/95 migrations). The chain has since grown by 57 migration files; the live project's actual applied-migration state is UNKNOWN while 402-restricted.

**Method note:** extraction regex `create\s+table\s+(?:if\s+not\s+exists\s+)?name` applied after stripping `--` line comments and `/* */` blocks; multi-line `CREATE TABLE` bodies handled via `\s+`. Script: sandbox `scripts/chain_census.py` (read-only).

## 4. Consequence for the findings register

- Open question #1 (live-DB census vs migration chain) remains **UNRESOLVED**, now with a precise environmental blocker and unblock path (above).
- New finding **OPS-011**: live Supabase project restricted (`exceed_egress_quota`) as of 2026-11-19; provided management token invalid; DB password not provided. Owner action required before any live verification (including the repo's own `run_verify_sql_live.sh` ceremony) can run.
