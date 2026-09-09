/**
 * LLM adapter — abstraction over the LLM provider (Groq / OpenRouter).
 *
 * VAULT §02.06 (Platform Feature Allocation Matrix): "AI Assistant
 * Integration — Full — Groq + OpenRouter" on Desktop. This module is the
 * single routing point that makes that real:
 *
 *   1. Supabase mode  → `edgeLLMAdapter` proxies through the `ai-proxy`
 *      Edge Function (plan §11.02: API keys NEVER leave the server; the
 *      Edge Function holds them in Supabase secrets and rate-limits via
 *      `ai_request_logs`).
 *   2. BYOK fallback  → if the Edge Function is unavailable but the admin
 *      configured Bring-Your-Own-Key credentials (Settings → IA), call
 *      Groq / OpenRouter directly. PII is masked BEFORE the call either way
 *      (the prompt sent over the wire is `AIRequest.maskedContent`).
 *   3. Mock           → canned responses for dev/demo environments where no
 *      backend and no keys are configured.
 *
 * All three paths implement the same `LLMAdapter` contract and return the
 * same `AIResponse` shape, so feature code (narrative generator, anomaly
 * explainer, drafting) is agnostic of the transport.
 *
 * Per plan §11.05–11.07: AI output is always a *suggestion* — teachers and
 * financial officers review before anything is published. The adapter never
 * writes to domain tables.
 */
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { AIRequest, AIResponse, AIProvider } from "../../domain/model/ai";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/supabase-client";
import { loadConfig } from "./ai-config-storage";
import { executeOpenAIStream } from "../../core/ai/streaming/stream-client";
import { resolveEndpoint } from "../../core/ai/providers/provider-registry";

/** LLM adapter contract — mock + edge + BYOK adapters implement this. */
export interface LLMAdapter {
  generate(request: AIRequest): Promise<Result<AIResponse>>;
}

/** AI features recognized by the `ai-proxy` Edge Function. */
export type AIFeature = "narrative" | "drafting" | "anomaly";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const MOCK_LATENCY_MS = 800;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Feature discriminator for a request. Callers SHOULD set `request.feature`
 * explicitly; when absent, the prompt is inspected (same keyword heuristic
 * the mock uses) so legacy call sites keep working.
 */
