# Database Schema Reference

This document describes the complete database schema for the El-Imtiyaz platform — all 50+ tables, RLS policies, triggers, functions, views, and indexes.

## Schema Overview

The database is **multi-tenant**: every tenant-scoped table has a `tenant_id` column referencing `tenants(id)`. RLS policies filter rows by the caller's tenant. The schema supports ~5,000 total users / 300 daily active users / 50 peak concurrent users.

### Naming conventions

- **Tables:** snake_case plural (e.g., `parents`, `students`, `payments`)
- **Columns:** snake_case (e.g., `first_name`, `created_at`)
- **Indexes:** `ix_<table>_<columns>` for B-tree, `<table>_trgm_idx` for GIN trigram
- **Functions:** `verb_noun` (e.g., `collect_payment`, `compute_gpa`)
- **Triggers:** `<table>_<action>` (e.g., `parents_touch_updated_at`)
- **Materialized views:** `mv_<name>`
- **Regular views:** `vw_<name>`

---

## Tables by Domain

### 1. Multi-Tenant Foundation (migrations 0001–0003)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `tenants` | Top-level isolation boundary | id, slug, name, legal_name, default_locale, default_currency, timezone |
| `user_profiles` | Application profile (1:1 with auth.users) | auth_user_id, tenant_id, email, status (pending/active/suspended/deleted) |
| `account_approval_requests` | Web registration queue | auth_user_id, requested_role, activation_code, status (pending/approved/rejected/expired) |
| `sessions` | Active session telemetry | user_profile_id, supabase_session_id, expires_at, revoked_at |
| `roles` | 11 role definitions | code (super_admin, financial_officer, etc.), is_staff_role, is_web_role |
| `permissions` | 56 atomic permissions | code, domain (crm/academic/financial/etc.) |
| `role_permissions` | Default role→permission matrix | role_id, permission_id |
| `tenant_role_overrides` | Per-tenant permission overrides | tenant_id, role_id, permission_id, action (grant/deny) |
| `role_assignments` | Effective user roles | user_profile_id, tenant_id, role_id, revoked_at |

### 2. Academic Structure (migration 0004)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `academic_years` | School years (e.g., 2026-2027) | label, start_date, end_date, term_structure, is_current |
| `academic_levels` | 14 grade levels (prescolaire → lycée) | cycle (prescolaire/primaire/cem/lycee), year_number, grade_code |
| `classes` | Concrete class sections | academic_level_id, section, code, capacity, homeroom_teacher_id |
| `subjects` | Catalog of teachable subjects | code, name_fr, domain (scolarite/club/therapy/auxiliary), default_coefficient |
| `class_subjects` | M:N class↔subject with per-class coefficient | class_id, subject_id, teacher_id, coefficient |
| `assessments` | Devoir 1, Devoir 2, Examen per term | class_subject_id, term, kind, max_score, weight |
| `grades` | Student scores (0–20) | student_id, assessment_id, score, subject_average (computed) |
| `attendance_records` | 4-status roll call | student_id, class_id, date, status (present/absent_excused/absent_unexcused/late) |
| `homework_assignments` | Teacher assignments (immutable after due date) | class_subject_id, target_class_id, title, due_date, is_locked (generated) |
| `academic_history` | Archived yearly records (append-only) | student_id, academic_year_id, gpa, decision |

### 3. CRM (migration 0005)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `parents` | Master billing entity | parent_code, first_name, last_name, primary_phone, email, auth_user_id (bound on activation) |
| `students` | Enrolled children | parent_id (NOT NULL FK), student_code, date_of_birth, grade_level_id, class_id |
| `parent_student_links` | Optional junction for multi-guardian | parent_id, student_id, is_primary |
| `activation_codes` | 6-7 digit single-use binding codes | code, parent_id, bound_to_auth_user_id, expires_at |
| `student_documents` | Birth certificates, medical, contracts | student_id, kind, storage_path |

### 4. Pricing (migration 0006)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `pricing_configs` | Top-level config per tenant per year | registration_fee, late_penalty_per_day, early_payment_bonus_pct |
| `grade_level_tuition` | 14 grade-level tuitions with 3-tranche schedule | academic_level_id, annual_amount, tranche_1/2/3_amount |
| `transport_destinations` | 4 transport zones | code, annual_amount, tranche_1/2/3_amount |
| `complementary_services` | Psychology, speech therapy | code, semester_amount, annual_amount, billing_model |
| `additional_services` | Canteen, second apron | code, amount, billing_model |
| `discounts` | 5 canonical discount codes | code (passage_palier, seniority_5y, etc.), discount_type, amount |
| `discount_applications` | Per-student applied discounts | student_id, discount_id, amount_applied |

