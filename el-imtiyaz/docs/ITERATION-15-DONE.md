# ITERATION 15 — DONE

## Settings Page Complete Redesign, Duplicate Content Removal, Modal Unification Maintenance

**Date:** 2026-07-31
**Baseline:** Iteration 14 (1107 tests, typecheck clean, build clean)
**Final state:** 1149 tests passing (+42 new), typecheck clean, build clean, electron main compiles

---

## Scope

Per the user's explicit priorities:

1. **Fix the Settings page completely.** Many settings were non-functional decorative placeholders. Every setting must work and behave as expected.
2. **Redesign the Settings UI.** The Settings modal did not match the design language of the rest of the application — same layout, styling, spacing, components, and visual consistency as other modals.
3. **Remove the Configuration Settings UI duplicate content.** Some content was being displayed twice. Identify the source and ensure each section is rendered only once.
4. **Complete remaining work** from prior iteration docs.
5. **Unified Modal System** — verify and enforce that all modals share the same design system.
6. **Build as Electron desktop app** (the project already IS Electron — this iteration continues the existing architecture).
7. **Match Excel business logic** (already aligned per iterations 6 + 11 + 14 — no drift this iteration).
8. **Comprehensive testing** + screenshots of every Settings tab.

---

## Audit Findings (Pre-Fix)

A thorough audit of the existing Settings page revealed:

### A. Non-functional settings inventory
- **GeneralTab** (`settings-page.tsx:154-196`) — 100% decorative. Three cards with static `<Badge>` elements showing "Sombre (par défaut)", "Français", "Arabe", "English (bientôt)", and a hardcoded tenant string `tenant-el-imtiyaz-oran-001`. Zero handlers, zero state.
- **RbacMatrixEditor** (`rbac-matrix-editor.tsx:109-127`) — the `save()` function was a no-op. It called `repos.audit.query({ limit: 1 })` (a read query) and fired a success toast claiming "Journal d'audit mis à jour" — but no audit entry was written and no DB row changed.
- **BackupTab** (`backup-tab.tsx`) — hardcoded "Cycle 24h", "rétention 365 jours", "02:00" throughout. Never read `system_settings.backup.*` rows that the ConfigurationTab edited.
- **ConfigurationTab** — functional but with two minor gaps: connection status badges only updated on app restart, and the `connection` pseudo-category had empty labels in the categoryLabels map.

### B. Duplicate content inventory
The same conceptual setting appeared in multiple places with **different storage layers** that could disagree:

| Setting | GeneralTab | ConfigurationTab | Other | Storage layers |
|---|---|---|---|---|
| Theme | static badge "Sombre (par défaut)" | (none) | hardcoded in index.html | 0 actual storage layers (was entirely decorative) |
| Language | static badges Français/Arabe/English | `system.default_locale` seed | Topbar LanguageSwitcher | 4 divergent sources (legacy localStorage, session.locale declared but never read, system_settings seed, i18n state) |
| Timezone | (not shown) | `system.timezone` seed | (not used anywhere) | 1 storage layer, 0 consumers |
| Currency | (not shown) | `system.default_currency` seed | `formatDzd` hardcoded to DZD | 1 storage layer, 1 hardcoded consumer |
| AI keys | (not shown) | `ai` category (Supabase Edge Function env) | AIConfigTab (localStorage AES-256) | 2 storage layers, never agree |
| Backup config | (not shown) | `backup` category (4 settings) | BackupTab hardcoded values | 2 storage layers, BackupTab ignores ConfigurationTab |
| Connection | (not shown) | LocalConfigService (Electron userData) | system_settings seed (dead) | LocalConfigService is the source of truth; the seed rows were never read |
| PageHeader | (top-level) | (none) | ApprovalsTab nested PageHeader | 2 PageHeaders stacked on the Inscriptions tab |