export function featureOf(request: AIRequest): AIFeature {
  // T-260: "copilot" is agentic — it has no single-shot feature budget;
  // callers route it through the agent runtime, and this helper only
  // classifies the single-shot paths.
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

/**
 * Server-side system prompts — mirrored from the `ai-proxy` Edge Function
 * so BYOK direct calls produce the same style of output as proxied calls.
 */
function systemPromptForFeature(request: AIRequest, feature: AIFeature): string {
  switch (feature) {
    case "narrative":
      return (
        "You are an expert educational report card narrative writer for Algerian private schools.\n" +
        "Write in formal French. Be specific, balanced (mention strengths and areas for growth), and professional.\n" +
        "The teacher will review and may edit your draft before sending to parents.\n" +
        "Do not invent grades or behaviors not present in the input.\n" +
        "Length: 3-5 paragraphs."
      );
    case "anomaly":
      return (
        "You are a financial anomaly detector for an Algerian private school.\n" +
        "Analyze the provided expense data and identify potential anomalies:\n" +
        "- Duplicate submissions (same amount, same vendor, same period)\n" +
        "- Unusually high amounts vs historical averages\n" +
        "- New vendors not previously used\n" +
        "- Budget overruns\n" +
        "Provide a signal (not a verdict). The human financial officer makes the final decision.\n" +
        'Output JSON: { "signals": [{ "type": "duplication"|"new_vendor"|"budget_overrun"|"amount_outlier", "severity": "low"|"medium"|"high", "explanation": "..." }] }'
      );
    default:
      return (
        "You are an administrative drafting assistant for an Algerian private school.\n" +
        "Write in formal French. Produce clear, concise, and professional administrative documents.\n" +
        "The user will review your draft before sending. Do not invent facts.\n" +
        "Tone: authoritative but respectful."
      );
  }
}

/* ------------------------------------------------------------------ */
/* Mock adapter                                                        */
/* ------------------------------------------------------------------ */

/**
 * Inspect the request to determine which canned response to return.
 * Looks at BOTH the system prompt AND the user prompt so callers can
 * trigger a specific shape from either side.
 */
function pickCannedResponse(request: AIRequest): string {
  const sys = request.systemPrompt.toLowerCase();
  const usr = request.userPrompt.toLowerCase();
  const hay = `${sys}\n${usr}`;

  // Narrative — report card comment in 3 paragraphs.
  if (
    hay.includes("narratif") ||
    hay.includes("bulletin") ||
    hay.includes("commentaire") ||
    hay.includes("appréciation")
  ) {
    return [
      "L'élève a montré un engagement régulier tout au long du trimestre. Les résultats obtenus témoignent d'un travail sérieux, notamment dans les matières à fort coefficient. L'assiduité et la participation en classe restent satisfaisantes.",
      "Quelques difficultés persistantes sont observées en mathématiques, où les automatismes de base doivent être renforcés. Une attention particulière devra être portée à la méthodologie lors des devoirs surveillés. L'élève est encouragé(e) à profiter des séances de soutien pour combler ces lacunes.",
      "Dans l'ensemble, le trimestre est positif. L'élève fait preuve de respect envers le corps enseignant et entretient de bonnes relations avec ses camarades. Les efforts fournis doivent être maintenus afin de consolider les acquis et d'aborder le prochain trimestre avec sérénité.",
    ].join("\n\n");
  }

  // Drafting — formal administrative document.
  if (
    hay.includes("convocation") ||
    hay.includes("alerte") ||
    hay.includes("note de politique") ||
    hay.includes("rédaction") ||
    hay.includes("draft")
  ) {
    return [
      "Objet: Convocation — Rencontre pédagogique",
      "",
      "Madame, Monsieur,",
      "",
      "Par la présente, nous avons l'honneur de vous convoquer à une rencontre pédagogique qui se tiendra dans les locaux de l'établissement. Cette rencontre a pour objet de faire le point sur la scolarité de votre enfant et d'aborder les points suivants:",
      "",
      "  • Résultats académiques du trimestre en cours",
      "  • Assiduité et comportement",
      "  • Mesures d'accompagnement éventuelles",
      "",
      "Nous vous remercions de bien vouloir confirmer votre présence auprès du secrétariat. En cas d'empêchement, une seconde date pourra être proposée.",
      "",
      "Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.",
      "",
      "La Direction",
    ].join("\n");
  }

  // Anomaly explanation — 3-signal pattern.
  if (
    hay.includes("anomalie") ||
    hay.includes("dépense") ||
    hay.includes("anomaly") ||
    hay.includes("fournisseur")
  ) {
    return [
      "Analyse de la dépense — 3 signaux d'anomalie détectés:",
      "",
      "1. Duplication: une dépense identique a été soumise par un autre membre du personnel il y a environ 2 heures.",
      "2. Nouveau fournisseur: le bénéficiaire n'a aucun historique de paiement dans l'établissement.",
      "3. Dépassement budgétaire: le montant est 3 fois supérieur à la moyenne mensuelle de la catégorie concernée.",
      "",
      "Recommandation: demander une justification au soumetteur avant toute approbation. L'IA fournit un signal, l'humain décide toujours.",
    ].join("\n");
  }

  // Generic fallback.
  return "Réponse générée (mock). Le contenu est simulé pour les besoins du développement. En production, cet appel serait proxifié via une Edge Function Supabase vers Groq ou OpenRouter.";
}

/**
 * The mock LLM adapter. Returns canned responses with an 800ms delay.
 *
 * Exported as a singleton — there's no state to reset between calls.
 */
export const mockLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    // Validate the prompt is non-empty. Both prompts are checked: the user
    // prompt is the canonical "input" but the system prompt can also be the
    // carrier (e.g. the narrative generator passes context as the system
    // prompt). If BOTH are empty, return Err.
    if (!request.userPrompt.trim() && !request.systemPrompt.trim()) {
      return Err(
        Errors.validation(
          "Cannot generate with empty prompt",
          "Le prompt ne peut pas être vide.",
        ),
      );
    }

    const start = Date.now();
    await delay(MOCK_LATENCY_MS);
    const content = pickCannedResponse(request);
    const durationMs = Date.now() - start;

    const response: AIResponse = {
      id: newId("ai-resp"),
      requestId: request.id,
      content,
      tokensUsed: Math.max(1, Math.ceil(content.length / 4)),
      durationMs,
      // The mock echoes back the provider from the request so the AIResponse
      // shape stays valid (provider is typed as AIProvider = groq|openrouter).
      provider: request.provider,
      model: request.model,
      finishedAt: new Date().toISOString(),
    };
    return Ok(response);
  },
};

