# Current Status

> Snapshot of the El-Imtiyaz project's current state as of HEAD `88b42fb` (2026-08-01).

---

## At a Glance

| Metric | Value |
|---|---|
| **Tests passing** | 1,420 / 1,444 (98.3%) |
| **Pre-existing failures** | 24 (all in Excel-import test files — see [known-issues.md](./known-issues.md)) |
| **TypeScript errors** | 0 (`tsc --noEmit` clean) |
| **Production build** | Succeeds (~15s) |
| **Largest source file** | 600 LOC (`financial-repository.ts`) |
| **Total source LOC** | ~80,000 |
| **Total test LOC** | ~25,000 |
| **Iterations completed** | 18 (16 original + 2 refactor) |
| **Git commits** | 21 |

---

## Completed Modules

### Core Architecture 
- **Layered architecture** — `core/` (pure utils), `domain/` (business logic + calc engine), `infrastructure/` (adapters), `features/` (UI modules), `shared/` (UI primitives), `app/` (shell + providers).
- **Pure domain layer** — no I/O, no React, fully testable. Repository contracts return `Promise<Result<T>>` for fallible ops and `Observable<T>` for reactive reads.
- **Centralized math engine** (`src/domain/calc/` — 1,974 LOC across 16 modules) — single source of truth for all calculations. Refactor iter 1.
- **Split mock layer** (`src/infrastructure/mock/repositories/` — 14 per-entity files) — was 3,206-LOC monolith. Refactor iter 2.

### Domain Models 
- Parent, Student (14 grade levels, 3 academic levels), Academic (Class/Subject/ClassSubject/Assessment/Attendance/Homework), Payment (3 methods, 6 statuses, installments, adjustments), Expense (6 statuses, 9 categories, anomaly scoring), Personnel (11 roles, Releve), Operations (Supplier/PurchaseRequest/Delivery/Inventory), Workflow (DAG with 5 node types, 17 subtypes), Audit (append-only), Calendar, Notifications, Backup, AI Config.

### Financial System 
- **Ledger-based accounting** — every financial value computed by replaying immutable ledger entries. Balances never stored as isolated numbers.
- **Reconciliation engine** — 7 structural checks + 3 cross-entity checks. Detects duplicate IDs, orphan reversals, balance sum mismatches, signed-amount convention violations.
- **Payment workflow** — collect (cash → paid, check/transfer → pending), refund (with ledger reversal), adjust (account adjustments replace deprecated scholarships).
- **Installment schedules** — 3-tranche default per grade level + per-destination transport. Flexible per-parent due date overrides + cycle-based re-templating (Primaire/CEM/Lycée).
- **Expense workflow** — submit → approve → disburse → settle. No-self-approval enforced at UI + repository + DB layers. State machine validation. Anomaly detection (signal not verdict).
- **Official 2026-2027 pricing** — 14 grade levels, 4 transport destinations, 5 canonical discounts, complementary services, 2nd apron surcharge. All configurable via UI.

### UI / UX 
- **100% Unified Modal System** — zero raw `@radix-ui/react-dialog` imports in production code (enforced by regression test). Three variants: dialog, drawer, command-palette.
- **Unified tab navigation** — `<PageTabs>` with elevated/underline/rail variants. Sliding ink-bar + sliding pill indicators. All Hub pages use consistent `variant="elevated"`.
- **11 role-based dashboards** — SuperAdmin, FinancialOfficer, Teacher, SupportStaff, Manager, Buyer, Driver, WarehouseWorker, Worker, Parent, Student.
- **RBAC** — 11 roles, 56 permissions, 3-layer gating (FeatureRegistry → FeatureGate → `<GatedContent>`). Locked items render at 40% opacity.
- **Internationalization** — FR primary + AR secondary (RTL). `initLocale()` prevents LTR flash for Arabic users.
- **User preferences** — theme (dark/light), locale, timezone, currency. Consolidated in `UserPreferencesProvider`. Persists to localStorage.

