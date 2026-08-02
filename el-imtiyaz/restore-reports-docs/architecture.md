# Architecture

> Detailed documentation of the El-Imtiyaz desktop application's architecture, folder structure, module responsibilities, data flow, and build process.

---

## Folder Structure

```
el-imtiyaz/
├── src/
│   ├── app/                          # Application shell + React Context providers
│   │   ├── app.tsx                   # Root component (router + providers)
│   │   ├── app-shell.tsx             # Sidebar + Topbar + content outlet
│   │   ├── splash-gate.tsx           # Auth gate (splash → login → shell)
│   │   └── providers/                # All 6 React Context providers (consolidated iter 16)
│   │       ├── auth-provider.tsx
│   │       ├── modal-provider.tsx
│   │       ├── repository-provider.tsx
│   │       ├── sync-provider.tsx
│   │       ├── toast-provider.tsx
│   │       └── user-preferences-provider.tsx
│   │
│   ├── core/                         # Pure utilities (no React, no I/O, no side effects)
│   │   ├── app-error.ts              # AppError + Errors factory (flattened iter 16)
│   │   ├── audit-actions.ts          # Audit action constants (flattened iter 16)
│   │   ├── logger.ts                 # Structured logger (flattened iter 16)
│   │   ├── result.ts                 # Result<T,E> discriminated union (flattened iter 16)
│   │   ├── format/                   # Formatting utilities
│   │   │   ├── currency.ts           # DZD formatting
│   │   │   ├── date.ts               # Date formatting
│   │   │   └── id.ts                 # ID generation (parent suffix, student code)
│   │   └── rbac/                     # Role-Based Access Control
│   │       ├── access-requirement.ts
│   │       ├── access-state.ts
│   │       ├── feature-gate.tsx      # React <FeatureGate> component
│   │       ├── feature-registry.ts   # Feature → permission mapping
│   │       ├── permissions.ts        # 56 permission constants + DEFAULT_ROLE_PERMISSIONS
│   │       ├── roles.ts              # 11 role constants + ROLE_LABELS_FR
│   │       └── session.ts            # Session type
│   │
│   ├── domain/                       # Domain layer (pure business logic, no I/O)
│   │   ├── model/                    # 16 entity model files
│   │   │   ├── academic.ts           # Class, Subject, ClassSubject, Assessment, Attendance, Homework
│   │   │   ├── ai.ts                 # AIProvider, AIProviderConfig, AIRequest, AIResponse
│   │   │   ├── audit.ts              # AuditEntry, AuditLogFilter, AuditLogQueryResult
│   │   │   ├── backup.ts             # BackupArchive, BackupRestoreResult
│   │   │   ├── calendar.ts           # CalendarEvent union (payment/audit/expense/follow_up/reminder/meeting/custom)
│   │   │   ├── expense.ts            # Expense, SubmitExpenseInput, ExpenseStatus
│   │   │   ├── index.ts              # Barrel re-export (partial — 9 of 16)
│   │   │   ├── ledger.ts             # LedgerEntry, AccountBalance, ParentLedgerSummary (now thin shim → calc/ledger/)
│   │   │   ├── operations.ts         # DashboardKpi, RevenuePoint, DebtByAgingBucket, AppNotification
│   │   │   ├── operations-workforce.ts # Supplier, PurchaseRequest, Delivery, InventoryItem
│   │   │   ├── parent.ts             # Parent, CreateParentInput, TransportDestination
│   │   │   ├── payment.ts            # Payment, Installment, AccountAdjustment, Receipt (now thin shim → calc/payment/)
│   │   │   ├── personnel.ts          # Personnel, ReleveEntry, ReleveActivity
│   │   │   ├── pricing.ts            # PricingConfig, PricingEntry, DiscountCode (now thin shim → calc/pricing/)
│   │   │   ├── student.ts            # Student, GradeLevel (14), AcademicLevel (3), GRADE_LEVELS
│   │   │   ├── workforce.ts          # Department, Shift, Schedule, Task, ChatChannel, OnboardingState
│   │   │   └── workflow.ts           # Workflow, WorkflowRun, WorkflowNodeResult
│   │   ├── repository/               # Repository contracts (interfaces)
│   │   │   ├── repository.ts         # 20 core repository interfaces (533 LOC)
│   │   │   ├── workforce-repository.ts # 9 workforce repository interfaces
│   │   │   └── operations-repository.ts # 5 operations repository interfaces
│   │   ├── calc/                     # Centralized math engine (refactor iter 1 — 1,974 LOC)
│   │   │   ├── index.ts              # Public API barrel
│   │   │   ├── shared/               # Pure utilities (no domain deps)
│   │   │   │   ├── money.ts          # absAmount, clampNonNegative, roundCurrency, sumOf, splitIntoParts
│   │   │   │   └── dates.ts          # MS_PER_DAY, daysBetweenFloor, isStrictlyPast, buildMonthlyBuckets
│   │   │   ├── ledger/               # Ledger calculations
│   │   │   │   ├── account-id.ts     # deriveAccountId
│   │   │   │   ├── balance.ts        # computeAccountBalance, computeParentSummary
│   │   │   │   ├── overdue.ts        # maxDaysOverdueFromLedger, buildOverdueDueDateMap
│   │   │   │   ├── entries.ts        # 5 entry factories (charge/payment/adjustment/refund/reversal)
│   │   │   │   └── charges.ts        # buildTuitionChargeEntries, buildTransportChargeEntry*
│   │   │   ├── payment/              # Payment calculations
│   │   │   │   ├── sums.ts           # sumPaidPayments, sumInstallmentsDue, sumInstallmentsPaid
│   │   │   │   ├── installments.ts   # installmentRemaining, totalOutstanding, overdueAmount, maxDaysOverdue, agingBucketFromDays
│   │   │   │   └── revenue.ts        # revenueByMonth, revenueByCategory, monthlyRevenue
│   │   │   ├── pricing/              # Pricing calculations
│   │   │   │   ├── discounts.ts      # applyDiscount, findDiscountByCode, computeSiblingDiscount
│   │   │   │   ├── tuition.ts        # tuitionForGradeLevel, tuitionForLevel, tuitionTranches*
│   │   │   │   └── transport.ts      # transportForDestination, transportForTier, transportTranchesForDestination
│   │   │   └── reconcile/            # Ledger reconciliation
│   │   │       ├── index.ts          # reconcileLedger orchestrator + re-exports
│   │   │       ├── checks.ts         # 7 individual checks
│   │   │       └── cross-checks.ts   # 3 cross-entity checks (payments, installments, balance sum)
│   │   ├── reconcile.ts              # Thin shim → calc/reconcile/ (iter 1)
│   │   ├── reconcile-types.ts        # ReconciliationViolation, ReconciliationReport types (split for circular-import avoidance)
│   │   ├── pii-mask.ts               # maskPII, unmaskPII (6 patterns: phone, email, IBAN, NN, parent/student names)
│   │   └── kahn.ts                   # detectCycle (DAG cycle detection for workflows)
│   │
│   ├── features/                     # Feature modules (each self-contained)
│   │   ├── academics/                # Classes, subjects, grades, attendance, homework (10 files)
│   │   ├── auth/                     # Splash screen, login screen
│   │   ├── crm/                      # Parents, students, batch registration, Excel import (6 files)
│   │   ├── dashboard/                # Dashboard, KPIs, calendar, alerts, see-details modal (6 files)
│   │   ├── financials/               # Payments, installments, expenses, receipts (7 files)
│   │   ├── personnel/                # HR, workforce, dashboards (15 files across 3 subfolders)
│   │   │   ├── dashboards/           # 7 role-based dashboards + primitives
│   │   │   ├── management/           # Employee directory, tasks, chat, departments
│   │   │   └── onboarding/           # 11-step onboarding wizard
│   │   ├── profile/                  # User profile, change password
│   │   ├── routing/                  # Access-denied panel
│   │   ├── settings/                 # 10 settings tabs (12 files)
│   │   └── workflow/                 # DAG editor, node palette, run detail drawer
│   │
│   ├── i18n/                         # Internationalization
│   │   ├── i18n.ts                   # i18next config
│   │   ├── fr.ts                     # French translations (primary)
│   │   ├── ar.ts                     # Arabic translations (secondary, RTL)
│   │   └── language-switcher.tsx     # FR/AR dropdown
│   │
│   ├── infrastructure/               # External adapters (no React)
│   │   ├── ai/                       # AI provider config + LLM adapter
│   │   │   ├── ai-config-storage.ts  # AES-256-GCM localStorage encryption
│   │   │   └── llm-adapter.ts        # LLMAdapter interface + mock implementation
│   │   ├── backup/                   # AES-256-GCM backup system
│   │   │   ├── aes-256.ts            # Web Crypto API (PBKDF2 100k iters, AES-256-GCM)
│   │   │   ├── backup-service.ts     # runBackup, restore, purgeExpired, deleteArchive
│   │   │   ├── backup-scheduler.ts   # 24h cycle (5min in dev)
│   │   │   └── indexed-db-vault.ts   # IndexedDB archive storage
│   │   ├── excel/                    # Excel import/export
│   │   │   ├── export-engine.ts      # exportToXlsx, exportToCsv, downloadBlob
│   │   │   ├── reports.ts            # Revenue, Debt, Roster report builders
│   │   │   └── import-engine/        # Schema-driven import engine (iter 11)
│   │   │       ├── schemas/          # ETAT, BON, Devis, REF schemas
│   │   │       ├── parsers/          # ExcelJS wrapper + sheet detector
│   │   │       ├── validators/       # Row validator + 6 field rules
│   │   │       ├── dedupe/           # Upsert matcher (identity extraction)
│   │   │       ├── storage/          # In-memory adapter (Supabase adapter future)
│   │   │       ├── reporters/        # JSON + Excel report generators
│   │   │       └── utils/            # ID, checksum, logger
│   │   ├── mock/                     # Mock repository layer (refactor iter 2)
│   │   │   ├── repositories/         # 14 per-entity files + shared store
│   │   │   │   ├── mock-store.ts     # Shared MockStore + appendAudit + delay
│   │   │   │   ├── auth-repository.ts
│   │   │   │   ├── parent-repository.ts
│   │   │   │   ├── student-repository.ts
│   │   │   │   ├── academic-repository.ts  (5 repos)
│   │   │   │   ├── financial-repository.ts (4 repos)
│   │   │   │   ├── personnel-audit-repository.ts (3 repos)
│   │   │   │   ├── notification-alerts-repository.ts (2 repos)
│   │   │   │   ├── dashboard-repository.ts
│   │   │   │   ├── calendar-repository.ts
│   │   │   │   ├── pricing-repository.ts
│   │   │   │   ├── ledger-repository.ts
│   │   │   │   ├── workflow-repository.ts (2 repos)
│   │   │   │   ├── ai-config-repository.ts
│   │   │   │   └── backup-repository.ts
│   │   │   ├── workforce/            # 9 workforce repos (moved iter 2, per-entity split deferred)
│   │   │   ├── operations/           # 5 operations repos (moved iter 2, per-entity split deferred)
│   │   │   ├── mock-repositories.ts   # Thin barrel (117 LOC, was 3,206)
│   │   │   ├── workforce-mock-repositories.ts # Thin barrel (11 LOC, was 1,075)
│   │   │   ├── operations-mock-repositories.ts # Thin barrel (11 LOC, was 819)
│   │   │   ├── seed-data.ts          # 8 parents, 15 students, 6 classes, etc.
│   │   │   ├── academic-seed.ts      # Class subjects, assessments, attendance, homework, releve
│   │   │   ├── ledger-seed.ts        # Generates ledger entries from pricing config
│   │   │   ├── pricing-seed.ts       # Official 2026-2027 fee schedule (14 grades, 4 destinations)
│   │   │   ├── workflow-seed.ts      # 3 seeded workflows + 15 runs
│   │   │   └── subject-behavior.ts   # Reactive Observable implementation
│   │   ├── supabase/                 # Supabase adapter (partial — Auth + Approval only)
│   │   │   ├── supabase-client.ts    # Singleton client + error mapper
│   │   │   ├── types.ts              # Database type definitions
│   │   │   ├── supabase-repositories.ts # Factory (mock fallback)
│   │   │   └── repositories/         # 2 Supabase implementations
│   │   │       ├── supabase-auth-repository.ts
│   │   │       └── supabase-approval-repository.ts
│   │   ├── sync/                     # Offline-first sync queue
│   │   │   ├── sync-service.ts       # Orchestrator with retry/backoff
│   │   │   ├── sync-queue-store.ts   # IndexedDB-backed queue
│   │   │   ├── sync-types.ts
│   │   │   ├── sync-indicator.tsx    # Topbar widget
│   │   │   └── online-detector.ts    # navigator.onLine + HTTP probe
│   │   ├── receipt-pdf.ts            # PDF receipt + account statement + bulletin + payslip generation
│   │   └── system-config.ts          # SystemConfigService (Supabase) + LocalConfigService (Electron)
│   │
│   ├── shared/                       # Shared UI + layout + hooks
│   │   ├── layout/                   # App chrome + layout helpers (extracted iter 16)
│   │   │   ├── topbar.tsx            # Cmd+K search, alerts bell, profile menu
│   │   │   ├── sidebar.tsx           # Collapsible, RBAC-gated navigation
│   │   │   ├── modal-host.tsx        # Modal portal host
│   │   │   ├── toast-viewport.tsx    # Toast viewport
│   │   │   ├── page-header.tsx       # Page title + actions
│   │   │   ├── page-tabs.tsx         # Unified tab navigation (elevated/underline/rail variants)
│   │   │   ├── state-views.tsx       # LoadingState, ErrorState, EmptyState
│   │   │   ├── coming-soon-card.tsx
│   │   │   └── gated-content.tsx     # RBAC gate wrapper
│   │   ├── ui/                       # shadcn/ui primitives + moved UI primitives
│   │   │   ├── unified-modal.tsx     # 100% of modals use this (dialog/drawer/command-palette variants)
│   │   │   ├── button.tsx, card.tsx, badge.tsx, etc. (22 primitives)
│   │   │   ├── form-field.tsx, money-input.tsx, kpi-card.tsx, status-chip.tsx
│   │   │   └── particle-canvas.tsx   # React wrapper for particle engine
│   │   ├── hooks/                    # useObservable, useDebounce
│   │   ├── particle-engine/          # GPU-free particle animation (iter 11)
│   │   └── search-index.ts           # 6-entity search index (flattened iter 16)
│   │
│   ├── test/                         # Test suite (66 files, 1,444 tests)
│   │   ├── setup.ts                  # jsdom polyfills (ResizeObserver, MutationObserver, indexedDB)
│   │   ├── unit/                     # Unit tests
│   │   │   ├── calc/                 # Math engine tests (257 tests, refactor iter 1)
│   │   │   ├── excel-import-engine/  # Excel engine tests
│   │   │   ├── mock/                 # Mock repository smoke tests (refactor iter 2)
│   │   │   ├── workforce/            # Workforce domain tests
│   │   │   └── ... (20+ other unit test files)
│   │   ├── component/                # React component tests
│   │   └── integration/              # Cross-layer integration tests
│   │
│   ├── main.tsx                      # React entry point (calls initUserPreferences before render)
│   ├── index.css                     # Tailwind directives + CSS variables
│   └── vite-env.d.ts
│
├── electron/                         # Electron main process
│   ├── main.ts                       # BrowserWindow + app lifecycle
│   ├── preload.ts                    # Context bridge (config read/write, app restart)
│   ├── ipc-handlers.ts               # IPC handlers for local config + app restart
│   ├── tsconfig.json
│   └── tsconfig.preload.json
│
├── supabase/                         # Supabase backend
│   ├── migrations/                   # 24 SQL migrations (~3,000 LOC)
│   │   ├── 0001_extensions.sql       # pgcrypto, pgjwt, uuid-ossp, pg_trgm, btree_gist
│   │   ├── 0002_tenants_and_users.sql
│   │   ├── 0003_rbac.sql             # 11 roles, 56 permissions, role-permission matrix
│   │   ├── 0004_academic_structure.sql
│   │   ├── 0005_crm.sql              # Parents, students, activation codes
│   │   ├── 0006_pricing.sql          # 14 grade levels, 4 transport destinations, 5 discounts
│   │   ├── 0007_financial.sql        # Payments, installments, ledger_entries (immutable)
│   │   ├── 0008_expenses.sql         # Expense workflow + no-self-approval trigger
│   │   ├── 0009_attendance_hr.sql    # Personnel, releve + prevent-self-releve trigger
│   │   ├── 0010_workforce.sql        # Departments, shifts, tasks, chat, onboarding
│   │   ├── 0011_operations.sql       # Suppliers, deliveries, inventory
│   │   ├── 0012_workflow.sql         # Workflows, AI configs
│   │   ├── 0013_calendar_notifications_backup.sql
│   │   ├── 0014_audit.sql            # Append-only audit_logs (UPDATE/DELETE blocked)
│   │   ├── 0018_storage.sql          # 10 storage buckets + RLS
│   │   ├── 0019_rls_policies.sql     # RLS for EVERY table (60+ policies)
│   │   ├── 0020_indexes.sql          # 50+ performance indexes
│   │   ├── 0021_views.sql            # 5 materialized views + 10 regular views
│   │   ├── 0022_functions.sql        # 14 PostgreSQL functions
│   │   ├── 0023_seed.sql             # Reference data (1 tenant, 11 roles, 56 permissions, pricing)
│   │   └── 0024_system_settings.sql  # system_settings table + 40+ default settings
│   ├── functions/                    # 11 Edge Functions
│   │   ├── _shared/                  # CORS, supabase client, audit helpers
│   │   ├── approve-signup-request/
│   │   ├── bind-activation-code/
│   │   ├── collect-payment/          # Atomic payment collection
│   │   ├── refund-payment/           # Atomic refund with ledger reversal
│   │   ├── ai-proxy/                 # AI provider proxy (keys never leave server)
│   │   ├── workflow-execute/         # DAG workflow executor
│   │   ├── run-overdue-scan/         # Cron: daily overdue scan
│   │   ├── expire-pending-approvals/ # Cron: daily approval expiry
│   │   ├── refresh-materialized-views/ # Cron: daily MV refresh
│   │   ├── purge-expired-backups/    # Cron: weekly backup purge
│   │   └── update-server-secret/     # Management API secret updates
│   └── config.toml                   # Supabase project configuration
│
├── package.json                      # Dependencies + scripts
├── vite.config.ts                    # Vite config (code-splitting, path aliases)
├── vitest.config.ts                  # Vitest config (jsdom, coverage)
├── tsconfig.json                     # TypeScript config (strict)
├── tailwind.config.cjs               # Tailwind config (design tokens, animations)
├── postcss.config.cjs                # PostCSS config
├── index.html                        # Vite entry HTML
└── restore-reports-docs/             # This documentation folder
```

