/**
 * Mock AI config repository — BYOK provider config (Groq + OpenRouter).
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim.
 *
 * Persists to localStorage via the encrypted `ai-config-storage` module
 * (AES-256-GCM). Maintains an in-memory `SubjectBehavior` so `observe()`
 * re-emits whenever `updateConfig` runs.
 *
 * `testProvider` simulates a network ping: returns ok=true after a 500ms
 * delay. Production will proxy through a Supabase Edge Function per
 * plan §11.02 so the API key never leaves the server.
 */
import type {
  AIConfigRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { logger } from "../../../core/logger";
import { SubjectBehavior } from "../subject-behavior";
import type { AIProvider, AIProviderConfig } from "../../../domain/model/ai";
import { DEFAULT_AI_PROVIDER_CONFIG } from "../../../domain/model/ai";
import { loadConfig, saveConfig } from "../../ai/ai-config-storage";
import { appendAudit, nowIso, delay } from "./mock-store";

export class MockAIConfigRepository implements AIConfigRepository {
  private config$: SubjectBehavior<AIProviderConfig>;

  constructor() {
    // Load synchronously from storage (encrypted at rest). The constructor
    // runs once at module load; we cache the result in the SubjectBehavior.
    // Reads of API keys happen via the async loadConfig() — but to keep the
    // constructor synchronous, we initialize with the default and let the
    // first call to `updateConfig` overwrite.
    this.config$ = new SubjectBehavior<AIProviderConfig>({ ...DEFAULT_AI_PROVIDER_CONFIG });
    // Kick off an async load in the background — when the async load
    // completes, we update the subject so subscribers see the persisted
    // state on their first emission.
    void this.loadInitial();
  }

  private async loadInitial(): Promise<void> {
    try {
      const cfg = await loadConfig();
      this.config$.set(cfg);
    } catch (err) {
      logger.warn("Failed to load AI config from storage", { err });
    }
  }

  observe(): Observable<AIProviderConfig> {
    return this.config$;
  }

  async updateConfig(
    input: Partial<Omit<AIProviderConfig, "updatedAt" | "updatedBy">>,
    updatedBy: string,
  ): Promise<Result<AIProviderConfig>> {
    await delay(120);
    const current = this.config$.get();
    const merged: AIProviderConfig = {
      groqApiKey: input.groqApiKey !== undefined ? input.groqApiKey : current.groqApiKey,
      openRouterApiKey:
        input.openRouterApiKey !== undefined ? input.openRouterApiKey : current.openRouterApiKey,
      defaultProvider: input.defaultProvider ?? current.defaultProvider,
      defaultModel: input.defaultModel ?? current.defaultModel,
      fallbackModel:
        input.fallbackModel !== undefined ? input.fallbackModel : current.fallbackModel,
      updatedAt: nowIso(),
      updatedBy,
    };
    try {
      await saveConfig(merged);
    } catch (err) {
      logger.error("Failed to persist AI config", { err });
      return Err(Errors.unknown(err));
    }
    this.config$.set(merged);
    appendAudit({
      action: AuditActions.AiConfigUpdate,
      entityType: "ai_config",
      entityId: "default",
      actorId: updatedBy,
      actorName: updatedBy,
      diff: {
        before: { defaultProvider: current.defaultProvider, defaultModel: current.defaultModel },
        after: { defaultProvider: merged.defaultProvider, defaultModel: merged.defaultModel },
      },
      note: "Configuration IA mise à jour",
    });
    return Ok(merged);
  }

  async testProvider(
    provider: AIProvider,
  ): Promise<Result<{ ok: boolean; latencyMs: number; error?: string }>> {
    await delay(500);
    // The mock always returns ok=true. Production will hit the configured
    // endpoint and return real status + latency.
    appendAudit({
      action: AuditActions.AiConfigTest,
      entityType: "ai_config",
      entityId: provider,
      actorId: "system",
      actorName: "system",
      note: `Test du provider ${provider} (mock — 500ms)`,
    });
    return Ok({ ok: true, latencyMs: 500 });
  }
}

/** Singleton — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockAIConfigRepository: AIConfigRepository = new MockAIConfigRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
