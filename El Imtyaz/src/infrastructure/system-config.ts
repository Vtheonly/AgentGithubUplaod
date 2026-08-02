/**
 * SystemConfig service — unified API for reading and writing all configurable
 * settings from the desktop app's Settings → Configuration tab.
 *
 * Two storage layers:
 *   1. LOCAL config (Electron userData/config.json) — for settings that must
 *      be available BEFORE the Supabase client initializes:
 *        - supabase.url
 *        - supabase.anon_key
 *        - supabase.use_supabase (boolean flag)
 *      These are read on app startup and used to initialize the Supabase client.
 *      In a browser (no Electron), falls back to localStorage.
 *
 *   2. SERVER config (Supabase system_settings table) — for all other settings:
 *        - AI provider API keys (Groq, OpenRouter)
 *        - Email service (Resend)
 *        - Push notifications (FCM)
 *        - Storage bucket names
 *        - Backup passphrase + retention
 *        - System (CORS, rate limits, log level, timezone)
 *        - Feature flags
 *      These are read after the Supabase client initializes.
 *
 * Sensitive values (API keys, passphrases) are stored as AES-256-GCM ciphertext
 * in the `value_encrypted` column. The actual values are NEVER stored in
 * plaintext in the database. The UI always shows "********" for configured
 * secrets and an empty field for unconfigured ones.
 *
 * Server-side secrets that need to be available to Edge Functions (GROQ_API_KEY,
 * RESEND_API_KEY, etc.) are updated via the `update-server-secret` Edge Function
 * which calls the Supabase Management API.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { Ok, Err, type Result } from "../core/result";
import { Errors } from "../core/app-error";

// ============================================================================
// Types
// ============================================================================

export type SettingCategory =
  | "connection"
  | "ai"
  | "email"
  | "push"
  | "storage"
  | "backup"
  | "system"
  | "feature_flags";

export type SettingValueType = "string" | "number" | "boolean" | "json" | "secret";

export interface SystemSetting {
  id: string;
  category: SettingCategory;
  key: string;
  label_fr: string;
  label_ar?: string | null;
  label_en?: string | null;
  description_fr?: string | null;
  value_type: SettingValueType;
  value: unknown | null;          // plaintext value (null for secrets)
  is_sensitive: boolean;
  is_editable: boolean;
  is_required: boolean;
  sort_order: number;
  validation_pattern?: string | null;
  validation_min?: number | null;
  validation_max?: number | null;
  options?: Array<{ value: string; label_fr: string }> | null;
  is_configured: boolean;         // for secrets: true if value_encrypted is non-null
  updated_at: string;
}

export interface LocalConfig {
  supabase_url?: string;
  supabase_anon_key?: string;
  supabase_use_supabase?: boolean;
}

// ============================================================================
// Local config (Electron userData/config.json or localStorage fallback)
// ============================================================================

const LOCAL_STORAGE_KEY = "el-imtiyaz.local-config";

async function readLocalConfig(): Promise<LocalConfig> {
  // Try Electron IPC first
  if (window.elImtiyaz?.config) {
    try {
      const result = await window.elImtiyaz.config.read();
      if (result.ok) {
        return {
          supabase_url: result.config.supabase_url as string | undefined,
          supabase_anon_key: result.config.supabase_anon_key as string | undefined,
          supabase_use_supabase: result.config.supabase_use_supabase as boolean | undefined,
        };
      }
    } catch {
      // Fall through to localStorage
    }
  }

  // Fallback: localStorage (browser dev mode)
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

async function writeLocalConfig(config: LocalConfig): Promise<Result<void>> {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Failed to set localStorage config:', err);
  }

  if (window.elImtiyaz?.config) {
    try {
      await window.elImtiyaz.config.write(config as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn('Failed to write config via IPC:', err);
    }
  }

  return Ok(undefined);
}

async function deleteLocalConfig(): Promise<Result<void>> {
  if (window.elImtiyaz?.config) {
    try {
      const result = await window.elImtiyaz.config.delete();
      if (!result.ok) {
        return Err(Errors.server(`Failed to delete local config: ${result.error}`));
      }
      return Ok(undefined);
    } catch (err) {
      return Err(Errors.server(`Failed to delete local config via IPC: ${(err as Error).message}`));
    }
  }

  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    return Ok(undefined);
  } catch (err) {
    return Err(Errors.server(`Failed to delete local config from localStorage: ${(err as Error).message}`));
  }
}

/**
 * Restart the Electron app. Required after changing Supabase connection
 * settings so the renderer re-initializes the Supabase client with the
 * new URL/key. In a browser, this reloads the page.
 */
