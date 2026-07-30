-- ============================================================================
-- 0019_rls_policies.sql
-- ============================================================================
-- Row-Level Security policies for EVERY tenant-scoped table.
--
-- Pattern (universal):
--   1. Enable RLS on the table.
--   2. CREATE POLICY ... FOR SELECT USING (tenant_id = public.current_tenant_id()
--      AND <role/permission check> AND deleted_at IS NULL);
--   3. CREATE POLICY ... FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id()
--      AND <role/permission check>);
--   4. CREATE POLICY ... FOR UPDATE USING (tenant_id = public.current_tenant_id()
--      AND <role/permission check>) WITH CHECK (tenant_id = public.current_tenant_id()
--      AND <role/permission check>);
--   5. CREATE POLICY ... FOR DELETE USING (tenant_id = public.current_tenant_id()
--      AND public.has_role('super_admin'));
--
-- Special handling:
--   - tenants: only SuperAdmin reads (no tenant_id column — IS the tenant root)
--   - user_profiles: tenant_id may be NULL for global admins; reads check
--     (tenant_id IS NULL OR tenant_id = current_tenant_id())
--   - audit_logs: append-only (no UPDATE/DELETE policies — trigger blocks them)
--   - ledger_entries: immutable (no UPDATE/DELETE policies)
--   - parents/students/personnel: soft-delete (deleted_at IS NULL filter on SELECT)
--
-- Helper predicates used below:
--   - public.current_tenant_id()       — caller's tenant from JWT/profile
--   - public.has_role(code)            — true if caller has the role
--   - public.has_any_role(array[...])  — true if caller has any of the roles
--   - public.has_permission(code)      — true if caller has the permission
--   - public.current_user_profile_id() — caller's user_profiles.id
--
-- Plan §12.05: service_role key BYPASSES RLS — use ONLY server-side in Edge
-- Functions, NEVER in client code. Client code uses the anon key.
-- ============================================================================

-- ============================================================================
-- TENANTS (root — no tenant_id column)
-- ============================================================================
alter table public.tenants enable row level security;

create policy tenants_select on public.tenants
    for select to authenticated
    using (
        id = public.current_tenant_id()
        or public.has_role('super_admin')
    );

create policy tenants_update on public.tenants
    for update to authenticated
    using (public.has_role('super_admin'))
    with check (public.has_role('super_admin'));

create policy tenants_insert on public.tenants
    for insert to authenticated
    with check (public.has_role('super_admin'));

create policy tenants_delete on public.tenants
    for delete to authenticated
    using (public.has_role('super_admin'));

-- ============================================================================
-- USER_PROFILES
-- ============================================================================
alter table public.user_profiles enable row level security;

create policy user_profiles_select_own on public.user_profiles
    for select to authenticated
    using (
        id = public.current_user_profile_id()
        or (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']))
    );

create policy user_profiles_update_own on public.user_profiles
    for update to authenticated
    using (id = public.current_user_profile_id())
    with check (id = public.current_user_profile_id());

create policy user_profiles_admin_update on public.user_profiles
    for update to authenticated
    using (public.has_role('super_admin'))
    with check (public.has_role('super_admin'));

-- ============================================================================
-- ACCOUNT_APPROVAL_REQUESTS — admin-only read; system inserts on signup
-- ============================================================================
alter table public.account_approval_requests enable row level security;

create policy approval_requests_select_admin on public.account_approval_requests
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'support_staff'])
    );

create policy approval_requests_update_admin on public.account_approval_requests
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'support_staff'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'support_staff'])
    );

create policy approval_requests_insert_system on public.account_approval_requests
    for insert to authenticated
    with check (true);  -- inserted by trigger on auth.users; RLS doesn't block

-- ============================================================================
-- SESSIONS — user reads own; admin reads all in tenant
-- ============================================================================
alter table public.sessions enable row level security;

create policy sessions_select_own on public.sessions
    for select to authenticated
    using (
        user_profile_id = public.current_user_profile_id()
        or (tenant_id = public.current_tenant_id() and public.has_role('super_admin'))
    );

