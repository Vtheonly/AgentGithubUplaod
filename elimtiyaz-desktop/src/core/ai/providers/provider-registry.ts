// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/providers/provider-registry.ts
// ============================================================================
/**
 * Provider registry & dynamic model discovery (T-260, 39th session).
 *
 * Model-agnostic BYOK: pasting any Groq / OpenRouter / custom-OpenAI key
 * lets the settings UI live-query the provider's `/models` endpoint and
 * populate the model selector (e.g. `qwen/qwen3.8-27b`,
 * `llama-3.3-70b-versatile`, …) with ZERO hardcoded model locks. Only the
 * endpoint addresses + auth-header shapes are provider-specific — every
 * provider speaks the same OpenAI-compatible wire protocol.
 *
 * `custom_openai` defaults to an Ollama-style localhost endpoint but
 * accepts ANY OpenAI-compatible base URL (LM Studio, vLLM, Groq's own URL,
 * an internal gateway …) via `AIProviderConfig.customBaseUrl`.
 */
import type { AIProvider, AIModelInfo } from "../../../domain/model/ai";

export interface ProviderEndpoint {
  chatCompletionsUrl: string;
  modelsUrl: string;
  authHeader: (key: string) => Record<string, string>;
}

export const PROVIDER_ENDPOINTS: Record<AIProvider, ProviderEndpoint> = {
  groq: {
    chatCompletionsUrl: "https://api.groq.com/openai/v1/chat/completions",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  openrouter: {
    chatCompletionsUrl: "https://openrouter.ai/api/v1/chat/completions",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    authHeader: (key) => ({
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://elimtiyaz.dz",
      "X-Title": "El-Imtiyaz Desktop Terminal",
    }),
  },
  custom_openai: {
    // Ollama-style default; overridden by AIProviderConfig.customBaseUrl.
    chatCompletionsUrl: "http://localhost:11434/v1/chat/completions",
    modelsUrl: "http://localhost:11434/v1/models",
    authHeader: (key): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {}),
  },
};

/** Normalize an auth-header fn so callers always get a full Record. */
export function safeAuthHeader(endpoint: ProviderEndpoint, key: string): Record<string, string> {
  const headers = endpoint.authHeader(key);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Resolve a provider's endpoints, honouring a custom base URL when set. */
export function resolveEndpoint(
  provider: AIProvider,
  customBaseUrl?: string | null,
): ProviderEndpoint {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (provider === "custom_openai" && customBaseUrl) {
    const base = customBaseUrl.replace(/\/+$/, "");
    return {
      ...endpoint,
      chatCompletionsUrl: `${base}/chat/completions`,
      modelsUrl: `${base}/models`,
    };
  }
  return endpoint;
}

/**
 * Live-query a provider's model list. Works with the standard
 * `{ data: [{ id, context_window? }] }` OpenAI/Groq shape AND the bare
 * `[{ id, … }]` array shape some OpenAI-compatible servers return.
 */
export async function queryLiveProviderModels(
  provider: AIProvider,
  apiKey: string,
  customBaseUrl?: string,
): Promise<AIModelInfo[]> {
  const endpoint = resolveEndpoint(provider, customBaseUrl);
  const url = endpoint.modelsUrl;
  const headers = safeAuthHeader(endpoint, apiKey);

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Échec de récupération des modèles (HTTP ${response.status})`);
  }

  const json = await response.json();
  const rawList: Array<{ id: string; context_window?: number }> = Array.isArray(json.data)
    ? json.data
    : Array.isArray(json)
      ? json
      : [];

  return rawList
    .filter((m) => typeof m?.id === "string" && m.id.length > 0)
    .map((m) => ({
      id: m.id,
      name: m.id,
      contextWindow: m.context_window,
      supportsTools: true,
      supportsReasoning: m.id.includes("r1") || m.id.includes("qwen") || m.id.includes("reason"),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
