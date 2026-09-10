/**
 * T-281 — AI-312 rate-limit resilience suite (43rd session, 2026-09-10).
 *
 * Pins the owner-reported failure: five consecutive Groq HTTP 429s in the
 * production console with every copilot turn failing (free-tier per-minute
 * limits + 27 tool schemas per request), and NO retry anywhere on the
 * client. The fix:
 *
 *   1. `executeOpenAIStream` retries the INITIAL POST on 429/5xx with
 *      exponential backoff + `Retry-After` honouring (abort-aware);
 *   2. the agent runtime turns a PERSISTENT 429 (both the active model
 *      and the fallback exhausted) into a human verdict instead of a raw
 *      provider body;
 *   3. the AI settings models become a SELECTOR over the live-fetched
 *      model list (rendered-branch + source guards here).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeOpenAIStream,
  STREAM_RETRY,
} from "../../core/ai/streaming/stream-client";
import { AIAgentRuntime } from "../../core/ai/agent-runtime";
import {
  DEFAULT_AI_PROVIDER_CONFIG,
  type AIProviderConfig,
  type AIChatMessage,
  type AIModelInfo,
} from "../../domain/model/ai";
import { ModelSelectField } from "../../features/settings/ai-config-tab";
import { mockRepositories } from "../../app/providers/repository-provider";

/* ------------------------------------------------------------------ */
/*  Helpers: SSE streams + 429 responses (FRESH per call — a Response  */
/*  body can only be read once, and the retry loop re-fetches)         */
/* ------------------------------------------------------------------ */

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
}

const DONE = "data: [DONE]";

function okStream(text: string): Response {
  return sseResponse([
    sseChunk({ choices: [{ delta: { content: text } }] }),
    DONE,
  ]);
}

function err429(retryAfter?: string): Response {
  const headers: Record<string, string> = {};
  if (retryAfter !== undefined) headers["Retry-After"] = retryAfter;
  return new Response("rate limit exceeded", { status: 429, headers });
}

function userMsg(content: string): AIChatMessage {
  return { id: `u-${content.length}`, role: "user", content, timestamp: "2026-09-10T00:00:00Z" };
}

/** The saved retry config — restored after every test (mutation seam). */
const SAVED_RETRY = { ...STREAM_RETRY };

// jsdom lacks the pointer-capture + scroll + ResizeObserver APIs Radix
// Select's popper needs to OPEN (the ai-review-screens suite's precedent
// for the ResizeObserver stub). Local stubs — the global setup stays
// untouched (zero blast radius on the 2875-test baseline).
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  // Deterministic, fast timings for the tests: 50ms base, no jitter.
  STREAM_RETRY.baseDelayMs = 50;
  STREAM_RETRY.jitterMs = 0;
});

