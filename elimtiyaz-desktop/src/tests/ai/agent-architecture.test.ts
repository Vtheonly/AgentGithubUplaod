/**
 * T-260 — Agentic AI Architecture regression suite (39th session, 2026-09-10).
 *
 * Pins the agent layer delivered in T-260:
 *   1. Domain model extension — AIProvider gains `custom_openai`,
 *      AIProviderConfig gains the BYOK sampling fields, the agent chat
 *      protocol types (AIChatMessage/AIToolCall), and every LEGACY export
 *      survives (the 2745-test baseline contract).
 *   2. SSE stream client — content-delta reassembly, tool-call fragment
 *      aggregation across chunks, [DONE]/keep-alive handling, HTTP error.
 *   3. Provider registry — endpoint resolution (custom base URL), live
 *      model discovery ({data:[…]} + bare-array shapes, error path).
 *   4. System tools — the six tool schemas; execution against the REAL
 *      mock repositories + canonical calc engines (search, ledger summary,
 *      academic profile, kpis, adjustment PROPOSAL — never a direct write,
 *      clarification, unknown tool).
 *   5. Agent runtime — the multi-turn loop: missing-key guard; a full
 *      tool-call round (fetch #1 returns a tool call → tool executes →
 *      fetch #2 returns the final answer) with onTextDelta/onToolStart/
 *      onToolFinish/onActionProposed wired; the runaway-loop guard.
 *   6. BYOK storage — round-trip with the new fields (3 encrypted keys +
 *      sampling params); legacy payload loads with defaults filled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  AI_PROVIDER_LABELS_FR,
  DEFAULT_AI_PROVIDER_CONFIG,
  DRAFT_TYPE_LABELS_FR,
  PII_PATTERN_LABELS_FR,
  ANOMALY_SIGNAL_LABELS_FR,
  type AIProvider,
  type AIProviderConfig,
  type AIChatMessage,
} from "../../domain/model/ai";
import { executeOpenAIStream } from "../../core/ai/streaming/stream-client";
import {
  PROVIDER_ENDPOINTS,
  resolveEndpoint,
  queryLiveProviderModels,
} from "../../core/ai/providers/provider-registry";
import {
  SYSTEM_TOOLS_DEFINITIONS,
  executeSystemTool,
} from "../../core/ai/tools/system-tools";
import { AIAgentRuntime } from "../../core/ai/agent-runtime";
import { loadConfig, saveConfig, readRawStored, clearConfig } from "../../infrastructure/ai/ai-config-storage";
import { mockRepositories } from "../../app/providers/repository-provider";

/* ------------------------------------------------------------------ */
/*  Helpers: build SSE streams + wire-format messages                  */
/* ------------------------------------------------------------------ */

/** Build a fetch Response whose body streams the given SSE lines. */
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
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
}

const DONE = "data: [DONE]";

function userMsg(content: string): AIChatMessage {
  return { id: `u-${content.length}`, role: "user", content, timestamp: "2026-09-10T00:00:00Z" };
}

