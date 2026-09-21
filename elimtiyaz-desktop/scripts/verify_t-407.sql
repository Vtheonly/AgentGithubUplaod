-- ============================================================================
-- verify_t-407.sql — T-407 (the UI/integration suite of T-401/402/403),
-- migration 0111: the register_family_batch classification thread.
-- Convention: BEGIN; … ROLLBACK; — re-runnable, never mutates.
--
-- BLOCK STRUCTURE (the PL/pgSQL savepoint trap): the sandbox setup, the
-- main happy-path, and every exception-expecting check live in ISOLATED DO
-- blocks so a caught exception cannot roll back earlier results.
--
--   C1  register_family_batch with filière/specialité in p_students →
--       the created student row CARRIES the classification (the wire no
--       longer drops it)
--   C2  'general' normalizes to NULL through the whole composite (the
--       canonical untagged form — never a literal)
--   C3  the same registration re-run (idempotent codes) UPDATES the
--       classification instead of duplicating or dropping it
--   C4  the returned out_students jsonb exposes filiere_code/specialite_code
--   C5  billing legs unaffected (the ledger rows still land; the
--       classification thread changes nothing else — the zero-regression
--       pin)
--   C6  the desktop's OLD wire shape (no filière keys) still works — the
--       jsonb_to_recordset columns are optional (back-compat)
-- ============================================================================
BEGIN;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t406_results (check_id text, ok boolean, detail text);

-- ─── Block A: the sandbox (a tenant + a fresh family) ─────────────────────
do $setup$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
begin
    -- The probe rows are keyed by run-unique codes (never a fixed code).
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone)
    values (v_tenant, 'PAR-T406-' || to_char(now(), 'HH24MISSUS'), 'Probe', 'T406', '0550 00 00 01');
end
$setup$;

-- ─── C1: the classification lands on the student row ─────────────────────
do $c1$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_code text := 'PAR-T406-' || to_char(now(), 'HH24MISSUS');
    v_parent_id uuid;
    v_result record;
    v_student_id uuid;
begin
    select id into v_parent_id from public.parents where tenant_id = v_tenant and parent_code = v_code;

    select * into v_result from public.register_family_batch(
        v_tenant,
        jsonb_build_object(
            'parent_code', v_code,
            'first_name', 'Probe',
            'last_name', 'T406',
            'primary_phone', '0550 00 00 01',
            'is_active', true
        ),
        jsonb_build_array(jsonb_build_object(
            'student_code', 'ELV-T406-' || to_char(now(), 'HH24MISSUS'),
            'first_name', 'Amine',
            'last_name', 'Touati',
            'date_of_birth', '2008-05-14',
            'gender', 'male',
            'grade_level_code', '2eme_annee',
            'payment_plan', 'tranches',
            'filiere_code', 'technique_mathematique',
            'specialite_code', 'genie_mecanique'
        ))
    );

    v_student_id := (v_result.out_students->0->>'id')::uuid;
    insert into t406_results (check_id, ok, detail)
    select 'C1',
           s.filiere_code = 'technique_mathematique' and s.specialite_code = 'genie_mecanique',
           'filiere=' || coalesce(s.filiere_code, '<null>') || ' specialite=' || coalesce(s.specialite_code, '<null>')
      from public.students s
     where s.id = v_student_id;
end
$c1$;

-- ─── C2: 'general' normalizes to NULL through the composite ──────────────
do $c2$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_code text := 'PAR-T406-' || to_char(now(), 'HH24MISSUS');
    v_parent_id uuid;
    v_result record;
    v_student_id uuid;
begin
    select id into v_parent_id from public.parents where tenant_id = v_tenant and parent_code = v_code;

    select * into v_result from public.register_family_batch(
        v_tenant,
        jsonb_build_object(
            'parent_code', v_code,
            'first_name', 'Probe',
            'last_name', 'T406',
            'primary_phone', '0550 00 00 02',
            'is_active', true
        ),
        jsonb_build_array(jsonb_build_object(
            'student_code', 'ELV-T406G-' || to_char(now(), 'HH24MISSUS'),
            'first_name', 'Nils',
            'last_name', 'Hamdi',
            'date_of_birth', '2018-09-10',
            'grade_level_code', '1ap',
            'filiere_code', 'general'
        ))
    );

    v_student_id := (v_result.out_students->0->>'id')::uuid;
    insert into t406_results (check_id, ok, detail)
    select 'C2',
           s.filiere_code is null,
           'filiere=' || coalesce(s.filiere_code, '<null>') || ' (expected <null>)'
      from public.students s
     where s.id = v_student_id;
end
$c2$;

-- ─── C3: the idempotent re-run UPDATES the classification ────────────────
do $c3$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_code text := 'PAR-T406-' || to_char(now(), 'HH24MISSUS');
    v_parent_id uuid;
    v_student_code text := 'ELV-T406-' || to_char(now(), 'HH24MISSUS');
    v_result record;
    v_student_id uuid;
