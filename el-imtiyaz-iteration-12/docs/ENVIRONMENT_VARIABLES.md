# Environment Variables Reference

This document lists every environment variable used by the El-Imtiyaz platform, where to set it, and what it's used for.

## Three Locations for Environment Variables

| Location | Purpose | How to Set |
|----------|---------|------------|
| **Supabase Edge Function Secrets** | Server-side env vars for Edge Functions | `supabase secrets set KEY=value` or Supabase Dashboard → Functions → Secrets |
| **Desktop App `.env.local`** | Vite env vars (legacy fallback — most config now done via UI) | Copy `app/.env.example` to `app/.env.local` and fill in |
| **Desktop App `userData/config.json`** | Local config set via Settings → Configuration UI | Set from the desktop app's Configuration tab (preferred method) |

**After iteration 13, you should configure everything from the desktop UI (Settings → Configuration).** The `.env.local` file is only a legacy fallback for development.

---

## 1. Supabase Edge Function Secrets

These are set via `supabase secrets set KEY=value` and are available in Edge Functions via `Deno.env.get("KEY")`.

### Required (must set before Edge Functions work)

| Secret | Purpose | Where to Get It |
|--------|---------|-----------------|
| `SUPABASE_URL` | The Supabase project URL | Dashboard → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Anon public key (used by Edge Functions to make authenticated calls) | Dashboard → Project Settings → API → Project API keys → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS — server-side only, NEVER in client) | Dashboard → Project Settings → API → Project API keys → service_role |
| `SUPABASE_JWT_SECRET` | JWT secret (for verifying tokens server-side) | Dashboard → Project Settings → API → JWT Settings → JWT Secret |

### Required for Configuration UI

| Secret | Purpose | Where to Get It |
|--------|---------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token for Supabase Management API (used by `update-server-secret` function to update other secrets) | https://supabase.com/dashboard/account/tokens → Create new token |
| `SUPABASE_PROJECT_REF` | Project reference ID | Dashboard → Project Settings → General → Reference ID |

### AI Providers (optional — for AI features)

| Secret | Purpose | Where to Get It |
|--------|---------|-----------------|
| `GROQ_API_KEY` | Groq API key for AI features (narratives, drafting, anomaly detection) | https://console.groq.com/keys |
| `OPENROUTER_API_KEY` | OpenRouter API key (fallback when Groq returns 429) | https://openrouter.ai/keys |

### Email Service (optional — for workflow email actions)

| Secret | Purpose | Where to Get It |
|--------|---------|-----------------|
| `RESEND_API_KEY` | Resend API key for sending emails | https://resend.com/api-keys |
| `EMAIL_FROM_ADDRESS` | From email address (must be verified in Resend) | Your domain email, e.g., `noreply@elimtiyaz.dz` |
| `EMAIL_FROM_NAME` | Display name for from address | `El-Imtiyaz Platform` |

### Push Notifications (optional — for Android app)

| Secret | Purpose | Where to Get It |
|--------|---------|-----------------|
| `FCM_SERVER_KEY` | Firebase Cloud Messaging server key | Firebase Console → Project Settings → Cloud Messaging → Server Key |
| `FCM_SENDER_ID` | FCM sender ID | Firebase Console → Project Settings → Cloud Messaging → Sender ID |

### Backup (required for backup daemon)

| Secret | Purpose | Where to Get It |
|--------|---------|-----------------|
| `BACKUP_PASSPHRASE` | AES-256-GCM encryption passphrase for backups (32+ chars) | Generate with `openssl rand -base64 48`. Store in a SEPARATE secrets manager in production. |

### Security + CORS

| Secret | Purpose | Default |
|--------|---------|---------|
| `CRON_SECRET` | Bearer token for manually invoking scheduled functions | Generate with `openssl rand -base64 32` |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | `http://localhost:5173,app://-,file://-` |
| `LOG_LEVEL` | Log verbosity: `trace`, `debug`, `info`, `warn`, `error`, `critical` | `info` |

---

## 2. Desktop App Vite Environment Variables

These are set in `app/.env.local` (copy from `app/.env.example`). Variables prefixed with `VITE_` are exposed to the renderer process.

**Note:** After iteration 13, these are LEGACY FALLBACKS. The preferred method is to configure via Settings → Configuration tab in the desktop app. The local config (stored in `userData/config.json`) takes precedence over these env vars.

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (legacy fallback) | — |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (legacy fallback) | — |
| `VITE_USE_SUPABASE` | Toggle mock vs Supabase backend (`true`/`false`) | `false` |
| `VITE_APP_NAME` | Application name | `El-Imtiyaz` |
| `VITE_APP_VERSION` | Application version | `0.1.0` |
| `VITE_DEFAULT_LOCALE` | Default language (`fr`, `ar`, `en`) | `fr` |
| `VITE_DEFAULT_CURRENCY` | Default currency code (ISO 4217) | `DZD` |
| `VITE_DEFAULT_TIMEZONE` | Default IANA timezone | `Africa/Algiers` |

---

## 3. Local Config (userData/config.json)

