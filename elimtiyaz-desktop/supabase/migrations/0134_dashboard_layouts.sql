-- ============================================================================
-- 0134_dashboard_layouts.sql
-- T-448 (125th session, 2026-09-30) — the owner's dedicated dashboard-layout
-- table mandate: "create a new dedicated Supabase table specifically for
-- storing dashboard layout configurations… configure the layout once, save
-- it, and never have to configure it again unless I intentionally change
-- it… only update the saved configuration when I explicitly change and
-- save it… keep this completely separate from unrelated application data."
--
-- Problem: UI-326 (the layout editor persisted to localStorage ONLY).
--
-- THE DESIGN (one clear responsibility: PERSISTING and RESTORING the user's
-- layout configuration — nothing else reads or writes this table):
--
--   - ONE row per (tenant, user, view). The desktop editor's view keys are
--     `overview` / `statistics:pilotage` / `statistics:diagnostic` /
--     `statistics:charts`; the `layout` jsonb is the editor's StoredLayout
--     verbatim: `{"<itemId>": {"x","y","w","h"}, …}`.
--   - RLS is USER-SCOPED, not role-gated: a dashboard layout is a personal
--     preference — every authenticated tenant member reads and writes ONLY
--     their own rows (no admin gate; no cross-user reads; NOT the 0024
--     system_settings pattern — that table is tenant-level admin config,
--     RLS-gated to super_admin/support_staff, and the owner explicitly
--     wants layouts kept SEPARATE from unrelated application data).
--   - `save_dashboard_layout(p_view_key, p_layout)` — the ONE write RPC:
--     resolves caller profile + tenant SERVER-SIDE (the client never sends
--     identity columns — it cannot forge another user's row), validates the
--     shape (non-empty view key; a JSON object), upserts on the identity
--     triple. SECURITY INVOKER so the table's own RLS remains the guard.
--   - Reads/deletes go through plain RLS-scoped PostgREST (SELECT / DELETE
--     where view_key = …) — the policies already pin the row to the caller.
--   - NO audit-log entry per save (0014 is the DOMAIN audit trail; a
--     personal-preference drag-and-drop save is not an auditable domain
--     event — writing one row per save would spam the audit log).
--
-- PARITY notes: the client contract is the editor's StoredLayout shape
-- (camelCase-free, numeric x/y/w/h) — mapped verbatim to/from jsonb; the
-- localStorage path stays as the OFFLINE CACHE (never removed: mock mode
-- and offline degradation keep working — §15.70).
--
-- §1  The table + constraints + trigger
-- §2  RLS (select/insert/update/delete — own rows only)
-- §3  save_dashboard_layout (the upsert RPC)
-- §4  Grants (§15.34: revoke explicitly from anon + public)
-- §5  Registration (T-091/MIG-TOKENS pattern — atomic with the DDL; the
--     ARCH-016 lesson: the registration lives IN the migration file)
--
-- Numbering: 0134 is the next free number (chain head 0133, live-verified
-- this session through the Management API).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. dashboard_layouts — the dedicated per-user layout store
-- ----------------------------------------------------------------------------
create table if not exists public.dashboard_layouts (
    id               uuid        primary key default gen_random_uuid(),
    tenant_id        uuid        not null references public.tenants(id) on delete cascade,
    -- The SAVING user's profile (user_profiles.id — the session's userId).
    user_profile_id  uuid        not null references public.user_profiles(id) on delete cascade,
    -- The editor's storage key: 'overview' | 'statistics:pilotage' | …
    view_key         text        not null check (char_length(view_key) between 1 and 128),
    -- The editor's StoredLayout verbatim: {"<itemId>": {"x","y","w","h"}, …}
    layout           jsonb       not null check (jsonb_typeof(layout) = 'object'),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    -- ONE saved layout per user per view: the "configure once" identity.
    constraint dashboard_layout_identity
        unique (tenant_id, user_profile_id, view_key)
);

comment on table public.dashboard_layouts is
  'T-448 (UI-326): the DEDICATED dashboard-layout-configuration store — one row per '
  '(tenant, user, view key). One clear responsibility: persisting and restoring the '
  'user''s dashboard layout. RLS pins every row to its owner (current_user_profile_id); '
  'the ONLY write path is the save_dashboard_layout RPC (explicit save — never an '
  'implicit update).';

