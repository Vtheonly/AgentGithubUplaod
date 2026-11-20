-- ============================================================================
-- 0092_portal_upload_storage.sql
-- ============================================================================
-- RECONSTRUCTED FROM LIVE (58th session, 2026-09-13 — T-326 / ARCH-011
-- reconciliation): this migration was applied to the production project and
-- registered in supabase_migrations.schema_migrations (version '0092', name
-- 'portal_upload_storage') WITHOUT its file ever being committed to the
-- chain (the ARCH-011 anti-pattern).
--
-- Purpose: the parent portal's absence-justification dialog
-- (elimtiyaz-website src/features/attendance/absence-justification-dialog.tsx)
-- uploads the justification file (photo/PDF) to the `attendance-justifications`
-- bucket at path `{tenant_id}/{student_id}/justifications/{record_id}.{ext}`
-- and records it on attendance_records.justification_path (columns added by
-- hub migration 0043 portal_alignment). The BUCKET and its storage.objects
-- policies never existed in the committed chain — 0018 defines the other
-- buckets; 0043 added the columns only.
--
-- This migration creates (idempotently):
--   1. the `attendance-justifications` bucket (private, 10 MB,
--      jpeg/png/webp/pdf — same limits as the 0018 document buckets);
--   2. four storage.objects policies mirroring the established
--      student-documents bucket pattern (0018/0080):
--        - parent read   — own-tenant + own-children folder prefix
--        - parent write  — INSERT, same scope (parents upload)
--        - parent update — UPDATE, same scope (replace before review)
--        - staff all     — super_admin/support_staff/teacher/financial_officer
--
-- Path convention: folder[1] = tenant_id, folder[2] = student_id — enforced
-- by the policies, matching the website's upload path format.
--
-- Idempotent: ON CONFLICT bucket insert + DROP/CREATE policies + ON CONFLICT
-- registration (already applied live — re-running is a no-op).
-- ============================================================================

-- 1. The bucket (private; only authenticated users under RLS policies).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'attendance-justifications',
    'attendance-justifications',
    false,
    10485760,  -- 10 MB
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
) on conflict (id) do nothing;

-- 2. Parent read — objects under their own children's folders.
drop policy if exists attendance_justifications_parent_read on storage.objects;
create policy attendance_justifications_parent_read
    on storage.objects for select to authenticated
    using (
        bucket_id = 'attendance-justifications'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (storage.foldername(name))[2] in (
            select s.id::text
              from public.students s
              join public.parents p on p.id = s.parent_id
             where p.auth_user_id = auth.uid()
               and p.deleted_at is null
               and s.deleted_at is null
        )
        and public.has_role('parent')
    );

-- 3. Parent write (upload) — same scope.
drop policy if exists attendance_justifications_parent_write on storage.objects;
create policy attendance_justifications_parent_write
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'attendance-justifications'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (storage.foldername(name))[2] in (
            select s.id::text
              from public.students s
              join public.parents p on p.id = s.parent_id
             where p.auth_user_id = auth.uid()
               and p.deleted_at is null
               and s.deleted_at is null
        )
        and public.has_role('parent')
    );

-- 4. Parent update (replace a file before staff review) — same scope.
drop policy if exists attendance_justifications_parent_update on storage.objects;
create policy attendance_justifications_parent_update
    on storage.objects for update to authenticated
    using (
        bucket_id = 'attendance-justifications'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (storage.foldername(name))[2] in (
            select s.id::text
              from public.students s
              join public.parents p on p.id = s.parent_id
             where p.auth_user_id = auth.uid()
               and p.deleted_at is null
               and s.deleted_at is null
        )
        and public.has_role('parent')
    )
    with check (
        bucket_id = 'attendance-justifications'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (storage.foldername(name))[2] in (
            select s.id::text
              from public.students s
              join public.parents p on p.id = s.parent_id
             where p.auth_user_id = auth.uid()
               and p.deleted_at is null
               and s.deleted_at is null
        )
        and public.has_role('parent')
    );

-- 5. Staff all — review + manage uploaded justifications.
drop policy if exists attendance_justifications_staff_all on storage.objects;
create policy attendance_justifications_staff_all
    on storage.objects for all to authenticated
    using (
        bucket_id = 'attendance-justifications'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'support_staff', 'teacher', 'financial_officer'])
    )
    with check (
        bucket_id = 'attendance-justifications'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'support_staff', 'teacher', 'financial_officer'])
    );

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — already applied live; ON CONFLICT
-- keeps this file a no-op on the live project while making fresh deployments
-- register it).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0092', '{0092_portal_upload_storage.sql}', 'portal_upload_storage')
on conflict (version) do nothing;
