-- ============================================================================
-- 0013_calendar_notifications_backup.sql
-- ============================================================================
-- Three sections:
--   A. Calendar — manually-created events by staff. Auto-derived events
--      (payments, audit log, expenses) are computed via a view, NOT stored.
--   B. Notifications/Alerts — user-facing alerts with priority, source, and
--      optional link back to the originating entity.
--   C. Backup metadata — ciphertext stays in IndexedDB (plan §13.03); this
--      table stores ONLY metadata (archive ID, checksum, retention, status).
--
-- Per plan §13 (Calendar, Notifications, Backup):
--   - Calendar events support polymorphic links to any entity (payment, parent,
--     student, expense ticket, etc.) via target_entity_type/target_entity_id
--   - Notifications have priority (low/medium/high/urgent) and source
--     (system/manual/workflow/schedule/audit) for filtering
--   - Backup archives NEVER store ciphertext in Postgres — only metadata.
--     Ciphertext lives in IndexedDB per the offline-first Electron design.
--   - Retention + purge scheduling is metadata-driven; the actual purge is
--     performed by a scheduled job in the Electron main process.
--
-- Conventions (consistent with 0002–0012):
--   - `public.gen_uuid()` for PKs
--   - `tenant_id` NOT NULL FK → tenants(id) ON DELETE CASCADE
--   - `created_at`/`updated_at` timestamptz NOT NULL DEFAULT now()
--   - `public.touch_updated_at()` trigger on every table with `updated_at`
--   - Actor columns (created_by, restored_by, target_user_id) reference
--     user_profiles.id WITHOUT FK constraints (convention)
--   - GIN indexes on jsonb columns; trigram on searchable text
--   - CHECK constraints for all enum-like text fields
--
-- Scale assumptions (per plan §00):
--   - ~5,000 total users / ~300 DAU / ~50 peak concurrent
-- ============================================================================

-- ============================================================================
-- SECTION A — CALENDAR
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A.1 calendar_events — manually-created events by staff
-- ----------------------------------------------------------------------------
-- NOTE: Auto-derived events (from payments, audit log, expenses) are computed
-- at read time via a view, NOT stored in this table. Only manual staff entries
-- live here. A future migration may create view public.calendar_events_derived
-- that UNIONs this table with derived rows.
create table public.calendar_events (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    kind                text        not null check (kind in (
                                'payment_received', 'audit_log', 'expense_event',
                                'follow_up_call', 'reminder', 'meeting', 'custom'
                            )),
    title               text        not null,
    description         text,
    start_at            timestamptz not null,
    end_at              timestamptz,
    all_day             boolean     not null default false,
    location            text,
    attendee_count      integer     not null default 0 check (attendee_count >= 0),
    target_entity_type  text,                                           -- 'parent', 'student', 'payment', 'expense_ticket', etc.
    target_entity_id    uuid,                                           -- polymorphic FK (no constraint)
    target_name         text,                                           -- denormalized contact name for follow-up calls
    target_phone        text,                                           -- denormalized contact phone for follow-up calls
    created_by          uuid,                                           -- user_profiles.id (no FK by convention)
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    is_deleted          boolean     not null default false,
    check (end_at is null or end_at >= start_at)
);

create index calendar_events_tenant_start_idx on public.calendar_events (tenant_id, start_at) where is_deleted = false;
create index calendar_events_tenant_kind_idx on public.calendar_events (tenant_id, kind, start_at) where is_deleted = false;
create index calendar_events_target_idx on public.calendar_events (target_entity_type, target_entity_id) where target_entity_id is not null;
create index calendar_events_created_by_idx on public.calendar_events (created_by, created_at desc) where created_by is not null;
create index calendar_events_trgm_idx on public.calendar_events using gin (title extensions.gin_trgm_ops);

comment on table public.calendar_events is
  'Manual staff-created calendar events. Auto-derived events (payments/audit/expenses) are computed via view, not stored. Plan §13.01.';
