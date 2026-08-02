# Project Overview

## What Is El-Imtiyaz?

**El-Imtiyaz** is a comprehensive **desktop educational management platform** built for a private Algerian school. It is an Electron + React + TypeScript application that manages the entire institution: students, parents, financials, academics, personnel, operations, workflows, and reporting.

The project serves **three client surfaces** from a single shared Supabase backend:
- **Desktop (Electron)** — full admin terminal for school staff (this repository)
- **Mobile (Android/Kotlin)** — staff-only field operations (separate repo)
- **Web (parent portal)** — read-only parent self-service (Supabase-hosted)

---

## Why The Project Exists

Algerian private schools manage complex operations with fragmented tools: Excel spreadsheets for billing, paper ledgers for accounting, WhatsApp groups for parent communication, and manual grade books. This leads to:

- **Data inconsistency** — the same parent's outstanding balance appears differently in the billing spreadsheet vs. the accounting ledger.
- **No audit trail** — financial changes have no record of who changed what, when, or why.
- **Manual, error-prone workflows** — batch registration, payment collection, expense approval all done by hand.
- **No real-time visibility** — administrators can't see current enrollment, revenue, or debt without manual aggregation.
- **Regulatory compliance gaps** — no enforced separation of duties, no immutable financial records.

El-Imtiyaz solves these by providing a **single source of truth** with:
- **Ledger-based accounting** — every financial value computed by replaying an immutable ledger; balances are never stored as isolated numbers.
- **Universal audit trail** — every state-changing operation writes an append-only audit log entry.
- **Role-based access control (RBAC)** — 11 roles, 56 permissions, defense-in-depth enforcement at UI + repository + database layers.
- **Multi-tenant from day 1** — every database table has `tenant_id` + Row Level Security policies.
- **Automated workflows** — DAG-based workflow engine for overdue alerts, promotions, account locking.

---

## What Problem It Solves

### For School Administrators
- **Real-time dashboard** — KPIs (students, parents, staff, monthly revenue, outstanding debt, attendance rate, overdue alerts) computed from live data.
- **Top 20 debtors ranking** with per-grade breakdown and one-click WhatsApp reminders.
- **Approval workflow** — web registrations → admin review → approve/reject → bind to parent profile.
- **Audit log** — queryable by action, entity, actor, date range; exportable to XLSX/CSV.

### For Financial Officers
- **Counter payment modal** — searchable parent picker, installment auto-suggest, proof capture for non-cash methods, auto-generated receipts.
- **Flexible installment schedules** — per-parent due date overrides + cycle-based re-templating (Primaire Sep/Dec/Mar, CEM Sep/Dec/Apr, Lycée Sep/Jan/May).
- **Expense workflow** — submit → approve → disburse → settle-proof, with no-self-approval enforcement and anomaly detection.
- **Reconciliation engine** — 7 structural checks + 3 cross-entity checks detect ledger corruption (duplicate IDs, orphan reversals, balance sum mismatches).

### For Teachers
- **Roll call screen** — 30-second workflow with 4-button row per student (Present/Absent Excused/Absent Not Excused/Retard).
- **Grade entry** — inline-editable table with live subject average recompute and class average.
- **Homework push** — multi-file attachment gallery, per-class history.
- **AI narrative generator** — PII-masked LLM call for report card narratives with mandatory teacher review.

### For Parents (Web Portal)
- **Activation code binding** — admin-issued code links parent's web account to their child's profile.
- **Read-only access** — view outstanding balance, payment history, installment schedule, child's grades and attendance.

