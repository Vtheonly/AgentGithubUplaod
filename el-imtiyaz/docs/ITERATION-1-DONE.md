# Iteration 1 — Done

> Snapshot of what shipped in iteration 1 of the El-Imtiyaz desktop rebuild.

## Project foundation

- **Electron 33 + Vite 6 + React 18 + TypeScript 5.7** scaffold with strict typing
- **Tailwind 3.4** configured with custom design tokens exposed as CSS variables
- **HashRouter** (Electron-safe — no server required)
- **TanStack Query 5** wired for future server-state caching
- **i18next** with FR (primary) + AR (secondary) + EN (reserved) translations
- **Build verified**: `tsc --noEmit` clean, `vite build` succeeds, Electron TypeScript compiles

## Architecture layers

```
src/
├── app/                  Application shell, providers, top-level routing
├── core/                 Pure, framework-agnostic primitives
│   ├── result/           Result<T, E> discriminated union
│   ├── errors/           AppError + typed error builders
│   ├── logging/          Structured 6-level logger (PII masking)
│   ├── audit/            AuditAction wire-protocol constants
│   ├── format/           Currency (DZD), date, ID formatters
│   └── rbac/             Roles, Permissions, FeatureGate, FeatureRegistry
├── domain/               Pure business model (no I/O, no React)
│   ├── model/            8 entity modules
│   └── repository/       17 repository contracts
├── infrastructure/       Adapters implementing domain contracts
│   ├── mock/             In-memory reactive mock with seed data
│   └── repository-provider.tsx  DI seam
├── state/                React contexts
│   ├── auth-context.tsx
│   ├── toast-context.tsx
│   └── modal-context.tsx
├── shared/               Reusable presentation layer
│   ├── ui/               14 shadcn-style primitives
│   ├── components/       App components (StatusChip, KpiCard, Sidebar, etc.)
│   └── hooks/            useObservable
├── features/             7 feature hubs
│   ├── auth/             Splash + Login
│   ├── dashboard/        Hub 1 (fully implemented)
│   ├── crm/              Hub 2 (Parents/Students tabs functional)
│   ├── academics/        Hub 3 (Classes tab functional)
│   ├── financials/       Hub 4 (Payments/Debt/Expenses tabs functional)
│   ├── personnel/        Hub 5 (Directory tab functional)
│   ├── routing/          Access-denied panel
│   └── settings/         General + Audit log viewer (showcase)
└── i18n/                 FR + AR string catalogs
```

## Domain model (plan §04–§12)

All entities implemented as immutable typed objects:

| Entity          | Plan section | Notes |
|-----------------|--------------|-------|
| Parent          | §04          | Parent-first dependency, 1→N children, city tiers T1/T2/T3 |
| Student         | §04          | Academic history, promotion decisions, status enum |
| Academic        | §05/§06      | Class, Subject, ClassSubject, Assessment, Attendance, Homework + grade formulas |
| Payment         | §07          | 3 methods, 6 statuses, installments, adjustments, debt summary, receipts |
| Expense         | §08          | Two-tier workflow, 6 statuses, 9 categories, anomaly scoring |
| Personnel       | §09          | 5 staff categories, Releve entries, 4 statuses |
| Operations      | §15          | KPIs, revenue points, debt aging, demographics, notifications |
| Audit           | §12          | Append-only entries with before/after JSON diff |

## Repository contracts (17 interfaces)

All return `Promise<Result<T>>` for fallible operations and `Observable<T>` for reactive reads.

## Mock data layer

Realistic-but-fictional Algerian private school seed:

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

Every mutating method writes an audit entry — the Settings → Audit Log viewer works end-to-end out of the box.

## RBAC (plan §02.07)

- **6 roles**: SuperAdmin, FinancialOfficer, Teacher, SupportStaff, Parent, Student
- **28 permissions** grouped by domain
- **3-layer gating**: FeatureRegistry (single source of truth) → FeatureGate (pure evaluator) → `<GatedContent>` (declarative UI wrapper)

Locked items render at 40% opacity with a lock icon; clicking is disabled.

## UI primitives (shadcn-style)

