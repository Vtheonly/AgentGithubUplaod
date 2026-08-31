# Runbook — Enable Google OAuth on the live Supabase project (AUTH-200)

> **Status (2026-08-31, 14th session): OPEN — owner action required.**
> Live-verified evidence: `external_google_enabled: false`, `external_google_client_id: EMPTY`,
> `external_google_secret: EMPTY` (queried via the Management API with the owner's access token).
> The portal's Google button is RENDERED and ENABLED client-side since T-096 (public config
> defaults), but the sign-in round-trip fails until the provider is enabled server-side.
> **This is the single remaining blocker for portal login.**

## Why this is owner-only

Enabling the provider requires a Google Cloud OAuth client that belongs to the school's Google
account. An agent cannot create it: it needs the owner's Google Console login, a consent screen,
and a client secret that must stay private to the owner. Everything AFTER the client exists can
be done by an agent with the Management API access token (steps 3–4 below).

## Steps

### 1. Create the Google OAuth client (owner, ~10 minutes)

1. Sign in to https://console.cloud.google.com with the school's Google account.
   The Firebase project `elimtiyaz-android` (nr. 259221439109) can be reused, or create a new
   project — either works.
2. Configure the OAuth consent screen (External, app name "El-Imtiyaz Portal", support email).
   No scopes are needed beyond the defaults (email/profile) — Supabase only needs the id_token.
3. Create credentials → OAuth client ID → **Web application**.
4. Authorized redirect URI: `https://hkvkefubghbbotgnteir.supabase.co/auth/v1/callback`
   (this is the Supabase callback — NOT the portal URL).
5. Note the **Client ID** and **Client Secret**.

### 2. (Optional but recommended) restrict the client

- Authorized JavaScript origins: `http://localhost:3000` (local dev) and the production origin
  once known.

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
  "https://hkvkefubghbbotgnteir.supabase.co/auth/v1/authorize?provider=google&redirect_to=http://localhost:3000"
# expect 30x (redirect to Google), and a full browser sign-in round-trip on the portal.
```

Then update this runbook's status line and flip AUTH-200 to TESTED/VERIFIED in the problem
registry, recording the evidence.

## Discoveries recorded during setup (2026-08-31, 14th session)

- **Management API `uri_allow_list` takes a COMMA-SEPARATED STRING, not an array.** Sending
  `["http://…","http://…"]` fails with `Invalid input: expected string, received array`; sending
  `"http://localhost:3000,http://localhost:3100"` works (PATCH returns 200 and the value
  persists). This is unintuitive (the GET response shows it as a single string) and cost one
  debugging round — recorded here so the next agent does not repeat it.
- The live allow-list now contains `http://localhost:3000,http://localhost:3100` (local dev
  origins for the owner's `npm run dev` port 3000 and the verification port 3100). The
  `site_url` remains `http://localhost:3000`. When the portal gets a production domain, BOTH
  must be updated via the same PATCH endpoint.
- The old runbook pointer in `next-task.md` referenced this file before it existed (doc gap —
  the 13th session referenced a runbook it never wrote). This file is that runbook, written in
  the 14th session.
