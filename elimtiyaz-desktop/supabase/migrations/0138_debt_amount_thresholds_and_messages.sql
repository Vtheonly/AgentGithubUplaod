-- ============================================================================
-- 0138_debt_amount_thresholds_and_messages.sql
-- ============================================================================
-- T-469 (DEBT-103, 136th session 2026-10-03) — the AMOUNT dimension of the
-- configurable green/yellow/red risk configuration + the per-level MESSAGE
-- templates (the owner's mandate: "I want a proper configuration interface
-- where administrators can configure the constraints/thresholds that
-- determine whether a value is green/yellow/red… There should also be a
-- configurable message/template associated with each risk level").
--
-- WHAT THIS ADDS (and nothing else — the T-429/0125 day-dimension
-- architecture is extended, never duplicated):
--
--   1. SIX new `debt` settings keys, seeded for every tenant (idempotent):
--        debt.amount_threshold_yellow_dz (default 20 000) — outstanding at
--            or above this = the AMOUNT-yellow band ("montant à surveiller")
--        debt.amount_threshold_red_dzd   (default 60 000) — outstanding
--            above this = the AMOUNT-red band ("montant critique")
--        debt.level_message_green|yellow|orange|red (default '' — EMPTY:
--            the canonical engine's reason-code explanation STANDS; a
--            configured message EXTENDS it, never replaces it)
--
--      The AMOUNT classification is a SEPARATE canonical dimension from the
--      day-based aging status (a 3 000 DZD debt 100 days late is
--      day-RED/amount-green; a 90 000 DZD debt 2 days late is
--      day-green/amount-red — both facts matter, neither masks the other).
--
--   2. `read_debt_aging_thresholds()` RECREATED (the §15.32 pattern for a
--      jsonb return extension — the 0133 body verbatim + the new keys):
--      the jsonb gains amountYellowDzd, amountRedDzd and
--      levelMessages{green,yellow,orange,red} — camelCase parity with the
--      TS `DebtAgingThresholds` extension (the 0111/0133 convention).
--
-- Follows ADR-001: NEW migration only — 0125/0133 are never edited.
--
-- IN-PLACE REPAIR (137th session, 2026-10-03 — the 0138 live-apply round):
-- the original §1 VALUES clause mixed an INTEGER literal (20000/60000 in
-- the first two rows) with ''-literals in the same default_value column
-- (the four message rows). A Postgres VALUES relation resolves ONE type
-- per column — the integer row won resolution and coerced '' to int4,
-- so the migration failed at execution time with
--   22P02: invalid input syntax for type integer: ""
-- on EVERY Postgres (dead-on-arrival — never applied anywhere: the live
-- schema_migrations had no 0138 row, zero seeds, the pre-0138 reader).
-- The repair is covered by the append-only discipline's own scope (AGENTS.md
-- §15.9 / T-058: "already-applied migrations are NEVER edited" — this one
-- had applied NOWHERE; a follow-up migration could NOT unblock the fresh
-- chain, which hard-fails at 0138 before reaching any successor).
-- The fix: every default_value literal is now a text literal and the jsonb
-- conversion branches on value_type — to_jsonb(default_value::numeric) for
-- 'number' rows (JSON NUMBER 20000 — the 0125 seed convention preserved),
-- to_jsonb(default_value) for 'string' rows (JSON STRING ""). Probed on the
-- live instance before re-applying (jsonb_typeof: number/string as
-- intended — zero-residue temp-table probe).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. Seed the amount thresholds + the level messages (idempotent)
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
        ('debt.amount_threshold_yellow_dzd', 'Seuil montant « À surveiller » (DZD)', 'Amount threshold yellow (DZD)',
         'Encours au-delà duquel le MONTANT dû passe en « à surveiller » (dimension montant — indépendante du vieillissement en jours).',
         'number', '20000', 90, 0, 100000000),
        ('debt.amount_threshold_red_dzd', 'Seuil montant « Critique » (DZD)', 'Amount threshold red (DZD)',
         'Encours au-delà duquel le MONTANT dû est « critique » (dimension montant — indépendante du vieillissement en jours).',
         'number', '60000', 91, 0, 100000000),
        ('debt.level_message_green', 'Message niveau VERT (optionnel)', 'Level message green (optional)',
         'Message affiché avec le statut vert ; vide = l''explication canonique du moteur suffit.',
         'string', '', 92, null, null),
        ('debt.level_message_yellow', 'Message niveau JAUNE (optionnel)', 'Level message yellow (optional)',
         'Message affiché avec le statut jaune ; vide = l''explication canonique du moteur suffit.',
         'string', '', 93, null, null),
        ('debt.level_message_orange', 'Message niveau ORANGE (optionnel)', 'Level message orange (optional)',
         'Message affiché avec le statut orange ; vide = l''explication canonique du moteur suffit.',
         'string', '', 94, null, null),
        ('debt.level_message_red', 'Message niveau ROUGE (optionnel)', 'Level message red (optional)',
         'Message affiché avec le statut rouge ; vide = l''explication canonique du moteur suffit.',
         'string', '', 95, null, null)
) as v(key, label_fr, label_en, description_fr, value_type, default_value, sort_order, validation_min, validation_max)
on conflict (tenant_id, category, key) do nothing;

-- ----------------------------------------------------------------------------
-- §2. read_debt_aging_thresholds — recreated with the EXTENDED return
--      (the 0133 body verbatim + the amount thresholds + the messages)
-- ----------------------------------------------------------------------------
drop function if exists public.read_debt_aging_thresholds();

create or replace function public.read_debt_aging_thresholds()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
declare
    v_tenant uuid;
    v_grace integer;
    v_yellow integer;
    v_red integer;
    v_active integer;
    v_amount_yellow numeric;
    v_amount_red numeric;
    v_msg_green text;
    v_msg_yellow text;
    v_msg_orange text;
    v_msg_red text;
begin
    -- The SAME staff gate as the aging surface itself (0111/0125/0133) —
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
    select
        coalesce(min(case when s.key = 'debt.amount_threshold_yellow_dzd'
                          then (s.value #>> '{}')::numeric end), 20000),
        coalesce(min(case when s.key = 'debt.amount_threshold_red_dzd'
                          then (s.value #>> '{}')::numeric end), 60000)
      into v_amount_yellow, v_amount_red
      from public.system_settings s
     where s.tenant_id = v_tenant
       and s.category = 'debt'
       and s.key in ('debt.amount_threshold_yellow_dzd', 'debt.amount_threshold_red_dzd');

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
    'T-443 (DEBT-101) + T-469 (DEBT-103): the staff-gated light reader for the '
    'configurable debt risk configuration — the 4 day-thresholds (0125), the 2 '
    'amount-thresholds and the 4 level-message templates (0138). Consumed by the '
    'desktop dashboard triage + the Finances legend + the amount classification.';

revoke execute on function public.read_debt_aging_thresholds() from anon, public;
grant execute on function public.read_debt_aging_thresholds() to authenticated;

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0138', '{0138_debt_amount_thresholds_and_messages.sql}', 'debt_amount_thresholds_and_messages')
on conflict (version) do nothing;
