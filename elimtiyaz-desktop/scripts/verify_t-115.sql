-- verify_t-115.sql — T-115 (migration 0065 canonical identity codes) live verification.
-- Convention (AGENTS.md §11.1): BEGIN; … ROLLBACK; — re-runnable any time, never
-- mutates the live DB. Results land in temp table t115_results (the Supabase CLI
-- does not surface RAISE NOTICE).
--
-- Covers:
--   C1  presence: the 4 new functions + the rewritten batch_register_family +
--       the schema_migrations registration row (version, name, statements).
--   C2  behavior: the deterministic generators pinned to vectors computed by the
--       DESKTOP canonical TS engine (src/core/format/id.ts, run via Node type
--       stripping, 2026-09-02) — the cross-platform equivalence leg.
--   NOTE (discovered live, 2026-09-02): the RPC REQUIRES date_of_birth in every
--   student JSON object (students.date_of_birth is NOT NULL and the function does
--   not default it) — callers must always supply it.
--   C3  contract: batch_register_family (a) rejects empty identity (no random
--       fallback), (b) creates a parent whose code equals the deterministic
--       generator, (c) REFUSES a duplicate registration via the
--       unique (tenant_id, parent_code) constraint (the idempotency gate),
--       (d) issues the deterministic activation code by default,
--       (e) writes the audit entry tagged deterministic_fnv1a_0065.
--
-- Evidence of the run: docs/recovery/t-115-live-verification.md.

BEGIN;

create temp table t115_results (check_id text, ok boolean, detail text);

-- ─── C1: presence + registration ───────────────────────────────────────────
insert into t115_results
select 'C1a five functions present',
       count(*) = 5,
       'found=' || count(*) || coalesce(': ' || string_agg(proname, ','), '')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('fn_fnv1a','fn_stable_hash','fn_deterministic_parent_code',
   'fn_deterministic_activation_code','batch_register_family');

insert into t115_results
select 'C1b registration row',
       (select count(*) from supabase_migrations.schema_migrations
         where version = '0065' and name = 'canonical_identity_codes'
           and statements = array['0065_canonical_identity_codes.sql']::text[]) = 1,
       (select coalesce('version=' || version || ' name=' || name, 'MISSING')
          from supabase_migrations.schema_migrations where version = '0065');

insert into t115_results
select 'C1c unique (tenant_id, parent_code) constraint',
       count(*) = 1, coalesce(string_agg(conname, ','), 'MISSING')
from pg_constraint
where conrelid='public.parents'::regclass and contype='u'
  and pg_get_constraintdef(oid) like '%tenant_id, parent_code%';

-- ─── C2: deterministic generator vectors (desktop TS == SQL) ───────────────
insert into t115_results values
 ('C2a fn_stable_hash raw input', public.fn_stable_hash('0554288142|MAMER') = '60E2BA', public.fn_stable_hash('0554288142|MAMER')),
 ('C2b fn_stable_hash empty',     public.fn_stable_hash('') = '811C9D', public.fn_stable_hash('')),
 ('C2c fn_stable_hash orphan',    public.fn_stable_hash('orphan-parent') = 'C13D99', public.fn_stable_hash('orphan-parent')),
 ('C2d parent code basic',        public.fn_deterministic_parent_code(2026, '0554288142', 'MAMER', '', '') = 'PAR-2026-60E2BA', public.fn_deterministic_parent_code(2026, '0554288142', 'MAMER', '', '')),
 ('C2e parent code trim+drop-empty', public.fn_deterministic_parent_code(2026, ' 0554288142 ', ' MAMER ', null, '  ') = 'PAR-2026-60E2BA', public.fn_deterministic_parent_code(2026, ' 0554288142 ', ' MAMER ', null, '  ')),
 ('C2f parent code fallback seed', public.fn_deterministic_parent_code(2026, '', '', '', '', 'seed-123') = 'PAR-2026-CB27E1', public.fn_deterministic_parent_code(2026, '', '', '', '', 'seed-123')),
 ('C2g parent code orphan default', public.fn_deterministic_parent_code(2026, null, null, null, null) = 'PAR-2026-C13D99', public.fn_deterministic_parent_code(2026, null, null, null, null)),
 ('C2h parent code 4-field',      public.fn_deterministic_parent_code(2025, '0770123456', 'BEN ALI', 'Karim', 'BEN ALI') = 'PAR-2025-D93B0A', public.fn_deterministic_parent_code(2025, '0770123456', 'BEN ALI', 'Karim', 'BEN ALI')),
 ('C2i activation code tenant',   public.fn_deterministic_activation_code('PAR-2026-ABCDEF', '00000000-0000-0000-0000-000000000001'::uuid) = '553830', public.fn_deterministic_activation_code('PAR-2026-ABCDEF', '00000000-0000-0000-0000-000000000001'::uuid)),
 ('C2j activation code null tenant', public.fn_deterministic_activation_code('PAR-2026-ABCDEF', null) = '905025', public.fn_deterministic_activation_code('PAR-2026-ABCDEF', null));

