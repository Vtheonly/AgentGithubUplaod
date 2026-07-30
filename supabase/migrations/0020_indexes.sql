-- ============================================================================
-- 0020_indexes.sql
-- ============================================================================
-- Performance indexes optimized for ~5,000 total users / ~300 DAU / ~50 peak
-- concurrent users. Adds ONLY indexes not already created in prior migrations.
-- Uses CREATE INDEX IF NOT EXISTS for idempotency.
--
-- Index strategy:
--   1. Composite indexes for common filter+sort patterns (tenant_id + status + time)
--   2. Partial indexes for hot reads (WHERE deleted_at IS NULL)
--   3. Covering indexes (INCLUDE) for index-only scans
--   4. GIN on jsonb columns frequently queried
--   5. BRIN on time-series tables (audit_logs, ledger_entries, payments, etc.)
--   6. Expression indexes (LOWER(email)) for case-insensitive lookups
-- ============================================================================

-- ============================================================================
-- TENANTS / USER_PROFILES / SESSIONS
-- ============================================================================
create index if not exists ix_tenants_slug_active on public.tenants (slug) where is_active = true;
create index if not exists ix_user_profiles_status on public.user_profiles (status, created_at desc);
create index if not exists ix_user_profiles_email_lower on public.user_profiles (lower(email));
create index if not exists ix_sessions_active_tenant on public.sessions (tenant_id, expires_at) where revoked_at is null;
create index if not exists ix_sessions_last_activity on public.sessions (last_activity_at desc) where revoked_at is null;

-- ============================================================================
-- ACCOUNT_APPROVAL_REQUESTS
-- ============================================================================
create index if not exists ix_approval_pending on public.account_approval_requests (tenant_id, requested_at desc) where status = 'pending';
create index if not exists ix_approval_reviewed on public.account_approval_requests (reviewed_by, reviewed_at desc) where reviewed_by is not null;
create index if not exists ix_approval_expires on public.account_approval_requests (expires_at) where status = 'pending';

-- ============================================================================
-- ACADEMIC STRUCTURE
-- ============================================================================
create index if not exists ix_classes_active on public.classes (tenant_id, academic_year_id, is_active) where is_active = true;
create index if not exists ix_class_subjects_active on public.class_subjects (class_id, is_active) where is_active = true;
create index if not exists ix_subjects_active on public.subjects (tenant_id, domain, is_active) where is_active = true;
create index if not exists ix_grades_student_term on public.grades (student_id, class_subject_id);
create index if not exists ix_grades_recent on public.grades (tenant_id, entered_at desc);
create index if not exists ix_attendance_class_date_status on public.attendance_records (class_id, date, status);
create index if not exists ix_homework_due_active on public.homework_assignments (target_class_id, due_date) where due_date >= current_date;

-- ============================================================================
-- CRM
-- ============================================================================
create index if not exists ix_parents_active on public.parents (tenant_id, last_name, first_name) where deleted_at is null and is_active = true;
create index if not exists ix_parents_restricted on public.parents (tenant_id, is_financially_restricted) where is_financially_restricted = true and deleted_at is null;
create index if not exists ix_students_active on public.students (tenant_id, last_name, first_name) where deleted_at is null and is_active = true;
create index if not exists ix_students_by_class on public.students (class_id, last_name) where class_id is not null and deleted_at is null;
create index if not exists ix_students_by_grade on public.students (grade_level_id) where deleted_at is null;
create index if not exists ix_activation_unbound on public.activation_codes (tenant_id, expires_at) where bound_to_auth_user_id is null;

-- ============================================================================
-- PRICING
-- ============================================================================
create index if not exists ix_pricing_configs_active on public.pricing_configs (tenant_id, is_active) where is_active = true;
create index if not exists ix_grade_level_tuition_lookup on public.grade_level_tuition (pricing_config_id, academic_level_id);
create index if not exists ix_transport_destinations_lookup on public.transport_destinations (pricing_config_id, code);
create index if not exists ix_discounts_active on public.discounts (pricing_config_id, is_active) where is_active = true;
create index if not exists ix_discount_apps_student on public.discount_applications (student_id, applied_at desc);