async function restartApp(): Promise<Result<void>> {
  if (window.elImtiyaz?.app?.restart) {
    try {
      const result = await window.elImtiyaz.app.restart();
      if (!result.ok) {
        return Err(Errors.server(`Failed to restart app: ${result.error}`));
      }
      return Ok(undefined);
    } catch (err) {
      return Err(Errors.server(`Failed to restart app: ${(err as Error).message}`));
    }
  }

  // Browser fallback: reload the page
  window.location.reload();
  return Ok(undefined);
}

// ============================================================================
// Server config (Supabase system_settings table)
// ============================================================================

export class SystemConfigService {
  constructor(private readonly client: SupabaseClient | null) {}

  /**
   * Read all settings for the current tenant, grouped by category.
   * Sensitive values are returned as null (use is_configured to check status).
   */
  async listAll(): Promise<Result<SystemSetting[]>> {
    if (!this.client) {
      return Err(Errors.server("Supabase client not initialized. Configure Supabase URL + anon key first."));
    }

    const { data, error } = await this.client
      .from("system_settings")
      .select("*")
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });

    if (error) {
      return Err(Errors.server(`Failed to load settings: ${error.message}`));
    }

    const settings: SystemSetting[] = (data ?? []).map((row) => ({
      id: row.id,
      category: row.category,
      key: row.key,
      label_fr: row.label_fr,
      label_ar: row.label_ar,
      label_en: row.label_en,
      description_fr: row.description_fr,
      value_type: row.value_type,
      value: row.value_type === "secret" ? null : row.value,
      is_sensitive: row.is_sensitive,
      is_editable: row.is_editable,
      is_required: row.is_required,
      sort_order: row.sort_order,
      validation_pattern: row.validation_pattern,
      validation_min: row.validation_min,
      validation_max: row.validation_max,
      options: row.options,
      is_configured: row.value_type === "secret"
        ? !!row.value_encrypted
        : row.value !== null,
      updated_at: row.updated_at,
    }));

    return Ok(settings);
  }

  /**
   * Read settings for a specific category.
   */
  async listByCategory(category: SettingCategory): Promise<Result<SystemSetting[]>> {
    if (!this.client) {
      return Err(Errors.server("Supabase client not initialized."));
    }

    const { data, error } = await this.client
      .from("system_settings")
      .select("*")
      .eq("category", category)
      .order("sort_order", { ascending: true });

    if (error) {
      return Err(Errors.server(`Failed to load settings: ${error.message}`));
    }

    const settings: SystemSetting[] = (data ?? []).map((row) => ({
      id: row.id,
      category: row.category,
      key: row.key,
      label_fr: row.label_fr,
      label_ar: row.label_ar,
      label_en: row.label_en,
      description_fr: row.description_fr,
      value_type: row.value_type,
      value: row.value_type === "secret" ? null : row.value,
      is_sensitive: row.is_sensitive,
      is_editable: row.is_editable,
      is_required: row.is_required,
      sort_order: row.sort_order,
      validation_pattern: row.validation_pattern,
      validation_min: row.validation_min,
      validation_max: row.validation_max,
      options: row.options,
      is_configured: row.value_type === "secret"
        ? !!row.value_encrypted
        : row.value !== null,
      updated_at: row.updated_at,
    }));

    return Ok(settings);
  }

  /**
   * Update a non-secret setting value.
   */
  async updateValue(settingId: string, value: unknown): Promise<Result<void>> {
    if (!this.client) {
      return Err(Errors.server("Supabase client not initialized."));
    }

    const { error } = await this.client
      .from("system_settings")
      .update({ value: JSON.stringify(value) })
      .eq("id", settingId);

    if (error) {
      return Err(Errors.server(`Failed to update setting: ${error.message}`));
    }

    return Ok(undefined);
  }

  /**
   * Update a SECRET setting. The value is sent to the `update-server-secret`
   * Edge Function which:
   *   1. Calls the Supabase Management API to update the Edge Function env var
   *   2. Updates the system_settings row (value_encrypted = "********" placeholder)
   *   3. Writes an audit log entry
   *
   * The actual value is NEVER stored in the database in plaintext — it lives
   * only in the Supabase Edge Function environment.
   */
  async updateSecret(
    category: SettingCategory,
    secretKey: string,         // e.g. 'groq.api_key' — the system_settings.key
    envVarName: string,        // e.g. 'GROQ_API_KEY' — the Edge Function env var name
    value: string,
    labelFr?: string
  ): Promise<Result<void>> {
    if (!this.client) {
      return Err(Errors.server("Supabase client not initialized."));
    }

    if (!value.trim()) {
      return Err(Errors.validation("Secret value cannot be empty"));
    }

    const { data, error } = await this.client.functions.invoke("update-server-secret", {
      body: {
        key: envVarName,
        value,
        category,
        label_fr: labelFr ?? secretKey,
      },
    });

    if (error) {
      return Err(Errors.server(`Failed to update secret: ${error.message}`));
    }
    if (data?.error) {
      return Err(Errors.server(data.error.message ?? "Failed to update secret"));
    }

    return Ok(undefined);
  }

  /**
   * Delete a secret (clears the Edge Function env var + sets value_encrypted to null).
   */
  async deleteSecret(envVarName: string): Promise<Result<void>> {
    if (!this.client) {
      return Err(Errors.server("Supabase client not initialized."));
    }

    // The Edge Function supports DELETE via query param
    const supabaseUrl = (this.client as unknown as { supabaseUrl: string }).supabaseUrl;
    const response = await fetch(
      `${supabaseUrl}/functions/v1/update-server-secret?key=${encodeURIComponent(envVarName)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${(await this.client.auth.getSession()).data.session?.access_token ?? ""}`,
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return Err(Errors.server(`Failed to delete secret: ${response.status} ${errText}`));
    }

    return Ok(undefined);
  }
}