/** A minimal config for runtime tests (groq, key set). */
const RUNTIME_CONFIG: AIProviderConfig = {
  ...DEFAULT_AI_PROVIDER_CONFIG,
  groqApiKey: "gsk-test-key",
  defaultModel: "openai/gpt-oss-120b",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ================================================================
 * 1. Domain model extension (backward compatibility contract)
 * ================================================================ */

describe("T-260 — domain model extension", () => {
  it("AIProvider accepts custom_openai alongside groq + openrouter", () => {
    const providers: AIProvider[] = ["groq", "openrouter", "custom_openai"];
    expect(providers).toHaveLength(3);
  });

  it("provider labels cover all three providers", () => {
    expect(Object.keys(AI_PROVIDER_LABELS_FR).sort()).toEqual([
      "custom_openai",
      "groq",
      "openrouter",
    ]);
  });

  it("DEFAULT_AI_PROVIDER_CONFIG carries the BYOK sampling fields + custom provider", () => {
    expect(DEFAULT_AI_PROVIDER_CONFIG.customApiKey).toBeNull();
    expect(DEFAULT_AI_PROVIDER_CONFIG.customBaseUrl).toBe("https://api.groq.com/openai/v1");
    expect(DEFAULT_AI_PROVIDER_CONFIG.temperature).toBe(0.6);
    expect(DEFAULT_AI_PROVIDER_CONFIG.topP).toBe(0.95);
    expect(DEFAULT_AI_PROVIDER_CONFIG.maxTokens).toBe(2048);
    // T-269 (LIVE evidence): defaults must be models the owner's Groq key
    // can actually reach — probed through the deployed ai-proxy EF
    // (2026-09-09): gpt-oss-120b/20b stream; every llama-*/qwen-* id 404s
    // (removed from the 2026 catalog). The multi-model trio:
    // reasoning flagship default + fast 20b + fallback.
    expect(DEFAULT_AI_PROVIDER_CONFIG.defaultModel).toBe("openai/gpt-oss-120b");
    expect(DEFAULT_AI_PROVIDER_CONFIG.fastModel).toBe("openai/gpt-oss-20b");
    expect(DEFAULT_AI_PROVIDER_CONFIG.reasoningModel).toBe("openai/gpt-oss-120b");
    expect(DEFAULT_AI_PROVIDER_CONFIG.fallbackModel).toBe("openai/gpt-oss-20b");
  });

  it("every LEGACY export survives (the 2745-test baseline contract)", () => {
    // The narrative/drafting/anomaly feature types + FR labels must all
    // still exist — the pre-existing modals depend on them.
    expect(DRAFT_TYPE_LABELS_FR.convocation).toBe("Convocation");
    expect(PII_PATTERN_LABELS_FR.phone).toBe("Téléphone");
    expect(ANOMALY_SIGNAL_LABELS_FR.duplicate).toBe("Duplication");
  });
});

/* ================================================================
 * 2. SSE stream client
 * ================================================================ */

describe("T-260 — executeOpenAIStream (SSE parser)", () => {
  it("reassembles chunked content deltas into the full text", async () => {
    const deltas = ["Bonjour ", "le ", "monde"];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        sseChunk({ choices: [{ delta: { content: deltas[0] } }] }),
        sseChunk({ choices: [{ delta: { content: deltas[1] } }] }),
        sseChunk({ choices: [{ delta: { content: deltas[2] } }] }),
        DONE,
      ]),
    );

    const seen: string[] = [];
    const result = await executeOpenAIStream(
      "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: "Bearer k" },
      { model: "m", messages: [] },
      { onDelta: (d) => seen.push(d) },
    );

    expect(result.fullContent).toBe("Bonjour le monde");
    expect(seen).toEqual(deltas);
    expect(result.toolCalls).toHaveLength(0);
  });

  it("aggregates tool-call fragments across multiple SSE chunks (indexed)", async () => {
    // Groq streams tool calls as: first chunk carries id+name, later chunks
    // append argument fragments on the SAME index.
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        sseChunk({
          choices: [
            { delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "search_entities", arguments: '{"que' } }] } },
          ],
        }),
        sseChunk({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"Benali"}' } }] } },
          ],
        }),
        sseChunk({
          choices: [
            { delta: { tool_calls: [{ index: 1, id: "call_2", function: { name: "get_school_kpi_overview", arguments: "{}" } }] } },
          ],
        }),
        DONE,
      ]),
    );

    const result = await executeOpenAIStream(
      "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: "Bearer k" },
      { model: "m", messages: [] },
      {},
    );

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].id).toBe("call_1");
    expect(result.toolCalls[0].function.name).toBe("search_entities");
    expect(result.toolCalls[0].function.arguments).toBe('{"query":"Benali"}');
    expect(result.toolCalls[1].function.name).toBe("get_school_kpi_overview");
  });

  it("ignores keep-alive comments and [DONE]; survives malformed JSON lines", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        ": keep-alive",
        "data: {not json",
        sseChunk({ choices: [{ delta: { content: "ok" } }] }),
        DONE,
      ]),
    );
    const result = await executeOpenAIStream("u", {}, { model: "m", messages: [] }, {});
    expect(result.fullContent).toBe("ok");
  });

  it("throws with the HTTP status + body text on a non-OK response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("quota exceeded", { status: 429 }),
    );
    await expect(
      executeOpenAIStream("u", {}, { model: "m", messages: [] }, {}),
    ).rejects.toThrow("HTTP 429");
  });

  it("always sends stream:true on the wire with the auth header", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([DONE]));
    await executeOpenAIStream(
      "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: "Bearer gsk-xyz" },
      { model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "hi" }] },
      {},
    );
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer gsk-xyz");
    expect(JSON.parse(init.body).stream).toBe(true);
  });
});

