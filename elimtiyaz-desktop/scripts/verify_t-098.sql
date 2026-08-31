-- ============================================================================
-- scripts/verify_t-098.sql — T-098 live verification (migration 0061)
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; — re-runnable,
-- no live mutation persists. Results land in a temp table.
--
-- Live profiles used (both verified present this session):
--   ADMIN = dac9c821-22a3-4edb-857c-6c4414199d2e (auth 0a3597e7…) — staff
--   USER B= 80aafabb-d61c-462a-a0ce-e587c483be4c (auth ef2d7159…) — NO roles
--
-- Checks (happy path + regression paths):
--   C1  migration 0061 registered in schema_migrations
--   C2  the 5 new chat_channels columns exist
--   C3  chat_channels_update policy exists (staff/creator-gated)
--   C4  chat_messages_touch_channel trigger exists
--   C5  create_direct_channel happy path (admin → B): direct type,
--       both members, deterministic code, name default
--   C6  idempotency: second call returns the SAME channel id (no dupes)
--   C7  staff gate: caller without staff roles (B) → 42501
--   C8  self-channel rejected (22023)
--   C9  fabricated target profile rejected (22023)
--   C10 CHAT-104 trigger: message insert advances last_message_at,
--       sets preview, bumps updated_at
--   C11 RLS regression: a non-member (B) sees 0 rows of a foreign channel
--   C12 RLS regression: anon sees 0 chat_channels rows
--   C13 update policy: non-staff non-creator (B) CANNOT update a channel;
--       staff (admin) CAN
--   C14 audit: the creation wrote a chat.channel_create audit_logs row
-- ============================================================================

BEGIN;

CREATE TEMP TABLE t098_results (check_id text, ok boolean, detail text);
-- The script switches to authenticated/anon roles below (RLS tests); those
-- roles need privileges on the temp table owned by the login role.
GRANT INSERT, SELECT ON t098_results TO authenticated, anon;

-- C1: registration
INSERT INTO t098_results
SELECT 'C1-registered', COUNT(*) = 1, 'rows=' || COUNT(*)
  FROM supabase_migrations.schema_migrations WHERE version = '0061';

-- C2: columns
INSERT INTO t098_results
SELECT 'C2-columns', COUNT(*) = 5, 'present=' || string_agg(column_name, ',')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'chat_channels'
   AND column_name IN ('description','department_id','archived_at','last_message_at','last_message_preview');

-- C3: update policy
INSERT INTO t098_results
SELECT 'C3-update-policy', COUNT(*) = 1, 'policies=' || COUNT(*)
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'chat_channels' AND policyname = 'chat_channels_update';

-- C4: trigger
INSERT INTO t098_results
SELECT 'C4-touch-trigger', COUNT(*) = 1, 'triggers=' || COUNT(*)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'chat_messages' AND t.tgname = 'chat_messages_touch_channel' AND NOT t.tgisinternal;

