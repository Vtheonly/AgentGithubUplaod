# El-Imtiyaz Platform — Complete Backend Configuration Package

This package contains the complete El-Imtiyaz educational management platform with full Supabase backend integration. **Everything you need to configure and connect the backend is included.**

## 📚 Documentation Index

**Start here:**
- **[QUICKSTART.md](docs/QUICKSTART.md)** — 15-minute getting started guide
- **[BACKEND_SETUP_GUIDE.md](docs/BACKEND_SETUP_GUIDE.md)** — Complete 15-step setup guide (30-45 min)

**Reference documentation:**
- **[ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md)** — Every env var explained + where to set it
- **[DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)** — All 50+ tables, RLS, triggers, functions, views, indexes
- **[EDGE_FUNCTIONS.md](docs/EDGE_FUNCTIONS.md)** — All 11 Edge Functions documented
- **[AUTHENTICATION_SETUP.md](docs/AUTHENTICATION_SETUP.md)** — JWT, Google OAuth, approval workflow, RBAC
- **[STORAGE_SETUP.md](docs/STORAGE_SETUP.md)** — All 10 buckets + RLS policies + signed URLs
- **[BACKUP_AND_SYNC.md](docs/BACKUP_AND_SYNC.md)** — Backup strategy + sync logic

**Iteration history:**
- **[ITERATION-12-DONE.md](docs/ITERATION-12-DONE.md)** — Supabase integration completion report
- **[ITERATION-13-DONE.md](docs/ITERATION-13-DONE.md)** — UI-driven configuration completion report

**Source documents:**
- **[Entire_Project_Plan.txt](docs/Entire_Project_Plan.txt)** — The source of truth (224KB)
- **[Clients_Sheet_Merged.txt](docs/Clients_Sheet_Merged.txt)** — Excel business logic reference (355KB)

---

## 🚀 Quick Start (15 minutes)

1. **Create Supabase project** → https://supabase.com/dashboard
2. **Apply migrations** → `cd supabase && supabase db push`
3. **Deploy Edge Functions** → `supabase functions deploy <name>` (11 functions)
4. **Set secrets** → `supabase secrets set KEY=value` (see ENVIRONMENT_VARIABLES.md)
5. **Create SuperAdmin** → via Supabase Dashboard + SQL (see QUICKSTART.md Step 7)
6. **Launch desktop app** → `cd app && npm install && npm start`
7. **Configure from UI** → Settings → Configuration tab

See **[QUICKSTART.md](docs/QUICKSTART.md)** for step-by-step instructions.

---

## 📦 What's in This Package

```
el-imtiyaz-iteration-12/
├── README.md                          # This file
│
├── docs/                              # Complete documentation
│   ├── QUICKSTART.md                  # 15-minute quick start
│   ├── BACKEND_SETUP_GUIDE.md         # Complete setup guide (15 steps)
│   ├── ENVIRONMENT_VARIABLES.md       # Every env var explained
│   ├── DATABASE_SCHEMA.md             # All tables + RLS + triggers + functions
│   ├── EDGE_FUNCTIONS.md              # All 11 Edge Functions
│   ├── AUTHENTICATION_SETUP.md        # JWT + OAuth + approval workflow
│   ├── STORAGE_SETUP.md               # All 10 buckets + RLS
│   ├── BACKUP_AND_SYNC.md             # Backup strategy
│   ├── DEPLOYMENT.md                  # Deployment guide
│   ├── ITERATION-12-DONE.md           # Iteration 12 report
│   ├── ITERATION-13-DONE.md           # Iteration 13 report
│   ├── Entire_Project_Plan.txt        # Source of truth
│   └── Clients_Sheet_Merged.txt       # Excel business logic
│
├── app/                               # Electron desktop application
│   ├── src/                           # React + TypeScript source
│   │   ├── core/                      # Pure utilities (result, errors, rbac, format)
│   │   ├── domain/                    # Domain models + repository contracts
│   │   ├── infrastructure/
│   │   │   ├── supabase/              # Supabase client adapter
│   │   │   ├── config/                # SystemConfig service (UI-driven config)
│   │   │   ├── mock/                  # Mock repositories (default)
│   │   │   ├── backup/                # AES-256 backup system
│   │   │   ├── ai/                    # AI adapter + config storage
│   │   │   ├── pdf/                   # PDF generation
│   │   │   ├── excel/                 # Excel import/export engine
│   │   │   └── repository-provider.tsx # Auto-selects mock vs Supabase
│   │   ├── features/                  # Feature modules
│   │   │   ├── auth/                  # Login + splash screen
│   │   │   ├── dashboard/             # Dashboard + KPIs + calendar
│   │   │   ├── crm/                   # Parents + students + batch registration
│   │   │   ├── academics/             # Classes + grades + attendance + homework
│   │   │   ├── financials/            # Payments + installments + expenses
│   │   │   ├── personnel/             # HR + workforce management
│   │   │   ├── workflow/              # DAG workflow editor
│   │   │   ├── settings/              # Configuration + approvals + RBAC + backup
│   │   │   └── profile/               # User profile
│   │   ├── shared/                    # Shared UI (UnifiedModal, PageTabs, etc.)
│   │   ├── state/                     # React contexts (auth, toast, modal)
│   │   └── test/                      # 1015 tests (46 files)
│   ├── electron/                      # Electron main process + preload + IPC
│   ├── docs/                          # Iteration docs (1-13)
│   ├── package.json
│   ├── .env.example                   # Desktop env template
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── tailwind.config.cjs
│   └── worklog.md
│
└── supabase/                          # Supabase backend
    ├── migrations/                    # 25 SQL migration files (~3,000 LOC)
    │   ├── 0001_extensions.sql        # PostgreSQL extensions
    │   ├── 0002_tenants_and_users.sql # Multi-tenant + users + approval workflow
    │   ├── 0003_rbac.sql              # Roles + permissions + role assignments
    │   ├── 0004_academic_structure.sql # Academic years + levels + classes + subjects
    │   ├── 0005_crm.sql               # Parents + students + activation codes
    │   ├── 0006_pricing.sql           # Pricing config + tuitions + transport + discounts
    │   ├── 0007_financial.sql         # Payments + installments + ledger + receipts
    │   ├── 0008_expenses.sql          # Expense workflow
    │   ├── 0009_attendance_hr.sql     # Personnel + releve
    │   ├── 0010_workforce.sql         # Departments + shifts + tasks + chat
    │   ├── 0011_operations.sql        # Suppliers + deliveries + inventory
    │   ├── 0012_workflow.sql          # Workflows + AI configs
    │   ├── 0013_calendar_notifications_backup.sql # Calendar + notifications + backup
    │   ├── 0014_audit.sql             # Audit log (append-only)
    │   ├── 0018_storage.sql           # 10 storage buckets + RLS
    │   ├── 0019_rls_policies.sql      # RLS for EVERY table
    │   ├── 0020_indexes.sql           # 50+ performance indexes
    │   ├── 0021_views.sql             # 5 materialized + 10 regular views
    │   ├── 0022_functions.sql         # 14 PostgreSQL functions
    │   ├── 0023_seed.sql              # Seed data (tenant + roles + permissions + pricing)
    │   └── 0024_system_settings.sql   # System settings table + 39 defaults
    │
    ├── functions/                     # 11 Edge Functions
    │   ├── _shared/                   # Shared utilities (CORS, Supabase client, audit)
    │   ├── approve-signup-request/     # Web registration → admin approval
    │   ├── bind-activation-code/       # Parent web portal activation
    │   ├── update-server-secret/       # Update Edge Function env vars from UI
    │   ├── collect-payment/            # Atomic payment collection
    │   ├── refund-payment/             # Atomic payment refund
    │   ├── ai-proxy/                   # AI provider proxy (Groq/OpenRouter)
    │   ├── workflow-execute/           # DAG workflow executor
    │   ├── run-overdue-scan/           # Cron: daily overdue scan
    │   ├── expire-pending-approvals/   # Cron: daily approval expiry
    │   ├── refresh-materialized-views/ # Cron: daily MV refresh
    │   └── purge-expired-backups/      # Cron: weekly backup purge
    │
    ├── docs/                          # Supabase-specific docs
    │   ├── DEPLOYMENT.md
    │   └── BACKUP_AND_SYNC.md
    │
    ├── config.toml                    # Supabase project configuration
    └── .env.example                   # Backend env template (placeholders only)
```