This is the PREFERRED location for Supabase connection settings. Set via Settings → Configuration tab in the desktop app. Stored at:
- **Electron:** `<userData>/config.json` (e.g., `~/.config/el-imtiyaz-desktop/config.json` on Linux)
- **Browser dev:** `localStorage["el-imtiyaz.local-config"]`

```json
{
  "supabase_url": "https://YOUR_PROJECT_REF.supabase.co",
  "supabase_anon_key": "YOUR_ANON_KEY",
  "supabase_use_supabase": true
}
```

**Priority order** (highest to lowest):
1. Local config (config.json / localStorage)
2. Vite env vars (`.env.local`)
3. Defaults (mock mode)

---

## 4. Database Direct Connection (for migrations + backups only)

| Variable | Purpose | Where to Get It |
|----------|---------|-----------------|
| `DATABASE_URL` | PostgreSQL connection string for `supabase db push` and `pg_dump` | Dashboard → Project Settings → Database → Connection string → URI |

Format: `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`

Set this in your shell environment or in `supabase/.env` (NOT committed to version control).

---

## 5. Google OAuth Credentials

These are configured in the Supabase Dashboard, NOT as env vars:

| Credential | Purpose | Where to Get It |
|------------|---------|-----------------|
| Google OAuth Client ID | Identifies your app to Google | Google Cloud Console → APIs & Services → Credentials |
| Google OAuth Client Secret | Authenticates your app to Google | Google Cloud Console → APIs & Services → Credentials |

Set in: Supabase Dashboard → Authentication → Providers → Google

---

## 6. System Settings (Database-Backed)

These are stored in the `system_settings` table and managed via Settings → Configuration tab. See `BACKEND_SETUP_GUIDE.md` for the full list.

| Category | Settings Count | Examples |
|----------|----------------|----------|
| `connection` | 3 | supabase.url, supabase.anon_key, supabase.use_supabase |
| `ai` | 5 | groq.api_key, groq.default_model, openrouter.api_key, ai.rate_limit_per_minute |
| `email` | 3 | resend.api_key, email.from_address, email.from_name |
| `push` | 2 | fcm.server_key, fcm.sender_id |
| `storage` | 10 | storage.bucket.payment_proofs, storage.bucket.receipts, etc. |
| `backup` | 4 | backup.passphrase, backup.retention_days, backup.schedule_hours |
| `system` | 7 | system.allowed_origins, system.rate_limit_max_requests, system.log_level, system.timezone |
| `feature_flags` | 5 | feature.enable_ai, feature.enable_workflows, feature.enable_backup_daemon |

**Total: 39 configurable settings in the database**, all editable from the UI.

---

## Quick Setup Checklist

For a fresh deployment, set these in order:

### Step 1: Supabase CLI secrets (required)
```bash
supabase secrets set SUPABASE_URL=https://YOUR_REF.supabase.co
supabase secrets set SUPABASE_ANON_KEY=YOUR_ANON_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set SUPABASE_JWT_SECRET=YOUR_JWT_SECRET
supabase secrets set SUPABASE_ACCESS_TOKEN=YOUR_PERSONAL_ACCESS_TOKEN
supabase secrets set SUPABASE_PROJECT_REF=YOUR_REF
supabase secrets set CRON_SECRET=$(openssl rand -base64 32)
supabase secrets set ALLOWED_ORIGINS=https://app.elimtiyaz.dz,app://-,file://-
supabase secrets set LOG_LEVEL=info
```

### Step 2: Desktop app (via UI)
1. Launch app → Settings → Configuration → Connexion
2. Enter Supabase URL + anon key + toggle "Use Supabase" = ON
3. Click "Save & Restart"
4. After restart, sign in with SuperAdmin
5. Configure remaining sections (IA, Email, Push, Backup, System) from the UI

### Step 3: Optional secrets (can be set from UI or CLI)
```bash
supabase secrets set GROQ_API_KEY=your_groq_key
supabase secrets set OPENROUTER_API_KEY=your_openrouter_key
supabase secrets set RESEND_API_KEY=your_resend_key
supabase secrets set EMAIL_FROM_ADDRESS=noreply@elimtiyaz.dz
supabase secrets set EMAIL_FROM_NAME="El-Imtiyaz Platform"
supabase secrets set BACKUP_PASSPHRASE=$(openssl rand -base64 48)
```

---

## Security Notes

1. **NEVER** commit secrets to version control. The `.env` files are in `.gitignore`.
2. **NEVER** use the `service_role` key in client-side code (desktop app, mobile app, web portal). It bypasses RLS.
3. **NEVER** store secret plaintext values in the `system_settings.value` column. Use `value_encrypted` (set via the `update-server-secret` Edge Function).
4. **ALWAYS** use HTTPS for all connections.
5. **ALWAYS** rotate the `SUPABASE_ACCESS_TOKEN` periodically (it doesn't expire automatically).
6. **ALWAYS** store the `BACKUP_PASSPHRASE` in a separate secrets manager in production (HashiCorp Vault, AWS Secrets Manager, OS keychain) — NOT in `.env`.
