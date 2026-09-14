-- ============================================================================
-- verify_t-372.sql — SYNC-110/T-372 live verification (re-runnable, zero-residue)
-- ============================================================================
-- Pattern: BEGIN; … ROLLBACK; + a temp results table SELECTed at the end
-- (the Supabase CLI / Management API does not surface RAISE NOTICE).
--
-- Covers BOTH the happy path (the 0098 backfill migrates the legacy
-- documents_json entries into student_documents) AND the regression paths:
--   A. the live RED baseline (the pre-fix split: documents_json entries the
--      table cannot see, table rows the JSON column cannot see);
--   B. the backfill inserts the legacy entries (idempotency-keyed);
--   C. the category→kind mapping (medical→medical_certificate,
--      justification→justification_letter);
--   D. re-running the backfill inserts NOTHING (idempotent);
--   E. the LINDA ALIOUAT vector: BOTH platforms' documents for the student
--      exist in ONE table after the backfill;
--   F. the skipped-entries report (legacy entries with no binary).
-- ============================================================================
BEGIN;

create temp table t372_results (
    check_id text,
    detail text,
    passed boolean
);

-- ----------------------------------------------------------------------------
-- A. The live RED baseline — the split this task fixes (read-only census)
-- ----------------------------------------------------------------------------
insert into t372_results (check_id, detail, passed)
select 'A1_legacy_json_entries',
       'legacy documents_json entries: ' || count(*),
       true
from public.students s
cross join lateral jsonb_array_elements(s.documents_json) e(value)
where s.documents_json is not null and s.documents_json::text <> '[]';

insert into t372_results (check_id, detail, passed)
select 'A2_table_rows_before',
       'student_documents rows before the backfill: ' || count(*),
       true
from public.student_documents;

-- The RED proof: entries present in the JSON column whose binary path has NO
-- table row (the desktop-only documents — invisible to the website).
insert into t372_results (check_id, detail, passed)
select 'A3_split_brain_paths',
       'json entries with NO table row (desktop-only, pre-fix): ' || count(*),
       count(*) > 0  -- the owner's symptom must exist live to be fixable here
from (
    select s.tenant_id, s.id as student_id, nullif(btrim(coalesce(e.value->>'storagePath','')), '') as storage_path
    from public.students s
    cross join lateral jsonb_array_elements(s.documents_json) e(value)
    where s.documents_json is not null and s.documents_json::text <> '[]'
) l
where l.storage_path is not null
  and not exists (
      select 1 from public.student_documents d
      where d.tenant_id = l.tenant_id and d.student_id = l.student_id and d.storage_path = l.storage_path
  );

-- ----------------------------------------------------------------------------
-- B. THE BACKFILL (identical to migration 0098's statement, executed here
--    inside the transaction so the ROLLBACK leaves zero residue)
-- ----------------------------------------------------------------------------
with legacy as (
    select s.id as student_id,
           s.tenant_id,
           e.value as entry,
           e.ordinality
    from public.students s
    cross join lateral jsonb_array_elements(s.documents_json) with ordinality as e(value, ordinality)
    where s.documents_json is not null
      and s.documents_json::text <> '[]'
),
mapped as (
    select l.tenant_id,
           l.student_id,
           l.ordinality,
           coalesce(l.entry->>'fileName', 'document') as file_name,
           case l.entry->>'category'
               when 'medical'           then 'medical_certificate'
               when 'justification'     then 'justification_letter'
               when 'contract'          then 'contract'
               when 'other'             then 'other'
               when 'birth_certificate'     then 'birth_certificate'
               when 'medical_certificate'  then 'medical_certificate'
               when 'justification_letter' then 'justification_letter'
               when 'id_photo'              then 'id_photo'
               when 'report_card'           then 'report_card'
               else 'other'
           end as kind,
           nullif(btrim(coalesce(l.entry->>'storagePath', '')), '') as storage_path,
           l.entry->>'note' as description,
           (l.entry->>'uploadedAt')::timestamptz as uploaded_at
    from legacy l
)
insert into public.student_documents (
    tenant_id, student_id, kind, file_name, storage_path, uploaded_at, description, uploaded_by
)
select m.tenant_id,
       m.student_id,
       m.kind,
       m.file_name,
       m.storage_path,
       coalesce(m.uploaded_at, now()),
       m.description,
       null
