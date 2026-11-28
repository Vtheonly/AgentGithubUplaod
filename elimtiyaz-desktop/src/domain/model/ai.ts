/**
 * AI domain model — iteration 7 (plan §11), extended T-260 (39th session,
 * the Agentic Architecture) and T-266 (41st session, REG-005 repair).
 *
 * Features:
 *   1. Report Card Narrative Generator (plan §11.05) — teacher review MANDATORY
 *   2. Administrative Drafting Assistant (plan §11.06) — human review required
 *   3. Expense Anomaly Detector (plan §11.07) — signal not verdict
 *   4. Universal Copilot (T-260/T-261) — model-agnostic, streaming, tool
 *      calling, human-in-the-loop action proposals.
 *
 * Routing: single-shot features proxy through the `ai-proxy` Edge
 * Function in production (plan §11.02); the BYOK paths call the provider
 * directly from the desktop with locally-encrypted keys (AES-256-GCM,
 * see ai-config-storage.ts).
 *
 * DEFAULT models (T-266/T-269): every default MUST be a model the
 * owner's LIVE Groq key can actually reach — verified 2026-09-09 by
 * probing through the deployed ai-proxy EF: every llama-… and qwen-… id
 * returns 404 model_not_found (removed from Groq's 2026 catalog for
 * this account); openai/gpt-oss-120b and openai/gpt-oss-20b stream
 * successfully. Defaults pinned to the reachable trio:
 *   - defaultModel:   `openai/gpt-oss-120b` (reasoning flagship)
 *   - fastModel:      `openai/gpt-oss-20b` (fast tier)
 *   - reasoningModel: `openai/gpt-oss-120b`
 *   - fallbackModel:  `openai/gpt-oss-20b`
 * The settings tab's live model discovery (`queryLiveProviderModels`)
 * re-derives the list per key, so a future catalog change is a
 * one-click selection away — never a code change.
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
  /** Default general model — a REAL Groq model id (see file header). */
  readonly defaultModel: string;
  /** Fast model for search, routing, and simple formatting. */
  readonly fastModel: string;
  /** Heavy reasoning model for finance, GPA, and complex synthesis. */
  readonly reasoningModel: string;
  /** Fallback model used when primary models hit rate limits (429). */
  readonly fallbackModel: string | null;
  /** Enable dynamic multi-model task routing (fast vs reasoning tier). */
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
/*  T-627 (C-25): the tenant-level NON-SECRET AI config share           */
/* ------------------------------------------------------------------ */

/**
 * The NON-SECRET subset of `AIProviderConfig` that syncs to the tenant
 * row (`ai.provider_config`, migration 0007 — `save_public_setting`).
 *
 * The SECRETS (the three provider API keys) NEVER enter the tenant row
 * (settings-stores.md rule 3: they stay device-local AES-256-GCM under the
 * per-device keychain passphrase — keys can never sync). The tenant row is
 * the NON-SECRET truth (provider / models / sampling): what another clerk
 * on another machine must see. The device store serves as the offline
 * cache; the tenant row wins at read (`loadConfig`'s tenant overlay).
 */
export interface TenantAIConfigShare {
  readonly customBaseUrl: string | null;
  readonly defaultProvider: AIProvider;
  readonly defaultModel: string;
  readonly fastModel: string;
  readonly reasoningModel: string;
  readonly fallbackModel: string | null;
  readonly enableSmartRouting: boolean;
  readonly temperature: number;
  readonly topP: number;
  readonly maxTokens: number;
  readonly reasoningEffort?: "default" | "low" | "medium" | "high";
}

/** Extract the non-secret share of a full config (the mirror direction). */
export function toTenantAIConfigShare(config: AIProviderConfig): TenantAIConfigShare {
  return {
    customBaseUrl: config.customBaseUrl,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    fastModel: config.fastModel,
    reasoningModel: config.reasoningModel,
    fallbackModel: config.fallbackModel,
    enableSmartRouting: config.enableSmartRouting,
    temperature: config.temperature,
    topP: config.topP,
    maxTokens: config.maxTokens,
    reasoningEffort: config.reasoningEffort,
  };
}

/**
 * Apply the tenant share OVER a (device-loaded) config — the overlay
 * direction. The device values keep the SECRETS (which the share never
 * carries); every non-secret field the share names comes from the tenant
 * row (the tenant is the truth; the device store is the offline cache).
 */
export function mergeTenantAIConfigShare(
  config: AIProviderConfig,
  share: TenantAIConfigShare,
): AIProviderConfig {
  return {
    ...config,
    customBaseUrl: share.customBaseUrl,
    defaultProvider: share.defaultProvider,
    defaultModel: share.defaultModel,
    fastModel: share.fastModel,
    reasoningModel: share.reasoningModel,
    fallbackModel: share.fallbackModel,
    enableSmartRouting: share.enableSmartRouting,
    temperature: share.temperature,
    topP: share.topP,
    maxTokens: share.maxTokens,
    reasoningEffort: share.reasoningEffort,
  };
}

/**
 * Parse + validate a raw tenant-row value into a share — null when the
 * row is absent/`null` ("never configured") or fails the shape check
 * (fail-open: the caller degrades to the device/offline values, never
 * throws — the read path must not crash on a malformed row).
 */
export function parseTenantAIConfigShare(raw: unknown): TenantAIConfigShare | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const providers: AIProvider[] = ["groq", "openrouter", "custom_openai"];
  if (
    typeof o.customBaseUrl !== "string" && o.customBaseUrl !== null
  ) return null;
  if (!providers.includes(o.defaultProvider as AIProvider)) return null;
  if (typeof o.defaultModel !== "string" || o.defaultModel.length === 0) return null;
  if (typeof o.fastModel !== "string") return null;
  if (typeof o.reasoningModel !== "string") return null;
  if (typeof o.fallbackModel !== "string" && o.fallbackModel !== null) return null;
  if (typeof o.enableSmartRouting !== "boolean") return null;
  if (typeof o.temperature !== "number") return null;
  if (typeof o.topP !== "number") return null;
  if (typeof o.maxTokens !== "number") return null;
  const effort = o.reasoningEffort;
  if (
    effort !== undefined &&
    !(["default", "low", "medium", "high"] as const).includes(
      effort as "default" | "low" | "medium" | "high",
    )
  ) return null;
  return {
    customBaseUrl: (o.customBaseUrl as string | null) ?? null,
    defaultProvider: o.defaultProvider as AIProvider,
    defaultModel: o.defaultModel as string,
    fastModel: o.fastModel as string,
    reasoningModel: o.reasoningModel as string,
    fallbackModel: (o.fallbackModel as string | null) ?? null,
    enableSmartRouting: o.enableSmartRouting as boolean,
    temperature: o.temperature as number,
    topP: o.topP as number,
    maxTokens: o.maxTokens as number,
    reasoningEffort: effort as TenantAIConfigShare["reasoningEffort"],
  };
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
  // LIVE-verified 2026-09-09 (T-269, through the deployed EF — see file
  // header): gpt-oss-120b/20b are the reachable Groq models for the
  // owner's key; the legacy llama-3.3-70b/3.1-8b ids 404.
  defaultModel: "openai/gpt-oss-120b",
  fastModel: "openai/gpt-oss-20b",
  reasoningModel: "openai/gpt-oss-120b",
  fallbackModel: "openai/gpt-oss-20b",
  enableSmartRouting: true,
  temperature: 0.6,
  topP: 0.95,
  maxTokens: 2048,
  reasoningEffort: "default",
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
};
