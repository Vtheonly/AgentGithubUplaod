-- ============================================================================
-- 0022_functions.sql
-- ============================================================================
-- PostgreSQL functions for complex business logic that must run atomically
-- inside the database. These functions are callable from Edge Functions
-- (server-side, using service_role key) and from the desktop/mobile/web
-- clients (using anon key, subject to RLS).
--
-- All functions are SECURITY DEFINER (run with the function owner's
-- privileges, NOT the caller's). This is necessary so they can write to
-- tables like ledger_entries and audit_logs that have restrictive RLS.
-- SECURITY DEFINER functions MUST set search_path = public to prevent
-- search_path injection attacks.
-- ============================================================================

-- ============================================================================
-- 1. batch_register_family — atomic parent + N students registration
-- ============================================================================
create or replace function public.batch_register_family(
    p_tenant_id uuid,
    p_parent jsonb,
    p_students jsonb,
    p_actor_profile_id uuid,
    p_activation_code text default null
)
returns table(parent_id uuid, student_ids uuid[])
language plpgsql
security definer
set search_path = public
as $$
declare
    v_parent_id uuid;
    v_student_ids uuid[] := '{}';
    v_student jsonb;
    v_parent_code text;
    v_student_code text;
    v_seq integer;
    v_activation_code text;
    v_audit_id uuid;
begin
    -- Generate parent code
    v_parent_code := 'PAR-' || extract(year from now())::text || '-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 4));

    -- Insert parent
    insert into public.parents (
        tenant_id, parent_code, first_name, last_name, primary_phone,
        secondary_phone, email, national_id, occupation, address, city,
        postal_code, relationship, notes, is_active, created_at, updated_at
    ) values (
        p_tenant_id, v_parent_code,
        p_parent->>'first_name', p_parent->>'last_name', p_parent->>'primary_phone',
        p_parent->>'secondary_phone', p_parent->>'email', p_parent->>'national_id',
        p_parent->>'occupation', p_parent->>'address', p_parent->>'city',
        p_parent->>'postal_code', p_parent->>'relationship', p_parent->>'notes',
        true, now(), now()
    )
    returning id into v_parent_id;

    -- Insert students
    for v_student in select * from jsonb_array_elements(p_students)
    loop
        v_seq := nextval('public.student_seq');
        v_student_code := 'ELV-' || extract(year from now())::text || '-' || lpad(v_seq::text, 6, '0');

        insert into public.students (
            tenant_id, parent_id, student_code, first_name, middle_name, last_name,
            date_of_birth, gender, grade_level_id, class_id, enrollment_date,
            enrollment_status, medical_notes, is_active, created_at, updated_at
        ) values (
            p_tenant_id, v_parent_id, v_student_code,
            v_student->>'first_name', v_student->>'middle_name', v_student->>'last_name',
            (v_student->>'date_of_birth')::date,
            v_student->>'gender',
            nullif(v_student->>'grade_level_id', '')::uuid,
            nullif(v_student->>'class_id', '')::uuid,
            current_date, 'enrolled', v_student->>'medical_notes',
            true, now(), now()
        )
        returning id into array v_student_ids[cardinality(v_student_ids) + 1];
    end loop;

    -- Issue activation code (or use provided one)
    if p_activation_code is not null then
        v_activation_code := p_activation_code;
    else
        v_activation_code := public.generate_activation_code(p_tenant_id);
    end if;

    insert into public.activation_codes (
        tenant_id, code, parent_id, issued_by, issued_at, expires_at
    ) values (
        p_tenant_id, v_activation_code, v_parent_id, p_actor_profile_id, now(), now() + interval '30 days'
    );

    -- Write audit log
    v_audit_id := public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'parent.batch_register',
        p_entity_type := 'parent',
        p_entity_id := v_parent_id,
        p_actor_id := p_actor_profile_id,
        p_before_json := null,
        p_after_json := jsonb_build_object('parent_id', v_parent_id, 'student_ids', v_student_ids, 'activation_code', v_activation_code),
        p_note := 'Atomic batch registration: parent + ' || cardinality(v_student_ids) || ' students'
    );

    return query select v_parent_id, v_student_ids;
end;
$$;

comment on function public.batch_register_family is
  'Atomic batch registration per plan §04.03. Inserts parent + N students in a single transaction. On any failure, raises exception (transaction rolls back). Issues activation code.';

