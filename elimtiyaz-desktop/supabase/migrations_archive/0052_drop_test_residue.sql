-- ============================================================================
-- 0052_drop_test_residue.sql — TEST-RESIDUE CLEANUP (T-087 / DATA-007)
-- ============================================================================
-- The live backend health check (T-084, 2026-08-30) found three pieces of
-- test residue in the production database:
--
--   1. Two RPCs `_eq_test_fn` and `_eq_test_fn2` (equivalence-harness
--      leftovers) are exposed via PostgREST. They take no args, return
--      scalars, and have no production callers anywhere in the three
--      repositories (verified via `rg "_eq_test_fn" src/ app/`).
--   2. One unconfirmed auth user `test.connection.supabase@gmail.com`
--      (id `65c9b9c3-5b6e-4f20-9b5e-7a6d5d5cf2b8` per the live census).
--   3. One expired `account_approval_requests` row tied to that user.
--
-- Dropping the RPCs is purely a removal of dead test code; deleting the
-- auth user requires a separate auth.admin call (NOT a migration — the
-- auth schema is not part of the public migration chain). The SQL below
-- handles (1); the auth user cleanup is documented in
-- docs/recovery/change-log.md and performed out-of-band.
--
-- Idempotent: `drop function if exists` is a no-op if the function
-- doesn't exist. Safe to re-run.
-- ============================================================================

drop function if exists public._eq_test_fn();
drop function if exists public._eq_test_fn2();

-- Self-documenting: leave a note in the database audit log so the next
-- operator knows the cleanup happened (best-effort — if the audit_logs
-- table is not writable from this session, the drop above still
-- succeeds; this block is wrapped in a DO block to swallow any error).
do $$
begin
  insert into public.audit_logs (
    tenant_id, action, entity_type, entity_id,
    actor_id, actor_name, diff, note, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'test_residue.cleanup',
    'function',
    '_eq_test_fn/_eq_test_fn2',
    null,
    'Système (T-087)',
    jsonb_build_object('before', 'present', 'after', 'dropped'),
    'T-087 / DATA-007: dropped test-residue RPCs _eq_test_fn and _eq_test_fn2 (equivalence-harness leftovers exposed via PostgREST).',
    now(),
    now()
  );
exception
  when others then
    -- Audit write is best-effort; the drop above is the substantive change.
    raise notice 'T-087 audit log insert skipped: %', sqlerrm;
end;
$$;