---

## Module Responsibilities

### `core/` — Pure Utilities
**Responsibility:** Framework-agnostic, side-effect-free utilities. No React, no I/O, no network.
**Depends on:** Nothing.
**Consumed by:** Everything.

### `domain/` — Business Logic
**Responsibility:** Entity models, repository contracts (interfaces), and pure calculation functions. No I/O, no React.
**Depends on:** `core/`.
**Consumed by:** `infrastructure/`, `features/`, `app/`.

The `domain/calc/` subfolder (refactor iter 1) is the **single source of truth for all math/calculation logic**. Every balance, debt, payment total, or remaining amount in the application MUST be computed through one of these functions. Hardcoding the same formula in 2+ places is forbidden.

### `infrastructure/` — External Adapters
**Responsibility:** Concrete implementations of repository contracts (mock + Supabase), external service integrations (AI, backup, Excel, sync). No React.
**Depends on:** `domain/`, `core/`.
**Consumed by:** `app/providers/`.

The mock layer (`infrastructure/mock/repositories/`) is the default backend. Supabase (`infrastructure/supabase/`) is a partial alternative (Auth + Approval only). Selection is automatic via `VITE_USE_SUPABASE` env var + `isSupabaseConfigured()` check.

### `features/` — Feature Modules
**Responsibility:** React components for each feature area. Each feature is self-contained with its own tabs, modals, drawers, and forms.
**Depends on:** `domain/`, `core/`, `shared/`, `infrastructure/` (via hooks).
**Consumed by:** `app/`.

