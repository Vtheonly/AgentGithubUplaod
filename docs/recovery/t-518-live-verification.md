# T-518 — Live verification (the 164th session, 2026-10-13): the "website still broken" chain diagnosis — every link probed, the real remaining blocker isolated

> **Task:** T-518 · **Problem:** AUTH-400 (new) + the AUTH-200 re-verification · **Mandate:** the owner's "the website is not working — still broken … fix it in vercel {"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}" report, with the live token sheet (GitHub PAT + Vercel PAT + Supabase access token + publishable/secret keys).

**The session's method (§15.77 data-gateway-first):** every claim below was probed LIVE against the real production surfaces (Vercel API, Supabase Management API + data gateway, accounts.google.com, a real headless-browser click on the production Google button). No claim rests on assumption. The reported error itself was re-probed and could NOT be reproduced — it describes a state that no longer exists (see §6).

## 1. The branch consolidation mandate — a verified NO-OP

- `git ls-remote` + the GitHub branches API on **elimtiyaz-website**: exactly ONE branch, `main` (HEAD `f07c9fb`). Nothing to merge, nothing to delete.
- `git ls-remote` on **AgentGithubUplaod** (the hub): exactly ONE branch, `main` (HEAD `402e0ef`). The `refs/pull/*/head` refs are GitHub-internal pull-request artifacts, not branches — they are unreachable by `git branch -d` and are not deletable via the API (GitHub retires PR refs only when the PR/branch UI action is used); per §15.59 they carry no unmerged commits relevant to `main`'s history (the §15.59 containment census of the hub ran at T-471 and the website merges are all in `main`'s graph — the Vercel deployment history below confirms the historical branch deployments `fix/t-464-portal-attachments` and `feature/t405-debt-aging` were merged and their refs already removed).
- Recorded as a discovery: the owner's merge mandate is already satisfied — this is the second consecutive session where the mandate arrives already-complete (the 162nd session recorded the same census on the website repo).

## 2. C1 — the Vercel production deployment is CURRENT (nothing to redeploy)

Vercel API (`/v6/deployments?projectId=prj_sriEbQM9NoqAmx0z1OarTSpQaivU`, team `team_DXsqUiBypsAoa8rQiYRHrarO`):

- Latest deployment: **2026-10-13T07:45:05Z · READY · commit `f07c9fb4` · ref `main`** — i.e. the production deployment IS the T-516 cutover commit, the current `main` HEAD. The "redeploy to pick up the new committed defaults" residual from the 162nd session is already DONE (Vercel auto-deploy fired on the push).
- Project env vars: **count 0** (verified via `/v9/projects/{id}/env`) — no env var overrides the committed T-096 defaults; the bundle's values come from `public-config.ts` verbatim.
- `GET https://elimtiyaz-website.vercel.app/` → **HTTP 200**.

## 3. C2 — the deployed bundle carries the NEW project identifiers

All 14 first-load JS chunks of the live deployment were downloaded and grepped:

- `vebfehrpzajhstyhinnw` — 1 occurrence (the Supabase URL);
- `sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg` — 1 occurrence (the publishable key);
- `hkvkefubghbbotgnteir` — **0 occurrences** (no OLD-project residue).

