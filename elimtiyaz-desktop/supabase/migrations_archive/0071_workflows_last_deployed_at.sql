-- ============================================================================
-- 0071 — Workflows: last_deployed_at column (T-176 / T-047 port #2)
-- Task: T-176 (session 28, 2026-09-05)
--
-- WHAT: Adds `last_deployed_at timestamptz` to `public.workflows`.
--
-- WHY: the T-047 workflows port needs a lossless mapping of the desktop
--   domain contract (`domain/model/workflow.ts` → `Workflow.lastDeployedAt`,
--   rendered by workflow-page.tsx as "Déployé <relative>" / "Jamais déployé").
--   The table has `last_executed_at` (a different concept — the last RUN,
--   maintained by the workflow-execute EF) but nothing for the publish
--   timestamp. Without this column the port would silently render
--   "Jamais déployé" for every deployed workflow.
--
-- SAFETY / IDEMPOTENCE:
--   - Pure additive DDL (ADD COLUMN IF NOT EXISTS) — safe to re-run.
--   - Nullable column: pre-0071 rows keep NULL = "Jamais déployé" (correct —
--     the live table has never been written to; the desktop mock was the
--     only writer).
--   - deploy() in the port writes this column together with
--     status='published' in ONE UPDATE.
--   - RLS untouched (workflows_admin FOR ALL, super_admin — migration 0019).
-- ============================================================================

alter table public.workflows
  add column if not exists last_deployed_at timestamptz;

comment on column public.workflows.last_deployed_at is
  'When the workflow was last published (deployed). Maintained by the desktop deploy() write path. Distinct from last_executed_at (the last RUN — maintained by the workflow-execute EF). Added by 0071 (T-176).';

-- Registration row (T-091/MIG-TOKENS pattern — the Management-API apply
-- script scripts/apply_0071_live.sh embeds this statement so the DDL and the
-- registration land in ONE atomic transaction; ON CONFLICT keeps it
-- idempotent.)
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0071', '{0071_workflows_last_deployed_at.sql}', 'workflows_last_deployed_at')
on conflict (version) do nothing;
