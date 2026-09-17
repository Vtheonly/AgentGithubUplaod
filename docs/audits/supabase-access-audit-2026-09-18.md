# Supabase Access-Point Audit — El-Imtiyaz Desktop (2026-09-18, 79th session)

> **Task:** T-390 (root-cause verification mandate — the owner's handed-over "Supabase Root Cause & Remediation Task List" of 2026-09-17).
> **Scope:** every Supabase access path in `elimtiyaz-desktop/src` (the desktop staff client), cross-checked live against the NEW project `vebfehrpzajhstyhinnw` with real credentials on 2026-09-18.
> **Method:** source scan (`rg`) for `createClient`, `.from(`, `.rpc(`, `.auth.`, `.storage`, `.channel(`, `functions.invoke`, `fetch(`, `VITE_SUPABASE`/`SUPABASE_`, `supabase.co` + live REST/SQL probes.

---

## 1. Executive summary — the handed-over report's verdict, corrected by live evidence

The handed-over task list's Root Problems 3–7 were **misdiagnosed as data/parent-ID problems**. Live evidence (2026-09-18) proves:

| Claim in the handed-over report | Live finding (evidence below) | Verdict |
|---|---|---|
| "The database returned `[]` for parent `220e7f65-…` — the parent does not exist" | The parent **EXISTS** on `vebfehrpzajhstyhinnw` (`asdfghgfds asdfghgfds`, tenant `…0001`, `deleted_at` NULL). The `[]` response was an **anon-role** read (no Bearer), which RLS correctly filters. | **DISPROVEN** — the parent exists; the response was RLS-filtered |
| "students table contains existing student records" (implying data migration state) | TRUE — 3 students (2 active, 1 soft-deleted), 7 parents, 1 tenant, 1 auth user, **97/97 migrations**. The NEW project is the zero-data clone + the owner's own live test data (created from the desktop on 2026-09-15/16/17). | **CONFIRMED** (data is owner-created test data, not a migration) |
| "New children cannot be inserted correctly" | `upsert_student_from_import` INSERTs **succeeded** live on 2026-09-17 (12:05:55 `ELV-2026-441FCD`, 14:04:40 `ELV-2026-069F26`) — creation works **when a valid session exists**; the observed failure window is the anon-session state (below). | **PARTIALLY DISPROVEN** — insert path works authenticated |
| "Root cause: credentials/URL" (Problems 1–2) | Already fixed by `f39eb17`/`cc317a6` (URL normalization + production lock). Verified: normal requests carry no `%20`; canonical client locked to `vebfehrpzajhstyhinnw`. | **CONFIRMED RESOLVED** (residual: §4.3) |

**The ACTUAL root cause of "connection works but data does not" (Problems 3/4/5/6/8): a session-state desynchronization in the desktop client** — registered as **AUTH-302** (see `docs/recovery/problem-registry.md`):

- The desktop keeps **two session stores**: the domain session (`el-imtiyaz.session`, with `expiresAt`) and the Supabase SDK session (`el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw`, the JWT that supplies the REST `Authorization: Bearer`).
- When the SDK session is missing/unrestorable/refresh-rejected while the domain session is still time-valid, `AuthProvider.initSession()` **keeps the user "logged in"** (it only evicts when `isExpired(stored)` — `auth-provider.tsx:107`). Every repository call then goes out **as `anon`** → RLS returns `200 []` → the repositories' silent `catch` blocks degrade every cache to `[]` → the UI shows "no parents / no children" with **no error anywhere**.
- This exactly reproduces the owner's console evidence: `GET /rest/v1/parents?select=*&id=eq.220e7f65-… → 200 []` (the `refreshById` query shape, `supabase-shared-repositories.ts:474-479`).

**Live proof (2026-09-18, NEW project):**

```
# 1. Same request WITHOUT a user JWT (the broken-desktop state):
GET /rest/v1/parents?select=*&id=eq.220e7f65-…   apikey only     → 200 []

# 2. Same request WITH the admin's Bearer (the healthy state):
POST /auth/v1/token?grant_type=password  (admin@elimtiyaz.dz)    → 200 (user a148fe34-…)
GET  /rest/v1/parents?select=*&id=eq.220e7f65-…   + Bearer       → 200 [{id: "220e7f65-…", display_name: "asdfghgfds asdfghgfds", …}]
GET  /auth/v1/user                                   + Bearer    → 200 (id, email, role: authenticated)
GET  /rest/v1/students?select=…&limit=10             + Bearer    → 200 [2 active students]
```

Auth → profile → tenant → RLS chain (live, as `postgres` + as `authenticated`):

```
auth.users:            1 user (admin@elimtiyaz.dz, a148fe34-98e3-422a-bf42-91da094e270c)
user_profiles:         1 row (42e369e9-…, status=active, tenant_id=00000000-…-0001)
role_assignments:      1 row (super_admin, tenant …0001, revoked_at NULL)
tenants:               1 row (default tenant …0001 — 0023 seed census intact)
parents: 7 · students: 3 (2 active + 1 soft-deleted) · migrations: 97/97
```

The backend needs **no remediation**. The fix is client-side: session-state synchronization + error surfacing + a deterministic diagnostics screen (T-392/T-393).

---

## 2. Canonical-client census (TASK 2) — exactly ONE client

| # | File | Line | Role |
|---|---|---|---|
| 1 | `src/infrastructure/supabase/supabase-client.ts` | 128 | **THE canonical client** — `createClient()` singleton behind `getSupabaseClient()`. Production locked to `https://vebfehrpzajhstyhinnw.supabase.co` + `sb_publishable_…` key; session storageKey scoped `el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw` |

Every Supabase consumer imports `getSupabaseClient` from this module (census: 20+ infrastructure files, `repository-provider.tsx`, `sync-provider.tsx`, `media-vault.ts`). **No second `createClient` exists in `src/`** — the only other occurrence is `src/tests/integration/t-094-overdue-live.test.ts:48` (a live integration test harness, gated, not shipped).

**Production flags (TASK 3):** `VITE_DESKTOP_PRODUCTION=true` forces URL/key/`useSupabase` to the canonical values (`supabase-client.ts:63,90-108`); `build-windows.mjs:25` pins the same canonical URL into the Windows packaging. The renderer never sees a secret key (ADR-009; the only `sb_secret_`/service-role literals live in `scripts/` live-probe harnesses, never imported by the app).

## 3. Access-point inventory (TASK 1)

### 3.1 `client.auth.*` (auth API)
| File | Operation | Purpose |
|---|---|---|
| `repositories/supabase-auth-repository.ts` | `signInWithPassword`, `refreshSession`, `signOut`, `updateUser`, `getSession`, `signInWithOAuth` | staff sign-in, session refresh (AUTH-301 contract), password change, Google OAuth (portal) |
| `infrastructure/supabase/financial-realtime.ts` | `getSession`, `onAuthStateChange` | realtime re-auth on token rotation |
| `infrastructure/system-config.ts` | `getSession` (line 356) | Bearer for the `update-server-secret` EF DELETE call |

### 3.2 `client.from("<table>")` — tables touched (census counts, non-test)
`installments` (18) · `parents` (16) · `payments` (12) · `notifications` (12) · `academic_years` (12) · `students` (11) · `attendance_records` (10) · `personnel` (9) · `inventory_items`/`deliveries` (7) · `workflows`/`purchase_requests`/`expense_tickets`/`chat_messages`/`audit_logs`/`assessments` (6) · `user_profiles`/`tasks`/`suppliers`/`subjects`/`pricing_configs`/`leave_requests`/`departments`/`classes`/`calendar_events` (5) · `transport_destinations`/`system_settings`/`staff_absences`/`ledger_entries`/`homework`/`grade_level_tuition`/`academic_levels` (4) · `workflow_runs`/`student_documents`/`discounts`/`complementary_services`/`class_subjects`/`chat_channels`/`additional_services` (3) · `workforce_attendance_events` … (2) — plus role/permission lookups in the auth path (`current_user_roles`/`current_user_permissions` RPCs).

### 3.3 `client.rpc("<fn>")` — RPCs called (TASK 17 census)
`write_audit_log` (7) · `upsert_ledger_entry_from_import` (4) · `upsert_student_from_import` · `upsert_parent_from_import` · `soft_delete_student` · `soft_delete_parent` · `notify_parent_user` · `mark_sync_queue_processed` · `execute_batch_promotion` · `current_user_profile_id` · `create_direct_channel` · `upsert_setting` · `upsert_payment_from_import` · `upsert_installment_from_import` · `upsert_attendance_from_import` · `upsert_assessment_from_import` · `set_current_academic_year` · `revert_payment_allocation` · `record_salary_disbursement` · `mark_payment_cleared` · `mark_payment_bounced` · `generate_activation_code` · `fn_finalize_class_placements` · `current_user_roles` · `current_user_permissions` · `current_tenant_id` · `adjust_personnel_salary` (+ `collect_and_allocate_payment` via the payment repository — all migration-created, chain 0001–0099, 97/97 registered live).

### 3.4 `client.functions.invoke` (Edge Functions)
`approve-signup-request` · `bind-activation-code` · `create-user-account` · `delete-user-account` · `workflow-execute` · `ai-proxy` · `update-server-secret` — all via the SDK (session token attached automatically). The 14-EF fleet is deployed + verified on the NEW project (T-379).

### 3.5 Storage
`src/infrastructure/storage/media-vault.ts` → `getSupabaseClient()` (tenant-prefixed paths `<tenant>/<entity>/<file>` — UPLOAD-101..104 conventions; buckets verified live in T-359/T-372).

### 3.6 Realtime
`supabase-chat-repository.ts` (`desktop-chat-realtime`) · `supabase-audit-log-repository.ts` (`desktop-audit-realtime`) · `financial-realtime.ts` (`desktop-finance-realtime-*`) — all `postgres_changes` subscriptions through the canonical client. (REALTIME-105/T-337 — publication membership — remains the standing open item, unchanged by this audit.)

### 3.7 Direct `fetch()` — the ONLY raw URL constructions (TASK 5)
| File | Line | Construction | Status |
|---|---|---|---|
| `system-config.ts` | 410 | `` fetch(`${url}/rest/v1/tenants?select=id&limit=1`) `` — **`validateConnection`** | ⚠️ **UNSANITIZED `url`** — a trailing space/newline passes the `startsWith("https://")` check and becomes `%20/rest/v1/…` (the exact Root-Problem-2 URL). Also: it sends the anon key as Bearer and reports "connected" on a `200 []` — the Task-29 trap. **FIXED in T-392** (normalized URL + honest response classification) |
| `system-config.ts` | 351 | `` fetch(`${supabaseUrl}/functions/v1/update-server-secret?…`) `` — `deleteSecret` | uses the client's own `supabaseUrl` (already normalized) + the user's Bearer — safe |

## 4. Residual risk register (from this audit)

1. **AUTH-302 (root cause, HIGH)** — domain/SDK session desync → anon REST calls → silent empty UI (§1). Fix: T-392.
2. **Error swallowing (OPS-317, HIGH)** — `seed()`-family catch blocks (`supabase-shared-repositories.ts:440-443,710-712` + `refreshById` `catch { /* ignore */ }`) convert auth/RLS/network failures into "no data" with zero diagnostics. Fix: T-392 (surface + classify; keep the honest-empty degradation but record the reason).
3. **`validateConnection` %20 + false-positive (OPS-318, MEDIUM)** — §3.7 row 1. Fix: T-392.
4. **Pre-existing (NOT this session's scope, registered for the record):** `scripts/t-368-verify-live-summary.ts` embeds the OLD project's service-role JWT (SEC-class artifact; old-project scoped); old-project refs (`hkvkefubghbbotgnteir`) in `scripts/` probe harnesses are **intentional** (both-project verification convention) and never enter the shipped app.

## 5. Old-project reference sweep (TASK 4)

`supabase.co` occurrences in shipped app code (`src/`, `electron/`, `vite.config.ts`, `resources/`): **only the canonical `vebfehrpzajhstyhinnw`** (`supabase-client.ts:24-27`, `build-windows.mjs:25`). Old-project refs live exclusively in test fixtures and live-probe scripts (enumerated in §4.4). No old URL/key can reach a production request.

## 6. Verification evidence

- Live probes executed 2026-09-18 (commands + outputs recorded in `docs/recovery/t-390-live-verification.md`): anon read `200 []`, authenticated read `200 [row]`, sign-in 200, `getUser` 200, students read 200, SQL census (parents=7, students=3, tenants=1, profiles=1, auth users=1, migrations=97/97, role_assignments super_admin).
- Source census commands: `rg 'createClient\(' src`, `rg '\.rpc\("' src`, `rg '\.from\("' src/infrastructure`, `rg 'functions\.invoke' src`, `rg 'supabase\.co' --glob …`.

**Audit verdict:** exactly one canonical client; correct project/key/flags; no old-project leakage into shipped code; the `%20` construction path and the session-desync defect are the two client-side residuals, both fixed under T-392 with regression tests under T-392/T-393.