-- ─── C3: batch_register_family contract ────────────────────────────────────
do $$
declare
    v_err text;
    v_code_a text; v_code_b text;
    v_pid uuid; v_sids uuid[];
    v_act text;
    v_audit_count integer;
begin
    -- C3a: empty identity must be REJECTED (no random fallback).
    begin
        perform public.batch_register_family(
            '00000000-0000-0000-0000-000000000001'::uuid, '{}'::jsonb, '[]'::jsonb, null);
        insert into t115_results values ('C3a empty identity rejected', false, 'NO ERROR RAISED');
    exception when others then
        v_err := sqlerrm;
        insert into t115_results values ('C3a empty identity rejected',
            v_err like '%identity fields required%', v_err);
    end;

    -- C3b: registration A creates a parent with the DETERMINISTIC code
    --      (explicit activation code 'T115FIX' so the code path is pinned).
    select parent_id, student_ids into v_pid, v_sids from public.batch_register_family(
        '00000000-0000-0000-0000-000000000001'::uuid,
        '{"primary_phone":"0999888777","display_name":"T115-TEST-A","first_name":"","last_name":""}'::jsonb,
        '[{"first_name":"T115","last_name":"Student","gender":"male","date_of_birth":"2015-01-01"}]'::jsonb,
        null, 'T115FIX');
    select parent_code into v_code_a from public.parents where id = v_pid;
    insert into t115_results values ('C3b deterministic parent code',
        v_code_a = public.fn_deterministic_parent_code(2026, '0999888777', 'T115-TEST-A', '', ''),
        'created=' || coalesce(v_code_a, 'NULL') || ' expected=' ||
        public.fn_deterministic_parent_code(2026, '0999888777', 'T115-TEST-A', '', ''));
    select code into v_act from public.activation_codes where parent_id = v_pid;
    insert into t115_results values ('C3b explicit activation code honored',
        v_act = 'T115FIX', 'issued=' || coalesce(v_act, 'NULL'));

    -- C3c: DUPLICATE registration of the SAME identity must be refused by the
    --      unique (tenant_id, parent_code) constraint — the idempotency gate.
    begin
        perform public.batch_register_family(
            '00000000-0000-0000-0000-000000000001'::uuid,
            '{"primary_phone":"0999888777","display_name":"T115-TEST-A","first_name":"","last_name":""}'::jsonb,
            '[]'::jsonb, null);
        insert into t115_results values ('C3c duplicate registration refused', false, 'NO ERROR RAISED');
    exception when unique_violation then
        insert into t115_results values ('C3c duplicate registration refused', true,
            'unique_violation: ' || sqlerrm);
    when others then
        insert into t115_results values ('C3c duplicate registration refused', false,
            'unexpected: ' || sqlerrm);
    end;

    -- C3d: registration B (different identity, NO explicit activation code)
    --      issues the DETERMINISTIC activation code by default.
    select parent_id, student_ids into v_pid, v_sids from public.batch_register_family(
        '00000000-0000-0000-0000-000000000001'::uuid,
        '{"primary_phone":"0999888778","display_name":"T115-TEST-B","first_name":"","last_name":""}'::jsonb,
        '[]'::jsonb, null);
    select parent_code into v_code_b from public.parents where id = v_pid;
    select code into v_act from public.activation_codes where parent_id = v_pid;
    insert into t115_results values ('C3d deterministic default activation code',
        v_act = public.fn_deterministic_activation_code(v_code_b, '00000000-0000-0000-0000-000000000001'::uuid),
        'issued=' || coalesce(v_act, 'NULL') || ' expected=' ||
        public.fn_deterministic_activation_code(v_code_b, '00000000-0000-0000-0000-000000000001'::uuid));

    -- C3e: the audit entry carries the code_rule tag.
    select count(*) into v_audit_count from public.audit_logs
     where action = 'parent.batch_register'
       and after_json->>'code_rule' = 'deterministic_fnv1a_0065'
       and entity_id in (select id from public.parents where parent_code in (v_code_a, v_code_b));
    insert into t115_results values ('C3e audit entries tagged',
        v_audit_count = 2, 'count=' || v_audit_count);
end $$;

select * from t115_results order by check_id;
ROLLBACK;
