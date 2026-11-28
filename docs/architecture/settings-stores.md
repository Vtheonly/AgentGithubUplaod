# Settings Stores — The C-25 Inventory & Boundary Map

> T-588 (ROADMAP 5.19 / EXECUTION-PLAN §4 E6.19). The settings-family
> persistence map: every store, its canonical home, its boundary class, and
> the unification decision. This document is the "boundaries documented"
> deliverable of C-25 — the physical collapse of the remaining device-local
> stores into `system_settings` proceeds as its own task series (see the
> follow-up register at the bottom).

## The boundary rule (the decision)

1. **Tenant-level configuration** lives in the DATABASE — `system_settings`
   (key/value, tenant-scoped, RLS) for general configuration, and the
   purpose-built tables where they exist (`tenant_role_overrides` for the
   RBAC matrix since T-588/migration 0006; `dashboard_layouts` since T-448).
   A value that another clerk on another machine must see belongs here.
2. **Device-local state** (caches, drafts, window-level preferences,
   last-used directories, MRU lists) stays in `localStorage` — but under
   ONE canonical constant per key, defined next to its domain model, never
   a private literal in a second file (the T-581/BUG-050 lesson).
3. **Secrets never enter the tenant-visible settings table.** The backup
   passphrase and the AI passphrase stay device-local (plan §13.02
   production path: a secrets manager, NOT `system_settings` — a secret in
   a table every authenticated tenant member can read is a defect).
4. **Session/persistence media of the MOCK mode** are the device-local
   stores (the mock layer IS the offline operating mode); the Supabase
   repositories own the tenant-level equivalents. Both implementations of
   the same repository seam must agree on ONE domain contract
   (`domain/repository/*`), never on a shared storage key.

## The inventory (empirical — the T-588 scan)

Every `el-imtiyaz:*` localStorage key in the desktop (non-test code),
traced through its constant to its call sites:

