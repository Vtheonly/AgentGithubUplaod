# SUPABASE RELOCATION & RELOAD GUIDE — the complete operational runbook + blocker register

**Date:** 2026-11-20 · **Session:** S18 · **Status:** READ-ONLY AUDIT OUTPUT (no application source, config, schema, or dependency touched) · **Repo HEAD verified:** `6c0b007e` (main)

**Owner mandate (verbatim intent):** given credentials for a brand-new Supabase account/project, document (1) how to relocate and reload the entire application onto it TODAY — including emergency recovery when the old project is already quota-blocked (`exceed_egress_quota`) — and (2) every hardcoded dependency, architectural trap, and breaking point that makes relocation difficult for non-technical Windows end users, plus the exact refactoring steps to make future relocations effortless with ZERO data loss.

**Relationship to the existing record:**
- `Local-First Architecture/RELOCATION-RUNBOOK.md` (S13) — the DESIGN-level relocation runbook (the BackendProfile concept, the 6-phase procedure, the zero-data-loss guarantees). **This guide is its operational successor**: every phase is now copy-pasteable, with the exact file:line edit list, the exact SQL, and the emergency offline path the S13 runbook deferred.
- `AGENTS_supabase.md` (repo root) — the HISTORICAL relocation record: the current project `vebfehrpzajhstyhinnw` was itself cloned from `hkvkefubghbbotgnteir` (95-migration era). Its lessons (the 54001 stack-depth trap; "N/N migrations applied ≠ functional parity") are folded into §A.2 below.
- `Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md` (S3) — the permanent end-state that retires this guide (§B.2).
- `Deep Sweep/09` (S13) — the egress/traffic-class audit; OPS-015's cap-lift sequencing constraint is a PRECONDITION of any live relocation window.

---

# PART 1 — THE SIX-LAYER RELOCATION AUDIT (every claim personally verified at HEAD `6c0b007e`)

## Layer 1 — Credentials, hardcoded references, build-time vs. runtime configuration

### 1.1 The three-way build-time lockdown (THE core finding)

The old project's URL and public key are locked into the packaged application in THREE independent places, each enforcing the others:

**Lock 1 — the renderer constants (`src/infrastructure/supabase/supabase-client.ts`):**
- `:35-38` — `CANONICAL_PRODUCTION_SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co"`, `CANONICAL_PRODUCTION_PUBLIC_KEY` (the `sb_publishable_…` value, hard-coded), `CANONICAL_PROJECT_REF = "vebfehrpzajhstyhinnw"`.
- `:121` — `isProductionDesktopBuild = readEnv("VITE_DESKTOP_PRODUCTION") === "true"` — a **build-time Vite env flag**.
- `:148-157` — in a production build, `supabaseUrl`/`supabaseAnonKey` are **unconditionally the canonical constants**. The comment at `:142-147` states this is DELIBERATE: *"Production is intentionally independent from persisted desktop settings"* — the runtime `localStorage` override is **ignored by design** in packaged builds.
- `:171-176` — `useSupabase` is forced `true` in production builds (mock mode unreachable).
- `:205` — the SDK session is persisted under `el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw` — **scoped to the OLD project ref** (a migration-mitigation measure from the PREVIOUS relocation, per the `:202-204` comment).