/* ================================================================
 * 3. Provider registry
 * ================================================================ */

describe("T-260 — provider registry + live model discovery", () => {
  it("exposes endpoints for all three providers", () => {
    expect(PROVIDER_ENDPOINTS.groq.modelsUrl).toBe("https://api.groq.com/openai/v1/models");
    expect(PROVIDER_ENDPOINTS.openrouter.chatCompletionsUrl).toContain("openrouter.ai");
    expect(PROVIDER_ENDPOINTS.custom_openai.chatCompletionsUrl).toContain("localhost:11434");
  });

  it("resolveEndpoint overrides the custom provider URLs from a base URL", () => {
    const e = resolveEndpoint("custom_openai", "http://192.168.1.20:1234/v1/");
    expect(e.chatCompletionsUrl).toBe("http://192.168.1.20:1234/v1/chat/completions");
    expect(e.modelsUrl).toBe("http://192.168.1.20:1234/v1/models");
  });

  it("queryLiveProviderModels parses the { data: [...] } shape and sorts ids", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile", context_window: 131072 }, { id: "qwen/qwen3.8-27b" }] }),
        { status: 200 },
      ),
    );
    const models = await queryLiveProviderModels("groq", "gsk-k");
    expect(models.map((m) => m.id)).toEqual(["llama-3.3-70b-versatile", "qwen/qwen3.8-27b"]);
    expect(models[0].contextWindow).toBe(131072);
    expect(models[0].supportsTools).toBe(true);
  });

  it("queryLiveProviderModels parses the bare-array shape (local servers)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify([{ id: "qwen2.5:7b" }]), { status: 200 }),
    );
    const models = await queryLiveProviderModels("custom_openai", "", "http://localhost:11434/v1");
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("qwen2.5:7b");
  });

  it("queryLiveProviderModels throws on HTTP failure", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(queryLiveProviderModels("groq", "bad-key")).rejects.toThrow("HTTP 401");
  });
});

/* ================================================================
 * 4. System tools (REAL repositories + canonical engines)
 * ================================================================ */

describe("T-260 — system tool definitions", () => {
  it("declares the 12 domain tools with JSON-schema parameters (T-267 deep set)", () => {
    // T-267: the registry grew from 6 to 12 — the deep debt-collection,
    // attendance, class-performance, payment-history and reminder-
    // proposal tools the owner's production-quality mandate required.
    expect(SYSTEM_TOOLS_DEFINITIONS).toHaveLength(12);
    const names = SYSTEM_TOOLS_DEFINITIONS.map((d) => d.function.name);
    expect(names).toEqual([
      "search_entities",
      "get_financial_ledger_summary",
      "get_overdue_accounts",
      "get_collection_analytics",
      "get_payment_history",
      "get_student_academic_profile",
      "get_student_attendance",
      "get_class_performance",
      "get_school_kpi_overview",
      "propose_account_adjustment",
      "propose_payment_reminder",
      "request_user_clarification",
    ]);
    for (const def of SYSTEM_TOOLS_DEFINITIONS) {
      expect(def.type).toBe("function");
      expect(def.function.description.length).toBeGreaterThan(10);
      expect(def.function.parameters.type).toBe("object");
    }
    // required arrays reference declared properties
    const search = SYSTEM_TOOLS_DEFINITIONS[0];
    expect(search.function.parameters.required).toEqual(["query"]);
    expect(Object.keys(search.function.parameters.properties)).toContain("entity_type");
  });
});

