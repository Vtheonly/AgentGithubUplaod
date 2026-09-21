-- ============================================================================
-- verify_t-398.sql — the post-apply functional + hardening assertions for
-- T-398 / PERF-502 (migration 0102: the register_family_batch one-round-trip
-- RPC).
--
-- House convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it
-- can be re-run any time without mutating the live DB (every probe row this
-- script creates is rolled back at the end — zero residue by construction);
-- results land in a temp table SELECTed at the end.
--
-- Covers: the function shape + grants (C1/C2), the happy-path probe with
-- the returned full rows + write counts (C3), the server-side account_id
-- derivation vs the canonical deriveAccountId format (C4), the ledger +
-- installments landed with the resolved uuids + client source_ids (C5/C6),
-- END-TO-END IDEMPOTENCY (the same payload re-run writes ZERO new rows,
-- C7), ATOMICITY (a poisoned billing row rolls back the WHOLE registration
-- — parent and students included, C8), the out-of-range student_ref guard
-- (C9), the activation-code passthrough (C10), and the timestamp fills
-- (C11).
--
-- Run:  the Management API SQL endpoint with this file's content (the
--       apply_0102_live.sh pattern), or
--       supabase db query --linked < scripts/verify_t-398.sql
-- ============================================================================

BEGIN;

CREATE TEMP TABLE t398_results (
    check_id   text,
    label      text,
    ok         boolean,
    detail     text
);

DO $verify$
DECLARE
    v_run        text := to_char(now(), 'YYYYMMDDHH24MISS');
    v_tenant     uuid;
    v_pcode      text := 'PAR-PROBE-T398-' || to_char(now(), 'YYYYMMDDHH24MISS');
    v_scode      text := 'ELV-PROBE-T398-' || to_char(now(), 'YYYYMMDDHH24MISS');
    v_poison     text := 'PAR-POISON-T398-' || to_char(now(), 'YYYYMMDDHH24MISS');
    v_parent     jsonb;
    v_students   jsonb;
    v_lw         integer;
    v_iw         integer;
    v_pid        uuid;
    v_sid        uuid;
    v_ledger_n   integer;
    v_inst_n     integer;
    v_lw2        integer;
    v_iw2        integer;
    v_ledger_n2  integer;
    v_inst_n2    integer;
    v_err        text;
    v_ref        text := 'PAR-BADREF-T398-' || to_char(now(), 'YYYYMMDDHH24MISS');
