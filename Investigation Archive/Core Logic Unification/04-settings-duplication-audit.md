# Settings Duplication Audit — Session 2 (2026-11-19)

Scope: "settings logic, heavily duplicated in both the UI and the underlying code" — `features/settings/` (39 files) + every settings-shaped surface outside it. Read-only sweep.

## 1. The real settings estate (19 surfaces, 6 persistence backends)

The Settings hub renders **14 tabs** (settings-page.tsx:75-78, 126-139): general, pricing, audit, rbac, approvals, accounts, config, diagnostics, crud, sync, ai, backup, locked, experimental. But settings-shaped state lives in far more places:

| Surface | File(s) | Persistence backend |
|---|---|---|
| User prefs (theme/locale/timezone/currency) | `general-tab.tsx` (345L) + `theme-editor-modal.tsx` + `user-preferences-provider` | localStorage (provider) |
| Custom themes | `theme-editor-modal.tsx` + core/theme | localStorage via provider |
| Danger zone | `danger-zone-card.tsx` | purge RPCs |
| Pricing (7 cards) | `pricing-tab.tsx` + `pricing/*.tsx` (7 cards + config bar) | `pricing_configs` / `grade_level_tuition` tables |
| Audit log | `audit-log-tab.tsx` | `audit_logs` (read-only) |
| RBAC matrix | `rbac-matrix-editor.tsx` | **localStorage ONLY** (`el-imtiyaz:rbac-overrides` — BUG-017; DB table `tenant_role_overrides` exists but unwired) |
| Approvals | `approvals-tab.tsx` | approvals repo |
| Accounts | `accounts-tab.tsx` + `create-account-modal.tsx` | auth/admin surfaces |
| System config | `configuration-tab.tsx` (332L) + `configuration/*` (6 files) | `system_settings` table + local config file |
| Diagnostics | `supabase-diagnostics/*` (7 files) | none (probes) |
| CRUD tests | `crud-test-tab.tsx` + runner | none (probes) |
| Sync | `sync-tab.tsx` + `conflict-resolver-modal.tsx` | sync queue |
| AI config | `ai-config-tab.tsx` | `ai_provider_configs` (mock in live mode — ARCH-006 slot) |
| Backup | `backup-tab.tsx` + `export-dialog.tsx` | vault + backups repo |
| Locked features | `locked-features-tab.tsx` | feature-registry (code) — read-only view |
| Experimental flags | `experimental-tab.tsx` + `infrastructure/experimental/experimental-flags.ts` | local flag |
| **Contextual thresholds (dashboard-hosted)** | `contextual-thresholds-config.tsx` (lives in features/settings, mounted by dashboard-page) | `system_settings` (debt thresholds) |
| Dashboard layout | `dashboard-layout-storage.ts` + `dashboardLayouts` repo | table 0134 / localStorage |
| Seed secrets (Excel/etc.) | `configuration/secret-edit-modal.tsx` | system_settings |

**Six persistence backends** for "settings": user-preferences provider, system_settings table, pricing_configs tables, ai_provider_configs, localStorage-only (RBAC overrides), local experimental flags + the dashboards layout store. There is no single settings-service contract; each tab wires its own service (`getSystemConfigService`, `getLocalConfigService`, repos, providers) with its own load/save/toast ceremony.

## 2. The duplication patterns (UI + code)

### 2.1 Per-tab ceremony (verified across tabs)

Every tab re-implements: `useState(settings) + useState(isLoading)` → effect loads (service or repo) → `result.ok` guard → toast error path → save handler → success toast → reload. Compare `configuration-tab.tsx:43-83` with `pricing-tab`'s card loads, `ai-config-tab`'s load, `backup-tab`'s listing, `accounts-tab`'s fetch. The iteration-20 refactor extracted `SettingsCard`/`setting-row`/`category-cards` + `buildCardCallbacks` — but ONLY for the Configuration tab; the other 13 tabs do not use them.

### 2.2 Card scaffolding

`Card > CardHeader(icon + title + description + action Button) > CardContent` is hand-assembled per tab (general-tab:105-124, pricing cards, backup-tab, sync-tab, ai-config-tab…). A `SettingsSection` primitive (icon/title/description/action slot) does not exist; `settings-card.tsx` is configuration-tab-local.

### 2.3 Gating duplication (four vocabularies)

1. Tab-level `disabled` props in settings-page (only pricing + audit — ARCH-012 gap).
2. Per-tab internal guards (`configuration-tab.tsx:86-88` AccessDeniedCard; audit tab internal).
3. `canEditThresholds(session)` in contextual-thresholds-config (its own role check).
4. feature-registry `evaluate`/`can()` dual idioms (S1 DUP-017) + locked-features-tab rendering the registry.
Plus `AccessDeniedCard` itself is exported from `audit-log-tab.tsx` and imported by configuration-tab (component placement violation).

### 2.4 Deep-link bug class (BUG-031 — new)

`settings-page.tsx:101-106` reads `?tab=` ONLY in the `useState` initializer. The topbar quick-backup navigates to `/settings?tab=backup` — if the user is already on `/settings`, the tab will NOT switch (same-page searchParams change). Identical class as S1 BUG-026 (class-detail). Dashboard-page does it correctly via mount-time effect (dashboard-page.tsx:135-154). Fix: the same effect idiom in settings-page.

### 2.5 Modal-per-tab ceremony

Each tab owns its edit modal(s): theme-editor, secret-edit, create-account, conflict-resolver, export-dialog — all correctly built on UnifiedModal/AutoFormModal (verified imports), but each re-wires open/close state + save + toast by hand. AutoFormModal already solves the form half; the missing shared piece is the "open editor for row X" state idiom (a tiny `useEditModal<T>()` hook would cover all five).

## 3. Unification plan

1. **SET-U1 (S):** promote `SettingsCard`/`SettingRow` from `configuration/` to `shared/settings/` (or `features/settings/shared/`); adopt in general/pricing/backup/sync/ai/accounts tabs. Pure presentational adoption — no persistence changes.
2. **SET-U2 (S):** `useSettingsSection<T>(loader, saver)` hook encapsulating load/loading/save/toast/reload; adopt per tab (kills §2.1 ceremony).
3. **SET-U3 (M):** one gating pass — per-tab `PageTab disabled` computed from feature-registry nodes (ARCH-012 resolution + collapses §2.3 vocabularies to the registry one); relocate `AccessDeniedCard` to shared.
4. **SET-U4 (XS):** BUG-031 fix (settings ?tab= effect).
5. **SET-U5 (M, decision-gated):** RBAC matrix persistence completion to `tenant_role_overrides` (BUG-017 — already roadmap 4.7) — the one settings backend that is a live defect rather than duplication.
6. **SET-U6 (S, later):** `useEditModal` idiom across the five tab modals.
7. **Document (ADR):** the settings-backend map (§1 table) — six backends is acceptable IF intentional per-domain (prefs=local, system=tenant DB, pricing/AI=domain tables); make it explicit so future tabs choose consciously.

## 4. Migration impact

- SET-U1/U2: mechanical, tab-by-tab T-tasks; zero behavior change; existing tab tests (t-4xx settings suites) verify.
- SET-U3: touches settings-page + each tab's guard; RBAC suites cover.
- SET-U4: 1 file.
- SET-U5: DB write path (needs migration ceremony per §11.1; already registered).
- No cross-section impact: settings is self-contained (the only external consumer of its state is the dashboard thresholds host, which keeps its contract).
