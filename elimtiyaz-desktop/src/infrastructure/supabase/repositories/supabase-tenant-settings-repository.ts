/**
 * SupabaseTenantSettingsRepository — the tenant-level home of the T-627
 * trio over the 0007 RPCs (migration `0007_tenant_public_settings.sql`):
 *
 *   - `read_public_settings()` — the STABLE SECURITY DEFINER reader,
 *     staff-gated + tenant-scoped server-side (the client sends no
 *     identity columns). Returns the three whitelisted non-secret jsonb
 *     values; null per key when the tenant row is absent.
 *   - `save_public_setting(p_key, p_value)` — the ONE whitelisted writer
 *     (the three public keys only, super_admin-gated, tenant + actor
 *     resolved SERVER-SIDE, shape-validated, audited through
 *     write_audit_log).
 *
 * DEVICE MIRROR (the offline-cache contract): every successful tenant
 * write ALSO mirrors the device-local key (the scheduler flag + the
 * custom-theme list + the AI non-secret half) so an OFFLINE boot renders
 * the last-known tenant state. The mock twin writes ONLY the device keys
 * — the mock mode is the offline mode.
 *
 * ERROR MODEL: fail-loud — every failure propagates as an Err
 * (supabaseErrorToAppError); the caller decides the degradation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TenantSettingsRepository,
  TenantPublicSettings,
} from "../../../domain/repository/tenant-settings-repository";
import type {
  TenantAIConfigShare,
} from "../../../domain/model/ai";
import { parseTenantAIConfigShare } from "../../../domain/model/ai";
import { Ok, Err, type Result } from "../../../core/result";
import { supabaseErrorToAppError } from "../supabase-client";
import { setSchedulerEnabled } from "../../backup/backup-scheduler";
import { saveStoredCustomThemes, loadStoredCustomThemes } from "../../../core/theme/theme-engine";
import type { CustomThemePalette } from "../../../core/theme/theme-types";
import { logger } from "../../../core/logger";

/** The reader payload contract (migration 0007's jsonb_build_object). */
interface ReadPublicSettingsPayload {
  aiProviderConfig: unknown;
  backupSchedulerEnabled: unknown;
  customThemes: unknown;
}

/** A per-entry light guard: a palette row must carry the renderable shape
 * (the writer validates before persisting; this drops only corrupted
 * entries so one bad row cannot blank the whole list at render). */
function isPaletteLike(v: unknown): v is CustomThemePalette {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.isDark === "boolean" &&
    typeof o.colors === "object" &&
    o.colors !== null
  );
}

export class SupabaseTenantSettingsRepository implements TenantSettingsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async load(): Promise<Result<TenantPublicSettings>> {
    try {
      const { data, error } = await this.client.rpc("read_public_settings");
      if (error) return Err(supabaseErrorToAppError(error));
      if (!data || typeof data !== "object") {
        return Err(
          supabaseErrorToAppError({
            message: "read_public_settings: réponse invalide",
          }),
        );
      }
      const raw = data as ReadPublicSettingsPayload;
      const scheduler =
        typeof raw.backupSchedulerEnabled === "boolean" ? raw.backupSchedulerEnabled : null;
      const themes = Array.isArray(raw.customThemes)
        ? raw.customThemes.filter(isPaletteLike)
        : null;
      return Ok({
        aiProviderConfig: parseTenantAIConfigShare(raw.aiProviderConfig),
        backupSchedulerEnabled: scheduler,
        customThemes: themes,
      });
    } catch (err) {
      return Err(
        supabaseErrorToAppError({
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async saveAiProviderConfig(value: TenantAIConfigShare | null): Promise<Result<void>> {
    return this.saveKey("ai.provider_config", value);
  }

  async saveSchedulerEnabled(enabled: boolean): Promise<Result<void>> {
    const r = await this.saveKey("backup.scheduler_enabled", enabled);
    if (r.ok) {
      // The device mirror (the offline cache follows the tenant truth).
      setSchedulerEnabled(enabled);
    }
    return r;
  }

  async saveCustomThemes(themes: CustomThemePalette[] | null): Promise<Result<void>> {
    const r = await this.saveKey("theme.custom_palettes", themes);
    if (r.ok) {
      // The device mirror — only when the local cache would otherwise go
      // STALE (a tenant delete/clear must remove it locally too).
      const mirrored = themes ?? [];
      const local = loadStoredCustomThemes();
      if (JSON.stringify(local) !== JSON.stringify(mirrored)) {
        saveStoredCustomThemes(mirrored);
      }
    }
    return r;
  }

  /** The ONE writer round-trip: p_key + p_value jsonb (the RPC derives the
   * category/label/type server-side; the client sends no metadata). */
  private async saveKey(key: string, value: unknown): Promise<Result<void>> {
    try {
      const { error } = await this.client.rpc("save_public_setting", {
        p_key: key,
        p_value: value ?? null,
      });
      if (error) return Err(supabaseErrorToAppError(error));
      logger.debug("tenant_settings.saved", { key });
      return Ok(undefined);
    } catch (err) {
      return Err(
        supabaseErrorToAppError({
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
