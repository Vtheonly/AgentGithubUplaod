-- ============================================================================
-- 0145: WORKFORCE-512 — the role-scoped tasks_delete policy
--       (T-501, 152nd session, 2026-10-11)
-- ============================================================================
--
-- THE DEFECT (T-500 live proof, G3/G4, 2026-10-10):
--
--   No `tasks_delete` policy exists anywhere in the migration chain
--   (0019 defines tasks select/insert/update ONLY). Under RLS
--   default-deny, a PostgREST DELETE affects ZERO rows and returns 204 —
--   silently, for EVERY role including super_admin. The task-detail
--   drawer's confirm modal closed, the success toast fired, and the task
--   SURVIVED (live-proven: the row re-read still exists).
--
-- THE DECISION (the audit's "decide the model" resolved):
--
--   The repository's contract is a HARD delete (mock parity; task_comments
--   + task_attachments cascade server-side) — so the policy matches the
--   repo rather than the repo being rewritten onto a status model. The
--   scope mirrors the tasks_update policy's authority union exactly
--   (0019): super_admin / manager (tenant-scoped), OR the task's creator.
--   Assignees can update a task's status (0019) but can NOT delete it —
--   deletion authority follows ownership, not assignment.
--
-- THE CLIENT HALF (already landed, T-501):
--
--   supabase-task-repository.deleteTask now requests
--   `Prefer: return=representation` (.delete().select()) and surfaces a
--   0-row delete as ERR_FORBIDDEN (« La suppression a été refusée — la
--   tâche n'a PAS été supprimée »); task-detail-drawer.handleDelete
--   carries the error branch. Before this migration is applied live, the
--   honest-refusal path is what users see; after it, super_admin /
--   manager / creator deletes succeed for real.
--
-- IDEMPOTENCY: `drop policy if exists` first — safe to re-apply.
--
-- OWNER-GATED LIVE APPLICATION (§15.77a): no DDL channel this session
-- (dead sbp_ token). Apply with a fresh token via
-- scripts/apply_0145_live.sh, then verify with the T-500 G3/G4 probe
-- inverted: the super_admin DELETE must return the deleted row (1 row
-- affected) and the task must be GONE on re-read; a parent-role DELETE
-- must still be a 0-row no-op (the policy's role union excludes parents).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. The role-scoped delete policy (mirrors tasks_update's authority union)
-- ----------------------------------------------------------------------------
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
    for delete to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'manager'])
            or created_by = public.current_user_profile_id()
        )
    );

comment on policy tasks_delete on public.tasks is
    'WORKFORCE-512 (0145): role-scoped hard delete — super_admin/manager (tenant-scoped) or the task creator; assignees can update status but not delete (mirrors tasks_update''s authority union).';

-- ----------------------------------------------------------------------------
-- §2. Registration (T-091/MIG-TOKENS pattern)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0145', '{0145_tasks_delete_policy.sql}', 'tasks_delete_policy')
on conflict (version) do nothing;
