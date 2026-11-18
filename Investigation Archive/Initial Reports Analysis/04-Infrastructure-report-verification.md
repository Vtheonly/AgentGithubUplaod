# Verification Report — 'Optimizing AI Context for Development — Infrastructure.md'

**Investigator:** Agent IF (Task RPT-4) · **Mode:** read-only · **Target:** `elimtiyaz-desktop/src/infrastructure/` (176 actual files: ai 3, backup 7, excel 44, experimental 1, export 5, mock 53, receipt-pdf 12, storage 1, supabase 42, sync 7, + `system-config.ts`).

## 1. Report summary

- The Infrastructure report is **largely accurate and unusually well-grounded**: of ~40 significant claims checked, the overwhelming majority VERIFIED against source, including the wiring matrix (49 Supabase slots + `approvals`, 5 mock slots), the financial realtime bridge, the seed-retry/concurrency-gate machinery, the sync layer, the Excel import engine, and the backup/AI/PDF subsystems.
- The **headline correction** is the "Phantom Electron Bridge" thesis: `electron/preload.cts:144` **does** expose `window.elImtiyaz` (same `api` object as `window.elImtiyazDesktop` at line 145). What is true is that the exposed API has **no `config`/`app` members**, so `system-config.ts`'s `window.elImtiyaz?.config` / `?.app` branches are dead *at the member level* — the conclusion (localStorage/reload fallback always wins) holds, the premise ("preload never exposes it") is false. The `vite-env.d.ts` type declaration is the phantom, not the global.
- The report's **most consequential miss**: `mock/fixtures/*` are NOT dead weight — `TestDataAutofill` (Ctrl+O autofill) is mounted **unconditionally** in `src/app/app.tsx:136` with no dev gating, and its generator chain value-imports `mock/fixtures/{rng,parent-fixtures,student-fixtures}.ts` (`src/shared/devtools/test-data/generators.ts:26-35`). The fixtures ship in the production bundle and are user-invokable in the packaged app.
- A **boundary violation the report missed**: `src/domain/calc/ledger/non-tuition-charges.ts:29` imports `defaultPricingConfig` from `infrastructure/mock/pricing-seed` — domain code depending on mock infrastructure.
- `mock/subject-behavior.ts` is **production infrastructure**, not mock: 26+ Supabase repositories import `SubjectBehavior`/`derived` from it. Treating it as removable mock noise would break the Supabase layer.
- Mock↔Supabase repository **method contracts are in sync** for all pairs compared. The real drift is **behavioral** (billing, attendance-rate default, enrolledCount reactivity, debt-summary source) — exactly as the report documents; all four re-verified true.
- The dead-code inventory is mostly correct; one addition: `dispatchPaymentOverdue` (`mock/repositories/workflow-event-bridge.ts:434`) has **no callers** — a dead 6th dispatcher.
- `supabase/types.ts` is **hand-written, not generated** (header lines 4–8 say so explicitly); no `supabase gen types` script exists — schema drift between migrations and this file is an unchecked manual risk the report never flags.
- The `electron/` main process imports **only** Electron + node builtins; the entire `src/infrastructure/` tree is renderer-process code reaching the main process solely via the preload bridge.
- Minor inaccuracies: scope note says "174 file dumps" (actual: 176); `sync-queue-store`'s fallback flag is the method `isUsingFallback()`; the report says the mock bridge fires on "5 domain events" while a 6th (`payment_overdue`) is declared in the docstring but is dead code.
- Doc-inconsistency found: `backup/aes-256.ts:6` claims "per-tenant salt" but the only caller uses a **fixed** salt `"el-imtiyaz-backup-salt-v1"` (`backup/backup-service.ts:109-110`).

## 2. Claim-by-claim verification table

