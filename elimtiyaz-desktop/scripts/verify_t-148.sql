-- ============================================================================
-- scripts/verify_t-148.sql — T-148 live verification (migration 0067)
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; — re-runnable,
-- no live mutation persists. Results land in a temp table.
--
-- Live profiles used (all verified present this session):
--   ADMIN  = dac9c821-22a3-4edb-857c-6c4414199d2e (auth 0a3597e7…) — super_admin
--   PARENT = 71669da0-046f-49cd-adb6-9dc28fd9556c (auth e027bed2…) — parent role (Mersel Fares)
--   B      = 80aafabb-d61c-462a-a0ce-e587c483be4c (auth ef2d7159…) — NO roles
--
-- Checks (happy path + regression paths):
--   C1  migration 0067 registered in schema_migrations (chain 64)
--   C2  profile_has_staff_role resolves staff-ness (admin true, B false)
--   C3  open_parent_admin_channel happy path (parent → admin): direct type,
--       both members, deterministic pair code, default name 'Administration'
--   C4  idempotency: second call returns the SAME channel id
--   C5  the creation wrote a chat.parent_admin_channel_open audit row
--   C6  staff caller rejected ('staff members must use create_direct_channel')
--   C7  caller WITHOUT the parent role (B) rejected ('only parent accounts')
--   C8  PARENT can post into the admin DM (chat_messages_insert allows)
--   C9  PARENT cannot post into a parent-only channel (members: parent + B)
--   C10 PARENT cannot CREATE a channel with a non-staff member (B)
--   C11 STAFF (admin) can still post into the admin DM (0048 semantics kept)
--   C12 the live chat_messages_insert policy carries the new profile_has_staff_role clause
--   C13 the live chat_channels_insert policy carries the new profile_has_staff_role clause
-- ============================================================================

BEGIN;

CREATE TEMP TABLE t148_results (check_id text, ok boolean, detail text);
GRANT INSERT, SELECT ON t148_results TO authenticated, anon;

-- C1: registration + chain count
INSERT INTO t148_results
SELECT 'C1-registered', COUNT(*) = 1, 'rows=' || COUNT(*)
  FROM supabase_migrations.schema_migrations WHERE version = '0067';
INSERT INTO t148_results
SELECT 'C1-chain-64', (SELECT COUNT(*) FROM supabase_migrations.schema_migrations) = 64,
       'chain=' || (SELECT COUNT(*) FROM supabase_migrations.schema_migrations);

