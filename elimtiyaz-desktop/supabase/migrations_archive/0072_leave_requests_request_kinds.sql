-- ============================================================================
-- 0072 — Leave requests: request-kind widening + reviewed_by_name (T-178 / T-047 port #3)
-- Task: T-178 (session 28, 2026-09-05)
--
-- WHAT:
--   1. Widens the leave_requests.leave_type CHECK to accept the DESKTOP
--      domain request kinds ('leave','absence','overtime','shift_swap',
--      'remote') alongside the legacy leave categories ('annual','sick',
--      'personal','unpaid','maternity','paternity').
--   2. Adds `reviewed_by_name text` (nullable).
--
-- WHY:
--   1. The LeaveRequestRepository domain contract (workforce-repository.ts)
--      types requests with the 5-kind RequestType union — the worker
--      dashboard's type selector submits those values. The 0010 schema
--      only modelled the 6 leave CATEGORIES, so the port would have to
--      either guess a category (lossy) or fail the CHECK. The widening is
--      PURE (a superset — every previously-valid value stays valid; the
--      table is empty live: the desktop mock was the only writer).
--   2. `decidedByName` is part of the domain contract (rendered by the
--      dashboards as "Approuvée par X"). reviewed_by is a bare uuid with
--      NO FK to user_profiles (0010 convention), so a PostgREST embed
--      cannot resolve it; the 0070 precedent (calendar assigned_to_* /
--      domain-contract columns) applies: store the name at decision time.
--
-- SAFETY / IDEMPOTENCE:
--   - The CHECK replacement drops ONLY check constraints whose definition
--     references leave_type (DO block, name-agnostic) and re-adds a
--     superset CHECK. Zero rows exist live (verified in the T-160 scoping:
--     desktop mock was the only writer) — no validation can fail.
--   - ADD COLUMN IF NOT EXISTS — safe to re-run.
--   - RLS untouched: leave_requests_insert (any authenticated tenant
--     member — the worker submit path) and leave_requests_manager_update
--     (super_admin/manager — the decide path) already match the domain
--     contract's only UI call sites. The mock's cancel() has no UI caller;
--     a worker-side cancel would be blocked by the manager-only UPDATE
--     policy — documented in the repository, not silently widened.
-- ============================================================================

-- 1. Widen the leave_type CHECK (drop any existing CHECK referencing
--    leave_type by definition-match, then add the superset).
do $drop_leave_type_checks$
declare r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.leave_requests'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%leave_type%'
    loop
        execute format('alter table public.leave_requests drop constraint %I', r.conname);
    end loop;
end
$drop_leave_type_checks$;

alter table public.leave_requests
    add constraint leave_requests_leave_type_kind_check
    check (leave_type in (
        -- legacy 0010 leave categories
        'annual', 'sick', 'personal', 'unpaid', 'maternity', 'paternity',
        -- desktop domain RequestType union (T-178)
        'leave', 'absence', 'overtime', 'shift_swap', 'remote'
    ));

-- 2. The domain's decidedByName (no FK to resolve it on read — 0070 precedent).
alter table public.leave_requests
    add column if not exists reviewed_by_name text;

comment on column public.leave_requests.reviewed_by_name is
    'Display name of the manager/admin who reviewed (decidedByName in the desktop domain contract). Stored at decision time because reviewed_by has no FK to user_profiles. Added by 0072 (T-178).';

comment on constraint leave_requests_leave_type_kind_check on public.leave_requests is
    'Legacy leave categories (0010) + the desktop domain request kinds (T-178). Superset widening — no previously-valid value was removed.';

-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0072_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0072', '{0072_leave_requests_request_kinds.sql}', 'leave_requests_request_kinds')
on conflict (version) do nothing;
