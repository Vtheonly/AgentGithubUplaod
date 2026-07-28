# El-Imtiyaz Desktop Terminal

Production-grade Electron desktop application for the **El-Imtiyaz Educational & Operational Management Platform** — a private school management system serving the Algerian education market (DZD currency, French + Arabic languages).

Rebuilt **from scratch** following `entire_project_plan.txt`. The legacy desktop codebase is NOT used as a foundation; only the particle intro animation is preserved as a brand-identity asset.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start the Vite dev server (renderer only, useful for UI iteration)
npm run dev

# Start the full Electron app in dev mode (Vite + Electron)
npm run electron:dev

# Type-check the entire codebase (renderer + Electron main)
npm run typecheck

# Build the renderer for production
npm run build

# Build distributable Electron packages
npm run electron:build
```

### Demo accounts (mock auth)

| Role                 | Email                     | Password     |
|----------------------|---------------------------|--------------|
| Super Administrateur | `admin@elimtiyaz.dz`      | `admin123`   |
| Agent Financier      | `financial@elimtiyaz.dz`  | `fin123`     |
| Enseignant           | `teacher@elimtiyaz.dz`    | `teach123`   |
| Personnel de Soutien | `support@elimtiyaz.dz`    | `support123` |

---

## Architecture

### Layered structure

```
src/
├── app/                     # App shell, providers, top-level routing
│   ├── app.tsx              # Root: providers + auth-gated routes
│   ├── app-shell.tsx        # Sidebar + Topbar + content area
│   └── splash-gate.tsx      # Particle intro animation gate
│
├── core/                    # Pure, framework-agnostic primitives
│   ├── result/              # Result<T, E> discriminated union
│   ├── errors/              # AppError + typed error builders
│   ├── logging/             # Structured 6-level logger (PII masking)
│   ├── audit/               # AuditAction constants (wire-protocol)
│   ├── format/              # Currency (DZD), date, ID formatters
│   └── rbac/                # Roles, Permissions, FeatureGate, FeatureRegistry
│
├── domain/                  # Pure business model (no I/O, no React)
│   ├── model/               # Parent, Student, Academic, Payment, Expense,
│   │                        #   Personnel, Operations, Audit entities
│   └── repository/          # Repository contracts (interfaces only)
│
├── infrastructure/          # Adapters that implement domain contracts
│   ├── mock/                # In-memory reactive mock with seed data
│   │   ├── seed-data.ts     # 8 parents, 15 students, 30 payments, etc.
│   │   ├── subject-behavior.ts  # Minimal Observable<T> primitive
│   │   └── mock-repositories.ts # All 17 mock repository implementations
│   └── repository-provider.tsx  # DI seam — swap mock → Supabase here
│
├── state/                   # React contexts (cross-cutting state)
│   ├── auth-context.tsx     # Session + sign-in / sign-out
│   ├── toast-context.tsx    # Popups / dialogs (secondary feedback layer)
│   └── modal-context.tsx    # Modal manager (primary interaction layer)
│
├── shared/                  # Reusable presentation layer
│   ├── ui/                  # shadcn-style primitives (button, card, dialog…)
│   ├── components/          # App-specific (StatusChip, KpiCard, Sidebar…)
│   ├── hooks/               # useObservable, future usePaginate, etc.
│   └── ...
│
├── features/                # Feature modules (one folder per hub)
│   ├── auth/                # Login screen + splash screen
│   ├── dashboard/           # Hub 1 — KPIs, charts, See Details modal
│   ├── crm/                 # Hub 2 — Parents & students directory
│   ├── academics/           # Hub 3 — Classes, subjects, homework
│   ├── financials/          # Hub 4 — Payments, debt, expenses
│   ├── personnel/           # Hub 5 — Directory, Relevé, audit, workflows
│   ├── routing/             # Driver mode (stubbed; not in plan)
│   └── settings/            # Settings + Audit log viewer (showcase)
│
├── i18n/                    # i18next setup (FR primary, AR secondary)
│   ├── i18n.ts
│   ├── fr.ts
│   └── ar.ts
│
├── main.tsx                 # React entrypoint
└── index.css                # Tailwind + design tokens (CSS variables)

