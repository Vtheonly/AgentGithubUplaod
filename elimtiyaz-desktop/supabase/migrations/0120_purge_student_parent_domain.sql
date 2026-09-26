-- ============================================================================
-- 0120_purge_student_parent_domain.sql
-- T-416 / PURGE-500 + PURGE-501 (issue #12) — the canonical student/parent
-- domain reset RPC: ONE server-canonical purge path (ADR-027), exposed
-- through the Settings "Zone de danger" card (the desktop UI change).
--
-- WHAT (the mandate):
--   The owner's issue #12: a Purge Button that "completely purges
--   student-related data" — students, parents, enrollments, academic
--   records, the whole financial family (payments, allocations,
--   installments, invoices, ledger, adjustments, discounts, service
--   enrollments), portal accounts, and every dependent/derived row —
--   "no orphaned, inconsistent, or partially deleted records".
--   The session directive adds the explicit gate: the purge MUST NOT
--   interfere with the sync and backup processes.
--
-- WHY AN RPC (ADR-002 + the 0100 house pattern):
--   A tenant-wide cross-family delete is exactly the "mutation RLS cannot
--   express" class: the financial family is on delete RESTRICT by design,
--   the portal closure spans auth.users, and the blast radius must be
--   audited server-side. SECURITY DEFINER + explicit gates + one audit
--   entry — never a client-side delete loop.
--
-- THE LIVE-0118 RECONCILIATION (PURGE-500, AGENTS.md §57c):
--   The live registry carries `0118 / purge_student_parent_domain` with NO
--   repo file (an off-repo actor). If a function exists under that name
--   with an unknown signature, a bare `create or replace` with OUR
--   signature would NOT replace it — it would add a SECOND overload (the
--   §57 42702 ambiguity class that killed the backup purge RPC live).
--   We therefore DROP EVERY existing overload of the name FIRST, then
--   create the one canonical function.
--
-- CONTRACT:
--   purge_student_parent_domain(
--       p_confirm_phrase text,          -- 'PURGER' required for execute
--       p_dry_run boolean default true, -- true = counts only, ZERO deletes
--       p_tenant_id uuid default null   -- null = current_tenant_id()
--   ) returns jsonb
--     {ok:true, mode:'dry_run', tenant_id, counts:{…}, total, preserved:{…}}
--     {ok:true, mode:'executed', …, audit_entry_id}
--     {ok:false, code:'forbidden'}               — not super_admin, not console
--     {ok:false, code:'tenant_unresolved'}       — no tenant from caller or param
--     {ok:false, code:'invalid_tenant'}          — param names a nonexistent tenant
--     {ok:false, code:'confirmation_required'}   — execute without the phrase
--
-- GATES (defense in depth, in order):
--   1. super_admin (has_role — the 0100 mirror) OR a DB-superuser console
--      session (session_user rolsuper — the Management-API SQL path, the
--      platform owner's highest-privilege context; the function gives it
--      the SAFE audited route instead of ad-hoc SQL. PostgREST callers
--      (anon/authenticated/service_role) are NEVER superuser.)
--   2. tenant resolution — coalesce(p_tenant_id, current_tenant_id());
--      null → 'tenant_unresolved' (NEVER a null-tenant match-everything);
--      the resolved value must exist in tenants.
--   3. the typed phrase — execute mode requires btrim(p_confirm_phrase) =
--      'PURGER' (case-sensitive, the GitHub danger-zone convention);
--      dry-run never deletes and never needs the phrase.
--
-- THE NO-INTERFERENCE CONTRACT (ADR-027 — the owner's session directive):
--   NEVER touched: backup_archives + every backup RPC/EF; the sync
--   infrastructure (non-domain sync_queue rows, mark_sync_queue_processed,
--   the idempotent push RPCs); audit_logs (append-only — the purge WRITES
--   one entry, deletes none); the academic catalog (academic_years/levels,
--   subjects, classes, class_subjects, filieres, subject_configurations,
--   timetable_*, rooms); workforce/operations (personnel*, salary_*,
--   workforce_*, expense_*, suppliers, purchases, inventory_*, deliveries,
--   pending_receipts — the OPERATIONS purchase-receipt table, NOT the
--   financial receipts); workflow engine history; ai_request_logs; tasks;
--   releve_entries; onboarding_states; system_settings.
--   The ONLY sync_queue rows deleted are this tenant's five domain
--   entities ('parent'|'student'|'payment'|'installment'|'ledger_entry'
--   — the StagedMutation.entity set): the queue is a pending-write log
--   whose idempotent upserts would otherwise RESURRECT every purged row
--   on the next drain (PURGE-501). That cleanup is part of the SAME
--   atomic transaction as the business deletes.
--
-- DELETE ORDER (FK-safe; every target set is collected BEFORE any delete):
--   payment_allocations → payments → installments → invoices →
--   ledger_entries → account_adjustments → receipts* → discount_applications
--   → service_enrollments → grades → attendance_records → academic_history
--   → student_academic_histories → student_documents → activation_codes →
--   parent_student_links → account_approval_requests (target-linked) →
--   students → parents → chat_messages → chat_channels (parent-member) →
--   notifications → calendar_events (parent/student targets) →
--   notification_preferences → device_tokens → sessions → role_assignments
--   → user_profiles → auth.users → sync_queue (domain entities).
--   (*receipts is guarded by an information_schema existence check — the
--   table is in the file chain (0007) but ABSENT on the live project per
--   §57c; PL/pgSQL compiles statements lazily so the dead branch never
--   parses against a missing relation.)
--
-- THE STAFF-ACCOUNT GUARD (ADR-027):
--   The portal/auth closure never deletes an account that holds a STAFF
--   role assignment (roles.is_staff_role) — a parent who is also staff
--   keeps the staff account; only pure parent/student portal accounts are
--   removed (profiles, sessions, tokens, preferences, role assignments,
--   auth.users).
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DDL
-- for the Management-API live application; idempotent via ON CONFLICT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The live-0118 reconciliation — drop EVERY overload of the name first
-- ----------------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure::text as sig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'purge_student_parent_domain'
    loop
        execute format('drop function if exists %s;', r.sig);
    end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. The canonical function
-- ----------------------------------------------------------------------------
create or replace function public.purge_student_parent_domain(
    p_confirm_phrase text,
    p_dry_run boolean default true,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant         uuid;
    v_counts         jsonb := '{}'::jsonb;
    v_total          bigint := 0;
    v_n              bigint;
    v_parent_ids     uuid[];
    v_student_ids    uuid[];
    v_auth_ids       uuid[];
    v_profile_ids    uuid[];
    v_channel_ids    uuid[];
    v_audit_id       uuid;
    v_other_queue    bigint;
begin
    -- Gate 1 — super_admin OR a DB-superuser console session (ADR-027).
    if not (
        public.has_role('super_admin')
        or exists (select 1 from pg_roles where rolname = session_user and rolsuper)
    ) then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;

    -- Gate 2 — tenant resolution (explicit param → caller context → fail
    -- closed; NEVER a null-tenant match-everything).
    v_tenant := coalesce(p_tenant_id, public.current_tenant_id());
    if v_tenant is null then
        return jsonb_build_object('ok', false, 'code', 'tenant_unresolved');
    end if;
    if not exists (select 1 from public.tenants where id = v_tenant) then
        return jsonb_build_object('ok', false, 'code', 'invalid_tenant');
    end if;

    -- Gate 3 — the typed phrase, execute mode only (dry-run deletes nothing).
    if not p_dry_run and coalesce(btrim(p_confirm_phrase), '') <> 'PURGER' then
        return jsonb_build_object('ok', false, 'code', 'confirmation_required');
    end if;

    -- ------------------------------------------------------------------
    -- Target collection — EVERY set is resolved BEFORE any delete so the
    -- dry-run preview and the execution see the SAME blast radius.
    -- ------------------------------------------------------------------
    select coalesce(array_agg(p.id), '{}') into v_parent_ids
      from public.parents p where p.tenant_id = v_tenant;

    select coalesce(array_agg(s.id), '{}') into v_student_ids
      from public.students s where s.tenant_id = v_tenant;

    -- The portal accounts of the domain — parents' + students' auth users,
    -- EXCLUDING any account that holds a staff role (the staff guard).
    select coalesce(array_agg(distinct au), '{}') into v_auth_ids
      from (
            select p.auth_user_id as au from public.parents p
             where p.tenant_id = v_tenant and p.auth_user_id is not null
            union
            select s.auth_user_id from public.students s
             where s.tenant_id = v_tenant and s.auth_user_id is not null
           ) ids(au)
     where not exists (
            select 1
              from public.user_profiles up
              join public.role_assignments ra on ra.user_profile_id = up.id
                                              and ra.revoked_at is null
              join public.roles r on r.id = ra.role_id and r.is_staff_role
             where up.auth_user_id = ids.au
           );

    select coalesce(array_agg(up.id), '{}') into v_profile_ids
      from public.user_profiles up
     where up.auth_user_id = any(v_auth_ids);

    -- Parent-member chat channels (ADR-012 parent↔admin direct channels;
    -- member_ids is a NATIVE uuid[] of user_profiles.id (0010) → the
    -- array-overlap operator &&, NOT a jsonb operator).
    select coalesce(array_agg(c.id), '{}') into v_channel_ids
      from public.chat_channels c
     where c.tenant_id = v_tenant
       and c.member_ids && v_profile_ids;

    -- The per-family helper: same predicate for the count (dry-run) and
    -- the delete (execute) — the preview can never drift from the blast.
    -- ------------------------------------------------------------------
    -- A. The financial closure (children before parents, RESTRICT-safe)
    -- ------------------------------------------------------------------
    if p_dry_run then
        select count(*) into v_n from public.payment_allocations t
         where t.tenant_id = v_tenant;
    else
        delete from public.payment_allocations t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('payment_allocations', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.payments t where t.tenant_id = v_tenant;
    else
        delete from public.payments t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('payments', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.installments t where t.tenant_id = v_tenant;
    else
        delete from public.installments t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('installments', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.invoices t where t.tenant_id = v_tenant;
    else
        delete from public.invoices t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('invoices', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.ledger_entries t where t.tenant_id = v_tenant;
    else
        delete from public.ledger_entries t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('ledger_entries', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.account_adjustments t where t.tenant_id = v_tenant;
    else
        delete from public.account_adjustments t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('account_adjustments', v_n); v_total := v_total + v_n;

    -- receipts: in the file chain (0007) but ABSENT live (§57c) — the
    -- existence guard keeps the branch dead where the table does not exist
    -- (PL/pgSQL compiles lazily; the dead branch never parses).
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = 'receipts') then
        if p_dry_run then
            select count(*) into v_n from public.receipts t where t.tenant_id = v_tenant;
        else
            delete from public.receipts t where t.tenant_id = v_tenant;
            get diagnostics v_n = row_count;
        end if;
        v_counts := v_counts || jsonb_build_object('receipts', v_n); v_total := v_total + v_n;
    end if;

    if p_dry_run then
        select count(*) into v_n from public.discount_applications t where t.tenant_id = v_tenant;
    else
        delete from public.discount_applications t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('discount_applications', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.service_enrollments t where t.tenant_id = v_tenant;
    else
        delete from public.service_enrollments t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('service_enrollments', v_n); v_total := v_total + v_n;

    -- ------------------------------------------------------------------
    -- B. The academic student data (incl. the 0004 no-FK soft references)
    -- ------------------------------------------------------------------
    if p_dry_run then
        select count(*) into v_n from public.grades t where t.tenant_id = v_tenant;
    else
        delete from public.grades t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('grades', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.attendance_records t where t.tenant_id = v_tenant;
    else
        delete from public.attendance_records t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('attendance_records', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.academic_history t where t.tenant_id = v_tenant;
    else
        delete from public.academic_history t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('academic_history', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.student_academic_histories t where t.tenant_id = v_tenant;
    else
        delete from public.student_academic_histories t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('student_academic_histories', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.student_documents t where t.tenant_id = v_tenant;
    else
        delete from public.student_documents t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('student_documents', v_n); v_total := v_total + v_n;

    -- ------------------------------------------------------------------
    -- C. The CRM core (links before principals; parents LAST)
    -- ------------------------------------------------------------------
    if p_dry_run then
        select count(*) into v_n from public.activation_codes t where t.tenant_id = v_tenant;
    else
        delete from public.activation_codes t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('activation_codes', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.parent_student_links t where t.tenant_id = v_tenant;
    else
        delete from public.parent_student_links t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('parent_student_links', v_n); v_total := v_total + v_n;

    -- approval requests LINKED to purged rows only (an unlinked pending
    -- signup is pre-parent data — ADR-027's scope boundary).
    if p_dry_run then
        select count(*) into v_n from public.account_approval_requests t
         where t.tenant_id = v_tenant
           and (t.target_parent_id = any(v_parent_ids)
                or t.target_student_id = any(v_student_ids));
    else
        delete from public.account_approval_requests t
         where t.tenant_id = v_tenant
           and (t.target_parent_id = any(v_parent_ids)
                or t.target_student_id = any(v_student_ids));
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('account_approval_requests', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.students t where t.tenant_id = v_tenant;
    else
        delete from public.students t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('students', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.parents t where t.tenant_id = v_tenant;
    else
        delete from public.parents t where t.tenant_id = v_tenant;
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('parents', v_n); v_total := v_total + v_n;

    -- ------------------------------------------------------------------
    -- D. The portal/auth closure (messages before channels; auth.users
    --    LAST; the staff guard already excluded staff accounts above)
    -- ------------------------------------------------------------------
    if p_dry_run then
        select count(*) into v_n from public.chat_messages t
         where t.tenant_id = v_tenant and t.channel_id = any(v_channel_ids);
    else
        delete from public.chat_messages t
         where t.tenant_id = v_tenant and t.channel_id = any(v_channel_ids);
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('chat_messages', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.chat_channels t
         where t.tenant_id = v_tenant and t.id = any(v_channel_ids);
    else
        delete from public.chat_channels t
         where t.tenant_id = v_tenant and t.id = any(v_channel_ids);
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('chat_channels', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.notifications t
         where t.tenant_id = v_tenant
           and (t.target_user_id = any(v_auth_ids)
                or (t.link_entity_type = 'parent' and t.link_entity_id = any(v_parent_ids))
                or (t.link_entity_type = 'student' and t.link_entity_id = any(v_student_ids)));
    else
        delete from public.notifications t
         where t.tenant_id = v_tenant
           and (t.target_user_id = any(v_auth_ids)
                or (t.link_entity_type = 'parent' and t.link_entity_id = any(v_parent_ids))
                or (t.link_entity_type = 'student' and t.link_entity_id = any(v_student_ids)));
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('notifications', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.calendar_events t
         where t.tenant_id = v_tenant
           and t.target_entity_type in ('parent', 'student')
           and (t.target_entity_id = any(v_parent_ids)
                or t.target_entity_id = any(v_student_ids));
    else
        delete from public.calendar_events t
         where t.tenant_id = v_tenant
           and t.target_entity_type in ('parent', 'student')
           and (t.target_entity_id = any(v_parent_ids)
                or t.target_entity_id = any(v_student_ids));
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('calendar_events', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.notification_preferences t
         where t.tenant_id = v_tenant and t.user_profile_id = any(v_profile_ids);
    else
        delete from public.notification_preferences t
         where t.tenant_id = v_tenant and t.user_profile_id = any(v_profile_ids);
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('notification_preferences', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.device_tokens t
         where t.user_id = any(v_auth_ids);
    else
        delete from public.device_tokens t where t.user_id = any(v_auth_ids);
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('device_tokens', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.sessions t
         where t.user_profile_id = any(v_profile_ids);
    else
        delete from public.sessions t where t.user_profile_id = any(v_profile_ids);
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('sessions', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.role_assignments t
         where t.user_profile_id = any(v_profile_ids);
    else
        delete from public.role_assignments t where t.user_profile_id = any(v_profile_ids);
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('role_assignments', v_n); v_total := v_total + v_n;

    if p_dry_run then
        select count(*) into v_n from public.user_profiles t
         where t.id = any(v_profile_ids);
    else
        delete from public.user_profiles t where t.id = any(v_profile_ids);
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('user_profiles', v_n); v_total := v_total + v_n;

    -- auth.users LAST (the GoTrue accounts; SECURITY DEFINER runs as the
    -- owner — postgres — which the live sandbox proves has the grant).
    if p_dry_run then
        select count(*) into v_n from auth.users t where t.id = any(v_auth_ids);
    else
        delete from auth.users t where t.id = any(v_auth_ids);
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('auth_users', v_n); v_total := v_total + v_n;

    -- ------------------------------------------------------------------
    -- E. The sync staging — ONLY this tenant's five domain entities
    --    (PURGE-501: the queue's idempotent upserts would resurrect every
    --    purged row on the next drain). Everything else in the queue, and
    --    the sync RPCs themselves, are untouched.
    -- ------------------------------------------------------------------
    if p_dry_run then
        select count(*) into v_n from public.sync_queue t
         where t.tenant_id = v_tenant
           and t.entity in ('parent', 'student', 'payment', 'installment', 'ledger_entry');
    else
        delete from public.sync_queue t
         where t.tenant_id = v_tenant
           and t.entity in ('parent', 'student', 'payment', 'installment', 'ledger_entry');
        get diagnostics v_n = row_count;
    end if;
    v_counts := v_counts || jsonb_build_object('sync_queue_domain', v_n); v_total := v_total + v_n;

    -- The non-interference evidence, returned with every call: what the
    -- purge left alone in the queue.
    select count(*) into v_other_queue from public.sync_queue t
     where t.tenant_id = v_tenant
       and t.entity not in ('parent', 'student', 'payment', 'installment', 'ledger_entry');

    -- ------------------------------------------------------------------
    -- The audit entry (append-only journal — execute mode only; dry-run
    -- changed nothing and writes nothing). counts ride p_after_json.
    -- ------------------------------------------------------------------
    if not p_dry_run then
        v_audit_id := public.write_audit_log(
            p_tenant_id   => v_tenant,
            p_action      => 'system.purge_student_parent_domain',
            p_entity_type => 'system',
            p_entity_id   => null,
            p_actor_id    => null,
            p_actor_name  => coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', session_user),
            p_after_json  => v_counts || jsonb_build_object('total', v_total),
            p_note        => 'T-416 (issue #12): the student/parent domain reset — '
                             || v_total || ' rows across ' || jsonb_object_length(v_counts) || ' families; '
                             || 'backup/sync-infrastructure/audit-journal/academic-catalog untouched per ADR-027.'
        );
    end if;

    return jsonb_build_object(
        'ok', true,
        'mode', case when p_dry_run then 'dry_run' else 'executed' end,
        'tenant_id', v_tenant,
        'counts', v_counts,
        'total', v_total,
        'preserved', jsonb_build_object(
            'backup_archives', 'untouched',
            'sync_queue_other', v_other_queue,
            'audit_logs', 'append_only',
            'academic_catalog', 'untouched',
            'workforce_operations', 'untouched'
        ),
        'audit_entry_id', v_audit_id
    );
end;
$$;

comment on function public.purge_student_parent_domain(text, boolean, uuid) is
    'T-416 / issue #12 — the canonical student/parent domain reset (ADR-027). '
    'Destructive, tenant-wide, execute-gated by the typed phrase ''PURGER''; '
    'p_dry_run=true (the default) counts without deleting. The backup family, '
    'the sync infrastructure (non-domain queue rows + RPCs), the audit journal, '
    'the academic catalog, and the workforce/operations domains are NEVER touched.';

-- PostgREST: the desktop calls with the admin's authenticated JWT; the
-- service_role grant covers the server-side maintenance path. The
-- authorization itself is the in-function super_admin gate (0100 pattern).
grant execute on function public.purge_student_parent_domain(text, boolean, uuid) to authenticated;
grant execute on function public.purge_student_parent_domain(text, boolean, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the Management-API apply embeds
-- this statement so the DDL and the registration land in ONE atomic
-- transaction; kept here so a fresh CLI deployment registers identically.
-- ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0120', '{0120_purge_student_parent_domain.sql}', 'purge_student_parent_domain')
on conflict (version) do nothing;
