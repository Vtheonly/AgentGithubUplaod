// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/agent-runtime.ts
// ============================================================================
/**
 * Agent reasoning & tool-execution runtime (T-260, 39th session;
 * repaired T-266, 41st session — REG-005).
 *
 * Coordinates a multi-turn conversation with the model:
 *   1. send the conversation + ALL tool schemas (function calling) with
 *      `stream: true`;
 *   2. if the model requests tools → execute each via
 *      `executeSystemTool` against the REAL repositories;
 *   3. feed the tool results back as `role: "tool"` messages and loop;
 *   4. stop at the first tool-free assistant message (the final answer),
 *      or after MAX_TOOL_STEPS rounds (runaway-loop guard).
 *
 * Model-tier routing (T-266): the 6ce49b9 patch's keyword intent
 * classifier is KEPT for MODEL SELECTION only (fast vs reasoning tier —
 * a misroute costs latency/quality, never capability), but its tool
 * SLICING is REMOVED: slicing tool availability on French keyword
 * matches produced silent misroutes (e.g. "qui me doit de l'argent ?"
 * → FAST slice with no financial tool), the model could not call tools
 * whose schemas were withheld, and the claimed "~75% token footprint"
 * reduction is negligible for a ~10-schema payload on Groq's 128k
 * context. ALL tools are always on the wire; the model decides.
 *
 * T-277 (42nd session): the registry grew to 27 tools (analysis /
 * visualization / document / workflow suites — tool-registry.ts), the
 * system prompt now teaches the CAPABILITY map (charts, documents,
 * campaigns) and the workflow discipline (search → analyze → visualize
 * → propose), and MAX_TOOL_STEPS rose 5 → 8: the composite workflows
 * (e.g. plan campaign → batch reminders → payment plan → document)
 * legitimately chain 4–6 tool rounds plus a final synthesis; 5 was
 * cutting them mid-flight. 8 keeps the runaway-loop guard meaningful.
 *
 * Mutating tools never write directly — `propose_account_adjustment`,
 * `propose_payment_reminder` and `propose_batch_reminders` surface an
 * `ActionProposal` through `onActionProposed` for the
 * human-in-the-loop validation card (§15.5/§15.8).
 */
import type { Repositories } from "../../app/providers/repository-provider";
import type { AIChatMessage, AIProviderConfig } from "../../domain/model/ai";
import { SYSTEM_TOOLS_DEFINITIONS, executeSystemTool } from "./tools/tool-registry";
import type { ActionProposal } from "./agent-types";
import { PROVIDER_ENDPOINTS, resolveEndpoint, safeAuthHeader } from "./providers/provider-registry";
import { executeOpenAIStream } from "./streaming/stream-client";

export interface AgentRunOptions {
  config: AIProviderConfig;
  conversation: readonly AIChatMessage[];
  repositories: Repositories;
  onTextDelta: (delta: string) => void;
  onToolStart: (toolName: string) => void;
  onToolFinish: (toolName: string, result: string) => void;
  onActionProposed: (proposal: ActionProposal) => void;
  signal?: AbortSignal;
}

interface WireMessage {
  role: string;
  content: string | null;
  name?: string;
  tool_calls?: AIChatMessage["toolCalls"];
  tool_call_id?: string;
}

type TaskComplexity = "FAST_SEARCH" | "MODERATE_INSPECTION" | "HEAVY_REASONING";

const SYSTEM_PROMPT = `Vous êtes l'Assistant IA Opérationnel et Pédagogique d'El-Imtiyaz, une plateforme scolaire en Algérie.

CAPACITÉS (27 outils système) :
1. LECTURE DOMAINES : recherche, situations financières, créances, assiduité, bulletins, KPIs.
2. ANALYSE : statistiques descriptives, tendances de revenus, détection d'anomalies (paiements/assiduité/notes), comparaison de classes, démographie.
3. VISUALISATION : graphiques (render_chart) et diagrammes structurels (draw_relationship_diagram) affichés dans la conversation.
4. DOCUMENTS : relevés de compte, rapports de classe, feuilles de recouvrement, plans de paiement (PDF) et exports Excel/CSV téléchargeables.
5. WORKFLOWS : campagnes de recouvrement priorisées, rappels groupés, plans de paiement échelonnés, recommandations d'intervention pédagogique.

RÈGLES STRICTES :
1. Raisonnez de manière rigoureuse en français professionnel.
2. Ne JAMAIS inventer de données chiffrées : appelez les outils système pour chaque chiffre.
3. Toute modification financière passe par une proposition (propose_account_adjustment, propose_batch_reminders) — jamais d'écriture directe.
4. WORKFLOW DISCIPLINE : pour une question complexe, enchaînez recherche → analyse → visualisation, puis PROPOSEZ une action concrète. Terminez par une synthèse claire avec les prochaines étapes.
5. ILLUSTREZ systématiquement vos analyses : les outils d'analyse retournent des graphiques automatiques ; utilisez render_chart pour toute comparaison personnalisée.
6. PROPOSEZ des documents téléchargeables (generate_*) quand l'utilisateur a besoin d'un support officiel.
7. Soignez la présentation : tableaux et listes Markdown, montants en DZD formatés.`;

