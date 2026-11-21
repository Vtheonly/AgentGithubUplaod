-- ============================================================================
-- 0005_sync_apply_batch.sql
-- T-593 (E7A-4 / ROADMAP 6.6) — the transactional batch sync RPC.
--
-- WHAT: `sync_apply_batch(p_mutations jsonb)` — ONE transaction applying a
-- bounded batch of queued sync mutations through the EXISTING canonical
-- upsert RPCs (ADR-002's authority unchanged), upserting their sync_queue
-- audit rows inside the same transaction, and bulk-marking them synced.
--
-- WHY (OPS-015 class 4): the desktop's push pipeline previously cost
-- ~3-4 requests PER queued item (the sync_queue audit upsert + the entity
-- RPC + the mark_sync_queue_processed mark) — a 1,000-row import burned
-- ~3-4,000 requests. The batch collapses N entries into ONE round trip
-- (the bounded 50-entry chunks the TS dispatcher groups).
--
-- THE ATOMICITY CONTRACT: any mid-batch failure RAISES and rolls back the
-- WHOLE batch — the applies AND the queue rows (no partial import, no
-- half-marked audit trail; the failure-injection tests in the t-593 suite
-- pin the rollback). Per-item results are returned compactly: an empty
-- error set means every entry applied + marked.
--
-- THE MAPPING (the TS dispatcher's mirror, server-side): the payload's
-- camel/snake field fallbacks, the blank→NULL normalization (SYNC-300:
-- NULLIF(btrim(x), '')), and the uuid-or-NULL gate (a safe-uuid helper —
-- the 22P02 cast rejection happens BEFORE the body under SECURITY
-- INVOKER; the helper keeps the batch immune). The deterministic
-- parent-code/activation-code derivation when the payload carries no code
-- reuses the SAME SQL functions the server already ships
-- (fn_deterministic_parent_code seeded by the queue entry id — the
-- T-018/DRIFT-001 retry-stability contract) instead of re-implementing
-- the TS algorithm.
--
-- SECURITY: SECURITY DEFINER + search_path 'public' (the house rule); the
-- session tenant is validated (current_tenant_id()) against every
-- mutation's tenant_id (a foreign-tenant mutation RAISES — the SYNC-102
-- confused-deputy guard the TS drain already applies client-side).
--
-- APPEND-ONLY (OPS-020): 0001..0004 untouched; this file appends as 0005.
-- ============================================================================

-- The safe-uuid gate (the uuidOrNull twin — a non-uuid string answers NULL
-- instead of failing the parameter cast).
create or replace function public.sync_safe_uuid(p_value text)
 returns uuid
 language sql
 immutable
as $function$
    select case
        when p_value is null or p_value ~ '^\s*$' then null
        when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid
        else null
    end
$function$
;
comment on function sync_safe_uuid(text) is 'T-593 (E7A-4): the uuidOrNull twin server-side — a non-uuid payload value answers NULL instead of the 22P02 cast rejection (SYNC-300).';

-- The blank-safe text extraction (blankToNull): payload->>'camel' with the
-- snake_case fallback, trimmed, empty → NULL.
create or replace function public.sync_j(payload jsonb, p_camel text, p_snake text)
 returns text
 language sql
 immutable
as $function$
    select nullif(btrim(coalesce(payload->>p_camel, payload->>p_snake, '')), '')
$function$
;
comment on function sync_j(jsonb, text, text) is 'T-593 (E7A-4): the payload text extraction with the camel/snake fallback + the blank→NULL normalization (the TS dispatcher mapping, server-side).';

-- The student-code twin of fn_deterministic_parent_code (the batch's
-- retry-stable fallback — DRIFT-001: the same code on every retry, never
-- random): the desktop deterministicStudentCode's exact rule.
create or replace function public.fn_deterministic_student_code(p_year integer, p_parent_id text DEFAULT NULL::text, p_display_name text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_fallback_seed text DEFAULT NULL::text)
 returns text
 language plpgsql
 immutable
as $function$
declare
    identity text;
begin
    -- Canonical rule (the desktop's deterministicStudentCode): the fixed
    -- 4-part join parentId|displayName|firstName|lastName, whole-string
    -- trim (NOT the parent's drop-empty-fields rule); the empty identity
    -- uses the fallback seed ('orphan-student' default) — NEVER random
    -- (T-018/DRIFT-001).
    identity := btrim(
        coalesce(p_parent_id, '') || '|' ||
        coalesce(p_display_name, '') || '|' ||
        coalesce(p_first_name, '') || '|' ||
        coalesce(p_last_name, '')
    );
    if identity = '' then
        identity := coalesce(nullif(btrim(p_fallback_seed), ''), 'orphan-student');
    end if;
    return 'ELV-' || p_year::text || '-' || public.fn_stable_hash(identity);
end
$function$
;
comment on function fn_deterministic_student_code(integer, text, text, text, text, text) is 'T-593 (E7A-4): the student-code twin of fn_deterministic_parent_code — mirrors desktop deterministicStudentCode (the 4-part identity join, the orphan-student fallback, fn_stable_hash).';

create or replace function public.sync_apply_batch(p_mutations jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
declare
    v_tenant uuid := public.current_tenant_id();
    m jsonb;
    v_entity text;
    v_payload jsonb;
    v_results jsonb := '[]'::jsonb;
    v_ids text[] := array[]::text[];
    v_parent_code text;
    v_student_code text;
    v_homework_row record;
begin
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;
    if p_mutations is null or jsonb_typeof(p_mutations) <> 'array' then
        raise exception 'invalid mutations payload: expected a jsonb array';
    end if;

    for m in select * from jsonb_array_elements(p_mutations) loop
        v_entity := m->>'entity';
        v_payload := coalesce(m->'payload', '{}'::jsonb);

        -- SYNC-102 (the confused-deputy guard, server-side): every
        -- mutation's tenant must equal the session's tenant.
        if (m->>'tenant_id')::text is not null and (m->>'tenant_id')::text <> v_tenant::text then
            raise exception 'forbidden: mutation % targets tenant % (session %)', m->>'id', m->>'tenant_id', v_tenant;
        end if;

        -- The audit row INSIDE the transaction (SYNC-101: ON CONFLICT DO
        -- NOTHING — a re-drain never resets the row to pending).
        insert into public.sync_queue (id, tenant_id, entity, operation, actor_id, payload, source_file, import_run_id, queued_at, status)
        values (
            m->>'id',
            v_tenant,
            v_entity,
            coalesce(m->>'operation', 'insert'),
            public.sync_safe_uuid(m->>'actor_id'),
            v_payload,
            m->>'source_file',
            m->>'import_run_id',
            coalesce((m->>'queued_at')::timestamptz, now()),
            'pending'
        )
        on conflict (id) do nothing;

        -- The canonical dispatch (ADR-002's authority unchanged — the
        -- per-mutation apply goes through the same upsert RPCs the
        -- per-item dispatcher uses).
        case v_entity
            when 'parent' then
                v_parent_code := coalesce(
                    public.sync_j(v_payload, 'code', 'parent_code'),
                    public.fn_deterministic_parent_code(
                        extract(year from now())::int,
                        public.sync_j(v_payload, 'phone', 'primary_phone'),
                        public.sync_j(v_payload, 'displayName', 'display_name'),
                        public.sync_j(v_payload, 'firstName', 'first_name'),
                        public.sync_j(v_payload, 'lastName', 'last_name'),
                        m->>'id'
                    )
                );
                perform public.upsert_parent_from_import(
                    v_tenant,
                    v_parent_code,
                    coalesce(public.sync_j(v_payload, 'firstName', 'first_name'), ''),
                    coalesce(public.sync_j(v_payload, 'lastName', 'last_name'), ''),
                    public.sync_j(v_payload, 'displayName', 'display_name'),
                    coalesce(public.sync_j(v_payload, 'phone', 'primary_phone'), '(inconnu)'),
                    public.sync_j(v_payload, 'whatsapp', 'secondary_phone'),
                    public.sync_j(v_payload, 'email', 'email'),
                    public.sync_j(v_payload, 'occupation', 'occupation'),
                    public.sync_j(v_payload, 'address', 'address'),
                    null,
                    coalesce(public.sync_j(v_payload, 'preferredLanguage', 'preferred_language'), 'fr'),
                    true,
                    public.sync_j(v_payload, 'transportDestination', 'transport_destination'),
                    public.sync_j(v_payload, 'cityTier', 'city_tier'),
                    public.fn_deterministic_activation_code(v_parent_code, v_tenant)
                );
            when 'student' then
                v_student_code := coalesce(
                    public.sync_j(v_payload, 'code', 'student_code'),
                    public.fn_deterministic_student_code(
                        extract(year from now())::int,
                        coalesce(public.sync_j(v_payload, 'parentId', 'parent_id'), ''),
                        public.sync_j(v_payload, 'displayName', 'display_name'),
                        public.sync_j(v_payload, 'firstName', 'first_name'),
                        public.sync_j(v_payload, 'lastName', 'last_name'),
                        m->>'id'
                    )
                );
                perform public.upsert_student_from_import(
                    v_tenant,
                    v_student_code,
                    coalesce(public.sync_j(v_payload, 'parentId', 'parent_id'), ''),
                    coalesce(public.sync_j(v_payload, 'firstName', 'first_name'), ''),
                    coalesce(public.sync_j(v_payload, 'lastName', 'last_name'), ''),
                    public.sync_j(v_payload, 'displayName', 'display_name'),
                    null,
                    nullif(btrim(coalesce(v_payload->>'birthDate', v_payload->>'date_of_birth', '')), '')::date,
                    case when v_payload->>'gender' = 'unspecified' then null else public.sync_j(v_payload, 'gender', 'gender') end,
                    null,
                    public.sync_safe_uuid(coalesce(v_payload->>'classId', v_payload->>'class_id')),
                    null,
                    'active',
                    public.sync_j(v_payload, 'medicalNotes', 'medical_notes'),
                    true,
                    public.sync_j(v_payload, 'gradeLevel', 'grade_level_code'),
                    public.sync_j(v_payload, 'transportTier', 'transport_tier'),
                    coalesce(public.sync_j(v_payload, 'paymentPlan', 'payment_plan'), 'tranches')
                );
            when 'payment' then
                perform public.upsert_payment_from_import(
                    v_tenant,
                    public.sync_j(v_payload, 'receiptNumber', 'payment_number'),
                    coalesce(public.sync_j(v_payload, 'parentId', 'parent_id'), ''),
                    public.sync_j(v_payload, 'studentId', 'student_id'),
                    null,
                    public.sync_j(v_payload, 'installmentId', 'installment_id'),
                    coalesce((coalesce(v_payload->>'amount', '0'))::numeric, 0),
                    coalesce(public.sync_j(v_payload, 'method', 'method'), 'cash'),
                    coalesce(public.sync_j(v_payload, 'category', 'category'), 'other'),
                    public.sync_j(v_payload, 'status', 'status'),
                    public.sync_j(v_payload, 'proofUrl', 'proof_path'),
                    nullif(btrim(coalesce(v_payload->>'collectedAt', v_payload->>'collected_at', '')), '')::timestamptz,
                    public.sync_safe_uuid(coalesce(v_payload->>'collectedBy', v_payload->>'collected_by')),
                    public.sync_j(v_payload, 'notes', 'notes')
                );
            when 'ledger_entry' then
                perform public.upsert_ledger_entry_from_import(
                    v_tenant,
                    coalesce(public.sync_j(v_payload, 'id', 'entry_number'), m->>'id'),
                    coalesce(public.sync_j(v_payload, 'parentId', 'parent_id'), ''),
                    public.sync_j(v_payload, 'studentId', 'student_id'),
                    public.sync_j(v_payload, 'accountId', 'account_id'),
                    coalesce(public.sync_j(v_payload, 'type', 'entry_type'), 'charge'),
                    coalesce((coalesce(v_payload->>'amount', '0'))::numeric, 0),
                    coalesce(public.sync_j(v_payload, 'category', 'category'), 'other'),
                    public.sync_j(v_payload, 'description', 'description'),
                    coalesce(public.sync_j(v_payload, 'sourceType', 'source_type'), 'bulk_import'),
                    public.sync_j(v_payload, 'sourceId', 'source_id'),
                    public.sync_j(v_payload, 'method', 'method'),
                    public.sync_j(v_payload, 'receiptNumber', 'receipt_number'),
                    public.sync_j(v_payload, 'paymentStatus', 'payment_status'),
                    public.sync_j(v_payload, 'reversesId', 'reverses_id'),
                    coalesce(public.sync_safe_uuid(coalesce(v_payload->>'actorId', v_payload->>'actor_id'))::text, m->>'actor_id'),
                    coalesce(public.sync_j(v_payload, 'actorName', 'actor_name'), 'System'),
                    nullif(btrim(coalesce(v_payload->>'at', '')), '')::timestamptz,
                    v_payload->'metadata'
                );
            when 'installment' then
                perform public.upsert_installment_from_import(
                    v_tenant,
                    coalesce(public.sync_j(v_payload, 'parentId', 'parent_id'), ''),
                    coalesce(public.sync_j(v_payload, 'id', 'installment_ref'), m->>'id'),
                    public.sync_j(v_payload, 'studentId', 'student_id'),
                    coalesce(public.sync_j(v_payload, 'category', 'category'), 'tuition'),
                    public.sync_j(v_payload, 'label', 'label'),
                    nullif(btrim(coalesce(v_payload->>'amountDue', v_payload->>'amount_due', '')), '')::numeric,
                    nullif(btrim(coalesce(v_payload->>'amountPaid', v_payload->>'amount_paid', '')), '')::numeric,
                    nullif(btrim(coalesce(v_payload->>'amountPending', v_payload->>'amount_pending', '')), '')::numeric,
                    nullif(btrim(coalesce(v_payload->>'dueDate', v_payload->>'due_date', '')), '')::date,
                    nullif(btrim(coalesce(v_payload->>'paidDate', v_payload->>'paid_date', '')), '')::date,
                    coalesce(public.sync_j(v_payload, 'status', 'status'), 'unpaid'),
                    public.sync_j(v_payload, 'academicCycle', 'academic_cycle'),
                    public.sync_j(v_payload, 'academicYear', 'academic_year')
                );
            when 'attendance' then
                perform public.upsert_attendance_from_import(
                    v_tenant,
                    public.sync_safe_uuid(coalesce(v_payload->>'studentId', v_payload->>'student_id')),
                    nullif(btrim(coalesce(v_payload->>'recordDate', v_payload->>'record_date', v_payload->>'date', '')), '')::date,
                    coalesce(public.sync_j(v_payload, 'status', 'status'), 'present'),
                    public.sync_safe_uuid(coalesce(v_payload->>'classId', v_payload->>'class_id')),
                    coalesce(public.sync_j(v_payload, 'session', 'session'), 'morning'),
                    public.sync_j(v_payload, 'arrivalTime', 'arrival_time'),
                    public.sync_j(v_payload, 'note', 'note'),
                    public.sync_safe_uuid(coalesce(v_payload->>'recordedBy', v_payload->>'recorded_by', m->>'actor_id'))
                );
            when 'grade' then
                perform public.upsert_assessment_from_import(
                    v_tenant,
                    public.sync_safe_uuid(coalesce(v_payload->>'studentId', v_payload->>'student_id')),
                    public.sync_safe_uuid(coalesce(v_payload->>'subjectId', v_payload->>'subject_id')),
                    coalesce((coalesce(v_payload->>'term', '1'))::integer, 1),
                    coalesce(public.sync_j(v_payload, 'academicYear', 'academic_year'), ''),
                    public.sync_safe_uuid(coalesce(v_payload->>'classId', v_payload->>'class_id')),
                    nullif(btrim(coalesce(v_payload->>'devoir1', '')), '')::numeric,
                    nullif(btrim(coalesce(v_payload->>'devoir2', '')), '')::numeric,
                    nullif(btrim(coalesce(v_payload->>'examen', '')), '')::numeric,
                    coalesce((coalesce(v_payload->>'coefficient', '1'))::numeric, 1),
                    public.sync_safe_uuid(m->>'actor_id')
                );
            when 'homework' then
                -- The table upsert (the canonical path — no dedicated import
                -- RPC exists for homework on either client).
                if public.sync_j(v_payload, 'id', 'id') is null
                    or public.sync_j(v_payload, 'classId', 'class_id') is null
                    or public.sync_j(v_payload, 'subjectId', 'subject_id') is null then
                    raise exception 'sync_apply_batch(homework): id, classId and subjectId are required';
                end if;
                insert into public.homework as v_homework_row (
                    id, tenant_id, class_id, subject_id, subject_name, teacher_id, teacher_name,
                    title, description, due_date, academic_year, pushed_at, created_at, attachments
                ) values (
                    public.sync_j(v_payload, 'id', 'id'),
                    v_tenant,
                    public.sync_j(v_payload, 'classId', 'class_id'),
                    public.sync_j(v_payload, 'subjectId', 'subject_id'),
                    public.sync_j(v_payload, 'subjectName', 'subject_name'),
                    public.sync_j(v_payload, 'teacherId', 'teacher_id'),
                    public.sync_j(v_payload, 'teacherName', 'teacher_name'),
                    coalesce(public.sync_j(v_payload, 'title', 'title'), 'Devoir'),
                    coalesce(v_payload->>'description', ''),
                    coalesce(public.sync_j(v_payload, 'dueDate', 'due_date'), ''),
                    public.sync_j(v_payload, 'academicYear', 'academic_year'),
                    nullif(btrim(coalesce(v_payload->>'pushedAt', '')), '')::timestamptz,
                    nullif(btrim(coalesce(v_payload->>'createdAt', v_payload->>'created_at', '')), '')::timestamptz,
                    v_payload->'attachments'
                )
                on conflict (id) do update set
                    subject_name = coalesce(excluded.subject_name, v_homework_row.subject_name),
                    teacher_id = coalesce(excluded.teacher_id, v_homework_row.teacher_id),
                    teacher_name = coalesce(excluded.teacher_name, v_homework_row.teacher_name),
                    title = excluded.title,
                    description = excluded.description,
                    due_date = excluded.due_date,
                    academic_year = coalesce(excluded.academic_year, v_homework_row.academic_year),
                    pushed_at = coalesce(excluded.pushed_at, v_homework_row.pushed_at),
                    attachments = coalesce(excluded.attachments, v_homework_row.attachments);
            else
                -- The SYNC-100 doctrine: NO silent no-ops — an unknown kind
                -- FAILS LOUD (and rolls the whole batch back).
                raise exception 'sync_apply_batch: no canonical push path for entity kind "%" — the batch is rolled back', v_entity;
        end case;

        v_ids := array_append(v_ids, m->>'id');
        v_results := v_results || jsonb_build_object('id', m->>'id', 'status', 'synced');
    end loop;

    -- The bulk mark: every applied entry's queue row → synced (atomic with
    -- the applies above — a mid-batch failure rolled BOTH back already).
    update public.sync_queue
       set status = 'synced',
           last_error = null,
           last_attempt_at = now(),
           pushed_at = now()
     where id = any (v_ids)
       and tenant_id = v_tenant;

    return v_results;
end;
$function$
;
comment on function sync_apply_batch(jsonb) is 'T-593 (E7A-4): the transactional batch sync RPC — one transaction, the per-mutation apply through the canonical upsert RPCs (ADR-002 unchanged), the queue rows upserted + bulk-marked inside the same transaction; a mid-batch failure rolls back the applies AND the queue rows. The 3-4-requests-per-queued-item pattern collapses to ONE round trip per 50-entry chunk.';