### 5. Financial (migration 0007)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `service_enrollments` | What each student is billed for | student_id, service_kind, annual_amount, tranche_1/2/3_amount |
| `invoices` | System-issued invoices | parent_id, student_id, invoice_number, amount, status |
| `installments` | Tranche-level billing (3 per enrollment) | parent_id, tranche_number, amount_due, amount_paid, due_date, status (auto-computed) |
| `payments` | Money received (cash/check/transfer) | parent_id, amount, method, status (paid/pending/unpaid/refunded) |
| `account_adjustments` | Replaces Scholarships | parent_id, amount, reason_code, admin_note (mandatory) |
| `receipts` | Auto-generated PDFs | payment_id, parent_id, receipt_number, pdf_path |
| `ledger_entries` | IMMUTABLE accounting (canonical) | parent_id, account_id, entry_type, amount (signed: +charge/-payment) |

### 6. Expenses (migration 0008)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `expense_categories` | Controlled category list | code (maintenance/office_supplies/etc.), label_fr |
| `expense_tickets` | Two-tier workflow tickets | title, requested_amount, status, submitted_by, approved_by, receipt_path |
| `expense_state_transitions` | Audit log of status changes | ticket_id, from_status, to_status, actor_id |

### 7. HR (migration 0009)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `personnel` | Staff master records | personnel_code, staff_category, role_id, department_id, base_salary (RLS-restricted) |
| `releve_entries` | Append-only teacher activity ledger | personnel_id, activity_type, clock_in_at, clock_out_at, duration_minutes (generated) |

### 8. Workforce (migration 0010)

| Table | Purpose |
|-------|---------|
| `departments` | Organizational units (Administration, Teaching, Support, Medical) |
| `shifts` | Reusable work-time templates |
| `schedules` | Daily shift assignments |
| `tasks` | Multi-assignee task management |
| `task_comments` | Discussion threads on tasks |
| `task_attachments` | Files attached to tasks |
| `workforce_attendance_events` | Clock-in/out events |
| `leave_requests` | Leave workflow (pending/approved/rejected) |
| `performance_reviews` | Quarterly/annual reviews |
| `chat_channels` | Direct/group/department/announcement channels |
| `chat_messages` | Messages with read receipts + attachments |
| `onboarding_states` | Onboarding wizard progress |

### 9. Operations (migration 0011)

| Table | Purpose |
|-------|---------|
| `suppliers` | Master vendor records |
| `purchase_requests` | Two-tier procurement workflow |
| `deliveries` | Multi-stop delivery tracking |
| `inventory_items` | SKUs with reorder thresholds |
| `inventory_transactions` | Append-only stock movement ledger |
| `pending_receipts` | Inbound goods awaiting verification |
| `pending_dispatches` | Outbound goods awaiting pickup |

### 10. Workflow + AI (migration 0012)

| Table | Purpose |
|-------|---------|
| `workflows` | DAG-based automation definitions |
| `workflow_runs` | Execution history with per-node status |
| `workflow_audit_links` | M:N link to audit_logs |
| `ai_provider_configs` | Encrypted API keys for Groq/OpenRouter |
| `ai_request_logs` | Per-call telemetry for audit + rate limiting |

### 11. Calendar + Notifications + Backup (migration 0013)

| Table | Purpose |
|-------|---------|
| `calendar_events` | Manual staff-created events (auto-derived events via view) |
| `notifications` | User-facing alerts with priority + source |
| `backup_archives` | Metadata for encrypted backups (ciphertext in IndexedDB) |

### 12. Audit Log (migration 0014)

| Table | Purpose |
|-------|---------|
| `audit_logs` | Append-only event stream (UPDATE/DELETE blocked by trigger) |

### 13. System Settings (migration 0024)

| Table | Purpose |
|-------|---------|
| `system_settings` | Database-backed configuration (39 settings across 8 categories) |

---

## Row-Level Security (RLS)

RLS is **enabled and forced** on every tenant-scoped table. The `service_role` key bypasses RLS (server-side only).

### Helper functions (used in RLS policies)

```sql
public.current_tenant_id()        -- resolves caller's tenant_id from JWT/profile
public.current_user_profile_id()  -- resolves caller's user_profiles.id
public.current_user_roles()       -- array of role codes
public.current_user_permissions() -- array of effective permission codes (after overrides)
public.has_permission(code)       -- boolean predicate
public.has_role(code)             -- boolean predicate
public.has_any_role(text[])       -- boolean predicate
```

### Policy patterns

