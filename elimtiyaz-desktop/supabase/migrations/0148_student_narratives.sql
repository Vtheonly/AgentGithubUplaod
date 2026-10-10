-- ============================================================================
-- 0148: GRADE-103 — the student_narratives table: the report-card narrative
--       persistence target (T-502, 153rd session, 2026-10-11)
-- ============================================================================
--
-- THE DEFECT (T-500 live+code proof, 2026-10-10):
--
--   The narrative generator's « Approuver » flow is persistence-HOLLOW:
--   the toast says « Narratif enregistré sur la fiche élève » but the ONLY
--   write is an audit_logs row (AiNarrativeApproved, 200-char preview).
--   The narrative text is retrievable from NOWHERE once the modal closes —
--   student_academic_histories.narrative is written only by the promotion
--   payload (which always passes NULL), and no other column/table exists.
--
-- WHY A DEDICATED TABLE (not student_academic_histories):
--
--   The histories table is the APPEND-ONLY year-end promotion record:
--   cycle/grade_code/grade_year/gpa/decision are NOT NULL — a mid-year
--   narrative write would have to fabricate a promotion decision that has
--   not happened. A report narrative is a LIVING document (regenerated,
--   edited, re-approved at every term) — its own table, keyed on the
--   active academic year, upserted in place. The promotion flow's
--   narrative field keeps its year-end semantics untouched.
--
-- THE CONTRACT:
--   * one narrative per (tenant_id, student_id, academic_year) — upsert
--     in place (re-approval replaces the text; the audit trail keeps the
--     approval history).
--   * approved_by/approved_by_name/approved_at — the approver trail.
--   * RLS: tenant-scoped SELECT for authenticated members (a narrative is
--     student-record data — the same visibility class as classes/grades);
--     INSERT/UPDATE for the staff writer family (super_admin / manager /
--     support_staff / teacher — the roles allowed to approve a narrative
--     in the UI: UseAI permission holders + super_admin).
--
-- IDEMPOTENCY: create table if not exists + drop-policy-first — safe to
-- re-apply.
--
-- VERIFICATION (post-apply): scripts/t502_postapply_verify2.sql — the
-- catalog census + the RLS matrix (staff upsert PASS, parent upsert
-- REFUSED, tenant isolation).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. The table
-- ----------------------------------------------------------------------------
create table if not exists public.student_narratives (
    id uuid primary key default public.gen_uuid(),
    tenant_id uuid not null,
    student_id uuid not null references public.students(id) on delete cascade,
    -- The academic year CODE (e.g. '2025-2026') — the same key space as
    -- student_academic_histories.academic_year and classes.academic_year.
    academic_year text not null,
    narrative text not null,
    approved_by uuid,
    approved_by_name text,
    approved_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_student_narrative unique (tenant_id, student_id, academic_year)
);

create index if not exists idx_student_narratives_student
    on public.student_narratives (tenant_id, student_id);

-- ----------------------------------------------------------------------------
-- §2. RLS
-- ----------------------------------------------------------------------------
alter table public.student_narratives enable row level security;

drop policy if exists student_narratives_select on public.student_narratives;
create policy student_narratives_select on public.student_narratives
    for select to authenticated
    using (tenant_id = public.current_tenant_id());

drop policy if exists student_narratives_insert on public.student_narratives;
create policy student_narratives_insert on public.student_narratives
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        -- GRADE-103 (0148): the narrative writers — the staff family that
        -- holds the UseAI permission in the UI (teacher + the admin trio);
        -- the super_admin arm is the global-admin fallback.
        and public.has_any_role(array['super_admin', 'manager', 'support_staff', 'teacher'])
    );

drop policy if exists student_narratives_update on public.student_narratives;
create policy student_narratives_update on public.student_narratives
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'manager', 'support_staff', 'teacher'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'manager', 'support_staff', 'teacher'])
    );

comment on table public.student_narratives is
    'GRADE-103 (0148): the year-keyed report-card narrative store — one per (tenant, student, academic_year), upserted on re-approval. Dedicated table (NOT student_academic_histories): the promotion record''s NOT NULL decision fields would force a fabricated mid-year decision.';

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0148', '{0148_student_narratives.sql}', 'student_narratives')
on conflict (version) do nothing;