comment on column public.dashboard_layouts.view_key is
  'The desktop editor''s storage key (overview / statistics:pilotage / statistics:diagnostic / statistics:charts).';
comment on column public.dashboard_layouts.layout is
  'The editor''s StoredLayout verbatim: {"<itemId>": {"x","y","w","h"}, …} — numeric grid coordinates.';

create trigger dashboard_layouts_touch_updated_at before update on public.dashboard_layouts
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- §2. RLS — own rows only (every authenticated tenant member; no admin gate:
--      a layout is a personal preference, not a domain object)
-- ----------------------------------------------------------------------------
alter table public.dashboard_layouts enable row level security;

drop policy if exists dashboard_layouts_select_own on public.dashboard_layouts;
create policy dashboard_layouts_select_own on public.dashboard_layouts
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and user_profile_id = public.current_user_profile_id()
    );

drop policy if exists dashboard_layouts_insert_own on public.dashboard_layouts;
create policy dashboard_layouts_insert_own on public.dashboard_layouts
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and user_profile_id = public.current_user_profile_id()
    );

drop policy if exists dashboard_layouts_update_own on public.dashboard_layouts;
create policy dashboard_layouts_update_own on public.dashboard_layouts
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and user_profile_id = public.current_user_profile_id()
    )
    with check (
        tenant_id = public.current_tenant_id()
        and user_profile_id = public.current_user_profile_id()
    );

drop policy if exists dashboard_layouts_delete_own on public.dashboard_layouts;
create policy dashboard_layouts_delete_own on public.dashboard_layouts
    for delete to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and user_profile_id = public.current_user_profile_id()
    );

-- ----------------------------------------------------------------------------
-- §3. save_dashboard_layout — the ONE write path (explicit save semantics)
-- ----------------------------------------------------------------------------
create or replace function public.save_dashboard_layout(
    p_view_key text,
    p_layout  jsonb
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $save_layout$
declare
    v_profile uuid;
    v_tenant  uuid;
    v_saved_at timestamptz;
begin
    -- Identity resolved SERVER-SIDE from the JWT: the caller cannot target
    -- another user's row (the client never sends tenant/profile columns).
    v_profile := public.current_user_profile_id();
    v_tenant  := public.current_tenant_id();
    if v_profile is null or v_tenant is null then
        raise exception 'save_dashboard_layout: no profile/tenant context'
          using errcode = '42501';
    end if;

    if p_view_key is null or btrim(p_view_key) = '' then
        raise exception 'save_dashboard_layout: p_view_key is required'
          using errcode = '23514';
    end if;
    if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
        raise exception 'save_dashboard_layout: p_layout must be a JSON object'
          using errcode = '23514';
    end if;

    insert into public.dashboard_layouts (tenant_id, user_profile_id, view_key, layout)
    values (v_tenant, v_profile, btrim(p_view_key), p_layout)
    on conflict (tenant_id, user_profile_id, view_key)
    do update set layout = excluded.layout
    returning updated_at into v_saved_at;

    return v_saved_at;
end;
$save_layout$;

comment on function public.save_dashboard_layout is
  'T-448 (UI-326): the ONLY write path for dashboard layouts — the EXPLICIT save. '
  'Caller profile + tenant resolved server-side (JWT); upserts the caller''s own row '
  'on (tenant, profile, view key). SECURITY INVOKER: the table''s own RLS stays the guard. '
  'Returns the saved-at timestamp.';

-- ----------------------------------------------------------------------------
-- §4. Grants (§15.34: revoke explicitly from anon + public — the platform
--      default privileges grant anon EXECUTE; keep authenticated + service_role)
-- ----------------------------------------------------------------------------
revoke all on function public.save_dashboard_layout(text, jsonb) from public, anon;
grant execute on function public.save_dashboard_layout(text, jsonb)
    to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- §5. Registration (T-091/MIG-TOKENS pattern — atomic with the DDL)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0134', '{0134_dashboard_layouts.sql}', 'dashboard_layouts')
on conflict (version) do nothing;
