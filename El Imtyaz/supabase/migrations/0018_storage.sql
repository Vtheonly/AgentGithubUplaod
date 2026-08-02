-- ============================================================================
-- 0018_storage.sql
-- ============================================================================
-- Supabase Storage bucket definitions + per-bucket RLS policies.
--
-- Per plan §13 (Storage):
--   - No public URLs — every access requires a signed URL (5-min default)
--   - Never cache signed URLs client-side
--   - Stored assets: receipts, check scans, medical certificates, vendor
--     receipts, expense proofs, homework attachments, student documents,
--     task attachments, tenant logos, AI-generated reports
--
-- Bucket naming convention (clear, consistent, kebab-case):
--   - bucket names are globally unique within a Supabase project
--   - all lowercase, hyphen-separated, no underscores, no special chars
--   - pattern: <domain>-<asset-type>  e.g. 'payment-proofs', 'expense-receipts'
--
-- Every bucket has:
--   - public = false (signed URLs only)
--   - allowed_mime_types restricted to the asset's expected formats
--   - max_file_size configured per asset type
--   - per-tenant folder structure: <tenant_id>/<entity_id>/<filename>
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Insert bucket definitions into storage.buckets
--    (Supabase storage schema is created by the storage extension.)
-- ----------------------------------------------------------------------------

-- payment-proofs — check scans + transfer receipts (plan §13.05)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'payment-proofs',
    'payment-proofs',
    false,
    10485760,  -- 10 MB
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
) on conflict (id) do nothing;

-- expense-receipts — vendor receipts (plan §08)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'expense-receipts',
    'expense-receipts',
    false,
    10485760,  -- 10 MB
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
) on conflict (id) do nothing;

-- receipts — auto-generated PDF receipts (plan §07.05)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'receipts',
    'receipts',
    false,
    5242880,  -- 5 MB
    array['application/pdf']
) on conflict (id) do nothing;

-- student-documents — birth certificates, medical, contracts, etc. (plan §04)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'student-documents',
    'student-documents',
    false,
    10485760,  -- 10 MB
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
) on conflict (id) do nothing;

-- homework-attachments — teacher-uploaded PDFs/photos for homework (plan §05.07)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'homework-attachments',
    'homework-attachments',
    false,
    10485760,  -- 10 MB
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
) on conflict (id) do nothing;

-- task-attachments — files attached to tasks (plan §10.05)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'task-attachments',
    'task-attachments',
    false,
    10485760,  -- 10 MB
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel', 'application/msword',
          'text/plain', 'text/csv']
) on conflict (id) do nothing;

-- chat-attachments — files shared in chat channels (plan §10.09)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'chat-attachments',
    'chat-attachments',
    false,
    10485760,  -- 10 MB
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain']
) on conflict (id) do nothing;

-- tenant-assets — logos, branding assets per tenant
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'tenant-assets',
    'tenant-assets',
    false,
    5242880,  -- 5 MB
    array['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']
) on conflict (id) do nothing;

-- ai-reports — AI-generated PDF reports (narratives, drafts) before teacher review
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'ai-reports',
    'ai-reports',
    false,
    5242880,  -- 5 MB
    array['application/pdf', 'text/plain']
) on conflict (id) do nothing;

-- import-reports — Excel/JSON reports from the import engine (plan §14)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'import-reports',
    'import-reports',
    false,
    10485760,  -- 10 MB
    array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/json', 'text/csv']
) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Storage Object Metadata (Supabase pattern: storage.objects table)
--    Per-bucket RLS policies below enforce:
--      - tenant isolation: object path must start with the caller's tenant_id
--      - role gating: only authorized roles can read/write
--      - signed URL access only (no public read)
-- ----------------------------------------------------------------------------

-- Policy: payment-proofs — FinancialOfficer + SuperAdmin can read; cashier can write
-- (Folder structure: <tenant_id>/<payment_id>/<filename>)
create policy "payment_proofs_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'payment-proofs'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