-- Sequence for student codes
create sequence if not exists public.student_seq start 1;

-- ============================================================================
-- 2. collect_payment — atomic payment collection with ledger + receipt
-- ============================================================================
create or replace function public.collect_payment(
    p_tenant_id uuid,
    p_parent_id uuid,
    p_student_id uuid,
    p_amount numeric,
    p_method text,
    p_invoice_id uuid default null,
    p_installment_id uuid default null,
    p_actor_profile_id uuid default null,
    p_notes text default null,
    p_check_number text default null,
    p_check_bank_name text default null,
    p_check_issue_date date default null,
    p_check_clearance_date date default null,
    p_transfer_reference text default null,
    p_transfer_source_bank text default null,
    p_proof_path text default null
)
returns table(payment_id uuid, receipt_id uuid, new_installment_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_payment_id uuid;
    v_receipt_id uuid;
    v_payment_number text;
    v_receipt_number text;
    v_seq integer;
    v_new_status text;
    v_account_id text;
    v_audit_id uuid;
begin
    -- Generate payment number
    v_seq := nextval('public.payment_seq');
    v_payment_number := 'PAY-' || extract(year from now())::text || '-' || lpad(v_seq::text, 6, '0');

    -- Insert payment (enforce_payment_proof trigger validates method-specific fields)
    insert into public.payments (
        tenant_id, payment_number, parent_id, student_id, invoice_id, installment_id,
        amount, method, check_number, check_bank_name, check_issue_date, check_clearance_date,
        transfer_reference, transfer_source_bank, proof_path, status, collected_at,
        collected_by, notes, created_at, updated_at
    ) values (
        p_tenant_id, v_payment_number, p_parent_id, p_student_id, p_invoice_id, p_installment_id,
        p_amount, p_method, p_check_number, p_check_bank_name, p_check_issue_date, p_check_clearance_date,
        p_transfer_reference, p_transfer_source_bank, p_proof_path,
        case p_method when 'cash' then 'paid' else 'pending' end,
        now(), p_actor_profile_id, p_notes, now(), now()
    )
    returning id into v_payment_id;

    -- If installment linked, update amount_paid (trigger auto-computes status)
    if p_installment_id is not null then
        update public.installments
           set amount_paid = amount_paid + p_amount,
               paid_date = case when method = 'cash' then current_date else paid_date end
         where id = p_installment_id
         returning status into v_new_status;
    end if;

    -- Append ledger entry (canonical accounting)
    v_account_id := 'parent:' || p_parent_id::text || ':category:payment';
    if p_student_id is not null then
        v_account_id := v_account_id || ':student:' || p_student_id::text;
    end if;

    insert into public.ledger_entries (
        tenant_id, entry_number, parent_id, student_id, payment_id, account_id,
        entry_type, amount, category, description, entry_date, created_at
    ) values (
        p_tenant_id,
        'LED-' || extract(year from now())::text || '-' || lpad(nextval('public.ledger_seq')::text, 6, '0'),
        p_parent_id, p_student_id, v_payment_id, v_account_id,
        'payment', -p_amount,  -- negative = credit (payment received)
        'payment',
        'Paiement ' || v_payment_number || ' (' || p_method || ')',
        now(), now()
    );

    -- Generate receipt
    v_receipt_number := 'RCP-' || extract(year from now())::text || '-' || lpad(nextval('public.receipt_seq')::text, 5, '0');
    insert into public.receipts (
        tenant_id, receipt_number, receipt_kind, payment_id, parent_id,
        pdf_path, generated_at, generated_by, created_at
    ) values (
        p_tenant_id, v_receipt_number, 'recent_payment', v_payment_id, p_parent_id,
        p_tenant_id::text || '/' || v_payment_id::text || '/receipt-' || v_receipt_number || '.pdf',
        now(), p_actor_profile_id, now()
    )
    returning id into v_receipt_id;

    -- Write audit log
    v_audit_id := public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'payment.collect',
        p_entity_type := 'payment',
        p_entity_id := v_payment_id,
        p_actor_id := p_actor_profile_id,
        p_after_json := jsonb_build_object(
            'payment_id', v_payment_id, 'amount', p_amount, 'method', p_method,
            'parent_id', p_parent_id, 'installment_id', p_installment_id,
            'receipt_id', v_receipt_id, 'ledger_account', v_account_id
        )
    );

    return query select v_payment_id, v_receipt_id, v_new_status;
end;
$$;