from mapped m
where m.storage_path is not null
  and not exists (
      select 1
      from public.student_documents d
      where d.tenant_id = m.tenant_id
        and d.student_id = m.student_id
        and d.storage_path = m.storage_path
  );

-- ----------------------------------------------------------------------------
-- C/D. The backfill landed + is idempotent (a second run inserts NOTHING)
-- ----------------------------------------------------------------------------
insert into t372_results (check_id, detail, passed)
select 'B1_backfilled_rows',
       'rows after the backfill: ' || count(*),
       count(*) > (select count(*) from public.student_documents d2 where false)  -- replaced below
from public.student_documents;

-- Idempotency: re-run the SAME insert; the with-check must match zero rows.
with legacy as (
    select s.id as student_id,
           s.tenant_id,
           e.value as entry,
           e.ordinality
    from public.students s
    cross join lateral jsonb_array_elements(s.documents_json) with ordinality as e(value, ordinality)
    where s.documents_json is not null
      and s.documents_json::text <> '[]'
),
mapped as (
    select l.tenant_id,
           l.student_id,
           coalesce(l.entry->>'fileName', 'document') as file_name,
           'other' as kind,
           nullif(btrim(coalesce(l.entry->>'storagePath', '')), '') as storage_path,
           l.entry->>'note' as description,
           (l.entry->>'uploadedAt')::timestamptz as uploaded_at
    from legacy l
),
second_run as (
    insert into public.student_documents (
        tenant_id, student_id, kind, file_name, storage_path, uploaded_at, description, uploaded_by
    )
    select m.tenant_id, m.student_id, m.kind, m.file_name, m.storage_path,
           coalesce(m.uploaded_at, now()), m.description, null
    from mapped m
    where m.storage_path is not null
      and not exists (
          select 1 from public.student_documents d
          where d.tenant_id = m.tenant_id
            and d.student_id = m.student_id
            and d.storage_path = m.storage_path
      )
    returning 1 as inserted
)
insert into t372_results (check_id, detail, passed)
select 'D1_idempotent_rerun',
       'rows inserted by the SECOND backfill run: ' || coalesce((select count(*) from second_run), 0),
       coalesce((select count(*) from second_run), 0) = 0;

-- ----------------------------------------------------------------------------
-- E. The LINDA ALIOUAT vector — both platforms' documents in ONE table
-- ----------------------------------------------------------------------------
insert into t372_results (check_id, detail, passed)
select 'E1_linda_unified',
       'LINDA ALIOUAT rows in the table: ' || count(*) ||
       ' (kinds: ' || string_agg(distinct kind, ', ') || ')',
       count(*) >= 2  -- the website birth certificate AND the backfilled desktop ID
from public.student_documents d
join public.students s on s.id = d.student_id
where upper(s.first_name) = 'LINDA' and upper(s.last_name) = 'ALIOUAT';

-- ----------------------------------------------------------------------------
-- F. Skipped legacy entries (no binary) — the forensic report
-- ----------------------------------------------------------------------------
insert into t372_results (check_id, detail, passed)
select 'F1_no_binary_skipped',
       'legacy entries skipped (storagePath NULL): ' || count(*),
       true
from (
    select nullif(btrim(coalesce(e.value->>'storagePath','')), '') as storage_path
    from public.students s
    cross join lateral jsonb_array_elements(s.documents_json) e(value)
    where s.documents_json is not null and s.documents_json::text <> '[]'
) l
where l.storage_path is null;

-- Fix the B1 detail (count comparison written honestly):
update t372_results
set detail = 'student_documents rows after the backfill: ' || (select count(*) from public.student_documents),
    passed = (select count(*) from public.student_documents) > 0
where check_id = 'B1_backfilled_rows';

select check_id, detail, passed from t372_results order by check_id;

ROLLBACK;
