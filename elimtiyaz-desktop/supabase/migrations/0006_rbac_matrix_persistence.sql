-- ============================================================================
-- 0006_rbac_matrix_persistence.sql
-- T-588 (ROADMAP 5.19 / EXECUTION-PLAN §4 E6.19) — the RBAC matrix
-- persistence completion (BUG-017 / SET-U5) + the permission-catalog
-- completion.
--
-- WHAT:
--   (1) The 41 desktop-enum permission codes the server catalog never
--       carried (the T-266/AI-309 class of drift — SuperAdmin needed a
--       client-side "stamp" repair precisely because codes like
--       use_ai/manage_ai_config could not be granted server-side). Seeded
--       idempotently (ON CONFLICT DO NOTHING, deterministic UUIDv5 ids).
--   (1b) The SuperAdmin default-grant completion: the 41 codes join
--       super_admin's role_permissions DEFAULTS (grants only — the
--       documented T-266 "SuperAdmin is unrestricted" invariant, now
--       server-side too). No OTHER role's defaults change; no existing
--       permission row is modified.
--   (2) read_rbac_effective_matrix() — the tenant-scoped, deny-wins
--       effective matrix (role_permissions defaults MINUS deny overrides
--       PLUS grant overrides) for EVERY role, so the Settings → RBAC
--       editor displays the matrix the server actually enforces instead
--       of the desktop's fictional DEFAULT_ROLE_PERMISSIONS baseline.
--   (3) save_rbac_matrix(p_matrix jsonb) — the ONE transactional write
--       path. Payload shape (per role):
--           {"teacher": {"granted": ["view_roster", ...],
--                        "denied":  ["manage_pricing", ...]}, ...}
--       The two lists carry the EDITOR's whole managed vocabulary for that
--       role: for every listed (role, code) cell the RPC compares the
--       DESIRED state against the role_permissions default and writes ONLY
--       the differing cells as tenant_role_overrides rows (grant when
--       desired=true/default=false, deny when desired=false/default=true),
--       deleting any override row where desired == default. Codes NOT
--       listed (the legacy server vocabulary outside the desktop enum)
--       are left untouched — a save can never silently strip a legacy
--       default grant it does not display. Fail-loud on unknown
--       roles/codes and on a granted/denied contradiction (zero silent
--       drops). SECURITY INVOKER: the existing tenant_role_overrides_admin
--       RLS policy (super_admin + tenant scope) is the enforcement; the
--       RPC additionally refuses non-super_admin callers explicitly.
--   (4) reset_rbac_matrix() — deletes the tenant's whole override set
--       (Réinitialiser), same gates.
--
-- WHY (BUG-017): the matrix editor previously persisted to localStorage
-- only — a placebo: NOTHING on the enforcement path (current_user_
-- permissions / RLS) ever read that key, so a SuperAdmin editing the
-- matrix changed nothing real. tenant_role_overrides existed since the
-- consolidated baseline with its deny-wins resolver wired into
-- current_user_permissions(), but no writer ever existed.
--
-- SCOPE FENCE (deliberately NOT here): the DB role_permissions default
-- matrix still speaks a LEGACY vocabulary for part of its grants
-- (view_students vs view_roster, assign_tasks vs manage_tasks,
-- settle_expense vs settle_expense_proof, push_homework vs
-- assign_homework, ...). Aligning the DEFAULT matrix with the desktop
-- enum changes effective permissions for every existing user and is a
-- security-sensitive behavioral change — registered separately, not
-- folded into this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) The permission-catalog completion (41 codes, idempotent)
-- ----------------------------------------------------------------------------
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('08f0e915-63e4-5437-b56b-eeb62479f8c3', 'create_student', 'Créer un élève', null, null, 'crm', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 105, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('b42996b2-f379-5ee9-81da-382ec8d12281', 'edit_student', 'Modifier un élève', null, null, 'crm', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 106, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('83365b31-58b7-57bf-8310-02d79e89ef04', 'delete_student', 'Supprimer un élève', null, null, 'crm', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 107, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('ad1416c5-2c5b-51c7-9ed6-7edb95d80a8b', 'promote_student', 'Promouvoir un élève', null, null, 'crm', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 110, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('58c4d1a8-e2f1-5702-bb4e-a7dc3abc6ce8', 'manage_classes', 'Gérer les classes', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 203, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('45806fbd-a80e-5c1a-9b70-94bd6e707a3d', 'assign_homework', 'Diffuser un devoir', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 204, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('86d5a5e7-090d-5055-8f25-de9f94ea5ae5', 'view_attendance', 'Consulter l''assiduité', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 208, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('84cb449d-f388-5fde-a131-75b92e4d83ee', 'manage_school_years', 'Gérer les années scolaires', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 210, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('5c530d86-63c1-50ee-a861-9a4abd2f0df9', 'view_clubs', 'Consulter les clubs', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 220, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('2d348db5-f29c-55e9-a6bb-5fe3b909447b', 'manage_clubs', 'Gérer les clubs', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 221, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('310bb31c-418f-5e4a-9404-43c83890c448', 'enroll_club_members', 'Inscrire aux clubs', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 222, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('9ed8eb0a-75c7-5c14-802b-e1140f99562d', 'log_club_activities', 'Pointer les activités de club', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 223, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('495ba21a-5bef-5f1f-b9dc-7ed88b8cb93a', 'view_psychology', 'Consulter le suivi psychologique', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 240, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('caae59d2-0eec-593e-b85d-d0c63f0c7d0c', 'manage_psychology', 'Gérer le suivi psychologique', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 241, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('a5009e00-8a08-54b8-84e1-bf98dceed988', 'conduct_psychology_session', 'Mener une séance de psychologie', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 242, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('f88e3157-e01c-5419-99f6-ce79c91745c2', 'create_psychology_report', 'Rédiger un rapport psychologique', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 243, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('472d205e-e1c8-5446-a162-ac7b2e8b0279', 'view_orthophonie', 'Consulter l''orthophonie', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 250, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('0ca9694c-7501-54b8-89ed-268f5a8a23f1', 'manage_orthophonie', 'Gérer l''orthophonie', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 251, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('bf990da8-5d14-5c30-8b85-be41ca30592b', 'conduct_orthophonie_session', 'Mener une séance d''orthophonie', null, null, 'academic', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 252, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('ffc5a66d-96fb-56b0-9faa-e5b525b80a37', 'generate_receipt', 'Générer un reçu', null, null, 'financial', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 305, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('ee67e3aa-71f9-5742-9eba-66b44feea420', 'adjust_account', 'Ajuster un compte', null, null, 'financial', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 306, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('50f25785-713e-5275-beca-b0848519ffb3', 'send_reminder', 'Envoyer un rappel', null, null, 'financial', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 307, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('00ff56cb-6590-5b43-8d7e-8049b0dab6f4', 'settle_expense_proof', 'Téléverser un justificatif', null, null, 'financial', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 308, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('b02ad664-58ab-50a3-bf62-ead25c567a00', 'disburse_expense', 'Décaisser une dépense', null, null, 'financial', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 309, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('165cc64d-5f73-5a85-a15c-0f9bafbdbe11', 'clock_in_out', 'Pointer (arrivée/départ)', null, null, 'hr', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 500, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('fe8a59d2-7918-596d-bc83-f07d5057ad00', 'view_salary', 'Consulter les salaires', null, null, 'hr', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 505, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('54df9dbb-4b83-5149-9c06-c491ea702a7a', 'approve_requests', 'Approuver les demandes', null, null, 'operations', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1100, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('812dc1dc-3530-547c-8921-3d9f3d7fa471', 'submit_requests', 'Soumettre des demandes', null, null, 'operations', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1101, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('e8d88fb5-ba66-5afd-b4d9-f4597ebd0713', 'manage_purchase_requests', 'Gérer les demandes d''achat', null, null, 'operations', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1102, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('854814f0-dbba-59a9-b45f-a52626361f8d', 'manage_deliveries', 'Gérer les livraisons', null, null, 'operations', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1105, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('c28b55eb-ed7e-54d4-b043-fcf542a92891', 'view_departments', 'Consulter les départements', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1203, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('e83ba3f5-04a6-5589-b73b-9d08a00545ec', 'manage_employee_profiles', 'Gérer les fiches employés', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1204, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('05810a62-3d7c-5c62-aa37-b2d37f4f0791', 'manage_schedules', 'Gérer les plannings', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1205, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('4f6079db-8d76-54e5-8995-5c4ae6f4c48f', 'view_performance', 'Consulter la performance', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1206, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('fd19525b-0a1d-5d97-a473-d9909ec80eda', 'manage_performance', 'Gérer la performance', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1207, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('17776351-ec24-57e1-b1fb-dc51b0eb2725', 'manage_tasks', 'Gérer les tâches', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1208, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('95d34553-8f9d-583a-926c-74be225b3eb1', 'update_task_status', 'Mettre à jour les tâches', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1209, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('92a8ef5e-afa9-5b02-912b-19b1dd5c3745', 'view_workforce_reports', 'Consulter les rapports RH', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1212, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('fb196451-0a45-5fcb-91f7-4702fdd21f83', 'use_chat', 'Utiliser la messagerie', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1300, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('1c589226-a501-5c7d-8a46-51a00f8d07a3', 'manage_chat_channels', 'Gérer les canaux', null, null, 'workforce', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1301, now())
on conflict do nothing;
insert into public.permissions (id, code, label_fr, label_ar, label_en, domain, description, sort_order, created_at) values
  ('f83afa0a-26c9-5382-9a2c-a09b937b1e50', 'manage_tenants', 'Gérer les tenants', null, null, 'settings', 'T-588: absent du catalogue serveur depuis la seed initiale — complété depuis l''enum desktop', 1504, now())
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- (1b) The SuperAdmin default-grant completion (additive, invariant-true).
-- The documented client invariant (T-266/AI-309: "SuperAdmin is
-- unrestricted") now holds SERVER-SIDE too: the 41 newly-cataloged codes
-- join super_admin's role_permissions DEFAULTS (grants only — nothing is
-- ever removed, and no OTHER role's defaults change). RLS policies
-- currently gate on has_role, not per-permission, so this changes no
-- live policy outcome — it makes current_user_permissions() and the
-- effective matrix coherent with the client stamp instead of relying
-- on it.
-- ----------------------------------------------------------------------------
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = any(array[
    'create_student','edit_student','delete_student','promote_student',
    'manage_classes','assign_homework','view_attendance','manage_school_years',
    'view_clubs','manage_clubs','enroll_club_members','log_club_activities',
    'view_psychology','manage_psychology','conduct_psychology_session','create_psychology_report',
    'view_orthophonie','manage_orthophonie','conduct_orthophonie_session',
    'generate_receipt','adjust_account','send_reminder','settle_expense_proof','disburse_expense',
    'clock_in_out','view_salary','approve_requests','submit_requests',
    'manage_purchase_requests','manage_deliveries','view_departments','manage_employee_profiles',
    'manage_schedules','view_performance','manage_performance','manage_tasks','update_task_status',
    'view_workforce_reports','use_chat','manage_chat_channels','manage_tenants'
])
where r.code = 'super_admin'
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- (2) read_rbac_effective_matrix — the tenant-scoped effective matrix
-- ----------------------------------------------------------------------------
create or replace function public.read_rbac_effective_matrix()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
    -- Effective matrix per role = role_permissions defaults
    -- MINUS deny overrides PLUS grant overrides (deny wins), tenant-scoped
    -- (current_tenant_id()) — the SAME resolution current_user_permissions()
    -- applies to the caller's own roles, lifted to every role.
    select coalesce(
        jsonb_object_agg(
            r.code,
            (
                select coalesce(jsonb_agg(distinct p.code order by p.code), '[]'::jsonb)
                from (
                    select p.code
                    from role_permissions rp
                    join permissions p on p.id = rp.permission_id
                    where rp.role_id = r.id
                      and p.code not in (
                          select p2.code
                          from tenant_role_overrides o
                          join permissions p2 on p2.id = o.permission_id
                          where o.tenant_id = public.current_tenant_id()
                            and o.role_id = r.id
                            and o.action = 'deny'
                      )
                    union
                    select p3.code
                    from tenant_role_overrides o3
                    join permissions p3 on p3.id = o3.permission_id
                    where o3.tenant_id = public.current_tenant_id()
                      and o3.role_id = r.id
                      and o3.action = 'grant'
                ) p
            )
        ),
        '{}'::jsonb
    )
    from roles r;
$function$
;

comment on function read_rbac_effective_matrix() is 'T-588/BUG-017: the tenant-scoped effective role x permission matrix (defaults - denies + grants) the RBAC editor displays. Mirrors current_user_permissions() resolution exactly.';

-- ----------------------------------------------------------------------------
-- (3) save_rbac_matrix — the ONE transactional override write path
-- ----------------------------------------------------------------------------
create or replace function public.save_rbac_matrix(p_matrix jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
    v_role_code text;
    v_perm_code text;
    v_desired boolean;
    v_role_id uuid;
    v_perm_id uuid;
    v_default_granted boolean;
    v_deleted int;
    v_saved int := 0;
    v_removed int := 0;
    v_tenant uuid := public.current_tenant_id();
    v_actor uuid := public.current_user_profile_id();
begin
    -- Fail-closed: only a tenant SuperAdmin may rewrite the override set.
    -- (RLS on tenant_role_overrides enforces the same — this makes the
    -- refusal explicit and testable instead of a silent zero-row write.)
    if not public.has_role('super_admin') then
        raise exception 'rbac.matrix.forbidden: seul un Super Administrateur peut modifier la matrice'
            using errcode = '42501';
    end if;
    if v_tenant is null then
        raise exception 'rbac.matrix.no_tenant: aucun tenant actif pour cet appel'
            using errcode = '23502';
    end if;
    if p_matrix is null or jsonb_typeof(p_matrix) <> 'object' then
        raise exception 'rbac.matrix.bad_payload: p_matrix doit etre un objet {role_code: {granted: [], denied: []}}'
            using errcode = '22P02';
    end if;

    -- Upfront shape validation (fail-loud): every role value must be an
    -- object carrying BOTH lists as arrays.
    if exists (
        select 1
        from jsonb_each(p_matrix) as e(k, v)
        where jsonb_typeof(v) <> 'object'
           or (v -> 'granted') is null
           or jsonb_typeof(v -> 'granted') <> 'array'
           or (v -> 'denied') is null
           or jsonb_typeof(v -> 'denied') <> 'array'
    ) then
        raise exception 'rbac.matrix.bad_payload: chaque role doit etre {granted: [], denied: []} (tableaux)'
            using errcode = '22P02';
    end if;

    -- Upfront contradiction check: a code listed on BOTH sides is refused
    -- BEFORE any write (the whole transaction must be atomic).
    if exists (
        select 1
        from jsonb_each(p_matrix) as e(k, v)
        cross join lateral jsonb_array_elements_text(v -> 'granted') as g(code)
        join lateral jsonb_array_elements_text(v -> 'denied') as d(code) on d.code = g.code
    ) then
        raise exception 'rbac.matrix.contradiction: un code figure a la fois dans granted et denied'
            using errcode = '22P02';
    end if;

    for v_role_code, v_perm_code, v_desired in
        select e.key as role_code, lst.code as perm_code, lst.desired
        from jsonb_each(p_matrix) as e
        cross join lateral (
            select j.code, true as desired
            from jsonb_array_elements_text(e.value -> 'granted') as j(code)
            union all
            select j.code, false as desired
            from jsonb_array_elements_text(e.value -> 'denied') as j(code)
        ) as lst
    loop
        -- resolve ids (fail-loud: an unknown role or code aborts the WHOLE
        -- transaction — zero silent drops, zero partial saves)
        select id into v_role_id from roles where code = v_role_code;
        if v_role_id is null then
            raise exception 'rbac.matrix.unknown_role: %', v_role_code using errcode = '23503';
        end if;
        select id into v_perm_id from permissions where code = v_perm_code;
        if v_perm_id is null then
            raise exception 'rbac.matrix.unknown_permission: %', v_perm_code using errcode = '23503';
        end if;

        select exists (
            select 1 from role_permissions rp
            where rp.role_id = v_role_id and rp.permission_id = v_perm_id
        ) into v_default_granted;

        if v_desired = v_default_granted then
            -- desired == default: no override needed — drop any stale row
            delete from tenant_role_overrides
            where tenant_id = v_tenant and role_id = v_role_id and permission_id = v_perm_id;
            get diagnostics v_deleted = row_count;
            v_removed := v_removed + v_deleted;
        else
            -- only write when the action actually CHANGES (an idempotent
            -- re-save must be a pure no-op: no row rewrite, no actor stamp)
            insert into tenant_role_overrides (tenant_id, role_id, permission_id, action, created_by)
            values (v_tenant, v_role_id, v_perm_id,
                    case when v_desired then 'grant' else 'deny' end, v_actor)
            on conflict (tenant_id, role_id, permission_id)
            do update set action = excluded.action, created_by = excluded.created_by
            where tenant_role_overrides.action <> excluded.action;
            get diagnostics v_deleted = row_count;
            v_saved := v_saved + v_deleted;
        end if;
    end loop;

    return jsonb_build_object('saved', v_saved, 'removed', v_removed);
end;
$function$
;

comment on function save_rbac_matrix(p_matrix jsonb) is 'T-588/BUG-017: the transactional RBAC-matrix override write (diff vs role_permissions defaults; deny-wins resolution preserved; unlisted codes untouched). SECURITY INVOKER — the tenant_role_overrides_admin RLS policy enforces super_admin + tenant scope.';

-- ----------------------------------------------------------------------------
-- (4) reset_rbac_matrix — Réinitialiser (drop the whole override set)
-- ----------------------------------------------------------------------------
create or replace function public.reset_rbac_matrix()
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
    v_removed int := 0;
    v_tenant uuid := public.current_tenant_id();
begin
    if not public.has_role('super_admin') then
        raise exception 'rbac.matrix.forbidden: seul un Super Administrateur peut reinitialiser la matrice'
            using errcode = '42501';
    end if;
    if v_tenant is null then
        raise exception 'rbac.matrix.no_tenant: aucun tenant actif pour cet appel'
            using errcode = '23502';
    end if;
    delete from tenant_role_overrides where tenant_id = v_tenant;
    get diagnostics v_removed = row_count;
    return jsonb_build_object('removed', v_removed);
end;
$function$
;

comment on function reset_rbac_matrix() is 'T-588/BUG-017: clears the tenant''s whole tenant_role_overrides set (back to role_permissions defaults). Same super_admin + tenant gates as save_rbac_matrix.';
