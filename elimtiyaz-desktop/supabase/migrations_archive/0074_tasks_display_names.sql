-- ============================================================================
-- 0074 — Tasks: created_by_name + task_comments.author_name (T-180 / T-047 port #5)
-- Task: T-180 (session 28, 2026-09-05)
--
-- WHAT:
--   1. Adds `created_by_name text` (nullable) to `tasks`.
--   2. Adds `author_name text` (nullable) to `task_comments`.
--
-- WHY:
--   The Task domain contract (workforce.ts) carries `createdByName` and
--   TaskComment.authorName (rendered by the management/dashboards UI).
--   `tasks.created_by` and `task_comments.author_id` are bare uuids with NO
--   FK to user_profiles (the 0010 convention), so a PostgREST embed cannot
--   resolve the display names. The 0070 (calendar assigned_to_*) / 0072
--   (leave_requests reviewed_by_name) precedent applies: stamp the display
--   name at write time.
--
-- SAFETY / IDEMPOTENCE:
--   - Pure additive DDL (ADD COLUMN IF NOT EXISTS) — safe to re-run.
--   - Nullable columns: pre-0074 rows keep NULL → the repository falls back
--     to the caller-provided name (""). The tables are empty live (the
--     desktop mock was the only writer).
--   - RLS untouched (0019: tasks select/update for managers + creators +
--     assignees; comments insert author-verified; attachments tenant-scoped).
-- ============================================================================

alter table public.tasks
    add column if not exists created_by_name text;

comment on column public.tasks.created_by_name is
    'Display name of the task creator (createdByName in the desktop domain contract). created_by has no FK to user_profiles, so the name cannot be joined. Added by 0074 (T-180).';

alter table public.task_comments
    add column if not exists author_name text;

comment on column public.task_comments.author_name is
    'Display name of the comment author (TaskComment.authorName in the desktop domain contract). author_id has no FK to user_profiles. Added by 0074 (T-180).';

-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0074_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0074', '{0074_tasks_display_names.sql}', 'tasks_display_names')
on conflict (version) do nothing;