describe("T-260 — executeSystemTool against the mock repositories", () => {
  it("search_entities finds seeded parents by name and returns a JSON envelope", async () => {
    const out = await executeSystemTool(
      "search_entities",
      { query: "Benali" },
      mockRepositories,
    );
    const parsed = JSON.parse(out) as {
      matched_parents: Array<{ id: string; name: string; code: string }>;
      matched_students: unknown[];
      matched_classes: unknown[];
    };
    expect(parsed.matched_parents.length).toBeGreaterThan(0);
    expect(parsed.matched_parents[0].code).toContain("PAR-");
  });

  it("get_financial_ledger_summary computes via the canonical engine for a seeded parent", async () => {
    const out = await executeSystemTool(
      "get_financial_ledger_summary",
      { parent_id: "par-001" },
      mockRepositories,
    );
    const parsed = JSON.parse(out) as {
      parent_name: string;
      parent_code: string;
      total_outstanding_balance: number;
      open_installments: Array<{ label: string; amount_due: number }>;
    };
    expect(parsed.parent_name.toLowerCase()).toContain("benali");
    expect(parsed.parent_code).toContain("PAR-");
    expect(typeof parsed.total_outstanding_balance).toBe("number");
    expect(Array.isArray(parsed.open_installments)).toBe(true);
  });

  it("get_financial_ledger_summary reports a missing parent as a JSON error (never throws)", async () => {
    const out = await executeSystemTool(
      "get_financial_ledger_summary",
      { parent_id: "par-does-not-exist" },
      mockRepositories,
    );
    expect(JSON.parse(out)).toEqual({ error: "Parent introuvable." });
  });

  it("get_student_academic_profile returns GPA fields from the canonical engine", async () => {
    // Find a seeded student id first (search tool against the mock store).
    const search = await executeSystemTool(
      "search_entities",
      { query: "e" },
      mockRepositories,
    );
    const students = (JSON.parse(search) as { matched_students: Array<{ id: string }> }).matched_students;
    if (students.length === 0) return; // defensive: seed-dependent
    const out = await executeSystemTool(
      "get_student_academic_profile",
      { student_id: students[0].id },
      mockRepositories,
    );
    const parsed = JSON.parse(out) as {
      code: string;
      gpa: number | null;
      is_passing: boolean;
      current_term: string;
    };
    expect(parsed.code).toContain("ELV-");
    expect(typeof parsed.is_passing).toBe("boolean");
    expect(parsed.current_term.length).toBeGreaterThan(0);
  });

  it("get_school_kpi_overview passes the repository KPIs through", async () => {
    const out = await executeSystemTool("get_school_kpi_overview", {}, mockRepositories);
    const parsed = JSON.parse(out) as { totalStudents: number; outstandingDebt: number };
    expect(typeof parsed.totalStudents).toBe("number");
  });

  it("propose_account_adjustment emits a PENDING proposal (never writes)", async () => {
    const proposals: Array<{ type: string; status: string; payload: Record<string, unknown> }> = [];
    const out = await executeSystemTool(
      "propose_account_adjustment",
      { parent_id: "par-001", amount: -15000, reason: "Remise exceptionnelle" },
      mockRepositories,
      (p) => proposals.push(p),
    );
    const parsed = JSON.parse(out) as { status: string; proposal_id: string };
    expect(parsed.status).toBe("proposal_generated");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].type).toBe("account_adjustment");
    expect(proposals[0].status).toBe("pending");
    expect(proposals[0].payload.amount).toBe(-15000);
  });

  it("request_user_clarification round-trips the question", async () => {
    const out = await executeSystemTool(
      "request_user_clarification",
      { question: "Quel parent ?" },
      mockRepositories,
    );
    expect(JSON.parse(out)).toEqual({
      status: "clarification_needed",
      question: "Quel parent ?",
      details: undefined,
    });
  });

  it("unknown tool → JSON error, never a throw", async () => {
    const out = await executeSystemTool("drop_database", {}, mockRepositories);
    expect(JSON.parse(out)).toEqual({ error: "Outil inconnu : drop_database" });
  });
});

/* ================================================================
 * 5. Agent runtime (multi-turn tool loop)
 * ================================================================ */

