-- ============================================================================
-- 0023_seed.sql
-- ============================================================================
-- Reference data seed: default tenant, all 11 roles, ~50 permissions,
-- role-permission matrix, default academic levels/year, expense categories,
-- departments, pricing config with all 14 grade-level tuitions and 4 transport
-- destinations, complementary services, and the 5 canonical discounts.
--
-- Idempotent: uses INSERT ... ON CONFLICT DO NOTHING everywhere.
-- ============================================================================

-- ============================================================================
-- 1. Default tenant
-- ============================================================================
insert into public.tenants (id, slug, name, legal_name, country, default_locale, default_currency, timezone, is_active, settings)
values (
    '00000000-0000-0000-0000-000000000001',
    'elimtiyaz-boumerdes',
    'El-Imtiyaz Boumerdès',
    'Sarl Elimtiyaz',
    'DZ',
    'fr',
    'DZD',
    'Africa/Algiers',
    true,
    '{"academic_year_start_month": 9, "academic_year_end_month": 6}'::jsonb
) on conflict (id) do nothing;

-- ============================================================================
-- 2. Roles (11 total — 9 staff + 2 web-only)
-- ============================================================================
insert into public.roles (id, code, label_fr, label_ar, label_en, staff_category, is_staff_role, is_web_role, sort_order) values
    ('00000000-0000-0000-0000-000000000101', 'super_admin', 'Super Administrateur', 'مدير عام', 'Super Admin', 'administration', true, false, 1),
    ('00000000-0000-0000-0000-000000000102', 'financial_officer', 'Responsable Financier', 'مسؤول مالي', 'Financial Officer', 'administration', true, false, 2),
    ('00000000-0000-0000-0000-000000000103', 'teacher', 'Enseignant', 'معلم', 'Teacher', 'teaching', true, false, 3),
    ('00000000-0000-0000-0000-000000000104', 'support_staff', 'Personnel Soutien', 'موظف دعم', 'Support Staff', 'administration', true, false, 4),
    ('00000000-0000-0000-0000-000000000105', 'manager', 'Gestionnaire', 'مدير', 'Manager', 'administration', true, false, 5),
    ('00000000-0000-0000-0000-000000000106', 'buyer', 'Acheteur', 'مشتريات', 'Buyer', 'administration', true, false, 6),
    ('00000000-0000-0000-0000-000000000107', 'driver', 'Chauffeur', 'سائق', 'Driver', 'support', true, false, 7),
    ('00000000-0000-0000-0000-000000000108', 'warehouse_worker', 'Magasinier', 'عامل مخزن', 'Warehouse Worker', 'support', true, false, 8),
    ('00000000-0000-0000-0000-000000000109', 'worker', 'Ouvrier', 'عامل', 'Worker', 'support', true, false, 9),
    ('00000000-0000-0000-0000-000000000110', 'parent', 'Parent / Tuteur', 'ولي الأمر', 'Parent / Guardian', null, false, true, 10),
    ('00000000-0000-0000-0000-000000000111', 'student', 'Élève', 'تلميذ', 'Student', null, false, true, 11)
on conflict (code) do nothing;

