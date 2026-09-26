-- ============================================================================
-- verify_t-414.sql — T-414 Task 1 (PRICING-500 / ADR-025), migration 0117.
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; — re-runnable,
-- never mutates. All logic inside a dollar-quoted DO block.
--
-- CHECKS:
--   C1  registration + the one-active-per-tenant partial unique index
--   C2  create_pricing_config_for_year (clone): new config INACTIVE + the
--       five child grids cloned from the active config
--   C3  duplicate creation for the same year → friendly 23505
--   C4  set_active_pricing_config: the atomic switch (target active, sibling
--       deactivated, sibling's PRICES unchanged — historical preservation)
--   C5  the DB-level one-active invariant: a direct second activation UPDATE
--       → unique_violation
--   C6  idempotent activation of the already-active config (no-op, no error)
--   C7  tenant isolation: activating another tenant's config → forbidden
--   C8  role gate: a profile with NO staff roles → forbidden
--   C9  grants: anon revoked, authenticated granted (§15.34)
-- ============================================================================
BEGIN;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t414_results (check_id text, ok boolean, detail text);

DO $$
DECLARE
  v_tenant uuid;
  v_probe_sub uuid := gen_random_uuid();
  v_probe_profile uuid;
  v_nostaff_sub uuid := gen_random_uuid();
  v_nostaff_profile uuid;
  v_year uuid;
  v_active_before public.pricing_configs%rowtype;
  v_new_id uuid;
  v_after public.pricing_configs%rowtype;
  v_hist_before public.pricing_configs%rowtype;
  v_hist_after public.pricing_configs%rowtype;
  v_tuition_active int; v_tuition_new int;
  v_transport_active int; v_transport_new int;
  v_comp_active int; v_comp_new int;
  v_addl_active int; v_addl_new int;
  v_disc_active int; v_disc_new int;
  v_dup_ok boolean := false;
  v_invariant_ok boolean := false;
  v_idem_ok boolean := false;
  v_cross_ok boolean := false;
  v_nostaff_ok boolean := false;
  v_other_tenant uuid;
  v_other_config uuid;
BEGIN
  select id into v_tenant from public.tenants order by created_at limit 1;

  -- Probe profile with super_admin (the pricing write surface's role).
  insert into public.user_profiles (auth_user_id, tenant_id, email, display_name, status)
  values (v_probe_sub, v_tenant, 'probe-t414-verify@el-imtiyaz.test', 'Probe T414', 'active')
  returning id into v_probe_profile;

  insert into public.role_assignments (user_profile_id, tenant_id, role_id)
  values (v_probe_profile, v_tenant, (select id from public.roles where code = 'super_admin'));

  -- No-staff profile (role gate probe).
  insert into public.user_profiles (auth_user_id, tenant_id, email, display_name, status)
  values (v_nostaff_sub, v_tenant, 'probe-t414-nostaff@el-imtiyaz.test', 'Probe T414 NoStaff', 'active')
  returning id into v_nostaff_profile;

  -- C1 ────────────────────────────────────────────────────────────────────
  insert into t414_results (check_id, ok, detail)
  select 'C1-registration-and-index',
    (select count(*) from supabase_migrations.schema_migrations where version = '0117') = 1
    and exists (
      select 1 from pg_indexes
       where schemaname = 'public' and tablename = 'pricing_configs'
         and indexname = 'pricing_configs_one_active_per_tenant'
    ),
    '0117 registered; partial unique index present';

  -- C2: probe academic year + cloned config ───────────────────────────────
  select * into v_active_before
    from public.pricing_configs
   where tenant_id = v_tenant and is_active
   order by updated_at desc limit 1;

  insert into public.academic_years (tenant_id, label, start_date, end_date, term_structure, is_current)
  values (v_tenant, '2098-2099-T414', '2098-09-01', '2099-06-30', 'trimester', false)
  returning id into v_year;

  -- Inside a DO block `SET LOCAL` is unavailable — set_config(..., true)
  -- is the transaction-local equivalent (the §11.1 JWT simulation).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_probe_sub, 'role', 'authenticated', 'aud', 'authenticated')::text,
    true);

  select public.create_pricing_config_for_year(
    p_academic_year_id := v_year,
    p_label := 'Tarification 2098-2099 T414',
    p_clone_from_active := true
  ) into v_new_id;

  select count(*) into v_tuition_active from public.grade_level_tuition
    where pricing_config_id = v_active_before.id;
  select count(*) into v_tuition_new from public.grade_level_tuition
    where pricing_config_id = v_new_id;
  select count(*) into v_transport_active from public.transport_destinations
    where pricing_config_id = v_active_before.id;
  select count(*) into v_transport_new from public.transport_destinations
    where pricing_config_id = v_new_id;
  select count(*) into v_comp_active from public.complementary_services
    where pricing_config_id = v_active_before.id;
  select count(*) into v_comp_new from public.complementary_services
    where pricing_config_id = v_new_id;
  select count(*) into v_addl_active from public.additional_services
    where pricing_config_id = v_active_before.id;
  select count(*) into v_addl_new from public.additional_services
    where pricing_config_id = v_new_id;
  select count(*) into v_disc_active from public.discounts
    where pricing_config_id = v_active_before.id;
  select count(*) into v_disc_new from public.discounts
    where pricing_config_id = v_new_id;

  select * into v_after from public.pricing_configs where id = v_new_id;

  insert into t414_results (check_id, ok, detail)
  values ('C2-create-clone',
    v_new_id is not null
    and v_after.is_active = false
    and v_after.academic_year_id = v_year
    and v_after.label = 'Tarification 2098-2099 T414'
    and v_tuition_new = v_tuition_active
    and v_transport_new = v_transport_active
    and v_comp_new = v_comp_active
    and v_addl_new = v_addl_active
    and v_disc_new = v_disc_active
    -- The ACTIVE config was NOT touched by the creation.
    and v_active_before.is_active = true
    and v_active_before.updated_at = (select updated_at from public.pricing_configs where id = v_active_before.id),
    'new config INACTIVE with all five child grids cloned; active config untouched');

  -- C3: duplicate for the same year ───────────────────────────────────────
  begin
    perform public.create_pricing_config_for_year(
      p_academic_year_id := v_year,
      p_label := 'Duplicate T414',
      p_clone_from_active := false
    );
  exception
    -- The RPC raises errcode 23505 explicitly; either the SQLSTATE or the
    -- friendly message proves the one-config-per-year gate.
    when unique_violation or check_violation then
      v_dup_ok := (sqlstate = '23505');
    when others then
      v_dup_ok := (sqlerrm like '%already exists for academic year%');
  end;
  if not v_dup_ok then
    -- Second chance: the friendly message path.
    begin
      perform public.create_pricing_config_for_year(
        p_academic_year_id := v_year, p_label := 'Duplicate T414', p_clone_from_active := false);
    exception when others then
      v_dup_ok := (sqlerrm like '%already exists%');
    end;
  end if;

  insert into t414_results (check_id, ok, detail)
  values ('C3-duplicate-year', v_dup_ok, 'duplicate creation for the same year rejected');

  -- C4: the activation switch ─────────────────────────────────────────────
  select * into v_hist_before from public.pricing_configs where id = v_active_before.id;

  perform public.set_active_pricing_config(p_config_id := v_new_id);

  select * into v_after from public.pricing_configs where id = v_new_id;
  select * into v_hist_after from public.pricing_configs where id = v_active_before.id;

  insert into t414_results (check_id, ok, detail)
  values ('C4-atomic-switch',
    v_after.is_active = true
    and v_hist_after.is_active = false
    -- HISTORICAL PRESERVATION: the deactivated config keeps its prices —
    -- only is_active/updated_at differ.
    and v_hist_before.label = v_hist_after.label
    and v_hist_before.registration_fee = v_hist_after.registration_fee
    and v_hist_before.second_apron_fee = v_hist_after.second_apron_fee
    and v_hist_before.academic_year_id = v_hist_after.academic_year_id
    and v_tuition_active = (select count(*) from public.grade_level_tuition where pricing_config_id = v_active_before.id),
    'target active; previously active config deactivated with prices unchanged');

  -- C5: DB-level one-active invariant ─────────────────────────────────────
  begin
    update public.pricing_configs set is_active = true
     where id = v_active_before.id;
    -- Should have raised; if it did not, fail.
    insert into t414_results (check_id, ok, detail)
    values ('C5-one-active-invariant', false, 'second activation UPDATE did NOT raise');
  exception when unique_violation then
    v_invariant_ok := true;
    insert into t414_results (check_id, ok, detail)
    values ('C5-one-active-invariant', true, 'direct second activation UPDATE raises unique_violation');
  end;

  -- C6: idempotent activation ─────────────────────────────────────────────
  begin
    perform public.set_active_pricing_config(p_config_id := v_new_id);
    v_idem_ok := (select is_active from public.pricing_configs where id = v_new_id);
  exception when others then
    v_idem_ok := false;
  end;
  insert into t414_results (check_id, ok, detail)
  values ('C6-idempotent-activation', v_idem_ok, 'activating the already-active config is a no-op');

  -- C7: tenant isolation ──────────────────────────────────────────────────
  select id into v_other_tenant from public.tenants
   where id <> v_tenant order by created_at limit 1;
  if v_other_tenant is null then
    insert into public.tenants (name, slug)
    values ('Probe Tenant T414', 'probe-tenant-t414')
    returning id into v_other_tenant;
  end if;
  insert into public.academic_years (tenant_id, label, start_date, end_date, term_structure, is_current)
  values (v_other_tenant, '2098-2099-OTHER-T414', '2098-09-01', '2099-06-30', 'trimester', false)
  returning id into v_year;
  insert into public.pricing_configs (tenant_id, academic_year_id, label, is_active)
  values (v_other_tenant, v_year, 'Other Tenant T414', false)
  returning id into v_other_config;

  begin
    perform public.set_active_pricing_config(p_config_id := v_other_config);
    insert into t414_results (check_id, ok, detail)
    values ('C7-tenant-isolation', false, 'cross-tenant activation did NOT raise');
  exception when others then
    v_cross_ok := (sqlerrm like '%another tenant%');
    insert into t414_results (check_id, ok, detail)
    values ('C7-tenant-isolation', v_cross_ok, 'cross-tenant activation rejected');
  end;

  -- C8: role gate (no staff roles) ────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_nostaff_sub, 'role', 'authenticated', 'aud', 'authenticated')::text,
    true);
  begin
    perform public.set_active_pricing_config(p_config_id := v_new_id);
    insert into t414_results (check_id, ok, detail)
    values ('C8-role-gate', false, 'no-staff activation did NOT raise');
  exception when others then
    v_nostaff_ok := (sqlerrm like '%staff surface%');
    insert into t414_results (check_id, ok, detail)
    values ('C8-role-gate', v_nostaff_ok, 'no-staff-role activation rejected');
  end;

  -- C9: grants ────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}', true);
  insert into t414_results (check_id, ok, detail)
  select 'C9-grants',
    not has_function_privilege('anon', 'public.set_active_pricing_config(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.create_pricing_config_for_year(uuid, text, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.set_active_pricing_config(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.create_pricing_config_for_year(uuid, text, boolean)', 'execute'),
    'anon revoked; authenticated granted';
END
$$;

select check_id, ok, detail from t414_results order by check_id;
select case when bool_and(ok) then 'ALL CHECKS GREEN' else 'FAILURES PRESENT' end as verdict
  from t414_results;

ROLLBACK;
