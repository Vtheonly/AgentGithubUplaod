# System Map — CURRENT Architecture

> This document describes the architecture **as it exists today** (audited 2026-08-28/29), not as it is intended to become. Where a TARGET state differs, it is explicitly marked `TARGET:`. Confusing the two is forbidden — see the problem registry for the gap list.

## 1. The system at a glance

```
                       ┌────────────────────────────────────────────┐
                       │              SUPABASE (one project)         │
                       │  PostgreSQL + RLS + SQL RPCs (migrations   │
                       │  0001–0043, canonical chain in THIS repo)  │
                       │  Edge Functions (12 in desktop repo,       │
                       │  2 in website repo — one is a drifted      │
                       │  duplicate)  ·  Realtime  ·  Storage        │
                       └───────▲──────────────▲──────────────▲──────┘
                               │              │              │
              direct RPC/table │   RPC + sync │              │ direct queries
              (seed-once cache)│  queue push  │              │ (TanStack Query
                               │              │              │  + realtime hooks)
                   ┌───────────┴───┐   ┌──────┴───────┐   ┌──┴──────────────┐
                   │  DESKTOP      │   │  ANDROID     │   │  WEBSITE        │
                   │  Electron 33  │   │  Kotlin +    │   │  Next.js 16     │
                   │  React 18     │   │  Compose,    │   │  parent portal  │
                   │  staff app    │   │  Room-first, │   │  (read-mostly,  │
                   │  (this repo)  │   │  offline-first│  │  Google OAuth)  │
                   └───────────────┘   └──────────────┘   └─────────────────┘
```

Three repositories, one application, one shared database. The desktop repository (`AgentGithubUplaod`) additionally owns the canonical backend definition.

## 2. Components

### 2.1 Backend / API / Database (authoritative layer)

