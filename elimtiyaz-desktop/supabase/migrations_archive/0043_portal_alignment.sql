-- ============================================================================
-- 0043_portal_alignment.sql — PORTAL SCHEMA ALIGNMENT (website repo patches)
-- ============================================================================
-- The website repo (elimtiyaz-website) carries four portal patches versioned
-- 0025-0028 — version numbers that COLLIDE with the desktop chain's canonical
-- 0025_waterfall_allocation / 0026_unified_financial / 0027_shared_unification /
-- 0028_shared_schema_extensions already applied to every provisioned database
-- (including production). The remote migration history therefore could never
-- record the portal patches under those versions.
--
-- This migration brings the four portal patches into the canonical desktop
-- chain as 0043 so every database provisioned from the chain — production
-- included — receives the portal schema the website depends on:
--   • device_tokens.user_agent        (portal browser metadata)
--   • attendance_records justification columns + index (parent-submitted
--     justifications, workflow reviewed by staff)
--   • attendance_parent_update_justification RLS policy + column-guard trigger
--   • notification_preferences table + tenant trigger + RLS policies
--
-- The website repo's own 0025-0028 files remain the portal's local copies;
-- they are idempotent and collapse to no-ops when applied after this
-- migration. Content is identical apart from the idempotency guards.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. device_tokens.user_agent (website patch 0025)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 0025_device_tokens.sql — PORTAL ALIGNMENT PATCH (canonical schema)
-- ============================================================================
-- FCM device token registration for push notifications.
--
-- REWRITE NOTE (cross-platform equivalence finding W-0025-SCHEMA):
-- The original version of this migration CREATEd a `device_tokens` table
-- with a `user_profile_id` column. The canonical backend chain (desktop
-- repo, migration 0027_shared_unification.sql) already defines
-- `public.device_tokens` with `user_id` — so on any database provisioned
-- from the canonical chain this migration's CREATE TABLE IF NOT EXISTS was
-- a no-op and every subsequent statement (unique index + RLS policies on
-- `user_profile_id`) FAILED with "column user_profile_id does not exist".
--
-- The portal now registers tokens through the canonical
-- `register_fcm_token(p_user_id, p_token, p_platform)` RPC (migration 0027)
-- — the exact same entry point the Android app's FcmTokenRegistrar uses —
-- and reads/deactivates rows via the `user_id` column with the RLS
-- policies installed by migration 0037.
--
-- This patch therefore only adds the portal-specific `user_agent` column
-- (additive, nullable) and documents the alignment. It contains ZERO
-- business logic.
-- ============================================================================

-- Portal-specific metadata column (additive — the canonical 0027 table has
-- `app_version` for native clients; the browser portal records its UA).
ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

COMMENT ON COLUMN public.device_tokens.user_agent IS
  'Browser user agent for tokens registered by the web portal (NULL for native clients).';