---

## ✅ Test Status

- **Typecheck:** clean (0 errors)
- **Tests:** 1015 passing (46 files)
- **Build:** succeeds in ~16s

---

## 🔑 What You Need to Configure

After following the setup guide, the ONLY things you need to provide are:

### One-time setup (via CLI)
1. **Supabase project** — create at supabase.com
2. **SUPABASE_ACCESS_TOKEN** — personal access token for Management API
3. **SUPABASE_PROJECT_REF** — your project's reference ID

### Configurable from the desktop UI (Settings → Configuration)
Everything else is configurable from the desktop app:
- ✅ Supabase URL + anon key
- ✅ AI provider keys (Groq, OpenRouter)
- ✅ Email service (Resend)
- ✅ Push notifications (FCM)
- ✅ Backup passphrase
- ✅ All system settings (CORS, rate limits, log level, timezone)
- ✅ Feature flags (AI, workflows, backup daemon, realtime, Arabic RTL)

**No manual `.env` file editing required** — everything is accessible through the UI.

---

## 🏗️ Architecture

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

### Multi-tenant

Every table has `tenant_id`. RLS policies filter by the caller's tenant. The schema supports ~5,000 total users / 300 daily active / 50 peak concurrent.

### Shared backend

Desktop, Mobile, and Web all connect to the SAME Supabase project. No platform-specific business logic duplication — all logic lives in PostgreSQL functions + Edge Functions.

---

## 📖 Key Features

### Backend (Supabase)
- ✅ 25 SQL migrations (~3,000 LOC) — complete schema with RLS, triggers, functions, views, indexes
- ✅ 11 Edge Functions — approval workflow, payment collection, AI proxy, workflow executor, cron jobs
- ✅ 10 storage buckets with RLS — signed URLs only (no public URLs)
- ✅ 4 cron jobs — overdue scan, approval expiry, MV refresh, backup purge
- ✅ Multi-tenant with RLS on every table
- ✅ 11 roles + 56 permissions + role-permission matrix
- ✅ Audit log (append-only) — every state change recorded
- ✅ Ledger-based accounting — balances computed by replay, never stored

### Desktop App (Electron)
- ✅ Settings → Configuration tab — ALL settings configurable from UI
- ✅ Settings → Inscriptions tab — approval workflow (web registration → admin approval)
- ✅ Unified Modal System — 100% of modals use UnifiedModal
- ✅ Mock fallback — works without Supabase for development
- ✅ 1015 tests passing
- ✅ Particle intro animation + dark theme + FR/AR RTL support

---

## 🆘 Need Help?

1. Check **[QUICKSTART.md](docs/QUICKSTART.md)** for the 15-minute setup
2. Check **[BACKEND_SETUP_GUIDE.md](docs/BACKEND_SETUP_GUIDE.md)** for detailed instructions
3. Check the **Troubleshooting** section in BACKEND_SETUP_GUIDE.md
4. Check Supabase Dashboard logs (Database → Logs, Functions → Logs)
5. Check the desktop app's DevTools console (View → Toggle Developer Tools)