### `shared/` — Shared UI + Layout
**Responsibility:** Reusable UI primitives (shadcn/ui style) and layout helpers (topbar, sidebar, page-tabs). No business logic.
**Depends on:** `core/`, `domain/` (types only).
**Consumed by:** `features/`, `app/`.

### `app/` — Application Shell
**Responsibility:** App entry point, router, React Context providers, splash gate.
**Depends on:** Everything.
**Consumed by:** `main.tsx`.

### `i18n/` — Internationalization
**Responsibility:** i18next configuration + FR/AR translation dictionaries + language switcher.
**Depends on:** `core/`.
**Consumed by:** `app/`, `features/`, `shared/`.

---

## Data Flow

### Read Flow (Reactive)
```
React Component
    │
    ▼
useObservable(() => repos.parents.observe(), [])
    │
    ▼
Repository (Mock or Supabase)
    │
    ▼
SubjectBehavior<T[]> (in-memory)  ◄── SyncProvider (offline queue)
    │                                        │
    ▼                                        ▼
Component re-renders on next emission    IndexedDB (queue persistence)
```

### Write Flow (Audited)
```
React Component
    │
    ▼
const result = await repos.payments.collect(input, actorId)
    │
    ▼
Repository validates input
    │
    ▼
Repository mutates in-memory store (or Supabase table)
    │
    ▼
appendAudit({ action, entityType, entityId, actorId, diff })
    │
    ▼
SubjectBehavior.set() → all subscribers re-render
    │
    ▼
SyncProvider.enqueue() → IndexedDB queue → Supabase push (when online)
    │
    ▼
Result<T> returned to component (Ok or Err)
```