// ============================================================================
// Local config service — for Supabase connection settings
// ============================================================================

export class LocalConfigService {
  /**
   * Read the current local config (Supabase URL + anon key + use_supabase flag).
   */
  async read(): Promise<Result<LocalConfig>> {
    try {
      const config = await readLocalConfig();
      return Ok(config);
    } catch (err) {
      return Err(Errors.server(`Failed to read local config: ${(err as Error).message}`));
    }
  }

  /**
   * Write the local config. After writing, the app should be restarted via
   * `restart()` so the Supabase client re-initializes with the new URL/key.
   */
  async write(config: LocalConfig): Promise<Result<void>> {
    return writeLocalConfig(config);
  }

  /**
   * Validate the Supabase URL + anon key by attempting a simple query.
   * Returns Ok if the connection works, Err with details if not.
   */
  async validateConnection(url: string, anonKey: string): Promise<Result<{ connected: boolean; tenantCount?: number; error?: string }>> {
    if (!url || !anonKey) {
      return Err(Errors.validation("URL and anon key are required"));
    }

    if (!url.startsWith("https://") || !url.includes(".supabase.co")) {
      return Err(Errors.validation("URL must be https://xxxx.supabase.co format"));
    }

    try {
      // Test connection by fetching the public tenants table (RLS allows SuperAdmin)
      const response = await fetch(`${url}/rest/v1/tenants?select=id&limit=1`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return Ok({
          connected: false,
          error: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
        });
      }

      const data = await response.json();
      return Ok({
        connected: true,
        tenantCount: Array.isArray(data) ? data.length : 0,
      });
    } catch (err) {
      return Ok({
        connected: false,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Save the Supabase connection settings + restart the app.
   */
  async saveConnectionAndRestart(url: string, anonKey: string, useSupabase: boolean): Promise<Result<void>> {
    const config: LocalConfig = {
      supabase_url: url,
      supabase_anon_key: anonKey,
      supabase_use_supabase: useSupabase,
    };

    const writeResult = await this.write(config);
    if (!writeResult.ok) {
      return writeResult;
    }

    return restartApp();
  }

  /**
   * Reset the local config (clears Supabase connection — app falls back to mock).
   */
  async resetAndRestart(): Promise<Result<void>> {
    const deleteResult = await deleteLocalConfig();
    if (!deleteResult.ok) {
      return deleteResult;
    }
    return restartApp();
  }

  /**
   * Check if running in Electron (vs browser).
   */
  isElectron(): boolean {
    return !!window.elImtiyaz?.app?.isElectron;
  }
}

// ============================================================================
// Singleton instances
// ============================================================================

let _systemConfigService: SystemConfigService | null = null;
let _localConfigService: LocalConfigService | null = null;

/**
 * Get the SystemConfigService singleton. Returns null if the Supabase client
 * is not initialized (e.g., before connection settings are configured).
 */
export function getSystemConfigService(client: SupabaseClient | null): SystemConfigService {
  if (!_systemConfigService) {
    _systemConfigService = new SystemConfigService(client);
  } else if (client) {
    // Update the client if a new one is provided
    (_systemConfigService as unknown as { client: SupabaseClient }).client = client;
  }
  return _systemConfigService;
}

export function getLocalConfigService(): LocalConfigService {
  if (!_localConfigService) {
    _localConfigService = new LocalConfigService();
  }
  return _localConfigService;
}
