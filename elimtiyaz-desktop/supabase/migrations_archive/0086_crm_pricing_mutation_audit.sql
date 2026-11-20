-- ============================================================================
-- 0086_crm_pricing_mutation_audit.sql
-- ============================================================================
-- T-306 (48th session, 2026-09-12) — row-level audit triggers for CRM +
-- pricing entity tables.
--
-- OWNER REPORT (the trigger's reason to exist):
--   "I changed a name and a price, but nothing changed in the audit."
--   Supabase-mode desktop edits go through direct PostgREST UPDATEs on
--   parents / students, and pricing edits stayed on the mock layer — none of
--   them called write_audit_log, and NO trigger existed on those tables, so
--   audit_logs carried ZERO entity-mutation rows while the owner was testing.
--
-- DESIGN (ADR-017 decision record lives in docs/decisions/):
--   - ONE shared trigger function (public.audit_row_change) — no per-table
--     duplicates (the zero-duplication doctrine).
--   - SERVER-SIDE on purpose: the same audit coverage lands for desktop
--     PostgREST edits, Android upsert-RPC pushes, the Excel importer and any
--     future writer — a client-side audit.log() call per repository would
--     have to be re-implemented on every platform (the exact DUP-class
--     damage this codebase keeps accumulating).
--   - Full row snapshots: to_jsonb(OLD)/to_jsonb(NEW) — plan §12 "before_json
--     / after_json must be COMPLETE, never truncated".
--   - Actor attribution: current_user_profile_id() + display_name + primary
--     active role, resolved INSIDE the trigger (auth.uid() context). No auth
--     context (service-role import/seed jobs) → actor 'System'.
--   - No-op guard: an UPDATE that changes nothing except updated_at (the
--     touch_updated_at trigger's own write) is skipped — one audit entry per
--     REAL mutation, not per touch.
--   - Financial RPC-covered tables (payments / ledger_entries /
--     installments) are deliberately NOT triggered: their canonical RPCs
--     (migrations 0022/0025/0034+) already write their own audit entries —
--     triggering them would double-count every payment operation.
--   - audit_logs INSERT fires no trigger (0014 blocks only UPDATE/DELETE),
--     so there is no recursion.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The shared row-level audit trigger function
-- ----------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entity   text;
    v_action   text;
    v_entity_id uuid;
    v_tenant   uuid;
    v_actor_id  uuid;
    v_actor_name text;
    v_actor_role text;
    v_before   jsonb;
    v_after    jsonb;
    v_row      jsonb;
begin
    -- Snapshots (updated_at stripped — the touch trigger always rewrites it).
    if TG_OP = 'UPDATE' then
        v_before := to_jsonb(OLD) - 'updated_at';
        v_after  := to_jsonb(NEW) - 'updated_at';
        -- No-op guard: only the touch timestamp changed → not a mutation.
        if v_before is not distinct from v_after then
            return null;
        end if;
    elsif TG_OP = 'INSERT' then
        v_before := null;
        v_after  := to_jsonb(NEW) - 'updated_at';
    else -- DELETE
        v_before := to_jsonb(OLD) - 'updated_at';
        v_after  := null;
    end if;

    v_row := case TG_OP when 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

    -- Entity + action mapping (AuditActions wire-code style: entity.action).
    v_entity := (case TG_TABLE_NAME
        when 'parents'                   then 'parent'
        when 'students'                  then 'student'
        when 'pricing_configs'           then 'pricing_config'
        when 'grade_level_tuition'       then 'pricing_grade'
        when 'transport_destinations'    then 'pricing_transport'
        when 'complementary_services'    then 'pricing_complementary_service'
        when 'additional_services'       then 'pricing_additional_service'
        when 'discounts'                 then 'pricing_discount'
        else TG_TABLE_NAME
    end);
    v_action := v_entity || '.' ||
        (case TG_OP when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end);

    v_entity_id := (v_row ->> 'id')::uuid;

    -- Tenant resolution: CRM rows carry tenant_id; pricing children resolve
    -- through their pricing_config.
    if TG_TABLE_NAME in ('parents', 'students', 'pricing_configs') then
        v_tenant := (v_row ->> 'tenant_id')::uuid;
    else
        v_tenant := (select pc.tenant_id
                       from public.pricing_configs pc
                      where pc.id = (v_row ->> 'pricing_config_id')::uuid);
    end if;
    if v_tenant is null then
        v_tenant := public.current_tenant_id();
    end if;
    -- Defensive: an unresolvable tenant must NEVER roll back the business
    -- write — skip the audit row and warn (observable in Postgres logs).
    if v_tenant is null then
        raise warning 'audit_row_change: tenant unresolvable for % %', TG_OP, TG_TABLE_NAME;
        return null;
    end if;

    -- Actor attribution (auth context; NULL under service-role jobs).
    select id into v_actor_id
      from public.user_profiles
     where auth_user_id = auth.uid()
     limit 1;
    if v_actor_id is not null then
        select coalesce(display_name, email) into v_actor_name
          from public.user_profiles
         where id = v_actor_id;
        select r.code into v_actor_role
          from public.role_assignments ra
          join public.roles r on r.id = ra.role_id
         where ra.user_profile_id = v_actor_id
           and ra.revoked_at is null
         order by r.code
         limit 1;
    else
        v_actor_name := 'System';
        v_actor_role := null;
    end if;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := v_action,
        p_entity_type := v_entity,
        p_entity_id   := v_entity_id,
        p_actor_id    := v_actor_id,
        p_actor_name  := v_actor_name,
        p_actor_role  := v_actor_role,
        p_before_json := v_before,
        p_after_json  := v_after,
        p_note        := 'Capture automatique (déclencheur ' || TG_OP || ' sur ' || TG_TABLE_NAME || ')'
    );

    return null;
end;
$$;

comment on function public.audit_row_change is
    'T-306: shared row-level audit trigger — writes a write_audit_log entry (full before/after snapshots + actor attribution) for every real INSERT/UPDATE/DELETE on the CRM + pricing entity tables. No-op updates (touch-only) are skipped.';

-- ----------------------------------------------------------------------------
-- 2. Remove the BROKEN touch triggers on the pricing child tables
-- ----------------------------------------------------------------------------
-- DISCOVERY (48th session, live evidence): grade_level_tuition and
-- transport_destinations have NO updated_at / created_at columns (0006 never
-- added them), yet 0006 §8 wired touch_updated_at BEFORE UPDATE triggers on
-- both — every UPDATE on those tables has ALWAYS raised
-- 'record "new" has no field "updated_at"'. No client ever hit it because no
-- client ever wrote to these tables (the desktop pricing slot stayed on the
-- mock layer). The moment T-307's pricing port lands, every price edit would
-- have exploded on this fossil. The audit rows carry the mutation time
-- (audit_logs.occurred_at), so the broken relics are simply dropped.
drop trigger if exists grade_level_tuition_touch_updated_at on public.grade_level_tuition;
drop trigger if exists transport_destinations_touch_updated_at on public.transport_destinations;

-- ----------------------------------------------------------------------------
-- 2b. Widen discounts.code to the domain DiscountCode union
-- ----------------------------------------------------------------------------
-- The domain model (src/domain/model/pricing.ts DiscountCode) + the mock
-- repository + the discounts-card UI all support sibling_10 / sibling_15 /
-- early_bird / custom codes; 0006's CHECK admitted only the 5 canonical
-- codes, so the moment T-307's pricing port routes addDiscount() to the
-- table, every custom-code insert would 500 on the constraint. The union is
-- aligned (still a CHECK — not unconstrained text).
alter table public.discounts drop constraint if exists discounts_code_check;
alter table public.discounts add constraint discounts_code_check check (code in (
    'passage_palier', 'seniority_5y', 'full_annual',
    'highest_average', 'sibling_fixed', 'sibling_10',
    'sibling_15', 'early_bird', 'custom'
));

-- ----------------------------------------------------------------------------
-- 3. Trigger wiring — one per audited table, all to the ONE function
-- ----------------------------------------------------------------------------
create trigger parents_audit_row_change
    after insert or update or delete on public.parents
    for each row execute function public.audit_row_change();

create trigger students_audit_row_change
    after insert or update or delete on public.students
    for each row execute function public.audit_row_change();

create trigger pricing_configs_audit_row_change
    after insert or update or delete on public.pricing_configs
    for each row execute function public.audit_row_change();

create trigger grade_level_tuition_audit_row_change
    after insert or update or delete on public.grade_level_tuition
    for each row execute function public.audit_row_change();

create trigger transport_destinations_audit_row_change
    after insert or update or delete on public.transport_destinations
    for each row execute function public.audit_row_change();

create trigger complementary_services_audit_row_change
    after insert or update or delete on public.complementary_services
    for each row execute function public.audit_row_change();

create trigger additional_services_audit_row_change
    after insert or update or delete on public.additional_services
    for each row execute function public.audit_row_change();

create trigger discounts_audit_row_change
    after insert or update or delete on public.discounts
    for each row execute function public.audit_row_change();