### Ledger Flow (Accounting)
```
Payment collected
    │
    ▼
MockPaymentRepository.collect()
    │
    ├─► store.payments.unshift(payment)        ◄── denormalized view
    │
    └─► store.ledger.push(ledgerEntry)          ◄── canonical source
            │
            ▼
        computeAccountBalance(entries, accountId)
            │
            ▼
        computeParentSummary(entries, parentId)
            │
            ▼
        Dashboard KPIs, Debt tab, Parent drawer all read same computed values
```

---

## Business Logic Flow

### Payment Collection → Ledger Entry → Balance
1. User opens Counter Payment modal, selects parent + installment.
2. Modal calls `repos.payments.collect(input, session.userId)`.
3. `MockPaymentRepository.collect()`:
   - Creates `Payment` record with status (cash → paid, check/transfer → pending).
   - Creates `LedgerEntry` (type=payment, amount=-input.amount) via `createPaymentEntry()`.
   - Appends both to `store.payments` and `store.ledger`.
   - Calls `appendAudit()` with before/after diff.
   - Returns `Ok(payment)`.
4. `store.payments$` and `store.ledger$` Subjects emit → all subscribers re-render.
5. Dashboard `outstandingDebt` KPI recomputes via `computeParentSummary(store.ledger, parentId)`.
6. Parent drawer's financial profile recomputes the same way.
7. SyncProvider enqueues the payment for Supabase push (if online + configured).

