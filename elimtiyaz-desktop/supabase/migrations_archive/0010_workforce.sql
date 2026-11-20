-- ============================================================================
-- 0010_workforce.sql
-- ============================================================================
-- Workforce management: departments, shifts, schedules, task management,
-- workforce attendance (clock-in/out), leave requests, performance reviews,
-- in-app chat, and onboarding wizard state.
--
-- Per plan §10 (Workforce & HR):
--   - Departments group personnel (Administration, Teaching, Support, Medical)
--   - Shifts define reusable work-time templates with grace periods
--   - Schedules assign personnel to shifts on specific dates
--   - Tasks support multi-assignee (jsonb uuid[]), tags, priority, progress 0-100
--   - Workforce attendance is event-based (clock_in / break_start / break_end / clock_out)
--     with optional GPS coords for field staff
--   - Leave requests follow pending/approved/rejected/cancelled state machine
--   - Performance reviews are quarterly or annual, scored numeric(3,2)
--   - Chat channels: direct / group / department / announcement
--   - Onboarding tracks wizard step progress per personnel
--
-- Conventions (consistent with 0002–0009):
--   - `public.gen_uuid()` for PKs
--   - `tenant_id` NOT NULL FK → tenants(id) ON DELETE CASCADE
--   - `created_at`/`updated_at` timestamptz NOT NULL DEFAULT now()
--   - `public.touch_updated_at()` trigger on every table with `updated_at`
--   - Actor columns (created_by, author_id, recorded_by, reviewed_by) reference
--     user_profiles.id WITHOUT FK constraints (convention — avoids cascade
--     headaches when user_profiles are soft-deleted/restored)
--   - CHECK constraints for all enum-like text fields
--   - GIN indexes on jsonb columns and trigram indexes on searchable text
--
-- Scale assumptions (per plan §00):
--   - ~5,000 total users / ~300 DAU / ~50 peak concurrent
--   - Indexes below target these access patterns
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. departments — organizational units grouping personnel
-- ----------------------------------------------------------------------------
create table public.departments (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    code                text        not null,                              -- 'ADM', 'TCH', 'SUP', 'MED'
    name_fr             text        not null,                              -- 'Administration'
    label_ar            text,                                              -- 'الإدارة'
    color_hex           text        check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
    head_personnel_id   uuid        references public.personnel(id) on delete set null,
    description         text,
    sort_order          integer     not null default 0,
    is_active           boolean     not null default true,
    is_archived         boolean     not null default false,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (tenant_id, code)
);

create index departments_tenant_active_idx on public.departments (tenant_id, sort_order) where is_archived = false;
create index departments_head_idx on public.departments (head_personnel_id) where head_personnel_id is not null;
create index departments_trgm_idx on public.departments using gin (name_fr extensions.gin_trgm_ops, label_ar extensions.gin_trgm_ops);

comment on table public.departments is
  'Organizational units grouping personnel (Administration, Teaching, Support, Medical). Plan §10.02.';
comment on column public.departments.code is 'Short stable code (e.g. ADM, TCH, SUP, MED). Unique per tenant.';
comment on column public.departments.color_hex is 'Hex color (#RRGGBB) used in the UI for visual grouping.';
comment on column public.departments.head_personnel_id is 'Personnel responsible for the department. SET NULL if they leave.';
comment on column public.departments.is_archived is 'Soft-archive flag: archived departments are hidden from new assignments but kept for history.';

