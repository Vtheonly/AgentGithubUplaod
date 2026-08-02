/**
 * LLM adapter — abstraction over the LLM provider (Groq / OpenRouter).
 *
 * Per plan §11.02: in production, real adapter implementations are deployed
 * as Supabase Edge Functions so the API key NEVER leaves the server. The
 * desktop client calls the Edge Function; the Edge Function holds the
 * decrypted key in a Supabase secret and proxies to Groq/OpenRouter.
 *
 * For iteration 7 (scaffold), only the `mockLLMAdapter` is wired in. It
 * returns canned responses after an 800ms simulated network delay. The
 * mock inspects the request's `systemPrompt` + `userPrompt` for keywords
 * and returns a contextually-appropriate canned response:
 *
 *   - narrative  (system mentions "bulletin" or "narratif")
 *       → 3-paragraph French narrative
 *   - drafting   (system mentions "convocation" / "alerte" / "note")
 *       → formal French draft
 *   - anomaly    (system mentions "anomalie" or "dépense")
 *       → 3-signal anomaly explanation
 *   - other      → generic acknowledgement
 *
 * Returns `Err` for empty prompts (validation guard).
 */
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { AIRequest, AIResponse } from "../../domain/model/ai";

/** LLM adapter contract — both mock + production adapters implement this. */
export interface LLMAdapter {
  generate(request: AIRequest): Promise<Result<AIResponse>>;
}

/* ------------------------------------------------------------------ */
/*  Mock adapter                                                       */
/* ------------------------------------------------------------------ */

const MOCK_LATENCY_MS = 800;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Inspect the request to determine which canned response to return.
 * Looks at BOTH the system prompt AND the user prompt so callers can
 * trigger a specific shape from either side.
 */
function pickCannedResponse(request: AIRequest): string {
  const sys = request.systemPrompt.toLowerCase();
  const usr = request.userPrompt.toLowerCase();
  const hay = `${sys}\n${usr}`;

  // Narrative — report card comment in 3 paragraphs.
  if (
    hay.includes("narratif") ||
    hay.includes("bulletin") ||
    hay.includes("commentaire") ||
    hay.includes("appréciation")
  ) {
    return [
      "L'élève a montré un engagement régulier tout au long du trimestre. Les résultats obtenus témoignent d'un travail sérieux, notamment dans les matières à fort coefficient. L'assiduité et la participation en classe restent satisfaisantes.",
      "Quelques difficultés persistantes sont observées en mathématiques, où les automatismes de base doivent être renforcés. Une attention particulière devra être portée à la méthodologie lors des devoirs surveillés. L'élève est encouragé(e) à profiter des séances de soutien pour combler ces lacunes.",
      "Dans l'ensemble, le trimestre est positif. L'élève fait preuve de respect envers le corps enseignant et entretient de bonnes relations avec ses camarades. Les efforts fournis doivent être maintenus afin de consolider les acquis et d'aborder le prochain trimestre avec sérénité.",
    ].join("\n\n");
  }

  // Drafting — formal administrative document.
  if (
    hay.includes("convocation") ||
    hay.includes("alerte") ||
    hay.includes("note de politique") ||
    hay.includes("rédaction") ||
    hay.includes("draft")
  ) {
    return [
      "Objet: Convocation — Rencontre pédagogique",
      "",
      "Madame, Monsieur,",
      "",
      "Par la présente, nous avons l'honneur de vous convoquer à une rencontre pédagogique qui se tiendra dans les locaux de l'établissement. Cette rencontre a pour objet de faire le point sur la scolarité de votre enfant et d'aborder les points suivants:",
      "",
      "  • Résultats académiques du trimestre en cours",
      "  • Assiduité et comportement",
      "  • Mesures d'accompagnement éventuelles",
      "",
      "Nous vous remercions de bien vouloir confirmer votre présence auprès du secrétariat. En cas d'empêchement, une seconde date pourra être proposée.",
      "",
      "Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.",
      "",
      "La Direction",
    ].join("\n");
  }

  // Anomaly explanation — 3-signal pattern.
  if (
    hay.includes("anomalie") ||
    hay.includes("dépense") ||
    hay.includes("anomaly") ||
    hay.includes("fournisseur")
  ) {
    return [
      "Analyse de la dépense — 3 signaux d'anomalie détectés:",
      "",
      "1. Duplication: une dépense identique a été soumise par un autre membre du personnel il y a environ 2 heures.",
      "2. Nouveau fournisseur: le bénéficiaire n'a aucun historique de paiement dans l'établissement.",
      "3. Dépassement budgétaire: le montant est 3 fois supérieur à la moyenne mensuelle de la catégorie concernée.",
      "",
      "Recommandation: demander une justification au soumetteur avant toute approbation. L'IA fournit un signal, l'humain décide toujours.",
    ].join("\n");
  }

  // Generic fallback.
  return "Réponse générée (mock). Le contenu est simulé pour les besoins du développement. En production, cet appel serait proxifié via une Edge Function Supabase vers Groq ou OpenRouter.";
}

/**
 * The mock LLM adapter. Returns canned responses with an 800ms delay.
 *
 * Exported as a singleton — there's no state to reset between calls.
 */
export const mockLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    // Validate the prompt is non-empty. Both prompts are checked: the user
    // prompt is the canonical "input" but the system prompt can also be the
    // carrier (e.g. the narrative generator passes context as the system
    // prompt). If BOTH are empty, return Err.
    if (!request.userPrompt.trim() && !request.systemPrompt.trim()) {
      return Err(
        Errors.validation(
          "Cannot generate with empty prompt",
          "Le prompt ne peut pas être vide.",
        ),
      );
    }

    const start = Date.now();
    await delay(MOCK_LATENCY_MS);
    const content = pickCannedResponse(request);
    const durationMs = Date.now() - start;

    const response: AIResponse = {
      id: newId("ai-resp"),
      requestId: request.id,
      content,
      tokensUsed: Math.max(1, Math.ceil(content.length / 4)),
      durationMs,
      // The mock echoes back the provider from the request so the AIResponse
      // shape stays valid (provider is typed as AIProvider = groq|openrouter).
      provider: request.provider,
      model: request.model,
      finishedAt: new Date().toISOString(),
    };
    return Ok(response);
  },
};

/**
 * Default adapter for the app — currently the mock. In production, this will
 * be swapped for a router that picks between `groqLLMAdapter` and
 * `openrouterLLMAdapter` based on the BYOK config.
 */
export const defaultLLMAdapter: LLMAdapter = mockLLMAdapter;
