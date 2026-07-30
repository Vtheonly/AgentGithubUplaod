# Authentication Setup Guide

This document describes the complete authentication system for the El-Imtiyaz platform — JWT tokens, Google OAuth, the approval workflow, session management, and password governance.

## Authentication Overview

The platform uses **Supabase Auth** as the identity provider. Three client types connect:

| Client | Auth Method | Roles |
|--------|-------------|-------|
| Desktop (Electron) | Email + Password | SuperAdmin, FinancialOfficer, Teacher, SupportStaff, Manager, Buyer, Driver, WarehouseWorker, Worker |
| Mobile (Android) | Email + Password | Same staff roles as Desktop |
| Web Portal (Parents/Students) | Google OAuth + Activation Code | Parent, Student |

### Authentication flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase Auth                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Email/Pass  │  │ Google OAuth │  │ JWT Token Generation │   │
│  │ (Staff)     │  │ (Parents)    │  │ + Refresh Tokens     │   │
│  └─────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  auth.users (Supabase managed)                                  │
│  - id (UUID)                                                    │
│  - email                                                        │
│  - encrypted_password                                           │
│  - raw_app_meta_data (tenant_id, etc.)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (trigger: on_auth_user_created)
┌─────────────────────────────────────────────────────────────────┐
│  public.user_profiles                                           │
│  - auth_user_id → auth.users.id                                 │
│  - tenant_id                                                    │
│  - status: pending → active → suspended → deleted               │
│  - approval_request_id                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (after admin approval)
┌─────────────────────────────────────────────────────────────────┐
│  public.role_assignments                                        │
│  - user_profile_id → user_profiles.id                           │
│  - role_id → roles.id                                           │
│  - revoked_at (null = active)                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (RLS reads these to resolve permissions)
┌─────────────────────────────────────────────────────────────────┐
│  RLS Policies on every table                                    │
│  - public.current_tenant_id()                                   │
│  - public.current_user_roles()                                  │
│  - public.current_user_permissions()                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. JWT Configuration

### Default JWT settings (Supabase managed)

- **Algorithm:** HS256
- **Expiry:** 3600 seconds (1 hour)
- **Refresh token rotation:** Enabled
- **Refresh token reuse interval:** 10 seconds

These are configured automatically by Supabase. You can view/change them in Dashboard → Authentication → Settings.

### JWT secret

The JWT secret is used to verify tokens server-side (in Edge Functions). Find it in:
- Dashboard → Project Settings → API → JWT Settings → JWT Secret

Set it as an Edge Function secret:
```bash
supabase secrets set SUPABASE_JWT_SECRET=your_jwt_secret
```

### JWT claims

The JWT contains these claims used by RLS:
- `sub` — user ID (auth.users.id)
- `email` — user email
- `role` — always "authenticated" (Supabase default)
- `app_metadata.tenant_id` — tenant ID (set during user creation)

The RLS helper functions resolve the tenant + roles from the database (not from JWT claims) for security:
```sql
public.current_tenant_id() -- reads from user_profiles, not JWT
public.current_user_roles() -- reads from role_assignments, not JWT
```

---

## 2. Email/Password Authentication (Staff)

Staff sign in via email + password on the Desktop and Mobile apps.

### Configuration

1. Go to Dashboard → Authentication → Sign In / Providers
2. **Email provider:** Enabled (default)
3. **Allow new users to sign up:** OFF (we use admin-approval workflow)
4. **Confirm email:** ON (users must confirm before signing in)

### Sign-in flow (Desktop app)

1. User enters email + password in the login screen
2. Desktop app calls `supabase.auth.signInWithPassword({ email, password })`
3. Supabase returns access_token + refresh_token
4. Desktop app calls `current_user_roles()` + `current_user_permissions()` RPCs
5. Desktop app builds `Session` object with roles + permissions
6. RLS policies gate all subsequent queries

### Password governance (plan §12.04)

Password changes are handled by the `SupabaseAuthRepository.changePassword()` method:

1. **Strength validation** (client-side):
   - Minimum 8 characters
   - At least one lowercase letter
   - At least one uppercase letter
   - At least one digit

2. **Re-authentication**: User must enter their current password, which is verified via `signInWithPassword()`

3. **Password update**: Calls `supabase.auth.updateUser({ password: newPassword })`

4. **Global session revocation**: Calls `supabase.auth.signOut({ scope: 'global' })` — revokes ALL sessions across ALL devices for this user

5. **Audit log**: Writes `auth.password_change` audit entry

### Failed login attempts

Supabase handles rate limiting for failed login attempts. Default: 10 attempts per 10 minutes per IP. After that, the IP is blocked for 10 minutes.

---

## 3. Google OAuth (Parent Web Portal)

Parents sign in to the web portal via Google OAuth + activation code.

### Step 1: Create Google OAuth credentials