### For Operations Staff
- **Buyer dashboard** — purchase request workflow, supplier directory.
- **Driver dashboard** — delivery tracking with delay reporting.
- **Warehouse worker dashboard** — receipt/dispatch management, inventory scanning, damage reporting.
- **Task management** — 5-column Kanban (pending/assigned/in_progress/blocked/completed) with comments and attachments.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Project                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ PostgreSQL  │  │   Auth (JWT) │  │  Edge Functions  │   │
│  │  + RLS      │  │  + OAuth     │  │  (11 functions)  │   │
│  │  50+ tables │  │              │  │                  │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Storage    │  │  Realtime    │  │  Cron Jobs       │   │
│  │ (10 buckets)│  │ (postgres_   │  │  (4 scheduled    │   │
│  │             │  │   changes)   │  │   functions)     │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
     │  Desktop    │  │   Mobile    │  │    Web      │
     │  (Electron) │  │ (Android)   │  │  (Parents)  │
     │             │  │             │  │             │
     │ Full admin  │  │ Staff-only  │  │ Read-only   │
     │ + config UI │  │ + camera    │  │ own data    │
     └─────────────┘  └─────────────┘  └─────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Desktop shell** | Electron 33 |
| **Build tool** | Vite 6 |
| **UI framework** | React 18 + TypeScript 5.7 (strict) |
| **Styling** | Tailwind CSS 3.4 + shadcn/ui + Radix UI |
| **State management** | React Context (6 providers) + TanStack Query 5 |
| **Forms** | React Hook Form + Zod |
| **Charts** | Recharts 2 |
| **Internationalization** | i18next (FR primary + AR secondary RTL) |
| **Backend** | Supabase (PostgreSQL + Auth + Storage + Edge Functions + Realtime) |
| **PDF** | pdf-lib 1.17 |
| **Excel** | ExcelJS 4.4 |
| **AI** | Groq + OpenRouter (via Edge Function proxy) |
| **Backup** | AES-256-GCM + IndexedDB vault + Web Crypto API |
| **Testing** | Vitest 2.1 + Testing Library |
| **Linting** | ESLint 9 + TypeScript ESLint |

---

## Key Invariants (Non-Negotiable)

These invariants have been maintained throughout all 18 iterations and are enforced by tests:

1. **100% Unified Modal System** — zero raw `@radix-ui/react-dialog` imports in production code outside `unified-modal.tsx`. Enforced by regression test.
2. **Ledger-based accounting** — every balance computed by replay via `computeParentSummary()`. The ledger is canonical; the payment table is a denormalized view. Reconciliation engine catches corruption.
3. **Universal audit trail** — every state-changing operation writes an append-only audit log entry with actor, timestamp, before/after diff.
4. **Multi-tenant isolation** — every Supabase table has `tenant_id` + RLS policy. `service_role` key never in client code.
5. **Defense in depth** — business rules (no-self-approval, mock exclusion, atomic writes) enforced at UI + repository + database layers.
6. **No hardcoded pricing** — all monetary amounts come from `PricingConfig`, admin-editable via UI.

---

## Project Trajectory

The project evolved through three distinct eras (see [`commit-history-analysis.md`](./commit-history-analysis.md) for full detail):

1. **Era 1 (Jun 17 – Jun 19, 2026)** — Original Electron/React/SQLite codebase. No tests. Deleted in the Era 2 rewrite.
2. **Era 2 (Jul 27 – Aug 1, 2026)** — Ground-up rewrite to domain-driven architecture with shadcn/ui + Supabase + mock repositories. Delivered 16 iterations of features. Introduced 24 permanently-failing Excel tests in the final mega-commit.
3. **Era 3 (Aug 1, 2026 — present)** — Refactor Bot recovery effort. Two clean iterations centralizing the math engine and splitting the mock layer. Added 264 tests with zero regressions.

**Current state:** 1,420/1,444 tests passing, `tsc` clean, production build succeeds. The 24 failures are isolated to Excel-import test files and do not affect business logic.

---

## Related Documents

- [`architecture.md`](./architecture.md) — detailed folder structure, module responsibilities, data flow
- [`iteration-history.md`](./iteration-history.md) — full engineering journal of all 18 iterations
- [`current-status.md`](./current-status.md) — what's done, what's broken, what's next
- [`decisions.md`](./decisions.md) — why key architectural choices were made