| # | Claim | Classification | Evidence | Notes |
|---|---|---|---|---|
| 1 | 49 `Repositories` slots Supabase-backed + `approvals` attached separately; 5 slots remain mock (`clubs`, `psychology`, `orthophonie`, `aiConfig`, `performanceReviews`) | **VERIFIED** | `supabase-repositories.ts:423-486` (override list = exactly 49), `:492` (`Object.assign`); `mock-composite.ts:88-148` (54 mock slots; 54−49 = 5 named slots) | Counted slot-by-slot |
| 2 | Packaged build lockdown: `VITE_DESKTOP_PRODUCTION === "true"` ignores `localConfig`, locks to `https://vebfehrpzajhstyhinnw.supabase.co`, `useSupabase = true` | **VERIFIED** | `supabase-client.ts:35-38`, `:121`, `:148-157`, `:171-176` | |
| 3 | Vitest hermetic mode: `isVitestRun` disables canonical fallbacks and defaults `useSupabase = false` | **VERIFIED** | `supabase-client.ts:59-71`, `:119-120`, `:153`, `:176` | |
| 4 | `startFinancialRealtime()` replaces `repositories.debt` via `Object.defineProperty` with `RealtimeFinancialDebtRepository` | **VERIFIED** | `financial-realtime.ts:371-387` (`installDebtFacade`), invoked `:460` | WeakMap-guarded against double-install |
| 5 | `pauseFinancialRealtime()`/`resumeFinancialRealtime()` suppress refresh storms during bulk imports | **VERIFIED** | `financial-realtime.ts:412-444`, `:469-473`, `:504-510` | Resume performs exactly ONE deferred `refreshAll` |
| 6 | PostgREST 1,000-row cap → `callCollectionRpc` (0123 RPCs) or `paginateKeyset` (`id > lastId`) | **VERIFIED** | `supabase-shared-repositories.ts:697-728` (PAGE=1000), `:801-836`, used at `:4760-4769`, `:4798-4813` | `paginateImportPreflight` at `:356` |
| 7 | In-flight dedupe map + strict FIFO gate `COLLECTION_READ_CONCURRENCY = 2` | **VERIFIED** | `supabase-shared-repositories.ts:789`, `:624`, `:644-668` | |
| 8 | Finance seeds use `readWithSeedRetry` (1s, 3s) + `finishSeed`, `observeSeedHealth()` | **VERIFIED** | `supabase-shared-repositories.ts:557`, `:564-576`, `:682-695`, `:515`, `:469` | |
| 9 | Tenant fallbacks: `getTenantId()` null / `requireTenantId()` throws; Dashboard + OverdueAlert private fallback `"00000000-…-0001"`; backup hardcodes `"tenant-el-imtiyaz-oran-001"` | **VERIFIED** | `supabase-shared-repositories.ts:154,166-184`; `supabase-dashboard-repository.ts:39-50`; `supabase-overdue-alert-generator.ts:370-382`; `backup-service.ts:179,249`; `backup-scheduler.ts:218` | `TENANT_FALLBACK` const at `:154` has zero other references — dead |
| 10 | Backup `restore()` applies snapshot only to `mockStore` + `erBackupRestore` — Supabase tables untouched | **VERIFIED** | `backup-service.ts:42,51,597,600,615,57` | |
| 11 | Debt summary divergence: Supabase computes from installments (RPC); realtime facade computes ledger replay; `collectDebtors` still reads installments | **VERIFIED** | `supabase-shared-repositories.ts:4760-4769`, `:4798-4825`; `financial-realtime.ts:100-128`, `:319-321`; `:5188-5199` | |
| 12 | 3 divergent billing implementations | **VERIFIED** | `registration-billing-wires.ts:117-147`, `:276-292`; `supabase-shared-repositories.ts:2100`, `:2148`; `mock/repositories/student-repository.ts:511-579`; `excel/import-engine/storage/repository-adapter.ts:60` | Mock nuance: prefers `defaultPricingConfig.registrationFeeByGrade` before `REAL_FI_BY_GRADE` (`:534`) |
| 13 | Student-code hash divergence: `createStudentTracked` hashes `parentId`; `batchRegister` hashes `parentCode` | **VERIFIED** | `supabase-shared-repositories.ts:1687` vs `:2059`, rationale comment `:2052-2056` | |
| 14 | Mock event bridge fires 5 domain events; in Supabase mode only `recordRollCall` dispatches client-side | **VERIFIED** | Mock callers: `payment-ops.ts:252,567,723`; `academic-repository.ts:643`; `student-repository.ts:386`. Supabase: `supabase-academic-repository.ts:79,1318,1383` | Bridge defines a 6th dispatcher `dispatchPaymentOverdue` (`workflow-event-bridge.ts:434`) with **zero callers** |
| 15 | Dashboard attendance-rate divergence: Supabase `1.0` on empty today; mock falls back to latest date / `0` | **VERIFIED** | `supabase-dashboard-repository.ts:198-204`; `mock/repositories/dashboard-repository.ts:67-87` | |
| 16 | Audit divergences: expense repo double-`JSON.stringify`s payloads; debt bulk ops pass literal `"bulk"` to `p_entity_id` | **VERIFIED** | `supabase-expense-repository.ts:848-849`; `supabase-shared-repositories.ts:5132`, `:5175` | `"bulk"` will fail 22P02 on a uuid param |
| 17 | `mapStudentRow` duplication: shared version complete; academic repo's private copy stale | **VERIFIED** | `supabase-shared-repositories.ts:883-939`; `supabase-academic-repository.ts:2129-2164` (`transportTier: null` at `:2152`) | |
| 18 | Sync: backoff, conflicts, push handler field omissions | **VERIFIED** | `sync-service.ts:49,115,61,196,263,580-581,589,674`; `default-push-handler.ts:107-348`; `conflict-detector.ts:44-259` | Installment RPC omits `tranche_number`/`academic_year_id`; grade RPC omits `cc` |
| 19 | Import engine: `RowValidator` converts all errors to warnings, making `ATOMIC_IMPORT_ABORTED`/`STRICT_MODE_REJECTED` unreachable | **VERIFIED** | `row-validator.ts:242`; `import-engine.ts:214-221`, `:317-323`, `:456-458` | |
| 20 | Non-persistent schemas: `ref` insert no-op; `bon`/`devis` stay in memory | **VERIFIED** | `repository-adapter.ts:1196-1200`, `:700-707`, `:664-665` | |
| 21 | `coerceMonthlyArray` unused by any registered schema | **VERIFIED** | `row-validator.ts:211-212`; grep zero occurrences in configs | |
| 22 | `ImportConfigRegistry` header-signature disambiguation; `__col_<LETTER>` positional keys | **VERIFIED** | `config-registry.ts:26-31`, `:270-302`; `excel-parser.ts:210`; `import-config/index.ts:10-12` | `ImportConfigStore` never wired: zero `.useStore(` callers |
| 23 | `RepositoryStorageAdapter`: concurrency 8, fail-closed preflight, 500-row chunk flushes | **VERIFIED** | `repository-adapter.ts:226`, `:248-327`, `:902-999`, `:1065` | |
| 24 | Expense status/category translation; assessments term mapping | **VERIFIED** | `supabase-expense-repository.ts:104-147`; `supabase-academic-repository.ts:1025` | |
| 25 | No-op Teacher writers return validation errors | **VERIFIED** | `supabase-teacher-repository.ts:366-374`, `:451-459`, `:464-472`, `:478-486` | |
| 26 | `receipt-pdf/global-reports.ts` exists, called directly, omitted from barrel | **VERIFIED** | `receipt-pdf/index.ts:17-30`; direct importer `features/dashboard/tabs/reports-tab.tsx:36` | |
| 27 | PDF WinAnsi constraints | **VERIFIED** | `receipt-pdf/shared.ts:57-85`, `:175`; Helvetica usage in `payment-receipt.ts:60-61` etc. | |
| 28 | Export pipelines: 13 sheets, warmup, STORE-only zip, legacy bypass paths | **VERIFIED** | `full-export.ts:12-26`, `:669`; `export-warmup.ts:62,169`; `archive-export.ts:37,44,128,182`; `zip-writer.ts:112,140,156`; `export-target.ts:123-154`; `data-export.ts:53-64`; `receipt-pdf/download.ts:7-18` | |
| 29 | Backup crypto: PBKDF2 100k, fixed salt, AES-256-GCM, IndexedDB vault, 365-day retention, scheduler | **VERIFIED** | `aes-256.ts:6,15,56`; `backup-service.ts:54`, `:109-110`; `indexed-db-vault.ts:21,258`; `backup-scheduler.ts:40,44,80,82-85,142` | `aes-256.ts:6` docstring wrongly says "per-tenant salt" |
| 30 | AI: routing edge→BYOK→mock; SEC-002 refusal; narrative-generator hardcodes provider/model | **VERIFIED** | `llm-adapter.ts:450-460`, `:225-231`, `:317-327`; `narrative-generator.ts:73-74`; `ai-config-storage.ts:26-27` | |
| 31 | ER gated by experimental flag, default OFF | **VERIFIED** | `experimental-flags.ts:20`, `:38`, `:41-48` | |
| 32 | Media vault: 5 private buckets, path convention, 300s signed URLs, 10MB chat limit | **VERIFIED** | `media-vault.ts:35-42`, `:103-105`, `:86`, `:49`, `:59-63` | |
| 33 | `window.elImtiyaz` is a phantom bridge never exposed by preload | **REJECTED (premise) / conclusion CORRECTED** | `electron/preload.cts:141-145`: `contextBridge.exposeInMainWorld("elImtiyaz", api)` **and** `("elImtiyazDesktop", api)` — same object. But the exposed `api` (`:113-139`) has only `window/zoom/shell/saveFile/pickFile/pickBackupFile/pickDirectory` — **no `config` or `app` members**, so `system-config.ts:99,133,145,171,517` branches are runtime-dead | The phantom is the *typed shape* in `vite-env.d.ts:15-59`, not the global |
| 34 | `mock/fixtures/*` have 0 runtime imports → removable noise | **CORRECTED** | `src/app/app.tsx:134-136` mounts `<TestDataAutofill />` unconditionally; `use-test-data-autofill.tsx:29-70` (Ctrl+O handler); `generators.ts:26-35` imports fixtures | Fixtures are bundled into production and user-reachable via Ctrl+O. "Removable" is not safe as written |
| 35 | `mock/pricing-seed.ts` → `defaultPricingConfig` is an active runtime fallback | **CORRECTED (incomplete)** | Verified consumers: `supabase-pricing-repository.ts:54`, `supabase-shared-repositories.ts:129`, `mock/repositories/student-repository.ts:34` — **plus** `src/domain/calc/ledger/non-tuition-charges.ts:29` (domain→mock-infrastructure import the report misses) | |
| 36 | Stale docstrings claim workforce repos stay mock | **VERIFIED** | `supabase-personnel-repository.ts:16-21`; `supabase-repositories.ts:195-196` — contradicted by actual wiring `supabase-repositories.ts:469-481` | |
| 37 | Scope note: "174 file dumps" | **CORRECTED** | Actual count: 176 files | |
| 38 | Auth: `buildSession` from `user_profiles` + `current_user_roles` + `current_user_permissions`; SuperAdmin all permissions client-side | **VERIFIED** | `supabase-auth-repository.ts:91-129`, `:165-179` | |
| 39 | Purge: `dryRunPurge()` / `executePurge("PURGER")` → RPC | **VERIFIED** | `supabase-purge-repository.ts:92`, `:135`, `:144` | |
| 40 | `sync-indicator.tsx` → `ConflictResolverModal` | **VERIFIED** | `sync/sync-indicator.tsx:26`, `:238`; mounted in `topbar.tsx:282` | Infrastructure→features import noted in Missed discoveries |