-- ============================================================================
-- FINANCIAL — these tables are read-heavy; add covering indexes
-- ============================================================================
create index if not exists ix_invoices_unpaid on public.invoices (tenant_id, status, due_date) where status in ('unpaid', 'partial', 'overdue');
create index if not exists ix_invoices_parent_recent on public.invoices (parent_id, issue_date desc) include (invoice_number, amount, status);
create index if not exists ix_installments_due on public.installments (tenant_id, due_date, status) where status in ('unpaid', 'partial');
create index if not exists ix_installments_overdue_partial on public.installments (tenant_id, due_date) where status = 'overdue';
create index if not exists ix_installments_parent_due on public.installments (parent_id, due_date) include (amount_due, amount_paid, status);
create index if not exists ix_payments_recent on public.payments (tenant_id, collected_at desc) include (payment_number, parent_id, amount, method, status);
create index if not exists ix_payments_by_method on public.payments (tenant_id, method, collected_at desc);
create index if not exists ix_payments_pending on public.payments (tenant_id, status, collected_at) where status = 'pending';

-- BRIN indexes for time-series scans (much smaller than B-tree for sequential data)
create index if not exists ix_ledger_entries_brin_entry_date on public.ledger_entries using brin (entry_date) with (pages_per_range = 32);
create index if not exists ix_payments_brin_collected on public.payments using brin (collected_at) with (pages_per_range = 32);

-- ============================================================================
-- EXPENSES
-- ============================================================================
create index if not exists ix_expense_tickets_pending on public.expense_tickets (tenant_id, submitted_at desc) where status = 'pending_approval';
create index if not exists ix_expense_tickets_by_submitter on public.expense_tickets (submitted_by, submitted_at desc) include (ticket_number, title, status, requested_amount);
create index if not exists ix_expense_tickets_by_approver on public.expense_tickets (approved_by, approved_at desc) where approved_by is not null;
create index if not exists ix_expense_tickets_anomaly on public.expense_tickets (tenant_id, anomaly_score desc) where anomaly_score is not null and anomaly_score >= 0.7;
create index if not exists ix_expense_state_transitions_ticket on public.expense_state_transitions (ticket_id, transitioned_at desc);

-- ============================================================================
-- ATTENDANCE / HR
-- ============================================================================
create index if not exists ix_personnel_active_by_dept on public.personnel (department_id, last_name) where deleted_at is null and is_active = true;
create index if not exists ix_personnel_active_by_role on public.personnel (role_id, last_name) where deleted_at is null and is_active = true;
create index if not exists ix_releve_entries_recent on public.releve_entries (tenant_id, clock_in_at desc) include (personnel_id, activity_type, duration_minutes);
create index if not exists ix_releve_entries_by_personnel on public.releve_entries (personnel_id, clock_in_at desc);
create index if not exists ix_releve_entries_brin_clock on public.releve_entries using brin (clock_in_at) with (pages_per_range = 32);

-- ============================================================================
-- WORKFORCE
-- ============================================================================
create index if not exists ix_tasks_active on public.tasks (tenant_id, status, due_date) where status not in ('completed', 'cancelled');
create index if not exists ix_tasks_by_priority on public.tasks (tenant_id, priority, due_date) where status not in ('completed', 'cancelled');
create index if not exists ix_schedules_by_date on public.schedules (tenant_id, date, personnel_id);
create index if not exists ix_workforce_att_brin on public.workforce_attendance_events using brin (event_at) with (pages_per_range = 32);
create index if not exists ix_leave_requests_pending on public.leave_requests (tenant_id, start_date) where status = 'pending';
create index if not exists ix_chat_messages_channel_recent on public.chat_messages (channel_id, sent_at desc) include (author_id, body) where deleted_at is null;
create index if not exists ix_chat_messages_brin on public.chat_messages using brin (sent_at) with (pages_per_range = 32);
create index if not exists ix_chat_channels_by_member on public.chat_channels using gin (member_ids);
create index if not exists ix_onboarding_pending on public.onboarding_states (tenant_id, started_at) where completed_at is null;

-- ============================================================================
-- OPERATIONS
-- ============================================================================
create index if not exists ix_suppliers_active on public.suppliers (tenant_id, name) where deleted_at is null and is_active = true;
create index if not exists ix_purchase_requests_submitted on public.purchase_requests (tenant_id, status, created_at desc) where status = 'submitted';
create index if not exists ix_deliveries_scheduled on public.deliveries (tenant_id, scheduled_at) where status in ('assigned', 'in_transit');
create index if not exists ix_inventory_low_stock on public.inventory_items (tenant_id) where deleted_at is null and quantity_on_hand <= reorder_level and is_active = true;
create index if not exists ix_inventory_transactions_brin on public.inventory_transactions using brin (transaction_at) with (pages_per_range = 32);
create index if not exists ix_pending_receipts_pending on public.pending_receipts (tenant_id, expected_at) where status = 'pending';
create index if not exists ix_pending_dispatches_pending on public.pending_dispatches (tenant_id, scheduled_at) where status = 'pending';

