# Backend Setup Guide — Complete Supabase Configuration

This guide walks you through configuring the Supabase backend for the El-Imtiyaz platform from scratch. Follow these steps in order. After completing this guide, the backend will be fully functional and the desktop application will connect to it.

**Time required:** 30–45 minutes (one-time setup)

**Prerequisites:**
- A computer with Node.js 18+ and npm installed
- A Supabase account (free tier is sufficient for development)
- A Google Cloud account (for parent web portal OAuth — optional, can skip for desktop-only deployment)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Create Supabase Project](#2-create-supabase-project)
3. [Install Supabase CLI](#3-install-supabase-cli)
4. [Link Local Project](#4-link-local-project)
5. [Apply Database Migrations](#5-apply-database-migrations)
6. [Deploy Edge Functions](#6-deploy-edge-functions)
7. [Set Edge Function Secrets](#7-set-edge-function-secrets)
8. [Configure Authentication](#8-configure-authentication)
9. [Configure Google OAuth (Optional)](#9-configure-google-oauth-optional)
10. [Configure Storage Buckets](#10-configure-storage-buckets)
11. [Create First SuperAdmin User](#11-create-first-superadmin-user)
12. [Configure Desktop App](#12-configure-desktop-app)
13. [Verify Everything Works](#13-verify-everything-works)
14. [Production Hardening](#14-production-hardening)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Overview

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Project                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ PostgreSQL  │  │   Auth (JWT) │  │  Edge Functions  │   │
│  │  + RLS      │  │  + OAuth     │  │  (11 functions)  │   │
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
     └─────────────┘  └─────────────┘  └─────────────┘
```

### What gets created

| Component | Count | Purpose |
|-----------|-------|---------|
| Database tables | 50+ | Multi-tenant schema with RLS |
| Database functions | 14 | Business logic (payment collection, refunds, etc.) |
| Database triggers | 30+ | Auto-updated_at, audit log, validation |
| Materialized views | 5 | Dashboard KPIs (refreshed daily) |
| Regular views | 10 | Convenience queries |
| RLS policies | 60+ | Row-level security for every table |
| Edge Functions | 11 | Serverless API endpoints |
| Storage buckets | 10 | File storage (receipts, documents, etc.) |
| Cron jobs | 4 | Scheduled tasks (overdue scan, backup purge, etc.) |
| Roles | 11 | SuperAdmin, FinancialOfficer, Teacher, etc. |
| Permissions | 56 | Granular capabilities per role |

---

## 2. Create Supabase Project

1. Go to **https://supabase.com/dashboard** → sign in → **New Project**

2. Fill in the project details:
   - **Name:** `el-imtiyaz` (or your preferred name)
   - **Database Password:** generate a strong password — **SAVE THIS SECURELY** (you'll need it later)
   - **Region:** choose the closest to your users
     - For Algeria/Europe: `EU Central 1` (Frankfurt) or `West EU` (Ireland)
   - **Pricing Plan:** Free tier works for development; Pro tier ($25/mo) recommended for production

3. Wait 2–3 minutes for the project to provision.

4. Once ready, note down these values from **Project Settings → API**:
   - **Project URL** (e.g., `https://abcdefgh.supabase.co`)
   - **Project Reference ID** (e.g., `abcdefgh`)
   - **anon public key** (long JWT string starting with `eyJ...`)
   - **service_role key** (long JWT string — **NEVER share this, NEVER put in client code**)

5. From **Project Settings → API → JWT Settings**, note:
   - **JWT Secret** (used to verify tokens server-side)

6. From **Project Settings → Database → Connection string**, note:
   - **Connection URI** (format: `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`)

---

## 3. Install Supabase CLI

The CLI is required to apply migrations and deploy Edge Functions.

### Option A: npm (recommended)

```bash
npm install -g supabase
```

### Option B: Homebrew (macOS)

```bash
brew install supabase/tap/supabase
```

### Verify installation

```bash
supabase --version
```

You should see a version number like `1.x.x`.

---

## 4. Link Local Project

1. Navigate to the `supabase/` directory from the project archive:

   ```bash
   cd el-imtiyaz-iteration-12/supabase
   ```

2. Login to Supabase (opens a browser):

   ```bash
   supabase login
   ```

3. Link this local project to your Supabase project:

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

   Replace `YOUR_PROJECT_REF` with the Project Reference ID from Step 2.

4. Verify the link:

   ```bash
   supabase projects list
   ```

   Your project should appear in the list.

---

## 5. Apply Database Migrations

This step creates all 50+ tables, RLS policies, triggers, functions, views, and seed data.

1. From the `supabase/` directory, run:

   ```bash
   supabase db push
   ```

2. The CLI will apply 25 migration files in order:
   - `0001_extensions.sql` — PostgreSQL extensions
   - `0002_tenants_and_users.sql` — multi-tenant + users + approval workflow
   - `0003_rbac.sql` — roles, permissions, role assignments
   - `0004_academic_structure.sql` — academic years, levels, classes, subjects, grades
   - `0005_crm.sql` — parents, students, activation codes
   - `0006_pricing.sql` — pricing config, tuitions, transport, discounts
   - `0007_financial.sql` — payments, installments, ledger, receipts
   - `0008_expenses.sql` — expense workflow
   - `0009_attendance_hr.sql` — personnel, releve
   - `0010_workforce.sql` — departments, shifts, tasks, chat
   - `0011_operations.sql` — suppliers, deliveries, inventory
   - `0012_workflow.sql` — workflows, AI configs
   - `0013_calendar_notifications_backup.sql` — calendar, notifications, backup metadata
   - `0014_audit.sql` — audit log (append-only)
   - `0018_storage.sql` — storage buckets + RLS
   - `0019_rls_policies.sql` — RLS for every table
   - `0020_indexes.sql` — performance indexes
   - `0021_views.sql` — materialized + regular views
   - `0022_functions.sql` — PostgreSQL functions
   - `0023_seed.sql` — seed data (tenant, roles, permissions, pricing)
   - `0024_system_settings.sql` — system settings table + defaults

3. **Verify the migrations succeeded** by running this SQL in the Supabase Dashboard → SQL Editor:

   ```sql
   SELECT count(*) AS tenant_count FROM tenants;           -- expect: 1
   SELECT count(*) AS role_count FROM roles;               -- expect: 11
   SELECT count(*) AS permission_count FROM permissions;   -- expect: 56
   SELECT count(*) AS level_count FROM academic_levels;    -- expect: 14
   SELECT count(*) AS tuition_count FROM grade_level_tuition; -- expect: 14
   SELECT count(*) AS transport_count FROM transport_destinations; -- expect: 4
   SELECT count(*) AS discount_count FROM discounts;       -- expect: 5
   SELECT count(*) AS setting_count FROM system_settings;  -- expect: 40+
   ```

   All counts should match. If any don't, check the migration output for errors.

---

## 6. Deploy Edge Functions

Deploy all 11 Edge Functions. From the `supabase/` directory:

```bash
# User-facing functions
supabase functions deploy approve-signup-request
supabase functions deploy bind-activation-code
supabase functions deploy update-server-secret
supabase functions deploy collect-payment
supabase functions deploy refund-payment
supabase functions deploy ai-proxy
supabase functions deploy workflow-execute

# Scheduled functions (cron)
supabase functions deploy run-overdue-scan
supabase functions deploy expire-pending-approvals
supabase functions deploy refresh-materialized-views
supabase functions deploy purge-expired-backups
```

**Verify deployment:** Go to Supabase Dashboard → Functions → you should see all 11 functions listed with "Deployed" status.

### Edge Function reference

| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `approve-signup-request` | POST | JWT + super_admin | Approve/reject web registrations |
| `bind-activation-code` | POST | JWT | Bind activation code to parent profile |
| `update-server-secret` | POST/DELETE | JWT + super_admin | Update Edge Function env vars from UI |
| `collect-payment` | POST | JWT + collect_payment | Atomic payment collection |
| `refund-payment` | POST | JWT + refund_payment | Atomic payment refund |
| `ai-proxy` | POST | JWT + use_ai | Proxy AI requests to Groq/OpenRouter |
| `workflow-execute` | POST | JWT + execute_workflow | Execute workflow DAG |
| `run-overdue-scan` | POST/CRON | None (cron) or JWT | Daily overdue installment scan |
| `expire-pending-approvals` | POST/CRON | None (cron) | Daily approval request expiry |
| `refresh-materialized-views` | POST/CRON | None (cron) | Daily materialized view refresh |
| `purge-expired-backups` | POST/CRON | None (cron) | Weekly backup purge |

---

## 7. Set Edge Function Secrets

Edge Functions need environment variables to work. Most are set from the desktop UI after initial setup, but a few MUST be set via CLI first.

### Required secrets (set via CLI)

```bash
# These are REQUIRED for Edge Functions to work at all
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
supabase secrets set SUPABASE_ANON_KEY=YOUR_ANON_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set SUPABASE_JWT_SECRET=YOUR_JWT_SECRET
```

### Required for the Configuration UI to work

The `update-server-secret` function needs these to call the Supabase Management API:

```bash
# Get SUPABASE_ACCESS_TOKEN from https://supabase.com/dashboard/account/tokens
# Create a new token named "el-imtiyaz-config"
supabase secrets set SUPABASE_ACCESS_TOKEN=your_personal_access_token
supabase secrets set SUPABASE_PROJECT_REF=YOUR_PROJECT_REF
```

### Optional secrets (can be set from the desktop UI later)

These can be set from Settings → Configuration after the desktop app is connected:

```bash
# AI providers (for AI features)
supabase secrets set GROQ_API_KEY=your_groq_key           # from https://console.groq.com/keys
supabase secrets set OPENROUTER_API_KEY=your_openrouter_key  # from https://openrouter.ai/keys

# Email service (for workflow email actions)
supabase secrets set RESEND_API_KEY=your_resend_key       # from https://resend.com/api-keys
supabase secrets set EMAIL_FROM_ADDRESS=noreply@elimtiyaz.dz
supabase secrets set EMAIL_FROM_NAME="El-Imtiyaz Platform"

# Push notifications (for Android app)
supabase secrets set FCM_SERVER_KEY=your_fcm_key          # from Firebase Console
supabase secrets set FCM_SENDER_ID=your_fcm_sender_id

# Backup encryption
supabase secrets set BACKUP_PASSPHRASE=$(openssl rand -base64 48)

# Security + CORS
supabase secrets set CRON_SECRET=$(openssl rand -base64 32)
supabase secrets set ALLOWED_ORIGINS=https://app.elimtiyaz.dz,https://portal.elimtiyaz.dz,app://-,file://-
supabase secrets set LOG_LEVEL=info
```

**Verify secrets:** Go to Supabase Dashboard → Functions → Secrets → you should see all secrets listed (values are hidden).

---

## 8. Configure Authentication

### Disable public signup (we use admin-approval workflow)

1. Go to Supabase Dashboard → **Authentication → Sign In / Providers**
2. Under **Email**, set **Allow new users to sign up** = **OFF**
   - (We use the approval workflow instead — users sign up, but their account stays "pending" until an admin approves)

3. Under **Email**, set **Confirm email** = **ON**
   - Users must confirm their email before they can sign in

### Configure URL redirects

1. Go to **Authentication → URL Configuration**
2. Set **Site URL:** `https://app.elimtiyaz.dz` (or your production URL)
   - For local development: `http://localhost:5173`
3. Add **Redirect URLs:**
   - `http://localhost:5173/auth/callback`
   - `https://app.elimtiyaz.dz/auth/callback`
   - `https://portal.elimtiyaz.dz/auth/callback`

### JWT settings

The JWT settings are already configured by Supabase. The JWT secret is in your project settings (noted in Step 2). The default expiry is 1 hour, which is fine.

### Session management

The desktop app uses Supabase's built-in session management:
- Access tokens auto-refresh
- Sessions persist across app restarts (stored in localStorage)
- Password changes revoke all sessions globally (handled by `auth.signOut({ scope: 'global' })`)

---

## 9. Configure Google OAuth (Optional)

**Skip this section if you're not using the parent web portal.** The desktop app uses email/password authentication.

Google OAuth is for parents who sign in to the web portal.

### Create Google OAuth credentials

1. Go to **https://console.cloud.google.com/apis/credentials**
2. Create a new project (or select existing) → **Credentials** → **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `El-Imtiyaz Web Portal`
5. **Authorized JavaScript origins:**
   - `https://YOUR_PROJECT_REF.supabase.co`
   - `https://portal.elimtiyaz.dz`
   - `http://localhost:5173` (for dev)
6. **Authorized redirect URIs:**
   - `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
   - `http://localhost:54321/auth/v1/callback` (for local dev)
7. Click **Create** → note the **Client ID** and **Client Secret**

### Configure in Supabase

1. Go to Supabase Dashboard → **Authentication → Providers → Google**
2. Toggle **Enabled** = ON
3. Paste the **Client ID** and **Client Secret** from Google
4. Set **Redirect URL** = `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` (Supabase fills this automatically)
5. Save

### Test OAuth flow

After the web portal is deployed, parents can:
1. Visit `https://portal.elimtiyaz.dz`
2. Click "Sign in with Google"
3. After Google authentication, they're redirected back to the portal
4. They enter their 6-7 digit activation code (issued by the school office)
5. The `bind-activation-code` Edge Function binds their Google account to their parent profile

---

## 10. Configure Storage Buckets

The 10 storage buckets are created automatically by migration `0018_storage.sql`. Verify they exist:

1. Go to Supabase Dashboard → **Storage**
2. You should see 10 buckets:

| Bucket | Purpose | Public? | Max Size |
|--------|---------|---------|----------|
| `payment-proofs` | Check scans + transfer receipts | No | 10 MB |
| `expense-receipts` | Vendor receipts | No | 10 MB |
| `receipts` | Auto-generated PDF receipts | No | 5 MB |
| `student-documents` | Birth certificates, medical, contracts | No | 10 MB |
| `homework-attachments` | Teacher-uploaded PDFs/photos | No | 10 MB |
| `task-attachments` | Files attached to tasks | No | 10 MB |
| `chat-attachments` | Files shared in chat | No | 10 MB |
| `tenant-assets` | Logos, branding | No | 5 MB |
| `ai-reports` | AI-generated PDFs | No | 5 MB |
| `import-reports` | Excel/JSON import reports | No | 10 MB |

### Folder structure (enforced by RLS)

Every file upload must follow this path pattern:
```
<tenant_id>/<entity_id>/<filename>
```

Example: `00000000-0000-0000-0000-000000000001/payment-uuid-123/receipt.pdf`

The RLS policy on `storage.objects` checks that the first path segment matches the caller's `tenant_id`.

### Signed URLs

All bucket access uses signed URLs (5-minute default expiry). Public URLs are forbidden per plan §13.04. The desktop app generates signed URLs via `supabase.storage.from('bucket').createSignedUrl(path, 60)`.

---

## 11. Create First SuperAdmin User

After migrations, you need a SuperAdmin to access the desktop app.

### Step 1: Create the auth user

1. Go to Supabase Dashboard → **Authentication → Users** → **Add user**
2. Email: `admin@elimtiyaz.dz` (or your preferred email)
3. Password: generate a strong password (save it securely)
4. **Auto Confirm User:** YES (check the box)
5. Click **Add user**
6. Copy the user's **UUID** (shown in the user list)

### Step 2: Activate the profile + assign SuperAdmin role

The `handle_new_auth_user` trigger automatically created a `user_profiles` row (status='pending') and an `account_approval_requests` row. You need to activate the profile and assign the SuperAdmin role.

Go to **Supabase Dashboard → SQL Editor** → **New query** → paste and run (replace the UUID):

```sql
-- Step 1: Activate the user profile
UPDATE public.user_profiles
   SET status = 'active'
 WHERE auth_user_id = 'PASTE_USER_UUID_HERE';

-- Step 2: Assign SuperAdmin role
INSERT INTO public.role_assignments (user_profile_id, tenant_id, role_id, assigned_at)
SELECT up.id, up.tenant_id, r.id, now()
  FROM public.user_profiles up
  CROSS JOIN public.roles r
 WHERE up.auth_user_id = 'PASTE_USER_UUID_HERE'
   AND r.code = 'super_admin'
   AND NOT EXISTS (
       SELECT 1 FROM public.role_assignments ra
        WHERE ra.user_profile_id = up.id AND ra.role_id = r.id
   );

-- Step 3: Mark the auto-created approval request as approved
UPDATE public.account_approval_requests
   SET status = 'approved',
       reviewed_at = now(),
       decision_note = 'Initial SuperAdmin — created during deployment'
 WHERE auth_user_id = 'PASTE_USER_UUID_HERE';

-- Verify
SELECT up.email, up.status, r.code AS role
  FROM public.user_profiles up
  JOIN public.role_assignments ra ON ra.user_profile_id = up.id
  JOIN public.roles r ON r.id = ra.role_id
 WHERE up.auth_user_id = 'PASTE_USER_UUID_HERE';
```

You should see one row with `status='active'` and `role='super_admin'`.

---

## 12. Configure Desktop App

### Step 1: Install dependencies

```bash
cd el-imtiyaz-iteration-12/app
npm install
```

### Step 2: Build the desktop app

```bash
# Verify typecheck passes
npm run typecheck

# Run tests (should be 1015 passing)
npm test

# Build for production
npm run build

# Build Electron app (produces installable in release/ folder)
npm run electron:build
```

### Step 3: First launch + configuration

1. Launch the desktop app:
   ```bash
   npm start
   ```

2. Sign in with the SuperAdmin credentials you created in Step 11:
   - Email: `admin@elimtiyaz.dz`
   - Password: (the password you set)

3. **Wait — the app starts in MOCK mode by default** (no Supabase connection configured yet). The login will work with the mock demo accounts:
   - Email: `admin@elimtiyaz.dz`
   - Password: `admin123`

4. Go to **Settings → Configuration** tab

5. In the **Connexion** section:
   - Enter **URL Supabase:** `https://YOUR_PROJECT_REF.supabase.co`
   - Enter **Clé anonyme:** your anon public key
   - Toggle **Utiliser Supabase** = ON
   - Click **Tester la connexion** — should show "Connexion réussie"
   - Click **Enregistrer & Redémarrer** — the app restarts

6. After restart, sign in with your REAL SuperAdmin credentials (the one you created in Step 11, NOT the mock demo account)

7. Go back to **Settings → Configuration** and configure the remaining sections:
   - **IA:** enter your Groq API key (from https://console.groq.com/keys)
   - **Email:** enter your Resend API key + from address (optional)
   - **Push:** enter your FCM keys (optional, for Android app)
   - **Sauvegardes:** enter a backup passphrase (32+ characters — generate one with `openssl rand -base64 48`)
   - **Système:** review CORS origins, rate limits, log level, timezone

8. All secrets are now stored in the Supabase Edge Function environment (NOT in the database) and can be managed from the UI.

---

## 13. Verify Everything Works

### Database verification

Run this SQL in Supabase Dashboard → SQL Editor:

```sql
-- Check all tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- Should show 50+ tables

-- Check RLS is enabled on all tables
SELECT tablename, rowsecurity, forcerowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
 ORDER BY tablename;
-- Every table should have rowsecurity = true and forcerowsecurity = true

-- Check materialized views
SELECT matviewname FROM pg_matviews WHERE schemaname = 'public';
-- Should show: mv_dashboard_kpis, mv_debt_aging, mv_top_debtors, mv_revenue_by_month, mv_grade_summary

-- Check functions
SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname;
-- Should show 14+ functions
```

### Edge Functions verification

```bash
# Test that each function responds (should return 401 without auth, not 404)
for fn in approve-signup-request bind-activation-code update-server-secret collect-payment refund-payment ai-proxy workflow-execute run-overdue-scan expire-pending-approvals refresh-materialized-views purge-expired-backups; do
  echo "Testing $fn..."
  curl -s -o /dev/null -w "%{http_code}" https://YOUR_PROJECT_REF.supabase.co/functions/v1/$fn
  echo ""
done
```

Each should return `401` (Unauthorized) or `405` (Method Not Allowed) — NOT `404` (Not Found).

### Storage verification

```bash
# List buckets (should show 10)
curl -s https://YOUR_PROJECT_REF.supabase.co/storage/v1/bucket \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" | jq '. | length'
```

### Desktop app verification

1. Launch the desktop app
2. Sign in with your SuperAdmin credentials
3. Verify the Dashboard loads (should show KPIs)
4. Go to **Settings → Configuration** → all sections should show settings
5. Go to **Settings → Inscriptions** → should show "Aucune demande en attente"
6. Go to **Settings → Sauvegardes** → should show backup UI
7. Go to **CRM** → should show parent/student lists (empty initially)

### Cron jobs verification

1. Go to Supabase Dashboard → **Functions**
2. Each scheduled function should show a "Schedule" badge:
   - `run-overdue-scan` — daily at 08:00 UTC
   - `expire-pending-approvals` — daily at 00:00 UTC
   - `refresh-materialized-views` — daily at 01:00 UTC
   - `purge-expired-backups` — weekly Sunday at 03:00 UTC

---

## 14. Production Hardening

### Database backups

1. Go to Supabase Dashboard → **Database → Backups**
2. Enable **Daily backups** (Pro tier)
3. Enable **Point-in-time recovery** (Pro tier) — allows restore to any point in last 7 days

### Connection pooling

1. Go to Supabase Dashboard → **Database → Connection Pooling**
2. Enable it
3. Mode: **Transaction**
4. Pool size: **20** (default, suitable for ~50 concurrent users)

### Rate limiting

1. Go to Supabase Dashboard → **Settings → API**
2. Set per-IP rate limits (e.g., 100 requests per minute)

### Custom domain (production)

1. Go to Supabase Dashboard → **Settings → Custom Domains**
2. Configure `api.elimtiyaz.dz` (requires DNS access)
3. Update the desktop app's Configuration tab with the new URL

### SSL/TLS

Supabase enforces HTTPS by default. No action needed.

### Audit log retention

The `audit_logs` table grows unboundedly. Set up a monthly archive job:

```sql
-- Create archive table
CREATE TABLE IF NOT EXISTS public.audit_logs_archive (LIKE public.audit_logs INCLUDING ALL);

-- Function to archive old logs (run monthly via a scheduled Edge Function)
CREATE OR REPLACE FUNCTION public.archive_old_audit_logs(p_days integer DEFAULT 2555)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.audit_logs_archive
  SELECT * FROM public.audit_logs
   WHERE occurred_at < now() - (p_days || ' days')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Use a SECURITY DEFINER function to bypass the append-only trigger
  DELETE FROM public.audit_logs
   WHERE occurred_at < now() - (p_days || ' days')::interval;

  RETURN v_count;
END;
$$;

-- Default: archive logs older than 7 years (2555 days)
-- To run manually: SELECT public.archive_old_audit_logs(2555);
```

---

## 15. Troubleshooting

### "permission denied for table X"

The user's RLS policies don't allow the operation. Check:
1. User has an active role assignment in `role_assignments`
2. The role has the required permission in `role_permissions`
3. The user's `user_profiles.status = 'active'` (not 'pending' or 'suspended')

```sql
-- Check a user's roles + permissions
SELECT up.email, up.status, r.code AS role, p.code AS permission
  FROM public.user_profiles up
  JOIN public.role_assignments ra ON ra.user_profile_id = up.id AND ra.revoked_at IS NULL
  JOIN public.roles r ON r.id = ra.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
  JOIN public.permissions p ON p.id = rp.permission_id
 WHERE up.email = 'admin@elimtiyaz.dz';
```

### "JWT expired"

The user's session expired. Sign out and sign back in. The desktop app auto-refreshes tokens, so this shouldn't happen unless the user was offline for >1 hour.

### "Function X not found"

An Edge Function failed to deploy. Check:
1. The function directory exists at `supabase/functions/<name>/index.ts`
2. Re-deploy: `supabase functions deploy <name>`
3. Check the deployment logs in Supabase Dashboard → Functions → select function → Logs

### "RPC function not found"

A PostgreSQL function is missing. Re-run migrations:
```bash
supabase db push
```

### Materialized view refresh fails

Check that UNIQUE indexes exist:
```sql
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename LIKE 'mv_%';
```
Each materialized view needs a UNIQUE index for `REFRESH CONCURRENTLY` to work. If missing, the migration `0021_views.sql` should have created them — re-run it if needed.

### Desktop app can't connect to Supabase

1. Verify the URL + anon key in Settings → Configuration → Connexion
2. Click **Tester la connexion** — if it fails, check:
   - URL format: `https://xxxx.supabase.co` (no trailing slash)
   - Anon key is the `anon public` key, NOT the `service_role` key
   - Network/firewall allows outbound HTTPS to `*.supabase.co`
3. Check the browser console (DevTools → Console) for error messages

### Storage upload fails with 403

The RLS policy on `storage.objects` is blocking the upload. Check:
1. The file path starts with the caller's `tenant_id`
2. The user has the required role (e.g., only FinancialOfficer + SuperAdmin can write to `payment-proofs`)
3. The bucket exists and is private (public = false)

### Edge Function returns 500

Check the function logs:
1. Supabase Dashboard → Functions → select function → Logs
2. Look for the error message
3. Common causes:
   - Missing env var (set via `supabase secrets set`)
   - Supabase client not initialized (check `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` secrets)
   - Function code has a bug (check the Deno logs)

### Rollback

If a deployment goes wrong:

1. **Database rollback:**
   ```bash
   supabase migration list          # see applied migrations
   supabase migration revert --to <migration_number>
   ```
   ⚠️ This will DELETE data. Test in staging first.

2. **Edge Function rollback:** Supabase keeps previous versions. Dashboard → Functions → select function → Rolls back to previous version.

3. **Full restore from backup:** See `BACKUP_AND_SYNC.md`

---

## Next Steps

After completing this guide:

1. **Read the other documentation files:**
   - `ENVIRONMENT_VARIABLES.md` — every env var explained
   - `DATABASE_SCHEMA.md` — all tables, RLS, triggers, functions
   - `EDGE_FUNCTIONS.md` — all 11 Edge Functions documented
   - `AUTHENTICATION_SETUP.md` — JWT, OAuth, approval workflow
   - `STORAGE_SETUP.md` — all 10 buckets + RLS policies
   - `BACKUP_AND_SYNC.md` — backup strategy + sync logic
   - `QUICKSTART.md` — 15-minute quick start

2. **Configure the desktop app** (Settings → Configuration tab)

3. **Start using the platform:**
   - Add parents + students (CRM tab)
   - Configure pricing (Settings → Tarification)
   - Collect payments (Financials tab)
   - Set up workflows (Automatisations tab)

4. **For the Android app:** The same Supabase backend serves the Android app. Point the Android app to the same Supabase URL + anon key.

5. **For the web portal:** Deploy the web portal (separate project) and point it to the same Supabase URL + anon key. Parents sign in via Google OAuth + activation code.

---

## Support

If you encounter issues:
1. Check the **Troubleshooting** section above
2. Check the Supabase Dashboard logs (Database → Logs, Functions → Logs)
3. Check the desktop app's DevTools console (View → Toggle Developer Tools)
4. Review the iteration docs (`ITERATION-12-DONE.md`, `ITERATION-13-DONE.md`) for architecture details
