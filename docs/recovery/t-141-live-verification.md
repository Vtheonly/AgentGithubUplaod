# T-141 Live Verification — AUTH-200 close: Google OAuth provider enabled (23rd session, 2026-09-03)

> **Task:** T-141 · **Problem:** AUTH-200 (Critical — the #1 user-facing blocker since 2026-08-31)
> **Status reached:** TESTED (agent-side complete; the final browser round-trip needs the owner's
> first real Google sign-in — one click on the production portal).

## What was wrong

Since the 13th session (2026-08-31), the portal's ONLY auth path (Google OAuth) was dead:
`external_google_enabled: false` on the live Supabase project. Every prior session re-verified
the same state — `client_id: EMPTY`, `secret: EMPTY` — because creating the Google Cloud OAuth
client belongs to the school's Google account (owner-only step, runbook step 1).

## What changed before this session (owner action, NEW DISCOVERY)

The 23rd-session opening check found **the owner completed runbook steps 1–2 between sessions**:

```
external_google_client_id: SET (72 chars — 259221439109-hp67…apps.googleusercontent.com)
external_google_secret:    SET (64 chars)
external_google_enabled:   false        ← the ONLY remaining bit
```

The runbook explicitly assigns steps 3–4 to the agent once the client exists. The owner had not
run the step-3 PATCH (or handed the credentials over) — the toggle was still off.

## What was done (this session)

Runbook **step 3** — the enable-only PATCH (the owner's credentials were NOT overwritten, only
the toggle flipped; a PATCH that sends empty id/secret would have destroyed them):

```bash
curl -s -X PATCH "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"external_google_enabled": true}'
# → HTTP 200; response re-read: enabled=true, client_id_len=72, secret_len=64 (both PRESERVED)
```

## Verification (runbook step 4, live 2026-09-03)

| Check | Result |
|---|---|
| GET `external_google_enabled` | **true** (was false since 2026-08-31) |
| GET client_id / secret lengths | 72 / 64 — preserved by the PATCH |
| `authorize?provider=google&redirect_to=<production>` | **HTTP 302 → accounts.google.com** (client_id `259221439109-hp67…`, redirect_uri `…/auth/v1/callback`, scope `email profile`, state nonce) — was `HTTP 400 "Unsupported provider"` |
| site_url / uri_allow_list | unchanged, production values from T-119 |
| Portal render (https://elimtiyaz-website.vercel.app/) | HTTP 200, correct title |

The authorize endpoint no longer returns "Unsupported provider" — the exact failure a parent
previously saw when clicking the portal's Google button. The OAuth round-trip now STARTS; the
`redirect_to` allow-list round-trip (previously unprobeable, 20th-session discovery) becomes
exercisable on the first real sign-in.

## Why TESTED and not VERIFIED

The remaining step is a real Google account completing the consent screen — something only a
human with a Google account can do. First parent (or owner) sign-in on
https://elimtiyaz-website.vercel.app/ closes the loop: session created → parent profile loaded →
then flip to VERIFIED. The client-side `provider_disabled` UX (T-116) remains in the code as a
safety net and is now dormant in production.

## Notes / discoveries for the next agent

- **The owner is an active actor between sessions** (third confirmation: 0066 in the 22nd
  session, Google credentials this session — the ARCH-014 lesson generalises beyond migrations
  to auth config). ALWAYS re-read live auth config before claiming it is still broken.
- The PATCH endpoint accepts a partial body — `{external_google_enabled: true}` alone works and
  preserves other fields. This is the safe shape for the enable step.
- Google's consent screen publishing status is still owner-visible only: while it stays in
  TESTING mode, parents must be added as test users (runbook step 1.2, 100-user cap).
- If the authorize endpoint ever 400s again with `provider is not enabled`, re-run the step-3
  PATCH — some dashboard interactions can flip the toggle back off.