### Refund → Ledger Reversal
1. User clicks "Rembourser" on a payment.
2. `MockPaymentRepository.refund(id)`:
   - Finds original `LedgerEntry` (type=payment, sourceId=id).
   - Creates reversal `LedgerEntry` (type=reversal, amount=-original.amount, reversesId=original.id) via `createReversalEntry()`.
   - Updates payment status to "refunded".
   - Appends both to store.
   - Calls `appendAudit()`.
3. Balance recomputes correctly: original payment (-500) + reversal (+500) = 0.

### Reconciliation
1. `MockLedgerRepository.reconcile()` runs 10 checks:
   - 7 structural: duplicate IDs, required fields, signed-amount convention, account ID match, reversal integrity, duplicate receipt numbers, tenant consistency.
   - 3 cross-entity: every Payment has matching ledger entry, every Installment has matching charge entry, sum of balances = sum of entries.
2. Returns `ReconciliationReport` with `{ passed, summary: { errors, warnings, infos } }`.
3. Pure function — takes entries array, returns violations. No side effects.

---

## UI Architecture

### Unified Modal System
**100% of modals** use `<UnifiedModal>` with three variants:
- `variant="dialog"` — centered overlay (forms, confirmations).
- `variant="drawer"` — right-side slide-over (detail views).
- `variant="command-palette"` — top-anchored search palette (Cmd+K).