1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Authorized redirect URIs:
   - `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
   - `http://localhost:54321/auth/v1/callback` (for local dev)
4. Copy Client ID + Client Secret

### Step 2: Configure in Supabase

1. Dashboard → Authentication → Providers → Google
2. Toggle Enabled = ON
3. Paste Client ID + Client Secret
4. Save

### Step 3: Web portal sign-in flow

1. Parent visits `https://portal.elimtiyaz.dz`
2. Clicks "Sign in with Google"
3. `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '/auth/callback' } })`
4. Google OAuth flow → redirect back to web portal
5. Web portal calls `bind-activation-code` Edge Function with the 6-7 digit code
6. Function calls `bind_activation_code()` RPC:
   - Validates code (exists, not used, not expired)
   - Marks code as bound (single-use)
   - Updates `parents.auth_user_id` to the caller's auth.users.id
7. Web portal now shows the parent's N children

### Activation code properties

- 6-7 digit numeric (generated by `generate_activation_code()` function)
- Single-use (cannot be reused once bound)
- 30-day expiry
- Issued by staff at enrollment time
- Can be delivered as QR code for camera-based entry

---

## 4. Approval Workflow

This is the core of the user's brief: "Approval workflow so that when a user registers from the website, an administrator can approve the account and assign it to the appropriate apprentice [parent/student] profile in the database."

### Two registration paths

**Path A: Admin-first (Account Activation Protocol)**
1. Staff creates parent + N students on Desktop app
2. Staff generates activation code
3. Parent signs up on web portal via Google OAuth
4. Parent enters activation code
5. Code binds parent's auth.users.id to their master parent profile

**Path B: Web-first (Approval Workflow)**
1. Parent signs up on web portal via Google OAuth (or email/password)
2. The `handle_new_auth_user` trigger creates:
   - `user_profiles` row (status='pending')
   - `account_approval_requests` row (status='pending')
3. Admin opens Desktop app → Settings → Inscriptions
4. Admin reviews the request, sees auto-matched parent profile (by email/national_id/phone/activation_code)
5. Admin chooses:
   - **Approve & Bind** — binds to existing parent profile
   - **Approve & Create New Parent** — creates new parent + binds
   - **Reject** — rejects with mandatory reason
6. The `approve-signup-request` Edge Function:
   - Updates `account_approval_requests.status` = 'approved'/'rejected'
   - Activates `user_profiles.status` = 'active' (or 'suspended' for reject)
   - Assigns role via `role_assignments`
   - Binds to parent/student profile (if approve)
   - Sends confirmation email (if Resend configured)
   - Writes audit log

### Auto-matching logic

When the admin views pending requests, the desktop app auto-finds matching parent profiles:

1. **Activation code** (canonical path) — looks up `activation_codes` table
2. **Email** — looks up `parents.email`
3. **National ID** — looks up `parents.national_id`
4. **Phone** — looks up `parents.primary_phone`

If a match is found, the UI shows a green card: "Parent correspondant trouvé"
If no match, the UI shows an amber card: "Aucun parent correspondant — un nouveau profil sera créé"

### Expiry

Pending approval requests auto-expire after 7 days. The `expire-pending-approvals` cron job (daily at 00:00 UTC) marks them as 'expired' and suspends the user profile.

---

## 5. Session Management

### Session creation

When a user signs in:
1. Supabase Auth issues access_token (1 hour) + refresh_token
2. Desktop app stores session in localStorage (`el-imtiyaz.supabase.session`)
3. Desktop app also writes a `sessions` row in the database (for audit + force-revocation)

### Session refresh

- Supabase auto-refreshes the access_token when it's about to expire
- Refresh token rotation is enabled (old refresh_token invalidated after use)
- Reuse interval: 10 seconds (allows for race conditions)

### Session revocation

**On password change** (plan §12.04):
- `supabase.auth.signOut({ scope: 'global' })` revokes ALL sessions for the user
- The `sessions` table rows are marked `revoked_at`
- User must re-authenticate on all devices

**On admin force-logout:**
- Admin can query `sessions` table + update `revoked_at` for a specific user
- Future: an Edge Function could automate this

### Concurrent session limits

Currently no hard limit on concurrent sessions. For production with strict security requirements, add a trigger that limits the number of active sessions per user (e.g., max 3 devices).

---

## 6. Role-Based Access Control (RBAC)

### 11 roles

| Role | Code | Staff? | Web? | Description |
|------|------|--------|------|-------------|
| Super Admin | `super_admin` | ✓ | — | Full system control |
| Financial Officer | `financial_officer` | ✓ | — | Financial hub + expense approvals |
| Teacher | `teacher` | ✓ | — | Grades + attendance + homework |
| Support Staff | `support_staff` | ✓ | — | Operations + parent registration |
| Manager | `manager` | ✓ | — | Department management + task assignment |
| Buyer | `buyer` | ✓ | — | Procurement + suppliers |
| Driver | `driver` | ✓ | — | Deliveries + routing |
| Warehouse Worker | `warehouse_worker` | ✓ | — | Inventory + receipts/dispatches |
| Worker | `worker` | ✓ | — | General tasks |
| Parent | `parent` | — | ✓ | Web portal — view own children |
| Student | `student` | — | ✓ | Web portal — view own grades |

