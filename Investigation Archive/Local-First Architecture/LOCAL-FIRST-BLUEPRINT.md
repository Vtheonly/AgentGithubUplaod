# Local-First Architecture Blueprint + Multi-User Sync Strategy — Session 3

**Task ID:** 3-c · **Mode:** read-only design (one file written, nothing implemented) · **Purpose:** the end-state architecture that makes the local Windows machine the PRIMARY database, keeps the app fully functional when every remote service is gone, and still synchronizes data across multiple users/installations — with zero technical setup for end users and no vendor/quota traps for the owner.
**Builds on (read first, not re-derived):** `Database and Supabase/SUPABASE-COUPLING-MAP.md` (today's coupling census — every "how bad is it" claim below cites it), `Database and Supabase/LIVE-CENSUS-2026-11-19.md` (the `exceed_egress_quota` restriction evidence), `Initial Reports Analysis/07-Supabase-report-verification.md` (§4 SQL-vs-TS census, §5 EF inventory, §6 RPC census), `Core Logic Unification/02-import-and-fetching-audit.md` (the repository seam), `Data Pipeline Unification/01-PIPELINE-INVENTORY.md` + `02-UNIFIED-PIPELINE-DESIGN.md` (today's pipeline work — this blueprint owns the backend swap that design explicitly delegates), `Architecture Maps/unified-architecture-map.md`, `Refactoring Unified/ROADMAP.md`.
**Code grounded this session:** `elimtiyaz-desktop/src/infrastructure/supabase/supabase-client.ts`, `src/app/providers/repository-provider.tsx`, `electron/main.cts`, `electron/preload.cts`, `src/vite-env.d.ts`, `src/infrastructure/system-config.ts`, `src/core/rbac/{session,roles,permissions}.ts`, `src/app/providers/auth-provider.tsx`, `src/infrastructure/storage/media-vault.ts`, `src/infrastructure/mock/repositories/{mock-store,auth-repository}.ts`, `src/infrastructure/supabase/supabase-repositories.ts`, `src/infrastructure/sync/online-detector.ts`, `src/domain/repository/repository.ts`.

---

## 1. Objective and constraints

The owner's constraints, restated as **design invariants**. Every later section is scored against these.

| # | Invariant (owner constraint) | Design consequence |
|---|---|---|
| INV-1 | **Local-first:** the PRIMARY database lives LOCALLY on Windows; every read, edit, addition, modification happens locally first. | The renderer's data plane must default to a local store that is always writable; the network is an optimization, never a precondition. |
| INV-2 | **Remote-outage independence:** the app must keep working when every remote service is gone — including today's hard fact: the live Supabase project is restricted (`exceed_egress_quota`, OPS-011; probes still 401/402 per coupling map §6) and live mode is broken against it *right now*. | No boot path, login path, or write path may require a remote round-trip. The current production build violates this (it cannot even start in live mode against a restricted backend, and mock mode is dev-only). |
| INV-3 | **Multi-user sync is required** — local-first does NOT mean zero sync; several people use the app and data MUST synchronize across installations. | A sync layer is in scope; offline divergence must converge deterministically (§7). |
| INV-4 | **Zero-config end users:** clients must never configure backends, migrate databases, or manage cloud accounts (they know basic computer use only). | All configuration is baked at build time or done ONCE by the owner; the end user installs and works. |
| INV-5 | **No vendor/quota traps, ever.** The Supabase freemium quota already locked the app out once; spinning up new accounts/migrating backends/re-verification is unacceptable. | No critical-path dependency on any metered/free-tier service. A quota, plan change, or account death can at most degrade *sync*, never the *app*. |
| INV-6 | **Owner may do ONE-TIME simple setup** (semi-technical). | A single self-hosted component (one install, one config file) is acceptable if it is optional to app function and un-metered. |
| INV-7 | **Windows is the deployment target** (`build-windows.sh` 3-layer chain; `electron/main.cts` + `preload.cts`). | Everything must run inside Electron on Windows: native modules must ship prebuilds; the DB file lives under `userData`. |
| INV-8 | **Durability:** school financial data; no silent loss. | Local durability primitives (WAL, atomic writes, backups) are the new foundation; the existing vault/backup discipline (pipeline design P-2/P-3) rides on top unchanged. |
| INV-9 | **No per-user or metered costs.** | Self-hosted/open-source components only on the critical path; any cloud piece is optional and replaceable. |

---

## 2. Current state in one page

All counts are today's census from `SUPABASE-COUPLING-MAP.md` (cross-checked against the 07-report):

- **Footprint:** 42 files / 26,684 lines in `src/infrastructure/supabase/` (37 adapters = 24,277 lines); 16 edge-function folders (22 .ts / 7,284 lines); 152 SQL migrations (43,388 lines) creating 100 tables / 14 views / 5 matviews (`LIVE-CENSUS-2026-11-19.md` §3); 324 CREATE POLICY / 108 ENABLE RLS (comment-aware census; 07-report methodology ~331/106); 56 distinct RPCs / 89 `.rpc()` call sites; 496 `.from()` queries touching 73 of 99 live chain tables (26 tables are RPC/EF/trigger-only from the desktop — coupling map §7 candidate 7).
- **The seam that exists:** the 54-slot `Repositories` interface (`src/app/providers/repository-provider.tsx:90-167`) with dual-mode selection (`selectDefaultRepositories()`, `:171-192`): mock mode (54 in-memory slots) vs live mode (`getSupabaseRepositories()` = mock spread + **49 overrides**, `src/infrastructure/supabase/supabase-repositories.ts:421-486`; 5 slots stay mock in live mode — ARCH-006). Features are Supabase-ignorant: 165 `useObservable` sites, 0 direct SDK use outside the 11 catalogued bypasses. Fail-closed live boot, Result-typed writes, T-313 anti-fake-success pin (`repository-provider.tsx:203-212`).
- **Where the seam leaks:** 14 bypass files (9 features + `shared/layout/tenant-switcher.tsx:56-62` direct PostgREST query + `sync-provider.tsx` + `system-config.ts` + `media-vault.ts` + `ai/llm-adapter.ts` + sync ×3) — coupling map §3h/§4; mock slots silently in-memory in live mode; `Session` carries GoTrue token fields; the seam swaps the *transport*, not the *logic* (server-side SQL business rules are invisible to it).
- **Why Supabase is irreplaceable today** (coupling map §5 heat map, 5 CRITICAL rows):
  1. **Production hard-lock** — `supabase-client.ts:35-38` (canonical URL + publishable key), `:148-157,171-172` (`VITE_DESKTOP_PRODUCTION=true` ignores local config entirely), and `system-config.ts:431-433` (`validateConnection` rejects every non-`*.supabase.co` URL). A local backend cannot even be *pointed at* without code changes.
  2. **SQL-authoritative financial engine** (ADR-002) — the 56 RPCs are the business logic, not data access; `collect_and_allocate_payment` ×8 redefinitions, `revert_payment_allocation` ×6.
  3. **Authorization lives in 324 RLS policies** that evaporate with the PostgREST gateway.
  4. **GoTrue lifecycle** — sign-in/refresh/global-signout/Google OAuth; staff account creation/deletion via `create-user-account`/`delete-user-account` EFs (GoTrue admin API — no local counterpart exists).
  5. **EF fleet + platform services** — workflow-execute (has a desktop dry-run twin), push notifications (FCM — inherently server-shaped), Storage buckets, Realtime channel over 6 tables (`financial-realtime.ts:58-65,539-546`).
