# Credential & Token Consistency Sheet — All Platforms

> **Purpose:** single canonical sheet for every credential the three El-Imtiyaz clients use to reach the shared backend. Written during session 8 (2026-08-30) while hardening the FCM token lifecycle (SEC-106 / SYNC-104 / SYNC-105, hub migrations 0049–0050).
>
> **Classification:** this file lives in the (private) hub repository. The Supabase URL, anon key, publishable key and Firebase web config are **public client identifiers** — they are designed to ship inside client bundles and are protected by RLS + JWT verification, not by secrecy. The **service_role key and secret key must never appear in any client repository**; they are listed here ONLY as a registry of what exists and where it may be used (server-side/CI only).

## 1. The one backend every platform must point at

| Field | Value |
|---|---|
| Supabase project ref | `hkvkefubghbbotgnteir` |
| Region | `eu-west-1` |
| REST URL | `https://hkvkefubghbbotgnteir.supabase.co` |
| Tenant | El-Imtiyaz Boumerdès (`00000000-0000-0000-0000-000000000001`), DZD, `fr`, Africa/Algiers |
| Auth users (live, 2026-09-01) | 1 — `admin@elimtiyaz.dz` (active, confirmed; password RESET 2026-09-01 by T-106/AUTH-300 after `invalid_credentials` 400s — new value delivered out-of-band, never in git) |
| Migration chain applied | 0001–0063 (60/60, session-17 opening check: zero drift; live-label quirk on row 0050 — see task-registry) |

**Verified live (session 8):** auth health OK · RLS blocks anon reads on all 9 core tables · 58 RPCs exposed · `expire-pending-approvals` EF denies anonymous calls (SEC-105 fix holding) · canonical financial RPCs present.

## 2. Where each platform reads its credentials

| Platform | Mechanism | File / code | Values |
|---|---|---|---|
| **Website** (parent portal) | Next.js `NEXT_PUBLIC_*` env vars, validated in `src/lib/env.ts` (zod, placeholder detection) | `.env.local` (gitignored); template committed as `.env.example` (URL pre-filled with the real project URL) | URL + anon key + Firebase web config + VAPID key |
| **Android** (staff app) | Secrets Gradle Plugin → `BuildConfig.SUPABASE_URL` / `SUPABASE_ANON_KEY` (publishable-key fallback); runtime override via encrypted SharedPreferences (SupabaseConfigDialog) | `.env` (gitignored) / `.env.example` placeholders; `SupabaseClientProvider.kt`; `NetworkTimeouts.isSupabaseConfigured` gates every call on non-placeholder values | URL + anon key (or publishable key) + `google-services.json` (Firebase) |
| **Desktop** (staff app) | Runtime settings dialog → stored per install in ElectronUserData/config.json; reads via `supabase-client.ts` singleton. Fail-closed: throws if `useSupabase=true` and no URL/key configured (no silent demo fallback). | `elimtiyaz-desktop/src/infrastructure/supabase/supabase-client.ts` + `src/features/settings/configuration/connection-card.tsx` | URL + anon key |

**Consistency rule (ADR-001 family):** all three clients MUST resolve to the SAME project ref. The URL is the identity; keys are per-platform-type but derive from the same project. When the project is ever migrated, update this sheet first, then every `.env.example`, then the runtime dialogs.

## 2.1. JWKS URL (canonical)

The Supabase JWT verification key set lives at:

```
https://hkvkefubghbbotgnteir.supabase.co/auth/v1/.well-known/jwks.json
```

- **Android** needs this URL explicitly because it verifies JWTs locally (Ktor client auth) — see `SUPABASE_JWKS_URL` in the Android `.env.example`.
- **Website + Desktop** do NOT need an explicit JWKS URL — the Supabase JS SDK handles JWKS fetching internally; they only need the project URL + anon key.
- The JWKS URL is constructed deterministically from the project URL, so when the project URL changes, the JWKS URL changes too (update Android `.env.example` accordingly).

## 3. Key registry

| Key | Scope | Where it may live | Notes |
|---|---|---|---|
| Supabase **anon key** (JWT, `role:anon`) — LEGACY, still ACTIVE | public client | website (rollback value in `public-config.ts`), Android `.env`, desktop settings | RLS-protected; never call it a secret; accepted everywhere (ADR-009 dual acceptance). Live-verified 2026-09-01: health 200 / REST / password-grant 200 |
| Supabase **publishable key** (`sb_publishable_…`) — PREFERRED public identifier | public client | website committed default (T-107/MIG-KEYS-201, `public-config.ts` + `.env.example`), Android `SUPABASE_PUBLISHABLE_KEY` slot, desktop Configuration tab (both formats named) | ADR-009: publishable-preferred. Live-verified 2026-09-01: health 200 / REST / password-grant 200 |
| Supabase **service_role key** | SERVER ONLY | Edge Functions secrets, CI/deployment env — never in any client repo | bypasses RLS; treat as root |
| Supabase **secret key** (`sb_secret_…`) | SERVER ONLY | Edge Functions secrets (`CRON_SECRET`-style), CI | server APIs; designated successor of the service_role JWT when Supabase retires legacy keys — EFs keep consuming the platform-injected `SUPABASE_SERVICE_ROLE_KEY` env name until then |
| Supabase **access token** (`sbp_…`) | owner/CI only | local operator machine, CI env | Management API (SQL endpoint used in session 8 to apply 0049/0050) |
| Firebase **web API key** | public client | website env, Android `google-services.json` | restricted by Google console config; see SEC-003 (committed google-services.json — deferred T-076) |

