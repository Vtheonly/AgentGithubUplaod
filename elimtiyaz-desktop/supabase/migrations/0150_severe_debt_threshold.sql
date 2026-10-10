-- ============================================================================
-- 0150_severe_debt_threshold.sql
-- ============================================================================
-- T-502 (DEBT-104, the 153rd session 2026-10-11) — the SEVERE-DEBT edge of
-- the configurable debt risk configuration. NUMBERED 0150: the live chain's
-- 0147/0148/0149 slots are claimed by the CONCURRENT session's live-applied
-- migrations (0147_drift012_correction / 0148_student_narratives /
-- 0149_classes_notes — live-verified 2026-10-11; their files will land in
-- the repo with that session's push), so this task takes the next free
-- number (ADR-001: one chain, no version collisions).
--
-- the configurable debt risk configuration. The Console d'Investigation
-- Opérationnelle's "Créances Critiques" quick query hardcoded
-- `debtAmount >= 40_000` (operational-query-engine.ts OPERATIONAL_PRESETS)
-- — an edge the owner could not move from Settings → Configuration while
-- every sibling edge (grace/yellow/red/active-payer since 0125, the amount
-- bands + the level messages since 0138) was configurable.
--
-- WHAT THIS ADDS (and nothing else — the T-429/0125 + T-469/0138
-- architecture is extended, never duplicated):
--
--   1. ONE new `debt` settings key, seeded for every tenant (idempotent):
--        debt.severe_debt_dzd (default 40 000) — the family outstanding at
--            or above this is a "Créance Critique" in the console's quick
--            query. A SEPARATE dimension from 0138's amount bands (the
--            console's operational triage edge, not the aging display's
--            band). Default 40 000 = the previously hardcoded value (the
--            existing behavior preserved by construction).
--
--   2. `read_debt_aging_thresholds()` RECREATED (the §15.32 pattern for a
--      jsonb return extension — the 0138 body verbatim + the new key):
--      the jsonb gains severeDebtDzd — camelCase parity with the TS
--      `DebtAgingThresholds` extension (the 0111/0133/0138 convention).
--
-- Follows ADR-001: NEW migration only — 0125/0133/0138 are never edited.
--
-- NOTE (the 0138 lesson, applied): the VALUES clause keeps ONE type per
-- column — every default_value literal is TEXT here (the `'40000'`
-- literal converts via the value_type branch, `to_jsonb((v.default_value)
-- ::numeric)` for 'number' rows → JSON NUMBER 40000, the 0125 seed
-- convention). The original 0138 mixed INTEGER and TEXT literals in one
-- VALUES relation and was dead-on-arrival (22P02) — see AGENTS.md §15.83a.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. Seed the severe-debt edge (idempotent)
-- ----------------------------------------------------------------------------
insert into public.system_settings
    (tenant_id, category, key, label_fr, label_en, description_fr, value_type, value,
     is_sensitive, is_required, sort_order, validation_min, validation_max)
select t.tenant_id,
       'debt',
       v.key,
       v.label_fr,
       v.label_en,
       v.description_fr,
       v.value_type,
       case when v.value_type = 'number'
            then to_jsonb((v.default_value)::numeric)
            else to_jsonb(v.default_value)
       end,
       false,
       true,
       v.sort_order,
       v.validation_min,
       v.validation_max
from (
    select distinct tenant_id from public.system_settings
    union
    select '00000000-0000-0000-0000-000000000001'::uuid as tenant_id
) t
cross join (
    values
        ('debt.severe_debt_dzd', 'Seuil « Créances Critiques » — Console d''Investigation (DZD)', 'Severe-debt threshold — Investigation Console (DZD)',
         'Encours familial au-delà duquel le dossier apparaît dans la requête rapide « Créances Critiques » de la Console d''Investigation Opérationnelle. Dimension indépendante des bandes montant du vieillissement.',
         'number', '40000', 96, 0, 100000000)
) as v(key, label_fr, label_en, description_fr, value_type, default_value, sort_order, validation_min, validation_max)
on conflict (tenant_id, category, key) do nothing;

-- ----------------------------------------------------------------------------
-- §2. read_debt_aging_thresholds — recreated with the EXTENDED return
--      (the 0138 body verbatim + the severe-debt edge)
-- ----------------------------------------------------------------------------
drop function if exists public.read_debt_aging_thresholds();

