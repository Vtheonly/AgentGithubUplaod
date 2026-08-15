# El-Imtiyaz Platform

> Educational & Operational Management Platform for Sarl Elimtiyaz, a private school in Boumerdès, Algeria.

This repository contains the **Desktop Terminal** application (Electron + React + TypeScript), the **Supabase backend** (migrations + Edge Functions), the **centralized documentation**, and the **legacy Excel workbook** that the platform replaces.

---

## Repository Structure

```
AgentGithubUplaod/
│
├── docs/                          # Centralized documentation (36 files)
│   ├── README.md                  # Entry point — start here
│   ├── project-specification/     # 21-note authoritative product blueprint
│   ├── pricing/                   # Official 2026-2027 fee schedule
│   ├── legacy-excel-workbook/     # Legacy Excel workbook documentation (10 files)
│   ├── development/               # Engineering work logs (3 files)
│   └── desktop/                   # Desktop app quick-start guide
│
├── elimtiyaz-desktop/             # The desktop application
│   ├── electron/                  # Electron main process + preload + IPC
│   ├── src/                       # React + TypeScript application source
│   │   ├── app/                   # App providers (auth, repository, toast, sync)
│   │   ├── core/                  # Core utilities (format, RBAC, i18n, logger)
│   │   ├── domain/                # Pure domain layer (models + calc engine)
│   │   ├── features/              # Feature modules (CRM, Financials, Academics, etc.)
│   │   ├── infrastructure/        # Infrastructure (mock + Supabase + Excel + PDF + AI)
│   │   ├── shared/                # Shared UI primitives + layout + hooks
│   │   ├── tests/                 # Test suite (25 files, 414 tests)
│   │   └── main.tsx               # App entry point
│   ├── supabase/                  # Supabase migrations (33) + Edge Functions (10)
│   ├── scripts/                   # Build + maintenance scripts
│   ├── package.json               # Dependencies + scripts
│   ├── tsconfig.json              # TypeScript config
│   ├── vite.config.ts             # Vite build config
│   ├── vitest.config.ts           # Test config
│   └── tailwind.config.cjs        # Tailwind CSS config
│
├── Suivis clients 2026_2027.xlsx  # Legacy Excel workbook (root-level fallback)
└── .gitignore
```

---

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Supabase account (for backend) — or run with mock repositories

### Install & Run

```bash
cd elimtiyaz-desktop
npm install
npm run dev          # Vite dev server (HMR)
npm run electron:dev # Vite + Electron concurrent
```

### Verify

```bash
npm run typecheck    # TypeScript check (0 errors)
npm test             # Run test suite (414 tests passing)
npm run build        # Production build
```

---

## What's Inside

### Desktop Application (`elimitiyaz-desktop/`)

Built with **Electron 33 + Vite 6 + React 18 + TypeScript 5.7 + Tailwind CSS 3 + shadcn/ui + Radix UI**.

- **5 shared UI primitives:** `<DataTable>`, `<AutoFormModal>`, `<EntityDetailDrawer>`, `<Wizard>`, `<RoleDashboardLayout>`
- **Pure domain calculation engine:** pricing (5 discount rules), payment (waterfall allocator + LIFO reversal), ledger (balance replay), reconcile (integrity checks)
- **4 consolidated desktop hubs:** Dashboard, Financial Portal, Relationship Portal, Academic Management
- **Excel import/export pipeline:** 4-schema engine (`etat`, `bon`, `devis`, `ref`) — formula engine purged
- **PDF receipt generators:** payment receipt, account statement, bulletin, payslip
- **33 Supabase migrations** + **10 Edge Functions** (collect-payment, refund-payment, workflow-execute, ai-proxy, etc.)

### Documentation (`docs/`)

36 centralized documentation files organized into 5 sections. Start at [`docs/README.md`](./docs/README.md).

### Legacy Excel Workbook

The `Suivis clients 2026_2027.xlsx` file is the financial-receivables tracking spreadsheet the platform replaces. It is preserved because the import pipeline reads it to bootstrap the database. Full documentation in [`docs/legacy-excel-workbook/`](./docs/legacy-excel-workbook/).

---

## Verification Status

| Check | Status |
| :--- | :--- |
| TypeScript (`tsc --noEmit`) | ✅ 0 errors |
| Tests (`npm test`) | ✅ 414/414 passing (25 files) |
| Production build (`npm run build`) | ✅ Succeeds |

---

## Documentation

For the full project specification, architecture, pricing, and engineering logs, see the **[`docs/`](./docs/)** folder.

**Recommended reading order:**

1. [`docs/README.md`](./docs/README.md) — documentation entry point
2. [`docs/project-specification/01-conflict-resolutions.md`](./docs/project-specification/01-conflict-resolutions.md) — surviving rules where drafts disagreed
3. [`docs/project-specification/02-architecture-and-platforms.md`](./docs/project-specification/02-architecture-and-platforms.md) — topology + RBAC matrix
4. [`docs/pricing/fee-schedule-2026-2027.md`](./docs/pricing/fee-schedule-2026-2027.md) — official fee schedule
5. [`docs/desktop/README.md`](./docs/desktop/README.md) — desktop app quick-start

---

## License

UNLICENSED (private).