14 Radix UI-backed components in `shared/ui/`:
Button, Card, Dialog, Tabs, Badge, Avatar, ScrollArea, Separator, Tooltip, DropdownMenu, Progress, Textarea, Select, Label, Input.

## App components

- **StatusChip** — 5 tones (success/warning/danger/info/neutral)
- **KpiCard** — tone-tinted icon + label + value
- **AsyncContent / LoadingState / ErrorState / EmptyState** — universal state views
- **PageHeader** — title + description + actions
- **GatedContent** — RBAC wrapper
- **ConfirmDialog** — 2-click confirmation pattern
- **ToastViewport** — popup feedback layer
- **ModalHost** — modal stack renderer
- **ComingSoonCard** — standardized "module scaffolded" placeholder
- **Sidebar** — collapsible left nav, RBAC-gated items, tooltips when collapsed
- **Topbar** — Cmd+K global search, alerts bell, profile menu, quick backup
- **ParticleEngine / ParticleLogo** — pure TS particle system ported from legacy codebase (spring physics, 3 modes, mouse-reactive)

## Feature hubs — what's fully working

### Auth (`features/auth/`)
- **SplashScreen** — particle EI monogram intro (~2.2s, plays once per session)
- **LoginScreen** — email/password form + 4 demo account quick-fill chips

### Dashboard (`features/dashboard/`) — Hub 1, fully implemented
- 4 KPI cards (students / parents / monthly revenue / outstanding debt)
- 12-month revenue bar chart (Recharts)
- 5-bucket debt aging chart with tone-coded bars
- Recent alerts feed (live from notification repository)
- 4 tabs: Overview / Alerts / Reports catalog / Analytics
- **See Details modal** with 4 sub-tabs (Revenue / Departments / Demographics / Debt) — overlays dashboard per plan §15

### Settings (`features/settings/`)
- **General tab**: appearance, language, tenant ID
- **Audit Log tab** (showcase feature): multi-column filtering (action/entity/actor), JSON before/after diff drawer, real-time stream. Restricted to SuperAdmin + FinancialOfficer per plan §12.
- **RBAC Matrix tab**: viewer (read-only)
- **AI Config tab**: BYOK form (Groq + OpenRouter), disabled
- **Backup tab**: stub with plan §13 description
- **Locked Features tab**: lists all 7 permanently-disabled features with state reasons

## Feature hubs — what's scaffolded (list view only)

### CRM (`features/crm/`) — Hub 2
- **Parents tab**: full list with search, call/WhatsApp/email quick actions, click-to-highlight
- **Students tab**: full list with level filter, status chips
- **Batch registration tab**: ComingSoonCard

### Academics (`features/academics/`) — Hub 3
- **Classes tab**: full list with capacity progress bars, fill-rate tone (success < 80% / warning 80-99% / danger ≥ 100%)
- **Subjects tab**: ComingSoonCard
- **Homework tab**: ComingSoonCard

### Financials (`features/financials/`) — Hub 4
- 4 KPI cards
- **Payments tab**: list with status chips, method/category labels
- **Debt tab**: 5-bucket aging list with debtor details
- **Expenses tab**: list with workflow status chips + anomaly badge
- **Installments tab**: ComingSoonCard
- **Receipts tab**: ComingSoonCard

### Personnel (`features/personnel/`) — Hub 5
- **Directory tab**: full list with category-colored avatars, weekly hours progress
- **Relevé / Audit / Workflows tabs**: ComingSoonCards

### Routing (`features/routing/`)
- Access-denied panel for users without `AccessDriverMode` permission
- ComingSoonCard for authorized users

## Build verification

```
✓ tsc --noEmit           (clean)
✓ vite build             (995 kB bundle, 27 kB CSS)
✓ electron tsc           (clean)
```

App runs end-to-end with mock data:
splash → login → dashboard with live KPIs/charts → settings with working audit log viewer.

## Demo accounts

| Role                 | Email                     | Password     |
|----------------------|---------------------------|--------------|
| Super Administrateur | `admin@elimtiyaz.dz`      | `admin123`   |
| Agent Financier      | `financial@elimtiyaz.dz`  | `fin123`     |
| Enseignant           | `teacher@elimtiyaz.dz`    | `teach123`   |
| Personnel de Soutien | `support@elimtiyaz.dz`    | `support123` |
