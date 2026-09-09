/**
 * AI domain model — iteration 7 (plan §11), extended for the Agentic
 * Architecture (T-260, 39th session).
 *
 * Provider stack: Groq (primary) + OpenRouter (fallback) + any
 * OpenAI-compatible endpoint (Ollama / LM Studio / vLLM), all via BYOK.
 * Features:
 *   1. Report Card Narrative Generator (plan §11.05) — teacher review MANDATORY
 *   2. Administrative Drafting Assistant (plan §11.06) — human review required
 *   3. Expense Anomaly Detector (plan §11.07) — signal not verdict
 *   4. Universal Copilot (T-260/T-261) — model-agnostic, streaming, tool
 *      calling, human-in-the-loop action proposals.
 *
 * All AI calls proxy through Edge Functions in production (plan §11.02);
 * the BYOK copilot path calls the provider directly from the desktop with
 * locally-encrypted keys (AES-256-GCM, see ai-config-storage.ts).
 *
 * T-260 extension policy: every pre-existing export is preserved verbatim
 * (PII types, Narrative/Drafting/Anomaly shapes, FR labels) — the agentic
 * types are ADDITIONS so the 2745-test baseline stays green.
 */

export type AIProvider = "groq" | "openrouter" | "custom_openai";

/**
 * A model discovered live from a provider's `/models` endpoint
 * (T-260 — `queryLiveProviderModels`). `supportsTools` is optimistic:
 * most current OpenAI-compatible chat models accept tool schemas.
 */
export interface AIModelInfo {
  readonly id: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly supportsTools: boolean;
  readonly supportsReasoning?: boolean;
}

export interface AIProviderConfig {
  readonly groqApiKey: string | null;
  readonly openRouterApiKey: string | null;
  readonly customApiKey: string | null;
  /** Base URL for the `custom_openai` provider (Ollama/LM Studio/vLLM). */
  readonly customBaseUrl: string | null;
  readonly defaultProvider: AIProvider;
  readonly defaultModel: string;
  readonly fallbackModel: string | null;
  readonly temperature: number;
  readonly topP: number;
  readonly maxTokens: number;
  readonly reasoningEffort?: "default" | "low" | "medium" | "high";
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/* ------------------------------------------------------------------ */
/*  Agent chat protocol (T-260)                                        */
/* ------------------------------------------------------------------ */

export type AIChatRole = "system" | "user" | "assistant" | "tool";

/** An OpenAI-compatible tool call (function calling) request fragment. */
export interface AIToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

/** One message in an agentic conversation (mirrors the chat-completions wire shape). */
export interface AIChatMessage {
  readonly id: string;
  readonly role: AIChatRole;
  readonly content: string | null;
  readonly toolCalls?: readonly AIToolCall[];
  readonly toolCallId?: string;
  readonly name?: string;
  readonly timestamp: string;
}

export interface AIRequest {
  readonly id: string;
  readonly provider: AIProvider;
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maskedContent: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly createdAt: string;
  /**
   * Feature discriminator used by the `ai-proxy` Edge Function and the BYOK
   * adapter to pick the server-side system prompt + token budget
   * (plan §11.05–11.07). Optional — when absent the adapter infers it from
   * the prompt (same heuristic as the mock adapter). T-260 adds `copilot`
   * for the Universal Copilot path.
   */
  readonly feature?: "copilot" | "narrative" | "drafting" | "anomaly";
  /**
   * T-260 (agentic): full multi-turn conversation. When present, the BYOK
   * adapter sends this instead of systemPrompt/userPrompt and forwards
   * `stream` to the provider. The single-shot feature fields stay for the
   * narrative/drafting/anomaly paths.
   */
  readonly messages?: readonly AIChatMessage[];
  readonly stream?: boolean;
  readonly topP?: number;
}

export interface AIResponse {
  readonly id: string;
  readonly requestId: string;
  readonly content: string;
  /** T-260 (agentic): tool calls the model wants executed (function calling). */
  readonly toolCalls?: readonly AIToolCall[];
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly provider: AIProvider;
  readonly model: string;
  readonly finishedAt: string;
}

/* ------------------------------------------------------------------ */
/*  PII masking                                                        */
/* ------------------------------------------------------------------ */

export type PIIPattern = "phone" | "email" | "iban" | "national_id" | "parent_name" | "student_name";

export interface PIIMaskResult {
  readonly masked: string;
  /** Map from placeholder (e.g. "[PHONE_1]") back to the original text. */
  readonly replacements: ReadonlyMap<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Feature-specific request shapes                                    */
/* ------------------------------------------------------------------ */

export interface NarrativeRequest {
  readonly studentId: string;
  readonly studentName: string;
  readonly grades: ReadonlyArray<{ subject: string; average: number }>;
  readonly attendanceRate: number;
  readonly teacherNotes: string;
  readonly term: string;
}

export type DraftType = "convocation" | "parent_alert" | "policy_notice";

export interface DraftingRequest {
  readonly draftType: DraftType;
  readonly keyPoints: readonly string[];
  readonly recipient?: string;
}

export type AnomalySignalType = "duplicate" | "missing_proof" | "budget_overrun" | "new_vendor";

export interface AnomalySignal {
  readonly type: AnomalySignalType;
  readonly description: string;
  readonly severity: "low" | "medium" | "high";
}

export interface AnomalyExplanation {
  readonly expenseId: string;
  readonly signals: readonly AnomalySignal[];
  readonly aiSummary: string;
}

/* ------------------------------------------------------------------ */
/*  Labels                                                             */
/* ------------------------------------------------------------------ */

export const AI_PROVIDER_LABELS_FR: Record<AIProvider, string> = {
  groq: "Groq (Recommandé & Ultra-rapide)",
  openrouter: "OpenRouter (Multi-modèles)",
  custom_openai: "OpenAI-Compatible / Local",
};

export const DRAFT_TYPE_LABELS_FR: Record<DraftType, string> = {
  convocation: "Convocation",
  parent_alert: "Alerte parent",
  policy_notice: "Note de politique",
};

export const PII_PATTERN_LABELS_FR: Record<PIIPattern, string> = {
  phone: "Téléphone",
  email: "Email",
  iban: "IBAN",
  national_id: "NN (N° national)",
  parent_name: "Nom du parent",
  student_name: "Nom de l'élève",
};

export const ANOMALY_SIGNAL_LABELS_FR: Record<AnomalySignalType, string> = {
  duplicate: "Duplication",
  missing_proof: "Justificatif manquant",
  budget_overrun: "Dépassement budgétaire",
  new_vendor: "Nouveau fournisseur",
};

export const ANOMALY_SEVERITY_LABELS_FR: Record<AnomalySignal["severity"], string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
};

/** Default empty config — used when no BYOK keys have been set. */
// (see DEFAULT_AI_PROVIDER_CONFIG below — T-260 extends it with the custom
// provider + sampling parameters while keeping every legacy default.)
export const DEFAULT_AI_PROVIDER_CONFIG: AIProviderConfig = {
  groqApiKey: null,
  openRouterApiKey: null,
  customApiKey: null,
  customBaseUrl: "https://api.groq.com/openai/v1",
  defaultProvider: "groq",
  defaultModel: "qwen/qwen3.8-27b",
  fallbackModel: "llama-3.3-70b-versatile",
  temperature: 0.6,
  topP: 0.95,
  maxTokens: 2048,
  reasoningEffort: "default",
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
};
