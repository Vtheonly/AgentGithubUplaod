-- ============================================================================
-- 0135_chat_channel_scope.sql — THE TWO CHAT SYSTEMS, SEPARATED IN THE DATA
-- MODEL (T-463 / CHAT-300, 135th session, 2026-10-03)
-- ============================================================================
-- OWNER MANDATE (registered as CHAT-300 before this fix, per AGENTS.md §13):
--   the platform has TWO distinct chat systems that must never be mixed:
--     (1) PORTAL↔STAFF — administrators/staff (desktop or mobile app)
--         communicating with students/parents through the portal ("part of
--         the portal communication system", ADR-012);
--     (2) INTERNAL STAFF — desktop↔desktop, desktop↔mobile, mobile↔mobile,
--         individual staff members, workers/personnel, staff-to-staff and
--         group conversations ("an internal workplace communication system
--         designed for communication between employees and personnel, not
--         students or parents").
--   Until now BOTH lived in ONE undifferentiated chat_channels table and
--   every client merged them into one channel list.
--
-- THE SEPARATION RULE (derived, not client-declared):
--   scope = 'portal'   when ANY member is NOT staff — a portal participant
--                      (parent/student role holder, or a profile with no
--                      employee roles at all) makes the channel a portal
--                      conversation;
--   scope = 'internal' only when EVERY member holds an employee role (the
--                      9-role 0105 set, incl. worker/buyer/driver/
--                      warehouse_worker) in the channel's tenant.
--   The derivation runs in a BEFORE INSERT OR UPDATE trigger — clients
--   CANNOT mislabel a channel: a staff member cannot smuggle a parent into
--   an 'internal' channel, and every parent DM is 'portal' by construction.
--   TENANT NOTE (live-learned, 135th session): the resolvers take the
--   channel's OWN tenant (NEW.tenant_id), NOT current_tenant_id() — the
--   caller-scoped 0067 resolvers are meaningless in caller-less contexts
--   (this migration's backfill) and would silently misclassify everything
--   as 'internal'.
--
-- ALSO FIXED HERE (the 0105/0067 role-list inconsistency, discovered while
-- designing the scope rule): 0067's profile_has_staff_role resolver lists
-- only the 5 office roles, while 0105 widened create_direct_channel to the
-- FULL 9-role employee set — so a WORKER creating a group channel via the
-- raw insert path (the desktop "new channel" form) hit 0067's non-staff-
-- creator branch and was denied (workers are not in the 5-role list).
-- profile_has_staff_role is recreated here on the 9-role list, aligning the
-- RLS resolvers with 0105's definition of staff. This is a strict WIDENING
-- of who counts as staff for chat (workers were already full chat citizens
-- via the RPC); parents/students remain non-staff everywhere.
--
-- COMPATIBILITY: the column is additive with a default; existing clients
-- that don't select it are unaffected. The trigger is SECURITY-less (a
-- plain row trigger — it runs under the writing role, incl. the SECURITY
-- DEFINER RPCs 0061/0067, whose member arrays it derives from; its
-- resolvers are themselves SECURITY DEFINER so the role lookups work under
-- any writer).
--
-- IDEMPOTENCY: drop-if-exists + create-or-replace throughout; the ALTER is
-- IF NOT EXISTS; the backfill is a no-op on re-run (derived values equal).
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): applied to the live
-- project TOGETHER with its schema_migrations registration in one atomic
-- transaction (the 0105 registration stanza at the bottom).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profile_has_staff_role — recreated on the FULL 9-role employee set
--    (0105 alignment; the 0067 policies keep their exact semantics, now
--    with the correct staff definition). Caller-tenant-scoped (RLS use).
-- ----------------------------------------------------------------------------
create or replace function public.profile_has_staff_role(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.role_assignments ra
          join public.roles r on r.id = ra.role_id
         where ra.user_profile_id = p_profile_id
           and ra.revoked_at is null
           and (ra.tenant_id = public.current_tenant_id() or ra.tenant_id is null)
           -- T-463 (0135): the FULL employee set — the same 9-role list
           -- 0105 gave create_direct_channel (the 0023 census minus
           -- parent/student). The 0067 5-role list predated the workforce
           -- parity mandate and made worker group-channel raw inserts
           -- RLS-impossible (CHAT-300's permissions half).
           and r.code = any(array[
               'super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher',
               'worker', 'buyer', 'driver', 'warehouse_worker'
           ])
    );
$$;

comment on function public.profile_has_staff_role is
  'CHAT-300 (0135): does this profile hold an ACTIVE employee role (the 0105 9-role set — office + workforce) in the CURRENT tenant? Caller-scoped (current_tenant_id) — for RLS policies. Use profile_has_staff_role_in_tenant for row-tenant derivations (the 0135 trigger/backfill).';

-- ----------------------------------------------------------------------------
-- 2. profile_has_staff_role_in_tenant — the row-tenant variant the scope
--    derivation needs (current_tenant_id() is NULL in caller-less contexts
--    such as this migration's backfill — live-learned, 135th session)
-- ----------------------------------------------------------------------------
create or replace function public.profile_has_staff_role_in_tenant(
    p_profile_id uuid,
    p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.role_assignments ra
          join public.roles r on r.id = ra.role_id
         where ra.user_profile_id = p_profile_id
           and ra.revoked_at is null
           and (ra.tenant_id = p_tenant_id or ra.tenant_id is null)
           and r.code = any(array[
               'super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher',
               'worker', 'buyer', 'driver', 'warehouse_worker'
           ])
    );
$$;

comment on function public.profile_has_staff_role_in_tenant is
  'CHAT-300 (0135): the row-tenant variant of profile_has_staff_role — does this profile hold an ACTIVE employee role in the GIVEN tenant? The scope-derivation trigger and the 0135 backfill use this (current_tenant_id() is caller-scoped and NULL in caller-less migration contexts).';

-- ----------------------------------------------------------------------------
-- 3. The scope column
-- ----------------------------------------------------------------------------
alter table public.chat_channels
    add column if not exists scope text not null default 'internal';

-- Drop-if-exists + re-add so the constraint's definition is stable on
-- re-runs (a no-op when already correct).
alter table public.chat_channels
    drop constraint if exists chat_channels_scope_check;
alter table public.chat_channels
    add constraint chat_channels_scope_check
    check (scope in ('internal', 'portal'));

comment on column public.chat_channels.scope is
  'CHAT-300 (0135): which chat system this channel belongs to — ''portal'' (at least one member is not an employee-role holder; the ADR-012 portal↔staff communication) or ''internal'' (every member holds an employee role; the ADR-008 workplace messenger). FORCED by the chat_channels_derive_scope trigger from member composition — clients cannot set it.';

-- ----------------------------------------------------------------------------
-- 4. The derivation trigger — scope is a derived, unspoofable column
-- ----------------------------------------------------------------------------
create or replace function public.chat_channels_derive_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if exists (
        select 1
          from unnest(new.member_ids) as m
         where not public.profile_has_staff_role_in_tenant(m, new.tenant_id)
    ) then
        new.scope := 'portal';
    else
        new.scope := 'internal';
    end if;
    return new;
end;
$$;

comment on function public.chat_channels_derive_scope is
  'CHAT-300 (0135): forces chat_channels.scope from member composition — any NON-staff member (parent/student, or a profile with no employee roles) makes the channel ''portal''; only all-employee member sets are ''internal''. Runs BEFORE INSERT and before every UPDATE so a client-supplied scope value never survives. Uses the row''s OWN tenant (NEW.tenant_id), not current_tenant_id().';

drop trigger if exists chat_channels_derive_scope on public.chat_channels;
create trigger chat_channels_derive_scope
    before insert or update on public.chat_channels
    for each row
    execute function public.chat_channels_derive_scope();

-- ----------------------------------------------------------------------------
-- 5. Backfill the existing rows (idempotent — the derivation is stable).
--    Live census at registration time: 2 rows, both parent↔admin DMs
--    (open_parent_admin_channel products; the parent-side members were
--    since-deleted test users — profiles with no employee roles, therefore
--    NOT staff, therefore the channels are 'portal': a channel with a
--    non-employee member is a portal conversation by definition).
-- ----------------------------------------------------------------------------
update public.chat_channels c
   set scope = case
       when exists (
           select 1
             from unnest(c.member_ids) as m
            where not public.profile_has_staff_role_in_tenant(m, c.tenant_id)
       ) then 'portal'
       else 'internal'
   end
 where scope is distinct from (
       case
           when exists (
               select 1
                 from unnest(c.member_ids) as m
                where not public.profile_has_staff_role_in_tenant(m, c.tenant_id)
           ) then 'portal'
           else 'internal'
       end
   );

-- ----------------------------------------------------------------------------
-- 6. Grants (the 0067 convention for RPC-facing resolvers).
-- ----------------------------------------------------------------------------
grant execute on function public.profile_has_staff_role_in_tenant(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Registration (T-091/MIG-TOKENS pattern — atomic with the live apply)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0135', '{0135_chat_channel_scope.sql}', 'chat_channel_scope')
on conflict (version) do nothing;