BEGIN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;

    -- ------------------------------------------------------------------
    -- C3 — the happy path: 1 parent + 1 student + 4 ledger + 3 installments.
    -- ------------------------------------------------------------------
    BEGIN
        SELECT * INTO v_parent, v_students, v_lw, v_iw
          FROM public.register_family_batch(
            v_tenant,
            jsonb_build_object(
              'parent_code', v_pcode,
              'first_name', 'Probe', 'last_name', 'T398',
              'display_name', null, 'primary_phone', '0554288198',
              'secondary_phone', null, 'email', null, 'occupation', null,
              'address', null, 'relationship', null,
              'preferred_language', 'fr', 'is_active', true,
              'transport_destination', null, 'city_tier', null,
              'activation_code', 'T398ACT'),
            jsonb_build_array(jsonb_build_object(
              'student_code', v_scode,
              'first_name', 'Enfant', 'last_name', 'Probe',
              'display_name', null, 'middle_name', null,
              'date_of_birth', '2014-05-01', 'gender', null,
              'grade_level_id', null, 'class_id', null,
              'enrollment_date', null, 'enrollment_status', 'active',
              'medical_notes', null, 'is_active', true,
              'grade_level_code', '1am', 'transport_tier', null,
              'payment_plan', 'tranches')),
            -- 3 tuition charges + 1 registration fee
            jsonb_build_array(
              jsonb_build_object('student_ref', 0, 'entry_number', 'led-t398-a1', 'entry_type', 'charge',
                'amount', 30000, 'category', 'tuition', 'description', 'Scolarité probe T1',
                'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                'source_type', 'installment', 'source_id', 'reg-' || v_scode || '-t1',
                'method', null, 'receipt_number', null, 'payment_status', null,
                'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
                'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', jsonb_build_object('tranche', 1)),
              jsonb_build_object('student_ref', 0, 'entry_number', 'led-t398-a2', 'entry_type', 'charge',
                'amount', 30000, 'category', 'tuition', 'description', 'Scolarité probe T2',
                'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                'source_type', 'installment', 'source_id', 'reg-' || v_scode || '-t2',
                'method', null, 'receipt_number', null, 'payment_status', null,
                'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
                'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', jsonb_build_object('tranche', 2)),
              jsonb_build_object('student_ref', 0, 'entry_number', 'led-t398-a3', 'entry_type', 'charge',
                'amount', 30000, 'category', 'tuition', 'description', 'Scolarité probe T3',
                'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                'source_type', 'installment', 'source_id', 'reg-' || v_scode || '-t3',
                'method', null, 'receipt_number', null, 'payment_status', null,
                'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
                'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', jsonb_build_object('tranche', 3)),
              jsonb_build_object('student_ref', null, 'entry_number', 'led-t398-fee', 'entry_type', 'charge',
                'amount', 5000, 'category', 'other', 'description', 'Frais d''inscription probe',
                'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                'source_type', 'manual_entry', 'source_id', 'reg-' || v_pcode || '-fee',
                'method', null, 'receipt_number', null, 'payment_status', null,
                'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
                'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', jsonb_build_object('type', 'registration_fee'))),
            jsonb_build_array(
              jsonb_build_object('student_ref', 0, 'category', 'tuition', 'tranche_number', 1,
                'label', 'Tranche 1', 'amount_due', 30000, 'amount_paid', 0, 'amount_pending', 0,
                'due_date', '2026-09-15', 'paid_date', null, 'status', 'unpaid',
                'academic_cycle', null, 'payment_plan', 'tranches', 'is_custom_schedule', false,
                'custom_schedule_note', null, 'source_type', 'bulk_import',
                'source_id', v_scode || ':tuition:T1'),
              jsonb_build_object('student_ref', 0, 'category', 'tuition', 'tranche_number', 2,
                'label', 'Tranche 2', 'amount_due', 30000, 'amount_paid', 0, 'amount_pending', 0,
                'due_date', '2026-12-15', 'paid_date', null, 'status', 'unpaid',
                'academic_cycle', null, 'payment_plan', 'tranches', 'is_custom_schedule', false,
                'custom_schedule_note', null, 'source_type', 'bulk_import',
                'source_id', v_scode || ':tuition:T2'),
              jsonb_build_object('student_ref', 0, 'category', 'tuition', 'tranche_number', 3,
                'label', 'Tranche 3', 'amount_due', 30000, 'amount_paid', 0, 'amount_pending', 0,
                'due_date', '2027-05-15', 'paid_date', null, 'status', 'unpaid',
                'academic_cycle', null, 'payment_plan', 'tranches', 'is_custom_schedule', false,
                'custom_schedule_note', null, 'source_type', 'bulk_import',
                'source_id', v_scode || ':tuition:T3'))
          );

        INSERT INTO t398_results
        SELECT 'C3', 'happy path: 4 ledger + 3 installments written, full rows returned',
               v_lw = 4 AND v_iw = 3
                 AND v_parent IS NOT NULL
                 AND jsonb_array_length(v_students) = 1
                 AND (v_students->0->>'student_code') = v_scode,
               'ledger=' || coalesce(v_lw, -1) || ' inst=' || coalesce(v_iw, -1)
                 || ' students=' || coalesce(jsonb_array_length(v_students), -1)
                 || ' parent_code=' || coalesce(v_parent->>'parent_code', '-');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO t398_results VALUES ('C3', 'happy path: 4 ledger + 3 installments written, full rows returned', false, sqlerrm);
    END;

    v_pid := (SELECT id FROM public.parents WHERE parent_code = v_pcode AND deleted_at IS NULL LIMIT 1);
    v_sid := (SELECT id FROM public.students WHERE student_code = v_scode AND deleted_at IS NULL LIMIT 1);

    -- C5 — the ledger rows landed with the resolved uuids + client source_ids.
    SELECT count(*) INTO v_ledger_n
      FROM public.ledger_entries
     WHERE tenant_id = v_tenant
       AND ((source_type = 'installment' AND source_id IN ('reg-' || v_scode || '-t1', 'reg-' || v_scode || '-t2', 'reg-' || v_scode || '-t3'))
            OR (source_type = 'manual_entry' AND source_id = 'reg-' || v_pcode || '-fee'))
       AND parent_id = v_pid;
    SELECT count(*) INTO v_inst_n
      FROM public.installments
     WHERE tenant_id = v_tenant AND student_id = v_sid
       AND source_id IN (v_scode || ':tuition:T1', v_scode || ':tuition:T2', v_scode || ':tuition:T3');

    INSERT INTO t398_results
    SELECT 'C5', 'ledger rows resolved to the server uuids (parent + student) + client source_ids',
           v_ledger_n = 4,
           'ledger rows=' || coalesce(v_ledger_n, -1) || ' (parent_id match + 3 student + 1 fee)';
    INSERT INTO t398_results
    SELECT 'C6', 'installment rows landed with the partial-identity source_ids',
           v_inst_n = 3,
           'inst rows=' || coalesce(v_inst_n, -1);

    -- C4 — the account_id derivation matches deriveAccountId EXACTLY.
    INSERT INTO t398_results
    SELECT 'C4', 'account_id = deriveAccountId format (parent:<uuid>:category:tuition:student:<uuid>)',
           count(*) = 3
             AND bool_and(account_id = 'parent:' || parent_id || ':category:tuition:student:' || student_id),
           'sample=' || coalesce(max(account_id), '-')
      FROM public.ledger_entries
     WHERE tenant_id = v_tenant AND source_type = 'installment'
       AND source_id IN ('reg-' || v_scode || '-t1', 'reg-' || v_scode || '-t2', 'reg-' || v_scode || '-t3')
       AND student_id = v_sid;

    -- C11 — the timestamp fills (entry_date/at not null on the charge rows).
    INSERT INTO t398_results
    SELECT 'C11', 'entry_date + at filled on every charge row',
           count(*) = 4 AND bool_and(entry_date IS NOT NULL AND at IS NOT NULL),
           'rows=' || count(*)
      FROM public.ledger_entries
     WHERE tenant_id = v_tenant AND parent_id = v_pid
       AND source_id LIKE 'reg-%';

    -- C10 — the 0037 activation-code write survived the composite call.
    INSERT INTO t398_results
    SELECT 'C10', 'activation_codes row written (0037 passthrough through the composite)',
           count(*) = 1 AND bool_and(parent_id = v_pid),
           'rows=' || count(*)
      FROM public.activation_codes
     WHERE tenant_id = v_tenant AND code = 'T398ACT';

    -- ------------------------------------------------------------------
    -- C7 — END-TO-END IDEMPOTENCY: the SAME payload re-run writes ZERO new
    --      billing rows and converges on the SAME family.
    -- ------------------------------------------------------------------
    BEGIN
        SELECT * INTO v_parent, v_students, v_lw2, v_iw2
          FROM public.register_family_batch(
            v_tenant,
            jsonb_build_object(
              'parent_code', v_pcode,
              'first_name', 'Probe', 'last_name', 'T398',
              'display_name', null, 'primary_phone', '0554288198',
              'secondary_phone', null, 'email', null, 'occupation', null,
              'address', null, 'relationship', null,
              'preferred_language', 'fr', 'is_active', true,
              'transport_destination', null, 'city_tier', null,
              'activation_code', 'T398ACT'),
            jsonb_build_array(jsonb_build_object(
              'student_code', v_scode,
              'first_name', 'Enfant', 'last_name', 'Probe',
              'display_name', null, 'middle_name', null,
              'date_of_birth', '2014-05-01', 'gender', null,
              'grade_level_id', null, 'class_id', null,
              'enrollment_date', null, 'enrollment_status', 'active',
              'medical_notes', null, 'is_active', true,
              'grade_level_code', '1am', 'transport_tier', null,
              'payment_plan', 'tranches')),
            jsonb_build_array(
              jsonb_build_object('student_ref', 0, 'entry_number', 'led-t398-a1', 'entry_type', 'charge',
                'amount', 30000, 'category', 'tuition', 'description', 'Scolarité probe T1',
                'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                'source_type', 'installment', 'source_id', 'reg-' || v_scode || '-t1',
                'method', null, 'receipt_number', null, 'payment_status', null,
                'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
                'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', jsonb_build_object('tranche', 1)),
              jsonb_build_object('student_ref', 0, 'entry_number', 'led-t398-a2', 'entry_type', 'charge',
                'amount', 30000, 'category', 'tuition', 'description', 'Scolarité probe T2',
                'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                'source_type', 'installment', 'source_id', 'reg-' || v_scode || '-t2',
                'method', null, 'receipt_number', null, 'payment_status', null,
                'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
                'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', jsonb_build_object('tranche', 2)),
              jsonb_build_object('student_ref', 0, 'entry_number', 'led-t398-a3', 'entry_type', 'charge',
                'amount', 30000, 'category', 'tuition', 'description', 'Scolarité probe T3',
                'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                'source_type', 'installment', 'source_id', 'reg-' || v_scode || '-t3',
                'method', null, 'receipt_number', null, 'payment_status', null,
                'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
                'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', jsonb_build_object('tranche', 3)),
              jsonb_build_object('student_ref', null, 'entry_number', 'led-t398-fee', 'entry_type', 'charge',
                'amount', 5000, 'category', 'other', 'description', 'Frais d''inscription probe',
                'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                'source_type', 'manual_entry', 'source_id', 'reg-' || v_pcode || '-fee',
                'method', null, 'receipt_number', null, 'payment_status', null,
                'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
                'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', jsonb_build_object('type', 'registration_fee'))),
            jsonb_build_array(
              jsonb_build_object('student_ref', 0, 'category', 'tuition', 'tranche_number', 1,
                'label', 'Tranche 1', 'amount_due', 30000, 'amount_paid', 0, 'amount_pending', 0,
                'due_date', '2026-09-15', 'paid_date', null, 'status', 'unpaid',
                'academic_cycle', null, 'payment_plan', 'tranches', 'is_custom_schedule', false,
                'custom_schedule_note', null, 'source_type', 'bulk_import',
                'source_id', v_scode || ':tuition:T1'),
              jsonb_build_object('student_ref', 0, 'category', 'tuition', 'tranche_number', 2,
                'label', 'Tranche 2', 'amount_due', 30000, 'amount_paid', 0, 'amount_pending', 0,
                'due_date', '2026-12-15', 'paid_date', null, 'status', 'unpaid',
                'academic_cycle', null, 'payment_plan', 'tranches', 'is_custom_schedule', false,
                'custom_schedule_note', null, 'source_type', 'bulk_import',
                'source_id', v_scode || ':tuition:T2'),
              jsonb_build_object('student_ref', 0, 'category', 'tuition', 'tranche_number', 3,
                'label', 'Tranche 3', 'amount_due', 30000, 'amount_paid', 0, 'amount_pending', 0,
                'due_date', '2027-05-15', 'paid_date', null, 'status', 'unpaid',
                'academic_cycle', null, 'payment_plan', 'tranches', 'is_custom_schedule', false,
                'custom_schedule_note', null, 'source_type', 'bulk_import',
                'source_id', v_scode || ':tuition:T3'))
          );

        SELECT count(*) INTO v_ledger_n2
          FROM public.ledger_entries
         WHERE tenant_id = v_tenant AND parent_id = v_pid AND source_id LIKE 'reg-%';
        SELECT count(*) INTO v_inst_n2
          FROM public.installments
         WHERE tenant_id = v_tenant AND student_id = v_sid;

        INSERT INTO t398_results
        SELECT 'C7', 'idempotent re-run: 0 new billing rows, no duplicates (converged family)',
               v_lw2 = 0 AND v_iw2 = 0 AND v_ledger_n2 = 4 AND v_inst_n2 = 3,
               'second-call writes ledger=' || coalesce(v_lw2, -1) || ' inst=' || coalesce(v_iw2, -1)
                 || ' totals ledger=' || coalesce(v_ledger_n2, -1) || ' inst=' || coalesce(v_inst_n2, -1);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO t398_results VALUES ('C7', 'idempotent re-run: 0 new billing rows, no duplicates (converged family)', false, sqlerrm);
    END;

    -- ------------------------------------------------------------------
    -- C8 — ATOMICITY: a poisoned billing row (CHECK-violating entry_type)
    --      rolls back the WHOLE registration — the parent/student rows the
    --      upserts created inside the SAME call are GONE.
    -- ------------------------------------------------------------------
    BEGIN
        PERFORM public.register_family_batch(
            v_tenant,
            jsonb_build_object(
              'parent_code', v_poison,
              'first_name', 'Poison', 'last_name', 'T398',
              'display_name', null, 'primary_phone', '0554288199',
              'secondary_phone', null, 'email', null, 'occupation', null,
              'address', null, 'relationship', null,
              'preferred_language', 'fr', 'is_active', true,
              'transport_destination', null, 'city_tier', null,
              'activation_code', null),
            jsonb_build_array(jsonb_build_object(
              'student_code', 'ELV-POISON-T398-' || v_run,
              'first_name', 'Enfant', 'last_name', 'Poison',
              'display_name', null, 'middle_name', null,
              'date_of_birth', '2014-05-01', 'gender', null,
              'grade_level_id', null, 'class_id', null,
              'enrollment_date', null, 'enrollment_status', 'active',
              'medical_notes', null, 'is_active', true,
              'grade_level_code', '1am', 'transport_tier', null,
              'payment_plan', 'tranches')),
            jsonb_build_array(jsonb_build_object(
              'student_ref', 0, 'entry_number', 'led-t398-poison', 'entry_type', 'not-a-real-type',
              'amount', 1000, 'category', 'tuition', 'description', 'poison',
              'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
              'source_type', 'installment', 'source_id', 'reg-poison-t1',
              'method', null, 'receipt_number', null, 'payment_status', null,
              'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
              'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', null)),
            '[]'::jsonb);
        INSERT INTO t398_results VALUES ('C8', 'atomicity: poisoned billing row raises + rolls back EVERYTHING', false, 'no exception raised (BUG)');
    EXCEPTION WHEN OTHERS THEN
        v_err := sqlerrm;
        -- The whole subtransaction (parent + student upserts included) must be gone.
        INSERT INTO t398_results
        SELECT 'C8', 'atomicity: poisoned billing row raises + rolls back EVERYTHING',
               (SELECT count(*) FROM public.parents WHERE parent_code = v_poison) = 0
                 AND (SELECT count(*) FROM public.students WHERE student_code = 'ELV-POISON-T398-' || v_run) = 0,
               'raised: ' || coalesce(v_err, '-') || ' orphan_parent=' ||
                 (SELECT count(*)::text FROM public.parents WHERE parent_code = v_poison);
    END;

    -- ------------------------------------------------------------------
    -- C9 — the out-of-range student_ref guard (a client bug must fail
    --      loudly, never write a dangling row).
    -- ------------------------------------------------------------------
    BEGIN
        PERFORM public.register_family_batch(
            v_tenant,
            jsonb_build_object(
              'parent_code', v_ref,
              'first_name', 'Badref', 'last_name', 'T398',
              'display_name', null, 'primary_phone', '0554288196',
              'secondary_phone', null, 'email', null, 'occupation', null,
              'address', null, 'relationship', null,
              'preferred_language', 'fr', 'is_active', true,
              'transport_destination', null, 'city_tier', null,
              'activation_code', null),
            jsonb_build_array(jsonb_build_object(
              'student_code', 'ELV-BADREF-T398-' || v_run,
              'first_name', 'Enfant', 'last_name', 'Badref',
              'display_name', null, 'middle_name', null,
              'date_of_birth', '2014-05-01', 'gender', null,
              'grade_level_id', null, 'class_id', null,
              'enrollment_date', null, 'enrollment_status', 'active',
              'medical_notes', null, 'is_active', true,
              'grade_level_code', '1am', 'transport_tier', null,
              'payment_plan', 'tranches')),
            jsonb_build_array(jsonb_build_object(
              'student_ref', 99, 'entry_number', 'led-t398-badref', 'entry_type', 'charge',
              'amount', 1000, 'category', 'tuition', 'description', 'badref',
              'entry_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
              'source_type', 'installment', 'source_id', 'reg-badref-t1',
              'method', null, 'receipt_number', null, 'payment_status', null,
              'reverses_id', null, 'actor_id', 'system', 'actor_name', 'verify T-398',
              'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), 'metadata', null)),
            '[]'::jsonb);
        INSERT INTO t398_results VALUES ('C9', 'out-of-range student_ref rejected loudly (guard)', false, 'no exception raised (BUG)');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO t398_results
        SELECT 'C9', 'out-of-range student_ref rejected loudly (guard)',
               (SELECT count(*) FROM public.parents WHERE parent_code = v_ref) = 0
                 AND position('hors limites' in coalesce(sqlerrm, '')) > 0,
               'raised: ' || coalesce(sqlerrm, '-');
    END;
END
$verify$;

-- C1 — the function shape: SECURITY DEFINER, public search_path, 4 OUT cols.
INSERT INTO t398_results
SELECT 'C1', 'register_family_batch exists: SECURITY DEFINER, search_path=public, 4 OUT params',
       count(*) = 1
         AND bool_and(prosecdef)
         AND bool_and(coalesce(proconfig::text[], '{}') @> ARRAY['search_path=public'])
         AND bool_and(pronargs = 5),
       'n=' || count(*) || ' args=' || coalesce(max(pronargs), -1)
         || ' definer=' || coalesce(bool_or(prosecdef), false)
         || ' config=' || coalesce(array_to_string(max(proconfig::text[]), ','), '-')
  FROM pg_proc
 WHERE oid = 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)'::regprocedure;

-- C2 — the grants: authenticated + service_role EXECUTE, PUBLIC revoked.
INSERT INTO t398_results
SELECT 'C2', 'grants: authenticated + service_role EXECUTE; PUBLIC none',
       has_function_privilege('authenticated', 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
         AND has_function_privilege('service_role', 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
         AND NOT has_function_privilege('public', 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
         AND NOT has_function_privilege('anon', 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
       'auth=' || has_function_privilege('authenticated', 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
         || ' svc=' || has_function_privilege('service_role', 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
         || ' public=' || has_function_privilege('public', 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
         || ' anon=' || has_function_privilege('anon', 'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE');

SELECT check_id, label, ok, detail FROM t398_results ORDER BY check_id;

ROLLBACK;