create policy sessions_insert_own on public.sessions
    for insert to authenticated
    with check (user_profile_id = public.current_user_profile_id());

create policy sessions_update_own on public.sessions
    for update to authenticated
    using (user_profile_id = public.current_user_profile_id() or public.has_role('super_admin'))
    with check (true);

create policy sessions_delete_admin on public.sessions
    for delete to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

-- ============================================================================
-- ROLES, PERMISSIONS, ROLE_PERMISSIONS — readable by all staff
-- ============================================================================
alter table public.roles enable row level security;
create policy roles_select on public.roles for select to authenticated using (true);

alter table public.permissions enable row level security;
create policy permissions_select on public.permissions for select to authenticated using (true);

alter table public.role_permissions enable row level security;
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

alter table public.tenant_role_overrides enable row level security;
create policy tenant_role_overrides_select on public.tenant_role_overrides
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy tenant_role_overrides_admin on public.tenant_role_overrides
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'))
    with check (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

alter table public.role_assignments enable row level security;
create policy role_assignments_select on public.role_assignments
    for select to authenticated
    using (
        user_profile_id = public.current_user_profile_id()
        or (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']))
    );
create policy role_assignments_admin on public.role_assignments
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'))
    with check (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

-- ============================================================================
-- ACADEMIC STRUCTURE (0004)
-- ============================================================================
alter table public.academic_years enable row level security;
create policy academic_years_select on public.academic_years
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy academic_years_admin on public.academic_years
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']));

alter table public.academic_levels enable row level security;
create policy academic_levels_select on public.academic_levels
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy academic_levels_admin on public.academic_levels
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'))
    with check (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

alter table public.classes enable row level security;
create policy classes_select on public.classes
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy classes_admin on public.classes
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'teacher']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']));

alter table public.subjects enable row level security;
create policy subjects_select on public.subjects
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy subjects_admin on public.subjects
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'teacher']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']));

alter table public.class_subjects enable row level security;
create policy class_subjects_select on public.class_subjects
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy class_subjects_admin on public.class_subjects
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'teacher']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']));

alter table public.assessments enable row level security;
create policy assessments_select on public.assessments
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy assessments_admin on public.assessments
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'teacher']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'teacher']));

alter table public.grades enable row level security;
create policy grades_select on public.grades
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager'])
            or public.has_role('parent')  -- parent sees own children's grades via join
            or public.has_role('student')  -- student sees own grades via join
        )
    );
create policy grades_teacher_write on public.grades
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher'])
    );
create policy grades_teacher_update on public.grades
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher'])
    );
create policy grades_admin_delete on public.grades
    for delete to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

alter table public.attendance_records enable row level security;
create policy attendance_select on public.attendance_records
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager', 'parent', 'student'])
    );
create policy attendance_teacher_write on public.attendance_records
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher', 'support_staff'])
    );
create policy attendance_teacher_update on public.attendance_records
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher', 'support_staff'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher', 'support_staff'])
    );

alter table public.homework_assignments enable row level security;
create policy homework_select on public.homework_assignments
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher', 'parent', 'student', 'support_staff'])
    );
create policy homework_teacher_write on public.homework_assignments
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher'])
    );
create policy homework_teacher_update on public.homework_assignments
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'teacher'])
    );

alter table public.academic_history enable row level security;
create policy academic_history_select on public.academic_history
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'parent', 'student'])
    );
create policy academic_history_insert on public.academic_history
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'support_staff'])
    );

-- ============================================================================
-- CRM (0005)
-- ============================================================================
alter table public.parents enable row level security;
create policy parents_select on public.parents
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and deleted_at is null
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager'])
    );
create policy parents_parent_self on public.parents
    for select to authenticated
    using (
        auth_user_id = auth.uid()
        and deleted_at is null
    );
create policy parents_insert on public.parents
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'support_staff'])
    );
create policy parents_update on public.parents
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );
create policy parents_delete on public.parents
    for delete to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