| Key | Constant (home) | Class | Boundary verdict |
|---|---|---|---|
| `el-imtiyaz:rbac-overrides` | `RBAC_OVERRIDES_STORAGE_KEY` (`domain/model/rbac.ts`) | MOCK-mode persistence of the RBAC matrix | Tenant-level truth = `tenant_role_overrides` (T-588, migration 0006 RPCs). Device key is the mock medium + the backup snapshot capture point (VAULT §13.01). |
| `el-imtiyaz:prefs` | `STORAGE_KEY` (user-preferences) | Device preference (theme/locale) | Stays device-local (class 2). Candidate for a `system_settings` mirror only if cross-device sync is ever requested. |
| `el-imtiyaz:ai-config` | `AI_CONFIG_STORAGE_KEY` (ai-config-storage) | Tenant-level config (BYOK provider list) | **COLLAPSED (T-627/0007)** — the NON-SECRET half (provider/models/sampling) mirrors to `system_settings` `ai.provider_config` (the `aiConfig` slot's Supabase twin writes BOTH media; `loadConfig()` merges the tenant row over the device cache). The SECRETS (the three API keys) stay device-local — rule 3 — and the encrypted device store doubles as the offline cache. |
| `el-imtiyaz:ai-passphrase` | `AI_PASSPHRASE_STORAGE_KEY` | Secret | Stays device-local — rule 3 (secrets manager in production, never the settings table). |
| `el-imtiyaz:ai-copilot-conversation` | `CONVERSATION_STORAGE_KEY` | Device cache (conversation history) | Stays device-local (class 2). |
| `el-imtiyaz:backup-passphrase` | `BACKUP_PASSPHRASE_KEY` (`domain/model/backup.ts` — the ONE canonical since T-588) | Secret | Stays device-local — rule 3. |
| `el-imtiyaz:backup-scheduler-enabled` | `SCHEDULER_ENABLED_KEY` | Tenant-level config | **COLLAPSED (T-627/0007)** — `system_settings` `backup.scheduler_enabled` is the tenant truth (the daemon reads tenant-first via `readSchedulerEnabledConfig`: tenant row → this device cache → default ON, fail-open); the Backup tab's toggle writes the seam (the super_admin render gate in Supabase mode). |
| `el-imtiyaz:backup-run-log` | `RUN_LOG_KEY` | Device operational log | Stays device-local (class 2). |
| `el-imtiyaz:backup-last-source-dir` / `-destination-dir` | `LAST_SOURCE_KEY` / `LAST_DESTINATION_KEY` (backup-locations) | Device MRU (class 2) | Stays device-local. |
| `el-imtiyaz:custom-themes` | `CUSTOM_THEMES_STORAGE_KEY` | Tenant-level config (branding) | **COLLAPSED (T-627/0007)** — `system_settings` `theme.custom_palettes` is the tenant truth (the `TenantThemeHydrator` hydrates the tenant list over this device cache at session start — tenant wins on id collision, the merged list mirrors back here; super_admin edits/deletes in Supabase mode, every staff member reads/selects). |
| `el-imtiyaz:dashboard-layout:*` | `DASHBOARD_LAYOUT_STORAGE_PREFIX` | Per-user layout | Tenant-level truth already exists: `dashboard_layouts` table + `save_dashboard_layout` RPC (T-448, migration 0134 lineage). The localStorage prefix is the offline cache/fallback — document the fallback rule at the collapse task. |
| `el-imtiyaz:placement-draft:*` | `PLACEMENT_DRAFT_STORAGE_PREFIX` | Working draft (tenant+year scoped) | **Collapse candidate** → `system_settings` keyed draft, or a purpose table if drafts gain concurrency needs. Follow-up task. |
| `el-imtiyaz:recent-searches` | `RECENT_SEARCHES_KEY` | Device MRU | Stays device-local (class 2). |
| `el-imtiyaz:restored-from` | `RESTORED_FROM_KEY` (backup-service) | Device marker (post-restore) | Stays device-local (class 2). |
| `el-imtiyaz:rbac-matrix-overrides` | — | **DEAD (DEAD-018, removed T-588)** | Written by the mock-store restore path, read by nobody. Removal: the restore path writes the canonical `RBAC_OVERRIDES_STORAGE_KEY`. |
| `el-imtiyaz:experimental` / `el-imtiyaz:locale` | (feature-flag / i18n internals) | Device state | Stays device-local (class 2). |

The `config.json` / `local-config` / `session-cache` entries of the
original 8-store list refer to the Electron-side configuration family
(`BackendProfile`, T-573) and the session persistence medium — both
already carry their own canonical homes (the backend profile store and
the auth provider's session serialization) and are not re-inventoried
here.

## What T-588 changed

- **RBAC (BUG-017/SET-U5):** the matrix editor persists through the
  `RbacRepository` seam — `tenant_role_overrides` via migration 0006's
  `read_rbac_effective_matrix` / `save_rbac_matrix` / `reset_rbac_matrix`
  RPCs (deny-wins, super_admin-gated, tenant-scoped, transactional
  diff-write). The device-local key remains ONLY as the mock-mode medium.
- **Deep-link (BUG-031/043/SET-U4):** the Settings `?tab=` param is
  followed at runtime, not only at mount.
- **Dead key (DEAD-018):** `el-imtiyaz:rbac-matrix-overrides` removed
  (restore-path write re-pointed to the canonical constant).
- **Duplicate constants:** `BACKUP_PASSPHRASE_KEY` consolidated to its
  domain-model home (backup-service re-exports); the RBAC key constant
  born canonical (`domain/model/rbac.ts`).

## The follow-up register (the physical collapse, bounded)

1. **DONE (T-627, Session 57, migration 0007):** `ai-config` (non-secret
   half) + `backup-scheduler-enabled` + `custom-themes` → `system_settings`
   rows — the seam (`TenantSettingsRepository`: the Supabase twin over
   `read_public_settings`/`save_public_setting` + the device-local mock
   twin over the EXISTING keys) + the three store rewires + the ARCH-001
   `aiConfig` slot retirement + SEC-121 (the upsert pair's caller
   verification) resolved in the same migration. RESOLVED-TESTED; the live
   apply is owner-gated (OPS-015).
2. `placement-draft` → keyed draft row. **T-628 (Session 58) established the runtime-validated v1 shape at `placement-draft-storage.ts`** (tuples/sections/patches/timestamp/context/identity checks); malformed state never reaches restore. The cross-device write/concurrency contract and DB collapse remain follow-up work; this repair does not synchronize drafts.
3. **DONE (T-629, Session 58):** `dashboard-layout` fallback documented at
   the layout store: server wins on successful load; explicit save only;
   load failure retains the local cache. A reset changes this device
   immediately but is shared/persistent only after server clear succeeds;
   failure is visible and retryable. Context changes and newer explicit
   writes invalidate older loads. The load sentinel keys by the view string,
   never by a repository wrapper’s object identity. No queued background sync is promised.
4. **The legacy-vocabulary reconciliation** (discovered during T-588, see
   the problem registry): the DB `role_permissions` default matrix speaks
   legacy codes (`view_students`, `assign_tasks`, `settle_expense`,
   `push_homework`, …) the desktop enum does not model. Aligning the
   DEFAULT matrix changes effective permissions for every user — a
   security-sensitive behavioral change that needs its own task + ADR.
