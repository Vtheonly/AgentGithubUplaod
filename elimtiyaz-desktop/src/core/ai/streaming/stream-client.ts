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
 * T-281 (AI-312, 43rd session): the initial POST now RETRIES transient
 * failures automatically — HTTP 429 (rate limit) and 5xx — with
 * exponential backoff (800ms → 1.6s → …, capped) and `Retry-After`
 * header honouring (both the seconds form and the HTTP-date form).
 * The owner's console showed 5 consecutive Groq 429s with every copilot
 * turn failing: the free-tier limits are per-minute, so an IMMEDIATE
 * retry (the old behavior — none) could never succeed. Retries are
 * aborted instantly when the caller's AbortSignal fires (the copilot's
 * stop button). Non-retryable statuses (400/401/403/404…) still throw
 * immediately, and the exhausted case throws the SAME
 * `HTTP <status>: <body>` shape the runtime's 429 detection reads.
 *
 * `STREAM_RETRY` is exported so tests can shorten/disable the delays
 * (module-import mutation — the same pattern the repo uses for injectable
 * test seams).
 *
 * @param url     chat-completions endpoint
 * @param headers auth headers (Authorization: Bearer …)
 * @param body    request payload (messages/model/temperature/…)
 * @param callbacks live-delta handlers
 * @param signal  optional AbortSignal (user cancels a running stream)
 */
export const STREAM_RETRY = {
  /** Total attempts per call (1 = no retry). */
  maxAttempts: 3,
  /** First backoff delay (ms) — doubled per subsequent attempt. */
  baseDelayMs: 800,
  /** Hard ceiling for one backoff delay (ms). */
  maxDelayMs: 10_000,
  /** Upper jitter bound added to every delay (ms) — desynchronizes bursts. */
  jitterMs: 250,
};

/** Statuses that indicate a TRANSIENT condition worth retrying. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Parse a `Retry-After` header (seconds or HTTP-date) into a delay in ms. */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

/** Compute the backoff delay for attempt N (1-based). */
function backoffDelayMs(attempt: number, retryAfterMs: number | null): number {
  const raw =
    retryAfterMs ?? STREAM_RETRY.baseDelayMs * 2 ** (attempt - 1);
  const jitter = STREAM_RETRY.jitterMs > 0 ? Math.random() * STREAM_RETRY.jitterMs : 0;
  return Math.min(STREAM_RETRY.maxDelayMs, raw + jitter);
}

/** setTimeout-based sleep that rejects as soon as `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Read the error body defensively (a consumed/locked body must not mask the status). */
async function readErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export async function executeOpenAIStream(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  let response: Response;
  let attempt = 0;

  // T-281 (AI-312): transient-retry loop around the INITIAL POST only —
  // once a 200 stream begins, failures are not retryable (partial content
  // was already delivered to the caller's callbacks).
  for (;;) {
    attempt++;
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });

    if (response.ok || attempt >= STREAM_RETRY.maxAttempts) break;
    if (!RETRYABLE_STATUSES.has(response.status)) break;

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    await sleep(backoffDelayMs(attempt, retryAfterMs), signal);
  }

  if (!response.ok) {
    const errorText = await readErrorText(response);
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
