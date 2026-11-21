# New Project Verification & Google OAuth Setup Run — 2026-11-21

**Archive provenance:** captured in the owner’s interactive setup chat (2026-11-21); entered the Investigation Archive as the Session 25 evidence record. All key material masked — token shapes never appear in this file.

**Scope:** the owner created a fresh Supabase project and supplied a full credential set with the instruction to perform the Google OAuth setup directly ("do it yourself"). This run: (1) verified the new project end-to-end, (2) audited the Google-provider state on it, (3) prepared the Google OAuth client values, (4) updated the standing infrastructure record. GET-only protocol throughout; keys live in the chmod-600 env file outside the repo (`scripts/credentials.env`), masked everywhere in this report.

**Project identity (from the Management API):** ref `gvuvibcsfjhwcjikgxql` · name `digitalforgedv-max_elemtiyaz` · org `drewljkwiwmrpemyyuua` · region `eu-west-1` · created 2026-11-20T13:42Z · status `ACTIVE_HEALTHY`.

---

## 1. Verdict at a glance

| Lane | Status | Evidence |
|---|---|---|
| NEW project REST | **ALIVE** | `GET /rest/v1/` (secret) → **200** PostgREST 14.18 swagger; publishable key correctly gated at root (401 key-type message, identical to old-project behavior) |
| NEW project DB | **EMPTY (fresh)** | `GET /rest/v1/students` → 404 PGRST205 "Could not find the table 'public.students' in the schema cache" — no app schema deployed yet |
| NEW project Auth | **ALIVE** | `/auth/v1/health` → 200 (GoTrue v2.198.0) · `/auth/v1/.well-known/jwks.json` → 200 · `/auth/v1/admin/users` → 200 |
| NEW auth users | **0** | admin/users census: 0 users |
| NEW mgmt token | **VALID — first valid mgmt token in project history** | `GET /v1/projects/{ref}` → 200 `ACTIVE_HEALTHY` |
| Token scope | **NEW project ONLY** | `/v1/projects` lists exactly `[gvuvibcsfjhwcjikgxql]`; the OLD project → **403** (different Supabase account) |
| Google provider (Supabase side) | **ALREADY FULLY WIRED** | `external_google_enabled=true`, `external_google_client_id` SET, `external_google_secret` SET — an earlier client's credentials are already pasted in |
| Google side (the OAuth client) | **THE missing piece** | the existing Google OAuth client's authorized redirect URIs do not cover the new project's callback — hence the owner's current "Create OAuth client ID" step |
| site_url | default `http://localhost:3000` | mgmt config; not yet customized |
| GitHub PAT | **WORKING** | `GET /user` → 200 (`Vtheonly`) |
| OLD project (`vebfehrpzajhstyhinnw`) | **STILL RESTRICTED (OPS-011)** | every lane 402 `exceed_egress_quota` — unchanged; the restriction is on the OLD account's plan/spend cap |

**Bottom line:** the new project is the first **live-capable lane since OPS-011 began** — REST, Auth, and Management API all healthy, no quota restriction. The old project's 402 persists independently (it is under a different account; nothing on the new project is affected by it, and the new token cannot reach it).

---

## 2. Probe transcript (masked)

```
== A. NEW project REST + Auth lanes ==
N1  GET {NEW}/rest/v1/ (publishable)   → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
N2  GET {NEW}/rest/v1/ (secret)       → 200 (swagger, PostgREST 14.18)
N3  GET {NEW}/rest/v1/students        → 404 PGRST205 (no public.students — fresh schema)
N4  GET {NEW}/auth/v1/health          → 200 (GoTrue v2.198.0)
N5  GET {NEW}/auth/v1/.well-known/jwks.json → 200
N6  GET {NEW}/auth/v1/admin/users     → 200 (census: 0 users)
N7  GET {NEW}/auth/v1/settings        → 200 (external: google=true, email=true, all others false; disable_signup=false)

== B. Management API (the new management token) ==
M1  GET /v1/projects/{NEW}            → 200 (ACTIVE_HEALTHY, eu-west-1, created 2026-11-20)
M2  GET /v1/projects/{OLD}            → 403 (account lacks privileges — separate account)
M3  GET /v1/projects                  → 200, list = [gvuvibcsfjhwcjikgxql] only
M4  GET /v1/projects/{NEW}/config/auth → 200: site_url=http://localhost:3000;
                                         external_google_enabled=true; client_id SET; secret SET
M5  OPTIONS /v1/projects/{NEW}/config/auth → no Allow header advertised (see §4 note)

== C. GitHub ==
G1  GET api.github.com/user           → 200 (Vtheonly)

== D. OLD project standing re-probe (OPS-011 record) ==
O1  GET {OLD}/rest/v1/ (secret)       → 402 exceed_egress_quota
O2  GET {OLD}/rest/v1/students        → 402 exceed_egress_quota
O3  GET {OLD}/auth/v1/health          → 402 exceed_egress_quota
O4  GET {OLD}/auth/v1/settings        → 402 exceed_egress_quota
```

Probe scripts (reproducible, keyless): `scripts/newproject_probe.sh`, `scripts/newproject_probe2.sh`.

---

## 3. The Google OAuth client — exact values

The console page in the owner's screenshots (Google Auth Platform → Clients → Create client, "My First Project") should be filled as follows **for the new project**:

| Form field | Value |
|---|---|
| Application type | `Web application` (keep) |
| Name | anything, e.g. `elimtiyaz — supabase new` (console label only, users never see it) |
| Authorized JavaScript origins | `https://gvuvibcsfjhwcjikgxql.supabase.co` |
| Authorized redirect URIs | `https://gvuvibcsfjhwcjikgxql.supabase.co/auth/v1/callback` |
| "Use this client for an AI-powered agent" | **leave unchecked** |