Enforced by regression test: no production file may import `@radix-ui/react-dialog` directly except `unified-modal.tsx`.

### Tab Navigation
`<PageTabs>` primitive with three variants:
- `variant="elevated"` — segmented control with sliding pill (default, used by all Hub pages).
- `variant="underline"` — dense layouts, sub-tabs in modals.
- `variant="rail"` — vertical rail (reserved for genuinely different contexts).

Sliding ink-bar (underline) and sliding pill (elevated) use `useLayoutEffect` + `ResizeObserver` + `MutationObserver` for accurate positioning.

### RBAC Gating
Three-layer defense in depth:
1. **Feature Registry** — `FeatureRegistry` maps features to required permissions.
2. **FeatureGate component** — `<FeatureGate feature="X">` renders children or locked placeholder.
3. **Repository layer** — repositories check permissions server-side (or in mock).

### State Management
- **Server state** — TanStack Query for cached server data (where Supabase is used).
- **Client state** — React Context (6 providers in `app/providers/`).
- **User preferences** — `UserPreferencesProvider` (theme, locale, timezone, currency) in localStorage.
- **Reactive data** — `SubjectBehavior<T>` observable pattern from repository layer.
- **Sync queue** — IndexedDB-backed offline-first queue.

---

## Database Interactions

### Mock Layer (Default)
- In-memory `MockStore` singleton with 20 reactive collections.
- `SubjectBehavior<T>` wraps each collection for reactive reads.
- `appendAudit()` writes to prepend-only audit log.
- `delay(ms)` simulates network latency.