**Standard tenant isolation:**
```sql
CREATE POLICY <table>_select ON <table>
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND deleted_at IS NULL);
```

**Role-gated write:**
```sql
CREATE POLICY <table>_admin ON <table>
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role('super_admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role('super_admin'));
```

**Parent sees own children only:**
```sql
CREATE POLICY students_parent_sees_own ON students
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND deleted_at IS NULL
    AND public.has_role('parent')
    AND parent_id IN (
      SELECT id FROM parents WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
    )
  );
```

**Append-only (audit_logs, ledger_entries):**
```sql
-- Only SELECT + INSERT policies; no UPDATE/DELETE
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT ...;
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT ...;
-- UPDATE/DELETE blocked by trigger (enforce_audit_log_append_only)
```

### Force RLS

```sql
-- Applied to every non-append-only table (migration 0019)
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
```

This ensures even the table owner is subject to RLS (only `service_role` can bypass).

---

## Triggers

### Universal `updated_at` trigger

```sql
CREATE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Attached to every table with an updated_at column
CREATE TRIGGER <table>_touch_updated_at
  BEFORE UPDATE ON <table>
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

### Auth user creation trigger

```sql
-- Fires AFTER a new auth.users row is inserted
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
```

This function:
1. Creates a `user_profiles` row (status='pending')
2. Creates an `account_approval_requests` row (status='pending')
3. Resolves the tenant from `raw_app_meta_data.tenant_id` (or defaults to first tenant)

### Subject average auto-computation

```sql
CREATE TRIGGER grades_compute_subject_average
  BEFORE INSERT OR UPDATE OF score ON grades
  FOR EACH ROW EXECUTE FUNCTION public.compute_grade_subject_average();
```

Computes `subject_average = (D1 + D2 + 2*Examen) / 4` per plan §13.03.

### Installment status auto-computation

```sql
CREATE TRIGGER installments_update_status
  BEFORE INSERT OR UPDATE OF amount_paid, due_date ON installments
  FOR EACH ROW EXECUTE FUNCTION public.update_installment_status();
```

Sets status to `paid` / `partial` / `unpaid` / `overdue` based on `amount_paid` vs `amount_due` and `due_date`.

### Payment proof enforcement

```sql
CREATE TRIGGER payments_enforce_proof
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_proof();
```

Validates that check/transfer payments have `proof_path`, `check_number`, `transfer_reference`, etc.

### Expense workflow enforcement

```sql
CREATE TRIGGER expense_tickets_enforce_workflow
  BEFORE INSERT OR UPDATE OF status, approved_by, receipt_path ON expense_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expense_workflow_rules();
```

Enforces:
- No self-approval (approved_by ≠ submitted_by)
- Receipt required before settlement
- Rejection reason required

### Releve self-entry prevention

```sql
CREATE TRIGGER releve_entries_prevent_self
  BEFORE INSERT OR UPDATE ON releve_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_releve_entry();
```

Per plan §09.05: teachers cannot record their own Releve entries.

### Audit log append-only enforcement

```sql
CREATE TRIGGER audit_logs_block_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_audit_log_append_only();