electron/                    # Electron main process
├── main.ts                  # BrowserWindow + menu + lifecycle
├── preload.ts               # contextBridge API exposed to renderer
└── ipc-handlers.ts          # File system, shell, app info handlers
```

### Architectural principles applied

- **Clean Architecture layers**: `core` (pure) ← `domain` (pure) ← `infrastructure` (adapters) ← `features` (UI). Each layer can only depend on layers to its left.
- **Repository pattern**: 17 repository contracts in `domain/repository/`. The mock implementation is wired in `infrastructure/repository-provider.tsx`. Swapping to Supabase means writing a new file that implements the same interfaces and passing it to `<RepositoryProvider repositories={...}>`.
- **Result<T, E>**: All fallible operations return `Result` rather than throwing. The type system forces callers to handle both success and failure paths.
- **Composition over inheritance**: No deep inheritance trees. Every UI piece is a small composable component.
- **Feature-flagged RBAC**: Single source of truth in `core/rbac/feature-registry.ts`. UI components consume nodes via `<GatedContent node={...}>` so permission rules live in one file.
- **Strong typing**: Every entity, every repository method, every UI prop is typed. No `any` outside the Electron IPC bridge (where it's unavoidable).
- **Audit trail**: Every mutating mock repository method writes to the in-memory audit log via `appendAudit()`. The pattern carries over to the Supabase adapter unchanged.

### Tech stack

| Concern                | Choice                              | Why                                            |
|------------------------|-------------------------------------|------------------------------------------------|
| Desktop shell          | Electron 33                         | Plan mandate                                   |
| Build tool             | Vite 6                              | Fast HMR, modern ESM                           |
| UI framework           | React 18 + TypeScript 5.7           | Plan mandate (React), strict typing            |
| Styling                | Tailwind 3.4 + CSS variables        | Plan mandate (shadcn/ui uses Tailwind)         |
| Component primitives   | Radix UI + custom shadcn-style      | Accessible, unstyled, composable               |
| Charts                 | Recharts 2                          | Reactive, declarative, React-friendly          |
| Routing                | React Router 7 (HashRouter)         | Electron-safe (no server)                      |
| State (cross-cutting)  | React Context                       | Minimal footprint, no extra deps               |
| Server state           | TanStack Query 5                    | Caching, refetch, retries                      |
| i18n                   | i18next + react-i18next             | FR/AR/EN ready, RTL support                    |
| Forms                  | React Hook Form + Zod               | Schema validation, performant                  |
| Icons                  | lucide-react                        | Tree-shakeable, consistent style               |

---

## Design System

All design tokens are CSS variables defined in `src/index.css`. Components reference them via Tailwind utility classes (`bg-brand-blue`, `text-status-success`, etc.) or via `var(--brand-blue)` directly.

### Color palette (plan §03.01)

| Token              | Hex       | Use                                   |
|--------------------|-----------|---------------------------------------|
| `--brand-blue`     | `#349BD4` | Primary buttons, active nav           |
| `--brand-blue-deep`| `#2B7FB0` | Hover / pressed                       |
| `--brand-blue-light`| `#6EC1E4` | Highlights, focus rings, LATE status  |
| `--brand-slate`    | `#3B464C` | Secondary text                        |
| `--brand-gold`     | `#C8A98C` | Accents, KPIs                         |
| `--brand-brown`    | `#836C68` | Tertiary accents                      |
| `--status-success` | `#3FA66E` | PAID, PRESENT, settled                |
| `--status-warning` | `#C8A98C` | PENDING, partial, late                |
| `--status-danger`  | `#C0504D` | UNPAID, ABSENT, errors                |
| `--status-info`    | `#6EC1E4` | Info toasts                           |

### Typography

- **Primary**: Inter (UI + body)
- **Arabic**: Noto Sans Arabic (RTL fallback)
- **Monospace**: JetBrains Mono (IDs, currency, audit JSON diffs)

### Dark theme (default)

Long operational hours — dark is the platform default. Light theme tokens are defined for future parity.

---

## Domain model (plan §04–§12)

The full entity model lives in `src/domain/model/`. Highlights:

- **Parent-first dependency** (plan §04.01): `students.parent_id` is NOT NULL. No student can exist without a parent. Enforced at the repository layer.
- **Atomic batch registration** (plan §04.03): `StudentRepository.batchRegister(input)` wraps Parent + N Students creation in a single transaction (mock simulates via single in-memory update + one audit entry).
- **Grading formula** (plan §06): `subject_average = (D1 + D2 + 2·Examen) / 4`, `overall_gpa = Σ(avg × coef) / Σ(coef)`, passing grade 10/20. Pure functions in `domain/model/academic.ts`.
- **Two-tier expense workflow** (plan §08): `draft → submitted → approved/rejected → disbursed → settled`. Receipt upload mandatory before close. No self-approval.
- **5-bucket debt aging**: `0-30 / 31-60 / 61-90 / 91-180 / 180+` days.