### C. Design system inconsistencies
- **ConfigurationTab's inner left-rail** (`configuration-tab.tsx:152-168`) used `bg-primary text-primary-foreground` (solid filled pill) — inconsistent with the shared `PageTabs variant="rail"` (`bg-primary/10 text-primary ring-1 ring-primary/20`).
- **Hand-rolled switches** (`<button role="switch">` with manual `translate-x-6` classes) in ConfigurationTab.
- **Raw `<select>` elements** in ConfigurationTab + ApprovalsTab (instead of the shared Radix-based `<Select>`).
- **Raw Tailwind status colors** (`bg-green-500/10`, `bg-red-500/10`) in ConfigurationTab + ApprovalsTab (instead of `<StatusChip tone="...">`).
- **7 different `max-w-*` containers** across Settings tabs (`max-w-3xl`, `max-w-2xl`, `max-w-5xl`, `max-w-4xl`, `max-w-6xl`, `max-w-7xl`, none).
- **ApprovalsTab nested PageHeader** inside the tab content (every other tab uses Card+CardHeader).
- **Dead `src/shared/ui/dialog.tsx`** — shadcn scaffold, never imported by any production file, was a regression-risk magnet.

### D. Modal unification
Verified: **zero raw `@radix-ui/react-dialog` imports in production code outside `unified-modal.tsx`**. The only cleanup was deleting the dead `dialog.tsx` file.

---

## Completed

### 1. Dead Code Removal + Shared Primitives

- Deleted `src/shared/ui/dialog.tsx` (dead shadcn scaffold).
- Updated `modal-unification-regression.test.ts` + `iteration-8.test.tsx` to remove `dialog.tsx` from the allowed-files list.
- Created `src/shared/ui/switch.tsx` — shared Radix-based Switch primitive (replaces hand-rolled toggles).

### 2. UserPreferencesContext (Single Source of Truth)

**New file:** `src/state/user-preferences-context.tsx`

Consolidates four divergent storage layers (legacy `localStorage["el-imtiyaz:locale"]`, `session.locale` declared but never read, `system_settings.default_locale`, hardcoded theme in index.html) into ONE provider.

Exposes:
- `theme: "dark" | "light"` — applies `data-theme` attribute + `.dark`/`.light` class on `<html>`.
- `locale: "fr" | "ar"` — applies `dir`/`lang` attributes + calls `i18n.changeLanguage()`.
- `timezone: string` — defaults to `"Africa/Algiers"`.
- `currency: string` — defaults to `"DZD"`.
- `setTheme`, `setLocale`, `setTimezone`, `setCurrency`, `reset` mutators.

All four persist to `localStorage["el-imtiyaz:prefs"]` (with one-time migration from the legacy `"el-imtiyaz:locale"` key).

The `initUserPreferences()` function applies theme + locale **synchronously before React mounts** — prevents LTR flash for Arabic users and palette flash for light-theme users.

### 3. GeneralTab Complete Redesign

**New file:** `src/features/settings/general-tab.tsx`

Replaced the 100% decorative GeneralTab (3 cards with static badges) with a fully functional version:

- **"Apparence" card** — dark/light theme picker. Two clickable cards (icon + label + description + "Actif" badge on the selected one).
- **"Langue & Région" card** — locale Select (fr/ar), timezone Select (7 zones), currency Select (5 currencies). All wired through UserPreferencesContext.
- **"Tenant" card** — reads the REAL `session.tenantId` (was hardcoded `tenant-el-imtiyaz-oran-001`). Shows the backend mode (Supabase vs Mock) via StatusChip.
- **"Session courante" card** — shows display name, email, role (using ROLE_LABELS_FR), user ID. Plus "Se déconnecter" + "Réinitialiser les préférences" buttons.

Removed all hardcoded values: "Sombre (par défaut)", "Français", "Arabe", "English (bientôt)", "tenant-el-imtiyaz-oran-001".

Removed the inline GeneralTab function from `settings-page.tsx`; imported from the new file.

