-- ============================================================================
-- 0153_expense_attachments_responsible.sql
-- ============================================================================
-- T-521 (WORKFORCE-518 + WORKFORCE-520, 167th session 2026-10-13) — the
-- expense-management unification (the owner's GitHub issue #29):
--
--   1. `expense_attachments` — THE canonical attachment metadata table.
--      One expense may carry ONE or MULTIPLE supporting images (receipts,
--      scanned justifications — the issue's §3/§4 mandate). The table is the
--      §15.31/SYNC-110 rule applied to expenses: a shared multi-client entity
--      (desktop Finance, desktop Staff/Personnel, Android scanner) owns ONE
--      canonical metadata table — never a per-client JSON column, never a
--      per-client derivation. The bytes live in the EXISTING private
--      `expense-receipts` bucket (migration 0018 — private, 10 MB,
--      jpeg/png/webp/pdf, the `<tenant_id>/<entity_id>/<filename>` path
--      canon); this table stores the METADATA (path, name, mime, size,
--      uploader, source) and the relationship to the parent expense.
--
--      DUPLICATE-UPLOAD GUARD: unique (expense_id, storage_path) — the same
--      file re-uploaded to the same path (a retried upload that actually
--      landed) can never create a second metadata row for the same bytes.
--      (The media vault's path already carries a timestamp+random suffix, so
--      a user deliberately re-attaching the same FILE creates a new path —
--      a new metadata row, the honest semantics — while a RETRIED upload of
--      the SAME path is idempotent.)
--
--   2. `expense_tickets.responsible_profile_id` — THE distinct
--      responsible-person relationship (the issue's §6 mandate: the staff
--      member accountable for the spend, DISTINCT from submitted_by the
--      requester and approved_by the decider). NULLABLE by design:
--      historical rows keep NULL and are FLAGGED for review in the UI
--      ("à renseigner") — the issue's rule: "Do not invent responsible-person
--      assignments or silently rewrite historical records."
--
--   3. RLS for expense_attachments — tenant-scoped, mirroring the
--      expense_tickets visibility set (0019): the privileged trio
--      (super_admin/financial_officer/manager) reads every tenant
--      attachment; every authenticated member of the ticket-insert role set
--      may INSERT (attach evidence to a ticket they can see); delete is
--      privileged-only (evidence removal is an administrative act).
--      The UPDATE policy is deliberately NOT created: attachment rows are
--      immutable metadata (wrong upload = delete + re-attach, both audited
--      client-side through the existing write_audit_log RPC path).
--
-- What this migration deliberately does NOT do:
--   - It does NOT touch `receipt_path` (the legacy single-proof column):
--     existing reads keep working; the desktop settle path continues to
--     write it (backward compatibility for every deployed client), while
--     `expense_attachments` owns the multi-image relationship going forward.
--   - It does NOT backfill `responsible_profile_id` (no invented data).
--   - It does NOT touch the 0064 state-machine trigger (unchanged rules).
--   - It does NOT create a new storage bucket (0018's `expense-receipts`
--     is canonical and its RLS is already correct — the defect was that no
--     client uploaded to it, which this task fixes in the clients).

-- ----------------------------------------------------------------------------
-- §1. expense_attachments — the canonical attachment metadata table
-- ----------------------------------------------------------------------------
create table public.expense_attachments (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    expense_id      uuid        not null references public.expense_tickets(id) on delete cascade,
    storage_bucket  text        not null default 'expense-receipts'
                    check (storage_bucket in ('expense-receipts', 'payment-proofs')),
                    -- 'payment-proofs' is accepted ONLY for legacy scanner rows
                    -- (the pre-T-521 Android scanner uploaded expense receipts
                    -- there); new writes are expected on 'expense-receipts'.
    storage_path    text        not null,          -- '<tenant>/<expense>/<file>' under the bucket
    file_name       text        not null,          -- the original user-facing name
    mime_type       text        not null,
    size_bytes      bigint      not null check (size_bytes > 0),
    uploaded_by     uuid,                           -- user_profiles.id
    uploaded_at     timestamptz not null default now(),
    source          text        not null default 'desktop'
                    check (source in ('desktop', 'mobile_camera', 'mobile_gallery')),
    created_at      timestamptz not null default now(),
    unique (expense_id, storage_path)               -- the duplicate-upload guard
);

create index expense_attachments_expense_idx on public.expense_attachments (expense_id, uploaded_at desc);
create index expense_attachments_tenant_idx on public.expense_attachments (tenant_id, uploaded_at desc);

comment on table public.expense_attachments is
  'T-521 (issue #29 / WORKFORCE-518): the canonical expense-attachment metadata — one expense, many supporting images; bytes in the 0018 expense-receipts bucket; the single source of truth shared by desktop Finance, desktop Staff/Personnel, and the Android scanner.';

-- ----------------------------------------------------------------------------
-- §2. expense_tickets.responsible_profile_id — the distinct accountable person
-- ----------------------------------------------------------------------------
alter table public.expense_tickets
    add column responsible_profile_id uuid references public.user_profiles(id) on delete set null;

comment on column public.expense_tickets.responsible_profile_id is
  'T-521 (issue #29 / WORKFORCE-520): the staff member accountable for the spend — DISTINCT from submitted_by (requester) and approved_by (decider). NULL on historical rows: flagged for review in the UI, never back-filled (the no-fabrication rule).';

create index expense_tickets_responsible_idx on public.expense_tickets (responsible_profile_id) where responsible_profile_id is not null;

-- ----------------------------------------------------------------------------
-- §3. RLS — expense_attachments
-- ----------------------------------------------------------------------------
alter table public.expense_attachments enable row level security;

-- Read: whoever can see the parent ticket can see its attachments (0019's
-- expense_tickets_select set — the privileged trio, plus... the submitter
-- reads the parent by submitted_by; here the attachment read is the trio
-- only, matching the 0018 expense_receipts_read storage policy exactly).
create policy expense_attachments_select on public.expense_attachments
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'manager'])
    );

-- Insert: the 0018 expense_receipts_write role set (same audience that can
-- upload into the bucket can register the metadata row).
create policy expense_attachments_insert on public.expense_attachments
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'manager', 'buyer',
                                  'teacher', 'support_staff', 'driver', 'warehouse_worker', 'worker'])
    );

-- Delete: privileged-only (evidence removal is administrative).
create policy expense_attachments_delete on public.expense_attachments
    for delete to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'manager'])
    );

-- ----------------------------------------------------------------------------
-- §4. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0153', '{0153_expense_attachments_responsible.sql}', 'expense_attachments_responsible')
on conflict (version) do nothing;