-- ============================================================================
-- 3. Permissions (~50 grouped by domain)
-- ============================================================================
insert into public.permissions (code, label_fr, label_ar, label_en, domain, sort_order) values
    -- CRM
    ('view_roster', 'Voir l''annuaire', 'عرض السجل', 'View roster', 'crm', 101),
    ('create_parent', 'Créer un parent', 'إنشاء ولي', 'Create parent', 'crm', 102),
    ('edit_parent', 'Modifier un parent', 'تعديل ولي', 'Edit parent', 'crm', 103),
    ('delete_parent', 'Supprimer un parent', 'حذف ولي', 'Delete parent', 'crm', 104),
    ('view_students', 'Voir les élèves', 'عرض التلاميذ', 'View students', 'crm', 105),
    ('enroll_student', 'Inscrire un élève', 'تسجيل تلميذ', 'Enroll student', 'crm', 106),
    ('batch_register', 'Inscription groupée', 'تسجيل جماعي', 'Batch register', 'crm', 107),
    ('import_data', 'Importer des données', 'استيراد البيانات', 'Import data', 'crm', 108),
    ('view_own_children', 'Voir ses enfants', 'عرض أبنائه', 'View own children', 'crm', 109),
    -- Academic
    ('view_academics', 'Voir le académique', 'عرض الأكاديمي', 'View academics', 'academic', 201),
    ('enter_grades', 'Saisir des notes', 'إدخال النقاط', 'Enter grades', 'academic', 202),
    ('roll_call', 'Faire l''appel', 'تسجيل الحضور', 'Roll call', 'academic', 203),
    ('push_homework', 'Donner un devoir', 'إعطاء واجب', 'Push homework', 'academic', 204),
    ('view_own_grades', 'Voir ses notes', 'عرض نقاطه', 'View own grades', 'academic', 205),
    ('view_own_attendance', 'Voir sa présence', 'عرض حضوره', 'View own attendance', 'academic', 206),
    ('manage_subjects', 'Gérer les matières', 'إدارة المواد', 'Manage subjects', 'academic', 207),
    -- Financial
    ('view_financials', 'Voir les finances', 'عرض المالية', 'View financials', 'financial', 301),
    ('collect_payment', 'Encaisser un paiement', 'تحصيل دفعة', 'Collect payment', 'financial', 302),
    ('refund_payment', 'Rembourser un paiement', 'رد دفعة', 'Refund payment', 'financial', 303),
    ('view_debt', 'Voir les créances', 'عرض الديون', 'View debt', 'financial', 304),
    ('manage_installments', 'Gérer les tranches', 'إدارة الأقساط', 'Manage installments', 'financial', 305),
    ('view_own_financials', 'Voir ses finances', 'عرض ماليته', 'View own financials', 'financial', 306),
    -- Expense
    ('submit_expense', 'Soumettre une dépense', 'تقديم مصروف', 'Submit expense', 'expense', 401),
    ('approve_expense', 'Approuver une dépense', 'الموافقة على مصروف', 'Approve expense', 'expense', 402),
    ('settle_expense', 'Régler une dépense', 'تسوية مصروف', 'Settle expense', 'expense', 403),
    -- HR
    ('view_personnel', 'Voir le personnel', 'عرض الموظفين', 'View personnel', 'hr', 501),
    ('manage_personnel', 'Gérer le personnel', 'إدارة الموظفين', 'Manage personnel', 'hr', 502),
    ('view_releve', 'Voir le relevé', 'عرض الكشف', 'View releve', 'hr', 503),
    ('log_releve', 'Enregistrer le relevé', 'تسجيل الكشف', 'Log releve', 'hr', 504),
    -- Workflow
    ('manage_workflows', 'Gérer les workflows', 'إدارة سير العمل', 'Manage workflows', 'workflow', 601),
    ('view_workflow_runs', 'Voir les exécutions', 'عرض التنفيicts', 'View workflow runs', 'workflow', 602),
    ('execute_workflow', 'Exécuter un workflow', 'تنفيذ سير العمل', 'Execute workflow', 'workflow', 603),
    -- Routing
    ('access_driver_mode', 'Mode chauffeur', 'وضع السائق', 'Access driver mode', 'routing', 701),
    ('view_routing', 'Voir le routage', 'عرض التوجيه', 'View routing', 'routing', 702),
    -- Settings
    ('manage_settings', 'Gérer les paramètres', 'إدارة الإعدادات', 'Manage settings', 'settings', 801),
    ('view_audit_log', 'Voir le journal d''audit', 'عرض سجل التدقيق', 'View audit log', 'audit', 802),
    ('manage_rbac', 'Gérer les rôles', 'إدارة الأدوار', 'Manage RBAC', 'settings', 803),
    ('manage_pricing', 'Gérer la tarification', 'إدارة التسعير', 'Manage pricing', 'settings', 804),
    -- Backup
    ('manage_backups', 'Gérer les sauvegardes', 'إدارة النسخ الاحتياطي', 'Manage backups', 'backup', 901),
    -- AI
    ('manage_ai_config', 'Gérer l''IA', 'إدارة الذكاء الاصطناعي', 'Manage AI config', 'ai', 1001),
    ('use_ai', 'Utiliser l''IA', 'استخدام الذكاء الاصطناعي', 'Use AI', 'ai', 1002),
    -- Operations
    ('view_operations', 'Voir les opérations', 'عرض العمليات', 'View operations', 'operations', 1101),
    ('manage_suppliers', 'Gérer les fournisseurs', 'إدارة الموردين', 'Manage suppliers', 'operations', 1102),
    ('manage_inventory', 'Gérer le stock', 'إدارة المخزون', 'Manage inventory', 'operations', 1103),
    -- Workforce
    ('view_workforce', 'Voir le personnel', 'عرض الموظفين', 'View workforce', 'workforce', 1201),
    ('manage_departments', 'Gérer les départements', 'إدارة الأقسام', 'Manage departments', 'workforce', 1202),
    ('assign_tasks', 'Assigner des tâches', 'إسناد المهام', 'Assign tasks', 'workforce', 1203),
    ('view_tasks', 'Voir les tâches', 'عرض المهام', 'View tasks', 'workforce', 1204),
    ('manage_onboarding', 'Gérer l''intégration', 'إدارة الإدماج', 'Manage onboarding', 'workforce', 1205),
    -- Calendar + Notifications
    ('manage_calendar', 'Gérer le calendrier', 'إدارة التقويم', 'Manage calendar', 'calendar', 1301),
    ('view_calendar', 'Voir le calendrier', 'عرض التقويم', 'View calendar', 'calendar', 1302),
    ('create_alert', 'Créer une alerte', 'إنشاء تنبيه', 'Create alert', 'notification', 1401),
    ('manage_alerts', 'Gérer les alertes', 'إدارة التنبيهات', 'Manage alerts', 'notification', 1402),
    ('view_notifications', 'Voir les notifications', 'عرض الإشعارات', 'View notifications', 'notification', 1403),
    -- Dashboard
    ('view_dashboard', 'Voir le tableau de bord', 'عرض لوحة القيادة', 'View dashboard', 'settings', 1501),
    ('export_data', 'Exporter des données', 'تصدير البيانات', 'Export data', 'settings', 1502)
