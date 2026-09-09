// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/agent-runtime.ts
// ============================================================================
/**
 * Agent reasoning & tool-execution runtime (T-260, 39th session).
 *
 * Coordinates a multi-turn conversation with the model:
 *   1. send the conversation + tool schemas (function calling) with
 *      `stream: true`;
 *   2. if the model requests tools → execute each via
 *      `executeSystemTool` against the REAL repositories;
 *   3. feed the tool results back as `role: "tool"` messages and loop;
 *   4. stop at the first tool-free assistant message (the final answer),
 *      or after MAX_TOOL_STEPS rounds (runaway-loop guard).
 *
 * Mutating tools never write directly — `propose_account_adjustment`
 * surfaces an `ActionProposal` through `onActionProposed` for the
 * human-in-the-loop validation card (§15.5/§15.8).
 */
import type { Repositories } from "../../app/providers/repository-provider";
import type { AIChatMessage, AIProviderConfig } from "../../domain/model/ai";
import { SYSTEM_TOOLS_DEFINITIONS, executeSystemTool } from "./tools/system-tools";
import { PROVIDER_ENDPOINTS, resolveEndpoint, safeAuthHeader } from "./providers/provider-registry";
import { executeOpenAIStream } from "./streaming/stream-client";
import type { ActionProposal } from "./agent-types";

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

/** Wire-format message (what actually goes over the wire). */
interface WireMessage {
  role: string;
  content: string | null;
  name?: string;
  tool_calls?: AIChatMessage["toolCalls"];
  tool_call_id?: string;
}

const SYSTEM_PROMPT = `Vous êtes l'Assistant IA Opérationnel et Pédagogique d'El-Imtiyaz, une plateforme scolaire en Algérie.
Vos capacités fondamentales :
1. Vous avez accès à des outils réels pour inspecter les comptes, les élèves, les classes, et les finances.
2. Raisonnez de manière rigoureuse en français professionnel. Si vous devez vérifier des chiffres (soldes, notes, présences), utilisez les outils système au lieu d'inventer des données.
3. Si une information essentielle manque ou est ambiguë pour répondre adéquatement, appelez l'outil 'request_user_clarification' ou posez directement la question à l'utilisateur.
4. Toute proposition d'action financière ou administrative doit être soumise sous forme de proposition pour validation humaine.
5. Soignez la clarté et l'élégance de vos réponses (tableaux, points saillants, format DZD).`;

export class AIAgentRuntime {
  /** Runaway-loop guard: at most 5 model→tool rounds per user turn. */
  private static readonly MAX_TOOL_STEPS = 5;

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
        model: config.defaultModel,
        messages: messagesToSend,
        temperature: config.temperature,
        top_p: config.topP,
        max_tokens: config.maxTokens,
        tools: SYSTEM_TOOLS_DEFINITIONS,
        tool_choice: "auto",
      };

      const result = await executeOpenAIStream(
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
        break; // Final response reached.
      }

      // Execute every requested tool, feed results back as tool messages.
      for (const tc of result.toolCalls) {
        onToolStart(tc.function.name);
        let argsParsed: Record<string, unknown> = {};
        try {
          argsParsed = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          argsParsed = {};
        }

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
