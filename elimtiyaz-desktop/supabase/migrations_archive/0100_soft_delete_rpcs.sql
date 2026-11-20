-- ============================================================================
-- 0100_soft_delete_rpcs.sql
-- T-384 / RLS-500 — the canonical CRM soft-delete RPCs (parents + students)
--
-- WHAT (the live-proven defect this fixes):
--   An `UPDATE parents SET deleted_at = <ts>` (or the students equivalent)
--   through PostgREST is IMPOSSIBLE for every authenticated caller — even
--   super_admin — with 42501 "new row violates row-level security policy".
--   ROOT CAUSE (reproduced live, 74th session, both directions): the staff
--   SELECT policies (0019 parents_select / students_select) carry
--   `deleted_at IS NULL`, and PostgreSQL folds the applicable SELECT-policy
--   predicates into the UPDATE path (visibility + the effective WITH CHECK
--   side) — the NEW row with deleted_at set can never satisfy them. The
--   bisection: with parents_update alone the UPDATE passes; add
--   parents_select back → 42501 (same for students). This has been true
--   since 0019 but DORMANT — no client ever wrote deleted_at via PostgREST
--   before T-381/T-384 surfaced the removal buttons (deleteStudent /
--   deleteParent had zero UI callers).
--
-- WHY AN RPC (not a policy change):
--   Removing `deleted_at IS NULL` from the SELECT policies would resurrect
--   soft-deleted rows in every staff list — a catastrophic behavior change.
--   The canonical house pattern for "a mutation RLS cannot express" is a
--   SECURITY DEFINER RPC (the 0077 notify_parent_user / 0096 placement
--   precedent): explicit tenant scoping, explicit role gate, explicit
--   guards, audited server-side. The desktop repository switches to
--   rpc("soft_delete_parent"/"soft_delete_student") in the same change.
--
-- CONTRACT (both functions, the EF envelope style):
--   soft_delete_parent(p_parent_id uuid) → jsonb
--     {ok:true, deleted_at:<ts>}                            — soft-deleted
--     {ok:false, code:'not_found'}                          — unknown / already-deleted / cross-tenant
--     {ok:false, code:'active_students_exist', count:<n>}   — the PARENT-500 guard (server-side)
--     {ok:false, code:'forbidden'}                          — caller is not super_admin
--   soft_delete_student(p_student_id uuid) → jsonb          — same minus the students guard
--
-- GATES (defense in depth, server-side canonical):
--   1. super_admin role (has_role — matches the *_delete RLS policies +
--      the delete-user-account EF precedent; the UI's DeleteParent /
--      DeleteStudent permissions are the presentation-layer gate).
--   2. tenant_id = current_tenant_id() (explicit — SECURITY DEFINER
--      bypasses the RLS that would normally scope this).
--   3. the active-students guard for parents (a parent with NON-deleted
--      enrolled students is refused — their parent_id would dangle at a
--      row every operational stream filters out).
--   4. the UPDATE itself re-checks deleted_at IS NULL (race-safe: a row
--      deleted between the resolve and the update reports not_found).
--
-- AUDIT: one write_audit_log entry per successful deletion
--   (parent.delete / student.delete — the wire codes the desktop mock has
--   always written; the intent record). The 0086 audit_row_change trigger
--   ADDITIONALLY writes its own entity.update mechanism entry with the
--   before/after snapshots — both honest, neither suppressed.
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DDL
-- for the Management-API live application; idempotent via ON CONFLICT).
-- ============================================================================

create or replace function public.soft_delete_parent(p_parent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row        public.parents%rowtype;
    v_active_kids integer;
begin
    -- Gate 1 — super_admin (the parents_delete RLS mirror).
    if not public.has_role('super_admin') then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;

    -- Resolve + Gate 2 — tenant scope (404 semantics for unknown/cross-tenant).
    select p.* into v_row
      from public.parents p
     where p.id = p_parent_id
       and p.deleted_at is null
       and p.tenant_id = public.current_tenant_id();
    if not found then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;

    -- Gate 3 — the active-students guard (PARENT-500's core rule, canonical).
    select count(*) into v_active_kids
      from public.students s
     where s.parent_id = p_parent_id
       and s.tenant_id = v_row.tenant_id
       and s.deleted_at is null;
    if v_active_kids > 0 then
        return jsonb_build_object('ok', false, 'code', 'active_students_exist',
                                   'count', v_active_kids);
    end if;

    -- Gate 4 — the soft-delete itself, re-checking deleted_at (race-safe).
    update public.parents
       set deleted_at = now(),
           is_active  = false
     where id = p_parent_id
       and deleted_at is null;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;

    -- The intent record (the 0086 trigger adds the mechanism entry).
    perform public.write_audit_log(
        p_tenant_id   := v_row.tenant_id,
        p_action      := 'parent.delete',
        p_entity_type := 'parent',
        p_entity_id   := v_row.id,
        p_actor_id    := public.current_user_profile_id(),
        p_before_json := to_jsonb(v_row) - 'updated_at',
        p_after_json  := null,
        p_note        := 'Suppression logique (T-384 / soft_delete_parent) — l''historique financier est conservé'
    );

    return jsonb_build_object('ok', true, 'deleted_at', now());
end;
$$;

comment on function public.soft_delete_parent is
    'T-384 / RLS-500: canonical parent soft-delete (deleted_at + is_active=false) — super_admin-gated, tenant-scoped, active-students-guarded, audited. A plain PostgREST UPDATE on deleted_at is RLS-impossible (the SELECT policies fold deleted_at IS NULL into the UPDATE check).';

create or replace function public.soft_delete_student(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.students%rowtype;
begin
    -- Gate 1 — super_admin (the students_delete RLS mirror).
    if not public.has_role('super_admin') then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;

    -- Resolve + Gate 2 — tenant scope.
    select s.* into v_row
      from public.students s
     where s.id = p_student_id
       and s.deleted_at is null
       and s.tenant_id = public.current_tenant_id();
    if not found then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;

    -- The soft-delete (students carry no children — no guard needed).
    update public.students
       set deleted_at = now(),
           is_active  = false
     where id = p_student_id
       and deleted_at is null;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;

    -- The intent record (the 0086 trigger adds the mechanism entry).
    perform public.write_audit_log(
        p_tenant_id   := v_row.tenant_id,
        p_action      := 'student.delete',
        p_entity_type := 'student',
        p_entity_id   := v_row.id,
        p_actor_id    := public.current_user_profile_id(),
        p_before_json := to_jsonb(v_row) - 'updated_at',
        p_after_json  := null,
        p_note        := 'Suppression logique (T-381/T-384 / soft_delete_student) — l''historique financier et les archives sont conservés'
    );

    return jsonb_build_object('ok', true, 'deleted_at', now());
end;
$$;

comment on function public.soft_delete_student is
    'T-381/T-384 / RLS-500: canonical student soft-delete — super_admin-gated, tenant-scoped, audited. Fixes the RLS-impossible plain UPDATE path the deleteStudent repository call used.';

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the Management-API apply embeds
-- this statement so the DDL and the registration land in ONE atomic
-- transaction; kept here so a fresh CLI deployment registers identically.
-- ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0100', '{0100_soft_delete_rpcs.sql}', 'soft_delete_rpcs')
on conflict (version) do nothing;
