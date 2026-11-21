# Deep Sweep 16 — The Website Portal Relocation Audit (`elimtiyaz-website` + `elimtiyaz-website.vercel.app`) (Session 27, 2026-11-21)

**Mode:** strictly READ-ONLY (G0 ACTIVE — Issue #32 at 0 comments, the 22nd consecutive silent run). The website repo was cloned OUTSIDE the repo under audit (`/tmp/elimtiyaz-website`, origin `https://github.com/Vtheonly/elimtiyaz-website`, branch `main`, clean, read-only — never modified, never pushed). Live probes were **GET-only**. No file inside `AgentGithubUplaod` was modified producing this report except `Investigation Archive/` + `Refactoring Unified/`.

**Owner-supplied inputs:** the website repo (`https://github.com/Vtheonly/elimtiyaz-website`) + the live URL (`https://elimtiyaz-website.vercel.app/`). **Registered: OPS-021** (the website relocation dependency set) + **T-614** (the Website Cutover card, EXECUTION-PLAN §12/§16/Track 3, ROADMAP 6.14, BLUEPRINT §19).

---

## Part 0 — The live-site GET probe (2026-11-21)

| Probe | Result |
|---|---|
| `GET https://elimtiyaz-website.vercel.app/` | **HTTP 200** (14,412 B HTML; `server: Vercel`; `x-vercel-cache: HIT`; `x-vercel-id: hkg1::…`; HSTS preload; CSP present) |
| CSP egress allowlist (`src/middleware.ts:36`, echoed live) | `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.googleapis.com https://fcm.googleapis.com https://*.firebaseio.com`; `form-action 'self' https://*.supabase.co` — **the `*.supabase.co` wildcard admits ANY project ref: no CSP change is needed for the relocation** |
| JS bundle grep (14 chunks fetched) | **`https://vebfehrpzajhstyhinnw.supabase.co` + `sb_publishable_` — the bundle still points at the OLD project** (10× `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` build-time inlined occurrences) |
| Vercel project/config API (`GET /v9/projects`) | **NOT RUN — no Vercel PAT in this session's env set** (P11-class skip, honestly recorded; the prior S13/S26 probes had it — OPS-013 notes the PAT is VALID and rotated) |
| `/auth/callback` route | **DOES NOT EXIST** (see Part 2 — the OAuth redirect target is the site root, dynamic `window.location.origin`) |

## Part 1 — What the website actually is (the framework/config census)

- **Next.js 16.1.1 App Router SPA** (`package.json` — `el-imtiyaz-portal` v1.1.0): `next dev -p 3000`; standalone build; `react 19`; `@supabase/ssr 0.12.4` + `@supabase/supabase-js 2.111.0`; `@tanstack/react-query`; `firebase 12.17` (FCM only); `pdf-lib`; radix-ui; `zod 4` (jitless); `zustand`; `vitest 4.1.10` (61 test files, ~730 tests, jsdom).
- **`next.config.ts:3-25`:** `output:"standalone"`; `ignoreBuildErrors:false` (strict since T-049); `reactStrictMode`; images allow `lh3.googleusercontent.com` + `avatars.githubusercontent.com`. **No CSP, no rewrites in next.config** (CSP lives in middleware). **No `vercel.json`** (framework-inferred Vercel config; `.vercel` gitignored).
- **`src/middleware.ts:49-89`:** security headers ONLY (CSP/X-Frame-Options DENY/nosniff/Referrer-Policy/Permissions-Policy/HSTS in prod) — **no auth guard, no session refresh, no redirects**; matcher skips `_next/static`, `favicon.ico`, `manifest.webmanifest`, `firebase-messaging-sw.js`.
- **Single-route hash-routed SPA:** `src/app/` contains only `page.tsx`, `layout.tsx`, `global-error.tsx`, `providers/`. Views are hash routes (`src/lib/hooks/use-hash-route.ts:13-23`: `#/finance`, `#/academic`, …). **There is NO `/auth/callback`, no login/logout route files, no `src/pages/`.**
- Tests never hit live Supabase (grep: string-literal assertions only; the auth provider is tested via a fluent mock).

## Part 2 — The Supabase client + auth surface

- **Exactly ONE client construction site:** `src/lib/supabase/client.ts:37-39` — `createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)` from `@supabase/ssr` (singleton `supabase`; null when unconfigured). **No server-side/SSR/service-role client anywhere** (`SUPABASE_SERVICE_ROLE` never consumed; `src/lib/t-096-portal-default-config.test.ts:97-108` actively forbids it in serialized config).
- **THE RELOCATION-CRITICAL TRAP (OPS-021 core):** env resolution is `process.env.NEXT_PUBLIC_*` FIRST (`src/lib/env.ts:86/:88`), falling back to **committed production defaults** — `src/lib/public-config.ts:89`: `NEXT_PUBLIC_SUPABASE_URL: "https://vebfehrpzajhstyhinnw.supabase.co"` + `:91-92`: `"sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"`. `.env.example:41-43` states it outright: *"No Vercel env var is needed: the committed default in src/lib/public-config.ts rules the production bundle (the T-516/T-519 pattern)."* The repo's own history documents the failure mode (`public-config.ts:37-39`): after the PREVIOUS cutover "the website's defaults were never updated … which is exactly why the freshly-cloned portal hit a dead backend". **If the new ref is set only via Vercel env vars the defaults are overridden safely; if the operator relies on the committed-default pattern (as T-516 did), the site silently pins itself to the doomed OLD project.**
- **Auth flow:** `signInWithOAuth({ provider:"google", options:{ redirectTo: \`${window.location.origin}/\`, queryParams:{ prompt:"select_account" } } })` (`src/app/providers/auth-provider.tsx:343-358`) — **dynamic origin; zero literal site URLs anywhere in the repo** (grep for `elimtiyaz-website.vercel.app` / `portal.elimtiyaz.dz` / `app.elimtiyaz.dz` in code/config: **0 hits**; `elimtiyaz.dz` appears only as an email domain in a test fixture and in the Google-fonts/avatar allowlist). OAuth error codes (`?error=/#error=`) are surfaced per T-521/AUTH-401 (`:70-87`, `:296-311`).
- **Session bootstrap chain (the RLS consumer):** `getSession()` → `getUser()` → `user_profiles` (status gate, `:149-152`) → `parents` by `auth_user_id` (`:187-191`) → `students` children (`:205-209`) with the T-413 student-bound fallback (`:231-259`). Missing rows → the pending/suspended screen — i.e. **relocation data gaps surface as "pending activation", not as errors**.
- **Activation lane:** `src/features/auth/activation-code-screen.tsx:87-100` — REST POST to `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/bind-activation-code` with `Authorization: Bearer <session token>` + `apikey: <publishable key>` (**the key is sent as apikey — URL and key must move together**).
- **Logout:** `deactivate_fcm_tokens` RPC then `signOut({scope:"local"})` (`:376-400`).

## Part 3 — The complete Supabase object dependency inventory (cross-checked against the desktop baseline `0001_initial_consolidated_schema.sql` — **all present**)

**31 tables (read unless W):** `user_profiles` · `parents` (**W**: contact self-edit `parent-contact-edit-card.tsx:85-99`) · `students` · `academic_levels` · `classes` · `assessments` · `attendance_records` (**W**: justification update `absence-justification-dialog.tsx:124-131`) · `homework` · `installments` · `payments` · `invoices` · `service_enrollments` · `account_adjustments` · `ledger_entries` (paginated replay) · `notifications` (**W**: `read_at` updates ×2) · `calendar_events` · `chat_channels` · `chat_messages` (**W**: `read_by` + INSERT ×2) · `notification_preferences` (**W**: UPDATE/INSERT) · `student_documents` (**W**: INSERT) · `academic_years` · `transport_destinations` · `pricing_configs` · `grade_level_tuition` · `discounts` · `additional_services` · `complementary_services` · `payment_allocations` · `student_academic_histories` · `account_approval_requests` (**W**: the T-413 self-service application) · `device_tokens` (**W**: FCM token lifecycle).

**1 view:** `v_timetable_published` (`src/lib/portal-queries.ts:1064-1067`; baseline `0001:14594`). *(The website does NOT reference `vw_student_roster`; `grades`/`receipts` are explicitly not-read, `portal-queries.ts:109-117/:350-359`.)*

**4 RPCs:** `register_fcm_token`, `unregister_fcm_token`, `deactivate_fcm_tokens` (`src/lib/fcm-registration.ts:72-76/:103/:124-127`) · `open_parent_admin_channel` (`src/features/portal/messages-view.tsx:56`). *(The `approve-signup-request`/`approve_account_request` and the `bind_activation_code` SQL function exist in the baseline but are desktop-side; the website's activation path goes through the EF.)*

**1 Edge Function (REST-style):** `bind-activation-code` — the ONLY EF the portal invokes; `send-push-notification` is server-side only and **actively guarded against portal invocation** (`src/test/t-126-hub-owned-edge-functions.test.ts:72-94`; the repo carries ZERO local EFs — `:63-70`).

**5 storage buckets:** `student-documents` (R+W upload/download), `chat-attachments` (W + signed 300 s), `homework-attachments` (signed), `payment-proofs` (signed), `attendance-justifications` (W upsert). **All five exist in the baseline** (`0001:16810-16843`, private, 10 MB limits); paths are tenant-first (`t-360`/`t-367` regression pins).

**6 realtime channels (postgres_changes, `use-realtime.ts:96-205`):** `notifications` · `chat_messages` ×2 (per-channel + badge) · `installments` (parent filter) · `payments` (parent filter) · `ledger_entries` (parent filter — **documented inert until `ledger_entries` joins the realtime publication**, `:167-169`) · `homework` (class filter). Fallback freshness: TanStack `staleTime 30 s` + `refetchInterval 5 min` (`src/app/providers/index.tsx:36-38`).

## Part 4 — Egress posture (the website's own)

- **`.range()` PAGE_SIZE-1000 pagination** (PostgREST-ceiling-respecting, loops to short page): `fetchAllInstallments` (`portal-queries.ts:268-288`) + `fetchAllLedgerEntries` (`:429-449`) — the **correct** pattern the desktop's Stage A adopts; **the website has NO >1000-row unbounded reads** except the cap-default class (academic_levels, catalogs, etc. — bounded by nature) and two hard caps: chat-unread `.limit(500)` (`:671`, documented LOWER-BOUND count, WEAK-023) + `pricing_configs.limit(1)`.
- Counts via `head:true` zero-row transfers (`:523`). `.maybeSingle()` at 13 sites; **no bare `.single()`** in production code.
- **No `max_rows=1000` violation class in the website itself** (the OLD project's egress quota burn is desktop+portal combined; the portal's share is modest — the daily-active parents' polling + realtime).

## Part 5 — The environment-variable census (every `process.env` consumption)

`NEXT_PUBLIC_SUPABASE_URL` (`env.ts:86`) · `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`:88`) · `NEXT_PUBLIC_FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID/STORAGE_BUCKET/MESSAGING_SENDER_ID/APP_ID` (`:90-100`, committed defaults — Firebase is a SEPARATE project, unaffected by the Supabase move) · `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (`:102`) · `NEXT_PUBLIC_APP_NAME` (`:103`) · `NEXT_PUBLIC_DEFAULT_LOCALE` (`:80`) · `NODE_ENV` (middleware HSTS only). **Complete — no server-side secrets.** Build-time inlining: `NEXT_PUBLIC_*` values are frozen INTO the bundle at build (T-184/ACT-201) — changing Vercel env vars **requires a redeploy to take effect**.

## Part 6 — The regression-pinning tests (the cutover's third rail)

`t-516-website-supabase-cutover.test.ts:37-39` pins `CURRENT_LIVE_PROJECT_REF = "vebfehrpzajhstyhinnw"` + the URL + the publishable key (assertions `:71-72/:84-85/:90-91`; scans the tree so the abandoned `hkvkefubghbbotgnteir` ref never returns, `:94-127`); `t-096…test.ts:59` pins the same URL; `t-107…test.ts:61-62` carries the OLD project's legacy anon JWT as a must-stay-absent scan target. **After the cutover these three pins must be updated in the website repo or its own "must stay green" gate (AGENTS.md §6.1) blocks — a website-repo commit, outside this repo's boundary.**

## Part 7 — The ranked relocation-risk register (OPS-021)

1. **The committed fallback defaults pin the OLD ref and can silently rule the production bundle** (`public-config.ts:89-92` + `.env.example:41-43`) — the T-516 precedent is documented inside the repo itself.
2. **The publishable key is project-scoped** — URL and key must move together (the EF call additionally sends the key as `apikey`).
3. **Three pinning tests go red post-cutover** (t-516/t-096/t-184-adjacent) — a website-repo commit.
4. **Supabase Auth must be reconfigured on the NEW project** (Google provider + site URL + redirect allow-list + any JWT custom claims feeding `current_tenant_id()`/RLS) — dashboard-side, NOT migratable by this repo.
5. **`bind-activation-code` EF must be deployed on the new project** (the repo carries zero local EFs — the activation path 404s against a project without it).
6. **auth.users + all 31 tables' data must survive** (users land in "pending activation" on gaps — silent breakage mode).
7. **The 5 storage buckets AND their objects must be migrated** (signed URLs + downloads point at stored objects; empty buckets = dead attachments).
8. **The realtime publication must include the 6 tables** (else freshness degrades to the 5-minute poll; `ledger_entries` is already inert-until-published by design).
9. **CSP: NO change needed** (`*.supabase.co` wildcard). Firebase/Google-fonts/avatar surfaces are outside the move.
10. **Non-risks (for completeness):** no vercel.json, no middleware auth guard, no service-role credentials, no `.functions.invoke`, no hardcoded site domain — the deployment surface is exactly: two env values (or the defaults file) + three pinning tests + the new project's dashboard-side configuration.

## Part 8 — The Website Cutover, Env Update, Redeploy & Operational Verification checklist (registered as T-614; folded into the Relocation Track — EXECUTION-PLAN §12/§16 + ROADMAP 6.14 + the RELOAD-GUIDE §A.7)

**Preconditions (hard):** the OPS-015 lock holds (T-559/T-560/T-594 green before ANY live traffic, website deploys included); the desktop's relocation lane completed (`T-573 → T-574 → T-575`; the new project carries the consolidated baseline + data + auth users); D-21/OPS-019 (Google OAuth on the new project) done.

1. **Vercel env re-point (the owner/website-repo action):** set `NEXT_PUBLIC_SUPABASE_URL=https://gvuvibcsfjhwcjikgxql.supabase.co` + `NEXT_PUBLIC_SUPABASE_ANON_KEY=<the NEW project's publishable key>` as Vercel project env vars (production + preview) — **or** commit-updated `public-config.ts` defaults per the repo's own T-516 pattern (choose ONE, never leave the OLD defaults in place). Trigger **redeploy** (build-time inlining demands it).
2. **Auth config on `gvuvibcsfjhwcjikgxql` (dashboard-side):** site_url → the portal's final URL; redirect URLs: the dynamic `window.location.origin` means the allow-list must contain the exact live origin (`https://elimtiyaz-website.vercel.app` — and any custom domain when attached; the legacy `app.elimtiyaz.dz`/`portal.elimtiyaz.dz` entries stay per the config.toml parity until the domains are re-pointed or retired); Google provider enabled with the client whose redirect set covers the new project (D-21/OPS-019).
3. **EF deployment parity:** `bind-activation-code` (and the hub-owned 15) deployed per the RELOAD-GUIDE §A.2 list.
4. **Storage + realtime parity:** the 5 buckets with objects; the 6 realtime tables in the publication.
5. **Website-repo test updates:** the three pinning tests re-pinned to the new ref/key (t-516/t-096) — one commit in `Vtheonly/elimtiyaz-website`.
6. **End-to-end operational verification (the smoke gate):** portal loads → Google login completes (no `redirect_uri_mismatch`, no `oauth_exchange_failed`) → the profile/children bootstrap resolves (active, not pending) → finance view renders installments/payments/ledger balances → activation-code path completes on a fresh device → timetable renders (`v_timetable_published`) → documents download (signed URLs) → notifications badge + chat message round-trip → realtime updates arrive (or the 5-min poll fallback is consciously accepted) → FCM token register/unregister. **All GET/browser-verifiable; zero mutations beyond the token/notifications writes inherent to login.**
7. **Honest repo-boundary statement:** the website's SOURCE lives in `https://github.com/Vtheonly/elimtiyaz-website` (now cloned read-only at `/tmp/elimtiyaz-website` for audit; NOT inside `AgentGithubUplaod`); its DEPLOY is Vercel-managed (the PAT exists per OPS-013 but is NOT in this session's env set — the env-var re-point + redeploy are **owner actions through the Vercel dashboard/CLI**); everything else (schema seed, EF deploy, auth config, buckets, publication, data) is driven from THIS repo's relocation lane. **What the owner must supply at cutover time: Vercel access (or the PAT in the session env) + the website repo's push access for the pinning-test commit.**

*Session 27 — read-only; GET-only probes; no key material anywhere in this report (the publishable key string quoted from the website's committed public defaults is a public, non-secret build constant already committed in that repo).*