-- ----------------------------------------------------------------------------
-- 2. attendance justification columns (website patch 0026)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 0026_attendance_justification_columns.sql
-- ============================================================================
-- Adds justification columns to attendance_records so parents can submit
-- absence justifications from the web portal. The original 0004 schema only
-- had a generic `note` column; per the Client Web Portal plan ("Absence
-- Justification — Notes, Uploads, Drive Links"), the portal needs dedicated
-- columns for the note text, the uploaded file path, and an optional Google
-- Drive link.
--
-- These columns are nullable so existing attendance rows are unaffected.
-- Parents can UPDATE only these three columns (RLS policy in 0027).
-- Staff can still update the full row (status, arrival_time, note, etc.).
-- ============================================================================

alter table public.attendance_records
  add column if not exists justification_note text,
  add column if not exists justification_path text,
  add column if not exists justification_drive_link text,
  add column if not exists justification_status text
    not null default 'none'
    check (justification_status in ('none', 'submitted', 'accepted', 'rejected')),
  add column if not exists justification_reviewed_by uuid,
  add column if not exists justification_reviewed_at timestamptz;

comment on column public.attendance_records.justification_note is
  'Parent-submitted justification note (web portal). NULL until the parent submits one.';
comment on column public.attendance_records.justification_path is
  'Storage path under bucket "attendance-justifications" for the parent-uploaded file.';
comment on column public.attendance_records.justification_drive_link is
  'Optional Google Drive link supplied by the parent as supporting evidence.';
comment on column public.attendance_records.justification_status is
  'Workflow state of the parent-submitted justification. Staff flip submitted→accepted/rejected from the desktop app.';
comment on column public.attendance_records.justification_reviewed_by is
  'user_profiles.id of the staff member who accepted/rejected the justification.';
comment on column public.attendance_records.justification_reviewed_at is
  'Timestamp of the staff review decision.';

create index if not exists attendance_justification_status_idx
  on public.attendance_records (tenant_id, justification_status)
  where justification_status <> 'none';

-- ----------------------------------------------------------------------------
-- 3. portal parent RLS policies (website patch 0027)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 0027_portal_parent_rls_policies.sql
-- ============================================================================
-- Adds the Row-Level Security policies the web portal needs but the desktop
-- migrations (0019) didn't include:
--
--   1. Parents can UPDATE attendance_records but ONLY the justification_*
--      columns (and only for their own children). The trigger below enforces
--      the column restriction because Postgres RLS itself can't.
--
--   2. Parents can SELECT and INSERT student_documents for their own children
--      (so they can upload birth certificates, medical certificates, etc.).
--
--   3. Parents can UPDATE their own parents row but ONLY contact fields
--      (primary_phone, secondary_phone, email, address, city, postal_code,
--      occupation). The trigger below enforces the column restriction.
--
-- These policies do NOT grant any new access to staff tables (expenses, HR,
-- audit logs, etc.) — the portal remains a strict client interface.
-- ============================================================================

-- ============================================================================
-- 1. attendance_records — parent can update justification_* for own children
-- ============================================================================
-- The existing attendance_teacher_update policy already allows
-- super_admin/teacher/support_staff to update any column. We add a separate
-- policy that allows parents to update rows for their own children, then
-- enforce column restrictions via a BEFORE UPDATE trigger.

drop policy if exists attendance_parent_update_justification on public.attendance_records;
create policy attendance_parent_update_justification on public.attendance_records
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_role('parent')
    and student_id in (
      select s.id from public.students s
      join public.parents p on p.id = s.parent_id
      where p.auth_user_id = auth.uid() and s.deleted_at is null and p.deleted_at is null
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_role('parent')
    and student_id in (
      select s.id from public.students s
      join public.parents p on p.id = s.parent_id
      where p.auth_user_id = auth.uid() and s.deleted_at is null and p.deleted_at is null
    )
  );

-- BEFORE UPDATE trigger: when the caller is a parent, restrict the update to
-- the justification_* columns only. Other columns (status, date, recorded_by,
-- etc.) must be rejected. Staff roles are unaffected.
create or replace function public.enforce_parent_attendance_update_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_parent boolean;
begin
  select public.has_role('parent') into is_parent;
  if is_parent then
    -- Only allow the parent to touch justification_* columns.
    if new.student_id is distinct from old.student_id
       or new.class_id is distinct from old.class_id
       or new.class_subject_id is distinct from old.class_subject_id
       or new.date is distinct from old.date
       or new.status is distinct from old.status
       or new.arrival_time is distinct from old.arrival_time
       or new.note is distinct from old.note
       or new.recorded_by is distinct from old.recorded_by
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Parents can only update justification columns on attendance_records';
    end if;
    -- Auto-set justification_status = 'submitted' the first time a parent
    -- submits a justification, but never override an accepted/rejected one.
    if old.justification_status in ('none', 'rejected') and new.justification_status = old.justification_status then
      new.justification_status = 'submitted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_records_enforce_parent_columns on public.attendance_records;
create trigger attendance_records_enforce_parent_columns
  before update on public.attendance_records
  for each row execute function public.enforce_parent_attendance_update_columns();

-- ============================================================================
-- 2. student_documents — parents can SELECT + INSERT for own children
-- ============================================================================
-- The existing student_documents_select policy already covers staff. We add
-- a parallel policy that lets parents read documents for their own children,
-- and an INSERT policy that lets them upload new ones (the desktop 0019
-- migration had student_documents_admin with FOR ALL but only for staff).

drop policy if exists student_documents_parent_select on public.student_documents;
create policy student_documents_parent_select on public.student_documents
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_role('parent')
    and student_id in (
      select s.id from public.students s
      join public.parents p on p.id = s.parent_id
      where p.auth_user_id = auth.uid() and s.deleted_at is null and p.deleted_at is null
    )
  );

