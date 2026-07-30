# Supabase Deployment Guide

This guide walks you through deploying the El-Imtiyaz Supabase backend from scratch.

## Prerequisites

1. **Supabase account** — sign up at https://supabase.com
2. **Supabase CLI** — install via `npm install -g supabase`
3. **Google Cloud project** — for OAuth (parent web portal)
4. **Groq account** — for AI features (https://console.groq.com)
5. **OpenRouter account** — optional, for AI fallback (https://openrouter.ai)
6. **Resend account** — optional, for emails (https://resend.com)

## Step 1: Create Supabase Project

1. Go to https://supabase.com/dashboard → New Project
2. Name: `el-imtiyaz` (or your preferred name)
3. Database password: generate a strong password, save it securely
4. Region: closest to your users (e.g., `eu-central-1` for Algeria/Europe)
5. Plan: Free tier is sufficient for development. Production: Pro tier recommended.

## Step 2: Link Local Project

```bash
cd /home/z/my-project/workspace/supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Find your project ref in: Supabase Dashboard → Project Settings → General → Reference ID.

## Step 3: Configure Environment Variables

```bash
cd /home/z/my-project/workspace/supabase
cp .env.example .env
```

Edit `.env` and fill in ALL placeholder values. The file contains detailed comments
explaining where to find each value.

### Critical secrets (required):

- `SUPABASE_URL` — Dashboard → Project Settings → API → Project URL
- `SUPABASE_ANON_KEY` — Dashboard → Project Settings → API → Project API keys → anon
- `SUPABASE_SERVICE_ROLE_KEY` — Dashboard → Project Settings → API → Project API keys → service_role
- `DATABASE_URL` — Dashboard → Project Settings → Database → Connection string → URI
- `SUPABASE_JWT_SECRET` — Dashboard → Project Settings → API → JWT Settings → JWT Secret

### OAuth secrets (required for parent web portal):

1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Authorized redirect URIs:
   - `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
   - `http://localhost:54321/auth/v1/callback` (for local dev)
4. Copy Client ID → `SUPABASE_AUTH_GOOGLE_CLIENT_ID`
5. Copy Client Secret → `SUPABASE_AUTH_GOOGLE_SECRET`

### AI secrets (required for AI features):

- `GROQ_API_KEY` — https://console.groq.com/keys → Create Key
- `OPENROUTER_API_KEY` (optional fallback) — https://openrouter.ai/keys

### Email secret (optional, for workflow emails):

- `RESEND_API_KEY` — https://resend.com/api-keys

### Backup passphrase (required):

Generate a strong passphrase (32+ chars):

```bash
openssl rand -base64 48
```

Set as `BACKUP_PASSPHRASE`. In production, store in a separate secrets manager
(HashiCorp Vault, AWS Secrets Manager, OS keychain) — NOT in the `.env` file.

## Step 4: Apply Database Migrations

```bash
cd /home/z/my-project/workspace/supabase
supabase db push
```

This applies all 24 migration files in order:
- 0001: Extensions
- 0002: Tenants + users + approval workflow
- 0003: RBAC (roles, permissions, role_permissions)
- 0004: Academic structure (years, levels, classes, subjects, grades, attendance)
- 0005: CRM (parents, students, activation codes)
- 0006: Pricing config (14 grade-level tuitions, 4 transport destinations, discounts)
- 0007: Financial (invoices, payments, installments, ledger, receipts)
- 0008: Expenses (two-tier workflow with no-self-approval)
- 0009: HR (personnel, releve)
- 0010: Workforce (departments, shifts, tasks, chat, onboarding)
- 0011: Operations (suppliers, purchase requests, deliveries, inventory)
- 0012: Workflow + AI config
- 0013: Calendar + notifications + backup metadata
- 0014: Audit log (append-only)
- 0018: Storage buckets + RLS policies
- 0019: RLS policies for ALL tables
- 0020: Performance indexes
- 0021: Materialized + regular views
- 0022: PostgreSQL functions
- 0023: Seed data (default tenant, 11 roles, 56 permissions, 14 academic levels, pricing config)

Verify: the seed data asserts on critical counts. If any assertion fails, the push
will abort — check the error message for the missing data.

## Step 5: Deploy Edge Functions

```bash
cd /home/z/my-project/workspace/supabase

# Deploy each function
supabase functions deploy approve-signup-request
supabase functions deploy bind-activation-code
supabase functions deploy collect-payment
supabase functions deploy refund-payment
supabase functions deploy run-overdue-scan
supabase functions deploy expire-pending-approvals
supabase functions deploy refresh-materialized-views
supabase functions deploy purge-expired-backups
supabase functions deploy ai-proxy
supabase functions deploy workflow-execute
```

## Step 6: Set Edge Function Secrets

Edge Functions need access to environment variables. Set them via the CLI:

```bash
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
supabase secrets set SUPABASE_ANON_KEY=YOUR_ANON_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set SUPABASE_JWT_SECRET=YOUR_JWT_SECRET
supabase secrets set GROQ_API_KEY=YOUR_GROQ_KEY
supabase secrets set OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
supabase secrets set RESEND_API_KEY=YOUR_RESEND_KEY
supabase secrets set EMAIL_FROM_ADDRESS=noreply@elimtiyaz.dz
supabase secrets set EMAIL_FROM_NAME="El-Imtiyaz Platform"
supabase secrets set ALLOWED_ORIGINS=https://app.elimtiyaz.dz,https://portal.elimtiyaz.dz
supabase secrets set LOG_LEVEL=info

# Optional: secret for guarding manual invocation of scheduled functions
supabase secrets set CRON_SECRET=$(openssl rand -base64 32)
```

## Step 7: Configure Auth Providers

In Supabase Dashboard → Authentication → Providers:

1. **Google** — enable, paste Client ID + Secret from Step 3
2. **Email** — keep enabled but set "Confirm email" = ON (default)
3. **Allow new users to sign up** = OFF (we use admin-approval workflow instead)

In Supabase Dashboard → Authentication → URL Configuration:
- Site URL: `https://app.elimtiyaz.dz` (production desktop/web URL)
- Redirect URLs: add all your app URLs + `http://localhost:5173/auth/callback` for dev

## Step 8: Create First SuperAdmin

After migrations + seed data, you need a SuperAdmin user to access the desktop app.

### Option A: Via Supabase Dashboard (easiest)

1. Dashboard → Authentication → Users → Add user
2. Email: `admin@elimtiyaz.dz`
3. Password: generate a strong password
4. Auto Confirm User: YES
5. After creation, copy the user's UUID

Then in Dashboard → SQL Editor, run:

```sql
-- The trigger automatically created a user_profiles row + approval request.
-- Activate the profile and assign SuperAdmin role:

UPDATE public.user_profiles
   SET status = 'active'
 WHERE auth_user_id = 'PASTE_USER_UUID_HERE';

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

-- Mark the auto-created approval request as approved
UPDATE public.account_approval_requests
   SET status = 'approved',
       reviewed_at = now(),
       decision_note = 'Initial SuperAdmin — created during deployment'
 WHERE auth_user_id = 'PASTE_USER_UUID_HERE';
```

### Option B: Via SQL (service_role key)

Use the Supabase CLI or `psql` with your DATABASE_URL:

```sql
-- Create the auth user
SELECT auth.admin_create_user(
  'admin@elimtiyaz.dz',
  'StrongPassword123!',
  '{"auto_confirm": true, "email_confirm": true, "user_metadata": {"full_name": "Super Admin"}}'
);
-- Note: admin_create_user is a Supabase-specific function. Check current docs
-- for the exact signature in your Supabase version.
```

Then run the same UPDATE/INSERT statements as Option A.

## Step 9: Configure Desktop App

```bash
cd /home/z/my-project/workspace/app
cp .env.example .env.local
```

Edit `.env.local`:
- `VITE_SUPABASE_URL` — same as `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` — same as `SUPABASE_ANON_KEY`
- `VITE_USE_SUPABASE=true` — switch from mock to Supabase

Build and run:

```bash
npm install
npm run typecheck   # should be clean
npm test            # should pass all tests
npm run electron:build  # produces dist/ + release/ folders
```

## Step 10: Verify Deployment

1. **Database** — Dashboard → SQL Editor → run:
   ```sql
   SELECT count(*) FROM tenants;          -- should be 1
   SELECT count(*) FROM roles;            -- should be 11
   SELECT count(*) FROM permissions;      -- should be 56
   SELECT count(*) FROM academic_levels;  -- should be 14
   SELECT count(*) FROM grade_level_tuition; -- should be 14
   SELECT count(*) FROM transport_destinations; -- should be 4
   SELECT count(*) FROM discounts;        -- should be 5
   ```

2. **Edge Functions** — Dashboard → Functions → verify all 10 functions are deployed

3. **Storage buckets** — Dashboard → Storage → verify 10 buckets exist:
   - payment-proofs, expense-receipts, receipts, student-documents
   - homework-attachments, task-attachments, chat-attachments
   - tenant-assets, ai-reports, import-reports

4. **RLS** — Dashboard → SQL Editor → run:
   ```sql
   SELECT tablename, rowsecurity, forcerowsecurity
     FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename;
   ```
   Every tenant-scoped table should have `rowsecurity = true` and `forcerowsecurity = true`.

5. **Desktop app** — launch, sign in with `admin@elimtiyaz.dz` + password.
   - Should land on Dashboard
   - Navigate to Settings → Inscriptions → should show "Aucune demande en attente"
   - Navigate to Settings → Sauvegardes → should show backup UI

## Step 11: Configure Cron Jobs (Production)

The `config.toml` file declares cron schedules for the scheduled Edge Functions.
Supabase Cron is automatically configured when you deploy via `supabase functions deploy`.

Verify in Dashboard → Functions → select each function → Schedule tab.

Schedules:
- `run-overdue-scan` — daily at 08:00 UTC
- `expire-pending-approvals` — daily at 00:00 UTC
- `refresh-materialized-views` — daily at 01:00 UTC
- `purge-expired-backups` — weekly Sunday at 03:00 UTC

## Step 12: Production Hardening

1. **Database backups** — Dashboard → Database → Backups → enable daily backups (Pro tier)

2. **Point-in-time recovery** — enable for Pro tier (allows restore to any point in last 7 days)

3. **Connection pooling** — Dashboard → Database → Connection Pooling → enable
   - Mode: Transaction
   - Pool size: 20 (default, suitable for ~50 concurrent users)

4. **Rate limiting** — Dashboard → Settings → API → set per-IP rate limits

5. **Custom domain** — Dashboard → Settings → Custom Domains → configure `api.elimtiyaz.dz`

6. **TLS/SSL** — Supabase enforces HTTPS by default. No action needed.

7. **Audit log retention** — audit_logs grows unboundedly. Set up a weekly job to
   archive entries older than 7 years to cold storage:
   ```sql
   -- Run weekly (add to a scheduled Edge Function)
   CREATE TABLE IF NOT EXISTS public.audit_logs_archive (LIKE public.audit_logs INCLUDING ALL);
   INSERT INTO public.audit_logs_archive SELECT * FROM public.audit_logs WHERE occurred_at < now() - interval '7 years';
   DELETE FROM public.audit_logs WHERE occurred_at < now() - interval '7 years';
   ```
   (Note: this DELETE will be blocked by the append-only trigger. Either disable
   the trigger temporarily or use a separate archive table that audit_logs rows
   are COPIED into then TRUNCATED via a SECURITY DEFINER function.)

## Troubleshooting

### "permission denied for table X"

The user's RLS policies don't allow the operation. Check:
1. User has an active role assignment in `role_assignments`
2. The role has the required permission in `role_permissions` (or tenant override)
3. The user's `user_profiles.status = 'active'` (not 'pending' or 'suspended')

### "JWT expired"

The user's session expired. Have them sign out and sign back in.
If using the desktop app, the auth context auto-refreshes tokens.

### "Function X not found"

An Edge Function failed to deploy. Check:
1. The function directory exists at `supabase/functions/<name>/index.ts`
2. The function has no TypeScript errors: `deno check supabase/functions/<name>/index.ts`
3. Re-deploy: `supabase functions deploy <name>`

### "RPC function not found"

A PostgreSQL function is missing. Re-run migrations:
```bash
supabase db push
```

### Materialized view refresh fails

Check that the UNIQUE indexes exist on the materialized views:
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'mv_%';
```
Each materialized view needs a UNIQUE index for `REFRESH CONCURRENTLY` to work.

## Rollback

If a deployment goes wrong:

1. **Database rollback** — Supabase keeps a migration history. To revert:
   ```bash
   supabase migration list  # see applied migrations
   supabase migration revert --to <migration_number>
   ```
   ⚠️ This will DELETE data. Test in staging first.

2. **Edge Function rollback** — Supabase keeps previous versions. Dashboard →
   Functions → select function → Rolls back to previous version.

3. **Full restore from backup** — see BACKUP_STRATEGY.md
