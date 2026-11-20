-- ============================================================================
-- 0142_onboarding_tenant_singleton.sql
-- ============================================================================
-- T-483 (140th session 2026-10-04) — the onboarding persistence port's model
-- ruling: the desktop's onboarding wizard state (§10-config: departments /
-- roles / employees / admins / managers / working-hours / shift-types /
-- permissions — the TENANT's first-run configuration) is a TENANT SINGLETON,
-- while 0010's `onboarding_states` is per-personnel (plan §10.10 — the
-- per-employee onboarding progress). The T-477 audit registered the mismatch
-- as "persists nothing — needs a model decision"; the owner's 140th-session
-- "fix what was listed in this audit" mandate supplies the decision.
--
-- THE RULING (recorded in the repository's doc comment too): BOTH models
-- are kept. The tenant wizard persists as the table's `personnel_id IS
-- NULL` row (one per tenant — the new partial unique index enforces it);
-- the per-personnel semantics (personnel_id NOT NULL + the 0010 unique
-- (tenant_id, personnel_id)) stay untouched for the future employee-level
-- onboarding. The 0019 RLS posture already covers the singleton row:
--   - onboarding_states_select: staff quartet OR own personnel — a NULL
--     personnel_id row matches only the staff quartet arm (correct: the
--     tenant wizard is admin-visible);
--   - onboarding_states_admin (for all, staff quartet): covers the
--     singleton row's reads AND writes.
--
-- Re-run safety: `drop not null` is idempotent by nature (a second run is a
-- no-op); the index uses IF NOT EXISTS; the registration on-conflicts.

-- ----------------------------------------------------------------------------
-- §1. The tenant-singleton row: personnel_id becomes nullable
-- ----------------------------------------------------------------------------
alter table public.onboarding_states
    alter column personnel_id drop not null;

-- ----------------------------------------------------------------------------
-- §2. One tenant-singleton row per tenant (the partial unique index)
-- ----------------------------------------------------------------------------
create unique index if not exists onboarding_states_tenant_singleton_idx
    on public.onboarding_states (tenant_id)
    where personnel_id is null;

comment on index public.onboarding_states_tenant_singleton_idx is
    'T-483 (0142): the tenant-level onboarding wizard state — exactly ONE row per tenant with personnel_id IS NULL (the per-personnel rows keep the 0010 (tenant_id, personnel_id) unique).';

comment on column public.onboarding_states.personnel_id is
    'T-483 (0142): NULL = the TENANT-singleton wizard row (the desktop OnboardingRepository''s storage); non-NULL = the 0010 per-employee onboarding progress (plan §10.10).';

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0142', '{0142_onboarding_tenant_singleton.sql}', 'onboarding_tenant_singleton')
on conflict (version) do nothing;
