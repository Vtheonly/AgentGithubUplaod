// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/ai/llm-adapter.ts
// ============================================================================
/**
 * LLM adapter — the single routing point for every single-shot AI feature
 * (narrative / drafting / anomaly). T-260 (39th session) added the agentic
 * copilot path; T-266 (41st session) RESTORED the edge-first routing after
 * the unregistered 6ce49b9 patch deleted it (REG-005).
 *
 * Routing order (VAULT §02.06 — "AI Assistant Integration — Full — Groq +
 * OpenRouter" on Desktop):
 *
 *   1. `edgeLLMAdapter` (Supabase mode) → proxies through the `ai-proxy`
 *      Edge Function (plan §11.02: API keys NEVER leave the server; the EF
 *      holds them in Supabase secrets, rate-limits via `ai_request_logs`,
 *      and audit-logs every request). PII is masked client-side BEFORE the
 *      call — only `AIRequest.maskedContent` crosses the network.
 *   2. `byokLLMAdapter` (BYOK fallback) → if the Edge Function is
 *      unavailable (not configured / network error) but the administrator
 *      configured Bring-Your-Own-Key credentials (Settings → IA, stored
 *      AES-256-GCM encrypted), call Groq / OpenRouter / any
 *      OpenAI-compatible endpoint directly. Same SEC-002 masking policy.
 *   3. `mockLLMAdapter` → canned responses for dev/demo environments where
 *      no backend and no keys are configured. NEVER a network transport.
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
import {
  getSupabaseClient,
  isSupabaseConfigured,
} from "../supabase/supabase-client";
import { loadConfig } from "./ai-config-storage";
import { executeOpenAIStream } from "../../core/ai/streaming/stream-client";
import { resolveEndpoint, safeAuthHeader } from "../../core/ai/providers/provider-registry";

/** LLM adapter contract — mock + edge + BYOK adapters implement this. */
export interface LLMAdapter {
  generate(request: AIRequest): Promise<Result<AIResponse>>;
}

/** AI features recognized by the `ai-proxy` Edge Function. */
export type AIFeature = "narrative" | "drafting" | "anomaly";

const MOCK_LATENCY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Feature discriminator for a request. Callers SHOULD set `request.feature`
 * explicitly; when absent, the prompt is inspected (same keyword heuristic
 * the mock uses) so legacy call sites keep working. T-260: "copilot" is
 * agentic — it has no single-shot feature budget; callers route it through
 * the agent runtime, and this helper only classifies the single-shot paths.
 */
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

/** Inspect the request to determine which canned response to return. */
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

/* ------------------------------------------------------------------ */
/* Mock adapter (dev/demo only — never a network transport)            */
/* ------------------------------------------------------------------ */

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
 * T-055 (SEC-002): a NON-EMPTY masked prompt must exist before ANY network
 * transport (edge function or BYOK) is used. The old
 * `request.maskedContent || request.userPrompt` fallback silently shipped
 * the RAW prompt (potentially student names, parent phones, financial
 * details) to Groq/OpenRouter whenever the masking step produced an empty
 * string. The network paths now REFUSE; the local mock may still use the
 * raw prompt (it never leaves the machine).
 */
function hasMaskedContent(request: AIRequest): boolean {
  return (
    typeof request.maskedContent === "string" &&
    request.maskedContent.trim().length > 0
  );
}

/**
 * Adapter that proxies through the `ai-proxy` Supabase Edge Function.
 *
 * The caller must be authenticated (JWT) and hold the `use_ai` permission —
 * the function enforces both. PII masking happens client-side BEFORE the
 * call: only `AIRequest.maskedContent` crosses the network. Restored
 * verbatim by T-266 (41st session) after the unregistered 6ce49b9 patch
 * deleted it (REG-005) — without this adapter, single-shot features
 * bypassed the server-side key custody, rate limiting, and audit logging
 * the EF provides.
 */
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
 * BYOK (Bring-Your-Own-Key) direct adapter — used when the Edge Function is
 * not reachable but the administrator configured provider keys in
 * Settings → IA (stored AES-256-GCM encrypted, decrypted only in memory
 * for the lifetime of the call).
 *
 * Three providers (groq / openrouter / custom OpenAI-compatible via
 * `customBaseUrl`) and two request shapes:
 *   - SINGLE-SHOT feature requests (narrative/drafting/anomaly) — the
 *     SEC-002 masked-content policy applies verbatim (raw prompts never
 *     leave the machine);
 *   - AGENTIC requests (`request.messages` present, feature "copilot") —
 *     the full conversation is forwarded as-is: the copilot is deliberately
 *     domain-grounded (tool results contain real balances/GPAs, the staff
 *     user asked about them), gated by the UseAI permission and the
 *     locally-encrypted BYOK key. See ADR-015 (T-267) for the recorded
 *     decision.
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
      const isAgentic =
        Array.isArray(request.messages) && request.messages.length > 0;

      // T-055 (SEC-002): only the PII-masked prompt leaves the machine on
      // the SINGLE-SHOT path — an EMPTY maskedContent BLOCKS this path.
      // The AGENTIC path (the staff copilot) is deliberately exempt: its
      // tool results are real domain data the staff user asked about
      // (ADR-015), gated by UseAI + the locally-encrypted key.
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

      // T-266 (REG-005 fix): resolve each provider's endpoint + auth header
      // through the CANONICAL provider registry — the 6ce49b9 patch
      // hand-built the header records here and produced
      // `Authorization: Bearer null` when a fallback provider had no key
      // (a null key is now SKIPPED instead of sent).
      const endpoints: Record<AIProvider, string> = {
        groq: resolveEndpoint("groq").chatCompletionsUrl,
        openrouter: resolveEndpoint("openrouter").chatCompletionsUrl,
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
        // T-266 fix: a provider without a key is SKIPPED (never
        // "Bearer null"); custom_openai may legitimately run keyless
        // (plain localhost Ollama) — its registry authHeader already
        // returns {} for an empty key.
        if (!key && provider !== "custom_openai") continue;

        const endpoint = resolveEndpoint(provider, config.customBaseUrl);
        try {
          const streamResult = await executeOpenAIStream(
            endpoints[provider],
            safeAuthHeader(endpoint, key ?? ""),
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

/* ------------------------------------------------------------------ */
/* Default router: edge → BYOK → mock (VAULT §02.06)                   */
/* ------------------------------------------------------------------ */

/**
 * The production router. Order matters:
 *   1. edge (server-held keys, rate limiting, audit logging) — used
 *      whenever Supabase is configured; falls through on EF failure;
 *   2. BYOK (locally-encrypted keys) — used when the EF is unreachable;
 *   3. mock (canned local text) — dev/demo only, NEVER a network call.
 *
 * The silent mock tail is acceptable ONLY for dev/demo: the desktop is an
 * Electron staff terminal and the mock content is obviously generic. Any
 * production deployment with Supabase configured will never reach it.
 */
export const defaultLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    if (isSupabaseConfigured()) {
      const edgeResult = await edgeLLMAdapter.generate(request);
      if (edgeResult.ok) return edgeResult;
    }
    const byokResult = await byokLLMAdapter.generate(request);
    if (byokResult.ok) return byokResult;
    return mockLLMAdapter.generate(request);
  },
};