/* ------------------------------------------------------------------ */
/* Edge Function adapter (production — plan §11.02)                    */
/* ------------------------------------------------------------------ */

interface AIProxyOkPayload {
  feature?: string;
  provider?: "groq" | "openrouter";
  model?: string;
  content?: unknown;
  raw_content?: string;
  tokens_used?: number;
  latency_ms?: number;
}

/**
 * Adapter that proxies through the `ai-proxy` Supabase Edge Function.
 *
 * The caller must be authenticated (JWT) and hold the `use_ai` permission —
 * the function enforces both. PII masking happens client-side BEFORE the
 * call: only `AIRequest.maskedContent` crosses the network.
 */
/**
 * T-055 (SEC-002): a NON-EMPTY masked prompt must exist before ANY network
 * transport (edge function or BYOK) is used. The old
 * `request.maskedContent || request.userPrompt` fallback silently shipped the
 * RAW prompt (potentially student names, parent phones, financial details)
 * to Groq/OpenRouter whenever the masking step produced an empty string.
 * The network paths now REFUSE; the local mock may still use the raw prompt
 * (it never leaves the machine).
 */
function hasMaskedContent(request: AIRequest): boolean {
  return typeof request.maskedContent === "string" && request.maskedContent.trim().length > 0;
}

export const edgeLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    // T-055 (SEC-002): refuse to ship the RAW prompt when masking produced
    // nothing — the edge function path is a NETWORK transport. Checked
    // BEFORE the configuration check (a policy violation is a policy
    // violation even when Supabase isn't configured).
    if (!hasMaskedContent(request)) {
      return Err(
        Errors.validation(
          "SEC-002: maskedContent is empty — the ai-proxy path refuses to send the raw prompt.",
        ),
      );
    }
    if (!isSupabaseConfigured()) {
      return Err(
        Errors.server("ai-proxy requires a configured Supabase backend"),
      );
    }
    const startedAt = Date.now();
    try {
      const client = getSupabaseClient();
      const { data, error } = await client.functions.invoke("ai-proxy", {
        body: {
          feature: featureOf(request),
          // Send the PII-masked prompt over the wire (plan §11.02).
          prompt: request.maskedContent,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
        },
      });
      if (error) {
        return Err(Errors.server(`ai-proxy error: ${error.message}`));
      }
      const payload = data as { data?: AIProxyOkPayload; error?: { message?: string } } | AIProxyOkPayload | null;
      const inner = (payload as { data?: AIProxyOkPayload } | null)?.data ?? (payload as AIProxyOkPayload | null);
      if (!inner || (payload as { error?: { message?: string } } | null)?.error) {
        const msg = (payload as { error?: { message?: string } } | null)?.error?.message ?? "ai-proxy returned no data";
        return Err(Errors.server(msg));
      }
      const content =
        typeof inner.raw_content === "string" && inner.raw_content.length > 0
          ? inner.raw_content
          : typeof inner.content === "string"
            ? inner.content
            : JSON.stringify(inner.content ?? "");
      const response: AIResponse = {
        id: newId("ai-resp"),
        requestId: request.id,
        content,
        tokensUsed: inner.tokens_used ?? Math.max(1, Math.ceil(content.length / 4)),
        durationMs: Date.now() - startedAt,
        provider: inner.provider ?? request.provider,
        model: inner.model ?? request.model,
        finishedAt: new Date().toISOString(),
      };
      return Ok(response);
    } catch (err) {
      return Err(
        Errors.server(err instanceof Error ? err.message : "ai-proxy call failed"),
      );
    }
  },
};

