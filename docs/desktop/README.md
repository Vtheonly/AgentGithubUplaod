# El-Imtiyaz Desktop Terminal

> Educational & Operational Management Platform — Desktop Terminal (Electron + React + TypeScript)

The Desktop Terminal is the full-capability administrative node of the El-Imtiyaz platform. It is the only node that runs backup routines, parses raw `.xlsx` files, and hosts the visual DAG workflow canvas editor.

For the full project specification, see [`../project-specification/`](../project-specification/). For engineering work logs, see [`../development/`](../development/).

---

## Quick Start

```bash
cd elimtiyaz-desktop
npm install
npm run dev          # Vite dev server (HMR)
npm run electron:dev # Vite + Electron concurrent
npm test             # Run test suite (414 tests passing)
npm run typecheck    # TypeScript check (0 errors)
npm run build        # Production build
```

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Runtime | Electron 33 |
| Build tool | Vite 6 |
| UI framework | React 18 |
| Language | TypeScript 5.7 |
| Styling | Tailwind CSS 3.4 + shadcn/ui + Radix UI |
| State | React hooks + observable repositories |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions + Storage) |
| Testing | Vitest 2 |
| Charts | Recharts / visx |
| PDF | pdf-lib (planned migration to `@react-pdf/renderer`) |
| Excel | ExcelJS (import/export only — formula engine purged) |

---

## Project Structure

```
elimtiyaz-desktop/
├── electron/                    Electron main process
├── src/
│   ├── app/                     App providers (auth, repository, toast, sync)
│   ├── core/                    Core utilities (format, rbac, i18n)
│   ├── domain/                  Domain layer (pure, no IO)
│   │   ├── model/               Domain entities (Parent, Student, Payment, etc.)
│   │   ├── calc/                Pure calculation engine
│   │   │   ├── pricing/         Tuition, transport, discount rules
│   │   │   ├── payment/         Waterfall allocator, LIFO reversal, queries
│   │   │   ├── ledger/          Balance computation, charge builders
│   │   │   ├── reconcile/       Ledger integrity checks
│   │   │   └── shared/          Money + date utilities
│   │   └── repository/          Repository interfaces
│   ├── features/                Feature modules (one per Hub)
│   │   ├── crm/                 Hub 3: Parents & Students
│   │   ├── financials/          Hub 2: Financial Portal
│   │   ├── academics/           Hub 4: Academic Management
│   │   ├── personnel/           Personnel & dashboards
│   │   ├── dashboard/           Hub 1: Dashboard
│   │   ├── settings/            System Settings
│   │   ├── profile/             User profile
│   │   └── workflow/            Workflow automation (DAG editor)
│   ├── infrastructure/          Infrastructure layer (IO)
│   │   ├── mock/                Mock repositories + seed data
│   │   ├── supabase/            Supabase repositories
│   │   ├── excel/               Excel import/export engine
│   │   └── receipt-pdf/         PDF receipt generators
│   ├── shared/                  Shared UI primitives + layout
│   │   ├── ui/                  DataTable, AutoFormModal, EntityDetailDrawer, Wizard
│   │   ├── layout/              PageHeader, PageTabs, state views
│   │   └── hooks/               useObservable, useDebounce, etc.
│   ├── tests/                   Test suite (25 files, 414 tests)
│   └── main.tsx                 App entry point
├── supabase/                    Supabase migrations
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## The 5 Shared UI Primitives

The desktop app uses 5 generic UI primitives built in Phase 3 of the refactor (see [`../development/refactor-state.md`](../development/refactor-state.md)):

| Primitive | Location | Purpose |
| :--- | :--- | :--- |
| `<DataTable<T>>` | `src/shared/ui/data-table/` | Generic table with search, sort, pagination, row actions |
| `<AutoFormModal<T>>` | `src/shared/ui/auto-form/` | Schema-driven modal form (react-hook-form + zod) |
| `<EntityDetailDrawer<T>>` | `src/shared/ui/entity-drawer/` | Slide-over drawer with avatar, metadata, tabs, actions |
| `<Wizard>` | `src/shared/ui/wizard/` | Multi-step wizard with progress bar + per-step validation |
| `<RoleDashboardLayout>` | `src/features/personnel/dashboards/` | Unified dashboard shell for role-based dashboards |

---

## Domain Calculation Engine

The `src/domain/calc/` directory contains the pure, testable calculation engine. No IO, no React, no side effects.

| Submodule | Purpose |
| :--- | :--- |
| `pricing/discount-rules.ts` | 5 canonical discount evaluators + pricing-config helpers |
| `pricing/discount-engine.ts` | Master `evaluateAllSystemDiscounts` aggregator |
| `pricing/tuition.ts` | Official tuition due dates + tranche split (40/30/30) |
| `pricing/transport.ts` | Official transport due dates + per-destination tranches |
| `payment/waterfall-allocator.ts` | Chronological waterfall payment allocation |
| `payment/lifo-reversal.ts` | LIFO refund reversal + installment status re-evaluation |
| `payment/queries.ts` | Installment queries (remaining, overdue, aging) |
| `payment/sums.ts` | Sum helpers (paid, due, etc.) |
| `ledger/balance.ts` | Account balance + parent summary (replay-based) |
| `ledger/charges.ts` | Tuition + transport charge entry builders |
| `ledger/overdue.ts` | Overdue detection + due-date map builder |
| `reconcile/` | Ledger integrity checks + cross-entity validation |

---

## Testing

```bash
npm test             # Run all 414 tests
npm test -- --ui     # Run with Vitest UI
npm test -- --coverage  # Run with coverage report
```

**Test suite:** 25 files / 414 tests passing.

| Test area | Files | Tests |
| :--- | :--- | :--- |
| Domain pricing | 2 | 38 |
| Domain payment | 1 | 24+ |
| Domain ledger | 2 | 27 |
| Domain reconcile | 2 | 18 |
| Domain academics | 3 | 47 |
| Infrastructure | 2 | 14 |
| Integration | 5 | 32 |
| UI primitives | 1 | 12 |
| RBAC | 1 | 16 |
| Other domain | 4 | 186 |

---

## Architecture Decisions

Key architectural decisions are documented in the ADR section of [`../development/refactor-state.md`](../development/refactor-state.md). The most important:

- **Pure domain layer** — all calculation logic lives in `src/domain/calc/` with no IO or React dependencies.
- **Repository pattern** — domain code depends on repository interfaces (`src/domain/repository/`); infrastructure provides mock and Supabase implementations.
- **Observable repositories** — UI components subscribe to repository changes via `useObservable(() => repo.observe(), [deps])`.
- **Single source of truth for model types** — `academic.ts` is canonical for `AcademicCycle`, `AcademicHistoryEntry`, `PromotionDecision`; `student.ts` and `payment.ts` re-export for backward compatibility.
- **No re-export shims** — all legacy shims deleted in Phase 4A; callers import directly from the canonical submodule.

---

## License

UNLICENSED (private).