comment on column public.calendar_events.kind is 'Event discriminator. payment_received/audit_log/expense_event are typically auto-derived (view); follow_up_call/reminder/meeting/custom are manual.';
comment on column public.calendar_events.start_at is 'Event start (timestamptz). Required. For all-day events, set start_at to midnight and end_at to next midnight.';
comment on column public.calendar_events.all_day is 'TRUE for all-day events (no time component). When TRUE, the UI ignores the time portion of start_at/end_at.';
comment on column public.calendar_events.target_entity_type is 'Polymorphic link discriminator (e.g. parent, student, payment, expense_ticket). target_entity_id is the row UUID.';
comment on column public.calendar_events.target_name is 'Denormalized contact name for follow-up calls — survives even if the linked entity is soft-deleted.';
comment on column public.calendar_events.target_phone is 'Denormalized contact phone for follow-up calls — survives even if the linked entity is soft-deleted.';
comment on column public.calendar_events.created_by is 'user_profiles.id of the staff member who created the event. No FK (convention).';
comment on column public.calendar_events.is_deleted is 'Soft-delete flag. Deleted events are filtered out by default via WHERE is_deleted = false.';

-- ============================================================================
-- SECTION B — NOTIFICATIONS / ALERTS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B.1 notifications — user-facing alerts
-- ----------------------------------------------------------------------------
create table public.notifications (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    kind                text        not null check (kind in (
                                'alert', 'info', 'warning', 'success', 'error', 'system'
                            )),
    title               text        not null,
    body                text,
    priority            text        not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
    source              text        not null default 'system' check (source in (
                                'system', 'manual', 'workflow', 'schedule', 'audit'
                            )),
    source_label        text,                                           -- human-readable source label, e.g. 'Workflow: Overdue Alert'
    target_user_id      uuid,                                           -- user_profiles.id (no FK by convention). NULL = broadcast to role.
    target_role         text,                                           -- role name for role-targeted notifications (NULL = all)
    is_read             boolean     not null default false,
    read_at             timestamptz,
    dismissed_at        timestamptz,
    triggered_at        timestamptz not null default now(),
    expires_at          timestamptz,
    link_entity_type    text,                                           -- 'payment', 'expense_ticket', 'workflow_run', etc.
    link_entity_id      uuid,                                           -- polymorphic FK (no constraint)
    created_by          uuid,                                           -- user_profiles.id (no FK by convention)
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index notifications_tenant_user_idx on public.notifications (tenant_id, target_user_id, triggered_at desc) where target_user_id is not null;
create index notifications_tenant_role_idx on public.notifications (tenant_id, target_role, triggered_at desc) where target_role is not null;
create index notifications_unread_idx on public.notifications (tenant_id, target_user_id) where is_read = false and dismissed_at is null and target_user_id is not null;
create index notifications_priority_idx on public.notifications (tenant_id, priority, triggered_at desc) where priority in ('high', 'urgent');
create index notifications_expires_idx on public.notifications (tenant_id, expires_at) where expires_at is not null;
create index notifications_link_idx on public.notifications (link_entity_type, link_entity_id) where link_entity_id is not null;
create index notifications_trgm_idx on public.notifications using gin (title extensions.gin_trgm_ops);

comment on table public.notifications is
  'User-facing alerts. target_user_id=NULL means role-broadcast (target_role). Polymorphic link to originating entity. Plan §13.02.';
comment on column public.notifications.kind is 'Visual category: alert/info/warning/success/error/system (drives icon + color).';
comment on column public.notifications.priority is 'Urgency: low/medium/high/urgent. Urgent triggers desktop notification + sound.';
comment on column public.notifications.source is 'Origin: system (auto), manual (admin-created), workflow (workflow_run), schedule (cron), audit (audit log).';
comment on column public.notifications.source_label is 'Human-readable source (e.g. "Workflow: Overdue Alert") shown in the notification UI.';
comment on column public.notifications.target_user_id is 'user_profiles.id of the recipient. NULL = broadcast to all users with target_role. No FK (convention).';
comment on column public.notifications.target_role is 'Role name for role-targeted notifications. NULL = all tenant users. Used when target_user_id is NULL.';
comment on column public.notifications.is_read is 'TRUE once the user has opened the notification (read_at is set).';
comment on column public.notifications.dismissed_at is 'Set when the user explicitly dismisses the notification (separate from read — dismissed hides it permanently).';
comment on column public.notifications.triggered_at is 'When the underlying event occurred (may differ from created_at for replayed/backfilled notifications).';
comment on column public.notifications.expires_at is 'Optional TTL — notification is hidden from active lists after this timestamp. NULL = never expires.';
comment on column public.notifications.link_entity_type is 'Polymorphic link discriminator (payment, expense_ticket, workflow_run, etc.). link_entity_id is the row UUID.';
comment on column public.notifications.created_by is 'user_profiles.id of the creator (NULL for system-generated notifications). No FK (convention).';

-- ============================================================================
-- SECTION C — BACKUP METADATA
-- ============================================================================

-- ----------------------------------------------------------------------------
-- C.1 backup_archives — metadata for IndexedDB-stored ciphertext archives
-- ----------------------------------------------------------------------------
-- CRITICAL: This table stores ONLY metadata. The actual ciphertext blob lives
-- in IndexedDB inside the Electron app (plan §13.03). Postgres must NEVER see
-- the plaintext or the ciphertext — only the metadata needed for retention,
-- integrity verification (checksum), and audit.
create table public.backup_archives (
    id                      uuid        primary key default public.gen_uuid(),
    tenant_id               uuid        not null references public.tenants(id) on delete cascade,
    archive_id_text         text        not null unique,                  -- globally unique archive identifier (matches IndexedDB key)
    file_name               text        not null,
    size_bytes              bigint      not null check (size_bytes >= 0),
    checksum_sha256         text        not null,                          -- hex SHA-256 of the ciphertext blob
    vault_location          text        not null check (vault_location in (
                                'indexeddb', 'local_drive', 'offsite_vault'
                            )),
    status                  text        not null default 'encrypted' check (status in (
                                'encrypted', 'restored', 'corrupted', 'purged'
                            )),
    retention_expires_at    timestamptz,                                     -- when the retention period ends (purge eligible after this)
    created_by              uuid,                                            -- user_profiles.id (no FK by convention)
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    restored_at             timestamptz,
    restored_by             uuid,                                            -- user_profiles.id (no FK by convention)
    purge_at                timestamptz,                                     -- scheduled purge time (set by retention scheduler)
    metadata                jsonb       not null default '{}'::jsonb        -- {schema_version, encryption_algo, kv_store_ref, ...}
);

create index backup_archives_tenant_created_idx on public.backup_archives (tenant_id, created_at desc);
create index backup_archives_tenant_status_idx on public.backup_archives (tenant_id, status, created_at desc);
create index backup_archives_vault_idx on public.backup_archives (tenant_id, vault_location, status);
create index backup_archives_purge_due_idx on public.backup_archives (tenant_id, purge_at) where purge_at is not null and status <> 'purged';
create index backup_archives_retention_idx on public.backup_archives (tenant_id, retention_expires_at) where retention_expires_at is not null and status <> 'purged';
create index backup_archives_metadata_gin_idx on public.backup_archives using gin (metadata jsonb_path_ops);

comment on table public.backup_archives is
  'Metadata for backup archives. Ciphertext stays in IndexedDB per plan §13.03 — Postgres stores ONLY metadata. NEVER store plaintext or ciphertext here.';
comment on column public.backup_archives.archive_id_text is 'Globally-unique archive identifier (matches the IndexedDB key). UNIQUE constraint spans all tenants.';
comment on column public.backup_archives.checksum_sha256 is 'Hex-encoded SHA-256 of the ciphertext blob. Used to detect corruption on restore.';
comment on column public.backup_archives.vault_location is 'Where the ciphertext lives: indexeddb (primary), local_drive (secondary copy), offsite_vault (tertiary).';
comment on column public.backup_archives.status is 'encrypted=at rest, restored=successfully restored, corrupted=checksum mismatch, purged=ciphertext deleted.';
comment on column public.backup_archives.retention_expires_at is 'When the retention period ends. After this date the archive is eligible for purge.';
comment on column public.backup_archives.purge_at is 'Scheduled purge timestamp. Set by the retention scheduler; the purge job picks up rows past this time.';
comment on column public.backup_archives.created_by is 'user_profiles.id of the admin who initiated the backup. No FK (convention).';
comment on column public.backup_archives.restored_by is 'user_profiles.id of the admin who restored from this archive. No FK (convention).';
comment on column public.backup_archives.metadata is 'JSON metadata: {schema_version, encryption_algo, kv_store_ref, source_app_version, ...}. GIN-indexed.';

-- ============================================================================
-- TRIGGERS — touch_updated_at on every table with updated_at
-- ============================================================================
create trigger calendar_events_touch_updated_at before update on public.calendar_events
    for each row execute function public.touch_updated_at();
create trigger notifications_touch_updated_at before update on public.notifications
    for each row execute function public.touch_updated_at();
create trigger backup_archives_touch_updated_at before update on public.backup_archives
    for each row execute function public.touch_updated_at();