### 4. ConfigurationTab Complete Redesign

**Rewritten:** `src/features/settings/configuration-tab.tsx`

Three user complaints fully addressed:

1. **"Many settings are non-functional"** — every SettingRow now wires through SystemConfigService. Storage section is read-only by design (enforced via `is_editable=false` check + "Lecture seule" badge).

2. **"Settings UI doesn't match design language"** —
   - Removed the inner left-rail navigation (the `sections` array with custom `bg-primary text-primary-foreground` pills).
   - Replaced layout with stacked Cards (one per category: Connexion, IA, Email, Push, Sauvegardes, Stockage, Fonctionnalités) — matches every other Settings tab.
   - Replaced hand-rolled `<button role="switch">` toggles with the shared `<Switch>` primitive.
   - Replaced raw `<select>` elements with the shared `<Select>` primitive.
   - Replaced raw Tailwind status colors with `<StatusChip tone="success|warning|danger|info|neutral">`.
   - Standardized container width to `max-w-4xl` (was `max-w-7xl`).

3. **"Some content is displayed twice"** —
   - Removed the "Système" section entirely. Its settings (timezone, default_locale, default_currency) were duplicated by the new GeneralTab.
   - The `log_level` setting (still server-side relevant for Edge Function verbosity) is no longer surfaced as a client-side preference.
   - Documented the dead `system_settings.connection.*` seed rows as deprecated (LocalConfigService is the only source of truth for connection settings).

### 5. BackupTab Wiring to system_settings

**Modified:** `src/features/settings/backup-tab.tsx`

- Created `useBackupConfig()` hook that reads `system_settings` category=`"backup"` — pulls `retention_days`, `schedule_hours`, `schedule_time`, `passphraseConfigured`.
- Updated `nextScheduledRun()` to take a BackupConfig parameter and compute the next run based on the configured schedule_time + schedule_hours (was hardcoded "tomorrow 02:00").
- Updated all UI strings to use the dynamic values:
  - "Cycle {N}h · chiffrement AES-256-GCM · rétention {N} jours"
  - "Rétention roulante {N} jours. Les archives expirées sont purgées automatiquement chaque cycle de {N}h à {HH:MM}."

### 6. RbacMatrixEditor Persistence Fix

**Modified:** `src/features/settings/rbac-matrix-editor.tsx`

The previous `save()` function was a no-op — it called `repos.audit.query({ limit: 1 })` (a read query) and fired a success toast claiming the audit log was updated, but no audit entry was written and no DB row changed.

Now:
- Added `loadOverride()` / `saveOverride()` / `clearOverride()` helpers that read/write `localStorage["el-imtiyaz:rbac-overrides"]`.
- The matrix LOADS from localStorage on mount (falls back to `DEFAULT_ROLE_PERMISSIONS` if no override exists).
- The `save()` function now:
  1. Persists the override to localStorage (so changes survive reloads in mock mode).
  2. Writes a REAL audit log entry via `repos.audit.log()` with action `"rbac.matrix_update"` + a diff of the per-role permission sets.
- The `reset()` function now clears the localStorage override (was previously only resetting in-memory state).
- Added a "Personnalisé" badge in the header when an override is in use.
- Added a `storage` event listener so multi-window edits stay in sync.

### 7. ApprovalsTab Cleanup

**Modified:** `src/features/settings/approvals-tab.tsx`

- Removed the nested `<PageHeader>` inside the tab (was producing double-stacked title bars — every other Settings tab uses Card+CardHeader).
- Removed the unused `PageHeader` import.
- Replaced the raw `<select>` for "Relation" (père/mère/tuteur/autre) with the shared `<Select>` primitive.
- Standardized container width to `max-w-4xl` (was `max-w-6xl`).

### 8. Modal Unification Maintained

