-- ============================================================================
-- 0060_fcm_token_transfer_guard.sql
-- ============================================================================
-- T-030 — PUSH-102 / SYNC-104 residue (13th session, 2026-08-31).
--
-- WHAT WAS WRONG (verified live this session — the registry's note that the
-- overwrite was "blocked" was inaccurate):
--   `register_fcm_token` (0027, hardened 0050) upserts device_tokens by
--   (tenant_id, token) with ON CONFLICT DO UPDATE SET user_id =
--   EXCLUDED.user_id. The 0050 caller verification only proves the caller
--   owns the p_user_id they register FOR — it says NOTHING about the row
--   already holding the token. So on a shared device, user B registering
--   token T (owned by an ACTIVE session of user A) silently RE-POINTS the
--   row to B: A's notifications are hijacked with no error, no audit
--   trail. Conversely the legitimate flow (A signs out — which now
--   DEACTIVATES A's tokens via deactivate_fcm_tokens, 0050 — then B signs
--   in and registers) must keep working.
--
-- WHAT CHANGES:
--   §1  register_fcm_token conflict semantics — explicit transfer only:
--       - existing row belongs to the SAME user   → reactivate (unchanged).
--       - existing row belongs to ANOTHER user and is INACTIVE (that user
--         signed out — the canonical sign-out path deactivates) → transfer
--         ALLOWED + 'device_token.transfer' AUDIT entry (before/after
--         ownership) + reactivation.
--       - existing row belongs to ANOTHER user and is ACTIVE → RAISE 42501
--         (the silent hijack is dead; the owner must sign out first).
--       New registrations also write a 'device_token.register' audit entry.
--   §2  NEW `unregister_fcm_token(p_token)` — deactivate ONE token row by
--       token string (the batch deactivate_fcm_tokens is user+platform
--       scoped; the token-refresh flow needs the single stale token).
--       Caller-verified: the row's user_id must resolve to the caller
--       (auth.uid()) or the caller is service_role. Returns the row id or
--       NULL when no active row matched.
--
-- WHY THIS SHAPE (AGENTS.md §6/§9 — no parallel implementations):
--   The single RPC pair (register / unregister) stays THE canonical entry
--   point for all three platforms; the Android FcmTokenRegistrar and the
--   website fcm-registration.ts keep calling the same functions. The
--   service-worker FCM_TOKEN_REFRESH flow on the website uses §2 to retire
--   the stale token immediately instead of leaving a permanently-active
--   orphan row (the old comment claimed "stale tokens are cleaned up the
--   next time the user opens the portal" — nothing ever did that).
--
-- IDEMPOTENCY: CREATE OR REPLACE only; §2 is new. No data migration.
-- ============================================================================

-- ─── §1. register_fcm_token — explicit-transfer conflict semantics ─────────
CREATE OR REPLACE FUNCTION public.register_fcm_token(
    p_user_id uuid,
    p_token   text,
    p_platform text DEFAULT 'android'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token_id uuid;
    v_tenant_id uuid;
    v_caller_profile uuid;
    v_is_service_role boolean;
    v_conflict_user uuid;
    v_conflict_active boolean;
    v_id uuid;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RAISE EXCEPTION 'p_token is required';
    END IF;

    -- SEC-106 (0050): verify the caller owns the profile they register for.
    v_is_service_role := (auth.role() = 'service_role');
    IF NOT v_is_service_role THEN
        SELECT up.id INTO v_caller_profile
          FROM public.user_profiles up
         WHERE up.auth_user_id = auth.uid()
         LIMIT 1;
        IF v_caller_profile IS NULL OR v_caller_profile <> p_user_id THEN
            RAISE EXCEPTION 'register_fcm_token: caller does not own user profile %', p_user_id
              USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Resolve tenant from the user's profile.
    SELECT tenant_id INTO v_tenant_id
      FROM public.user_profiles
     WHERE id = p_user_id
     LIMIT 1;

    IF v_tenant_id IS NULL THEN
        -- Default tenant — matches the seed in 0023.
        v_tenant_id := '00000000-0000-0000-0000-000000000001'::uuid;
    END IF;

    -- T-030: inspect the conflicting row BEFORE the upsert so the silent
    -- re-point can be distinguished from a legitimate reactivation.
    SELECT dt.user_id, dt.is_active
      INTO v_conflict_user, v_conflict_active
      FROM public.device_tokens dt
     WHERE dt.tenant_id = v_tenant_id
       AND dt.token = p_token
     LIMIT 1;

    IF v_conflict_user IS NOT NULL AND v_conflict_user <> p_user_id THEN
        IF v_conflict_active THEN
            -- PUSH-102: the token belongs to an ACTIVE session of another
            -- user — a silent transfer would hijack their notifications.
            -- The canonical sign-out (deactivate_fcm_tokens) is the
            -- legitimate way to release the device first.
            RAISE EXCEPTION 'register_fcm_token: token is registered to an ACTIVE device of user % — transfer requires that user to sign out first', v_conflict_user
              USING ERRCODE = '42501';
        END IF;
        -- Inactive conflict = the previous owner signed out: explicit
        -- transfer, AUDITED (PUSH-102 "audit + explicit transfer").
        INSERT INTO public.device_tokens (tenant_id, user_id, token, platform, is_active, last_seen_at)
        VALUES (v_tenant_id, p_user_id, p_token, p_platform, true, now())
        ON CONFLICT (tenant_id, token) DO UPDATE
           SET user_id       = EXCLUDED.user_id,
               platform      = EXCLUDED.platform,
               is_active     = true,
               last_seen_at  = now()
        RETURNING id INTO v_token_id;

        PERFORM public.write_audit_log(
            p_tenant_id   := v_tenant_id,
            p_action      := 'device_token.transfer',
            p_entity_type := 'device_token',
            p_entity_id   := v_token_id,
            p_actor_id    := p_user_id,
            p_before_json := jsonb_build_object('user_id', v_conflict_user, 'is_active', false),
            p_after_json  := jsonb_build_object('user_id', p_user_id, 'is_active', true),
            p_note        := 'Transfert de jeton FCM (appareil partagé, ancien propriétaire déconnecté)'
        );
        RETURN v_token_id;
    END IF;

    -- Same user (or brand-new row): plain reactivation/registration.
    INSERT INTO public.device_tokens (tenant_id, user_id, token, platform, is_active, last_seen_at)
    VALUES (v_tenant_id, p_user_id, p_token, p_platform, true, now())
    ON CONFLICT (tenant_id, token) DO UPDATE
       SET user_id       = EXCLUDED.user_id,
           platform      = EXCLUDED.platform,
           is_active     = true,
           last_seen_at  = now()
    RETURNING id INTO v_token_id;

    PERFORM public.write_audit_log(
        p_tenant_id   := v_tenant_id,
        p_action      := 'device_token.register',
        p_entity_type := 'device_token',
        p_entity_id   := v_token_id,
        p_actor_id    := p_user_id,
        p_after_json  := jsonb_build_object('platform', p_platform, 'active', true),
        p_note        := 'Enregistrement (ré)activé de jeton FCM'
    );

    RETURN v_token_id;
END;
$$;

COMMENT ON FUNCTION public.register_fcm_token IS
  'Canonical FCM registration entry point shared by the Android app (FcmTokenRegistrar) and the web portal (fcm-registration.ts). Upserts device_tokens by (tenant_id, token). SEC-106 (0050): client callers may only register against their own profile. PUSH-102/T-030 (0060): a token held by an ACTIVE session of ANOTHER user is rejected (42501) — transfer only after that user signs out (deactivate), and every transfer is audited.';

-- ─── §2. unregister_fcm_token — single-token retirement ────────────────────
CREATE OR REPLACE FUNCTION public.unregister_fcm_token(
    p_token text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_row public.device_tokens%ROWTYPE;
    v_caller_profile uuid;
    v_is_service_role boolean;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RAISE EXCEPTION 'unregister_fcm_token: p_token is required';
    END IF;

    v_is_service_role := (auth.role() = 'service_role');

    SELECT * INTO v_row
      FROM public.device_tokens dt
     WHERE dt.token = p_token
     ORDER BY dt.is_active DESC, dt.last_seen_at DESC
     LIMIT 1;

    IF v_row.id IS NULL THEN
        RETURN NULL; -- nothing to retire (idempotent no-op)
    END IF;

    IF NOT v_is_service_role THEN
        SELECT up.id INTO v_caller_profile
          FROM public.user_profiles up
         WHERE up.auth_user_id = auth.uid()
         LIMIT 1;
        IF v_caller_profile IS NULL OR v_caller_profile <> v_row.user_id THEN
            RAISE EXCEPTION 'unregister_fcm_token: caller does not own the device token row %', v_row.id
              USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.device_tokens
       SET is_active = false,
           last_seen_at = now()
     WHERE id = v_row.id
     RETURNING id INTO v_row.id;

    PERFORM public.write_audit_log(
        p_tenant_id   := v_row.tenant_id,
        p_action      := 'device_token.unregister',
        p_entity_type := 'device_token',
        p_entity_id   := v_row.id,
        p_actor_id    := v_row.user_id,
        p_after_json  := jsonb_build_object('is_active', false),
        p_note        := 'Retrait du jeton FCM (rotation / désactivation)'
    );

    RETURN v_row.id;
END;
$$;

COMMENT ON FUNCTION public.unregister_fcm_token IS
  'T-030 (PUSH-102/SYNC-104): retire ONE FCM token row by token string — used by the portal service-worker FCM_TOKEN_REFRESH flow to retire the stale token immediately. Caller-verified (row owner or service_role). Idempotent: returns NULL when no row matches.';
