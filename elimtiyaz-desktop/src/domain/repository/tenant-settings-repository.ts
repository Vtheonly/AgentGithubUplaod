/**
 * TenantSettingsRepository — the T-627 (C-25 follow-up register, item 1)
 * seam: the tenant-level home of the three former device-only settings
 * stores, collapsed onto `system_settings` rows (migration 0007).
 *
 * The three values (all NON-SECRET by charter — secrets never enter the
 * tenant-visible table, settings-stores.md rule 3):
 *   - `ai.provider_config`      — the non-secret half of the AI config
 *                                  (provider / models / sampling). The API
 *                                  keys stay device-local AES-256-GCM.
 *   - `backup.scheduler_enabled` — the automatic-backup on/off flag
 *                                  (seeded TRUE — the pre-collapse
 *                                  default-ON semantics).
 *   - `theme.custom_palettes`   — the school's custom brand palettes
 *                                  (readable/selectable by every staff
 *                                  member; edited by super_admin only).
 *
 * Implementations:
 *   - Supabase twin → the 0007 RPCs (`read_public_settings` — the
 *     staff-gated whitelisted reader; `save_public_setting` — the
 *     super_admin-gated whitelisted writer) + the device-local MIRROR
 *     writes (the offline cache must track the tenant truth).
 *   - Mock twin → the EXISTING device-local stores verbatim (the mock
 *     mode IS the offline mode — C-25 boundary rule 4: both twins agree
 *     on this ONE domain contract, never on a shared storage key).
 */
import type { Result } from "../../core/result";
import type { TenantAIConfigShare } from "../model/ai";
import type { CustomThemePalette } from "../../core/theme/theme-types";

/** The loaded trio. `null` on a field = "the tenant row is absent — the
 * caller falls back to its device/offline values" (the honest default). */
export interface TenantPublicSettings {
  /** The tenant's non-secret AI configuration, or null when never set. */
  readonly aiProviderConfig: TenantAIConfigShare | null;
  /** The tenant's scheduler flag, or null when never set (→ default ON). */
  readonly backupSchedulerEnabled: boolean | null;
  /** The tenant's custom palettes, or null when never set. */
  readonly customThemes: CustomThemePalette[] | null;
}

export interface TenantSettingsRepository {
  /** Load the tenant's three public settings (fail-loud: Err on failure). */
  load(): Promise<Result<TenantPublicSettings>>;
  /** Mirror the non-secret AI half to the tenant row (null = clear). */
  saveAiProviderConfig(value: TenantAIConfigShare | null): Promise<Result<void>>;
  /** Write the tenant scheduler flag. */
  saveSchedulerEnabled(enabled: boolean): Promise<Result<void>>;
  /** Write the tenant custom-palette list (null = clear). */
  saveCustomThemes(themes: CustomThemePalette[] | null): Promise<Result<void>>;
}