on conflict (code) do nothing;

-- ============================================================================
-- 4. Role-Permission Matrix (defaults)
-- ============================================================================
-- SuperAdmin: ALL permissions
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'super_admin'
on conflict do nothing;

-- FinancialOfficer: financial + expense + audit + dashboard + export + personnel + backup + AI + calendar
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'financial_officer'
   and p.code in (
        'view_financials', 'collect_payment', 'refund_payment', 'view_debt',
        'manage_installments', 'submit_expense', 'approve_expense', 'settle_expense',
        'view_audit_log', 'view_dashboard', 'export_data',
        'view_personnel', 'view_releve',
        'manage_backups', 'use_ai', 'view_calendar',
        'view_roster', 'view_students', 'view_academics'
   )
on conflict do nothing;

-- Teacher: view + grades + attendance + homework + releve + AI + calendar + tasks
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'teacher'
   and p.code in (
        'view_roster', 'view_students', 'view_academics',
        'enter_grades', 'roll_call', 'push_homework',
        'view_releve', 'log_releve', 'use_ai',
        'view_calendar', 'view_tasks', 'assign_tasks',
        'view_notifications', 'view_own_grades'
   )
on conflict do nothing;

-- SupportStaff: view + create/edit parent + enroll + batch + view financials + collect + view personnel + calendar + tasks + onboarding + notifications
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'support_staff'
   and p.code in (
        'view_roster', 'create_parent', 'edit_parent',
        'view_students', 'enroll_student', 'batch_register', 'import_data',
        'view_academics',
        'view_financials', 'collect_payment',
        'view_personnel',
        'view_calendar', 'view_tasks', 'assign_tasks',
        'manage_onboarding', 'view_notifications',
        'view_dashboard'
   )