## 3. Missed discoveries

1. **Domain → mock-infrastructure reverse dependency**: `src/domain/calc/ledger/non-tuition-charges.ts:29` — `import { defaultPricingConfig } from "../../../infrastructure/mock/pricing-seed"`. The file's own docstring (lines 20-23) admits "The Supabase layer should re-implement these helpers by querying the live pricing_config table".
2. **`mock/fixtures` are production-reachable**: `app.tsx:136` mounts `<TestDataAutofill />` unconditionally; Ctrl+O binds on every screen; no `import.meta.env.DEV` gate exists.
3. **`mock/subject-behavior.ts` is shared production infrastructure**: imported by 26+ Supabase repositories plus ~15 test suites.
4. **Dead dispatcher `dispatchPaymentOverdue`**: `workflow-event-bridge.ts:434-455` — defined, docstring-advertised, zero call sites.
5. **`supabase/types.ts` is hand-written with no generation pipeline**: `types.ts:4-8`; no gen script in `package.json` or `scripts/`. Drift between migrations (0018→0157) and this 926-line file is enforced only by review/tests.
6. **Type-level phantom in `vite-env.d.ts`**: `src/vite-env.d.ts:15-59` declares `Window.elImtiyaz?: ElImtiyazDesktopApi` with `app`/`fs`/`config` members that the real preload (`electron/preload.cts:113-139`) never provides.
7. **Infrastructure → app/features reverse import in the sync UI**: `sync-indicator.tsx:22` imports `useSyncStatus/useSyncActions` from `../../app/providers/sync-provider` and `:26` imports `ConflictResolverModal` from `../../features/settings/...` — a renderer UI component living under `infrastructure/` value-imports upward through both layers.
8. **Fixed-salt vs "per-tenant salt" doc contradiction**: `aes-256.ts:6` vs `backup-service.ts:109-110`.
9. **`receipt-pdf/index.ts` doc drift**: header says "Re-exports the 4 PDF generators" while the barrel re-exports 8 generator entry points + `downloadPdf`.
10. **Mock `PaymentRepository.refund` optional-arg drift**: mock `refund(id, reason, actorId?, actorName?)` vs Supabase `refund(id, reason, actorId: string, actorName?)` — `actorId` optional in mock, required in Supabase.
11. **Security test pins mock seeds**: `src/tests/security/no-demo-credentials.test.ts:8` references `seed-data.ts`'s `seedAccounts` — removing/altering mock seed data would break the security suite.
12. **File-count nits**: 176 files, not 174; `sync-queue-store`'s fallback surface is the method `isUsingFallback()` (`sync-queue-store.ts:215-217`).