/* ------------------------------------------------------------------ */
/* BYOK direct adapter (Groq / OpenRouter / custom OpenAI-compatible)  */
/* ------------------------------------------------------------------ */

/**
 * (T-260) The BYOK transport now uses the shared SSE streaming client
 * (`executeOpenAIStream`) so single-shot feature requests AND agentic
 * conversations share one wire path — and tool calls round-trip for the
 * copilot. The provider fallback chain and the SEC-002 PII policy are
 * preserved verbatim.
 */
type ChatCompletionPayload = {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    name?: string;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>;
  max_tokens: number;
  temperature: number;
  top_p?: number;
  tools?: unknown;
  tool_choice?: string;
  stream?: boolean;
}

async function callChatCompletions(
  endpoint: string,
  apiKey: string,
  body: ChatCompletionPayload,
  extraHeaders: Record<string, string> = {},
): Promise<{ content: string; tokens: number }> {
  const streamResult = await executeOpenAIStream(endpoint, {
    Authorization: `Bearer ${apiKey}`,
    ...extraHeaders,
  }, body, {});
  const content = streamResult.fullContent;
  // Agentic callers consume `toolCalls` via the AIResponse.toolCalls field;
  // this helper is the single-shot leg, where an empty completion is fatal.
  if (!content && streamResult.toolCalls.length === 0) throw new Error("Empty completion");
  return {
    content,
    tokens: Math.max(1, Math.ceil(content.length / 4)),
  };
}

/**
 * BYOK (Bring-Your-Own-Key) direct adapter — used when the Edge Function is
 * not reachable but the administrator configured provider keys in
 * Settings → IA (stored AES-256-GCM encrypted, decrypted only in memory
 * for the lifetime of the call).
 *
 * T-260: three providers (groq / openrouter / custom OpenAI-compatible
 * via `customBaseUrl`) and two request shapes:
 *   - SINGLE-SHOT feature requests (narrative/drafting/anomaly) — the
 *     SEC-002 masked-content policy applies verbatim (raw prompts never
 *     leave the machine);
 *   - AGENTIC requests (`request.messages` present, feature "copilot") —
 *     the full conversation is forwarded as-is: the copilot is deliberately
 *     domain-grounded (tool results contain real balances/GPAs, the staff
 *     user asked about them), gated by the UseAI permission and the
 *     locally-encrypted BYOK key. This mirrors the agent runtime transport.
 *
 * Provider fallback (groq ↔ openrouter) is preserved from the original
 * behavior; `custom_openai` is tried first when selected and never
 * cross-falls-back to a cloud provider (an explicitly local deployment
 * must not silently ship data to Groq/OpenRouter).
 */
