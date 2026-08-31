-- ============================================================================
-- scripts/verify_t-030.sql — T-030 live verification (migration 0060)
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; — re-runnable,
-- no live mutation persists. Results land in a temp table.
--
-- Checks (happy path + regression paths), all under a SIMULATED staff JWT
-- (request.jwt.claims = the live admin profile) unless stated:
--   C1  migration 0060 is registered in schema_migrations
--   C2  unregister_fcm_token exists with the expected signature
--   C3  register_fcm_token still verifies the caller owns p_user_id (SEC-106
--       regression path: registering for ANOTHER user's profile → 42501)
--   C4  PUSH-102 fix: registering a token held by an ACTIVE row of ANOTHER
--       user → 42501 (the silent user_id re-point is dead)
--   C5  PUSH-102 transfer: registering a token held by an INACTIVE row of
--       another user (they signed out) → allowed, row transferred + an
--       audited 'device_token.transfer' entry exists
--   C6  same-user re-registration still reactivates (no error, is_active
--       back to true) + a 'device_token.register' audit entry
--   C7  unregister_fcm_token retires the caller's own row (is_active=false)
--   C8  unregister_fcm_token is idempotent for unknown tokens (returns NULL)
--   C9  register audit coverage: a register produced an audit_logs row
-- ============================================================================

BEGIN;

CREATE TEMP TABLE t030_results (check_id text, ok boolean, detail text);

-- C1: registration
INSERT INTO t030_results
SELECT 'C1-registered', COUNT(*) = 1,
       'schema_migrations rows=' || COUNT(*)
  FROM supabase_migrations.schema_migrations
 WHERE version = '0060';

-- C2: signature
INSERT INTO t030_results
SELECT 'C2-unregister-present', COUNT(*) = 1,
       'overloads=' || COUNT(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'unregister_fcm_token'
   AND pg_get_function_arguments(p.oid) = 'p_token text';

-- Use the two EXISTING live profiles (verified present this session):
--   USER A (admin)  = dac9c821-22a3-4edb-857c-6c4414199d2e (auth 0a3597e7…)
--   USER B (residue)= 80aafabb-d61c-462a-a0ce-e587c483be4c (auth ef2d7159…)
-- Seed two throwaway device_tokens rows owned by A inside the transaction
-- (rolled back at the end).
INSERT INTO public.device_tokens (id, tenant_id, user_id, token, platform, is_active)
VALUES
  ('bb030000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'dac9c821-22a3-4edb-857c-6c4414199d2e', 't030-token-active', 'android', true),
  ('bb030000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'dac9c821-22a3-4edb-857c-6c4414199d2e', 't030-token-inactive', 'android', false)
ON CONFLICT (id) DO NOTHING;

-- C3: SEC-106 regression — caller (admin profile) registering for user A's
-- profile → 42501. Simulated JWT = the live admin (0a3597e7…), who is NOT
-- (admin), who is NOT the simulated caller B.
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        PERFORM public.register_fcm_token(
            '80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid,
            't030-foreign-token', 'android');
        INSERT INTO t030_results VALUES ('C3-caller-verification', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t030_results
        VALUES ('C3-caller-verification', (SQLERRM LIKE '%caller does not own user profile%'),
                'raised: ' || SQLERRM);
    END;
END $$;

-- C4: PUSH-102 — the ACTIVE-conflict guard. Caller = user B registering the
-- token owned by user A's ACTIVE row → 42501.
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "ef2d7159-1a99-4351-ba2d-10ac860e34c0", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        PERFORM public.register_fcm_token(
            '80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid,
            't030-token-active', 'android');
        INSERT INTO t030_results VALUES ('C4-active-conflict-rejected', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t030_results
        VALUES ('C4-active-conflict-rejected', (SQLERRM LIKE '%ACTIVE device of user%'),
                'raised: ' || SQLERRM);
    END;
END $$;

-- C5: PUSH-102 — the audited transfer. User B registers the INACTIVE token
-- previously owned by A → allowed + audit entry.
DO $$
DECLARE
    v_audit_count int;
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "ef2d7159-1a99-4351-ba2d-10ac860e34c0", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        PERFORM public.register_fcm_token(
            '80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid,
            't030-token-inactive', 'android');
        SELECT COUNT(*) INTO v_audit_count
          FROM public.audit_logs
         WHERE action = 'device_token.transfer'
           AND entity_id = (SELECT id FROM public.device_tokens WHERE token = 't030-token-inactive');
        INSERT INTO t030_results
        VALUES ('C5-transfer-audited',
                v_audit_count = 1
                AND (SELECT user_id FROM public.device_tokens WHERE token = 't030-token-inactive')
                    = '80aafabb-d61c-462a-a0ce-e587c483be4c',
                'transfer audit rows=' || v_audit_count);
    EXCEPTION WHEN others THEN
        INSERT INTO t030_results
        VALUES ('C5-transfer-audited', false, 'raised: ' || SQLERRM);
    END;
END $$;

-- C6: same-user re-registration reactivates + register audit entry.
DO $$
DECLARE
    v_audit_count int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    -- Give the live admin profile the seeded token row's ownership for this tx.
    UPDATE public.device_tokens
       SET user_id = (SELECT id FROM public.user_profiles WHERE auth_user_id = '0a3597e7-9681-48b1-bd32-0360c7981d1e' LIMIT 1),
           is_active = false
     WHERE token = 't030-token-inactive';
    PERFORM public.register_fcm_token(
        (SELECT id FROM public.user_profiles WHERE auth_user_id = '0a3597e7-9681-48b1-bd32-0360c7981d1e' LIMIT 1),
        't030-token-inactive', 'web');
    SELECT COUNT(*) INTO v_audit_count
      FROM public.audit_logs
     WHERE action = 'device_token.register'
       AND entity_id = (SELECT id FROM public.device_tokens WHERE token = 't030-token-inactive');
    INSERT INTO t030_results
    VALUES ('C6-same-user-reactivates',
            (SELECT is_active FROM public.device_tokens WHERE token = 't030-token-inactive')
            AND v_audit_count >= 1,
            'register audit rows=' || v_audit_count);
END $$;

-- C7: unregister_fcm_token retires the caller's own row.
DO $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    v_id := public.unregister_fcm_token('t030-token-inactive');
    INSERT INTO t030_results
    VALUES ('C7-unregister-retires',
            v_id IS NOT NULL
            AND NOT (SELECT is_active FROM public.device_tokens WHERE token = 't030-token-inactive'),
            'retired id null? ' || (v_id IS NULL)::text);
END $$;

-- C8: idempotent for unknown tokens.
DO $$
DECLARE
    v_id uuid;
BEGIN
    v_id := public.unregister_fcm_token('t030-token-never-registered');
    INSERT INTO t030_results
    VALUES ('C8-unregister-idempotent', v_id IS NULL, 'returned null? ' || (v_id IS NULL)::text);
END $$;

-- C9: consolidated audit coverage (register + transfer both wrote entries).
INSERT INTO t030_results
SELECT 'C9-audit-coverage', COUNT(*) >= 2,
       'device_token.* audit rows this tx=' || COUNT(*)
  FROM public.audit_logs
 WHERE action IN ('device_token.register', 'device_token.transfer')
   AND created_at > now() - interval '1 minute';

SELECT * FROM t030_results ORDER BY check_id;

ROLLBACK;