## 4. Mock vs Supabase census

**Switching mechanism (verified):**
- Mode flag: `useSupabase` resolved in `supabase-client.ts:171-176` (production build ⇒ true; local-config toggle; `VITE_USE_SUPABASE`; Vitest default false).
- Selection: `selectDefaultRepositories()` in `app/providers/repository-provider.tsx:171-192` — `!useSupabase` ⇒ `mockRepositories` (`mock-composite.ts:88`); configured ⇒ `getSupabaseRepositories()` (`supabase-repositories.ts:124-496`), which **spreads `mockRepositories` then overrides 49 slots** (`:423-486`) and attaches `approvals` via `Object.assign` (`:492`). Singleton-cached. Because of the spread, **every mock singleton (and `mock-store` seed data) is constructed even in Supabase mode** — the mock layer is always in the bundle.
- Runtime overlay: `startFinancialRealtime()` swaps `debt` for the realtime facade (`financial-realtime.ts:371-387,453-461`).

**Who consumes `infrastructure/mock` (non-test):**
- `app/providers/repository-provider.tsx:85-86` (composite + re-export).
- `supabase/supabase-repositories.ts:51` (spread base).
- 26+ `supabase/repositories/*.ts` files: `mock/subject-behavior` only (production-shared primitive).
- `supabase-pricing-repository.ts:54` + `supabase-shared-repositories.ts:129`: `mock/pricing-seed` (`defaultPricingConfig` fallback).
- `backup/backup-service.ts:42,51`: mock identity-resolution repo (`erBackupSnapshot/erBackupRestore`) + `mock-store`.
- `domain/calc/ledger/non-tuition-charges.ts:29`: `mock/pricing-seed` (boundary violation).
- `shared/devtools/test-data/generators.ts:26-35`: `mock/fixtures/*` (Ctrl+O autofill, production-mounted).
- Everything else is `src/tests/**` (40+ test files).