- **Database**: PostgreSQL via Supabase. Schema defined by the **canonical migration chain `elimtiyaz-desktop/supabase/migrations/0001…0043`** (40 files; 0015–0017 were never used). ADR-001 establishes this chain as the single source for provisioning. The website's `supabase/migrations/0025–0028` are portal patches **absorbed by desktop migration 0043** (their numbers collide with canonical 0025–0028 — problem `CROSS-001`); the Android repo carries 6 stale copies (0034–0036, 0040–0042) that are documentation only (`CROSS-003`).
- **Tenancy & RBAC**: `tenants`, `user_profiles`, `role_assignments` (migrations 0002/0003). `current_tenant_id()` resolves via `auth.uid() → user_profiles.tenant_id`. **Known defect:** `current_user_roles()`/`current_user_permissions()` ignore `tenant_id` (`TENANT-100`), and several admin RLS policies lack tenant scoping (`TENANT-101`).
- **Financial engine (server-side, canonical)**: `collect_and_allocate_payment` (0040 — atomic payment + ledger + waterfall + parent_credit + audit + server receipt number), `revert_payment_allocation` (0041 — LIFO refund; **missing tenant check**, `SEC-112`), `mark_payment_cleared` / `mark_payment_bounced` (0039/0040), `upsert_*_from_import` family (0027/0037 — non-atomic idempotent upserts designed for Excel import and sync push; `upsert_payment_from_import` is SECURITY DEFINER — `SEC-111`).
- **Academic schema**: `academic_years`, `classes`, `subjects`, `class_subjects`, `homework` (canonical, 0029 — NOT legacy `homework_assignments` from 0004), `student_academic_histories` (0029; its only RLS policy is inert — `DEAD-100`/`TENANT-106`), `attendance_records` (0004 + 0041 canonical index + justification columns), `assessments`/`grades` (0029/0041).
- **Edge Functions (desktop repo, canonical set)**: `ai-proxy`, `approve-signup-request`, `bind-activation-code`, `update-server-secret`, `workflow-execute`, `expire-pending-approvals`, `run-overdue-scan`, `refresh-materialized-views`, `purge-expired-backups`, plus **`collect-payment` and `refund-payment` which no client ever invokes** (`DEAD-016`). Four cron EFs accept anonymous calls (`SEC-105`).
- **Edge Functions (website repo)**: `bind-activation-code` (drifted duplicate of the desktop's, with extra user-activation logic — `CROSS-009`, blocked on `UNKNOWN-001`) and `send-push-notification` (broken twice internally and never invoked — `PUSH-100`).
- **Auth**: Supabase Auth with Google OAuth (parents) + email/password (staff). `handle_new_auth_user` trigger auto-creates `user_profiles` + approval request (trusts client-supplied metadata — `SEC-108`).

### 2.2 Desktop (`elimtiyaz-desktop/`, this repo)

- Electron 33 + React 18 + Vite 6 + TanStack Query/Table, Radix UI, Tailwind 3; dinero.js for money; exceljs for the Excel bridge; pdf-lib for receipts/bulletins.
- Architecture: domain layer (`src/domain/` — models + `calc/` engines) → repository layer (`src/infrastructure/{supabase,mock}/repositories/`) → feature UI (`src/features/`) → providers (`src/app/providers/`).
- `getSupabaseRepositories()` overrides ~19 of ~45 repository slots with Supabase implementations; **the rest stay mock** (workforce, chat, clubs, expenses, workflows, …) — `ARCH-001`.
- Canonical TS engine in `src/domain/calc/` (waterfall, balances, overdue, reconciliation, pricing/discounts) — the reference implementation mirrored by SQL and Kotlin.
- Sync: outbound queue in IndexedDB (`SyncService` + `defaultPushHandler`) used by the Excel import path; handles only 4 of 15 entity kinds (`SYNC-100`).
- Known hard defects: payment cache seeds once and never refreshes (`CROSS-104`), no refund UI (`DEAD-015`), silent collect fallback (`BUSINESS-002`), login screen ships 9 staff credentials (`SEC-100`).

### 2.3 Android (`elimtiyaz-android/`)

- Kotlin + Jetpack Compose; Hilt DI; Room as the **local primary store** (offline-first); Supabase Kotlin SDK for auth, RPC push/pull, FCM.
- All repositories bind to `Local*Repository` (`RepositoryModule`); **no Supabase-backed repository exists** — writes go to Room then a sync queue (`SyncSupport` → `SyncQueueDispatcher` → `upsert_*_from_import` RPCs) — `ARCH-003`/`CROSS-005`. This bypasses canonical financial RPCs entirely (TARGET state defined in ADR-005).
- Pull sync: `PullSyncRepository.pullAll()` every 15 min (SyncWorker) + on startup/session change; does not pull academic entities (`HOMEWORK-103`). Zero realtime subscriptions (`REALTIME-104`).
- Known hard defects: SUPER_ADMIN fallback on any failed login (`SEC-101`), email-substring role inference (`SEC-102`), sync dispatcher swallows server errors (`CROSS-200`), overdue KPI permanently 0 (`WEAK-007`), destructive Room migration enabled (`ARCH-004`).

### 2.4 Website (`elimtiyaz-website/`)

- Next.js 16 (App Router) parent portal; TanStack Query (staleTime 30s, no window-focus refetch — `CACHE-100`); Tailwind; PWA; hash routing.
- Auth: Google OAuth via Supabase; **plus a mock-admin system that is still wired and bypassable** (`SEC-007`).
- Reads: parents, students, installments, payments, ledger, homework (`homework` table), attendance, notifications, chat (permanently empty — `CHAT-103`).
- Canonical engine port in `src/lib/canonical/` (26 files, mostly unused — `DRIFT-009`) consumed by `portal-derive.ts` for balance/GPA/attendance computation.
- Writes: activation-code binding, absence-justification submission (no staff review path exists — `ATT-101`), FCM registration (manual opt-in — `PUSH-103`).

## 3. Real data flows (CURRENT)

### 3.1 Payment collection
```
Desktop UI (UnifiedPaymentModal)
  → repos.payments.collect() → client.rpc("collect_and_allocate_payment")   [canonical, atomic]
      ↳ on RPC failure: SILENT FALLBACK → client.rpc("upsert_payment_from_import")  [BUSINESS-002 — payment row only,
        no ledger/waterfall/parent_credit/audit; client-side PAY-YYYY-random receipt number]
Android UI (CounterPaymentScreen)
  → LocalPaymentRepository.collect() → Room write + local waterfall + local receipt (REC-YYYY-count+1)
  → sync queue → SyncQueueDispatcher.pushPayment → upsert_payment_from_import   [CROSS-005; errors swallowed: CROSS-200]
Website: no collect (read-only)
```

### 3.2 Refund
```
Desktop: NO UI PATH EXISTS (DEAD-015). Repository refund() calls revert_payment_allocation with
         hardcoded reason "Manual refund" and possibly wrong actor (BUSINESS-003).
Android: PaymentDetailScreen → LocalPaymentRepository.refund() → Room status flip + local reversal entry +
         local installment revert; sync pushes payment status + ledger entry only (no reason: CROSS-102;
         no installment state: CROSS-103; non-idempotent: BUSINESS-102).
Canonical server path: revert_payment_allocation (LIFO, atomic, audited) — reachable today only by direct SQL.
```

### 3.3 Parent onboarding / activation
```
Google OAuth signup → handle_new_auth_user trigger → user_profiles(pending) + account_approval_requests
  Path A (self-service): parent enters activation code → website bind-activation-code EF
       → bind_activation_code RPC (binds parents.auth_user_id) + website-specific activation
         (status='active' + parent role)  [divergent from desktop EF — CROSS-009, UNKNOWN-001]
  Path B (admin approval): staff → approve-signup-request EF → approve_account_request RPC
       → user_profiles(active) + role_assignments + parents.auth_user_id
```

### 3.4 Homework / attendance (academic)
```
Desktop homework push: INSERT omits tenant_id → always fails 23502 (HOMEWORK-100)
Android homework push: id="hwk-{uuid}" → invalid UUID → always fails (HOMEWORK-101)
Website: reads homework table; realtime subscribed to the DEAD legacy table (WEAK-016)
→ the homework feature is end-to-end non-functional on every platform.
Attendance: desktop roll call upsert triple-broken (ATT-100); Android writes via canonical RPC and works;
            website displays; the justification review workflow has no staff side (ATT-101).
```

### 3.5 Sync & freshness
```
Desktop: Subject-caches seeded once per app session; no realtime (CROSS-104). Sync queue = outbound only.
Android: Room-first; push queue (drains on WorkManager tick); pullAll every 15 min (11 entity types);
         no realtime (REALTIME-104).
Website: TanStack Query + 4 realtime hooks (2 broken: homework table, notifications filter);
         staleTime 30s, refetchOnWindowFocus=false → no fallback freshness (CACHE-100).
```

## 4. Important external dependencies

- **Supabase** (Postgres, Auth, Edge Functions/Deno, Realtime, Storage) — the entire backend.
- **Firebase / FCM** (Android `google-services.json`, website service worker) — push (currently non-functional end to end).
- **Groq / OpenRouter** (via `ai-proxy` EF and BYOK fallback) — LLM features (PII-leak risk: `SEC-002`).
- **Resend** (email; only the signup-approval EF attempts it, and the workflow `send_email` action is a stub — `PUSH-104`).
- **Google OAuth** — parent/staff identity.

## 5. CURRENT vs TARGET (must-read)

| Area | CURRENT | TARGET |
|---|---|---|
| Payment writes | 3 divergent paths (desktop RPC + fallback; Android local + import upsert; website none) | ALL clients write through `collect_and_allocate_payment` / `revert_payment_allocation` (ADR-002); no silent fallbacks (T-011) |
| Android write architecture | Room-first, canonical RPCs never called (ARCH-003) | Online → canonical RPC; offline → durable queue replaying the SAME canonical RPCs (ADR-005, proposed) |
| Payment EFs (`collect-payment`, `refund-payment`) | Dead code, never invoked (DEAD-016) | Decision required: canonical gateway OR removal (UNKNOWN-003) |
| Identity codes | Random/sequential in 5+ paths (DRIFT-001) | Deterministic FNV-1a everywhere (ADR-003, accepted) |
| Receipt numbering | 5 algorithms (DRIFT-011) | Server-authoritative `REC-YYYY-NNNNNN` only (ADR-004, accepted) |
| Migrations | Desktop chain canonical; website/Android partial copies collide (CROSS-001/003) | Single chain in desktop repo; client repos carry no migration files (ADR-001) |
| Chat / push / timetable | Structurally unimplemented or dead (CHAT-103, PUSH-100, SCHED-100) | Product decisions pending (UNKNOWN-005, UNKNOWN-011) |
| Documentation | THIS unified system (2026-08-29) | Maintain it; it is the project's memory |