The probe script: `/home/z/my-project/scripts/probe_live_bundle.sh` (this session's artifact).

## 4. C3–C5 — the backend and the Google provider state on the NEW project

- `GET https://vebfehrpzajhstyhinnw.supabase.co/auth/v1/health` → **HTTP 200** (publishable key accepted).
- `GET /rest/v1/parents?select=id&limit=1` → **HTTP 200 `[]`** (RLS intact — the T-516 §7 recipe, still green).
- Management API (`GET /v1/projects/vebfehrpzajhstyhinnw/config/auth`, owner token):
  - `external_google_enabled: true`
  - `external_google_client_id: 259221439109-hp67cbdhj2kaa4i03okpjdpa5uqen7c0.apps.googleusercontent.com` (the same client T-141 registered on the OLD project)
  - `external_google_secret: SET` (masked, length 64 — the T-141 pattern "client_id 72 chars + secret 64 chars")
  - `site_url: https://elimtiyaz-website.vercel.app`, `uri_allow_list: http://localhost:3000,http://localhost:3100,https://elimtiyaz-website.vercel.app`
- **Discovery:** the §9.4 residual steps (a) paste the Google client secret and (c) flip `external_google_enabled` — documented as owner-gated by the 162nd session — are **DONE** (live-verified this session; the owner evidently executed them from the documented residuals between the 162nd session's close and this session's probes). Step (b) — the Google-console redirect URI registration — is NOT done (§6 below) and is now the sole remaining blocker.

## 5. C6 — the authorize start works (the reported "Unsupported provider" error is GONE)

`GET /auth/v1/authorize?provider=google&redirect_to=https://elimtiyaz-website.vercel.app/&prompt=select_account` (the portal's exact call shape) → **HTTP 302 → accounts.google.com** with the owner's client id, `redirect_uri=https://vebfehrpzajhstyhinnw.supabase.co/auth/v1/callback`, `response_type=code`, `scope=email profile`.

**The reported error `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}` can no longer be produced by the production chain.** It was the state of this link BEFORE the provider was enabled on the new project (the AUTH-200 recurrence the owner hit after the 07:45Z redeploy picked up the new URL while the provider was still disabled).

## 6. C7 — THE REAL REMAINING BLOCKER: `redirect_uri_mismatch` at the Google console (AUTH-400)

The probe (NEW capability — testing the Google-console registration WITHOUT console access; reusable script `/home/z/my-project/scripts/probe_google_redirect_uris.sh`):

```
GET https://accounts.google.com/o/oauth2/v2/auth?client_id=259221439109-hp67…&redirect_uri=<RURI>&response_type=code&scope=email+profile   (curl -L, browser UA)

redirect_uri = https://vebfefhrpzajhstyhinnw… NO — https://vebfehrpzajhstyhinnw.supabase.co/auth/v1/callback  → lands on accounts.google.com/signin/oauth/error  → MISMATCH (NOT registered)
redirect_uri = https://hkvkefubghbbotgnteir.supabase.co/auth/v1/callback                                        → lands on the account chooser                      → ACCEPTED (registered)
redirect_uri = http://localhost:3000/auth/v1/callback                                                            → lands on accounts.google.com/signin/oauth/error    → MISMATCH (NOT registered)
```

**Browser-level end-to-end proof (a real click on the production site):** loaded `https://elimtiyaz-website.vercel.app/` in a headless browser → the login screen renders cleanly (title "El-Imtiyaz Portal — Espace Parent & Élève", the « Se connecter avec Google » button present and ENABLED, ZERO page errors, only the documented truthful T-121 FCM warning) → clicked the Google button → the browser landed on **Google's `signin/oauth/error` page whose `authError` blob decodes to `redirect_uri_mismatch` with `redirect_uri: https://vebfehrpzajhstyhinnw.supabase.co/auth/v1/callback`**. Screenshots: `/home/z/my-project/download/elimtiyaz-portal-live-2026-10-13.png` (the healthy login screen) and `/home/z/my-project/download/redirect-uri-mismatch-live-2026-10-13.png` (the Google rejection a parent sees today).

**Conclusion:** the OAuth chain has FOUR links; three are green (bundle→new project ✓, Supabase provider enabled+credentials ✓, authorize 302 ✓); the fourth — the Google Cloud Console OAuth client's authorized-redirect-URI list — still contains only the OLD (now INACTIVE, DNS-dead) project's callback. **The portal's Google sign-in is dead at Google's own door, and no credential in the owner's token sheet can open the Google Cloud Console — the fix is strictly owner-gated** (2 minutes: console.cloud.google.com → project `elimtiyaz-android` (nr. 259221439109) → APIs & Services → Credentials → the `259221439109-hp67…` Web-application client → Authorized redirect URIs → ADD `https://vebfehrpzajhstyhinnw.supabase.co/auth/v1/callback` → Save; keeping the old entry is harmless since the old project is INACTIVE).

## 7. C8 — the OLD project is INACTIVE (DNS dead)

- Management API project census: `hkvkefubghbbotgnteir` (name "elimtiyaz") → **status INACTIVE** (created 2026-07-25); `vebfehrpzajhstyhinnw` (name "elimtiyaz-empty") → **ACTIVE_HEALTHY**.
- `curl https://hkvkefubghbbotgnteir.supabase.co/auth/v1/health` → **curl exit 6 (DNS resolution failure)** — any client still pointing at the old project is hard-down at the network layer. This retro-confirms CONFIG-500's severity and closes the "could the old project be revived as a fallback?" question: it would first need a restore from INACTIVE (a dashboard action), and the cutover decision (T-516) supersedes it anyway.

## 8. The website repository health battery (re-run this session, clean clone)

- `npm run lint` → **0 errors**.
- `npm run test` → **53 files / 661 tests, all green** (matches the registered T-516 baseline exactly).
- `npm run build` → **strict build green** (Next.js 16, TypeScript clean, 3 static pages) per T-049.
- Code inspection: `src/lib/public-config.ts` (the new-project defaults, no OLD residue), `src/lib/env.ts` (the T-096 fallback chain), `src/app/providers/auth-provider.tsx:283` (`signInWithOAuth` — the AUTH-200 `provider_disabled` mapping intact and still correct for its failure mode). **No code change required — the repository is coherent with the live backend state; the defect is not in the repo.**

## 9. What this session changed

- **Website repo: NOTHING** (no code defect found; HEAD `f07c9fb` verified green and deployed). No commit was created there — a null change with evidence is the correct outcome, not an omission.
- **Hub repo: this documentation set** — the AUTH-400 registration (the problem-registry entry + the summary-table row), the AUTH-200 re-verification note, the CONFIG-500 left-items correction, the T-518 task-registry entry, the change-log record, the next-task 164th-session snapshot, the credentials.md §9.3/§9.4 state updates, the portal-google-oauth.md runbook rewrite (new-project steps + the redirect-URI probe method), and the AGENTS.md §15.98 lesson (the four-link OAuth chain rule).

## 10. Left / owner actions

1. **THE fix (2 minutes, owner, Google console):** add `https://vebfehrpzajhstyhinnw.supabase.co/auth/v1/callback` to the authorized redirect URIs of OAuth client `259221439109-hp67cbdhj2kaa4i03okpjdpa5uqen7c0.apps.googleusercontent.com` (Google Cloud project `elimtiyaz-android`, nr. 259221439109). Then re-run the §6 probe (expect ACCEPTED) and perform the first real Google sign-in on the portal (AUTH-200/AUTH-400 → VERIFIED).
2. While the Google consent screen stays in TESTING mode, the signing-in Google accounts must be test users (the T-141 step-1.2 caveat, still standing).
3. FCM web push remains disabled (the truthful T-096/T-121 state — the WEB app id + VAPID key are still unknown).