**Production / dev / test / dead classification:**
- Production code paths (Supabase mode): `subject-behavior.ts`, `pricing-seed.ts` (fallback), mock composite singletons for the 5 mock slots (`clubs`, `psychology`, `orthophonie`, `aiConfig`, `performanceReviews` — all live UI features write through them), `mock-store` (touched by backup restore + sync staging).
- Dev/mock-mode-only (but bundled): all other mock repositories and seeds.
- Test-only consumers: `mock/fixtures` (also autofill), `seed-data.ts`, `ledger-seed.ts` (Tier2 suite), plus direct class imports across the suites.
- Dead: `dispatchPaymentOverdue`; `mockBackupRepository`'s trailing `export { delay, store }`; within-file dead `TENANT_FALLBACK` / `getBillingRepos`. **No dead mock *repository* found** — all 54 composite slots are wired.

**Contract pairing (representative pairs compared):**
- `MockParentRepository` (`mock/repositories/parent-repository.ts:30-149`) vs `SupabaseParentRepository` (`supabase-shared-repositories.ts:1212-1412`): same 7 + `refresh()`.
- `MockStudentRepository` (`student-repository.ts:50-473`: 13 methods) vs `SupabaseStudentRepository` (`:1615-2217`: same 13 + `refresh()`). Behavioral drift: billing, student-code hash input, no `recomputeClassEnrolledCounts` on the Supabase side.
- `MockDebtRepository` (8 methods) vs `SupabaseDebtRepository` (same 8 + `refreshSummary`); `RealtimeFinancialDebtRepository` implements the full `DebtRepository` and delegates everything except `observeSummary` — a clean facade.
- `MockDashboardRepository` (6 methods) vs `SupabaseDashboardRepository` (same 6) — exact surface parity; the drift is the `attendanceRateToday` default.
- `MockExpenseRepository` (12 methods) vs `SupabaseExpenseRepository` (same 12 + `refresh()`).
- **Contract-drift findings**: method sets in sync (domain interfaces pin them); drift is (a) optional-param nit on `refund`; (b) Supabase-only helper methods (`refresh`, `listImport*`); (c) the four behavioral divergences (billing, attendance rate, enrolledCount reactivity, debt-summary basis).