on conflict do nothing;

-- Manager: dashboard + view roster/personnel + tasks + departments + approve expense + audit + calendar
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'manager'
   and p.code in (
        'view_dashboard', 'view_roster', 'view_students',
        'view_personnel', 'manage_personnel',
        'view_tasks', 'assign_tasks', 'manage_departments',
        'approve_expense', 'view_audit_log',
        'view_calendar', 'view_notifications',
        'view_workforce', 'manage_onboarding'
   )
on conflict do nothing;

-- Buyer: operations + suppliers + tasks
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'buyer'
   and p.code in (
        'view_operations', 'manage_suppliers',
        'view_tasks', 'assign_tasks',
        'view_notifications', 'submit_expense'
   )
on conflict do nothing;

-- Driver: driver mode + routing + tasks
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'driver'
   and p.code in (
        'access_driver_mode', 'view_routing',
        'view_tasks', 'view_notifications', 'submit_expense'
   )
on conflict do nothing;

-- WarehouseWorker: operations + inventory + tasks
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'warehouse_worker'
   and p.code in (
        'view_operations', 'manage_inventory',
        'view_tasks', 'view_notifications', 'submit_expense'
   )
on conflict do nothing;

-- Worker: tasks only
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'worker'
   and p.code in ('view_tasks', 'view_notifications', 'submit_expense')
on conflict do nothing;

-- Parent: view own children + view own financials
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'parent'
   and p.code in (
        'view_own_children', 'view_own_financials',
        'view_own_grades', 'view_own_attendance',
        'view_calendar', 'view_notifications'
   )
on conflict do nothing;

-- Student: view own grades + view own attendance
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'student'
   and p.code in (
        'view_own_grades', 'view_own_attendance',
        'view_calendar', 'view_notifications'
   )
on conflict do nothing;

-- ============================================================================
-- 5. Academic Levels (14 — 2 prescolaire + 5 primaire + 4 CEM + 3 lycée)
-- ============================================================================
insert into public.academic_levels (tenant_id, cycle, year_label, year_number, grade_code, sort_order, is_active) values
    ('00000000-0000-0000-0000-000000000001', 'prescolaire', 'Moyenne Section', 1, 'prescolaire_1', 1, true),
    ('00000000-0000-0000-0000-000000000001', 'prescolaire', 'Grande Section', 2, 'prescolaire_2', 2, true),
    ('00000000-0000-0000-0000-000000000001', 'primaire', '1ère Année Primaire', 1, '1ap', 11, true),
    ('00000000-0000-0000-0000-000000000001', 'primaire', '2ème Année Primaire', 2, '2ap', 12, true),
    ('00000000-0000-0000-0000-000000000001', 'primaire', '3ème Année Primaire', 3, '3ap', 13, true),
    ('00000000-0000-0000-0000-000000000001', 'primaire', '4ème Année Primaire', 4, '4ap', 14, true),
    ('00000000-0000-0000-0000-000000000001', 'primaire', '5ème Année Primaire', 5, '5ap', 15, true),
    ('00000000-0000-0000-0000-000000000001', 'cem', '1ère Année Moyenne', 1, '1am', 21, true),
    ('00000000-0000-0000-0000-000000000001', 'cem', '2ème Année Moyenne', 2, '2am', 22, true),
    ('00000000-0000-0000-0000-000000000001', 'cem', '3ème Année Moyenne', 3, '3am', 23, true),
    ('00000000-0000-0000-0000-000000000001', 'cem', '4ème Année Moyenne', 4, '4am', 24, true),
    ('00000000-0000-0000-0000-000000000001', 'lycee', '1ère Année Secondaire', 1, '1ere_annee', 31, true),
    ('00000000-0000-0000-0000-000000000001', 'lycee', '2ème Année Secondaire', 2, '2eme_annee', 32, true),
    ('00000000-0000-0000-0000-000000000001', 'lycee', '3ème Année Secondaire', 3, '3eme_annee', 33, true)
on conflict (tenant_id, grade_code) do nothing;