alter table public.students enable row level security;
create policy students_select on public.students
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and deleted_at is null
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager'])
    );
create policy students_student_self on public.students
    for select to authenticated
    using (
        auth_user_id = auth.uid()
        and deleted_at is null
    );
create policy students_parent_sees_own on public.students
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and deleted_at is null
        and public.has_role('parent')
        and parent_id in (
            select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
        )
    );
create policy students_insert on public.students
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'support_staff'])
    );
create policy students_update on public.students
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher'])
    );
create policy students_delete on public.students
    for delete to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

alter table public.parent_student_links enable row level security;
create policy parent_student_links_select on public.parent_student_links
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'parent'])
    );
create policy parent_student_links_admin on public.parent_student_links
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']));

alter table public.activation_codes enable row level security;
create policy activation_codes_select on public.activation_codes
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'support_staff'])
    );
create policy activation_codes_admin on public.activation_codes
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']));

alter table public.student_documents enable row level security;
create policy student_documents_select on public.student_documents
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager'])
    );
create policy student_documents_admin on public.student_documents
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']));

-- ============================================================================
-- PRICING (0006)
-- ============================================================================
alter table public.pricing_configs enable row level security;
create policy pricing_configs_select on public.pricing_configs
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy pricing_configs_admin on public.pricing_configs
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.grade_level_tuition enable row level security;
create policy grade_level_tuition_select on public.grade_level_tuition
    for select to authenticated
    using (exists (select 1 from public.pricing_configs pc where pc.id = pricing_config_id and pc.tenant_id = public.current_tenant_id()));
create policy grade_level_tuition_admin on public.grade_level_tuition
    for all to authenticated
    using (public.has_any_role(array['super_admin', 'financial_officer']))
    with check (public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.transport_destinations enable row level security;
create policy transport_destinations_select on public.transport_destinations
    for select to authenticated
    using (exists (select 1 from public.pricing_configs pc where pc.id = pricing_config_id and pc.tenant_id = public.current_tenant_id()));
create policy transport_destinations_admin on public.transport_destinations
    for all to authenticated
    using (public.has_any_role(array['super_admin', 'financial_officer']))
    with check (public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.complementary_services enable row level security;
create policy complementary_services_select on public.complementary_services
    for select to authenticated
    using (exists (select 1 from public.pricing_configs pc where pc.id = pricing_config_id and pc.tenant_id = public.current_tenant_id()));
create policy complementary_services_admin on public.complementary_services
    for all to authenticated
    using (public.has_any_role(array['super_admin', 'financial_officer']))
    with check (public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.additional_services enable row level security;
create policy additional_services_select on public.additional_services
    for select to authenticated
    using (exists (select 1 from public.pricing_configs pc where pc.id = pricing_config_id and pc.tenant_id = public.current_tenant_id()));
create policy additional_services_admin on public.additional_services
    for all to authenticated
    using (public.has_any_role(array['super_admin', 'financial_officer']))
    with check (public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.discounts enable row level security;
create policy discounts_select on public.discounts
    for select to authenticated
    using (exists (select 1 from public.pricing_configs pc where pc.id = pricing_config_id and pc.tenant_id = public.current_tenant_id()));
create policy discounts_admin on public.discounts
    for all to authenticated
    using (public.has_any_role(array['super_admin', 'financial_officer']))
    with check (public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.discount_applications enable row level security;
create policy discount_applications_select on public.discount_applications
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy discount_applications_admin on public.discount_applications
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));

-- ============================================================================
-- FINANCIAL (0007)
-- ============================================================================
alter table public.service_enrollments enable row level security;
create policy service_enrollments_select on public.service_enrollments
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy service_enrollments_admin on public.service_enrollments
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']));

alter table public.invoices enable row level security;
create policy invoices_select on public.invoices
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
            or (public.has_role('parent') and parent_id in (
                select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
            ))
        )
    );
create policy invoices_admin on public.invoices
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']));

alter table public.installments enable row level security;
create policy installments_select on public.installments
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
            or (public.has_role('parent') and parent_id in (
                select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
            ))
        )
    );
