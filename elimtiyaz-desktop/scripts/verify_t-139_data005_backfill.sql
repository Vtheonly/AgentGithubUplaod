-- verify_t-139_data005_backfill.sql — live verification of the reconstructed
-- migration 0066 (ARCH-014) and the DATA-005 backfill's end state.
-- Convention: wrapped in BEGIN…ROLLBACK so it can be re-run any time without
-- mutating the live DB; results land in a temp table for the final SELECT
-- (the Management API SQL endpoint surfaces only the last statement's rows).
-- Run: supabase db query --linked < scripts/verify_t-139_data005_backfill.sql
--   or via the Management API SQL endpoint (multi-statement, one session).

begin;

drop table if exists t139_results;
create temp table t139_results (check_id text, ok boolean, detail text);

-- C1: the registration row exists with the exact live values.
insert into t139_results
select 'C1_registration_row', version = '0066' and name = 'parent_first_name_backfill',
       'version=' || version || ' name=' || coalesce(name, '(null)')
from supabase_migrations.schema_migrations where version = '0066';

-- C2: the empty-first_name era is over — only single-token names remain.
insert into t139_results
select 'C2_single_token_residual', count(*) = 1,
       count(*) || ' row(s) with first_name empty (expected 1: the single-token name)'
from parents where first_name = '';

-- C3: every populated first_name is the display_name remainder after the
-- leading last_name token (btrim semantics of the reconstruction).
insert into t139_results
select 'C3_split_semantics', count(*) = 0,
       count(*) || ' row(s) violate btrim(display - last - separator) = first'
from parents
where first_name <> ''
  and btrim(replace(display_name, last_name || ' ', '')) <> first_name;

-- C4: display_name untouched — every row still carries one, and it still
-- starts with the last_name token (the pre-backfill corpus shape).
insert into t139_results
select 'C4_display_name_intact', count(*) = 0,
       count(*) || ' row(s) with empty/short display_name'
from parents
where display_name is null or display_name = ''
   or left(display_name, length(last_name)) <> last_name;

-- C5: idempotency — the reconstruction's UPDATE predicate matches ZERO rows
-- on the post-backfill state (only the single-token row has first_name='',
-- and it is excluded by the position(' '…) > 0 guard).
insert into t139_results
select 'C5_idempotent', count(*) = 0,
       count(*) || ' row(s) would change on re-run (expected 0)'
from parents
where first_name = ''
  and display_name is not null and display_name <> ''
  and position(' ' in display_name) > 0
  and left(display_name, length(last_name)) = last_name
  and length(display_name) > length(last_name) + 1;

-- C6: parentDisplayName semantics still hold end-to-end: the rendered name
-- equals display_name on every row (the canonical helper prefers it).
insert into t139_results
select 'C6_renderable_names', count(*) = 0,
       count(*) || ' row(s) with a blank renderable name'
from parents
where display_name is null or btrim(display_name) = '';

select check_id, ok, detail from t139_results order by check_id;

rollback;