-- ---------------------------------------------------------------------
-- C5 + C6 + C14: happy path + idempotency + audit (as ADMIN, authenticated)
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_ch1 public.chat_channels;
    v_ch2 public.chat_channels;
    v_audit int;
    v_expected_code text;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;

    v_expected_code := 'DM-' ||
        least('dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid, '80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid) || '-' ||
        greatest('dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid, '80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid);

    v_ch1 := public.create_direct_channel('80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid, 'Test DM T-098');
    INSERT INTO t098_results VALUES ('C5-happy-path',
        v_ch1.channel_type = 'direct'
        and v_ch1.member_ids @> array['dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid, '80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid]
        and v_ch1.code = v_expected_code
        and v_ch1.name = 'Test DM T-098'
        and v_ch1.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid,
        'type=' || v_ch1.channel_type || ' code=' || v_ch1.code || ' name=' || v_ch1.name);

    -- C6: idempotent second call → same id
    v_ch2 := public.create_direct_channel('80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid, 'Test DM T-098');
    INSERT INTO t098_results VALUES ('C6-idempotent', v_ch1.id = v_ch2.id,
        'id1=' || v_ch1.id || ' id2=' || v_ch2.id);

    -- C14: audit row written
    SELECT COUNT(*) INTO v_audit FROM public.audit_logs
     WHERE action = 'chat.channel_create' AND entity_type = 'chat_channel' AND entity_id = v_ch1.id;
    INSERT INTO t098_results VALUES ('C14-audit', v_audit >= 1, 'audit rows=' || v_audit);
END $$;

-- ---------------------------------------------------------------------
-- C7: staff gate — B (no roles) cannot create channels
-- ---------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "ef2d7159-1a99-4351-ba2d-10ac860e34c0", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        SET LOCAL ROLE authenticated;
        PERFORM public.create_direct_channel('dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid);
        INSERT INTO t098_results VALUES ('C7-staff-gate', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t098_results VALUES ('C7-staff-gate', (SQLERRM LIKE '%only staff%'), 'raised: ' || SQLERRM);
    END;
END $$;

-- ---------------------------------------------------------------------
-- C8: self-channel rejected (as ADMIN)
-- ---------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        SET LOCAL ROLE authenticated;
        PERFORM public.create_direct_channel('dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid);
        INSERT INTO t098_results VALUES ('C8-self-rejected', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t098_results VALUES ('C8-self-rejected', (SQLERRM LIKE '%different profile%'), 'raised: ' || SQLERRM);
    END;
END $$;

-- ---------------------------------------------------------------------
-- C9: fabricated profile rejected (as ADMIN)
-- ---------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        SET LOCAL ROLE authenticated;
        PERFORM public.create_direct_channel('dead0000-0000-4000-8000-000000000000'::uuid);
        INSERT INTO t098_results VALUES ('C9-foreign-profile', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t098_results VALUES ('C9-foreign-profile', (SQLERRM LIKE '%not found in the caller%'), 'raised: ' || SQLERRM);
    END;
END $$;

-- ---------------------------------------------------------------------
-- C10: CHAT-104 trigger — insert a message as ADMIN into the DM channel,
--      verify the channel's last_message_at/preview/updated_at advance.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_ch     public.chat_channels;
    v_before timestamptz;
    v_after  public.chat_channels;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;

    v_ch := public.create_direct_channel('80aafabb-d61c-462a-a0ce-e587c483be4c'::uuid, 'Test DM T-098');
    SELECT updated_at INTO v_before FROM public.chat_channels WHERE id = v_ch.id;

    -- RLS insert path (admin is a member — the 0048 policy must pass)
    INSERT INTO public.chat_messages (tenant_id, channel_id, author_id, body, read_by, attachments)
    VALUES (v_ch.tenant_id, v_ch.id, 'dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid,
            'message body for t-098 trigger verification', '[]'::jsonb, '[]'::jsonb);

    SELECT * INTO v_after FROM public.chat_channels WHERE id = v_ch.id;
    INSERT INTO t098_results VALUES ('C10-touch-fires',
        v_after.last_message_at is not null
        and v_after.last_message_preview = 'message body for t-098 trigger verification'
        and v_after.updated_at >= v_before,
        'last_message_at=' || coalesce(v_after.last_message_at::text, 'NULL')
        || ' preview=' || coalesce(v_after.last_message_preview, 'NULL'));
END $$;

-- ---------------------------------------------------------------------
-- C11 + C12 + C13: RLS regressions
-- ---------------------------------------------------------------------
-- Seed a channel that ONLY admin is a member of (as the table owner —
-- postgres — inside this transaction; rolled back at the end).
INSERT INTO public.chat_channels (id, tenant_id, code, name, channel_type, member_ids, created_by)
VALUES ('bb610000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001',
        'T098-FOREIGN', 'T098 foreign channel', 'group',
        array['dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid], 'dac9c821-22a3-4edb-857c-6c4414199d2e'::uuid)
ON CONFLICT (id) DO NOTHING;

-- C11: B (authenticated, non-member) sees 0 rows of the foreign channel
DO $$
DECLARE
    v_visible int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "ef2d7159-1a99-4351-ba2d-10ac860e34c0", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO v_visible FROM public.chat_channels WHERE id = 'bb610000-0000-0000-0000-0000000000aa'::uuid;
    INSERT INTO t098_results VALUES ('C11-nonmember-invisible', v_visible = 0, 'visible rows=' || v_visible);
END $$;

-- C13a: B cannot update the foreign channel (non-staff, non-creator).
-- NOTE (discovery): RLS on a plain UPDATE does NOT raise 42501 for rows the
-- USING clause filters out — Postgres silently updates 0 rows. The correct
-- regression assertion is ROW_COUNT = 0 (and the name unchanged).
-- NOTE: the name verification must run OUTSIDE the DO block — inside it the
-- SET LOCAL ROLE is still in effect, so the owner-level SELECT sees nothing.
DO $$
DECLARE
    v_rows int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "ef2d7159-1a99-4351-ba2d-10ac860e34c0", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    UPDATE public.chat_channels SET name = 'hijacked by parent'
     WHERE id = 'bb610000-0000-0000-0000-0000000000aa'::uuid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    INSERT INTO t098_results VALUES ('C13a-nonstaff-update-blocked-0rows', v_rows = 0,
        'rows updated=' || v_rows || ' (RLS silently filters — no error is expected)');
END $$;

-- As the table owner (role reverted after the DO block): name NOT hijacked.
INSERT INTO t098_results
SELECT 'C13a-nonstaff-name-intact', name = 'T098 foreign channel', 'name=' || name
  FROM public.chat_channels WHERE id = 'bb610000-0000-0000-0000-0000000000aa'::uuid;

-- C13b: admin (staff) CAN update the channel name
DO $$
DECLARE
    v_rows int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    UPDATE public.chat_channels SET name = 'renamed by staff (t-098)'
     WHERE id = 'bb610000-0000-0000-0000-0000000000aa'::uuid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    INSERT INTO t098_results VALUES ('C13b-staff-update-allowed', v_rows = 1, 'rows updated=' || v_rows);
END $$;

-- C12: anon sees nothing
DO $$
DECLARE
    v_visible int;
BEGIN
    SET LOCAL ROLE anon;
    SELECT COUNT(*) INTO v_visible FROM public.chat_channels;
    INSERT INTO t098_results VALUES ('C12-anon-invisible', v_visible = 0, 'visible rows=' || v_visible);
END $$;

-- ---------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------
INSERT INTO t098_results
SELECT 'SUMMARY', COUNT(*) FILTER (WHERE NOT ok) = 0,
       COUNT(*) FILTER (WHERE NOT ok) || ' OF ' || COUNT(*) || ' CHECKS FAIL'
         || CASE WHEN COUNT(*) FILTER (WHERE NOT ok) = 0 THEN ' (ALL PASS)' ELSE '' END
  FROM t098_results;

SELECT check_id, ok, detail FROM t098_results ORDER BY check_id;

ROLLBACK;