- **What already points local-first** (coupling map §4 "local-first precedents already shipping"): the IndexedDB sync queue + idempotent replay (`sync/sync-queue-store.ts`, `default-push-handler.ts:73-105`); the encrypted backup vault (local ciphertext authoritative, server mirror best-effort, `supabase-backup-repository.ts:20-27`); the AI adapter's edge→BYOK→mock routing (`llm-adapter.ts:15-23`); the port-shaped `AuthProvider` (zero supabase imports, `auth-provider.tsx`); `CacheFreshness` TTL+focus (platform-free); the 0143 composite `(updated_at, id)` keyset sync contract.
- **Live mode is broken right now:** REST root 401/402 `exceed_egress_quota` (coupling map §6) — the strongest possible argument for INV-2.

---

## 3. Target architecture

### 3.1 End-state diagram

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ELECTRON RENDERER (React — unchanged feature layer, 165 useObservable sites)   │
│                                                                                                │
│  features ──useRepositories()──▶ RepositoryProvider ──▶ 54 repository interfaces│
│                                        │              (src/domain/repository/*)│
│                                        ▼                                       │
│                    ┌─────────────────────────────────────────┐                  │
│                    │   DataBackendPort (formal seam, §5)     │                  │
│                    │   LocalBackendAdapter  ◀── DEFAULT      │                  │
│                    │   RemoteSyncAdapter   ◀── optional      │                  │
│                    │   MockAdapter         ◀── dev/tests     │                  │
│                    └───────────────┬─────────────────────────┘                  │
│                                    │ IPC (contextBridge, request/response +     │
│                                    │ change-notification events)                │
└────────────────────────────────────┼────────────────────────────────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ ELECTRON MAIN PROCESS (Node — the new home of data, auth, workflow, files)      │
│                                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ LocalDatabaseService                                                     │  │
│  │   PGlite (WASM Postgres) @ userData/el-imtiyaz/db                        │  │
│  │   - the EXISTING 100-table schema (152-migration chain replayed)         │  │
│  │   - the EXISTING SQL RPC bodies (collect_and_allocate_payment,           │  │
│  │     revert_payment_allocation, fn_* academic state machines, …)          │  │
│  │   - RLS policies kept as backstop behind an auth.uid() compatibility     │  │
│  │     shim (per-transaction app.current_user_id GUC)                       │  │
│  │   - change-log table (outbound op log) + change notifications            │  │
│  └────────────┬───────────────────────────────┬─────────────────────────────┘  │
│  ┌────────────▼───────────┐   ┌───────────────▼──────────────┐  ┌───────────┐  │
│  │ LocalAuthService       │   │ WorkflowService              │  │ MediaStore│  │
│  │ users table + scrypt   │   │ (promoted dry-run engine +   │  │ userData/ │  │
│  │ password hashes,       │   │  overdue scanner = the       │  │ media/    │  │
│  │ session minting, RBAC  │   │  canonized desktop formulas) │  │ (5 buckets│  │
│  │ tables, user-manager   │   │                              │  │  → folders)│ │
│  └────────────────────────┘   └──────────────────────────────┘  └───────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ SyncEngine (reuses sync-service/conflict-detector semantics, §6-§7)      │  │
│  │  op-log drain ▶ SyncTransportPort ▶ { LocalRelay | Supabase(optional) |  │  │
│  │                                   none — fully offline }                 │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
                                     │ (optional, never required to boot/write)
                                     ▼
                 ┌───────────────────────────────────────┐
                 │ Tiny self-hosted relay (owner, once)  │   or   Supabase (demoted
                 │ Node + Postgres, LAN or VPS           │   to optional adapter —
                 │ dumb append-log + keyset pull + FCM   │   §6 option e)
                 └───────────────────────────────────────┘
```

### 3.2 Component responsibilities (and what each absorbs)

- **Local primary store in the MAIN process.** Today the main process is purely a window/file-dialog shell (`electron/main.cts`: window controls, `shell:open-external`, `vault:save-file`, `vault:pick-*` handlers; `preload.cts`: the same six members — verified: zero "supabase" hits in both files, coupling map §3a). The renderer never touches the database: the existing `contextBridge` IPC pattern (which already streams file bytes one-way for backup restore, `electron/main.cts:155-191`) gains request/response + change-event channels. Rationale: durability across renderer reloads, one writer, OS-file control under `userData`, and the renderer stays sandbox-shaped (`contextIsolation: true`, `nodeIntegration: false` — `electron/main.cts:21-26`).
- **The repository seam becomes a formal `DataBackendPort`** (sketch in §5). The 54-slot `Repositories` interface (`repository-provider.tsx:90-167`) is *kept as the feature-facing contract*; the port sits *under* it. THREE adapters: `LocalBackendAdapter` (default; implements the same repository classes against main-process SQL), `RemoteSyncAdapter` (optional relay — including the existing Supabase adapters, demoted), `MockAdapter` (dev/tests, unchanged — the mock store already proves the domain works without Supabase: `mock-store.ts:268-300` `replaceOperationalState`, `armStaging`).
- **Auth becomes local.** `users` + `password_hash` (Node `crypto.scrypt`) + `user_profiles`/`role_assignments`/`permissions` tables *inside the local DB* (the schema already models them — migrations 0003/0023/0053). The existing client RBAC layer (`src/core/rbac/*`: 11-role enum `roles.ts:17-32`, 71-permission enum `permissions.ts:15ff`, `Session`/`can`/`hasRole` `session.ts`) becomes THE enforcement point (it already gates every route and feature; `route-access.ts`, `feature-gate.ts`), with the adapter enforcing row-level checks the way the mock does today (Session-based, no RLS) and PGlite RLS as a defense-in-depth backstop. `MockAuthRepository.signIn` (email-only match, minted token `mock-jwt-*`, `mock/repositories/auth-repository.ts:29-86`) is the working proof that the `AuthRepository` contract (`repository.ts:94-106`) does not need GoTrue. The owner-administered user-manager UI already exists in desktop form (`UserAccountRepository.createAccount/listAccounts/deleteAccount`, `repository.ts:181-197`; Settings accounts tab) — it re-points from EFs to local tables. Per-installation identity: a machine id (already proposed as `sourceMachineId` in the pipeline design's manifest).
- **Edge functions port into main-process services.** Honest inventory (coupling map §3f): 4 of 15 callable EFs have real local counterparts — `ai-proxy`→BYOK direct path (`llm-adapter.ts:15-23`); `workflow-execute`→the desktop dry-run engine + condition evaluator (engine was ported FROM the desktop, 07 §5; resolve the 0088 `has_medical_justification`/`source_handle` divergence); `run-overdue-scan`→`supabase-overdue-alert-generator.ts` (the fuller INV-4 formula — canonize it, delete the EF twin); `update-server-secret`→obsolete (secrets become local config). Port with bounded work: `bind-activation-code` (same rules as local logic — single-use `activation_codes` table + ADR-011 status gates), `approve-signup-request` (approval UI is already desktop-side; the role-escalation guard moves into `LocalAuthService`), cron family (`expire-pending-approvals`, `purge-expired-backups`, `refresh-materialized-views` → main-process scheduled tasks; matviews become plain views or computed queries — `mv_grade_summary` refresh is already broken, BUG-006 class). **What dies without a server:** `send-push-notification` (FCM HTTP v1 needs a server with credentials — §10), Google OAuth (`signInWithOAuth`), and Resend email (becomes a relay job or an SMTP config).
- **Storage becomes local filesystem.** `media-vault.ts` already defines the exact interface (`uploadPrivateMedia`, `freshSignedMediaUrl`, 5 private buckets, `:86-133` upload / `:141-180` signed URLs) and its mock proves the shape works without Supabase (in-memory registry `:81-84`). Local adapter: `userData/media/<bucket>/<tenant>/<entity>/` + no signing (renderer reads via an IPC file channel); the migration path 0018 convention `<tenant>/<entity>/<filename>` is kept verbatim. This also **absorbs** the pipeline design's H-2 (therapy attachment bytes discarded today, `therapy-attachments-card.tsx:63-75`) — the local `MediaStore` makes the planned bucket migration a folder, not a SQL migration.
- **Realtime becomes the local store's change notifications.** Realtime today only *invalidates caches* (TTL+focus do the real work, coupling map §3d); the 30s fallback poll and window-focus re-seed already suffice single-user. `LocalDatabaseService` emits change events (table+op) over IPC → `LocalBackendAdapter` pokes the same `CacheFreshness` invalidation → **all 165 `useObservable` sites keep working unchanged**. Multi-user freshness arrives via the relay (§6): a push notification "streams X changed" over the transport, same invalidation call. `financial-realtime.ts`'s channel goes away; its debt-facade swap (`Object.defineProperty`, `:379`) and canonical replay are replaced by the adapter's own notify.

### 3.3 The IPC boundary and the adapter porting mechanics

**IPC contract (new, minimal):** four channels on the existing preload bridge (`electron/preload.cts:113-139` pattern), all request/response except the event feed:

```
db:request   { id, kind: "query" | "rpc" | "upsert" | "tx", payload }  → { id, ok, value | error }
db:changes   (main → renderer event) { table, op, ids? }      — the invalidation bus
auth:request { id, kind: "signIn" | "signOut" | … , payload }  → { id, ok, value | error }
media:request { id, kind: "put" | "get" | "url", payload }     → { id, ok, value | error }
```

The renderer keeps ZERO SQL strings for the ports it already abstracts — but note honestly: today's 37 Supabase adapter files DO embed SQL-adjacent knowledge (select column lists, `.order()`, keyset pagination shapes). The port keeps that knowledge where it is.

**How a Supabase adapter becomes a Local adapter — the mechanical recipe** (this is the LF-1 unit of work, repeated ~37 times):

| Supabase adapter idiom (today) | Local adapter equivalent | Reused verbatim |
|---|---|---|
| `client.from("students").select(cols).eq("tenant_id", t).order("id")` | `port.read({ table: "students", cols, where, orderBy })` → main-process SQL builder | column lists, filter shapes, row mappers (`mapStudentRow`, `mapParentRow` …) |
| `client.rpc("collect_and_allocate_payment", args)` | `port.execute({ rpc: "collect_and_allocate_payment", args })` → `SELECT * FROM collect_and_allocate_payment(…)` inside a PGlite transaction | the RPC name, args shape, result mapping — and the SQL body itself (unchanged, in the DB) |
| `paginateKeyset(pageSize, after)` (shared-repositories) | same cursor math over `port.read` | all of it — the 0143 `(updated_at, id)` cursor arithmetic is transport-free |
| `readWithSeedRetry` / `runGatedCollectionRead` | same retry/gating logic around `port.read` | all of it |
| `SubjectBehavior` cache + `CacheFreshness` | identical — the adapter's subject is poked by `db:changes` instead of realtime | all of it (26 adapters already share the primitive — architecture map §4.3) |
| `uploadPrivateMedia(bucket, …)` (media-vault.ts:92-133) | `media:request put` → `userData/media/<bucket>/…` | path convention (0018), size/content-type metadata |

The lesson from the factory comment at `supabase-repositories.ts:445-453` (T-498: `promotionCycles` implemented but never wired) is registered as a finding candidate (§12.4): the local factory needs a compile-time exhaustiveness check so an unwired slot cannot ship silently.

---

## 4. Local persistence engine — evaluated

Decision matrix — scored 1 (bad) to 5 (good) against the invariants (§1). "ADR-002 handling" is the decisive criterion: where does the SQL-authoritative business logic live?

| Criterion | (a) PGlite (WASM Postgres, main process) | (b) better-sqlite3 + schema translation | (c) RxDB | (d) In-memory + file snapshots (mock + vault) |
|---|---|---|---|---|
| Runs the EXISTING schema (100 tables / 152 migrations) | **5** — Postgres dialect; chain replays nearly verbatim (§8) | 2 — SERIAL/uuid/jsonb/arrays + 324 policies + 56 PL/pgSQL RPCs all need translation | 1 — NoSQL documents; full re-model of 73 queried tables | 1 — no schema at all |
| ADR-002 financial engine (`collect_and_allocate_payment` ×8 defs, `revert_payment_allocation` ×6) | **5** — RPC bodies run AS-IS in-transaction; TS mirrors stay mirrors; parity suites keep passing | 2 — must promote TS to sole authority OR port PL/pgSQL to triggers; the 0087 allocations/bulk_import SQL gaps then need fixing in TS | 1 — full TS promotion with no transactional RPC concept | 1 — TS-only, weakest |
| 21 academic `fn_*` RPCs with NO TS mirror (promotion cycles, re-enrollment, placements — coupling map §5 row 6) | **5** — keep running as SQL; zero port | 1 — the largest correctness risk of option (b): state machines rewritten blind | 1 | 1 |
| RLS estate (324 policies / 108 enables) | **4** — policies run; needs an `auth.uid()` shim (§8); `SECURITY DEFINER` helpers work | 1 — SQLite has no CREATE POLICY; re-home into TS/triggers | 1 — enforcement fully in app code | 3 — mock already enforces via Session, but no data-plane enforcement |
| Perf at school scale (≈741 parents / 390 students / ~2,600 ledger rows — pipeline manifest example; even ×10) | 4 — WASM overhead is real but irrelevant at this scale; single-connection is fine for one desktop | **5** — fastest native option | 3 | 5 (until volume grows) |
| Electron/Windows integration | 4 — pure WASM, no native rebuild, no electron-rebuild pain (INV-7); asset ~a few MB wasm, boots in ~100 ms (verify against current release) | 3 — native module; prebuilds exist for Windows but every Electron upgrade re-checks ABI | 4 — pure JS (+ optional SQLite storage) | **5** |
| Maturity / risk | 3 — Apache-2.0 (ElectricSQL team), active, production users, but young; single-connection by design | 5 — battle-hardened | 4 — mature, observable-first | 5 — already shipping in the app (mock mode) |
| Migration effort (from today's adapters) | **4** — adapters keep their SQL; swap `client.from()/rpc()` calls for port calls | 1 — largest rewrite in the codebase's history | 1 | 2 |
| Query/observable story | 4 — SQL → adapter → `Observable` (existing `SubjectBehavior` idiom) | 4 | **5** — RxDB is observable-native | **5** |
| **Weighted total (ADR-002 ×3, fn_* ×2, schema ×2)** | **Recommended: 4.4** | 2.0 | 1.7 | 2.3 |

**Recommendation: (a) PGlite in the Electron main process.** It is the only option where the *business logic* does not move — ADR-002's principle (one canonical writer, atomic, audited) survives with its LOCATION inverted (server → main process), not its authority broken. The 21 academic `fn_*` state machines — the biggest single migration risk in the coupling map (§5 row 6, "no TS mirrors") — simply keep executing. The Postgres error-code mapping in `supabase-client.ts:260-290` (23505/23503/42501/PGRST116) keeps working for local PG errors (PGlite IS Postgres — same SQLSTATE codes; only the `PGRST116` PostgREST code disappears with the gateway).

**Honest assessment of PGlite (the claim-by-claim version):**

| Concern | Assessment | Mitigation / gate |
|---|---|---|
| Bundle size | The WASM asset is single-digit MB compressed; the DB file itself starts <1 MB. Acceptable inside an Electron installer that already ships Chromium. | measure in LF-1 spike; hard ceiling gate: installer growth < 30 MB |
| Performance | WASM Postgres is slower than native — but the workload is one school: hundreds-to-thousands of rows per table, single-user interactive queries, occasional bulk imports (the 1,170-entry import burst already flows through chunked idempotent upserts, inventory §2.3). Sub-100 ms interactive reads are expected; verify with the t-368-scale corpus (the import-engine fixture builder already generates school-scale data, `scripts/build-test-fixture.ts`). | LF-1 perf gate: import of the full corpus + the 18-subscription heaviest pages (`financials-page`) under the current Supabase-mode timings |
| Single connection | By design — no concurrent writers within the process. Our topology has exactly one writer (the main process); the renderer goes through IPC anyway. Multi-process access (two app instances) is a non-goal; enforce single-instance lock (Electron `app.requestSingleInstanceLock`). | add single-instance lock in LF-1 |
| Electron/Windows integration | Pure WASM — no `node-gyp`, no `electron-rebuild`, no ABI matrix on Windows upgrades (INV-7). Runs in the main process's Node context; persistence = one directory under `userData` with WAL. | spike on the packaged Windows build in LF-1 |
| Extension coverage | PGlite supports a curated extension set; the chain's needs must be verified: `pgcrypto`/`gen_random_uuid()` (used across the chain), any `pg_trgm`/etc. (grep the 152 migrations in LF-0 — the census script pattern from LIVE-CENSUS §3 applies). | LF-0 gate: extension census over the chain; any gap gets a compat shim or blocks the fallback decision |
| RLS support | Postgres RLS works — but the policies call Supabase's `auth.uid()`; an `auth` schema shim reading a per-transaction GUC covers the dominant pattern (`auth.uid()` short-circuit, 0099; InitPlan hoists, 0126). Policies with JWT-claim access beyond `uid()` need a case-by-case pass. | LF-1 gate: policy-parse census = 324/324; run the RLS probe scripts (`scripts/t418-live-smoke.sh` pattern) against local PGlite |
| Maturity | Apache-2.0, built by the ElectricSQL team, actively maintained, production users exist — but it is a young project compared to SQLite/Postgres. This is the accepted risk, priced against the alternative risk of rewriting 56 RPCs + 21 state machines (§4 matrix). | named fallback (b) with pre-agreed trigger gates |

**Fallback: (b) better-sqlite3**, triggered if PGlite fails any LF-1 gate (perf, stability, extension coverage, packaging). Accepted cost of the fallback: TS promotion of the financial core (mirrors exist and are parity-pinned — 07 §4 — but the SQL's `payment_allocations`/`bulk_import` gaps from 0087 would then need fixing IN TS), plus rewriting the 21 academic `fn_*` state machines with no reference mirror, plus re-homing 324 policies into app-layer checks — roughly **doubling** LF-1/LF-2 effort and moving the biggest correctness risk from "runs the proven SQL" to "re-derives the SQL". (d) remains the dev/test mode permanently; (c) RxDB is rejected — it duplicates the benefit the existing observable layer already provides (`SubjectBehavior` + `useObservable`) while forcing a full data re-model.

---

## 5. The decoupling boundary

Five ports (proposed home: `src/domain/ports/`). For each: what implements it today (paths from the coupling map) and what changes.

```ts
// ── DataBackendPort — the formalized repository seam ────────────────────────
// Sits UNDER the 54-slot Repositories interface (repository-provider.tsx:90-167).
export interface DataBackendPort {
  readonly id: "local-pglite" | "supabase-relay" | "mock";
  // Reads honor the existing Observable<T> contract (repository.ts:88-92) —
  // the 165 useObservable sites are untouched.
  observe<T>(spec: ReadSpec): Observable<T[]>;
  read<T>(spec: ReadSpec): Promise<T[]>;
  // Mutations are RPC-SHAPED (name + args), executed inside the backend with
  // full transactionality — collect_and_allocate_payment, fn_*, … keep their names.
  execute<T>(op: { rpc: string; args: Record<string, unknown> }): Promise<Result<T>>;
  upsertMany(table: string, rows: Record<string, unknown>[]): Promise<Result<number>>; // import/sync path
  transaction<T>(fn: (tx: DataBackendPort) => Promise<T>): Promise<T>;
  changes(): Observable<BackendChange[]>;   // replaces the realtime channel
  migrate(target?: number): Promise<Result<{ applied: number }>>; // chain replay/advance
}
```
- Today: the seam is implicit — `getSupabaseRepositories()` (`supabase-repositories.ts:421-486`) and `mockRepositories` (`infrastructure/mock/mock-composite.ts`) both satisfy the 54 interfaces. Change: a third factory `getLocalRepositories()` slots in; `selectDefaultRepositories()` (`repository-provider.tsx:171-192`) becomes a **three-way** selection (local default / relay / mock) with the fail-closed contract kept for the relay path and removed for local (local cannot be "unconfigured").
- **Migration step zero (the hard-lock removal, coupling map §5 rows 1+5):** delete the canonical pin in `supabase-client.ts:35-38,148-157,171-172` (`VITE_DESKTOP_PRODUCTION` no longer ignores local config); replace the `.supabase.co`-only check in `LocalConfigService.validateConnection` (`system-config.ts:431-433`) with backend-kind-aware validation (local = no URL; relay = any `https://` origin; supabase = current check); unpin the session storage key from the project ref (`supabase-client.ts:205`). Nothing else in the plan is reachable until this lands.

```ts
// ── AuthPort — local identity + admin account lifecycle ─────────────────────
export interface AuthPort {
  signIn(email: string, password: string): Promise<Result<Session>>;          // repository.ts:94-106
  signOut(scope: "local" | "all-devices"): Promise<Result<void>>;
  refreshSession(): Promise<Result<Session | null>>;
  changePassword(current: string, next: string): Promise<Result<void>>;       // SEC-103 contract kept
  // Admin surface (was UserAccountRepository + approval EFs):
  createAccount(input: CreateAccountInput): Promise<Result<CreatedAccount>>;   // repository.ts:181-197
  deleteAccount(id: string): Promise<Result<void>>;
  listAccounts(): Promise<Result<AccountOverviewEntry[]>>;
  issueActivationCode(parentId: string): Promise<Result<{ code: string }>>;   // ADR-011 lifecycle, local
  bindActivationCode(code: string): Promise<Result<void>>;
}
```
- Today: `supabase-auth-repository.ts` (GoTrue), `supabase-user-account-repository.ts` (create/delete-user-account EFs), `supabase-approval-repository.ts` (approve/bind EFs) — all Sev-5/CRITICAL (coupling map §3b/§3c). Change: ONE `LocalAuthService` in the main process (scrypt hashes, session minting, activation-code single-use rules from SQL 0055, role-escalation guard from `_shared/role-assignment.ts` — that core is deliberately Deno-free and already imported by desktop vitest, coupling map §3f). The `Session` shape survives (mock already mints fake tokens, §7 identity note).

```ts
// ── SyncTransportPort — dumb byte-pipe, swappable ───────────────────────────
export interface SyncTransportPort {
  push(ops: SyncOperation[]): Promise<Result<{ acks: Array<{ id: string; seq?: number }> }>>;
  pull(cursor: KeysetCursor, limit?: number): Promise<Result<{ ops: SyncOperation[]; next?: KeysetCursor }>>;
  onRemoteChange(cb: (n: { streams: string[] }) => void): () => void;  // invalidation bus
  status(): Observable<"online" | "offline" | "degraded">;             // replaces online-detector's Supabase probe
}
export type KeysetCursor = { updated_at: string; id: string };  // the 0143 composite keyset contract
```
- Today: `default-push-handler.ts` (idempotent `upsert_*_from_import` dispatch), `sync-queue-store.ts` (durable IndexedDB queue), `online-detector.ts:22,41-46` (Supabase `/auth/v1/health` probe — coupling map §7 candidate 4), 0143 `pull_*_for_sync` keyset RPCs. Change: push handlers become transport posts; pull stays keyset (the cursor semantics are kept verbatim); the probe becomes a relay-health check. The queue, debounce/backoff, conflict parking, and tenant/actor safety in `sync-service.ts` (inventory §2.3) are reused.

```ts
// ── NotificationPort — in-app always local; push optional ───────────────────
export interface NotificationPort {
  notifyParentUser(parentId: string, payload: AppNotificationPayload): Promise<Result<void>>; // RPC 0077 → local insert
  sendPush(deviceTokens: string[], payload: PushPayload): Promise<Result<void>>;              // needs relay+FCM (§10)
}
```
- Today: `notify_parent_user` RPC (`supabase-shared-repositories.ts`), `send-push-notification` EF (service-role only). Change: in-app notification is a local table write; push is delegated to the relay when configured, and *skipped honestly* when not.

```ts
// ── DiagnosticsPort — the Settings tooling behind one door ──────────────────
export interface DiagnosticsPort {
  describeBackend(): { kind: string; version?: string; writable: boolean; lastCheck?: string };
  runReadProbe(table: string): Promise<Result<{ rows: number; ms: number }>>;
  runCrudProbe?(…): Promise<Result<…>>;   // supabase-only — absent in local mode
  listMedia(): Promise<Result<MediaCensus>>;  // was listBuckets (diagnostics-runner.ts:527)
}
```
- Today: the 6 settings diagnostics/config surfaces importing `supabase-client` directly (ARCH-019; coupling map §3h) + `describeSupabaseConnection` (`supabase-client.ts:226-255`). Change: this is F-U3's `PlatformDiagnosticsPort` (import audit §2.4) generalized to backends; the remaining bypasses (`tenant-switcher.tsx:56-62`, `parent-detail-drawer.tsx:99,331`) route through repositories/ports.

---

## 6. Multi-user sync — options evaluated

Scored 1–5 against §1 invariants. "Multi-user correctness" = conflict handling + convergence; "zero-config" = end-user effort after the owner's one-time setup.

| Option | Multi-user correctness / conflicts | Zero-config end users | Quota-trap freedom (INV-5/9) | Windows fit | Effort | Maturity / risk | Offline behavior | Verdict |
|---|---|---|---|---|---|---|---|---|
| (a) **Tiny self-hosted relay** (Node + Postgres on owner VPS or a school PC; dumb append-log + keyset pull + sequence assignment; app reuses queue/conflict machinery) | 4 — relay sequences financial ops (total order ⇒ deterministic convergence); 3-way merge for entity edits (existing `conflict-detector.ts`) | **5** — app ships pre-configured; users just install | **5** — owner's own box, un-metered | 5 — relay is Linux/Windows-friendly; client side is plain HTTP | 3 — moderate: new small service + transport adapter (§5) | 3 — custom code the owner owns; built from already-tested desktop parts | **5** — full function offline; queue drains later | **RECOMMENDED (primary)** |
| (b) CRDT peer sync (cr-sqlite / Yjs-style merges over WebDAV/S3/shared folder/USB) | 3 — row-level CRDT convergence is good, but the financial model is canonical-writer/transaction-shaped; CRDT merges can violate audit/waterfall invariants | 4 — folder/URL paste once | 5 | 4 | 2 — forces SQLite (see §4: rejects PGlite ⇒ the 56-RPC/21-state-machine port) AND a CRDT schema layer | 2 — cr-sqlite is early-stage; Yjs fits documents, not relational finance | 5 | **Fallback** if the owner refuses ANY server |
| (c) ElectricSQL (self-hosted Postgres sync) | 4 | 4 | 4 | 3 | 2 | **1** — the classic sync server is discontinued/pivoted (verify before any consideration); client is its own PGlite dialect | 4 | Rejected — product risk recreates the vendor trap with different branding |
| (d) PowerSync | 4 — mature local-first sync service | 4 | 2 — self-hosting exists but the licensing model is commercial-tier-dependent (verify current terms) | 3 | 2 — requires the PowerSync client (SQLite-based) ⇒ re-platform away from PGlite/SQL RPCs | 4 — solid product | 5 | Rejected as primary (platform + licensing); note as a revisit option if (a) fails and SQLite (fallback engine) is in play |
| (e) **Supabase retained as OPTIONAL relay** (the existing adapters, demoted behind the boundary) | 3 — same as today's queue+keyset | 5 (already configured) | **2 as critical path / 5 as optional** — the whole point: local-first makes the quota non-fatal | 5 | **5** — near-zero new code | 3 — the quota ALREADY fired (OPS-011) | 5 (with local primary) | **Kept during transition** — the demotion itself is LF-5 |
| (f) Naive shared-folder single-file DB (SMB path to one DB file) | 1 — no conflict handling at all | 3 | 5 | 1 — SMB opportunistic locking + partial writes over WAN = corruption roulette; two writers = lost updates | 4 | 1 | 1 (single point) | **Rejected** — file-locking semantics over SMB are exactly the durability trap INV-8 forbids |

**Recommendation: (a) a tiny self-hosted relay, with (e) Supabase-as-optional-relay retained during the migration window and (b) as the named zero-server fallback.** The relay is *dumb* by design: authenticated clients POST operations (the relay assigns a global sequence), clients pull by `(updated_at, id)` keyset cursor (0143 semantics), and the relay holds the FCM credentials for push if the owner keeps it. It reuses the app's own already-tested sync machinery (queue, backoff, 3-way guard, tenant/actor safety — inventory §2.3) instead of importing a sync platform. Owner one-time setup = install one small service on a VPS (~un-metered fixed cost) or a always-on school PC; end users see nothing (INV-4). If the relay dies, the app is unaffected (INV-2) — only cross-machine sync pauses; the local vault/backup discipline (pipeline P-2/P-3) covers local durability.

**Per-option notes (the honest version behind the matrix scores):**

- **(a) Tiny relay.** The strength is architectural reuse: `sync-service.ts` (747 lines) already implements debounce, exponential backoff, mock invariants, tenant re-scope, and conflict parking; `default-push-handler.ts` already defines the idempotent push semantics; 0143 already defines the pull cursor. The relay is a new but SMALL component (~a few hundred lines: auth, append-log, keyset read, sequence minter, optional FCM forwarder) — the effort score of 3 reflects the client-side transport re-pointing more than the relay itself. The weakness is that the owner now owns a service (risk 1 below) and the sync-correctness code is bespoke (risk 2).
- **(b) CRDT (cr-sqlite / Yjs over a dumb transport).** Genuinely zero-server (WebDAV/S3/shared folder/USB even), and offline behavior is best-in-class. But it is **incompatible with the recommended engine** (cr-sqlite requires SQLite, i.e. §4 option (b) with its 56-RPC/21-state-machine rewrite) and with the financial model: canonical-writer RPCs with audit triggers are transaction-shaped; row-level CRDT merges can produce states no single writer would have produced (a merged payment row whose ledger entries never matched it). Keep as the fallback only if the owner rejects any server AND accepts the engine switch.
- **(c) ElectricSQL.** Architecturally the closest fit to "Postgres everywhere" — but the classic sync server product is discontinued/pivoted (to be re-verified before ANY consideration; this session made no network calls). Adopting a discontinued sync engine would recreate the vendor trap with worse odds. Rejected on maturity, not on concept.
- **(d) PowerSync.** A credible local-first sync service with self-hosting — but it brings its own client SDK (SQLite-based, conflicting with PGlite), its licensing model has commercial tiers that gate features (verify current terms before any future re-evaluation), and it adds a platform dependency the owner does not control. Parked: worth re-evaluating ONLY if the engine fallback (SQLite) is ever triggered.
- **(e) Supabase demoted to optional relay.** This is not a new option so much as the transition strategy and the proof of INV-5: once local is primary, the quota can fire again and the *app still works* — the queue holds, the school runs. Keep the existing 37 adapters compiling behind `RemoteSyncAdapter` until LF-5 decides their fate.
- **(f) Shared-folder single-file DB.** Documented for completeness: opening one DB file over SMB from multiple Windows PCs invites opportunistic-locking stalls, torn writes on network hiccups, and last-writer data loss with no conflict record. It fails INV-8 (durability) and INV-3 (multi-user correctness) simultaneously. Rejected without mitigation interest.

**Top 3 risks of the recommendation + mitigations:**
1. **Relay availability/ops burden** (owner runs a server). Mitigation: the relay is optional to app function (offline queue already exists); ship it as one self-updating service with a health page; document restore-from-backup-on-any-PC; data loss exposure is limited to *cross-machine* sync lag, never local durability.
2. **Custom sync-code correctness** (sequencing/conflict bugs in money data). Mitigation: financial operations converge by *deterministic replay* of the relay-ordered log (not by row merges); per-entity policy table (§7) is declarative and test-pinned; the round-trip test layers from the pipeline design (H-4) extend to a two-node simulation.
3. **Security exposure if internet-facing.** Mitigation: default posture is LAN/same-building; internet mode goes through TLS + per-installation tokens (activation-code ceremony reused, ADR-011); FCM/push rides the relay only; no admin surface on the relay.

---

## 7. Conflict & identity model

**Identity:** user identity keeps the existing UUIDs (imported from `user_profiles`); each installation gets a stable `machineId` (the pipeline design's manifest `sourceMachineId`) minted at first run into local config; every sync operation carries `(machineId, userId, opId, lamport-ish seq)`. The `Session` type keeps its token fields (`session.ts:43-45`) — the local session mints opaque tokens exactly as the mock proves possible (`auth-repository.ts:67-69`), so the RBAC layer and `auth-provider.tsx` are untouched.

**Conflict handling — per-entity policy table** (extends the pipeline design's `SYNC_POLICY` in `sync-types.ts`; aligns with its `SyncService`):

| Entity class | Policy | Mechanics (existing code reused) |
|---|---|---|
| Financial mutations (payments, reversals, salary disbursements) | **Operational queue — deterministic replay, no row merges** | The RPC *inputs* (`collect_and_allocate_payment` args, etc.) are the queued units; the relay assigns a total order; every installation replays the same ordered ops through its local PGlite RPCs. Idempotency by `opId` + the RPCs' own guards. Receipt numbering: relay-sequenced when online; offline collections get a provisional reference and the final `REC-YYYY-NNNNNN` at replay (ADR-004 amendment, §10). |
| Staged entity edits (parent, student, installment, ledger corrections) | **3-way merge** — the existing `conflict-detector.ts` (`conflictGuard`, `computeThreeWayForEntry`, SYNC-108 merged-payload verdicts) + conflict-resolver UI | `basePayload` carried per entry exactly as today; both-changed fields park as `conflict`, never silent overwrite. |
| High-frequency low-stakes rows (attendance, homework) | **Entity-level last-writer-wins** on `(updated_at, id)` | Same as today's `last-write-wins` policy rows in the pipeline design. |
| Catalog/config (pricing, classes, subjects, thresholds) | **LWW + owner-edit discipline** (single-editor in practice) | Keyset pull catches up; audit log records who changed what. |
| Append-only streams (audit_logs, notifications) | **Union merge** (no conflicts possible) | Straight op-log replay. |

The 0143 `(updated_at, id)` composite keyset remains THE cursor contract for pull (desktop never calls `pull_*_for_sync` today — 07 §6 — but the contract shape is exactly what the relay reuses for the desktop's own pull side).

**Worked example — the hardest case, two machines collect a payment for the same student while both offline:**

1. Machine A collects 20,000 DZD (op `opA`, provisional receipt ref `REC-2026-LOCAL-A7`); Machine B collects 15,000 DZD for the same installment (op `opB`). Each machine's local waterfall runs atomically — its own ledger is internally consistent.
2. Both reconnect. The relay sequences `opA` then `opB` (total order by arrival; ties broken by `(machineId, opId)`).
3. Both machines replay the ordered log through the SAME `collect_and_allocate_payment` RPC bodies locally. The waterfall's own INV-4 capacity logic decides the outcome deterministically on both machines (e.g. `opA` fills the tranche, `opB` overflows to the next tranche or is rejected by the RPC's own guards — the SAME verdict everywhere, because the replay order is identical).
4. Receipt numbers finalize at replay: `opA` gets `REC-2026-000123`, `opB` gets `REC-2026-000124` (relay-minted sequence block); the provisional refs remain recorded in the audit trail as aliases.
5. The 3-way entity-merge path (conflict-detector) never engages for these rows — operational replay replaces row-merging exactly where merging would be dangerous. The resolver UI stays for profile-field edits (a parent's phone changed on two machines).

This is why the relay is a *sequencer*, not a database-of-record: no financial truth lives on it, only the ORDER of operations. A restored-from-backup machine rebuilds truth by replaying the log it pulls.

---

## 8. Data migration path (Supabase → local)

**Schema:** replay the append-only 152-migration chain (`0001`→`0157`) into an empty PGlite database — the chain, not the live DB, is the schema source (LIVE-CENSUS §3; the broken `bootstrap/9000` is NOT used — verified broken, 07 §1). Prerequisite shims, applied as a local-only `0000_local_compat` prologue: an `auth` schema with `auth.uid()` reading a per-transaction GUC (`app.current_user_id`) so the 324 policies still parse and mostly still work; verify extension coverage per current PGlite release (`pgcrypto`/uuid generation, `gen_random_uuid()`); matview creation may need plain-view fallback. Every replayed migration is diffed against a chain-census test (100 tables / 14 views / 5 matviews) — the census numbers become the verification gate.

**Data — three vehicles, in preference order:**
1. **One-time full extraction script (owner-gated):** a `t-368`-style script (the proven pattern: `scripts/t-368-verify-live-summary.ts`, t-425/t-433 headless re-import drivers) that reads all tables via REST `.from()` + the `read_*_collection` RPCs (0123) for gated reads, writes JSON per stream, then seeds the local DB through the **unified ImportService commit path** (`RepositoryStorageAdapter` — the one commit path, pipeline P-1.1) whose `upsert_*_from_import` RPCs are idempotent by construction. This is the only vehicle that covers all ~73 desktop-relevant tables plus the 26 RPC-only tables (their data comes via RPC reads).
2. **The t-368 13-stream full-export workbook** (`excel/full-export.ts`, `FullExportData:63`) — proven, human-readable, but covers only the 13 canonical streams; ~60 other tables (chat, calendar, tasks, timetable, workflows, audit history…) would be lost. Acceptable only as a degraded seed.
3. **The encrypted vault archives** (8 collections + RBAC + ER state) — the least complete; last resort.

**The hard truth (state plainly):** while the project is restricted (`exceed_egress_quota`, OPS-011), **NO extraction is possible** — every REST/EF surface returns 401/402. The owner must lift the spend cap **ONCE** for the final export, or explicitly accept the freshest existing artifact (last t-368 workbook / vault archive) as the seed and lose whatever changed since. No amount of local-first engineering changes this; it is the one remaining thing only the owner can do on the Supabase side.

**Day-one table scoping (which tables the local DB actually needs immediately):** the coupling map's §7 candidate 7 lists the 26 of 99 chain tables the desktop never touches via `.from()` (their logic is RPC/EF/trigger-reached) — `device_tokens`, `promotion_cycles`, `re_enrollments`, `permissions`, `role_permissions`, `parent_student_links`, `ai_request_logs`, `workflow_pending_resumes`, `account_adjustments`, `expense_state_transitions`, `grades`, `homework_assignments`, `academic_history`, `filieres`, `invoices`, `notification_preferences`, `performance_reviews`, `promotion_cycle_classes`, `salary_adjustments`, `service_enrollments`, `sessions`, `tenant_role_overrides`, `workflow_audit_links`, `exam_sessions`, `discount_applications`, `ai_provider_configs`. Under PGlite the answer is simple and safe: **create all 100 tables** (the chain replay costs nothing extra) and seed only what the extraction covers — but the list drives the *extraction script's* completeness checklist (these tables' data is reachable only via RPC reads or not at all from the desktop, so the script must call the RPCs, not just scan tables).

**Sequencing (the migration weekend, owner-run, ~1 day):** (1) LF-1 build installed on the primary PC; (2) chain-replay verified (census gate); (3) extraction script run against the unrestricted Supabase project (owner lifted the cap for the day — GET-heavy, one write-free session, consistent with the read-only ceremony rules); (4) seed via ImportService commit path with preflights (T-421 triple) and per-stream verify (counts + FK integrity, the pipeline design's step 8); (5) safety backup taken (the vault now ALSO mirrors into the main-process store, §12.3); (6) relay configured; (7) second PC paired via activation code (ADR-011 ceremony reused); (8) two-node sync smoke; (9) Supabase cap can go back on — from this point it no longer matters.

---

## 9. Phased migration plan

Effort scale (relative, honest): **LF-0 = M** (mechanical but wide — 14 bypass files + the hard-lock surgery + 5 interface files); **LF-1 = XL** (the heart: engine + 37 adapter re-points + parity suites — the only phase that competes with the ROADMAP's entire Phase 1 in size); **LF-2 = L**; **LF-3 = M-L** (workflow promotion is the delicate part — the 0088 divergence must be settled as ROADMAP 2.1 already plans); **LF-4 = L** (relay + policy table + two-node tests); **LF-5 = S-M** (mostly deletion/archival + ADRs). Total is a multi-session program, not one task series — deliberately ordered so the school is never blocked: after LF-1+LF-2 the app is already fully functional locally with zero Supabase dependency; LF-4 adds multi-user; LF-5 is cleanup.

Interlock: LF-0..LF-5 extend `Refactoring Unified/ROADMAP.md` as a proposed Phase 6 (the pipeline design's P-0..P-4 proposed the same). Dependencies: LF-0 blocks everything; LF-1 rides P-1.1's commit path; LF-3 supersedes pipeline P-4.1 (therapy bucket → local folder); LF-4 consumes P-1.2's declarative policy table; ROADMAP Phase 2 (live SQL/EF repair) shrinks as EFs are retired by LF-3 — sequence LF-3 after Phase 2's owner-priority fixes or consciously drop the ones LF-3 deletes (2.3 collect-payment EF, 2.4 config.toml).

| Phase | Scope | Files / areas touched | What breaks (honestly) | Verification | Rollback |
|---|---|---|---|---|---|
| **LF-0 — Seam formalization + hard-lock removal** | The 5 ports (§5) as interfaces only; `supabase-client.ts` canonical pin + `validateConnection` URL check + storageKey pin removed; the 14 bypass files routed (parent-detail-drawer, tenant-switcher → repository; diagnostics → DiagnosticsPort = F-U3/ROADMAP 5.11); ADR-002/004 supersession ADRs drafted | `supabase-client.ts`, `system-config.ts`, `repository-provider.tsx`, `vite-env.d.ts`, 14 bypass files, `docs/decisions/` | Nothing user-visible; the Configuration tab gains non-supabase URL acceptance | typecheck + full vitest; hermeticity contract (t-472) re-pointed; ARCH-019 suites | Trivial (revert commits) |
| **LF-1 — Local engine behind the seam** | PGlite in main process (`LocalDatabaseService`); chain replay + compat shims; `LocalBackendAdapter` for the 49 overridden slots (SQL kept, transport swapped); the 5 mock-only slots get real persistence (resolves ARCH-006 / ROADMAP 3.7 by port); IPC channels; mock-parity test layer (every repository: mock vs local, same fixtures) | `electron/main.cts`, `electron/preload.cts`, new `src/infrastructure/local/**`, 37 adapter files re-pointed | Test surface is the blast radius: 188/321 test files mention supabase, 77 reference `Supabase*Repository` classes (coupling map §3j) — the mock-parity suite is the new safety net | chain-replay census gate (100/14/5); mock↔local parity suites; t-364/t-421 import suites against local | Feature flag: default backend remains supabase/mock until parity is green |
| **LF-2 — Auth + RBAC local** | `LocalAuthService` (scrypt, sessions, activation codes, role guard), `users`/role/permission tables live in local DB; user-manager UI re-pointed; Google OAuth + global-signout re-scoped (owner decision §11) | `supabase-auth-repository.ts` → local twin, `supabase-user-account-repository.ts`, `supabase-approval-repository.ts`, `auth-provider.tsx` (unchanged contract) | Sign-in semantics change (local accounts); GoTrue-only features (OAuth) stop unless kept via relay | RBAC suites; T-266 SuperAdmin repair test; activation-code lifecycle tests (0055 semantics) | Keep supabase auth selectable per installation during transition |
| **LF-3 — EF ports + storage** | Workflow engine promoted (dry-run engine → primary; fix 0088 divergence); overdue scanner canonized (desktop INV-4 formula; EF twin deleted); cron family → main-process scheduled tasks; `MediaStore` local folders replacing 5 buckets + therapy bytes (absorbs pipeline P-4.1/H-2); audit writer in adapter (mock precedent) | `supabase-workflow-repository.ts`, `supabase-overdue-alert-generator.ts` (promoted), `media-vault.ts`, new `electron/` services | Push notifications dead unless relay present (§10); matviews become views (KPI recompute); financial-realtime channel removed | workflow parity suite (imports EF engine today — re-pointed); overdue boundary fixtures; media round-trip test | Per-service flags |
| **LF-4 — Sync relay + conflict policies** | Relay service (owner one-time deploy); `SyncTransportPort` adapters (relay + supabase-as-relay); op-log change-log table; per-entity policy table wired (§7); receipt sequencing; cross-machine invalidation bus | `sync/**` (reused, extended), `default-push-handler.ts` → transport posts, new `relay/` (separate small repo/folder) | Two-writer financial scenarios surface sequencing decisions (offline receipt refs) | Two-node simulation tests (deterministic replay proofs); conflict-resolver UI suites; offline-drain tests (t-171/t-305 patterns) | Relay disabled = today's offline behavior (queue holds) |
| **LF-5 — Supabase demotion + teardown** | Supabase adapter kept ONLY as optional relay (quota can never break the app — INV-5 satisfied); scripts archive sweep (coupling map §3i: 292+54 files); `AGENTS.md` §11.1 ceremony replaced by local DB commands; ADRs finalized (§10); credentials.md cleanup (coupling map §7 candidate 6) | `supabase/` (archived, read-only), `scripts/`, `docs/operations/`, governance | None functional; documentation churn | Final full-suite run + a "kill the network" boot test (INV-2 gate) | Supabase adapter remains selectable indefinitely |

**Standing verification gates (apply at every phase boundary, in order):**

1. `tsc --noEmit` + full vitest green (the ROADMAP's standing rule 2 — unchanged).
2. **INV-2 gate:** with the network fully blocked, the packaged Windows build boots, signs in (local), reads, writes, backs up, restores. This gate does not exist today and is the definition of success for the whole program.
3. **Mock-parity gate:** for every ported repository slot, mock vs local adapters produce identical observable sequences for the same fixture corpus (the fixture builder + the t-364/t-421 suites supply the corpus).
4. **Chain-census gate:** the local DB's schema census equals the LIVE-CENSUS numbers (100 tables / 14 views / 5 matviews) after replay, and 324/324 policies parse.
5. **Money-parity gate:** the existing financial parity suites (the ADR-002 mirror discipline, 07 §4) pass against the local engine — because the SQL is the same, they must pass unchanged; any failure means the port changed behavior.
6. **Kill-switch rollback:** at every phase, the previous backend remains selectable via configuration until the NEXT phase is green — mirroring the app's own dual-mode heritage.

---

## 10. What we deliberately keep / lose

**Kept (by design):** the 54-slot seam and 165 `useObservable` sites; the observable-cache idiom; the fail-closed philosophy (re-targeted); the encrypted vault + backup scheduler + restore ladder (pipeline P-2/P-3 unchanged — they gain a *better* restore target: the real local DB); the import engine; the PDF stack; the SQL business logic itself (ADR-002's *authority*, relocated).

**ADR dispositions (each requires a supersession ADR in LF-0/LF-5):**

| ADR | Disposition under local-first |
|---|---|
| **ADR-002** (SQL RPCs are the canonical financial engine) | **Inverted in location, preserved in principle:** the canonical writers are the SAME SQL RPC bodies, executed in the main-process PGlite transaction. The desktop TS engine remains the reference mirror. Consequence text updates: "the server" → "the local database service"; the parity suites keep passing because both sides are unchanged. |
| **ADR-004** (server-authoritative sequential receipt numbers) | **Locally-authoritative with relay sequencing:** a `receipt_sequences` counter table (tenant+year) lives in the local DB; online collections request sequence blocks from the relay (auditable, gap-tolerant); offline collections mint a provisional reference and finalize at replay (the ADR's own Android design note already accepts provisional numbers). Cross-device auditability preserved by the ordered op-log. |
| **ADR-005** (Android writes through canonical RPCs) | **Out of desktop scope but directly affected:** the relay can expose the same RPC-shaped HTTP surface so Android's dispatcher keeps its contract; otherwise Android cloud access ends (owner decision §11). |
| **ADR-009** (Supabase key formats) | **Obsolete in local mode** (no apikeys); kept only for the optional-relay adapter. |
| **ADR-011** (binding activates the account) | **Ported to local logic** — the single-use `activation_codes` table + status gates run in PGlite/`LocalAuthService`; also becomes the per-installation pairing ceremony for the relay (§6 risk 3). |

**Honestly lost / degraded without a server:** push notifications to Android parents (FCM needs a credentialed server — options: keep it as a relay capability, or drop push and keep in-app notifications; there is no credible LAN alternative for Android push); Google OAuth sign-in (GoTrue feature); Resend transactional email (relay job or SMTP config or dropped); server-side "hot" config that all clients see instantly (replaced by synced `system_settings` rows). Multi-device *online* receipt uniqueness becomes sequencing-dependent (§7) — strictly weaker than today's single-DB uniqueness, accepted consciously in exchange for INV-1/INV-2.

**The push-notification decision spelled out** (the one genuinely product-level loss):

| Alternative | Verdict |
|---|---|
| Keep FCM via the relay (relay holds `FIREBASE_*` credentials — exactly the keys the stale `update-server-secret` allowlist misses, 07 §3.2) | Works, keeps the Android parent UX; costs: relay must be internet-facing + Google account upkeep (a soft vendor dependency, but a *non-fatal* one — push failing never blocks the app). |
| Drop push; keep in-app `notifications` rows (they sync like any table) | Parents see messages when they next open the app; zero external dependencies. |
| LAN-based local push (e.g. the desktop app broadcasting on the school network) | Not credible for parents' personal Android phones outside school Wi-Fi; rejected. |
| SMS/WhatsApp gateways | Metered per-message costs — violates INV-9; rejected unless the owner explicitly re-prioritizes. |

---

## 11. Open decisions for the owner

1. **Sync topology:** single-school LAN relay (a always-on school PC, zero internet exposure) vs internet relay on a VPS (multi-site, e.g. owner's home + school) vs both (same software, two deployments)? This sets the security posture and the FCM question.
2. **Android parents' cloud access:** keep (relay exposes the Android pull/push surface — more scope) or end (desktop-only product; Android app becomes orphaned pending its own local-first story)?
3. **Push notifications:** pay the complexity of FCM-on-relay, or drop push and keep in-app + SMS/WhatsApp-style manual contact?
4. **Hosting appetite:** does the owner accept running ONE small service (INV-6 says yes in principle), or is the zero-server CRDT fallback (§6b, doubling engine effort) preferred?
5. **Timeline vs stopgap:** lift the quota cap ONCE for the final export (§8) — and separately decide whether to ALSO pay for a Supabase plan as a temporary live-mode stopgap during LF-0..LF-3, or run the school on local mode + relay from LF-1 onward (recommended: the latter; paying for a stopgap extends the coupling this blueprint exists to remove).
6. **Mock-slot features** (clubs, psychology, orthophonie, aiConfig, performanceReviews — ARCH-006 / ROADMAP 3.7 / open question 5): LF-1 forces the decision — persist them properly in the local DB or delete the features.
7. **Google OAuth / global signout:** dropped, or kept via the relay (a real identity-provider surface — significant extra scope)?

---

## 12. New finding candidates

*(Each marked "candidate — pending ID assignment"; next free IDs per handoff S2: DEAD-015, DUP-031, ARCH-022, BUG-032, OPS-012. Cross-checked against FINDINGS_INDEX, the coupling map's §7 candidates, and the pipeline design's candidates — no re-registration.)*

1. **candidate — pending ID assignment (ARCH-class, possibly extending R-3.9/ROADMAP 0.7):** the renderer-declared Electron API is materially ahead of the actual preload: `src/vite-env.d.ts:15-41` declares `app` (getVersion/getPath/restart/isElectron), `fs`, and `config` (read/write/delete) members on `ElImtiyazDesktopApi`, but `electron/preload.cts:113-139` exposes none of them (only window/zoom/shell/saveFile/pick* — verified: zero "config" matches in `electron/`). Runtime consequence: `window.elImtiyaz?.config` (`src/infrastructure/system-config.ts:99,133,145`) and `window.elImtiyaz?.app?.restart` (`:171`) are always undefined, so the "Electron userData/config.json" local-config layer documented in `system-config.ts:5-12` NEVER executes — localStorage (`el-imtiyaz.local-config`) is the only working local-config persistence, and `saveConnectionAndRestart` degrades to a page reload. Local-first LF-0 must build the real main-process config bridge this dead code already sketches.
2. **candidate — pending ID assignment (ARCH-class):** the domain `Session` type hard-couples the RBAC layer to a token-exchange auth model — `accessToken`/`refreshToken`/`expiresAt` are GoTrue-shaped fields on `src/core/rbac/session.ts:43-45`, forcing even the mock to mint fake JWTs (`src/infrastructure/mock/repositories/auth-repository.ts:67-69`). A local auth twin must keep minting token-shaped strings solely to satisfy this type; the local-first port should either keep the shape deliberately (documented as opaque) or introduce a local session variant — an interface decision that touches every session producer.
3. **candidate — pending ID assignment (ARCH-class):** the backup vault is the only authoritative data store that lives in the RENDERER (IndexedDB, `src/infrastructure/backup/indexed-db-vault.ts`) while the main process cannot see it — the inverse of every other store, and invisible to main-process durability (backups die with "clear site data" on the renderer profile; pipeline design H-13 registered the symptom). Under the local-first architecture the vault naturally migrates into the main-process DB/filesystem; registering the inversion now so LF-1/LF-3 treat vault absorption as a first-class scope item, not a side effect.
4. **candidate — pending ID assignment (ARCH-class):** the 49-key override list in `src/infrastructure/supabase/supabase-repositories.ts:421-486` is the single wiring point for the entire backend, and T-498's own comment (`:445-453`) documents that a fully-implemented, suite-pinned repository (`promotionCycles`) sat un-wired while live mode silently used the in-memory mock — data loss by omission, caught only by manual observation. The local-first port (49+ adapters re-registered against `DataBackendPort`) needs a compile-time exhaustiveness check (e.g. `satisfies` over the slot map per backend factory) so an unwired slot is a type error, not a silent void.

---

*End of blueprint. One file written this session: `Investigation Archive/Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md`. No application source, configuration, schema, or dependency was modified; no npm/build/test command was run; no network call was made; no git state was mutated. Every current-code claim cites the file read; every coupling count cites `SUPABASE-COUPLING-MAP.md` (2026-11-19).*
