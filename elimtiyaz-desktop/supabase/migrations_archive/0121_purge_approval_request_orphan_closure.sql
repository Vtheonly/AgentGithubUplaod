-- ============================================================================
-- 0121_purge_approval_request_orphan_closure.sql
-- ============================================================================
-- T-416 (PURGE-502, issue #12): close the account_approval_requests orphan
-- edge the live sandbox caught on the first T-416 live run (2026-09-26).
--
-- THE BUG (live-caught, PURGE-502):
--   The GoTrue trigger handle_new_auth_user() creates an
--   account_approval_requests row keyed by auth_user_id at EVERY auth.users
--   insert (the self-signup path) — with target_parent_id NULL (pre-parent
--   data). 0044_admin_created_accounts resolves such requests WITHOUT ever
--   setting target_parent_id, and the bind flow then lets a parents row
--   claim that same auth_user_id. In that end state 0120's purge deleted
--   the auth.users account (the portal closure) but LEFT the request —
--   because 0120's account_approval_requests family matched only
--   target_parent_id / target_student_id. Result: a surviving request
--   pointing at a deleted auth account — exactly the "orphaned,
--   inconsistent, or partially deleted records" the issue-#12 mandate
--   forbids.
--
-- THE FIX (one predicate, both the count and the delete branch):
--   ... or t.auth_user_id = any(v_auth_ids)
--   v_auth_ids contains ONLY auth accounts claimed by the tenant's
--   parent/student rows (minus staff-guarded accounts) — i.e. accounts the
--   purge is ALREADY deleting. A request keyed to an account that dies
--   must die with it.
--
-- THE BOUNDARY IS PRESERVED (ADR-027 refinement, not a widening):
--   A pending signup whose auth account is NOT claimed by any parent/
--   student row keeps BOTH its account and its request — v_auth_ids never
--   contains unclaimed accounts, so pre-parent data stays outside the
--   blast radius. The invariant becomes: a request survives if and only
--   if its auth account survives (or the account is unclaimed).
--
-- THE CROSS-TENANT NOTE (considered, accepted):
--   auth.users has no tenant column, so the portal closure is global per
--   account while this family stays tenant-scoped. A single auth account
--   claimed by parents in two tenants would orphan the OTHER tenant's
--   request. The deployment is single-tenant (0023 seeds exactly one),
--   and the edge is inherited unchanged from 0120's closure design — not
--   worsened by this amendment.
--
-- THE FIX 2 (live-caught run 7 — the 0120 audit-note landmine):
--   0120's EXECUTE path built its audit note with
--   jsonb_object_length(v_counts) — a function that DOES NOT EXIST on
--   Postgres (no such builtin; PG has jsonb_object_keys only). Every
--   EXECUTE would die at the audit write (42883) and roll back the whole
--   purge; the dry-run never reaches the audit write, which is why every
--   prior local/live gate was green. Replaced with a scalar
--   jsonb_object_keys count. This amendment therefore carries the ONLY
--   correct body: it supersedes 0120's note expression as well.
--
-- FORM (the 0119 precedent):
--   PL/pgSQL has no per-family patch — the function is replaced WHOLE.
--   The body is identical to 0120's except (a) the PURGE-502 predicate in
--   the account_approval_requests family and (b) the audit-note fix
--   above (this header + the dependency-graph comment line aside).
--   create or replace preserves the ACLs; the grants are re-issued for
--   explicitness.
--
-- Registration (T-091/MIG-TOKENS — idempotent via ON CONFLICT; embedded
-- so the Management-API apply lands DDL + registration atomically).
-- ============================================================================

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

    -- approval requests LINKED to purged rows, PLUS any request keyed to
    -- an auth account the purge is deleting (PURGE-502: the GoTrue trigger
    -- creates requests keyed by auth_user_id with target_parent_id NULL,
    -- and 0044 resolves them without ever linking a target — after the
    -- bind, the parents row claims the same auth_user_id; leaving the
    -- request behind would orphan it against the deleted account). A
    -- pending signup whose account is NOT claimed by any parent/student
    -- row keeps BOTH its account and its request (ADR-027's pre-parent
    -- boundary preserved — v_auth_ids only contains claimed accounts).
    if p_dry_run then
        select count(*) into v_n from public.account_approval_requests t
         where t.tenant_id = v_tenant
           and (t.target_parent_id = any(v_parent_ids)
                or t.target_student_id = any(v_student_ids)
                or t.auth_user_id = any(v_auth_ids));
    else
        delete from public.account_approval_requests t
         where t.tenant_id = v_tenant
           and (t.target_parent_id = any(v_parent_ids)
                or t.target_student_id = any(v_student_ids)
                or t.auth_user_id = any(v_auth_ids));
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
                             || v_total || ' rows across ' || (select count(*) from jsonb_object_keys(v_counts)) || ' families; '
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
    'the academic catalog, and the workforce/operations domains are NEVER touched. '
    '0121 (PURGE-502): requests keyed to a purged auth account die with the account.';

-- PostgREST: the desktop calls with the admin's authenticated JWT; the
-- service_role grant covers the server-side maintenance path. The
-- authorization itself is the in-function super_admin gate (0100 pattern).
grant execute on function public.purge_student_parent_domain(text, boolean, uuid) to authenticated;
grant execute on function public.purge_student_parent_domain(text, boolean, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the Management-API apply embeds
-- this statement so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0121', '{0121_purge_approval_request_orphan_closure.sql}', 'purge_approval_request_orphan_closure')
on conflict (version) do nothing;