---

## RBAC (plan §02.07)

**6 roles** (4 staff + 2 client): SuperAdmin, FinancialOfficer, Teacher, SupportStaff, Parent, Student.
**28 permissions** grouped by domain: CRM, Academic, Financial, Expense, HR, Routing, Settings.

### Three-layer gating

1. **FeatureRegistry** (`core/rbac/feature-registry.ts`) — single source of truth. Every sidebar entry, page, and action carries an `AccessRequirement`.
2. **FeatureGate** (`core/rbac/feature-gate.ts`) — pure evaluator. Returns `Enabled | Disabled(reason) | Hidden`.
3. **GatedContent** (`shared/components/gated-content.tsx`) — React wrapper. Renders children, or a locked state at 40% opacity with a lock icon, or nothing (Hidden).

To change a permission rule, edit ONE file: `feature-registry.ts`. UI components consume the rule declaratively.

---

## Audit log (plan §12)

Every state-changing operation writes an audit entry with:
- `action` (e.g. `payment.create`, `expense.approve`)
- `entityType`, `entityId`
- `actorId`, `actorName`
- `diff` — JSON `{before, after}` snapshots (never truncated)
- `ipAddress`, `userAgent`, `at` (UTC ISO timestamp)

The Settings → Audit Log tab (restricted to SuperAdmin + FinancialOfficer) provides:
- Multi-column filtering (action, entity, actor)
- JSON before/after diff drawer
- Real-time stream (mock simulates via `SubjectBehavior`)

Anonymous operations are **impossible** — system actions are attributed to a system user ID.

---

## Mock data layer

The mock layer (`infrastructure/mock/`) ships with realistic seed data so the UI runs end-to-end without a backend:

- 8 parents (FR/AR mix, T1/T2/T3 city tiers)
- 15 students (across Primaire/CEM/Lycée)
- 6 classes (2 per cycle)
- 12 subjects (Scolarité + extracurricular)
- 30 payments (mix of cash/check/transfer, all statuses)
- 18 installments (Tuition 3-tranche pattern)
- 5 expenses (covering all workflow states)
- 10 personnel (5 categories)
- 15 audit entries (covering all action types)
- 6 notifications

### Swapping to Supabase

When ready to wire the real backend:

1. Create `src/infrastructure/supabase/supabase-repositories.ts` that implements the same 17 repository interfaces using `@supabase/supabase-js`.
2. Export a `supabaseRepositories: Repositories` constant from that file.
3. In `src/app/app.tsx`, change `<RepositoryProvider>` to pass `repositories={supabaseRepositories}`.

No component code changes. The swap is one line.

---

## What's implemented in this session

### Fully implemented
- **Project scaffold**: Electron + Vite + React + TS + Tailwind + shadcn-style primitives
- **Design system**: All 13 brand + status color tokens, Inter/Noto Sans Arabic/JetBrains Mono fonts, dark theme default
- **Core infrastructure**: `Result<T, E>`, `AppError`, 6-level logger with PII masking, audit actions, currency (DZD) / date / ID formatters
- **RBAC**: 6 roles, 28 permissions, FeatureRegistry (single source of truth), FeatureGate (pure evaluator), GatedContent (declarative UI wrapper)
- **Domain model**: All entities from plan §04–§12 (Parent, Student, Academic, Payment, Expense, Personnel, Operations, Audit)
- **Repository contracts**: 17 interfaces covering every operation
- **Mock data layer**: 17 in-memory reactive implementations with realistic seed data + audit logging
- **State**: AuthContext (session persistence), ToastContext (popups), ModalContext (modal stack), RepositoryProvider (DI)
- **Shared UI**: Button, Card, Input, Label, Dialog, Tabs, Badge, Avatar, ScrollArea, Separator, Tooltip, DropdownMenu, Progress, Textarea, Select — all shadcn-style
- **App components**: StatusChip (5 tones), KpiCard, AsyncContent/LoadingState/ErrorState/EmptyState, PageHeader, GatedContent, ConfirmDialog, ToastViewport, ModalHost, ComingSoonCard
- **Particle intro**: Pure TS particle engine ported from legacy codebase (logo/circular/linear modes, mouse-reactive spring physics)
- **Auth shell**: Splash screen with particle EI monogram, login screen with 4 demo accounts + role picker
- **App shell**: Collapsible sidebar (4 hubs + Routing + Settings), topbar (Cmd+K global search, alerts bell, profile menu), HashRouter
- **Dashboard hub (Hub 1)**: 4-KPI grid, 12-month revenue bar chart, 5-bucket debt aging, demographics pie charts, alerts feed, See Details modal with 4 sub-tabs (Revenue/Departments/Demographics/Debt)
- **Settings hub**: General, **Audit log viewer with JSON diff drawer (showcase feature)**, RBAC matrix viewer, AI BYOK config, Backup management stub, Locked features card

