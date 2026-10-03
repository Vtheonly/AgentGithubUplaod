-- ============================================================================
-- 0141_releve_auto_entries.sql
-- ============================================================================
-- T-482 (UNKNOWN-030, 140th session 2026-10-04) — ADR-034: the auto-Relevé
-- (vault §09.06's AUTOMATED operational activity ledger per teacher) becomes
-- possible under the canonical contract. The 0009 contract made it impossible:
--   - RLS releve_entries_insert: the staff quartet only (a teacher cannot
--     INSERT at all);
--   - the prevent_self_releve_entry trigger: raises whenever
--     recorded_by == personnel.user_id — a teacher's own auto-entry fires it
--     by construction.
--
-- The design (ADR-034, the owner's 140th-session mandate as the ruling):
--   1. An exempted auto entry kind: entry_source ('manual'|'auto', default
--      'manual' — every pre-0141 row is manual, no data change) + auto_kind
--      ('grade_entry'|'homework_push'|'roll_call'), CHECK-coupled (a manual
--      row never carries auto_kind; an auto row always does).
--   2. The §09.05 self-entry ban re-scoped to MANUAL rows (the trigger
--      function replaced append-only; the 0009 file untouched). The manual
--      path is unchanged: a teacher still cannot record their own manual
--      entry, and the 0019 insert RLS (staff quartet) still governs manual
--      inserts.
--   3. The canonical writer: record_auto_releve_entry(p_kind, p_class_id,
--      p_class_subject_id, p_note) — SECURITY DEFINER, the ONLY sanctioned
--      writer of auto rows. It resolves the CALLER's own personnel row
--      (user_id = auth.uid(), tenant-scoped, not deleted); maps the kind to
--      the activity vocabulary the desktop mock already defined
--      (grade_entry→correction, homework_push→task, roll_call→supervision —
--      the 0140-widened wire code); inserts recorded_by = auth.uid(),
--      clock_in_at = now(). A caller with no personnel row returns NULL
--      (§09.06 is a per-TEACHER ledger — an admin entering grades has
--      nothing to auto-record).
--
-- Re-run safety: every statement is guarded (add column if not exists /
-- create or replace / DO-block constraint guard / on-conflict registration).

-- ----------------------------------------------------------------------------
-- §1. entry_source — the manual/auto discriminator
-- ----------------------------------------------------------------------------
alter table public.releve_entries
    add column if not exists entry_source text not null default 'manual';

do $src_check$
begin
    if not exists (
        select 1 from pg_constraint
         where conrelid = 'public.releve_entries'::regclass
           and conname = 'releve_entries_entry_source_check'
    ) then
        alter table public.releve_entries
            add constraint releve_entries_entry_source_check
            check (entry_source in ('manual', 'auto'));
    end if;
end
$src_check$;

-- ----------------------------------------------------------------------------
-- §2. auto_kind — the §09.06 classroom operation kind (auto rows only)
-- ----------------------------------------------------------------------------
alter table public.releve_entries
    add column if not exists auto_kind text;

do $kind_check$
begin
    if not exists (
        select 1 from pg_constraint
         where conrelid = 'public.releve_entries'::regclass
           and conname = 'releve_entries_auto_kind_check'
    ) then
        alter table public.releve_entries
            add constraint releve_entries_auto_kind_check
            check (auto_kind is null or auto_kind in ('grade_entry', 'homework_push', 'roll_call'));
    end if;
end
$kind_check$;

-- The coupling: manual rows never carry an auto_kind; auto rows always do.
do $coupling_check$
begin
    if not exists (
        select 1 from pg_constraint
         where conrelid = 'public.releve_entries'::regclass
           and conname = 'releve_entries_source_kind_coupling_check'
    ) then
        alter table public.releve_entries
            add constraint releve_entries_source_kind_coupling_check
            check (
                (entry_source = 'manual' and auto_kind is null)
                or (entry_source = 'auto' and auto_kind is not null)
            );
    end if;
end
$coupling_check$;

comment on column public.releve_entries.entry_source is
    'ADR-034 (T-482/0141): manual = the §09.05 admin-recorded path (staff quartet + the self-entry trigger); auto = the §09.06 system side effect written ONLY by record_auto_releve_entry.';
comment on column public.releve_entries.auto_kind is
    'ADR-034 (T-482/0141): the classroom operation that generated the auto row (grade_entry / homework_push / roll_call). CHECK-coupled: non-null only when entry_source = ''auto''.';

-- ----------------------------------------------------------------------------
-- §3. The §09.05 self-entry trigger, re-scoped to manual rows
-- ----------------------------------------------------------------------------
-- The 0009 function is REPLACED (the append-only convention: the 0009 file
-- stays untouched; this migration owns the current definition). The auto
-- early-return is the ADR-034 exemption; the manual path is byte-identical
-- to 0009's logic.
create or replace function public.prevent_self_releve_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_personnel_user_id uuid;
begin
    -- T-482 / ADR-034: auto rows are recorded by the canonical
    -- record_auto_releve_entry RPC — the system side effect of the caller's
    -- OWN classroom operation (§09.06), where recorded_by == the teacher's
    -- user id BY DESIGN. The §09.05 ban below governs manual rows only.
    if new.entry_source = 'auto' then
        return new;
    end if;

    select user_id into v_personnel_user_id from public.personnel where id = new.personnel_id;

    if v_personnel_user_id is not null and v_personnel_user_id = new.recorded_by then
        raise exception 'Plan §09.05 violation: a teacher cannot record their own Releve entry. Use a separate administrator.';
    end if;

    return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- §4. record_auto_releve_entry — the canonical auto-row writer
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER: the function owner (postgres) bypasses the releve_entries
-- insert RLS — the RPC's OWN checks are the guard (tenant context, the kind
-- whitelist, the caller-owns-the-personnel-row resolution). Grants:
-- authenticated only (the revoked public grant follows the house convention).
create or replace function public.record_auto_releve_entry(
    p_kind text,
    p_class_id uuid default null,
    p_class_subject_id uuid default null,
    p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant_id uuid;
    v_user_id uuid;
    v_personnel_id uuid;
    v_entry_id uuid;
begin
    -- The caller must be an authenticated member of a tenant.
    v_user_id := auth.uid();
    if v_user_id is null then
        raise exception 'record_auto_releve_entry: an authenticated caller is required';
    end if;
    v_tenant_id := public.current_tenant_id();
    if v_tenant_id is null then
        raise exception 'record_auto_releve_entry: no tenant context for the caller';
    end if;

    -- The kind whitelist (the §09.06 vocabulary).
    if p_kind not in ('grade_entry', 'homework_push', 'roll_call') then
        raise exception 'record_auto_releve_entry: unknown auto kind ''%''', p_kind;
    end if;

    -- §09.06 is the per-TEACHER ledger: resolve the CALLER's own personnel
    -- row in this tenant. A caller with no personnel binding (an admin
    -- entering grades, a support account) returns NULL — nothing to
    -- auto-record.
    select p.id into v_personnel_id
      from public.personnel p
     where p.tenant_id = v_tenant_id
       and p.user_id = v_user_id
       and p.deleted_at is null
     order by p.created_at
     limit 1;
    if v_personnel_id is null then
        return null;
    end if;

    -- The activity vocabulary (the desktop mock's §09.06 mapping, verbatim):
    --   grade_entry → correction · homework_push → task · roll_call →
    --   supervision (the 0140-widened clients' wire code).
    insert into public.releve_entries (
        tenant_id,
        personnel_id,
        activity_type,
        class_id,
        class_subject_id,
        description,
        clock_in_at,
        clock_out_at,
        recorded_by,
        entry_source,
        auto_kind
    ) values (
        v_tenant_id,
        v_personnel_id,
        case p_kind
            when 'grade_entry'  then 'correction'
            when 'homework_push' then 'task'
            when 'roll_call'    then 'supervision'
        end,
        p_class_id,
        p_class_subject_id,
        p_note,
        now(),
        null,
        v_user_id,
        'auto',
        p_kind
    )
    returning id into v_entry_id;

    return v_entry_id;
end;
$$;

revoke all on function public.record_auto_releve_entry(text, uuid, uuid, text) from public;
grant execute on function public.record_auto_releve_entry(text, uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- §5. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0141', '{0141_releve_auto_entries.sql}', 'releve_auto_entries')
on conflict (version) do nothing;
