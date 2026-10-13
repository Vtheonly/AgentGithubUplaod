# Runbook — Enable Google OAuth on the live Supabase project (AUTH-200 + AUTH-400 + AUTH-401)

> **Status (2026-10-13, 167th session — T-522): the chain's links 1–4 are ALL GREEN; the sole remaining blocker is AUTH-401 (the token-exchange rejection — the Supabase Google provider's stored client SECRET is invalid).**
> The live backend is `vebfehrpzajhstyhinnw`; the provider is enabled with a client id + secret SET (Management API, re-verified this session); the authorize endpoint 302s to Google; **the redirect URIs are registered on BOTH Google-console clients (§5 probes — AUTH-400 RESOLVED-LIVE: the owner REPLACED the stale old-callback entry on the OLD client and created the NEW `elimtiyaz-production` client `944201689219-j18a…` with the Supabase callback pre-registered, 2026-10-13 09:51). The owner's browser round-trip now passes the account chooser and the callback — and dies at the token exchange: the stored secret is a 64-char lowercase-hex string (NOT a Google `GOCSPX-…` secret), so Google answers `401 invalid_client` to Supabase's server-side code exchange (§6 probe), and GoTrue redirects the failure to the portal as `?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+4%2F0A…` (the portal now SURFACES it — T-522, commit `efc391f`).**
> **THE OWNER ACTION (~2 minutes, §6.3):** Supabase Dashboard → `vebfehrpzajhstyhinnw` → Authentication → Providers → Google → paste the NEW client id `944201689219-j18ab6oevrt699j5dukb6smg5lg98iv8.apps.googleusercontent.com` + its FULL `GOCSPX-…Ma3E` secret (if the full value from creation 09:51:58 was not saved: the client's Google-console page → "Add new secret" → paste the fresh one — rotation is downtime-free). Then re-run the §6 probe with the new pair (expect `400 invalid_grant` — the GREEN shape) and perform the first real sign-in (closes AUTH-200 + AUTH-400 + AUTH-401 together).
>
> **Historical (2026-10-13, 164th session — T-518):** AUTH-400 registered + live-diagnosed (the redirect-URI mismatch era — §5's probe method was invented here); resolved by the owner's console change before the 167th session.
>
> **Historical (2026-09-03, 23rd session — T-141): AUTH-200 closed agent-side on the then-live OLD project** — the owner supplied the client (id 72 chars + secret 64 chars), the agent ran the enable PATCH, the authorize endpoint 302'd. Evidence: `docs/recovery/t-141-live-verification.md`.
>
> **Historical (2026-09-02, 20th session — T-119): agent-side production config DONE** — `site_url = https://elimtiyaz-website.vercel.app` and `uri_allow_list = http://localhost:3000,http://localhost:3100,https://elimtiyaz-website.vercel.app` (both live-verified on the new project again at T-518).

## Why this is owner-only

Enabling the provider requires a Google Cloud OAuth client that belongs to the school's Google
account. An agent cannot create it: it needs the owner's Google Console login, a consent screen,
and a client secret that must stay private to the owner. Everything AFTER the client exists can
be done by an agent with the Management API access token (steps 3–4 below). **The redirect-URI
registration (step 1.4) is the one part that lives ONLY in the Google Cloud Console — no API in
the owner's token sheet can touch it (the Firebase API key is not a console credential — verified
at T-119; the Supabase/Vercel/GitHub tokens have no Google-console scope).**

## The FIVE-LINK chain (§15.98/§15.101 — probe each link separately)

```
[1] the deployed bundle carries the NEW project URL + key       → probe: grep the live JS chunks
[2] the Supabase provider is ENABLED with id + secret SET       → probe: Management API GET config/auth
[3] the authorize endpoint redirects to Google (302)            → probe: GET /auth/v1/authorize?provider=google
[4] the Google console ACCEPTS the new project's callback       → probe: §5 below (the redirect-URI probe)
[5] Google ACCEPTS the token-exchange (id+secret pair valid)    → probe: §6 below (the token-endpoint probe)
```

A 302 at link 3 proves links 1–3 AND NOTHING about links 4–5: Google validates the redirect_uri
AFTER the redirect lands, at its own door, and the parent's browser shows Google's raw error
page; and even a fully-registered callback (link 4 green) says nothing about the client
credentials — the exchange (link 5) is a server-to-server call Supabase makes with the STORED
id+secret pair, and its failure reaches the portal only as GoTrue's error redirect
(`?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code…`).
The 167th session's live proof of both blind spots: the owner's sign-in passed the account
chooser and the callback, then died at the exchange — an invalid STORED secret that the
link-4 mismatch era had masked all along.

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
4. Authorized redirect URI: **`https://vebfehrpzajhstyhinnw.supabase.co/auth/v1/callback`**
   (the CURRENT live project's Supabase callback — NOT the portal URL, and NOT the old project's
   `https://hkvkefubghbbotgnteir.supabase.co/auth/v1/callback`, which is the stale entry whose
   registration is now the AUTH-400 blocker — it points at an INACTIVE project). If BOTH
   are present that is harmless (the old one is inert); what matters is that the new one EXISTS.
   **THIS STEP (1.4) IS THE ONE REMAINING OWNER ACTION as of 2026-10-13 (T-518).**
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
  "https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/config/auth"
```

> 2026-10-13 state: this PATCH is ALREADY DONE on the live config (enabled=true, id SET, secret SET —
> live-verified at T-518). It is kept here because the AUTH-200 history warns: "dashboard interactions
> can flip the toggle off" — if the authorize endpoint ever 400s again with `Unsupported provider`,
> re-run the enable-only PATCH `{"external_google_enabled": true}` (credentials preserved).

### 4. Verify (the Supabase-side links 2–3)

```bash
# Provider enabled?
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/config/auth" \
  | jq '.external_google_enabled'        # expect true

# The OAuth start endpoint answers (should NOT say provider is disabled):
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://vebfehrpzajhstyhinnw.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://elimtiyaz-website.vercel.app"
# expect 30x (redirect to Google), and a full browser sign-in round-trip on the portal.
```

NOTE on verification order (live evidence, 20th session 2026-09-02): the
authorize endpoint checks the PROVIDER before validating `redirect_to` —
both a bogus and the production `redirect_to` return the same
`Unsupported provider` 400 while the provider is disabled. The `uri_allow_list` effect can therefore
only be round-trip-verified AFTER step 3 (provider enabled); the config values
themselves were verified by GET after the T-119 PATCH.

### 5. Verify link 4 — the Google-console redirect-URI registration probe (T-518, NEW — works WITHOUT console access)

A 302 from the authorize endpoint does NOT mean the sign-in works: Google validates the
`redirect_uri` AFTER the redirect, at its own door. The registration state of ANY candidate URI
is readable with a plain `curl -L` against accounts.google.com — a REGISTERED URI lands on the
account chooser, an UNREGISTERED one lands on `signin/oauth/error` (redirect_uri_mismatch):

```bash
CID="259221439109-hp67cbdhj2kaa4i03okpjdpa5uqen7c0.apps.googleusercontent.com"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

probe() {
  local ruri="$1"   # URL-ENCODED redirect_uri
  local final
  final=$(curl -s -L -m 25 -o /dev/null -w "%{url_effective}" -A "$UA" \
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=$CID&redirect_uri=$ruri&response_type=code&scope=email+profile&state=probe")
  if echo "$final" | grep -q "signin/oauth/error"; then
    echo "NOT REGISTERED (Google rejects: redirect_uri_mismatch)"
  else
    echo "REGISTERED (reached the account chooser)"
  fi
}

probe "https%3A%2F%2Fvebfehrpzajhstyhinnw.supabase.co%2Fauth%2Fv1%2Fcallback"   # the LIVE callback — must say REGISTERED
```

⚠️ The `-L` flag is ESSENTIAL — without it `url_effective` is just the requested URL and EVERY
probe falsely answers "registered" (this exact bug was caught and fixed during T-518's own
probe-script development; a browser User-Agent is also required — Google answers bots differently).

**2026-10-13 live result (re-probed at the 167th session — T-522): the NEW callback → ACCEPTED on the OLD client (the owner REPLACED the stale old-callback entry) AND on the NEW client `944201689219-j18a…`; the OLD callback → MISMATCH (the stale entry is GONE). AUTH-400 RESOLVED-LIVE.** The original T-518-era result (NEW → NOT REGISTERED; OLD → REGISTERED) is preserved above as the method's worked example. The next sign-in blocker is the token exchange — §6.

### 6. Verify link 5 — the token-exchange probe (T-522, NEW — isolates the STORED client secret WITHOUT ever holding a real code)

A registered callback says nothing about the client CREDENTIALS: the exchange is a server-to-server
POST Supabase (GoTrue) makes to `https://oauth2.googleapis.com/token` with the STORED client id +
secret. **Google validates the client pair BEFORE the code** — so a probe with a DUMMY code
discriminates a bad secret from a bad code with zero side effects:

```bash
# 1) Read the pair Supabase actually stores (the Management API returns the real values):
SBT="<sbp_…>"; REF="vebfehrpzajhstyhinnw"
CFG=$(curl -s -H "Authorization: Bearer $SBT" "https://api.supabase.com/v1/projects/$REF/config/auth")
CID=$(echo "$CFG" | jq -r .external_google_client_id)
SECRET=$(echo "$CFG" | jq -r .external_google_secret)

# 2) The probe — a dummy code, the STORED pair:
curl -s -X POST https://oauth2.googleapis.com/token \
  -d grant_type=authorization_code -d code=4/0Adummy_invalid_probe_code \
  -d client_id="$CID" -d client_secret="$SECRET" \
  -d redirect_uri=https%3A%2F%2Fvebfehrpzajhstyhinnw.supabase.co%2Fauth%2Fv1%2Fcallback
```

| Result | Meaning |
|---|---|
| `401 {"error":"invalid_client","error_description":"The provided client secret is invalid."}` | **the STORED secret is WRONG** (the AUTH-401 shape — the 167th-session live result with the stored 64-hex secret; an obviously-wrong control secret answers identically) |
| `400 {"error":"invalid_grant", …code…}` | **the pair is VALID** (the GREEN shape — the secret was accepted, only the dummy code was rejected; this is what the probe must answer AFTER the owner pastes the correct pair) |
| `400 {"error":"invalid_request","error_description":"client_secret is missing."}` | the no-secret control (proves Google validates the client pair specifically) |

Also diagnostic, read straight from the GET: a stored secret whose charset is `[0-9a-f]` and length 64
is NOT a Google secret at all (Google secrets are `GOCSPX-…` ≈35 chars, or legacy ≈24) — a hex value
of that shape is a JWT-secret/DB-password-class paste error. **The masking effect to remember: a
link-4 failure (redirect_uri_mismatch) HIDES a link-5 failure — the exchange is never reached
until the callbacks are registered; an invalid secret can sit silently behind it.**

#### 6.3 The owner fix (the AUTH-401 action, ~2 minutes)

1. Supabase Dashboard → project `vebfehrpzajhstyhinnw` → **Authentication → Providers → Google**.
2. Paste the **Client ID** `944201689219-j18ab6oevrt699j5dukb6smg5lg98iv8.apps.googleusercontent.com`
   (the NEW `elimtiyaz-production` client — it ALREADY carries the Supabase callback, §5-probed).
3. Paste the **Client Secret** — the FULL `GOCSPX-…Ma3E` value. The Google console now shows the
   secret only as `****Ma3E`; if the full value from the client's creation (2026-10-13 09:51:58)
   was not saved, open the client's page → **"Add new secret"** → copy the fresh value → paste THAT
   (Google supports secret rotation without downtime; the old one keeps working until first use
   of the new one).
4. Save. (Alternative: the OLD client's own correct `GOCSPX-…` secret — but the old client lives
   in the retired `elimtiyaz-android` project's console and dies with it; the new client is the
   forward path.)
5. Hygiene while in the Google console: add `https://elimtiyaz-website.vercel.app` to the NEW
   client's Authorized JavaScript origins (not blocking for the redirect flow — correct for any
   future Google Identity Services use).

**Verification after the paste (agent):** re-run the §6 probe with the NEW pair → expect the GREEN
`400 invalid_grant` shape → the first real browser sign-in on https://elimtiyaz-website.vercel.app
→ account chooser → selection → the pending-activation screen (the "6-digit code" the owner
expects) or the dashboard → flip AUTH-200 + AUTH-400 + AUTH-401 to VERIFIED together.

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

## Discoveries recorded during the 164th session (2026-10-13 — T-518)

- **A 302 from the authorize endpoint verifies links 1–3 of the OAuth chain and NOTHING about
  link 4** (the Google-console redirect-URI registration): Google validates the redirect_uri
  after the redirect lands, at its own door, on a page the portal cannot catch. The §5 probe
  closes that gap WITHOUT console access. (§15.98.)
- **The `curl -L` flag is load-bearing in the §5 probe** — without it `url_effective` is the
  requested URL and every probe falsely answers "registered"; a browser User-Agent is also
  required (Google answers bots differently).
- **An owner error report captured before an infra change may describe a state that no longer
  exists:** the "still broken" report carried the raw `400 Unsupported provider` body — by the
  time the session probed, the owner had already enabled the provider + secret (the §9.4
  residuals (a)+(c)) and the error was unproducible; the ACTUAL blocker had MOVED to the next
  link (redirect_uri_mismatch). Re-probe the live chain before diagnosing ANY error body.
- **The OLD project `hkvkefubghbbotgnteir` is INACTIVE with dead DNS** (Management API census +
  curl exit 6) — its registered-but-dead callback entry in the Google console is inert; keep or
  remove it freely, but the NEW callback must be ADDED regardless.

## Discoveries recorded during the 167th session (2026-10-13 — T-522)

- **The chain has FIVE links, and each newly-green link can UNMASK the next failure:** the owner
  fixed the redirect URIs (AUTH-400) and the sign-in immediately died one link deeper (AUTH-401,
  the exchange) — an invalid stored secret that had been sitting behind the link-4 failure all
  along. Diagnose by the CURRENT live probe set, never by yesterday's blocker.
- **The token-endpoint probe (§6) isolates the stored client credentials without a real code:**
  Google validates `client_id`+`client_secret` BEFORE the authorization code, so a dummy-code
  POST discriminates `invalid_client` (bad secret — the defect) from `invalid_grant` (good pair —
  the GREEN shape). Zero side effects, no console access, re-runnable after the owner's paste.
- **The Management API returns the ACTUAL secret value, not a mask** — the shape is readable
  (charset/length): the stored value being 64-char lowercase hex proved it was never a Google
  `GOCSPX-…` secret BEFORE any exchange attempt. Read the shape FIRST, probe SECOND.
- **A failure the portal cannot see is a UX defect in itself:** Supabase redirects OAuth
  failures to the site as `?error=…&error_description=…` (query + a double-encoded hash copy);
  swallowing them silently leaves the parent staring at a bare login screen with no explanation
  (the owner's "the authentication process does not continue"). The AUTH-200 stable-code pattern
  extends to redirect-borne failures: read once at mount, localize, clean the URL. Do NOT call
  setState inside the mount effect — seed the state via the lazy initializer (the
  `react-hooks/set-state-in-effect` rule) and let the effect only clean the consumed params.
- **The "6-digit verification code" language:** an owner describing the POST-sign-in activation
  flow (pending-activation-screen.tsx Path A — the 6–7-digit school-issued activation code) means
  the OAuth callback itself is failing BEFORE any activation screen could render. Translate the
  owner's symptom into the chain link it implies before searching the code.