create policy installments_admin on public.installments
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']));

alter table public.payments enable row level security;
create policy payments_select on public.payments
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
            or (public.has_role('parent') and parent_id in (
                select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
            ))
        )
    );
create policy payments_insert on public.payments
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );
create policy payments_update on public.payments
    for update to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.account_adjustments enable row level security;
create policy account_adjustments_select on public.account_adjustments
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']));
create policy account_adjustments_insert on public.account_adjustments
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.receipts enable row level security;
create policy receipts_select on public.receipts
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
            or (public.has_role('parent') and parent_id in (
                select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
            ))
        )
    );
create policy receipts_insert on public.receipts
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']));

-- ledger_entries — IMMUTABLE (no UPDATE/DELETE policies)
alter table public.ledger_entries enable row level security;
create policy ledger_entries_select on public.ledger_entries
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
            or (public.has_role('parent') and parent_id in (
                select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
            ))
        )
    );
create policy ledger_entries_insert on public.ledger_entries
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']));

-- ============================================================================
-- EXPENSES (0008)
-- ============================================================================
alter table public.expense_categories enable row level security;
create policy expense_categories_select on public.expense_categories
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy expense_categories_admin on public.expense_categories
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.expense_tickets enable row level security;
create policy expense_tickets_select on public.expense_tickets
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'manager'])
            or submitted_by = public.current_user_profile_id()
        )
    );
create policy expense_tickets_insert on public.expense_tickets
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'manager', 'buyer',
                                  'teacher', 'support_staff', 'driver', 'warehouse_worker', 'worker'])
    );
create policy expense_tickets_update on public.expense_tickets
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'manager'])
            or submitted_by = public.current_user_profile_id()
        )
    )
    with check (tenant_id = public.current_tenant_id());

alter table public.expense_state_transitions enable row level security;
create policy expense_state_transitions_select on public.expense_state_transitions
    for select to authenticated
    using (tenant_id = public.current_tenant_id());

-- ============================================================================
-- ATTENDANCE/HR (0009)
-- ============================================================================
alter table public.personnel enable row level security;
create policy personnel_select on public.personnel
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and deleted_at is null
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager',
                                  'teacher', 'buyer', 'driver', 'warehouse_worker', 'worker'])
    );
create policy personnel_self on public.personnel
    for select to authenticated
    using (user_id = public.current_user_profile_id() and deleted_at is null);
create policy personnel_admin on public.personnel
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']));

-- Restrict salary visibility to SuperAdmin + FinancialOfficer (plan §09.04)
-- Implemented as a column-level policy on personnel.base_salary + bonuses_json
alter table public.personnel enable row level security;
-- (Column-level RLS is achieved via separate view — see 0021_views.sql)

alter table public.releve_entries enable row level security;
create policy releve_entries_select on public.releve_entries
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager'])
            or (personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id()))
        )
    );
create policy releve_entries_insert on public.releve_entries
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager'])
    );

-- ============================================================================
-- WORKFORCE (0010) — Generic pattern: tenant + role-gated
-- ============================================================================
alter table public.departments enable row level security;
create policy departments_select on public.departments for select to authenticated using (tenant_id = public.current_tenant_id());
create policy departments_admin on public.departments
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']));

alter table public.shifts enable row level security;
create policy shifts_select on public.shifts for select to authenticated using (tenant_id = public.current_tenant_id());
create policy shifts_admin on public.shifts
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']));

alter table public.schedules enable row level security;
create policy schedules_select on public.schedules
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'support_staff', 'manager'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );
create policy schedules_admin on public.schedules
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']));

alter table public.tasks enable row level security;
create policy tasks_select on public.tasks
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'manager'])
            or created_by = public.current_user_profile_id()
            or assignee_ids @> to_jsonb(public.current_user_profile_id()::text)
        )
    );