export class AIAgentRuntime {
  /**
   * T-277: 8 tool rounds (was 5) — the composite workflows legitimately
   * chain 4–6 rounds (search → analyze → visualize → propose → document)
   * before the final synthesis; the runaway-loop guard stays meaningful.
   */
  private static readonly MAX_TOOL_STEPS = 8;

  /**
   * Analyzes query intent to pick the optimal MODEL TIER ONLY.
   *
   * T-266 repair: tool slicing removed (see file header) — the return
   * value never restricts tool availability; it only steers the
   * fast/reasoning model selection. A keyword misroute is therefore
   * harmless: the fast model still sees every tool schema.
   */
  private static analyzeIntent(lastUserQuery: string): TaskComplexity {
    const q = lastUserQuery.toLowerCase();

    // Heavy reasoning triggers (finance adjustment, multi-step math, GPA
    // evaluation, comparative analysis). "analyse" is deliberately broad —
    // the reasoning tier is the safe default for synthesis questions.
    const isHeavyReasoning =
      q.includes("remise") ||
      q.includes("ajustement") ||
      q.includes("débit") ||
      q.includes("crédit") ||
      q.includes("moyenne générale") ||
      q.includes("gpa") ||
      q.includes("bulletin") ||
      q.includes("comparatif") ||
      q.includes("analyse") ||
      q.includes("prévision") ||
      q.includes("forecast");
    if (isHeavyReasoning) return "HEAVY_REASONING";

    // Financial inspection — moderate questions benefit from the fast
    // tier but never lose financial capability (all tools remain wired).
    if (
      q.includes("solde") ||
      q.includes("impayé") ||
      q.includes("créance") ||
      q.includes("tranche") ||
      q.includes("dette") ||
      q.includes("retard")
    ) {
      return "MODERATE_INSPECTION";
    }

    // Academic & student notes.
    if (
      q.includes("note") ||
      q.includes("élève") ||
      q.includes("classe") ||
      q.includes("présence") ||
      q.includes("absence")
    ) {
      return "MODERATE_INSPECTION";
    }

    // Simple search & macro questions.
    return "FAST_SEARCH";
  }

  /**
   * Selects the target model based on task complexity and user configuration.
   */
  private static selectModel(
    complexity: TaskComplexity,
    config: AIProviderConfig,
    activeOverride?: string,
  ): string {
    if (activeOverride) return activeOverride;
    if (!config.enableSmartRouting) return config.defaultModel;

    switch (complexity) {
      case "FAST_SEARCH":
        return config.fastModel || config.defaultModel;
      case "MODERATE_INSPECTION":
        return config.fastModel || config.defaultModel;
      case "HEAVY_REASONING":
        return config.reasoningModel || config.defaultModel;
    }
  }

