/**
 * AI domain model — iteration 7 (plan §11).
 *
 * Provider stack: Groq (primary) + OpenRouter (fallback), both via BYOK.
 * Three AI features:
 *   1. Report Card Narrative Generator (plan §11.05) — teacher review MANDATORY
 *   2. Administrative Drafting Assistant (plan §11.06) — human review required
 *   3. Expense Anomaly Detector (plan §11.07) — signal not verdict
 *
 * All AI calls proxy through Edge Functions in production (plan §11.02).
 * Mock LLM adapter in this iteration.
 */

export type AIProvider = "groq" | "openrouter";

export interface AIProviderConfig {
  readonly groqApiKey: string | null;
  readonly openRouterApiKey: string | null;
  readonly defaultProvider: AIProvider;
  readonly defaultModel: string;
  readonly fallbackModel: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string;
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
}

export interface AIResponse {
  readonly id: string;
  readonly requestId: string;
  readonly content: string;
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
  groq: "Groq",
  openrouter: "OpenRouter",
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
export const DEFAULT_AI_PROVIDER_CONFIG: AIProviderConfig = {
  groqApiKey: null,
  openRouterApiKey: null,
  defaultProvider: "groq",
  defaultModel: "llama-3.3-70b-versatile",
  fallbackModel: null,
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
};