## 5. Per-infrastructure-module summary

| Module (files) | Responsibility | Consumers | Condition |
|---|---|---|---|
| `supabase/supabase-client.ts` | Client singleton, mode resolution, error mapping | repository-provider, all supabase repos, sync, online-detector, financial-realtime | Healthy; well-documented |
| `supabase/supabase-repositories.ts` | Factory: mock spread + 49 Supabase overrides + `approvals`; late-binds workflow dispatcher | repository-provider, financial-realtime | Healthy; header comments partially stale (lines 29, 195-196) |
| `supabase/repositories/` (38 files) | All Supabase adapters | Wired via supabase-repositories | `supabase-shared-repositories.ts` is a 5,250-line monolith (platform helpers + 6 repos); duplication documented (audit mirrors, stale `mapStudentRow`) |
| `supabase/types.ts` | Hand-written DB row types | supabase repos | Manual mirror of migrations — drift risk, no gen pipeline |
| `supabase/financial-realtime.ts` | Realtime invalidation bridge + canonical debt facade + pause/resume seam | app runtime | Healthy |
| `mock/` (53 files) | Mock-mode repositories over `MockStore` + shared reactive primitive + seeds + fixtures | mock-composite → provider; 26 supabase repos (subject-behavior only); backup-service; domain non-tuition-charges; devtools autofill; 40+ test files | Production-shared parts must not be pruned; fixtures production-reachable; `dispatchPaymentOverdue` dead |
| `excel/` (44 files) | Import engine (parser, validators, er-matcher, 2,962-line RepositoryStorageAdapter), import-config registry, export engine, full-export (13 sheets), reports | excel-import-modal, export-dialog, tests | Core engine healthy; dead branches documented; writers duplicate download plumbing |
| `export/` (5 files) | Destination picker, warmup, ZIP writer/reader, archive export | export-dialog, backup checkpoint/file-restore | Healthy; `export-target.ts` docstring contains the incorrect "phantom elImtiyaz" narrative |
| `backup/` (7 files) | AES-256-GCM vault, backup service (restore = mock-only), scheduler, checkpoint, file restore | Settings backup tab, scheduler | Restore limitation verified; fixed salt vs docstring contradiction; hardcoded tenant IDs |
| `sync/` (7 files) | IndexedDB queue, online detector, service (backoff, conflicts), push handler, indicator UI | sync-provider, topbar | Healthy; push handler is a legacy/offline-drain subset (field omissions verified); `sync-indicator.tsx` violates layering |
| `receipt-pdf/` (12 files) | pdf-lib generators + ReportSpec adapters + shared primitives + download helper | features (finance, dashboard reports-tab imports global-reports directly) | Healthy; barrel omits global-reports |
| `ai/` (3 files) | LLM router, config storage, narrative generator | features, copilot | Healthy; hardcoded groq/llama-3.3 defaults are display-only |
| `storage/` (1 file) | `media-vault.ts`: private buckets, signed URLs, chat limits | payment proofs, student documents, expense attachments, chat | Healthy |
| `experimental/` (1 file) | `experimental-flags.ts`; single capability `er-pmae` | excel-import-modal:231,342, experimental-tab:53, tests | Not dead — default-OFF |
| `system-config.ts` | SystemConfigService + LocalConfigService | Settings → Configuration | `window.elImtiyaz?.config/app` branches runtime-dead (no such members on the exposed bridge) |
| Electron split | Main process imports only electron/node; all infrastructure is renderer-side via preload IPC | — | Clean separation |

