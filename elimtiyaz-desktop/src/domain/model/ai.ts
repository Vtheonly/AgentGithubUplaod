/**
 * AI domain model — iteration 7 (plan §11), extended for the Multi-Model
 * Agentic Architecture (T-260/T-261).
 *
 * Provider stack: Groq (primary) + OpenRouter (fallback) + any
 * OpenAI-compatible endpoint (Ollama / LM Studio / vLLM), all via BYOK.
 */

export type AIProvider = "groq" | "openrouter" | "custom_openai";

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
  /** Base URL for the custom_openai provider (Ollama/LM Studio/vLLM). */
  readonly customBaseUrl: string | null;
  readonly defaultProvider: AIProvider;
  /** Primary / Default general model */
  readonly defaultModel: string;
  /** Fast model dedicated to search, routing, and simple formatting */
  readonly fastModel: string;
  /** Heavy reasoning model dedicated to finance, GPA, and complex calculations */
  readonly reasoningModel: string;
  /** Fallback model used when primary models hit rate limits (429) */
  readonly fallbackModel: string | null;
  /** Enable dynamic multi-model task routing */
  readonly enableSmartRouting: boolean;
  readonly temperature: number;
  readonly topP: number;
  readonly maxTokens: number;
  readonly reasoningEffort?: "default" | "low" | "medium" | "high";
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/* ------------------------------------------------------------------ */
/*  Agent chat protocol                                               */
/* ------------------------------------------------------------------ */

export type AIChatRole = "system" | "user" | "assistant" | "tool";

export interface AIToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

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
  readonly feature?: "copilot" | "narrative" | "drafting" | "anomaly";
  readonly messages?: readonly AIChatMessage[];
  readonly stream?: boolean;
  readonly topP?: number;
}

export interface AIResponse {
  readonly id: string;
  readonly requestId: string;
  readonly content: string;
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

export type PIIPattern =
  | "phone"
  | "email"
  | "iban"
  | "national_id"
  | "parent_name"
  | "student_name";

export interface PIIMaskResult {
  readonly masked: string;
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

export type AnomalySignalType =
  | "duplicate"
  | "missing_proof"
  | "budget_overrun"
  | "new_vendor";

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
/*  Labels & Defaults                                                 */
/* ------------------------------------------------------------------ */

export const AI_PROVIDER_LABELS_FR: Record<AIProvider, string> = {
  groq: "Groq (Ultra-rapide & Recommandé)",
  openrouter: "OpenRouter (Multi-fournisseurs)",
  custom_openai: "OpenAI-Compatible / Serveur Local",
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

export const ANOMALY_SEVERITY_LABELS_FR: Record<
  AnomalySignal["severity"],
  string
> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
};

export const DEFAULT_AI_PROVIDER_CONFIG: AIProviderConfig = {
  groqApiKey: null,
  openRouterApiKey: null,
  customApiKey: null,
  customBaseUrl: "https://api.groq.com/openai/v1",
  defaultProvider: "groq",
  defaultModel: "llama-3.3-70b-versatile",
  fastModel: "llama-3.1-8b-instant",
  reasoningModel: "llama-3.3-70b-versatile",
  fallbackModel: "llama-3.1-8b-instant",
  enableSmartRouting: true,
  temperature: 0.5,
  topP: 0.95,
  maxTokens: 2048,
  reasoningEffort: "default",
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
};