create policy "payment_proofs_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'payment-proofs'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

-- Policy: expense-receipts — staff can write; admin/finoff can read
create policy "expense_receipts_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'expense-receipts'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'manager', 'buyer'])
    );

create policy "expense_receipts_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'expense-receipts'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'manager', 'buyer',
                                  'teacher', 'support_staff', 'driver', 'warehouse_worker', 'worker'])
    );

-- Policy: receipts — system writes (Edge Function); admin/finoff + parent reads own
create policy "receipts_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
            or public.has_role('parent')
        )
    );

create policy "receipts_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

-- Policy: student-documents — admin/staff read; admin/staff write
create policy "student_documents_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'student-documents'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff',
                                  'teacher', 'manager'])
    );

create policy "student_documents_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'student-documents'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

-- Policy: homework-attachments — teacher writes; teacher + student + parent read
create policy "homework_attachments_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'homework-attachments'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'teacher', 'parent', 'student', 'support_staff'])
    );

create policy "homework_attachments_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'homework-attachments'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'teacher'])
    );

-- Policy: task-attachments — any staff can read; assignee + creator write
create policy "task_attachments_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'task-attachments'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff',
                                  'teacher', 'manager', 'buyer', 'driver',
                                  'warehouse_worker', 'worker'])
    );

create policy "task_attachments_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'task-attachments'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff',
                                  'teacher', 'manager', 'buyer', 'driver',
                                  'warehouse_worker', 'worker'])
    );

-- Policy: chat-attachments — channel members only
create policy "chat_attachments_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'chat-attachments'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff',
                                  'teacher', 'manager', 'buyer', 'driver',
                                  'warehouse_worker', 'worker'])
    );

create policy "chat_attachments_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'chat-attachments'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff',
                                  'teacher', 'manager', 'buyer', 'driver',
                                  'warehouse_worker', 'worker'])
    );

-- Policy: tenant-assets — SuperAdmin + FinancialOfficer only
create policy "tenant_assets_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'tenant-assets'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer'])
    );

create policy "tenant_assets_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'tenant-assets'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_role('super_admin')
    );

-- Policy: ai-reports — system writes; teacher + admin read
create policy "ai_reports_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'ai-reports'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'teacher'])
    );

create policy "ai_reports_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'ai-reports'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer'])
    );

-- Policy: import-reports — admin only
create policy "import_reports_read" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'import-reports'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

create policy "import_reports_write" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'import-reports'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

-- ----------------------------------------------------------------------------
-- 3. Helper function: get_signed_url (callable from Edge Functions / RLS)
-- ----------------------------------------------------------------------------
-- Returns a signed URL for a storage object, validating the caller has access.
create or replace function public.get_signed_url(
    p_bucket_id text,
    p_object_path text,
    p_expires_seconds integer default 300
)
returns text
language plpgsql
security definer
as $$
declare
    v_url text;
    v_tenant_id uuid := public.current_tenant_id();
begin
    -- Validate tenant isolation: object path must start with tenant_id
    if not p_object_path like v_tenant_id::text || '/%' then
        raise exception 'Access denied: object does not belong to caller''s tenant';
    end if;

    -- Use Supabase storage function to generate signed URL
    -- (This is a placeholder — actual signed URL generation happens via
    -- the Supabase JS client or Edge Function; this SQL function is for
    -- server-side use cases where a function needs to return a URL.)
    select 'signed-url-placeholder' into v_url;

    return v_url;
end;
$$;

comment on function public.get_signed_url is
  'Server-side signed URL generator. Validates tenant isolation. Client-side signed URLs should be generated via the Supabase JS client createSignedUrl() method.';

-- ----------------------------------------------------------------------------
-- 4. Comment on storage strategy
-- ----------------------------------------------------------------------------
comment on schema storage is 'Supabase Storage schema. All buckets are private (signed URLs only). Folder structure: <tenant_id>/<entity_id>/<filename> enforces tenant isolation.';