## 4. FCM device tokens — the canonical lifecycle (migrations 0027 + 0050)

`device_tokens` rows are keyed by `(tenant_id, token)` with `user_id` = the owning `user_profiles.id`.

| Step | Android | Website | Server |
|---|---|---|---|
| Register | `FcmTokenRegistrar.register(token)` on `onNewToken` — RPC `register_fcm_token(p_user_id, p_token, p_platform='android')` | `registerDeviceToken(profileId)` on push-enable — same RPC, `p_platform='web'` | caller-verified (SEC-106 fix): client JWT must own `p_user_id`; service_role exempt |
| Refresh | `onNewToken` re-registers | service-worker `FCM_TOKEN_REFRESH` message → re-register | upsert by (tenant_id, token) re-activates |
| **Sign-out (SYNC-104/105 fix, session 8)** | `LocalAuthRepository.signOut()` calls RPC `deactivate_fcm_tokens(p_user_id, p_platform='android')` BEFORE revoking the JWT | `AuthProvider.signOut()` calls `unregisterDeviceToken()` (same RPC, `p_platform='web'`) then `auth.signOut({scope:'local'})` — local, NOT global (global killed the family's other devices) | soft-deactivate `is_active=false`; count returned |
| Send | Edge Function `send-push-notification` reads active tokens | — | NOTE (website repo): the website's local `send-push-notification` copy is dead/broken (PUSH-100) — the canonical EF lives in the hub repo |

**Known live state (2026-08-30):** 3 device_tokens rows, all `platform='android'`, 2 still active for the admin profile — they will be cleaned up by that user's next sign-out (the new deactivation path).

## 5. Session-token rules (cross-platform)

- **Website sign-out scope = `local`** (session 8): a parent signing out on one browser must not kill sessions on the family's other devices (old behavior: `scope:'global'`).
- **Android**: session JWT persisted via multiplatform-settings (SettingsSessionManager); `Session.accessToken` holds the real SDK JWT (WEAK-101 fix, T-002).
- **Desktop**: session managed by the auth-provider; changePassword now re-authenticates and revokes (SEC-103 fix, T-003).

## 6. Rotation procedure (when a key leaks)

1. Rotate in the Supabase dashboard (Settings → API) — new keys are issued instantly; old JWTs keep working until their `exp` (the live anon JWT above expires 2036; plan a forced rotation window).
2. Update this sheet's registry (NOT the values — values stay out of git).
3. Update `.env.example` files only if the project URL changed.
4. Re-deploy Edge Functions with the new secrets; restart desktop clients (runtime dialog re-entry).

## 7. Verification checklist (re-run after any credential change)

```bash
# 1. Auth health
curl -s https://hkvkefubghbbotgnteir.supabase.co/auth/v1/health -H "apikey: $ANON"
# 2. RLS: anon must see ZERO rows on core tables
curl -s "$URL/rest/v1/parents?select=*&limit=3" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
# 3. Token RPC hardening: cross-user registration must be denied (42501)
#    (call register_fcm_token with a JWT belonging to user A, p_user_id = user B)
# 4. Website build: npm run build (strict) — env validation must not flag placeholders
```

## 8. New-format API key migration (T-107 / MIG-KEYS-201, 2026-09-01 — ADR-009)

**Decision:** dual acceptance, publishable-preferred. The project's public identifier moves to `sb_publishable_…` where values are COMMITTED (website `public-config.ts`), while every client continues to accept the legacy anon JWT. No destructive switch, no client-side parsing of either format (both are opaque strings for supabase-js ^2.111 and supabase-kt 3.1.1).

| Platform | State after T-107 | Where |
|---|---|---|
| Website | committed default = publishable key; legacy JWT kept in-document as rollback; placeholder detection format-agnostic | `src/lib/public-config.ts`, `.env.example`, `src/lib/env.ts` |
| Desktop | Configuration tab names both formats; runtime key-agnostic (URL+key from userData config) | `connection-card.tsx`, `supabase-client.ts` |
| Android | runtime dual-accepts since session 8 (`ifBlank` fallback); `.env` stays owner-supplied (T-064/SEC-005: no committed APK-path credentials) | `SupabaseClientProvider.kt`, `.env.example` |
| Backend / Edge Functions | unchanged; `sb_secret_` documented as successor for the service_role JWT | hub `supabase/functions/*` |

**Live dual-key matrix (2026-09-01, hkvkefubghbbotgnteir):** `auth/v1/health` 200 ×2 · REST `parents` query processed ×2 (42703 column-probe, i.e. RLS-processed not key-rejected) · `grant_type=password` 200 ×2 (with the post-T-106 password). Guards: website `t-107-api-key-migration.test.ts` 4/4; desktop `api-key-format-acceptance.test.ts` 4/4.

**When Supabase announces legacy-JWT retirement (future session):** (1) switch Android `.env` to the publishable value; (2) website rollback comment may then be deleted (guard test update included); (3) desktop users re-enter the key in Settings → Configuration; (4) re-run the §7 checklist; (5) update this sheet first, then ADR-009's status.