### 56 permissions

Grouped by domain:
- **crm** (9): view_roster, create_parent, edit_parent, delete_parent, view_students, enroll_student, batch_register, import_data, view_own_children
- **academic** (7): view_academics, enter_grades, roll_call, push_homework, view_own_grades, view_own_attendance, manage_subjects
- **financial** (6): view_financials, collect_payment, refund_payment, view_debt, manage_installments, view_own_financials
- **expense** (3): submit_expense, approve_expense, settle_expense
- **hr** (4): view_personnel, manage_personnel, view_releve, log_releve
- **workflow** (3): manage_workflows, view_workflow_runs, execute_workflow
- **routing** (2): access_driver_mode, view_routing
- **settings** (4): manage_settings, manage_rbac, manage_pricing, view_dashboard
- **audit** (1): view_audit_log
- **backup** (1): manage_backups
- **ai** (2): manage_ai_config, use_ai
- **operations** (3): view_operations, manage_suppliers, manage_inventory
- **workforce** (5): view_workforce, manage_departments, assign_tasks, view_tasks, manage_onboarding
- **calendar** (2): manage_calendar, view_calendar
- **notification** (3): create_alert, manage_alerts, view_notifications
- **dashboard** (2): view_dashboard, export_data

### Role-permission matrix (defaults)

Defined in migration `0023_seed.sql`. SuperAdmin gets ALL permissions. Other roles get subsets. See `DATABASE_SCHEMA.md` for the full matrix.

### Tenant-specific overrides

Admins can override the default matrix per tenant via `tenant_role_overrides`:
- `action = 'grant'` — adds a permission to a role
- `action = 'deny'` — removes a permission from a role (deny wins)

The `current_user_permissions()` function computes effective permissions:
```sql
effective = (default_permissions - denied) ∪ granted
```

### RBAC editor

SuperAdmin can edit the matrix via Settings → Matrice RBAC. Changes are written to `tenant_role_overrides` + audit-logged.

---

## 7. Multi-Tenant Isolation

### Tenant resolution

Every RLS policy calls `public.current_tenant_id()` which resolves the tenant from:
1. `user_profiles.tenant_id` (primary — set when the user is created)
2. JWT `app_metadata.tenant_id` (fallback — for service accounts)

### Tenant isolation enforcement

Every tenant-scoped table has RLS policies like:
```sql
CREATE POLICY parents_select ON parents
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND deleted_at IS NULL
  );
```

Users can NEVER see data from other tenants — even if they know the UUID.

### Service role bypass

The `service_role` key bypasses RLS entirely. It's used ONLY in Edge Functions (server-side). NEVER use it in client code (desktop, mobile, web).

---

## 8. Audit Logging

Every authentication event is logged:

| Action | When |
|--------|------|
| `auth.login` | User signs in |
| `auth.logout` | User signs out |
| `auth.password_change` | User changes password |
| `auth.session_revoked` | Session revoked (e.g., after password change) |
| `auth.password_reset` | Password reset requested |
| `account_approval.approve` | Admin approves registration |
| `account_approval.reject` | Admin rejects registration |
| `account_approval.expire_batch` | Cron expires stale requests |
| `activation_code.bind` | Parent binds activation code |
| `activation_code.generate` | Staff generates activation code |

All audit entries include: actor_id, actor_name, actor_role, ip_address, user_agent, before_json, after_json, occurred_at.

---

## 9. Security Best Practices

### Secrets management

- **JWT secret**: stored in Supabase project settings (never in client code)
- **Service role key**: stored as Edge Function secret (never in client code)
- **Anon key**: safe to publish in client code (gated by RLS)
- **Google OAuth secret**: stored in Supabase Auth settings
- **AI API keys**: stored as Edge Function secrets (never sent to client)
- **Backup passphrase**: stored as Edge Function secret + in OS keychain (production)

### Defense in depth

1. **RLS** — database-level isolation
2. **Role checks** — `requirePermission()` in Edge Functions
3. **Client-side gating** — `FeatureGate` component hides UI elements
4. **Audit logging** — every action recorded

### Rate limiting

- **Supabase Auth**: 10 failed login attempts per 10 minutes per IP
- **Edge Functions**: per-tenant rate limit (configurable in system_settings)
- **AI proxy**: 60 requests/minute per tenant (configurable)

### Session security

- Access tokens expire in 1 hour
- Refresh tokens rotate on each use
- Password changes revoke all sessions globally
- Session telemetry stored in `sessions` table (for audit + force-revocation)
