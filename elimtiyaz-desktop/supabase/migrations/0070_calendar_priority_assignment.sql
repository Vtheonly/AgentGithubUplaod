-- ============================================================================
-- 0070 — Calendar events: priority + assignment columns (T-175 / T-047 port)
-- Task: T-175 (session 28, 2026-09-05)
--
-- WHAT: Adds three columns to `public.calendar_events`:
--   - priority        text NOT NULL DEFAULT 'medium' (alert-priority enum)
--   - assigned_to_user_id uuid  (user_profiles.id — no FK, convention)
--   - assigned_to_role      text  (role code, e.g. 'financial_officer')
--
-- WHY: T-047's scoping (docs/architecture/t-047-repository-migration-scoping.md)
--   classified the `calendar` slot as "PORT — adapter over existing tables
--   (no schema work needed)". That was true at TABLE granularity but not at
--   COLUMN granularity: the desktop domain contract (CalendarEvent /
--   CreateCalendarEventInput, `domain/model/calendar.ts`) carries `priority`
--   (the creator modal's Priorité select; the calendar view's priority badge)
--   and `assignedToUserId` / `assignedToRole` — none of which had a column.
--   A lossless port is impossible without them: the desktop writer would
--   silently drop the staff member's chosen priority (always 'medium') and
--   assignment. This migration closes exactly that gap; it does NOT change
--   any existing column, policy or RPC.
--
-- SAFETY / IDEMPOTENCE:
--   - Pure additive DDL (ADD COLUMN IF NOT EXISTS ×3) — safe to re-run.
--   - NOT NULL with DEFAULT on priority: a brief ACCESS EXCLUSIVE lock,
--     no table rewrite (Postgres fast default since v11).
--   - Existing rows: every pre-0070 event becomes priority 'medium'
--     (the domain default in the creator modal) with null assignment —
--     exactly the mock fallback behaviour.
--   - RLS untouched: writes still flow through the tenant-scoped
--     `calendar_events_admin` FOR ALL policy (migration 0019).
-- ============================================================================

alter table public.calendar_events
  add column if not exists priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  add column if not exists assigned_to_user_id uuid,
  add column if not exists assigned_to_role text;

comment on column public.calendar_events.priority is
  'Alert-priority enum for color-coding manual events (low/medium/high/urgent). Desktop domain default medium. Added by 0070 (T-175).';
comment on column public.calendar_events.assigned_to_user_id is
  'user_profiles.id the event is assigned to (no FK, convention). NULL = unassigned. Added by 0070 (T-175).';
comment on column public.calendar_events.assigned_to_role is
  'Role code the event is assigned to (e.g. financial_officer). NULL = unassigned. Added by 0070 (T-175).';

-- Registration row (T-091/MIG-TOKENS pattern — the Management-API apply
-- script scripts/apply_0070_live.sh embeds this statement so the DDL and the
-- registration land in ONE atomic transaction; kept here too so a fresh CLI
-- deployment registers identically. ON CONFLICT keeps it idempotent.)
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0070', '{0070_calendar_priority_assignment.sql}', 'calendar_priority_assignment')
on conflict (version) do nothing;
