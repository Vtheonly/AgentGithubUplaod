// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/streaming/stream-client.ts
// ============================================================================
/**
 * Streaming SSE client for OpenAI-compatible chat completions
 * (T-260, 39th session — the Agentic AI Architecture).
 *
 * A low-latency, browser-native Server-Sent-Events consumer that adheres to
 * the Groq / OpenAI streaming format (`stream: true`): it reconstitutes
 * chunked text deltas into the full assistant message AND reassembles
 * fragmented `tool_calls` (Groq streams tool-call arguments as many small
 * `function.arguments` fragments indexed by `tc.index`) into complete
 * `AIToolCall[]` objects.
 *
 * Used by:
 *   - the agent runtime loop (./agent-runtime.ts) — multi-turn reasoning;
 *   - the BYOK LLM adapter (src/infrastructure/ai/llm-adapter.ts) —
 *     single-shot feature requests upgraded to streaming;
 *   - the settings tab inference test (latency probe).
 *
 * jsdom note: fetch streams are unavailable in tests — the test suite feeds
 * a mocked `Response` whose `body` is a ReadableStream built from string
 * chunks, which exercises the exact same parser path.
 */
import type { AIToolCall } from "../../../domain/model/ai";

export interface StreamCallbacks {
  /** Fired for every content delta chunk (the live typing effect). */
  onDelta?: (deltaText: string) => void;
  /** Fired whenever tool-call fragments are (re-)aggregated. */
  onToolCallDelta?: (toolCalls: AIToolCall[]) => void;
}

export interface StreamResult {
  fullContent: string;
  toolCalls: AIToolCall[];
}

/**
 * POST `{ ...body, stream: true }` to `url` and consume the SSE response.
 *
 * @param url     chat-completions endpoint
 * @param headers auth headers (Authorization: Bearer …)
 * @param body    request payload (messages/model/temperature/…)
 * @param callbacks live-delta handlers
 * @param signal  optional AbortSignal (user cancels a running stream)
 */
export async function executeOpenAIStream(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error("Réponse de flux vide du serveur.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullContent = "";
  const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;
      const dataStr = trimmed.replace(/^data:\s*/, "");
      if (dataStr === "[DONE]") continue;

      try {
        const parsed = JSON.parse(dataStr);
        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          fullContent += delta.content;
          callbacks.onDelta?.(delta.content);
        }

        if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            const current =
              toolCallsMap.get(index) ?? { id: tc.id || "", name: tc.function?.name || "", args: "" };
            if (tc.id) current.id = tc.id;
            if (tc.function?.name) current.name = tc.function.name;
            if (tc.function?.arguments) current.args += tc.function.arguments;
            toolCallsMap.set(index, current);
          }
          const aggregated: AIToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.args },
          }));
          callbacks.onToolCallDelta?.(aggregated);
        }
      } catch {
        // Skip malformed chunk (can happen when a JSON payload is split
        // across SSE lines — the next chunk completes it).
      }
    }
  }

  const finalToolCalls: AIToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
    id: tc.id,
    type: "function",
    function: { name: tc.name, arguments: tc.args },
  }));

  return { fullContent, toolCalls: finalToolCalls };
}