## 6. Unresolved questions

1. **`staff_absences` server-side state machine**: asserted as DB-enforced; needs a check of `supabase/migrations/0010`+ and `supabase-workforce-attendance-repository.ts` write paths in a DB-focused session. (Addressed in RPT-7.)
2. **Calendar exam storage shape** (`kind: "custom"` + `target_entity_type: "exam"`): report claim not re-verified.
3. **`observeParentProfile` installment embedding** (`supabase-shared-repositories.ts:4901`): body not read.
4. **`guardSelfApproval` client-side enforcement** in the expense repo: not read this session.
5. **"5 system discount rules" count**: wiring verified; rule count not independently tallied.
6. **`SupabaseDashboardRepository.demographics`** null-birth-date handling: not re-verified.
7. **RLS `42501` on plain `.update({deleted_at})`** and `DELETE`-returns-200-on-0-rows: need migration/RLS review. (Addressed in RPT-7.)
8. **Impact assessment for the Ctrl+O autofill in production**: product/security question.
9. **Remediation priority for the two boundary violations** (domain→mock pricing-seed; sync-indicator→app/features): both compile and are tested; decide whether to codify exceptions or refactor.
10. **`types.ts` drift audit**: a systematic diff of `supabase/types.ts` against migrations 0001-0157 has never been done. (Partially addressed in RPT-7.)

**Bottom line:** The Infrastructure context report is trustworthy as a consolidated reference — its wiring matrix, invariant lists, and contradiction table are real and verified in source. Three corrections must be carried forward: (1) `window.elImtiyaz` **is** exposed by preload (the phantom is the *typed shape*, not the global), (2) `mock/fixtures` are production-reachable via the ungated Ctrl+O autofill and must not be pruned as dead, and (3) `mock/subject-behavior.ts` and `mock/pricing-seed.ts` (incl. its domain-layer consumer) are live production dependencies that the "mock = removable" framing endangers.