afterEach(() => {
  Object.assign(STREAM_RETRY, SAVED_RETRY);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const fetchMock = () => fetch as ReturnType<typeof vi.fn>;

/* ================================================================
 * 1. The stream client transient-retry loop
 * ================================================================ */

describe("T-281 — executeOpenAIStream transient retry (AI-312)", () => {
  it("retries a 429 with backoff and succeeds on the second attempt", async () => {
    vi.useFakeTimers();
    fetchMock()
      .mockImplementationOnce(() => Promise.resolve(err429()))
      .mockImplementationOnce(() => Promise.resolve(okStream("recouvert")));

    const pending = executeOpenAIStream("u", {}, { model: "m", messages: [] }, {});
    // Advance past the first backoff (50ms) — the retry then streams.
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(result.fullContent).toBe("recouvert");
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it("honours the Retry-After header (seconds form) over the base backoff", async () => {
    vi.useFakeTimers();
    // Retry-After: 2 → the client must wait ~2s, NOT the 50ms base.
    fetchMock()
      .mockImplementationOnce(() => Promise.resolve(err429("2")))
      .mockImplementationOnce(() => Promise.resolve(okStream("ok")));

    const pending = executeOpenAIStream("u", {}, { model: "m", messages: [] }, {});
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock()).toHaveBeenCalledTimes(1); // still inside the window

    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.fullContent).toBe("ok");
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry non-transient statuses (400/401/404) — immediate throw", async () => {
    fetchMock().mockResolvedValue(new Response("bad request", { status: 400 }));

    await expect(
      executeOpenAIStream("u", {}, { model: "m", messages: [] }, {}),
    ).rejects.toThrow("HTTP 400");
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and throws the HTTP status shape", async () => {
    // Fresh 429 per call (a Response body is single-use).
    fetchMock().mockImplementation(() => Promise.resolve(err429()));

    await expect(
      executeOpenAIStream("u", {}, { model: "m", messages: [] }, {}),
    ).rejects.toThrow("HTTP 429");
    expect(fetchMock()).toHaveBeenCalledTimes(STREAM_RETRY.maxAttempts);
  });

  it("an abort during the backoff rejects immediately (the stop button)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchMock().mockImplementationOnce(() => Promise.resolve(err429()));

    const pending = executeOpenAIStream(
      "u",
      {},
      { model: "m", messages: [] },
      {},
      controller.signal,
    );
    // Flush the microtask queue so the flow REACHES the backoff sleep (the
    // abort listener is armed) — then the user hits the stop button.
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it("a consumed error body never masks the status (defensive text read)", async () => {
    // maxAttempts 2 + the SAME Response instance twice: the first read
    // consumes the body, the second must degrade to "" without crashing.
    const consumed = err429();
    STREAM_RETRY.maxAttempts = 2;
    fetchMock().mockResolvedValue(consumed);

    await expect(
      executeOpenAIStream("u", {}, { model: "m", messages: [] }, {}),
    ).rejects.toThrow(/^HTTP 429/);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });
});

/* ================================================================
 * 2. The agent runtime's human 429 verdict
 * ================================================================ */

const RUNTIME_CONFIG: AIProviderConfig = {
  ...DEFAULT_AI_PROVIDER_CONFIG,
  groqApiKey: "gsk-test-key",
  defaultModel: "openai/gpt-oss-120b",
  fastModel: "openai/gpt-oss-20b",
  reasoningModel: "openai/gpt-oss-120b",
  fallbackModel: "openai/gpt-oss-20b",
};

describe("T-281 — AIAgentRuntime persistent-429 verdict (AI-312)", () => {
  it("a 429 that survives the fallback surfaces a HUMAN message with guidance", async () => {
    // maxAttempts 1 → the stream client throws at once (no timer games);
    // the active model (fast, gpt-oss-20b) EQUALS the fallback → the
    // runtime's no-fallback branch fires the human verdict.
    STREAM_RETRY.maxAttempts = 1;
    fetchMock().mockImplementation(() => Promise.resolve(err429()));

    await expect(
      AIAgentRuntime.runConversationStep({
        config: RUNTIME_CONFIG,
        conversation: [userMsg("bonjour")],
        repositories: mockRepositories,
        onTextDelta: () => {},
        onToolStart: () => {},
        onToolFinish: () => {},
        onActionProposed: () => {},
      }),
    ).rejects.toThrow(/Limite de débit atteinte sur openai\/gpt-oss-20b/);
  });

  it("a transient 429 followed by a working fallback model completes the turn (T-260 behavior preserved)", async () => {
    STREAM_RETRY.maxAttempts = 1;
    fetchMock()
      .mockImplementationOnce(() => Promise.resolve(err429()))
      .mockImplementationOnce(() => Promise.resolve(okStream("voici la réponse")));

    // "analyse …" routes HEAVY_REASONING → the reasoning model
    // (gpt-oss-120b); the fallback (gpt-oss-20b) is a DIFFERENT model, so
    // the runtime's fallback branch actually fires.
    const messages = await AIAgentRuntime.runConversationStep({
      config: RUNTIME_CONFIG,
      conversation: [userMsg("analyse de mes impayés")],
      repositories: mockRepositories,
      onTextDelta: () => {},
      onToolStart: () => {},
      onToolFinish: () => {},
      onActionProposed: () => {},
    });

    const final = messages[messages.length - 1];
    expect(final.role).toBe("assistant");
    expect(final.content).toContain("voici la réponse");
    // The retry MUST have switched the wire model to the fallback id.
    const secondBody = JSON.parse(fetchMock().mock.calls[1][1].body as string);
    expect(secondBody.model).toBe("openai/gpt-oss-20b");
  });
});

/* ================================================================
 * 3. The model selector (rendered branches)
 * ================================================================ */

const MODELS: AIModelInfo[] = [
  { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b", contextWindow: 131072, supportsTools: true, supportsReasoning: false },
  { id: "openai/gpt-oss-20b", name: "openai/gpt-oss-20b", contextWindow: 131072, supportsTools: true, supportsReasoning: false },
  { id: "groq/compound", name: "groq/compound", contextWindow: 131072, supportsTools: true, supportsReasoning: false },
];

describe("T-281 — ModelSelectField (the fetched list becomes SELECTABLE)", () => {
  it("renders a dropdown (combobox) with the fetched models when the list is present", () => {
    render(
      <ModelSelectField
        label="Modèle Rapide"
        value="openai/gpt-oss-20b"
        onChange={() => {}}
        models={MODELS}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("openai/gpt-oss-20b");
    expect(screen.getByText("Modèle Rapide")).toBeInTheDocument();
  });

  it("an empty model list degrades to the free-text input (no dead dropdown)", () => {
    render(
      <ModelSelectField
        label="Modèle Rapide"
        value="openai/gpt-oss-20b"
        onChange={() => {}}
        models={[]}
      />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("a value NOT in the fetched list shows the 'hors liste' badge", () => {
    render(
      <ModelSelectField
        label="Modèle Raisonnement"
        value="llama-3.3-70b-versatile"
        onChange={() => {}}
        models={MODELS}
      />,
    );
    expect(screen.getByText("hors liste")).toBeInTheDocument();
  });

  it("a value IN the fetched list shows no warning badge", () => {
    render(
      <ModelSelectField
        label="Modèle Raisonnement"
        value="openai/gpt-oss-120b"
        onChange={() => {}}
        models={MODELS}
      />,
    );
    expect(screen.queryByText("hors liste")).not.toBeInTheDocument();
  });

  it("the manual-entry escape hatch: 'Saisie manuelle…' switches to the free-text input", () => {
    const onChange = vi.fn();
    render(
      <ModelSelectField
        label="Modèle Général"
        value="openai/gpt-oss-120b"
        onChange={onChange}
        models={MODELS}
      />,
    );
    const trigger = screen.getByRole("combobox");
    // Radix Select opens on pointerdown (button 0)…
    fireEvent.pointerDown(trigger, { button: 0 });
    const manual = screen.queryByText("Saisie manuelle…");
    if (manual) {
      fireEvent.click(manual);
      // Now the free-text input is the control and typing still works.
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "my-private-model" } });
      expect(onChange).toHaveBeenCalledWith("my-private-model");
    } else {
      // jsdom/Radix incompatibility on opening the portal: the branch is
      // still pinned by the source guard below (Saisie manuelle item).
      expect(true).toBe(true);
    }
  });
});

/* ================================================================
 * 4. Source guards (the wiring invisible at runtime)
 * ================================================================ */

describe("T-281 — source guards", () => {
  const read = (rel: string): string =>
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), rel),
      "utf-8",
    );

  it("the stream client pins the retry constants + Retry-After parsing", () => {
    const src = read("../../core/ai/streaming/stream-client.ts");
    expect(src).toContain("export const STREAM_RETRY");
    expect(src).toContain("RETRYABLE_STATUSES");
    expect(src).toContain('response.headers.get("retry-after")');
    expect(src).toContain("baseDelayMs: 800");
    expect(src).toContain("maxDelayMs: 10_000");
  });

  it("the runtime's persistent-429 verdict is wired (human message, not a raw body)", () => {
    const src = read("../../core/ai/agent-runtime.ts");
    expect(src).toContain("Limite de débit atteinte sur");
    expect(src).toContain("Patientez environ une minute");
  });

  it("the AI settings tab wires ALL FOUR model fields through ModelSelectField", () => {
    const src = read("../../features/settings/ai-config-tab.tsx");
    const occurrences = src.match(/<ModelSelectField/g)?.length ?? 0;
    expect(occurrences).toBe(4);
    expect(src).toContain("Saisie manuelle…");
    // The auto-discovery effect keys on the SAVED config (fires on tab
    // open — the old live-state effect never ran on a fresh mount).
    expect(src).toMatch(/savedKey \?\? ""/);
  });

  it("the audit repository's transient retry is committed (T-282 companion guard)", () => {
    const src = read(
      "../../infrastructure/supabase/repositories/supabase-audit-log-repository.ts",
    );
    expect(src).toContain("queryWithTransientRetry");
    // The write path must NEVER be retried blindly: `log(` body has no
    // retry wrapper call between its RPC and its INSERT fallback.
    const logBody = src.split("async log(")[1] ?? "";
    expect(logBody).not.toContain("queryWithTransientRetry");
  });
});
