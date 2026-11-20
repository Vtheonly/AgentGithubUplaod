-- 0105_personnel_worker_chat_channel_access.sql
-- Personnel workforce parity (T-400): the WORKER-side direct chat.
--
-- PROBLEM (live-proven by scripts/t-400-personnel-e2e.py, 2026-09-21):
--   the Personnel worker dashboard's "message the supervisor" action calls
--   the canonical create_direct_channel RPC (0061) as the WORKER — and the
--   RPC's staff gate lists only super_admin / manager / support_staff /
--   financial_officer / teacher, so every employee holding the workforce
--   roles (worker, buyer, driver, warehouse_worker) gets HTTP 403
--   "only staff may create chat channels".
--
-- INTENT (0061 header + ADR-008): the gate exists to keep EXTERNAL users
--   (parents — "read+reply by design", and students) from initiating
--   channels. The workforce roles are EMPLOYEE roles (personnel-linked
--   staff); excluding them was an oversight of the 0061 role list, not a
--   security boundary. Parents keep their dedicated 0067
--   open_parent_admin_channel() path and remain excluded here.
--
-- CHANGE: widen the gate to the full staff role set (the 0023 census minus
--   parent/student). Everything else in the RPC is byte-identical to 0061
--   (idempotent deterministic DM code, member verification, audit row).
--   CREATE OR REPLACE with the SAME signature — no overload is created
--   (the §15.32a trap does not apply).

create or replace function public.create_direct_channel(
    p_other_profile_id uuid,
    p_name text default null
)
returns public.chat_channels
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me     uuid := public.current_user_profile_id();
    v_tenant uuid := public.current_tenant_id();
    v_a      uuid;
    v_b      uuid;
    v_code   text;
    v_ch     public.chat_channels;
begin
    if v_me is null then
        raise exception 'create_direct_channel: no user profile for the caller (auth.uid() has no user_profiles row)'
            using errcode = '42501';
    end if;
    if v_tenant is null then
        raise exception 'create_direct_channel: caller has no tenant (global admins must act inside a tenant context)'
            using errcode = '42501';
    end if;
    -- T-400: the full STAFF role set (0023 census minus parent/student) —
    -- the workforce employee roles are staff; parents stay read+reply by
    -- design (their path is open_parent_admin_channel, 0067).
    if not public.has_any_role(array[
        'super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher',
        'worker', 'buyer', 'driver', 'warehouse_worker'
    ]) then
        raise exception 'create_direct_channel: only staff may create chat channels (parents are read+reply by design)'
            using errcode = '42501';
    end if;
    if p_other_profile_id is null or p_other_profile_id = v_me then
        raise exception 'create_direct_channel: p_other_profile_id must be a different profile from the caller'
            using errcode = '22023';
    end if;
    -- The other member must be a real profile of the same tenant (or a
    -- global-admin profile). Guards against fabricated member ids.
    if not exists (
        select 1 from public.user_profiles up
         where up.id = p_other_profile_id
           and (up.tenant_id = v_tenant or up.tenant_id is null)
    ) then
        raise exception 'create_direct_channel: other profile not found in the caller''s tenant'
            using errcode = '22023';
    end if;

    v_a := least(v_me, p_other_profile_id);
    v_b := greatest(v_me, p_other_profile_id);
    v_code := 'DM-' || v_a || '-' || v_b;

    insert into public.chat_channels (
        tenant_id, code, name, channel_type, member_ids, created_by, description
    ) values (
        v_tenant, v_code, coalesce(nullif(btrim(p_name), ''), 'Direct'), 'direct',
        array[v_a, v_b], v_me, null
    )
    on conflict (tenant_id, code) do nothing
    returning * into v_ch;

    if v_ch is null then
        -- Already exists (idempotent re-open by either member of the pair).
        select * into v_ch
          from public.chat_channels
         where tenant_id = v_tenant and code = v_code;
    end if;

    if v_ch is null then
        raise exception 'create_direct_channel: channel vanished after upsert'
            using errcode = '22023';
    end if;

    -- Audit the creation (mock parity: chat.channel_create; convention 0014).
    if v_ch.created_by = v_me then
        insert into public.audit_logs (
            tenant_id, action, entity_type, entity_id, actor_id, after_json, note
        ) values (
            v_tenant, 'chat.channel_create', 'chat_channel', v_ch.id, v_me,
            to_jsonb(v_ch), 'create_direct_channel (idempotent RPC)'
        );
    end if;

    return v_ch;
end;
$$;

comment on function public.create_direct_channel is
  'CHAT-103 canonical path: idempotent 1:1 direct channel creation, staff-only (T-400: the full employee role set — worker/buyer/driver/warehouse_worker included; parents remain read+reply by design via 0067). Deterministic code from the sorted member pair (same pair always maps to the same channel). SECURITY DEFINER with full caller verification (staff gate + target-exists + fixed direct type) — see migration header; returns only a channel the caller belongs to.';

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the Management-API apply
-- embeds this statement so the DDL and the registration land in ONE atomic
-- transaction; kept here so a fresh CLI deployment registers identically.
-- ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0105', '{0105_personnel_worker_chat_channel_access.sql}', 'personnel_worker_chat_channel_access')
on conflict (version) do nothing;