CREATE TRIGGER audit_logs_block_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_audit_log_append_only();
```

Both raise an exception — UPDATE and DELETE are forbidden.

---

## PostgreSQL Functions

### Business logic functions (migration 0022)

| Function | Purpose |
|----------|---------|
| `batch_register_family(tenant, parent_json, students_json, actor)` | Atomic parent + N students registration (plan §04.03) |
| `collect_payment(tenant, parent, student, amount, method, ...)` | Atomic payment + ledger + receipt + audit |
| `refund_payment(tenant, payment_id, actor, reason)` | Atomic refund via reversal entry |
| `approve_expense(tenant, ticket_id, approver, note)` | Atomic expense approval (no-self-approval) |
| `settle_expense(tenant, ticket_id, final_amount, receipt_path, actor)` | Atomic expense settlement |
| `record_roll_call(tenant, class, date, records_json, teacher)` | Atomic batch attendance insert |
| `compute_gpa(student_id, term)` | Overall GPA = Σ(avg×coef)/Σ(coef) |
| `promote_students(tenant, year, decisions_json, actor)` | Batch year-end promotion |
| `run_overdue_scan(tenant, as_of_date)` | Scan overdue installments |
| `purge_expired_backups(tenant)` | Mark expired backup archives as 'purged' |
| `search_entities(tenant, query, limit)` | Cross-entity trigram search |
| `get_parent_summary(parent_id)` | Aggregated parent dashboard data |
| `refresh_all_materialized_views()` | Refresh all 5 materialized views concurrently |
| `expire_pending_approvals()` | Auto-expire stale approval requests |

### Helper functions (migration 0002–0003)

| Function | Purpose |
|----------|---------|
| `current_tenant_id()` | Resolve caller's tenant_id |
| `current_user_profile_id()` | Resolve caller's user_profiles.id |
| `current_user_roles()` | Array of role codes |
| `current_user_permissions()` | Array of effective permissions (after overrides) |
| `has_permission(code)` | Boolean predicate |
| `has_role(code)` | Boolean predicate |
| `has_any_role(text[])` | Boolean predicate |
| `write_audit_log(...)` | Canonical audit log writer |
| `touch_updated_at()` | Universal updated_at trigger function |
| `gen_uuid()` | UUID generator wrapper |

### CRM functions (migration 0005)

| Function | Purpose |
|----------|---------|
| `generate_activation_code(tenant_id)` | Generate 7-digit unique code |
| `bind_activation_code(tenant, code, auth_user_id)` | Bind code to parent profile (single-use) |
| `approve_account_request(request_id, reviewer, target_parent, target_student, note)` | Approve + assign role + bind to profile |
| `reject_account_request(request_id, reviewer, reason)` | Reject + suspend user |

### Financial functions (migration 0007)

| Function | Purpose |
|----------|---------|
| `compute_account_balance(account_id)` | Replay ledger for one account |
| `compute_parent_balance(parent_id)` | Per-account breakdown |
| `compute_parent_outstanding(parent_id)` | Total outstanding (signed) |
| `compute_overdue_amount(parent_id, as_of)` | Overdue charges with no matching payment |

### System settings functions (migration 0024)

| Function | Purpose |
|----------|---------|
| `get_setting(tenant_id, key)` | Read setting value (jsonb) |
| `get_setting_text(tenant_id, key)` | Read setting as text |
| `get_setting_bool(tenant_id, key, default)` | Read boolean setting with fallback |
| `upsert_setting(tenant, category, key, label, value, type, sensitive, actor)` | Insert/update non-secret setting |
| `upsert_secret_setting(tenant, category, key, label, value_encrypted, actor)` | Insert/update secret setting |

---

## Views

### Materialized views (refreshed daily at 01:00 UTC)

| View | Purpose | Unique Index |
|------|---------|--------------|
| `mv_dashboard_kpis` | Per-tenant KPI snapshot | tenant_id |
| `mv_debt_aging` | Debt bucketed by aging tier | tenant_id, parent_id, aging_bucket |
| `mv_top_debtors` | Top 20 families by outstanding | tenant_id, parent_id |
| `mv_revenue_by_month` | Last 12 months of paid payments | tenant_id, month |
| `mv_grade_summary` | Per-student subject averages | tenant_id, student_id, class_subject_id |

### Regular views

| View | Purpose |
|------|---------|
| `vw_revenue_by_category` | Payments grouped by service category |
| `vw_student_roster` | Joined student+parent+class for export |
| `vw_personnel_directory` | Personnel WITHOUT salary fields |
| `vw_personnel_directory_restricted` | Personnel WITH salary fields (RLS-gated) |
| `vw_audit_log_by_day` | Daily audit event counts per action |
| `vw_calendar_events_derived` | UNION of manual + auto-derived events |
| `vw_attendance_summary` | Per-student attendance counts + rate |
| `vw_inventory_low_stock` | Items below reorder level |
| `vw_pricing_full` | Joined pricing config (all tables) |
| `vw_pending_approvals` | Counts of pending items per tenant |
| `vw_audit_log_with_actor` | Denormalized audit log for fast UI listing |
| `active_pricing_config` | Active pricing config + current academic year |

---

## Indexes

### Performance indexes (migration 0020)

50+ indexes optimized for the platform's access patterns:

**Composite indexes** for common filter+sort:
```sql
CREATE INDEX ix_installments_due ON installments (tenant_id, due_date, status)
  WHERE status IN ('unpaid', 'partial');
```

**Partial indexes** for hot reads:
```sql
CREATE INDEX ix_parents_active ON parents (tenant_id, last_name, first_name)
  WHERE deleted_at IS NULL AND is_active = true;
```

**Covering indexes** (INCLUDE) for index-only scans:
```sql
CREATE INDEX ix_invoices_parent_recent ON invoices (parent_id, issue_date DESC)
  INCLUDE (invoice_number, amount, status);