create sequence if not exists public.payment_seq start 1;
create sequence if not exists public.ledger_seq start 1;
create sequence if not exists public.receipt_seq start 1;

comment on function public.collect_payment is
  'Atomic payment collection: payment + installment update + ledger entry + receipt + audit log. Per plan §07.';

-- ============================================================================
-- 3. refund_payment — atomic refund via reversal
-- ============================================================================
create or replace function public.refund_payment(
    p_tenant_id uuid,
    p_payment_id uuid,
    p_actor_profile_id uuid,
    p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_original record;
    v_reversal_id uuid;
    v_reversal_number text;
    v_account_id text;
begin
    select * into v_original from public.payments where id = p_payment_id and tenant_id = p_tenant_id;
    if not found then
        raise exception 'Payment not found';
    end if;

    -- Generate reversal payment number
    v_reversal_number := 'PAY-' || extract(year from now())::text || '-' || lpad(nextval('public.payment_seq')::text, 6, '0');

    -- Insert reversal payment
    insert into public.payments (
        tenant_id, payment_number, parent_id, student_id, invoice_id, installment_id,
        amount, method, status, collected_at, collected_by, notes,
        reversal_of_payment_id, created_at, updated_at
    ) values (
        v_original.tenant_id, v_reversal_number, v_original.parent_id, v_original.student_id,
        v_original.invoice_id, v_original.installment_id,
        v_original.amount, v_original.method, 'refunded', now(), p_actor_profile_id,
        'REVERSAL: ' || p_reason, v_original.id, now(), now()
    )
    returning id into v_reversal_id;

    -- Update original payment status
    update public.payments set status = 'refunded', updated_at = now() where id = p_payment_id;

    -- If installment linked, reverse the amount_paid
    if v_original.installment_id is not null then
        update public.installments
           set amount_paid = greatest(0, amount_paid - v_original.amount),
               paid_date = null,
               updated_at = now()
         where id = v_original.installment_id;
    end if;

    -- Append reversal ledger entry (negates original)
    v_account_id := 'parent:' || v_original.parent_id::text || ':category:payment';
    if v_original.student_id is not null then
        v_account_id := v_account_id || ':student:' || v_original.student_id::text;
    end if;

    insert into public.ledger_entries (
        tenant_id, entry_number, parent_id, student_id, payment_id, account_id,
        entry_type, amount, category, description, entry_date, created_at
    ) values (
        p_tenant_id,
        'LED-' || extract(year from now())::text || '-' || lpad(nextval('public.ledger_seq')::text, 6, '0'),
        v_original.parent_id, v_original.student_id, v_reversal_id, v_account_id,
        'reversal', v_original.amount,  -- positive = debit (reverses the original credit)
        'payment',
        'Reversal of payment ' || v_original.payment_number || ': ' || p_reason,
        now(), now()
    );

    -- Write audit log
    perform public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'payment.refund',
        p_entity_type := 'payment',
        p_entity_id := v_reversal_id,
        p_actor_id := p_actor_profile_id,
        p_before_json := to_jsonb(v_original),
        p_after_json := jsonb_build_object('reversal_id', v_reversal_id, 'original_id', v_original.id, 'reason', p_reason)
    );

    return v_reversal_id;
end;
$$;

comment on function public.refund_payment is
  'Atomic refund: reversal payment + original status update + installment rollback + reversal ledger entry + audit log. Per plan §07.';

-- ============================================================================
-- 4. approve_expense — atomic expense approval (no-self-approval enforced)
-- ============================================================================
create or replace function public.approve_expense(
    p_tenant_id uuid,
    p_ticket_id uuid,
    p_approver_profile_id uuid,
    p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ticket record;
    v_audit_id uuid;
begin
    select * into v_ticket from public.expense_tickets where id = p_ticket_id and tenant_id = p_tenant_id;
    if not found then raise exception 'Expense ticket not found'; end if;

    if v_ticket.submitted_by = p_approver_profile_id then
        raise exception 'Self-approval is forbidden (plan §08)';
    end if;

    if v_ticket.status <> 'pending_approval' then
        raise exception 'Ticket is not pending approval (current: %)', v_ticket.status;
    end if;

    update public.expense_tickets
       set status = 'approved_funds_released',
           approved_by = p_approver_profile_id,
           approved_at = now(),
           approval_note = p_note,
           disbursed_at = now(),
           updated_at = now()
     where id = p_ticket_id;

    v_audit_id := public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'expense.approve',
        p_entity_type := 'expense_ticket',
        p_entity_id := p_ticket_id,
        p_actor_id := p_approver_profile_id,
        p_after_json := jsonb_build_object('status', 'approved_funds_released', 'note', p_note)
    );

    return v_audit_id;