-- ============================================================================
-- 6. Default Academic Year: 2026-2027
-- ============================================================================
insert into public.academic_years (tenant_id, label, start_date, end_date, term_structure, is_current, is_archived)
values (
    '00000000-0000-0000-0000-000000000001',
    '2026-2027',
    '2026-09-01',
    '2027-06-30',
    'trimester',
    true,
    false
) on conflict (tenant_id, label) do nothing;

-- ============================================================================
-- 7. Default Expense Categories
-- ============================================================================
insert into public.expense_categories (tenant_id, code, label_fr, is_active) values
    ('00000000-0000-0000-0000-000000000001', 'maintenance', 'Maintenance', true),
    ('00000000-0000-0000-0000-000000000001', 'office_supplies', 'Fournitures de bureau', true),
    ('00000000-0000-0000-0000-000000000001', 'educational_material', 'Matériel pédagogique', true),
    ('00000000-0000-0000-0000-000000000001', 'utilities', 'Charges utilities', true),
    ('00000000-0000-0000-0000-000000000001', 'transport', 'Transport', true),
    ('00000000-0000-0000-0000-000000000001', 'it', 'Informatique', true),
    ('00000000-0000-0000-0000-000000000001', 'facilities', 'Locaux', true),
    ('00000000-0000-0000-0000-000000000001', 'medical', 'Médical', true),
    ('00000000-0000-0000-0000-000000000001', 'other', 'Autre', true)
on conflict (tenant_id, code) do nothing;

-- ============================================================================
-- 8. Default Departments
-- ============================================================================
-- Note: head_personnel_id is null at seed time (filled in when staff is created)
insert into public.departments (tenant_id, code, name_fr, label_ar, color_hex, sort_order, is_active) values
    ('00000000-0000-0000-0000-000000000001', 'ADM', 'Administration', 'الإدارة', '#3B464C', 1, true),
    ('00000000-0000-0000-0000-000000000001', 'TCH', 'Enseignants', 'المعلمون', '#349BD4', 2, true),
    ('00000000-0000-0000-0000-000000000001', 'SUP', 'Maintenance & Support', 'الصيانة والدعم', '#C8A98C', 3, true),
    ('00000000-0000-0000-0000-000000000001', 'MED', 'Médical & Thérapie', 'طبي وعلاج', '#3FA66E', 4, true)
on conflict (tenant_id, code) do nothing;

-- ============================================================================
-- 9. Default Pricing Config + 14 Grade-Level Tuitions + 4 Transport Destinations
-- ============================================================================
insert into public.pricing_configs (
    tenant_id, academic_year_id, label, registration_fee, late_penalty_per_day,
    second_apron_fee, early_payment_bonus_pct, early_payment_deadline, is_active
)
select
    '00000000-0000-0000-0000-000000000001',
    ay.id,
    'Tarification 2026-2027',
    5000.00,  -- registration fee
    100.00,   -- late penalty per day
    2000.00,  -- second apron fee
    5.00,     -- early payment bonus %
    '2027-06-30',  -- early payment deadline
    true
  from public.academic_years ay
 where ay.tenant_id = '00000000-0000-0000-0000-000000000001'
   and ay.label = '2026-2027'
on conflict (tenant_id, academic_year_id) do nothing;