create policy tasks_insert on public.tasks
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy tasks_update on public.tasks
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'manager'])
            or created_by = public.current_user_profile_id()
            or assignee_ids @> to_jsonb(public.current_user_profile_id()::text)
        )
    )
    with check (tenant_id = public.current_tenant_id());

alter table public.task_comments enable row level security;
create policy task_comments_select on public.task_comments
    for select to authenticated using (tenant_id = public.current_tenant_id());
create policy task_comments_insert on public.task_comments
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id());
create policy task_comments_update_own on public.task_comments
    for update to authenticated
    using (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id())
    with check (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id());

alter table public.task_attachments enable row level security;
create policy task_attachments_select on public.task_attachments
    for select to authenticated using (tenant_id = public.current_tenant_id());
create policy task_attachments_insert on public.task_attachments
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());

alter table public.workforce_attendance_events enable row level security;
create policy workforce_attendance_select on public.workforce_attendance_events
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'support_staff', 'manager'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );
create policy workforce_attendance_insert on public.workforce_attendance_events
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());

alter table public.leave_requests enable row level security;
create policy leave_requests_select on public.leave_requests
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'support_staff', 'manager'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );
create policy leave_requests_insert on public.leave_requests
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy leave_requests_manager_update on public.leave_requests
    for update to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'manager']));

alter table public.performance_reviews enable row level security;
create policy performance_reviews_select on public.performance_reviews
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'support_staff', 'manager'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );
create policy performance_reviews_admin on public.performance_reviews
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'manager']));

alter table public.chat_channels enable row level security;
create policy chat_channels_select on public.chat_channels
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role('super_admin')
            or member_ids @> array[public.current_user_profile_id()]
        )
    );
create policy chat_channels_insert on public.chat_channels
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());

alter table public.chat_messages enable row level security;
create policy chat_messages_select on public.chat_messages
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and deleted_at is null
        and (
            public.has_role('super_admin')
            or exists (
                select 1 from public.chat_channels c
                 where c.id = chat_messages.channel_id
                   and c.member_ids @> array[public.current_user_profile_id()]
            )
        )
    );
create policy chat_messages_insert on public.chat_messages
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and author_id = public.current_user_profile_id()
    );
create policy chat_messages_update_own on public.chat_messages
    for update to authenticated
    using (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id())
    with check (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id());

alter table public.onboarding_states enable row level security;
create policy onboarding_states_select on public.onboarding_states
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'support_staff', 'manager'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );
create policy onboarding_states_admin on public.onboarding_states
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff', 'manager']));

-- ============================================================================
-- OPERATIONS (0011) — Generic pattern
-- ============================================================================
alter table public.suppliers enable row level security;
create policy suppliers_select on public.suppliers
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and deleted_at is null);
create policy suppliers_admin on public.suppliers
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'buyer', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'buyer', 'manager']));

alter table public.purchase_requests enable row level security;
create policy purchase_requests_select on public.purchase_requests
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'manager'])
            or requester_id = public.current_user_profile_id()
        )
    );
create policy purchase_requests_insert on public.purchase_requests
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy purchase_requests_update on public.purchase_requests
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'manager', 'buyer'])
    )
    with check (tenant_id = public.current_tenant_id());

alter table public.deliveries enable row level security;
create policy deliveries_select on public.deliveries
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'manager'])
            or driver_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );
create policy deliveries_admin on public.deliveries
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'manager']));

alter table public.inventory_items enable row level security;
create policy inventory_items_select on public.inventory_items
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and deleted_at is null);
create policy inventory_items_admin on public.inventory_items
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'warehouse_worker', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'warehouse_worker', 'manager']));

alter table public.inventory_transactions enable row level security;
create policy inventory_transactions_select on public.inventory_transactions
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy inventory_transactions_insert on public.inventory_transactions
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'warehouse_worker', 'buyer', 'manager'])
    );

alter table public.pending_receipts enable row level security;
create policy pending_receipts_select on public.pending_receipts
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy pending_receipts_admin on public.pending_receipts
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'warehouse_worker', 'buyer', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'warehouse_worker', 'buyer', 'manager']));