  public static async runConversationStep(options: AgentRunOptions): Promise<AIChatMessage[]> {
    const {
      config,
      conversation,
      repositories,
      onTextDelta,
      onToolStart,
      onToolFinish,
      onActionProposed,
      signal,
    } = options;

    const apiKey =
      config.defaultProvider === "groq"
        ? config.groqApiKey
        : config.defaultProvider === "openrouter"
          ? config.openRouterApiKey
          : config.customApiKey;

    if (!apiKey && config.defaultProvider !== "custom_openai") {
      throw new Error("Clé API manquante pour le fournisseur configuré.");
    }

    const endpoint = resolveEndpoint(
      config.defaultProvider,
      config.defaultProvider === "custom_openai" ? config.customBaseUrl : null,
    );
    const url =
      config.defaultProvider === "custom_openai" && config.customBaseUrl
        ? endpoint.chatCompletionsUrl
        : PROVIDER_ENDPOINTS[config.defaultProvider].chatCompletionsUrl;
    const headers = safeAuthHeader(endpoint, apiKey ?? "");

    // Extract the latest user query for routing
    const lastUserMsg = [...conversation].reverse().find((m) => m.role === "user");
    const userQueryText = lastUserMsg?.content ?? "";

    // 1. Route task tier (model selection only — see file header)
    const complexity = this.analyzeIntent(userQueryText);
    let activeModel = this.selectModel(complexity, config);

    const systemMsg: AIChatMessage = {
      id: "sys-0",
      role: "system",
      content: SYSTEM_PROMPT,
      timestamp: new Date().toISOString(),
    };

    const messagesToSend: WireMessage[] = [
      { role: "system", content: systemMsg.content },
      ...conversation.map((m) => ({
        role: m.role,
        content: m.content,
        name: m.name,
        tool_calls: m.toolCalls,
        tool_call_id: m.toolCallId,
      })),
    ];

    const workingConversation = [...conversation];
    let stepCount = 0;

    while (stepCount < this.MAX_TOOL_STEPS) {
      stepCount++;

      const body = {
        model: activeModel,
        messages: messagesToSend,
        temperature: complexity === "FAST_SEARCH" ? 0.2 : config.temperature,
        top_p: config.topP,
        max_tokens: config.maxTokens,
        // T-266: ALL tools always on the wire (slicing removed — REG-005).
        tools: SYSTEM_TOOLS_DEFINITIONS.length > 0 ? SYSTEM_TOOLS_DEFINITIONS : undefined,
        tool_choice: SYSTEM_TOOLS_DEFINITIONS.length > 0 ? "auto" : undefined,
      };

      let result;
      try {
        result = await executeOpenAIStream(
          url,
          headers,
          body,
          {
            onDelta: (text) => {
              onTextDelta(text);
            },
          },
          signal,
        );
      } catch (err) {
        const is429 =
          err instanceof Error &&
          (err.message.includes("429") || err.message.toLowerCase().includes("rate limit"));

        if (is429 && config.fallbackModel && activeModel !== config.fallbackModel) {
          console.warn(
            `[AIAgentRuntime] Rate limit (429) hit on ${activeModel}. Retrying with fallback: ${config.fallbackModel}`,
          );
          activeModel = config.fallbackModel;
          body.model = activeModel;

          try {
            result = await executeOpenAIStream(
              url,
              headers,
              body,
              {
                onDelta: (text) => {
                  onTextDelta(text);
                },
              },
              signal,
            );
          } catch (fallbackErr) {
            const still429 =
              fallbackErr instanceof Error &&
              (fallbackErr.message.includes("429") ||
                fallbackErr.message.toLowerCase().includes("rate limit"));
            // T-281 (AI-312): the stream client already backed off and
            // retried both models — a persistent 429 needs a HUMAN-readable
            // verdict, not a raw provider body (the owner's console showed
            // five bare 429s with no guidance).
            if (still429) {
              throw new Error(
                `Limite de débit atteinte sur ${activeModel} et ${config.fallbackModel} ` +
                  "(HTTP 429 — quota Groq épuisé pour la minute en cours). " +
                  "Patientez environ une minute avant de renvoyer la question, ou réglez " +
                  "des modèles plus légers dans Réglages → IA.",
              );
            }
            throw fallbackErr;
          }
        } else {
          if (is429) {
            // T-281 (AI-312): no fallback model configured (or it IS the
            // active one) — same human verdict as above.
            throw new Error(
              `Limite de débit atteinte sur ${activeModel} (HTTP 429 — quota Groq ` +
                "épuisé pour la minute en cours). Patientez environ une minute avant de " +
                "renvoyer la question, ou réglez un modèle de secours dans Réglages → IA.",
            );
          }
          throw err;
        }
      }

      const assistantMsg: AIChatMessage = {
        id: `ast-${Date.now()}-${stepCount}`,
        role: "assistant",
        content: result.fullContent || null,
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        timestamp: new Date().toISOString(),
      };

      workingConversation.push(assistantMsg);
      messagesToSend.push({
        role: "assistant",
        content: assistantMsg.content,
        tool_calls: assistantMsg.toolCalls,
        name: undefined,
        tool_call_id: undefined,
      });

      if (result.toolCalls.length === 0) {
        break; // Finished
      }

      // Execute requested tools
      for (const tc of result.toolCalls) {
        onToolStart(tc.function.name);
        let argsParsed: Record<string, unknown> = {};
        try {
          argsParsed = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          argsParsed = {};
        }

        // NOTE (T-266): the 6ce49b9 patch's "guardrail" here was a
        // console.warn that did NOTHING — a fake safety net. Real argument
        // validation for mutating proposals now lives INSIDE
        // executeSystemTool (see system-tools.ts, T-267), which returns a
        // structured { error } the model must react to — enforcement, not
        // logging.

        const toolOutput = await executeSystemTool(
          tc.function.name,
          argsParsed,
          repositories,
          onActionProposed,
        );

        onToolFinish(tc.function.name, toolOutput);

        const toolMsg: AIChatMessage = {
          id: `tool-${Date.now()}-${tc.id}`,
          role: "tool",
          content: toolOutput,
          toolCallId: tc.id,
          name: tc.function.name,
          timestamp: new Date().toISOString(),
        };

        workingConversation.push(toolMsg);
        messagesToSend.push({
          role: "tool",
          content: toolMsg.content,
          tool_call_id: toolMsg.toolCallId,
          name: toolMsg.name,
          tool_calls: undefined,
        });
      }
    }

    return workingConversation;
  }
}