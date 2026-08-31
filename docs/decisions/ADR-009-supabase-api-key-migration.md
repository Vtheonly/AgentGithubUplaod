# ADR-009 — New-format Supabase API keys: dual acceptance, publishable-preferred

- **Status:** Accepted (2026-09-01, 17th repair session)
- **Task:** T-107 / MIG-KEYS-201 · **Problem:** KEYMIG-300
- **Supersedes:** none (extends ADR-001's one-backend identity rule to the key layer)

## Context

Supabase now issues non-JWT API keys (`sb_publishable_…` public / `sb_secret_…` server) alongside the legacy `anon` / `service_role` JWTs, and will eventually retire the legacy format. The El-Imtiyaz system has THREE clients resolving credentials through three different mechanisms (website: committed public defaults + env; desktop: runtime Electron config; Android: BuildConfig + runtime override), so a key-format migration that is not coordinated per-platform recreates the exact drift class this project's audits catalogue (CROSS-001…). The owner mandated the migration be applied consistently and verified everywhere (17th-session instruction).

At migration time BOTH formats are active on the live project `hkvkefubghbbotgnteir` and were verified live (2026-09-01): `auth/v1/health` 200, REST processed, and the password grant 200 — with each format as the apikey.

## Decision

1. **Dual acceptance.** Every client accepts EITHER public format. No client-side parsing/format validation of the key is introduced anywhere (supabase-js ^2.111 and supabase-kt 3.1.1 already treat the key as an opaque string for the `apikey` header).
2. **Publishable-preferred where values are COMMITTED.** The website's committed public default (`src/lib/public-config.ts` + `.env.example`) becomes the `sb_publishable_…` value; the legacy anon JWT is retained IN-DOCUMENT (comment) as the rollback value and pinned by a guard test so it cannot silently vanish while legacy keys are still active.
3. **No committed credentials in the Android APK path.** Android keeps its T-064/SEC-005 posture: `.env` (gitignored, owner-supplied) with `SUPABASE_PUBLISHABLE_KEY` as the documented preferred slot; `.env.example` documents it without carrying the value.
4. **Desktop stays runtime-configured.** The Configuration tab's guidance now names both formats; no code behaviour change (the client was already key-agnostic).
5. **Server keys unchanged today.** Edge Functions continue consuming the platform-injected `SUPABASE_SERVICE_ROLE_KEY` env name. The `sb_secret_` key is the designated successor and is documented in the credentials sheet; the actual EF-secret switch happens only when Supabase announces legacy retirement (runbook steps in credentials.md §8).

## Consequences

- Positive: the system is already compatible with the retirement event (no emergency migration later); fresh clones and runtime dialogs both accept either format; the rollback path is explicit and guarded.
- Costs: two formats coexist in documentation until retirement; the website guard test must be updated when the rollback comment is eventually deleted (its update step is written down in credentials.md §8).
- Neutrality guard: because no client parses the key, this ADR requires NO changes to RLS, JWT verification, JWKS usage (Android `SUPABASE_JWKS_URL` — the JWT-signing key set is independent of the apikey format), or Edge Function auth.

## Verification regime

- Website: `src/test/t-107-api-key-migration.test.ts` (4 guards) + T-096's fresh-clone pin updated to the new format.
- Desktop: `src/tests/security/api-key-format-acceptance.test.ts` (4 guards incl. client construction under both keys).
- Live: dual-key matrix recorded in `docs/operations/credentials.md` §8 (health / REST / password-grant × both formats).
