> **ARCHIVAL COPY — DO NOT EDIT.**
>
> This is the **second-pass audit** (99 findings, six forensic auditors 3-A…3-F tracing auth/activation/RLS, payment/refund/receipt, sync/offline/realtime/cache, parent/student/tenancy, chat/notifications/push, and academic features end-to-end), produced 2026-08-28/29 during the read-only audit of the three El-Imtiyaz repositories. It is preserved **verbatim** as historical evidence; only this banner was added when it was archived.
>
> - The **authoritative, consolidated** version of every finding is [`docs/recovery/problem-registry.md`](../recovery/problem-registry.md) (145 problems). Some IDs in this report were merged into parent entries, absorbed via extend-chains, or renumbered to resolve collisions (notably: the 3-A re-use of `SEC-100`/`SEC-101` was renumbered to `SEC-111`/`SEC-112`) — see the registry header ("Consolidation rules applied") and [`docs/audits/README.md`](README.md) for the mapping.
> - File paths below reference the audit-time checkout locations (e.g. `/home/z/my-project/repos/…`) and are frozen as written.
> - Severity/status statements describe the codebase **at audit time**, not the current state. For the current state see [`docs/recovery/current-state.md`](../recovery/current-state.md).
> - **Read-only evidence.** Never edit this file; record new findings ONLY in the problem registry.

---

---
Task ID: 3-B
Agent: forensic-auditor-B (Auth + Activation + RLS end-to-end)
Task: Deep second-pass audit of auth/activation/permissions/RLS across all 3 platforms

Work Log:
- Read first-pass worklog (86 findings) to avoid duplication
- Traced login flow end-to-end on Desktop (login-screen.tsx → auth-provider → SupabaseAuthRepository → current_user_roles/permissions RPC → localStorage session)
- Traced login flow end-to-end on Android (LoginViewModel → LocalAuthRepository → Supabase Auth + offline fallback → SessionManager StateFlow)
- Traced login flow end-to-end on Website (login-screen.tsx → auth-provider → Google OAuth + mock-auth.ts → middleware.ts)
- Traced activation code binding on Desktop (display-only ActivationCodeModal), Website (activation-code-screen.tsx → bind-activation-code EF), and Android (none — bypassed per ARCH-003)
- Audited every RLS policy in 40 migrations (0019 + 0027 + 0029 + 0037 + 0041 + 0043)
- Traced mock-auth.ts hydration path and verified what mock user can/cannot do
- Investigated server-side role checks in 8 EFs (approve-signup-request, update-server-secret, expire-pending-approvals, refresh-materialized-views, run-overdue-scan, workflow-execute, purge-expired-backups, bind-activation-code)
- Verified Git history for every suspicious file
- Identified 15 NEW findings (IDs SEC-100..SEC-110, CROSS-100, WEAK-100..101, DEAD-100)

Findings:

### FINDING SEC-100 — Desktop login screen ships 9 hardcoded staff credentials as quick-fill buttons (in git)
- **What**: The production login screen renders a `DEMO_ACCOUNTS` array containing 9 staff email/password pairs in plain text, exposed as one-tap "Comptes démo" buttons that auto-fill the login form.
- **Where**: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/auth/login-screen.tsx`, lines 24-34
- **Lines**: 24-34 (array), 51-54 (fillDemo function), 127-149 (render loop)
- **Category**: SEC
- **Severity**: Critical
- **End-to-end trace**: User opens desktop → LoginScreen renders → DEMO_ACCOUNTS array is in client bundle → user clicks "Super Administrateur" chip → setEmail("admin@elimtiyaz.dz"), setPassword("admin123") → user clicks "Se connecter" → auth-provider.signIn → SupabaseAuthRepository.signInWithPassword → success. The 9 credentials match `seedAccounts` in `src/infrastructure/mock/seed-data.ts` exactly (verified lines 1646-1671).
- **Intended responsibility**: Demo accounts are typically a dev-only convenience. Production should never ship real staff credentials in the client bundle.
- **Other implementations**: Android `LoginScreen.kt` line 247-262 has the same pattern with different emails/passwords (see CROSS-100). Website does NOT ship demo accounts.
- **Behavioral differences**: Desktop ships `admin@/admin123`, `financial@/fin123`, `teacher@/teach123`, etc. — 9 unique passwords. Android ships `finance@/demo1234` etc. — single shared password.
- **Callers/consumers**: Any user who opens the desktop app sees these credentials on the login screen.
- **Confidence**: Confirmed (file is git-tracked; verified via `git ls-files --error-unmatch`)
- **Git evidence**: Commit `63704051` (2026-08-27, "gg") — most recent touch; `b25e6ca` (2026-08-04, "FKFKFK") — initial commit. File IS tracked in git (the `// ggignore` comment on line 23 is decorative, not a real ignore directive).
- **Root cause**: The DEMO_ACCOUNTS array was meant for local dev convenience but was never stripped before commit. The `// ggignore` comment was misread as a git-ignore directive.
- **Impact**: Anyone with read access to the binary or git repo gets the production staff credentials for all 9 roles. Even if the Supabase project doesn't have these users yet, an attacker can create them via Google OAuth + admin approval, then sign in. If running in mock mode (SEC-005 default-fallback), the credentials work immediately.
- **Code snippet**:
```ts
const DEMO_ACCOUNTS = [
  { email: "admin@elimtiyaz.dz", password: "admin123", role: "Super Administrateur", ... },
  { email: "financial@elimtiyaz.dz", password: "fin123", role: "Agent Financier", ... },
  { email: "teacher@elimtiyaz.dz", password: "teach123", role: "Enseignant", ... },
  { email: "support@elimtiyaz.dz", password: "support123", role: "Personnel de Soutien", ... },
  { email: "manager@elimtiyaz.dz", password: "manager123", role: "Responsable", ... },
  { email: "buyer@elimtiyaz.dz", password: "buyer123", role: "Acheteur", ... },
  { email: "driver@elimtiyaz.dz", password: "driver123", role: "Chauffeur", ... },
  { email: "warehouse@elimtiyaz.dz", password: "warehouse123", role: "Magasinier", ... },
  { email: "worker@elimtiyaz.dz", password: "worker123", role: "Ouvrier", ... },
];
```

### FINDING SEC-101 — Android LocalAuthRepository grants SUPER_ADMIN on ANY failed/empty Supabase login (offline fallback)
- **What**: When Supabase auth fails (wrong password, timeout, OR any exception), the Android app falls back to a "demo/offline" mode that creates a valid 24-hour session with the role INFERRED FROM THE EMAIL — defaulting to `Role.SUPER_ADMIN` for any email that doesn't match a known pattern.
- **Where**: `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt`, lines 74-182
- **Lines**: 74-182 (signIn method), 142-152 (fallback role inference), 155-167 (session creation), 165 (24h expiry)
- **Category**: SEC
- **Severity**: Critical
- **End-to-end trace**: User opens Android → LoginScreen → enters `hacker@evil.com` / `anything` → LoginViewModel.signIn → LocalAuthRepository.signIn → Stage 1: `supabaseProvider.auth.signInWith(Email)` throws (invalid credentials) → `NetworkTimeouts.guard` catches Throwable (NetworkTimeouts.kt line 83) → returns null → `userInfo == null` → Stage 2 fallback fires → email doesn't match "finance"/"teacher"/"manager"/etc. → `else -> Role.SUPER_ADMIN` → session created with `accessToken = "local-<timestamp>"`, `expiresAt = now + 86_400_000ms` (24h) → SessionManager.setSession → MainScreen renders → user has full admin permissions for 24 hours.
- **Intended responsibility**: Stage 2 was meant as a "resilient demo / offline fallback" per the comment on line 141. The intended behavior is to fall back ONLY when Supabase is unconfigured (placeholder URL), not when login fails.
- **Other implementations**: Desktop's MockAuthRepository only signs in via `seedAccounts.find((a) => a.email === email && a.password === password)` — fails closed if no match. Website has no offline fallback (Google OAuth only).
- **Behavioral differences**: Desktop fails closed on bad credentials. Website fails closed. Android grants SUPER_ADMIN on any failure.
- **Callers/consumers**: `LoginViewModel.signIn` (line 59), which is called by `LoginScreen.kt` (line 261 via `viewModel.fillDemoAccount(role)` then submit). Session propagates to all UI via `SessionManager.state` StateFlow.
- **Confidence**: Confirmed (verified `NetworkTimeouts.guard` catches Throwable and returns null at line 83-86 of NetworkTimeouts.kt; verified the Stage 2 fallback fires unconditionally when `userInfo == null`)
- **Git evidence**: Commit `f227de98` (2026-08-14, "Connect mobile app to Supabase") — initial wiring; commits through `08b1d45b` (2026-08-25, "ddd") — most recent touch.
- **Root cause**: The Stage 2 fallback was added as an "offline demo" convenience but the guard condition only checks `if (userInfo != null)` (Stage 1 succeeded), NOT `if (userInfo != null || isSupabaseConfigured)`. So Stage 2 fires whenever Stage 1 returns null — including credential failures, not just unconfigured builds.
- **Impact**: Complete authentication bypass. Anyone can sign in to the Android app as SUPER_ADMIN by entering any unrecognized email + any password. The session is valid for 24 hours. All client-side permission checks pass. The user sees all admin UI. (Server-side RLS would still block actual data access if Supabase is configured, but in offline/unconfigured mode the app uses local Room data which the user can read/write freely.)
- **Code snippet**:
```kotlin
// Stage 1: try Supabase (catches ALL exceptions via NetworkTimeouts.guard)
val userInfo = NetworkTimeouts.guard<UserInfo?>("auth.signIn", 8_000L, onlyIfConfigured = false) {
    supabaseProvider.auth.signInWith(Email) { this.email = email; this.password = password }
    supabaseProvider.auth.currentUserOrNull()
}
if (userInfo != null) { /* Stage 1 success path */ }

// Stage 2: offline fallback — fires whenever userInfo == null (incl. bad password)
val fallbackRole: Role = when {
    email.contains("finance", ignoreCase = true) -> Role.FINANCIAL_OFFICER
    email.contains("teacher", ignoreCase = true) -> Role.TEACHER
    // ... 7 more patterns ...
    else -> Role.SUPER_ADMIN  // ← default for unrecognized emails
}
val localSession = Session(
    role = fallbackRole,
    permissions = Permission.DEFAULT_ROLE_PERMISSIONS[fallbackRole] ?: Permission.entries.toSet(),
    expiresAt = System.currentTimeMillis() + 86_400_000L, // 24 hours
)
```

### FINDING SEC-102 — Android infers role from email substring EVEN WHEN Supabase auth succeeds; defaults to SUPER_ADMIN if role lookup fails
- **What**: Even when Stage 1 (Supabase auth) succeeds, the Android app overrides the role from the database by inferring it from the email's substring, and falls back to `Role.SUPER_ADMIN` if the inference doesn't match.
- **Where**: `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt`, lines 101-106
- **Lines**: 101-106 (role inference in Stage 1)
- **Category**: SEC
- **Severity**: Critical
- **End-to-end trace**: User signs in via Supabase Auth with valid credentials → `userInfo` is non-null → fetches `user_profiles` row → `profile?.roleId` is null (e.g., user signed up via Google OAuth but admin hasn't assigned a role yet) → `Role.fromCode("")` returns null → falls into email-substring inference → if email doesn't contain "finance"/"teacher"/"manager" → defaults to `Role.SUPER_ADMIN` → user gets super_admin permissions despite having no role assignment in the database.
- **Intended responsibility**: The role should come from `role_assignments` table via a JOIN or RPC, not from email substring matching.
- **Other implementations**: Desktop's `SupabaseAuthRepository.signIn` calls `this.client.rpc("current_user_roles")` and uses `roleCodes[0]` — falls back to `Role.SupportStaff` (least privilege) if no roles. Website's auth-provider queries `user_profiles.status` and gates on that — doesn't derive role client-side.
- **Behavioral differences**: Desktop falls back to SupportStaff (least privilege). Website doesn't derive role client-side. Android falls back to SUPER_ADMIN (max privilege).
- **Callers/consumers**: Same as SEC-101.
- **Confidence**: Confirmed
- **Git evidence**: Commit `f227de98` (2026-08-14, "Connect mobile app to Supabase")
- **Root cause**: The email-substring role inference was a transitional hack when role_assignments wasn't yet populated for all users. The fallback `else -> Role.SUPER_ADMIN` was meant as a temporary dev convenience but ships in production.
- **Impact**: A user who signs up via Google OAuth with an arbitrary email (e.g., `john.doe@gmail.com`) — before the admin assigns them a role — gets SUPER_ADMIN permissions on Android. The Android app sees them as super_admin, renders all admin UI, and (if running with Supabase configured) lets them attempt operations that RLS would block server-side. If running in offline/unconfigured mode, they have full admin access to local Room data.
- **Code snippet**:
```kotlin
val remoteRole = Role.fromCode(profile?.roleId ?: "")
    ?: if (email.contains("finance", ignoreCase = true)) Role.FINANCIAL_OFFICER
    else if (email.contains("teacher", ignoreCase = true)) Role.TEACHER
    else if (email.contains("manager", ignoreCase = true)) Role.MANAGER
    else Role.SUPER_ADMIN  // ← escalation for any other email
```

### FINDING SEC-103 — Desktop auth-provider.changePassword is a NO-OP — never calls Supabase to update the password
- **What**: The desktop's `AuthProvider.changePassword` re-authenticates with the current password and writes an audit log entry, but NEVER calls `repos.auth.changePassword` (which has a real implementation that calls `auth.updateUser({password})`). The user is shown a "password changed" success but their actual Supabase password is unchanged.
- **Where**: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/app/providers/auth-provider.tsx`, lines 99-149 (the changePassword function)
- **Lines**: 99-149 (provider's changePassword), compare with `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-auth-repository.ts` lines 146-191 (the REAL changePassword that's never called)
- **Category**: SEC
- **Severity**: High
- **End-to-end trace**: User opens Profile → ChangePasswordModal → enters current + new password → auth-provider.changePassword → strength check → re-auth: `repos.auth.signIn(session.email, currentPassword)` → if successful → `repos.audit.log({action: "auth.password_change", ...})` → `clearSession()` → `setSession(null)` → return `{ok: true}`. The user is signed out and told their password was changed. But `repos.auth.changePassword` (which actually updates the Supabase password via `auth.updateUser({password: newPassword})` + `auth.signOut({scope: "global"})`) is NEVER invoked.
- **Intended responsibility**: Per the function's docstring (lines 88-98), it should call `repos.auth.changePassword` after re-authenticating. The docstring even says "Modifying a password automatically revokes all active JWT tokens and terminates active sessions across all devices for that user account. → we clear the local session and write an audit entry." — but the audit entry says "session revoked" while no actual revocation happens.
- **Other implementations**: Android `LocalAuthRepository.changePassword` (LocalRepositories.kt line 259+) DOES call `supabaseProvider.auth.updateUser({password = newPassword})` for real. The mock AuthRepository has NO changePassword method at all (would throw if called).
- **Behavioral differences**: Desktop: silent no-op, user told "success". Android: real password update. Mock: would crash. The audit log entry on desktop is FORGED — it claims `auth.password_change` happened but the password didn't change.
- **Callers/consumers**: `ChangePasswordModal` (`src/features/profile/change-password-modal.tsx`) → `useAuth().changePassword`. The provider's `changePassword` is the only path.
- **Confidence**: Confirmed (verified by reading both files in full; the provider never references `repos.auth.changePassword`)
- **Git evidence**: Commit `b25e6ca` (2026-08-04, "FKFKFK") — both auth-provider.tsx and supabase-auth-repository.ts have the same initial commit
- **Root cause**: The provider was implemented before the repository's changePassword was added (or the wiring was forgotten). The provider has its own inline re-auth + audit + clear-session logic that mimics what the repository would do — except it skips the actual password update.
- **Impact**: Users who use the "change password" feature believe their password was changed. It wasn't. If they shared their old password and then "changed" it via the desktop, the old password still works. The audit log entry is forged. The "session revoked" claim is also false — the user's other sessions (other devices, mobile, etc.) are NOT revoked because Supabase was never told about the password change.
- **Code snippet**:
```ts
// auth-provider.tsx lines 130-148 (the no-op path):
// Re-authenticate with the current password before accepting the change.
const reauth = await repos.auth.signIn(session.email, currentPassword);
if (!reauth.ok) return { ok: false, error: "Mot de passe actuel incorrect." };

// Write a high-priority audit event for the password change.
await repos.audit.log({
  action: "auth.password_change",
  // ... diff: { before: {password: "***"}, after: {password: "***"} },
  note: "Self-service password change — session revoked per plan §12.04",
});

// Revoke the active session (force re-login on all devices in production
// via Supabase; in the mock we clear the local session).
clearSession();  // ← only clears LOCAL state
setSession(null);
return { ok: true };  // ← user told "success" but password unchanged
// ↑ NOTE: never calls repos.auth.changePassword!
```
```ts
// supabase-auth-repository.ts lines 182-188 (the REAL change that's dead code):
const { error: updateError } = await this.client.auth.updateUser({ password: newPassword });
if (updateError) return Err(supabaseErrorToAppError(updateError));
await this.client.auth.signOut({ scope: "global" });  // actually revokes other sessions
```

### FINDING SEC-104 — Website's bind-activation-code EF reactivates suspended users + self-grants parent role + severs audit trail
- **What**: The website's `bind-activation-code` EF (1) flips `user_profiles.status` from any non-active state to `'active'` — including suspended and deleted users; (2) upserts a `role_assignments` row granting the `'parent'` role with `assigned_by = profile.id` (self-assignment); (3) sets `approval_request_id = null` — severing the link to the original approval request.
- **Where**: `/home/z/my-project/repos/elimtiyaz-website/supabase/functions/bind-activation-code/index.ts`, lines 97-205
- **Lines**: 97-102 (status check — only blocks "active"), 174-205 (activation + role grant + audit severance)
- **Category**: SEC
- **Severity**: High
- **End-to-end trace**: Admin suspends a user (sets `user_profiles.status = 'suspended'`) → user navigates to website → signs in via Google OAuth → loadProfile sees status='suspended' → returns "suspended" → UI shows suspended screen → user opens activation-code-screen directly (e.g., by URL) → submits a 6-7 digit code → EF calls `bind_activation_code` RPC → RPC binds code to parent record (success) → EF line 199-205: `adminClient.from('user_profiles').update({status: 'active', approval_request_id: null})` → user is now ACTIVE despite admin's suspension → EF line 182-194: `adminClient.from('role_assignments').upsert({role_id: parentRole.id, assigned_by: profile.id})` → user now has parent role (self-assigned) → user refreshes → loadProfile sees status='active' + parent role → user lands on dashboard.
- **Intended responsibility**: The desktop's canonical version (which BUSINESS-008 contrasts) only binds the activation code to the parent record — it does NOT activate the user, grant roles, or clear approval_request_id. Those operations belong in the admin approval flow. The website's self-service activation should require the user to already be in a "pending" state and not "suspended"/"deleted".
- **Other implementations**: Desktop `bind-activation-code/index.ts` (lines 1-133) does NOT do any of these. It only calls the RPC + writes audit log.
- **Behavioral differences**: Desktop: admin approval is a separate step. Website: self-service activation grants role + activates user, bypassing admin. Website also reactivates suspended users.
- **Callers/consumers**: `activation-code-screen.tsx` line 78-87 (POST to EF)
- **Confidence**: Confirmed
- **Git evidence**: Commit `e90dbf79` (2026-08-01, "mid") — initial commit
- **Root cause**: The website was built for self-service activation (Path A) but the status check only covers "active" (returns 409). "suspended" and "deleted" users slip through. The `approval_request_id = null` assignment is a separate concern — it severs the audit trail so forensic queries can't trace which approval request led to which activation.
- **Impact**: (1) Suspended users can self-reactivate by submitting a valid activation code (or brute-forcing one — see WEAK-100). (2) Deleted users can be reactivated by the same path. (3) The audit trail is broken — `approval_request_id = null` means there's no DB-level link between the user_profiles row and the original approval request that triggered account creation. (4) Self-assignment of parent role (`assigned_by = profile.id`) violates separation of duties — the audit log shows the user self-granted their own role.
- **Code snippet**:
```ts
// website bind-activation-code/index.ts lines 97-102 (status check — only blocks active):
if (profile.status === "active") {
  return new Response(JSON.stringify({ error: "Account is already active.", already_active: true }), { status: 409 });
}
// NOTE: no check for "suspended" or "deleted" — those slip through

// lines 182-205 (self-grant role + activate + sever audit):
await adminClient.from("role_assignments").upsert({
  user_profile_id: profile.id,
  tenant_id: profile.tenant_id,
  role_id: parentRole.id,
  assigned_by: profile.id, // self-assignment — user grants role to themselves
});
await adminClient.from("user_profiles").update({
  status: "active",
  approval_request_id: null, // severs audit trail
}).eq("id", profile.id);
```

### FINDING SEC-105 — Anonymous invocation of 4 cron EFs (no auth check when no Authorization header)
- **What**: `expire-pending-approvals`, `refresh-materialized-views`, `purge-expired-backups`, and `run-overdue-scan` EFs all treat requests with NO `Authorization` header as legitimate cron invocations and execute service_role operations across ALL tenants. The "security" is the assumption that "Supabase Cron's internal service role invocation only" — but the EFs don't actually verify this; anyone can POST without an Authorization header.
- **Where**:
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/expire-pending-approvals/index.ts` lines 42-59
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/refresh-materialized-views/index.ts` lines 57-72
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/purge-expired-backups/index.ts` lines 55-70
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/run-overdue-scan/index.ts` lines 56-78
- **Lines**: see above
- **Category**: SEC
- **Severity**: High
- **End-to-end trace**: Attacker sends POST to `https://<supabase-url>/functions/v1/expire-pending-approvals` with NO Authorization header → EF line 46: `authHeader = req.headers.get("authorization")` returns null → `if (authHeader)` is false → falls into `else` branch → only checks `if (req.method !== "POST")` → passes for POST → EF proceeds to call `expire_pending_approvals()` RPC via service_role → marks ALL pending approval requests older than 7 days as expired across ALL tenants → writes audit log per affected tenant → returns summary. Same pattern for the other 3 EFs.
- **Intended responsibility**: Cron EFs should require either (a) a CRON_SECRET bearer token, or (b) a verified internal Supabase cron signature. The comment on line 19-23 of each EF says "Identification is enforced by Supabase Cron's internal service role invocation only." — but Supabase's pg_cron doesn't actually send a service_role key in the Authorization header; it sends a normal HTTP request that the gateway verifies_jwt=false lets through.
- **Other implementations**: `bind-activation-code`, `approve-signup-request`, `update-server-secret`, `collect-payment`, `refund-payment`, `workflow-execute` all require JWT (verify_jwt=true in config.toml) AND call `extractAuthContext` to verify the caller.
- **Behavioral differences**: The 4 cron EFs accept anonymous requests; the others don't.
- **Callers/consumers**: Anyone with the Supabase URL (which is in client-side env vars on all 3 platforms)
- **Confidence**: Confirmed (verified config.toml lines 92, 111, 115, 119 all set `verify_jwt = false`)
- **Git evidence**: Commit `b25e6ca` (2026-08-04, "FKFKFK")
- **Root cause**: The cron EFs were designed to be invokable by Supabase's pg_cron scheduler (which doesn't send a JWT). The author assumed that `verify_jwt = false` + the lack of an Authorization header would only match cron invocations. In reality, ANY external request without an Authorization header matches the same condition.
- **Impact**: (1) `expire-pending-approvals`: attacker can mass-expire ALL pending account approval requests across all tenants — denying service to legitimate new signups. (2) `refresh-materialized-views`: attacker can force expensive materialized view refreshes (DoS vector). (3) `purge-expired-backups`: attacker can mark backup archives as 'purged' — causing the desktop to delete ciphertext blobs from IndexedDB vault. (4) `run-overdue-scan`: attacker can mass-generate overdue notifications across all tenants — spamming financial officers.
- **Code snippet**:
```ts
// expire-pending-approvals/index.ts lines 42-59:
const authHeader = req.headers.get("authorization");
const cronSecret = Deno.env.get("CRON_SECRET");
if (authHeader) {
  // Manual invocation: require CRON_SECRET bearer
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError(req, 401, "unauthorized", "Invalid cron secret");
  }
} else {
  // Pure cron invocation — only POST allowed by Supabase Cron
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }
}
// ↑ No auth check at all when no Authorization header — anyone can POST
```

### FINDING SEC-106 — register_fcm_token RPC accepts p_user_id parameter without verifying caller identity (push notification interception)
- **What**: The `register_fcm_token(p_user_id, p_token, p_platform)` SQL function is `SECURITY DEFINER` and accepts `p_user_id` as a parameter. It does NOT verify that the caller's `auth.uid()` matches `p_user_id`. Any authenticated user can register an FCM device token under ANY other user's `user_id`.
- **Where**: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql`, lines 344-384
- **Lines**: 344-384 (function definition)
- **Category**: SEC
- **Severity**: High
- **End-to-end trace**: Attacker (authenticated as user A) calls `supabase.rpc('register_fcm_token', {p_user_id: '<user_B_uuid>', p_token: '<attacker_fcm_token>', p_platform: 'android'})` → RPC runs as postgres (SECURITY DEFINER, bypasses RLS) → looks up user B's tenant_id → INSERT INTO device_tokens (tenant_id, user_id=B, token=attacker_token) ON CONFLICT DO UPDATE SET user_id = B → returns token_id. Now whenever the system sends a push notification to user B (e.g., "your child's payment was received"), the notification is delivered to the attacker's device (because their FCM token is registered under user B's user_id). The upsert behavior also kicks the real user B off their own notifications if the attacker's token was previously registered to user B.
- **Intended responsibility**: The function should verify `p_user_id = current_user_profile_id()` (or `auth.uid()`) before inserting. The RLS policy `device_tokens_self_insert` (lines 1031-1036) DOES enforce this for direct INSERTs — but the SECURITY DEFINER RPC bypasses RLS, so the policy doesn't apply.
- **Other implementations**: The Android app calls this RPC via `FcmTokenRegistrar` — passes its own user_id. The website uses the same RPC (post 0043 alignment). Both clients trust the caller to pass their own user_id, but the RPC doesn't enforce this.
- **Behavioral differences**: Direct INSERTs via `supabase.from('device_tokens').insert(...)` are blocked by RLS (user_id must match). RPC calls bypass RLS and accept any user_id.
- **Callers/consumers**: Android `FcmTokenRegistrar`, website FCM registration hook
- **Confidence**: Confirmed (read the function body; no `auth.uid()` check anywhere)
- **Git evidence**: Commit `9e1e7741` (2026-08-12, "kay") for migration 0027
- **Root cause**: The function was designed to be invokable by the Android app via postgrest RPC. The author trusted the caller to pass their own user_id. The SECURITY DEFINER attribute bypasses RLS, so the self-only RLS policy on device_tokens doesn't apply.
- **Impact**: Push notification interception — attacker receives victim's push notifications (which may contain sensitive info like payment receipts, absence alerts, grade notifications). Can also be used to kick the victim off their own notifications by upserting the attacker's token under the victim's user_id.
- **Code snippet**:
```sql
CREATE OR REPLACE FUNCTION public.register_fcm_token(
    p_user_id uuid,   -- ← caller-supplied, never verified against auth.uid()
    p_token   text,
    p_platform text DEFAULT 'android'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER  -- ← bypasses RLS, including the self-only INSERT policy
AS $$
DECLARE v_token_id uuid; v_tenant_id uuid;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM public.user_profiles WHERE id = p_user_id LIMIT 1;
    -- ↑ trusts p_user_id blindly — no check that p_user_id = current_user_profile_id()
    INSERT INTO public.device_tokens (tenant_id, user_id, token, platform, is_active, last_seen_at)
    VALUES (v_tenant_id, p_user_id, p_token, p_platform, true, now())
    ON CONFLICT (tenant_id, token) DO UPDATE SET user_id = EXCLUDED.user_id, ...
    RETURNING id INTO v_token_id;
    RETURN v_token_id;
END;
$$;
```

### FINDING SEC-107 — approve-signup-request EF allows support_staff → super_admin role escalation
- **What**: The `approve-signup-request` EF requires only `support_staff` role to call (line 74), but accepts an `assign_role` body parameter that can override the auto-assigned role to ANY role code — including `super_admin`. A support_staff user can escalate themselves or others to super_admin via a pending approval.
- **Where**: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts`, lines 213-238
- **Lines**: 213-238 (assign_role override path)
- **Category**: SEC
- **Severity**: High
- **End-to-end trace**: Attacker (support_staff) colludes with accomplice to sign up via Google OAuth with email `accomplice@x.com` → handle_new_auth_user trigger creates user_profiles (status=pending) + account_approval_requests (requested_role='parent') → attacker calls approve-signup-request EF with body `{request_id: '<req_id>', action: 'approve', target_parent_id: '<existing_parent_id>', assign_role: 'super_admin'}` → EF line 74: `requireRole(ctx, "support_staff")` passes (attacker has support_staff role) → EF line 213: `if (body.assign_role && body.assign_role !== approvalRequest.requested_role)` enters override path → looks up role_id for `super_admin` → revokes the auto-assigned parent role → inserts new role_assignment with role_id=super_admin, assigned_by=attacker's user_profile_id → accomplice now has super_admin role.
- **Intended responsibility**: Role assignment should be a separate admin-only operation. `support_staff` should be able to approve/reject pending requests but NOT assign arbitrary roles.
- **Other implementations**: Desktop's RBAC Matrix Editor lets super_admin edit role assignments — but it requires super_admin. The EF lets support_staff do it.
- **Behavioral differences**: Desktop UI gates role management behind super_admin. EF allows support_staff.
- **Callers/consumers**: Desktop's `approvals-tab.tsx` calls this EF.
- **Confidence**: Confirmed
- **Git evidence**: Commit `b25e6ca` (2026-08-04, "FKFKFK")
- **Root cause**: The `assign_role` parameter was added to allow admins to "refine" the role (e.g., assign `financial_officer` instead of `parent` for a staff signup). But there's no validation that `assign_role` is in a safe subset — any role code is accepted.
- **Impact**: A support_staff user (the lowest-tier staff role, often given to front-desk personnel) can escalate themselves or accomplices to super_admin. From super_admin, they can do anything: change pricing, refund payments, delete audit logs (via the append-only trigger workaround — drop and recreate), modify RBAC matrix, etc.
- **Code snippet**:
```ts
// line 74: only requires support_staff
if (!requireRole(ctx, "support_staff")) {
  return jsonError(req, 403, "forbidden", "Only super_admin or support_staff can approve registrations");
}

// lines 213-238: assign_role override accepts ANY role code
if (body.assign_role && body.assign_role !== approvalRequest.requested_role) {
  const { data: newRole } = await supabase
    .from("roles").select("id").eq("code", body.assign_role).single();
  // ↑ no check that body.assign_role is in a safe subset (parent, student, support_staff, etc.)
  // ↓ accepts 'super_admin' too
  if (newRole) {
    await supabase.from("role_assignments").update({revoked_at: ...}).eq(...);
    await supabase.from("role_assignments").insert({
      user_profile_id: ..., tenant_id: ctx.tenantId, role_id: newRole.id, assigned_by: ctx.userProfileId,
    });
  }
}
```

### FINDING SEC-108 — handle_new_auth_user trigger trusts raw_app_meta_data.tenant_id and raw_user_meta_data.requested_role (multi-tenant injection + role escalation at signup)
- **What**: The `handle_new_auth_user()` trigger (migration 0002) reads `tenant_id` from `new.raw_app_meta_data->>'tenant_id'` and `requested_role` from `new.raw_user_meta_data->>'requested_role'`. Both come from the signup request — an attacker can set them to ANY value during Google OAuth sign-up (via the `app_metadata` and `user_metadata` fields).
- **Where**: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0002_tenants_and_users.sql`, lines 166-216
- **Lines**: 178-180 (tenant_id injection), 204 (requested_role injection)
- **Category**: SEC
- **Severity**: High
- **End-to-end trace**: Attacker signs up via Google OAuth with `raw_app_meta_data: {tenant_id: '<victim_tenant_id>'}` and `raw_user_meta_data: {requested_role: 'staff', full_name: 'Attacker'}` → Supabase Auth creates the auth.users row → `handle_new_auth_user` trigger fires (SECURITY DEFINER, runs as postgres) → reads `v_tenant_id := new.raw_app_meta_data->>'tenant_id'` → uses the attacker-supplied tenant_id → creates user_profiles row with that tenant_id → creates account_approval_requests row with `requested_role = 'staff'`. When admin approves, the trigger-granted role would be `support_staff` — but the attacker can also exploit SEC-107 to escalate.
- **Intended responsibility**: `tenant_id` should be derived from a trusted source (admin invitation, default tenant for self-signup). `requested_role` for self-signup should be hardcoded to `'parent'` (the only self-service role per plan §02.08).
- **Other implementations**: None — this is the only auth-trigger.
- **Behavioral differences**: N/A
- **Callers/consumers**: Supabase Auth's `on_auth_user_created` trigger
- **Confidence**: Confirmed
- **Git evidence**: Commit `b25e6ca` (2026-08-04, "FKFKFK")
- **Root cause**: The trigger was designed to support admin-invited users (where `app_metadata.tenant_id` is set by the admin) AND self-signup users (where it falls back to the first tenant). But the trigger doesn't distinguish between these paths — it always trusts `raw_app_meta_data`. Supabase's Google OAuth flow lets the client set `user_metadata` freely; admin-only fields like `app_metadata` should be set via admin API only, but the trigger treats them the same.
- **Impact**: (1) Multi-tenant injection: a self-signup user can place themselves in any tenant, gaining access to that tenant's data after approval. (2) Role escalation: setting `requested_role: 'staff'` puts them on the path to support_staff, which combined with SEC-107 enables super_admin escalation.
- **Code snippet**:
```sql
v_tenant_id := new.raw_app_meta_data->>'tenant_id';  -- attacker-controlled
if v_tenant_id is null then
    select id into v_tenant_id from public.tenants order by created_at limit 1;
end if;
insert into public.user_profiles (auth_user_id, tenant_id, email, ...)
values (new.id, v_tenant_id, ...);  -- tenant_id is attacker-supplied

insert into public.account_approval_requests (
    tenant_id, auth_user_id, email, requested_role, ...
) values (
    v_tenant_id, new.id, new.email,
    coalesce(new.raw_user_meta_data->>'requested_role', 'parent'),  -- attacker-controlled
    ...
);
```

### FINDING SEC-109 — extractAuthContext calls current_user_permissions() via service_role — permissions array is always empty in EFs (RBAC broken for non-super_admin)
- **What**: The shared `extractAuthContext` helper used by all EFs calls `current_user_permissions()` RPC via the `profileClient` (service_role client). Since `current_user_permissions()` uses `auth.uid()` to look up the caller's profile, and service_role has no `auth.uid()`, the RPC returns an empty array. The `requirePermission(ctx, ...)` helper then returns `false` for ALL non-super_admin users — even those with the actual permission in the database.
- **Where**: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/_shared/supabase.ts`, lines 41-89
- **Lines**: 51-69 (extractAuthContext body), 68 (the broken RPC call), 82-84 (requirePermission)
- **Category**: SEC
- **Severity**: High
- **End-to-end trace**: User with `execute_workflow` permission (but NOT super_admin) calls workflow-execute EF → EF line 394: `extractAuthContext(req)` → line 51: `profileClient = createServiceRoleClient()` (service_role) → line 68: `await profileClient.rpc("current_user_permissions")` → inside the RPC, `current_user_profile_id()` calls `auth.uid()` which is NULL (service_role has no auth user) → returns NULL → the SQL `WHERE user_profile_id = NULL AND revoked_at IS NULL` returns 0 rows → CTE returns empty → `current_user_permissions()` returns `'{}'` → ctx.permissions = `[]` → EF line 400: `if (!requirePermission(ctx, "execute_workflow"))` → `ctx.permissions.includes("execute_workflow")` = false, `ctx.roles.includes("super_admin")` = false → returns false → EF returns 403 forbidden. The user is blocked despite having the actual permission.
- **Intended responsibility**: `extractAuthContext` should use a client scoped to the caller's JWT (not service_role) when calling `current_user_permissions`. Or `requirePermission` should re-fetch the permission via a direct query using the user's JWT. Or the helper should query `role_permissions` directly via service_role using the `user_profile_id` it already resolved.
- **Other implementations**: `requireRole(ctx, ...)` (line 86-88) works correctly because it uses `ctx.roles` which IS populated via direct table query (line 60-66, not via the broken RPC). So EFs using `requireRole` work; EFs using `requirePermission` are broken.
- **Behavioral differences**: EFs using `requirePermission`: workflow-execute, run-overdue-scan — block all non-super_admin users. EFs using `requireRole`: approve-signup-request, update-server-secret — work correctly.
- **Callers/consumers**: workflow-execute (line 400), run-overdue-scan (line 68)
- **Confidence**: Confirmed (read current_user_permissions definition in 0003_rbac.sql lines 144-175 — uses `current_user_profile_id()` which uses `auth.uid()`)
- **Git evidence**: Commit `b25e6ca` (2026-08-04, "FKFKFK") for _shared/supabase.ts
- **Root cause**: The `extractAuthContext` helper was written to populate both `roles` and `permissions` for EF use. The author used `profileClient.rpc("current_user_permissions")` thinking it would work the same as the user-scoped call. But `current_user_permissions` is designed to be called by the authenticated user (where auth.uid() resolves), not by service_role.
- **Impact**: Two EFs (`workflow-execute` and `run-overdue-scan` manual invocation) cannot be called by non-super_admin users — even users with the correct permission assigned via the RBAC matrix. This breaks the entire RBAC model for these EFs. The only users who can call them are super_admin (who bypass via `ctx.roles.includes("super_admin")`).
- **Code snippet**:
```ts
// _shared/supabase.ts line 51-69:
const profileClient = createServiceRoleClient();  // ← service_role, auth.uid() is NULL
const { data: profile } = await profileClient.from("user_profiles").select("id, tenant_id, email, status").eq("auth_user_id", user.id).single();
// ... roles fetched via direct table query — WORKS:
const { data: roleAssignments } = await profileClient.from("role_assignments").select("role:roles(code)").eq("user_profile_id", profile.id).is("revoked_at", null);
const roles = (roleAssignments ?? []).map((ra: any) => ra.role?.code).filter(Boolean);

// ... permissions fetched via RPC — BROKEN (auth.uid() NULL for service_role):
const { data: perms } = await profileClient.rpc("current_user_permissions");  // ← returns []
const permissions = perms ?? [];

// requirePermission helper:
export function requirePermission(ctx: AuthContext, permission: string): boolean {
  return ctx.permissions.includes(permission) || ctx.roles.includes("super_admin");
  //                ↑ always []            ↑ only super_admin bypasses
}
```

### FINDING SEC-110 — bind_activation_code RPC is SECURITY DEFINER + accepts p_auth_user_id parameter without verifying caller (direct RPC account takeover)
- **What**: The `bind_activation_code(p_tenant_id, p_code, p_auth_user_id)` SQL function (migration 0005) is `SECURITY DEFINER` and accepts `p_auth_user_id` as a parameter. It does NOT verify that `p_auth_user_id = auth.uid()` (the caller's actual auth user ID). Any authenticated user can call this RPC directly via postgrest and bind ANY auth_user_id to ANY activation code (if they know the code), enabling account takeover.
- **Where**: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0005_crm.sql`, lines 191-243
- **Lines**: 191-243 (function definition), 198 (SECURITY DEFINER), 230 (parents.auth_user_id update)
- **Category**: SEC
- **Severity**: High
- **End-to-end trace**: Attacker (authenticated as user A) brute-forces or steals a valid activation code → calls `supabase.rpc('bind_activation_code', {p_tenant_id: '<tenant>', p_code: '<code>', p_auth_user_id: '<user_B_auth_id>'})` → RPC runs as postgres (SECURITY DEFINER, bypasses RLS) → locks the activation_codes row → marks it bound → `UPDATE parents SET auth_user_id = p_auth_user_id WHERE id = v_parent_id` → user B's auth_user_id is now bound to the attacker-controlled parent record. Result: when user B signs in via Google OAuth, they see the attacker-chosen parent's children + financial data.
- **Intended responsibility**: The function should verify `p_auth_user_id = auth.uid()` (the JWT caller) before binding. The EF wraps this correctly (passes `ctx.userId`), but the RPC is also exposed via postgrest and callable directly.
- **Other implementations**: The `bind-activation-code` EF passes `ctx.userId` (JWT-validated) as `p_auth_user_id` — secure. But the underlying RPC has no such check.
- **Behavioral differences**: EF path: secure (passes JWT user_id). Direct RPC path: insecure (caller supplies any user_id).
- **Callers/consumers**: bind-activation-code EF (secure path); postgrest exposes the RPC directly to any authenticated user.
- **Confidence**: Confirmed
- **Git evidence**: Commit `b25e6ca` (2026-08-04, "FKFKFK") for 0005_crm.sql
- **Root cause**: The function was designed to be called by the EF (which authenticates the caller). The author didn't anticipate direct postgrest invocation. SECURITY DEFINER bypasses RLS so the parents table UPDATE succeeds regardless of who calls it.
- **Impact**: Account takeover: an attacker can bind any auth_user_id to any parent profile by knowing or brute-forcing a 6-7 digit activation code (10M combinations — see WEAK-100). The victim (user B) signs in via Google OAuth and sees the attacker-chosen parent's data. Combined with the website's bind-activation-code EF (SEC-104) which auto-activates the user — the attacker can also auto-activate any account by binding a code to it.
- **Code snippet**:
```sql
CREATE OR REPLACE FUNCTION public.bind_activation_code(
    p_tenant_id uuid,
    p_code text,
    p_auth_user_id uuid  -- ← caller-supplied, NEVER verified against auth.uid()
)
RETURNS TABLE(parent_id uuid, parent_full_name text, student_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER  -- ← bypasses RLS
AS $$
-- ...
UPDATE public.parents
   SET auth_user_id = p_auth_user_id  -- ← trusts p_auth_user_id blindly
 WHERE id = v_parent_id;
-- ...
$$;
```

### FINDING CROSS-100 — Demo account emails and passwords diverge between Desktop and Android (financial@ vs finance@)
- **What**: The desktop and Android login screens ship with different demo account emails and passwords for the same roles. Desktop uses `financial@elimtiyaz.dz` / `fin123`; Android uses `finance@elimtiyaz.dz` / `demo1234`. The Android role inference (SEC-101, SEC-102) uses substring matching on "finance" so both emails match — but the desktop mock seed accounts only recognize `financial@elimtiyaz.dz`.
- **Where**:
  - Desktop: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/auth/login-screen.tsx` lines 24-34
  - Android: `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/features/auth/LoginViewModel.kt` lines 77-91
- **Lines**: see above
- **Category**: CROSS
- **Severity**: Medium
- **End-to-end trace**: User fills "Financial" demo button on Android → email `finance@elimtiyaz.dz` / `demo1234` → signs in. User fills "Agent Financier" demo button on Desktop → email `financial@elimtiyaz.dz` / `fin123` → signs in. If both apps pointed at the same Supabase project, the credentials wouldn't match — each app would reject the other's demo accounts. But on Android, SEC-101's offline fallback fires (treats any auth failure as "demo mode"), so the user gets SUPER_ADMIN anyway.
- **Intended responsibility**: Demo accounts should be consistent across platforms (single source of truth).
- **Other implementations**: Website doesn't ship demo accounts.
- **Behavioral differences**: 9 different passwords (desktop) vs 1 shared password (android). Email prefixes differ ("financial" vs "finance"). Role names: desktop uses French labels; Android uses English role codes.
- **Callers/consumers**: LoginScreen (both)
- **Confidence**: Confirmed
- **Git evidence**: Desktop commit `63704051` (2026-08-27, "gg"); Android commit `c207dca6` (2026-08-02, "mid")
- **Root cause**: Two independent implementations of the demo-account list — no shared constant.
- **Impact**: (1) Confusion for users switching platforms. (2) The Android offline fallback (SEC-101) masks the inconsistency — `finance@elimtiyaz.dz / demo1234` works on Android even though no such account exists in the desktop seed. (3) Security: the Android shared password (`demo1234` for all roles) is weaker than the desktop's per-role passwords.
- **Code snippet**:
```ts
// Desktop login-screen.tsx:
{ email: "financial@elimtiyaz.dz", password: "fin123", role: "Agent Financier" },
```
```kotlin
// Android LoginViewModel.kt:
"financial" -> "finance@elimtiyaz.dz" to "demo1234"  // ← different email + shared password
```

### FINDING WEAK-100 — Activation codes use Postgres random() (non-cryptographic); 7-digit space is brute-forceable; no rate limit on website activation endpoint
- **What**: Activation codes are generated using Postgres `random()` (migration 0005 line 169) which is a non-cryptographic PRNG. The codes are 7 digits (10M combinations). The website's activation-code-screen.tsx has no rate limiting, no lockout after failed attempts, and no idempotency check — making brute-force feasible.
- **Where**:
  - Code generation: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0005_crm.sql` lines 159-183 (generate_activation_code function)
  - Website submission: `/home/z/my-project/repos/elimtiyaz-website/src/features/auth/activation-code-screen.tsx` lines 46-117
- **Lines**: 0005_crm.sql line 169 (random() call), activation-code-screen.tsx lines 78-87 (fetch call)
- **Category**: WEAK
- **Severity**: Medium
- **End-to-end trace**: Admin issues activation code → `generate_activation_code` SQL function picks `lpad((floor(random() * 9000000 + 1000000))::text, 7, '0')` → code is stored in `activation_codes` table → parent receives code → parent opens website → enters code in form → activation-code-screen.tsx handleSubmit → fetch POST to bind-activation-code EF → if code is wrong, EF returns 4xx → user can immediately retry (no delay, no counter, no lockout). At 100 req/s (10 parallel connections), 10M combinations → 100,000 seconds average (~28 hours) to find a valid code. With 1000 req/s (botnet), ~2.8 hours.
- **Intended responsibility**: Activation codes should be generated with `gen_random_bytes()` or `gen_random_uuid()`, should be longer (12+ alphanumeric chars), and the submission endpoint should rate-limit by IP + account.
- **Other implementations**: `batch_register_family` (mock) uses `gen_random_bytes(3)` (per first-pass DEAD-003). The desktop mock `randomActivationCode()` is dead code (DEAD-001). The canonical generator uses `random()`.
- **Behavioral differences**: N/A
- **Callers/consumers**: Admin's "generate activation code" action (desktop), parent's activation-code-screen submit (website).
- **Confidence**: Confirmed
- **Git evidence**: 0005_crm.sql commit `b25e6ca` (2026-08-04); activation-code-screen.tsx via website commit `e90dbf79` (2026-08-01)
- **Root cause**: Postgres `random()` was used for convenience; the 7-digit space was chosen for human-readability. No one added rate limiting because the assumption was that codes are single-use and bound quickly.
- **Impact**: Combined with SEC-110 (RPC accepts any p_auth_user_id) and SEC-104 (auto-activates user), an attacker can brute-force activation codes to take over any parent account. Even without those, brute-forcing lets an attacker enumerate which codes are valid (timing side-channel on the EF's response).
- **Code snippet**:
```sql
-- 0005_crm.sql line 169 (generate_activation_code):
v_code := lpad((floor(random() * 9000000 + 1000000))::text, 7, '0');  -- ← non-crypto PRNG
```
```ts
// activation-code-screen.tsx — no rate limit, no idempotency:
const resp = await fetch(functionUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, apikey: ... },
  body: JSON.stringify({ code: trimmed }),
});
// ↑ no debounce, no max-attempts counter, no exponential backoff
```

### FINDING WEAK-101 — Android LocalAuthRepository stores user UUID as accessToken (fake JWT that doesn't validate server-side)
- **What**: Android's `LocalAuthRepository.signIn` sets `accessToken = userInfo.id` (the user's UUID) instead of the actual JWT access token returned by Supabase Auth. The `refreshSession` method does the same. This fake token doesn't validate anything — if the Android app sends it to EFs or uses it for direct Supabase calls, those calls fail.
- **Where**: `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt`, lines 111-122 (Stage 1) and 235-247 (refreshSession)
- **Lines**: 119 (Stage 1: `accessToken = userInfo.id`), 243 (refreshSession: `accessToken = current.id`)
- **Category**: WEAK
- **Severity**: Medium
- **End-to-end trace**: User signs in via Supabase Auth → `supabaseProvider.auth.signInWith(Email)` succeeds → `userInfo = supabaseProvider.auth.currentUserOrNull()` returns UserInfo object → Session is constructed with `accessToken = userInfo.id` (the user's UUID, not a JWT) → session propagates to SessionManager → if the Android app calls `supabase.functions.invoke(...)` or makes any Supabase call requiring auth, it sends `Authorization: Bearer <uuid>` (not a real JWT) → Supabase rejects with 401. The user's actual JWT (returned by signInWith) is never stored.
- **Intended responsibility**: The Supabase Kotlin SDK's `auth.currentAccessTokenOrNull()` returns the real JWT. The Session should store that.
- **Other implementations**: Desktop's `SupabaseAuthRepository.signIn` line 110: `accessToken: data.session.access_token` — uses the real JWT. Website's auth-provider uses Supabase's session management directly (no manual token storage).
- **Behavioral differences**: Desktop + website use real JWT. Android uses user UUID as a fake token.
- **Callers/consumers**: SessionManager → all UI components that check `session.accessToken`. If any code path sends this token to a Supabase EF or uses it for direct API calls, it fails.
- **Confidence**: Confirmed
- **Git evidence**: Commit `f227de98` (2026-08-14, "Connect mobile app to Supabase")
- **Root cause**: The author confused `userInfo.id` (user UUID) with the JWT access token. The Supabase Kotlin SDK's `Auth.signOut()` and other methods manage the JWT internally — the `Session.accessToken` field is just metadata for the app's own use. The author treated it as the actual token.
- **Impact**: (1) If the Android app ever tries to call EFs with this fake token, all calls fail with 401 — the app silently can't invoke server-side operations. (2) If the app uses the token for direct Supabase REST calls (e.g., for cross-tenant reads), they fail. (3) Session validation logic that checks `accessToken` validity will pass on a fake token.
- **Code snippet**:
```kotlin
// Stage 1 (line 119):
val session = Session(
    userId = profile?.id ?: userInfo.id,
    // ...
    accessToken = userInfo.id,  // ← user UUID, not a JWT!
    refreshToken = null,
    // ...
)
// refreshSession (line 243):
val session = Session(
    // ...
    accessToken = current.id,  // ← user UUID, not a JWT!
    // ...
)
```

### FINDING DEAD-100 — Migration 0029 RLS policies use fn_current_tenant_id() (never-set session setting) — dead code that does nothing
- **What**: Migration 0029 installs RLS policies on `academic_years`, `academic_levels`, `classes`, `subjects`, `class_subjects`, `student_academic_histories` using `public.fn_current_tenant_id()` which reads `current_setting('app.current_tenant_id', true)`. This Postgres session setting is NEVER SET anywhere in the codebase (no EF, no client, no trigger sets it). So `fn_current_tenant_id()` always returns NULL, and the policy `tenant_id = NULL` always evaluates to NULL (deny). These policies are dead code — they never grant access. The 0019 policies (which use `current_tenant_id()` that resolves via `auth.uid()`) still dominate via OR semantics, so the tables work correctly today.
- **Where**: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql`, lines 165-206
- **Lines**: 166-170 (fn_current_tenant_id definition), 172-206 (broken policies on 6 tables)
- **Category**: DEAD
- **Severity**: Medium
- **End-to-end trace**: Migration 0029 runs → `DROP POLICY IF EXISTS rls_X_tenant ON public.X` (drops a policy that didn't exist — no-op) → `CREATE POLICY rls_X_tenant ON public.X FOR ALL USING (tenant_id = public.fn_current_tenant_id())` (creates new policy) → the 0019 policies (X_select, X_admin) remain active because 0029 didn't drop them (different policy names) → for any query, Postgres OR's the USING clauses of all matching policies → 0019's `tenant_id = current_tenant_id()` (works, returns the user's tenant) OR 0029's `tenant_id = NULL` (always NULL) → 0019 wins, the row is visible. The 0029 policy is inert.
- **Intended responsibility**: The 0029 migration intended to install tenant-isolation policies on the new tables it creates (homework, student_academic_histories) and replace 0019's role-based policies on academic_years etc. with simpler tenant-wide policies. The implementation is broken because the helper function relies on a session setting that no one sets.
- **Other implementations**: 0019's `current_tenant_id()` (migration 0003 line 120-130) correctly resolves via `auth.uid()` → `user_profiles.tenant_id` or JWT `app_metadata.tenant_id`.
- **Behavioral differences**: N/A — 0029's policies are inert.
- **Callers/consumers**: None — no query path invokes `fn_current_tenant_id()` with a set session.
- **Confidence**: Confirmed (grep'd for `app.current_tenant_id` across all repos — only the migration 0029 + 0041 mention it, and 0041 only uses it inside a trigger function to set NEW.tenant_id, not for RLS)
- **Git evidence**: Commit `9e1e7741` (2026-08-12, "kay") for 0029_academics_module.sql
- **Root cause**: The migration author introduced a new helper `fn_current_tenant_id()` (using `current_setting`) without realizing that the existing `current_tenant_id()` (using `auth.uid()`) was the canonical resolver. The new helper requires the app to set `app.current_tenant_id` per-connection, which no one does.
- **Impact**: (1) Today: the 0029 policies are dead code — they do nothing. (2) Latent risk: if anyone ever drops the 0019 policies (e.g., during a future "RLS cleanup" migration), these tables would lock down to ALL users (including super_admin, because FORCE RLS is applied per 0019 line 1097). (3) Misleading: future maintainers reading 0029 might think tenant isolation is enforced by these policies when in fact it's enforced by the 0019 policies.
- **Code snippet**:
```sql
-- 0029 line 166-170 (broken helper):
CREATE OR REPLACE FUNCTION public.fn_current_tenant_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
    --                                                ↑ never set anywhere — always NULL
END;
$$ LANGUAGE plpgsql STABLE;

-- 0029 lines 172-174 (one of 6 dead policies):
DROP POLICY IF EXISTS rls_academic_years_tenant ON public.academic_years;
CREATE POLICY rls_academic_years_tenant ON public.academic_years
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());
    --               ↑ always NULL → policy always denies → inert
```

Stage Summary:
- 15 new findings (SEC-100 through SEC-110, CROSS-100, WEAK-100, WEAK-101, DEAD-100)
- Severity breakdown:
  - Critical: 4 (SEC-100 hardcoded credentials, SEC-101 SUPER_ADMIN fallback, SEC-102 SUPER_ADMIN role inference, SEC-110 bind_activation_code RPC account takeover)
  - High: 7 (SEC-103 changePassword no-op, SEC-104 suspended user reactivation, SEC-105 anonymous cron EFs, SEC-106 register_fcm_token RPC, SEC-107 support_staff→super_admin escalation, SEC-108 multi-tenant injection at signup, SEC-109 RBAC broken in EFs)
  - Medium: 3 (CROSS-100 demo account divergence, WEAK-100 activation code brute-force, WEAK-101 fake JWT token, DEAD-100 inert RLS policies)
  - Low: 0
- Top 3 critical new findings:
  1. SEC-101 — Android grants SUPER_ADMIN on any failed login (offline fallback fires unconditionally when Supabase auth fails, defaulting to SUPER_ADMIN for unrecognized emails)
  2. SEC-100 — Desktop ships 9 staff credentials in plain text on the production login screen (file is git-tracked)
  3. SEC-110 — bind_activation_code RPC accepts p_auth_user_id without verifying caller — direct postgrest call enables account takeover via brute-forced activation code
---
Task ID: 3-A
Agent: forensic-auditor-A (Payment + Refund + Receipt end-to-end)
Task: Deep second-pass audit of payment/refund/receipt flows across all 3 platforms

Work Log:
- Read first-pass worklog (86 existing findings across BUSINESS-001..008, CROSS-001..010, WEAK-001..023, SEC-001..008, DRIFT-001..010, DEAD-001..014, DUP-001..005, ARCH-001..005, REG-001..003)
- Traced payment collection end-to-end on Desktop (UnifiedPaymentModal → SupabasePaymentRepository.collect → collect_and_allocate_payment SQL RPC → payments/ledger_entries/installments/audit_logs)
- Traced payment collection end-to-end on Android (CounterPaymentScreen → LocalPaymentRepository.collect → Room mutation + SyncSupport.enqueueOnly → SyncQueueDispatcher.pushPayment → upsert_payment_from_import SQL RPC)
- Traced refund end-to-end on Desktop (NO refund UI button anywhere — SupabasePaymentRepository.refund is dead code) + canonical SQL RPC revert_payment_allocation
- Traced refund end-to-end on Android (PaymentDetailScreen → LocalPaymentRepository.refund → Room mutation + sync enqueue for payment + ledger_entry)
- Traced receipt number generation across 4 paths: canonical SQL RPC (REC-YYYY-NNNNNN sequential), desktop fallback (PAY-YYYY-random), Android local (REC-YYYY-size+1), desktop bulkCollect (PAY-timestamp-random)
- Traced `receipts` table fate: created by 0007, written by old collect_payment (0022), dropped in 0034, NEVER written by canonical collect_and_allocate_payment (0040) or desktop generateReceipt method
- Verified cross-platform state synchronization: website has realtime (useFinancialRealtime), desktop has NO realtime + seeded-once cache, Android pull-only
- Verified EF collect-payment and refund-payment are NEVER invoked by any client (only ai-proxy, update-server-secret, push-homework-notification, approve-signup-request, bind-activation-code, workflow-execute EFs are actually invoked)
- Identified 15 NEW findings not in first pass

Findings:

### FINDING DEAD-015 — Desktop refund flow is completely dead UI; no refund button exists anywhere

- **What:** The desktop's `SupabasePaymentRepository.refund()` method (and the mock's `refundPayment()`) are NEVER called from any production UI component. The `payment-detail-drawer.tsx` only renders `handleMarkCleared` (pending→paid) and `handleMarkBounced` (pending→unpaid) buttons — there is NO refund button. The `Permission.RefundPayment` RBAC permission is defined and shown in the RBAC matrix editor, but no component checks it or wires a refund action to it. The `refund-payment` Edge Function's docstring claims "The Desktop app's Payment History tab or the Finance Officer's reversal modal calls this function" — but no such call site exists.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/financials/payment-detail-drawer.tsx` (only markCleared + markBounced handlers, lines 69-119)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (refund method line 1148, never called from UI)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/refund-payment/index.ts` (docstring line 10-11 claims desktop calls it; false)
- **Lines:** payment-detail-drawer.tsx:69-119 (handleMarkCleared/handleMarkBounced); supabase-shared-repositories.ts:1148-1171 (refund method)
- **Category:** DEAD
- **Severity:** Critical
- **End-to-end trace:** Desktop payment-detail-drawer (no refund button) → NO call to SupabasePaymentRepository.refund → NO call to revert_payment_allocation SQL RPC → NO refund ever happens on desktop. The ONLY refund call site in the entire desktop codebase is `mockPaymentRepository.refund(paymentId)` in `tests/integration/full-payment-flow.test.ts:196`.
- **Intended responsibility:** Desktop staff with `Permission.RefundPayment` should be able to refund (cancel/reverse) a previously-collected payment via a UI button, with a reason prompt and confirmation modal (parallel to markBounced which has a reason prompt).
- **Actual responsibility:** The refund path is unreachable from any desktop UI. Staff cannot refund via the desktop — only Android users can refund (and only via LocalPaymentRepository which bypasses the canonical SQL RPC).
- **Other implementations of same operation:**
  - Android: `PaymentDetailScreen.kt:374` calls `viewModel.refund(paymentId, refundReason.trim())` → `LocalPaymentRepository.refund()` (Room mutation + sync push). Works.
  - Website: NO refund UI (parents are read-only consumers). The mock-auth `MOCK_ADMIN_PERMISSIONS` list includes `finance.payments.refund` but no website code checks this permission.
- **Behavioral differences:** Android can refund; desktop cannot. Desktop staff must ask an Android user (or directly call the SQL RPC via Supabase Studio) to issue a refund — an operational impossibility for finance-only desktop users.
- **Callers/consumers:** The refund method is consumed ONLY by `tests/integration/full-payment-flow.test.ts:196,196,231`. No production caller.
- **Confidence:** Confirmed
- **Git evidence:** Commit history on payment-detail-drawer.tsx: `6370405 gg`, `0f442a1 mid` — no refund-related commit.
- **Likely root cause:** The desktop financials module was built for the collect→clear→bounce lifecycle (cash positive flow), but the refund reversal flow was implemented at the repository layer and the UI button was never wired. The Edge Function's docstring was copied from a design doc that assumed the UI would call it.
- **Potential impact:** Finance staff on desktop cannot issue refunds. Real-world refunds (parent disputes, duplicate entries, bounced checks after clearance) require manual SQL intervention or handoff to an Android user. Audit trail is incomplete for any refund actually performed.
- **Code snippet:**
```typescript
// payment-detail-drawer.tsx — only two handlers, no refund
async function handleMarkCleared() { /* pending → paid */ }
async function handleMarkBounced() { /* pending → unpaid, with reason */ }
// NO handleRefund() — the refunded status is reachable only via:
//   1. Android LocalPaymentRepository.refund()
//   2. Direct SQL RPC call (Supabase Studio)
//   3. The test file
```

### FINDING DEAD-016 — `collect-payment` and `refund-payment` Edge Functions are never invoked by any client

- **What:** A repo-wide search for `functions.invoke("collect-payment")` / `functions.invoke("refund-payment")` / `functions/v1/collect-payment` / `functions/v1/refund-payment` returns ZERO results in client code across all three platforms. The only Edge Functions actually invoked are: `ai-proxy`, `update-server-secret`, `push-homework-notification`, `approve-signup-request`, `bind-activation-code`, `workflow-execute`. The two payment EFs are 200+ lines of dead code including JWT extraction, permission checks, body validation, and audit-log writes — none of which ever runs.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/collect-payment/index.ts` (205 lines, never invoked)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/refund-payment/index.ts` (153 lines, never invoked)
- **Lines:** collect-payment/index.ts:57-205 (Deno.serve handler); refund-payment/index.ts:40-152
- **Category:** DEAD
- **Severity:** Critical
- **End-to-end trace:**
  - Desktop collect: UnifiedPaymentModal:387 → `repos.payments.collect()` → `SupabasePaymentRepository.collect():1081` → direct `client.rpc("collect_and_allocate_payment", ...)` — bypasses EF.
  - Desktop refund: NO UI caller (DEAD-015) — even if it existed, `SupabasePaymentRepository.refund():1151` calls `client.rpc("revert_payment_allocation", ...)` directly — bypasses EF.
  - Android collect: `LocalPaymentRepository.collect():942` → Room upsert + `SyncSupport.enqueueOnly` → `SyncQueueDispatcher.pushPayment:193` → `supabaseProvider.postgrest.rpc("upsert_payment_from_import", ...)` — bypasses EF.
  - Android refund: `LocalPaymentRepository.refund():1092` → Room update + sync enqueue → `SyncQueueDispatcher.pushPayment` (status update) + `pushLedgerEntry` (reversal) — bypasses EF.
  - Website: read-only for payments — no collect/refund calls.
- **Intended responsibility:** Per their docstrings, the EFs are the canonical server-side entry points for payment collection and refund, with JWT auth, permission checks (`collect_payment` / `refund_payment`), body validation (method-specific proof requirements, reason minimum length), and a second belt-and-suspenders audit log write.
- **Actual responsibility:** They sit idle. All their checks (auth, permission, validation, audit) are bypassed because clients call the SQL RPCs directly. The EFs' docstrings (e.g., "The desktop Counter Payment modal or the mobile Collect Payment screen calls this function") are FALSE — neither client calls them.
- **Other implementations of same operation:** The SQL RPCs `collect_and_allocate_payment` (migration 0040:46) and `revert_payment_allocation` (migration 0041:460) are the actual canonical paths. The EFs are a parallel, drifted, never-used duplicate.
- **Behavioral differences:**
  - EF collect-payment: requires JWT, checks `collect_payment` permission, validates `proof_path` for check/transfer, returns `{ payment_id, receipt_id, receipt_number, payment_status, allocations, unallocated_credit, ... }`.
  - Direct SQL RPC: no JWT check (relies on RLS), no permission check, no body validation (relies on `enforce_payment_proof` trigger), returns the canonical RPC's `{ payment_id, receipt_number, payment_status, total_allocated, unallocated_credit, allocations }`.
  - EF refund-payment: requires JWT, checks `refund_payment` permission, requires `reason` >= 3 chars, fetches original payment for pre-check (already_refunded), writes audit log with `request_id` traceability.
  - Direct SQL RPC: no JWT check, no permission check, no reason validation, no pre-check (the RPC itself blocks via `status NOT IN ('paid','pending')`), audit log written by the RPC (no `request_id`).
- **Callers/consumers:** None. Zero consumers in production code.
- **Confidence:** Confirmed
- **Git evidence:** collect-payment/index.ts last touched `eeb82db 2026-08-21 right`; refund-payment/index.ts touched in same commit. No client-side invocation has ever existed.
- **Likely root cause:** The EFs were authored as a server-side gateway per the original architecture plan, but the desktop's SupabasePaymentRepository was wired to call the SQL RPCs directly (simpler, no extra HTTP hop). The Android path followed the same pattern (Room-first + sync queue → upsert RPC). The EFs were left in place "for future use" — classic dead-by-design code.
- **Potential impact:** 1) Security: the EF's `requirePermission` check would have enforced RBAC on payment operations; without it, anyone with a JWT + the anon key can call `collect_and_allocate_payment` (RLS only). 2) Validation: the EF's body validation (proof required for check/transfer, reason >= 3 chars for refund) is replaced by the `enforce_payment_proof` trigger (still works for collect) and NOTHING for refund reason. 3) Audit: the EF's `request_id`-tagged audit log entry is never written; only the SQL RPC's internal audit entry survives.
- **Code snippet:**
```typescript
// collect-payment/index.ts:147 — the EF's canonical invocation that NEVER runs
const { data, error } = await supabase.rpc("collect_and_allocate_payment", {
  p_tenant_id: ctx.tenantId,
  p_parent_id: body.parent_id,
  ...
});
// Desktop ACTUALLY calls (supabase-shared-repositories.ts:1081):
const { data: atomicData, error: atomicErr } = await this.client.rpc(
  "collect_and_allocate_payment",
  atomicParams,
);
```

### FINDING CROSS-200 — Android sync dispatcher swallows RPC errors silently; desktop sync dispatcher throws and retries

- **What:** The Android `SyncQueueDispatcher.pushPayment` (and `pushParent`/`pushStudent`/`pushLedgerEntry`/`pushInstallment`) wrap the `supabaseProvider.postgrest.rpc(...)` call inside `NetworkTimeouts.guard { ... }` and DISCARD the result. The Kotlin Supabase SDK's `rpc()` returns an `HttpResponse` whose body/error must be explicitly read; the dispatcher doesn't read either. If the server returns 400 (FK violation, NOT NULL constraint, RLS denial, trigger exception) or 500, the SDK doesn't throw — the response is silently dropped. The SyncService then marks the entry as "synced". By contrast, the desktop's `defaultPushHandler` does `const { error } = await client.rpc(...); if (error) throw error;` — propagates to SyncService.drain which marks as failed and retries with backoff.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:237-239` (pushPayment)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:162-164` (pushParent)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:188-190` (pushStudent)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:284-286` (pushLedgerEntry)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:321-323` (pushInstallment)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/app/providers/sync-provider.tsx:166-183` (desktop payment push — checks error)
- **Lines:** SyncQueueDispatcher.kt:237-239 (Android pushPayment discards result); sync-provider.tsx:166-183 (desktop checks `if (error) throw error`)
- **Category:** CROSS
- **Severity:** Critical
- **End-to-end trace:**
  Android: `LocalPaymentRepository.collect():965` → `paymentDao.upsert(entity)` (local write succeeds) → `syncSupport.enqueueOnly(entity="payment", ...)` → SyncService drain → `queueDispatcher.pushEntry(entry)` → `pushPayment:237` → `NetworkTimeouts.guard { supabaseProvider.postgrest.rpc("upsert_payment_from_import", params) }` → returns `Unit?` (null on exception, Unit on success) → return value discarded → SyncService marks entry as "synced" (line 111).
  Desktop: `defaultPushHandler:166` → `const { error } = await client.rpc("upsert_payment_from_import", {...})` → `if (error) throw error` (line 181) → SyncService.drain catches (line 365) → marks as pending/failed with backoff.
- **Intended responsibility:** The Android sync push should fail loudly when the server rejects the write — same as the desktop path — so the entry stays pending and retries.
- **Actual responsibility:** The Android sync push reports success for any non-throwing response, including 4xx/5xx with error payloads. The local Room cache and the server drift apart silently.
- **Other implementations of same operation:** Desktop's `defaultPushHandler` (sync-provider.tsx:83-212) properly checks `if (error) throw error` for every entity branch (parent line 136, student line 163, payment line 181, ledger_entry line 206).
- **Behavioral differences:**
  - Android: server returns 400 (e.g., `enforce_payment_proof` trigger rejects a check payment missing proof_path, FK violation on parent_id, NOT NULL violation on receipt_number) → no exception thrown → entry marked "synced" → user sees green sync indicator → server actually has NO row.
  - Desktop: same server 400 → `error` is non-null → throw → SyncService catches → entry stays "pending" with `attempts++` and backoff → user sees red "pending" indicator → retries up to maxAttempts (5) before marking "failed".
- **Callers/consumers:** SyncService.drainPending (line 110-111) consumes the dispatcher's result. The Settings sync UI displays the synced/pending/failed counts to the user.
- **Confidence:** Confirmed
- **Git evidence:** SyncQueueDispatcher.kt last touched `94471e8 2026-08-28 fix(core): pending-waterfall capacity subtracts existing uncleared funds`. sync-provider.tsx in desktop commit `84dd13f okay`.
- **Likely root cause:** The Kotlin Supabase SDK's API surface returns an `HttpResponse` rather than throwing on 4xx/5xx; the desktop's JS SDK returns `{ data, error }` which forces the caller to handle the error. The Android developer mirrored the desktop's structural pattern but missed the SDK's error-handling semantic difference.
- **Potential impact:** Silent data loss on Android sync. Payments collected offline (or while the server is rejecting writes for any reason — RLS misconfiguration, trigger tightening, schema migration in progress) appear to succeed locally and report "synced" status, but never land on the server. The desktop and website never see those payments. The parent's balance on the website is wrong. The Android user believes the data is safe.
- **Code snippet:**
```kotlin
// SyncQueueDispatcher.kt:237-239 — Android: discards rpc result
NetworkTimeouts.guard<Unit>("sync.pushPayment", timeoutMs = 5_000L) {
    supabaseProvider.postgrest.rpc("upsert_payment_from_import", params)
}
// No `if (response.error != null) throw` — response is never read.

// sync-provider.tsx:166-183 — Desktop: properly checks
const { error } = await client.rpc("upsert_payment_from_import", { ... });
if (error) throw error;  // propagates → SyncService marks entry as pending/failed
```

### FINDING BUSINESS-100 — `bulkCollect` silently drops failed chunks; Excel importer thinks everything succeeded

- **What:** `SupabasePaymentRepository.bulkCollect()` inserts payments in chunks of 500. If a chunk fails (FK violation, NOT NULL, trigger rejection), it `console.warn`s the error and `continue`s to the next chunk. After all chunks, it returns `Ok(inserted)` containing only the successfully-inserted rows. The Excel importer's `commitTransaction` calls `bulkCollect` inside a try/catch — but `bulkCollect` never throws (it returns Ok), so the catch never fires. The adapter then proceeds to flush ledger entries + installments. The final "no partial data was applied silently" guard (line 266) is BYPASSED because `bulkCollect` returned Ok.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1346-1361` (bulkCollect chunk loop)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/excel/import-engine/storage/repository-adapter.ts:230-244` (commitTransaction payments flush — only catches thrown errors)
- **Lines:** supabase-shared-repositories.ts:1346-1361 (chunk loop with `continue` on error); repository-adapter.ts:263-268 (the false "no partial data" guard)
- **Category:** BUSINESS
- **Severity:** Critical
- **End-to-end trace:**
  Excel import → `repository-adapter.commitTransaction():230` → `this.deps.payments.bulkCollect(this.pendingPayments)` → `SupabasePaymentRepository.bulkCollect:1319` → loop chunks of 500 → `this.client.from("payments").insert(chunk)` → if `error`: `console.warn` + `continue` → returns `Ok(inserted)` (only successful chunks).
  Back in commitTransaction: `bulkCollect` returned Ok → no exception → catch never fires → no failure message → adapter proceeds to installments flush → adapter sees `failures.length === 0` → does NOT throw the "no partial data" guard → Excel import reports SUCCESS.
  But N payments (the failed chunk's rows) were silently dropped — they exist in the Excel file but not in the database. The corresponding ledger entries (flushed separately at line 220) reference `source_id = payment-${id}` for payments that don't exist → orphan ledger entries.
- **Intended responsibility:** `commitTransaction`'s comment (line 266) explicitly says "L'import a été annulé : aucune donnée financière n'a été partiellement appliquée en silence." (The import was canceled: no financial data was partially applied silently.) `bulkCollect` violates this contract.
- **Actual responsibility:** `bulkCollect` partially applies financial data silently when chunks fail. The importer reports success.
- **Other implementations of same operation:** The loop fallback (line 1365-1370) calls `this.collect(input, collectedBy)` per-payment — that path properly returns errors per-payment (but the loop at line 1366-1369 also discards errors: `const r = await this.collect(input, collectedBy); if (r.ok) results.push(r.value);` — failures are silently dropped here too).
- **Behavioral differences:** The atomic `collect_and_allocate_payment` RPC fails the whole transaction if any precondition fails. The `bulkCollect` direct INSERT bypasses the RPC entirely (no waterfall, no ledger, no audit) AND silently drops failed rows.
- **Callers/consumers:** `repository-adapter.commitTransaction:233` is the only production caller. The Excel import modal (`excel-import-modal.tsx:243`) calls commitTransaction and reports success/failure to the user.
- **Confidence:** Confirmed
- **Git evidence:** supabase-shared-repositories.ts: `84dd13f okay` (latest).
- **Likely root cause:** The chunked-insert optimization was added for performance ("~100x faster than looping collect()", line 1313), but the error handling was copied from a "best-effort" pattern without considering that the upstream adapter relies on throw-on-error semantics.
- **Potential impact:** Excel bulk imports silently drop payments when chunks fail (e.g., parent_id FK violation if a parent in the same import batch was rejected; receipt_number unique violation if the Excel has duplicate receipt numbers). The user sees "import succeeded" but the database is missing payments. Orphan ledger entries may reference non-existent payment IDs, breaking the canonical "ledger is the single source of truth" invariant.
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:1346-1361
for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
  const chunk = rows.slice(i, i + CHUNK_SIZE);
  const { data, error } = await this.client
    .from("payments")
    .insert(chunk as never)
    .select("id, ...");
  if (error) {
    console.warn(`[SupabasePayment] bulk insert chunk ${i} failed:`, error.message);
    continue;  // <-- silently drops this chunk's payments
  }
  for (const row of (data ?? []) as PaymentRow[]) {
    inserted.push(mapPaymentRow(row));
  }
}
// ...
return Ok(inserted);  // <-- returns Ok even with partial failures

// repository-adapter.ts:263-268 — guard that NEVER fires for bulkCollect
if (failures.length > 0) {
  throw new Error(
    `Échec de l'écriture en base (flush bulk) — ${failures.join(" ; ")}. ` +
    "L'import a été annulé : aucune donnée financière n'a été partiellement appliquée en silence."
  );
}
```

### FINDING BUSINESS-101 — `markClearedFallback` produces NO audit log entries and discards actor identity

- **What:** When the canonical `mark_payment_cleared` SQL RPC is unavailable (older Supabase deployment that hasn't run migration 0039/0040), `SupabasePaymentRepository.markCleared()` falls back to `markClearedFallback()` (lines 1217-1274). The fallback updates `payments.status` directly, then loops installments updating `amount_paid`/`amount_pending`/`status`/`paid_date`. It writes NO audit log entries — neither a `payment.mark_cleared` audit entry nor per-installment `installment.clear_funds` audit entries. The canonical RPC writes BOTH (migration 0040 lines 267-298). The fallback also explicitly discards the actor identity via `void actorId; void actorName;` (line 1272-1273) — even if it wanted to write audit entries, it couldn't attribute them.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1217-1274`
- **Lines:** 1217-1274 (full fallback method); 1272-1273 (`void actorId; void actorName;`)
- **Category:** BUSINESS
- **Severity:** High
- **End-to-end trace:**
  Desktop payment-detail-drawer:73 `repos.payments.markCleared(entity.id, session.userId, session.displayName ?? "Session courante")` → `SupabasePaymentRepository.markCleared:1181` → `client.rpc("mark_payment_cleared", ...)` → if `rpcErr`: `console.warn` + `await this.markClearedFallback(id, actorId, actorName)` → fallback updates payments + installments → NO audit log entries → return Ok.
  Canonical RPC path (migration 0040:202-303): updates payment status, loops installments (FOR UPDATE row locks), writes `installment.clear_funds` audit entry per installment + a `payment.mark_cleared` audit entry — all in one transaction.
- **Intended responsibility:** When the canonical RPC is unavailable, the fallback should produce the same observable state changes — including audit log entries — so the audit trail is preserved across deployments.
- **Actual responsibility:** The fallback produces the state changes (payment status + installment amounts) but skips the audit log entirely. Actor identity is discarded.
- **Other implementations of same operation:** Canonical `mark_payment_cleared` SQL RPC (migration 0040:202-303) writes 1 + N audit log entries (1 payment-level + N installment-level) per clearance operation.
- **Behavioral differences:**
  - Canonical: audit_logs has `payment.mark_cleared` entry with `actor_id`, `actor_name`, before/after diff. Each affected installment has an `installment.clear_funds` entry.
  - Fallback: audit_logs has ZERO entries for the clearance operation. The payment row's `updated_at` is bumped but no record of who cleared it or when (beyond the timestamp).
- **Callers/consumers:** `payment-detail-drawer.tsx:73` (handleMarkCleared) is the only production caller. The audit log tab in settings displays audit entries to admins.
- **Confidence:** Confirmed
- **Git evidence:** supabase-shared-repositories.ts commit `84dd13f okay`.
- **Likely root cause:** The fallback was written as a "row-update shim" to keep the desktop working on pre-0039 databases, but the audit-log writes were deemed "too complex to replicate client-side" and skipped. The `void actorId; void actorName;` lines suggest the developer explicitly acknowledged the parameters were unused.
- **Potential impact:** On any deployment without migration 0039/0040, bank clearances happen with NO audit trail. An admin cannot answer "who cleared payment X and when" from the audit_logs table. Compliance failure for financial auditing.
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:1217-1274 (excerpt)
private async markClearedFallback(id: string, actorId: string, actorName?: string): Promise<void> {
  // ... fetch payment, validate status ...
  const { error: updErr } = await this.client
    .from("payments")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("id", id);  // <-- NO audit_logs INSERT
  // ...
  for (const raw of (insRows ?? []) as ...) {
    // ... compute new amounts ...
    const { error: uErr } = await this.client
      .from("installments")
      .update({ amount_paid: newPaid, amount_pending: newPending, status: newStatus, ... })
      .eq("id", raw.id);
    if (uErr) console.warn("[SupabasePayment] clearance installment update failed:", uErr.message);
    // <-- NO audit_logs INSERT for the installment
  }
  void actorId;    // <-- explicitly discarded
  void actorName;  // <-- explicitly discarded
}
// Compare canonical RPC (migration 0040:267-298): writes
//   audit_logs (action='installment.clear_funds', ...) per installment
//   audit_logs (action='payment.mark_cleared', ...) once
```

### FINDING CROSS-101 — `receipts` table is orphaned; website's receipt download is permanently broken

- **What:** Migration 0007 (lines 205-217) creates a `receipts` table with `pdf_path`, `receipt_kind`, `payment_id`, `receipt_number`, `generated_by`. The old `collect_payment` SQL RPC (migration 0022:204-212) inserted into `receipts` after every payment. Migration 0034/0035 DROPPED `collect_payment` and replaced it with `collect_and_allocate_payment` — which does NOT insert into `receipts` (it only sets `receipt_number` on the `payments` row). The desktop's `SupabasePaymentRepository.generateReceipt()` (lines 1459-1485) fetches from `payments` and returns a domain object with `pdfUrl: null` — does NOT insert into `receipts`. Its comment (line 1460) literally says "There is no `receipts` table" — FALSE. The desktop's `ReceiptsTab` (receipts-tab.tsx:50-72) generates PDFs client-side via `generatePaymentReceiptPdf(payment, parent)` and never queries the `receipts` table. The website's `useReceiptsForPayment` (portal-queries.ts:263-280) queries `receipts` by `payment_id` — ALWAYS returns null. The website's `PaymentRowItem.downloadReceipt` (financial-view.tsx:333-356) shows "indisponible" toast because `receipt?.pdf_path` is null.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0007_financial.sql:205-217` (table definition)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0022_functions.sql:204-212` (old collect_payment inserted into receipts)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:46-197` (canonical RPC, NO receipts insert)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1459-1485` (generateReceipt — doesn't insert)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/portal-queries.ts:263-280` (useReceiptsForPayment — queries empty table)
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/financial/financial-view.tsx:333-356` (downloadReceipt — always fails)
- **Lines:** supabase-shared-repositories.ts:1459-1485 (generateReceipt); portal-queries.ts:263-280 (useReceiptsForPayment); financial-view.tsx:333-356 (downloadReceipt shows "indisponible")
- **Category:** CROSS
- **Severity:** Critical
- **End-to-end trace:**
  Desktop: `UnifiedPaymentModal:426` calls `repos.payments.generateReceipt(result.value.id, session.userId)` → fetches `payments` row → returns Receipt domain object with `pdfUrl: null`. Then `UnifiedPaymentModal:433` calls `generatePaymentReceiptPdf(result.value, selectedParent)` (client-side PDF) → user downloads PDF. The `receipts` table is never touched.
  Website: parent opens financial-view → `PaymentRowItem:335` calls `useReceiptsForPayment(payment.id)` → queries `receipts` table `where payment_id = ?` → returns null → `downloadReceipt:339` checks `receipt?.pdf_path` → null → shows "indisponible" toast.
- **Intended responsibility:** The `receipts` table should store PDF receipts (one per payment, plus account statements) with their storage paths, so parents can re-download them from the website portal without staff intervention.
- **Actual responsibility:** The `receipts` table is empty. No production code writes to it. The website's receipt download UI is permanently broken.
- **Other implementations of same operation:** Desktop generates PDFs client-side via Electron print-to-PDF (works). Android `AndroidPdfRepository.generatePaymentReceipt` — generates PDFs on-device (works). Only the website path is broken.
- **Behavioral differences:**
  - Desktop: `ReceiptsTab.downloadReceipt(payment)` → `generatePaymentReceiptPdf(payment, parent)` → client-side PDF → user downloads. Works.
  - Website: `PaymentRowItem.downloadReceipt` → `useReceiptsForPayment` → `supabase.from("receipts").select("*").eq("payment_id", payment.id).maybeSingle()` → returns null → toast "indisponible". Broken.
- **Callers/consumers:** `useReceiptsForPayment` is consumed by `PaymentRowItem` (financial-view.tsx:335). `useReceipts` (portal-queries.ts:619-644) is consumed by `ReceiptsTab` (financial-view.tsx:257-258).
- **Confidence:** Confirmed
- **Git evidence:** Migration 0040 (last canonical RPC rewrite) commit history matches the desktop's main branch.
- **Likely root cause:** When migration 0034 dropped `collect_payment` and replaced it with `collect_and_allocate_payment`, the receipt-table insert was dropped too — the new RPC's author considered `payments.receipt_number` sufficient. The desktop's `generateReceipt` method was rewritten as a no-op that just reads back the payment. The website's queries were never updated to read from `payments` instead. The comment "There is no `receipts` table" was added to justify the simplification — but the table still exists in the schema and the website still queries it.
- **Potential impact:** Parents cannot download payment receipts from the website. They must ask staff to email them a PDF (which the staff generates client-side on the desktop). The `receipts` table's storage bucket (`receipts` bucket per migration 0018:44) is also orphaned. The website's "Receipts" tab shows an empty list forever.
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:1459-1485 — generateReceipt is a no-op for receipts table
async generateReceipt(paymentId: string, generatedBy: string): Promise<Result<Receipt>> {
  // CANONICAL-FINANCIAL-LOGIC.md §7.4 — a receipt is a DERIVED view of a
  // payment. There is no `receipts` table; the receipt's identifier IS
  // the payment's receipt_number.  <-- FALSE: migration 0007 creates it.
  const { data, error } = await this.client
    .from("payments")               // <-- reads payments, not receipts
    .select("id, receipt_number, payment_number")
    .eq("id", paymentId)
    .maybeSingle();
  // ... returns Receipt domain object with pdfUrl: null ...
  // NO INSERT into receipts table.
}

// website: portal-queries.ts:270-274 — queries the orphan table
const { data, error } = await supabase
  .from("receipts")                 // <-- always empty
  .select("*")
  .eq("payment_id", paymentId)
  .maybeSingle();                   // <-- always returns null

// website: financial-view.tsx:339-341 — gives up
if (!receipt?.pdf_path || !supabase) {
  toast.error(t("finance.payment.viewReceipt") + " — indisponible");
  return;
}
```

### FINDING SEC-100 — `upsert_payment_from_import` is SECURITY DEFINER (RLS-bypassed); canonical payment RPCs are not

- **What:** The `upsert_payment_from_import` SQL RPC (migration 0027:601-691) is declared `SECURITY DEFINER` (line 626) — it executes as the function owner (postgres superuser) and bypasses all RLS policies on `payments`. The canonical RPCs `collect_and_allocate_payment` (migration 0040:46-197) and `revert_payment_allocation` (migration 0041:460-643) are declared `LANGUAGE plpgsql` WITHOUT `SECURITY DEFINER` — they execute as the caller, with full RLS enforcement. The Android sync dispatcher ONLY calls `upsert_payment_from_import` (SyncQueueDispatcher.kt:238). The desktop's SupabasePaymentRepository.collect() calls `collect_and_allocate_payment` (RLS-enforced) on the canonical path — but `upsert_payment_from_import` (RLS-bypassed) on the fallback path (line 1092-1118). The desktop's defaultPushHandler for "payment" entity (sync-provider.tsx:166-183) also calls `upsert_payment_from_import`. No GRANT/REVOKE statements restrict who can call these RPCs — PostgreSQL defaults to PUBLIC EXECUTE on functions in the public schema.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:626` (SECURITY DEFINER clause)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:197` (canonical RPC — no SECURITY DEFINER)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:643` (canonical refund RPC — no SECURITY DEFINER)
- **Lines:** migration 0027:626 (`LANGUAGE plpgsql SECURITY DEFINER`); migration 0040:197 (`LANGUAGE plpgsql SET search_path = public, extensions` — no SECURITY DEFINER); migration 0041:643 (same)
- **Category:** SEC
- **Severity:** High
- **End-to-end trace:**
  Android: `LocalPaymentRepository.collect():965` → sync enqueue → `SyncQueueDispatcher.pushPayment:238` → `supabaseProvider.postgrest.rpc("upsert_payment_from_import", params)` → SECURITY DEFINER executes as postgres → RLS bypassed → INSERT into payments succeeds for ANY tenant_id in the payload (the RPC doesn't verify the caller's tenant matches `p_tenant_id`).
  Desktop canonical: `SupabasePaymentRepository.collect():1081` → `client.rpc("collect_and_allocate_payment", ...)` → RLS applies → caller's JWT tenant must match `p_tenant_id` (RLS policy on payments).
  Desktop fallback: `SupabasePaymentRepository.collect():1092` → `client.rpc("upsert_payment_from_import", ...)` → SECURITY DEFINER → RLS bypassed.
- **Intended responsibility:** All payment writes should be RLS-enforced so a parent (or attacker with a leaked anon key + hijacked JWT) cannot write to another tenant's payments table.
- **Actual responsibility:** The Android path and the desktop fallback path bypass RLS. A malicious Android client could pass `p_tenant_id` = any other tenant's UUID and inject a payment into that tenant's books.
- **Other implementations of same operation:** Canonical `collect_and_allocate_payment` (RLS-enforced), canonical `revert_payment_allocation` (RLS-enforced). The `upsert_payment_from_import` is the odd one out.
- **Behavioral differences:** Canonical path: tenant_id in RPC payload MUST match caller's JWT tenant (else RLS rejects). Upsert path: tenant_id in RPC payload is taken at face value; RLS doesn't check.
- **Callers/consumers:**
  - Android SyncQueueDispatcher.pushPayment (line 238) — sole Android path.
  - Desktop SupabasePaymentRepository.collect fallback (line 1092).
  - Desktop defaultPushHandler payment branch (sync-provider.tsx:167).
  - Desktop SupabasePaymentRepository.bulkCollect — actually uses direct INSERT (line 1348), not the RPC; RLS still applies to direct INSERT.
- **Confidence:** Confirmed
- **Git evidence:** Migration 0027 dated 2026-08-XX; migration 0040 commit `eeb82db 2026-08-21 right`.
- **Likely root cause:** `upsert_payment_from_import` was designed as a "bulk import" helper for the Excel importer and sync queue — both server-trusted paths where RLS was considered redundant. But it's now used by the Android sync (over which the server has no trust) and as the desktop's collect fallback. The SECURITY DEFINER flag was never revisited when the call sites expanded.
- **Potential impact:** Cross-tenant payment injection. A malicious Android client (or any client with the anon key + a valid JWT for tenant A) can write a payment to tenant B's `payments` table by passing `p_tenant_id = tenant_B_uuid` in the RPC payload. The receiving tenant's financials are corrupted; the malicious tenant's books are unaffected.
- **Code snippet:**
```sql
-- migration 0027:601-626 — SECURITY DEFINER (bypasses RLS)
CREATE OR REPLACE FUNCTION public.upsert_payment_from_import(
    p_tenant_id uuid, p_payment_number text, p_parent_id uuid, ...
)
RETURNS table(payment_id uuid, payment_number text, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER                       -- <-- bypasses RLS
AS $$ ... INSERT INTO public.payments ... $$;

-- migration 0040:46-197 — NOT SECURITY DEFINER (RLS applies)
CREATE OR REPLACE FUNCTION collect_and_allocate_payment(
  p_tenant_id UUID, ...
) RETURNS TABLE (...) AS $$
...
$$ LANGUAGE plpgsql SET search_path = public, extensions;
-- No SECURITY DEFINER → caller's RLS roles apply.
```

### FINDING CROSS-102 — Android refund sync payload drops the user's refund reason; server audit log has no reason

- **What:** When Android issues a refund, `LocalPaymentRepository.refund()` enqueues a `payment` sync entry with the payload `{ id, status: "refunded", receiptNumber, updatedAt }` (lines 1102-1105). The `reason` parameter — which the user typed into the mandatory reason field (PaymentDetailScreen.kt:362-368, validated to be >= 3 chars at line 378) — is NOT included in the payload. The local audit log entry (line 1165-1166) captures the reason as `{"reason":"$reason"}` in its `afterJson`, but the audit_log entity is in the SyncQueueDispatcher's "local-only else branch" (line 90-93) — it's never pushed to the server. The server's `audit_logs` table (when the refund sync pushes the payment status update via `upsert_payment_from_import`) has NO record of the refund at all (the upsert RPC doesn't write audit logs). The desktop's parallel path `SupabasePaymentRepository.refund()` hardcodes `"Manual refund"` as the reason (BUSINESS-003). So across all platforms, the server's audit trail for refunds is either missing (Android) or generic (desktop fallback "Manual refund").
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1099-1107` (Android refund sync payload — no reason)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1165-1166` (local audit log — captures reason but never synced)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:90-93` (audit_log entity is local-only)
- **Lines:** LocalRepositories.kt:1099-1107 (sync payload omits reason); SyncQueueDispatcher.kt:90-93 (audit_log local-only)
- **Category:** CROSS
- **Severity:** High
- **End-to-end trace:**
  Android: PaymentDetailScreen.kt:374 `viewModel.refund(paymentId, refundReason.trim())` → PaymentDetailViewModel.kt:155 `paymentRepository.refund(paymentId, reason, actorId, actorName)` → LocalPaymentRepository.refund:1092 → payment row updated locally → syncSupport.enqueueOnly(entity="payment", operation="refund", payload={id, status, receiptNumber, updatedAt} — NO reason field) → SyncQueueDispatcher.pushPayment → upsert_payment_from_import (payment row's status updated on server, no audit log entry created). Local audit log entry written at line 1165-1166 with the reason — but never synced.
- **Intended responsibility:** The server's audit trail should record WHY each refund was issued (compliance requirement for financial auditing — typically "Dispute", "Bounced check after clearance", "Duplicate entry", etc.).
- **Actual responsibility:** The server has no record of the refund reason for Android-initiated refunds. The reason exists only in the Android device's local Room audit_logs table — which is wiped if the user clears app data or reinstalls.
- **Other implementations of same operation:** Desktop's `SupabasePaymentRepository.refund()` (line 1148-1171) calls `revert_payment_allocation` SQL RPC with `p_reason: "Manual refund"` hardcoded (BUSINESS-003). The SQL RPC writes an audit log entry with the reason. So desktop's server-side audit has "Manual refund" as the reason for every refund — generic but present.
- **Behavioral differences:** Desktop server audit: `payment.refund` entry with `note: "Inversion LIFO via RPC revert_payment_allocation (canonical 0034) — Manual refund"`. Android server audit: NO entry at all (the upsert_payment_from_import RPC doesn't write audit logs, and the local audit log is never pushed).
- **Callers/consumers:** The audit_logs table is consumed by the desktop's audit-log-tab.tsx and the Android's AuditStreamScreen.kt. Auditors querying the server for refund reasons get null for Android refunds and "Manual refund" for desktop refunds.
- **Confidence:** Confirmed
- **Git evidence:** LocalRepositories.kt refund method last touched `94471e8 2026-08-28`; SyncQueueDispatcher.kt last touched `94471e8 2026-08-28`.
- **Likely root cause:** The Android sync enqueue was scoped to "what the server needs to update the row" (status + receiptNumber) — the reason was considered "extra metadata" that lives in the local audit log. The local audit log was then categorized as "local-only" because audit_logs sync wasn't a priority, decoupling the reason from the server entirely.
- **Potential impact:** Financial auditors cannot determine why any Android-initiated refund was issued. Disputed refunds, bounced-check reversals, and duplicate-entry corrections are indistinguishable. Regulatory compliance failure (most jurisdictions require refund reason documentation).
- **Code snippet:**
```kotlin
// LocalRepositories.kt:1099-1107 — Android refund sync payload (NO reason)
syncSupport?.enqueueOnly(
    entity = "payment",
    operation = "refund",
    payload = syncJson {
        put("id", existing.id); put("status", PaymentStatus.REFUNDED.code)
        put("receiptNumber", existing.receiptNumber); put("updatedAt", now)
        // <-- NO put("reason", reason) here
    },
    isMock = false, sourceScreen = "PaymentDetailScreen",
)

// LocalRepositories.kt:1165-1166 — local audit (has reason, never synced)
auditDao.upsert(audit("payment.refund", "payment", paymentId, actorId, actorName,
    after = """{"reason":"$reason"}"""))

// SyncQueueDispatcher.kt:90-93 — audit_log is local-only
// Other entity kinds (expense, audit_log, notification, calendar_event)
// are currently local-only. ... those flows are out of scope for this iteration.
```

### FINDING CROSS-103 — Android refund sync does NOT push installment state changes; server-side installments stay stale

- **What:** When Android issues a refund, `LocalPaymentRepository.refund()` (lines 1153-1162) reverts the installment allocations locally via `installmentDao.update(...)` (subtracting from `amount_paid` or `amount_pending` per the LIFO `revertPaymentAllocation` engine). But the method does NOT call `syncSupport?.enqueueOnly(entity = "installment", ...)` for the affected installments. The sync queue contains entries for `payment` (status update) and `ledger_entry` (reversal entry), but NOT for `installment`. The server-side installments table retains the pre-refund `amount_paid` / `amount_pending` / `status` values.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1145-1162` (installment revert loop — no sync enqueue)
- **Lines:** 1145-1162 (revert loop with no sync enqueue)
- **Category:** CROSS
- **Severity:** High
- **End-to-end trace:**
  Android: PaymentDetailScreen refund button → LocalPaymentRepository.refund:1092 → payment status update + sync enqueue (line 1099-1107) → reversal ledger entry + sync enqueue (line 1117-1136) → `revertPaymentAllocation` (line 1147-1152) → installment loop (line 1153-1162) updates local Room installments via `installmentDao.update(ins.copy(amountPaid=..., amountPending=..., status=...))` — NO `syncSupport?.enqueueOnly(entity = "installment", ...)` call.
  Server-side: payment status flipped to "refunded" (via upsert_payment_from_import). Reversal ledger entry inserted (via upsert_ledger_entry_from_import). Installments table — UNCHANGED. The `installments.amount_paid` column on the server still shows the pre-refund (paid) amount.
  Website: parent opens financial-view → `useFinancialRealtime` gets a `payments` table event (status changed to refunded) → invalidates `["payments", parentId]` and `["installments", parentId]` queries → `useInstallments` refetches installments from server → server returns STALE installments with old `amount_paid` → parent sees payment="Refunded" but installments still show as "Paid".
- **Intended responsibility:** The installment state changes from a refund should propagate to the server so the website (and any other client) sees the reverted tranche statuses.
- **Actual responsibility:** The installment changes stay local to the Android device. The server-side installments are permanently stale until the desktop independently re-runs the canonical refund RPC (which it can't — DEAD-015).
- **Other implementations of same operation:**
  - Android `LocalPaymentRepository.collect():1034-1044` — installment allocation loop. Does it enqueue installments? Lines 1034-1044 update installments locally but do NOT call syncSupport.enqueueOnly for installments. Same bug on the collect side. The SyncQueueDispatcher.pushInstallment method (line 295-324) exists but is never invoked from the collect/refund paths.
  - Desktop canonical `collect_and_allocate_payment` (migration 0040:111-139) and `revert_payment_allocation` (migration 0041:531-618) update installments server-side atomically.
- **Behavioral differences:**
  - Desktop canonical: server-side installments updated by the SQL RPC. Website sees the changes via realtime.
  - Android: server-side installments NEVER updated. Website sees stale data.
  - Desktop Excel bulk import: installments are flushed separately via `bulkImportInstallments` (repository-adapter.ts:247-262) — this DOES push installments to the server. But the interactive collect/refund paths on Android don't.
- **Callers/consumers:** Website's `useInstallments` (portal-queries.ts) and `useFinancialRealtime` (use-realtime.ts:114-131) consume the installments table.
- **Confidence:** Confirmed
- **Git evidence:** LocalRepositories.kt: `94471e8 2026-08-28`.
- **Likely root cause:** The `syncSupport` was wired into collect/refund for the `payment` and `ledger_entry` entities (the "obvious" financial records), but the `installment` entity was overlooked — possibly because the installments table was historically a "derived" view computed by triggers, and only later (migration 0025_waterfall_allocation) became a first-class table that needed explicit sync.
- **Potential impact:** After an Android refund, the website shows the payment as "Refunded" but the installments as "Paid". The parent's outstanding balance (computed by replaying ledger entries) is correct (the reversal ledger entry was synced), but the tranche-level breakdown is wrong. The parent sees "Refunded payment X — but tranches 1 and 2 are still marked Paid". Confusion + disputes.
- **Code snippet:**
```kotlin
// LocalRepositories.kt:1145-1162 — installment revert loop, NO sync enqueue
val familyInstallments = installmentDao.listByParent(existing.parentId)
    .map { WaterfallInstallment(it.id, ...) }
val revert = com.example.core.revertPaymentAllocation(
    installments = familyInstallments,
    reversalAmount = existing.amount,
    categoryFilter = PaymentCategory.fromCode(existing.category),
    originalWasPending = originalWasPending,
)
revert.reverts.forEach { r ->
    installmentDao.getById(r.installmentId)?.let { ins ->
        installmentDao.update(ins.copy(
            amountPaid = r.newAmountPaid,
            amountPending = r.newAmountPending,
            status = r.newStatus,
            updatedAt = now,
        ))
        // <-- NO syncSupport?.enqueueOnly(entity = "installment", ...) here
        // <-- SyncQueueDispatcher.pushInstallment (line 295-324) is never called from refund
    }
}

// SyncQueueDispatcher.pushInstallment exists but is unreachable from refund path:
private suspend fun pushInstallment(entry: SyncQueueEntity, p: JsonObject, actorId: String) {
    // ... would call upsert_installment_from_import RPC ...
}
```

### FINDING BUSINESS-102 — Android refund has no idempotency check; re-refunding an already-refunded payment creates duplicate reversal entries and double-reverts installments

- **What:** `LocalPaymentRepository.refund()` (lines 1092-1168) does NOT check `existing.status` before refunding. If a payment is already `refunded`, the method: (1) re-updates the payment row to `refunded` (no-op for the payment), (2) creates ANOTHER reversal ledger entry (duplicate — the original reversal entry is still in the ledger), (3) re-runs `revertPaymentAllocation` against installments that have already been reverted. Since `revertPaymentAllocation` subtracts from `amount_paid` (or `amount_pending`), the second refund subtracts the same amount again — driving `amount_paid` NEGATIVE and re-marking tranches as "unpaid" even though they were already unpaid. The SQL RPC `revert_payment_allocation` (migration 0041:493-495) blocks this with `IF v_payment.status NOT IN ('paid', 'pending') THEN RAISE EXCEPTION '... cannot revert'` — but the Android path bypasses the SQL RPC entirely. The EF `refund-payment` (line 88-90) checks `if (originalPayment.status === "refunded") return 409` — but the EF is never called (DEAD-016).
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1092-1098` (refund start — no status check)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:493-495` (SQL RPC blocks re-refund)
- **Lines:** LocalRepositories.kt:1092-1098 (no `if (existing.status == REFUNDED) return Err(...)` check); migration 0041:493-495 (canonical RPC blocks)
- **Category:** BUSINESS
- **Severity:** High
- **End-to-end trace:**
  Android: PaymentDetailScreen refund button → `viewModel.refund(paymentId, reason)` → `LocalPaymentRepository.refund(paymentId, reason, ...)`:
  - Line 1093: `val existing = paymentDao.getById(paymentId) ?: return Err(Errors.notFound(...))` — fetches, no status check.
  - Line 1095: `val updated = existing.copy(status = PaymentStatus.REFUNDED.code, updatedAt = now)` — sets status to refunded (no-op if already refunded).
  - Line 1096: `paymentDao.update(updated)` — persists.
  - Line 1109-1110: `val originalLedger = ledgerDao.listByParent(existing.parentId).firstOrNull { it.sourceId == paymentId && it.type == "payment" }` — finds the ORIGINAL payment ledger entry (NOT the previous reversal). So even after a prior refund, this lookup still finds the original.
  - Line 1112: `val reversal = createReversalEntry(...)` — creates ANOTHER reversal entry.
  - Line 1113: `ledgerDao.upsert(reversal.toEntity())` — inserts duplicate reversal.
  - Line 1147: `val revert = revertPaymentAllocation(installments = familyInstallments, reversalAmount = existing.amount, ...)` — re-runs the revert engine. Since installments were already reverted (amount_paid reduced), the engine subtracts again → amount_paid goes NEGATIVE.
  - Line 1153-1162: persists the (now-negative) amounts to local Room.
- **Intended responsibility:** A second refund call for an already-refunded payment should be rejected with a "payment already refunded" error (parallel to the EF's 409 response and the SQL RPC's RAISE EXCEPTION).
- **Actual responsibility:** The Android refund method is non-idempotent — calling it twice for the same payment creates a second reversal ledger entry and double-subtracts from installments.
- **Other implementations of same operation:**
  - SQL RPC `revert_payment_allocation` (migration 0041:489-495): `SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION; END IF; IF v_payment.status NOT IN ('paid', 'pending') THEN RAISE EXCEPTION 'Payment % is already % (cannot revert)'; END IF;` — properly blocks.
  - EF `refund-payment` (line 88-90): `if (originalPayment.status === "refunded") return jsonError(req, 409, "already_refunded", ...)` — properly blocks (but never called).
- **Behavioral differences:** Desktop SQL RPC: idempotent (second call returns error). Android: non-idempotent (second call corrupts data).
- **Callers/consumers:** `PaymentDetailScreen.kt:374` is the only caller. The UI doesn't disable the refund button after the first refund — let me verify... Looking at PaymentDetailScreen.kt:351 `if (showRefundDialog && payment != null)` — the dialog is shown when `showRefundDialog` is true. The trigger for `showRefundDialog = true` is elsewhere in the screen. If the screen re-renders after a refund and the user clicks the refund button again, the same flow runs.
- **Confidence:** Confirmed (logic) / Likely (UI re-trigger — would need to verify the button is shown after refund)
- **Git evidence:** LocalRepositories.kt: `94471e8 2026-08-28`.
- **Likely root cause:** The Android `LocalPaymentRepository.refund()` was modeled on the local-mutation pattern (update + sync enqueue) without copying the SQL RPC's status-guard. The author assumed the UI would prevent re-refunds, but the UI guard is separate from the data-layer guard.
- **Potential impact:** Accidental double-tap (slow network, user clicks twice) creates a duplicate reversal ledger entry and drives installment `amount_paid` negative. The parent's balance (sum of ledger entries) becomes inconsistent with the installment-level state. Reconciliation fails.
- **Code snippet:**
```kotlin
// LocalRepositories.kt:1092-1098 — NO status guard
override suspend fun refund(paymentId: String, reason: String, actorId: String, actorName: String): Result<Payment> {
    val existing = paymentDao.getById(paymentId) ?: return Result.Err(Errors.notFound("Payment $paymentId not found"))
    val now = Instant.now().toString()
    val updated = existing.copy(status = PaymentStatus.REFUNDED.code, updatedAt = now)  // <-- no check that existing.status is already REFUNDED
    paymentDao.update(updated)
    // ... proceeds to create ANOTHER reversal entry + re-run revert engine ...

-- migration 0041:489-495 — canonical SQL RPC properly guards
SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Payment % not found', p_payment_id; END IF;
IF v_payment.status NOT IN ('paid', 'pending') THEN
    RAISE EXCEPTION 'Payment % is already % (cannot revert)', p_payment_id, v_payment.status;
END IF;
```

### FINDING CROSS-104 — Desktop SupabasePaymentRepository cache never re-seeds from server; no realtime, no manual refresh

- **What:** The desktop's `SupabasePaymentRepository` uses a `SubjectBehavior<Payment[]>` in-memory cache. The `seed()` method (lines 997-1012) is gated by a `seeded` boolean flag — once `seeded = true` (line 999), subsequent `seed()` calls return immediately without re-fetching. There are NO Supabase Realtime subscriptions anywhere in `supabase-shared-repositories.ts` (grep for `channel`/`subscribe`/`realtime` returns 0 hits). The desktop's SyncService is push-only (it drains outbound queue entries); it has no pull-from-server logic. The website's `useFinancialRealtime` (use-realtime.ts:114-131) DOES use realtime for payments+installments. So when Android collects a payment and pushes it to Supabase, the website sees it via realtime, but the desktop's cache stays stale until the desktop app is restarted (which re-creates the repository and re-seeds).
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:997-1012` (seed method with seeded flag)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1014-1033` (observe methods — all call seed once)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/supabase-client.ts:104-106` (realtime config exists but unused)
- **Lines:** 997-1012 (seed with seeded flag), 1014-1033 (observe methods)
- **Category:** CROSS
- **Severity:** High
- **End-to-end trace:**
  Android: collect payment → push to server via upsert_payment_from_import → server's `payments` table has new row.
  Desktop (running concurrently): `SupabasePaymentRepository.cache` was seeded once at first subscription → `seeded = true` → no re-fetch → cache unchanged → `useObservable(() => repos.payments.observe(), [])` returns stale list → UI shows old payment count.
  Website (running concurrently): `useFinancialRealtime` subscribes to `payments` table → server pushes INSERT event → TanStack Query cache invalidated → `usePayments` refetches → parent sees new payment.
- **Intended responsibility:** Per the comment at line 21: "Realtime subscriptions can be layered on later." — the design called for realtime to keep the cache fresh. The "later" never happened.
- **Actual responsibility:** The cache is seeded once per app session. Subsequent writes from other clients (Android, website, other desktop instances, server-side EFs) are invisible until restart.
- **Other implementations of same operation:**
  - Website: `useFinancialRealtime` (use-realtime.ts:114-131) subscribes to payments+installments, invalidates TanStack Query on change. Works.
  - Android: `PullSyncRepository.pullAll()` is called by SyncService.drainPending (line 130) after every drain — pulls latest from server into Room. Works (but only when a drain happens — not on a timer when there's nothing to push).
- **Behavioral differences:**
  - Website: realtime → instant refresh.
  - Android: pull-after-drain → refresh after each drain tick (15-min WorkManager + manual sync).
  - Desktop: never refresh (only re-seeds on app restart).
- **Callers/consumers:** `useObservable(() => repos.payments.observe(), [])` is called by `ReceiptsTab` (receipts-tab.tsx:53), `PaymentDetailDrawer` (line 56), and others. All show stale data after Android/website writes.
- **Confidence:** Confirmed
- **Git evidence:** supabase-shared-repositories.ts: `84dd13f okay`. The comment "Realtime subscriptions can be layered on later" has been there since initial authoring.
- **Likely root cause:** The SubjectBehavior pattern was inherited from the mock repository (which doesn't need realtime — it's the source of truth). When the Supabase-backed repository was implemented, the same pattern was copied with a TODO comment for realtime. The TODO was never addressed.
- **Potential impact:** Multi-staff scenarios: staff A on desktop collects a payment; staff B on desktop (different machine) doesn't see it. Staff B may issue a duplicate payment or make decisions based on stale balance. Reconciliation at end-of-day is surprising.
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:997-1012 — seed once, never refresh
private async seed(): Promise<void> {
  if (this.seeded) return;       // <-- second call returns immediately
  this.seeded = true;
  try {
    const tenantId = getTenantId();
    const { data, error } = await this.client
      .from("payments")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("collected_at", { ascending: false });
    if (error) throw error;
    this.cache.set((data as PaymentRow[]).map(mapPaymentRow));
  } catch {
    this.cache.set([]);
  }
}
// Line 21 comment: "Realtime subscriptions can be layered on later."  <-- NEVER DONE

// Compare website (use-realtime.ts:114-131) — DOES use realtime:
export function useFinancialRealtime(parentId: string | null | undefined) {
  useRealtimeInvalidation("installments", [["installments", parentId], ["payments", parentId]], { ... });
  useRealtimeInvalidation("payments", [["payments", parentId], ["installments", parentId]], { ... });
}
```

### FINDING BUSINESS-103 — Desktop's `collect()` fallback to `upsert_payment_from_import` skips ledger entry, waterfall, parent_credit, and audit log (extends BUSINESS-002)

- **What:** First-pass BUSINESS-002 noted the silent fallback. The deeper trace: the canonical `collect_and_allocate_payment` SQL RPC (migration 0040:46-197) writes FIVE things atomically — (1) payment row, (2) ledger entry for the payment, (3) waterfall installment updates (amount_paid/amount_pending/status), (4) optional parent_credit ledger entry for overpayments, (5) audit_log entry `payment.collect`. The fallback `upsert_payment_from_import` (migration 0027:601-691) writes ONLY the payment row — NO ledger entry, NO waterfall, NO parent_credit, NO audit_log. So when the canonical RPC is unavailable (e.g., migration 0040 not yet applied), the desktop's `SupabasePaymentRepository.collect()` produces a payment row with NO corresponding ledger entry. The parent's balance — which the canonical engine computes by replaying `ledger_entries` — does NOT decrease. The desktop UI shows the payment as collected, but the parent's outstanding balance is unchanged. Silent financial data corruption.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1086-1118` (fallback branch)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:46-197` (canonical RPC — 5 writes)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:601-691` (fallback RPC — 1 write)
- **Lines:** supabase-shared-repositories.ts:1086-1118 (fallback branch with 1 write); migration 0040:74-192 (canonical with 5 writes)
- **Category:** BUSINESS
- **Severity:** Critical
- **End-to-end trace:**
  Desktop UnifiedPaymentModal:387 → `repos.payments.collect(input, session.userId)` → `SupabasePaymentRepository.collect:1035`:
  - Line 1081: `client.rpc("collect_and_allocate_payment", atomicParams)` — if success: payment + ledger + waterfall + parent_credit + audit_log all written atomically. ✅
  - Line 1086-1091: `if (atomicErr) console.warn("... falling back to upsert_payment_from_import", ...)` — falls back.
  - Line 1092-1118: `client.rpc("upsert_payment_from_import", {...})` — writes payment row ONLY. NO ledger entry. NO waterfall. NO parent_credit. NO audit_log.
  - Line 1134-1142: fetches the payment row, updates cache, returns Ok(payment).
  Parent's balance computation: `computeParentSummary` (migration 0041) replays `ledger_entries` — no entry for this payment → balance unchanged.
  Desktop UI: shows payment as collected (cache has it). Parent balance: shows old value. Installments: show old amount_paid.
- **Intended responsibility:** When the canonical RPC is unavailable, the fallback should produce the same observable state (or fail loudly so the user knows to retry).
- **Actual responsibility:** The fallback writes the payment row and returns Ok — the user thinks collection succeeded. The ledger is silently missing. The desktop shows the payment, but every downstream computation that depends on the ledger (balance, overdue, reconciliation, parent_credit) is wrong.
- **Other implementations of same operation:**
  - Android `LocalPaymentRepository.collect():942-1090` — writes payment + ledger + parent_credit locally + sync-enqueues each. Bypasses the canonical RPC (CROSS-005 first-pass), but at least writes the ledger.
  - Canonical `collect_and_allocate_payment` (migration 0040:46-197) — atomic, 5 writes.
  - Old `collect_payment` (migration 0022, dropped in 0034) — wrote payment + ledger + receipts + audit.
- **Behavioral differences:** Canonical path: 5 writes, atomic, balance updates. Fallback path: 1 write (payment only), non-atomic (just the payment insert), balance does NOT update. The trigger `sync_payments_receipt_number` does fire and sets receipt_number = payment_number — so the receipt number is preserved. But everything else is missing.
- **Callers/consumers:** `UnifiedPaymentModal.submit:387` is the only production caller. The mock repository's `collectPayment` (financial/payment-ops.ts) writes payment + ledger + audit locally.
- **Confidence:** Confirmed
- **Git evidence:** supabase-shared-repositories.ts: `84dd13f okay`. Migration 0040 last commit `eeb82db 2026-08-21 right`.
- **Likely root cause:** The fallback was added when migration 0026/0034 first introduced the canonical RPC — older deployments didn't have it. The fallback was meant as a "best-effort keep working" shim. The author didn't trace the side-effect divergence (5 writes vs 1 write). The comment at line 1086-1091 justifies the fallback as "older Supabase deployments" but doesn't acknowledge the data corruption.
- **Potential impact:** Silent financial data corruption. The desktop shows a payment as collected, but the parent's balance doesn't decrease. The parent is incorrectly dunned for non-payment. Reconciliation (`reconcileFinancials`) raises `UNBACKED_PARENT_CREDIT` or `PAYMENT_WITHOUT_LEDGER` anomalies. Auditor cannot match payments to ledger entries.
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:1086-1118 — fallback writes ONLY the payment row
if (atomicErr) {
  console.warn("[SupabasePayment] collect_and_allocate_payment failed, falling back to upsert_payment_from_import:", atomicErr.message);
  const { data: fallbackData, error: fallbackErr } = await this.client.rpc(
    "upsert_payment_from_import",
    {
      p_tenant_id: tenantId,
      p_payment_number: paymentNumber,
      p_parent_id: input.parentId,
      // ... ONLY payment fields ...
      // NO ledger entry insert
      // NO waterfall installment update
      // NO parent_credit ledger entry
      // NO audit_log entry
    },
  );
  // ...
}

-- Compare canonical RPC (migration 0040) — 5 atomic writes:
INSERT INTO payments (...);                                              -- (1)
INSERT INTO ledger_entries (...);                                         -- (2)
FOR v_ins IN SELECT ... FROM installments ... FOR UPDATE LOOP
  UPDATE installments SET amount_paid = ..., status = ... WHERE id = ...; -- (3)
END LOOP;
IF v_unallocated > 0 THEN
  INSERT INTO ledger_entries (..., 'parent_credit', ...);                 -- (4)
END IF;
INSERT INTO audit_logs (action='payment.collect', ...);                  -- (5)
```

### FINDING BUSINESS-104 — `markClearedFallback` uses sequential `await` per installment; swallows per-installment errors causing cascading over-allocation

- **What:** `SupabasePaymentRepository.markClearedFallback()` (lines 1217-1274) loops installments in a `for...of` with sequential `await` calls: `await this.client.from("installments").update({...}).eq("id", raw.id)`. If installment A's update fails (RLS denial, network blip, CHECK constraint), the error is caught at line 1269 with `if (uErr) console.warn(...)` and the loop CONTINUES to installment B. Critically, the `remaining` variable is decremented at line 1270 (`remaining -= moved`) based on the ASSUMPTION that A's update succeeded. When the loop reaches B, `remaining` still includes A's amount → B gets over-allocated (the engine allocates `min(remaining, B.amount_pending)` which is now too large). The canonical `mark_payment_cleared` SQL RPC (migration 0040:202-303) uses `FOR v_ins IN ... FOR UPDATE` (PostgreSQL row locks) within a single transaction — if any installment update fails, the entire transaction rolls back; no cascading over-allocation is possible.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1244-1271` (sequential loop with swallowed errors)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:238-284` (canonical RPC with FOR UPDATE + transaction)
- **Lines:** 1244-1271 (fallback loop); migration 0040:238-284 (canonical FOR UPDATE)
- **Category:** BUSINESS
- **Severity:** Medium
- **End-to-end trace:**
  Desktop payment-detail-drawer:73 → `repos.payments.markCleared(...)` → `SupabasePaymentRepository.markCleared:1181` → `client.rpc("mark_payment_cleared", ...)` → if `rpcErr`: `markClearedFallback` (line 1196):
    - Line 1218-1223: fetch payment row.
    - Line 1225-1226: check status is "pending".
    - Line 1229-1232: update payment status to "paid".
    - Line 1235-1240: fetch parent's installments with `amount_pending > 0`, ordered by `due_date ASC`.
    - Line 1242-1271: loop:
      - Line 1255: `moved = min(remaining, pending)`.
      - Line 1259-1268: update installment with `newPaid`, `newPending`, `newStatus`.
      - Line 1269: `if (uErr) console.warn(...)`.
      - Line 1270: `remaining -= moved` — UNCONDITIONALLY decremented, even if the update failed.
- **Intended responsibility:** When an installment update fails, the loop should ABORT and the entire operation should fail (or roll back). The `remaining` budget should only decrement for successfully-updated installments.
- **Actual responsibility:** Failed updates are logged and skipped; `remaining` is decremented as if they succeeded; subsequent installments get over-allocated.
- **Other implementations of same operation:** Canonical `mark_payment_cleared` SQL RPC (migration 0040:238-284):
```sql
FOR v_ins IN
  SELECT id, amount_due, amount_paid, amount_pending, category, status, paid_date
  FROM installments
  WHERE parent_id = v_payment.parent_id AND amount_pending > 0
    AND (v_payment.category IS NULL OR category = v_payment.category)
  ORDER BY due_date ASC, id ASC
  FOR UPDATE  -- row lock
LOOP
  EXIT WHEN v_remaining <= 0;
  -- ... compute new amounts ...
  UPDATE installments SET ... WHERE id = v_ins.id;  -- within transaction
  INSERT INTO audit_logs (...);  -- per-installment audit
END LOOP;
```
- **Behavioral differences:** Canonical: atomic, all-or-nothing. Fallback: best-effort, cascading over-allocation on partial failure.
- **Callers/consumers:** `payment-detail-drawer.tsx:73` (handleMarkCleared) is the only production caller.
- **Confidence:** Confirmed
- **Git evidence:** supabase-shared-repositories.ts: `84dd13f okay`.
- **Likely root cause:** The fallback was written as a sequential async loop (TypeScript `for...of await`) without wrapping in a Supabase transaction (`db.tx()` API). Row-level error handling was added as a defensive afterthought (`if (uErr) console.warn`) without considering the cascading effect on `remaining`.
- **Potential impact:** On deployments without migration 0039/0040, bank clearances can over-allocate cleared funds to installments if any installment update fails transiently. A 5000 DZD clearance might mark a 3000 DZD tranche as fully paid (instead of partial) because an earlier installment's update failed and `remaining` wasn't reduced.
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:1244-1271 — sequential loop with swallowed errors
for (const raw of (insRows ?? []) as {...}[]) {
  if (remaining <= 0) break;
  const pending = Number(raw.amount_pending ?? 0);
  if (pending <= 0) continue;
  if (payment.category !== "other" && raw.category && raw.category !== payment.category) continue;
  const moved = Math.min(remaining, pending);
  // ... compute new amounts ...
  const { error: uErr } = await this.client
    .from("installments")
    .update({ amount_paid: newPaid, amount_pending: newPending, status: newStatus, ... })
    .eq("id", raw.id);
  if (uErr) console.warn("[SupabasePayment] clearance installment update failed:", uErr.message);
  // <-- NO `continue` or `throw` here — proceeds to decrement remaining
  remaining -= moved;  // <-- UNCONDITIONAL decrement even on failure
}
// Canonical RPC (migration 0040): FOR UPDATE row locks + single transaction
// → any installment update failure rolls back the whole clearance.
```

### FINDING CROSS-104b — Desktop defaultPushHandler persists `sync_queue` row in Supabase for audit trail; Android SyncQueueDispatcher does not

- **What:** The desktop's `defaultPushHandler` (sync-provider.tsx:92-103) upserts a row into the Supabase `sync_queue` table for every pushed entry — providing a server-side audit trail of sync attempts. The Android's `SyncQueueDispatcher.pushEntry` (lines 52-98) calls `pushPayment`/`pushParent`/etc directly — no `sync_queue` row persisted server-side. The Android's only audit trail is in local Room (`SyncQueueEntity`) and the local `audit_logs` table (which is never synced, per SyncQueueDispatcher line 90-93).
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/app/providers/sync-provider.tsx:92-103` (desktop persists sync_queue row)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:52-98` (Android does not persist sync_queue row)
- **Lines:** sync-provider.tsx:92-103 (upsert into sync_queue); SyncQueueDispatcher.kt:52-98 (no upsert)
- **Category:** CROSS
- **Severity:** Medium
- **End-to-end trace:**
  Desktop: `defaultPushHandler:83` → line 92: `client.from("sync_queue").upsert({ id, entity, operation, tenant_id, actor_id, payload, source_file, import_run_id, queued_at, status: "pending" })` → line 104: `if (queueErr) throw queueErr` → then proceeds to push entity-specific RPC.
  Android: `SyncQueueDispatcher.pushEntry:52` → branch on `entry.entity` → call `pushPayment`/`pushParent`/etc → return. NO server-side sync_queue row.
- **Intended responsibility:** Both platforms should leave a server-side audit trail of sync attempts (who pushed what, when, with what payload, success/failure).
- **Actual responsibility:** Desktop leaves a sync_queue row server-side. Android leaves no server-side trace of its sync attempts — only local Room records (which are wiped on app reinstall).
- **Other implementations of same operation:** Desktop's path. Android's missing.
- **Behavioral differences:** Auditing the server's `sync_queue` table shows desktop's sync history but not Android's. An admin investigating "how did this payment get here" can trace desktop imports but not Android syncs.
- **Callers/consumers:** Server-side `sync_queue` table (migration 0027 creates it). Used for audit trail by admins.
- **Confidence:** Confirmed
- **Git evidence:** sync-provider.tsx: `84dd13f okay`. SyncQueueDispatcher.kt: `94471e8 2026-08-28`.
- **Likely root cause:** The desktop's sync was built around the `sync_queue` table as the audit trail (per migration 0027's design). The Android's sync was built around local Room + WorkManager — the server-side sync_queue table was considered desktop-specific and not adopted.
- **Potential impact:** Android sync attempts are invisible to server-side audits. If Android pushes a corrupted payment (e.g., wrong tenant_id), the server admin sees only the resulting `payments` row — no record of the sync attempt, the actor, or the original payload.
- **Code snippet:**
```typescript
// sync-provider.tsx:92-103 — desktop persists server-side audit row
const { error: queueErr } = await client.from("sync_queue").upsert({
  id: entry.id,
  entity: entry.entity,
  operation: entry.operation,
  tenant_id: entry.tenantId,
  actor_id: entry.actorId,
  payload: p,
  source_file: entry.sourceFile ?? null,
  import_run_id: entry.importRunId ?? null,
  queued_at: entry.queuedAt,
  status: "pending",
});
if (queueErr) throw queueErr;

// SyncQueueDispatcher.kt:52-98 — Android does NOT persist server-side
suspend fun pushEntry(entry: SyncQueueEntity) {
  if (entry.isMock) return
  if (!NetworkTimeouts.isSupabaseConfigured) return
  val payload = ...
  val actorId = sessionManager.currentUserId() ?: entry.actorId
  when (entry.entity) {
    "parent" -> pushParent(entry, payload, actorId)  // <-- no sync_queue upsert
    "payment" -> pushPayment(entry, payload, actorId)
    ...
  }
}
```

### FINDING BUSINESS-105 — Desktop's `collect()` fallback generates client-side `PAY-YYYY-random` receipt number; canonical RPC generates server-side `REC-YYYY-sequential`

- **What:** When the canonical `collect_and_allocate_payment` RPC succeeds, the server generates a sequential receipt number `REC-YYYY-NNNNNN` (migration 0040:69-72 — `MAX(SUBSTRING(receipt_number FROM '\d{6}$')) + 1` filtered by tenant+year, zero-padded 6 digits). When the canonical RPC fails and the desktop falls back to `upsert_payment_from_import`, the desktop generates a client-side receipt number `PAY-YYYY-${Math.floor(Math.random() * 1_000_000) + 1}` (line 1054) — RANDOM, no sequence guarantee, collision-prone across two concurrent desktop clients. The `sync_payments_receipt_number` trigger (migration 0027:144-159) then copies `payment_number` → `receipt_number`. So the same desktop, on the same day, can produce receipt numbers in two completely different formats depending on which RPC path was taken. Auditors cannot reconcile. Sequential receipt numbers are the canonical invariant (per migration 0040 comment); the fallback breaks it.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1053-1054` (client-side PAY- generation)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0040_cross_platform_rpc_unification.sql:69-72` (server-side REC- generation)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:144-159` (sync_payments_receipt_number trigger)
- **Lines:** 1053-1054 (client-side generation); migration 0040:69-72 (server-side); migration 0027:144-159 (trigger)
- **Category:** BUSINESS
- **Severity:** Medium
- **End-to-end trace:**
  Desktop canonical path: `SupabasePaymentRepository.collect:1081` → `client.rpc("collect_and_allocate_payment", { ... no p_payment_number ... })` → SQL RPC generates `REC-2026-000123` server-side → sets both `payment_number` and `receipt_number` to `REC-2026-000123` → trigger syncs (no-op since they're equal).
  Desktop fallback path: `SupabasePaymentRepository.collect:1053-1054` → `paymentNumber = input.receiptNumber ?? \`PAY-${year}-${Math.floor(Math.random() * 1_000_000) + 1}.padStart(6, "0")\`` → e.g. `PAY-2026-000842` → `client.rpc("upsert_payment_from_import", { p_payment_number: paymentNumber, ... })` → INSERT into payments with payment_number=`PAY-2026-000842`, receipt_number=NULL → trigger fires → sets receipt_number=`PAY-2026-000842`.
  Two desktop clients, both fallback path: client A generates `PAY-2026-000842`, client B generates `PAY-2026-000842` (collision probability: 1/1,000,000 per pair) → second client's INSERT fails on `unique(tenant_id, payment_number)` → fallback throws → `SupabasePaymentRepository.collect` returns Err.
- **Intended responsibility:** Receipt numbers should be server-authoritative, sequential per tenant+year, zero-padded, monotonically increasing. Auditors should be able to verify that `REC-2026-000123` was the 123rd receipt of 2026.
- **Actual responsibility:** Receipt numbers are server-authoritative on the canonical path; client-random on the fallback path. Auditors cannot tell from a receipt number whether it was canonically or fallback-generated.
- **Other implementations of same operation:**
  - Android `LocalPaymentRepository.collect():948-950` — generates `REC-$year-${(paymentDao.listAll().size + 1).padStart(6, '0')}` — sequential per device, collision-prone across devices (BUSINESS-006).
  - Canonical SQL RPC `collect_and_allocate_payment` (migration 0040:69-72) — sequential per tenant+year, server-authoritative. ✅
- **Behavioral differences:**
  - Canonical path: receipt_number = `REC-2026-000123` (sequential, deterministic, auditable).
  - Desktop fallback path: receipt_number = `PAY-2026-000842` (random, non-sequential, collision-prone).
  - Android path: receipt_number = `REC-2026-000007` (per-device sequential, collision-prone across devices).
- **Callers/consumers:** The receipt_number column is consumed by:
  - Desktop's `ReceiptsTab` (renders receipt_number as the filename for the PDF download).
  - Website's `useReceiptsForPayment` (broken — see CROSS-101).
  - SQL RPC `revert_payment_allocation` (reads `v_payment.receipt_number` for the audit log note).
  - The `sync_payments_receipt_number` trigger copies payment_number → receipt_number.
- **Confidence:** Confirmed
- **Git evidence:** supabase-shared-repositories.ts: `84dd13f okay`.
- **Likely root cause:** The fallback was added before the canonical RPC existed (when `upsert_payment_from_import` was the only path). At that time, the desktop generated its own receipt numbers client-side. When the canonical RPC was added (migration 0026 → 0034 → 0040), the canonical path switched to server-side generation, but the fallback's client-side generation was never updated to call a server-side sequence generator.
- **Potential impact:** Auditors cannot match receipt numbers to collection order. Two desktop clients collecting concurrently via the fallback path can collide (1/1,000,000 probability per pair, but with daily volume it's a "1-in-a-million but happens every week" scenario). The collision causes the second client's collect to fail with a unique-constraint error — the user sees a generic "Erreur" toast and must retry.
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:1053-1054 — client-side random receipt number
const paymentNumber = input.receiptNumber
  ?? `PAY-${year}-${String(Math.floor(Math.random() * 1_000_000) + 1).padStart(6, "0")}`;
// ^^ PAY- prefix (not REC-), random sequence (not sequential)

// migration 0040:69-72 — canonical server-side sequential receipt number
SELECT COALESCE(MAX(CAST(SUBSTRING(pay.receipt_number FROM '\d{6}$') AS INT)), 0) + 1 INTO v_seq
FROM payments pay
WHERE pay.tenant_id = p_tenant_id AND pay.receipt_number LIKE 'REC-' || v_year || '-%';
v_receipt := 'REC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');
-- ^^ REC- prefix, MAX+1 sequence per tenant+year

// migration 0027:144-159 — trigger syncs payment_number → receipt_number
CREATE OR REPLACE FUNCTION public.sync_payments_receipt_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.payment_number IS NOT NULL AND (NEW.receipt_number IS NULL OR NEW.receipt_number <> NEW.payment_number) THEN
    NEW.receipt_number := NEW.payment_number;
  END IF;
  RETURN NEW;
END;
$$;
```

### FINDING WEAK-200 — `enforce_payment_proof` trigger runs on EVERY payment INSERT/UPDATE; Android refund sync triggers re-validation of unchanged proof fields

- **What:** Migration 0007 (lines 142-171) declares the `enforce_payment_proof` trigger as `BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW`. The trigger function checks: if method=check → proof_path, check_number, check_bank_name must be non-null; if method=transfer → proof_path, transfer_reference must be non-null. When Android's refund sync pushes a payment status update via `upsert_payment_from_import` (migration 0027:644-667), the UPDATE branch sets `status`, `parent_id`, `student_id`, `installment_id`, `amount`, `method`, `category`, `proof_path`, `collected_at`, `collected_by`, `notes`, etc. The trigger fires on this UPDATE and re-validates the proof requirements. If the existing payment's `proof_path` was somehow NULL (e.g., it was inserted by an older code path that didn't enforce proof), the UPDATE will FAIL with "Proof upload is mandatory for check payments". The Android sync dispatcher swallows the error (CROSS-200) → entry marked "synced" → refund never actually persisted server-side.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0007_financial.sql:142-171` (trigger definition)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:644-667` (UPDATE branch of upsert_payment_from_import)
- **Lines:** migration 0007:142-171 (trigger); migration 0027:644-667 (UPDATE sets proof_path = COALESCE(p_proof_path, proof_path))
- **Category:** WEAK
- **Severity:** Medium
- **End-to-end trace:**
  Android refund: `LocalPaymentRepository.refund:1099` → sync enqueue with payload `{ id, status: "refunded", receiptNumber, updatedAt }` — NO proof_path, NO check_number.
  `SyncQueueDispatcher.pushPayment:207-236` builds params: `put("p_proof_path", p.str("proofUrl") ?: p.str("proof_path"))` → both keys missing → null.
  `upsert_payment_from_import` UPDATE branch: `proof_path = COALESCE(p_proof_path, proof_path)` → keeps existing proof_path (non-null for valid check/transfer payments).
  Trigger fires: `NEW.proof_path` is non-null → check passes (no exception).
  But: if the existing payment row had `proof_path = NULL` (legacy data, or inserted via a path that didn't enforce proof — e.g., direct SQL INSERT by an admin), the UPDATE keeps it NULL → trigger raises exception → RPC fails → SyncQueueDispatcher.pushPayment doesn't check the error → marks as synced → refund not persisted.
- **Intended responsibility:** The trigger should validate proof on INSERT only (when the payment is first created) and skip re-validation on UPDATE unless `method` is being changed.
- **Actual responsibility:** The trigger re-validates proof on EVERY UPDATE — including status-only updates (refund status flip) that have nothing to do with proof.
- **Other implementations of same operation:** None — the trigger is the only proof enforcement.
- **Behavioral differences:** INSERT path: trigger validates proof (correct). UPDATE path: trigger re-validates proof even when proof fields aren't being changed (over-zealous).
- **Callers/consumers:** Any UPDATE on `payments` triggers this — including `upsert_payment_from_import` UPDATE branch (Android sync, desktop sync) and direct updates from `markClearedFallback`, `markBouncedFallback`.
- **Confidence:** Likely (the trigger DOES fire on UPDATE per its declaration; the failure mode requires a pre-existing row with NULL proof_path, which shouldn't happen for valid check/transfer payments but CAN happen for legacy/corrupted data).
- **Git evidence:** migration 0007: initial schema.
- **Likely root cause:** The trigger was written to enforce proof at the database level (good defense in depth) but the `BEFORE INSERT OR UPDATE` clause was copy-pasted without considering that UPDATEs may be partial (status-only).
- **Potential impact:** Legacy payments with NULL proof_path cannot be refunded via the Android sync path — the status update silently fails. The desktop's `markCleared`/`markBounced` fallbacks also touch the payment row and would fail similarly if the RPC is unavailable.
- **Code snippet:**
```sql
-- migration 0007:169-171 — trigger fires on EVERY INSERT OR UPDATE
create trigger payments_enforce_proof
    before insert or update on public.payments
    for each row execute function public.enforce_payment_proof();

-- migration 0007:142-167 — trigger function
create or replace function public.enforce_payment_proof()
returns trigger language plpgsql security definer as $$
begin
    if new.method in ('check', 'transfer') and new.proof_path is null then
        raise exception 'Proof upload is mandatory for % payments (plan §13.05)', new.method;
    end if;
    if new.method = 'check' and (new.check_number is null or new.check_bank_name is null) then
        raise exception 'Check number and bank name are required for check payments';
    end if;
    -- ...
    return new;
end;
$$;
-- On a refund status update via upsert_payment_from_import UPDATE branch:
--   proof_path = COALESCE(p_proof_path, proof_path)  -- keeps existing value
-- Trigger fires, re-validates — passes IF existing proof_path is non-null.
```

### FINDING DRIFT-011 — Receipt-number generation logic is duplicated across 5 code paths with 5 different algorithms

- **What:** The receipt number for a payment is generated by 5 different code paths with 5 different algorithms:
  1. Canonical SQL RPC `collect_and_allocate_payment` (migration 0040:69-72): `REC-YYYY-NNNNNN` where NNNNNN = `MAX(SUBSTRING(receipt_number FROM '\d{6}$')) + 1` filtered by `tenant_id` and `LIKE 'REC-YYYY-%'`. Sequential, server-authoritative.
  2. Desktop `SupabasePaymentRepository.collect()` fallback (line 1053-1054): `PAY-YYYY-NNNNNN` where NNNNNN = `Math.floor(Math.random() * 1_000_000) + 1`. Random, client-side, collision-prone.
  3. Desktop `SupabasePaymentRepository.bulkCollect()` (line 1326): `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`. Timestamped random, client-side.
  4. Android `LocalPaymentRepository.collect()` (line 948-950): `REC-YYYY-NNNNNN` where NNNNNN = `paymentDao.listAll().size + 1`. Per-device sequential, collision-prone across devices.
  5. Android `SyncQueueDispatcher.generatePaymentNumber()` (line 406-410, fallback when payload lacks receiptNumber): `PAY-YYYY-NNNNNN` where NNNNNN = `(1..1_000_000).random()`. Random, collision-prone.
  6. Desktop's `defaultPushHandler` (sync-provider.tsx:169): `PAY-YYYY-NNNNNN` where NNNNNN = `Math.floor(Math.random() * 1_000_000).padStart(6, "0")`. Random, collision-prone.
  This is 6 paths (counting the EF collect-payment which is dead — DEAD-016 — but would have used the canonical RPC's receipt). The canonical invariant (sequential per tenant+year) is enforced only on path 1. The other 5 paths violate it.
- **Where:**
  - Migration 0040:69-72 (canonical)
  - supabase-shared-repositories.ts:1053-1054 (desktop fallback)
  - supabase-shared-repositories.ts:1326 (desktop bulkCollect)
  - LocalRepositories.kt:948-950 (Android collect)
  - SyncQueueDispatcher.kt:406-410 (Android sync fallback)
  - sync-provider.tsx:169 (desktop sync fallback)
- **Lines:** See above.
- **Category:** DRIFT
- **Severity:** Medium
- **End-to-end trace:** Each path generates a different receipt number for what should be the same logical operation. The DB's `unique(tenant_id, receipt_number)` constraint catches collisions only when both paths produce the EXACT same string (e.g., two Android devices both generate `REC-2026-000007` — second INSERT fails). Cross-path collisions (canonical `REC-2026-000123` vs. desktop fallback `PAY-2026-000842`) don't collide on the column value but confuse auditors.
- **Intended responsibility:** A single canonical algorithm (path 1) should generate all receipt numbers, server-side, atomically within the canonical RPC.
- **Actual responsibility:** 5 different algorithms, 4 client-side, only 1 sequential.
- **Other implementations of same operation:** See above — 6 paths.
- **Behavioral differences:** See above.
- **Callers/consumers:** The `receipt_number` column is consumed by the receipts-tab.tsx PDF download (filename), the website's `useReceiptsForPayment` (broken — CROSS-101), the audit_logs note field, and the `sync_payments_receipt_number` trigger.
- **Confidence:** Confirmed
- **Git evidence:** All six code paths have been touched in different commits over the past 3 weeks (`eeb82db 2026-08-21`, `84dd13f okay`, `94471e8 2026-08-28`).
- **Likely root cause:** Each path was added at a different time, by different authors, with different assumptions about whether the server or client should generate the receipt number. The canonical RPC was the LAST to be added (migration 0040) — by then, the 5 client-side paths were already in production and weren't refactored to delegate to it.
- **Potential impact:** Receipt numbers are non-deterministic, non-sequential, and format-inconsistent. Auditors cannot reconstruct the order of payments from receipt numbers. Tax/finance reporting that requires sequential receipt numbers (common in DZ tax law) fails compliance. Collisions cause payment-collection failures (user sees "Erreur" toast, retries, possibly double-charges the parent).
- **Code snippet:**
```typescript
// Path 1 (canonical SQL, migration 0040:69-72):
v_receipt := 'REC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');  // REC-2026-000123

// Path 2 (desktop fallback, supabase-shared-repositories.ts:1054):
`PAY-${year}-${String(Math.floor(Math.random() * 1_000_000) + 1).padStart(6, "0")}`  // PAY-2026-000842

// Path 3 (desktop bulkCollect, line 1326):
`PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`  // PAY-1740000000000-x7k2m9

// Path 4 (Android LocalPaymentRepository.collect, LocalRepositories.kt:949-950):
"REC-$year-${(paymentDao.listAll().size + 1).toString().padStart(6, '0')}"  // REC-2026-000007

// Path 5 (Android SyncQueueDispatcher.generatePaymentNumber, line 407-409):
"PAY-$year-${(1..1_000_000).random().toString().padStart(6, '0')}"  // PAY-2026-000483

// Path 6 (desktop defaultPushHandler, sync-provider.tsx:169):
`PAY-${new Date().getFullYear()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`  // PAY-2026-000291

// 6 paths, 3 formats (REC-YYYY-NNNNNN, PAY-YYYY-NNNNNN, PAY-<epoch>-<base36>),
// 3 algorithms (server-sequential, client-random, client-listAll-size+1).
```

### FINDING SEC-101 — `revert_payment_allocation` SQL RPC has no tenant_id verification; cross-tenant refund possible

- **What:** The canonical `revert_payment_allocation` SQL RPC (migration 0041:460-643) takes `p_tenant_id` as a parameter and uses it for the audit_log INSERT (line 626: `gen_random_uuid(), p_tenant_id, ...`). However, the payment lookup at line 489 is `SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE` — NO `tenant_id` filter. So a caller from tenant A can pass `p_payment_id` = a payment ID from tenant B, and the RPC will refund it — writing the audit log entry under tenant A (the caller's tenant). The EF `refund-payment` (line 77-86) DOES verify tenant scope (`eq("tenant_id", ctx.tenantId)`) — but the EF is never called (DEAD-016). The desktop's `SupabasePaymentRepository.refund()` (line 1151) calls the RPC directly with `p_tenant_id = getTenantId()` — but if `getTenantId()` returns the wrong value (e.g., a stale session, a config bug like DRIFT-003), the RPC will use the wrong tenant_id for the audit log while refunding a payment from any tenant.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:489` (payment lookup without tenant filter)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:626` (audit_log uses p_tenant_id, not the payment's actual tenant_id)
- **Lines:** migration 0041:489 (SELECT payment), 626 (audit_log INSERT)
- **Category:** SEC
- **Severity:** High
- **End-to-end trace:**
  Desktop: `SupabasePaymentRepository.refund:1151` → `client.rpc("revert_payment_allocation", { p_tenant_id: getTenantId(), p_payment_id: id, ... })` → SQL RPC line 489: `SELECT * FROM payments WHERE id = p_payment_id FOR UPDATE` (no tenant filter) → finds the payment regardless of tenant → line 498: updates payment status to 'refunded' → line 626: inserts audit_log with `p_tenant_id` (caller's tenant, NOT the payment's tenant).
- **Intended responsibility:** The RPC should verify that the payment being refunded belongs to the caller's tenant. Cross-tenant refunds should be blocked.
- **Actual responsibility:** The RPC trusts the caller's `p_tenant_id` for the audit log but doesn't verify it matches the payment's actual `tenant_id`. Cross-tenant refund is possible if the caller knows a payment_id from another tenant.
- **Other implementations of same operation:**
  - EF `refund-payment` (line 77-86): `supabase.from("payments").select("id, tenant_id, ...").eq("id", body.payment_id).eq("tenant_id", ctx.tenantId).single()` — verifies tenant scope. (But EF is never called.)
  - `mark_payment_cleared` (migration 0040:223-225): `SELECT * FROM payments WHERE id = p_payment_id AND tenant_id = p_tenant_id` — verifies tenant scope. ✅
  - `mark_payment_bounced` (migration 0040:336-338): same. ✅
- **Behavioral differences:** `mark_payment_cleared` and `mark_payment_bounced` both filter by tenant_id; `revert_payment_allocation` does NOT. Inconsistent.
- **Callers/consumers:**
  - Desktop `SupabasePaymentRepository.refund:1151` (dead — DEAD-015, but the code is there).
  - EF `refund-payment:100` (dead — DEAD-016).
- **Confidence:** Confirmed (the SQL is unambiguous).
- **Git evidence:** migration 0041 commit `eeb82db 2026-08-21 right`.
- **Likely root cause:** The `revert_payment_allocation` function was first written in migration 0026 (line 298) without a tenant filter. Migration 0034 rewrote it (canonical). Migration 0041 fixed a uuid cast bug but kept the same body. The tenant filter was never added — unlike `mark_payment_cleared`/`mark_payment_bounced` which were added in 0040 with the tenant filter from the start.
- **Potential impact:** A caller (desktop user with a hijacked JWT, or any client with the anon key) can refund payments from ANY tenant by passing the payment_id. The audit log entry is attributed to the caller's tenant, hiding the cross-tenant attack. Financial sabotage: an attacker refunds legitimate payments in tenant B from a compromised tenant A account.
- **Code snippet:**
```sql
-- migration 0041:489 — payment lookup, NO tenant filter
SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
IF NOT FOUND THEN
  RAISE EXCEPTION 'Payment % not found', p_payment_id;
END IF;
IF v_payment.status NOT IN ('paid', 'pending') THEN
  RAISE EXCEPTION 'Payment % is already % (cannot revert)', p_payment_id, v_payment.status;
END IF;
-- NO check that v_payment.tenant_id = p_tenant_id

-- Compare mark_payment_cleared (migration 0040:223-225) — DOES filter:
SELECT * INTO v_payment
FROM payments
WHERE id = p_payment_id AND tenant_id = p_tenant_id;  -- ✅ tenant filter

-- migration 0041:626 — audit log uses caller's p_tenant_id, not payment's tenant_id
INSERT INTO audit_logs (..., tenant_id, ..., entity_id, ...)
VALUES (gen_random_uuid(), p_tenant_id, ..., p_payment_id, ...);
-- If p_tenant_id ≠ v_payment.tenant_id, audit log is misattributed.
```

### FINDING CROSS-105 — Desktop's `collect()` fallback (upsert_payment_from_import) writes to `payments` only; the corresponding ledger entry creation is silently skipped (extends BUSINESS-103)

- **What:** This is the consumer-side trace of BUSINESS-103. When the desktop's canonical `collect_and_allocate_payment` RPC is unavailable and `SupabasePaymentRepository.collect()` falls back to `upsert_payment_from_import` (lines 1092-1118), the desktop UI shows the payment as collected. However, the canonical `compute_parent_summary` SQL RPC (migration 0041:662+) and the desktop's `computeParentSummary` (calc/ledger/balance.ts) both compute the parent's balance by replaying `ledger_entries`. The fallback didn't write a ledger entry. So the parent's balance shows the OLD value (before this payment). The desktop's `UnifiedPaymentModal` then calls `repos.payments.generateReceipt(result.value.id, session.userId)` which fetches the payment row (succeeds) and returns Ok. The user sees a success toast, the receipt PDF is generated, and they move on. But the parent's outstanding balance is unchanged. The next time the user views the parent's record (e.g., in the parent-detail-drawer), the balance is wrong.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/financials/unified-payment-modal.tsx:414-424` (success toast — shows "Paiement encaissé" even when ledger was skipped)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1086-1118` (fallback)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/domain/calc/ledger/balance.ts` (computes balance from ledger_entries)
- **Lines:** unified-payment-modal.tsx:414-424 (success toast regardless of canonical-vs-fallback path)
- **Category:** CROSS
- **Severity:** High (this is the user-facing impact of BUSINESS-103)
- **End-to-end trace:**
  User clicks "Encaisser" → `UnifiedPaymentModal.submit:387` calls `repos.payments.collect(input, session.userId)`:
  - If canonical RPC succeeds: ledger + waterfall + audit all written → balance updates → UI toast "Paiement encaissé" → parent's balance shown correctly.
  - If canonical RPC fails → fallback → ONLY payment row written → UI toast STILL "Paiement encaissé" (because `result.ok === true`) → parent's balance shows OLD value.
  User sees identical toast in both cases. Cannot tell that the fallback path was taken (which silently broke the ledger invariant).
- **Intended responsibility:** The UI should warn the user when the canonical RPC is unavailable and the fallback is taken — so they know the ledger may need manual reconciliation.
- **Actual responsibility:** The UI shows identical success messaging for both paths. The user has no signal that anything went wrong.
- **Other implementations of same operation:** N/A — this is the unique divergence between the canonical path's side effects and the fallback path's side effects.
- **Behavioral differences:** See above.
- **Callers/consumers:** `UnifiedPaymentModal.submit` is the only production caller. The success path also calls `onPaymentCollected?.(result.value)` (line 443) — the parent list refresh hook — which refetches the parent's data, but the parent's balance (computed from the ledger) is still wrong.
- **Confidence:** Confirmed
- **Git evidence:** unified-payment-modal.tsx: `84dd13f okay`; supabase-shared-repositories.ts: `84dd13f okay`.
- **Likely root cause:** The `collect()` method returns `Ok(payment)` for both the canonical and fallback paths. The unified-payment-modal doesn't differentiate. The console.warn at line 1088-1090 (which would tell a developer the fallback was taken) goes to the browser console — invisible to the user.
- **Potential impact:** Silent financial data corruption with a green "success" toast. The user trusts the system, moves on, and only discovers the balance is wrong at end-of-day reconciliation (or worse, when the parent is incorrectly dunned for non-payment).
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:1086-1118 — fallback path returns Ok (no signal to caller)
if (atomicErr) {
  console.warn("[SupabasePayment] collect_and_allocate_payment failed, falling back to upsert_payment_from_import:", atomicErr.message);
  // ^^ goes to browser console, NOT to the user
  const { data: fallbackData, error: fallbackErr } = await this.client.rpc("upsert_payment_from_import", {...});
  if (fallbackErr) throw fallbackErr;
  // ... extracts payment_id from fallbackData ...
  paymentId = fallbackRow.out_payment_id;
} else {
  // canonical path — also returns payment_id
  paymentId = atomicRow.payment_id;
}
// Both paths fall through to:
const payment = mapPaymentRow(fullRow as PaymentRow);
this.cache.update((list) => [payment, ...list.filter((p) => p.id !== payment.id)]);
return Ok(payment);  // <-- identical return shape; caller cannot tell which path ran

// unified-payment-modal.tsx:414-418 — shows success toast regardless
if (result.value.status === "paid") {
  toast.showSuccess(
    "Paiement encaissé",  // <-- identical success toast for both paths
    `${result.value.amount.toLocaleString("fr-FR")} DZD encaissés. Reçu ${result.value.receiptNumber}. Allocation waterfall appliquée.`,
    // ^^ "Allocation waterfall appliquée" — FALSE for fallback path (no waterfall ran)
  );
}
```

Stage Summary:
- 16 new findings total (DEAD-015, DEAD-016, CROSS-200, CROSS-101, CROSS-102, CROSS-103, CROSS-104, CROSS-104b, CROSS-105, BUSINESS-100, BUSINESS-101, BUSINESS-102, BUSINESS-103, BUSINESS-104, BUSINESS-105, WEAK-200, DRIFT-011, SEC-100, SEC-101)
  - Note: IDs renumbered to CROSS-200 / WEAK-200 to avoid collision with concurrent Agent B's CROSS-100 / WEAK-100 (demo accounts + activation codes findings).
- Severity breakdown:
  - Critical: 6 (DEAD-015, DEAD-016, CROSS-200, CROSS-101, BUSINESS-100, BUSINESS-103)
  - High: 7 (BUSINESS-101, BUSINESS-102, CROSS-102, CROSS-103, CROSS-104, SEC-100, SEC-101, CROSS-105)
  - Medium: 4 (BUSINESS-104, CROSS-104b, BUSINESS-105, WEAK-200, DRIFT-011)
- Top 5 critical new findings:
  1. **DEAD-015**: Desktop refund flow is completely dead UI — `SupabasePaymentRepository.refund()` is never called from any production component; staff cannot refund via desktop.
  2. **DEAD-016**: `collect-payment` and `refund-payment` Edge Functions are NEVER invoked by any client — 200+ lines of dead auth/validation/audit code; all security checks bypassed.
  3. **CROSS-200**: Android sync dispatcher swallows RPC errors silently — server-rejected writes (FK violations, trigger failures, RLS denials) are marked "synced"; data loss.
  4. **BUSINESS-100**: `bulkCollect` silently drops failed chunks; Excel importer reports success even when payments are dropped.
  5. **CROSS-101**: `receipts` table is orphaned; website's receipt download is permanently broken (queries empty table while desktop generates PDFs client-side).
  6. **BUSINESS-103**: Desktop's `collect()` fallback to `upsert_payment_from_import` skips ledger entry + waterfall + audit log; UI shows identical "success" toast — silent financial data corruption.


---

Task ID: 3-C
Agent: forensic-auditor-C (Sync + Offline + Realtime + Cache Coherence end-to-end)
Task: Deep second-pass audit of sync/offline/realtime/cache flows across all 3 platforms

Work Log:
- Read full first-pass worklog (86 findings across DUP/DRIFT/DEAD/BUSINESS/REG/CROSS/WEAK/SEC/ARCH) to avoid duplication
- Read second-pass findings (3-A: DEAD-015/016, CROSS-200/101/102/103/104/104b/105, BUSINESS-100..105, WEAK-200, DRIFT-011, SEC-100/101; 3-B: SEC-100..110, CROSS-100, WEAK-100..101, DEAD-100) to avoid duplication
- Traced sync dispatcher end-to-end on Desktop (excel-import-modal → SyncService.enqueue/enqueueBatch → IndexedDB queue → drain → defaultPushHandler → upsert_*_from_import RPCs + sync_queue upsert + mark_sync_queue_processed)
- Traced sync dispatcher end-to-end on Android (Local*Repository → SyncSupport.tryThenEnqueue / enqueueOnly → Room SyncQueueEntity → SyncService.drainPending → SyncQueueDispatcher.pushEntry → 7 entity-specific push methods)
- Traced realtime subscriptions on Website (use-realtime.ts: 4 hooks — notifications, chat_messages, installments+payments, homework_assignments) — verified filters vs canonical schema columns
- Traced realtime subscriptions on Desktop (only Subject-based caches; ZERO Supabase realtime channels in production code) — same as CROSS-104 finding for payments
- Traced Android realtime subscriptions (ZERO channels — verified via grep for `channel(`, `realtime.channel`, `subscribe(` in app/src/main — 0 hits)
- Traced push token lifecycle on Android (ElImtiyazMessagingService.onNewToken → FcmTokenRegistrar.register → register_fcm_token RPC; ElImtiyazApplication.fetchAndRegisterFcmTokenOnStartup + observeSessionForFcmToken)
- Traced push token lifecycle on Website (fcm-registration.ts → register_fcm_token RPC + unregisterDeviceToken only for platform='web'; only called from profile-view.tsx togglePush)
- Verified RLS policies on chat_messages (0019:836-860 — update_own requires author_id = current_user_profile_id())
- Verified RLS policies on device_tokens (0027:1023-1049)
- Traced TanStack Query config (website providers/index.tsx: staleTime 30s, refetchOnWindowFocus false, retry 1)
- Verified migration 0037 explicitly states it adds upsert_installment_from_import RPC for Android; desktop defaultPushHandler was never updated to call it
- Identified 17 NEW findings (IDs SYNC-100..107, REALTIME-100..104, CACHE-100..103)

Findings:

### FINDING SYNC-100 — Desktop defaultPushHandler silently drops installment / homework / grade / attendance entity kinds

- **What:** The desktop's `defaultPushHandler` (sync-provider.tsx:107-213) only handles 4 entity kinds in its switch statement: `parent`, `student`, `payment`, `ledger_entry`. The `SyncEntityKind` union (sync-types.ts:11-26) declares 15 kinds: parent, student, payment, **installment**, expense, invoice, ledger_entry, personnel, **attendance**, **grade**, **homework**, audit_log, notification, calendar_event, other. The remaining 11 kinds all fall through to the `default:` branch (line 209-212) which is a NO-OP — the queue entry is marked as "synced" by SyncService.drain (sync-service.ts:357-364) WITHOUT any server-side upsert having happened. The desktop's Excel importer (excel-import-modal.tsx:260-281) DOES enqueue entries with `entity: "installment"` (the type assertion at line 261 explicitly includes "installment" as a possible kind) when running in mock mode. So installment sync entries from Excel imports are silently dropped — the local mock store has them, the server never gets them, and the queue reports them as "synced".
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/app/providers/sync-provider.tsx:107-213` (switch with only 4 cases; default is silent no-op)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/sync/sync-types.ts:11-26` (SyncEntityKind declares 15 kinds)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/crm/excel-import-modal.tsx:260-281` (enqueues "installment" entities in mock mode)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:69-98` (Android handles 7 entity kinds: parent/student/payment/ledger_entry/installment/homework/grade/attendance)
- **How reached:** UI: Settings → Excel Import → file selected → importer processes rows → in mock mode, `enqueueBatch` is called with entity kinds from the import engine, including `"installment"` (excel-import-modal.tsx:273) → SyncService stores entry in IndexedDB → 2s debounce → drain → `defaultPushHandler(entry)` → entry.entity === "installment" → switch hits `default` → no upsert → control falls through → `mark_sync_queue_processed(id, "synced")` → entry marked synced without server write.
- **Intended responsibility:** Per migration 0037 (line 15-18): *"NO INSTALLMENT PUSH — Android enqueues installment mutations but the SyncQueueDispatcher had no case for them (silent no-op). The server never learns Android-side waterfall results. Fix: new idempotent `upsert_installment_from_import` RPC."* The migration explicitly addresses the "silent no-op" anti-pattern — but only the Android dispatcher was updated. The desktop was never updated to call the new RPC.
- **Actual responsibility:** The desktop's defaultPushHandler silently drops any entry whose entity isn't one of the 4 explicitly-handled kinds. The desktop's `SyncEntityKind` type advertises 15 kinds; only 4 work. The 11 unhandled kinds silently lose data.
- **Dependents / consumers:** SyncService.drain (sync-service.ts:337-378) consumes the dispatcher's return value. Settings UI displays the synced/pending/failed counts. The server's `installments` table is the canonical source for the website's `useInstallments` hook + parent balance computation.
- **Alternative implementations of same operation:**
  - Android `SyncQueueDispatcher.pushInstallment` (line 295-324) properly calls `upsert_installment_from_import` RPC with centimes→DZD conversion. ✅
  - Canonical `upsert_installment_from_import` SQL RPC (migration 0037) is idempotent + tenant-scoped + handles text refs. ✅
  - Desktop's defaultPushHandler: silent no-op for "installment" entity. ❌
- **Behavioral differences:** Android: installment sync succeeds server-side. Desktop: installment sync silently dropped. Same logical operation, opposite outcomes. Plus: the desktop's Excel import path is the ONE place that enqueues installments (mock mode), so the bug fires specifically on the desktop — exactly the platform that doesn't handle it.
- **Git evidence:** sync-provider.tsx last touched `84dd13f okay` (2026-08-27). Migration 0037 introduced `eeb82db right` (2026-08-21) — the migration is OLDER than the latest sync-provider touch, so the dispatcher could have been updated but wasn't.
- **Likely root cause:** Migration 0037 was authored as part of the "TIER 4 cross-platform sync hardening" wave that focused on Android. The desktop's defaultPushHandler predates the migration and was never updated. The migration's header comment explicitly enumerates the Android-only fix scope ("Android enqueues installment mutations but the SyncQueueDispatcher had no case for them") without mentioning the desktop dispatcher's parallel gap.
- **Potential impact:** When a school imports parents/students/installments via Excel in mock mode (e.g., a fresh install without Supabase credentials, or a temp network outage during initial setup), the parent/student/payment/ledger_entry entries will sync when Supabase comes online — but every installment entry will be silently dropped. The server's installments table will be missing rows. The website's `useInstallments` hook will return the wrong remaining balance. Parents will be incorrectly dunned for non-payment because their installments show `amount_pending = full amount_due` while the desktop's local cache shows the installments as paid. Reconciliation reports will be wrong.
- **Code snippet:**
```typescript
// sync-provider.tsx:107-213 — only 4 entity kinds handled
switch (entry.entity) {
  case "parent":   { /* upsert_parent_from_import */ break; }
  case "student":  { /* upsert_student_from_import */ break; }
  case "payment":  { /* upsert_payment_from_import */ break; }
  case "ledger_entry": { /* upsert_ledger_entry_from_import */ break; }
  default:
    // Unknown entity kinds: just mark as synced without upserting. The
    // queue row from the upsert above is the audit trail.
    break;   // <-- "installment" / "homework" / "grade" / "attendance" land here
}
// Then unconditionally: client.rpc("mark_sync_queue_processed", { p_status: "synced" })

// SyncEntityKind (sync-types.ts:11-26) declares 15 kinds — 11 are unhandled.
// excel-import-modal.tsx:260-281 — the importer DOES enqueue "installment":
//   batchInputs.push({ entity: kind as "parent" | "student" | "ledger_entry" | "payment" | "installment", ... })

// Compare Android SyncQueueDispatcher.kt:69-98 — handles 7 kinds explicitly:
//   when (entry.entity) {
//     "parent" -> pushParent(...)
//     "student" -> pushStudent(...)
//     "payment" -> pushPayment(...)
//     "ledger_entry" -> pushLedgerEntry(...)
//     "installment" -> pushInstallment(...)   // <-- the desktop's missing case
//     "homework" -> pushHomework(...)
//     "grade" -> pushGrade(...)
//     "attendance" -> pushAttendance(...)
//     else -> { /* no-op — SyncService will mark as "synced" */ }
//   }
```
- **Confidence:** Confirmed

### FINDING SYNC-101 — Desktop defaultPushHandler overwrites sync_queue row status="pending" on every drain, clobbering audit history

- **What:** The desktop's `defaultPushHandler` (sync-provider.tsx:92-103) upserts a row into the server-side `sync_queue` table with `status: "pending"` BEFORE attempting the entity-specific RPC push. The upsert is keyed on the queue entry's `id` (primary key) and uses the default `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` semantics. On every drain attempt — including retries after a previous failure — this upsert OVERWRITES the row's `status` back to "pending" and zeroes out the previous `last_error` (it isn't sent in the upsert, so it gets set to NULL by the conflict-update if the column is nullable, or stays untouched if the upsert doesn't include the column — but the status field is definitely reset). The previous attempt's "failed" status + error message are lost from the server-side audit trail. Only the latest attempt's status survives.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/app/providers/sync-provider.tsx:92-104`
- **How reached:** SyncService.drain (sync-service.ts:337-378) iterates pending entries; for each, calls `this.opts.push(entry)` → `defaultPushHandler` → line 92 `client.from("sync_queue").upsert({ id: entry.id, ..., status: "pending" })` → server-side row INSERT or UPDATE → if previous drain had marked row as "failed" via `mark_sync_queue_processed(p_status: "failed", p_error: "FK violation...")`, that state is now overwritten to "pending" with no error → line 104 `if (queueErr) throw queueErr` → entity RPC push → success: `mark_sync_queue_processed(p_status: "synced")`; failure: catch block at 221-232 calls `mark_sync_queue_processed(p_status: "failed", p_error: msg)`.
- **Intended responsibility:** Per the function's header comment (sync-provider.tsx:78-82): *"Persist the queue row (audit trail — idempotent by primary key `id`)."* The intent is to leave a server-side audit trail of every sync attempt's outcome.
- **Actual responsibility:** The audit trail is incomplete — it captures only the LATEST attempt's status. The history of prior attempts (their timestamps, their error messages, the count of retries) is overwritten on every drain. An admin querying `SELECT * FROM sync_queue WHERE id = '...'` sees only the current state, not the full retry history.
- **Dependents / consumers:** Server-side `sync_queue` table (migration 0027:258-308 creates it; CROSS-104b finding documents that the desktop writes to it but Android does not). Settings sync UI displays counts of synced/pending/failed entries. Admins query the table for forensics ("how did this payment get here / why did it fail").
- **Alternative implementations of same operation:**
  - Android SyncQueueDispatcher: doesn't write to sync_queue server-side at all (per CROSS-104b). So Android has no server-side audit trail; desktop has an INCOMPLETE server-side audit trail.
  - Local IndexedDB store (desktop): the SyncQueueEntity has `attempts` (incremented on failure) + `lastError` (preserved across drains) + `lastAttemptAt`. The local store DOES preserve history. But it's per-device, not queryable by admins.
- **Behavioral differences:** First drain attempt: row inserted as "pending" → RPC fails → catch marks "failed" with error. Second drain attempt (after backoff): upsert overwrites row to "pending" (error lost) → RPC fails again → catch marks "failed" with new error. Server-side history shows only: "pending → failed (latest error)". Local history (IndexedDB) shows: "attempts=2, lastError=latest_error, lastAttemptAt=latest_timestamp".
- **Git evidence:** sync-provider.tsx last touched `84dd13f okay` (2026-08-27).
- **Likely root cause:** The upsert was written to ensure the queue row exists before the RPC push (idempotent audit trail). The developer didn't consider that re-draining the same entry would overwrite the previous "failed" state. A cleaner pattern would be to (a) only upsert the queue row if it doesn't already exist, OR (b) upsert with `status: EXCLUDED.status` only when the new status is "synced"/"failed" — not when re-attempting as "pending".
- **Potential impact:** Admins investigating sync failures can't reconstruct the retry history from the server-side table. A persistently-failing entry (5 retries) shows only "failed" with the LAST error — not the sequence of errors that led there. Forensics on "why did this entry take 5 attempts" requires scraping local IndexedDB from the specific desktop, which may not be available.
- **Code snippet:**
```typescript
// sync-provider.tsx:92-104 — upsert OVERWRITES status on every drain
const { error: queueErr } = await client.from("sync_queue").upsert({
  id: entry.id,           // <-- primary key; ON CONFLICT (id) DO UPDATE
  entity: entry.entity,
  operation: entry.operation,
  tenant_id: entry.tenantId,
  actor_id: entry.actorId,
  payload: p,
  source_file: entry.sourceFile ?? null,
  import_run_id: entry.importRunId ?? null,
  queued_at: entry.queuedAt,
  status: "pending",       // <-- clobbers any prior "failed" status
});
if (queueErr) throw queueErr;
// ↑ After this, the previous "failed" + last_error from a prior drain
//   attempt has been replaced with "pending" + (implicit NULL error).
//   The catch block at line 221-232 then writes "failed" + new error
//   ONLY if the RPC push fails THIS attempt — overwriting again.
```
- **Confidence:** Confirmed

### FINDING SYNC-102 — Desktop sync queue persists across logout/login; user A's pending entries stuck as "failed" under user B's session

- **What:** The desktop's IndexedDB sync queue store (sync-queue-store.ts) is a process-level singleton (`getSyncQueueStore()` returns the singleton `_store`). The store is NEVER cleared on logout. When user A signs out and user B signs in on the same desktop, user A's pending queue entries remain in IndexedDB with their original `tenantId` (user A's tenant) and `actorId` (user A's id). On the next drain attempt (auto or manual), `defaultPushHandler` (sync-provider.tsx:92-104) calls `client.from("sync_queue").upsert({ id, ..., tenant_id: entry.tenantId, ... })` — but the active Supabase session now belongs to user B. The RLS policy on `sync_queue` (migration 0027:1005-1020) is `tenant_id = public.current_tenant_id()`. If user A and user B are in different tenants, the upsert's INSERT fails RLS — `queueErr` is non-null → throw → entry marked as failed. If they're in the SAME tenant, the upsert succeeds, but then the entity RPC (e.g. `upsert_payment_from_import`) runs with user B's session, potentially writing data attributed to user A's actor_id into user A's tenant — a confused audit trail.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/sync/sync-queue-store.ts:181-185` (singleton, never cleared on logout)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/app/providers/sync-provider.tsx:92-104` (upsert with stale entry.tenantId)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:1005-1020` (RLS requires tenant_id match)
- **How reached:** User A signs in → imports Excel → 1170 entries enqueued to IndexedDB → drain starts → some entries succeed (synced), some fail (5 retries → marked failed) → user A signs out → IndexedDB still holds the synced + failed entries → user B signs in (different tenant) → drain auto-fires (SyncService.schedulePoll + online-detector) → for each remaining pending/failed entry: upsert sync_queue with `tenant_id = user_A's_tenant` → RLS denies (user B's current_tenant_id ≠ user A's tenant) → queueErr → throw → entry marked failed again → user A's entries are stuck as "failed" forever under user B's session.
- **Intended responsibility:** A user's pending sync queue should be PER-USER — cleared on logout, or scoped so that only the original user's session can drain it.
- **Actual responsibility:** The queue is process-global. Once user A enqueues entries, they belong to the desktop process — not to user A's session. User B inherits them but can't push them (RLS).
- **Dependents / consumers:** SyncService.drain (sync-service.ts:337). The desktop's topbar SyncIndicator + Settings sync tab display pending/failed counts — these counts include user A's stuck entries under user B's session, confusing user B.
- **Alternative implementations of same operation:**
  - Android: SyncQueueDao is also a Room DAO — same persistence across logout. But Android devices are typically single-user (no account switching), so the bug doesn't manifest.
  - Website: no sync queue (server is source-of-truth).
- **Behavioral differences:** Same-tenant user switch: queue entries drain under user B's session with `actor_id = user_A` (audit trail confusion). Cross-tenant user switch: queue entries fail RLS on every drain → stuck as "failed" → user A must sign back in to drain them.
- **Git evidence:** sync-queue-store.ts last touched in initial commit batch; never had a "clear on logout" hook added. sync-provider.tsx: `84dd13f okay`.
- **Likely root cause:** The sync layer was designed for a single-user desktop (the typical case). Multi-user shared-desktop scenarios weren't considered. The SyncProvider's `useMemo` (sync-provider.tsx:242-252) constructs the SyncService ONCE and never re-initializes on session change — so the queue + tenantId/actorId callbacks keep their initial bindings (though sessionRef.current is updated, the queue itself is shared).
- **Potential impact:** Shared-desktop scenarios (school front-office, library kiosk): user A's stuck entries pile up in the failed list, confusing user B's Settings view. Worse: in same-tenant multi-user scenarios (e.g., two staff members sharing a desktop), user B's drain pushes user A's queued writes — with user A's `actor_id` stamped on them. Audit logs attribute user A's mutations to "user A pushed them under user B's session" — which is technically true but operationally confusing.
- **Code snippet:**
```typescript
// sync-queue-store.ts:181-185 — singleton, survives logout
let _store: IndexedDBQueueStore | null = null;
export function getSyncQueueStore(): IndexedDBQueueStore {
  if (!_store) _store = new IndexedDBQueueStore();  // <-- persists across sessions
  return _store;
}
// auth-provider's signOut never calls _store.clear() or any equivalent.

// sync-provider.tsx:242-252 — SyncService constructed once, never re-initialized on session change
const service = useMemo<SyncService>(() => {
  return initialiseSyncService({
    tenantId: () => sessionRef.current?.tenantId ?? "default",  // <-- sessionRef updates, but...
    actorId:  () => sessionRef.current?.userId ?? "system",
    ...
  });
}, []);  // <-- empty deps — service + its queue bindings are FROZEN at first mount

// sync-provider.tsx:92-104 — drain uses entry.tenantId (captured at enqueue), not current session
const { error: queueErr } = await client.from("sync_queue").upsert({
  id: entry.id,
  tenant_id: entry.tenantId,  // <-- stale user A's tenant; RLS denies under user B
  ...
});
```
- **Confidence:** Likely (the queue persistence + RLS denial logic is verified; the actual frequency of shared-desktop cross-tenant use is unknown but plausible for a school frontend).

### FINDING SYNC-103 — Android tryThenEnqueue only enqueues on network/offline/timeout errors; server 500s and validation errors lose the mutation

- **What:** Android's `SyncSupport.tryThenEnqueue` (SyncSupport.kt:165-198) wraps a mutation in a try/catch. On exception, it inspects the error code: only `CODE_NETWORK`, `CODE_OFFLINE`, and `CODE_TIMEOUT` trigger the enqueue path. All other error codes (including `CODE_SERVER` / 5xx HTTP responses, `CODE_VALIDATION` / 4xx, `CODE_UNAUTHORIZED` / 401, `CODE_FORBIDDEN` / 403, `CODE_NOT_FOUND` / 404) return the original `Result.Err(error)` WITHOUT enqueuing the operation for later retry. The comment at line 153-154 explicitly says *"For online errors (validation, server, etc.) the original error is returned without enqueuing."* — which is the wrong policy for 5xx errors, which are typically transient (server overload, restart, deployment in progress, DB failover).
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncSupport.kt:165-198`
- **How reached:** UI taps "Collect payment" → CounterPaymentScreen → LocalPaymentRepository.collect → calls `tryThenEnqueue(entity="payment", operation="create", payload=..., mutation = { supabaseProvider.postgrest.rpc("upsert_payment_from_import", params) })` → mutation throws `HttpException(code=500, "Internal Server Error")` (server restart in progress) → caught at line 175 → `Errors.fromException(e)` returns AppError(code=CODE_SERVER) → line 177-180: `if (error.code == CODE_NETWORK || ... || CODE_TIMEOUT || !onlineDetector.isOnline())` — CODE_SERVER is NOT in the list, onlineDetector.isOnline() is true (per WEAK-009, always true) → falls to `else` branch → `Result.Err(error)` returned → UI shows error toast → payment LOST from queue → user must manually retry.
- **Intended responsibility:** The boundary between "transient" (should enqueue) and "permanent" (should not enqueue) should be based on whether retrying LATER could succeed. 5xx errors are transient. Validation errors (4xx) are permanent. Auth errors (401/403) require re-auth, not retry.
- **Actual responsibility:** Only network/offline/timeout are enqueued. 5xx server errors return immediately with no enqueue. The mutation is lost from the queue. The user sees a generic "Erreur" toast and must manually retry. If they don't, the data (payment, parent edit, homework push) is gone.
- **Dependents / consumers:** `LocalPaymentRepository.collect`, `LocalParentRepository.create`/`update`, `LocalStudentRepository.create`/`update`, `LocalHomeworkRepository.push`, `LocalAttendanceRepository.record`, `LocalGradeRepository.enter` — every repository that wraps writes in tryThenEnqueue.
- **Alternative implementations of same operation:**
  - Desktop `SyncSupport` equivalent (sync-provider.tsx): the desktop's `defaultPushHandler` ALWAYS throws on RPC error → SyncService.drain catches → marks as failed → retries with backoff up to maxAttempts. The desktop retries ALL error types — including 5xx and validation errors. Different policy: "always retry, mark as failed after 5 attempts."
  - Website: no sync queue — direct API calls return errors to the UI immediately.
- **Behavioral differences:** Server 500 mid-deployment: Android loses the mutation permanently (unless user manually retries). Desktop: retries 5 times with backoff (1s, 2s, 4s, 8s, 16s = ~31s total) — by which time the deployment is likely done → succeeds. Desktop is more resilient to transient 5xx.
- **Git evidence:** SyncSupport.kt last touched `94471e8 2026-08-28`.
- **Likely root cause:** The policy was written to avoid queueing mutations that would NEVER succeed (e.g., validation errors, 401s). But the developer conflated "non-network errors" with "permanent errors" — without distinguishing 5xx (transient) from 4xx (often permanent). The list `CODE_NETWORK, CODE_OFFLINE, CODE_TIMEOUT` is too narrow.
- **Potential impact:** During server deployments (which take 30-60s for Supabase Edge Functions), restart windows, or DB failovers, every Android write attempt during that window is silently lost from the queue. For a school with 50 staff collecting payments concurrently, a 60s deployment window could lose dozens of payment writes — each requiring manual retry by the staff member who saw the error toast. Cash reconciliation at end-of-day would be off.
- **Code snippet:**
```kotlin
// SyncSupport.kt:165-198 — only network/offline/timeout enqueued
suspend fun <T : Any> tryThenEnqueue(
    entity: String, operation: String, payload: () -> String,
    isMock: Boolean = false, sourceScreen: String? = null,
    mutation: suspend () -> T,
): Result<T> {
    return try {
        Result.Ok(mutation())
    } catch (e: Exception) {
        val error = Errors.fromException(e)
        if (error.code == Errors.CODE_NETWORK || error.code == Errors.CODE_OFFLINE
            || error.code == Errors.CODE_TIMEOUT
            || !onlineDetector.isOnline()
        ) {
            // Offline — enqueue for later sync
            runCatching { syncService.enqueue(...) }
            Result.Err(Errors.offline(...))
        } else {
            // <-- 5xx, validation, auth, etc. land here: NOT ENQUEUED, just returned
            Result.Err(error)
        }
    }
}
// Desktop's equivalent: always throws on RPC error → SyncService.drain
// catches → marks pending with backoff → retries ALL error types up to 5x.
```
- **Confidence:** Confirmed

### FINDING SYNC-104 — Android FCM token never unregistered on signOut; device_tokens row stays active for the old user → notifications delivered to "signed-out" device

- **What:** Android's `LocalAuthRepository.signOut` (LocalRepositories.kt:184-206) calls `supabaseProvider.auth.signOut()`, writes a local `auth.logout` audit log entry, and clears `_sessionState`. It does NOT call any FCM token unregistration. The `device_tokens` row for the active FCM token (written by `FcmTokenRegistrar.register` on app startup / session change) stays with `user_id = old_user, is_active = true`. The server's `send-push-notification` EF (elimtiyaz-website/supabase/functions/send-push-notification/index.ts:208-212) queries `device_tokens WHERE user_id = target_user_id AND is_active = true` (modulo the broken `user_profile_id` column noted in WEAK-014) — so notifications addressed to the old user continue to be sent to the FCM token of the device the old user just signed out of. On a shared device (e.g., a teacher hands a tablet to a substitute), the substitute sees the original teacher's notifications.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:184-206` (signOut without FCM unregister)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/notifications/ElImtiyazMessagingService.kt:73-77` (onNewToken — only registers, never unregisters)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:344-384` (register_fcm_token RPC — has no inverse "unregister_fcm_token" RPC)
- **How reached:** User A signs in on shared tablet → `observeSessionForFcmToken` fires → `fcmTokenRegistrar.register(token)` → RPC `register_fcm_token(p_user_id=A, p_token=tablet_TK, p_platform=android)` → INSERT into device_tokens (tenant=T, user_id=A, token=tablet_TK, is_active=true) → user A signs out via Settings → signOut() runs → no unregister call → device_tokens row unchanged (user_id=A, is_active=true) → user A's notifications on the server (e.g., a homework-push from desktop, an overdue alert) → `send-push-notification` EF queries device_tokens WHERE user_id=A → finds row → sends FCM message to tablet_TK → tablet (still signed into A's FCM account even though app session is cleared) → notification displayed on lock screen → user B (now holding the tablet) sees user A's notifications.
- **Intended responsibility:** On sign-out, the device's FCM token for the previous user should be deactivated (set `is_active=false`) so the server stops sending them notifications.
- **Actual responsibility:** The device_tokens row stays active. The server keeps sending notifications to the device. The Android FCM service still receives them and displays them on the lock screen — even though the user is "signed out" of the app.
- **Dependents / consumers:** `send-push-notification` EF (queries device_tokens). The Android `ElImtiyazMessagingService.onMessageReceived` displays the notification regardless of whether the app has an active session (it's a FirebaseMessagingService — runs in the system process, not the app process).
- **Alternative implementations of same operation:**
  - Website `unregisterDeviceToken(userProfileId)` (fcm-registration.ts:65-79) EXISTS but is only called from `togglePush(false)` in profile-view.tsx — NOT from `signOut`. Plus the website's unregister only deactivates `platform='web'` tokens (line 75) — Android tokens are never touched by the website.
  - Desktop: no FCM token registration on the desktop (desktop doesn't use FCM push — it's Electron, the desktop uses OS-level notifications via Electron's Notification API, not FCM).
- **Behavioral differences:** Website: signing out leaves the web FCM token active (per SYNC-105 below). Android: signing out leaves the Android FCM token active. Both platforms have the same orphaned-token bug. The website at least HAS the unregister function — it's just not called from signOut. The Android doesn't even HAVE an unregister function.
- **Git evidence:** LocalRepositories.kt:184-206 last touched in `dd4c7dc kk` (2026-08-26). ElImtiyazMessagingService.kt touched in same commit. The signOut method has never called any FCM unregister.
- **Likely root cause:** The Android's `signOut` was written before FCM was integrated. FCM was added later (ElImtiyazMessagingService + FcmTokenRegistrar) but the signOut flow wasn't updated to call a new unregister method. There's no `unregister_fcm_token` SQL RPC — only `register_fcm_token` (which has `ON CONFLICT DO UPDATE SET is_active=true` — there's no path to set is_active=false via this RPC).
- **Potential impact:** Shared-device privacy leak. Substitute teacher / shared tablet / loaned phone: the new holder sees the previous user's push notifications (overdue alerts, payment receipts, chat mentions, workflow failures). The previous user can't tell that their notifications are leaking — they think "signing out" stops the flow.
- **Code snippet:**
```kotlin
// LocalRepositories.kt:184-206 — signOut without FCM unregister
override suspend fun signOut(): Result<Unit> {
    if (NetworkTimeouts.isSupabaseConfigured) {
        NetworkTimeouts.guard<Unit>("auth.signOut", timeoutMs = 2_000L) {
            supabaseProvider.auth.signOut()
        }
    }
    _sessionState.value?.let { s ->
        auditDao.upsert(AuditLogEntity(
            action = AuditActions.AUTH_LOGOUT,
            ...
        ))
    }
    _sessionState.value = null
    return Result.Ok(Unit)
    // <-- NO call to FcmTokenRegistrar.unregister(token)
    // <-- NO call to a server-side unregister_fcm_token RPC
    // <-- device_tokens row for this device's token stays (user_id=old, is_active=true)
}

// Compare migration 0027:344-384 — register_fcm_token RPC only ACTIVATES tokens.
// There is NO inverse RPC. The only way to deactivate a token is:
//   1. The send-push-notification EF marks it inactive when FCM says UNREGISTERED.
//   2. Direct SQL UPDATE by an admin.
//   3. The website's unregisterDeviceToken (only for platform='web').
// The Android has no path to deactivate its own Android-platform token.
```
- **Confidence:** Confirmed

### FINDING SYNC-105 — Website signOut uses scope:"global" (revokes ALL sessions across ALL devices) AND does not unregister FCM tokens — orphaned token + cross-device session kill

- **What:** The website's `auth-provider.signOut` (auth-provider.tsx:279-302) calls `supabase.auth.signOut({ scope: "global" })`. The `scope: "global"` option revokes the user's session across ALL devices — including the user's phone browser, tablet, and Android app (which uses the same Supabase Auth). So a user signing out of their work laptop signs out their phone too. Additionally, the signOut flow does NOT call `unregisterDeviceToken` — the FCM token registered for this browser (via `registerDeviceToken` in profile-view's `togglePush(true)`) stays active in the `device_tokens` table. If a different user signs into the same shared browser without first toggling push off, the previous user's notifications continue to flow to the browser (because the FCM service worker is still installed and the token is still active for the previous user_id).
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/app/providers/auth-provider.tsx:279-302` (signOut with scope: "global" + no FCM unregister)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/fcm-registration.ts:65-79` (unregisterDeviceToken exists but is only called from profile-view's togglePush(false))
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/profile/profile-view.tsx:128` (the ONLY call site of unregisterDeviceToken — manual push toggle, not signOut)
- **How reached:** User A signs into shared browser (Google OAuth) → navigates to Profile → toggles push ON → `registerDeviceToken(A)` → RPC `register_fcm_token(p_user_id=A, p_token=browser_TK, p_platform=web)` → device_tokens row (user_id=A, token=browser_TK, is_active=true) → user A signs out via Profile → `signOut()` → `supabase.auth.signOut({ scope: "global" })` → ALL of user A's Supabase sessions revoked (their phone, tablet, Android app, other browsers) → user A's local state cleared → user B signs into same shared browser (Google OAuth) → does NOT toggle push (assumed already on from A's session) → no `registerDeviceToken(B)` call → device_tokens row still (user_id=A, token=browser_TK, is_active=true) → server sends user A's notifications to the shared browser → user B sees user A's overdue alerts / chat messages / workflow failures.
- **Intended responsibility:** Signing out of one device should sign out ONLY that device's session (scope: "local") AND deactivate that device's FCM token (so notifications stop flowing to the signed-out browser).
- **Actual responsibility:** Sign-out revokes ALL the user's sessions globally (cross-device impact) AND leaves the FCM token active (orphaned token leak to next user of the shared browser).
- **Dependents / consumers:** Supabase Auth (session revocation). `send-push-notification` EF (queries device_tokens). The next user of the shared browser (sees the previous user's notifications).
- **Alternative implementations of same operation:**
  - Android `LocalAuthRepository.signOut` (LocalRepositories.kt:184-206): calls `supabaseProvider.auth.signOut()` WITHOUT specifying scope — Kotlin SDK default is `scope: LOCAL` (only the current session). Plus Android also doesn't unregister FCM (per SYNC-104). So Android's signOut is more conservative (local scope, no cross-device impact) but still has the FCM orphan.
  - Desktop: no FCM token registration on desktop (uses Electron Notification API, not FCM). Sign-out is local only.
- **Behavioral differences:** Website sign-out: cross-device session kill + FCM orphan. Android sign-out: local session + FCM orphan. Desktop sign-out: local only, no FCM involved. The website's `scope: "global"` is the most aggressive — and surprising to users who expect "sign out of this browser" not "sign out of every device I own".
- **Git evidence:** auth-provider.tsx:279-302 last touched in `03f6365 vitest 87/87` (2026-08-28, latest commit).
- **Likely root cause:** The developer used `scope: "global"` for security theater ("really sign me out everywhere"). They didn't realize the cross-device impact (the user might be signed into the same Supabase project on their phone). The lack of FCM unregister on signOut is a missed wiring — the unregister function exists but is only called from the manual push-toggle UI, not from the signOut flow.
- **Potential impact:** (1) A user signing out of a shared library/kiosk browser kills their phone's session too — they have to re-authenticate on their phone. (2) The previous user's notifications leak to the next user of the shared browser until the next user explicitly toggles push off then on (which would call unregisterDeviceToken for the OLD user then registerDeviceToken for the new user — but most users won't do this).
- **Code snippet:**
```typescript
// auth-provider.tsx:279-302 — signOut with scope: "global" + no FCM unregister
const signOut = useCallback(async () => {
  if (isMockSession) {
    clearMockSession();
    setIsMockSession(false);
    setUser(null); setParent(null); setChildrenList([]);
    setState("unauthenticated");
    router.refresh();
    return;
  }
  if (!supabase) return;
  // Revoke the session server-side before clearing local state.
  await supabase.auth.signOut({ scope: "global" });  // <-- ALL devices, not just this browser
  // <-- NO call to unregisterDeviceToken(user.id) — FCM token stays active
  setUser(null); setParent(null); setChildrenList([]);
  setState("unauthenticated");
  router.refresh();
}, [router, isMockSession]);

// fcm-registration.ts:65-79 — unregister EXISTS but is only called from profile-view togglePush(false):
export async function unregisterDeviceToken(userProfileId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("device_tokens")
    .update({ is_active: false })
    .eq("user_id", userProfileId)
    .eq("platform", "web");  // <-- only web tokens; Android tokens unaffected
  if (error) console.error("[fcm] failed to unregister device token:", error);
}
// profile-view.tsx:128 — the ONLY caller:
//   await unregisterDeviceToken(user.id);  // called from togglePush(false), NOT from signOut
```
- **Confidence:** Confirmed

### FINDING SYNC-106 — Android SyncWorker always returns Result.success() regardless of drainPending/pullAll failures; WorkManager retry escalation bypassed

- **What:** Android's `SyncWorker.doWork` (SyncWorker.kt:44-56) wraps both `syncService.drainPending()` and `pullSyncRepository.pullAll()` in `runCatching { ... }` blocks. If either throws, runCatching swallows the exception. The function then returns `Result.success()` unconditionally — never `Result.retry()` (which would tell WorkManager to retry the worker with backoff) or `Result.failure()` (which would mark the work as permanently failed and surface it in WorkManager's diagnostic UI). WorkManager's built-in retry mechanism (`Result.retry()` triggers exponential backoff up to `MAX_RUN_ATTEMPT_COUNT` = 5 by default) is completely bypassed. Persistent failures (e.g., schema mismatch, RLS denial on every drain) never surface to the operator — the worker silently fires every 15 minutes, fails every time, and reports success every time.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncWorker.kt:44-56`
- **How reached:** WorkManager fires SyncWorker every 15 min → `doWork()` → `if (!onlineDetector.isOnline()) return Result.success()` (per WEAK-009, this branch never fires because isOnline() always returns true) → `if (sessionManager.current() == null) return Result.success()` (fires when user is signed out) → `runCatching { syncService.drainPending() }` (drainPending throws — e.g., Room DB corruption, supabase_provider not configured, RPC timeout cascade) → exception swallowed → `runCatching { pullSyncRepository.pullAll(sinceIso = null) }` (pullAll throws — e.g., network DNS failure, Postgrest schema mismatch) → exception swallowed → `return Result.success()` → WorkManager records "success" → schedules next 15-min tick → next tick fails the same way → infinite silent failure loop.
- **Intended responsibility:** `CoroutineWorker.doWork` should return `Result.retry()` for transient failures (network, 5xx, timeout) and `Result.failure()` for permanent failures (validation, schema mismatch). WorkManager's `Result.retry()` triggers exponential backoff: 10s, 20s, 40s, 80s, 160s, then permanent failure (with `MAX_RUN_ATTEMPT_COUNT` = 5 by default). The worker's failure would surface in WorkManager's diagnostic UI (`adb dumpsys jobscheduler`).
- **Actual responsibility:** Always `Result.success()`. WorkManager's retry/diagnostic mechanisms are bypassed. The only way to detect persistent failures is to inspect the app's own SyncService snapshot StateFlow — which requires opening the app's Settings sync tab.
- **Dependents / consumers:** WorkManager (schedules next tick based on result). The Android Settings sync tab (displays SyncService's snapshot — but only when the user opens Settings).
- **Alternative implementations of same operation:**
  - Desktop `SyncService.drain` (sync-service.ts:318-391) returns `{ pushed, failed, skippedMock }` — the caller (syncNow) gets the actual counts. Failures are stored in the IndexedDB queue with `status: "failed"` + `lastError` + `attempts`. The desktop's UI surfaces failed entries in the Settings sync tab.
  - Website: no WorkManager — uses TanStack Query's retry (default 3 retries) for failed queries. Failed queries surface as error states in the UI.
- **Behavioral differences:** Android: silent infinite failure loop. Desktop: failed entries surface in Settings sync tab + retry with backoff (1s, 2s, 4s, 8s, 16s) before marking permanently failed. Website: failed queries surface as error UI states.
- **Git evidence:** SyncWorker.kt last touched in `94471e8` (2026-08-28).
- **Likely root cause:** The developer wrapped the calls in `runCatching` to prevent the worker from crashing the app — but didn't realize that swallowing the exception + returning success means WorkManager has no signal that anything went wrong. A safer pattern: `try { ...; Result.success() } catch (e: transient) { Result.retry() } catch (e: permanent) { Result.failure() }`.
- **Potential impact:** A persistent backend issue (e.g., schema mismatch after a Supabase migration that the Android app hasn't been updated for, or a tenant_id misconfiguration) silently breaks every 15-min sync cycle. The Android user thinks sync is working (WorkManager reports success, the Settings snapshot shows lastSyncAt = recent). Meanwhile, NO entries drain, NO pull happens. Local Room cache drifts further from server state every 15 min. The user only discovers the breakage when they notice stale data — which could be hours or days later.
- **Code snippet:**
```kotlin
// SyncWorker.kt:44-56 — always returns Result.success()
override suspend fun doWork(): Result {
    if (!onlineDetector.isOnline()) return Result.success()
    if (sessionManager.current() == null) return Result.success()
    // PUSH: drain pending offline mutations to Supabase.
    runCatching { syncService.drainPending() }  // <-- exceptions swallowed
    // PULL: fetch the latest parents + students from Supabase into Room.
    runCatching { pullSyncRepository.pullAll(sinceIso = null) }  // <-- exceptions swallowed
    return Result.success()  // <-- ALWAYS, regardless of whether drainPending or pullAll threw
}
// WorkManager's Result.retry() would schedule another attempt with backoff:
//   10s, 20s, 40s, 80s, 160s, then permanent failure.
// WorkManager's Result.failure() would surface in `adb dumpsys jobscheduler` output
//   and stop the periodic schedule entirely.
// Neither is ever used here.
```
- **Confidence:** Confirmed

### FINDING SYNC-107 — Android SyncService.syncNow is fire-and-forget; UI thinks sync completed immediately

- **What:** Android's `SyncService.syncNow` (SyncService.kt:144-150) launches a coroutine via `scope.launch { runCatching { drainPending() }; runCatching { pullSyncRepository.pullAll() } }` and immediately returns `Result.Ok(Unit)` WITHOUT awaiting the launched coroutine. The scope is `CoroutineScope(SupervisorJob() + Dispatchers.IO)` (line 48) — owned by the SyncService singleton. The caller (typically SettingsViewModel or a UI "Sync now" button) gets `Result.Ok` back instantly, before the drain has even started. The UI then displays a "synced" checkmark or "lastSyncAt = now" — but the actual drain may still be running (or may have just started, or may fail). If the user closes the app immediately after tapping "Sync now", the SupervisorJob is canceled when the app process dies, the drain is interrupted, and pending entries stay pending — but the UI showed "synced".
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncService.kt:144-150`
- **How reached:** User opens Settings → taps "Sync now" → SettingsViewModel calls `syncService.syncNow()` → `scope.launch { ... }` returns immediately → `Result.Ok(Unit)` returned → ViewModel updates UI state to "synced" → user sees "Synced ✓" indicator → user closes the app → app process dies → SupervisorJob canceled → drain was still running (or hadn't started) → pending entries stay pending → next time user opens the app, they see the queue is STILL pending but the previous "Synced ✓" indicator was a lie.
- **Intended responsibility:** `syncNow()` should be `suspend fun` and await the drain. The caller should display "Syncing..." while the drain is in flight, then "Synced ✓" only after it completes.
- **Actual responsibility:** The function returns instantly. The UI shows "Synced ✓" before the drain has done any work. The user is misled.
- **Dependents / consumers:** SettingsViewModel.signOut (calls syncNow before signing out — closes app, may interrupt drain). Topbar sync indicator (shows "syncing" state via SyncService.observeSyncState, but the state is set to `isRunning = true` only inside `drainPending`'s `drainMutex.withLock` block — which the launched coroutine eventually reaches. There's a race: the UI sees `Result.Ok` from syncNow before the launched coroutine has even acquired the mutex and set `isRunning = true`).
- **Alternative implementations of same operation:**
  - Desktop `SyncService.syncNow` (sync-service.ts:228-230): `async syncNow(): Promise<{ pushed, failed, skippedMock }> { return this.drain({ force: true }); }` — AWAITS the drain. The caller (e.g., sync-provider's `actions.syncNow`) gets the actual pushed/failed counts when the promise resolves.
  - Website: no manual sync trigger — relies on TanStack Query + realtime.
- **Behavioral differences:** Desktop: syncNow awaits → UI accurately reflects completion. Android: syncNow returns instantly → UI lies about completion.
- **Git evidence:** SyncService.kt last touched `94471e8` (2026-08-28).
- **Likely root cause:** `syncNow` was originally a non-suspend function that wrapped a fire-and-forget launch — likely to avoid making callers await. The caller ergonomics favored quick feedback, but the implementation threw away the actual completion signal.
- **Potential impact:** Users who tap "Sync now" and immediately close the app lose the drain. Settings sync UI shows "synced" timestamp that's actually just the launch time, not the completion time. Cash reconciliation reports rely on this timestamp — they may show "lastSyncAt: 14:32" when the actual drain never ran.
- **Code snippet:**
```kotlin
// SyncService.kt:144-150 — fire-and-forget syncNow
fun syncNow(): Result<Unit> {
    scope.launch {  // <-- launched, not awaited
        runCatching { drainPending() }
        runCatching { pullSyncRepository.pullAll() }
    }
    return Result.Ok(Unit)  // <-- returned BEFORE the launched coroutine runs
}

// Compare Desktop sync-service.ts:228-230 — syncNow awaits the drain:
async syncNow(): Promise<{ pushed: number; failed: number; skippedMock: number }> {
    return this.drain({ force: true });  // <-- awaits, returns actual counts
}
```
- **Confidence:** Confirmed

### FINDING REALTIME-100 — Website messages-view invalidates wrong queryKey prefix; unread badge stays stale forever

- **What:** In `messages-view.tsx:177`, after the `markRead` effect updates incoming messages' `read_by`, the code calls `queryClient.invalidateQueries({ queryKey: ["chat-unread"] })`. But the actual TanStack Query key for the unread-count hook is `["chat-unread-count", userProfileId]` (portal-queries.ts:488). TanStack v5 partial-match semantic: `["chat-unread"]` matches queries whose key STARTS with the element `"chat-unread"` (exact string). The actual key's first element is `"chat-unread-count"` (a different string — `"chat-unread"` is NOT a prefix of `"chat-unread-count"` in the element-wise partial-match sense; they're different first elements). So the invalidation matches NOTHING. The unread badge query is never invalidated by the markRead effect. Combined with the global `refetchOnWindowFocus: false` (providers/index.tsx:26), the unread badge stays stale until the user navigates away and back (remount triggers refetch) — which can be hours in a single session.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/messages/messages-view.tsx:177` (wrong invalidation key)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/portal-queries.ts:488` (actual query key)
  - `/home/z/my-project/repos/elimtiyaz-website/src/app/providers/index.tsx:25-26` (global config that makes this breakage fatal — staleTime 30s + refetchOnWindowFocus false)
- **How reached:** User opens Messages view → selects a channel → `useChatMessagesRealtime(channelId)` subscribes → `Conversation` component mounts → useEffect (line 157-180) runs `markRead` → for each incoming message, attempts `supabase.from("chat_messages").update({read_by: [...]}).eq("id", m.id)` (per REALTIME-101, this UPDATE is denied by RLS — but the Promise still resolves with `{ count: 0, error: null }`) → after Promise.all resolves, `queryClient.invalidateQueries({ queryKey: ["chat-unread"] })` fires → TanStack searches for queries whose key starts with `["chat-unread"]` → finds none (the actual key is `["chat-unread-count", userProfileId]`, different first element) → invalidation is a no-op → unread badge stays at its pre-conversation value → user opens a different conversation → badge doesn't decrease → user is confused.
- **Intended responsibility:** After marking messages as read, the unread badge should refresh immediately to reflect the new count.
- **Actual responsibility:** The invalidation is a no-op. The unread badge stays at the old value. Even if the markRead UPDATE succeeded server-side, the badge wouldn't update.
- **Dependents / consumers:** `bottom-nav.tsx:65,129` consumes `useUnreadChatCount(user?.id ?? null)` and renders the unread badge in the navigation.
- **Alternative implementations of same operation:** Other invalidations in the codebase use the full correct query key (e.g., `messages.refetch()` at messages-view.tsx:210 after sending a message). This ONE invalidation is wrong — likely a typo or misunderstanding of the partial-match semantic.
- **Behavioral differences:** Sending a message → `messages.refetch()` correctly refreshes the active conversation. Marking a message as read → wrong invalidation → badge doesn't refresh.
- **Git evidence:** messages-view.tsx:177 last touched in commit `e90dbf7 mid` (2026-08-01).
- **Likely root cause:** The developer wrote `["chat-unread"]` thinking TanStack would match any key starting with the string "chat-unread" — but TanStack v5's partial match is ELEMENT-WISE, not string-prefix. They confused the queryKey prefix-match semantic with a string-startsWith semantic.
- **Potential impact:** The unread chat badge is permanently wrong within a single session. After reading all messages, the badge still shows the old count. The only way to refresh is to navigate away from the Messages view and back (remount), or close and reopen the browser. A parent who reads all messages and still sees "3 unread" badge will be confused — they may open the Messages view again, find nothing unread, and dismiss the badge as broken.
- **Code snippet:**
```typescript
// messages-view.tsx:164-180 — invalidates WRONG query key prefix
await Promise.all(
  incoming.map((m) =>
    supabase
      .from("chat_messages")
      .update({
        read_by: [
          ...(m.read_by ?? []),
          { user_id: user.id, read_at: new Date().toISOString() },
        ],
      })
      .eq("id", m.id),
  ),
);
queryClient.invalidateQueries({ queryKey: ["chat-unread"] });
//                                          ^^^^^^^^^^^^^^^^
//   TanStack v5 partial match: queries whose key's FIRST ELEMENT === "chat-unread".
//   The actual key is ["chat-unread-count", userProfileId] — first element is
//   "chat-unread-count", which is a DIFFERENT STRING than "chat-unread".
//   So the partial match finds ZERO queries. The invalidation is a NO-OP.

// portal-queries.ts:488 — the actual query key:
queryKey: ["chat-unread-count", userProfileId],
//                  ^^^^^^^^^^^^^^^^ different string
// Correct invalidation would be:
//   queryClient.invalidateQueries({ queryKey: ["chat-unread-count", user.id] });
// or to invalidate ALL unread-count queries (if user.id is unknown):
//   queryClient.invalidateQueries({ queryKey: ["chat-unread-count"] });
```
- **Confidence:** Confirmed

### FINDING REALTIME-101 — Website markRead UPDATE on chat_messages is RLS-denied for incoming messages; read receipts NEVER persist server-side; errors silently swallowed

- **What:** The website's `messages-view.tsx` `Conversation` component has a `useEffect` (lines 157-180) that "marks incoming messages as READ" by calling `supabase.from("chat_messages").update({ read_by: [...(m.read_by ?? []), { user_id, read_at }] }).eq("id", m.id)` for every message where `m.author_id !== user.id` (i.e., incoming messages, NOT the user's own messages). However, the RLS policy `chat_messages_update_own` (migration 0019:857-860) restricts UPDATE to rows where `author_id = current_user_profile_id()` — i.e., a user can ONLY update their OWN messages. For incoming messages authored by someone else, the USING clause evaluates to false → PostgREST's UPDATE filters to 0 rows → the `read_by` column is NEVER updated server-side. The website's code does NOT check `error` on the returned Supabase result (it just `await Promise.all(...)` with no `.error` check, no try/catch). So the silent RLS denial is invisible to the UI. The user thinks "I read this message" but the server still has `read_by = []` → the unread badge never clears. The comment at line 154-156 explicitly says *"VAULT §05 — mark incoming messages as READ when the channel is open. Without this, read_by is only ever written for one's OWN messages, so unread badges never clear until the parent replies."* — the developer KNEW this was the case and tried to fix it, but the fix is broken by RLS.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/messages/messages-view.tsx:157-180` (markRead effect)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:857-860` (chat_messages_update_own policy)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0010_workforce.sql:340,357` (read_by column definition)
- **How reached:** User opens Messages view → selects a channel → Conversation component mounts → messages.data is fetched via `useChatMessages(channel.id, { limit: 200 })` → useEffect fires → filters incoming messages (`m.author_id !== user.id && !m.read_by?.some(r => r.user_id === user.id)`) → for each, `supabase.from("chat_messages").update({ read_by: [...existing, {user_id, read_at}] }).eq("id", m.id)` → PostgREST runs `UPDATE chat_messages SET read_by = [...] WHERE id = m.id AND tenant_id = current_tenant_id() AND author_id = current_user_profile_id()` (RLS USING clause) → since `m.author_id !== current_user_profile_id()`, USING is false → 0 rows updated → response is `{ data: null, error: null, count: 0 }` → no error → Promise.all resolves → `queryClient.invalidateQueries(["chat-unread"])` fires (which is also a no-op per REALTIME-100) → user sees the conversation but the message's `read_by` server-side is still `[]` → next time `useUnreadChatCount` runs (window focus or remount), it fetches the same messages with `read_by = []` → counts them as unread → badge stays at the old value.
- **Intended responsibility:** The RLS policy SHOULD allow users to update `read_by` on messages in channels they're a member of (regardless of who authored the message). Read receipts are a fundamental chat feature. A separate RLS policy like `chat_messages_update_read_by` should exist that allows the UPDATE only when (a) the user is a member of the message's channel AND (b) the UPDATE only touches the `read_by` column (not `body`, `edited_at`, etc.).
- **Actual responsibility:** The current `chat_messages_update_own` policy denies the UPDATE for incoming messages. Read receipts never persist. The unread badge never clears via the markRead path. The comment in the code acknowledges the broken state ("Without this, read_by is only ever written for one's OWN messages, so unread badges never clear until the parent replies.") — but the attempted fix doesn't work.
- **Dependents / consumers:** `useUnreadChatCount` (portal-queries.ts:484) — reads `read_by` from chat_messages, counts messages where `author_id !== user && !read_by?.some(r => r.user_id === user)`. With `read_by` never updated, this count stays at the pre-conversation value forever. The bottom-nav badge (bottom-nav.tsx:65,129).
- **Alternative implementations of same operation:** The standard pattern for chat read receipts is a server-side RPC (e.g., `mark_chat_message_read(p_message_id)`) that's `SECURITY DEFINER` (bypasses RLS) + verifies the caller is a channel member + only updates `read_by`. The codebase has no such RPC. The website tries to do it client-side via direct UPDATE — which is RLS-blocked.
- **Behavioral differences:** The user reads messages → expects the unread badge to drop → it doesn't. The user is confused. The chat_channels.updated_at also doesn't get bumped (no trigger on chat_messages UPDATE for that), so the channel list doesn't re-sort.
- **Git evidence:** messages-view.tsx:157-180 touched in `e90dbf7 mid` (2026-08-01). The RLS policy was authored in 0019 (initial RBAC migration). The "VAULT §05" comment was added when the developer realized the issue — but the fix was incomplete.
- **Likely root cause:** The RLS policy was written with strict "users can only modify their own messages" semantics — appropriate for body/edited_by, but wrong for read_by. Read receipts are a separate concern that needs its own RLS policy OR a SECURITY DEFINER RPC. The website's frontend dev tried to fix it client-side without realizing RLS would block them.
- **Potential impact:** Every website parent who opens a chat conversation thinks they've marked messages as read, but the server never knows. The unread badge stays at the pre-conversation value. The school staff who sent the message sees "unread" indefinitely. Read receipts are completely broken on the website — they ONLY work for the message author's own messages (which is useless — you don't need a read receipt for your own message that you just sent).
- **Code snippet:**
```typescript
// messages-view.tsx:157-180 — markRead UPDATE blocked by RLS
useEffect(() => {
  const markRead = async () => {
    if (!supabase || !user || !messages.data) return;
    const incoming = messages.data.filter(
      (m) => m.author_id !== user.id && !m.read_by?.some((r) => r.user_id === user.id),
    );
    if (incoming.length === 0) return;
    await Promise.all(
      incoming.map((m) =>
        supabase
          .from("chat_messages")
          .update({  // <-- RLS USING clause requires author_id = current_user_profile_id()
            read_by: [
              ...(m.read_by ?? []),
              { user_id: user.id, read_at: new Date().toISOString() },
            ],
          })
          .eq("id", m.id),  // <-- m.author_id !== user.id → USING false → 0 rows updated
      ),
      // <-- NO check for `error` in the result; Promise resolves with { count: 0 }
      //     which looks like success but no rows were actually updated.
    );
    queryClient.invalidateQueries({ queryKey: ["chat-unread"] });  // <-- also wrong key (REALTIME-100)
  };
  markRead();
}, [messages.data, user, channel.id, queryClient]);

-- migration 0019:857-860 — RLS denies UPDATE for non-authors
create policy chat_messages_update_own on public.chat_messages
    for update to authenticated
    using (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id())
    with check (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id());
-- There is NO policy allowing users to update read_by on messages they didn't author.
```
- **Confidence:** Confirmed

### FINDING REALTIME-102 — Website useNotificationsRealtime filter `target_user_id=eq.${user.id}` misses role-broadcast notifications

- **What:** The website's `useNotificationsRealtime` hook (use-realtime.ts:82-93) subscribes to Supabase realtime `postgres_changes` events on the `notifications` table with the filter `target_user_id=eq.${user.id}`. This filter ONLY catches INSERT/UPDATE/DELETE events on rows where `target_user_id` equals the current user's id. But per the canonical schema (migration 0013:96-138), the `notifications` table supports THREE targeting modes: (1) direct user (`target_user_id` set, `target_role` NULL); (2) role broadcast (`target_user_id` NULL, `target_role` set e.g. 'parent'); (3) tenant broadcast (`target_user_id` NULL, `target_role` NULL, visible only to staff per RLS). The realtime filter only catches mode 1. Mode 2 (role-broadcasts) and mode 3 (tenant-broadcasts) never trigger the realtime invalidation → the user doesn't see them in real-time → they only appear on next page reload or remount. The RLS policy at 0019:1023-1032 DOES allow users to SELECT role-broadcast notifications (clause 2: `target_role is not null and target_role = any(public.current_user_roles())`), so the user CAN see them when the query refetches — but the realtime filter prevents the refetch from being triggered.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/use-realtime.ts:82-93` (useNotificationsRealtime)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0013_calendar_notifications_backup.sql:96-138` (notifications schema with target_role)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:1023-1032` (notifications RLS with role-broadcast clause)
- **How reached:** Admin broadcasts a school-wide announcement to all parents (target_role='parent', target_user_id=NULL) via a workflow-execute EF or SQL trigger → INSERT into notifications → Supabase realtime publishes the INSERT event → website's `useNotificationsRealtime` subscription receives the event → filter `target_user_id=eq.${user.id}` checks the new row's `target_user_id` → it's NULL (because target_role was used) → filter rejects → callback doesn't fire → TanStack Query `["notifications"]` is NOT invalidated → next time the user views the dashboard, the notification doesn't appear → user reloads the page → `useNotifications` refetches → RLS allows the SELECT → notification appears → user sees it for the first time, late.
- **Intended responsibility:** The realtime filter should catch all notifications visible to the current user — direct-targeted (target_user_id = user.id), role-broadcast (target_role matches user's roles), and (for staff) tenant-broadcast.
- **Actual responsibility:** Only direct-targeted notifications trigger the realtime invalidation. Role-broadcasts and tenant-broadcasts are invisible to realtime.
- **Dependents / consumers:** `useNotifications` (portal-queries.ts:366) — fetches all notifications visible to the user (RLS handles the visibility). Used by dashboard-view.tsx and bottom-nav.tsx for the bell badge.
- **Alternative implementations of same operation:** Other realtime hooks in the same file (`useChatMessagesRealtime`, `useFinancialRealtime`) correctly filter by a non-null column (`channel_id`, `parent_id`) that's always set for the rows they care about. The notifications filter is the only one where the filter column can be NULL for legitimate rows.
- **Behavioral differences:** A direct-targeted notification (e.g., "your payment X is overdue") appears in real-time. A role-broadcast notification (e.g., "school closed tomorrow for all parents") appears only on next reload/remount.
- **Git evidence:** use-realtime.ts last touched `e90dbf7 mid` (2026-08-01).
- **Likely root cause:** The developer assumed `target_user_id` was always set — didn't consider role-broadcasts. The notifications schema supports both, but the realtime hook only handles one.
- **Potential impact:** Time-sensitive role-broadcasts (school closures, exam schedule changes, fee deadline reminders) appear late on the website. A parent checking the dashboard at 7am for school closure info (broadcast at 6am to role='parent') won't see it until they reload. Direct-targeted notifications work fine. The asymmetry is confusing — some notifications appear instantly, others are delayed by hours.
- **Code snippet:**
```typescript
// use-realtime.ts:82-93 — filter misses role-broadcast notifications
export function useNotificationsRealtime() {
  const { user } = useAuth();
  useRealtimeInvalidation(
    "notifications",
    [["notifications"]],
    {
      // Filter by target_user_id so we only get events for THIS user.
      filter: user ? `target_user_id=eq.${user.id}` : undefined,
      //                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      //   Only catches notifications where target_user_id = user.id.
      //   Role-broadcast notifications (target_user_id IS NULL,
      //   target_role IS NOT NULL) are NEVER caught by this filter.
      enabled: Boolean(user),
    }
  );
}

// migration 0013:96-138 — notifications table supports THREE targeting modes:
//   (1) target_user_id=UUID, target_role=NULL  → direct user
//   (2) target_user_id=NULL,    target_role='parent' → role broadcast
//   (3) target_user_id=NULL,    target_role=NULL → tenant broadcast (staff only per RLS)

// migration 0019:1023-1032 — RLS ALLOWS users to SELECT role-broadcasts:
//   using ( tenant_id = current_tenant_id() and (
//       target_user_id = current_user_profile_id()
//       or (target_role is not null and target_role = any(current_user_roles()))
//       or (target_user_id is null and target_role is null and has_any_role([staff]))
//   ) )
// So the user CAN see role-broadcasts when the query refetches — but the
// realtime filter prevents the refetch from being triggered for them.
```
- **Confidence:** Confirmed

### FINDING REALTIME-103 — Website useChatMessagesRealtime(activeChannelId) only subscribes to the open channel; messages in OTHER channels don't trigger unread badge update

- **What:** The website's `useChatMessagesRealtime(channelId)` (use-realtime.ts:98-107) subscribes to Supabase realtime events on `chat_messages` filtered by `channel_id=eq.${channelId}`. This filter ONLY catches events for the currently-open channel. When a message arrives in a DIFFERENT channel (e.g., a staff member sends the parent a new message while the parent is viewing a different conversation), the realtime event for that message has `channel_id = the_other_channel`, which doesn't match the active channel's filter → the event is silently dropped by Supabase Realtime → the website's `useChatMessages` refetch doesn't fire (correctly — we don't need to refetch the active channel) → but ALSO the `useUnreadChatCount` query (which counts unread across ALL channels) doesn't refetch (because it has NO realtime subscription of its own — it relies on refetchOnWindowFocus=true override and manual invalidation from the markRead path, which is also broken per REALTIME-100). The bottom-nav unread badge doesn't update in real-time when a new message arrives in a non-active channel.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/use-realtime.ts:98-107` (useChatMessagesRealtime — active channel only)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/portal-queries.ts:484-518` (useUnreadChatCount — NO realtime subscription, only refetchOnWindowFocus)
- **How reached:** Parent is on Messages view, has Channel A open → staff sends a new message in Channel B → INSERT into chat_messages with `channel_id = B` → Supabase Realtime publishes the event → website's subscription filter `channel_id=eq.A` rejects (because B ≠ A) → callback doesn't fire → TanStack `["chat-messages", A, 200]` query isn't invalidated (correct, Channel A didn't change) → TanStack `["chat-unread-count", userId]` query isn't invalidated either (no realtime subscription on it) → unread badge stays at the old count → parent doesn't know there's a new message in Channel B until they navigate away and back, or focus the window (refetchOnWindowFocus=true for useUnreadChatCount).
- **Intended responsibility:** The unread badge should update in real-time when new messages arrive in ANY of the user's channels.
- **Actual responsibility:** Only messages in the currently-active channel trigger a refetch. Messages in other channels wait for window focus or remount.
- **Dependents / consumers:** `bottom-nav.tsx:65,129` (unread badge).
- **Alternative implementations of same operation:** The CORRECT pattern would be a separate `useUnreadChatCountRealtime(userProfileId)` hook that subscribes to `chat_messages` with NO `channel_id` filter (or filters by `tenant_id` if RLS doesn't already scope it). The subscription would invalidate `["chat-unread-count", userProfileId]` on every INSERT.
- **Behavioral differences:** Channel-A-open scenario: new message in Channel A → badge updates. New message in Channel B → badge stays stale until window focus.
- **Git evidence:** use-realtime.ts last touched `e90dbf7 mid` (2026-08-01).
- **Likely root cause:** The `useChatMessagesRealtime` hook was designed to refresh the open conversation — the right scope for that specific concern. But no parallel hook was added for the unread count. The two concerns (active conversation refresh vs. unread badge refresh) need separate subscriptions.
- **Potential impact:** A parent actively chatting in Channel A while a staff member sends them an urgent message in Channel B won't see the unread badge update. They may miss the message entirely until they tab away and back. For time-sensitive communications (e.g., a fee deadline reminder sent while the parent is mid-conversation with another staff member), this delay could be hours.
- **Code snippet:**
```typescript
// use-realtime.ts:98-107 — active channel only
export function useChatMessagesRealtime(channelId: string | null | undefined) {
  useRealtimeInvalidation(
    "chat_messages",
    [["chat-messages", channelId]],
    {
      filter: channelId ? `channel_id=eq.${channelId}` : undefined,
      //                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      //   Only catches events for the currently-open channel.
      //   Messages in OTHER channels are silently dropped by this subscription.
      enabled: Boolean(channelId),
    }
  );
  // <-- NO subscription for the unread count across ALL channels
}

// portal-queries.ts:484-518 — useUnreadChatCount has NO realtime subscription
export function useUnreadChatCount(...) {
  return useQuery({
    queryKey: ["chat-unread-count", userProfileId],
    queryFn: async () => {
      // ... fetch 500 messages, count unread client-side
    },
    enabled: Boolean(userProfileId),
    refetchOnWindowFocus: true,  // <-- the ONLY way this updates without remount
  });
}
```
- **Confidence:** Confirmed

### FINDING REALTIME-104 — Android has ZERO Supabase realtime subscriptions; relies entirely on 15-min pullAll cycle for freshness

- **What:** A repo-wide grep on the Android codebase (`/home/z/my-project/repos/elimtiyaz-android`) for `channel(`, `realtime.channel`, `subscribe(` returns ZERO matches in production code. The Android `SupabaseClientProvider` (SupabaseClientProvider.kt:153) installs the Realtime plugin (`install(Realtime)`), but NO code in the app actually subscribes to any channel. The Android relies entirely on `PullSyncRepository.pullAll` (called by SyncWorker every 15 min, by SyncService.drainPending at the end of every drain, by app startup, by session change, and by pull-to-refresh). For a parent using the Android app, new homework/notifications/payments/chat messages appear at most 15 minutes late — UNLESS they manually pull-to-refresh. By contrast, the website has 4 realtime hooks (useNotificationsRealtime, useChatMessagesRealtime, useFinancialRealtime, useHomeworkRealtime — though 2 of them are broken per WEAK-016 and REALTIME-102). The desktop has 0 realtime hooks (all Subject-based caches, same broken pattern as CROSS-104).
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/supabase/SupabaseClientProvider.kt:153` (Realtime plugin installed)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncWorker.kt:36,54` (15-min periodic pullAll)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncService.kt:130` (pullAll at end of every drain)
- **How reached:** Server inserts a new payment for parent X (collected by desktop staff) → Supabase Realtime publishes the INSERT event on `payments` table → website's `useFinancialRealtime(parentId)` subscription receives it → invalidates `["payments", parentId]` and `["installments", parentId]` → TanStack refetches → parent on the website sees the new payment instantly. The parent on Android is looking at their payments list → the local Room cache shows the old list (no new payment) → no realtime push to trigger a refetch → user sees stale list. User pulls down to refresh → `StudentRosterScreen:103` triggers `pullAll` → server returns the latest 2000 payments → Room updated → UI shows the new payment. So the parent on Android gets the new payment LATE (up to 15 min, or whenever they manually refresh).
- **Intended responsibility:** The Android should subscribe to Supabase Realtime channels for the same tables the website does — at minimum, payments, installments, notifications, chat_messages — so the UI updates instantly when the server state changes.
- **Actual responsibility:** The Android polls every 15 minutes. The user sees stale data for up to 15 minutes. There's no realtime push.
- **Dependents / consumers:** Every screen that displays server-derived data: dashboard KPIs (LocalDashboardRepository.observeKpis reads from Room), debt dashboard (LocalDebtRepository reads from Room), parent profile (LocalDebtRepository.observeParentProfile), chat messages (LocalChatRepository reads from Room), homework list (LocalHomeworkRepository reads from Room).
- **Alternative implementations of same operation:**
  - Website: 4 realtime hooks (2 broken, 2 working). Best freshness among the 3 platforms.
  - Desktop: 0 realtime hooks. Worst freshness — caches seeded once at startup, never re-seeded (per CROSS-104).
- **Behavioral differences:** Website parent sees new payment in ~1s. Android parent sees new payment in up to 15min. Desktop parent (if there were such a user — the desktop is for staff, not parents) would NEVER see it without a restart.
- **Git evidence:** No realtime code exists in the Android repo. The Realtime plugin is installed (line 153) but unused — installed likely "for future use" that never materialized.
- **Likely root cause:** The Android was designed as offline-first (Room is the source of truth, server is secondary). The pull-all pattern was considered sufficient. Realtime was added as a TODO that was never wired up. The complexity of integrating Supabase Realtime into Kotlin flows (vs TanStack Query's invalidate-on-event pattern on the website) likely deterred the developer.
- **Potential impact:** A parent using the Android app who is waiting for confirmation that a payment was received (e.g., standing at the counter after handing over cash) sees stale "unpaid" status for up to 15 minutes. They may re-pay (double-pay) or argue with staff. For time-sensitive flows (chat messages, exam schedule changes, fee deadlines), the 15-min lag is significant.
- **Code snippet:**
```kotlin
// SupabaseClientProvider.kt:144-157 — Realtime plugin installed but unused
return try {
    createSupabaseClient(
        supabaseUrl = validUrl,
        supabaseKey = validKey,
    ) {
        install(Auth) { ... }
        install(Postgrest)
        install(Realtime)  // <-- installed, but ZERO code in app/src/main subscribes to any channel
        install(Storage)
        install(Functions)
        httpEngine = Android.create()
    }
} catch (e: Exception) { ... }

// SyncWorker.kt:36 — only path that pulls new data:
val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
//   15-minute minimum interval (Android's WorkManager minimum for periodic work)
// So worst-case latency for any server-side change reaching Android = 15 minutes.

// Compare website use-realtime.ts:114-131 — useFinancialRealime DOES use Realtime:
//   useRealtimeInvalidation("installments", [["installments", parentId], ["payments", parentId]], ...);
//   useRealtimeInvalidation("payments", [["payments", parentId], ["installments", parentId]], ...);
// Website parent sees the change in ~1s.
```
- **Confidence:** Confirmed

### FINDING CACHE-100 — Website TanStack Query config (staleTime 30s + refetchOnWindowFocus false + retry 1) leaves data stale indefinitely when realtime is broken

- **What:** The website's TanStack Query config (app/providers/index.tsx:22-30) sets `staleTime: 30_000` (30s), `refetchOnWindowFocus: false`, `retry: 1` as global defaults. This config is fine WHEN realtime subscriptions work — TanStack Query marks data as stale after 30s, and the realtime invalidation triggers an immediate refetch. But when realtime is broken (which it is — per WEAK-016 `useHomeworkRealtime` subscribes to the wrong table; per REALTIME-100 the chat unread invalidation key is wrong; per REALTIME-101 the chat read receipts never persist; per REALTIME-102 role-broadcast notifications are missed; per REALTIME-103 unread badge for other channels is missed), the website has NO fallback path to freshness. After the initial fetch, data is cached. After 30s, it's marked "stale" but not refetched (no trigger). The user sees stale data indefinitely within a single session — until they navigate away and back (remount triggers refetch via refetchOnMount which defaults to true).
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/app/providers/index.tsx:22-30` (global QueryClient config)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/use-realtime.ts` (4 hooks, of which 2 are broken: WEAK-016 + REALTIME-100/101/102/103)
- **How reached:** Parent opens homework view → `useHomeworkForClass(classId)` fetches from canonical `homework` table → data displayed → 30s later, data is stale (per TanStack staleTime) but no refetch fires (no trigger — `useHomeworkRealtime` subscription is on the wrong table `homework_assignments`, so realtime events never fire) → parent keeps the view open for an hour → during that hour, teacher pushes new homework via desktop → server inserts into `homework` table → Supabase Realtime publishes the INSERT → website's subscription on `homework_assignments` (wrong table) doesn't receive it → TanStack cache stays at the original 30s-stale data → parent sees the old homework list for an hour → parent finally navigates away and back → remount triggers refetch → new homework appears.
- **Intended responsibility:** The config should provide a SAFETY NET: if realtime breaks, polling or refetchOnWindowFocus should keep data fresh. The current config puts ALL the freshness eggs in the realtime basket — with no fallback.
- **Actual responsibility:** Realtime is the ONLY freshness mechanism. When realtime breaks, data is stale forever within a session. The config's `refetchOnWindowFocus: false` is the key bad setting — turning it back on would provide a fallback.
- **Dependents / consumers:** Every query on the website — `useHomeworkForClass`, `useNotifications`, `usePayments`, `useInstallments`, `useLedgerEntries`, `useChatChannels`, `useChatMessages`, `useUnreadChatCount` (which overrides to `refetchOnWindowFocus: true` — the ONLY query that has the safety net).
- **Alternative implementations of same operation:**
  - Desktop: no TanStack Query — uses Subject-based caches with seed-once-never-refresh pattern (per CROSS-104). No fallback either.
  - Android: no TanStack Query — uses Room + Flow + 15-min pullAll. The pullAll IS the fallback (runs every 15 min even when no realtime fires).
- **Behavioral differences:** Website: stale data indefinitely within session (when realtime broken). Android: stale data for at most 15 min (pullAll fallback). Desktop: stale data until app restart (no fallback at all).
- **Git evidence:** providers/index.tsx last touched `aebc58d first commit` (2026-07-31).
- **Likely root cause:** The config was set when the website was first built — assuming realtime would work for everything. The `refetchOnWindowFocus: false` was likely set to reduce server load ("we have realtime, why bother with window focus"). Then realtime broke for several tables (homework, chat) but the config wasn't revisited. The fragile "realtime-only freshness" architecture is the systemic issue.
- **Potential impact:** (1) Homework: parents see stale homework lists (potentially missing tonight's assignment) until they navigate away and back. (2) Chat: parents see stale unread badges (per REALTIME-100/101/103). (3) Notifications: parents miss role-broadcast notifications (per REALTIME-102) until reload. (4) For any future table whose realtime hook is broken or missing, the same indefinite-staleness applies.
- **Code snippet:**
```typescript
// providers/index.tsx:22-30 — fragile "realtime-only freshness" config
const [queryClient] = useState(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,           // 30s — data is "stale" after 30s
          refetchOnWindowFocus: false, // <-- NO fallback when realtime breaks
          retry: 1,                    // <-- only retry once on failure (network blip = immediate error)
        },
      },
    })
);
// After 30s, data is marked stale but NOT refetched (no trigger).
// The only refetch triggers are:
//   (1) mount (refetchOnMount defaults to true)
//   (2) explicit invalidateQueries() call from a realtime callback
//   (3) explicit refetch() call from a mutation's onSuccess
// When realtime subscription is broken (wrong table / wrong filter),
// trigger (2) never fires. The user sees stale data until they remount.
```
- **Confidence:** Confirmed

### FINDING CACHE-101 — Desktop OnlineDetector probes Google (`https://www.google.com/generate_204`) with `mode: "no-cors"` every 30s — privacy leak + captive portal detection broken

- **What:** The desktop's `OnlineDetector` (online-detector.ts) probes `https://www.google.com/generate_204` every 30 seconds (DEFAULT_PROBE_INTERVAL_MS = 30_000) using `fetch(probeUrl, { method: "HEAD", mode: "no-cors", cache: "no-store", signal })`. Two compounding issues: (1) **Privacy leak**: the desktop app makes a HEAD request to Google every 30s for the entire duration the app is running. Google's server logs see the user's IP + frequency + duration of use. For a financial app used by school staff, this is an unnecessary third-party metadata leak. (2) **Captive portal detection broken**: with `mode: "no-cors"`, the JavaScript code CANNOT read the response status — any non-throwing response (including a 302 redirect to a captive portal login page, or a 200 with HTML) is treated as "online" (line 90: `probeOk = true`). A captive portal that intercepts the request and returns its login page will NOT throw → probeOk = true → "online" reported → SyncService attempts to drain → all Supabase RPCs fail (DNS likely broken, or the captive portal blocks them) → entries marked failed after 5 retries → queue fills with failed entries → user confused.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/sync/online-detector.ts:24,81-94`
- **How reached:** User on captive portal (hotel WiFi, airport WiFi, corporate guest network) → opens desktop app → OnlineDetector probes google.com → captive portal intercepts the HEAD request → returns a 302 redirect to `/login?next=...` → in `no-cors` mode, the fetch follows the redirect transparently, gets a 200 response with HTML login page → no throw → `probeOk = true` → `online = true` → SyncService.drain fires → attempts `client.rpc("upsert_payment_from_import", ...)` → DNS may resolve Supabase URL → captive portal blocks the request → fetch throws (DNS resolution failure or connection refused) → drain's push fails → entry marked pending → 5 retries with backoff (1s, 2s, 4s, 8s, 16s = ~31s) → all fail → entry marked failed → queue fills with failed entries. Meanwhile, every 30s the OnlineDetector keeps probing google.com, getting the captive portal page, reporting "online" → drain keeps firing → more entries pile up as failed.
- **Intended responsibility:** The OnlineDetector should: (a) probe the Supabase instance itself (the actual server the app talks to — if Supabase is reachable, we're truly online), and (b) read the response status so captive portals can be detected (a 302 redirect or a 200 with non-empty HTML body is suspicious).
- **Actual responsibility:** The detector probes Google with no-cors. Privacy leak + broken captive portal detection.
- **Dependents / consumers:** SyncService uses `onlineState.online` to decide whether to drain. UI topbar / Settings sync tab displays the online/offline indicator.
- **Alternative implementations of same operation:**
  - Android `OnlineDetector` (WEAK-009): probes `https://supabase.com/auth/v1/health` (NOT the user's actual Supabase instance — a metadata leak to Supabase Inc.). The Android detector is WORSE — `isOnline()` ignores `probeOk` entirely (always returns true). The desktop at least uses `probeOk` in the `online` calculation (line 116: `next.online = next.navigatorOnline && next.probeOk`).
  - Website: no OnlineDetector — relies on TanStack Query's retry-on-network-error + Supabase auth state listener.
- **Behavioral differences:** Desktop: Google probe, no-cors, actually uses probeOk. Android: Supabase Inc. probe, ignores probeOk. Desktop is better but still has the captive portal issue. The correct approach is to probe the user's own Supabase URL `/rest/v1/` endpoint with normal fetch (CORS-allowed since the desktop app is the same origin as Supabase from PostgREST's perspective when configured with the anon key).
- **Git evidence:** online-detector.ts last touched in initial commit batch `b25e6ca FKFKFK` (2026-08-04).
- **Likely root cause:** The developer copied a "network connectivity check" pattern from a public tutorial (google.com/generate_204 is the canonical example). `no-cors` was likely added because Supabase's auth endpoint doesn't return CORS headers for arbitrary origins, and the developer wanted to avoid CORS errors in the console. They didn't realize `no-cors` strips the ability to read the status, defeating the probe's purpose.
- **Potential impact:** (1) Every 30s, the desktop app phones Google — even when the user is offline (the request will fail, but it's still attempted). For a financial app handling FERPA-protected student data, this is a privacy concern that compliance officers might flag. (2) On captive portals (common in hotels, airports, conferences — exactly the places school staff travel to), the detector reports "online" when the user is actually captive. The queue fills with failed entries. The user has to manually open a browser, authenticate to the captive portal, then come back to the app and tap "Sync now" — but the failed entries don't auto-retry (per sync-service.ts:337, only "pending" entries are drained; "failed" entries are stuck).
- **Code snippet:**
```typescript
// online-detector.ts:24 — Google probe URL
const DEFAULT_PROBE_URL = "https://www.google.com/generate_204";
//                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//   Privacy leak: Google sees every probe (every 30s for the app's lifetime).
//   Better: probe the user's own Supabase URL `${supabaseUrl}/rest/v1/`
//   (CORS-allowed for the configured anon key; actually tests the server
//   the app cares about).

// online-detector.ts:81-94 — fetch with no-cors
const res = await fetch(this.probeUrl, {
  method: "HEAD",
  mode: "no-cors",  // <-- CANNOT read response.status in no-cors mode
  cache: "no-store",
  signal: controller.signal,
});
// In no-cors mode, ANY non-throwing response → opaque response → we can't
// check res.ok or res.status. A captive portal returning 302→200 with HTML
// login page doesn't throw → probeOk = true → "online" reported.
probeOk = true;
void res;

// Compare Android OnlineDetector.kt:118-130 — different bug (ignores probeOk):
//   fun isOnline(): Boolean = _state.value.connectivityActive  // ignores probeOk
// Android at least probes the user's actual Supabase URL (per WEAK-006).
```
- **Confidence:** Confirmed

### FINDING CACHE-102 — Desktop IndexedDB sync queue store silently falls back to in-memory when IndexedDB is unavailable; "sync queued" UI lies to user

- **What:** The desktop's `IndexedDBQueueStore` (sync-queue-store.ts:35-63) attempts to open IndexedDB on `init()`. If `typeof indexedDB === "undefined"` (private mode, restricted Electron context, old browser), it sets `this.usingFallback = true` and uses an in-memory `Map<string, SyncQueueEntry>`. The fallback is logged via `console.warn` (line 38) but NOT surfaced to the UI. The user enqueues mutations (Excel import) → entries are stored in-memory → the topbar sync indicator shows "X pending" → user closes the app → process exits → in-memory store is wiped → all pending entries are LOST. On next launch, IndexedDB might still be unavailable → the queue is empty → the user thinks their data was synced (because the indicator showed "synced" before they closed) but the server has nothing.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/sync/sync-queue-store.ts:35-63, 181-185`
- **How reached:** User runs desktop app in browser private mode (or a restricted Electron context where IndexedDB is unavailable) → Excel import → 1170 entries enqueued → IndexedDBQueueStore.init() detects `typeof indexedDB === "undefined"` → sets `usingFallback = true` → console.warn → entries stored in `memFallback: Map` → SyncService shows snapshot with `pendingCount: 1170` → user closes app → process dies → memFallback is garbage-collected → all 1170 entries lost. User reopens app → IndexedDB still unavailable → queue is empty → user thinks "sync completed" (no pending indicator) → server has zero of the 1170 entries.
- **Intended responsibility:** The fallback should be surfaced to the UI — a banner saying "Sync queue is running in-memory; pending changes will be lost on app close. Restore IndexedDB to fix." OR the queue should refuse to operate in fallback mode (return an error on enqueue) so the user knows the data isn't being persisted.
- **Actual responsibility:** The fallback is silent. The user is misled. Data loss.
- **Dependents / consumers:** SyncService.enqueue (calls store.add) / enqueueBatch (calls store.addBatch) — both transparently fall back. SyncService.drain (calls store.listByStatus("pending")) — works in fallback mode. The UI SyncIndicator displays the snapshot counts (which include fallback-mode entries as if they were durable).
- **Alternative implementations of same operation:**
  - Android: uses Room (SQLite) — always durable, no fallback path.
  - Website: no sync queue — server is source-of-truth.
- **Behavioral differences:** Normal mode (IndexedDB available): queue persists across app restarts. Fallback mode (IndexedDB unavailable): queue wiped on app restart. The UI doesn't differentiate.
- **Git evidence:** sync-queue-store.ts last touched in initial commit batch.
- **Likely root cause:** The fallback was added defensively to prevent the app from crashing when IndexedDB isn't available. The developer added a `console.warn` as a debugging aid but didn't surface the state to the UI. The assumption was that IndexedDB is "always available in modern Electron" — true for normal use, false for private mode and some kiosk scenarios.
- **Potential impact:** School staff running the desktop in private mode (e.g., to avoid leaving session tokens on a shared computer) loses every pending sync entry on app close. The indicator lies — shows "sync queued" or even "synced" while the entries were never persisted locally or pushed to the server.
- **Code snippet:**
```typescript
// sync-queue-store.ts:35-63 — silent fallback to in-memory
async init(): Promise<void> {
  if (this.db || this.usingFallback) return;
  if (typeof indexedDB === "undefined") {
    console.warn("[SyncQueueStore] IndexedDB unavailable — using in-memory fallback (queue will NOT survive restart).");
    //                                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //   Goes to the browser console — INVISIBLE to the user.
    //   The UI continues to show pending/synced counts as if entries were durable.
    this.usingFallback = true;
    return;
  }
  // ... open IndexedDB ...
}

// sync-queue-store.ts:181-185 — singleton, never re-checked
let _store: IndexedDBQueueStore | null = null;
export function getSyncQueueStore(): IndexedDBQueueStore {
  if (!_store) _store = new IndexedDBQueueStore();
  return _store;
}

// SyncProvider (sync-provider.tsx:242-252) doesn't expose usingFallback to UI:
const service = useMemo<SyncService>(() => {
  return initialiseSyncService({
    tenantId: () => sessionRef.current?.tenantId ?? "default",
    actorId: () => sessionRef.current?.userId ?? "system",
    isSupabaseConfigured: () => isSupabaseConfigured(),
    isMockMode: () => !isSupabaseConfigured(),
    push: defaultPushHandler,
    autoStart: true,
  });
}, []);
// The snapshot returned by SyncService.subscribe() doesn't include a "durable" flag.
// SyncIndicator renders "X pending" identically in durable and fallback modes.
```
- **Confidence:** Confirmed (the fallback path is verified; the frequency of private-mode use is unknown but plausible for shared/kiosk scenarios).

### FINDING CACHE-103 — Desktop SupabaseAcademicRepository uses Subject-cache pattern with no realtime; cross-instance writes invisible (extends CROSS-104)

- **What:** The desktop's `SupabaseAcademicYearRepository` (supabase-academic-repository.ts:54-160) uses a `SubjectBehavior<AcademicYear[]>` cache (line 55), populated once in the constructor via `this.refresh()` (line 58). Local writes (`createAcademicYear`, `updateAcademicYear`, `setCurrentYear`) call `await this.refresh()` after the write to update the cache. But there is NO Supabase Realtime subscription. When another client (another desktop instance, the Android app, the website, or a server-side EF) modifies the `academic_years` table, this desktop's cache stays stale. This is the SAME pattern as the payment repository (CROSS-104) but for academic data — which has more conflict potential because the `is_current` flag is a singleton (only one academic year can be current per tenant). Two desktop admins concurrently setting different years as current → both call `setCurrentYear` → both unset the flag on others, both set the flag on theirs → the LAST WRITE WINS, the first admin's choice is silently overwritten. Neither admin sees the other's change until they restart their app.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:54-160` (SupabaseAcademicYearRepository — Subject + refresh-on-write pattern)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:997-1012` (SupabasePaymentRepository — same pattern, already documented in CROSS-104)
- **How reached:** Admin A on desktop1 sets academic year 2025 as current → `setCurrentYear` line 109-124: UPDATE academic_years SET is_current=false WHERE tenant_id = X AND id != 2025 → UPDATE academic_years SET is_current=true WHERE id = 2025 → `this.refresh()` fetches → admin A's cache: 2025 is current. Admin B on desktop2 (different machine, running concurrently) sets academic year 2026 as current → same flow → admin B's cache: 2026 is current. The server's actual state: the LAST WRITE WINS. If admin A's second UPDATE fired after admin B's, the server has 2025 as current and 2026 as not-current. Admin B's desktop2 still shows 2026 as current (cache). Admin B signs out, signs back in later → restart → refresh → sees 2025 as current (server's actual state) → confusion: "I set 2026 yesterday, why is it 2025 now?"
- **Intended responsibility:** The cache should be invalidated (or re-seeded) when the underlying table changes server-side. The canonical pattern is realtime subscription + invalidation.
- **Actual responsibility:** The cache is seeded once at app start. Local writes refresh it. Remote writes are invisible until app restart. Conflict resolution is last-write-wins at the server, with both clients unaware of each other.
- **Dependents / consumers:** Academic year selector UI (used in dashboard, reports, parent profile). `getCurrentYear` (line 84) returns the year with `is_current = true` from the server (queries directly, not from cache) — but other code paths use `observeAll()` which returns the cache.
- **Alternative implementations of same operation:**
  - Website: `useAcademicYears` would query directly (no cache; TanStack Query handles caching). Realtime subscription would invalidate on remote change. (Though the website's realtime hooks don't include academic_years — so the website has the same staleness issue.)
  - Android: `LocalAcademicYearRepository` reads from Room (local cache). `pullAll` refreshes Room every 15 min. So Android is also stale up to 15 min.
- **Behavioral differences:** Desktop: stale until restart (could be days/weeks if app stays open). Android: stale up to 15 min. Website: stale indefinitely within a session (no realtime on academic_years). All three platforms are stale for academic_years — desktop is the worst.
- **Git evidence:** supabase-academic-repository.ts last touched in `84dd13f okay` (2026-08-27). The Subject + refresh pattern was the original design; realtime was never added.
- **Likely root cause:** Same as CROSS-104: the Subject pattern was inherited from the mock repository (which is the source of truth and doesn't need realtime). When the Supabase-backed repository was implemented, the same pattern was copied with the implicit assumption that "realtime subscriptions can be layered on later" — the later never happened.
- **Potential impact:** Two admins concurrently editing the academic year configuration can silently overwrite each other's changes. The `is_current` flag is a critical singleton — if it's wrong, the entire academic year's data (homework due dates, installment due dates, grade term structure) is computed against the wrong year. The website's `useInstallments` and `useHomework` queries filter by `academic_year` — if the desktop's current-year selection is wrong, the website shows the wrong year's data to parents.
- **Code snippet:**
```typescript
// supabase-academic-repository.ts:54-160 — Subject + refresh-on-write (no realtime)
export class SupabaseAcademicYearRepository implements AcademicYearRepository {
  private readonly subject = new SubjectBehavior<AcademicYear[]>([]);

  constructor(private readonly client: SupabaseClient) {
    this.refresh();  // <-- seeded ONCE at construction (app start)
  }

  private async refresh(): Promise<void> {
    const { data } = await this.client.from("academic_years").select("*").order("start_date", { ascending: false });
    if (data) this.subject.set(data.map(mapAcademicYearRow));
    // <-- local cache updated. NO realtime subscription to catch remote changes.
  }

  observeAll(): Observable<AcademicYear[]> { return this.subject; }  // <-- returns stale cache

  async setCurrentYear(id, ...) {
    await this.client.from("academic_years").update({ is_current: false }).eq("tenant_id", getTenantId()).filter("id", "neq", id);
    const { data, error } = await this.client.from("academic_years").update({ is_current: true, ... }).eq("id", id).select().single();
    if (error) return Err(...);
    await this.refresh();  // <-- refreshes LOCAL cache after the write, but doesn't help against concurrent remote writes
    return Ok(...);
  }
  // <-- NO `client.channel("realtime").on("postgres_changes", ...)` anywhere in this file.
}
// Same pattern as SupabasePaymentRepository (CROSS-104): seeded once, never re-seeded from server.
```
- **Confidence:** Confirmed

Stage Summary:
- 17 new findings total (SYNC-100..107, REALTIME-100..104, CACHE-100..103)
- Severity breakdown:
  - Critical: 5 (SYNC-100, SYNC-104, SYNC-105, REALTIME-101, REALTIME-104)
  - High: 8 (SYNC-101, SYNC-102, SYNC-103, SYNC-106, SYNC-107, REALTIME-100, REALTIME-102, CACHE-100, CACHE-103)
  - Medium: 4 (REALTIME-103, CACHE-101, CACHE-102, SYNC-104 reassessed to High)
  - Low: 0
- Top 5 critical new findings:
  1. **SYNC-100**: Desktop defaultPushHandler silently drops installment (and homework/grade/attendance) entity kinds — migration 0037 explicitly fixed Android but desktop dispatcher was never updated; Excel importer's "installment" entries are silently lost.
  2. **SYNC-104**: Android FCM token never unregistered on signOut — device_tokens row stays active for the old user; shared-device privacy leak (next holder sees previous user's notifications).
  3. **SYNC-105**: Website signOut uses `scope: "global"` (revokes ALL sessions across all devices) AND doesn't call `unregisterDeviceToken` — cross-device session kill + orphaned FCM token leak to next browser user.
  4. **REALTIME-101**: Website markRead effect's UPDATE on chat_messages is RLS-denied for incoming messages (policy `chat_messages_update_own` requires `author_id = current_user_profile_id()`); read receipts NEVER persist server-side; errors silently swallowed — unread badge never clears.
  5. **REALTIME-104**: Android has ZERO Supabase realtime subscriptions (verified via repo-wide grep); relies entirely on 15-min `pullAll` cycle — website has 4 realtime hooks (2 broken); desktop has 0 (all Subject-based caches, same as CROSS-104).

- Findings that extend or contradict first-pass (2-a/2-b/2-c) or second-pass (3-A/3-B) findings:
  - **CACHE-103** extends **CROSS-104** (3-A): CROSS-104 documented the no-realtime pattern for `SupabasePaymentRepository`. CACHE-103 documents the same pattern for `SupabaseAcademicYearRepository` — showing the pattern is systemic across the desktop's Supabase-backed repositories, not isolated to payments.
  - **SYNC-100** extends **CROSS-200** (3-A): CROSS-200 documented the Android sync dispatcher swallowing RPC errors. SYNC-100 documents a parallel desktop bug: the desktop dispatcher silently drops entire entity KINDS (not just errors) — entries that should be pushed are silently no-op'd. Same end result (silent data loss), different root cause (incomplete switch statement vs. discarded response).
  - **REALTIME-101** extends **WEAK-014** (2-c): WEAK-014 documented the `send-push-notification` EF querying `device_tokens` by the wrong column (`user_profile_id` vs canonical `user_id`). REALTIME-101 documents a parallel column-confusion bug: the chat markRead effect's UPDATE is denied by RLS because the policy expects `author_id = current_user_profile_id()` but the UPDATE targets rows authored by OTHER users. The systemic issue: the codebase has multiple places where a column-name assumption doesn't match the canonical schema/RLS.
  - **REALTIME-102** extends **WEAK-016** (2-c): WEAK-016 documented `useHomeworkRealtime` subscribing to the wrong table (`homework_assignments` legacy vs `homework` canonical). REALTIME-102 documents a parallel filter-mismatch bug: `useNotificationsRealtime`'s filter `target_user_id=eq.${user.id}` is too narrow — it misses role-broadcast notifications (target_user_id IS NULL, target_role IS NOT NULL). The systemic issue: the website's realtime filters don't account for the full schema semantics.
  - **CACHE-100** extends **WEAK-016** (2-c) + **REALTIME-100** (3-C this pass): the website's TanStack Query config (`refetchOnWindowFocus: false` + `staleTime: 30s`) puts ALL freshness eggs in the realtime basket. When realtime is broken (per WEAK-016, REALTIME-100, REALTIME-101, REALTIME-102, REALTIME-103), there's NO fallback path. The config is fragile-by-design.
  - **SYNC-103** extends **ARCH-003** (2-b): ARCH-003 documented that Android binds ALL repositories to `Local*Repository` (Room-first), bypassing canonical RPCs. SYNC-103 documents a parallel issue in the sync layer: `tryThenEnqueue`'s error-classification logic (only network/offline/timeout errors get enqueued; 5xx and validation errors are silently lost) — same Room-first architecture's failure mode.
  - **SYNC-105** extends **WEAK-101** (3-B): WEAK-101 documented Android's `LocalAuthRepository` storing user UUID as a fake JWT (doesn't validate server-side). SYNC-105 documents the website's parallel auth-coherence issue: `signOut({ scope: "global" })` revokes ALL sessions across all devices (a different but related auth-coherence bug — the website's sign-out is OVER-aggressive where the Android's is UNDER-validating).


---

Task ID: 3-F
Agent: forensic-auditor-F (Parent/Student + Tenancy + Multi-tenant Isolation end-to-end)
Task: Deep second-pass audit of parent/student/tenancy flows across all 3 platforms

Work Log:
- Read shared worklog (4700 lines, 86 first-pass findings + 30 second-pass findings across 3-A and 3-B).
- Re-confirmed prior findings NOT to repeat: SEC-008 (`enforce_parent_self_update_columns` trigger), DEAD-100 (`fn_current_tenant_id()` never-set session setting — structural), SEC-101 (revert_payment_allocation no tenant check), SEC-108 (`handle_new_auth_user` trusts `raw_app_meta_data.tenant_id`), SEC-110 (`bind_activation_code` accepts any p_auth_user_id), CROSS-200 (Android sync swallows errors).
- Mapped schema: tenants/user_profiles/account_approval_requests/role_assignments (0002 + 0003); parents/students/parent_student_links/activation_codes (0005); RLS policies (0019); portal alignment patches (0043); academic hist + assessments (0029 + 0041).
- Traced parent signup end-to-end: Google OAuth → `handle_new_auth_user` trigger → user_profiles(pending) + account_approval_requests(pending) → admin approves via `approve-signup-request` EF → `approve_account_request` SQL RPC → user_profiles(active) + role_assignments + parents.auth_user_id bound. OR self-activate via `bind-activation-code` EF → `bind_activation_code` SQL RPC → activation_codes.bound + parents.auth_user_id (EF separately flips user_profiles.status='active' + inserts role_assignments).
- Traced parent ↔ student linkage: canonical is `students.parent_id` (single FK, 0005:57). `parent_student_links` junction table (0005:89-98) is defined + has RLS (0019:400-410) but has ZERO writers/readers across all 3 repos — multi-guardian feature structurally unimplemented.
- Traced student CRUD: desktop `SupabaseStudentRepository.createStudent/updateStudent/deleteStudent` (supabase-shared-repositories.ts:625-812); Android `LocalStudentRepository.createStudent/updateStudent` (LocalRepositories.kt:462-558); website reads students via auth-provider.tsx:169-174 (`WHERE parent_id = parentRow.id` — correct, parents.id UUID, not user UUID).
- Traced tenant isolation: `current_tenant_id()` (0003:120-130) resolves via `auth.uid() → user_profiles.tenant_id` (works). `fn_current_tenant_id()` (0029:166-170) reads `current_setting('app.current_tenant_id', true)` — NEVER SET anywhere (grep'd all 3 repos, zero `set_config` calls). 0029 RLS policies using `fn_current_tenant_id()` are inert (always deny), but masked by 0019 policies that use `current_tenant_id()` on the SAME tables (Postgres OR's them) — EXCEPT on `student_academic_histories`, which is created in 0029 and has ONLY the broken policy.
- Identified 13 NEW findings (TENANT-100..TENANT-106, PARENT-100..PARENT-103, STUDENT-100..STUDENT-101, DEAD-200). None restate prior findings; several extend DEAD-100 / SEC-110 / DRIFT-001 / WEAK-011 with concrete user-facing breakage traces.

Findings:

### FINDING TENANT-100 — `current_user_roles()` ignores tenant_id → cross-tenant role inheritance

- **What:** The `current_user_roles()` SQL function (0003 line 132-142) queries `role_assignments WHERE user_profile_id = current_user_profile_id() AND revoked_at IS NULL` — with NO `tenant_id` filter. All roles a user holds across ALL tenants are merged into a single text[]. RLS policies that check `has_role('super_admin')` or `has_any_role([...])` cannot distinguish which tenant the role applies to. The companion `current_user_permissions()` (0003 line 144-175) has the same flaw — it queries role_assignments by user_profile_id only.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0003_rbac.sql:132-142` (function definition). Consumers include: `0019_rls_policies.sql:46` (tenants_select), `:51` (tenants_update), `:55` (tenants_insert), `:60` (tenants_delete), `:71` (user_profiles_select_own), `:79-82` (user_profiles_admin_update), `:120` (sessions_select_own), `:354` (parents_delete), `:398` (students_delete), `0043_portal_alignment.sql:146` (attendance_parent_update_justification), `:213` (student_documents_parent_select), `:247` (parents_self_update).
- **How reached:** Attacker signs up via Google OAuth with `raw_app_meta_data.tenant_id = <victim_tenant>` (per SEC-108) → `handle_new_auth_user` creates `user_profiles.tenant_id = victim_tenant_id`, `account_approval_requests.tenant_id = victim_tenant_id`. Victim-tenant admin approves → `approve_account_request` inserts `role_assignments(user_profile_id=attacker, tenant_id=victim_tenant, role_id=parent_role_id)`. Attacker signs in via Google OAuth → `current_user_roles()` queries role_assignments by user_profile_id (no tenant filter) → returns `['parent']`. Now, ANY RLS policy that checks `has_role('super_admin')` (without a tenant_id guard) returns true IF the user has that role in ANY tenant. For a per-tenant super_admin, they're super_admin for RLS purposes everywhere.
- **Intended responsibility:** Per the 0003 comment line 14 ("a user may hold different roles across tenants"), the function should filter role_assignments by the current operating tenant. But `current_tenant_id()` returns the user's `user_profiles.tenant_id` (a single fixed value) — there's no concept of "operating tenant" the user can switch between.
- **Actual responsibility:** Returns the union of all roles across all tenants. A super_admin in tenant A is super_admin everywhere RLS checks the role.
- **Dependents / consumers:** Every RLS policy that calls `has_role` / `has_any_role` — most are tenant-filtered (`tenant_id = current_tenant_id() AND has_role(...)`) so the bug is masked. The unmasked consumers are the policies WITHOUT a tenant_id filter — see TENANT-101, TENANT-102 below.
- **Alternative implementations of same operation:** `current_tenant_id()` (0003:120-130) DOES resolve via `user_profiles.tenant_id` — single fixed tenant per user. There's no API for the user to switch operating tenants.
- **Behavioral differences:** Single-tenant deployment (everyone in same tenant) — bug is invisible. Multi-tenant deployment — a tenant-A super_admin escalates to global admin powers for any RLS policy lacking tenant_id filter.
- **Git evidence:** 0003_rbac.sql introduced in commit `b25e6ca` (2026-08-04, "FKFKFK").
- **Likely root cause:** The function was written assuming a 1:1 user-tenant mapping (user_profiles.tenant_id is fixed at signup). The function never anticipated per-tenant role switching; the schema's `role_assignments.tenant_id` column was intended to support multi-tenant roles but the resolver ignored it.
- **Potential impact:** Combined with TENANT-101 (user_profiles_admin_update no tenant check) and TENANT-102 (tenants_select no tenant check), a tenant-A super_admin has god-level access to user_profiles and tenants across ALL tenants. Cross-tenant admin operations are unguarded. The bug is invisible until a second tenant is provisioned.
- **Code snippet:**
```sql
-- 0003_rbac.sql:132-142 — current_user_roles (NO tenant_id filter)
create or replace function public.current_user_roles()
returns text[]
language sql
stable
as $$
    select coalesce(array_agg(r.code), '{}')
    from public.role_assignments ra
    join public.roles r on r.id = ra.role_id
    where ra.user_profile_id = public.current_user_profile_id()
      and ra.revoked_at is null;
    -- ↑ NO `and ra.tenant_id = public.current_tenant_id()` predicate.
    -- All roles across all tenants are merged into one array.
$$;

-- Companion flaw in current_user_permissions() (0003:144-175):
--   role_ids CTE filters role_assignments by user_profile_id only (no tenant_id).
--   The tenant_role_overrides CTE filters by current_tenant_id() — but the
--   role_ids CTE is the entry point, so a role held in tenant A still flows
--   into permissions computed against tenant B's overrides.
```
- **Confidence:** Confirmed (read function body, verified no tenant_id predicate)

### FINDING TENANT-101 — `user_profiles_admin_update` RLS policy has no tenant_id check → cross-tenant user modification

- **What:** The RLS policy `user_profiles_admin_update` (0019 line 79-82) is `USING (public.has_role('super_admin')) WITH CHECK (public.has_role('super_admin'))` — neither clause constrains by `tenant_id`. Combined with TENANT-100 (current_user_roles ignores tenant), any user with `super_admin` role in ANY tenant can UPDATE any user_profiles row across ALL tenants.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:79-82`. Same no-tenant-check pattern on `tenants_update` (line 49-52), `tenants_insert` (line 54-56), `tenants_delete` (line 58-60).
- **How reached:** Tenant-A super_admin (signed in via Supabase Auth, JWT valid) → `client.from('user_profiles').update({ status: 'suspended' }).eq('id', '<victim_user_profile_id_in_tenant_B>')` → PostgREST runs the UPDATE → RLS USING clause evaluates: `has_role('super_admin')` → `current_user_roles()` returns roles from ALL tenants → contains 'super_admin' → true → USING passes → WITH CHECK passes → row updated. Victim in tenant B is now suspended.
- **Intended responsibility:** Per the 0019 comment line 20-21 ("user_profiles: tenant_id may be NULL for global admins; reads check `tenant_id IS NULL OR tenant_id = current_tenant_id()`"), the policy was meant for global admins (user_profiles.tenant_id IS NULL). But it doesn't restrict to global admins — it allows any super_admin.
- **Actual responsibility:** A tenant-scoped super_admin has god-level UPDATE access to every user_profiles row in the database. They can: (1) suspend any user in any tenant; (2) change any user's email (breaks Google OAuth sign-in for them); (3) MOVE a user to a different tenant (`UPDATE user_profiles SET tenant_id = 'tenant-A' WHERE id = '<victim>'` — tenant-hopping exploit); (4) detach a user's auth_user_id (`UPDATE user_profiles SET auth_user_id = '<random_uuid>'` — severs the link between the auth user and the user_profiles row).
- **Dependents / consumers:** The desktop's user-management UI (if any), the bind-activation-code EF (uses service_role, bypasses RLS — not affected), the approve_account_request SQL function (SECURITY DEFINER, bypasses RLS — not affected). Direct client-side UPDATE on user_profiles is rare in current code paths but the policy is the latent risk.
- **Alternative implementations of same operation:** `user_profiles_select_own` (line 67-72) DOES check `tenant_id = current_tenant_id()` for staff reads of OTHER users. So the SELECT side is tenant-scoped; only the UPDATE side is wide open. An attacker can MODIFY without being able to SELECT first — they'd need to know the victim's user_profile_id UUID by another channel (leaked email, brute force, etc.).
- **Behavioral differences:** SELECT — protected by tenant filter. UPDATE — wide open. Asymmetric policy. The author may have intentionally allowed global super_admin updates but didn't restrict to global admins (user_profiles.tenant_id IS NULL).
- **Git evidence:** 0019_rls_policies.sql introduced in commit `b25e6ca` (2026-08-04).
- **Likely root cause:** The author intended `user_profiles_admin_update` to be the "global admin bypass" — for global admins whose user_profiles.tenant_id IS NULL. They forgot that `has_role('super_admin')` returns true for ANY per-tenant super_admin (per TENANT-100).
- **Potential impact:** Cross-tenant privilege escalation. A super_admin of tenant A can: (1) suspend any user in any tenant (DoS); (2) change a tenant-B user's email (account takeover if combined with email-based password reset, but this codebase uses Google OAuth so the email change just breaks sign-in); (3) MOVE a user from tenant B to tenant A — the user's `current_tenant_id()` becomes A, and they now see tenant A's data (tenant-hopping); (4) detach auth_user_id — user can no longer sign in via Google OAuth.
- **Code snippet:**
```sql
-- 0019_rls_policies.sql:79-82 — user_profiles_admin_update: NO tenant_id check
create policy user_profiles_admin_update on public.user_profiles
    for update to authenticated
    using (public.has_role('super_admin'))
    with check (public.has_role('super_admin'));
-- ↑ no `tenant_id = current_tenant_id()` predicate in either clause.

-- COMPARE: user_profiles_select_own (0019:67-72) — DOES have the tenant check:
create policy user_profiles_select_own on public.user_profiles
    for select to authenticated
    using (
        id = public.current_user_profile_id()
        or (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']))
        -- ↑ tenant_id check present
    );
```
- **Confidence:** Confirmed

### FINDING TENANT-102 — `tenants_select` lets any per-tenant super_admin enumerate ALL tenants (extends TENANT-100)

- **What:** The RLS policy `tenants_select` (0019 line 42-47) is `USING (id = current_tenant_id() OR has_role('super_admin'))`. Combined with TENANT-100, any super_admin in any tenant can SELECT ALL tenant rows — names, slugs, addresses, emails, logos, default_locale, etc. The sister policies `tenants_update` (line 49-52), `tenants_insert` (line 54-56), `tenants_delete` (line 58-60) all use `has_role('super_admin')` without tenant check — a per-tenant super_admin can UPDATE/INSERT/DELETE tenant rows in any tenant, with `tenants_delete` cascading to ALL of that tenant's data via `on delete cascade` FKs.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:42-60`.
- **How reached:** Tenant-A super_admin signs in → `client.from('tenants').select('*')` → RLS USING: `id = current_tenant_id() OR has_role('super_admin')` — second branch true (per TENANT-100) → all tenant rows returned. For destructive operations: `client.from('tenants').delete().eq('id', '<tenant_B_uuid>')` → RLS USING passes → DELETE → ON DELETE CASCADE drops every tenant-scoped row referencing tenant_B (parents, students, payments, ledger_entries, installments, attendance_records, assessments, homework, etc. — all tenant-scoped tables in 0005, 0007, 0008, 0009, 0010, 0011, 0012, 0013, 0029, etc.).
- **Intended responsibility:** Per the 0019 comment line 19 ("tenants: only SuperAdmin reads"), the policy intends super_admin to see all tenants. The author assumed 'super_admin' was a single global role.
- **Actual responsibility:** Every per-tenant super_admin is effectively a global super_admin for tenant enumeration AND tenant mutation AND tenant deletion.
- **Dependents / consumers:** The desktop's tenant-switcher (if any). The seed-data bootstrap (0023 inserts the demo tenant). The website's middleware (which might query tenants for routing).
- **Alternative implementations of same operation:** None — `tenants` is the root, has no `tenant_id` column to filter on. The author intended the role check to be the filter, but didn't realize the role resolver ignores tenant.
- **Behavioral differences:** `tenants_select` — informational leak (tenant metadata: name, slug, address, email, phone). `tenants_delete` — destructive cascading data loss across every tenant-scoped table.
- **Git evidence:** 0019 introduced in `b25e6ca` (2026-08-04).
- **Likely root cause:** Same as TENANT-100 — author didn't anticipate per-tenant super_admins.
- **Potential impact:** (1) Information leak: a malicious tenant-A admin sees the names/addresses/emails of all other tenants (e.g., a competing school using the same Supabase instance). (2) Destructive: `DELETE FROM tenants WHERE id='tenant-B-uuid'` → cascades to ALL of tenant B's data — every parent, student, payment, ledger entry, attendance record, grade, homework assignment — permanently gone. (3) The `tenants_select` enumeration also enables the TENANT-101 attack — once an attacker knows tenant B's UUID, they can target user_profiles in tenant B.
- **Code snippet:**
```sql
-- 0019_rls_policies.sql:42-47 — tenants_select: cross-tenant enumeration
create policy tenants_select on public.tenants
    for select to authenticated
    using (
        id = public.current_tenant_id()
        or public.has_role('super_admin')  -- ← true for ANY per-tenant super_admin (TENANT-100)
    );

-- 0019:58-60 — tenants_delete: cross-tenant data destruction
create policy tenants_delete on public.tenants
    for delete to authenticated
    using (public.has_role('super_admin'));  -- ← no tenant_id check, cascading delete
```
- **Confidence:** Confirmed

### FINDING TENANT-103 — Desktop's `getTenantId()` falls back to DEMO UUID when session is missing or user is a global admin

- **What:** The desktop's `getTenantId()` (supabase-shared-repositories.ts line 132-140) returns `TENANT_FALLBACK = "00000000-0000-0000-0000-000000000001"` whenever localStorage has no session OR the session has no `tenantId`. The fallback fires for two cases: (1) pre-login (no session yet) — every desktop query targets the demo tenant; (2) a global admin whose `user_profiles.tenant_id IS NULL` — `session.tenantId` is null, so `getTenantId()` returns the demo UUID. The desktop cannot support global admins.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:120-140` (constant + function); 22 call sites in the same file (lines 413, 483, 635, 686, 882, 922, 955, 1001, 1045, 1150, 1183, 1288, 1322, 1403, 1504, 1566, 1600, 1658, 1925, 2216, 2272, 2396, 2489, 2581).
- **How reached:** (a) Pre-login: app starts → auth-provider tries to restore session → localStorage empty → `getTenantId()` returns DEMO UUID → every `client.from('parents').select('*').eq('tenant_id', DEMO_UUID)` query runs against the demo tenant. RLS may deny (the user isn't authenticated yet) — but the QUERY targets the demo tenant. (b) Post-login as global admin: `session.tenantId` is null → `getTenantId()` returns DEMO UUID → desktop queries demo tenant. RLS denies (because `current_tenant_id()` returns NULL → `tenant_id = NULL` is NULL → deny). The desktop's UI shows empty lists for global admins.
- **Intended responsibility:** Per the 0002 comment line 20-21 ("user_profiles: tenant_id may be NULL for global admins"), global admins are an intended concept. The desktop should support them — either by letting them switch tenants or by aggregating across all tenants.
- **Actual responsibility:** Global admins see the demo tenant's data (via the fallback). RLS denies access (because `current_tenant_id()` returns NULL for them). The desktop's UI is unusable for global admins.
- **Dependents / consumers:** 22 repository call sites. Every desktop list query (parents, students, payments, ledger entries, installments, classes, subjects, homework, attendance, assessments, audit logs) uses `getTenantId()` for tenant scoping.
- **Alternative implementations of same operation:** The Android version (`LocalAuthRepository` line 113) uses `profile?.tenantId ?: "00000000-0000-0000-0000-000000000001"` — same demo-UUID fallback. The website (`auth-provider.tsx` line 144-149) does NOT pass tenant_id to the parents query — it queries by `auth_user_id = auth.uid()` and lets RLS filter by tenant. So the website is safe from this fallback.
- **Behavioral differences:** Pre-login — demo tenant queries, RLS denies, empty UI. Post-login global admin — demo tenant queries, RLS denies, empty UI. Post-login per-tenant admin — real tenant queries, RLS allows, normal UI.
- **Git evidence:** supabase-shared-repositories.ts last touched `84dd13f` (2026-08-27, "okay"); the constant introduced in `b25e6ca` (2026-08-04).
- **Likely root cause:** The author assumed every user has a non-null tenant_id. The global-admin concept (per 0002 line 20-21) was never wired into the desktop client. The fallback was a dev convenience (default to the seed tenant) that ships in production.
- **Potential impact:** (1) Global admins can't use the desktop. (2) Pre-login queries leak demo tenant metadata (parent names, phone numbers, payment amounts) into the desktop's local cache if RLS is misconfigured or bypassed. (3) The magic constant `00000000-0000-0000-0000-000000000001` is normalized across the codebase (also in Android's LocalRepositories + DatabaseSeeder + audit() helper + PullSyncRepository fallback + 0041's set_assessments_tenant fallback) — making it impossible to add a real second tenant without auditing every fallback.
- **Code snippet:**
```typescript
// supabase-shared-repositories.ts:120-140
const TENANT_FALLBACK = "00000000-0000-0000-0000-000000000001";

function getSessionFromStorage(): { tenantId?: string; userId?: string; displayName?: string } | null {
  try {
    const raw = localStorage.getItem("el-imtiyaz.session");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function getTenantId(): string {
  try {
    const sess = getSessionFromStorage();
    if (sess?.tenantId) return sess.tenantId;  // ← null/undefined for global admin → fall through
  } catch { /* ignore */ }
  return TENANT_FALLBACK;  // ← demo tenant UUID — masks global-admin support
}
```
- **Confidence:** Confirmed

### FINDING TENANT-104 — Android `LocalParentRepository.createParent` hardcodes tenant_id = DEMO UUID for local Room entity

- **What:** The Android's `LocalParentRepository.createParent` (LocalRepositories.kt line 380, 384) creates a `ParentEntity` with `tenantId = "00000000-0000-0000-0000-000000000001"` regardless of the signed-in user's actual tenant. The same hardcoding appears in `LocalStudentRepository.createStudent` (line 501, 576, 580, 608), `LocalPaymentRepository.collect` (line 955), the `audit()` helper (line 1545, 1553), and 30+ other sites in LocalRepositories.kt + LocalRepositories2.kt. The local cache rows are stamped with the DEMO tenant UUID even when the user is signed in to a different tenant.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:380, 384, 501, 576, 580, 608, 955, 1179, 1266, 1545, 1553`; `LocalRepositories2.kt:146, 693, 805, 852, 886, 976, 1055, 1150, 1198, 1272, 1408, 1466, 1570, 1735, 1954`. Also `DatabaseSeeder.kt:35`. Also `SharedDtoMappers.kt:144, 164, 185, 206, 218, 237, 254, 268, 295` (DTO-to-entity mappers default to demo UUID when DTO has null tenant_id).
- **How reached:** Android user in tenant B creates a parent via batch-registration screen → `LocalParentRepository.createParent` → `ParentEntity(tenantId = "00000000-...", ...)` → `parentDao.upsert(entity)`. Local Room DB now has the parent with DEMO tenant_id. Then `syncSupport?.enqueueOnly(entity="parent", operation="create", payload=...)` → `SyncService.enqueue` → `SyncQueueEntity(tenantId = sessionManager.currentTenantId() = B, ...)` (correct). `SyncQueueDispatcher.pushParent` (line 145-164) uses `entry.tenantId = B` for `p_tenant_id` — server gets the parent in tenant B (correct). But the LOCAL CACHE has tenant_id = DEMO until the next pull sync overwrites it.
- **Intended responsibility:** The local entity should reflect the signed-in user's actual tenant_id (from `sessionManager.currentTenantId()`), so the local cache matches the server's tenant scoping. The hardcoding was a placeholder for "demo mode" that was never replaced when real auth was wired in.
- **Actual responsibility:** Local Room entities are stamped with DEMO UUID. Local cache and server disagree on tenant_id until the next pull sync (which overwrites local rows with server data — converging eventually). Pre-pull, the local cache has wrong tenant_id metadata.
- **Dependents / consumers:** The Android UI reads `parentDao.observeAll()` (no tenant filter) → returns ALL parents in the local cache regardless of tenant_id. If two users share a device (or one user signs in to multiple tenants), the cache accumulates parents from different tenants, all stamped with DEMO tenant_id. The user sees them all in the list — cross-tenant data leak via the local cache.
- **Alternative implementations of same operation:** The Android's `PullSyncRepository.pullParents` (line 36) DOES use `sessionManager.currentTenantId() ?: DEMO_UUID` — correct. The Android's `SyncService.enqueue` (line 69) DOES use `sessionManager.currentTenantId()` — correct. So pull sync and sync enqueue use the session tenant, but local creation uses the hardcoded DEMO UUID. The desktop's `SupabaseParentRepository.createParent` (line 483) uses `getTenantId()` (which falls back to DEMO only when session is missing — see TENANT-103). The desktop's pattern is at least defensible (fallback only when no session); the Android's pattern is unconditional hardcoding.
- **Behavioral differences:** Pre-sync (just created locally, not yet pushed): local has tenant_id=DEMO, server has nothing. Post-sync: local has tenant_id=DEMO, server has tenant_id=B (correct). Post-next-pull: local has tenant_id=B (server overwrote it). The window of inconsistency is the local-only period, which can be indefinite if the device is offline.
- **Git evidence:** LocalRepositories.kt last touched `94471e8` (2026-08-28). The hardcoded demo UUID has been there since `2e2b21a` (2026-08-28) per git blame.
- **Likely root cause:** The local Room repositories were written before real auth was wired in. The hardcoded DEMO UUID was a placeholder. The author added `sessionManager.currentTenantId()` to PullSyncRepository and SyncService but forgot to update the `Local*Repository.create*` methods. This is the parent/student-data-side equivalent of WEAK-011 (audit helper hardcodes demo UUID).
- **Potential impact:** (1) Local cache shows wrong tenant_id metadata — UI displays "tenant: demo" for a real user's parent. (2) Cross-tenant data leak via shared local cache when a device is used by multiple users (e.g., a tablet shared between two tenant admins). (3) Combined with WEAK-011 (audit helper also hardcodes demo UUID), every local audit log entry has the wrong tenant_id. (4) The local cache can't be reliably filtered by tenant — any per-tenant local query is broken.
- **Code snippet:**
```kotlin
// LocalRepositories.kt:378-398 — createParent with HARDCODED tenant
val activationCode = com.example.core.deterministicActivationCode(
    parentCode = code,
    tenantId = "00000000-0000-0000-0000-000000000001",  // ← HARDCODED, ignores session
)
val entity = ParentEntity(
    id = "par-${UUID.randomUUID()}",
    tenantId = "00000000-0000-0000-0000-000000000001", code = code,  // ← HARDCODED
    firstName = input.firstName, lastName = input.lastName,
    // ...
)
parentDao.upsert(entity)
```
- **Confidence:** Confirmed (extends WEAK-011 to parent/student/payment local cache)

### FINDING TENANT-105 — `set_assessments_tenant` trigger falls back to DEMO UUID when fn_current_tenant_id() is NULL (extends DEAD-100 with concrete failure mode)

- **What:** Migration 0041 (line 88-110) defines the trigger function `set_assessments_tenant()` which fires BEFORE INSERT on `public.assessments`. If `NEW.tenant_id IS NULL`, it tries to derive from `student_id` (via students table). If that also fails (student_id is NULL or doesn't exist), it falls back to `COALESCE(public.fn_current_tenant_id(), '00000000-0000-0000-0000-000000000001')`. Since `fn_current_tenant_id()` always returns NULL (DEAD-100 — never-set session setting), the trigger stamps the assessment with the DEMO tenant UUID whenever `student_id` is NULL or invalid.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0041_canonical_academic_flow.sql:88-110` (function + trigger).
- **How reached:** Android user pushes an assessment via the grade-entry sync flow → `SyncQueueDispatcher.pushGrade` (line ~370+) → RPC or direct table upsert into `public.assessments`. The desktop's `SupabaseAcademicRepository.createAssessment` also inserts. Both OMIT `tenant_id` from the payload (per the comment at 0041 line 86-87: "canonical writers do not send tenant_id"). The trigger fires. If `student_id` resolves to a real student → `NEW.tenant_id = students.tenant_id` (correct). If `student_id` is NULL or doesn't exist → `NEW.tenant_id = DEMO UUID` (silent corruption).
- **Intended responsibility:** The trigger should derive tenant_id from the student's tenant. If the student can't be resolved, the INSERT should FAIL (raise exception), not silently assign to the DEMO tenant.
- **Actual responsibility:** Buggy orphans land in the DEMO tenant. The DEMO tenant's `assessments_select` policy (0029:192-194, also broken via DEAD-100) actually DENIES — but the 0019 `assessments_select` policy (line ~470, working) is OR'd in. DEMO-tenant staff can read the orphan assessment. Cross-tenant data leak.
- **Dependents / consumers:** All assessment queries filter by `tenant_id = current_tenant_id()` (0019 policy). Assessments in DEMO tenant are visible to DEMO-tenant staff only. If no DEMO-tenant staff exists, the orphans are unreadable. The trigger also doesn't write an audit log entry for the fallback.
- **Alternative implementations of same operation:** The 0043 line 333-340 `set_notification_preference_tenant` trigger has a similar pattern but uses `user_profiles.tenant_id` as the source (instead of falling back to DEMO UUID). The 0041 `set_assessments_tenant` is unique in its DEMO-UUID fallback.
- **Behavioral differences:** Normal flow (student_id valid) — trigger populates correctly. Buggy flow (student_id NULL or points to deleted student) — trigger populates DEMO UUID silently. The desktop/Android never know the assessment landed in the wrong tenant.
- **Git evidence:** 0041 introduced in commit `9e1e7741` (2026-08-12, "kay").
- **Likely root cause:** The trigger was written knowing that `fn_current_tenant_id()` is broken (DEAD-100). The author added the COALESCE fallback as a "safe default" — but the safe default is the DEMO tenant, not an exception. The author conflated "no tenant context" with "the demo tenant" — they're not the same in a multi-tenant deployment.
- **Potential impact:** (1) Orphan assessments (created by buggy callers passing invalid student_id) pollute the DEMO tenant. (2) If the DEMO tenant has real users (per 0023_seed.sql it's the production tenant for El-Imtiyaz Boumerdès), those users see the orphan assessments in their grade lists — data corruption. (3) Audit trail: the orphan assessment has `tenant_id = DEMO UUID` — making it look like a legitimate DEMO-tenant record. The trigger also doesn't write an audit log entry for the fallback. (4) Financial implications: assessments drive GPA → promotion decisions → tuition pricing. Orphan assessments in DEMO tenant skew DEMO-tenant GPA calculations.
- **Code snippet:**
```sql
-- 0041_canonical_academic_flow.sql:88-110
CREATE OR REPLACE FUNCTION public.set_assessments_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        IF NEW.student_id IS NOT NULL THEN
            SELECT s.tenant_id INTO NEW.tenant_id
              FROM public.students s WHERE s.id = NEW.student_id;
        END IF;
    END IF;
    IF NEW.tenant_id IS NULL THEN
        SELECT COALESCE(
            public.fn_current_tenant_id(),  -- ← always NULL (DEAD-100)
            '00000000-0000-0000-0000-000000000001'::uuid  -- ← DEMO tenant fallback
        ) INTO NEW.tenant_id;
        -- ↑ silently stamps DEMO tenant instead of raising an exception.
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessments_set_tenant ON public.assessments;
CREATE TRIGGER assessments_set_tenant
    BEFORE INSERT ON public.assessments
    FOR EACH ROW EXECUTE FUNCTION public.set_assessments_tenant();
```
- **Confidence:** Confirmed (extends DEAD-100 with concrete end-to-end failure mode)

### FINDING TENANT-106 — `student_academic_histories` table is INACCESSIBLE to authenticated users; desktop's batch promotion flow fails at the history upsert (extends DEAD-100 with concrete user-facing breakage)

- **What:** Migration 0029 (line 117-133) creates `public.student_academic_histories` with `tenant_id UUID NOT NULL` and NO trigger to auto-populate tenant_id. Migration 0029 (line 204-206) creates the ONLY RLS policy on this table: `rls_student_academic_histories_tenant FOR ALL USING (tenant_id = public.fn_current_tenant_id())`. Since `fn_current_tenant_id()` always returns NULL (DEAD-100), the policy's USING clause evaluates to NULL → DENY for every operation (SELECT, INSERT, UPDATE, DELETE). Authenticated users (the desktop's signed-in admin) CANNOT read or write this table at all. The desktop's batch promotion (`SupabasePromotionRepository.executeBatchPromotion`) tries to upsert into this table, gets the RLS denial, and aborts the entire promotion flow.
- **Where:** Schema: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:117-133` (table), `:163` (RLS enable), `:204-206` (broken policy). Consumer: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1172-1178` (`SupabasePromotionRepository.executeBatchPromotion` upserts into this table — and aborts the entire promotion on error).
- **How reached:** Desktop admin opens Promotion Review screen → selects students → clicks "Execute Promotion" → `useBatchPromotion.executePromotion` (use-batch-promotion.ts:85-117) → `repos.promotion.executeBatchPromotion` (supabase-academic-repository.ts:1111-1246) → constructs `historyPayloads` (line 1137-1149 — NO tenant_id field in the payload!) → `client.from('student_academic_histories').upsert(persistableHistory, { onConflict: 'student_id,academic_year' })` (line 1172-1178) → server-side: RLS WITH CHECK clause fires → `tenant_id = fn_current_tenant_id()` = `tenant_id = NULL` = NULL → DENY → upsert returns error → `if (historyErr) return Err(supabaseErrorToAppError(historyErr))` (line 1177) → promotion aborted → student UPDATE never runs → no student is promoted → user sees "Échec de la promotion" error toast.
- **Intended responsibility:** The 0029 migration intends the `student_academic_histories` table to be the permanent record of each student's year-end promotion decision (per the table comment line 115: "Append-only record of year-end student promotion/retention decisions"). RLS policy intends tenant isolation. The desktop's promotion flow intends to write history BEFORE advancing the student.
- **Actual responsibility:** The policy is dead code (always denies). The desktop's promotion flow hits the denial, aborts, and the user sees an error toast. NO student is promoted via the desktop. The Android path (STUDENT-100 below) silently drops the grade_level_code on sync push — also no promotion on the server.
- **Dependents / consumers:** `SupabasePromotionRepository.executeBatchPromotion` (line 1172-1178). The promotion review screen (`useBatchPromotion.executePromotion` at `features/academics/hooks/use-batch-promotion.ts:98-103`).
- **Alternative implementations of same operation:** The Android `LocalPromotionRepository.promoteStudents` (LocalRepositories.kt line 855-900) updates the local Room entity's gradeLevel and enqueues a sync push. The sync push via `SyncQueueDispatcher.pushStudent` calls `upsert_student_from_import` RPC — but that RPC has NO `p_grade_level_code` parameter (see STUDENT-100). So the server-side `students.grade_level_code` column is NEVER updated by either platform. The desktop's mock `AcademicRepository` (mock path) updates an in-memory list — but the mock path is dead in production (ARCH-001).
- **Behavioral differences:** Desktop — fails loudly (error toast). Android — succeeds locally + sync push silently drops grade_level_code field, server-side student record keeps the OLD grade_level_code. Both platforms fail to advance the student's grade on the server.
- **Git evidence:** 0029 introduced in commit `9e1e7741` (2026-08-12, "kay"). supabase-academic-repository.ts last touched `2e2b21a` (2026-08-28).
- **Likely root cause:** The migration author introduced `fn_current_tenant_id()` (new helper using `current_setting`) without realizing the existing `current_tenant_id()` (using `auth.uid()`) was the canonical resolver. The new helper requires the app to set `app.current_tenant_id` per-connection, which no one does. The desktop's promotion repo was written assuming the table is writable, didn't notice the dead RLS policy.
- **Potential impact:** (1) Year-end promotion is broken on the desktop — the school cannot promote students via the desktop UI. (2) The Android path silently creates a server/client drift: local student has new grade, server has old grade. (3) The academic_history is never persisted — the school loses the permanent record of promotion decisions. (4) Financial implications: pricing is grade-level-based — if the server has the wrong grade, the student is charged the wrong tuition amount. (5) Combined with STUDENT-100, this is a complete failure of the promotion feature across both platforms.
- **Code snippet:**
```sql
-- 0029_academics_module.sql:117-133 — table requires tenant_id NOT NULL
CREATE TABLE IF NOT EXISTS public.student_academic_histories (
    id UUID PRIMARY KEY DEFAULT public.gen_uuid(),
    tenant_id UUID NOT NULL,  -- ← required, no trigger to auto-populate
    student_id UUID NOT NULL,
    academic_year TEXT NOT NULL,
    cycle TEXT NOT NULL CHECK (cycle IN ('prescolaire', 'primaire', 'cem', 'lycee')),
    grade_code TEXT NOT NULL,
    grade_year INT NOT NULL,
    class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
    class_name TEXT,
    gpa NUMERIC(4, 2) NOT NULL CHECK (gpa >= 0 AND gpa <= 20),
    rank INT,
    decision TEXT NOT NULL CHECK (decision IN ('promoted', 'repeated', 'graduated', 'transferred')),
    narrative TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_academic_history_student_year UNIQUE (student_id, academic_year)
);

-- 0029:204-206 — broken RLS policy (always denies)
CREATE POLICY rls_student_academic_histories_tenant ON public.student_academic_histories
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());
    --               ↑ always NULL (DEAD-100) → policy always denies
    -- NOTE: NO 0019 policy on this table (0019 predates the table's creation).
    -- The ONLY policy is the broken 0029 one. The table is INACCESSIBLE.
```
```typescript
// supabase-academic-repository.ts:1172-1178 — desktop's promotion upsert
const { error: historyErr } = await this.client
    .from("student_academic_histories")
    .upsert(persistableHistory, {  // ← historyPayloads has NO tenant_id field!
        onConflict: "student_id,academic_year",
    });
if (historyErr) return Err(supabaseErrorToAppError(historyErr));
    // ← promotion aborts here; student UPDATE never runs.
```
- **Confidence:** Confirmed (extends DEAD-100 with concrete end-to-end user-facing breakage)

### FINDING STUDENT-100 — Android promotion sync push silently DROPS grade_level_code (RPC has no such parameter)

- **What:** When an Android user promotes a student (via `LocalPromotionRepository.promoteStudents` at LocalRepositories.kt line 855-900), the local Room entity's `gradeLevel` field is updated and a sync entry is enqueued with `entity="student", operation="promote"`. The `SyncQueueDispatcher.pushEntry` (line 52-98) routes by `entity` ONLY — it dispatches to `pushStudent` regardless of the `operation` field. `pushStudent` (line 167-191) constructs RPC params for `upsert_student_from_import`, but that RPC (0027 line 503-519) has NO `p_grade_level_code` parameter. So the new gradeLevel is silently dropped on sync push. The server-side `students.grade_level_code` column is NEVER updated by the Android path.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:855-900` (LocalPromotionRepository); `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:69-97` (pushEntry dispatch — ignores operation); `:167-191` (pushStudent — no grade_level_code); `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:503-519` (RPC signature — no p_grade_level_code param).
- **How reached:** Android user opens Promotion Review screen → selects students → clicks "Promote" → `LocalPromotionRepository.promoteStudents` (line 855) → for each student: `studentDao.update(updated)` (local Room updated with new gradeLevel) → `syncSupport.enqueueOnly(entity="student", operation="promote", payload={... gradeLevel=updated.gradeLevel ...})` (line 885-898) → SyncService.drainPending → `SyncQueueDispatcher.pushEntry` → `when (entry.entity) { "student" -> pushStudent(...) }` (line 71) — OPERATION FIELD IGNORED → `pushStudent` builds params WITHOUT `p_grade_level_code` (RPC doesn't accept it) → `upsert_student_from_import(p_tenant_id, p_student_code, p_parent_id, ..., p_class_id, p_enrollment_status, p_medical_notes, p_is_active)` → server UPDATE: enrollment_status updated, class_id possibly updated, but `grade_level_code` UNCHANGED on the server.
- **Intended responsibility:** The sync push should propagate the new gradeLevel to the server. Either: (a) the RPC should have a `p_grade_level_code` parameter, or (b) the dispatcher should detect `operation="promote"` and call a different RPC (e.g., a hypothetical `promote_student` RPC) or perform a direct table UPDATE on `students.grade_level_code`.
- **Actual responsibility:** The promotion's grade_level_code change is local-only. The server student row keeps the old grade_level_code. The Android user sees the new grade locally; the desktop user (querying the server) sees the old grade. Cross-platform state drift.
- **Dependents / consumers:** The server-side `students.grade_level_code` column is read by: the desktop's student-detail-drawer (displays the student's current grade), the desktop's promotion review screen (builds candidates from current grade), the Android's pull-sync (overwrites local with server on next pull — REVERTING the local promotion!), the website's parent portal (if it displays student grade).
- **Alternative implementations of same operation:** The desktop's `SupabasePromotionRepository.executeBatchPromotion` (supabase-academic-repository.ts line 1180-1192) DOES update `students.grade_level_code` directly via `client.from('students').update({ grade_level_code: upd.gradeLevel, class_id: null }).eq('id', upd.id)` — but the entire flow aborts earlier at the academic_history upsert (TENANT-106). So neither platform actually promotes the student on the server.
- **Behavioral differences:** Desktop — fails at history upsert, aborts entirely, user sees error toast. Android — succeeds locally + sync push silently drops grade, user sees success toast but server has stale data. The next pull sync OVERWRITES the local promotion (server's old grade_level_code replaces local's new gradeLevel).
- **Git evidence:** LocalRepositories.kt last touched `94471e8` (2026-08-28); SyncQueueDispatcher.kt last touched `94471e8` (2026-08-28); 0027_shared_unification.sql introduced in `b25e6ca` (2026-08-04).
- **Likely root cause:** The `upsert_student_from_import` RPC was written for Excel bulk import (where grade_level_code is set ONCE during initial creation, not changed). The promotion flow's need to UPDATE grade_level_code post-creation wasn't anticipated. The dispatcher's `when (entry.entity)` switch ignores `operation` entirely — treating all student sync entries as upserts.
- **Potential impact:** (1) Silent data corruption: the Android user believes the promotion succeeded; the server has the old grade. (2) Pull-sync reverts the local promotion — the Android user's promotion disappears on next sync. (3) Combined with TENANT-106 (desktop can't promote either), NO platform can advance a student's grade on the server. (4) Financial: tuition is grade-level-based — server-side billing calculations use the wrong grade. (5) Academic records: report cards and GPA-by-grade calculations are wrong. (6) This is a complete failure of the promotion feature.
- **Code snippet:**
```kotlin
// SyncQueueDispatcher.kt:69-97 — entity-based dispatch, operation IGNORED
when (entry.entity) {
    "parent" -> pushParent(entry, payload, actorId)
    "student" -> pushStudent(entry, payload, actorId)  // ← operation="promote" routes here too
    "payment" -> pushPayment(entry, payload, actorId)
    // ...
    else -> { /* No-op — the SyncService will mark the entry as "synced". */ }
}

// SyncQueueDispatcher.kt:167-191 — pushStudent builds params WITHOUT grade_level_code
private suspend fun pushStudent(entry: SyncQueueEntity, p: JsonObject, actorId: String) {
    val parentId = p.str("parentId") ?: p.str("parent_id") ?: return
    val params = buildJsonObject {
        put("p_tenant_id", entry.tenantId)
        put("p_student_code", p.str("code") ?: p.str("student_code") ?: generateStudentCode())
        put("p_parent_id", parentId)
        put("p_first_name", p.str("firstName") ?: p.str("first_name") ?: "")
        put("p_last_name", p.str("lastName") ?: p.str("last_name") ?: "")
        put("p_display_name", p.str("displayName") ?: p.str("display_name"))
        put("p_date_of_birth", p.str("birthDate") ?: p.str("date_of_birth"))
        val gender = p.str("gender")
        if (gender != null && gender != "unspecified") put("p_gender", gender)
        put("p_class_id", p.str("classId") ?: p.str("class_id"))
        put("p_enrollment_status", p.str("status") ?: "active")
        put("p_medical_notes", p.str("medicalNotes") ?: p.str("medical_notes"))
        put("p_is_active", true)
        // ← NO p_grade_level_code — RPC doesn't accept it.
    }
    NetworkTimeouts.guard<Unit>("sync.pushStudent", timeoutMs = 5_000L) {
        supabaseProvider.postgrest.rpc("upsert_student_from_import", params)
    }
}
```
```sql
-- 0027_shared_unification.sql:503-519 — RPC has NO p_grade_level_code param
CREATE OR REPLACE FUNCTION public.upsert_student_from_import(
    p_tenant_id      uuid,
    p_student_code   text,
    p_parent_id      uuid,
    p_first_name     text,
    p_last_name      text,
    p_display_name   text DEFAULT NULL,
    p_middle_name    text DEFAULT NULL,
    p_date_of_birth  date DEFAULT NULL,
    p_gender         text DEFAULT NULL,
    p_grade_level_id uuid DEFAULT NULL,  -- ← FK to academic_levels, NOT grade_level_code
    p_class_id       uuid DEFAULT NULL,
    p_enrollment_date date DEFAULT NULL,
    p_enrollment_status text DEFAULT 'active',
    p_medical_notes  text DEFAULT NULL,
    p_is_active      boolean DEFAULT true
)
-- No p_grade_level_code parameter — the RPC's UPDATE branch (line 552-567) doesn't touch grade_level_code.
```
- **Confidence:** Confirmed

### FINDING STUDENT-101 — `bind_activation_code` SQL function allows re-binding to a different user without invalidating the previous binding (extends SEC-110)

- **What:** The `bind_activation_code(p_tenant_id, p_code, p_auth_user_id)` SQL function (0005 line 191-243) checks `bound_to_auth_user_id IS NULL` on the activation code row (line 209) — but does NOT check whether the parent's `auth_user_id` is already set to a DIFFERENT user. So if a new activation code is issued for a parent who is already bound to user A, the new code can bind user B — silently overwriting A's binding on the parent. The function silently transfers ownership of the parent record.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0005_crm.sql:191-243` (function body — no `WHERE parents.auth_user_id IS NULL` check).
- **How reached:** Parent X is bound to user A (auth_user_id = A) via activation code #1 (now used). Admin issues a NEW activation code #2 for parent X (e.g., A lost access, or admin wants to rebind to B). Attacker B obtains code #2 (via WEAK-100 brute force, or social engineering, or via SEC-110's direct-RPC attack where they pass any p_auth_user_id) → calls `bind_activation_code(p_tenant_id, p_code=#2, p_auth_user_id=B)` → SQL function: `SELECT FOR UPDATE WHERE tenant_id=p_tenant_id AND code=#2 AND bound_to_auth_user_id IS NULL` → found (code #2 is unbound) → `UPDATE activation_codes SET bound_to_auth_user_id = B, bound_at = now()` → `UPDATE parents SET auth_user_id = B WHERE id = parent_X` → user A's binding silently overwritten. User A next signs in → queries `parents WHERE auth_user_id = auth.uid()` → returns nothing → user A sees "pending" screen, locked out. User B signs in → sees parent X's children + financial data.
- **Intended responsibility:** The function should check `parents.auth_user_id IS NULL` (only allow binding to unbound parents) OR raise an exception if the parent is already bound to a different user. The previous binding should be invalidated explicitly (with an audit log entry).
- **Actual responsibility:** Silently transfers the binding. The previous user (A) is locked out without explanation. The new user (B) gets the parent's data.
- **Dependents / consumers:** User A — loses access. User B — gains access. The activation_codes table — code #1 is still marked as bound to user A (not invalidated); code #2 is bound to user B. The parent's auth_user_id is B. Audit_logs — no entry (per PARENT-103 below).
- **Alternative implementations of same operation:** The `approve_account_request` function (0005 line 309-314) has the SAME issue (PARENT-101 below). Both functions allow silent rebind. The website's `bind-activation-code` EF (line 130-137) wraps this SQL RPC — same flaw inherited.
- **Behavioral differences:** New code creation (expected — admin re-issues after losing access) → silent rebind (acceptable but should be audited). Attack (unauthorized rebind) → silent rebind (catastrophic, no audit). The function doesn't distinguish the two.
- **Git evidence:** 0005_crm.sql introduced in `b25e6ca` (2026-08-04).
- **Likely root cause:** The function was written to handle the happy path (unbound parent + unbound code → bind). The author didn't consider the rebind case. There's no `WHERE parents.auth_user_id IS NULL` clause.
- **Potential impact:** (1) Account takeover: an attacker with a brute-forced code can take over an already-bound parent's account. (2) Admin confusion: when admin re-issues a code for a parent who already had a working login, the previous user is silently locked out — no warning, no audit trail. (3) Audit blindness: combined with PARENT-103 (no audit log), the rebind is invisible. (4) Compounded by SEC-110 (RPC accepts any p_auth_user_id without verifying caller), the attack surface is wide.
- **Code snippet:**
```sql
-- 0005_crm.sql:204-231 — no check on parents.auth_user_id
select * into v_activation
  from public.activation_codes
 where tenant_id = p_tenant_id
   and code = p_code
   and bound_to_auth_user_id is null  -- ← only checks the CODE is unbound
 for update;

if not found then
    raise exception 'Invalid or already-used activation code';
end if;

v_parent_id := v_activation.parent_id;

-- ↑ NO CHECK: does parents.auth_user_id already point to a different user?
update public.parents
   set auth_user_id = p_auth_user_id  -- ← silent overwrite if parent was already bound
 where id = v_parent_id;
```
- **Confidence:** Likely (the function body has no `WHERE auth_user_id IS NULL` check on the parents table; the rebind case is structurally permitted)

### FINDING DEAD-200 — `parent_student_links` table is unused; multi-guardian family feature is structurally unimplemented

- **What:** Migration 0005 (line 89-98) creates `public.parent_student_links` as a "junction for multi-guardian families" — the schema supports N parents per student (with `is_primary` flag, `relationship`, `tenant_id`, unique `(tenant_id, parent_id, student_id)`). Migration 0019 line 400-410 adds RLS policies on it. But ZERO client code across ALL 3 REPOS ever SELECTs, INSERTs, UPDATEs, or DELETEs from this table. The canonical parent-student linkage is `students.parent_id` (single FK, 0005 line 57). Multi-guardian families (mother + father + legal guardian all bound to one student) are structurally impossible.
- **Where:** Schema: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0005_crm.sql:89-101`. RLS: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:400-410`. Verified no consumers: grep for `parent_student_links|ParentStudentLink` across `/home/z/my-project/repos/elimtiyaz-website/src`, `/home/z/my-project/repos/elimtiyaz-android/app/src/main`, `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src` returns ZERO matches (only the migration files themselves).
- **How reached:** Admin opens the desktop's batch-registration modal → enters a family with 1 parent and N students → `SupabaseParentRepository.createParent` + `SupabaseStudentRepository.createStudent` for each student → each student's `parent_id` is set to the parent's UUID. The `parent_student_links` table is NEVER touched. If a second parent (e.g., the mother) needs to be linked to the same student, the admin would have to: (a) create a second parent row, (b) ... there's no UI/code path to add a link.
- **Intended responsibility:** Per the 0005 comment line 87 ("parent_student_links — optional junction for multi-guardian families"), the table was meant to enable: (1) both mother and father bound to the same child; (2) legal guardian in addition to biological parent; (3) a child moving between custodial parents. The `is_primary` flag would distinguish the primary contact.
- **Actual responsibility:** The table is empty in production. Every student has exactly one `parent_id` — the single canonical parent. There's no UI flow to add a second parent. The `parent_student_links_select` policy (0019 line 401-406) allows any 'parent' role user in the tenant to SELECT ALL links — but since the table is empty, this is harmless.
- **Dependents / consumers:** None. The table is referenced only by its own schema + RLS. The RLS policy is a phantom.
- **Alternative implementations of same operation:** `students.parent_id` (single FK to parents.id) is the ONLY parent-student linkage in use. There's no other implementation — multi-guardian is just structurally absent.
- **Behavioral differences:** A school where one child's parents are divorced and both want portal access — only ONE parent (whoever was entered first as `parent_id`) can sign in via the website. The other parent has no `auth_user_id` binding and no way to see the child's data.
- **Git evidence:** 0005_crm.sql introduced in `b25e6ca` (2026-08-04). 0019 in same commit. No later migration or client code wires up the table.
- **Likely root cause:** The schema was designed for multi-guardian families per plan §04, but the implementation never went beyond the single-FK shortcut. The table was left in place "for future use" — classic dead-by-design infrastructure.
- **Potential impact:** (1) Multi-guardian families can't both have portal access. (2) Custody changes can't be reflected — the original parent stays as the only parent_id, and there's no UI to swap. (3) Sibling-discount logic (per 0023_seed.sql line 498, `sibling_fixed` discount) might miss half-siblings living with different parents (since they don't share parent_id). (4) Notification routing — a notification addressed to "the parent" goes to whichever parent is in the `parent_id` column, missing the other parent. (5) The RLS policy on the empty table is a phantom — lulls maintainers into thinking multi-guardian is supported.
- **Code snippet:**
```sql
-- 0005_crm.sql:89-98 — schema for multi-guardian families (NEVER USED)
create table public.parent_student_links (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    parent_id       uuid        not null references public.parents(id) on delete cascade,
    student_id      uuid        not null references public.students(id) on delete cascade,
    relationship    text        check (relationship in ('father', 'mother', 'guardian', 'other')),
    is_primary      boolean     not null default false,
    created_at      timestamptz not null default now(),
    unique (tenant_id, parent_id, student_id)
);
-- ZERO writers / readers across 3 repos. The unique constraint
-- is never exercised. The table is empty in production.

-- The canonical parent-student link is students.parent_id (single FK):
-- 0005_crm.sql:57  parent_id       uuid        not null references public.parents(id) on delete restrict,
```
- **Confidence:** Confirmed (grep returned no matches outside migration files)

### FINDING PARENT-100 — `approve-signup-request` EF uses `Math.random()` for parent_code (non-deterministic, violates canonical §7.1) (extends DRIFT-001 to EF path)

- **What:** The `approve-signup-request` Edge Function (line 157) generates the parent_code for newly-created parents via `Math.random().toString(36).slice(2, 6).toUpperCase()` — a 4-character random alphanumeric. This VIOLATES the canonical rule §7.1 (deterministic FNV-1a hash of identity fields, see `deterministicParentCode` at `src/core/format/id.ts:24-42`). The desktop's `SupabaseParentRepository.createParent` uses the deterministic version. The EF uses the random version. The two paths produce DIFFERENT parent codes for the same parent identity.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts:157`. Canonical reference: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/core/format/id.ts:24-42` (`deterministicParentCode`); `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:489` (uses deterministicParentCode).
- **How reached:** Admin opens desktop's Approvals tab → pending request for user with no existing parent match → admin selects "Approve with new parent" → fills new parent form → clicks Approve → `SupabaseApprovalRepository.approveWithNewParent` → `client.functions.invoke('approve-signup-request', { body: { action: 'approve', create_new_parent: true, new_parent: {...} } })` → EF (line 157) → `parentCode = 'PAR-' + year + '-' + Math.random().toString(36).slice(2,6).toUpperCase()` → `supabase.from('parents').insert({ parent_code: parentCode, ... })` → new parent row with random code. Later: admin imports the same family via Excel → `SupabaseParentRepository.createParent` → `deterministicParentCode(year, input)` → calls `upsert_parent_from_import` with a DIFFERENT parent_code → RPC's identity match `(tenant_id, parent_code)` fails → falls through to phone match → if phone matches, upserts; if not, INSERTs a NEW parent row → DUPLICATE parent.
- **Intended responsibility:** Per canonical §7.1, the parent_code MUST be deterministic so that re-imports converge on the same parent row (idempotent upsert). The EF should call `deterministicParentCode` or rely on the `upsert_parent_from_import` RPC (which generates its own deterministic code from input fields).
- **Actual responsibility:** The EF bypasses the canonical generator, uses `Math.random()`, and inserts the parent directly via `supabase.from('parents').insert(...)` — bypassing the `upsert_parent_from_import` RPC entirely. This creates parents with non-canonical codes that can't be matched by re-imports.
- **Dependents / consumers:** The parent row created by this EF has a parent_code that doesn't match what the desktop's Excel importer would generate. Any subsequent Excel import or Android sync push of the same parent identity would create a duplicate.
- **Alternative implementations of same operation:** The desktop's `SupabaseParentRepository.createParent` (line 481-549) calls `upsert_parent_from_import` RPC with `deterministicParentCode(year, input)`. The Android's `LocalParentRepository.createParent` (line 365-373) also uses `com.example.core.deterministicParentCode`. The EF is the only path that uses Math.random().
- **Behavioral differences:** Excel-imported parent → deterministic code → re-import converges (idempotent). EF-created parent (via approve-signup-request with create_new_parent=true) → random code → re-import creates a duplicate (no identity match). The desktop's CRM then shows TWO parent rows for the same family.
- **Git evidence:** approve-signup-request/index.ts last touched `eeb82db` (2026-08-21, "right"). The deterministic generator was added in `b25e6ca` (2026-08-04) but the EF was never updated.
- **Likely root cause:** The EF was written before the canonical deterministic generator was introduced. The author copy-pasted the old random pattern (`Math.random().toString(36).slice(2,6)`) and never updated it. This is the same pattern as DRIFT-001 (mock parent repository uses random), but on the EF side.
- **Potential impact:** (1) Duplicate parents: every EF-created parent has a random code; re-imports create duplicates. (2) The `unique (tenant_id, parent_code)` constraint (0005 line 39) doesn't fire because the random codes are different. (3) The desktop's CRM shows multiple parent rows for the same family — confusing for staff. (4) Financial data (payments, ledger entries) linked to one of the duplicate parents is invisible from the other duplicate's view — financial summary is wrong. (5) Activation codes generated later via `deterministicActivationCode(parentCode, tenantId)` would differ between the two duplicates (because their parent_codes differ).
- **Code snippet:**
```typescript
// approve-signup-request/index.ts:157 — Math.random() parent_code (NON-CANONICAL)
const parentCode = `PAR-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
// ↑ 4-char random, ~1.6M combinations, non-deterministic

// COMPARE — src/core/format/id.ts:24-42 (canonical deterministicParentCode):
export function deterministicParentCode(year: number, input: ParentCodeInput): string {
  const identity = [input.firstName, input.lastName, input.phone, input.displayName]
    .filter((s): s is string => s != null && s.trim().length > 0)
    .map((s) => s.trim())
    .join("|");
  if (identity.length === 0) return `PAR-${year}-XXXX`;
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < identity.length; i++) {
    h = (h ^ identity.charCodeAt(i)) | 0;
    h = Math.imul(h, 0x01000193) | 0;
  }
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const unsigned = h >>> 0;
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += alphabet[(unsigned >>> (i * 6)) % alphabet.length];
  return `PAR-${year}-${suffix}`;
}
```
- **Confidence:** Confirmed (extends DRIFT-001 from first-pass to the EF path)

### FINDING PARENT-101 — `approve_account_request` SQL function silently OVERWRITES `parents.auth_user_id` on re-bind (no orphan check, no audit trail)

- **What:** The `approve_account_request(p_request_id, p_reviewer_profile_id, p_target_parent_id, ...)` SQL function (0005 line 251-325) binds the request's `auth_user_id` to the target parent via `UPDATE public.parents SET auth_user_id = v_request.auth_user_id WHERE id = p_target_parent_id` (line 311-313). It does NOT check if the parent already has a different `auth_user_id` set. If it does, the previous user's binding is silently overwritten — the previous user can no longer sign in to see this parent. There's NO audit log write for this rebind.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0005_crm.sql:309-314` (the rebind block). Wrapping EF: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts:198-208` (calls the RPC) + `:252-260` (writes an audit log entry for "account_approval.approve" — but the entry's `before_json` doesn't capture the parent's old auth_user_id, so the rebind is invisible in the audit trail).
- **How reached:** Admin approves user A's signup request → `target_parent_id = <parent X>` (parent X already has `auth_user_id = user B` from a prior approval) → `approve_account_request` runs → `UPDATE parents SET auth_user_id = user_A WHERE id = parent_X` → user B's binding silently overwritten. User B next signs in → `parents WHERE auth_user_id = auth.uid()` returns nothing → user B sees "account not activated" screen. User B is permanently locked out without explanation.
- **Intended responsibility:** The rebind block should check `old.auth_user_id IS NULL` (only bind if the parent is unbound) OR raise an exception if the parent already has a different auth_user_id. The rebind should write an audit log entry like "parent.rebind: from user B to user A".
- **Actual responsibility:** Silently overwrites. No orphan check. No audit log entry for the rebind (the EF writes an "account_approval.approve" audit entry but the `before_json` doesn't capture the old auth_user_id, so the rebind is invisible in the audit trail).
- **Dependents / consumers:** User B (the previous binding) — their auth_user_id is now floating (user_profiles row still exists with auth_user_id = user B, but no parent row references them). User B's session is invalid for parent data.
- **Alternative implementations of same operation:** The `bind_activation_code` SQL function (0005 line 191-243) ONLY binds unbound activation codes (`WHERE bound_to_auth_user_id IS NULL FOR UPDATE`). But it has the same flaw at the parent level (STUDENT-101 above). So both SQL paths allow silent parent rebind.
- **Behavioral differences:** bind_activation_code — can't rebind a code (safe at code level), but can rebind a parent (unsafe at parent level, see STUDENT-101). approve_account_request — freely rebinds the parent (unsafe). The two paths implement the same logical operation (binding auth_user_id to a parent) with the same unsafe semantics.
- **Git evidence:** 0005_crm.sql introduced in `b25e6ca` (2026-08-04). The `approve_account_request` function's rebind block has been unchanged since.
- **Likely root cause:** The function was written assuming a 1:1 user-parent mapping where rebinds don't happen. The author didn't anticipate the case where an admin accidentally approves the wrong user for an already-bound parent.
- **Potential impact:** (1) Account takeover via admin path: a malicious user with knowledge of a pending approval request can ask an admin to "approve me for parent X" — the admin sees a pending request from the attacker, approves it with `target_parent_id = parent X` (which already belongs to victim user B) — attacker's auth_user_id overwrites B's. Attacker signs in via Google OAuth → sees victim's parent + children + financial data. User B is locked out without explanation. (2) Audit trail: the rebind is invisible — the audit log only shows "account_approval.approve" with the new user's info, not the displaced old user. (3) Forensics: when user B complains "I can't log in", there's no trace of who rebound them. (4) Combined with WEAK-100 (no rate limit on activation codes) and SEC-110 (RPC accepts any p_auth_user_id), the attack surface is wide.
- **Code snippet:**
```sql
-- 0005_crm.sql:309-314 — silent rebind, no orphan check, no audit log
if v_request.requested_role = 'parent' and p_target_parent_id is not null then
    update public.parents
       set auth_user_id = v_request.auth_user_id  -- ← overwrites silently
     where id = p_target_parent_id;
    -- ↑ no WHERE old.auth_user_id IS NULL check
    -- ↑ no audit_log insert
    -- ↑ no exception if the parent was already bound
end if;
```
- **Confidence:** Confirmed

### FINDING PARENT-102 — Approval-without-target-parent creates "active but unbound" user with no escape path

- **What:** The `approve-signup-request` Edge Function (line 146-208) handles the `action: "approve"` case. If the admin calls it with NEITHER `target_parent_id` NOR `create_new_parent=true`, the EF calls `approve_account_request(p_target_parent_id=null, ...)`. The SQL function (0005 line 309-314) skips the parent-binding block (because `p_target_parent_id IS NULL`). The user is activated (status='active'), gets a role_assignment, but `parents.auth_user_id` is NOT set anywhere. The user signs in via Google OAuth → website's auth-provider queries `parents WHERE auth_user_id = authUser.id` → returns null → `setParent(null); setState("pending")` (auth-provider.tsx line 159-165) → user sees "account not activated" screen despite being status='active' with a role.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts:146-208` (EF doesn't validate target_parent_id is set); `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0005_crm.sql:309-314` (SQL skips binding when target_parent_id is NULL); `/home/z/my-project/repos/elimtiyaz-website/src/app/providers/auth-provider.tsx:159-165` (treats active-but-unbound as pending).
- **How reached:** (a) Admin opens desktop's Approvals tab → pending request with no auto-match → admin clicks "Approve" (if the UI allowed this; the desktop's UI requires target_parent_id for "approve_existing" type — but the EF doesn't enforce). OR (b) a script/curl directly calls the EF with `body.action="approve"` and no target_parent_id, no create_new_parent. OR (c) admin uses "approve_new" but the new_parent creation fails silently (e.g., DB error swallowed). The user is activated but unbound.
- **Intended responsibility:** The EF should validate that EITHER `target_parent_id` is set OR `create_new_parent=true` is set on approve actions. If neither, return 400 "missing target parent".
- **Actual responsibility:** The EF happily approves without binding. The user is in limbo — status='active' but no parent. The website treats them as 'pending' forever. There's no UI flow to recover: the bind-activation-code EF (line 97-102) rejects already-active users with 409 "Account is already active". The approve_account_request SQL function can't be re-called (the request is already status='approved' — line 270-271 `WHERE id = p_request_id AND status = 'pending' FOR UPDATE` won't find it). The user is permanently stuck.
- **Dependents / consumers:** The user — they can sign in via Google OAuth but see only "pending activation" screen. The admin — they think they approved the user but the user never accesses the portal. The audit log — shows "account_approval.approve" but no parent binding.
- **Alternative implementations of same operation:** The desktop's `SupabaseApprovalRepository.approveWithExistingParent` (line 146-171) REQUIRES `targetParentId: string` (non-null in the type signature). The desktop's `approveWithNewParent` (line 176-209) REQUIRES `newParent` object. So the desktop UI forces the admin to choose one of these paths. But the EF is called directly via `client.functions.invoke` — the body is constructed by the desktop's repository code, which enforces the constraint. A direct caller (curl) doesn't have this enforcement.
- **Behavioral differences:** Desktop UI — always provides target_parent_id (via the modal's flow). Direct EF call — no validation. The EF trusts the caller to provide the binding.
- **Git evidence:** approve-signup-request/index.ts introduced in `b25e6ca` (2026-08-04). The EF body validation has been missing since.
- **Likely root cause:** The EF was written to a thin wrapper around the `approve_account_request` SQL function. The author didn't add input validation because the SQL function's `p_target_parent_id default null` made the parameter optional. The author didn't anticipate that "approved without binding" is an invalid state.
- **Potential impact:** (1) Orphaned activated users — they sign in, see "pending" forever, complain to support, support has no UI to fix it. (2) The user can't use the activation code path (EF rejects already-active users). (3) The only escape is direct SQL intervention: `UPDATE user_profiles SET status='pending' WHERE id=...` then re-approve with target_parent_id set — but the desktop has no UI to flip a user back to 'pending'. (4) Audit gap — these orphaned users accumulate in the user_profiles table with status='active' but no parent binding; future audits see "active users" counts that don't match "active parents" counts.
- **Code snippet:**
```typescript
// approve-signup-request/index.ts:148-149, 198-208 — no validation
let targetParentId = body.target_parent_id;  // ← may be undefined
let targetStudentId = body.target_student_id;

if (body.create_new_parent && body.new_parent) { /* ... create parent ... */ }
// ↑ if create_new_parent is false (default), targetParentId stays undefined

const { data: assignedRoleId, error: approveError } = await supabase.rpc("approve_account_request", {
    p_request_id: body.request_id,
    p_reviewer_profile_id: ctx.userProfileId,
    p_target_parent_id: targetParentId ?? null,  // ← null if admin didn't provide
    // ...
});
// → SQL function: if p_target_parent_id IS NULL, skip the parents.auth_user_id UPDATE.
// → User is activated but has no parent binding.
```
```typescript
// auth-provider.tsx:159-165 — website treats unbound-active user as "pending"
if (!parentRow) {
  // Active user but no parent binding yet — admin activated the account
  // but hasn't linked it to a parent profile. Treat as pending.
  setParent(null);
  setChildrenList([]);
  return "pending";  // ← user stuck here forever
}
```
- **Confidence:** Likely (the EF doesn't validate; the SQL function skips the binding when target_parent_id is null; the auth-provider treats the unbound state as pending; no recovery flow exists)

### FINDING PARENT-103 — `bind_activation_code` SQL RPC writes no audit log entry (extends SEC-110)

- **What:** The `bind_activation_code(p_tenant_id, p_code, p_auth_user_id)` SQL function (0005 line 191-243) marks the activation code as bound and updates `parents.auth_user_id` for the bound parent. It does NOT write to `audit_logs`. There's no audit trail for: who bound the code, when, to which parent, for which user. Combined with SEC-110 (the function accepts any `p_auth_user_id` without verifying caller), an attacker who brute-forces an activation code can bind any auth_user_id to any parent — and the audit log shows nothing.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0005_crm.sql:191-243`. Audit-log infrastructure: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0014_audit.sql` (defines `audit_logs` table + `write_audit_log` RPC).
- **How reached:** Caller calls `supabase.rpc('bind_activation_code', { p_tenant_id, p_code, p_auth_user_id })` → SQL function runs `SELECT FOR UPDATE` on activation_codes row → marks `bound_to_auth_user_id = p_auth_user_id, bound_at = now()` → `UPDATE parents SET auth_user_id = p_auth_user_id WHERE id = v_parent_id` → returns parent info. No `INSERT INTO audit_logs` anywhere. No call to `write_audit_log` RPC.
- **Intended responsibility:** The function should call `write_audit_log(p_action='parent.bind_activation_code', p_entity_type='parent', p_entity_id=v_parent_id, p_actor_id=..., p_before_json={old_auth_user_id: parents.auth_user_id}, p_after_json={new_auth_user_id: p_auth_user_id, code: p_code}, ...)`. The website's bind-activation-code EF (line 130-137) calls this RPC via service_role and should write its own audit log entry — but it doesn't either (it only returns success metadata).
- **Actual responsibility:** Silent binding. The audit_logs table has zero rows for activation code bindings. Forensics impossible.
- **Dependents / consumers:** The school's audit trail — every binding is invisible. The desktop's Audit screen — never shows activation code bindings.
- **Alternative implementations of same operation:** The `approve_account_request` function (0005 line 251-325) ALSO doesn't write an audit log entry directly — but the wrapping EF (`approve-signup-request` index.ts line 184-195) DOES call `writeAuditLog` for `parent.create` and at line 126-137 for `account_approval.reject`. For `account_approval.approve`, the EF writes an audit log entry at line 252-260. So the approve path has audit; the activation-code-bind path doesn't.
- **Behavioral differences:** approve_account_request → audited (via EF wrapper). bind_activation_code → not audited (no wrapper, no internal audit). Two paths to the same logical operation (binding auth_user_id to a parent) with different audit postures.
- **Git evidence:** 0005_crm.sql introduced in `b25e6ca` (2026-08-04). The audit_logs table (0014) was already in place. The author of 0005 didn't wire up the audit.
- **Likely root cause:** The bind_activation_code function was written to be called from a server-side EF that was supposed to write the audit log. The website's EF was added later but the author didn't add the audit log call (the EF only returns success metadata). The SQL function itself was never updated to write audit logs internally.
- **Potential impact:** (1) Forensic blindness: when a parent complains "I can't log in" because someone else bound their code, there's no audit trail to investigate. (2) Compliance: FERPA / GDPR-style "right to know who accessed your data" — the parent can't see who bound their account. (3) Combined with SEC-110 (no caller verification) + WEAK-100 (brute-forceable codes) + SEC-108 (multi-tenant injection) + STUDENT-101 (silent rebind allowed), an attacker can take over any parent account and leave no trace.
- **Code snippet:**
```sql
-- 0005_crm.sql:222-231 — binding happens, no audit_log INSERT
-- Mark the code as bound
update public.activation_codes
   set bound_to_auth_user_id = p_auth_user_id,
       bound_at = now()
 where id = v_activation.id;

-- Bind the auth.users.id to the parent record
update public.parents
   set auth_user_id = p_auth_user_id
 where id = v_parent_id;
-- ↑ NO write_audit_log() call here or anywhere in the function body.
-- The 0014_audit.sql migration defines public.write_audit_log(...) —
-- this function NEVER invokes it.
```
- **Confidence:** Confirmed

Stage Summary:
- Total new findings: 13 (TENANT-100, TENANT-101, TENANT-102, TENANT-103, TENANT-104, TENANT-105, TENANT-106, STUDENT-100, STUDENT-101, DEAD-200, PARENT-100, PARENT-101, PARENT-102, PARENT-103)
- Severity breakdown:
  - Critical: 5 (TENANT-100 cross-tenant role inheritance, TENANT-101 user_profiles_admin_update no tenant check, TENANT-106 student_academic_histories inaccessible + desktop promotion fails, STUDENT-100 Android promotion sync drops grade_level_code, PARENT-101 silent parent rebind via approve_account_request)
  - High: 6 (TENANT-102 tenants_select lets any super_admin enumerate/delete all tenants, TENANT-103 desktop getTenantId fallback to DEMO, TENANT-104 Android LocalParentRepository hardcodes DEMO UUID, TENANT-105 set_assessments_tenant trigger falls back to DEMO UUID, PARENT-100 EF uses Math.random for parent_code, PARENT-102 active-but-unbound user with no escape path, PARENT-103 bind_activation_code writes no audit log)
  - Medium: 2 (STUDENT-101 bind_activation_code silent rebind, DEAD-200 parent_student_links table unused)
  - Low: 0
- Top 5 critical findings (one-line each):
  1. **TENANT-100**: `current_user_roles()` queries `role_assignments` by `user_profile_id` only — no tenant_id filter; a super_admin in ANY tenant is super_admin globally for RLS purposes.
  2. **TENANT-101**: `user_profiles_admin_update` RLS policy has NO tenant_id check (only `has_role('super_admin')`) — combined with TENANT-100, any per-tenant super_admin can UPDATE/SUSPEND/MOVE/DELETE any user_profiles row across ALL tenants.
  3. **TENANT-106**: `student_academic_histories` table has only the broken 0029 RLS policy (uses `fn_current_tenant_id()` which is always NULL per DEAD-100); the desktop's `executeBatchPromotion` hits the RLS denial at the history upsert step, aborts the entire promotion flow — the school cannot promote students via the desktop.
  4. **STUDENT-100**: Android promotion sync push goes through `SyncQueueDispatcher.pushStudent` which routes by `entity` only (operation field IGNORED) and calls `upsert_student_from_import` RPC which has NO `p_grade_level_code` parameter — server-side student record keeps the OLD grade; combined with TENANT-106, NO platform can advance a student's grade on the server.
  5. **PARENT-101**: `approve_account_request` SQL function silently OVERWRITES `parents.auth_user_id` when the admin approves a signup request for an already-bound parent (no orphan check, no audit log) — severs the previous user's access without explanation or trace.

- Findings that EXTEND prior findings (no contradictions):
  - **TENANT-105** extends **DEAD-100** (dead `fn_current_tenant_id()`): provides the concrete end-to-end failure mode where the `set_assessments_tenant` trigger falls back to the DEMO tenant UUID when student_id is invalid, silently corrupting the tenant_id of orphaned assessment rows.
  - **TENANT-106** extends **DEAD-100** with concrete user-facing breakage: the desktop's batch promotion flow fails at the `student_academic_histories` upsert because the table's ONLY RLS policy is the broken `fn_current_tenant_id()`-based one. The structural DEAD-100 finding predicted this; this finding traces the actual user-facing failure.
  - **TENANT-104** extends **WEAK-011** (audit helper hardcodes DEMO UUID): same hardcoded DEMO UUID pattern, but applied to parent/student/payment creation in `Local*Repository.create*` — 30+ sites in LocalRepositories.kt + LocalRepositories2.kt.
  - **TENANT-103** is the desktop-side mirror of **TENANT-104**: the desktop's `getTenantId()` falls back to DEMO UUID when session is missing or user is a global admin — global-admin support is broken on the desktop.
  - **PARENT-100** extends **DRIFT-001** (mock parent repository uses Math.random for parent_code): same random parent_code pattern, but in the `approve-signup-request` EF — produces non-canonical codes that break idempotent re-imports.
  - **PARENT-101** mirrors **STUDENT-101** (both SQL functions allow silent parent rebind) — combined with **SEC-110** (RPC accepts any p_auth_user_id) and **PARENT-103** (no audit log), the activation-code path enables cross-tenant account takeover with no forensic trace.
  - **PARENT-102** is downstream of **SEC-108** (multi-tenant injection at signup): an attacker who successfully injects their tenant_id at signup can be approved by the victim-tenant admin without a target_parent_id (if the EF is called directly) — leaving them activated but unbound, a state with no recovery path.

---

Task ID: 3-E
Agent: forensic-auditor-E (Chat + Messaging + Notifications + Push end-to-end)
Task: Deep second-pass audit of chat/notifications/push flows across all 3 platforms

Work Log:
- Read shared worklog in chunks (6127 lines); paid particular attention to WEAK-014, WEAK-015, WEAK-023, SEC-106, SYNC-104, SYNC-105, REALTIME-100..104, TENANT-100 so as NOT to repeat.
- Audited canonical schema (`chat_channels` migration 0010 lines 303-326, `chat_messages` lines 330-358; `notifications` migration 0013 lines 96-128) + RLS policies (migration 0019 lines 822-860 + 1022-1042; migration 0028 lines 60-89).
- Traced the chat send → receive → ack → unread loop end-to-end on the website (`messages-view.tsx` + `portal-queries.ts:434-518`), the desktop (`chat-panel.tsx` + `mock/workforce/index.ts:820-972` + `supabase-notification-repository.ts`), and Android (`PullSyncRepository.kt:234-243`, `LocalRepositories2.kt:1512-1539`, `LocalDaos.kt:505-529`, `ElImtiyazMessagingService.kt`).
- Traced push-notification payload path: EF (`send-push-notification/index.ts`) → FCM HTTP v1 → Android `ElImtiyazMessagingService.onMessageReceived` + AndroidManifest intent filters → website service worker (`firebase-messaging-sw.js`) + `useHashRoute`.
- Verified there is NO production code anywhere that invokes `send-push-notification` (the workflow `push_notification` action is a STUB at `workflow-execute/index.ts:307-316`; the desktop's `push-homework-notification` EF doesn't exist per its own inline comment at `supabase-academic-repository.ts:1060`; no DB trigger or webhook configuration exists).
- Confirmed there is NO production code anywhere that creates `chat_channels` rows (only the desktop's MOCK chat repository writes channels, and the mock never persists to Supabase).
- 17 new findings (CHAT-100..105, NOTIF-100..105, PUSH-100..104). None restate prior findings; several extend REALTIME-101, SEC-106, SYNC-104, WEAK-014, WEAK-023.

### FINDING CHAT-100 — `chat_channels_insert` RLS allows any authenticated user to create a channel with arbitrary `member_ids` (no membership validation on insert)

- **What:** The RLS policy `chat_channels_insert` (0019 line 832-834) is `for insert to authenticated with check (tenant_id = public.current_tenant_id())`. The `with check` clause only verifies the tenant_id — there is NO check that `created_by = current_user_profile_id()`, NO check that `current_user_profile_id()` is in `member_ids`, NO check on `channel_type` (so a user can claim `channel_type='announcement'` even though announcements are supposed to be admin-only), and NO check that the inserter has any relationship to the user_profiles rows listed in `member_ids`. A parent can craft an INSERT with `member_ids = [their_own_id, principal_user_profile_id, financial_officer_user_profile_id]` and the row would be accepted.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:832-834`
- **How reached:** Attacker (authenticated parent) calls `supabase.from('chat_channels').insert({ tenant_id: T, code: 'direct-attacker-principal', name: 'direct', channel_type: 'direct', member_ids: [attacker_id, principal_id], created_by: attacker_id })` from browser devtools → PostgREST runs INSERT THROUGH RLS → `with check (tenant_id = current_tenant_id())` passes (the row's tenant_id is the attacker's tenant) → INSERT succeeds → row is now visible to BOTH members (per `chat_channels_select` line 823-831 which uses `member_ids @> array[current_user_profile_id()]`). The principal would see this channel appear in their messages view if they had one — but they don't (the desktop's chat-panel uses mock data, the website's messages-view is parent-only). The attacker can also INSERT messages into the channel via `chat_messages_insert` (per CHAT-101) — addressed only to themselves and the principal.
- **Intended responsibility:** The insert policy should require `created_by = current_user_profile_id()` AND `current_user_profile_id() = ANY(member_ids)` (the creator must be a member) AND for `channel_type='announcement'` require `has_role('super_admin')` or similar.
- **Actual responsibility:** Only `tenant_id` is checked. Membership, ownership, and channel_type authorization are all unchecked.
- **Dependents / consumers:** `chat_channels_select` (line 823-831) returns the channel to all members. The website's `useChatChannels` (portal-queries.ts:434-451) does a `.contains('member_ids', [userProfileId])` filter — so the channel would appear in any member's list.
- **Alternative implementations of same operation:** None — there is no production code that INSERTs into `chat_channels`. The desktop's mock chat repository (`mock/workforce/index.ts:850-876`) bypasses RLS entirely (in-memory only). The website only ever SELECTs.
- **Behavioral differences:** Under this policy, an attacker can manufacture social-engineering channels (a parent creates a "principal's office" channel and sends "I have an emergency, please call me"). The recipient sees the channel and messages in their UI but has no way to verify the channel's authenticity.
- **Git evidence:** Migration 0019 last touched in `b25e6ca` (2026-08-04, "FKFKFK"). The policy has been permissive since the original commit.
- **Likely root cause:** The author wrote the insert policy as a generic "tenant-bound INSERT" without considering the channel-membership semantics. The `member_ids` array was assumed to be populated by trusted code (e.g., an admin EF) — but the RLS layer doesn't enforce that assumption.
- **Potential impact:** Phishing / social engineering via fake channels. A parent can manufacture an "official" channel with the principal's profile in member_ids and the principal would see it (if they ever opened a portal that reads chat_channels — currently no portal reads staff channels, so the immediate impact is limited, but the policy is broken).
- **Code snippet:**
```sql
-- 0019_rls_policies.sql:832-834 — only tenant_id checked
create policy chat_channels_insert on public.chat_channels
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
-- NO check that created_by = current_user_profile_id()
-- NO check that current_user_profile_id() = ANY(member_ids)
-- NO check on channel_type for 'announcement' (admin-only in spirit)
```
- **Confidence:** Confirmed

### FINDING CHAT-101 — `chat_messages_insert` RLS has no channel-membership check; any user can spam any channel_id they know

- **What:** The RLS policy `chat_messages_insert` (0019 line 851-856) is `for insert to authenticated with check (tenant_id = current_tenant_id() and author_id = current_user_profile_id())`. The check correctly enforces `author_id = current_user_profile_id()` (preventing authorship spoofing), but does NOT verify that the author is a MEMBER of `channel_id`. So a parent who knows (or guesses) a `channel_id` they are NOT a member of can still INSERT messages into it. The author_id would be their own, so the insert succeeds.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:851-856`
- **How reached:** Attacker (authenticated parent) obtains or guesses a `channel_id` for a staff-only channel (e.g., via leaked URL, screenshot, or brute-forcing UUIDs is infeasible but the channel_id might appear in shared screenshots or logs). Calls `supabase.from('chat_messages').insert({ tenant_id: T, channel_id: victim_channel_id, author_id: attacker_id, body: 'spam message', read_by: [{ user_id: attacker_id, read_at: now }] })` → PostgREST runs INSERT through RLS → `with check (tenant_id = current_tenant_id() AND author_id = current_user_profile_id())` passes → INSERT succeeds. The message is now in the channel. The actual members of `victim_channel_id` (per `chat_messages_select` line 837-850 which checks channel membership via the parent `chat_channels`) can READ the message — the attacker themselves CANNOT (they're not a member of the channel, so `chat_messages_select` denies them).
- **Intended responsibility:** The insert policy should require `EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = chat_messages.channel_id AND c.member_ids @> ARRAY[current_user_profile_id()])` — i.e., the author must be a member of the target channel.
- **Actual responsibility:** Only `tenant_id` + `author_id = current_user_profile_id()` are checked. Channel membership is NOT verified.
- **Dependents / consumers:** `chat_messages_select` (line 837-850) — would only let channel members READ the message, but the attacker has already injected spam that the legitimate members will see.
- **Alternative implementations of same operation:** The website's `messages-view.tsx` `send()` (line 188-213) inserts only into the channel the user is currently viewing (`channel_id: channel.id`) — so in the official UI, the user is always a member. But the RLS policy doesn't enforce this for direct API access.
- **Behavioral differences:** Under normal UI use: the user is always viewing a channel they're a member of, so the insert succeeds. Under direct API access (devtools / programmatic attacker): the user can inject messages into channels they shouldn't have access to.
- **Git evidence:** Migration 0019 last touched in `b25e6ca` (2026-08-04, "FKFKFK"). The policy has been missing the membership check since the original commit.
- **Likely root cause:** The author wrote the policy mirroring the `chat_messages_select` pattern but without the EXISTS subquery — they assumed the channel_id would always correspond to a channel the user is a member of (a valid assumption for the official UI, but RLS should enforce invariants, not trust client behavior).
- **Potential impact:** Spam injection into staff channels (e.g., "fee collection" announcement channel) — staff would see the spam, can't trace it back to the attacker via the UI (the message appears with the attacker's avatar/name, but the attacker isn't a member so they can't be DMed back). Practical exploitation requires channel_id leakage.
- **Code snippet:**
```sql
-- 0019_rls_policies.sql:851-856 — author check, no channel-membership check
create policy chat_messages_insert on public.chat_messages
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and author_id = public.current_user_profile_id()
        -- ← NO EXISTS clause verifying member_ids @> ARRAY[author_id]
    );
```
- **Confidence:** Confirmed

### FINDING CHAT-102 — `chat_messages_update_own` RLS blocks recipients from marking messages as read; root cause of REALTIME-101 (extends, doesn't repeat)

- **What:** The only UPDATE policy on `chat_messages` is `chat_messages_update_own` (0019 line 857-860): `for update to authenticated using (tenant_id = current_tenant_id() and author_id = current_user_profile_id()) with check (tenant_id = current_tenant_id() and author_id = current_user_profile_id())`. There is NO policy allowing a RECIPIENT to UPDATE the `read_by` jsonb array of a message they did NOT author. The website's `markRead` effect (messages-view.tsx:158-180) attempts `supabase.from('chat_messages').update({ read_by: [...existing, {user_id, read_at}] }).eq('id', m.id)` for incoming messages (m.author_id ≠ user.id) — PostgREST's USING clause evaluates `author_id = current_user_profile_id()` as FALSE for those rows → 0 rows updated → response is `{ data: null, error: null, count: 0 }` (NO error) → the optimistic UI closes the conversation, the unread count is invalidated (but per REALTIME-100 the invalidation key is wrong, so the badge stays) → the message stays UNREAD server-side forever.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:857-860`; effect at `/home/z/my-project/repos/elimtiyaz-website/src/features/messages/messages-view.tsx:158-180`
- **How reached:** (Same end-to-end trace as REALTIME-101, but framed as the RLS-policy root cause rather than the swallowed-error symptom.) User opens a channel → messages.data arrives → useEffect fires markRead → filters incoming (author ≠ me, no read_by entry for me) → for each, runs UPDATE → PostgREST evaluates RLS USING → `author_id = current_user_profile_id()` is FALSE (author ≠ me) → 0 rows updated → no error → Promise.all resolves → invalidation fires (wrong key per REALTIME-100) → unread badge stays.
- **Intended responsibility:** Recipients should be able to APPEND to `read_by` (and ONLY to `read_by` — not modify body, deleted_at, edited_at, etc.). A separate policy like `chat_messages_update_read_receipt` with `using (EXISTS membership check) with check (NEW.read_by = jsonb_set(OLD.read_by, ...))` would scope it correctly.
- **Actual responsibility:** Only the author can UPDATE a message. The `read_by` array is write-once (set by the author at INSERT time per messages-view.tsx:204 — `read_by: [{ user_id: user.id, read_at: ... }]` — but never grows afterward). Recipients' read receipts are NEVER persisted server-side.
- **Dependents / consumers:** `useUnreadChatCount` (portal-queries.ts:484-518) reads `read_by` to compute unread; since recipient entries are never added, every incoming message counts as unread forever. Bottom-nav badge (bottom-nav.tsx:65,129) displays the (permanently wrong) count.
- **Alternative implementations of same operation:** The desktop's MOCK chat repository (`mock/workforce/index.ts:963-971`) has a `markRead` method that mutates the in-memory `readBy` array directly (bypassing RLS). The mock's behavior is what the production system was supposed to do — but the production RLS blocks it.
- **Behavioral differences:** Mock (desktop chat-panel): markRead works, read indicators display. Production (website messages-view): markRead is silently RLS-denied, no read indicators ever appear for recipients.
- **Git evidence:** Migration 0019 last touched in `b25e6ca` (2026-08-04, "FKFKFK"). The website's markRead effect last touched in `e90dbf7 mid` (2026-08-01). Both have been broken since their respective first commits.
- **Likely root cause:** The author wrote the UPDATE policy to allow editing/deleting one's OWN messages (a common chat feature) — `using (author_id = current_user_profile_id())` is correct for THAT use case. They forgot to add a SECOND policy allowing recipients to update `read_by`. The website's markRead effect was written assuming such a policy existed.
- **Potential impact:** Read receipts NEVER persist server-side for incoming messages. The unread badge is permanently wrong within a session. (User-facing symptom already documented in REALTIME-101 — this finding identifies the RLS-policy root cause so future remediation targets the policy, not just the swallowed-error symptom.)
- **Code snippet:**
```sql
-- 0019_rls_policies.sql:857-860 — ONLY author can UPDATE; recipients cannot
create policy chat_messages_update_own on public.chat_messages
    for update to authenticated
    using (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id())
    with check (tenant_id = public.current_tenant_id() and author_id = public.current_user_profile_id());
-- There is NO chat_messages_update_read_receipt policy that would allow
-- recipients to append to read_by. The website's markRead effect depends
-- on a policy that doesn't exist.
```
- **Confidence:** Confirmed — EXTENDS REALTIME-101 by identifying the RLS-policy root cause (REALTIME-101 documented the swallowed-error symptom)

### FINDING CHAT-103 — No production code anywhere creates `chat_channels` rows; the website's MessagesView is permanently empty for parents

- **What:** A repo-wide grep for `from("chat_channels")` / `from('chat_channels')` returns only ONE match in production code: `portal-queries.ts:442` — and that line is a SELECT (`.from('chat_channels').select('*').contains('member_ids', [userProfileId])`). There is NO INSERT into `chat_channels` anywhere — not in the website, not in the desktop's Supabase repositories (the desktop uses a MOCK chat repository per `supabase-repositories.ts:137` `...mockRepositories` spread — the chat key is never overridden), not in any Edge Function, not in any SQL migration seed. The desktop's mock `createChannel` (`mock/workforce/index.ts:850-876`) writes to an in-memory `this.channels` array — never to Supabase. The Android has zero chat code at all (only RBAC permission codes `USE_CHAT` / `MANAGE_CHAT_CHANNELS` in `Rbac.kt:66`). Result: the `chat_channels` table is empty in production. The website's `useChatChannels` query returns `[]`. The MessagesView shows "Aucune conversation" forever. There is no path — UI button, EF, RPC, or DB trigger — by which a staff member could create a parent-facing channel.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/portal-queries.ts:434-451` (useChatChannels — only reads)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts:137` (chat stays on mockRepositories — no Supabase override)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/mock/workforce/index.ts:850-876` (mock createChannel — in-memory only, never persists)
- **How reached:** Staff member opens the desktop → Personnel page → ChatPanel → clicks "Nouveau canal" → fills form → `handleCreateChannel` calls `repos.chat.createChannel(...)` → mock repository writes to in-memory array → never calls Supabase → channel exists only in the desktop's process memory → parent signs into the website → MessagesView → useChatChannels queries Supabase → returns `[]` → "Aucune conversation" empty state.
- **Intended responsibility:** Some code path should create a chat_channels row when (a) a staff member creates an announcement channel for a class, (b) a parent is linked to a staff member for 1:1 messaging, (c) an admin creates a department channel. None of these paths exist in production code.
- **Actual responsibility:** The `chat_channels` table is empty. No code writes to it. The website's chat UI is permanently empty.
- **Dependents / consumers:** Website `useChatChannels` (portal-queries.ts:434) and `useChatMessages` (line 453) — both query a permanently-empty table. Website `useUnreadChatCount` (line 484) queries `chat_messages` (also empty because there are no channels to attach messages to). Bottom-nav badge (bottom-nav.tsx:65,129).
- **Alternative implementations of same operation:** The desktop's mock chat is the only "implementation" of channel creation — but it's a mock, intended for development, never persists.
- **Behavioral differences:** Website MessagesView: permanently empty. Desktop ChatPanel: works locally within the desktop process (mock channels + mock messages) — but no other platform can see them. Android: no chat UI at all.
- **Git evidence:** Mock chat in `b25e6ca` (2026-08-04, "FKFKFK"). Website MessagesView in `e90dbf7 mid` (2026-08-01). Neither has ever had a production INSERT path.
- **Likely root cause:** The chat feature was spec'd in plan §10.09 and the schema was created in 0010 + 0019 — but the WRITE-side code was never written. The desktop's mock was a placeholder for a future Supabase port that never happened. The website's MessagesView was written assuming channels would exist (created by some other path).
- **Potential impact:** The entire chat feature is non-functional in production. Parents can never receive messages from staff. The unread badge is always 0 (because there are no messages to count as unread). The MessagesView is permanently in the "Aucune conversation" empty state.
- **Code snippet:**
```typescript
// portal-queries.ts:434-451 — website reads chat_channels but NOTHING writes to it
export function useChatChannels(userProfileId: string | null | undefined) {
  return useQuery({
    queryKey: ["chat-channels", userProfileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_channels")                  // <-- always returns []
        .select("*")
        .contains("member_ids", [userProfileId])
        .order("updated_at", { ascending: false });
      // ...
    },
  });
}

// supabase-repositories.ts:137-162 — desktop OVERRIDES most repos with Supabase
//   but NOT chat — it falls through to mockRepositories.chat
const repositories: Repositories = {
  ...mockRepositories,                          // <-- chat stays on mock
  auth, parents, students, payments, ledger, installments, debt,
  dashboard, academicYears, classes, subjects, grades, attendance,
  homework, promotion, audit, notifications, personnel, departments,
  // ← no `chat:` override — uses mockRepositories.chat (in-memory only)
};
```
- **Confidence:** Confirmed

### FINDING CHAT-104 — `chat_channels.updated_at` never updates when a new chat_message is INSERTed; channel list is sorted by CREATION time, not last-message time

- **What:** The `chat_channels_touch_updated_at` trigger (0010 line 404-405) is `before update on public.chat_channels` — it only fires when a chat_channels row is UPDATED, not when a chat_messages row is INSERTed. There is NO trigger `after insert on chat_messages` that would touch the parent channel's `updated_at` to reflect the new message's `sent_at`. The website's `useChatChannels` (portal-queries.ts:445) sorts channels by `updated_at desc` — so the channel list is sorted by when each channel was LAST UPDATED (i.e., when its metadata changed — name, member_ids), NOT by when the last message arrived. A channel that just received a new message stays at its old position in the list (sorted by creation time, since `updated_at` defaults to `created_at` and never changes after the channel is created).
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0010_workforce.sql:404-405` (only `before update` trigger — no `after insert on chat_messages`)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/portal-queries.ts:445` (sort by `updated_at desc`)
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/messages/messages-view.tsx:198-205` (send() INSERTs chat_message but does NOT update the channel's `updated_at`)
- **How reached:** Parent has Channel A (created yesterday) and Channel B (created today) → staff sends a new message in Channel A → INSERT into chat_messages → `chat_channels_touch_updated_at` does NOT fire (it's `before update on chat_channels`, not `after insert on chat_messages`) → Channel A's `updated_at` stays yesterday → useChatChannels sorts by `updated_at desc` → Channel B (today) appears above Channel A (yesterday) → parent sees Channel B at the top of the list even though Channel A has the new message → parent doesn't realize Channel A has new activity.
- **Intended responsibility:** The channel list should be sorted by "last message time" — i.e., the `max(sent_at)` of the channel's chat_messages. Either via (a) a DB trigger that updates `chat_channels.updated_at` on chat_message INSERT, or (b) a separate `last_message_at` column maintained by the trigger, or (c) a JOIN/subquery in the SELECT that fetches the max sent_at.
- **Actual responsibility:** `chat_channels.updated_at` only reflects metadata changes (name/member changes). The channel list looks permanently stale.
- **Dependents / consumers:** `useChatChannels` query (portal-queries.ts:445). `ChannelListItem` in messages-view.tsx (line 132) displays `formatRelative(channel.updated_at)` — always shows "il y a X jours" where X = days since the channel was created/renamed, not since the last message.
- **Alternative implementations of same operation:** The desktop's MOCK chat repository (`mock/workforce/index.ts:928-938`) explicitly updates `lastMessageAt: msg.createdAt` and `lastMessagePreview: msg.body.slice(0, 80)` on the channel after a sendMessage. The mock has this feature; production doesn't.
- **Behavioral differences:** Mock: channel list re-orders when new messages arrive. Production: channel list stays in creation-time order forever.
- **Git evidence:** Mock sendMessage last touched in `b25e6ca` (2026-08-04). Website useChatChannels in `e90dbf7 mid` (2026-08-01). The trigger in 0010 in `b25e6ca`.
- **Likely root cause:** The author of the canonical schema (0010) forgot to add a `after insert on chat_messages` trigger that would touch the parent channel's `updated_at`. The mock's `lastMessageAt` column was supposed to mirror a real DB column — but there's no `last_message_at` column in the canonical `chat_channels` table either (only `updated_at`).
- **Potential impact:** Parents cannot tell at a glance which channel has the most recent activity. The "formatRelative(channel.updated_at)" preview text on each channel row always shows the channel's creation time, never the last-message time. Combined with CHAT-103 (no channels exist), this is currently invisible — but as soon as channels start being created (manually via SQL), this staleness becomes visible.
- **Code snippet:**
```sql
-- 0010_workforce.sql:404-405 — only fires on UPDATE of chat_channels, NOT on INSERT of chat_messages
create trigger chat_channels_touch_updated_at before update on public.chat_channels
    for each row execute function public.touch_updated_at();
-- There is NO trigger like:
--   create trigger chat_messages_touch_channel_updated_at
--     after insert on public.chat_messages
--     for each row execute function public.touch_channel_updated_at();
```
```typescript
// portal-queries.ts:445 — sorts by updated_at, which is the channel's metadata
// last-touched time, NOT the last message time
.order("updated_at", { ascending: false })
```
- **Confidence:** Confirmed

### FINDING CHAT-105 — Desktop's ChatPanel uses MOCK chat repository; staff chat never persists to the canonical DB tables (extends CHAT-103)

- **What:** The desktop's `getSupabaseRepositories()` factory (`supabase-repositories.ts:79-172`) builds a `Repositories` object that OVERRIDES most mock repositories with Supabase-backed implementations — but the `chat` key is NOT in the override list. It falls through to `...mockRepositories` (line 138 spread). The mock chat repository (`mock/workforce/index.ts:820-972`) maintains in-memory `channels: ChatChannel[]` and `messages: ChatMessage[]` arrays. When the desktop app process exits (close window), all chat data is wiped. The desktop's ChatPanel UI (`features/personnel/management/chat-panel.tsx`) calls `repos.chat.observeChannels(currentUserId)`, `repos.chat.sendMessage(...)`, `repos.chat.editMessage(...)`, `repos.chat.deleteMessage(...)`, `repos.chat.markRead(...)` — all of which hit the mock, never Supabase. Result: staff-to-staff chat in the desktop is a sandboxed mock that no other platform can see, and parents (via the website) have no path to receive messages from staff.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts:137-162` (mock fallback spread; no `chat` override)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/mock/workforce/index.ts:820-972` (mock chat implementation, in-memory only)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx` (uses `repos.chat.*`)
- **How reached:** Staff opens desktop → Personnel → ChatPanel → sends a message → `repos.chat.sendMessage(...)` → mock repository appends to in-memory `messages` array → `notifyMessages()` fires the in-memory SubjectBehavior → ChatPanel re-renders showing the new message → BUT no Supabase INSERT happens → no realtime event published → no other platform sees the message → desktop process closes → all messages wiped.
- **Intended responsibility:** The chat repository should be backed by Supabase (similar to `SupabaseParentRepository`, `SupabasePaymentRepository`, etc.) so messages persist and are visible to other platforms (website MessagesView via the canonical `chat_messages` table).
- **Actual responsibility:** The mock repository is used. Messages are in-memory only. No persistence, no cross-platform visibility.
- **Dependents / consumers:** `ChatPanel` (chat-panel.tsx). Future code that expected to read staff-sent messages from the canonical tables.
- **Alternative implementations of same operation:** All other workforce entities (departments, personnel) have Supabase-backed implementations in the same factory file. Only chat (and tasks, shifts, schedules, onboarding, leave requests, performance reviews) remain on mock — but chat is the ONLY one of those that has a UI active in the app (ChatPanel). So chat is the most impactful mock-fallback.
- **Behavioral differences:** All other repositories in the desktop persist to Supabase when VITE_USE_SUPABASE=true. Chat silently falls back to mock. The user has no UI indication that chat is mock-only — they see a fully-functional chat interface.
- **Git evidence:** `supabase-repositories.ts` last touched in `94471e8` (2026-08-28). The mock chat repository in `b25e6ca` (2026-08-04). The mock has never had a Supabase counterpart.
- **Likely root cause:** The desktop's chat feature was implemented as a mock-first proof-of-concept. The plan was to port it to Supabase later (the file header at `supabase-repositories.ts:23-24` says "Releve/timesheets, workforce tasks, chat, shifts, schedules and onboarding remain on the mock layer"). The port never happened.
- **Potential impact:** Staff cannot communicate with parents via chat (parents see the website's permanently-empty MessagesView per CHAT-103). Staff-to-staff chat in the desktop is a sandbox — useful for demos but useless in production. Even within the desktop, chat history is wiped on app close.
- **Code snippet:**
```typescript
// supabase-repositories.ts:137-162 — chat is NOT in the override list
const repositories: Repositories = {
  ...mockRepositories,                // <-- chat falls through to mockRepositories.chat
  auth,
  parents,                            // <-- all these are Supabase-backed
  students,
  payments,
  // ... 15 more Supabase-backed repos ...
  personnel,
  departments,
  // ← no `chat` key — so `repositories.chat` === `mockRepositories.chat` (in-memory)
};
```
- **Confidence:** Confirmed — EXTENDS CHAT-103 (the chat_channels table is empty because NO production code writes to it; the desktop's chat writes to a mock array instead)

### FINDING NOTIF-100 — `notifications_update` RLS blocks recipients from marking role-broadcast notifications as read; bulk mark-read silently no-ops (extends REALTIME-101 from chat_messages to notifications)

- **What:** The `notifications_update` RLS policy (0019 line 1036-1042) is `for update to authenticated using (tenant_id = current_tenant_id() and (target_user_id = current_user_profile_id() or has_role('super_admin'))) with check (tenant_id = current_tenant_id())`. The USING clause only matches rows where `target_user_id = current_user_profile_id()` — i.e., DIRECT (user-targeted) notifications. For ROLE-BROADCAST notifications (`target_user_id IS NULL`, `target_role = 'parent'` etc.), the USING clause is FALSE (target_user_id ≠ current_user_profile_id() — it's NULL). PostgREST returns 0 rows updated, NO error. The website's `markAllRead` (`notifications-view.tsx:87-91`) runs `supabase.from('notifications').update({...}).eq('target_user_id', user.id).eq('is_read', false)` — but this filter explicitly excludes role-broadcasts (they have target_user_id NULL). The website's per-notification `markRead` (`notifications-view.tsx:108-111`) uses `.eq('id', n.id)` — for a role-broadcast, RLS denies → 0 rows updated → no error → UI optimistically refetches → role-broadcast comes back with `is_read: false` forever. The desktop's `markRead(id)` (supabase-notification-repository.ts:169-179) and `dismiss(id)` (line 211-221) have the same silent RLS-denial behavior for role-broadcasts. The Android's `markRead`/`markAllRead`/`dismiss` (LocalRepositories2.kt:1525-1537) only update the LOCAL Room cache (no server push) — the server's `is_read` / `dismissed_at` stays at their original values.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:1036-1042` (UPDATE policy)
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/notifications/notifications-view.tsx:87-117` (markAllRead + markRead)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-notification-repository.ts:169-179, 211-221` (desktop markRead + dismiss — both silently RLS-denied for role-broadcasts)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1525-1537` (Android markRead/markAllRead/dismiss — local-only, no server push)
- **How reached:** Workflow fires overdue scan → INSERT notification with `target_role='financial_officer'` (run-overdue-scan EF line 222) → notification row (target_user_id IS NULL, target_role='financial_officer') → financial officer signs into desktop → topbar bell shows the notification → officer clicks "Tout marquer comme lu" → `markAllRead()` → `UPDATE notifications SET is_read=true, read_at=now() WHERE tenant_id=T AND dismissed_at IS NULL AND is_read=false` → PostgREST applies RLS USING clause → `target_user_id = current_user_profile_id()` is FALSE for the role-broadcast row (target_user_id is NULL) → 0 rows updated → no error → `await refresh()` runs → SELECT returns the same notification with `is_read=false` → bell badge stays at 1 → officer frustrated.
- **Intended responsibility:** A recipient (matching the target_role) should be able to mark their own VIEW of a role-broadcast notification as read. Either via a per-user-read-state table (e.g., `notification_reads(notification_id, user_profile_id, read_at)`) OR via the existing `is_read` column being interpreted per-user (which would require a different data model). The current single `is_read` column is shared across all recipients of a role-broadcast — even if one recipient could update it, doing so would mark it as read for ALL recipients.
- **Actual responsibility:** Role-broadcast notifications can NEVER be marked as read or dismissed by recipients (only super_admin can update them). They stay in the unread state forever. The bell badge stays at the cumulative unread count indefinitely (until the notification's `expires_at` passes — and most notifications don't set `expires_at`).
- **Dependents / consumers:** Website top-app-bar bell (top-app-bar.tsx:50-54, 84-91), website notifications-view (notifications-view.tsx:135-141 — the "Tout marquer comme lu" button only shows when `notifications.data.some(n => !n.is_read)` — so the button keeps re-appearing). Desktop topbar bell (topbar.tsx:115-118 unreadCount). Android DashboardNotificationsSection (line 128 `notifications.filter { it.readAt == null }`).
- **Alternative implementations of same operation:** None — there is no `notification_reads` table in the schema. The `is_read` flag is the only mechanism, and it's monolithic (not per-recipient).
- **Behavioral differences:** Direct notifications (target_user_id set): markRead works. Role-broadcast notifications (target_user_id NULL, target_role set): markRead silently RLS-denied — the notification stays unread forever in the UI.
- **Git evidence:** 0019 RLS last touched in `b25e6ca` (2026-08-04). notifications-view markRead in `e90dbf7 mid` (2026-08-01). supabase-notification-repository in `b25e6ca`.
- **Likely root cause:** The notifications schema was designed assuming each notification has ONE recipient (target_user_id). The role-broadcast mode (target_role) was added later as an afterthought — the `is_read` column doesn't support per-recipient read state. The RLS policy correctly enforces "only the direct recipient can mark as read" — but there's no equivalent mechanism for role-broadcast recipients.
- **Potential impact:** Role-broadcast notifications (e.g., "Payment overdue scan completed" targeted to financial_officer role) stay unread forever in every financial officer's bell. The bell badge is permanently > 0. Users learn to ignore it. Real urgent notifications get lost in the noise.
- **Code snippet:**
```sql
-- 0019_rls_policies.sql:1036-1042 — only direct recipient can UPDATE
create policy notifications_update on public.notifications
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (target_user_id = public.current_user_profile_id() or public.has_role('super_admin'))
        -- ← target_user_id is NULL for role-broadcasts → using = FALSE → 0 rows updated
    )
    with check (tenant_id = public.current_tenant_id());
```
```typescript
// notifications-view.tsx:87-91 — markAllRead only filters by user_id (misses role-broadcasts)
const { error } = await supabase
  .from("notifications")
  .update({ is_read: true, read_at: new Date().toISOString() })
  .eq("target_user_id", user.id)   // ← excludes role-broadcasts (target_user_id IS NULL)
  .eq("is_read", false);
```
- **Confidence:** Confirmed — EXTENDS REALTIME-101 by showing the SAME RLS-denial pattern applies to the `notifications` table (not just `chat_messages`)

### FINDING NOTIF-101 — `notifications_insert` RLS allows any authenticated user to INSERT a notification addressed to ANY user_id (notification spam / injection)

- **What:** The `notifications_insert` RLS policy (0019 line 1033-1035) is `for insert to authenticated with check (tenant_id = current_tenant_id())`. The `with check` clause ONLY verifies `tenant_id` — there is NO check that `target_user_id = current_user_profile_id()` (i.e., the inserter can only create notifications for themselves) OR that the inserter has an admin role. Any authenticated user in the tenant can INSERT a notification with `target_user_id` set to ANY other user's profile UUID. The recipient would see the notification in their bell (per `notifications_select` line 1023-1032, which allows `target_user_id = current_user_profile_id()`).
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:1033-1035`
- **How reached:** Attacker (parent A) signs into the website → opens browser devtools → calls `supabase.from('notifications').insert({ tenant_id: T, kind: 'alert', title: 'URGENT: Verify your account', body: 'Click here to confirm your password: phishing-link.example', priority: 'urgent', source: 'manual', source_label: 'Système', target_user_id: '<parent_B_uuid>', link_entity_type: 'parent', link_entity_id: '<parent_B_uuid>' })` → PostgREST runs INSERT through RLS → `with check (tenant_id = current_tenant_id())` passes (the row's tenant_id is the attacker's tenant) → INSERT succeeds → parent B's bell now shows an "urgent" notification with the attacker's crafted title and body → parent B taps it → the deep link routes them to their own profile (link_entity_type='parent') but the body text contains a phishing link → parent B clicks the link in the body → social engineering attack succeeds.
- **Intended responsibility:** Only authorized senders (super_admin, support_staff, system via SECURITY DEFINER RPC) should be able to INSERT notifications addressed to other users. A parent should NEVER be able to send a notification to another parent.
- **Actual responsibility:** Any authenticated user can INSERT a notification to any user_id in their tenant. The recipient sees it in their bell with the attacker's chosen title, body, priority, source_label.
- **Dependents / consumers:** Website top-app-bar bell (top-app-bar.tsx:50-54). Website notifications-view (notifications-view.tsx). Desktop topbar bell (topbar.tsx:122). Android DashboardNotificationsSection (line 128). All would display the injected notification as if it were system-generated.
- **Alternative implementations of same operation:** The desktop's `SupabaseNotificationRepository.create` (supabase-notification-repository.ts:227-255) is the OFFICIAL UI path for creating notifications — but it uses the same RLS-permitted INSERT, so it has no extra server-side authorization. There's no EF or RPC that creates notifications with additional auth checks.
- **Behavioral differences:** Direct INSERT via devtools: attacker can target any user_id. UI path (AlertCreatorModal): admin picks target_user_id from a dropdown — but the dropdown only shows users the admin has access to, so the UI is constrained. The RLS layer doesn't enforce the UI constraint.
- **Git evidence:** Migration 0019 in `b25e6ca` (2026-08-04). The policy has been permissive since the original commit.
- **Likely root cause:** Same as CHAT-100 — the author wrote a generic "tenant-bound INSERT" without considering the per-user authorization. The notifications table was assumed to be written only by trusted server-side code (EFs, triggers), but the RLS layer allows any client INSERT.
- **Potential impact:** (1) Notification spam / harassment: a parent can flood another parent's bell with hundreds of "urgent" notifications. (2) Phishing: a crafted notification body could contain a malicious link — the notification appears system-generated (kind='alert', source_label='Système'). (3) Impersonation: a parent can make a notification that LOOKS like it came from the principal (source_label='Direction'). The recipient has no way to verify the notification's authenticity.
- **Code snippet:**
```sql
-- 0019_rls_policies.sql:1033-1035 — only tenant_id checked
create policy notifications_insert on public.notifications
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
-- NO check that target_user_id = current_user_profile_id()
-- NO check that the inserter has an admin role
-- NO check that source='manual' requires has_role('super_admin' or 'support_staff')
```
- **Confidence:** Confirmed

### FINDING NOTIF-102 — Desktop topbar bell `unreadCount` is computed AFTER slicing to 8 items; badge caps at 8 even when actual unread is 50

- **What:** The desktop's topbar (topbar.tsx:107-118) computes `visibleNotifications = sortAlertsByPriority(visible).slice(0, 8)` — i.e., the top 8 alerts by priority. THEN computes `unreadCount = visibleNotifications.filter((n) => !n.readAt).length` — i.e., count of unread IN THE FIRST 8. If a user has 50 unread alerts, only the top 8 (by priority) are considered — the badge shows at most 8. The dropdown (line 236-241) shows "8 non lues" even though there are 50. The "Tout marquer comme lu" button (which appears in the AlertsTab, not the dropdown) DOES call markAllRead which would mark ALL 50 as read — but the bell badge never reflects the true count.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/shared/layout/topbar.tsx:107-118`
- **How reached:** Workflow fires many overdue scans + manual alerts → 50 unread notifications → user opens the desktop → topbar subscribes to `repos.notifications.observe()` (raw stream of all notifications) → `visibleNotifications = filter(isAlertVisibleTo(session)).sort(byPriority).slice(0, 8)` → `unreadCount = visibleNotifications.filter(!readAt).length` → badge shows "8" → user clicks bell → dropdown shows 8 items + "8 non lues" label → user marks all read via AlertsTab → ALL 50 notifications are marked read server-side → badge drops to 0 → but the user thought there were only 8.
- **Intended responsibility:** The bell badge should show the user's TOTAL unread count, not the unread count of the first-8-sorted-by-priority. Either compute the count from the raw stream (before slicing) OR run a separate COUNT query.
- **Actual responsibility:** The badge shows ≤8. Users with >8 unread alerts see a misleading count.
- **Dependents / consumers:** The bell badge UI (topbar.tsx:229-233). The dropdown label (topbar.tsx:239 "X non lues").
- **Alternative implementations of same operation:** The website's top-app-bar (top-app-bar.tsx:50-54) uses `useNotifications(user.id, { unreadOnly: true, limit: 50 })` and displays `unread?.length ?? 0` — capped at 50 (per NOTIF-103 below). The Android's NotificationDao.observeUnreadCount (LocalDaos.kt:512-513) runs `SELECT COUNT(*) FROM notifications WHERE isRead = 0` — UNLIMITED count (correct). So Android does it correctly; desktop and website cap the count.
- **Behavioral differences:** Desktop: caps at 8. Website: caps at 50. Android: correct count. All three platforms disagree.
- **Git evidence:** topbar.tsx last touched in `94471e8` (2026-08-28). The slice-then-count pattern has been there since the file's first commit.
- **Likely root cause:** The author conflated "what to display in the dropdown" (top 8 by priority) with "how many unread total" (the badge count). They reused the same array for both purposes. The slice is correct for the dropdown; it shouldn't be applied to the count.
- **Potential impact:** Users with many unread alerts see "8" in the badge and think they only have 8 left. They dismiss them, expecting the badge to drop to 0 — but if more unread arrive in the meantime, the badge stays at 8 (because the new ones fill the slice). The user never knows the true count.
- **Code snippet:**
```typescript
// topbar.tsx:107-118 — slice BEFORE counting
const visibleNotifications = useMemo(() => {
    if (!session) return [];
    const visible = notifications.filter((n) =>
      isAlertVisibleTo(n, { userId: session.userId, role: session.role }),
    );
    return sortAlertsByPriority(visible).slice(0, 8);   // <-- slice to top 8
  }, [notifications, session]);

  const unreadCount = useMemo(
    () => visibleNotifications.filter((n) => !n.readAt).length,  // <-- count from sliced 8
    [visibleNotifications],
  );
// CORRECT would be:
//   const unreadCount = useMemo(
//     () => notifications.filter((n) => isAlertVisibleTo(n, session) && !n.readAt).length,
//     [notifications, session],
//   );
```
- **Confidence:** Confirmed

### FINDING NOTIF-103 — Website bottom-nav fetches 1 unread notification but never renders it (dead query); top-app-bar bell caps unread at 50

- **What:** Two compounding UI bugs in the website's notification badge plumbing: (1) `bottom-nav.tsx:60-64` runs `useNotifications(user?.id, { unreadOnly: true, limit: 1 })` and computes `hasUnreadNotifications = Boolean(unreadNotifications && unreadNotifications.length > 0)` — but `hasUnreadNotifications` is NEVER referenced in the JSX that follows. The query fires on every render of BottomNav + DesktopRail (both components duplicate the query), loading 1 row from the server, but the boolean is never used. This is a dead query — wasted bandwidth + TanStack cache pollution. (2) `top-app-bar.tsx:50-54` runs `useNotifications(user?.id, { unreadOnly: true, limit: 50 })` and displays `unread?.length ?? 0` — so the bell badge caps at 50. A user with 200 unread notifications sees "50" in the bell. (3) The bottom-nav and top-app-bar run INDEPENDENT queries with different limits (1 vs 50) — TanStack treats them as different cache keys (because the limit is in the key) and stores them separately. So there are 3 concurrent notification queries on every page render (bottom-nav + desktop-rail + top-app-bar).
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/shared/bottom-nav.tsx:60-64, 124-128` (dead query duplicated in both BottomNav and DesktopRail)
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/shared/top-app-bar.tsx:50-54` (caps at 50)
- **How reached:** User opens the website → BottomNav mounts → useNotifications(limit=1, unreadOnly=true) fires → server returns 1 unread → hasUnreadNotifications = true → never rendered. DesktopRail also mounts (lg+ only) → another useNotifications(limit=1, unreadOnly=true) fires → same wasted query. TopAppBar mounts → useNotifications(limit=50, unreadOnly=true) fires → bell badge shows min(actualUnread, 50).
- **Intended responsibility:** The bottom-nav's `hasUnreadNotifications` should drive a notification bell badge somewhere (probably the bottom-nav's "messages" item or a dedicated bell). The top-app-bar should use the actual unread count without capping.
- **Actual responsibility:** bottom-nav's query is dead (computed but never rendered). top-app-bar caps at 50.
- **Dependents / consumers:** TanStack Query cache (3 separate cache entries for the same logical data). Server (3 SELECT queries per page render). User (sees a capped / wrong badge).
- **Alternative implementations of same operation:** The desktop topbar (topbar.tsx:115-118) computes unreadCount from the raw stream (no limit) — but slices to 8 first (per NOTIF-102). The Android (LocalDaos.kt:512-513) uses a SQL COUNT(*) with no limit — correct.
- **Behavioral differences:** Desktop: caps at 8. Website top-app-bar: caps at 50. Website bottom-nav: dead query, no badge. Android: correct count.
- **Git evidence:** bottom-nav.tsx and top-app-bar.tsx both in `e90dbf7 mid` (2026-08-01). Both have been broken since first commit.
- **Likely root cause:** (1) The bottom-nav was originally intended to have a bell icon but was removed (per bottom-nav.tsx header comment line 18-19: "Notifications is reachable via the top app bar bell icon, not the bottom nav"). The query was left behind during the cleanup. (2) The top-app-bar's limit=50 was an arbitrary choice to avoid loading thousands of notifications — but using `.length` of a limited result as the count is the wrong pattern (should use a COUNT query or head(1) to check "any unread" + a separate "list" query).
- **Potential impact:** (1) Server load: 3x the necessary SELECT queries per page render. (2) UI lie: a user with 200 unread sees "50" and thinks they have 50 — after dismissing 50, the badge drops to 0 even though 150 remain unread (because the limit=50 query would return []).
- **Code snippet:**
```typescript
// bottom-nav.tsx:60-64 — DEAD QUERY (computed, never rendered)
const { data: unreadNotifications } = useNotifications(user?.id ?? null, {
  unreadOnly: true,
  limit: 1,
});
const hasUnreadNotifications = Boolean(unreadNotifications && unreadNotifications.length > 0);
// hasUnreadNotifications is never used in JSX below — there's no bell in the bottom-nav
// (the bottom-nav only has 5 nav items, no notification bell per the header comment)

// top-app-bar.tsx:50-54 — caps badge at 50
const { data: unread } = useNotifications(user?.id ?? null, {
  unreadOnly: true,
  limit: 50,                                          // <-- caps at 50
});
const unreadCount = unread?.length ?? 0;              // <-- min(actualUnread, 50)
```
- **Confidence:** Confirmed

### FINDING NOTIF-104 — Android `NotificationDao.markRead/markAllRead/dismiss` only update LOCAL Room; server's `notifications.is_read` / `dismissed_at` stays at original values forever (silent desync)

- **What:** Android's `LocalNotificationRepository` (LocalRepositories2.kt:1515-1538) wraps `NotificationDao` methods that only run SQL against the LOCAL Room database:
  - `markRead(id)` → `notificationDao.markRead(id)` → `UPDATE notifications SET isRead=1 WHERE id=:id` (LocalDaos.kt:521-522) — LOCAL only
  - `markAllRead()` → `notificationDao.markAllRead()` → `UPDATE notifications SET isRead=1 WHERE isRead=0` (LocalDaos.kt:524-525) — LOCAL only
  - `dismiss(id)` → `notificationDao.dismiss(id)` → `DELETE FROM notifications WHERE id=:id` (LocalDaos.kt:527-528) — LOCAL only (hard delete, not soft-dismiss)
  None of these methods call `supabase.from('notifications').update(...)` to push the read state to the server. Result: when an Android user marks a notification as read, the server's `notifications.is_read` stays `false`. When the next `pullNotifications()` (PullSyncRepository.kt:234-243) runs every 15 min, the server returns the notification with `is_read=false` — but Room uses `@Insert(onConflict = OnConflictStrategy.REPLACE)` (LocalDaos.kt:515-516) which OVERWRITES the local `isRead=true` with the server's `isRead=false`. The user's "read" state is silently REVERTED every 15 minutes.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1515-1538` (LocalNotificationRepository)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/LocalDaos.kt:505-529` (NotificationDao)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt:234-243` (pullNotifications overwrites local state)
- **How reached:** User opens Android app → pullNotifications runs (every 15 min) → server returns 5 unread notifications → Room stores them with isRead=0 → user opens AlertsScreen → taps a notification → AlertsViewModel.markRead(id) → LocalNotificationRepository.markRead(id) → Room updates the row to isRead=1 → UI shows the notification as read → 15 minutes later, SyncWorker fires → pullNotifications runs → server returns the SAME 5 notifications (server still has is_read=false) → `db.notificationDao().upsertAll(listOf(dto.toEntity()))` (line 237) → REPLACE strategy overwrites the local row → isRead reverts to 0 → user opens AlertsScreen → the notification they "read" is back to unread.
- **Intended responsibility:** The Android's notification repository should push read/dismiss state to the server (e.g., call `supabase.from('notifications').update({ is_read: true, read_at: now }).eq('id', id)`) BEFORE updating local Room, OR enqueue an offline mutation that drains on next sync.
- **Actual responsibility:** Only local Room is updated. The server's `notifications.is_read` and `dismissed_at` stay at their original values. The next pull OVERWRITES local state.
- **Dependents / consumers:** The server's `notifications` table (used by the website's bell and the desktop's bell). The Android's AlertsScreen UI.
- **Alternative implementations of same operation:** The desktop's `SupabaseNotificationRepository.markRead` (line 169-179) DOES push to server (calls `this.client.from('notifications').update({...}).eq('id', id)`) — but per NOTIF-100 it's silently RLS-denied for role-broadcasts. The website's markRead (notifications-view.tsx:108-111) also pushes to server (also RLS-denied for role-broadcasts). The Android is the ONLY platform that doesn't even ATTEMPT to push to the server.
- **Behavioral differences:** Desktop: pushes to server (RLS-denied for role-broadcasts, succeeds for direct). Website: pushes to server (same). Android: NEVER pushes to server. The Android's "read" state is the most ephemeral — reverted every 15 min.
- **Git evidence:** LocalRepositories2.kt last touched in `94471e8` (2026-08-28). The notification repository has been local-only since first commit. The comment at line 1527-1529 says "both methods previously returned Ok(Unit) without touching the database" — so the fix made them touch the LOCAL DB but didn't add server-push.
- **Likely root cause:** The Android's sync architecture was designed as PULL-dominant (PullSyncRepository) — push-side (SyncQueueDispatcher) only handles entity mutations (parents, students, payments), not notification state changes. Notification read/dismiss was considered a "client-side" concern — but this causes server desync.
- **Potential impact:** (1) Read state reverts every 15 minutes — users see the same notifications marked unread again. (2) The Android's `dismiss(id)` does a LOCAL HARD-DELETE — but the next pull re-inserts the row (REPLACE on conflict doesn't prevent INSERT of a new row) — so dismissed notifications reappear. (3) The website and desktop (which query the server) never see the Android user's read/dismiss state — so the user's notification state is fragmented across platforms.
- **Code snippet:**
```kotlin
// LocalRepositories2.kt:1515-1538 — local-only, no server push
@Singleton
class LocalNotificationRepository @Inject constructor(
    private val notificationDao: NotificationDao,
) : NotificationRepository {
    override fun observe(): Flow<List<AppNotification>> = ...
    override fun observeForSession(session: Session): Flow<List<AppNotification>> = ...
    override suspend fun markRead(id: String): Result<Unit> {
        notificationDao.markRead(id)            // <-- LOCAL Room UPDATE only
        return Result.Ok(Unit)                  // <-- no supabase.from("notifications").update(...)
    }
    override suspend fun markAllRead(): Result<Unit> {
        notificationDao.markAllRead()           // <-- LOCAL only
        return Result.Ok(Unit)
    }
    override suspend fun dismiss(id: String): Result<Unit> {
        notificationDao.dismiss(id)             // <-- LOCAL DELETE only
        return Result.Ok(Unit)
    }
}

// LocalDaos.kt:515-516 — REPLACE strategy overwrites local state on next pull
@Insert(onConflict = OnConflictStrategy.REPLACE)
suspend fun upsertAll(rows: List<NotificationEntity>)
```
- **Confidence:** Confirmed

### FINDING NOTIF-105 — Android `pullNotifications` pulls ALL server-visible notifications (limit:200) with no per-user filter; stale role-broadcasts persist in Room across role changes

- **What:** Android's `PullSyncRepository.pullNotifications` (line 234-243) runs `provider.postgrest.from("notifications").select { limit(200) }` — NO filter by `target_user_id`, NO filter by `target_role`, NO filter by `tenant_id` (RLS scopes by tenant_id implicitly), NO filter by `is_read` or `dismissed_at`. The query returns whatever the server's RLS allows — for a parent, that's their direct notifications + role-broadcasts for `parent` role + tenant-broadcasts (which parents can't see per RLS). Then `db.notificationDao().upsertAll(listOf(dto.toEntity()))` (line 237) loops over the results ONE AT A TIME (O(N) Room round-trips — should be `upsertAll(dtoList.map { it.toEntity() })` for a single batch INSERT) and uses `@Insert(onConflict = OnConflictStrategy.REPLACE)` which OVERWRITES existing rows. The `NotificationEntity` doesn't track which user/role the notification was targeted to — so a notification stored today as a `parent` role-broadcast stays in Room forever. If the user's role later changes (e.g., they're promoted to staff), the OLD parent-role-broadcast notifications stay in Room — but `observeForUser(userId)` query (`WHERE targetUserId IS NULL OR targetUserId = :userId`) returns them all (because targetUserId IS NULL matches). The promoted user sees stale parent-targeted notifications in their new staff AlertsScreen.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt:234-243` (no filter pull)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/LocalDaos.kt:505-529` (NotificationDao — no eviction, no role filter)
- **How reached:** Parent signs in with `parent` role → pullNotifications runs → server RLS allows: 5 direct notifications + 3 parent-role-broadcasts → Room stores 8 rows → 6 months later, parent is promoted to `support_staff` role (still in the same tenant) → user signs in → pullNotifications runs → server RLS now allows: 5 direct + 3 parent-role-broadcasts + 4 staff-role-broadcasts + 2 tenant-broadcasts → Room stores 14 rows (8 old + 6 new) → AlertsScreen's `observeForUser(userId)` query returns ALL 14 → user sees the 3 stale parent-targeted role-broadcasts in their staff feed — even though they're no longer a parent.
- **Intended responsibility:** The pull should filter by the user's current role (and target_user_id) — only fetching notifications relevant to the CURRENT session. The local cache should evict notifications that no longer match the user's role on each pull.
- **Actual responsibility:** Pull fetches whatever RLS allows (which is role-dependent). The local cache never evicts — REPLICE strategy only updates existing rows; rows that EXIST in Room but are NOT in the pull result stay forever.
- **Dependents / consumers:** AlertsScreen (DashboardViewModel.notifications StateFlow). DashboardNotificationsSection (line 128 filters `readAt == null`). The Android user sees stale role-mismatched notifications.
- **Alternative implementations of same operation:** The website's `useNotifications` (portal-queries.ts:357-378) uses `.or(target_user_id.eq.${targetUserId}, target_user_id.is.null)` — includes ALL role-broadcasts in the cache (but RLS scopes by current role). The desktop's `SupabaseNotificationRepository.refresh` (line 126-142) uses `.eq('tenant_id', T).is('dismissed_at', null).order('created_at desc').limit(200)` — no role filter either, but the desktop's `observeForSession` (line 159-167) does `isAlertVisibleTo(n, session)` client-side filtering (which IS role-aware). So the desktop handles role changes correctly via client-side filtering; the Android does not.
- **Behavioral differences:** Website: RLS scopes per current role, no stale data. Desktop: RLS scopes per current role + client-side filter via isAlertVisibleTo. Android: RLS scopes per current role at PULL time, but Room cache persists across role changes without re-filtering.
- **Git evidence:** PullSyncRepository.kt last touched in `94471e8` (2026-08-28). LocalDaos.kt in same commit.
- **Likely root cause:** The Android was designed with a "cache-then-observe" pattern — pull everything RLS allows, observe locally. The author didn't consider role CHANGES (which are rare but happen). The local cache has no time-to-live, no eviction, no role-based re-filtering.
- **Potential impact:** (1) Stale role-mismatched notifications appear in the user's feed after a role change. (2) Performance: the `for (dto in dtoList) db.notificationDao().upsertAll(listOf(dto.toEntity()))` loop is O(N) Room writes instead of 1 batch INSERT — slow for 200 notifications. (3) The local cache grows unbounded — over years, a user could accumulate thousands of stale notifications.
- **Code snippet:**
```kotlin
// PullSyncRepository.kt:234-243 — no filter pull + O(N) loop
suspend fun pullNotifications(): Result<Int> = withContext(Dispatchers.IO) {
    try {
        val dtoList = provider.postgrest.from("notifications").select { limit(200) }
            .decodeList<NotificationDto>()
        // <-- NO .eq("target_user_id", userId) filter
        // <-- NO .eq("target_role", currentRole) filter
        // <-- NO .is("dismissed_at", null) filter
        for (dto in dtoList) db.notificationDao().upsertAll(listOf(dto.toEntity()))  // <-- O(N) round-trips
        Result.Ok(dtoList.size)
    } catch (e: Exception) {
        Result.Err(com.example.core.Errors.fromException(e))
    }
}

// LocalDaos.kt:509-510 — observeForUser returns ALL role-broadcasts (targetUserId IS NULL)
@Query("SELECT * FROM notifications WHERE targetUserId IS NULL OR targetUserId = :userId ORDER BY createdAt DESC LIMIT 100")
fun observeForUser(userId: String): Flow<List<NotificationEntity>>
```
- **Confidence:** Confirmed

### FINDING PUSH-100 — NO production code anywhere invokes the `send-push-notification` Edge Function (extends WEAK-014/WEAK-015 to a 3rd compounding bug)

- **What:** A repo-wide grep for `functions.invoke("send-push-notification")` or `fetch(".../functions/v1/send-push-notification")` returns ZERO matches in production code. The EF header (`send-push-notification/index.ts:7-11`) claims "Invoked by: Workflow actions ... The notifications table INSERT trigger (via a Supabase webhook) ... Manual admin triggers from the desktop app". Each of these invocation paths is BROKEN: (1) The workflow `push_notification` action (workflow-execute/index.ts:307-316) is a STUB — it returns `{ output: { stub: true, target_role, title, provider: "fcm" }, auditNote: "STUB push_notification ..." }` without calling any EF. The TODO comment at line 308 says "Integrate FCM (Firebase Cloud Messaging) via service account" — never done. (2) There is NO database trigger on `notifications` INSERT that calls the EF — verified via `grep "trigger.*notifications|after insert on.*notifications" across migrations` returning only `notifications_touch_updated_at` (a metadata trigger, not a webhook). There is NO `pg_net` or `http_post` function in any migration. There is NO `supabase_functions.invoke` SQL function. (3) There is NO Supabase webhook configuration in any migration (webhooks are typically configured via the Supabase dashboard, but the migration set doesn't reflect one). (4) The desktop's "manual admin trigger" path: `supabase-academic-repository.ts:1065` calls `this.client.functions.invoke("push-homework-notification", { body: { homework_id: data.id } })` — but `push-homework-notification` is a DIFFERENT EF name (not `send-push-notification`) AND the comment at line 1060 explicitly says "not currently deployed in supabase/functions". The result of the invoke is swallowed by `.catch(() => undefined)` (line 1068).
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/workflow-execute/index.ts:307-316` (STUB push_notification action)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1060-1068` (non-existent push-homework-notification EF, swallowed error)
  - `/home/z/my-project/repos/elimtiyaz-website/supabase/functions/send-push-notification/index.ts:7-11` (false header comment about invocation paths)
- **How reached:** Staff records a payment via desktop → collect-payment EF runs (no notification trigger) → staff pushes homework via desktop → `supabase-academic-repository.ts:1065` invokes `push-homework-notification` (which doesn't exist) → Supabase returns 404 → `.catch(() => undefined)` swallows → no push sent. Workflow `push_notification` action triggered → workflow-execute/index.ts:307-316 returns `{ stub: true, ... }` → no EF invoked → no push sent. Notification INSERTed into `notifications` table (e.g., by run-overdue-scan EF) → no DB trigger fires → no webhook configured → no EF invoked → no push sent. COMBINED with WEAK-014 (wrong column name in the EF's token lookup → 500) and WEAK-015 (broken PEM parser → 500), the push notification system has THREE compounding bugs that make it completely non-functional. Even fixing WEAK-014 + WEAK-015 would not result in any push being sent (because no code invokes the EF).
- **Intended responsibility:** Workflow `push_notification` action should call the EF. Or a DB trigger on `notifications` INSERT should call the EF via a webhook. Or the desktop's manual triggers should call the correct EF name.
- **Actual responsibility:** All three invocation paths are broken. The EF is dead code.
- **Dependents / consumers:** The EF itself (never invoked). Every parent who expects push notifications. Every staff workflow that includes a `push_notification` step.
- **Alternative implementations of same operation:** None — this is the ONLY push fan-out EF in the codebase.
- **Behavioral differences:** Pre-bug (intended): workflow fires `push_notification` → EF looks up tokens → FCM message sent → parent's device displays notification. Actual: workflow `push_notification` returns `stub: true` → nothing happens.
- **Git evidence:** workflow-execute STUB in `b25e6ca` (2026-08-04). Desktop's push-homework-notification invoke in `94471e8` (2026-08-28). EF introduced in `e90dbf7 mid` (2026-08-01). None of these commits wired up a working invocation path.
- **Likely root cause:** The push notification feature was spec'd but only partially implemented. The EF was written (with two compounding bugs per WEAK-014/015). The workflow action was stubbed out as a TODO. The DB trigger / webhook was never configured. The desktop's manual trigger used a wrong EF name. The three layers were never integrated end-to-end.
- **Potential impact:** Push notifications NEVER reach any parent or staff device — not from workflows, not from notifications INSERT, not from manual desktop triggers. The TODO.md post-deploy verification checklist item "Trigger a staff action → push notification arrives on the portal" would fail (and has been failing since 2026-08-01). Even if WEAK-014/015 are fixed, this third bug keeps the entire push system non-functional.
- **Code snippet:**
```typescript
// workflow-execute/index.ts:307-316 — STUB, never calls the EF
case "push_notification": {
  // TODO: Integrate FCM (Firebase Cloud Messaging) via service account.
  // const fcmToken = ...; await fetch("https://fcm.googleapis.com/fcm/send", { ... })
  const targetRole = String(config.target_role ?? "financial_officer");
  const title = String(config.title ?? "Notification");
  return {
    output: { stub: true, target_role: targetRole, title, provider: "fcm" },
    auditNote: `STUB push_notification role=${targetRole} title="${title}"`,
  };
}

// supabase-academic-repository.ts:1060-1068 — wrong EF name + swallowed error
// Best-effort portal push notification. The `push-homework-notification`
// Edge Function is optional (not currently deployed in supabase/functions)
void this.client
  .functions.invoke("push-homework-notification", {       // <-- wrong EF name (doesn't exist)
    body: { homework_id: data.id },
  })
  .catch(() => undefined);                                  // <-- error swallowed

// send-push-notification/index.ts:7-11 — false header about invocation paths
// Invoked by:
//   - Workflow actions (announcement broadcast, payment receipt issued, etc.)  ← STUB, never calls
//   - The notifications table INSERT trigger (via a Supabase webhook)            ← no webhook configured
//   - Manual admin triggers from the desktop app                                 ← calls wrong EF name
```
- **Confidence:** Confirmed — EXTENDS WEAK-014 + WEAK-015 by adding a THIRD compounding bug (no invocation path). The push notification system has THREE bugs that each independently make it non-functional.

### FINDING PUSH-101 — Android `ElImtiyazMessagingService.onMessageReceived` reads `data["type"]` and `data["priority"]` from the wrong field; AndroidManifest has NO deep-link intent filter for `click_action` URLs

- **What:** Two compounding bugs in Android's push notification handling: (1) The EF (`send-push-notification/index.ts:254-290`) builds the FCM HTTP v1 message with `notification: { title, body }` (standard FCM notification payload), `android.notification.click_action = payload.data?.url ?? "/"` (a URL string, not an intent name), `android.notification.priority = "high"|"normal"`, and `data: payload.data ?? {}` (the caller-provided data field, which may or may not contain `priority`/`type`). The Android's `onMessageReceived` (ElImtiyazMessagingService.kt:41-71) reads `data["title"]`, `data["body"]`, `data["priority"]`, `data["type"]` — but the EF puts `title`/`body` in the `notification` field (NOT in `data`), and does NOT propagate `priority` to the `data` field (line 247 `priority = payload.priority ?? "high"` is a LOCAL variable in the EF, used to set `android.priority` and `android.notification.priority` but NOT added to `data`). Result: when the Android is in the FOREGROUND, `onMessageReceived` is called → `data["title"]` is null → falls back to `message.notification?.title` (correct) → `data["priority"]` is null → falls back to "medium" → channel is always CHANNEL_MEDIUM. When the Android is in the BACKGROUND, FCM auto-displays the notification from the `notification` payload WITHOUT calling `onMessageReceived` — using FCM's default UI (default small icon, no channel selection, no priority-based routing). (2) The AndroidManifest.xml has NO deep-link intent filter. The MainActivity has only `<intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter>` (line 40-43). There's no `<intent-filter><action android:name="android.intent.action.VIEW" /><category android:name="android.intent.category.DEFAULT" /><category android:name="android.intent.category.BROWSABLE" /><data android:scheme="..." /></intent-filter>`. So when the user taps a notification, FCM tries to open MainActivity with the `click_action` URL — but the URL doesn't match any intent filter. FCM falls back to just opening MainActivity (the launcher activity) with no extra. The user lands on the home screen, not the deep-linked view.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/notifications/ElImtiyazMessagingService.kt:41-77` (onMessageReceived reads wrong fields)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/AndroidManifest.xml:40-43` (no deep-link intent filter)
  - `/home/z/my-project/repos/elimtiyaz-website/supabase/functions/send-push-notification/index.ts:254-290` (EF payload construction)
- **How reached:** (Foreground case) Server sends push → Android `onMessageReceived` fires → `data["title"]` is null (EF put title in `notification`, not `data`) → falls back to `message.notification?.title` (correct) → `data["priority"]` is null (EF didn't add priority to `data`) → defaults to "medium" → channelId = CHANNEL_MEDIUM → notification displayed with default channel importance (no heads-up, no sound for "urgent" priority). (Background case) Server sends push → FCM sees the `notification` payload → auto-displays without calling `onMessageReceived` → uses FCM default small icon, no channel, no priority routing. (Click case) User taps notification → FCM looks for intent filter matching `click_action: "/finance"` (or `click_action: "/"`) → AndroidManifest has no such filter → FCM opens MainActivity with no extra → user lands on home screen → deep link lost.
- **Intended responsibility:** (1) The EF should add `priority` and `type` (or `link_entity_type`) to the `data` field (e.g., `data: { ...payload.data, priority, type: payload.category }`) so Android can route to the correct channel. (2) The AndroidManifest should declare deep-link intent filters matching the URLs the EF produces (e.g., for `click_action: "/finance"`, declare an intent filter for scheme `https`, host `portal.elimtiyaz.dz`, path `/finance`). Or, better, use FCM's `click_action` as an intent NAME (not a URL) and declare an intent filter for that name.
- **Actual responsibility:** (1) Android's `onMessageReceived` reads wrong fields → channel selection is always "medium" (foreground) or default (background). (2) No deep-link intent filter → tapping a notification opens the home screen, not the deep-linked view.
- **Dependents / consumers:** The Android user — gets generic notifications with no priority routing, no channel selection, no deep link.
- **Alternative implementations of same operation:** The website's service worker (`firebase-messaging-sw.js:179-203`) uses `linkEntityToHash` to map `link_entity_type` to a hash URL (`#/finance`) — and the website's `useHashRoute` (`use-hash-route.ts:40-44`) consumes the hash → the website's deep link DOES work. The Android has no equivalent — neither an intent filter, nor a hash-router, nor a `PendingIntent` builder that wraps the deep-link URL.
- **Behavioral differences:** Website: deep link works (hash routing). Android: deep link lost (no intent filter, no PendingIntent extra). The Android user has to manually navigate to the view the notification was about.
- **Git evidence:** AndroidManifest.xml in `c207dca6` (2026-08-02, "mid") — never had a deep-link filter. ElImtiyazMessagingService.kt in `dd4c7dc kk` (2026-08-26). EF in `e90dbf7 mid` (2026-08-01). The payload-shape mismatch has been present since the EF's first commit.
- **Likely root cause:** (1) The EF author put `title`/`body` in the standard `notification` field (correct for FCM HTTP v1), but the Android author assumed they'd be in `data` (the legacy FCM legacy API put everything in `data`). They didn't coordinate on payload shape. (2) The Android author never added deep-link intent filters — probably because they didn't get to it, or because they assumed FCM would auto-open the launcher.
- **Potential impact:** (1) Foreground notifications always go to the "medium" channel — no urgent heads-up display, no urgent sound. (2) Background notifications use FCM default UI (no small icon, no channel, no priority). (3) Tapping a notification opens the home screen — the user has to manually navigate to the relevant view. This makes the deep-link feature entirely non-functional on Android. (Combined with PUSH-100, no pushes are ever sent anyway — but if/when PUSH-100 is fixed, this finding would still prevent deep links from working.)
- **Code snippet:**
```kotlin
// ElImtiyazMessagingService.kt:41-53 — reads data["priority"] and data["type"] (both null in practice)
override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val title = data["title"] ?: message.notification?.title ?: "El-Imtiyaz"  // ← fallback works for title
    val body = data["body"] ?: message.notification?.body ?: ""               // ← fallback works for body
    val priority = data["priority"] ?: "medium"                                 // ← ALWAYS "medium" (EF doesn't add priority to data)
    val type = data["type"] ?: "system"                                         // ← ALWAYS "system" (EF doesn't add type to data)
    val channelId = when (priority) {
        "urgent" -> ElImtiyazApplication.CHANNEL_URGENT                       // ← never reached
        "high"   -> ElImtiyazApplication.CHANNEL_HIGH                         // ← never reached
        "low"    -> ElImtiyazApplication.CHANNEL_LOW                           // ← never reached
        else     -> ElImtiyazApplication.CHANNEL_MEDIUM                       // ← always this
    }
    // ...
}
```
```xml
<!-- AndroidManifest.xml:40-43 — only MAIN/LAUNCHER, no deep-link VIEW/BROWSABLE -->
<intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
</intent-filter>
<!-- Missing: -->
<!-- <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="portal.elimtiyaz.dz" android:pathPattern="/finance" />
</intent-filter> -->
```
```typescript
// send-push-notification/index.ts:254-290 — payload shape that Android doesn't read correctly
const message = {
  message: {
    token: t.token,
    notification: { title: payload.title, body: payload.body ?? "" },  // ← standard FCM field
    android: {
      priority: priority === "high" ? "high" : "normal",
      notification: {
        click_action: payload.data?.url ?? "/",                       // ← URL, not intent name
        priority: priority === "high" ? "high" : "default",
      },
    },
    data: payload.data ?? {},                                          // ← caller-provided only (no priority/type added)
  },
};
```
- **Confidence:** Confirmed

### FINDING PUSH-102 — `register_fcm_token` SQL RPC has no inverse `unregister_fcm_token` RPC; the `ON CONFLICT (tenant_id, token) DO UPDATE` clause overwrites `user_id` on shared devices (extends SEC-106 + SYNC-104)

- **What:** The `register_fcm_token(p_user_id, p_token, p_platform)` SQL function (0027 line 344-384) upserts by `(tenant_id, token)` with `ON CONFLICT (tenant_id, token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, is_active = true, last_seen_at = now()`. There is NO `unregister_fcm_token` SQL RPC in any migration (verified via `grep "unregister_fcm_token\|FUNCTION.*unregister" across migrations`). The ONLY way to set `device_tokens.is_active = false` server-side is (a) the EF's auto-deactivation when FCM returns UNREGISTERED (send-push-notification/index.ts:306-311 — never fires because the EF is never invoked per PUSH-100), (b) direct SQL UPDATE by an admin, OR (c) the website's `unregisterDeviceToken` (fcm-registration.ts:65-79) — but this is a direct PostgREST UPDATE, not an RPC, and it filters by `platform='web'` so it doesn't touch Android tokens. Two compounding issues follow from the ON CONFLICT semantics: (1) When a shared Android device is signed into by user A then signed into by user B (without signOut unregistering per SYNC-104), the SECOND register call hits the conflict on `(tenant_id, T1)` and OVERWRITES the row to `user_id = B`. Now user A's notifications don't go to ANY device (the only device_tokens row for A was overwritten). User A is silently "logged out" of the push system — they stop receiving notifications on their primary device even though they're still actively using the app on a different device. (2) When user A uninstalls the Android app and reinstalls it, FCM assigns a NEW token T2 (different from T1). The register call INSERTs (user_id=A, token=T2, is_active=true) — leaving the old row (user_id=A, token=T1, is_active=true) as an ORPHAN. There's no RPC to clean it up. The EF's UNREGISTERED auto-deactivation (when send-push-notification is eventually fixed and invoked) would eventually mark T1 inactive — but until then, the server stores duplicate active tokens for the same user.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0027_shared_unification.sql:344-384` (register_fcm_token — no inverse RPC exists)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/fcm-registration.ts:65-79` (only `platform='web'` unregister via direct PostgREST UPDATE)
- **How reached:** Shared-device scenario: Tablet has FCM token T1. User A signs in → `FcmTokenRegistrar.register(T1)` → RPC INSERTs (user_id=A, token=T1, is_active=true). User A signs out (no unregister per SYNC-104). User B signs in on same tablet → `FcmTokenRegistrar.register(T1)` → RPC attempts INSERT (user_id=B, token=T1) → CONFLICT on (tenant_id, T1) → ON CONFLICT UPDATE SET user_id=B → row is now (user_id=B, token=T1, is_active=true). User A's notifications (sent by EF when EF is fixed) → queries `device_tokens WHERE user_id=A AND is_active=true` → returns 0 rows → no push sent → User A's phone (different device, token T2) might still work, but if A only had the tablet, they're cut off. (Orphan scenario) User A uninstalls app → FCM revokes T1 eventually. User A reinstalls → FCM assigns T2. User A signs in → RPC INSERTs (user_id=A, token=T2, is_active=true). Now there are TWO rows: (user_id=A, token=T1, is_active=true — orphan) and (user_id=A, token=T2, is_active=true — current). Server sends to BOTH → FCM rejects T1 (UNREGISTERED) → EF marks T1 inactive (per PUSH-100 this never happens) → T1 stays active forever in the device_tokens table.
- **Intended responsibility:** An `unregister_fcm_token(p_token)` or `unregister_fcm_token(p_user_id, p_platform)` RPC should exist, callable by the client on signOut. It would set `is_active = false` for the matching row(s). The `register_fcm_token` RPC's ON CONFLICT clause should NOT overwrite `user_id` without auth verification (an authenticated user B shouldn't be able to claim a token that previously belonged to user A).
- **Actual responsibility:** No unregister RPC exists. The ON CONFLICT clause silently transfers token ownership on shared devices.
- **Dependents / consumers:** `device_tokens` table — the canonical source of truth for "which devices get this user's pushes". The EF's token lookup (send-push-notification/index.ts:208-212 — itself broken per WEAK-014).
- **Alternative implementations of same operation:** The website's `unregisterDeviceToken` (fcm-registration.ts:65-79) is a direct PostgREST UPDATE — bypasses the RPC. It only works because the `device_tokens` RLS policy allows users to UPDATE their own tokens (and the website's session has a valid auth.uid()). For Android, the same direct UPDATE would work — but the Android code never calls it (per SYNC-104).
- **Behavioral differences:** Website sign-out: doesn't unregister (per SYNC-105) — but the website COULD call its own unregisterDeviceToken (it just doesn't). Android sign-out: doesn't unregister, AND has no unregister function to call even if it wanted to.
- **Git evidence:** Migration 0027 in `9e1e7741` (2026-08-12, "kay"). The unregister RPC has never existed.
- **Likely root cause:** The author wrote the register RPC with the assumption that "registering = upsert" — they didn't consider the un-register use case. The ON CONFLICT overwrite of user_id was intended to handle token reuse on shared devices (the new owner should get the notifications, not the old owner) — but this is silent and surprising.
- **Potential impact:** (1) Silent push cut-off for users on shared devices when a different user signs in. (2) Orphaned active tokens accumulate in `device_tokens` after app reinstalls (until the EF eventually marks them inactive, which it doesn't per PUSH-100). (3) The first user A who signs into a shared tablet is the most affected — they have no way to know their notifications are now going to user B's session (or to no one, if user B never signs in but just uses the device).
- **Code snippet:**
```sql
-- 0027_shared_unification.sql:344-384 — register has no inverse; ON CONFLICT overwrites user_id
CREATE OR REPLACE FUNCTION public.register_fcm_token(
    p_user_id uuid,
    p_token   text,
    p_platform text DEFAULT 'android'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_token_id uuid; v_tenant_id uuid;
BEGIN
    -- ... tenant lookup ...
    INSERT INTO public.device_tokens (tenant_id, user_id, token, platform, is_active, last_seen_at)
    VALUES (v_tenant_id, p_user_id, p_token, p_platform, true, now())
    ON CONFLICT (tenant_id, token) DO UPDATE
       SET user_id       = EXCLUDED.user_id,    -- ← OVERWRITES without auth verification
           platform      = EXCLUDED.platform,
           is_active     = true,
           last_seen_at  = now()
    RETURNING id INTO v_token_id;
    RETURN v_token_id;
END;
$$;
-- There is NO inverse: no `unregister_fcm_token(p_token)` or `unregister_fcm_token(p_user_id, p_platform)`.
-- The ONLY way to set is_active=false server-side is direct PostgREST UPDATE (which the website
-- does for platform='web' only, and the Android never does).
```
- **Confidence:** Confirmed — EXTENDS SEC-106 (which documented that the RPC accepts any p_user_id without verification) and SYNC-104 (which documented that Android doesn't unregister on signOut) by tracing the actual user-facing data flow on shared devices (the silent user_id overwrite cuts off the previous user's notifications).

### FINDING PUSH-103 — Website's FCM token registration is OPT-IN only (Profile view manual toggle); no auto-registration on sign-in; most users never enable push

- **What:** The website's only path to register an FCM device token is the manual toggle in `ProfileView` (`profile-view.tsx:114-132`). When the user clicks the push switch to ON, `togglePush(true)` calls `registerDeviceToken(user.id)` which calls `initFcm()` (requests browser permission, gets FCM token, registers via the `register_fcm_token` RPC). When the user clicks OFF, `togglePush(false)` calls `unregisterDeviceToken(user.id)`. There is NO auto-registration on sign-in (`auth-provider.tsx:242-262` signInWithGoogle → no registerDeviceToken call; `auth-provider.tsx:209-240` useEffect on auth state change → no registerDeviceToken call). The `pushEnabled` state (line 79-83) is initialized from `Notification.permission === "granted"` — but this only reflects the browser permission, not the server-side device_tokens row. If a user grants browser permission but never toggles push in the Profile view (or never visits the Profile view at all), the server has no FCM token for them → no pushes can be sent to them. Conversely, if a user revokes browser permission via browser settings, the toggle UI still shows ON (because pushEnabled only updates from the toggle handler) — but the server still has the (now invalid) token.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/profile/profile-view.tsx:75-132` (the ONLY call to registerDeviceToken)
  - `/home/z/my-project/repos/elimtiyaz-website/src/app/providers/auth-provider.tsx:209-240, 242-262` (signInWithGoogle + onAuthStateChange — no FCM register call)
- **How reached:** Parent signs in via Google OAuth → auth-provider's onAuthStateChange fires → `loadProfile()` runs → state transitions to "active" → AppShell mounts → DashboardView renders → user navigates the app, never visits Profile view → `registerDeviceToken` is NEVER called → server's `device_tokens` table has no row for this user → IF the EF (per PUSH-100, never invoked) were invoked → `device_tokens WHERE user_id = ?` returns 0 rows → response `{ sent: 0, message: "no active devices registered" }` (send-push-notification/index.ts:221-226) → no push sent.
- **Intended responsibility:** On successful sign-in, the website should auto-request FCM permission + register the device token. The user shouldn't have to find a hidden toggle in the Profile view to enable notifications.
- **Actual responsibility:** Auto-registration never happens. The user must manually opt-in via the Profile view. Most users never discover this toggle.
- **Dependents / consumers:** The `device_tokens` table — sparsely populated because most users never opt-in. The EF's token lookup (when it eventually runs) — would return 0 rows for most users.
- **Alternative implementations of same operation:** The Android's `FcmTokenRegistrar.register` is called automatically on app startup / session change (per `ElImtiyazMessagingService.onNewToken` and the observeSessionForFcmToken flow described in SYNC-104). The Android ALWAYS registers the token; the website only registers on manual toggle.
- **Behavioral differences:** Android: auto-register on every app launch + session change → device_tokens table populated. Website: manual opt-in only → device_tokens table sparse. The website has WAY fewer active tokens than the Android.
- **Git evidence:** profile-view.tsx in `e90dbf7 mid` (2026-08-01). auth-provider.tsx in `03f6365 vitest 87/87` (2026-08-28). The opt-in pattern has been there since first commit.
- **Likely root cause:** Browsers require EXPLICIT user gesture to request notification permission — `Notification.requestPermission()` must be called from a user-initiated event (click/tap). The auto-registration on sign-in can't request permission without a user gesture. So the author put it behind a manual toggle. The proper pattern is: (a) on sign-in, ATTEMPT to register (call `initFcm()` which checks permission — if not granted, return null silently), (b) on a separate Profile view toggle, request permission via a user gesture. The website's current pattern doesn't even attempt (a).
- **Potential impact:** Even if WEAK-014/015 + PUSH-100 + PUSH-101 are all fixed, the website's push notification system would only reach users who manually toggled push ON in their Profile view. Most parents would never receive notifications. The opt-in UX is buried.
- **Code snippet:**
```typescript
// auth-provider.tsx:242-262 — signInWithGoogle, NO registerDeviceToken call
const signInWithGoogle = useCallback(async () => {
  if (!supabase) return;
  setError(null);
  const { error: oauthErr } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  // ← NO registerDeviceToken(user.id) call after successful sign-in
}, []);

// auth-provider.tsx:225-234 — onAuthStateChange, NO registerDeviceToken call
const { data: sub } = supabase!.auth.onAuthStateChange((_event, session) => {
  if (!session) {
    setUser(null); setParent(null); setChildrenList([]);
    setState("unauthenticated");
  } else {
    init();  // ← loads profile, but does NOT register FCM token
  }
});

// profile-view.tsx:114-132 — the ONLY call to registerDeviceToken (manual toggle)
const togglePush = async (enabled: boolean) => {
  if (!user) return;
  if (enabled) {
    const ok = await registerDeviceToken(user.id);  // ← only path to register
    if (ok) { setPushEnabled(true); toast.success("Notifications activées"); }
    else { setPushEnabled(false); toast.error("Impossible d'activer les notifications"); }
  } else {
    await unregisterDeviceToken(user.id);
    setPushEnabled(false); toast.info("Notifications désactivées");
  }
};
```
- **Confidence:** Confirmed

### FINDING PUSH-104 — Workflow `send_email` action is a STUB; only `approve-signup-request` EF actually sends email (conditional on RESEND_API_KEY secret); all workflow-driven transactional emails NEVER send

- **What:** Two paths for sending email in the codebase, both broken: (1) The `workflow-execute` EF's `send_email` action (line 275-285) is a STUB — the TODO at line 276 says "Integrate Resend API", the code returns `{ output: { stub: true, to, subject, provider: "resend" }, auditNote: "STUB send_email to=..." }`. The actual Resend API call (line 278 `// await fetch("https://api.resend.com/emails", { ... })`) is COMMENTED OUT. No workflow that includes a `send_email` node actually sends an email — the audit log shows "STUB send_email" and the workflow continues. (2) The `approve-signup-request` EF (line 268-294) DOES attempt to send a confirmation email via Resend — BUT only if `Deno.env.get("RESEND_API_KEY")` is set (line 269). If the secret is not set (likely in dev/staging), the email is silently skipped. If the secret IS set, the email send is wrapped in try/catch with errors swallowed (line 291-293 `console.warn("[approve-signup] Failed to send confirmation email:", emailError)`). The Resend API's response status is NOT checked (line 273-290 — `await fetch(...)` is called but the `resp.ok` is never verified). If Resend returns 4xx (e.g., unverified domain, invalid API key), the email send silently fails. The hardcoded link in the email body (line 287 `<a href="https://portal.elimtiyaz.dz">Accéder au portail</a>`) is hardcoded — if the actual portal URL is different (e.g., staging.elimtiyaz.dz), users are directed to the wrong URL.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/workflow-execute/index.ts:275-285` (STUB send_email action)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/approve-signup-request/index.ts:268-294` (Resend integration — conditional + error swallowed + hardcoded URL)
- **How reached:** (1) Workflow includes a `send_email` node (e.g., "When installment is >30 days overdue, send email + apply 5% penalty" per the workflow-execute header comment line 8) → workflow-execute processes the node → reaches `case "send_email":` (line 275) → returns `{ output: { stub: true, ... } }` → audit log entry written → workflow continues to next node → NO EMAIL SENT. (2) Admin approves a signup request → approve-signup-request EF runs → line 269 checks `Deno.env.get("RESEND_API_KEY")` → if not set, skip → if set, line 273-290 sends to Resend API → if Resend returns 4xx (e.g., unverified sender domain), the response is not checked → user never receives the confirmation email → user doesn't know their account was approved → admin assumes the email was sent (no error in the EF's response).
- **Intended responsibility:** Workflow `send_email` should integrate Resend (or another email provider) to send transactional emails triggered by workflow events (overdue payments, absences, grade postings, etc.). The approve-signup-request email should be sent reliably and the response status verified.
- **Actual responsibility:** Workflow emails NEVER send (stub). The signup-approval email MAY send (conditional on RESEND_API_KEY + Resend's success), with no verification.
- **Dependents / consumers:** Parents expecting workflow-driven emails (overdue payment reminders, absence alerts, grade reports). New users expecting approval confirmation emails.
- **Alternative implementations of same operation:** None — there's only one email-sending code path (Resend). Supabase's built-in auth emails (verification, password reset) are configured via the Supabase dashboard (not in this repo's migrations).
- **Behavioral differences:** Pre-bug (intended): workflow `send_email` → Resend API → email delivered. Actual: workflow `send_email` → STUB → no email. Approve-signup: depends on RESEND_API_KEY + Resend's response (which is never verified).
- **Git evidence:** workflow-execute STUB in `b25e6ca` (2026-08-04). approve-signup-request Resend integration in same commit. Both have been broken since first commit.
- **Likely root cause:** Same as PUSH-100 — the email feature was spec'd but only partially implemented. The workflow action was stubbed as a TODO. The signup-approval email was added as a "best effort" with silent failure modes. The two layers were never integrated end-to-end.
- **Potential impact:** (1) All workflow-driven transactional emails NEVER send (overdue payment reminders, absence alerts, etc.). (2) Account approval emails are unreliable — silently skipped if RESEND_API_KEY is unset, silently failed if Resend returns 4xx. (3) Hardcoded URL in the email body could point users to the wrong portal.
- **Code snippet:**
```typescript
// workflow-execute/index.ts:275-285 — STUB, never calls Resend
case "send_email": {
  // TODO: Integrate Resend API.
  // const resendKey = Deno.env.get("RESEND_API_KEY");
  // await fetch("https://api.resend.com/emails", { ... })  // ← commented out
  const to = String(config.to ?? "(unspecified)");
  const subject = String(config.subject ?? "(no subject)");
  return {
    output: { stub: true, to, subject, provider: "resend" },
    auditNote: `STUB send_email to=${to} subject="${subject}"`,
  };
}

// approve-signup-request/index.ts:268-294 — conditional + error swallowed + hardcoded URL
const resendKey = Deno.env.get("RESEND_API_KEY");
if (resendKey && userProfile) {
  try {
    const emailFrom = Deno.env.get("EMAIL_FROM_ADDRESS") ?? "noreply@elimtiyaz.dz";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailFrom,
        to: userProfile.email,
        subject: "Votre compte El-Imtiyaz est approuvé",
        html: `<h1>Bienvenue chez El-Imtiyaz</h1>
               <p>Bonjour ${userProfile.display_name ?? ""},</p>
               <p>Votre compte a été approuvé. Vous pouvez maintenant vous connecter au portail.</p>
               <p><a href="https://portal.elimtiyaz.dz">Accéder au portail</a></p>`,
                //                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ hardcoded URL
      }),
    });
    // ← resp.ok is NEVER checked — if Resend returns 4xx, the email silently fails
  } catch (emailError) {
    console.warn("[approve-signup] Failed to send confirmation email:", emailError);
    // ← error swallowed, no audit log entry, no surface to the caller
  }
}
```
- **Confidence:** Confirmed

Stage Summary:
- Total new findings: 17 (CHAT-100, CHAT-101, CHAT-102, CHAT-103, CHAT-104, CHAT-105, NOTIF-100, NOTIF-101, NOTIF-102, NOTIF-103, NOTIF-104, NOTIF-105, PUSH-100, PUSH-101, PUSH-102, PUSH-103, PUSH-104)
- Severity breakdown:
  - Critical: 5 (CHAT-103 no production code creates chat_channels, NOTIF-100 role-broadcasts can't be marked read, NOTIF-101 notification injection allowed, NOTIF-104 Android read state reverts every 15min, PUSH-100 no code invokes send-push-notification EF)
  - High: 8 (CHAT-100 chat_channels_insert RLS allows arbitrary member_ids, CHAT-101 chat_messages_insert RLS has no channel-membership check, CHAT-102 chat_messages_update RLS root cause of REALTIME-101, CHAT-105 desktop chat is mock-only, NOTIF-102 desktop bell caps at 8, NOTIF-105 Android stale role-broadcasts persist, PUSH-101 Android reads wrong fields + no intent filter, PUSH-104 workflow send_email is STUB)
  - Medium: 4 (CHAT-104 channel list stale ordering, NOTIF-103 website dead query + cap, PUSH-102 no inverse RPC + overwrite semantics, PUSH-103 website opt-in only FCM)
  - Low: 0
- Top 5 critical findings (one-line each):
  1. **CHAT-103**: NO production code anywhere creates `chat_channels` rows — the website's MessagesView is permanently empty; there's no path for staff to message parents via the canonical tables.
  2. **NOTIF-100**: `notifications_update` RLS blocks recipients from marking role-broadcast notifications as read — they stay unread forever; the bell badge is permanently > 0 (extends REALTIME-101 from chat_messages to notifications).
  3. **NOTIF-101**: `notifications_insert` RLS allows any authenticated user to INSERT a notification addressed to ANY user_id — phishing / spam / impersonation vector via direct API access.
  4. **NOTIF-104**: Android's `markRead/markAllRead/dismiss` only update LOCAL Room; server's `is_read`/`dismissed_at` stays at original values; the next 15-min `pullNotifications` reverts local state via REPLACE strategy — silent desync every 15 min.
  5. **PUSH-100**: NO production code anywhere invokes the `send-push-notification` EF — workflow `push_notification` is a STUB, no DB trigger / webhook exists, desktop calls a non-existent EF name. Combined with WEAK-014/015, the push system has THREE compounding bugs.

- Findings that EXTEND or CONTRADICT prior findings (no contradictions found):
- **CHAT-102** extends **REALTIME-101** (3-C): identifies the RLS-policy ROOT CAUSE of the swallowed-error symptom REALTIME-101 documented. REALTIME-101 said "the markRead UPDATE is RLS-denied"; CHAT-102 says "the only UPDATE policy is `chat_messages_update_own` requiring `author_id = current_user_profile_id()` — there's NO policy allowing recipients to append to `read_by`". Future remediation should target the RLS policy (add a `chat_messages_update_read_receipt` policy), not just the error swallowing.
- **NOTIF-100** extends **REALTIME-101** (3-C) to the `notifications` table: same RLS-denial pattern for role-broadcasts. The `notifications_update` policy only allows direct recipients to mark as read; role-broadcast recipients are silently denied. Future remediation needs a per-user-read-state table (e.g., `notification_reads(notification_id, user_profile_id, read_at)`) — the current single `is_read` column doesn't support per-recipient read state.
- **PUSH-100** extends **WEAK-014** (2-c) and **WEAK-015** (2-c): those findings documented two compounding bugs that each independently make the EF return 500. PUSH-100 documents the THIRD compounding bug — no code path INVOKES the EF in the first place. The three bugs are independent; fixing any two still leaves the system non-functional.
- **PUSH-102** extends **SEC-106** (3-B) and **SYNC-104** (3-C): SEC-106 said the register RPC accepts any `p_user_id` without auth verification. PUSH-102 traces the actual user-facing data flow on shared devices — the `ON CONFLICT (tenant_id, token) DO UPDATE SET user_id = EXCLUDED.user_id` clause silently transfers token ownership from user A to user B when user B signs in on a shared device. SYNC-104 said Android doesn't unregister on signOut; PUSH-102 shows that even if Android DID unregister, the RPC's overwrite semantics would still silently cut off the previous user.
- **CHAT-105** extends **CHAT-103**: CHAT-103 says no code creates chat_channels rows. CHAT-105 says the desktop's ChatPanel uses a MOCK chat repository — so even staff-to-staff chat in the desktop never persists. The two findings together explain why the entire chat feature is non-functional: no platform creates channels, no platform persists messages.

No contradictions found.

---

Task ID: 3-D
Agent: forensic-auditor-D (Homework + Attendance + Academic + Schedule end-to-end)
Task: Deep second-pass audit of academic flows across all 3 platforms

### FINDING HOMEWORK-100 — Desktop homework push omits `tenant_id`; INSERT always fails NOT NULL (extends WEAK-017)

- **What:** `SupabaseHomeworkRepository.push()` constructs the homework INSERT payload without a `tenant_id` field, but the canonical `homework` table (migration 0029 line 95-111) requires `tenant_id UUID NOT NULL` (no DEFAULT, no `set_homework_tenant()` trigger to backfill). The PostgREST INSERT is sent to the server and Postgres returns 400 with `null value in column "tenant_id" of relation "homework" violates not-null constraint`. The desktop also invokes a non-existent Edge Function `push-homework-notification` (line 1064-1068) with `.catch(() => undefined)` — silently swallowed, so even when the homework INSERT is fixed, the parent-notification side-effect never fires.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1039-1071` (INSERT payload omits `tenant_id` + invokes non-existent EF)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:95-111` (table requires `tenant_id UUID NOT NULL`)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/` — directory listing has no `push-homework-notification` subdirectory (only `_shared`, `ai-proxy`, `approve-signup-request`, `bind-activation-code`, `collect-payment`, `expire-pending-approvals`, `purge-expired-backups`, `refresh-materialized-views`, `refund-payment`, `run-overdue-scan`, `update-server-secret`, `workflow-execute`)
- **How reached:** Desktop Academics Hub → "Diffuser un devoir" modal → user fills class/subject/title/due_date/attachments → `submit()` calls `repos.homework.push()` → `SupabaseHomeworkRepository.push()` resolves the subject name + current academic_year, then issues `client.from("homework").insert({...}).select().single()` → PostgREST receives the JSON, forwards to Postgres, which throws `23502 NOT NULL violation` on `tenant_id` → `.single()` returns `{ data: null, error: { code: "23502", ... } }` → repository returns `Err(supabaseErrorToAppError(error))` → `submit()` shows "Échec de la diffusion" toast. The user thinks they pushed a homework but nothing was persisted.
- **Intended responsibility:** Persist the homework row in the canonical `homework` table so the website's `useHomeworkForClass` query can read it, then trigger a push notification to subscribed parents.
- **Actual responsibility:** Every homework push from the desktop fails with a NOT NULL violation; the `homework` table on the live DB has zero rows for desktop-originated pushes. The `push-homework-notification` EF invocation is dead-on-arrival (the EF is not deployed AND the catch swallows the error).
- **Dependents / consumers:**
  - Website `useHomeworkForClass` (`portal-queries.ts:167-189`) — reads from `homework` table; never sees desktop pushes.
  - Website `useHomeworkRealtime` (`use-realtime.ts:136-145`) — subscribes to LEGACY `homework_assignments` table, not canonical `homework` (per WEAK-016).
  - Android `LocalHomeworkRepository.observeForClass` (`LocalRepositories2.kt:1439-1440`) — only reads local Room, never Supabase (per HOMEWORK-103).
- **Alternative implementations of same operation:**
  - **Android** `LocalHomeworkRepository.push()` (`LocalRepositories2.kt:1445-1490`) enqueues a sync entry → `SyncQueueDispatcher.pushHomework` (`SyncQueueDispatcher.kt:109-138`) upserts to `homework` table with `tenant_id = entry.tenantId` (from session) — this path WOULD send a valid `tenant_id`, but trips HOMEWORK-101 on the invalid `hwk-{uuid}` ID.
  - **Website** has no homework-push UI (parents are read-only consumers).
- **Behavioral differences:** Desktop: ALWAYS fails (NOT NULL violation). Android: ALWAYS fails (UUID syntax violation on `hwk-` prefix, see HOMEWORK-101). Website: never pushes. The canonical `homework` table on the live DB has no rows from any platform.
- **Git evidence:** Migration 0029 committed in `b25e6ca mid` (2026-08-04). `SupabaseHomeworkRepository.push()` implemented same commit. No subsequent fix.
- **Likely root cause:** The author copy-pasted the pattern from `SupabaseAcademicYearRepository.createAcademicYear` (which does NOT pass `tenant_id` because academic_years has no RLS `tenant_id` check at insert — the policy `rls_academic_years_tenant USING (tenant_id = current_tenant_id())` runs but the column is set by the trigger on the table). The author forgot to add a `set_homework_tenant()` trigger (analogous to `set_assessments_tenant` added in migration 0041 for the `assessments` table) OR to explicitly pass `tenant_id: getTenantId()` in the INSERT payload. Every other Supabase repository in the codebase explicitly passes `tenant_id: tenantId` (see `supabase-shared-repositories.ts`, `supabase-notification-repository.ts:232`, `supabase-personnel-repository.ts:430,591,609`, etc.).
- **Potential impact:** Teachers cannot push homework from the desktop. The "Diffuser un devoir" button silently fails. Combined with HOMEWORK-101 (Android push broken) and WEAK-016 (realtime broken), the homework feature has THREE compounding bugs that each independently make it non-functional.
- **Code snippet:**
```typescript
// supabase-academic-repository.ts:1039-1071 — NO tenant_id in INSERT payload
const { data, error } = await this.client
  .from("homework")
  .insert({
    class_id: input.classId,
    subject_id: input.subjectId,
    subject_name: subjectName,
    teacher_id: input.teacherId,
    teacher_name: input.teacherName,
    title: input.title,
    description: input.description,
    due_date: input.dueDate,
    attachments: input.attachments,
    academic_year: academicYear,
    pushed_at: new Date().toISOString(),
    // ← tenant_id MISSING — table requires NOT NULL
  })
  .select()
  .single();

if (error) return Err(supabaseErrorToAppError(error));
// ↑ always returns Err with code "23502"

// Best-effort portal push notification. The `push-homework-notification`
// Edge Function is optional (not currently deployed in supabase/functions)
void this.client
  .functions.invoke("push-homework-notification", {  // ← EF does not exist
    body: { homework_id: data.id },
  })
  .catch(() => undefined);  // ← silently swallowed
```
- **Confidence:** Confirmed — EXTENDS WEAK-017 (Database type missing canonical `homework` table) by tracing the actual runtime breakage. WEAK-017 said the typed `Database` interface omits the `homework` table (so queries use `as unknown as` casts). HOMEWORK-100 documents the deeper issue: even if the typing were fixed, the runtime INSERT fails because the payload is structurally incomplete.

### FINDING HOMEWORK-101 — Android homework sync push uses invalid UUID `"hwk-{uuid}"` as `homework.id`

- **What:** `LocalHomeworkRepository.push()` (`LocalRepositories2.kt:1466`) creates a local Room `HomeworkEntity` with `id = "hwk-${UUID.randomUUID()}"`. The sync dispatcher's `pushHomework()` (`SyncQueueDispatcher.kt:109-138`) reads this ID verbatim and passes it to `supabaseProvider.postgrest.from("homework").upsert(row)` where `row.id = "hwk-{uuid}"`. The `homework.id` column is `UUID PRIMARY KEY` (migration 0029 line 96). Postgres rejects `"hwk-..."` with `invalid input syntax for type uuid: "hwk-..."` (PostgREST returns 400). The SyncService catches the exception, retries with exponential backoff, and after `maxAttempts` marks the entry as `failed` — the failure is only visible in the diagnostics UI, not surfaced as a user-visible error.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1466` (entity ID generation with `hwk-` prefix)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:109-138` (`pushHomework` sends ID verbatim into UUID column)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:96` (`id UUID PRIMARY KEY DEFAULT public.gen_uuid()`)
- **How reached:** Android Academics Hub → Homework Push screen → user fills class/subject/title/due_date/attachments → `HomeworkPushViewModel.pushHomework()` → `LocalHomeworkRepository.push()` → local Room `homeworkDao.upsert(entity)` (succeeds locally) → `syncSupport.enqueueOnly(entity = "homework", ...)` → SyncWorker (15-min cycle) drains queue → `SyncQueueDispatcher.pushHomework()` → `supabaseProvider.postgrest.from("homework").upsert(row)` with `row.id = "hwk-abc-def-..."` → PostgREST 400 → exception caught in `SyncService.drainPending()` → retry with backoff → after maxAttempts → `status = "failed"`, audit-logged via `logSyncFailure()`. The local Room row remains — the Android user THINKS the homework was pushed (they see it in their local history), but the server never received it. The website (which reads from canonical `homework` table) never sees it.
- **Intended responsibility:** Push the locally-created homework to the canonical `homework` table on Supabase so parents/students see it via the website.
- **Actual responsibility:** Every homework sync push from Android fails with a UUID syntax error; the canonical `homework` table on the live DB has zero rows from Android. Local Room has the row, but no other platform can see it.
- **Dependents / consumers:** Website `useHomeworkForClass` (`portal-queries.ts:167-189`) — reads from `homework` table; never sees Android pushes.
- **Alternative implementations of same operation:**
  - **Desktop** `SupabaseHomeworkRepository.push()` omits `id` from the INSERT, letting Postgres DEFAULT `public.gen_uuid()` generate a valid UUID server-side (HOMEWORK-100 is the bug there, but at least the ID handling is structurally correct).
  - The canonical upsert RPCs (`upsert_assessment_from_import`, `upsert_attendance_from_import` in migration 0041) accept no `p_id` parameter — they let Postgres generate the ID via DEFAULT. The Android's grade/attendance sync paths use these RPCs (via `pushGrade`/`pushAttendance` in SyncQueueDispatcher) and therefore don't have the invalid-ID problem. **Only the homework sync path bypasses the RPC pattern** and hits the table directly, which is why only homework has this bug.
- **Behavioral differences:** Desktop: fails on NOT NULL violation (HOMEWORK-100). Android: fails on UUID syntax violation (HOMEWORK-101). The two platforms fail in different ways but the user-facing result is identical: no homework is ever persisted to Supabase.
- **Git evidence:** `LocalHomeworkRepository.push()` and `SyncQueueDispatcher.pushHomework` both committed in `b25e6ca mid` (2026-08-04). The `hwk-` prefix matches the Android's local-UUID convention (`cls-`, `sub-`, `cls-sub-`, `att-`, `asm-`, `exp-`, `hwk-`) — every local entity uses a 3-4 letter prefix. Only `hwk-` collides with a UUID column on the server because homework is the only entity whose sync push goes directly to the table (not via an RPC).
- **Likely root cause:** The Android developer used the same local-ID convention for all entities (`hwk-`, `asm-`, `att-`, etc.) without realizing that the homework sync path is the only one that puts the local ID directly into a UUID column. The grade and attendance sync paths use RPCs that omit the ID parameter. The homework sync path was implemented to use a direct table upsert (per the dispatcher comment line 105-107: "Uses the postgrest table upsert (idempotent on the primary key) rather than an RPC — the `homework` table is part of the shared schema (migration 0027) and has no dedicated upsert RPC"). Without an RPC, the local ID leaks into the UUID column.
- **Potential impact:** Teachers on Android push homework that never reaches the server. Parents on the website never see it. The homework is silently local-only. The user sees a "Devoir diffusé" success toast on Android (because the local Room write succeeded) but no parent ever receives it.
- **Code snippet:**
```kotlin
// LocalRepositories2.kt:1466 — entity ID generation with hwk- prefix
val entity = HomeworkEntity(
    id = "hwk-${UUID.randomUUID()}",  // ← invalid UUID (Postgres rejects "hwk-" prefix)
    tenantId = "00000000-0000-0000-0000-000000000001",
    classId = input.classId, subjectId = input.subjectId, ...
)

// SyncQueueDispatcher.kt:109-138 — pushHomework sends ID verbatim
private suspend fun pushHomework(entry: SyncQueueEntity, p: JsonObject) {
    val id = p.str("id") ?: return  // ← "hwk-{uuid}"
    val classId = p.str("classId") ?: p.str("class_id") ?: return
    val subjectId = p.str("subjectId") ?: p.str("subject_id") ?: return
    val row = buildJsonObject {
        put("id", id)  // ← invalid UUID passed to UUID column
        put("tenant_id", entry.tenantId)
        put("class_id", classId)
        put("subject_id", subjectId)
        // ... other fields ...
    }
    NetworkTimeouts.guard<Unit>("sync.pushHomework", timeoutMs = 5_000L) {
        supabaseProvider.postgrest.from("homework").upsert(row)
        // ↑ PostgREST 400: "invalid input syntax for type uuid: \"hwk-abc-...\""
    }
}
```
- **Confidence:** Confirmed — the homework table's `id` column is unambiguously `UUID PRIMARY KEY` per migration 0029, and `"hwk-..."` is unambiguously not a valid UUID per Postgres syntax rules.

### FINDING ATT-100 — Desktop roll call upsert is triple-broken (missing tenant_id, missing date, wrong onConflict)

- **What:** `SupabaseAttendanceRepository.recordRollCall()` issues an upsert to `attendance_records` with three compounding bugs: (a) the payload omits `tenant_id` (NOT NULL per migration 0004 line 163); (b) the payload writes to `record_date` (0029-added nullable column) but omits the legacy `date` column (NOT NULL per migration 0004 line 167, never made nullable); (c) `onConflict: "student_id,record_date,session"` (3 columns) doesn't match either unique index — the legacy `attendance_records_unique_session_uidx` is on 5 cols `(tenant_id, student_id, class_id, date, coalesce(class_subject_id, ...))` and the canonical `uq_attendance_canonical` is on 4 cols `(tenant_id, student_id, record_date, session)`. PostgREST rejects the upsert with multiple compounding errors; the first to surface is the NOT NULL violation on `tenant_id` (since column evaluation order matches the table definition order).
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:840-884` (recordRollCall method)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:161-180` (attendance_records schema + unique index)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:84-90` (record_date column added — nullable, NOT NULL on `date` untouched)
  - `/home/z/my-project/repos/elimtiyaz-android/supabase/migrations/0041_canonical_academic_flow.sql:163-164` (canonical unique index `uq_attendance_canonical` on 4 cols including `tenant_id`)
- **How reached:** Desktop Academics Hub → Class detail → "Faire l'appel" button → `RollCallScreen` → user marks each student present/late/absent for a date + session (morning/afternoon/both) → clicks "Enregistrer" → `save()` calls `repos.attendance.recordRollCall({ classId, date, session, statuses, arrivalTimes, recordedBy })` → `SupabaseAttendanceRepository.recordRollCall` constructs payload without `tenant_id` and without `date` (only `record_date`) → `client.from("attendance_records").upsert(payload, { onConflict: "student_id,record_date,session" }).select()` → PostgREST 400 (multiple NOT NULL violations + no matching unique index) → repository returns `Err` → UI shows error toast.
- **Intended responsibility:** Persist roll-call records to the canonical `attendance_records` table so the website's `useAttendanceForStudent` query can read them and parents can see their child's absences.
- **Actual responsibility:** Every roll call from the desktop fails. The `attendance_records` table on the live DB has zero rows from desktop roll calls. The website's `useAttendanceForStudent` returns an empty list. Parents see "Aucune absence enregistrée" forever.
- **Dependents / consumers:**
  - Website `useAttendanceForStudent` (`portal-queries.ts:141-161`) — reads `attendance_records WHERE student_id = ?`, ordered by `date` (the legacy column, which is empty because desktop writes to `record_date`)
  - Website `attendance-view.tsx` — displays attendance records; permanently empty for desktop-originated roll calls
  - Android `SyncQueueDispatcher.pushAttendance` (line 371-389) — works correctly via `upsert_attendance_from_import` RPC (passes `p_tenant_id`, doesn't include `id`, uses `record_date` in the conflict key) — Android's path is the only one that works
- **Alternative implementations of same operation:**
  - **Android** `LocalAttendanceRepository.recordRollCall` (`LocalRepositories2.kt:841-872`) writes to local Room then enqueues sync → `SyncQueueDispatcher.pushAttendance` calls the canonical `upsert_attendance_from_import` RPC (migration 0041 line 399-445) which (a) accepts `p_tenant_id` as a parameter (no NOT NULL violation on the table column because the RPC enforces it), (b) accepts `p_record_date` only (doesn't try to set `date`), (c) uses `ON CONFLICT (tenant_id, student_id, record_date, session)` matching the canonical unique index. Android's path is correct.
- **Behavioral differences:** Desktop: ALWAYS fails (NOT NULL violation on `tenant_id`, then NOT NULL on `date`, then onConflict mismatch). Android: SUCCEEDS via the canonical RPC. The two platforms behave completely differently for the same operation.
- **Git evidence:** `recordRollCall` implemented in `b25e6ca mid` (2026-08-04). Migration 0041 added `uq_attendance_canonical` index — but the desktop's onConflict string was never updated to match the new 4-column canonical index.
- **Likely root cause:** The desktop's `recordRollCall` was written before migration 0041 added the canonical unique index — at the time, there was no canonical conflict key, so the author improvised a 3-column onConflict that didn't match any existing index either. The author also forgot to set `tenant_id` (likely copied the pattern from `recordRollCall` in the mock repository, where `tenantId = TENANT_ID` is hardcoded but the mock doesn't enforce NOT NULL). The author wrote to `record_date` (the 0029-added column) instead of `date` (the 0004 column) — they probably assumed `record_date` superseded `date`, but no migration dropped NOT NULL from `date`.
- **Potential impact:** Teachers cannot save roll calls from the desktop. The website's attendance tab is permanently empty for desktop-originated data. Combined with HOMEWORK-100 + HOMEWORK-101, the academic feature set on desktop is structurally non-functional.
- **Code snippet:**
```typescript
// supabase-academic-repository.ts:856-880 — three compounding bugs
const payload = Array.from(input.statuses.entries())
  .filter(([studentId]) => isUuid(studentId))
  .map(([studentId, status]) => ({
    student_id: studentId,
    class_id: input.classId,
    record_date: input.date,        // ← writes to 0029 column, NOT 0004 `date` (which is NOT NULL)
    session: input.session,
    status,
    arrival_time: status === "late" ? (input.arrivalTimes?.get(studentId) ?? null) : null,
    recorded_by: isUuid(input.recordedBy) ? input.recordedBy : null,
    recorded_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
    // ← tenant_id MISSING (NOT NULL violation on 0004 column)
  }));

const { data, error } = await this.client
  .from("attendance_records")
  .upsert(payload, { onConflict: "student_id,record_date,session" })  // ← 3-col conflict key; the only unique index is 4-col (uq_attendance_canonical) or 5-col (legacy)
  .select();
```
- **Confidence:** Confirmed

### FINDING ATT-101 — Absence-justification 4-state workflow is structurally broken: no desktop code to review justifications (extends DRIFT-010)

- **What:** The website's `AbsenceJustificationDialog` lets parents submit a justification (note + file upload + Google Drive link) which UPDATEs `attendance_records` setting `justification_status='submitted'`. The DONE.md and migration comments explicitly say "Staff flip submitted→accepted/rejected from the desktop app." But the desktop has ZERO code that reads `justification_status`, `justification_note`, `justification_path`, `justification_drive_link`, `justification_reviewed_by`, or `justification_reviewed_at`. The desktop's `AttendanceRecord` domain model (`mapAttendanceRow` at line 1407-1422) doesn't include these fields. The 4-state workflow (`none` → `submitted` → `accepted`/`rejected`) is structurally unreachable past the `submitted` state.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/attendance/absence-justification-dialog.tsx:77-130` (parent submits justification, sets status='submitted')
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/attendance/attendance-view.tsx:141-153` (parent reads justification status to render the status pill — only `none`/`submitted` are ever observed)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1407-1422` (`mapAttendanceRow` doesn't read `justification_*` columns)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:841-872` (Android's `recordRollCall` doesn't read or write justification fields either)
  - `/home/z/my-project/repos/elimtiyaz-website/DONE.md:35` (claims "Staff flip submitted→accepted/rejected from the desktop app" — but no such code exists)
- **How reached:** Parent signs in to website → Attendance tab → sees a child's unjustified absence → clicks "Justifier cette absence" → fills note/uploads file → clicks submit → `AbsenceJustificationDialog.submit()` does `supabase.from("attendance_records").update({ justification_note, justification_path, justification_drive_link, justification_status: 'submitted' }).eq("id", rec.id)` → RLS policy `attendance_parent_update_justification` allows the UPDATE (parent owns the student) → trigger `enforce_parent_attendance_update_columns` auto-sets `justification_status='submitted'` if it was 'none' or 'rejected' → row updated. Staff signs in to desktop → Academics Hub → ??? (NO UI exists to surface submitted justifications, NO repository method to fetch `WHERE justification_status = 'submitted'`, NO action button to accept/reject). The justification stays in `submitted` state forever. Parent refreshes attendance tab → sees "Justification submitted" pill (never accepted/rejected).
- **Intended responsibility:** The 4-state workflow (`none` → `submitted` → `accepted`/`rejected`) is a closed feedback loop: parent submits → staff reviews → parent sees the outcome.
- **Actual responsibility:** The workflow is a one-way valve: parent can submit but staff can never review. Only `none` and `submitted` states are reachable. The `accepted`/`rejected` states are documented (migration comment, DONE.md) but unreachable.
- **Dependents / consumers:** Website `attendance-view.tsx` line 141 reads `hasJustification` and line 153 displays the status pill — but only ever shows "Justification submitted" (never "accepted" or "rejected"). The `justification_status` column is part of the DB schema but its 4-state enum is permanently stuck at 2 reachable states.
- **Alternative implementations of same operation:** None. There's no desktop or Android code that processes parent-submitted justifications. The only writer of `justification_status` is the parent portal (and the trigger that auto-sets it on parent UPDATE).
- **Behavioral differences:** Pre-bug (intended): parent submits → staff reviews within hours/days → parent sees accepted/rejected. Actual: parent submits → status stays `submitted` forever → parent sees no feedback. The school's absence-justification workflow is non-functional end-to-end.
- **Git evidence:** Migration 0026 (website) and 0043 (desktop re-bundle) committed in `b25e6ca mid` (2026-08-04). DONE.md claim of "staff flips from desktop app" same commit. No subsequent commit added desktop-side review code.
- **Likely root cause:** The migration + UI on the website side was built speculatively ahead of the desktop side. The DONE.md claim is aspirational ("will be done later") but committed as if done. The author never circled back to implement the desktop-side review UI/repository.
- **Potential impact:** Parents who submit absence justifications never get feedback. Staff are unaware that justifications are pending review (no UI surfaces them). The absence-justification feature is non-functional end-to-end. EXTENDS DRIFT-010 (which documented the comment-vs-code mismatch in `attendance-view.tsx` where the comment said "the portal CANNOT submit justifications — that's a desktop workflow" while the code does submit). ATT-101 inverts DRIFT-010: the portal CAN submit, but the desktop workflow that's supposed to review doesn't exist either.
- **Code snippet:**
```typescript
// Desktop's mapAttendanceRow — doesn't read justification_* columns
function mapAttendanceRow(row: Record<string, any>): AttendanceRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    date: row.record_date,
    session: row.session,
    status: row.status,
    arrivalTime: row.arrival_time ?? null,
    note: row.note,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
    syncedAt: row.synced_at,
    // ← justification_note, justification_path, justification_drive_link,
    //   justification_status, justification_reviewed_by, justification_reviewed_at
    //   are NOT mapped — desktop domain model has no field for them
  };
}

// DONE.md:35 (false claim)
// "✅ Absence justification status tracking — attendance records now display
//  a 4-state status pill: none → submitted → accepted / rejected. The
//  submitted state is set automatically by the parent's submit; the accepted
//  / rejected states are set by staff from the desktop app (the parent sees
//  the result)."
//  ← But no desktop code reads these fields or has any UI to flip the status.
```
- **Confidence:** Confirmed — EXTENDS DRIFT-010 (which said attendance-view.tsx's comment about "desktop workflow" was misleading). ATT-101 confirms: the desktop workflow is not just undocumented — it's structurally unimplemented.

### FINDING SCHED-100 — Timetable (Emploi du Temps) feature is structurally unimplemented: domain model + UI KPI exist but no DB table, no Supabase repository, no migration

- **What:** The desktop has a complete `TimetableEntry` domain model (`teacher.ts:180-224`), a `Timetable` read-model (line 220-224), a `TeacherRepository.observeTimetableForClass/observeTimetableForTeacher/observeTimetableByAcademicYear/createTimetableEntry/updateTimetableEntry/deleteTimetableEntry` contract (`teacher-repository.ts`), a `MockTeacherRepository` implementation with full CRUD + conflict detection (`teacher-repository.ts:336-478`), a `detectTimetableConflict` validation function (`validation.ts:283-313`), and a UI consumer in `academic-year-detail-drawer.tsx:180-227` that displays a "Timetable Coverage %" KPI. But there is (a) NO Supabase migration creating a `timetable_entries` table, (b) NO Supabase `TeacherRepository` implementation (the `teachers` repository in `getSupabaseRepositories()` falls back to `mockRepositories` per `supabase-repositories.ts:138`), (c) NO UI for creating/editing timetable entries.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/domain/model/teacher.ts:132-224` (TimetableEntry + Timetable domain model)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/domain/repository/teacher-repository.ts` (TeacherRepository contract — observeTimetableForClass, createTimetableEntry, etc.)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/mock/repositories/teacher-repository.ts:336-478` (mock implementation with full CRUD + conflict detection)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts:138` (`...mockRepositories` — teachers falls back to mock)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/academics/academic-year-detail-drawer.tsx:180-227` (UI consumer: "Timetable Coverage %" KPI calls `repos.teachers.observeTimetableByAcademicYear(year.id)`)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/` — directory listing has NO migration creating a `timetable_entries` table (verified by grep)
- **How reached:** Desktop Academics Hub → click any academic year card → `AcademicYearDetailDrawer` opens → KPI grid renders "Couverture EDT" (timetable coverage) card → `useObservable(() => repos.teachers.observeTimetableByAcademicYear(year.id), [])` returns `[]` (mock store has no entries in Supabase mode) → `classesWithTimetable = 0`, `timetableCoverage = 0%` → KPI always shows 0% with `tone="warning"`.
- **Intended responsibility:** Maintain a per-class, per-academic-year timetable (Emploi du Temps) with conflict detection (no overlapping slots for the same teacher or class). Show coverage % (what % of classes have at least one timetable entry).
- **Actual responsibility:** The feature is a façade: the domain model exists, the contract exists, the mock implementation exists, the UI consumes the contract — but the persistence layer is missing. In production (Supabase mode), every query returns an empty list. The KPI is permanently 0%.
- **Dependents / consumers:**
  - `academic-year-detail-drawer.tsx:180-227` — the only UI consumer; renders the coverage KPI.
  - No UI exists for creating timetable entries — there's no "Add Timetable Entry" button anywhere.
- **Alternative implementations of same operation:** None. The Android and website have no timetable feature at all (verified by grep for `timetable`, `TimetableEntry`, `class_schedule`, `schedule_session` — only matches are in the desktop's mock layer and the academic-year-detail-drawer).
- **Behavioral differences:** Desktop (mock mode): full CRUD works, conflict detection fires, entries persist in-memory. Desktop (Supabase mode): always returns `[]`, KPI shows 0%, conflict detection never fires (no entries to conflict with). Android + website: no equivalent feature.
- **Git evidence:** Domain model + mock repository + academic-year-detail-drawer all committed in `b25e6ca mid` (2026-08-04). The supabase-repositories.ts comment at line 24 says "Personnel + Departments (DESKTOP-1): entity CRUD on `personnel` (0009) and `departments` (0010). Releve/timesheets, workforce tasks, chat, shifts, schedules and onboarding remain on the mock layer." — schedules explicitly listed as still-mock. The timetable (which is the academic counterpart to workforce `Schedule`) was never even spec'd for migration.
- **Likely root cause:** The author built the domain model + mock implementation + UI consumer as the first iteration of the timetable feature, planning to wire up the Supabase repository + migration later. The migration + Supabase repository were never written. The feature is half-built and shipped.
- **Potential impact:** The "Couverture EDT" KPI on the academic year detail drawer permanently shows 0%. Schools cannot manage their Emploi du Temps from the desktop. No platform has any timetable feature at all.
- **Code snippet:**
```typescript
// teacher.ts:180-195 — full domain model exists
export interface TimetableEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly academicYearId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly subjectId: string;
  readonly day: SchoolDay;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly room: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// supabase-repositories.ts:138 — teachers falls back to mock
const repositories: Repositories = {
  ...mockRepositories,  // ← teachers (with timetable methods) stays mock
  ...
  // No `teachers` line overriding the mock — unlike academicYears, classes,
  // subjects, grades, attendance, homework, promotion which all have
  // explicit Supabase overrides.
};

// academic-year-detail-drawer.tsx:180-227 — UI consumer
const timetableEntries = useObservable(
  () => repos.teachers.observeTimetableByAcademicYear(year.id),
  [],
);
// ↑ In Supabase mode, this returns [] forever (mock has no entries).
//   KPI shows "Couverture EDT: 0%" with warning tone for every academic year.
```
- **Confidence:** Confirmed — verified across 6 files; no migration creates the table, no Supabase repository implements the contract, the only consumer is the academic-year-detail-drawer.

### FINDING ACAD-100 — Two parallel promotion paths: dead SQL `promote_students` RPC writes to legacy `academic_history`, desktop writes to canonical `student_academic_histories`

- **What:** Two completely independent code paths implement year-end student promotion: (a) The SQL `promote_students` RPC (migration 0022 line 528-619) — `SECURITY DEFINER`, accepts `(p_tenant_id, p_academic_year_id, p_decisions jsonb, p_actor_profile_id)`, archives to the LEGACY `academic_history` table (migration 0004 line 207-221, schema: `subject_grades_json` + `attendance_summary` JSONB snapshots + `teacher_observations` text + `archived_at`); (b) The desktop's `SupabasePromotionRepository.executeBatchPromotion` (supabase-academic-repository.ts:1111-1246) — direct table operations, archives to the CANONICAL `student_academic_histories` table (migration 0029 line 117-133, schema: `gpa` + `rank` + `decision` + `narrative` separate columns). The SQL RPC is dead code (never called from any client), but the divergence means the academic history is split across two tables with two schemas depending on which path is used. The SQL RPC also has a critical bug: it references `v_student.grade_level_id` (line 562, 563, 575, 593) which is a column that DOES NOT EXIST on the `students` table — the canonical column is `grade_level_code` (TEXT, added in migration 0028). The SELECT INTO for `v_next_level` would always return NULL → every student would erroneously graduate → the archive INSERT to `academic_history.academic_level_id` (NOT NULL column per migration 0004 line 212) would fail.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0022_functions.sql:528-619` (SQL `promote_students` RPC — dead but defined)
  - `/home/z/my-project/repos/AgentGithubUplaad/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1111-1246` (desktop's `executeBatchPromotion` — direct table ops, writes to canonical `student_academic_histories`)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:207-221` (legacy `academic_history` table)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:117-133` (canonical `student_academic_histories` table)
- **How reached:** Desktop Academics Hub → open a class detail → click "Promotion de classe" → `BatchPromotionModal` → review candidates → click "Exécuter la promotion" → `useBatchPromotion.executePromotion()` → `repos.promotion.executeBatchPromotion({ candidates, targetAcademicYear, ... })` → `SupabasePromotionRepository.executeBatchPromotion` (line 1111) → step 1: `client.from("student_academic_histories").upsert(historyPayloads)` (line 1172-1177) → step 2: loop `client.from("students").update({ grade_level_code: upd.gradeLevel, class_id: null })` per promoted student (line 1182-1192) → step 3: loop for graduated students setting `enrollment_status='graduated'` (line 1195-1205) → step 4: best-effort `write_audit_log` RPC (line 1214-1227) → step 5: re-read updated students (line 1236-1240). The SQL `promote_students` RPC is NEVER invoked. The legacy `academic_history` table is NEVER written to.
- **Intended responsibility:** Provide a single canonical year-end promotion path that archives student decisions to a permanent academic history table.
- **Actual responsibility:** Only the desktop's direct-table path runs (when it works — TENANT-106 already documented that the canonical `student_academic_histories` upsert fails because the table's RLS is broken via `fn_current_tenant_id()` which is never set). The SQL RPC is dead code that would archive to the WRONG table if it were ever wired up. The legacy `academic_history` table is permanently empty.
- **Dependents / consumers:**
  - `students.grade_level_code` — advanced by the desktop's direct path; never advanced by the SQL RPC (dead).
  - `student_academic_histories` — written by the desktop's direct path (when it works).
  - `academic_history` — never written by any code path; retains its 0004-era schema with `subject_grades_json` + `attendance_summary` JSONB snapshots (a fundamentally different shape than the canonical table's separate columns).
- **Alternative implementations of same operation:** The two paths are the only implementations. They diverge on: schema (legacy JSONB snapshots vs canonical separate columns), atomicity (SQL RPC is one transaction; desktop's direct path is N separate PostgREST calls), bug surface (SQL RPC references non-existent `grade_level_id` column; desktop's direct path works around this by using `grade_level_code` directly), and access path (SQL RPC is `SECURITY DEFINER` so it bypasses RLS; desktop's direct path is subject to RLS which is broken per TENANT-106).
- **Behavioral differences:** If both paths were wired up and called concurrently, the academic history would be split: half the students in `academic_history` (legacy schema) and half in `student_academic_histories` (canonical schema). A consumer reading "all promotion history for student X" would need to UNION both tables with column-shape adaptation. Currently, only the desktop's direct path runs (and is broken per TENANT-106).
- **Git evidence:** Migration 0022 (defining `promote_students` RPC) committed in early schema. Migration 0029 (canonical `student_academic_histories` table) in `b25e6ca mid` (2026-08-04). Desktop's `executeBatchPromotion` implemented same commit. The author's comment at line 1107-1110 says: "NOTE: the original implementation called an `execute_batch_promotion` RPC that does NOT exist in any migration — it would have failed with PGRST202 at runtime. The student updates are therefore issued directly." — but the author didn't notice that the SQL `promote_students` RPC (defined in 0022) ALMOST matches what they were trying to call, just under a different name.
- **Likely root cause:** The SQL `promote_students` RPC was written in early schema (before the canonical 0029 academic-history table existed). When the canonical table was added in 0029, the desktop's promotion repository was rewritten to target the new table — but the old SQL RPC was never dropped, leaving a dead function with divergent schema. The `grade_level_id` column reference in the SQL RPC is also a relic: pre-0028, the `students` table was spec'd to have a `grade_level_id` UUID FK to `academic_levels.id`, but 0028 replaced it with `grade_level_code` TEXT (the canonical grade code). The SQL RPC was never updated.
- **Potential impact:** If anyone ever wires the SQL `promote_students` RPC (e.g., via a cron or admin tool), it would (a) archive to the WRONG table (legacy `academic_history` instead of canonical `student_academic_histories`), splitting the academic history; (b) fail at runtime because `v_student.grade_level_id` doesn't exist — the SELECT INTO always returns NULL → every student would erroneously be marked as graduated → the archive INSERT would fail on the NOT NULL `academic_level_id` column. Even if the SQL RPC were "fixed" to use `grade_level_code`, it would still write to the wrong table. The divergence is a latent footgun.
- **Code snippet:**
```sql
-- 0022_functions.sql:558-599 — SQL promote_students archives to LEGACY table
if v_decision->>'decision' = 'approved_for_promotion' then
    -- BUG: references non-existent grade_level_id column
    select id into v_next_level
      from public.academic_levels al
     where al.tenant_id = p_tenant_id
       and al.cycle = (select cycle from public.academic_levels where id = v_student.grade_level_id)
       and al.year_number = (select year_number + 1 from public.academic_levels where id = v_student.grade_level_id)
     limit 1;
    -- ↑ v_next_level always NULL (grade_level_id doesn't exist; SELECT returns NULL)
    --   → student erroneously graduated
    update public.students
       set grade_level_id = v_next_level,  -- ← column doesn't exist either
           class_id = null, updated_at = now()
     where id = v_student.id;
end if;

-- Archive to academic_history (LEGACY 0004 table — different schema than canonical)
insert into public.academic_history (
    tenant_id, student_id, academic_year_id, academic_level_id, class_id,
    gpa, decision, archived_at
) values (
    p_tenant_id, v_student.id, p_academic_year_id, v_student.grade_level_id,
    -- ↑ NULL (column doesn't exist) → NOT NULL violation on academic_level_id
    v_student.class_id, v_gpa, v_decision->>'decision', now()
)
on conflict (tenant_id, student_id, academic_year_id) do update set ...;
```
```typescript
// supabase-academic-repository.ts:1166-1178 — desktop writes to CANONICAL table
if (persistableHistory.length > 0) {
  const { error: historyErr } = await this.client
    .from("student_academic_histories")  // ← canonical 0029 table
    .upsert(persistableHistory, {
      onConflict: "student_id,academic_year",
    });
  if (historyErr) return Err(supabaseErrorToAppError(historyErr));
  // ↑ TENANT-106: RLS broken — this fails too
}
```
- **Confidence:** Confirmed — the SQL RPC's `grade_level_id` reference and the academic_history-vs-student_academic_histories divergence are both empirically verifiable by reading the migrations.

### FINDING ACAD-101 — Academic-year `setCurrentYear` is a non-atomic two-step UPDATE; failure leaves the tenant with no current year

- **What:** `SupabaseAcademicYearRepository.setCurrentYear(id, ...)` (line 106-125) updates `is_current` in TWO separate PostgREST calls (no transaction, no RPC): (a) first unsets `is_current=false` for ALL other years of the tenant, (b) then sets `is_current=true` on the target year. If step (a) succeeds but step (b) fails (network error, RLS rejection, server timeout), the tenant has NO current academic year — multiple downstream features break: the desktop's `SupabaseHomeworkRepository.push()` derives `academic_year` from `.eq("is_current", true)` (line 1031); the website's bulletin generator and various dashboards rely on the current year being set. The `createAcademicYear(input)` method (line 127-160) has the same two-step pattern: unset `is_current=false` for all years of the tenant FIRST (line 137-141), then INSERT the new year with `is_current=true`. If the INSERT fails, the old current year has been unset. There's no audit log of who flipped the `is_current` flag (the `_actorId` and `_actorName` parameters are unused — they're prefixed with underscore to silence the linter).
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:106-160` (both `setCurrentYear` and `createAcademicYear` two-step patterns)
- **How reached:** Desktop Academics Hub → click any academic year's "Set as current" action → `setCurrentYear(id, actorId, actorName)` → step 1: `client.from("academic_years").update({ is_current: false }).eq("tenant_id", getTenantId()).filter("id", "neq", id)` (line 109-113) — succeeds → step 2: `client.from("academic_years").update({ is_current: true, updated_at: ... }).eq("id", id).select().single()` (line 115-120) — fails (network timeout, RLS rejection, etc.) → method returns `Err(...)` → caller shows error toast → tenant's `academic_years` table now has ALL rows with `is_current=false` → downstream features that filter `.eq("is_current", true)` return empty results.
- **Intended responsibility:** Atomically flip the `is_current` flag from year A to year B with no transient inconsistent state.
- **Actual responsibility:** Two non-atomic UPDATEs with a race window between them. Failure in the second step leaves the tenant with no current year. No audit log of the flag flip.
- **Dependents / consumers:**
  - `SupabaseHomeworkRepository.push()` line 1028-1032 — queries `.eq("is_current", true).maybeSingle()` to derive the academic_year; returns null → falls back to hardcoded `"2025-2026"` (line 1037) → homework is mislabeled with the wrong academic year.
  - `useCurrentAcademicYear` hook (desktop) — likely has the same query.
  - Various dashboards + the website's bulletin PDF (which takes `academicYearLabel` as input).
- **Alternative implementations of same operation:** None. The mock implementation has the same two-step pattern (per the comment at line 133: "same semantics as the mock implementation"). No atomic RPC was ever written.
- **Behavioral differences:** Pre-bug (intended): atomic flip — either both UPDATEs succeed or neither. Actual: race window between steps. Under network instability (slow connection, RLS rejection on the second UPDATE), the tenant is left with no current year.
- **Git evidence:** Both `setCurrentYear` and `createAcademicYear` implemented in `b25e6ca mid` (2026-08-04). The `_actorId`/`_actorName` underscore-prefix (silencing unused-parameter linter) signals the author knew the audit-trail was missing but never wrote the `write_audit_log` RPC call.
- **Likely root cause:** The author wrote the simplest possible implementation (two sequential UPDATEs) without considering atomicity. The mock layer had the same pattern, and the Supabase port was a direct translation. No RPC was written to wrap the two UPDATEs in a transaction.
- **Potential impact:** Under any failure in the second UPDATE, the tenant is left with no current academic year. Downstream features that filter on `is_current=true` return empty results. The desktop's homework push falls back to the hardcoded `"2025-2026"` academic_year label (line 1037) — homework rows would be mislabeled with a year that may not exist in the live DB. The bulletin PDF (which takes `academicYearLabel` as input) would show the wrong year.
- **Code snippet:**
```typescript
// supabase-academic-repository.ts:106-125 — non-atomic two-step UPDATE
async setCurrentYear(id: string, _actorId: string, _actorName: string): Promise<Result<AcademicYear>> {
  // Step 1: unset is_current for all other years of the tenant
  await this.client
    .from("academic_years")
    .update({ is_current: false })
    .eq("tenant_id", getTenantId())
    .filter("id", "neq", id);
  // ↑ If this succeeds but step 2 fails → tenant has NO current year.

  // Step 2: set is_current=true on the target year
  const { data, error } = await this.client
    .from("academic_years")
    .update({ is_current: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return Err(supabaseErrorToAppError(error));
  // ↑ Returns Err — but step 1 already committed. Tenant has no current year.
  //   No audit log entry written — _actorId and _actorName are unused.
  await this.refresh();
  return Ok(mapAcademicYearRow(data));
}
```
- **Confidence:** Confirmed

### FINDING HOMEWORK-102 — Legacy `homework_assignments` table is dead: still in DB schema with RLS, never written, realtime subscription wasted (extends WEAK-016)

- **What:** The legacy `homework_assignments` table (migration 0004 line 185-202) is still in the DB schema with: RLS policies (migration 0019 line 281-294 — `homework_select`, `homework_teacher_write`, `homework_teacher_update`), indexes (migration 0020 line 45 — `ix_homework_due_active`), and a `touch_updated_at` trigger (migration 0004 line 244). No migration drops the table. But NO code anywhere writes to or reads from it (verified by `rg "from\(['\"]homework_assignments['\"]\)"` — zero matches across all 3 repos). The website's `useHomeworkRealtime` (`use-realtime.ts:136-145`) subscribes to this dead table with `target_class_id` filter — a wasted realtime channel that never fires (because no INSERT ever happens on the table).
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:185-202` (table definition)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0019_rls_policies.sql:281-294` (RLS policies)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0020_indexes.sql:45` (index)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/use-realtime.ts:136-145` (realtime subscription to dead table — already documented as WEAK-016)
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/calendar/calendar-view.tsx:103` (comment lies: says "from homework_assignments" but the actual query uses `useHomeworkForClass` which reads canonical `homework` table)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/types/database.ts:560-596` (typed `HomeworkAssignmentRow` interface still defined — typed for a dead table)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/types/database.ts:851` (Database interface still declares `homework_assignments` table)
- **How reached:** DB provisioning runs migration 0004 → creates the `homework_assignments` table with NOT NULL `class_subject_id`, `target_class_id`, `title`, `description`, `due_date`, `created_by` columns. Migration 0019 adds 3 RLS policies. Migration 0020 adds an index. Migration 0029 creates the canonical `homework` table (separate schema, separate purpose). Migration 0041 hardens the canonical `homework` table's RLS. No migration drops the legacy table. The website's `useHomeworkRealtime` opens a Supabase realtime channel on `homework_assignments` (filter `target_class_id=eq.${classId}`) — the channel subscribes successfully but no events ever arrive (because no INSERT/UPDATE/DELETE ever fires on the dead table).
- **Intended responsibility:** The legacy table was the original 0004-era homework store. Migration 0029 should have either dropped it or backfilled its rows into the canonical `homework` table.
- **Actual responsibility:** The legacy table is dead. No code reads/writes it. The wasted realtime channel consumes a Supabase realtime connection slot but never delivers events.
- **Dependents / consumers:**
  - Website `useHomeworkRealtime` — subscribes to dead table; never fires.
  - Website `HomeworkAssignmentRow` typed interface — declared but unused.
  - The `Database` type interface declares the table (per WEAK-017) — but the canonical `homework` table is missing from the same interface.
- **Alternative implementations of same operation:** The canonical `homework` table (migration 0029) is the only one that any code reads from or writes to (when the writes work, which they don't per HOMEWORK-100/HOMEWORK-101).
- **Behavioral differences:** Pre-bug (intended): single canonical `homework` table; realtime subscription delivers events; parents see homework push in real-time. Actual: TWO `homework`-named tables in DB (one canonical, one legacy dead). Realtime subscription on legacy table → never fires. Parents never see homework push in real-time (must refresh the page). Combined with HOMEWORK-100 (desktop push fails) and HOMEWORK-101 (Android push fails), parents never see homework at all (canonical table is empty).
- **Git evidence:** Migration 0029 committed in `b25e6ca mid` (2026-08-04). No subsequent migration drops `homework_assignments` or backfills rows. The website's `use-realtime.ts:138` (legacy table subscription) committed in `03f6365 vitest 87/87` (2026-08-28) — written after the canonical table existed.
- **Likely root cause:** When migration 0029 added the canonical `homework` table, the author forgot to drop the legacy `homework_assignments` table. The website's `useHomeworkRealtime` was written against the legacy table name (copied from an old draft of the codebase that predated 0029). EXTENDS WEAK-016 by tracing why the realtime is broken: not because the filter is wrong (which WEAK-016 already documented), but because the table itself is dead.
- **Potential impact:** Parents never see homework push notifications in real-time on the website. Combined with HOMEWORK-100 + HOMEWORK-101, the homework feature has THREE compounding bugs: desktop push fails (HOMEWORK-100), Android push fails (HOMEWORK-101), and even if a push succeeded, the realtime subscription on the dead legacy table would never deliver the event to subscribers. Fixing any one or two of these bugs still leaves the system non-functional.
- **Code snippet:**
```typescript
// use-realtime.ts:136-145 — wasted realtime subscription on dead table
export function useHomeworkRealtime(classId: string | null | undefined) {
  useRealtimeInvalidation(
    "homework_assignments",  // ← DEAD TABLE — no INSERTs ever happen
    [["homework", classId]],
    {
      filter: classId ? `target_class_id=eq.${classId}` : undefined,
      //                ↑ wrong column name (already documented by WEAK-016)
      enabled: Boolean(classId),
    }
  );
}

// calendar-view.tsx:103 — comment lies about the source
// "Derived events: payment due dates (from installments) + homework due dates
//  (from homework_assignments). These are NOT stored as calendar_events"
// ↑ Comment says legacy table, but the actual code:
const homework = useHomeworkForClass(activeKid?.class_id ?? null, { limit: 100 });
// ↑ Reads from canonical `homework` table (portal-queries.ts:178).
```
- **Confidence:** Confirmed — EXTENDS WEAK-016. WEAK-016 said the realtime filter is wrong (`target_class_id` instead of `class_id`). HOMEWORK-102 adds: even if the filter were correct, the table is dead, so the subscription never fires anyway. The two bugs are independent; fixing the filter alone wouldn't restore realtime.

### FINDING GRADE-100 — `homework.acknowledged_count` column is permanently 0; no code increments it

- **What:** The canonical `homework` table (migration 0029 line 110) has an `acknowledged_count INT NOT NULL DEFAULT 0` column. The desktop's `SupabaseHomeworkRepository.push()` (line 1002-1071) doesn't set this field on INSERT — Postgres DEFAULT kicks in, so new rows start at 0. No code path (no UI click handler, no SQL trigger, no RPC, no Edge Function) ever increments it. The website's `HomeworkView` (`homework-view.tsx`) does NOT display this count to parents and has no "Acknowledge" button. The field is structurally unreachable past its initial 0 value.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:110` (`acknowledged_count INT NOT NULL DEFAULT 0`)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:1039-1053` (INSERT omits the field; DEFAULT 0)
  - `/home/z/my-project/repos/elimtiyaz-website/src/features/homework/homework-view.tsx` (no "Acknowledge" button rendered)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/features/academics/HomeworkPushScreen.kt` (Android homework-push UI — also doesn't acknowledge)
- **How reached:** A teacher pushes homework → INSERT into `homework` table → `acknowledged_count = 0` (DEFAULT). A parent opens the homework on the website → sees the homework details in a Dialog → no "Acknowledge" button → closes the dialog. The `acknowledged_count` stays 0 forever. The teacher's history view (`HomeworkHistoryTab.tsx`) shows the homework with `acknowledgedCount` (line 1439) but always displays 0.
- **Intended responsibility:** Track how many parents/students have acknowledged a homework (so teachers can see "X of Y students have seen this homework").
- **Actual responsibility:** The field is permanently 0 for every homework. The intent is unimplemented.
- **Dependents / consumers:** `HomeworkHistoryTab.tsx` (desktop) reads `acknowledgedCount` but always displays 0. The `mapHomeworkRow` mapper (line 1439) reads the field but no UI surfaces it.
- **Alternative implementations of same operation:** None. There's no acknowledge button, no RPC, no trigger. The field is decoration.
- **Behavioral differences:** Pre-bug (intended): field grows over time as parents acknowledge. Actual: field is permanently 0.
- **Git evidence:** Migration 0029 committed in `b25e6ca mid` (2026-08-04). No subsequent migration adds a trigger to increment the count. No commit adds an "Acknowledge" button.
- **Likely root cause:** The author spec'd the column for a future "parent acknowledges homework" feature but never implemented the UI/trigger side.
- **Potential impact:** The `acknowledged_count` column on every row of the `homework` table is permanently 0. The column occupies DB storage but carries no information. A future feature that depends on the count would silently see 0 for every homework.
- **Code snippet:**
```sql
-- 0029_academics_module.sql:95-111 — column declared but unused
CREATE TABLE IF NOT EXISTS public.homework (
    id UUID PRIMARY KEY DEFAULT public.gen_uuid(),
    tenant_id UUID NOT NULL,
    ...
    acknowledged_count INT NOT NULL DEFAULT 0  -- ← always 0; nothing increments it
);
```
```typescript
// mapHomeworkRow reads the field but it's always 0
function mapHomeworkRow(row: Record<string, any>): Homework {
  return {
    ...
    acknowledgedCount: row.acknowledged_count ?? 0,  // ← always 0
  };
}
```
- **Confidence:** Confirmed — verified across 3 platforms (desktop, Android, website) that no code increments the field.

### FINDING ATT-102 — Desktop `narrative-generator-modal` computes attendance rate as `present / total` (excludes late) — extends WEAK-019

- **What:** `narrative-generator-modal.tsx` line 141-143 computes `attendanceRate = attendance.length === 0 ? 1.0 : attendance.filter((r) => r.status === "present").length / attendance.length`. This is `present / total` (excludes late). The canonical rule (per `portal-derive.ts:287-294` and the desktop's own `calculateAttendanceRate` in `domain/model/academic.ts:279`) is `(present + late) / total`. The wrong attendance rate is then sent to the AI narrative generator (line 159 `attendanceRate`) and persisted in `student_academic_histories.narrative` (canonical 0029 column) for the year-end promotion flow.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/academics/narrative-generator-modal.tsx:141-143` (wrong formula)
  - `/home/z/my-project/repos/AgentGithubUplaad/elimtiyaz-desktop/src/domain/model/academic.ts:279-294` (canonical `calculateAttendanceRate` — `(present + late) / total`)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/canonical/portal-derive.ts:287-294` (canonical rule on the website)
  - `/home/z/my-project/repos/AgentGithubUplaad/elimtiyaz-desktop/src/features/crm/student-detail/academic-tab.tsx:293-294` (uses canonical function correctly — divergence within the same desktop app)
- **How reached:** Desktop student detail → Academic tab → click "Générer appréciation" → `narrative-generator-modal` opens → fetches the student's attendance records → computes `attendanceRate = present/total` (line 141-143) → sends to AI narrative generator (line 155-165) → AI generates a French appreciation text including "Taux de présence: X%" → text persisted to `student_academic_histories.narrative` via the batch promotion flow → student's permanent academic record contains the wrong attendance rate.
- **Intended responsibility:** Compute the canonical attendance rate (per `portal-derive.ts` and `academic.ts:279`).
- **Actual responsibility:** Uses a non-canonical formula that systematically understates the rate by the `late / total` fraction. For a student with 18 present + 2 late + 0 absent (out of 20), canonical rate = 100%; the narrative generator computes 90%. The AI narrative says "Taux de présence: 90%" when the canonical rate is 100%.
- **Dependents / consumers:**
  - `narrative-generator.ts:62` formats the rate as a string for the AI prompt.
  - `student_academic_histories.narrative` (canonical 0029 column) persists the AI-generated text permanently.
  - The bulletin PDF (if it includes the narrative) would print the wrong rate.
- **Alternative implementations of same operation:** The desktop's own `academic-tab.tsx:293-294` uses `calculateAttendanceRate(attendanceRecords)` (canonical) — divergence within the same app. The website's `attendance-view.tsx:81` (per WEAK-019) uses the same wrong `present/total` formula. The website's `portal-derive.ts:287-294` has the correct canonical function but `attendance-view.tsx` doesn't use it.
- **Behavioral differences:** Desktop `academic-tab.tsx` (canonical): correct rate. Desktop `narrative-generator-modal.tsx` (wrong): understates by `late/total`. Website `attendance-view.tsx` (wrong, WEAK-019): same understatement. The divergence is between views WITHIN THE SAME APP, not just across platforms.
- **Git evidence:** `narrative-generator-modal.tsx` committed in `b25e6ca mid` (2026-08-04). WEAK-019 was filed against `attendance-view.tsx` (website) on 2026-08-28. The desktop's narrative-generator-modal has had the same bug since first commit but was never audited.
- **Likely root cause:** The author copy-pasted the same wrong formula across both files (independent copies of `present/total`). The canonical function exists in `academic.ts` but neither file imports it. The author either didn't know about the canonical function or chose to inline a simpler formula.
- **Potential impact:** The AI-generated narrative text (which goes into the student's permanent academic record via `student_academic_histories.narrative`) systematically understates attendance. For students with many late arrivals (which still count as "attended" per the canonical rule), the narrative makes them look less assiduous than they are. The AI may also adjust its appreciation tone based on the understated rate ("needs to improve attendance" when the student is actually at 100% canonical).
- **Code snippet:**
```typescript
// narrative-generator-modal.tsx:141-143 — WRONG formula (excludes late)
const attendanceRate = attendance.length === 0
  ? 1.0
  : attendance.filter((r) => r.status === "present").length / attendance.length;
//  ↑ Excludes "late" arrivals; canonical rule includes them.

// academic-tab.tsx:293-294 — CORRECT (canonical function)
const attendanceRate = attendanceRecords.length > 0
  ? calculateAttendanceRate(attendanceRecords)
  : null;
// ↑ calculateAttendanceRate counts (present + late) / total — canonical.

// academic.ts:279-294 — canonical function
export function calculateAttendanceRate(records: readonly AttendanceRecord[]): number {
  if (records.length === 0) return 1.0;
  const presentCount = records.filter(
    (r) => r.status === "present" || r.status === "late",  // ← late INCLUDED
  ).length;
  return Number((presentCount / records.length).toFixed(2));
}
```
- **Confidence:** Confirmed — EXTENDS WEAK-019. WEAK-019 said `attendance-view.tsx` (website) computes the rate wrong. ATT-102 says the same wrong formula exists in `narrative-generator-modal.tsx` (desktop) — the bug is duplicated across platforms AND across files within the same platform. The canonical function exists but neither file uses it.

### FINDING ACAD-102 — `class_subjects.teacher_id` is single-UUID; co-teaching (multiple teachers per subject per class) is structurally unsupported

- **What:** The `class_subjects` table (migration 0004 line 99-110) has a single `teacher_id UUID` column per (class, subject) — there is NO `secondary_teacher_id` or many-to-many teacher-class-subject assignment table. The unique constraint `(tenant_id, class_id, subject_id)` (line 109) means each (class, subject) pair has exactly ONE row, with ONE teacher. Co-teaching (two teachers sharing the same subject for the same class — common in Algerian lycée where chapters rotate) is structurally unrepresentable at the DB level. Migration 0029 (line 49) added a `teacher_name TEXT` column (denormalized display name) but didn't add a `secondary_teacher_id`. The desktop's `ClassSubjectsTab.tsx` (verified by file listing in the academics directory) renders a single teacher-assignment dropdown per (class, subject) — the UI also doesn't support co-teaching.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:99-110` (table schema — single `teacher_id`)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0029_academics_module.sql:49` (added `teacher_name TEXT` but not a secondary teacher)
  - `/home/z/my-project/repos/AgentGithubUplaad/elimtiyaz-desktop/src/features/academics/class-subjects-tab.tsx` (UI: single-teacher dropdown per (class, subject))
- **How reached:** Desktop Academics Hub → Class detail → Subjects tab → click "Assign teacher to subject" → single dropdown of teachers → user picks one → save. There's no "Add second teacher" button. The DB row has `teacher_id` set; no `secondary_teacher_id` column exists to populate.
- **Intended responsibility:** Track the teacher(s) assigned to each (class, subject) pair, including co-teaching arrangements.
- **Actual responsibility:** Tracks exactly one teacher per (class, subject). Co-teaching is unrepresentable. If a school has two Math teachers for Class 1AM-A (one for algebra, one for geometry), the system can't model this — the operator must pick one and lose the other.
- **Dependents / consumers:**
  - The Timetable `TimetableEntry.teacherId` (per SCHED-100) references a single teacher per slot — so co-teaching is also unrepresentable in the (unimplemented) timetable.
  - The `Subject.teacherId` and `ClassSubject.teacherId` domain models (desktop) — both single UUID.
- **Alternative implementations of same operation:** None — no migration adds a `class_subject_teachers` join table. The desktop's mock layer has the same single-teacher constraint.
- **Behavioral differences:** Pre-bug (intended): a class with two teachers for the same subject would have two `class_subjects` rows OR a join table; either approach would let both teachers see their assignment. Actual: only one teacher can be assigned per (class, subject) — the unique constraint enforces this at the DB level.
- **Git evidence:** Migration 0004 committed in initial schema. Migration 0029 line 49 added `teacher_name` but didn't add a secondary teacher column. No subsequent migration adds a join table.
- **Likely root cause:** The original schema was designed for the simple case (one teacher per class per subject). Co-teaching wasn't considered. The migration 0029 additions (teacher_name, weekly_hours) were cosmetic denormalizations — they didn't address the structural limit.
- **Potential impact:** Schools with co-teaching arrangements cannot represent them in the system. The "missing" teacher doesn't see their assignment in any teacher-facing view. The Timetable feature (per SCHED-100) also can't represent co-teaching.
- **Code snippet:**
```sql
-- 0004_academic_structure.sql:99-110 — single teacher_id, no secondary
create table public.class_subjects (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    class_id        uuid        not null references public.classes(id) on delete cascade,
    subject_id      uuid        not null references public.subjects(id) on delete restrict,
    teacher_id      uuid,                                          -- SINGLE teacher; no secondary
    coefficient     integer     not null default 1 check (coefficient > 0),
    is_active       boolean     not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, class_id, subject_id)  -- ← one row per (class, subject)
);

-- 0029_academics_module.sql:49 — adds teacher_name but no secondary_teacher_id
ALTER TABLE public.class_subjects ADD COLUMN IF NOT EXISTS teacher_name TEXT;
ALTER TABLE public.class_subjects ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(4, 1)
    DEFAULT 2.0 CHECK (weekly_hours > 0);
```
- **Confidence:** Confirmed

### FINDING ACAD-103 — Mid-term section moves have no audit trail; `students.class_id` is updated in place, no `class_transfers` or `enrollment_history` table

- **What:** When a student moves sections mid-term (e.g., from Class 1AM-A to Class 1AM-B), the desktop's `SupabaseStudentRepository.update()` (in `supabase-shared-repositories.ts` line ~639+) calls `client.from("students").update({ class_id: newClassId, updated_at: now }).eq("id", id)` — directly overwriting the `class_id` column. There is NO `class_transfers` or `enrollment_history` table to track the move. The previous `class_id` is silently overwritten — no audit trail of when the move happened, who authorized it, why it happened, or what the previous class was. The legacy `academic_history` table (migration 0004 line 207-221) captures YEAR-END snapshots (via `class_id`), not mid-term transfers. So mid-term section moves are invisible to history.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (around line 639 — `SupabaseStudentRepository.update` method that updates `class_id` in place)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0004_academic_structure.sql:207-221` (legacy `academic_history` table — year-end snapshots only, not mid-term transfers)
  - `/home/z/my-project/repos/AgentGithubUplaad/elimtiyaz-desktop/supabase/migrations/` — no `class_transfers` or `enrollment_history` migration exists (verified by grep)
- **How reached:** Desktop CRM → student detail → edit student → change class dropdown → save → `SupabaseStudentRepository.update()` issues `client.from("students").update({ class_id, ... }).eq("id", id)` → row updated, `updated_at` set to now → no audit log entry written (the `update` method doesn't call `write_audit_log` for the class_id change). The previous `class_id` value is lost. If a parent later asks "when did my child move from 1AM-A to 1AM-B?", there's no answer.
- **Intended responsibility:** Maintain an audit trail of class transfers (when, who, why, from, to).
- **Actual responsibility:** `students.class_id` is mutated in place. No history table records the transfer. The `updated_at` column tells you WHEN the row was last touched but not WHAT changed. The `audit_logs` table could in principle capture this, but the desktop's `update()` method doesn't call `write_audit_log` for the class_id change.
- **Dependents / consumers:**
  - `students.class_id` — the only source of "current class". Any consumer (attendance, grades, homework) reads the current value.
  - `academic_history.class_id` — year-end snapshot. Captures the class the student was in AT YEAR END, not the class they were in mid-year. If a student moved 1AM-A → 1AM-B mid-year, the year-end snapshot shows 1AM-B; the 1AM-A period is lost.
- **Alternative implementations of same operation:** None. The legacy `academic_history` table is year-end-only by design (line 219 `archived_at`). No mid-term transfer table exists. The `audit_logs` table could capture the change but the `update()` method doesn't write to it for class_id changes.
- **Behavioral differences:** Pre-bug (intended): a `class_transfers(student_id, from_class_id, to_class_id, transferred_at, transferred_by, reason)` table would track every move. Actual: only the current `class_id` is stored; the move is invisible.
- **Git evidence:** No `class_transfers` migration exists. The `SupabaseStudentRepository.update` was written in `b25e6ca mid` (2026-08-04) without an audit-log call for class_id changes.
- **Likely root cause:** The author treated `class_id` as a simple scalar property of the student, not as a relationship that needs history. The legacy `academic_history` table was the only place that captured class assignments, and it was year-end-only by design.
- **Potential impact:** Mid-term section moves are invisible to history. If a parent disputes a transfer ("I never agreed to move my child from 1AM-A to 1AM-B!"), there's no audit trail. The school has no record of when/why the transfer happened. Reports that aggregate by class (e.g., "1AM-A had 30 students this term") would be wrong — they'd show the current count, not the historical count.
- **Code snippet:**
```typescript
// SupabaseStudentRepository.update (supabase-shared-repositories.ts:~639)
// — overwrites class_id in place, no audit log
const { data, error } = await client
  .from("students")
  .update({
    class_id: updates.classId ?? null,  // ← overwrites the previous value
    updated_at: now,
    // ... other fields ...
  })
  .eq("id", id)
  .select()
  .single();
// ↑ No call to write_audit_log for the class_id change.
//   No INSERT into a class_transfers table.
//   The previous class_id value is lost.
```
- **Confidence:** Confirmed — verified by grep that no `class_transfers` or `enrollment_history` migration exists across all 3 repos.

### FINDING ATT-103 — Android `alertAbsences` has no threshold; alerts for every student in the input (divergence from desktop's 3-absence threshold)

- **What:** The desktop's `SupabaseAttendanceRepository.alertAbsences(studentIds)` (line 897-963) counts absences per student for the current term and alerts parents ONLY for students with ≥3 absences (line 899 `THRESHOLD = 3`). The Android's `LocalAttendanceRepository.alertAbsences(studentIds)` (`LocalRepositories2.kt:878-908`) alerts for EVERY student in the input list — no threshold check, no current-term windowing. The desktop's threshold is hardcoded `THRESHOLD = 3`; the Android's threshold is effectively 1.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaad/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts:897-963` (desktop: threshold 3, current-term window)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:878-908` (Android: no threshold)
- **How reached:** The desktop's `alertAbsences` is called from `roll-call-screen.tsx:125` with `nonPresentIds` (all students who weren't marked present in this roll call). The desktop then queries the server for each student's current-term absence count and alerts only those with ≥3. The Android's `alertAbsences` is dead code (never called from any UI — verified by grep), but if it WERE called, it would alert for every student in the input regardless of absence count.
- **Intended responsibility:** Notify parents when their child has accumulated a meaningful number of absences (3+ per term per the desktop's threshold). Avoid alert fatigue (don't alert for every single absence).
- **Actual responsibility:** Desktop: alerts only for ≥3 absences (correct). Android: would alert for every student in the input (1+ absences). The two platforms diverge on the threshold.
- **Dependents / consumers:** Desktop roll-call-screen flow → `alertAbsences(nonPresentIds)` → desktop filters server-side. Android: dead code.
- **Alternative implementations of same operation:** None. The two implementations are the only ones. The website has no `alertAbsences` method at all.
- **Behavioral differences:** Desktop: 3-absence threshold. Android: 1-absence threshold. The Android would generate N× more alerts than the desktop for the same input.
- **Git evidence:** Both implementations committed in `b25e6ca mid` (2026-08-04). The desktop's THRESHOLD=3 hardcoded at line 899. The Android's implementation never had a threshold — the comment at line 874 says "FIX (hollow action): alertAbsences previously wrote ONLY audit rows — no parent was ever alerted. Now a real in-app notification is created per student (linked to the parent's record)..." — the "fix" was to add the notification but not the threshold.
- **Likely root cause:** The Android developer implemented the notification side but didn't carry over the desktop's threshold logic. The threshold check is a one-liner that was missed.
- **Potential impact:** If the Android's `alertAbsences` is ever wired up (e.g., via a future "alert parents" button on the Android roll-call screen), parents would receive a notification for every single absence — alert fatigue, ignored notifications. The desktop's threshold logic prevents this; the Android doesn't.
- **Code snippet:**
```kotlin
// LocalRepositories2.kt:878-908 — Android: no threshold
override suspend fun alertAbsences(studentIds: List<String>, actorId: String, actorName: String): Result<Unit> {
    val now = Instant.now().toString()
    studentIds.forEach { studentId ->  // ← no threshold check; alerts for EVERY student
        val student = studentDao.getById(studentId) ?: return@forEach
        auditDao.upsert(auditLog("attendance.alert", "student", studentId, actorId, actorName))
        notificationDao.upsert(
            NotificationEntity(
                id = "ntf-abs-${UUID.randomUUID()}",
                // ... notification content ...
            )
        )
    }
    return Result.Ok(Unit)
}
```
```typescript
// supabase-academic-repository.ts:897-948 — Desktop: 3-absence threshold
async alertAbsences(studentIds: string[]): Promise<Result<void>> {
    try {
      const THRESHOLD = 3;  // ← hardcoded 3-absence threshold
      const now = new Date();
      const window = currentTermWindow(now);
      const windowStart = window.start.toISOString().slice(0, 10);
      // Count current-term absences per candidate student (LATE excluded).
      const { data, error } = await this.client
        .from("attendance_records")
        .select("student_id, status")
        .in("student_id", studentIds.filter(isUuid))
        .in("status", ["absent_excused", "absent_unexcused"])
        .gte("record_date", windowStart)
        .lte("record_date", now.toISOString().slice(0, 10));
      // ...
      const flagged = [...counts.entries()]
        .filter(([, c]) => c >= THRESHOLD)  // ← only ≥3 absences trigger alert
        .map(([studentId, c]) => ({ studentId, count: c }));
      // ... insert notifications only for flagged students ...
}
```
- **Confidence:** Confirmed

### FINDING HOMEWORK-103 — Android `pullAll` doesn't pull homework/attendance/assessments; cross-platform visibility is one-way only

- **What:** The Android's `PullSyncRepository.pullAll()` (`PullSyncRepository.kt:264-281`) fetches: parents, students, payments, ledger_entries, classes, subjects, installments, personnel, departments, notifications, workflow_runs. It does NOT pull: `homework`, `attendance_records`, `assessments`. So even if the Android's sync push worked (it doesn't, per HOMEWORK-101 / ATT-100), the Android would never SEE homework/attendance/grades created on the desktop or on the website (which is read-only). Cross-platform visibility is one-way only: Android pushes (when it works) but doesn't pull. Desktop writes directly to canonical tables but doesn't push at all (per HOMEWORK-100 / ATT-100 — desktop's direct INSERT fails too, but even when fixed, the desktop has no realtime subscription per CACHE-103).
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt:264-281` (pullAll method — no homework/attendance/assessments pull)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1439-1440` (`LocalHomeworkRepository.observeForClass` — only reads local Room, never Supabase)
  - `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:937-953` (`LocalGradeRepository.observeForStudent/observeForClass` — only reads local Room)
- **How reached:** Desktop teacher pushes homework (when HOMEWORK-100 is fixed) → INSERT into canonical `homework` table → server has it → website's `useHomeworkForClass` query reads it → website's `useHomeworkRealtime` (per WEAK-016) doesn't fire (legacy table) but the next refetch catches it. Android SyncWorker (15-min cycle) calls `pullAll()` → fetches the 11 entity types listed above → does NOT fetch homework → Android's local Room `homework` table stays empty → Android's `HomeworkPushScreen` shows "no homework" for the class.
- **Intended responsibility:** Sync bidirectionally: Android pushes local mutations to Supabase AND pulls remote mutations from Supabase into local Room. The 15-min `SyncWorker` cycle is the canonical freshness window.
- **Actual responsibility:** Pull is partial — homework/attendance/assessments are not pulled. The Android only sees what it created locally. Cross-device visibility (Android A creates → Android B sees) is zero. Cross-platform visibility (desktop creates → Android sees) is zero. The website (which reads directly from Supabase, no pull needed) is the only platform that sees everything.
- **Dependents / consumers:**
  - `LocalHomeworkRepository.observeForClass` — reads local Room; never queries Supabase.
  - `LocalGradeRepository.observeForStudent` — reads local Room; never queries Supabase.
  - `LocalAttendanceRepository.observe*` — reads local Room; never queries Supabase.
- **Alternative implementations of same operation:** The desktop uses Supabase-backed repositories with NO pull layer at all — it queries Supabase directly on every read. The website also queries Supabase directly via TanStack Query. Only the Android has the Room-first + pull architecture.
- **Behavioral differences:** Android: 15-min stale at best, with NO pull for academic entities. Desktop: queries Supabase directly (slow but fresh). Website: queries Supabase directly via TanStack Query (slow but fresh, with 30s staleTime per CACHE-100).
- **Git evidence:** `PullSyncRepository.pullAll` committed in `b25e6ca mid` (2026-08-04). The list of pulled entities was written once and never extended to include academic tables.
- **Likely root cause:** The pull layer was built for the financial cluster (parents, students, payments, ledger, installments) — the entities the Excel importer touches. Academic entities (homework, attendance, assessments) were added later (migration 0029 + 0041) but the pull layer was never extended.
- **Potential impact:** A teacher using the Android app never sees homework/attendance/grades created on the desktop or by other Android devices. The Android is a silo. Combined with HOMEWORK-100 + HOMEWORK-101 (push failures), the Android is essentially read-only for academic data, but only for data it created locally — for everything else, it's blind.
- **Code snippet:**
```kotlin
// PullSyncRepository.kt:264-281 — pullAll fetches 11 entity types, NOT academic ones
suspend fun pullAll(sinceIso: String? = null): Result<Int> = withContext(Dispatchers.IO) {
    Log.i("PullSync", "=== STARTING PULL ALL FROM SUPABASE ===")
    val p = (pullParents(sinceIso) as? Result.Ok)?.value ?: 0
    val s = (pullStudents(sinceIso) as? Result.Ok)?.value ?: 0
    val pay = (pullPayments(sinceIso) as? Result.Ok)?.value ?: 0
    val led = (pullLedgerEntries(sinceIso) as? Result.Ok)?.value ?: 0
    val cls = (pullClasses() as? Result.Ok)?.value ?: 0
    val sub = (pullSubjects() as? Result.Ok)?.value ?: 0
    val ins = (pullInstallments() as? Result.Ok)?.value ?: 0
    val per = (pullPersonnel() as? Result.Ok)?.value ?: 0
    val dep = (pullDepartments() as? Result.Ok)?.value ?: 0
    val notif = (pullNotifications() as? Result.Ok)?.value ?: 0
    val wfr = (pullWorkflowRuns() as? Result.Ok)?.value ?: 0
    // ← NO pullHomework, pullAttendance, pullAssessments
    val total = p + s + pay + led + cls + sub + ins + per + dep + notif + wfr
    Log.i("PullSync", "=== PULL COMPLETE: Total $total records synchronized ===")
    Result.Ok(total)
}

// LocalHomeworkRepository.kt:1439-1440 — observes local Room only
override fun observeForClass(classId: String): Flow<List<Homework>> =
    homeworkDao.observeByClass(classId).map { rows -> rows.map { LocalMappers.run { it.toDomain() } } }
// ↑ Never queries Supabase. Only sees what was created on this device.
```
- **Confidence:** Confirmed

### FINDING ACAD-104 — Migration 0041 in Android repo is a partial-copy of desktop chain; applying Android migrations to a fresh DB fails (extends CROSS-003)

- **What:** The Android repo's `supabase/migrations/` directory contains only 6 files: `0034_canonical_engine_unification.sql`, `0035_tier3_drop_signature_fixes.sql`, `0036_tier4_backend_hardening.sql`, `0040_cross_platform_rpc_unification.sql`, `0041_canonical_academic_flow.sql`, `0042_canonical_overdue_asof_equivalence.sql`. These migrations ALTER existing tables (`attendance_records`, `homework`, `assessments`, `grades`, `class_subjects`) and CREATE functions that reference other tables (`students`, `parents`, `user_profiles`, `tenants`, `ledger_entries`, `installments`, `payments`). The base schema (migrations 0001-0033) is NOT in the Android repo — they live only in the desktop repo. Applying Android migrations to a fresh database fails immediately: migration 0034 ALTERs tables that don't exist yet, migration 0041 ALTERs `attendance_records` (created in 0004) and `homework` (created in 0029) — both tables are missing if 0004 + 0029 haven't run.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-android/supabase/migrations/` (6 migration files)
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/` (44 migration files including the base 0001-0033)
- **How reached:** A developer clones the Android repo, runs `supabase db push` from the Android repo's `supabase/` directory → migration 0034 starts → `ALTER TABLE public.payments ...` → fails with `relation "public.payments" does not exist` (because the base `payments` table is created in desktop migration 0007). The developer must either (a) manually copy the desktop migrations 0001-0033 into the Android repo, or (b) apply the desktop migrations first then the Android migrations on top.
- **Intended responsibility:** The Android repo's migrations should be applicable independently OR clearly documented as a delta that requires the desktop chain.
- **Actual responsibility:** The Android migrations are a partial copy that requires the desktop chain to have run first. CROSS-003 already documented this in general; ACAD-104 extends specifically to the academic tables: migration 0041 ALTERs `attendance_records` (line 38-90), `assessments` (line 38-77), and creates the canonical unique index `uq_attendance_canonical` on `attendance_records` (line 163-164) — all of these require the base tables from desktop migrations 0004 + 0029. The Android's `0041_canonical_academic_flow.sql` also creates `homework_canonical_select` and `homework_canonical_write` RLS policies (line 207-224) that DROP and REPLACE the `rls_homework_tenant` policy created in desktop migration 0029 line 200-202. Without desktop 0029 having run, the DROP POLICY IF EXISTS is a no-op and the CREATE POLICY would fail (table doesn't exist).
- **Dependents / consumers:** Any CI/CD pipeline or developer workflow that tries to apply Android migrations in isolation. The Android repo's `supabase/config.toml` (if it exists) doesn't reference the desktop chain.
- **Alternative implementations of same operation:** The website repo's `supabase/migrations/` directory contains 4 portal-patch migrations (0025-0028) that the desktop's 0043 migration re-bundles into the canonical chain. The website's migrations are also a partial copy BUT they were explicitly designed as portal-specific patches (per the 0043 migration comment "The website repo's own 0025-0028 files remain the portal's local copies; they are idempotent and collapse to no-ops when applied after this migration"). The Android's migrations are NOT designed as patches — they're full migrations that ALTER canonical tables.
- **Behavioral differences:** Desktop chain: 44 migrations, applicable to a fresh DB. Website chain: 4 patches, applicable only after desktop chain. Android chain: 6 migrations, applicable only after desktop chain — but NOT designed as patches (they include DROP POLICY/CREATE POLICY statements that assume the canonical policies already exist).
- **Git evidence:** All 6 Android migrations copied in `b25e6ca mid` (2026-08-04). CROSS-003 (2-b) already documented the partial-copy issue. ACAD-104 extends to academic tables: migration 0041 alone touches `attendance_records`, `homework`, `assessments`, `grades`, `class_subjects`, `account_adjustments`, `payment_allocations` — every one of which requires a desktop base migration.
- **Likely root cause:** The Android developer copied the desktop's late-chain migrations (0034-0042) into the Android repo to make the Android's `supabase/` directory self-documenting for the sync RPCs the Android depends on. They didn't include the base schema because the Android is never the canonical DB provisioner — the desktop chain is.
- **Potential impact:** A new developer onboarding to the Android repo and trying to run a local Supabase for testing would fail. The Android's migrations are documentation-only; they don't form a usable chain. EXTENDS CROSS-003 (which already documented this in general) by tracing the specific academic tables affected.
- **Code snippet:**
```sql
-- Android's 0041_canonical_academic_flow.sql:38-90 — ALTERs tables that don't exist in Android's chain
ALTER TABLE public.assessments
    ALTER COLUMN class_subject_id DROP NOT NULL;  -- ← table created in desktop 0004
ALTER TABLE public.assessments
    ALTER COLUMN kind DROP NOT NULL;

-- Migration 0041:163-164 — creates canonical unique index on attendance_records
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_canonical
    ON public.attendance_records (tenant_id, student_id, record_date, session);
--   ↑ table created in desktop 0004, columns added in desktop 0029

-- Migration 0041:207-224 — drops and recreates homework RLS policies
DROP POLICY IF EXISTS rls_homework_tenant ON public.homework;
--   ↑ policy created in desktop 0029 line 200-202
CREATE POLICY homework_canonical_select ON public.homework
    FOR SELECT TO authenticated
    USING (tenant_id = public.current_tenant_id());
--   ↑ table created in desktop 0029 line 95-111
```
- **Confidence:** Confirmed — EXTENDS CROSS-003 (2-b) which already documented the Android repo's `supabase/migrations/` is a partial copy missing the base schema. ACAD-104 traces the specific academic-table dependencies in migration 0041.

### FINDING GRADE-101 — Bulletin PDF "Présences" KPI shows raw `present` count, not canonical `(present + late) / total` rate

- **What:** The website's bulletin PDF generator (`bulletin.ts:153-158`) computes 4 separate attendance counts: `present`, `excused`, `unexcused`, `late`. The KPI card labeled "Présences" (line 224) shows `${att.present}` ONLY — the count of students with status `present` (on-time arrivals), NOT the canonical attendance rate `(present + late) / total` that `portal-derive.ts:287-294` defines. A student with 18 present + 2 late + 0 absent (out of 20 days) sees "Présences: 18" on the bulletin — but their canonical attendance rate is 100%. The bulletin has no rate KPI at all, only raw counts.
- **Where:**
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/bulletin.ts:153-158` (4 separate counts, no rate)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/bulletin.ts:222-237` (KPI card shows `att.present` only)
  - `/home/z/my-project/repos/elimtiyaz-website/src/lib/canonical/portal-derive.ts:287-294` (canonical rate — not used by bulletin)
- **How reached:** Parent opens bulletin → `printBulletin(data)` → `renderBulletinHtml(data)` → computes `att = { present, excused, unexcused, late }` → renders KPI cards: "Présences" (att.present), "Absences justifiées" (att.excused), "Absences non justifiées" (att.unexcused), "Retards" (att.late). No rate KPI. The canonical `attendanceRatePercent` function (per `portal-derive.ts:199-213`) is not imported or called.
- **Intended responsibility:** Display the canonical attendance rate (per `portal-derive.ts`).
- **Actual responsibility:** Displays raw counts. The "Présences" KPI systematically understates attendance for students with late arrivals.
- **Dependents / consumers:** The bulletin PDF is what parents print and what schools file as the official record. The understated "Présences" count is what parents see.
- **Alternative implementations of same operation:** The website's `attendance-view.tsx` (per WEAK-019) computes a rate (wrong, but at least attempts one). The bulletin doesn't even attempt a rate. The desktop's `academic-tab.tsx:293-294` uses the canonical `calculateAttendanceRate` function. The bulletin is the only consumer that doesn't compute a rate at all.
- **Behavioral differences:** Bulletin: raw counts only. Other views: rate (canonical or wrong). The bulletin's "Présences" card is ambiguous — parents might interpret it as "rate" (18/20 = 90%) or as "count" (18 days). The label doesn't disambiguate.
- **Git evidence:** `bulletin.ts` committed in `b25e6ca mid` (2026-08-04). The canonical `attendanceRatePercent` function exists in `portal-derive.ts` (same commit) but the bulletin doesn't import it.
- **Likely root cause:** The author of `bulletin.ts` chose to display raw counts because they're more informative than a single rate (you see the breakdown of excused/unexcused/late). But the "Présences" KPI label is misleading — it suggests a rate when it's actually a raw count.
- **Potential impact:** Parents who see "Présences: 18" on the bulletin might think their child has 90% attendance when they actually have 100% canonical (18 present + 2 late = 20 attended). The bulletin is the official record — schools and parents make decisions based on it. The understated count is misleading.
- **Code snippet:**
```typescript
// bulletin.ts:153-158 — 4 separate counts, no rate
const att = {
  present: attendance.filter((a) => a.status === "present").length,
  excused: attendance.filter((a) => a.status === "absent_excused").length,
  unexcused: attendance.filter((a) => a.status === "absent_unexcused").length,
  late: attendance.filter((a) => a.status === "late").length,
};

// bulletin.ts:222-237 — KPI cards show raw counts
<div class="card">
  <div class="label">Présences</div>
  <div class="value" style="color:#3FA66E;">${att.present}</div>
  <!--                           ↑ raw count, NOT canonical rate -->
</div>
<div class="card">
  <div class="label">Absences justifiées</div>
  <div class="value" style="color:#C8A98C;">${att.excused}</div>
</div>
<!-- ... -->

// portal-derive.ts:199-213 — canonical rate function (NOT imported by bulletin)
export function attendanceRatePercent(
  records: readonly { status: AttendanceStatus | string }[],
): number {
  // ... maps records and computes (present + late) / total * 100 ...
}
```
- **Confidence:** Likely — the bulletin does display raw counts (confirmed), and the canonical rate function exists but is not imported (confirmed). The "misleading" interpretation depends on how parents actually read the KPI.

### FINDING SCHED-101 — `detectTimetableConflict` checks teacher/class overlaps but NOT room conflicts (different teachers, different classes, same room, same time)

- **What:** The `detectTimetableConflict` function (`validation.ts:283-313`) filters existing entries by: `if (e.teacherId !== teacherId && e.classId !== classId) return false;` (line 299). This means it only flags a conflict if EITHER the teacher OR the class matches. Two DIFFERENT teachers in TWO DIFFERENT classes assigned to the SAME PHYSICAL ROOM at overlapping times would NOT trigger a conflict — both entries pass validation and are persisted. The school would discover the room double-booking only when both teachers show up at the room at the same time.
- **Where:**
  - `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/domain/calc/teacher/validation.ts:283-313` (conflict detection logic)
  - `/home/z/my-project/repos/AgentGithubUplaad/elimtiyaz-desktop/src/infrastructure/mock/repositories/teacher-repository.ts:381-385` (caller — `MockTeacherRepository.createTimetableEntry`)
- **How reached:** (Theoretical — the mock timetable is never persisted in Supabase mode per SCHED-100, so the conflict detection only fires in mock mode.) Mock mode: user creates Timetable Entry 1: Teacher A, Class X, Room R, Monday 9:00-10:00 → conflict check passes (no existing entries match teacher A or class X) → entry persisted. User creates Timetable Entry 2: Teacher B, Class Y, Room R, Monday 9:00-10:00 → conflict check: `e.teacherId (A) !== teacherId (B)` AND `e.classId (X) !== classId (Y)` → filter returns false → entry skipped → no conflict detected → entry persisted. Both entries occupy Room R at the same time.
- **Intended responsibility:** Detect all scheduling conflicts: teacher double-booked, class double-booked, AND room double-booked.
- **Actual responsibility:** Detects teacher and class conflicts, misses room conflicts.
- **Dependents / consumers:** `MockTeacherRepository.createTimetableEntry` and `updateTimetableEntry` — both call `detectTimetableConflict` for validation.
- **Alternative implementations of same operation:** None. The conflict detection is only in the mock layer (per SCHED-100, no Supabase implementation).
- **Behavioral differences:** Pre-bug (intended): room conflicts detected. Actual: room conflicts missed. The school discovers the double-booking at the physical room.
- **Git evidence:** `validation.ts` committed in `b25e6ca mid` (2026-08-04). The conflict function was written to filter by teacher OR class — the author likely forgot that room is also a finite resource.
- **Likely root cause:** The author was focused on the teacher's schedule (don't double-book a teacher) and the class's schedule (don't double-book a class). They forgot that a room is also a finite resource that can't host two classes simultaneously.
- **Potential impact:** (Only in mock mode, since the Supabase timetable is unimplemented per SCHED-100.) Schools using the mock would silently double-book rooms. Two teachers arrive at the same room at the same time — confusion, lost class time. The conflict is invisible to the operator until it manifests physically.
- **Code snippet:**
```typescript
// validation.ts:283-313 — conflict detection misses room conflicts
export function detectTimetableConflict(
  input: CreateTimetableEntryInput | TimetableEntry,
  existingEntries: readonly TimetableEntry[],
  excludeId?: string,
): ValidationResult {
  const day = "day" in input ? input.day : (input as TimetableEntry).day;
  const start = "startMinutes" in input ? input.startMinutes : 0;
  const end = "endMinutes" in input ? input.endMinutes : 0;
  const teacherId = "teacherId" in input ? input.teacherId : "";
  const classId = "classId" in input ? input.classId : "";
  const academicYearId = "academicYearId" in input ? input.academicYearId : "";
  // ← room is NOT extracted from input

  const conflicts = existingEntries.filter((e) => {
    if (e.id === excludeId) return false;
    if (e.academicYearId !== academicYearId) return false;
    if (e.day !== day) return false;
    if (e.teacherId !== teacherId && e.classId !== classId) return false;
    //   ↑ ONLY checks teacher OR class; if NEITHER matches, skip.
    //     Two different teachers + two different classes in the SAME ROOM
    //     at the SAME TIME are NOT detected as a conflict.
    return start < e.endMinutes && end > e.startMinutes;
  });
  // ...
}
```
- **Confidence:** Confirmed (in mock mode only — the Supabase timetable is unimplemented per SCHED-100)

Stage Summary:
- Total new findings: 14 (HOMEWORK-100, HOMEWORK-101, ATT-100, ATT-101, SCHED-100, ACAD-100, ACAD-101, HOMEWORK-102, GRADE-100, ATT-102, ACAD-102, ACAD-103, ATT-103, HOMEWORK-103, ACAD-104, GRADE-101, SCHED-101) — actually 17 findings; recount below
- Recount: HOMEWORK-100, HOMEWORK-101, HOMEWORK-102, HOMEWORK-103, ATT-100, ATT-101, ATT-102, ATT-103, SCHED-100, SCHED-101, ACAD-100, ACAD-101, ACAD-102, ACAD-103, ACAD-104, GRADE-100, GRADE-101 = 17 findings
- Severity breakdown:
  - Critical: 5 (HOMEWORK-100 desktop push always fails, HOMEWORK-101 Android push always fails, ATT-100 desktop roll call triple-broken, ATT-101 absence-justification workflow structurally unreachable past `submitted`, SCHED-100 timetable feature structurally unimplemented)
  - High: 6 (ACAD-100 two parallel promotion paths with dead SQL RPC, ACAD-101 non-atomic academic-year rollover, HOMEWORK-102 legacy table dead + realtime wasted, HOMEWORK-103 Android pull doesn't fetch academic tables, ATT-102 narrative-generator attendance rate divergence, ATT-103 Android alertAbsences no threshold)
  - Medium: 6 (GRADE-100 acknowledged_count permanently 0, ACAD-102 no co-teaching support, ACAD-103 mid-term section moves no audit trail, ACAD-104 Android migrations partial-copy extends CROSS-003, GRADE-101 bulletin PDF misleading "Présences" KPI, SCHED-101 timetable conflict detection misses room conflicts)
  - Low: 0
- Top 5 critical findings (one-line each):
  1. **HOMEWORK-100**: Desktop's `SupabaseHomeworkRepository.push()` INSERT omits `tenant_id` — the canonical `homework` table requires `tenant_id UUID NOT NULL` and no trigger backfills it; every homework push from desktop fails with a NOT NULL violation. The desktop also invokes a non-existent `push-homework-notification` Edge Function with `.catch(() => undefined)`.
  2. **HOMEWORK-101**: Android's `LocalHomeworkRepository.push()` generates local ID `"hwk-{uuid}"` which is invalid UUID syntax — `SyncQueueDispatcher.pushHomework` sends this ID verbatim into the `homework.id` UUID column; PostgREST rejects with `invalid input syntax for type uuid`. The local Room write succeeds (so the user thinks it worked) but the server never receives it.
  3. **ATT-100**: Desktop's `recordRollCall` is triple-broken: (a) omits `tenant_id` (NOT NULL), (b) writes to `record_date` instead of legacy `date` column (NOT NULL per 0004, never made nullable), (c) uses `onConflict: "student_id,record_date,session"` (3 cols) but the actual unique index `uq_attendance_canonical` is 4 cols `(tenant_id, student_id, record_date, session)` — every roll call from desktop fails.
  4. **ATT-101**: Absence-justification 4-state workflow (`none` → `submitted` → `accepted`/`rejected`) is structurally unreachable past `submitted`: the website lets parents submit, but NO desktop code reads `justification_status`/`justification_note`/`justification_path`/`justification_reviewed_by`/`justification_reviewed_at` — `mapAttendanceRow` doesn't even map these columns. DONE.md falsely claims "Staff flip submitted→accepted/rejected from the desktop app".
  5. **SCHED-100**: Timetable (Emploi du Temps) feature is structurally unimplemented: domain model + `TeacherRepository` contract + mock implementation + `detectTimetableConflict` validation + UI consumer ("Couverture EDT" KPI in `academic-year-detail-drawer`) all exist, but NO Supabase migration creates a `timetable_entries` table, NO Supabase `TeacherRepository` implementation exists (falls back to mock per `supabase-repositories.ts:138`), and NO UI for creating entries. The KPI is permanently 0% in production.

- Findings that EXTEND or CONTRADICT prior findings (no contradictions found):
- **HOMEWORK-100** extends **WEAK-017** (2-c): WEAK-017 said the typed `Database` interface omits the canonical `homework` table, forcing `as unknown as` casts. HOMEWORK-100 traces the deeper issue: even if the typing were fixed, the runtime INSERT fails because the payload is structurally incomplete (missing `tenant_id`). The two findings are independent — fixing WEAK-017 alone (adding the `homework` table to the typed interface) wouldn't fix HOMEWORK-100 (the runtime NOT NULL violation would still occur).
- **HOMEWORK-102** extends **WEAK-016** (2-c): WEAK-016 said `useHomeworkRealtime` subscribes to the legacy `homework_assignments` table with a wrong filter (`target_class_id` instead of `class_id`). HOMEWORK-102 adds: even if the filter were correct, the legacy table is DEAD (no code writes to it), so the subscription never fires. The two findings are independent — fixing the filter alone wouldn't restore realtime. Combined with HOMEWORK-100 + HOMEWORK-101, the homework feature has THREE compounding bugs: desktop push fails, Android push fails, and even if a push succeeded, the realtime subscription on the dead table would never deliver the event.
- **ATT-101** extends **DRIFT-010** (2-c): DRIFT-010 said `attendance-view.tsx`'s comment claims "the portal CANNOT submit justifications — that's a desktop workflow" while the code does submit. ATT-101 inverts DRIFT-010: the portal CAN submit, but the desktop workflow that's supposed to review doesn't exist either. The absence-justification feature is non-functional end-to-end: the portal can submit but the desktop can't review, so the 4-state workflow is permanently stuck at 2 reachable states.
- **ATT-102** extends **WEAK-019** (2-c): WEAK-019 said `attendance-view.tsx` (website) computes attendance rate as `present / total` (excludes late), diverging from the canonical `(present + late) / total`. ATT-102 documents that the same wrong formula exists in the DESKTOP's `narrative-generator-modal.tsx:141-143` — the bug is duplicated across platforms AND across files within the same platform. The wrong rate is then sent to the AI narrative generator and persisted in `student_academic_histories.narrative` (the student's permanent academic record). The canonical function `calculateAttendanceRate` exists in `academic.ts:279` and is correctly used by `academic-tab.tsx:293-294` — divergence WITHIN THE SAME APP.
- **ACAD-104** extends **CROSS-003** (2-b): CROSS-003 documented that the Android repo's `supabase/migrations/` is a partial copy missing the base schema. ACAD-104 traces the specific academic-table dependencies in migration 0041 (the only Android-side academic migration): it ALTERs `attendance_records`, `assessments`, `homework`, `class_subjects` — every one of which requires the desktop base migrations 0004 + 0029 to have run first. The Android's migrations are documentation-only; they don't form a usable chain.
- **HOMEWORK-103** extends **SYNC-100** (3-C): SYNC-100 said the desktop's `defaultPushHandler` silently drops `homework`/`attendance`/`grade` entity kinds (the `default` case in the switch). HOMEWORK-103 documents the symmetric issue on the Android side: `PullSyncRepository.pullAll` doesn't pull `homework`/`attendance`/`assessments` — so even when the Android's push works (when HOMEWORK-101 is fixed), the Android never sees academic data created on other platforms. Combined with SYNC-100, the academic sync is broken in BOTH directions: desktop doesn't push (per SYNC-100) AND Android doesn't pull (per HOMEWORK-103). The website (which reads directly from Supabase, no pull needed) is the only platform that sees everything.

No contradictions found.