```

**GIN indexes** on jsonb + trigram:
```sql
CREATE INDEX ix_parents_trgm ON parents USING gin (last_name gin_trgm_ops, first_name gin_trgm_ops);
CREATE INDEX ix_tasks_assignees_gin ON tasks USING gin (assignee_ids jsonb_path_ops);
```

**BRIN indexes** on time-series tables (10-100x smaller than B-tree):
```sql
CREATE INDEX ix_audit_logs_brin ON audit_logs USING brin (occurred_at) WITH (pages_per_range = 64);
CREATE INDEX ix_ledger_entries_brin ON ledger_entries USING brin (entry_date) WITH (pages_per_range = 32);
```

**Expression indexes** for case-insensitive lookups:
```sql
CREATE INDEX ix_parents_lower_email ON parents (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
```

---

## Seed Data (migration 0023 + 0024)

### Default tenant
```sql
id: '00000000-0000-0000-0000-000000000001'
slug: 'elimtiyaz-boumerdes'
name: 'El-Imtiyaz Boumerdès'
legal_name: 'Sarl Elimtiyaz'
country: 'DZ'
default_locale: 'fr'
default_currency: 'DZD'
timezone: 'Africa/Algiers'
```

### 11 roles
`super_admin`, `financial_officer`, `teacher`, `support_staff`, `manager`, `buyer`, `driver`, `warehouse_worker`, `worker`, `parent`, `student`

### 56 permissions
Grouped by domain: crm (9), academic (7), financial (6), expense (3), hr (4), workflow (3), routing (2), settings (4), backup (1), ai (2), operations (3), workforce (5), calendar (2), notification (3), dashboard (2)

### Role-permission matrix
- SuperAdmin: ALL 56 permissions
- FinancialOfficer: financial + expense + audit + dashboard + export + personnel + backup + AI + calendar
- Teacher: view + grades + attendance + homework + releve + AI + calendar + tasks
- SupportStaff: view + create/edit parent + enroll + batch + view financials + collect + view personnel + calendar + tasks + onboarding + notifications
- Manager: dashboard + view roster/personnel + tasks + departments + approve expense + audit + calendar
- Buyer: operations + suppliers + tasks
- Driver: driver mode + routing + tasks
- WarehouseWorker: operations + inventory + tasks
- Worker: tasks only
- Parent: view own children + view own financials
- Student: view own grades + view own attendance

### 14 academic levels
- prescolaire: prescolaire_1 (MS), prescolaire_2 (GS)
- primaire: 1ap, 2ap, 3ap, 4ap, 5ap
- cem: 1am, 2am, 3am, 4am
- lycee: 1ere_annee, 2eme_annee, 3eme_annee

### Default academic year
`2026-2027` (2026-09-01 to 2027-06-30, trimester, is_current=true)

### 9 expense categories
maintenance, office_supplies, educational_material, utilities, transport, it, facilities, medical, other

### 4 departments
ADM (Administration), TCH (Enseignants), SUP (Maintenance & Support), MED (Médical & Thérapie)

### Pricing config (official 2026-2027 fee schedule)
- Registration fee: 5,000 DZD
- Late penalty: 100 DZD/day
- Second apron fee: 2,000 DZD
- Early payment bonus: 5% (before June 30)

**14 grade-level tuitions:**
| Level | Annual | Tranche 1 | Tranche 2 | Tranche 3 |
|-------|--------|-----------|-----------|-----------|
| prescolaire_1/2 | 130,000 | 40,000 | 45,000 | 45,000 |
| 1ap–5ap | 205,000 | 60,000 | 70,000 | 75,000 |
| 1am–4am | 305,000 | 100,000 | 100,000 | 105,000 |
| 1ere_annee | 340,000 | 110,000 | 115,000 | 115,000 |
| 2eme_annee | 355,000 | 115,000 | 120,000 | 120,000 |
| 3eme_annee | 365,000 | 120,000 | 120,000 | 125,000 |

**4 transport destinations:**
| Zone | Annual | Tranches |
|------|--------|----------|
| ville_boumerdes | 40,000 | 15k/15k/10k |
| tidjelabine_sahel_figuier_corso | 43,000 | 16k/16k/11k |
| boudouaou_thenia_zemmouri | 52,000 | 20k/20k/12k |
| autres | 55,000 | 20k/20k/15k |

**5 canonical discounts:**
| Code | Type | Amount | Applies To |
|------|------|--------|------------|
| passage_palier | fixed | 10,000 DZD | tuition |
| seniority_5y | percentage | 5% | tuition |
| full_annual | percentage | 10% | total |
| highest_average | percentage | 10% | tuition |
| sibling_fixed | fixed | 5,000 DZD | per_student |

### 39 system settings
Across 8 categories: connection (3), ai (5), email (3), push (2), storage (10), backup (4), system (7), feature_flags (5)
