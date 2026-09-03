# Runbook — Enable Google OAuth on the live Supabase project (AUTH-200)

> **Status (2026-09-03, 23rd session — T-141): AUTH-200 CLOSED agent-side · provider ENABLED · only the first real Google sign-in remains.**
> The owner completed steps 1–2 between the 22nd and 23rd sessions (client_id 72 chars + secret 64 chars
> SET on the live config — discovered by the 23rd-session opening check); the 23rd session ran the
> step-3 enable PATCH and live-verified step 4: `external_google_enabled: true`, credentials preserved,
> `authorize?provider=google` → **HTTP 302 to accounts.google.com** with the owner's client
> (was `400 Unsupported provider` since 2026-08-31). Evidence: `docs/recovery/t-141-live-verification.md`.
> The portal's Google button now starts the real OAuth round-trip; flip AUTH-200 to VERIFIED after the
> first successful browser sign-in (owner or parent — while the Google consent screen stays in TESTING
> mode, remember the 100-test-user cap, step 1.2).
>
> **Historical (2026-09-02, 20th session — T-119): agent-side production config DONE.**
> `site_url = https://elimtiyaz-website.vercel.app` and
> `uri_allow_list = http://localhost:3000,http://localhost:3100,https://elimtiyaz-website.vercel.app`
> (GET re-verified after PATCH: values persisted; localhost dev origins PRESERVED).
> Without this the OAuth round-trip would have bounced off the portal even AFTER the
> provider is enabled: the portal sends `redirect_to=<origin>/` and Supabase falls back to
> `site_url` for non-allowed origins — the old `site_url` was `http://localhost:3000`.

## Why this is owner-only

Enabling the provider requires a Google Cloud OAuth client that belongs to the school's Google
account. An agent cannot create it: it needs the owner's Google Console login, a consent screen,
and a client secret that must stay private to the owner. Everything AFTER the client exists can
be done by an agent with the Management API access token (steps 3–4 below).

## Steps

### 1. Create the Google OAuth client (owner, ~10 minutes)

1. Sign in to https://console.cloud.google.com with the school's Google account.
   The Firebase project `elimtiyaz-android` (nr. 259221439109) can be reused, or create a new
   project — either works. NOTE (verified 2026-09-02): the Firebase config carries NO usable
   OAuth client for this — `google-services.json` has `oauth_client: []` and the Firebase API
   key is NOT an OAuth client — so the client MUST be created explicitly.
2. Configure the OAuth consent screen (External, app name "El-Imtiyaz Portal", support email).
   No scopes are needed beyond the defaults (email/profile) — Supabase only needs the id_token.
   While the consent screen stays in TESTING mode, add the parents' Google accounts as test
   users (Testing caps at 100 users and shows an "unverified app" screen — publish the app
   when the school is ready).
3. Create credentials → OAuth client ID → **Web application**.
4. Authorized redirect URI: `https://hkvkefubghbbotgnteir.supabase.co/auth/v1/callback`
   (this is the Supabase callback — NOT the portal URL).
5. Note the **Client ID** and **Client Secret**.

### 2. (Optional but recommended) restrict the client

- Authorized JavaScript origins: `http://localhost:3000` (local dev) AND
  `https://elimtiyaz-website.vercel.app` (the production origin — known since T-119).

### 3. Enable the provider on Supabase (agent can do this with the access token)

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"external_google_enabled": true,
       "external_google_client_id": "<GOOGLE_CLIENT_ID>",
       "external_google_secret": "<GOOGLE_CLIENT_SECRET>"}' \
  "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/config/auth"
```

### 4. Verify

```bash
# Provider enabled?
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/config/auth" \
  | jq '.external_google_enabled'        # expect true

# The OAuth start endpoint answers (should NOT say provider is disabled):
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://hkvkefubghbbotgnteir.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://elimtiyaz-website.vercel.app"
# expect 30x (redirect to Google), and a full browser sign-in round-trip on the portal.
```

NOTE on verification order (live evidence, 20th session 2026-09-02): the
authorize endpoint checks the PROVIDER before validating `redirect_to` —
both a bogus and the production `redirect_to` currently return the same
`Unsupported provider` 400. The `uri_allow_list` effect can therefore only
be round-trip-verified AFTER step 3 (provider enabled); the config values
themselves were verified by GET after the T-119 PATCH.

Then update this runbook's status line and flip AUTH-200 to TESTED/VERIFIED in the problem
registry, recording the evidence.

## Production web-push env vars (the OTHER owner step)

The production portal renders and signs in WITHOUT any Vercel env vars
(T-096 committed public defaults). Web PUSH needs two values those defaults
deliberately do not carry (see `src/lib/public-config.ts`):

- `NEXT_PUBLIC_FIREBASE_APP_ID` — the Firebase **WEB** app id
  (`1:259221439109:web:…`; the `android:…` app id is a DIFFERENT app in the
  same Firebase project — register a Web app in Firebase console → Project
  settings → Your apps → Web).
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY` — Firebase console → Project settings →
  Cloud Messaging → Web Push certificates → Generate key pair.

Set both on Vercel (Project → Settings → Environment Variables) and
redeploy. Until then the portal logs (since T-121, 2026-09-02) an
actionable warning naming exactly these two vars.

## Discoveries recorded during setup (2026-08-31, 14th session)

- **Management API `uri_allow_list` takes a COMMA-SEPARATED STRING, not an array.** Sending
  `["http://…","http://…"]` fails with `Invalid input: expected string, received array`; sending
  `"http://localhost:3000,http://localhost:3100"` works (PATCH returns 200 and the value
  persists). This is unintuitive (the GET response shows it as a single string) and cost one
  debugging round — recorded here so the next agent does not repeat it.
- The live allow-list now contains `http://localhost:3000,http://localhost:3100` (local dev
  origins for the owner's `npm run dev` port 3000 and the verification port 3100). ~~The
  `site_url` remains `http://localhost:3000`. When the portal gets a production domain, BOTH
  must be updated via the same PATCH endpoint.~~ **DONE 2026-09-02 (T-119): the production
  domain exists — `https://elimtiyaz-website.vercel.app` — and both values were updated and
  live-verified (see the status header).**
- The old runbook pointer in `next-task.md` referenced this file before it existed (doc gap —
  the 13th session referenced a runbook it never wrote). This file is that runbook, written in
  the 14th session.

## Discoveries recorded during the 20th session (2026-09-02)

- **The authorize endpoint checks the PROVIDER before validating `redirect_to`** — while the
  Google provider is disabled, a request with a BOGUS redirect_to returns the SAME
  `Unsupported provider` 400 as the production domain (verified live, both probed). You
  cannot probe allow-list acceptance until the provider is enabled; verify the config by GET
  instead.
- **The Management API `/v1/projects/<ref>/users` REST path does not exist** ("Cannot GET" —
  recorded as AGENTS.md §11.1 quirk #4). The auth-user census must go through the SQL
  endpoint (`SELECT … FROM auth.users`).