-- 14 Grade-Level Tuitions (official 2026-2027 fee schedule)
insert into public.grade_level_tuition (
    pricing_config_id, academic_level_id, annual_amount,
    tranche_1_amount, tranche_2_amount, tranche_3_amount,
    tranche_1_month, tranche_2_month, tranche_3_month
)
select
    pc.id, al.id,
    case al.grade_code
        when 'prescolaire_1' then 130000.00
        when 'prescolaire_2' then 130000.00
        when '1ap' then 205000.00
        when '2ap' then 205000.00
        when '3ap' then 205000.00
        when '4ap' then 205000.00
        when '5ap' then 205000.00
        when '1am' then 305000.00
        when '2am' then 305000.00
        when '3am' then 305000.00
        when '4am' then 305000.00
        when '1ere_annee' then 340000.00
        when '2eme_annee' then 355000.00
        when '3eme_annee' then 365000.00
    end as annual_amount,
    case al.grade_code
        when 'prescolaire_1' then 40000.00
        when 'prescolaire_2' then 40000.00
        when '1ap' then 60000.00
        when '2ap' then 60000.00
        when '3ap' then 60000.00
        when '4ap' then 60000.00
        when '5ap' then 60000.00
        when '1am' then 100000.00
        when '2am' then 100000.00
        when '3am' then 100000.00
        when '4am' then 100000.00
        when '1ere_annee' then 110000.00
        when '2eme_annee' then 115000.00
        when '3eme_annee' then 120000.00
    end as tranche_1_amount,
    case al.grade_code
        when 'prescolaire_1' then 45000.00
        when 'prescolaire_2' then 45000.00
        when '1ap' then 70000.00
        when '2ap' then 70000.00
        when '3ap' then 70000.00
        when '4ap' then 70000.00
        when '5ap' then 70000.00
        when '1am' then 100000.00
        when '2am' then 100000.00
        when '3am' then 100000.00
        when '4am' then 100000.00
        when '1ere_annee' then 115000.00
        when '2eme_annee' then 120000.00
        when '3eme_annee' then 120000.00
    end as tranche_2_amount,
    case al.grade_code
        when 'prescolaire_1' then 45000.00
        when 'prescolaire_2' then 45000.00
        when '1ap' then 75000.00
        when '2ap' then 75000.00
        when '3ap' then 75000.00
        when '4ap' then 75000.00
        when '5ap' then 75000.00
        when '1am' then 105000.00
        when '2am' then 105000.00
        when '3am' then 105000.00
        when '4am' then 105000.00
        when '1ere_annee' then 115000.00
        when '2eme_annee' then 120000.00
        when '3eme_annee' then 125000.00
    end as tranche_3_amount,
    -- Tranche months per academic cycle (plan §07.03)
    case al.cycle
        when 'prescolaire' then 9
        when 'primaire' then 9
        when 'cem' then 9
        when 'lycee' then 9
    end as tranche_1_month,
    case al.cycle
        when 'prescolaire' then 12
        when 'primaire' then 12
        when 'cem' then 12
        when 'lycee' then 1   -- January for Lycée
    end as tranche_2_month,
    case al.cycle
        when 'prescolaire' then 3
        when 'primaire' then 3   -- March for Primaire
        when 'cem' then 4        -- April for CEM
        when 'lycee' then 5      -- May for Lycée
    end as tranche_3_month
  from public.pricing_configs pc
  cross join public.academic_levels al
 where pc.tenant_id = '00000000-0000-0000-0000-000000000001'
   and al.tenant_id = '00000000-0000-0000-0000-000000000001'
   and pc.is_active = true
on conflict (pricing_config_id, academic_level_id) do nothing;

-- 4 Transport Destinations (plan §07.02)
insert into public.transport_destinations (
    pricing_config_id, code, label_fr, label_ar, annual_amount,
    tranche_1_amount, tranche_2_amount, tranche_3_amount,
    tranche_1_month, tranche_2_month, tranche_3_month
)
select
    pc.id, v.code, v.label_fr, v.label_ar, v.annual_amount,
    v.tranche_1_amount, v.tranche_2_amount, v.tranche_3_amount,
    9, 12, 3
  from public.pricing_configs pc
  cross join (values
    ('ville_boumerdes', 'Boumerdès ville', 'بومرداس', 40000.00, 15000.00, 15000.00, 10000.00),
    ('tidjelabine_sahel_figuier_corso', 'Tidjelabine, Sahel, Figuier, Corso', 'تيجلابين، الساحل، التين، كورسو', 43000.00, 16000.00, 16000.00, 11000.00),
    ('boudouaou_thenia_zemmouri', 'Boudouaou, Thénia, Zemmouri', 'بودواو، الثنية، زموري', 52000.00, 20000.00, 20000.00, 12000.00),
    ('autres', 'Autres localités', 'مناطق أخرى', 55000.00, 20000.00, 20000.00, 15000.00)
  ) as v(code, label_fr, label_ar, annual_amount, tranche_1_amount, tranche_2_amount, tranche_3_amount)
 where pc.tenant_id = '00000000-0000-0000-0000-000000000001'
   and pc.is_active = true