export const byokLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    const startedAt = Date.now();
    try {
      const config = await loadConfig();
      const feature = featureOf(request);
      const systemPrompt = systemPromptForFeature(request, feature);

      const isAgentic = Array.isArray(request.messages) && request.messages.length > 0;

      // T-055 (SEC-002): only the PII-masked prompt leaves the machine on
      // the SINGLE-SHOT path — an EMPTY maskedContent BLOCKS this path (it
      // used to silently fall back to the raw prompt, leaking PII).
      if (!isAgentic) {
        if (!hasMaskedContent(request)) {
          return Err(
            Errors.validation(
              "SEC-002: maskedContent is empty — the BYOK path refuses to send the raw prompt.",
            ),
          );
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
      const models: Record<AIProvider, string> = {
        groq: primary === "groq" ? config.defaultModel : (config.fallbackModel ?? "llama-3.3-70b-versatile"),
        openrouter:
          primary === "openrouter"
            ? config.defaultModel
            : (config.fallbackModel ?? "meta-llama/llama-3.3-70b-instruct:free"),
        custom_openai: config.defaultModel,
      };
      const endpoints: Record<AIProvider, string> = {
        groq: "https://api.groq.com/openai/v1/chat/completions",
        openrouter: "https://openrouter.ai/api/v1/chat/completions",
        custom_openai: resolveEndpoint("custom_openai", config.customBaseUrl).chatCompletionsUrl,
      };

      const bodyFor = (model: string): ChatCompletionPayload => {
        if (isAgentic) {
          return {
            model,
            messages: (request.messages ?? []).map((m) => ({
              role: m.role,
              content: m.content,
              name: m.name,
              tool_calls: m.toolCalls,
              tool_call_id: m.toolCallId,
            })),
            max_tokens: request.maxTokens,
            temperature: request.temperature,
            top_p: request.topP,
            stream: request.stream,
          };
        }
        return {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: request.maskedContent },
          ],
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          top_p: request.topP,
        };
      };

      // Primary provider, then fallback (mirrors ai-proxy behavior).
      let lastError: unknown = null;
      for (const provider of providers) {
        const key = keys[provider];
        if (!key && provider !== "custom_openai") continue;
        try {
          const { content, tokens } = await callChatCompletions(
            endpoints[provider],
            key ?? "",
            bodyFor(models[provider]),
            provider === "openrouter" ? { "HTTP-Referer": "https://elimtiyaz.dz" } : {},
          );
          const response: AIResponse = {
            id: newId("ai-resp"),
            requestId: request.id,
            content,
            tokensUsed: tokens,
            durationMs: Date.now() - startedAt,
            provider,
            model: models[provider],
            finishedAt: new Date().toISOString(),
          };
          return Ok(response);
        } catch (err) {
          lastError = err;
          // try the fallback provider
        }
      }
      return Err(
        Errors.server(
          lastError instanceof Error ? lastError.message : "BYOK AI call failed (no provider key configured?)",
        ),
      );
    } catch (err) {
      return Err(Errors.server(err instanceof Error ? err.message : "BYOK AI call failed"));
    }
  },
};

/* ------------------------------------------------------------------ */
/* Routing adapter (default)                                           */
/* ------------------------------------------------------------------ */

/**
 * Default adapter for the app — routes each request through the best
 * available transport:
 *
 *   1. `ai-proxy` Edge Function when a Supabase backend is configured
 *      (canonical production path — keys + rate limiting server-side).
 *   2. BYOK direct call when the Edge Function is unreachable and the
 *      admin configured their own Groq/OpenRouter keys.
 *   3. Mock adapter otherwise (dev/demo environments).
 */
export const defaultLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    if (isSupabaseConfigured()) {
      const edgeResult = await edgeLLMAdapter.generate(request);
      if (edgeResult.ok) return edgeResult;
      // Edge function unavailable (not deployed / 503 not configured) —
      // fall through to BYOK if the admin supplied keys, else mock so the
      // feature keeps working in demo setups.
      const byokResult = await byokLLMAdapter.generate(request);
      if (byokResult.ok) return byokResult;
      return mockLLMAdapter.generate(request);
    }
    const byokResult = await byokLLMAdapter.generate(request);
    if (byokResult.ok) return byokResult;
    return mockLLMAdapter.generate(request);
  },
};