begin
    select id into v_parent_id from public.parents where tenant_id = v_tenant and parent_code = v_code;

    -- First registration: mathematiques.
    select * into v_result from public.register_family_batch(
        v_tenant,
        jsonb_build_object(
            'parent_code', v_code, 'first_name', 'Probe', 'last_name', 'T406',
            'primary_phone', '0550 00 00 03', 'is_active', true
        ),
        jsonb_build_array(jsonb_build_object(
            'student_code', v_student_code,
            'first_name', 'Amine', 'last_name', 'Touati',
            'grade_level_code', '2eme_annee',
            'filiere_code', 'mathematiques'
        ))
    );
    v_student_id := (v_result.out_students->0->>'id')::uuid;

    -- Re-run with a DIFFERENT filière (the same deterministic code → UPDATE).
    perform public.register_family_batch(
        v_tenant,
        jsonb_build_object(
            'parent_code', v_code, 'first_name', 'Probe', 'last_name', 'T406',
            'primary_phone', '0550 00 00 03', 'is_active', true
        ),
        jsonb_build_array(jsonb_build_object(
            'student_code', v_student_code,
            'first_name', 'Amine', 'last_name', 'Touati',
            'grade_level_code', '2eme_annee',
            'filiere_code', 'sciences_experimentales'
        ))
    );

    insert into t406_results (check_id, ok, detail)
    select 'C3',
           count(*) = 1 and min(filiere_code) = 'sciences_experimentales',
           'students=' || count(*) || ' filiere=' || coalesce(min(filiere_code), '<null>')
      from public.students
     where id = v_student_id;
end
$c3$;

-- ─── C4: the returned out_students exposes the classification ────────────
do $c4$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_code text := 'PAR-T406-' || to_char(now(), 'HH24MISSUS');
    v_parent_id uuid;
    v_result record;
begin
    select id into v_parent_id from public.parents where tenant_id = v_tenant and parent_code = v_code;

    select * into v_result from public.register_family_batch(
        v_tenant,
        jsonb_build_object(
            'parent_code', v_code, 'first_name', 'Probe', 'last_name', 'T406',
            'primary_phone', '0550 00 00 04', 'is_active', true
        ),
        jsonb_build_array(jsonb_build_object(
            'student_code', 'ELV-T406R-' || to_char(now(), 'HH24MISSUS'),
            'first_name', 'Rania', 'last_name', 'Mekki',
            'grade_level_code', '3eme_annee',
            'filiere_code', 'lettres_philosophie'
        ))
    );

    insert into t406_results (check_id, ok, detail)
    values (
        'C4',
        v_result.out_students->0->>'filiere_code' = 'lettres_philosophie',
        'out_students filiere=' || coalesce(v_result.out_students->0->>'filiere_code', '<null>')
    );
end
$c4$;

-- ─── C5: the billing legs still land (the zero-regression pin) ───────────
do $c5$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_code text := 'PAR-T406-' || to_char(now(), 'HH24MISSUS');
    v_parent_id uuid;
    v_result record;
begin
    select id into v_parent_id from public.parents where tenant_id = v_tenant and parent_code = v_code;

    select * into v_result from public.register_family_batch(
        v_tenant,
        jsonb_build_object(
            'parent_code', v_code, 'first_name', 'Probe', 'last_name', 'T406',
            'primary_phone', '0550 00 00 05', 'is_active', true
        ),
        jsonb_build_array(jsonb_build_object(
            'student_code', 'ELV-T406B-' || to_char(now(), 'HH24MISSUS'),
            'first_name', 'Karim', 'last_name', 'Hamdi',
            'grade_level_code', '1ap',
            'filiere_code', 'tronc_commun_sciences'
        )),
        jsonb_build_array(jsonb_build_object(
            'student_ref', 0,
            'entry_number', 'ENT-T406-' || to_char(now(), 'HH24MISSUS'),
            'entry_type', 'charge',
            'amount', 100000,
            'category', 'tuition',
            'description', 'T406 probe charge',
            'source_type', 'batch_registration',
            'source_id', 't406-probe',
            'payment_status', 'unpaid'
        )),
        jsonb_build_array(jsonb_build_object(
            'student_ref', 0,
            'category', 'tuition',
            'tranche_number', 1,
            'label', 'Tranche 1',
            'amount_due', 40000,
            'due_date', '2025-11-30',
            'source_type', 'batch_registration',
            'source_id', 't406-probe'
        ))
    );

    insert into t406_results (check_id, ok, detail)
    select 'C5',
           v_result.out_ledger_written = 1 and v_result.out_installments_written = 1,
           'ledger=' || v_result.out_ledger_written || ' installments=' || v_result.out_installments_written;
end
$c5$;

-- ─── C6: the OLD wire shape (no filière keys) still works (back-compat) ──
do $c6$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_code text := 'PAR-T406-' || to_char(now(), 'HH24MISSUS');
    v_parent_id uuid;
    v_result record;
    v_student_id uuid;
begin
    select id into v_parent_id from public.parents where tenant_id = v_tenant and parent_code = v_code;

    -- NO filière_code key at all — the pre-0111 desktop wire shape.
    select * into v_result from public.register_family_batch(
        v_tenant,
        jsonb_build_object(
            'parent_code', v_code, 'first_name', 'Probe', 'last_name', 'T406',
            'primary_phone', '0550 00 00 06', 'is_active', true
        ),
        jsonb_build_array(jsonb_build_object(
            'student_code', 'ELV-T406O-' || to_char(now(), 'HH24MISSUS'),
            'first_name', 'Old', 'last_name', 'Wire',
            'grade_level_code', '2am'
        ))
    );

    v_student_id := (v_result.out_students->0->>'id')::uuid;
    insert into t406_results (check_id, ok, detail)
    select 'C6',
           s.filiere_code is null and s.grade_level_code = '2am',
           'old-wire student ok, filiere=' || coalesce(s.filiere_code, '<null>')
      from public.students s
     where s.id = v_student_id;
end
$c6$;

select check_id, ok, detail from t406_results order by check_id;

ROLLBACK;