drop policy if exists student_documents_parent_insert on public.student_documents;
create policy student_documents_parent_insert on public.student_documents
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_role('parent')
    and student_id in (
      select s.id from public.students s
      join public.parents p on p.id = s.parent_id
      where p.auth_user_id = auth.uid() and s.deleted_at is null and p.deleted_at is null
    )
    and uploaded_by = public.current_user_profile_id()
  );

-- ============================================================================
-- 3. parents — parent can self-update contact fields
-- ============================================================================
-- The existing parents_update policy only covers staff. We add a parallel
-- policy that allows a parent to update their own row, then enforce column
-- restrictions via a BEFORE UPDATE trigger.

drop policy if exists parents_self_update on public.parents;
create policy parents_self_update on public.parents
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_role('parent')
    and auth_user_id = auth.uid()
    and deleted_at is null
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_role('parent')
    and auth_user_id = auth.uid()
    and deleted_at is null
  );

create or replace function public.enforce_parent_self_update_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Parents can only touch contact fields. Anything else is rejected.
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.parent_code is distinct from old.parent_code
     or new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.national_id is distinct from old.national_id
     or new.relationship is distinct from old.relationship
     or new.notes is distinct from old.notes
     or new.is_active is distinct from old.is_active
     or new.is_financially_restricted is distinct from old.is_financially_restricted
     or new.auth_user_id is distinct from old.auth_user_id
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'Parents can only update contact fields (phone, email, address, occupation)';
  end if;
  return new;
end;
$$;

drop trigger if exists parents_enforce_self_update_columns on public.parents;
create trigger parents_enforce_self_update_columns
  before update on public.parents
  for each row execute function public.enforce_parent_self_update_columns();

-- ----------------------------------------------------------------------------
-- 4. notification_preferences (website patch 0028)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 0028_notification_preferences.sql
-- ============================================================================
-- Per-category notification opt-in/out for each user. The web portal uses
-- this table to let parents choose which notification categories they want
-- to receive via push (FCM) vs. in-app only.
--
-- Categories are derived from the notification taxonomy documented in the
-- project plan (payment, absence, message, announcement, grade, homework,
-- calendar, account, system).
--
-- A row is created on-demand the first time the user opens the preferences
-- screen — we don't pre-seed rows for every user × category. When a row is
-- missing, the default behavior is "both push and in-app enabled" (the
-- Edge Function treats missing rows as opted-in).
-- ============================================================================

create table if not exists public.notification_preferences (
  id              uuid        primary key default public.gen_uuid(),
  tenant_id       uuid        references public.tenants(id) on delete cascade,
  user_profile_id uuid        not null references public.user_profiles(id) on delete cascade,
  category        text        not null check (category in (
                    'payment', 'absence', 'message', 'announcement',
                    'grade', 'homework', 'calendar', 'account', 'system'
                  )),
  push_enabled    boolean     not null default true,
  in_app_enabled  boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_profile_id, category)
);

create index if not exists notification_prefs_user_idx
  on public.notification_preferences (user_profile_id);

comment on table public.notification_preferences is
  'Per-category notification opt-in/out for each user. Missing rows = both push and in-app enabled (default opt-in).';

drop trigger if exists notification_preferences_touch_updated_at on public.notification_preferences;
create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- Auto-populate tenant_id from the user's profile on insert.
create or replace function public.set_notification_preference_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    select tenant_id into new.tenant_id from public.user_profiles where id = new.user_profile_id;
  end if;
  return new;
end;
$$;

drop trigger if exists notification_preferences_set_tenant on public.notification_preferences;
create trigger notification_preferences_set_tenant
  before insert on public.notification_preferences
  for each row execute function public.set_notification_preference_tenant();

-- ----------------------------------------------------------------------------
-- RLS: a user can only see and manage their own preferences.
-- ----------------------------------------------------------------------------
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own
  on public.notification_preferences
  for select to authenticated
  using (user_profile_id = public.current_user_profile_id());

drop policy if exists notification_preferences_upsert_own on public.notification_preferences;
create policy notification_preferences_upsert_own
  on public.notification_preferences
  for insert to authenticated
  with check (user_profile_id = public.current_user_profile_id());

drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own
  on public.notification_preferences
  for update to authenticated
  using (user_profile_id = public.current_user_profile_id())
  with check (user_profile_id = public.current_user_profile_id());

drop policy if exists notification_preferences_delete_own on public.notification_preferences;
create policy notification_preferences_delete_own
  on public.notification_preferences
  for delete to authenticated
  using (user_profile_id = public.current_user_profile_id());

