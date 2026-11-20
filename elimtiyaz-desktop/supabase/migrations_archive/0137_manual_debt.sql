-- ============================================================================
-- 0137_manual_debt.sql
-- ============================================================================
-- T-466 (DEBT-102, 136th session 2026-10-03) — the MANUAL DEBT: the owner's
-- "manually assign a pre-existing debt with exactly what it represents"
-- mandate.
--
-- WHAT THIS DOES (and nothing else):
--
--   1. `installments.tranche_number` becomes NULLABLE. NULL = the documented
--      NON-WAVE row class the TS model has carried since T-424/DATA-042
--      ("a row with NO tranche number is a NON-WAVE row — excluded from every
--      wave everywhere, never coerced into wave 1"). A manual debt is not a
--      wave: it is a service/purchase/charge obligation that already exists
--      outside the tranche workflow. Safety: the existing CHECK
--      (tranche_number IN (0,1,2,3)) passes NULL rows by SQL semantics, the
--      0129 identity index's own predicate (`WHERE … tranche_number IS NOT
--      NULL`) already excludes NULL rows, and every wave grouping in the TS
--      engine filters on `trancheNumber` presence — NULL rows are invisible
--      to waves BY DESIGN. Live census: 0 NULL-tranche rows exist today, so
--      the constraint relaxation touches no data.
--
--   2. `create_manual_debt(…)` — THE canonical manual-debt write path
--      (SECURITY DEFINER, the upsert_installment_from_import conventions):
--        - refs resolved through resolve_parent_ref / resolve_student_ref;
--        - amount > 0 and the category CHECK enforced up front;
--        - academic_year_id stamped through the SAME precedence the import
--          path applies (explicit code/label match first, then the INV-14
--          window resolver on the due date — ADR-030: frozen at write time);
--        - the installment row: source_type='manual_entry', a deterministic
--          source_id ('manual-<entry-number>'), status 'unpaid',
--          amount_paid/amount_pending 0, label = the reason;
--        - the MATCHING ledger charge entry (the register_family_batch /
--          re-enrollment billing-wire pattern: every new obligation is BOTH
--          an installment row AND a charge entry) so the account balance,
--          the audit trail and the reconciliation include the new debt;
--        - an audit_logs row (the payment.collect pattern: actor + diff).
--
-- WHY AN INSTALLMENT ROW (the architecture, DEBT-102's root cause): every
-- debt surface in the system derives from the installments table — the
-- Créances summary (DebtRepository.observeSummary), the aging statuses
-- (0111 compute_debt_aging_summary), Year Tracking (computeParentYearHistory
-- — a non-tuition/non-transport category lands in the per-service group),
-- the Dashboard statistics (deriveOutstandingDebt / deriveFamilyConcentration
-- / the triage), the CRM échéancier, and the payment waterfall
-- (collect_and_allocate_payment selects by parent_id + category — a manual
-- row allocates EXACTLY like a tranche). One canonical record, every view a
-- query over it — the owner's unified-financial-data mandate by construction,
-- ZERO per-surface changes (§15.53a). The pre-existing ledger-only escapes
-- (adjust / appendManualCharge) are NOT touched — they answer different
-- needs (account-balance corrections / additional-service sales).
--
-- GRANTS (§15.34): EXECUTE revoked from anon and public; granted to
-- authenticated (the RLS policies on installments already gate authenticated
-- staff through the installments_admin ALL policy).
--
-- Follows ADR-001: NEW migration only — applied migrations are never edited.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. installments.tranche_number — NULLABLE (the non-wave row class)
-- ----------------------------------------------------------------------------
alter table public.installments alter column tranche_number drop not null;

comment on column public.installments.tranche_number is
  'T-466 (DEBT-102): 0 = the registration fee (FI), 1..3 = the official tranches, '
  'NULL = a NON-WAVE row (a manual debt / custom charge that exists outside the '
  'tranche workflow) — excluded from every wave everywhere (T-424/DATA-042) and '
  'from the 0129 identity index by its own predicate.';

-- ----------------------------------------------------------------------------
-- §2. create_manual_debt — the canonical manual-debt write path
-- ----------------------------------------------------------------------------
-- Same-session repair (the file was corrected BEFORE its first commit — the
-- initial live application created a TEXT-actor overload; this DROP makes
-- the migration self-healing: the canonical UUID-actor signature [the
-- audit_logs.actor_id / collect_and_allocate_payment convention] is the
-- only one that survives a re-run).
drop function if exists public.create_manual_debt(text, text, text, text, numeric, date, text, text, text, text, text);

create or replace function public.create_manual_debt(
    p_parent_id       text,             -- uuid OR parent_code / local ref
    p_student_id      text,             -- uuid OR student_code / local ref (REQUIRED: installments.student_id is NOT NULL)
    p_category        text,             -- the associated service/charge (the installments.category CHECK list)
    p_label           text,             -- the reason — what the debt represents (REQUIRED, >= 3 chars)
    p_amount_due      numeric,          -- the amount (REQUIRED, > 0)
    p_due_date        date,             -- the debt date (REQUIRED)
    p_academic_year   text default null,-- explicit academic_years code; NULL = the INV-14 window on p_due_date
    p_note            text default null,-- free detail note (ledger description + metadata)
    p_reference       text default null,-- external reference/source (ledger metadata)
    p_actor_id        uuid default null,   -- uuid (the audit_logs.actor_id convention — collect_and_allocate_payment's own signature)
    p_actor_name      text default null
)
returns table (installment_id uuid, ledger_entry_id uuid, academic_year_id uuid)
language plpgsql
security definer
set search_path to public
as $$
declare
    v_tenant      uuid := public.current_tenant_id();
    v_parent      uuid := public.resolve_parent_ref(v_tenant, p_parent_id);
    v_student     uuid := public.resolve_student_ref(v_tenant, p_student_id);
    v_label       text := nullif(btrim(coalesce(p_label, '')), '');
    v_note        text := nullif(btrim(coalesce(p_note, '')), '');
    v_reference   text := nullif(btrim(coalesce(p_reference, '')), '');
    v_year_id     uuid;
    v_ins_id      uuid;
    v_ledger_id   uuid;
    v_entry_no    text;
    v_description text;
    v_account_id  text;
begin
    -- Gate 1 — staff roles (the installments_admin policy's audience).
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: manual debt creation is a staff financial write';
    end if;

    -- Gate 2 — the refs must resolve (the upsert_installment_from_import errors).
    if v_parent is null then
        raise exception 'create_manual_debt: unresolvable parent ref %', p_parent_id;
    end if;
    if v_student is null then
        raise exception 'create_manual_debt: unresolvable student ref %', p_student_id;
    end if;

    -- Gate 3 — the contract guards (fail closed, before any write).
    if v_label is null or length(v_label) < 3 then
        raise exception 'create_manual_debt: the label (the reason) is required (>= 3 chars)';
    end if;
    if p_amount_due is null or p_amount_due <= 0 then
        raise exception 'create_manual_debt: the amount must be strictly positive';
    end if;
    if p_due_date is null then
        raise exception 'create_manual_debt: the due date is required';
    end if;
    if p_category is null or btrim(p_category) = '' then
        raise exception 'create_manual_debt: the category is required';
    end if;

    -- The academic-year stamp — the SAME precedence the import path applies
    -- (0127/0129): explicit code/label match first, then the INV-14 window
    -- resolver on the due date. Frozen at write time (ADR-030 / INV-18b).
    if p_academic_year is not null and nullif(btrim(p_academic_year), '') is not null then
        select ay.id into v_year_id
          from public.academic_years ay
         where ay.tenant_id = v_tenant
           and (ay.code = btrim(p_academic_year) or ay.label = btrim(p_academic_year))
         order by ay.start_date desc
         limit 1;
    end if;
    if v_year_id is null then
        v_year_id := public.resolve_academic_year_id_for_date(p_due_date, v_tenant);
    end if;

    -- The deterministic ledger identity (the led-{ISO}-{rand} convention).
    v_entry_no := 'led-' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                  || '-' || substr(md5(gen_random_uuid()::text), 1, 8);

    v_description := 'Dette manuelle — ' || v_label
                     || (case when v_note is not null then ' · ' || v_note else '' end)
                     || (case when v_reference is not null then ' · réf. ' || v_reference else '' end);

    -- The charge lands on the student-scoped account when the debt is
    -- student-anchored (the adjust() R1.5 convention), else parent-scoped.
    v_account_id := 'parent:' || v_parent || ':category:' || p_category
                    || ':student:' || v_student;

    -- ------------------------------------------------------------------
    -- Write 1/3 — the INSTALLMENT row (the canonical debt record).
    -- ------------------------------------------------------------------
    v_ins_id := public.gen_uuid();
    insert into public.installments (
        id, tenant_id, parent_id, student_id, category, label,
        tranche_number, amount_due, amount_paid, amount_pending,
        due_date, paid_date, status,
        source_type, source_id,
        created_at, updated_at
    ) values (
        v_ins_id, v_tenant, v_parent, v_student, p_category, v_label,
        null, p_amount_due, 0, 0,
        p_due_date, null, 'unpaid',
        'manual_entry', 'manual-' || v_entry_no,
        now(), now()
    );

    -- ------------------------------------------------------------------
    -- Write 2/3 — the LEDGER charge entry (the billing-wire pattern: every
    -- new obligation is both an installment row and a charge entry).
    -- ------------------------------------------------------------------
    v_ledger_id := public.gen_uuid();
    insert into public.ledger_entries (
        id, tenant_id, entry_number, parent_id, student_id, account_id,
        entry_type, amount, category, description, entry_date,
        source_type, source_id, method, receipt_number, payment_status,
        reverses_id, actor_id, actor_name, at, metadata
    ) values (
        v_ledger_id, v_tenant, v_entry_no, v_parent, v_student, v_account_id,
        'charge', p_amount_due, p_category, v_description,
        (p_due_date::timestamptz at time zone 'UTC'),
        'manual_entry', 'manual-' || v_entry_no, null, null, null,
        null, p_actor_id::text, p_actor_name, now(),
        jsonb_build_object(
            'manual', true,
            'installmentId', v_ins_id,
            'note', v_note,
            'reference', v_reference,
            'reason', v_label,
            'source', 'create_manual_debt'
        )
    );

    -- ------------------------------------------------------------------
    -- Write 3/3 — the AUDIT row (the payment.collect pattern).
    -- ------------------------------------------------------------------
    insert into public.audit_logs (
        id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
        before_json, after_json, diff, note, created_at
    ) values (
        public.gen_uuid(), v_tenant, 'installment.manual_debt_created', 'installment', v_ins_id,
        p_actor_id, p_actor_name,
        null,
        jsonb_build_object(
            'installmentId', v_ins_id, 'ledgerEntryId', v_ledger_id,
            'parentId', v_parent, 'studentId', v_student,
            'category', p_category, 'label', v_label,
            'amountDue', p_amount_due, 'dueDate', p_due_date,
            'academicYearId', v_year_id, 'reference', v_reference
        ),
        jsonb_build_object(
            'installmentId', v_ins_id, 'ledgerEntryId', v_ledger_id,
            'parentId', v_parent, 'studentId', v_student,
            'category', p_category, 'label', v_label,
            'amountDue', p_amount_due, 'dueDate', p_due_date,
            'academicYearId', v_year_id, 'reference', v_reference
        ),
        'Dette manuelle créée via RPC create_manual_debt (T-466/DEBT-102 — la voie canonique)',
        now()
    );

    return query select v_ins_id, v_ledger_id, v_year_id;
end;
$$;

comment on function public.create_manual_debt is
  'T-466 (DEBT-102): the canonical manual-debt write path — one installments '
  'row (source_type=manual_entry, tranche_number NULL = non-wave, academic_year_id '
  'stamped via the explicit-code-then-INV-14 precedence) + the matching ledger '
  'charge entry + the audit row. The created obligation flows into every debt '
  'surface (Créances, aging statuses, Year Tracking, Dashboard statistics, CRM '
  'échéancier) and allocates through the canonical payment waterfall exactly '
  'like a tranche.';

revoke execute on function public.create_manual_debt(text, text, text, text, numeric, date, text, text, text, uuid, text) from anon, public;
grant execute on function public.create_manual_debt(text, text, text, text, numeric, date, text, text, text, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0137', '{0137_manual_debt.sql}', 'manual_debt')
on conflict (version) do nothing;
