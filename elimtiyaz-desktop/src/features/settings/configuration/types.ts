/**
 * Shared types + helpers for the Configuration tab sub-components.
 *
 * Extracted from `configuration-tab.tsx` in iteration 20 to keep each
 * sub-component focused and under the 200-LOC guideline.
 */
import type { LocalConfig, SystemSetting, SettingCategory } from "../../../infrastructure/system-config";

export interface SecretEditState {
  settingKey: string;
  envVarName: string;
  label: string;
  value: string;
  showValue: boolean;
}

export interface ConnectionTestResult {
  connected: boolean;
  error?: string;
  tenantCount?: number;
  /** OPS-318/Task-29 honesty (T-392): a 200-with-0-rows probe note — reachable + key accepted ≠ data access (the probe runs as anon). */
  note?: string;
}

/** Build the env-var name (UPPER_SNAKE) from a dotted setting key. */
export function settingKeyToEnvVar(settingKey: string): string {
  return settingKey
    .split(".")
    .map((p) => p.toUpperCase())
    .join("_");
}

/** Find the category for a setting key by scanning the loaded settings. */
export function categoryForKey(
  settings: readonly SystemSetting[],
  key: string,
): SettingCategory {
  return settings.find((s) => s.key === key)?.category ?? "system";
}

/** Local config type re-export so sub-components don't depend on the infra layer directly. */
export type { LocalConfig, SystemSetting, SettingCategory };