describe("T-260 — AIAgentRuntime.runConversationStep", () => {
  it("refuses to run without an API key for cloud providers", async () => {
    await expect(
      AIAgentRuntime.runConversationStep({
        config: { ...RUNTIME_CONFIG, groqApiKey: null },
        conversation: [userMsg("Bonjour")],
        repositories: mockRepositories,
        onTextDelta: () => {},
        onToolStart: () => {},
        onToolFinish: () => {},
        onActionProposed: () => {},
      }),
    ).rejects.toThrow("Clé API manquante");
  });

  it("executes a full tool round: tool call → execution → final answer", async () => {
    // Round 1: the model requests search_entities.
    // Round 2: given the tool result, the model answers.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        sseResponse([
          sseChunk({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", function: { name: "search_entities", arguments: '{"query":"Benali"}' } },
                  ],
                },
              },
            ],
          }),
          DONE,
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          sseChunk({ choices: [{ delta: { content: "J'ai trouvé la " } }] }),
          sseChunk({ choices: [{ delta: { content: "famille Benali." } }] }),
          DONE,
        ]),
      );

    const toolStarts: string[] = [];
    const toolFinishes: string[] = [];
    const deltas: string[] = [];

    const result = await AIAgentRuntime.runConversationStep({
      config: RUNTIME_CONFIG,
      conversation: [userMsg("Trouve la famille Benali")],
      repositories: mockRepositories,
      onTextDelta: (d) => deltas.push(d),
      onToolStart: (n) => toolStarts.push(n),
      onToolFinish: (n, r) => toolFinishes.push(`${n}:${r.slice(0, 20)}`),
      onActionProposed: () => {},
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(toolStarts).toEqual(["search_entities"]);
    expect(toolFinishes).toHaveLength(1);
    expect(deltas.join("")).toBe("J'ai trouvé la famille Benali.");

    // The conversation now contains: user, assistant(toolCalls), tool, assistant(final)
    const roles = result.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
    const toolMessage = result.find((m) => m.role === "tool");
    expect(toolMessage?.name).toBe("search_entities");
    expect(toolMessage?.toolCallId).toBe("call_1");
    const final = result[result.length - 1];
    expect(final.content).toBe("J'ai trouvé la famille Benali.");
  });

  it("stops at the runaway guard when the model keeps requesting tools", async () => {
    // Every round returns a fresh tool call — the loop must cap at
    // MAX_TOOL_STEPS (5) instead of spinning forever.
    const toolCallRound = () =>
      sseResponse([
        sseChunk({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: `call_${Math.random()}`, function: { name: "get_school_kpi_overview", arguments: "{}" } },
                ],
              },
            },
          ],
        }),
        DONE,
      ]);
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => toolCallRound());

    let toolStarts = 0;
    const result = await AIAgentRuntime.runConversationStep({
      config: RUNTIME_CONFIG,
      conversation: [userMsg("loop")],
      repositories: mockRepositories,
      onTextDelta: () => {},
      onToolStart: () => {
        toolStarts++;
      },
      onToolFinish: () => {},
      onActionProposed: () => {},
    });

    expect(toolStarts).toBe(5);
    // user + 5×(assistant + tool)
    expect(result).toHaveLength(11);
  });

  it("sends the system prompt + ALL tools + tool_choice:auto on the wire (T-266: slicing removed)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([sseChunk({ choices: [{ delta: { content: "salut" } }] }), DONE]),
    );
    await AIAgentRuntime.runConversationStep({
      config: RUNTIME_CONFIG,
      conversation: [userMsg("hello")],
      repositories: mockRepositories,
      onTextDelta: () => {},
      onToolStart: () => {},
      onToolFinish: () => {},
      onActionProposed: () => {},
    });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("El-Imtiyaz");
    // T-266 (REG-005 repair): EVERY tool schema is always on the wire —
    // the 6ce49b9 patch sliced tools on French keywords, so "hello"
    // (FAST tier) saw only 3 schemas and any non-keyword financial
    // question silently lost financial capability. The runtime asserts
    // the FULL registry (not a hardcoded count) so future deep tools
    // (T-267) extend this contract automatically.
    expect(body.tools).toHaveLength(SYSTEM_TOOLS_DEFINITIONS.length);
    expect(SYSTEM_TOOLS_DEFINITIONS.length).toBeGreaterThanOrEqual(6);
    expect(body.tool_choice).toBe("auto");
    // "hello" routes to the FAST tier (fastModel = gpt-oss-20b).
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.max_tokens).toBe(RUNTIME_CONFIG.maxTokens);
  });

  it("routes a reasoning-tier query to the reasoning model with the same full tool set", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([sseChunk({ choices: [{ delta: { content: "ok" } }] }), DONE]),
    );
    await AIAgentRuntime.runConversationStep({
      config: RUNTIME_CONFIG,
      conversation: [userMsg("Analyse comparatif des moyennes générales par classe")],
      repositories: mockRepositories,
      onTextDelta: () => {},
      onToolStart: () => {},
      onToolFinish: () => {},
      onActionProposed: () => {},
    });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // "Analyse comparatif" → HEAVY_REASONING → reasoningModel
    // (= openai/gpt-oss-120b in DEFAULT_AI_PROVIDER_CONFIG).
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.tools).toHaveLength(SYSTEM_TOOLS_DEFINITIONS.length);
  });
});