-- Backfill the FK on personnel.department_id declared (without FK) in 0009.
alter table public.personnel
    add constraint personnel_department_fk
    foreign key (department_id) references public.departments(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 2. shifts — reusable work-time templates
-- ----------------------------------------------------------------------------
create table public.shifts (
    id                      uuid        primary key default public.gen_uuid(),
    tenant_id               uuid        not null references public.tenants(id) on delete cascade,
    code                    text        not null,                          -- 'MORNING', 'AFTERNOON', 'NIGHT'
    name                    text        not null,
    start_time              time        not null,
    end_time                time        not null,
    grace_period_minutes    integer     not null default 0 check (grace_period_minutes >= 0),
    color_hex               text        check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
    is_active               boolean     not null default true,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    unique (tenant_id, code),
    check (end_time > start_time)
);

create index shifts_tenant_active_idx on public.shifts (tenant_id, code) where is_active = true;

comment on table public.shifts is
  'Reusable work-time templates with grace period for late clock-ins. Plan §10.03.';
comment on column public.shifts.grace_period_minutes is 'Tolerance window (minutes) before a clock-in is flagged late.';
comment on column public.shifts.start_time is 'Local-time start of shift (no timezone — interpreted in tenant.timezone).';
comment on column public.shifts.end_time is 'Local-time end of shift. Must be later than start_time.';

-- ----------------------------------------------------------------------------
-- 3. schedules — per-day shift assignment for personnel
-- ----------------------------------------------------------------------------
create table public.schedules (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    personnel_id    uuid        not null references public.personnel(id) on delete cascade,
    shift_id        uuid        references public.shifts(id) on delete set null,
    date            date        not null,
    start_time      time,                                           -- overrides shift.start_time if set
    end_time        time,                                           -- overrides shift.end_time if set
    note            text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, personnel_id, date)
);

create index schedules_personnel_date_idx on public.schedules (personnel_id, date);
create index schedules_tenant_date_idx on public.schedules (tenant_id, date);
create index schedules_shift_idx on public.schedules (shift_id) where shift_id is not null;

comment on table public.schedules is
  'Daily shift assignment per personnel. One row per personnel per date (uniqueness enforced). Plan §10.04.';
comment on column public.schedules.start_time is 'Optional override of shift.start_time for this specific day.';
comment on column public.schedules.end_time is 'Optional override of shift.end_time for this specific day.';