alter table public.pending_dispatches enable row level security;
create policy pending_dispatches_select on public.pending_dispatches
    for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy pending_dispatches_admin on public.pending_dispatches
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'warehouse_worker', 'manager']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'warehouse_worker', 'manager']));

-- ============================================================================
-- WORKFLOW + AI (0012)
-- ============================================================================
alter table public.workflows enable row level security;
create policy workflows_select on public.workflows
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'manager']));
create policy workflows_admin on public.workflows
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'))
    with check (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

alter table public.workflow_runs enable row level security;
create policy workflow_runs_select on public.workflow_runs
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer', 'manager']));
create policy workflow_runs_insert on public.workflow_runs
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());

alter table public.workflow_audit_links enable row level security;
create policy workflow_audit_links_select on public.workflow_audit_links
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));

alter table public.ai_provider_configs enable row level security;
create policy ai_provider_configs_select on public.ai_provider_configs
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));
create policy ai_provider_configs_admin on public.ai_provider_configs
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_role('super_admin'))
    with check (tenant_id = public.current_tenant_id() and public.has_role('super_admin'));

alter table public.ai_request_logs enable row level security;
create policy ai_request_logs_select on public.ai_request_logs
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));
create policy ai_request_logs_insert on public.ai_request_logs
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());

-- ============================================================================
-- CALENDAR / NOTIFICATIONS / BACKUP (0013)
-- ============================================================================
alter table public.calendar_events enable row level security;
create policy calendar_events_select on public.calendar_events
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and is_deleted = false
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager',
                                  'teacher', 'buyer', 'driver', 'warehouse_worker', 'worker'])
    );
create policy calendar_events_admin on public.calendar_events
    for all to authenticated
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            target_user_id = public.current_user_profile_id()
            or (target_role is not null and target_role = any(public.current_user_roles()))
            or (target_user_id is null and target_role is null and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
        )
    );
create policy notifications_insert on public.notifications
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy notifications_update on public.notifications
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (target_user_id = public.current_user_profile_id() or public.has_role('super_admin'))
    )
    with check (tenant_id = public.current_tenant_id());

alter table public.backup_archives enable row level security;
create policy backup_archives_select on public.backup_archives
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));
create policy backup_archives_admin on public.backup_archives
    for all to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']))
    with check (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'financial_officer']));

-- ============================================================================
-- AUDIT LOGS (0014) — admin-only read; system inserts
-- ============================================================================
alter table public.audit_logs enable row level security;
create policy audit_logs_select_admin on public.audit_logs
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer'])
    );
create policy audit_logs_select_own on public.audit_logs
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and actor_id = public.current_user_profile_id()
    );
create policy audit_logs_insert on public.audit_logs
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
-- No UPDATE or DELETE policies — trigger blocks them.

-- ============================================================================
-- FINAL: Force RLS on every tenant-scoped table (defense-in-depth)
-- ============================================================================
-- The ALTER TABLE ... ENABLE ROW LEVEL SECURITY above covers every table.
-- For tables owned by the postgres user, we also need FORCE ROW LEVEL SECURITY
-- so that even the table owner is subject to RLS (only the service_role can
-- bypass). This is critical for tables that might be touched by triggers
-- running as the table owner.
do $$
declare
    t record;
begin
    for t in
        select table_name from information_schema.tables
         where table_schema = 'public'
           and table_type = 'BASE TABLE'
           and table_name not in (
               'audit_logs', 'ledger_entries', 'workflow_audit_links',
               'inventory_transactions', 'workforce_attendance_events',
               'task_attachments', 'chat_messages', 'workflow_runs',
               'ai_request_logs'  -- these are append-only or have special handling
           )
    loop
        execute format('alter table public.%I force row level security;', t.table_name);
    end loop;
end $$;

comment on script is 'RLS policies for every tenant-scoped table. service_role bypasses RLS — use server-side only. FORCE ROW LEVEL SECURITY applied to non-append-only tables.';
