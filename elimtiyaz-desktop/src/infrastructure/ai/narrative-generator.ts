import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import { AuditActions } from "../../core/audit-actions";
import { maskPII, unmaskPII } from "../../domain/pii-mask";
import { defaultLLMAdapter } from "./llm-adapter";
import type { AIRequest, NarrativeRequest } from "../../domain/model/ai";
import type { AuditRepository } from "../../domain/repository/repository";

export interface ReportCardNarrativeResult {
  readonly studentId: string;
  readonly narrative: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly requiresTeacherReview: true;
}

/**
 * AI Report Card Narrative Generator (plan §11.05)
 *
 * Generates an individualized 3-paragraph qualitative summary for report cards:
 *   Paragraph 1: Engagement & overall academic performance.
 *   Paragraph 2: Identified areas for improvement & methodology.
 *   Paragraph 3: Encouragements & future outlook.
 *
 * Mandates teacher review prior to publication (never auto-published).
 */
export async function generateReportCardNarrative(input: {
  request: NarrativeRequest;
  auditRepo: AuditRepository;
  actorId: string;
  actorName: string;
  tenantId: string;
}): Promise<Result<ReportCardNarrativeResult>> {
  const { request, auditRepo, actorId, actorName, tenantId } = input;

  if (request.grades.length === 0) {
    return Err(
      Errors.validation(
        "Cannot generate narrative without grades",
        "Aucune note n'est disponible pour cet élève.",
      ),
    );
  }

  const overallAvg =
    request.grades.reduce((sum, g) => sum + g.average, 0) /
    request.grades.length;

  const systemPrompt =
    "Tu es un enseignant expérimenté et bienveillant dans un établissement scolaire privé. " +
    "Rédige un commentaire narratif personnalisé pour le bulletin scolaire de l'élève en 3 paragraphes distincts:\n" +
    "1. Engagement et résultats globaux durant le trimestre.\n" +
    "2. Difficultés observées, méthode de travail et axes d'amélioration précis.\n" +
    "3. Encouragements et perspectives pour le trimestre suivant.\n" +
    "Adopte un ton constructif, professionnel et encourageant. " +
    "N'utilise pas le nom de l'élève directement (il sera réinséré automatiquement via des balises).";

  const rawUserPrompt =
    `Élève: ${request.studentName}\n` +
    `Moyenne générale: ${overallAvg.toFixed(2)} / 20\n` +
    `Taux de présence: ${(request.attendanceRate * 100).toFixed(1)}%\n` +
    `Notes par matière:\n${request.grades.map((g) => `  - ${g.subject}: ${g.average.toFixed(2)}/20`).join("\n")}\n` +
    `Remarques de l'enseignant: ${request.teacherNotes || "(Aucune remarque spécifique)"}`;

  // Mask PII (student name) before passing to the LLM
  const { masked, replacements } = maskPII(rawUserPrompt, {
    studentNames: [request.studentName],
  });

  const aiRequest: AIRequest = {
    id: `ai-req-narrative-${request.studentId}-${Date.now()}`,
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    systemPrompt,
    userPrompt: rawUserPrompt,
    maskedContent: masked,
    maxTokens: 800,
    temperature: 0.7,
    createdAt: new Date().toISOString(),
    // VAULT §02.06 — routed to the narrative feature server-side.
    feature: "narrative",
  };

  const llmResult = await defaultLLMAdapter.generate(aiRequest);
  if (!llmResult.ok) {
    return Err(llmResult.error);
  }

  // Restore PII placeholders
  const unmaskedNarrative = unmaskPII(llmResult.value.content, replacements);

  // Log generation in audit trail
  await auditRepo.log({
    action: AuditActions.AiNarrativeDrafted,
    entityType: "student",
    entityId: request.studentId,
    actorId,
    actorName,
    tenantId,
    diff: {
      before: null,
      after: {
        tokensUsed: llmResult.value.tokensUsed,
        model: llmResult.value.model,
      },
    },
    note: `Narratif de bulletin généré pour l'élève ${request.studentId} (${request.term})`,
  });

  return Ok({
    studentId: request.studentId,
    narrative: unmaskedNarrative,
    tokensUsed: llmResult.value.tokensUsed,
    durationMs: llmResult.value.durationMs,
    requiresTeacherReview: true,
  });
}