-- ============================================================================
-- WORKFLOW + AI
-- ============================================================================
create index if not exists ix_workflows_published on public.workflows (tenant_id, status) where status = 'published';
create index if not exists ix_workflow_runs_recent on public.workflow_runs (tenant_id, triggered_at desc) include (workflow_id, status, duration_ms);
create index if not exists ix_workflow_runs_failed on public.workflow_runs (tenant_id, triggered_at desc) where status in ('failed', 'timeout');
create index if not exists ix_ai_provider_configs_active on public.ai_provider_configs (tenant_id, is_active) where is_active = true;
create index if not exists ix_ai_request_logs_brin on public.ai_request_logs using brin (requested_at) with (pages_per_range = 32);
create index if not exists ix_ai_request_logs_rate_window on public.ai_request_logs (tenant_id, requested_at) where requested_at > now() - interval '1 minute';

-- ============================================================================
-- CALENDAR / NOTIFICATIONS / BACKUP
-- ============================================================================
create index if not exists ix_calendar_events_upcoming on public.calendar_events (tenant_id, start_at) where is_deleted = false and start_at >= now();
create index if not exists ix_notifications_unread_priority on public.notifications (tenant_id, priority, triggered_at desc) where is_read = false and dismissed_at is null;
create index if not exists ix_notifications_target_user_unread on public.notifications (target_user_id, triggered_at desc) where is_read = false and dismissed_at is null and target_user_id is not null;
create index if not exists ix_backup_archives_purge_due on public.backup_archives (tenant_id, purge_at) where purge_at is not null and status <> 'purged';
create index if not exists ix_backup_archives_retention_expired on public.backup_archives (tenant_id, retention_expires_at) where retention_expires_at is not null and status <> 'purged';

-- ============================================================================
-- AUDIT LOGS
-- ============================================================================
-- BRIN for sequential time-series scans (audit log is append-only by date)
create index if not exists ix_audit_logs_brin_occurred on public.audit_logs using brin (occurred_at) with (pages_per_range = 64);
create index if not exists ix_audit_logs_tenant_action_recent on public.audit_logs (tenant_id, action, occurred_at desc);
create index if not exists ix_audit_logs_entity_lookup on public.audit_logs (entity_type, entity_id, occurred_at desc);

-- ============================================================================
-- EXPRESSION INDEXES for case-insensitive lookups
-- ============================================================================
create index if not exists ix_parents_lower_email on public.parents (lower(email)) where email is not null and deleted_at is null;
create index if not exists ix_parents_lower_last_name on public.parents (lower(last_name)) where deleted_at is null;
create index if not exists ix_students_lower_last_name on public.students (lower(last_name)) where deleted_at is null;
create index if not exists ix_personnel_lower_last_name on public.personnel (lower(last_name)) where deleted_at is null;
create index if not exists ix_suppliers_lower_name on public.suppliers (lower(name)) where deleted_at is null;
create index if not exists ix_user_profiles_lower_email on public.user_profiles (lower(email));

-- ============================================================================
-- COVERING INDEXES for high-frequency dashboard queries
-- ============================================================================
-- Dashboard KPIs often query: count(active students) + sum(outstanding debt)
-- These covering indexes allow index-only scans.
create index if not exists ix_students_active_covering on public.students (tenant_id) include (id, parent_id, grade_level_id, class_id) where deleted_at is null and is_active = true;
create index if not exists ix_parents_active_covering on public.parents (tenant_id) include (id, first_name, last_name, primary_phone, is_financially_restricted) where deleted_at is null and is_active = true;

-- ============================================================================
-- COMMENTS on key indexes (explain query pattern they optimize)
-- ============================================================================
comment on index public.ix_installments_overdue_partial is 'Optimizes overdue alert scan (plan §07.06): WHERE status = overdue AND due_date < now()';
comment on index public.ix_payments_pending is 'Optimizes pending-payment reconciliation queue: WHERE status = pending';
comment on index public.ix_expense_tickets_anomaly is 'Optimizes AI anomaly review: WHERE anomaly_score >= 0.7 (high-confidence signals)';
comment on index public.ix_audit_logs_brin_occurred is 'BRIN index for sequential audit log scans by time range. 10-100x smaller than B-tree for append-only data.';
comment on index public.ix_ledger_entries_brin_entry_date is 'BRIN index for ledger replay scans. Used by compute_account_balance() and compute_parent_balance() for date-range replays.';
comment on index public.ix_chat_messages_brin is 'BRIN index for chat history pagination by sent_at (append-only time-series).';
comment on index public.ix_inventory_low_stock is 'Partial index for low-stock alerts: only rows where quantity_on_hand <= reorder_level';
comment on index public.ix_notifications_unread_priority is 'Optimizes Topbar bell query: unread + not dismissed, ordered by priority then recency';
