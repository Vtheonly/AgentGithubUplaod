// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/ai/llm-adapter.ts
// ============================================================================
/**
 * Multi-Model LLM Adapter with automatic task specialization routing.
 */
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { AIRequest, AIResponse, AIProvider } from "../../domain/model/ai";
import {
  getSupabaseClient,
  isSupabaseConfigured,
} from "../supabase/supabase-client";
import { loadConfig } from "./ai-config-storage";
import { executeOpenAIStream } from "../../core/ai/streaming/stream-client";
import { resolveEndpoint } from "../../core/ai/providers/provider-registry";

export interface LLMAdapter {
  generate(request: AIRequest): Promise<Result<AIResponse>>;
}

export type AIFeature = "narrative" | "drafting" | "anomaly";

const MOCK_LATENCY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function featureOf(request: AIRequest): AIFeature {
  if (request.feature && request.feature !== "copilot") return request.feature;
  const hay = `${request.systemPrompt}\n${request.userPrompt}`.toLowerCase();
  if (
    hay.includes("narratif") ||
    hay.includes("bulletin") ||
    hay.includes("commentaire") ||
    hay.includes("appréciation")
  ) {
    return "narrative";
  }
  if (
    hay.includes("anomalie") ||
    hay.includes("dépense") ||
    hay.includes("anomaly") ||
    hay.includes("fournisseur")
  ) {
    return "anomaly";
  }
  return "drafting";
}

function systemPromptForFeature(
  request: AIRequest,
  feature: AIFeature,
): string {
  switch (feature) {
    case "narrative":
      return (
        "Vous êtes un enseignant expérimenté dans une école privée algérienne.\n" +
        "Rédigez un commentaire narratif pour le bulletin scolaire en français soigné, structuré en 3 paragraphes.\n" +
        "N'inventez aucune note non fournie."
      );
    case "anomaly":
      return (
        "Vous êtes un auditeur financier scolaire.\n" +
        "Analysez la dépense et signalez les anomalies potentielles (doublon, nouveau fournisseur, dépassement).\n" +
        "Fournissez un signal d'aide à la décision (l'humain reste décisionnaire)."
      );
    default:
      return (
        "Vous êtes un assistant de rédaction administrative pour un établissement scolaire.\n" +
        "Rédigez des documents clairs, précis et professionnels en français formel."
      );
  }
}

function pickCannedResponse(request: AIRequest): string {
  const hay = `${request.systemPrompt}\n${request.userPrompt}`.toLowerCase();

  if (
    hay.includes("narratif") ||
    hay.includes("bulletin") ||
    hay.includes("commentaire")
  ) {
    return [
      "L'élève a montré un engagement régulier tout au long du trimestre. Les résultats obtenus témoignent d'un travail sérieux, notamment dans les matières fondamentales.",
      "Des efforts restent nécessaires pour renforcer la rigueur méthodologique lors des évaluations écrites. La participation aux séances d'accompagnement sera bénéfique.",
      "Trimestre globalement positif. En maintenant cette volonté d'apprendre, l'élève progressera sereinement.",
    ].join("\n\n");
  }

  if (hay.includes("anomalie") || hay.includes("dépense")) {
    return "Analyse : aucun risque majeur détecté. Vérifier la conformité du justificatif avant décaissement final.";
  }

  return "Document administratif généré avec succès.";
}

export const mockLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    if (!request.userPrompt.trim() && !request.systemPrompt.trim()) {
      return Err(Errors.validation("Le prompt ne peut pas être vide."));
    }

    const start = Date.now();
    await delay(MOCK_LATENCY_MS);
    const content = pickCannedResponse(request);

    return Ok({
      id: newId("ai-resp"),
      requestId: request.id,
      content,
      tokensUsed: Math.max(1, Math.ceil(content.length / 4)),
      durationMs: Date.now() - start,
      provider: request.provider,
      model: request.model,
      finishedAt: new Date().toISOString(),
    });
  },
};

function hasMaskedContent(request: AIRequest): boolean {
  return (
    typeof request.maskedContent === "string" &&
    request.maskedContent.trim().length > 0
  );
}

export const byokLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    const startedAt = Date.now();
    try {
      const config = await loadConfig();
      const feature = featureOf(request);
      const systemPrompt = systemPromptForFeature(request, feature);
      const isAgentic =
        Array.isArray(request.messages) && request.messages.length > 0;

      if (!isAgentic && !hasMaskedContent(request)) {
        return Err(Errors.validation("SEC-002: maskedContent est vide."));
      }

      // Multi-model task selection:
      // Heavy features (anomaly, narrative) -> reasoningModel
      // Fast drafting -> fastModel
      let selectedModel = config.defaultModel;
      if (config.enableSmartRouting) {
        if (feature === "anomaly" || feature === "narrative") {
          selectedModel = config.reasoningModel || config.defaultModel;
        } else if (feature === "drafting") {
          selectedModel = config.fastModel || config.defaultModel;
        }
      }

      const primary = config.defaultProvider;
      const providers: AIProvider[] =
        primary === "custom_openai"
          ? ["custom_openai"]
          : [primary, primary === "groq" ? "openrouter" : "groq"];

      const keys: Record<AIProvider, string | null> = {
        groq: config.groqApiKey,
        openrouter: config.openRouterApiKey,
        custom_openai: config.customApiKey,
      };

      const endpoints: Record<AIProvider, string> = {
        groq: "https://api.groq.com/openai/v1/chat/completions",
        openrouter: "https://openrouter.ai/api/v1/chat/completions",
        custom_openai: resolveEndpoint("custom_openai", config.customBaseUrl)
          .chatCompletionsUrl,
      };

      const body = {
        model: selectedModel,
        messages: isAgentic
          ? (request.messages ?? []).map((m) => ({
              role: m.role,
              content: m.content,
              name: m.name,
              tool_calls: m.toolCalls,
              tool_call_id: m.toolCallId,
            }))
          : [
              { role: "system", content: systemPrompt },
              { role: "user", content: request.maskedContent },
            ],
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        top_p: request.topP,
      };

      let lastError: unknown = null;
      for (const provider of providers) {
        const key = keys[provider];
        if (!key && provider !== "custom_openai") continue;
        try {
          const streamResult = await executeOpenAIStream(
            endpoints[provider],
            {
              Authorization: `Bearer ${key}`,
              ...(provider === "openrouter"
                ? { "HTTP-Referer": "https://elimtiyaz.dz" }
                : {}),
            },
            body,
            {},
          );

          return Ok({
            id: newId("ai-resp"),
            requestId: request.id,
            content: streamResult.fullContent,
            tokensUsed: Math.max(
              1,
              Math.ceil(streamResult.fullContent.length / 4),
            ),
            durationMs: Date.now() - startedAt,
            provider,
            model: selectedModel,
            finishedAt: new Date().toISOString(),
          });
        } catch (err) {
          lastError = err;
        }
      }

      return Err(
        Errors.server(
          lastError instanceof Error
            ? lastError.message
            : "Échec de l'appel IA BYOK",
        ),
      );
    } catch (err) {
      return Err(
        Errors.server(err instanceof Error ? err.message : "Erreur inattendue"),
      );
    }
  },
};

export const defaultLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    const byokResult = await byokLLMAdapter.generate(request);
    if (byokResult.ok) return byokResult;
    return mockLLMAdapter.generate(request);
  },
};