### Feature Hubs 
- **Auth** — Splash screen with particle animation, login with 9 demo accounts.
- **Dashboard** — KPIs (students, parents, staff, monthly revenue, outstanding debt, attendance rate, overdue alerts), 12-month revenue chart, debt aging buckets, demographics (4 slices: grade, gender, age, capacity), integrated calendar, alerts feed, academic year selector with date range filtering.
- **CRM** — Parents list, students list, batch registration (atomic with rollback), parent detail drawer (4 sections), student detail drawer (4 tabs), Excel import (schema-driven, 4 sheet types).
- **Academics** — Classes list, class detail (4 tabs: Élèves/Matières/Présences/Notes), subjects directory (CRUD + class-subject assignment), roll call screen (30-second workflow), grade entry (inline-editable with live average), homework push + history.
- **Financials** — Counter payment modal, installment schedule tab (with custom due dates + cycle regeneration), debt tab (Top 20 debtors + per-grade breakdown), expense workflow, receipts tab (auto-generated PDFs).
- **Personnel** — Employee directory, employee profile drawer, department management, task management (5-column Kanban), chat panel, onboarding wizard (11 steps), 6 role dashboards.
- **Workflow** — DAG editor (SVG-based, draggable nodes, bezier edges, cycle detection), node palette (17 subtypes), execution monitor, run detail drawer.
- **Settings** — 10 tabs (Général, Tarification, Journal d'audit, Matrice RBAC, Inscriptions, Configuration, Synchronisation, IA, Sauvegardes, Fonctionnalités verrouillées).
- **Profile** — Header card, permissions grid, recent activity, change password (with strength validation + session revocation).

### Infrastructure 
- **Mock repository layer** — 39 singletons (25 core + 9 workforce + 5 operations) across 14 per-entity files. Shared `MockStore` with 20 reactive collections.
- **Supabase adapter (partial)** — Auth + Approval repositories fully ported. 24 SQL migrations, 11 Edge Functions, 60+ RLS policies ALL production-ready. Other 38 repos fall back to mock.
- **Sync service** — Offline-first queue with IndexedDB persistence. Mock exclusion (defense in depth). Auto-sync triggers. Exponential backoff retry.
- **AI integration** — BYOK config (Groq + OpenRouter). PII masking (6 patterns). Mock LLM adapter. Narrative generator, drafting assistant, anomaly explainer. API keys never leave server (Edge Function proxy).
- **Backup system** — AES-256-GCM (PBKDF2 100k iterations) + IndexedDB vault. 365-day retention. Backup scheduler (24h cycle). 3 seed archives.
- **Excel import/export** — Schema-driven import engine (ETAT, BON, Devis, REF schemas). ExcelJS-based export (revenue, debt, roster reports).
- **PDF generation** — Receipts, account statements, report cards (bulletins), payslips.
- **Particle engine** — GPU-free particle animation with morphing (logo/circular/linear modes). Replaced native `sharp` dependency with Web APIs.

### Testing 
- **1,444 tests** across 66 files (1,420 passing, 24 pre-existing Excel failures).
- **Test trajectory:** 0 → 158 → 273 → 330 → 393 → 527 → 723 → 807 → 836 → 980 → 1004 → 1015 → 1027 → 1107 → 1149 → 1180 → 1444. Zero regressions across all refactors.
- **Coverage areas:** unit (calc, excel, mock, workforce, domain), component (modals, dashboards, tabs), integration (repositories, ledger, workflows).
- **Regression guards** — modal unification regression test, settings redesign regression test, structure refactor regression test.

---

## Incomplete Modules

### Supabase Adapter (Partial)
- **Done:** Auth repository (signIn, signOut, refreshSession, changePassword, signInWithGoogle), Approval repository (listPending, approveWithExistingParent, approveWithNewParent, reject, bindActivationCode).
- **Not done:** 38 other repositories still use mock. SQL schema + Edge Functions + RLS policies ALL complete — only the TypeScript adapter layer is missing. Each repository can be ported independently by replacing mock in `getSupabaseRepositories()`.

### Sync Service (Minimal)
- **Done:** Offline-first queue, mock exclusion, auto-sync triggers, retry with backoff, IndexedDB persistence, topbar indicator, settings tab.
- **Not done:** Per-entity sync push routing (currently upserts everything to single `sync_queue` table — production may want per-table routing). Realtime sync conflict resolution (last-write-wins may lose data). Sync queue UI improvements (pagination, filtering by status, retry individual failed entries).

### Excel Import (Partial)
- **Done:** Schema-driven engine (ETAT, BON, Devis, REF). Auto-detection via header aliases. Per-row validation with collect-all-errors. Atomic commit. Idempotent upsert. JSON + Excel report generation. 96.5% acceptance rate on real ETAT sheet.
- **Not done:** BON + Devis sheets use per-client multi-row layout that doesn't fit tabular schema model (most rows rejected — carried known limitation). 24 pre-existing test failures (2 schema mismatches, 2 engine behavior, 7 comprehensive, 13 missing fixture).

---

## Missing Business Logic

- **Real AI API calls** — mock LLM adapter returns canned responses. Real Groq + OpenRouter adapters require Edge Function proxy (Edge Function exists, just needs real API keys configured).
- **Real Supabase Edge Function deploy** — mock returns success after 1.5s. Real deploy requires Supabase CLI.
- **Real offsite backup vault** — currently IndexedDB only. Production requires separate physical location per plan §13.03.
- **Realtime sync** — Supabase Realtime not yet wired (postgres_changes channel ready in schema, no client subscription).
- **Mobile parity verification** — Android app (separate repo) not verified against current API.
- **Routing/OSRM/TSP solver** — explicitly NOT in plan (stubbed for Android parity only).

---

## Broken Functionality

### 24 Pre-Existing Excel Test Failures
All 24 failures are in Excel-import test files. **None affect business logic.** See [known-issues.md](./known-issues.md) for full detail.

| Test file | Failures | Root cause |
|---|---|---|
| `schemas.test.ts` | 2 | Schema constants disagree with test expectations (headerRow: 1 vs expected 10/13) |
| `engine.test.ts` | 2 | Audit event emission + validation relaxation mismatch |
| `excel-import-comprehensive.test.ts` | 7 | Synthetic ETAT workbook builder produces rows engine doesn't import |
| `excel-real-file.test.ts` | 13 | `test-fixture-suivis.xlsx` referenced but never committed to repo |

---

## Technical Debt

| Item | Severity | Carried Since | Notes |
|---|---|---|---|
| 24 Excel test failures | Medium | Iter 11 (commit `29e794c`) | Isolated to Excel tests; no business logic impact |
| AI keys two storage layers | Low | Iter 13 | `AIConfigTab` writes localStorage; `ConfigurationTab → IA` writes Supabase Edge Function env. Two layers unaware of each other. |
| `overdueAmount` semantics divergence | Low | Iter 6 | `payment.ts` uses installment due dates; `ledger.ts` uses charge entry timestamps. Ledger canonical for dashboard. |
| RBAC override in localStorage | Low | Iter 15 | Should be Supabase `tenant_role_overrides` table (SQL schema ready). |
| 38 repositories on mock | Medium | Iter 12 | SQL schema + Edge Functions + RLS ALL ready; only TypeScript adapter missing. |
| BON + Devis sheet importers | Low | Iter 11 | Per-client multi-row layout doesn't fit tabular model. |
| `dist/` and `dist-electron/` committed | Low | Iter 3 (commit `1356665`) | Build artifacts in git. Should be `.gitignore`d. |
| `domain/model/index.ts` barrel incomplete | Trivial | Iter 16 | Re-exports only 9 of 16 model files. Either complete or delete. |
| 16 test files with `iteration-N-` prefix | Trivial | Iter 4–16 | Low-priority cleanup; would lose traceability to docs. |

---

## Known Bugs

1. **Topbar quick-backup button** — navigates to `/settings?tab=backup` but only auto-selects tab on initial mount (not on param change while already on page). Minor UX issue.
2. **DAG canvas edge creation** — mouse-only (no touch support) per plan §10.02.
3. **OnlineDetector probe** — uses `google.com/generate_204`, fails in air-gapped networks.
4. **Sync push handler** — minimal, upserts everything to single `sync_queue` table. Production may want per-entity routing.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Supabase project misconfiguration | Medium | High (app won't connect) | UI-driven configuration tab + "Tester la connexion" button + mock fallback |
| AI API key leakage | Low | Critical | Keys never leave server (Edge Function proxy); AES-256-GCM at rest |
| Backup passphrase loss | Low | Critical (data unrecoverable) | UI enforces passphrase confirmation; no recovery mechanism by design |
| Excel import data corruption | Low | Medium | Idempotent upsert + checksum verification + dry-run preview before commit |
| Ledger corruption | Low | Critical | Reconciliation engine (10 checks) + immutable entries + reversal pattern (never delete) |
| Multi-tenant data leakage | Low | Critical | RLS on every table + `tenant_id` NOT NULL + `service_role` key never in client |
| Mock data syncing to Supabase | Low | High | Defense in depth: flagged at queue time AND re-checked at drain time |

---

## Blockers

**No current blockers.** The project is in a healthy state:
- All business logic tests pass (1,420/1,420 non-Excel tests).
- TypeScript compiles cleanly.
- Production build succeeds.
- Desktop app runs end-to-end.
- Supabase backend schema + Edge Functions are production-ready (only secrets need filling).

The 24 Excel test failures are **pre-existing technical debt**, not a blocker — they don't affect any business logic and are isolated to Excel-import test files.

---

## Related Documents

- [`known-issues.md`](./known-issues.md) — detailed list of known bugs and technical debt
- [`next-steps.md`](./next-steps.md) — prioritized roadmap for next work
- [`architecture.md`](./architecture.md) — how the codebase is organized
- [`iteration-history.md`](./iteration-history.md) — how we got here