-- ----------------------------------------------------------------------------
-- 4. tasks — multi-assignee task management
-- ----------------------------------------------------------------------------
create table public.tasks (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    title           text        not null check (length(trim(title)) >= 1),
    description     text,
    status          text        not null default 'pending' check (status in (
                        'pending', 'assigned', 'in_progress', 'blocked',
                        'completed', 'cancelled'
                    )),
    priority        text        not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
    department_id   uuid        references public.departments(id) on delete set null,
    assignee_ids    jsonb       not null default '[]'::jsonb,             -- array of user_profiles.id (uuid strings)
    due_date        date,
    completed_at    timestamptz,
    progress        integer     not null default 0 check (progress >= 0 and progress <= 100),
    tags            text[]      not null default '{}',
    created_by      uuid,                                               -- user_profiles.id (no FK by convention)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index tasks_tenant_status_idx on public.tasks (tenant_id, status, due_date);
create index tasks_tenant_priority_idx on public.tasks (tenant_id, priority, due_date);
create index tasks_department_idx on public.tasks (department_id) where department_id is not null;
create index tasks_assignees_gin_idx on public.tasks using gin (assignee_ids jsonb_path_ops);
create index tasks_tags_gin_idx on public.tasks using gin (tags);
create index tasks_due_date_idx on public.tasks (due_date) where due_date is not null and status not in ('completed', 'cancelled');
create index tasks_trgm_idx on public.tasks using gin (title extensions.gin_trgm_ops);

comment on table public.tasks is
  'Multi-assignee task management. assignee_ids is a jsonb array of user_profiles.id strings. Plan §10.05.';
comment on column public.tasks.assignee_ids is 'JSON array of user_profiles.id UUIDs (as strings). GIN-indexed for membership queries.';
comment on column public.tasks.progress is 'Completion percentage 0-100. CHECK constraint enforces range.';
comment on column public.tasks.tags is 'Free-form tag array for filtering. GIN-indexed.';
comment on column public.tasks.created_by is 'user_profiles.id of the task creator. No FK (convention).';

-- ----------------------------------------------------------------------------
-- 5. task_comments — discussion thread on a task
-- ----------------------------------------------------------------------------
create table public.task_comments (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    task_id         uuid        not null references public.tasks(id) on delete cascade,
    author_id       uuid        not null,                                 -- user_profiles.id (no FK by convention)
    body            text        not null check (length(trim(body)) >= 1),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);
create index task_comments_author_idx on public.task_comments (author_id, created_at desc);

comment on table public.task_comments is
  'Threaded discussion on a task. Cascade-deleted with the parent task. Plan §10.05.';
comment on column public.task_comments.author_id is 'user_profiles.id of the commenter. No FK (convention).';

-- ----------------------------------------------------------------------------
-- 6. task_attachments — files attached to a task (stored in Supabase Storage)
-- ----------------------------------------------------------------------------
create table public.task_attachments (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    task_id         uuid        not null references public.tasks(id) on delete cascade,
    file_name       text        not null,
    storage_path    text        not null,                                 -- path under bucket 'task-attachments'
    mime_type       text,
    size_bytes      bigint      check (size_bytes is null or size_bytes >= 0),
    uploaded_by     uuid        not null,                                 -- user_profiles.id (no FK by convention)
    uploaded_at     timestamptz not null default now(),
    created_at      timestamptz not null default now()
);

create index task_attachments_task_idx on public.task_attachments (task_id, uploaded_at desc);

comment on table public.task_attachments is
  'Files attached to a task. Blob stored in Supabase Storage; metadata in this table. Plan §10.05.';
comment on column public.task_attachments.storage_path is 'Storage path under the task-attachments bucket. Cascade-deleted with task.';

-- ----------------------------------------------------------------------------
-- 7. workforce_attendance_events — clock-in / break / clock-out events
-- ----------------------------------------------------------------------------
-- NOTE: column named `event_at` (not `timestamp`) to avoid SQL keyword clash.
create table public.workforce_attendance_events (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    personnel_id    uuid        not null references public.personnel(id) on delete cascade,
    event_type      text        not null check (event_type in (
                        'clock_in', 'break_start', 'break_end', 'clock_out'
                    )),
    event_at        timestamptz not null default now(),
    latitude        numeric(9,6),                                         -- GPS coord for field staff
    longitude       numeric(9,6),
    note            text,
    recorded_by     uuid,                                                 -- user_profiles.id (no FK by convention)
    created_at      timestamptz not null default now()
);

create index workforce_attendance_events_personnel_idx on public.workforce_attendance_events (personnel_id, event_at desc);
create index workforce_attendance_events_tenant_day_idx on public.workforce_attendance_events (tenant_id, event_at desc);

comment on table public.workforce_attendance_events is
  'Append-only clock-in/out event stream. event_at replaces the reserved word "timestamp". Plan §10.06.';
comment on column public.workforce_attendance_events.event_at is 'When the event occurred (renamed from "timestamp" to avoid SQL keyword clash).';
comment on column public.workforce_attendance_events.latitude is 'Optional GPS latitude (numeric(9,6) gives sub-meter precision).';
comment on column public.workforce_attendance_events.recorded_by is 'user_profiles.id of whoever recorded the event (typically the personnel themselves via their account, or an admin override).';

-- ----------------------------------------------------------------------------
-- 8. leave_requests — paid/unpaid leave workflow
-- ----------------------------------------------------------------------------
create table public.leave_requests (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    personnel_id    uuid        not null references public.personnel(id) on delete cascade,
    leave_type      text        not null check (leave_type in (
                        'annual', 'sick', 'personal', 'unpaid',
                        'maternity', 'paternity'
                    )),
    start_date      date        not null,
    end_date        date        not null,
    reason          text,
    status          text        not null default 'pending' check (status in (
                        'pending', 'approved', 'rejected', 'cancelled'
                    )),
    reviewed_by     uuid,                                               -- user_profiles.id (no FK by convention)
    reviewed_at     timestamptz,
    decision_note   text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    check (end_date >= start_date)
);

create index leave_requests_personnel_idx on public.leave_requests (personnel_id, start_date desc);
create index leave_requests_tenant_status_idx on public.leave_requests (tenant_id, status, start_date);
create index leave_requests_pending_idx on public.leave_requests (tenant_id, start_date) where status = 'pending';

comment on table public.leave_requests is
  'Leave request workflow: pending → approved/rejected/cancelled. Plan §10.07.';
comment on column public.leave_requests.leave_type is 'Leave category. Algerian labor law categories: annual, sick, personal, unpaid, maternity, paternity.';
comment on column public.leave_requests.reviewed_by is 'user_profiles.id of the manager/admin who reviewed. No FK (convention).';
comment on column public.leave_requests.decision_note is 'Mandatory when status = rejected (enforced by app layer).';

-- ----------------------------------------------------------------------------
-- 9. performance_reviews — quarterly / annual staff reviews
-- ----------------------------------------------------------------------------
create table public.performance_reviews (
    id                      uuid        primary key default public.gen_uuid(),
    tenant_id               uuid        not null references public.tenants(id) on delete cascade,
    personnel_id            uuid        not null references public.personnel(id) on delete cascade,
    review_period           text        not null check (review_period in ('q1', 'q2', 'q3', 'q4', 'annual')),
    reviewer_id             uuid        references public.personnel(id) on delete set null,
    score                   numeric(3,2) check (score is null or (score >= 0 and score <= 10)),
    strengths               text,
    areas_for_improvement   text,
    goals                   text,
    review_date             date        not null default current_date,
    status                  text        not null default 'draft' check (status in (
                                'draft', 'published', 'acknowledged'
                            )),
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

create index performance_reviews_personnel_idx on public.performance_reviews (personnel_id, review_date desc);
create index performance_reviews_reviewer_idx on public.performance_reviews (reviewer_id) where reviewer_id is not null;
create index performance_reviews_tenant_period_idx on public.performance_reviews (tenant_id, review_period, review_date desc);

comment on table public.performance_reviews is
  'Quarterly or annual performance reviews. Score scale 0.00–10.00 (numeric(3,2)). Plan §10.08.';
comment on column public.performance_reviews.review_period is 'q1/q2/q3/q4 for quarterly reviews, annual for year-end.';
comment on column public.performance_reviews.reviewer_id is 'personnel.id of the reviewer (a staff member). SET NULL if they leave.';
comment on column public.performance_reviews.score is 'Numeric score 0.00–10.00 with 2 decimals. NULL until review is finalized.';

-- ----------------------------------------------------------------------------
-- 10. chat_channels — direct / group / department / announcement channels
-- ----------------------------------------------------------------------------
create table public.chat_channels (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    code            text        not null,                                 -- stable identifier
    name            text        not null,
    channel_type    text        not null check (channel_type in (
                        'direct', 'group', 'department', 'announcement'
                    )),
    member_ids      uuid[]      not null default '{}',                    -- array of user_profiles.id
    created_by      uuid,                                                 -- user_profiles.id (no FK by convention)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, code)
);

create index chat_channels_tenant_type_idx on public.chat_channels (tenant_id, channel_type);
create index chat_channels_members_gin_idx on public.chat_channels using gin (member_ids);

comment on table public.chat_channels is
  'In-app chat channels. member_ids is a uuid[] of user_profiles.id, GIN-indexed for membership queries. Plan §10.09.';
comment on column public.chat_channels.channel_type is 'direct=1:1, group=ad-hoc multi-user, department=scoped to a department, announcement=read-only broadcast.';
comment on column public.chat_channels.member_ids is 'Array of user_profiles.id. For announcement channels, members are recipients (only channel owners post).';
comment on column public.chat_channels.created_by is 'user_profiles.id of the channel creator. No FK (convention).';

-- ----------------------------------------------------------------------------
-- 11. chat_messages — individual messages in a channel
-- ----------------------------------------------------------------------------
create table public.chat_messages (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    channel_id          uuid        not null references public.chat_channels(id) on delete cascade,
    author_id           uuid        not null,                             -- user_profiles.id (no FK by convention)
    body                text        not null default '',
    edited_at           timestamptz,
    edited_by           uuid,                                             -- user_profiles.id (no FK by convention)
    deleted_at          timestamptz,                                      -- soft delete
    parent_message_id   uuid        references public.chat_messages(id) on delete set null,
    read_by             jsonb       not null default '[]'::jsonb,         -- [{user_id, read_at}]
    attachments         jsonb       not null default '[]'::jsonb,         -- [{file_name, storage_path, mime_type, size_bytes}]
    sent_at             timestamptz not null default now(),
    created_at          timestamptz not null default now()
);

create index chat_messages_channel_sent_idx on public.chat_messages (channel_id, sent_at desc);
create index chat_messages_author_idx on public.chat_messages (author_id, sent_at desc);
create index chat_messages_parent_idx on public.chat_messages (parent_message_id) where parent_message_id is not null;
create index chat_messages_unread_gin_idx on public.chat_messages using gin (read_by jsonb_path_ops);
create index chat_messages_attachments_gin_idx on public.chat_messages using gin (attachments jsonb_path_ops) where attachments <> '[]'::jsonb;

comment on table public.chat_messages is
  'Messages in a chat channel. Soft-deleted via deleted_at. Threaded via parent_message_id. Plan §10.09.';
comment on column public.chat_messages.author_id is 'user_profiles.id of the sender. No FK (convention).';
comment on column public.chat_messages.edited_by is 'user_profiles.id of the last editor. NULL if never edited.';
comment on column public.chat_messages.parent_message_id is 'Self-FK for threaded replies. SET NULL on parent delete (preserves reply text).';
comment on column public.chat_messages.read_by is 'JSON array of {user_id: uuid, read_at: timestamptz} objects tracking read receipts.';
comment on column public.chat_messages.attachments is 'JSON array of attachment metadata objects referencing Supabase Storage paths.';

-- ----------------------------------------------------------------------------
-- 12. onboarding_states — tracks onboarding wizard progress per personnel
-- ----------------------------------------------------------------------------
create table public.onboarding_states (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    personnel_id        uuid        not null references public.personnel(id) on delete cascade,
    current_step        integer     not null default 0 check (current_step >= 0),
    completed_steps     integer[]   not null default '{}',
    started_at          timestamptz not null default now(),
    completed_at        timestamptz,
    data_json           jsonb       not null default '{}'::jsonb,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (tenant_id, personnel_id)
);

create index onboarding_states_pending_idx on public.onboarding_states (tenant_id, started_at) where completed_at is null;
create index onboarding_states_data_gin_idx on public.onboarding_states using gin (data_json jsonb_path_ops);

comment on table public.onboarding_states is
  'Onboarding wizard progress per personnel. One row per personnel (uniqueness enforced). Plan §10.10.';
comment on column public.onboarding_states.current_step is 'Zero-based index of the current wizard step.';
comment on column public.onboarding_states.completed_steps is 'Array of step indices the user has completed (allows non-linear navigation).';
comment on column public.onboarding_states.completed_at is 'Set when the user finishes the wizard. NULL means in-progress.';
comment on column public.onboarding_states.data_json is 'Free-form JSON payload capturing partial inputs (e.g. draft profile fields) between wizard steps.';

-- ----------------------------------------------------------------------------
-- 13. Triggers — touch_updated_at on every table with updated_at
-- ----------------------------------------------------------------------------
create trigger departments_touch_updated_at before update on public.departments
    for each row execute function public.touch_updated_at();
create trigger shifts_touch_updated_at before update on public.shifts
    for each row execute function public.touch_updated_at();
create trigger schedules_touch_updated_at before update on public.schedules
    for each row execute function public.touch_updated_at();
create trigger tasks_touch_updated_at before update on public.tasks
    for each row execute function public.touch_updated_at();
create trigger task_comments_touch_updated_at before update on public.task_comments
    for each row execute function public.touch_updated_at();
create trigger leave_requests_touch_updated_at before update on public.leave_requests
    for each row execute function public.touch_updated_at();
create trigger performance_reviews_touch_updated_at before update on public.performance_reviews
    for each row execute function public.touch_updated_at();
create trigger chat_channels_touch_updated_at before update on public.chat_channels
    for each row execute function public.touch_updated_at();
create trigger onboarding_states_touch_updated_at before update on public.onboarding_states
    for each row execute function public.touch_updated_at();
-- NOTE: workforce_attendance_events, task_attachments, chat_messages are
-- append-only / soft-delete tables without updated_at — no trigger.
