# Quickstart Guide — 15 Minutes to Running

This guide gets the El-Imtiyaz platform running in 15 minutes. For detailed instructions, see `BACKEND_SETUP_GUIDE.md`.

## Prerequisites

- Node.js 18+ and npm installed
- A Supabase account (free tier works)
- 15 minutes

---

## Step 1: Create Supabase Project (3 min)

1. Go to https://supabase.com/dashboard → **New Project**
2. Name: `el-imtiyaz`
3. Database password: generate strong password, save it
4. Region: closest to you
5. Wait 2-3 min for provisioning

## Step 2: Get Your Project Keys (1 min)

From Dashboard → **Project Settings → API**, copy:
- **Project URL** (e.g., `https://abcdefgh.supabase.co`)
- **Project Reference ID** (e.g., `abcdefgh`)
- **anon public key**
- **service_role key**
- **JWT Secret** (from Project Settings → API → JWT Settings)

## Step 3: Install Supabase CLI (1 min)

```bash
npm install -g supabase
supabase login  # opens browser
```

## Step 4: Apply Database Migrations (3 min)

```bash
cd el-imtiyaz-iteration-12/supabase
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

This creates all 50+ tables, RLS policies, triggers, functions, views, and seed data.

**Verify:** Go to Dashboard → SQL Editor → run:
```sql
SELECT count(*) FROM roles;  -- should return 11
```

## Step 5: Deploy Edge Functions (3 min)

```bash
# From the supabase/ directory
supabase functions deploy approve-signup-request
supabase functions deploy bind-activation-code
supabase functions deploy update-server-secret
supabase functions deploy collect-payment
supabase functions deploy refund-payment
supabase functions deploy ai-proxy
supabase functions deploy workflow-execute
supabase functions deploy run-overdue-scan
supabase functions deploy expire-pending-approvals
supabase functions deploy refresh-materialized-views
supabase functions deploy purge-expired-backups
```

## Step 6: Set Required Secrets (2 min)

```bash
# Replace placeholders with your values
supabase secrets set SUPABASE_URL=https://YOUR_REF.supabase.co
supabase secrets set SUPABASE_ANON_KEY=YOUR_ANON_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set SUPABASE_JWT_SECRET=YOUR_JWT_SECRET
supabase secrets set SUPABASE_PROJECT_REF=YOUR_REF

# Get SUPABASE_ACCESS_TOKEN from https://supabase.com/dashboard/account/tokens
supabase secrets set SUPABASE_ACCESS_TOKEN=YOUR_PERSONAL_ACCESS_TOKEN

# Generate random secrets
supabase secrets set CRON_SECRET=$(openssl rand -base64 32)
supabase secrets set ALLOWED_ORIGINS=http://localhost:5173,app://-,file://-
supabase secrets set LOG_LEVEL=info
```

## Step 7: Create SuperAdmin User (2 min)

1. Dashboard → **Authentication → Users → Add user**
2. Email: `admin@elimtiyaz.dz`
3. Password: generate a strong password, save it
4. **Auto Confirm User:** YES
5. Click **Add user** → copy the user's UUID

6. Dashboard → **SQL Editor → New query** → paste (replace UUID):

```sql
UPDATE public.user_profiles SET status = 'active'
 WHERE auth_user_id = 'PASTE_UUID_HERE';

INSERT INTO public.role_assignments (user_profile_id, tenant_id, role_id, assigned_at)
SELECT up.id, up.tenant_id, r.id, now()
  FROM public.user_profiles up
  CROSS JOIN public.roles r
 WHERE up.auth_user_id = 'PASTE_UUID_HERE'
   AND r.code = 'super_admin'
   AND NOT EXISTS (
       SELECT 1 FROM public.role_assignments ra
        WHERE ra.user_profile_id = up.id AND ra.role_id = r.id
   );

UPDATE public.account_approval_requests
   SET status = 'approved', reviewed_at = now(),
       decision_note = 'Initial SuperAdmin'
 WHERE auth_user_id = 'PASTE_UUID_HERE';
```

Click **Run**.

## Step 8: Launch Desktop App (2 min)

```bash
cd el-imtiyaz-iteration-12/app
npm install
npm start
```

The app launches in **MOCK mode** (default).

1. Sign in with mock demo account:
   - Email: `admin@elimtiyaz.dz`
   - Password: `admin123`

2. Go to **Settings → Configuration** (new tab)

3. In **Connexion** section:
   - URL Supabase: `https://YOUR_REF.supabase.co`
   - Clé anonyme: your anon key
   - Toggle "Utiliser Supabase" = ON
   - Click **Tester la connexion** → should show "Connexion réussie"
   - Click **Enregistrer & Redémarrer**

4. App restarts. Sign in with your REAL SuperAdmin:
   - Email: `admin@elimtiyaz.dz`
   - Password: (the one you set in Step 7)

5. Go to **Settings → Configuration** → configure remaining sections:
   - **IA**: enter Groq API key (from https://console.groq.com/keys)
   - **Sauvegardes**: enter backup passphrase (32+ chars)

## Done! 🎉

You now have:
- ✅ Supabase backend running
- ✅ 50+ database tables with RLS
- ✅ 11 Edge Functions deployed
- ✅ 4 cron jobs scheduled
- ✅ 10 storage buckets
- ✅ Desktop app connected to Supabase
- ✅ SuperAdmin account configured
- ✅ All settings configurable from the UI

## Next Steps

1. **Add parents + students** → CRM tab
2. **Configure pricing** → Settings → Tarification (already seeded with 2026-2027 fees)
3. **Collect a payment** → Financials tab
4. **Set up workflows** → Automatisations tab
5. **Read the full docs** → `docs/` folder

## Troubleshooting

**App won't connect to Supabase?**
- Check URL format: `https://xxxx.supabase.co` (no trailing slash)
- Verify anon key (not service_role key)
- Check network allows outbound HTTPS

**Login fails with real account?**
- Verify user_profiles.status = 'active' (run SQL in Step 7)
- Verify role_assignments row exists
- Check password is correct

**Edge Function returns 500?**
- Check Dashboard → Functions → Logs
- Verify all required secrets are set (`supabase secrets list`)

**Need more help?**
- Full setup guide: `BACKEND_SETUP_GUIDE.md`
- All env vars: `ENVIRONMENT_VARIABLES.md`
- Database schema: `DATABASE_SCHEMA.md`
- Edge Functions: `EDGE_FUNCTIONS.md`
- Authentication: `AUTHENTICATION_SETUP.md`
- Storage: `STORAGE_SETUP.md`