end;
$$;

comment on function public.approve_expense is 'Atomic expense approval. Enforces no-self-approval (plan §08).';

-- ============================================================================
-- 5. settle_expense — atomic settlement (requires receipt)
-- ============================================================================
create or replace function public.settle_expense(
    p_tenant_id uuid,
    p_ticket_id uuid,
    p_final_amount numeric,
    p_receipt_path text,
    p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ticket record;
    v_audit_id uuid;
begin
    select * into v_ticket from public.expense_tickets where id = p_ticket_id and tenant_id = p_tenant_id;
    if not found then raise exception 'Expense ticket not found'; end if;

    if v_ticket.status not in ('approved_funds_released', 'disbursed') then
        raise exception 'Ticket must be approved_funds_released or disbursed to settle (current: %)', v_ticket.status;
    end if;

    if p_receipt_path is null or trim(p_receipt_path) = '' then
        raise exception 'Receipt upload is mandatory before settlement (plan §08)';
    end if;

    update public.expense_tickets
       set status = 'settled_and_closed',
           final_spent_amount = p_final_amount,
           receipt_path = p_receipt_path,
           receipt_uploaded_at = now(),
           receipt_uploaded_by = p_actor_profile_id,
           settled_by = p_actor_profile_id,
           settled_at = now(),
           updated_at = now()
     where id = p_ticket_id;

    v_audit_id := public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'expense.settle',
        p_entity_type := 'expense_ticket',
        p_entity_id := p_ticket_id,
        p_actor_id := p_actor_profile_id,
        p_after_json := jsonb_build_object('final_amount', p_final_amount, 'receipt_path', p_receipt_path)
    );

    return v_audit_id;
end;
$$;

comment on function public.settle_expense is 'Atomic expense settlement. Requires receipt_path (plan §08).';

-- ============================================================================
-- 6. record_roll_call — atomic batch attendance insert
-- ============================================================================
create or replace function public.record_roll_call(
    p_tenant_id uuid,
    p_class_id uuid,
    p_date date,
    p_records jsonb,
    p_teacher_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_record jsonb;
    v_count integer := 0;
begin
    for v_record in select * from jsonb_array_elements(p_records)
    loop
        insert into public.attendance_records (
            tenant_id, student_id, class_id, date, status, arrival_time,
            note, recorded_by, created_at, updated_at
        ) values (
            p_tenant_id,
            (v_record->>'student_id')::uuid,
            p_class_id,
            p_date,
            v_record->>'status',
            nullif(v_record->>'arrival_time', '')::time,
            v_record->>'note',
            p_teacher_profile_id,
            now(), now()
        )
        on conflict (tenant_id, student_id, class_id, date, coalesce(class_subject_id, '00000000-0000-0000-0000-000000000000'))
        do update set
            status = excluded.status,
            arrival_time = excluded.arrival_time,
            note = excluded.note,
            recorded_by = excluded.recorded_by,
            updated_at = now();

        v_count := v_count + 1;
    end loop;

    perform public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'attendance.roll_call',
        p_entity_type := 'class',
        p_entity_id := p_class_id,
        p_actor_id := p_teacher_profile_id,
        p_after_json := jsonb_build_object('date', p_date, 'record_count', v_count)
    );

    return v_count;
end;
$$;

comment on function public.record_roll_call is 'Atomic batch roll call insert per plan §09.02.';

-- ============================================================================
-- 7. compute_gpa — overall GPA for a student/term
-- ============================================================================
create or replace function public.compute_gpa(p_student_id uuid, p_term integer default null)
returns numeric(5,2)
language sql
stable
security definer
set search_path = public
as $$
    select
        case
            when sum(coefficient) = 0 then null
            else round((sum(subject_average * coefficient) / sum(coefficient))::numeric, 2)
        end
    from public.grades g
    join public.class_subjects cs on cs.id = g.class_subject_id
    where g.student_id = p_student_id
      and g.subject_average is not null
      and (p_term is null or exists (
          select 1 from public.assessments a where a.id = g.assessment_id and a.term = p_term
      ));
$$;