Copy the redirect URI exactly — no trailing slash, no wildcard; Google matches it character for character.

**Two ways to finish (pick one):**

- **Option A — fastest (recommended): reuse the client already wired into Supabase.** The new project already has a Google client ID + secret pasted in. Find that existing client in the Google console (Clients list), open it, and **add** the two URIs above to its origins/redirect lists. Nothing changes on the Supabase side — done in one edit, no secret rotation.
- **Option B — create this new client.** Fill the form with the values above, click Create, then replace the credentials in the new project (Supabase Dashboard → the new project → Authentication → Sign In / Providers → Google → paste the new Client ID + Secret, Save). The Management API documents an "update auth service config" endpoint, so the two values can also be handed to the assistant to apply and verify programmatically.

**Consent-screen checklist (either option):** Google Auth Platform → Branding must have an app name + support email; Audience must be either published to Production, or in Testing with the owner's Google account added as a test user — otherwise Google returns `Error 403: access_denied` even with the client configured.

---

## 4. What was done from here vs what remains owner-manual

| Step | Who | Status |
|---|---|---|
| Verify new project REST/Auth/DB state | done this run | complete |
| Verify new mgmt token + scope | done this run | complete |
| Audit Google-provider state on the new project | done this run | complete (already enabled + credentials set) |
| Google OAuth client creation / URI edit in the Google console | **owner only** — lives behind the owner's Google login; no API path exists for OAuth client creation | pending (values ready in §3) |
| Paste/replace client credentials into the new project | owner dashboard (30 s) or assistant via Management-API PATCH once the values are supplied | pending |
| Set Site URL / Redirect URLs (Auth → URL Configuration) to the real portal/deep-link values | owner dashboard or assistant — values not yet decided (current: default `http://localhost:3000`) | deferred until cutover |
| Deploy the app schema to the new DB | owner-gated repo work (audit charter: no source/SQL edits by the assistant) | pending |
| Switch the app's canonical Supabase URL/keys to the new project | owner-gated repo work | pending |

---

## 5. Security & hygiene

- All supplied keys are stored **only** in the chmod-600 env file outside the repo (`scripts/credentials.env`); no token material appears in any committed or delivered file; all output above is masked.
- The credentials were pasted in plaintext chat — the standing rotate-recommendation (OPS-012 family) applies to the full set once setup completes.
- The Google client **secret** should be treated like a password; never paste it into the repo or chat transcripts that get archived. Supplying it once for the PATCH step is acceptable if the owner prefers the assistant apply it; rotating it afterwards is cheap.

---

## 6. Strategic implications (for the standing record)

1. **OPS-011 escape lane confirmed:** the new project is live-capable now. The old project's restriction is on the OLD account's plan/spend cap and cannot affect the new one.
2. **Before the app can use it:** (a) schema deploy to the new DB, (b) app canonical URL/keys switch — both owner-gated repo work; (c) auth users: the new project has 0; the old project's user base is part of the E7.9 export ceremony, still 402-gated on the old side.
3. **OPS-015 sequencing carries over:** before pointing live traffic at ANY project, land T-559/T-560 + the BUG-058 probe fix — otherwise the same egress-burn pattern (13k-row re-seed volleys, BUG-042 amplification, BUG-058 drip) will consume the new project's fresh quota.
4. **Two-account split:** the new mgmt token sees only the new project; the old project's ceremonies (live census, S8 §8 re-verification, S11 §A1.5 reconciliation) remain owner-gated on the OLD account exactly as before.

---

## 7. Session 27 addendum — the website cutover lane (OPS-021 / T-614)

**2026-11-21:** the owner supplied the website repo (`https://github.com/Vtheonly/elimtiyaz-website`) + the live URL (`https://elimtiyaz-website.vercel.app/`). Audit of record: `Deep Sweep/16-WEBSITE-PORTAL-RELOCATION-AUDIT-2026-11-21.md`. Findings relevant to this file's new-project record:

1. **The live portal is UP** (GET 200; Vercel) but **its bundle still pins the OLD project** (`vebfehrpzajhstyhinnw` + its publishable key — `NEXT_PUBLIC_*` build-time-inlined). After relocation the portal needs the env re-point + **a redeploy**.
2. **The cutover dependency set is now REGISTERED (OPS-021) and homed (T-614):** the committed-default trap (`public-config.ts:89-92` — the OLD ref as the production fallback), the three pinning tests (t-516/t-096/t-107 — a website-repo commit post-cutover), the auth parity requirement on the new project (**the redirect allow-list must contain `https://elimtiyaz-website.vercel.app`** — the OAuth redirect is dynamic-origin; no `/auth/callback` route exists), the `bind-activation-code` EF + 5 buckets + 6 realtime tables parity, and the end-to-end smoke. The full checklist: **the RELOAD-GUIDE §A.7**.
3. **The D-21/OPS-019 scope note:** completing the Google client's redirect URI set must now consider the PORTAL's origin too — Google sign-in on the new project should complete on BOTH the desktop's verification surface and the portal after T-614.
4. **The owner-supplied inputs at cutover time:** Vercel access (or the PAT) + the website repo's push access (the pinning-test commit). Everything else is driven from this repo's relocation lane.

---

*Run date: 2026-11-21 · protocol: GET-only probes, keys in-memory/env-file only · related standing record: `01-INFRASTRUCTURE-STATUS.md` (§ new-project run appended).*