/* ================================================================
 * 6. BYOK storage extension
 * ================================================================ */

describe("T-260 — ai-config-storage (3 encrypted keys + sampling)", () => {
  it("round-trips the full extended config without plaintext keys at rest", async () => {
    const cfg: AIProviderConfig = {
      ...DEFAULT_AI_PROVIDER_CONFIG,
      groqApiKey: "gsk-plain-secret",
      openRouterApiKey: "sk-or-plain",
      customApiKey: "local-key",
      customBaseUrl: "http://localhost:11434/v1",
      defaultProvider: "custom_openai",
      defaultModel: "qwen2.5:14b",
      temperature: 0.3,
      topP: 0.9,
      maxTokens: 1024,
      updatedAt: "2026-09-10T10:00:00Z",
      updatedBy: "admin-001",
    };
    await saveConfig(cfg);

    const raw = readRawStored();
    expect(raw).not.toBeNull();
    expect(raw!.groqApiKeyEnc).not.toContain("gsk-plain-secret");
    expect(raw!.customApiKeyEnc).not.toBeNull();
    expect(raw!.customBaseUrl).toBe("http://localhost:11434/v1");
    expect(raw!.temperature).toBe(0.3);

    const loaded = await loadConfig();
    expect(loaded.groqApiKey).toBe("gsk-plain-secret");
    expect(loaded.openRouterApiKey).toBe("sk-or-plain");
    expect(loaded.customApiKey).toBe("local-key");
    expect(loaded.customBaseUrl).toBe("http://localhost:11434/v1");
    expect(loaded.temperature).toBe(0.3);
    expect(loaded.topP).toBe(0.9);
    expect(loaded.maxTokens).toBe(1024);

    clearConfig();
    expect(readRawStored()).toBeNull();
  });

  it("loads a LEGACY payload (pre-T-260 shape) with the new defaults filled in", async () => {
    const legacy = {
      groqApiKeyEnc: null,
      openRouterApiKeyEnc: null,
      defaultProvider: "groq",
      defaultModel: "openai/gpt-oss-120b",
      fallbackModel: null,
      updatedAt: "2026-08-01T00:00:00Z",
      updatedBy: "admin-001",
    };
    localStorage.setItem("el-imtiyaz:ai-config", JSON.stringify(legacy));

    const loaded = await loadConfig();
    expect(loaded.customApiKey).toBeNull();
    expect(loaded.customBaseUrl).toBe(DEFAULT_AI_PROVIDER_CONFIG.customBaseUrl);
    expect(loaded.temperature).toBe(DEFAULT_AI_PROVIDER_CONFIG.temperature);
    expect(loaded.topP).toBe(DEFAULT_AI_PROVIDER_CONFIG.topP);
    expect(loaded.maxTokens).toBe(DEFAULT_AI_PROVIDER_CONFIG.maxTokens);
    expect(loaded.defaultModel).toBe("openai/gpt-oss-120b");
  });
});