create or replace function public.read_debt_aging_thresholds()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_grace integer;
    v_yellow integer;
    v_red integer;
    v_active integer;
    v_amount_yellow numeric;
    v_amount_red numeric;
    v_severe numeric;
    v_msg_green text;
    v_msg_yellow text;
    v_msg_orange text;
    v_msg_red text;
begin
    -- The SAME staff gate as the aging surface itself (0111/0125/0133/0138) —
    -- the thresholds are the aging audience's operational config, and the
    -- system_settings RLS (0024) stays untouched.
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: debt thresholds are a staff surface';
    end if;

    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    select t.grace_period_days, t.yellow_days, t.red_days, t.active_payer_grace_days
      into v_grace, v_yellow, v_red, v_active
      from public.debt_aging_thresholds(v_tenant) t;

    -- T-469 (DEBT-103): the AMOUNT dimension + the level messages — read
    -- directly from system_settings (documented defaults when missing).
    -- T-502 (DEBT-104): + the SEVERE-DEBT edge (the console's quick query).
    select
        coalesce(min(case when s.key = 'debt.amount_threshold_yellow_dzd'
                          then (s.value #>> '{}')::numeric end), 20000),
        coalesce(min(case when s.key = 'debt.amount_threshold_red_dzd'
                          then (s.value #>> '{}')::numeric end), 60000),
        coalesce(min(case when s.key = 'debt.severe_debt_dzd'
                          then (s.value #>> '{}')::numeric end), 40000)
      into v_amount_yellow, v_amount_red, v_severe
      from public.system_settings s
     where s.tenant_id = v_tenant
       and s.category = 'debt'
       and s.key in ('debt.amount_threshold_yellow_dzd', 'debt.amount_threshold_red_dzd',
                     'debt.severe_debt_dzd');

    select
        coalesce(max(case when s.key = 'debt.level_message_green'    then s.value #>> '{}' end), ''),
        coalesce(max(case when s.key = 'debt.level_message_yellow'   then s.value #>> '{}' end), ''),
        coalesce(max(case when s.key = 'debt.level_message_orange'   then s.value #>> '{}' end), ''),
        coalesce(max(case when s.key = 'debt.level_message_red'      then s.value #>> '{}' end), '')
      into v_msg_green, v_msg_yellow, v_msg_orange, v_msg_red
      from public.system_settings s
     where s.tenant_id = v_tenant
       and s.category = 'debt'
       and s.key in ('debt.level_message_green', 'debt.level_message_yellow',
                     'debt.level_message_orange', 'debt.level_message_red');

    return jsonb_build_object(
        'gracePeriodDays', coalesce(v_grace, 5),
        'yellowDays', coalesce(v_yellow, 15),
        'redDays', coalesce(v_red, 60),
        'activePayerGraceDays', coalesce(v_active, 15),
        -- T-469 (DEBT-103): the amount edges (0 = the classification is
        -- disabled — every amount is amount-green) + the per-level messages
        -- (empty = the canonical engine text stands).
        'amountYellowDzd', coalesce(v_amount_yellow, 20000),
        'amountRedDzd', coalesce(v_amount_red, 60000),
        -- T-502 (DEBT-104): the console's severe-debt quick-query edge
        -- (default 40 000 — the previously hardcoded value).
        'severeDebtDzd', coalesce(v_severe, 40000),
        'levelMessages', jsonb_build_object(
            'green', coalesce(v_msg_green, ''),
            'yellow', coalesce(v_msg_yellow, ''),
            'orange', coalesce(v_msg_orange, ''),
            'red', coalesce(v_msg_red, '')
        )
    );
end;
$$;

comment on function public.read_debt_aging_thresholds is
    'T-443 (DEBT-101) + T-469 (DEBT-103) + T-502 (DEBT-104): the staff-gated light reader for the '
    'configurable debt risk configuration — the 4 day-thresholds (0125), the 2 amount-thresholds '
    'and the 4 level-message templates (0138), and the severe-debt edge of the Investigation '
    'Console''s quick query (0150). Consumed by the desktop dashboard triage + the Finances '
    'legend + the amount classification + the operational console.';

revoke execute on function public.read_debt_aging_thresholds() from anon, public;
grant execute on function public.read_debt_aging_thresholds() to authenticated;

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0150', '{0150_severe_debt_threshold.sql}', 'severe_debt_threshold')
on conflict (version) do nothing;
