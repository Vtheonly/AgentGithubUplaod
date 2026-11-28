/**
 * SupabaseAIConfigRepository — the aiConfig slot's Supabase twin
 * (T-627, the ARCH-001 mock-slot retirement).
 *
 * SPLIT OF CONCERNS (settings-stores.md rule 3 + the T-627 contract):
 *   - The SECRETS (the three provider API keys) stay DEVICE-LOCAL —
 *     `saveConfig`'s AES-256-GCM store under the per-device keychain
 *     passphrase. Keys can never sync.
 *   - The NON-SECRET half (provider / models / sampling) is the TENANT
 *     truth: `updateConfig` writes the device store AND mirrors the
 *     non-secret half through `save_public_setting` (fail-loud — the
 *     honest-error contract: a failed mirror surfaces as an Err naming
 *     what was saved where).
 *   - `observe()` reads through `loadConfig()` — which carries the tenant
 *     overlay (tenant row wins on the non-secret fields; the device
 *     store serves as the offline cache).
 *
 * `testProvider` is a REAL ping (the provider's live models endpoint —
 * the same `queryLiveProviderModels` call the settings tab's discovery
 * uses), never a fabricated ok.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AIConfigRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { logger } from "../../../core/logger";
import { SubjectBehavior } from "../../mock/subject-behavior";
import type {
  AIProvider,
  AIProviderConfig,
} from "../../../domain/model/ai";
import {
  DEFAULT_AI_PROVIDER_CONFIG,
  toTenantAIConfigShare,
} from "../../../domain/model/ai";
import {
  loadConfig,
  saveConfig,
  invalidateTenantAIOverlay,
} from "../../ai/ai-config-storage";
import type { TenantSettingsRepository } from "../../../domain/repository/tenant-settings-repository";
import { queryLiveProviderModels } from "../../../core/ai/providers/provider-registry";

export class SupabaseAIConfigRepository implements AIConfigRepository {
  private readonly config$: SubjectBehavior<AIProviderConfig>;

  constructor(
    _client: SupabaseClient,
    private readonly tenantSettings: TenantSettingsRepository,
  ) {
    this.config$ = new SubjectBehavior<AIProviderConfig>({ ...DEFAULT_AI_PROVIDER_CONFIG });
    void this.loadInitial();
  }

  private async loadInitial(): Promise<void> {
    try {
      // loadConfig() carries the tenant overlay (the tenant row wins on
      // the non-secret fields; the device store is the offline cache).
      const cfg = await loadConfig();
      this.config$.set(cfg);
    } catch (err) {
      logger.warn("Failed to load AI config", { err });
    }
  }

  observe(): Observable<AIProviderConfig> {
    return this.config$;
  }

  async updateConfig(
    input: Partial<Omit<AIProviderConfig, "updatedAt" | "updatedBy">>,
    updatedBy: string,
  ): Promise<Result<AIProviderConfig>> {
    const current = this.config$.get();
    const merged: AIProviderConfig = {
      groqApiKey: input.groqApiKey !== undefined ? input.groqApiKey : current.groqApiKey,
      openRouterApiKey:
        input.openRouterApiKey !== undefined ? input.openRouterApiKey : current.openRouterApiKey,
      customApiKey: input.customApiKey !== undefined ? input.customApiKey : current.customApiKey,
      customBaseUrl: input.customBaseUrl !== undefined ? input.customBaseUrl : current.customBaseUrl,
      defaultProvider: input.defaultProvider ?? current.defaultProvider,
      defaultModel: input.defaultModel ?? current.defaultModel,
      fastModel: input.fastModel ?? current.fastModel,
      reasoningModel: input.reasoningModel ?? current.reasoningModel,
      enableSmartRouting:
        input.enableSmartRouting !== undefined
          ? input.enableSmartRouting
          : current.enableSmartRouting,
      fallbackModel:
        input.fallbackModel !== undefined ? input.fallbackModel : current.fallbackModel,
      temperature: input.temperature ?? current.temperature,
      topP: input.topP ?? current.topP,
      maxTokens: input.maxTokens ?? current.maxTokens,
      reasoningEffort: input.reasoningEffort ?? current.reasoningEffort,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    // (1) The device store — the secrets (and the offline cache).
    try {
      await saveConfig(merged);
    } catch (err) {
      logger.error("Failed to persist AI config", { err });
      return Err(Errors.unknown(err));
    }

    // (2) The tenant mirror — the non-secret half through the 0007 writer
    //     (the RPC audits the write server-side; the client sends no
    //     identity). FAIL-LOUD: the device half is saved, but a failed
    //     tenant sync is surfaced as an Err that names the split state —
    //     never swallowed (the BUSINESS-002 lesson).
    const mirror = await this.tenantSettings.saveAiProviderConfig(toTenantAIConfigShare(merged));
    if (!mirror.ok) {
      return Err(
        Errors.validation(
          "ai-config tenant mirror failed",
          "La configuration est enregistrée sur cet appareil, mais la synchronisation pour l'établissement a échoué — " +
            `${mirror.error.userMessage} (la moitié non secrète ne sera pas visible sur les autres postes tant que la synchronisation échoue).`,
        ),
      );
    }
    // The overlay cache must not serve the pre-save tenant row.
    invalidateTenantAIOverlay();

    this.config$.set(merged);
    return Ok(merged);
  }

  async testProvider(
    provider: AIProvider,
  ): Promise<Result<{ ok: boolean; latencyMs: number; error?: string }>> {
    try {
      // A REAL ping: the provider's live models endpoint with the CURRENT
      // key (the same call the settings tab's discovery makes). Never a
      // fabricated ok — an unreachable key reports ok=false with its error.
      const cfg = await loadConfig();
      const key =
        provider === "groq"
          ? cfg.groqApiKey
          : provider === "openrouter"
            ? cfg.openRouterApiKey
            : cfg.customApiKey;
      if (!key) {
        return Ok({ ok: false, latencyMs: 0, error: "Aucune clé configurée pour ce fournisseur." });
      }
      const startedAt = Date.now();
      try {
        await queryLiveProviderModels(provider, key, cfg.customBaseUrl ?? undefined);
        return Ok({ ok: true, latencyMs: Date.now() - startedAt });
      } catch (err) {
        return Ok({
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      return Err(Errors.unknown(err));
    }
  }
}