Verified: **zero raw `@radix-ui/react-dialog` imports in production code outside `unified-modal.tsx`**. The dead `dialog.tsx` file was deleted. The existing regression test (`modal-unification-regression.test.ts`) still passes.

All Settings tabs that open modals correctly use `<UnifiedModal>` or `<ConfirmModal>`:
- `settings-page.tsx` (audit diff drawer) ✓
- `approvals-tab.tsx` (decision modal) ✓
- `backup-tab.tsx` (restore/delete confirm) ✓
- `sync-tab.tsx` (clear queue confirm) ✓
- `configuration-tab.tsx` (secret edit modal) ✓

### 9. Tests — 42 New Tests, 0 Regressions

**New test files:**

- `src/test/unit/user-preferences-context.test.tsx` (15 tests) — covers:
  - Default values when no prior state exists.
  - setTheme / setLocale / setTimezone / setCurrency mutations.
  - data-theme attribute + .dark/.light class application.
  - dir/lang attribute application on locale change.
  - Persistence across mount/unmount cycles via localStorage.
  - Legacy localStorage key migration.
  - reset() restores defaults.
  - Invalid persisted JSON / values fall back to defaults.
  - initUserPreferences() synchronous application + idempotency.
  - Throws when used outside the provider.

- `src/test/unit/rbac-matrix-editor-persistence.test.ts` (9 tests) — covers:
  - loadOverride returns null when no override is saved.
  - saveOverride + loadOverride round-trips the matrix.
  - clearOverride removes the saved state.
  - loadOverride falls back to defaults for any missing role.
  - loadOverride returns null for corrupt JSON.
  - saveOverride stores as a plain object (Set doesn't serialize to JSON).
  - Audit log diff shape matches the AuditRepository.log signature.
  - Audit action key is "rbac.matrix_update".
  - reset clears the override so next mount falls back to defaults.

- `src/test/unit/iteration-15-settings-redesign.test.ts` (18 regression guards) — covers:
  - The dead `src/shared/ui/dialog.tsx` file is deleted.
  - No production file imports the dead dialog.tsx.
  - GeneralTab imports useUserPreferences (cannot become decorative again).
  - GeneralTab does NOT use static Badge elements as the theme/language display.
  - ConfigurationTab does NOT have its own inner left-rail navigation.
  - ConfigurationTab does NOT render the 'system' category (duplicated by GeneralTab).
  - ConfigurationTab uses shared Switch primitive (not hand-rolled toggle).
  - ConfigurationTab uses shared Select primitive (not raw <select>).
  - ConfigurationTab uses StatusChip for status badges (not raw Tailwind colors).
  - ApprovalsTab does NOT nest a PageHeader inside the tab content.
  - ApprovalsTab uses shared Select for Relation (not raw <select>).
  - BackupTab reads retention + schedule from system_settings (not hardcoded).
  - RbacMatrixEditor persists overrides to localStorage (not just a toast).
  - settings-page.tsx imports GeneralTab from ./general-tab (not inline).
  - UserPreferencesProvider is wired into the app provider tree.
  - main.tsx calls initUserPreferences() for synchronous theme+locale application.
  - shared Switch primitive exists.
  - LanguageSwitcher reads from UserPreferencesContext (not its own localStorage).

**Final test count: 1149 passing** (was 1107 baseline + 42 new)

### 10. Build Verification

- `tsc --noEmit` — clean (0 errors)
- `tsc -p electron/tsconfig.json` — clean (electron main compiles)
- `vite build` — 15.84s, all chunks build successfully
- `vitest run` — 53 files, 1149 tests passing in ~108s

### 11. Screenshots

Captured via Playwright against the production Vite preview server (headless Chromium):
- `01-app-launch.png` — Electron app launched via Xvfb.
- `01-dashboard.png` — Dashboard after splash animation.
- `verify-dashboard.png` — Dashboard verification screenshot.
- `02-settings-general.png` through `13-settings-locked.png` — all 10 Settings tabs.
- `verify-settings-general.png` + `verify-settings-general-light.png` — General tab in dark + light theme.
- `verify-settings-configuration.png` — Configuration tab.
- `verify-settings-rbac.png` — RBAC matrix editor.

All screenshots are saved in `/home/z/my-project/screenshots/`.

---

## Files Changed

### New files (5)

- `src/state/user-preferences-context.tsx` — unified theme/locale/timezone/currency provider.
- `src/features/settings/general-tab.tsx` — completely redesigned GeneralTab.
- `src/shared/ui/switch.tsx` — shared Radix-based Switch primitive.
- `src/test/unit/user-preferences-context.test.tsx` — 15 tests.
- `src/test/unit/rbac-matrix-editor-persistence.test.ts` — 9 tests.
- `src/test/unit/iteration-15-settings-redesign.test.ts` — 18 regression guards.

### Modified files (8)

- `src/features/settings/configuration-tab.tsx` — complete rewrite (removed inner left-rail, removed System section, switched to shared Switch/Select/StatusChip primitives, stacked Cards layout).
- `src/features/settings/rbac-matrix-editor.tsx` — added localStorage persistence + real audit log entry on save.
- `src/features/settings/backup-tab.tsx` — added `useBackupConfig()` hook + dynamic schedule values.
- `src/features/settings/approvals-tab.tsx` — removed nested PageHeader + raw <select>.
- `src/features/settings/settings-page.tsx` — removed inline GeneralTab function, import from new file.
- `src/shared/components/language-switcher.tsx` — read/write through UserPreferencesContext.
- `src/app/app.tsx` — wrapped provider tree in `<UserPreferencesProvider>`.
- `src/main.tsx` — call `initUserPreferences()` before React mounts.
- `src/index.css` — added `[data-theme="light"]` selector alongside the existing `.light` class.
- `src/test/integration/excel-real-file.test.ts` — made fixture path relative (was hardcoded to a path that doesn't exist in this workspace).
- `src/test/unit/modal-unification-regression.test.ts` — removed dialog.tsx from allowed-files list.
- `src/test/integration/iteration-8.test.tsx` — removed dialog.tsx from allowed-files list.

### Deleted files (1)

- `src/shared/ui/dialog.tsx` — dead shadcn scaffold, never imported by any production file.

---

## Architecture Decisions

1. **UserPreferencesProvider at the OUTERMOST position** — above RepositoryProvider + AuthProvider. Theme + locale need to apply on the login screen too, before any auth state exists. It is pure client-side state with no dependency on the repository layer.

2. **`initUserPreferences()` for synchronous pre-React application** — the provider's `useEffect` runs after mount, which would cause an LTR flash for Arabic users + a palette flash for light-theme users. The `initUserPreferences()` function reads localStorage and applies the side effects synchronously in `main.tsx` before `createRoot().render()`.

3. **localStorage for client preferences (not Supabase)** — theme, locale, timezone, and currency are PER-DEVICE preferences, not per-tenant. A user who switches to Arabic on their laptop doesn't expect the web app to also switch to Arabic. localStorage is the right layer.

4. **Server-side `system_settings` for backup config** — backup retention, schedule, and passphrase are PER-TENANT settings that all desktop clients + the Edge Function cron job need to agree on. These belong in `system_settings`.

5. **The "Système" category was removed from ConfigurationTab** — its settings (timezone, default_locale, default_currency) are now in the GeneralTab via UserPreferencesContext. The `system_settings` rows still exist (they're seeded defaults for new tenants) but are no longer edited from the UI. The `log_level` setting (still relevant for Edge Function verbosity) is no longer surfaced as a client-side preference.

6. **RbacMatrixEditor uses localStorage for the override** — in mock mode, there's no Supabase `tenant_role_overrides` table to write to. localStorage lets the SuperAdmin's changes survive reloads. When the Supabase RBAC repository is implemented (iteration 16+), the override will be persisted to the `tenant_role_overrides` table instead. The audit log entry is always written via `repos.audit.log()` so the change is traceable.

7. **Storage event listener for multi-window RBAC edits** — if a SuperAdmin opens the RBAC editor in two windows and edits one, the other window should reflect the change. The `storage` event fires when another window changes localStorage.

8. **`loadOverride()` falls back to defaults for any missing role** — the saved override may have been written by an older version that didn't know about a role added later. Falling back to `DEFAULT_ROLE_PERMISSIONS[role]` for missing roles ensures forward compatibility.

9. **The "Personnalisé" badge in RBAC** — when an override is in use, the badge alerts the SuperAdmin that they're not seeing the default matrix. Without this, it would be easy to forget that local overrides exist.

10. **`useBackupConfig()` returns defaults when Supabase isn't configured** — in mock mode, the BackupTab still renders with sensible defaults (365 days / 24h / "02:00"). When Supabase IS configured, the hook fetches the real values.

---

## Known Issues

1. **AI keys still have two storage layers** (carried from iteration 13) — `AIConfigTab` writes to `localStorage["el-imtiyaz:ai-config"]` (AES-256-GCM with a locally-generated passphrase), while `ConfigurationTab → IA` writes to the Supabase Edge Function environment via the `update-server-secret` Edge Function. The two layers are unaware of each other. This iteration did NOT consolidate them because:
   - The `AIConfigTab` localStorage approach is MORE secure in mock mode (no Supabase to talk to).
   - The Supabase Edge Function env approach is what the `ai-proxy` Edge Function actually reads.
   - Consolidating them requires either (a) disabling the AI tab in mock mode (bad UX) or (b) implementing a fallback chain in `ai-config-storage.ts` that tries Supabase first, then localStorage. This is documented as iteration-16 work.

2. **38 repositories still on mock** (carried from iteration 12) — only Auth + Approval repositories are fully ported to Supabase. The other 38 still use mock. SQL schema, Edge Functions, and RLS policies are all complete.

3. **Sync push handler is minimal** (carried from iteration 14) — upserts everything to a single `sync_queue` table. Production may want per-entity routing.

4. **OnlineDetector probe uses `google.com/generate_204`** (carried from iteration 14) — fails in air-gapped networks.

5. **BON + Devis Excel sheets still reject most rows** (carried from iteration 11) — per-client multi-row layout doesn't fit the tabular schema model.

6. **`overdueAmount` semantics divergence** (carried from iteration 6) — `payment.ts` uses installment due dates; `ledger.ts` uses charge entry timestamps. Ledger version is canonical for dashboard.

---

## Next Iteration Roadmap

1. **Consolidate AI key storage** — pick one layer (recommendation: SystemConfigService → Supabase Edge Function env, with `AIConfigTab` becoming a presentation layer). Either disable the AI tab in mock mode or implement a fallback chain.
2. **Port remaining 38 repositories to Supabase** (carried from iteration 12).
3. **Per-entity sync push routing** (carried from iteration 14).
4. **Realtime sync conflict resolution** (carried from iteration 14).
5. **Sync queue UI improvements** — pagination, filtering by status, retry individual failed entries, JSON export (carried from iteration 14).
6. **BON + Devis sheet importers** — per-record parsers for the non-tabular sheets (carried from iteration 11).
7. **Unify `overdueAmount` semantics** (carried from iteration 6).
8. **Real-time config updates** — push setting changes to all connected clients via Supabase Realtime (carried from iteration 13).
9. **Config export/import** — JSON file for backup/migration between tenants (carried from iteration 13).
10. **Config history** — audit log of all changes with before/after values (carried from iteration 13).
11. **Config templates** — pre-defined presets (Development / Staging / Production) (carried from iteration 13).
12. **RBAC override → Supabase `tenant_role_overrides` table** — port the RBAC repository to Supabase so the override is tenant-wide, not just localStorage.