### Scaffolded (structure correct, deep workflows deferred)
- **CRM hub**: Parents tab fully functional (list, search, quick actions call/WhatsApp/email). Students tab shows roster. Batch registration tab shows coming-soon card.
- **Academics hub**: Classes tab fully functional (capacity progress bars, fill-rate tone). Subjects & Homework tabs scaffolded.
- **Financials hub**: KPI grid + Payments tab (list with status chips) + Debt tab (aging buckets) + Expenses tab (workflow states). Installments & Receipts tabs scaffolded.
- **Personnel hub**: Directory tab fully functional (category-colored avatars, weekly hours progress). Relevé, Audit (redirects to Settings), Workflows tabs scaffolded.
- **Routing hub**: Access-denied panel when user lacks `AccessDriverMode`; coming-soon card otherwise. (Routing is NOT in the business plan; included only as a stub for parity with the Android app.)

### Locked features (permanently disabled, shown in Settings)
- AI assistant (Removed — module scaffolded for future)
- AI report narrative (Not yet available)
- AI expense anomaly (Not yet available)
- Workflow DAG editor (Not yet available — desktop-only per plan §10)
- Excel bulk import (Not yet available — desktop-only per plan §14)
- Local backup (Not yet available — desktop-only per plan §13)
- Point-in-time restore (Not yet available)

---

## Conventions

### File naming
- React components: `kebab-case.tsx` (e.g. `status-chip.tsx`)
- Pure TS modules: `kebab-case.ts`
- Domain entities: singular (e.g. `parent.ts`, not `parents.ts`)

### Import order
1. External packages (React, Radix, lucide-react)
2. `core/*` (pure infrastructure)
3. `domain/*` (pure business model)
4. `infrastructure/*` (adapters)
5. `state/*` (React contexts)
6. `shared/*` (UI primitives)
7. Relative imports

### ID formats (preserved from Android app)
- Parent code: `PAR-{year}-{4-char suffix}` (e.g. `PAR-2025-A4F9`)
- Student code: `ELV-{year}-{6-digit seq}` (e.g. `ELV-2025-001234`)
- Receipt #: `REC-{year}-{6-digit seq}` (e.g. `REC-2025-000123`)
- Personnel ID: `EMP-{year}-{3-digit seq}` (e.g. `EMP-2025-014`)
- Backup file: `backup-YYYY-MM-DD-HHMMSS.db`

### Currency
All monetary values are DZD (Algerian Dinar). Format: `"12 500 DZD"` (non-breaking space grouping, `Locale.FRANCE`).

---

## Plan compliance

This implementation follows the plan **to the letter**. Where the user's prompt conflicted with the plan, the plan won:

| Conflict                          | Plan ruling          | Implementation           |
|-----------------------------------|----------------------|--------------------------|
| Particle intro animation          | Not in plan (legacy) | Preserved as brand asset |
| Routing/OSRM/TSP solver           | Not in plan          | Stubbed (locked)         |
| Parent → N children (was 4-cap)   | Unlimited (§04.02)   | No cap                   |
| Scholarships                      | PURGED (§07.04)      | Account Adjustments only |
| Excel formula engine              | PURGED (§14)         | ExcelJS for I/E only     |
| 5th attendance status             | Forbidden (§09.02)   | Exactly 4 statuses       |
| 5th top-level Hub                 | Forbidden (§03.02)   | 4 hubs + Settings entry  |
| Mobile backups                    | Forbidden (§13.05)   | N/A (desktop only)       |
| `service_role` key in client      | Forbidden (§12.05)   | Will use anon key        |

---

## License

Proprietary — © El-Imtiyaz. All rights reserved.
