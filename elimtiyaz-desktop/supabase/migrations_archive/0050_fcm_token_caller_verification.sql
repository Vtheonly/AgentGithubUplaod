-- ============================================================================
-- 0050_fcm_token_caller_verification.sql
-- ============================================================================
-- Session 8 (2026-08-30) — SEC-106 + cross-platform token lifecycle.
--
-- Fixes one security defect and adds one canonical RPC:
--
--   1. SEC-106 (High): `register_fcm_token(p_user_id, p_token, p_platform)`
--      (migration 0027) is SECURITY DEFINER and trusts the caller-supplied
--      p_user_id with NO verification. Any authenticated user could:
--        a) register tokens against another user's profile (push spam), or
--        b) on (tenant_id, token) conflict RE-POINT an existing device row
--           to themselves (hijack another user's notifications).
--      Fix: resolve the caller's own user_profiles row via auth.uid() and
--      reject mismatched p_user_id with SQLSTATE 42501. Service-role
--      callers (Edge Functions, auth.uid() IS NULL, auth.role() =
--      'service_role') remain allowed so server-side registration keeps
--      working.
--
--   2. SYNC-104 / SYNC-105 (Medium): neither the Android app nor the web
--      portal unregisters FCM tokens on sign-out — device_tokens rows stay
--      is_active=true for signed-out users (verified live: 2 stale android
--      tokens). Add the canonical `deactivate_fcm_tokens(p_user_id,
--      p_platform)` RPC both clients call on sign-out: caller-verified
--      (same rule as register), soft-deactivates matching rows, returns
--      the number of rows deactivated. Android passes p_platform='android',
--      the portal passes 'web'.
--
-- All statements are idempotent. No data migration — the two stale live
-- android tokens belong to the still-active admin profile and are left
-- for that user's next sign-out to clean up.
-- ============================================================================

BEGIN;

-- ─── 1. register_fcm_token with caller verification ─────────────────────────

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
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RAISE EXCEPTION 'p_token is required';
    END IF;

    -- SEC-106: verify the caller owns the profile they register a token for.
    -- Client calls arrive with the user's JWT: auth.uid() resolves and must
    -- match p_user_id. Server-side calls (Edge Functions with the service
    -- role key) have auth.uid() IS NULL and are allowed through.
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

    -- Upsert by (tenant_id, token).
    INSERT INTO public.device_tokens (tenant_id, user_id, token, platform, is_active, last_seen_at)
    VALUES (v_tenant_id, p_user_id, p_token, p_platform, true, now())
    ON CONFLICT (tenant_id, token) DO UPDATE
       SET user_id       = EXCLUDED.user_id,
           platform      = EXCLUDED.platform,
           is_active     = true,
           last_seen_at  = now()
    RETURNING id INTO v_token_id;

    RETURN v_token_id;
END;
$$;

COMMENT ON FUNCTION public.register_fcm_token IS
    'Canonical FCM registration entry point shared by the Android app (FcmTokenRegistrar) and the web portal (fcm-registration.ts). Upserts device_tokens by (tenant_id, token). SEC-106 fix (2026-08-30): client callers may only register tokens against their own user_profiles row (auth.uid() verification); service-role callers are exempt.';

-- ─── 2. deactivate_fcm_tokens — canonical sign-out path (SYNC-104/105) ──────

CREATE OR REPLACE FUNCTION public.deactivate_fcm_tokens(
    p_user_id uuid,
    p_platform text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_profile uuid;
    v_is_service_role boolean;
    v_deactivated integer;
BEGIN
    -- Same caller-verification rule as register_fcm_token.
    v_is_service_role := (auth.role() = 'service_role');
    IF NOT v_is_service_role THEN
        SELECT up.id INTO v_caller_profile
          FROM public.user_profiles up
         WHERE up.auth_user_id = auth.uid()
         LIMIT 1;
        IF v_caller_profile IS NULL OR v_caller_profile <> p_user_id THEN
            RAISE EXCEPTION 'deactivate_fcm_tokens: caller does not own user profile %', p_user_id
              USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.device_tokens
       SET is_active = false,
           updated_at = now()
     WHERE user_id = p_user_id
       AND is_active = true
       AND (p_platform IS NULL OR platform = p_platform);

    GET DIAGNOSTICS v_deactivated = ROW_COUNT;
    RETURN v_deactivated;
END;
$$;

COMMENT ON FUNCTION public.deactivate_fcm_tokens IS
    'Canonical FCM sign-out path (SYNC-104/105 fix, 2026-08-30): deactivates the caller''s device_tokens rows — Android passes p_platform=''android'', the web portal passes ''web''. Pass NULL to deactivate every platform. Caller-verified like register_fcm_token.';

COMMIT;