on conflict (pricing_config_id, code) do nothing;

-- ============================================================================
-- 10. Complementary Services
-- ============================================================================
insert into public.complementary_services (pricing_config_id, code, label_fr, label_ar, semester_amount, annual_amount, billing_model, is_active)
select
    pc.id, v.code, v.label_fr, v.label_ar, v.semester_amount, v.annual_amount, v.billing_model, true
  from public.pricing_configs pc
  cross join (values
    ('psychology', 'Psychologie', 'علم النفس', 20000.00, 40000.00, 'per_session'),
    ('speech_therapy', 'Orthophonie', 'تقويم النطق', 10000.00, 20000.00, 'per_session'),
    ('psychotherapy', 'Psychothérapie', 'العلاج النفسي', 25000.00, 50000.00, 'per_session')
  ) as v(code, label_fr, label_ar, semester_amount, annual_amount, billing_model)
 where pc.tenant_id = '00000000-0000-0000-0000-000000000001'
   and pc.is_active = true
on conflict (pricing_config_id, code) do nothing;

-- ============================================================================
-- 11. Default Discounts (5 canonical codes per plan §07.04)
-- ============================================================================
insert into public.discounts (pricing_config_id, code, label_fr, label_ar, discount_type, amount, applies_to, is_active)
select
    pc.id, v.code, v.label_fr, v.label_ar, v.discount_type, v.amount, v.applies_to, true
  from public.pricing_configs pc
  cross join (values
    ('passage_palier', 'Passage palier', 'تجاوز المرحلة', 'fixed_amount', 10000.00, 'tuition'),
    ('seniority_5y', 'Ancienneté 5 ans', 'أقدمية 5 سنوات', 'percentage', 5.00, 'tuition'),
    ('full_annual', 'Paiement annuel', 'دفع سنوي', 'percentage', 10.00, 'total'),
    ('highest_average', 'Meilleure moyenne', 'أعلى معدل', 'percentage', 10.00, 'tuition'),
    ('sibling_fixed', 'Fratrie', 'إخوة', 'fixed_amount', 5000.00, 'per_student')
  ) as v(code, label_fr, label_ar, discount_type, amount, applies_to)
 where pc.tenant_id = '00000000-0000-0000-0000-000000000001'
   and pc.is_active = true
on conflict (pricing_config_id, code) do nothing;

-- ============================================================================
-- 12. Verification queries (run after seeding to confirm)
-- ============================================================================
-- Verify tenant count
do $$ begin
    assert (select count(*) from public.tenants) >= 1, 'Tenant not seeded';
    assert (select count(*) from public.roles) = 11, 'Expected 11 roles';
    assert (select count(*) from public.permissions) >= 50, 'Expected ~50 permissions';
    assert (select count(*) from public.academic_levels where tenant_id = '00000000-0000-0000-0000-000000000001') = 14, 'Expected 14 academic levels';
    assert (select count(*) from public.expense_categories where tenant_id = '00000000-0000-0000-0000-000000000001') = 9, 'Expected 9 expense categories';
    assert (select count(*) from public.departments where tenant_id = '00000000-0000-0000-0000-000000000001') = 4, 'Expected 4 departments';
    assert (select count(*) from public.grade_level_tuition) = 14, 'Expected 14 grade-level tuitions';
    assert (select count(*) from public.transport_destinations) = 4, 'Expected 4 transport destinations';
    assert (select count(*) from public.discounts) = 5, 'Expected 5 canonical discounts';
end $$;

-- Reference seed data: 1 default tenant, 11 roles, 56 permissions, full
-- role-permission matrix, 14 academic levels, 2026-2027 academic year,
-- 9 expense categories, 4 departments, full pricing config with 14 tuitions
-- + 4 transports + 3 services + 5 discounts.