comment on function public.compute_gpa is 'Overall GPA = sum(subject_average * coefficient) / sum(coefficient) per plan §13.03.';

-- ============================================================================
-- 8. promote_students — batch year-end promotion
-- ============================================================================
create or replace function public.promote_students(
    p_tenant_id uuid,
    p_academic_year_id uuid,
    p_decisions jsonb,
    p_actor_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_decision jsonb;
    v_count integer := 0;
    v_student record;
    v_next_level uuid;
    v_gpa numeric(5,2);
begin
    for v_decision in select * from jsonb_array_elements(p_decisions)
    loop
        select * into v_student from public.students
         where id = (v_decision->>'student_id')::uuid
           and tenant_id = p_tenant_id
           and deleted_at is null;

        if not found then continue; end if;

        v_gpa := public.compute_gpa(v_student.id);

        if v_decision->>'decision' = 'approved_for_promotion' then
            -- Find next academic level in the same cycle
            select id into v_next_level
              from public.academic_levels al
             where al.tenant_id = p_tenant_id
               and al.cycle = (select cycle from public.academic_levels where id = v_student.grade_level_id)
               and al.year_number = (select year_number + 1 from public.academic_levels where id = v_student.grade_level_id)
             limit 1;

            if v_next_level is null then
                -- No next level — student graduates
                update public.students
                   set enrollment_status = 'graduated',
                       is_active = false,
                       updated_at = now()
                 where id = v_student.id;
            else
                update public.students
                   set grade_level_id = v_next_level,
                       class_id = null,  -- must be re-assigned to new class
                       updated_at = now()
                 where id = v_student.id;
            end if;
        elsif v_decision->>'decision' = 'retained_same_year' then
            -- Student stays in same grade
            update public.students
               set class_id = null,  -- must be re-assigned
                   updated_at = now()
             where id = v_student.id;
        end if;

        -- Archive to academic_history
        insert into public.academic_history (
            tenant_id, student_id, academic_year_id, academic_level_id, class_id,
            gpa, decision, archived_at
        ) values (
            p_tenant_id, v_student.id, p_academic_year_id, v_student.grade_level_id,
            v_student.class_id, v_gpa, v_decision->>'decision', now()
        )
        on conflict (tenant_id, student_id, academic_year_id) do update set
            gpa = excluded.gpa,
            decision = excluded.decision,
            archived_at = now();

        perform public.write_audit_log(
            p_tenant_id := p_tenant_id,
            p_action := 'student.promote',
            p_entity_type := 'student',
            p_entity_id := v_student.id,
            p_actor_id := p_actor_profile_id,
            p_after_json := jsonb_build_object(
                'decision', v_decision->>'decision',
                'gpa', v_gpa,
                'override_reason', v_decision->>'override_reason'
            )
        );

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

comment on function public.promote_students is 'Batch year-end promotion per plan §05.06.';

-- ============================================================================
-- 9. run_overdue_scan — scan overdue installments
-- ============================================================================
create or replace function public.run_overdue_scan(
    p_tenant_id uuid,
    p_as_of date default current_date
)
returns table(
    installment_id uuid,
    parent_id uuid,
    days_overdue integer,
    amount_overdue numeric
)
language sql
stable
security definer
set search_path = public
as $$
    select
        i.id as installment_id,
        i.parent_id,
        (p_as_of - i.due_date) as days_overdue,
        (i.amount_due - i.amount_paid) as amount_overdue
    from public.installments i
    where i.tenant_id = p_tenant_id
      and i.status in ('unpaid', 'partial')
      and i.due_date < p_as_of
      and i.amount_due > i.amount_paid
    order by days_overdue desc;
$$;

comment on function public.run_overdue_scan is 'Scans all overdue installments for a tenant. Used by overdue alert generator (plan §07.06).';

-- ============================================================================
-- 10. purge_expired_backups — mark expired backup archives as purged
-- ============================================================================
create or replace function public.purge_expired_backups(p_tenant_id uuid)
returns table(archive_id uuid, file_name text, purged_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_archive record;
begin
    for v_archive in
        select id, file_name from public.backup_archives
         where tenant_id = p_tenant_id
           and retention_expires_at < now()
           and status <> 'purged'
    loop
        update public.backup_archives
           set status = 'purged',
               purge_at = now(),
               updated_at = now()
         where id = v_archive.id;

        perform public.write_audit_log(
            p_tenant_id := p_tenant_id,
            p_action := 'backup.purge',
            p_entity_type := 'backup_archive',
            p_entity_id := v_archive.id,
            p_after_json := jsonb_build_object('file_name', v_archive.file_name, 'purged_at', now())
        );

        return query select v_archive.id, v_archive.file_name, now();
    end loop;
end;
$$;

comment on function public.purge_expired_backups is
  'Marks expired backup archives as purged in metadata. Actual ciphertext deletion happens in Electron IndexedDB (plan §13.03).';

-- ============================================================================
-- 11. search_entities — cross-entity trigram search
-- ============================================================================
create or replace function public.search_entities(
    p_tenant_id uuid,
    p_query text,
    p_limit integer default 20
)
returns table(entity_type text, entity_id uuid, label text, sublabel text, score real)
language sql
stable
security definer
set search_path = public
as $$
    -- Parents
    select 'parent'::text, p.id,
           p.last_name || ' ' || p.first_name,
           p.primary_phone,
           similarity(p.last_name || ' ' || p.first_name, p_query)
      from public.parents p
     where p.tenant_id = p_tenant_id
       and p.deleted_at is null
       and (p.last_name || ' ' || p.first_name) % p_query
    union all
    -- Students
    select 'student'::text, s.id,
           s.last_name || ' ' || s.first_name,
           s.student_code,
           similarity(s.last_name || ' ' || s.first_name, p_query)
      from public.students s
     where s.tenant_id = p_tenant_id
       and s.deleted_at is null
       and (s.last_name || ' ' || s.first_name) % p_query
    union all
    -- Personnel
    select 'personnel'::text, per.id,
           per.last_name || ' ' || per.first_name,
           per.personnel_code,
           similarity(per.last_name || ' ' || per.first_name, p_query)
      from public.personnel per
     where per.tenant_id = p_tenant_id
       and per.deleted_at is null
       and (per.last_name || ' ' || per.first_name) % p_query
    order by score desc
    limit p_limit;
$$;

comment on function public.search_entities is 'Cross-entity trigram search across parents, students, personnel.';

-- ============================================================================
-- 12. get_parent_summary — aggregated parent dashboard
-- ============================================================================
create or replace function public.get_parent_summary(p_parent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_result jsonb;
begin
    select jsonb_build_object(
        'parent_id', p.id,
        'parent_name', p.last_name || ' ' || p.first_name,
        'total_charged', (select coalesce(sum(amount), 0) from public.ledger_entries where parent_id = p.id and amount > 0),
        'total_paid', (select coalesce(sum(abs(amount)), 0) from public.ledger_entries where parent_id = p.id and amount < 0),
        'outstanding', public.compute_parent_outstanding(p.id),
        'overdue_amount', public.compute_overdue_amount(p.id, current_date),
        'last_payment_at', (select max(collected_at) from public.payments where parent_id = p.id and status = 'paid'),
        'student_count', (select count(*) from public.students where parent_id = p.id and deleted_at is null),
        'next_installment_due', (
            select min(due_date) from public.installments
             where parent_id = p.id
               and status in ('unpaid', 'partial')
               and due_date >= current_date
        )
    ) into v_result
    from public.parents p
    where p.id = p_parent_id;

    return v_result;
end;
$$;

comment on function public.get_parent_summary is 'Aggregated parent dashboard data.';

-- ============================================================================
-- 13. refresh_all_materialized_views — concurrent refresh helper
-- ============================================================================
create or replace function public.refresh_all_materialized_views()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    refresh materialized view concurrently public.mv_dashboard_kpis;
    refresh materialized view concurrently public.mv_debt_aging;
    refresh materialized view concurrently public.mv_top_debtors;
    refresh materialized view concurrently public.mv_revenue_by_month;
    refresh materialized view concurrently public.mv_grade_summary;
end;
$$;

comment on function public.refresh_all_materialized_views is 'Refreshes all materialized views concurrently (requires UNIQUE indexes).';

-- ============================================================================
-- 14. expire_pending_approvals — auto-expire stale approval requests
-- ============================================================================
create or replace function public.expire_pending_approvals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    update public.account_approval_requests
       set status = 'expired',
           updated_at = now()
     where status = 'pending'
       and expires_at < now();

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

comment on function public.expire_pending_approvals is
  'Auto-expires pending approval requests past their 7-day window. Should be called daily by a scheduled job (pg_cron or Edge Function).';