**Lock 2 — the Windows packager (`scripts/build-windows.mjs`):**
- `:25` — `CANONICAL_SUPABASE_URL` hard-coded a second time.
- `:161-163` — `CANONICAL_PUBLIC_KEYS` is a **Set containing exactly ONE key** (the current project's).
- `:177-183` — **fail-closed guard**: if any env var (`VITE_SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_ANON_KEY`, file or process) supplies a DIFFERENT non-empty key, the build **refuses to package** ("Refusing to package: the configured public Supabase key does not match the canonical NEW project"). You cannot even build a foreign-project installer by accident.
- `:205-212` — the build env injects `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`, `VITE_USE_SUPABASE=true`, **`VITE_DESKTOP_PRODUCTION=true`** (which activates Lock 1's hard-code path).
- `:80-97` — `verifyCanonicalSupabase()`: a **live network preflight** — `GET {url}/rest/v1/tenants?select=id&limit=1` with the public key; **any non-200 aborts the build**. **Consequence (new ID OPS-016): while the old project is quota-blocked (402), `npm run package:win` CANNOT produce a Windows installer at all.** The packager is hostage to the old project's billing state.
- `:305` and `:314` — `assertPayloadContainsText(dist, …)`: after building, the script greps the compiled `dist/` payload and **fails unless the canonical URL string is literally present** in the bundle.

**Lock 3 — no `.env` files exist anywhere.** Verified: neither `.env`, `.env.local`, `.env.example`, nor any env template exists in `elimtiyaz-desktop/` or the repo root. All environment comes from (a) the packager's `buildEnv` injection, or (b) process env at dev time. Even `npm run dev` (plain Vite, no env) falls back to the **canonical old project** (`supabase-client.ts:153` — the dev default is LIVE canonical; C-20).

### 1.2 The runtime override surface (dev builds ONLY)

- `src/infrastructure/system-config.ts:95` — `LOCAL_STORAGE_KEY = "el-imtiyaz.local-config"`; the Settings → Configuration tab writes `{supabase_url, supabase_anon_key, supabase_use_supabase}` through `LocalConfigService.saveConnectionAndRestart` (`:482-491`, normalizing via the shared `normalizeSupabaseUrl` seam, `:417` `validateConnection`).
- `supabase-client.ts:123-140` — the client reads this key **only when `VITE_DESKTOP_PRODUCTION` is not "true"** (dev/browser/test builds). Resolution order in dev: `localStorage` → `VITE_*` env → canonical fallback.
- **Conclusion for the "Critical Electron/Windows Check": the URL/keys ARE baked into the compiled renderer bundle at build time. Pointing a PACKAGED Windows client at a new Supabase project requires a source edit + full rebuild + reinstall on every client PC. There is NO runtime config/override mechanism in production builds — by explicit design.** (The dev-mode Configuration tab is the only runtime seam, and it is production-disabled.)

### 1.3 The two-gates family (already registered; relocation-relevant)

- `src/infrastructure/sync/online-detector.ts:177-179` — the 30 s health probe URL derives from the `supabaseUrl` export (canonical in production); `:53-55` — **only 200/401 count as online; the current 402 quota state reads as OFFLINE** (fail-closed — this is why the app today shows offline rather than erroring). After a relocation the probe follows the effective client URL — but until T-559/T-560/BUG-058 land, the Configuration tab's refetch gate falls back to canonical keys (BUG-042) — see §B.1 item 8.
- The Electron main process (`electron/main.cts`) has **ZERO Supabase references** (only `VITE_DEV_SERVER_URL`/`NODE_ENV`) — all backend config lives renderer-side, i.e., in the Vite build.

### 1.4 Where the project ref appears (census: 141 files)

- **1 production source file** (`supabase-client.ts`), 4 test files (pinning hermeticity — `t-472-hermeticity.test.ts` etc.), 2 SQL **comments** (0099, 0101 — informational only, not functional).
- **~134 scripts** under `elimtiyaz-desktop/scripts/` — the live-operation fleet (`apply_*_live.sh`, `t*-e2e.*`, verification probes). All hard-code `PROJECT_REF="vebfehrpzajhstyhinnw"`. The `apply_*_live.sh` family applies migrations through the **Management-API SQL endpoint** (`api.supabase.com/v1/projects/{ref}/database/query`) with `SUPABASE_ACCESS_TOKEN` from the environment (never committed) — **the repo's own migration tooling is blocked today by the 401-invalid management token AND would target the old ref regardless** (§B.1 item 4).

## Layer 2 — Database schema, migrations, extensions, views, functions, triggers, RLS

### 2.1 The chain (the schema IS in-source — verified)

- **Historical chain: 152 migration files (0001 → 0157) — now VERBATIM in `elimtiyaz-desktop/supabase/migrations_archive/` (frozen forensic record, per S24).** The S2 live census (reconstructed from that chain, then live-confirmed where possible) recorded **100 tables, 14 views, 5 materialized views** — the historical basis. **The baseline of record since S24 is `supabase/migrations/0001_initial_consolidated_schema.sql` — the corrected final state: 99 tables (the chain census's "100" counted `receipts`, dropped 0079), 14 views, 5 matviews, 147 functions, 90 triggers, 264 policies (242 public + 22 storage), 11 buckets, 226 FKs, 512 indexes (Deep Sweep/14 Part C.3; re-proven from-scratch by the S26 PGlite audit).**
- **RLS census at HEAD (grep, method recorded):** 109 `enable row level security` statements; 331 `create policy` statements; `auth.uid()` appears 90 times across 28 migration files. (S13's 108/324 count predates 0154-0157; both methods cited. **S26 correction:** these are chain-cumulative grep counts; the FINAL live set is **264 policies — 242 public + 22 storage — per the consolidated-baseline census**, and the relocation verification gates below use the corrected figures.)
- **Extensions (0001_extensions.sql:20-37):** `pgcrypto`, `pgjwt`, `uuid-ossp`, `pg_trgm`, `btree_gist` — all `create extension if not exists … with schema extensions`; `pg_stat_statements` attempted with a graceful `exception` skip. **No `pg_cron`/`pg_net` requirement** — all scheduling is Edge-Function-side (config.toml).
- **Materialized views (0021_views.sql):** exactly 5 — `mv_dashboard_kpis` (:12), `mv_debt_aging` (:57), `mv_top_debtors` (:84), `mv_revenue_by_month` (:103), `mv_grade_summary` (:122). Refresh: the `refresh-materialized-views` Edge Function on a **daily 01:00 UTC cron** (config.toml:114-116). Desktop consumers: **none** (DEAD-019) — the desktop computes from base tables; the MVs serve reporting/portal only.
- **Seeds:** `0023_seed.sql` (24 inserts — the role/permission catalog: super_admin, financial_officer, teacher, support_staff, manager, buyer, driver, warehouse_worker, worker, parent, student + permission rows + role_permissions grants; 0157 later deletes the tournee-specific trio). **There is NO `supabase/seed.sql`** — reference data (tenants, academic years, pricing) is NOT seeded by the chain; it must be exported/imported (§A.3/A.4).

### 2.2 Blank-project completeness — CAN the chain run from zero? YES, with two proven traps

1. **OPS-313 is FIXED at HEAD.** `0096_class_placement_finalize.sql:300-306` now carries the `$function$;` terminator (added 2026-09-15, T-378) — the chain **parses cleanly from scratch** today. (`AGENTS_supabase.md` §5.2 still lists it OPEN — that file is stale on this point; this guide is current.)
2. **The 54001 stack-depth trap is fixed IN-CHAIN by 0099** — but it is the single most important lesson from the previous relocation (AGENTS_supabase.md): a fresh chain that creates the five RLS helpers (`current_user_profile_id`, `current_tenant_id`, `has_role`, `has_any_role`, `has_permission`) **without `SECURITY DEFINER` + `SET search_path`**, or drops the `auth_user_id = auth.uid()` fast-path disjunct from `user_profiles_select_own`, produces an app that is **blank with a wall of 401/500 (54001 stack depth limit exceeded)** even though "N/N migrations applied, N/N policies". The chain as committed carries the fix (0099), so a from-zero push is safe — but **any hand-editing, cherry-picking, or partial re-apply of the chain must re-run the 0099 parity check** (§A.2 verification).
3. **The bootstrap file is a TRAP for full relocations:** `supabase/bootstrap/9000_bootstrap_shared_schema.sql` (1,070 lines) is an idempotent single-file bootstrap for the **SHARED subset only** (consolidating 0001-0028: tenants + default tenant `00000000-…-0001`, minimal user_profiles, parents/students/payments/ledger_entries/installments/sync_queue/device_tokens + the importer RPCs) intended for the Android/importer quickstart ("anyone whose database is empty; anyone who got 390 ignoré(s) on Excel import"). It (a) covers only ~10 of the 100 tables, (b) creates the default tenant with a FIXED well-known UUID, (c) **disables RLS on those tables so the anon key can write during setup**, and (d) **does NOT register anything in `schema_migrations`** — so a later `db push` of the full chain will re-run 0001-0028 against it. **Rule: use the full chain for relocation; use 9000 only for the standalone importer/Android scenario, never both.**

### 2.3 Project-config settings that must be re-created on the new project (`supabase/config.toml`)

- `[api] max_rows = 1000` (the silent-truncation family BUG-059..063 — the new project inherits the same 1,000-row REST cap; do NOT raise it until the truncation lane is fixed, or data will stream, not truncate, and egress will burn),
- `[auth]`: `jwt_expiry = 3600`, `refresh_token_rotation_enabled = true`, `refresh_token_reuse_interval = 10`, `enable_signup = true`, `enable_anonymous_sign_ins = false`, `enable_manual_linking = true`; `[auth.email] enable_signup = false` (email signup is approval-gated — see Layer 3); site/redirect URLs: `http://localhost:5173/auth/callback`, `https://app.elimtiyaz.dz/auth/callback`, `https://portal.elimtiyaz.dz/auth/callback`,
- `[auth.external.google]`: enabled, client id/secret from `env(SUPABASE_AUTH_GOOGLE_CLIENT_ID)` / `env(SUPABASE_AUTH_GOOGLE_SECRET)`, `redirect_uri = https://api.elimtiyaz.dz/auth/v1/callback` — **the Google OAuth client must be re-pointed (or a new client created) and its id/secret set as project secrets on the NEW project**,
- `[auth.hooks] send_confirmation = "approve-signup-request"` — the signup-approval hook (an Edge Function invoked by Auth itself),
- `[edge_runtime] policy = "per_worker"`,
- per-function `verify_jwt` flags + 5 cron schedules (Layer 4).

## Layer 3 — Auth, OAuth providers, and `auth.users` UUID portability (CRITICAL)

### 3.1 The linkage surface — every place `auth.users.id` is baked into data

| Table / object | Column | Migration | Notes |
|---|---|---|---|
| `user_profiles` | `auth_user_id uuid NOT NULL UNIQUE` | 0002:65 | **The login join.** FK to `auth.users(id)` enforced by trigger |
| `account_approval_requests` | `auth_user_id uuid` | 0002:97 | The web-signup approval queue ("the new auth.users.id from web signup") |
| `parents` | `auth_user_id uuid` | 0005:35 | "Bound on activation" — parent portal login |
| `students` | `auth_user_id uuid` | 0005:70 | Student web login (bound on activation) |
| activation codes | `bound_to_auth_user_id uuid` | 0005:114 | Set by `bind_activation_code` (RPC 0055:49; Edge Function of the same name) |
| workforce/personnel linkage | `p_auth_user_id` | 0097:47 | Staff↔personnel account binding |
| payment audit attribution | resolves `user_profiles` **by profile id OR `auth_user_id`** | 0087:30,75 | The desktop passes either form |
| RLS helper functions | `current_user_profile_id()`, `current_tenant_id()`, `has_any_role()`, `has_permission()` | 0003 + 0123 gates | **All key on `auth.uid()`** — 90 `auth.uid()` references in 28 migration files |

### 3.2 What happens on a naive relocation (the lockout, precisely)

The desktop session builder (`supabase-auth-repository.ts:96-100`) does `user_profiles.select(…).eq("auth_user_id", user.id).single()`; no profile row → `Errors.notFound("User profile")` → **login refused**. If users are re-created on the new project by email alone (new UUIDs), every `user_profiles.auth_user_id`, `parents.auth_user_id`, `students.auth_user_id`, activation binding, and personnel link points at UUIDs that no longer exist → **nobody can log in, and parent/student portal bindings are orphaned**. Two valid strategies exist (§A.3.2 / §A.4.3): **preserve the UUIDs** at creation time (admin API honors `user_id`), or **remap by email** with a one-shot SQL pass.

### 3.3 The flows (verified)

- **Staff (desktop):** email/password (`signInWithPassword`, `supabase-auth-repository.ts:65-75`). Password policy ≥8 chars with mixed case + digit (`:190-199`). Password change revokes all sessions globally (`:224-230`).
- **NO self-serve signup on desktop:** new accounts arrive via (a) the web signup → `account_approval_requests` → the `approve-signup-request` EF (wired as the `send_confirmation` auth hook, config.toml:82-84) → activation-code binding (`bind-activation-code` EF + RPC), or (b) admin-created accounts (0044 + the `create-user-account` EF), with the rebind guard (0047) preventing double-binding.
- **Status gates:** `user_profiles.status` of `pending`/`suspended` blocks login with explicit messages (`:108-113`) — **after relocation, the bootstrap admin's profile must be set to an active status and granted a role via SQL** (the previous relocation hit exactly this: `admin@elimtiyaz.dz` auto-profiled by the auth trigger, role approval needed by hand — AGENTS_supabase.md §5.4).
- **Google OAuth:** `signInWithGoogle` redirects to `${window.location.origin}/auth/callback` (`:240-252`) — **a WEB-PORTAL flow** (`portal.elimtiyaz.dz`), not used by the Electron desktop (whose origin is `file://`). Parents authenticate on the portal via Google + a 6-7 digit activation code. The Electron main process registers **no custom protocol/deep-link handler** (verified: no `setAsDefaultProtocolClient`; only `shell.openExternal` for external URLs) — so **no desktop OAuth callback wiring exists to reconfigure; all OAuth configuration lives in the Supabase dashboard + the Google Cloud console**.
- **Passwords are NOT exportable** (Supabase never exposes hashes) → any user-recreation path requires a password reset per user (§A.3.2).

## Layer 4 — Edge Functions, Storage buckets, Realtime, scheduled jobs

### 4.1 Edge Functions (15 deployed dirs + `_shared`; config drift registered as ARCH-046)

| Function | verify_jwt | Cron (config.toml) | Secrets it reads (`Deno.env.get`, verified per-file) |
|---|---|---|---|
| `approve-signup-request` | **false** | — (auth-hook invoked) | platform-injected only |
| `bind-activation-code` | true | — | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `update-server-secret` | true | — | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` |
| `collect-payment` | true | — | platform-injected |
| `refund-payment` | true | — | platform-injected |
| `run-overdue-scan` | true | **daily 08:00 UTC** | platform-injected (+ cron-auth secret per `_shared` convention: `CRON_SECRET` found in the shared config) |
| `expire-pending-approvals` | **false** | **daily 00:00 UTC** | platform-injected |
| `refresh-materialized-views` | **false** | **daily 01:00 UTC** | platform-injected |
| `purge-expired-backups` | **false** | **weekly Sun 03:00 UTC** | platform-injected |
| `ai-proxy` | true | — | `GROQ_API_KEY`, `OPENROUTER_API_KEY` |
| `workflow-execute` | true | — | platform-injected |
| `workflow-resume-scheduler` | **false** | **every 10 min** | platform-injected (`CRON_SECRET`) |
| `send-push-notification` | *(unlisted)* | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `create-user-account` | *(unlisted)* | — | platform-injected |
| `delete-user-account` | *(unlisted)* | — | platform-injected |

- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected per function by the platform at deploy time** — they re-point automatically on the new project.
- **ARCH-046 (config drift, registered this session):** config.toml declares `[functions.export-data]` and `[functions.generate-receipt-pdf]` — **neither directory exists** in `supabase/functions/` (stale entries; a `supabase functions deploy` of the config-listed set would fail for these two); conversely `create-user-account`, `delete-user-account`, `send-push-notification` exist as code but have **no config.toml entry** (they deploy with the CLI default `verify_jwt=true`, which matches expectations — but the drift should be reconciled so the deploy set is explicit).

### 4.2 Storage (fully portable — positive finding)

- **10 private buckets**, all created BY THE MIGRATION CHAIN (0018_storage.sql: inserts into `storage.buckets` + per-bucket RLS): `payment-proofs` (:30), `expense-receipts` (:40), `receipts` (:50), `student-documents` (:60), `homework-attachments` (:70), `task-attachments` (:80), `chat-attachments` (:94), `tenant-assets` (:106), `ai-reports` (:116), `import-reports` (:126). All `public = false`, MIME-restricted, size-limited (e.g. 10 MB), **per-tenant folder structure `{tenant_id}/{entity_id}/{filename}`** (0018:22; the T-362 path canon, `media-vault.ts:66`).
- **No absolute URLs are stored anywhere in the database.** Column audit: `attachment_path` (0004:192 — "storage path under bucket 'homework-attachments'"), `proof_path` (0007:123 — "storage path under bucket 'payment-proofs'") are **bucket-relative text**; `getPublicUrl` is forbidden by design (`media-vault.ts:14` — "no getPublicUrl anywhere"); access is **time-limited signed URLs (5-min) minted at runtime** (`media-vault.ts:9-16`). **Consequence: storage relocation = recreate buckets (the chain does it) + copy objects to the same paths. NO URL-rewrite pass over any table is needed.**

### 4.3 Realtime

- Four production consumers open channels through the shared client (so they follow the client's project automatically): `financial-realtime.ts`, `supabase-leave-request-repository.ts`, `supabase-chat-repository.ts`, `supabase-audit-log-repository.ts` (+ `diagnostics-runner.ts`). Client caps: `eventsPerSecond: 10` (`supabase-client.ts:207-209`).
- Publication membership is migration-defined: `0085` (audit_logs realtime publication), `0106` (personnel), `0049`-era fanout fixes. **A `db push` of the chain recreates publications — no dashboard work needed.**

## Layer 5 — Local offline cache, `sync_queue`, backups, and reconnection (CRITICAL)

### 5.1 The complete local estate on a Windows client (verified inventory)

| Store | Location | Content | Survives restart? |
|---|---|---|---|
| **Pending sync queue** | IndexedDB DB `el-imtiyaz-sync` v1, store `queue` (indexes: status/queuedAt/isMock) — `sync-queue-store.ts:18-51` | `SyncQueueEntry` records (shape below) | **Yes** (unless IndexedDB unavailable → in-memory fallback with a console warn; the UI surfaces it — CACHE-102 `isUsingFallback()`) |
| **Encrypted backup vault** | IndexedDB DB `el-imtiyaz-backup-vault`, store `archives` — `indexed-db-vault.ts:21-31` | `{id, metadata, ciphertext, iv}` — **AES-256-encrypted** snapshots (`aes-256.ts`; salt in `localStorage["el-imtiyaz-backup-salt-v1"]`); manifest carries per-archive counts; installments + workflow schemas included (§13.01) | Yes |
| **SDK auth session** | `localStorage["el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw"]` (`supabase-client.ts:205`) | Supabase JWT + refresh token | Yes (auto-refresh) |
| **Domain session** | `localStorage["el-imtiyaz.session"]` | The app Session (userId, tenant, role, permissions) | Yes |
| **Sync watermark** | `localStorage["el-imtiyaz.sync.lastSyncAt"]` | Last successful drain time | Yes |
| **Dev backend override** | `localStorage["el-imtiyaz.local-config"]` | `{supabase_url, supabase_anon_key, supabase_use_supabase}` (dev builds only) | Yes |
| **In-memory repo caches** | 9 SubjectBehavior caches + `CacheFreshness` (`cache-freshness.ts:32-66`) | Seeded collections; TTL + window-focus re-seed (`shouldReseed()` = `now - seededAt > ttl`) | No (self-healing — first post-swap volley re-downloads everything; OPS-015 class 1) |
| **File exports** | `el-imtiyaz-export/v1`, `el-imtiyaz-full-export/v1` (zip-writer/archive-export.ts) + Excel corpus | ZIP archives of data | Files on disk |
| **Other** | `el-imtiyaz:ai-config`, `el-imtiyaz:ai-copilot-conversation`, `el-imtiyaz:ai-passphrase`, `el-imtiyaz:backup-last-destination-dir`, `el-imtiyaz.splash-played` | AI config (localStorage), last backup dir, etc. | Yes |

**`SyncQueueEntry` shape** (`sync-types.ts`): `id`, `queuedAt`, `lastAttemptAt`, `entity` (14 kinds: parent/student/payment/installment/expense/invoice/ledger_entry/personnel/attendance/grade/homework/audit_log/notification/calendar_event/other), `operation`, **`tenantId`**, **`actorId`**, `payload`, `isMock`, `sourceFile?`/`importRunId?` (Excel provenance), **`basePayload`** (the 3-way BASE — the server-row snapshot the edit started from), `conflict?`, `status`, `attempts`, `lastError`.

### 5.2 The drain and its idempotency guarantees (why replay is safe)

- **30-second poll** (`sync-service.ts:113,459`) + immediate retry after failed attempts; online-gated by the detector (Layer 1.3).
- Pushes go through **8 natural-key idempotent upsert RPCs**: `upsert_parent_from_import`, `upsert_student_from_import`, `upsert_payment_from_import`, `upsert_ledger_entry_from_import`, `upsert_installment_from_import`, `upsert_attendance_from_import`, `upsert_assessment_from_import`, plus `mark_sync_queue_processed` (`default-push-handler.ts:123-360`; the audit upsert is `ignoreDuplicates`). **Replaying a queue twice cannot duplicate rows.**
- **3-way conflict guard** (T-298 OFFLINE-400): for `update` entries carrying `basePayload`, the drain compares base vs. the fresh server row before pushing; any field both sides changed parks the entry in `conflict` status for the resolver modal — **no silent overwrite** (`conflict-detector.ts`).
- `isMock` entries never push (auto-`skipped_mock`).

### 5.3 Scenario analysis

**Scenario A — old project accessible:** the full export ceremony works (S13 RELOCATION-RUNBOOK Phase 2; the staged E7.9 final export). Nothing in the app blocks it. → §A.3.

**Scenario B — old project quota-blocked (THE CURRENT REALITY, 15 probe runs stable):** what already exists locally, and what is missing:
- **Exists on clients:** pending `sync_queue` edits (un-pushable mutations, incl. their basePayloads); encrypted vault archives (AES-256; full-snapshot format incl. installments + workflow schemas); any file exports (full-export ZIPs, Excel corpus — the ORIGINAL source workbooks remain the canonical import input); the repository caches (in-memory only — lost on close, but they mirror server data anyway).
- **Exists NOWHERE client-side:** `auth.users` (UUIDs are recoverable from `user_profiles.auth_user_id` ONLY IF a data export exists; passwords are never recoverable); anything written to the server and never exported/backed-up (the gap window); Storage objects never downloaded (proofs/receipts live server-side only — clients hold signed-URL caches at most).
- **Reconstruction path:** §A.4 — re-import from the Excel corpus / vault archives / export ZIPs through the import engine (the S8 adversarial harness proved the engine's DB write path at 197 tests green; the expected full-scale result is 5,963 installments per the S8 §7.4 note), plus queue replay for post-export edits.

### 5.4 Client reconnection rules (what to clear / what to preserve — verified against the code)

| Local state | On relocation | Why |
|---|---|---|
| `el-imtiyaz.session` (domain session) | **CLEAR** | Points at the old backend's user/tenant context; stale after cutover |
| `el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw` | **CLEAR** (or leave — see note) | Old-project JWT. A rebuilt app with the NEW ref gets a DIFFERENT storage key (the ref-suffix at `supabase-client.ts:205`), so the old session is naturally orphaned — but clear it for hygiene on dev builds that reused the key path |
| `el-imtiyaz.sync.lastSyncAt` | **CLEAR** | Forces a fresh watermark against the new backend |
| IndexedDB `el-imtiyaz-sync` (pending queue) | **PRESERVE** | The zero-data-loss payload — replays via the idempotent RPCs + 3-way guard. Preconditions: the referenced `tenantId` and `actorId` rows must exist on the new project FIRST (they will, if data was migrated) |
| IndexedDB `el-imtiyaz-backup-vault` + `el-imtiyaz-backup-salt-v1` | **PRESERVE** | Rollback artifact + the only local full-snapshot source in Scenario B |
| `el-imtiyaz.local-config` | Dev builds: **UPDATE** (new URL/key via Settings → Configuration); production: irrelevant (ignored by design) | Layer 1.2 |
| In-memory caches | Nothing to do | `CacheFreshness` TTL re-seeds automatically; expect ONE full re-download volley on first launch (OPS-015 class 1) |

**Duplicate/overwrite safety during switchover:** queue replay = idempotent natural-key upserts (no duplicates); 3-way guard parks genuine divergences as conflicts (no silent overwrites); FK failures surface as `Errors.validation` (23503 mapping, `supabase-client.ts:271-273`) and the entry retries/backoffs rather than dropping — the visible symptom of importing the queue before its referenced rows.

## Layer 6 — Cross-app impacts (mobile / web portal / scripts)

- **This repo contains ONLY the desktop app** (`elimtiyaz-desktop/`). The web portal and the Android app are NOT in this repository, but they are coupled to the same backend: config.toml's redirect URLs reference `app.elimtiyaz.dz` and `portal.elimtiyaz.dz` (web apps) and `api.elimtiyaz.dz` (the canonical API host — the Google OAuth `redirect_uri`); the bootstrap file is explicitly written "for the Excel importer + Android app"; the Vercel PAT (validated 200, S13-S17) implies the portal deploys on Vercel. **A relocation MUST re-point the portal + Android builds at the new URL/keys separately — out of this repo's scope, flagged as an owner action.**
- **The vestigial root `src/`** (repo root, `features/` only) is dead code (DEAD-023, S15) — no relocation impact, do not touch.
- **The script fleet** (~134 files under `elimtiyaz-desktop/scripts/`): all hard-code the old `PROJECT_REF`; the `apply_*_live.sh` family drives the Management API (blocked by the 401 token today). After relocation these are historical forensics; new-project operations need a fresh ref (§B.1 item 4).
- **`docs/recovery/`** (change-log, problem-registry, task-registry) and `AGENTS*.md` document the previous relocation — read `AGENTS_supabase.md` before executing §A.2.

---

# PART 2 — SECTION A: THE RELOCATION RUNBOOK (current codebase, step-by-step)

> **Audience:** the engineer/owner executing the move. The end user (Windows operator) never does any of this — at most they install the new build and log in.
> **Precondition order is HARD:** do not skip A.0.

## A.0 — Preconditions (all of these, in order)

1. **Land T-559 + T-560 (the five-site toast-churn family) + the BUG-058 probe fix first** (EXECUTION-PLAN v1.2 §11; OPS-015). If the cap is lifted or live traffic begins before these, the app re-burns egress through five request loops + the 30 s probe drip.
2. **Decide the path:** Path 1 (§A.3) if the old project can be un-quotad for a one-time export window; Path 2 (§A.4) if it stays blocked. (Today: 402 on REST+auth for 15 consecutive probe runs — plan for Path 2 unless the owner lifts the cap.)
3. **Take a local canonical backup NOW** (Settings → backup; the encrypted vault archive) on the primary client — the rollback artifact and, in Path 2, a data source.
4. **Freeze writes** on the old project during the transfer window (operational announcement / off-hours). The app's offline queue keeps accepting local edits — they replay later (§5.4).
5. Collect the new-project credentials: `SUPABASE_URL`, publishable (`sb_publishable_…`) key, secret/service-role key, **database password** (created at project creation — needed for `pg_dump`/`psql`/CLI), and a **fresh management access token** (the current one is 401-invalid).

## A.1 — New Supabase project pre-flight (dashboard steps)

1. Create the project (region eu-west-1 for latency parity with the client base; any region works functionally). **Record the DB password.**
2. **Auth settings parity** (Dashboard → Authentication → Settings / Providers):
   - Email provider: enabled; **disable "Confirm email" self-serve signup parity is per config.toml** — `[auth.email] enable_signup = false` with confirmations on; the desktop has NO self-serve signup (approval workflow) — mirror the config.toml `[auth]` block from §2.3 (jwt_expiry 3600, rotation on, reuse interval 10, anonymous off, manual linking ON — needed for the admin-created-account rebind flows).
   - **URL configuration:** add `https://app.elimtiyaz.dz/auth/callback`, `https://portal.elimtiyaz.dz/auth/callback`, `http://localhost:5173/auth/callback` as redirect URLs (only if the web portal stays in service — otherwise trim).
   - **Google provider:** enable; set the SAME Google Cloud OAuth client id/secret (`SUPABASE_AUTH_GOOGLE_CLIENT_ID`/`SECRET` as project secrets) and keep `https://api.elimtiyaz.dz/auth/v1/callback` as the callback — **or create a new Google client and update the portal config accordingly**. Without this, parent portal login breaks silently.
3. **Do NOT raise `max_rows`** — keep the platform default posture matching config.toml's `max_rows = 1000` until the BUG-059..063 truncation lane lands (raising it changes data-visible behavior mid-relocation).
4. No bucket creation by hand — the migration chain creates all 10 (§4.2). No publication setup — the chain does it (§4.3).

## A.2 — Schema & backend deployment (both paths, identical)

> **Standing rule (S26, OPS-020 — the Charter):** any apply of the schema to a real target runs ONLY after a fresh **100% local from-scratch validation pass** (PGlite + the `0000_local_compat` prologue; the full census on every axis) — see `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md`. The S26 re-validation of `0001`: 2,348 statements, ZERO failures, census-equal on every axis.

```bash
# 1. Link the CLI to the new project (requires the management token):
cd elimtiyaz-desktop
npx supabase login            # paste the NEW access token
npx supabase link --project-ref <NEW_PROJECT_REF>

# 2. Apply the CONSOLIDATED BASELINE (ONE single-pass file — `0001_initial_consolidated_schema.sql`;
#    the 152-file historical chain is frozen forensic history in migrations_archive/, never re-pushed;
#    0099's 54001 fix is inside the baseline; the append-only regime continues from 0002_* beside it):
npx supabase db push          # dry-run first with --dry-run if desired

# 3. Deploy the 15 Edge Functions + set their secrets:
npx supabase functions deploy approve-signup-request
npx supabase functions deploy bind-activation-code
npx supabase functions deploy update-server-secret
npx supabase functions deploy collect-payment
npx supabase functions deploy refund-payment
npx supabase functions deploy run-overdue-scan
npx supabase functions deploy expire-pending-approvals
npx supabase functions deploy refresh-materialized-views
npx supabase functions deploy purge-expired-backups
npx supabase functions deploy ai-proxy
npx supabase functions deploy workflow-execute
npx supabase functions deploy workflow-resume-scheduler
npx supabase functions deploy send-push-notification
npx supabase functions deploy create-user-account
npx supabase functions deploy delete-user-account
#   (do NOT deploy export-data / generate-receipt-pdf — stale config entries, ARCH-046)
npx supabase secrets set GROQ_API_KEY=… OPENROUTER_API_KEY=… \
  FIREBASE_PROJECT_ID=… FIREBASE_SERVICE_ACCOUNT_JSON=… CRON_SECRET=… \
  SUPABASE_AUTH_GOOGLE_CLIENT_ID=… SUPABASE_AUTH_GOOGLE_SECRET=…
#   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected per function.
```

**Migration-application alternative (no CLI):** the SQL Editor route — paste the migrations **in filename order** inside a transaction per file, mirroring the `apply_*_live.sh` convention (each migration + its `schema_migrations` registration in the SAME atomic transaction). The Management-API fleet in `scripts/` can be reused after replacing `PROJECT_REF` (§B.1 item 4) — but the CLI path is simpler and registers versions correctly by itself.

**Verification gate (do not proceed until ALL pass):**
```sql
select count(*) from supabase_migrations.schema_migrations;      -- expect 1 (version '0001' — the consolidated baseline; the 152 historical rows are NOT registered)
select count(*) from information_schema.tables
  where table_schema = 'public';                                  -- expect 99 (+14 views, 5 matviews, 147 functions, 90 triggers)
-- THE 54001 regression test (the previous relocation's failure mode):
select proname, prosecdef, proconfig from pg_proc
 where proname in ('current_user_profile_id','current_tenant_id',
                   'has_role','has_any_role','has_permission');
-- expect: every row prosecdef = true AND proconfig includes search_path=public
select count(*) from pg_policies;                                  -- expect 264 (242 public + 22 storage — the final live set, drops included)
select matviewname from pg_matviews where schemaname='public';     -- expect the 5 mv_* views
select count(*) from storage.buckets;                              -- expect 11 (0018's ten + attendance-justifications)
```
Plus the functional parity proof — **"N/N applied" is NOT parity** (AGENTS_supabase.md rule): run `scripts/verify_t-376.sql` (12/12 PASS expected: authenticated REST reads with JWT claims, BEGIN/ROLLBACK-safe) against the new project. Then an authenticated REST smoke: `GET /rest/v1/tenants?select=id&limit=1` with a real logged-in user's token → 200 (not 401/500).

## A.3 — Path 1: data extraction & reload (old project ONLINE — requires the one-time cap-lift window)

### A.3.1 Export from the old project
1. **Data:** `pg_dump` through the pooler (ports verified OPEN, S13-S17 probes): `pg_dump "postgresql://postgres.<OLD_REF>:<DB_PASSWORD>@aws-1-eu-west-1.pooler.supabase.com:6543/postgres" --schema=public --schema=storage --data-only --inserts` (or the staged E7.9 canonical export via the app's full-export ZIP — the unified pipeline format). `pg_dump` needs **egress headroom on the old project** — the owner must lift the old project's cap for the window.
2. **Auth users:** the admin API (a working management token): `GET /v1/projects/{ref}/auth/users?per_page=…` — capture `id`, `email`, `raw_user_meta_data`, `app_metadata`, `created_at`. **Passwords are not exportable — plan a reset flow.**
3. **Storage:** object listing + download per bucket (11 buckets; the `storage.objects` table lists paths; download via signed URLs or the CLI).

### A.3.2 Reload into the new project (FK-ordered)
1. **Auth users with PRESERVED UUIDs** — the admin `createUser` API honors an explicit `user_id`: for each exported user, `POST /v1/projects/{NEW_REF}/auth/users` with the SAME `id` + email, then trigger a password reset. **This single decision keeps every `user_profiles.auth_user_id`, `parents.auth_user_id`, `students.auth_user_id`, activation binding, personnel link, and audit attribution valid with ZERO remapping.**
2. **Data in FK order** (the load order that satisfies the chain's FKs): `tenants` → `user_profiles` → RBAC (`roles`, `permissions`, `role_permissions`, `role_assignments`) → `account_approval_requests`/activation codes → `parents` → `students` → academic structure (`academic_years`, `classes`, `subjects`, enrollments) → `pricing_configs` → `installments` → `payments` → `ledger_entries` → personnel/workforce → operations/chat/workflow tables → audit logs. (If you restore a full `pg_dump --data-only`, FK order is handled by `--disable-triggers` under the postgres role, or by restoring with `LOAD order` from a schema dump.)
3. **Sequences:** `setval` every serial/identity sequence past the imported max — the classic restore pitfall (`select setval(pg_get_serial_sequence('payments','id'), (select max(id) from payments));` pattern per table; a full pg_dump restore carries setvals automatically).
4. **Storage:** re-upload each object to the SAME bucket + path (`{tenant_id}/{entity_id}/{filename}`) — no DB rewrite needed (Layer 4.2).
5. **Materialized views:** `REFRESH MATERIALIZED VIEW` all five (or wait for the 01:00 cron).
6. **The bootstrap admin:** verify `admin@elimtiyaz.dz` (or the current admin) has an active status + super_admin role assignment via SQL (the previous relocation's §5.4 step).

### A.3.3 Delta pass + cutover
Freeze old writes → delta export of rows changed since A.3.1 → delta import → re-verify counts (closes the window to minutes) → proceed to §A.5.

## A.4 — Path 2: emergency reload from LOCAL state (old project quota-blocked — no cap lift)

> This is the path available TODAY. It reconstructs the new project from what the Windows clients + owner files already hold.

1. **Inventory the sources (in this priority order):**
   a. **Full-export ZIPs / vault archives** (Settings → backup archives; the `el-imtiyaz-full-export/v1` ZIPs) — the richest machine-readable source (schema-aware, includes installments + workflow data).
   b. **The Excel corpus** (`Excel/` at repo root + the owner's filled workbooks) — the canonical import input; the import engine is proven at scale (S8: 197 tests green; expected 5,963 installments at full corpus).
   c. **The pending `sync_queue`** on each client — post-export edits (replays last, §A.5.3).
   d. **Anything else is gone** (server-only writes inside the gap window; storage objects never exported; **auth passwords — always**).
2. **Provision schema:** §A.2 unchanged.
3. **Auth users — the UUID problem, two sub-paths:**
   - **3a. If any data export exists:** it contains `user_profiles` (id, `auth_user_id`, email) → re-create each auth user on the new project **with the exported UUID** (admin API `user_id` honored) → zero remapping; then the password-reset flow per user.
   - **3b. If NO export exists (worst case):** create users fresh (new UUIDs), then **remap by email** — one SQL pass per linkage table:
     ```sql
     -- after creating auth users with known emails:
     update user_profiles up set auth_user_id = au.id
       from auth.users au where lower(au.email) = lower(up.email);
     update parents p set auth_user_id = au.id
       from auth.users au where lower(au.email) = lower(p.email);   -- only where emails match
     update students s set auth_user_id = au.id
      from auth.users au where lower(au.email) = lower(s.email);
     -- activation bindings + personnel linkage: re-bind via the normal activation flow
     -- (safer than blind SQL: the 0047 rebind guard exists for this)
     ```
     Residual risk: parents/students whose portal email differs from any auth user remain unbound — they re-activate via their codes (the designed flow).
4. **Data reconstruction:** run the Excel import (the engine's real DB write path — ImportEngine + RepositoryStorageAdapter + the `upsert_*_from_import` RPCs; idempotent, natural-keyed) OR replay the vault/export archive through the backup restore path (decrypt → verify → apply; note ARCH-029 — restored data lands staged, verify the stage→live propagation for the tables you rely on). Expected result at full corpus: 5,963 installments, per-student balance oracle **1137/1137 + 390/390, maxDelta 0 DZD, 940/197 indebted census** (the S8 oracle — run it; it is the data-integrity gate).
5. **Storage:** unreachable server-side assets are lost unless previously exported; future proofs upload on creation. Document the loss window honestly.
6. Proceed to §A.5.

## A.5 — Switching credentials & reconnecting the Windows clients

### A.5.1 The hard truth first: a rebuild is REQUIRED for production clients

Per Layer 1: production builds hard-code the backend, ignore runtime config, and the packager refuses foreign keys. The **exact source edit list** for a production re-point (this is the minimal diff; nothing else needs touching):

| File | Line(s) | Change |
|---|---|---|
| `src/infrastructure/supabase/supabase-client.ts` | `:35` | `CANONICAL_PRODUCTION_SUPABASE_URL` → the new project URL |
| `src/infrastructure/supabase/supabase-client.ts` | `:36-37` | `CANONICAL_PRODUCTION_PUBLIC_KEY` → the new project's publishable key |
| `src/infrastructure/supabase/supabase-client.ts` | `:38` | `CANONICAL_PROJECT_REF` → the new ref (re-scopes the SDK session storage key — old JWTs are naturally orphaned) |
| `scripts/build-windows.mjs` | `:25` | `CANONICAL_SUPABASE_URL` → the new URL |
| `scripts/build-windows.mjs` | `:161-163` | `CANONICAL_PUBLIC_KEYS` → a Set containing the new key |
| (no other edits — the guard at `:177-183`, the `buildEnv` injection at `:205-212`, and the payload assertion then all validate the NEW values automatically) |

Then `npm run package:win` (native Windows or wine-equipped host; NSIS + portable targets) and **reinstall on every client**. Note: the packager's live preflight (`:80-97`) requires the NEW project to answer 200 on `/rest/v1/tenants` — which it will, being fresh; this also means **no installer can be built while the target project is quota-blocked** (OPS-016).

**Dev-build alternative (no rebuild):** Settings → Configuration tab → enter the new URL + publishable key (`LocalConfigService.saveConnectionAndRestart`) — dev builds only; production ignores it by design.

### A.5.2 Client state transition (per client, in order)

1. **Install the new build** (or apply the dev config).
2. **Clear the stale session keys** (dev builds / hygiene): `el-imtiyaz.session`, the old `el-imtiyaz.supabase.session.<OLD_REF>`, `el-imtiyaz.sync.lastSyncAt`. (In a rebuilt production app the SDK key auto-changes with the new ref — old sessions are inert.)
3. **PRESERVE** IndexedDB `el-imtiyaz-sync` (the pending queue), `el-imtiyaz-backup-vault` + its salt, and any export files. **Do not** "clear application data" or reinstall-with-wipe on clients holding pending edits.
4. **Log in** (the password-reset flow lands users here) → the app comes online against the new project.

### A.5.3 Offline-queue replay (the zero-data-loss step)

- The 30 s drain picks up pending entries automatically and pushes them through the idempotent `upsert_*_from_import` RPCs — duplicates are impossible (natural-key upserts), silent overwrites are impossible (the 3-way `basePayload` guard parks divergences as conflicts for the resolver modal).
- **Preconditions for a clean replay:** the queue's `tenantId`/`actorId` rows must already exist on the new project (guaranteed if §A.3.2/A.4 loaded data before clients connect); otherwise entries retry with FK errors (visible, recoverable — not lost).
- Watch the sync badge settle to "À jour" (up to date); investigate any parked conflicts via the resolver modal.

### A.5.4 First-launch expectations

One full cache re-seed volley per repository (OPS-015 class 1) — expected, one-time. The 30 s health probe now targets the new project (`/auth/v1/health` → 200 with the new key).

## A.6 — Post-relocation smoke & data-integrity verification checklist (ALL must pass)

**SQL gates (run on the new project):**
```sql
-- 1. Census parity vs the export manifest (per-table counts; sample the criticals):
select count(*) from tenants; select count(*) from user_profiles;
select count(*) from parents;  select count(*) from students;
select count(*) from installments;  select count(*) from payments;
select count(*) from ledger_entries;
-- 2. RLS isolation (as an authenticated parent user — the verify_t-376 method):
--    parent sees ONLY their rows; anon sees [] on every table.
-- 3. Auth linkage integrity (after A.3.2/A.4.3):
select count(*) from user_profiles up
  where not exists (select 1 from auth.users au where au.id = up.auth_user_id);  -- expect 0
select count(*) from parents p
  where p.auth_user_id is not null
    and not exists (select 1 from auth.users au where au.id = p.auth_user_id);   -- expect 0
-- 4. MV freshness:
select count(*) from mv_dashboard_kpis;   -- non-zero after refresh
-- 5. Sync audit trail:
select status, count(*) from sync_queue group by status;  -- processed rows match the replay
```
**Functional gates (UI, on a client):** staff login; parent portal login (Google + activation code); dashboard KPIs render; the Encaissement modal completes a payment (the `collect-payment` EF dry path); receipt PDF generates; a proof upload downloads back via a fresh signed URL (storage round-trip); the sync queue drains to zero with no conflicts; the per-student balance oracle (S8 script) reports 1137/1137 + 390/390, maxDelta 0 DZD; the diagnostics tab (Settings → Supabase diagnostics) shows the new host.
**Cron gates:** verify the 5 schedules armed (Dashboard → Edge Functions → each cron function's schedule) and manually invoke `refresh-materialized-views` once.

---

# PART 2 — SECTION B: RELOCATION BLOCKERS & THE EFFORTLESS-RELOCATION REFACTORING PLAN

## B.1 The blocker register (ranked by relocation impact; each with evidence and the exact fix)

| # | Blocker | Evidence (file:line, this session) | Severity | The exact fix (future execution session) |
|---|---|---|---|---|
| 1 | **Build-time credential lockdown — no runtime account switching in production** | supabase-client.ts:35-38,121,148-157,171-176; no `.env*` files repo-wide; build-windows.mjs:25,161-185,205-212 | **BLOCKER** (rebuild + reinstall on every client, every relocation) | **T-573 (new): the BackendProfile service** (RELOCATION-RUNBOOK §2): a versioned profile object `{id, label, kind, url, publishableKey, projectRef, schemaVersion, tenantBinding, syncedAtCursor}` resolved by ONE main-process service exposed via the preload bridge; the compiled-in constants demote to "factory default profile"; the renderer reads the effective profile only. This is the T-559/T-560/BUG-058 single-source fix generalized — same execution lane |
| 2 | **The packager is hostage to the canonical project (and to its billing state)** | build-windows.mjs:80-97 (live preflight, fail on non-200 — **OPS-016**: no installer buildable while the old project 402s), :177-183 (foreign-key refusal), payload-contains-text assert | **BLOCKER** (cannot even BUILD the relocation installer today) | Parameterize the packager: target profile as input (validating against the profile service), the preflight becomes a **readiness check** (schema/census/EFs — §B.3) not a canonical-identity check; the payload assert checks "the EFFECTIVE profile URL is present", not a hard-coded one |
| 3 | **`auth.users` UUID coupling** | The 7-surface linkage map (Layer 3.1); login join at supabase-auth-repository.ts:96-100; passwords non-exportable | **BLOCKER** without the §A.3.2/A.4.3 ceremony | **T-574 (new): relocation auth tooling** — (a) a documented, tested export/import command pair (admin API, UUID-preserving) shipped in `scripts/`; (b) the email-match remap SQL (§A.4.3.3b) as an idempotent script with a dry-run report; (c) the password-reset communication flow. Long-term: LOCAL-FIRST-BLUEPRINT's local auth removes the coupling entirely |
| 4 | **The script fleet hard-codes the old ref + depends on the Management API** | ~134 scripts; apply_*_live.sh `PROJECT_REF="vebfehrpzajhstyhinnw"`; SQL endpoint via `SUPABASE_ACCESS_TOKEN` (401 today) | HIGH (operational, not runtime) | Parameterize `PROJECT_REF`/`SUPABASE_ACCESS_TOKEN` per invocation (env, like the token already is); prefer the CLI (`supabase link`+`db push`) as the primary path so the fleet becomes forensics-only |
| 5 | **EF config drift** — 2 stale entries, 4 unlisted functions | config.toml:134-138 (`export-data`, `generate-receipt-pdf` — no such code); `create-user-account`/`delete-user-account`/`send-push-notification` unlisted (**ARCH-046**, registered this session) | MEDIUM (deploy set ambiguity during relocation) | Reconcile config.toml with the functions/ tree; make `verify_jwt` explicit for all 15; add a CI check (functions/ dirs ↔ config.toml sections) |
| 6 | **`max_rows = 1000` silent truncation** (inherited by the new project) | config.toml:18; BUG-059..063 (DS/09 §1) | MEDIUM (data-visible behavior) | The truncation lane as registered (raise the cap only after the BUG-059..063 fixes land); keep parity during relocation |
| 7 | **The verification surfaces are themselves broken** | ARCH-029 (restore never replays to the live store — backup-file-restore.ts stages only); BUG-061 (`reconcile()` on truncated inputs) | **BLOCKER for the verification gates** (Path 2 relies on both) | Fix ARCH-029/BUG-061 before any Path-2 execution (they are already in the plan of record; this guide adds a relocation consumer) |
| 8 | **The two-gates family** (canonical fallbacks in the probe + Configuration tab) | online-detector.ts:53-55,177-179; BUG-042/T-559/T-560 (DS/12 §2 — five loop-capable sites) | **BLOCKER (precondition)** — post-swap, these paths keep hammering the OLD project | Already the top CRITICAL lane (EXECUTION-PLAN v1.2 §11): T-559 first, T-560 ×5 sites, the BUG-058 probe fix — same fix family as item 1 |
| 9 | **Storage URLs** — **NOT a blocker** (positive finding) | Relative paths only (0018:22; 0004:192; 0007:123); signed URLs at runtime (media-vault.ts:9-16); no `getPublicUrl` | NONE | Nothing to refactor — preserve the invariant: never store absolute URLs (add a lint/CI grep for `supabase.co/storage` in column-writing code paths) |

## B.2 The target end-state (what "effortless" looks like)

After **T-573 (BackendProfile)** + the LF-0..LF-5 arc (LOCAL-FIRST-BLUEPRINT): a backend is a profile object; relocation = "add profile → one full push of local data → cursor re-anchor" (RELOCATION-RUNBOOK §6). The end user sees a file-pick dialog at most. The quota trap is escaped by construction (local engine = system of record; INV-2/INV-5).

## B.3 The one-command relocation preflight (spec, folded as T-575)

A single script (repo `scripts/preflight-target.mjs`) that, given `--url` + `--key` (+ optional `--db-url`), verifies a target project's readiness and prints a pass/fail table: migration count (152), public-table census (100), matview presence (5), bucket census (10), RLS-enabled census (~109), the 5 RLS helpers' `SECURITY DEFINER + search_path` parity (the 54001 regression), EF list vs config.toml (drift check), `max_rows` posture, an authenticated REST smoke, and the `verify_t-376` 12/12. Wire it into the packager (item 2) so `package:win` runs it against the effective profile automatically.

---

## Appendix — quick-reference tables

**localStorage keys (client):** `el-imtiyaz.session` · `el-imtiyaz.local-config` · `el-imtiyaz.sync.lastSyncAt` · `el-imtiyaz-backup-salt-v1` · `el-imtiyaz.supabase.session.<projectRef>` · `el-imtiyaz:ai-config` · `el-imtiyaz:ai-copilot-conversation` · `el-imtiyaz:ai-passphrase` · `el-imtiyaz:backup-last-destination-dir` · `el-imtiyaz.splash-played` · export markers `el-imtiyaz-export/v1`, `el-imtiyaz-full-export/v1`.

**IndexedDB databases:** `el-imtiyaz-sync` (store `queue`) · `el-imtiyaz-backup-vault` (store `archives`).

**Buckets (10, all private):** payment-proofs · expense-receipts · receipts · student-documents · homework-attachments · task-attachments · chat-attachments · tenant-assets · ai-reports · import-reports.

**Edge Functions (15):** see §4.1 table (verify_jwt + cron + secrets).

**Cron schedules (5):** run-overdue-scan 08:00 UTC daily · expire-pending-approvals 00:00 UTC daily · refresh-materialized-views 01:00 UTC daily · purge-expired-backups 03:00 UTC Sundays · workflow-resume-scheduler every 10 min.

**The production re-point edit list:** §A.5.1 table (6 lines across 2 files) — until T-573 lands.

---

*Verification of this document: every file path, symbol, migration filename, function name, bucket name, and line number above was personally read/grepped at HEAD `6c0b007e` during Session 18 (2026-11-20). No application source, config, schema, or dependency was modified. No credentials or token values appear in this document (token-hygiene grep clean).*