### Supabase Layer (Partial)
- Singleton `supabase-client.ts` reads connection config from Electron `userData/config.json` or localStorage.
- `supabaseErrorToAppError()` maps Postgres error codes to `AppError` categories.
- Only `AuthRepository` and `ApprovalRepository` fully ported; other 38 repos fall back to mock.
- All 24 SQL migrations + 11 Edge Functions + RLS policies are production-ready.

### Sync Layer
- `SyncService` orchestrates offline-first queue.
- Triggers: app startup, online transition, new entry queued (debounced 2s), periodic poll (30s online / 120s offline), manual sync.
- Mock invariant: mock entries auto-marked `skipped_mock` at queue time AND re-checked at drain time (defense in depth).
- Retry: exponential backoff (1s × 2^attempts), max 5 attempts.
- IndexedDB persistence survives app restarts.

---

## Build Process

### Development
```bash
npm install
npm run dev          # Vite dev server (HMR)
npm run electron:dev # Vite + Electron concurrent
```

### Production Build
```bash
npm run build        # tsc -b + vite build
npm run build:electron # tsc -p electron/tsconfig.json + preload rename
npm run electron:build # vite build + tsc + electron-builder
```

### Vite Code-Splitting
`manualChunks` defines 9 vendor chunks:
- `vendor-react` (181 kB) — React + ReactDOM.
- `vendor-radix` (134 kB) — All Radix primitives.
- `vendor-i18n` (48 kB) — i18next + react-i18next.
- `vendor-charts` (410 kB) — Recharts (lazy-loaded on first dashboard view).
- `vendor-pdf` (429 kB) — pdf-lib (lazy-loaded on first Receipts tab).
- `vendor-excel` (940 kB) — ExcelJS (lazy-loaded on first Excel import/export).
- `vendor-forms` (92 kB) — React Hook Form + Zod + @hookform/resolvers.
- `vendor-router` (52 kB) — React Router DOM.
- `vendor-query` (44 kB) — TanStack Query.

Initial dashboard load: ~779 kB raw / ~224 kB gzipped (72% reduction vs monolithic bundle).

### Testing
```bash
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch mode
```

### Typecheck
```bash
npm run typecheck    # tsc --noEmit
```

### Lint
```bash
npm run lint         # eslint . --ext ts,tsx
```

---

## Configuration

### Environment Variables (Legacy)
- `VITE_USE_SUPABASE` — `true` to use Supabase, `false` (default) for mock.
- `VITE_SUPABASE_URL` — Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key.

### UI-Driven Configuration (Iter 13)
All configuration is accessible from Settings → Configuration tab:
- **Connexion** — Supabase URL + anon key + use_supabase toggle (stored locally in Electron `userData/config.json`).
- **IA** — Groq + OpenRouter API keys (stored as Supabase Edge Function env vars via Management API).
- **Email** — Resend API key + from address + from name.
- **Push** — FCM server key + sender ID.
- **Sauvegardes** — Passphrase + retention days + schedule.
- **Fonctionnalités** — Feature flags (AI, workflows, backup daemon, realtime, Arabic RTL).

Secret values NEVER stored in the database — only as Supabase Edge Function environment variables. UI shows "********" for configured secrets.

---

## Related Documents

- [`project-overview.md`](./project-overview.md) — why the project exists, what problem it solves
- [`decisions.md`](./decisions.md) — why architectural choices were made
- [`current-status.md`](./current-status.md) — what's done, what's broken
- [`iteration-history.md`](./iteration-history.md) — how the architecture evolved over 18 iterations
