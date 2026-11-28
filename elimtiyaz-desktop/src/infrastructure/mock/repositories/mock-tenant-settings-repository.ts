/**
 * MockTenantSettingsRepository — the T-627 seam's device-local twin.
 *
 * The mock mode IS the offline mode (C-25 boundary rule 4): the three
 * stores keep their EXISTING localStorage homes verbatim (the encrypted
 * ai-config store, the scheduler on/off key, the custom-themes key) — the
 * mock twin presents them through the ONE domain contract the Supabase
 * twin serves from `system_settings`. No new key, no second medium.
 */
import type {
  TenantSettingsRepository,
  TenantPublicSettings,
} from "../../../domain/repository/tenant-settings-repository";
import type { Result } from "../../../core/result";
import { Ok } from "../../../core/result";
import {
  loadConfig,
  saveConfig,
} from "../../ai/ai-config-storage";
import {
  toTenantAIConfigShare,
  mergeTenantAIConfigShare,
  DEFAULT_AI_PROVIDER_CONFIG,
  type TenantAIConfigShare,
} from "../../../domain/model/ai";
import {
  isSchedulerEnabled,
  setSchedulerEnabled,
} from "../../backup/backup-scheduler";
import {
  loadStoredCustomThemes,
  saveStoredCustomThemes,
} from "../../../core/theme/theme-engine";
import type { CustomThemePalette } from "../../../core/theme/theme-types";

export class MockTenantSettingsRepository implements TenantSettingsRepository {
  async load(): Promise<Result<TenantPublicSettings>> {
    // The device store IS the tenant truth in offline mode: the AI half
    // reads the (device-only — unconfigured ⇒ no overlay) config's
    // non-secret share; the scheduler flag and themes read their keys.
    const cfg = await loadConfig();
    return Ok({
      aiProviderConfig: toTenantAIConfigShare(cfg),
      backupSchedulerEnabled: isSchedulerEnabled(),
      customThemes: loadStoredCustomThemes(),
    });
  }

  async saveAiProviderConfig(value: TenantAIConfigShare | null): Promise<Result<void>> {
    // The offline-mode mirror of the tenant write: merge the non-secret
    // half over the device config (the secrets are preserved untouched —
    // the share never carries them) and persist through the ONE device
    // store. A null share clears the "tenant row" — the honest offline
    // equivalent is the DEFAULT non-secret half (the reader's callers
    // fall back to the defaults when the row is absent).
    const cfg = await loadConfig();
    const share = value ?? toTenantAIConfigShare(DEFAULT_AI_PROVIDER_CONFIG);
    await saveConfig(mergeTenantAIConfigShare(cfg, share));
    return Ok(undefined);
  }

  async saveSchedulerEnabled(enabled: boolean): Promise<Result<void>> {
    setSchedulerEnabled(enabled);
    return Ok(undefined);
  }

  async saveCustomThemes(themes: CustomThemePalette[] | null): Promise<Result<void>> {
    saveStoredCustomThemes(themes ?? []);
    return Ok(undefined);
  }
}

/** Singleton — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockTenantSettingsRepository: TenantSettingsRepository =
  new MockTenantSettingsRepository();