-- C2: profile_has_staff_role (as PARENT — SECURITY DEFINER must resolve other
-- profiles' roles despite the caller's RLS on role_assignments)
DO $$
DECLARE
    v_admin_staff boolean;
    v_b_staff boolean;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "e027bed2-81e2-4db5-8e30-ad9dbf39b95f", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    SELECT public.profile_has_staff_role('dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid) INTO v_admin_staff;
    SELECT public.profile_has_staff_role('80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid) INTO v_b_staff;
    INSERT INTO t148_results VALUES ('C2-staff-resolver',
        v_admin_staff = true AND v_b_staff = false,
        'admin=' || v_admin_staff || ' B=' || v_b_staff);
END $$;

-- C3 + C4 + C5: happy path + idempotency + audit (as PARENT)
DO $$
DECLARE
    v_ch1 public.chat_channels;
    v_ch2 public.chat_channels;
    v_audit int;
    v_expected_code text;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "e027bed2-81e2-4db5-8e30-ad9dbf39b95f", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;

    v_expected_code := 'DM-' ||
        least('71669da0-046f-49cd-adb6-9dc28fd9556c'::uuid, 'dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid) || '-' ||
        greatest('71669da0-046f-49cd-adb6-9dc28fd9556c'::uuid, 'dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid);

    v_ch1 := public.open_parent_admin_channel();
    INSERT INTO t148_results VALUES ('C3-happy-path',
        v_ch1.channel_type = 'direct'
        and v_ch1.member_ids @> array['71669da0-046f-49cd-adb6-9dc28fd9556c'::uuid, 'dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid]
        and v_ch1.code = v_expected_code
        and v_ch1.name = 'Administration'
        and v_ch1.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid,
        'type=' || v_ch1.channel_type || ' code_ok=' || (v_ch1.code = v_expected_code) || ' name=' || v_ch1.name);

    v_ch2 := public.open_parent_admin_channel();
    INSERT INTO t148_results VALUES ('C4-idempotent', v_ch1.id = v_ch2.id,
        'id1=' || v_ch1.id || ' id2=' || v_ch2.id);

    SELECT COUNT(*) INTO v_audit FROM public.audit_logs
     WHERE action = 'chat.parent_admin_channel_open' AND entity_type = 'chat_channel' AND entity_id = v_ch1.id;
    INSERT INTO t148_results VALUES ('C5-audit', v_audit >= 1, 'audit rows=' || v_audit);

    -- stash the channel id for C8/C11 (same DO block keeps the channel alive
    -- inside this transaction)
    CREATE TEMP TABLE t148_ch (ch_id uuid);
    INSERT INTO t148_ch VALUES (v_ch1.id);
END $$;

-- C6: staff caller rejected
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        SET LOCAL ROLE authenticated;
        PERFORM public.open_parent_admin_channel();
        INSERT INTO t148_results VALUES ('C6-staff-rejected', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        -- NOTE: the parent-role gate fires FIRST for a pure-staff caller (no
        -- parent role) — either message is a correct rejection.
        INSERT INTO t148_results VALUES ('C6-staff-rejected', (SQLERRM LIKE '%staff members must use create_direct_channel%' OR SQLERRM LIKE '%only parent accounts%'), 'raised: ' || SQLERRM);
    END;
END $$;

-- C7: caller without the parent role rejected
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "ef2d7159-1a99-4351-ba2d-10ac860e34c0", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        SET LOCAL ROLE authenticated;
        PERFORM public.open_parent_admin_channel();
        INSERT INTO t148_results VALUES ('C7-non-parent-rejected', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t148_results VALUES ('C7-non-parent-rejected', (SQLERRM LIKE '%only parent accounts%'), 'raised: ' || SQLERRM);
    END;
END $$;

-- Setup for C9/C10: a parent-only channel (members: PARENT + B) created BY
-- STAFF (allowed — staff keep 0048 semantics), plus a message attempt.
DO $$
DECLARE
    v_ch public.chat_channels;
BEGIN
    -- staff creates the parent-only channel
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    -- Create the channel with B as the counterpart FIRST (admin<->B pair —
    -- a DIFFERENT deterministic code than the admin<->parent DM, so the
    -- parent's DM from C3 is never touched), then swap members to parent+B
    -- via the staff-gated update policy (staff keep that power).
    v_ch := public.create_direct_channel('80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid, 't148 set');
    UPDATE public.chat_channels SET member_ids = array['71669da0-046f-49cd-adb6-9dc28fd9556c'::uuid, '80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid]
     WHERE id = v_ch.id;
    CREATE TEMP TABLE IF NOT EXISTS t148_pch (ch_id uuid);
    DELETE FROM t148_pch;
    INSERT INTO t148_pch VALUES (v_ch.id);
END $$;

-- C8: PARENT posts into the admin DM → ALLOWED
DO $$
DECLARE
    v_ch_id uuid;
    v_err text := null;
BEGIN
    SELECT ch_id INTO v_ch_id FROM t148_ch;
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "e027bed2-81e2-4db5-8e30-ad9dbf39b95f", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    BEGIN
        INSERT INTO public.chat_messages (tenant_id, channel_id, author_id, body, attachments, read_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::uuid, v_ch_id, '71669da0-046f-49cd-adb6-9dc28fd9556c'::uuid,
                't148 parent to admin message', '[]'::jsonb,
                jsonb_build_array(jsonb_build_object('user_id', '71669da0-046f-49cd-adb6-9dc28fd9556c', 'read_at', to_jsonb(now()::text))));
    EXCEPTION WHEN others THEN
        v_err := SQLERRM;
    END;
    INSERT INTO t148_results VALUES ('C8-parent-posts-admin-dm', v_err IS NULL, coalesce('raised: ' || v_err, 'insert accepted'));
END $$;

-- C9: PARENT posts into the parent-only channel → REJECTED
DO $$
DECLARE
    v_ch_id uuid;
    v_err text := null;
BEGIN
    SELECT ch_id INTO v_ch_id FROM t148_pch;
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "e027bed2-81e2-4db5-8e30-ad9dbf39b95f", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    BEGIN
        INSERT INTO public.chat_messages (tenant_id, channel_id, author_id, body, attachments, read_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::uuid, v_ch_id, '71669da0-046f-49cd-adb6-9dc28fd9556c'::uuid,
                't148 forbidden parent to parent', '[]'::jsonb,
                jsonb_build_array(jsonb_build_object('user_id', '71669da0-046f-49cd-adb6-9dc28fd9556c', 'read_at', to_jsonb(now()::text))));
    EXCEPTION WHEN others THEN
        v_err := SQLERRM;
    END;
    INSERT INTO t148_results VALUES ('C9-parent-p2p-rejected', v_err IS NOT NULL, coalesce('insert REJECTED: ' || v_err, 'NO ERROR RAISED (DEFECT)'));
END $$;

-- C10: PARENT tries to CREATE a channel with a non-staff member → REJECTED
DO $$
DECLARE
    v_err text := null;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "e027bed2-81e2-4db5-8e30-ad9dbf39b95f", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    BEGIN
        INSERT INTO public.chat_channels (tenant_id, code, name, channel_type, member_ids, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'CH-t148-p2p', 'p2p attempt', 'direct',
                array['71669da0-046f-49cd-adb6-9dc28fd9556c'::uuid, '80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid],
                '71669da0-046f-49cd-adb6-9dc28fd9556c'::uuid);
    EXCEPTION WHEN others THEN
        v_err := SQLERRM;
    END;
    INSERT INTO t148_results VALUES ('C10-parent-create-p2p-rejected', v_err IS NOT NULL, coalesce('insert REJECTED: ' || v_err, 'NO ERROR RAISED (DEFECT)'));
END $$;

-- C11: STAFF posts into the admin DM → ALLOWED (0048 semantics preserved)
DO $$
DECLARE
    v_ch_id uuid;
    v_err text := null;
BEGIN
    SELECT ch_id INTO v_ch_id FROM t148_ch;
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    BEGIN
        INSERT INTO public.chat_messages (tenant_id, channel_id, author_id, body, attachments, read_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::uuid, v_ch_id, 'dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid,
                't148 admin reply', '[]'::jsonb,
                jsonb_build_array(jsonb_build_object('user_id', 'dac9c821-22a3-4edb-857c-6c4414199d2e', 'read_at', to_jsonb(now()::text))));
    EXCEPTION WHEN others THEN
        v_err := SQLERRM;
    END;
    INSERT INTO t148_results VALUES ('C11-staff-posts-dm', v_err IS NULL, coalesce('raised: ' || v_err, 'insert accepted'));
END $$;

-- C12 + C13: the live policies carry the new clause
INSERT INTO t148_results
SELECT 'C12-messages-policy-clause', COUNT(*) = 1 AND (MAX(with_check) LIKE '%profile_has_staff_role%'), left(MAX(with_check), 120)
  FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='chat_messages_insert';
INSERT INTO t148_results
SELECT 'C13-channels-policy-clause', COUNT(*) = 1 AND (MAX(with_check) LIKE '%profile_has_staff_role%'), left(MAX(with_check), 120)
  FROM pg_policies WHERE schemaname='public' AND tablename='chat_channels' AND policyname='chat_channels_insert';

-- Final result table
SELECT * FROM t148_results ORDER BY check_id;
ROLLBACK;
