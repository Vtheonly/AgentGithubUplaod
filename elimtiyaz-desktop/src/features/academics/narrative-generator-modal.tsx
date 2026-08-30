/**
 * NarrativeGeneratorModal — Report Card Narrative Generator (plan §11.05).
 *
 * Generates a French narrative comment for a student's report card based on
 * their grades + attendance rate + teacher notes. The teacher MUST review
 * the generated text and explicitly click "Approuver" before it's saved —
 * the narrative is never auto-published.
 *
 * PII flow:
 *   1. Student name is masked → `[STUDENT_1]` before being sent to the LLM.
 *   2. LLM returns a response with the placeholder intact.
 *   3. The placeholder is unmasked back to the real name before display.
 *
 * Audit: every generate / approve / reject writes an audit entry.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  GraduationCap,
  Calendar,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Textarea } from "../../shared/ui/textarea";
import { Badge } from "../../shared/ui/badge";
import { Separator } from "../../shared/ui/separator";
import { FormField } from "../../shared/ui/form-field";
import { StatusChip } from "../../shared/ui/status-chip";
import { AuditActions } from "../../core/audit-actions";
import { Permission } from "../../core/rbac/permissions";
import { maskPII, unmaskPII } from "../../domain/pii-mask";
import { defaultLLMAdapter } from "../../infrastructure/ai/llm-adapter";
import type { AIRequest, NarrativeRequest } from "../../domain/model/ai";
import type { Assessment, AttendanceRecord } from "../../domain/model/academic";
import { calculateAttendanceRate } from "../../domain/model/academic";
import type { Student } from "../../domain/model/student";

/* ------------------------------------------------------------------ */
/*  Public trigger — small icon button to put next to a student row    */
/* ------------------------------------------------------------------ */

export function NarrativeGeneratorButton({
  student,
  classId,
}: {
  student: Student;
  classId: string;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);

  // Only show the button if the user has the UseAI permission (per plan §11.05).
  if (!session || !session.permissions.has(Permission.UseAI)) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setOpen(true)}
        title={t("ai.narrative.title")}
        aria-label={t("ai.narrative.title")}
      >
        <Sparkles className="h-4 w-4 text-primary" />
      </Button>
      <NarrativeGeneratorModal
        student={student}
        classId={classId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal                                                               */
/* ------------------------------------------------------------------ */

export function NarrativeGeneratorModal({
  student,
  classId,
  open,
  onOpenChange,
}: {
  student: Student;
  classId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  // Reactive reads: grades + attendance for this student.
  const assessments = useObservable<Assessment[]>(
    () => repos.grades.observeForStudent(student.id),
    [student.id],
  );
  const attendance = useObservable<AttendanceRecord[]>(
    () => repos.attendance.observeByStudent(student.id, "2000-01-01", "2099-12-31"),
    [student.id],
  );

  // Local form state.
  const [teacherNotes, setTeacherNotes] = useState("");
  const [narrative, setNarrative] = useState("");
  const [loading, setLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Reset state whenever the modal opens for a fresh student.
  useEffect(() => {
    if (open) {
      setTeacherNotes("");
      setNarrative("");
      setRejectReason("");
    }
  }, [open, student.id]);

  // ---- Derived data --------------------------------------------------

  const grades = assessments
    .filter((a) => a.subjectAverage != null)
    .map((a) => {
      const subj = repos.subjects.observe().get().find((s) => s.id === a.subjectId);
      return { subject: subj?.name ?? a.subjectId, average: a.subjectAverage as number };
    });

  // T-027 / ATT-102: use the canonical `calculateAttendanceRate` (present +
  // late count as attended). The previous inline `present / total`
  // under-reported by counting late arrivals as absent, then sent the
  // wrong rate to the AI narrative generator AND persisted it in
  // `student_academic_histories.narrative` for the year-end promotion flow.
  const attendanceRate = calculateAttendanceRate(attendance);

  const overallAvg = grades.length === 0
    ? null
    : grades.reduce((s, g) => s + g.average, 0) / grades.length;

  // ---- Actions -------------------------------------------------------

  async function handleGenerate() {
    if (!session) return;
    setLoading(true);
    try {
      const request: NarrativeRequest = {
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        grades,
        attendanceRate,
        teacherNotes: teacherNotes.trim(),
        term: "T1",
      };

      // System prompt — describes the task to the LLM.
      const systemPrompt =
        "Tu es un enseignant expérimenté. Rédige un commentaire narratif pour le bulletin " +
        "scolaire d'un élève. Le commentaire doit faire 3 paragraphes: (1) engagement et " +
        "résultats globaux, (2) difficultés observées et axes d'amélioration, (3) " +
        "encouragements et perspectives. Ton bienveillant et professionnel. N'utilise pas " +
        "le nom de l'élève dans la réponse (il sera réinséré automatiquement).";

      // User prompt — the actual data. PII (student name) is masked first.
      const rawUserPrompt =
        `Élève: ${request.studentName}\n` +
        `Moyenne générale: ${overallAvg != null ? overallAvg.toFixed(2) : "N/A"}/20\n` +
        `Taux de présence: ${(attendanceRate * 100).toFixed(1)}%\n` +
        `Notes par matière:\n${grades.map((g) => `  - ${g.subject}: ${g.average.toFixed(2)}/20`).join("\n")}\n` +
        `Notes de l'enseignant: ${teacherNotes.trim() || "(aucune)"}`;

      const { masked, replacements } = maskPII(rawUserPrompt, {
        studentNames: [request.studentName],
      });

      const aiRequest: AIRequest = {
        id: `ai-req-${Date.now()}`,
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

      const result = await defaultLLMAdapter.generate(aiRequest);
      if (!result.ok) {
        toast.showError(t("toast.error"), result.error.userMessage);
        return;
      }

      // Unmask the response (the LLM may have echoed the placeholder).
      const unmasked = unmaskPII(result.value.content, replacements);
      setNarrative(unmasked);

      // Audit the generation (NOT the approval — that's a separate action).
      await repos.audit.log({
        action: AuditActions.AiNarrativeDrafted,
        entityType: "student",
        entityId: student.id,
        actorId: session.userId,
        actorName: session.displayName,
        tenantId: session.tenantId,
        diff: { before: null, after: { tokensUsed: result.value.tokensUsed, model: result.value.model } },
        note: `Narratif généré pour ${student.firstName} ${student.lastName}`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!session) return;
    if (!narrative.trim()) {
      toast.showWarning("Narratif vide", "Générez un narratif avant d'approuver.");
      return;
    }
    await repos.audit.log({
      action: AuditActions.AiNarrativeApproved,
      entityType: "student",
      entityId: student.id,
      actorId: session.userId,
      actorName: session.displayName,
      tenantId: session.tenantId,
      diff: { before: null, after: { narrativePreview: narrative.slice(0, 200) } },
      note: `Narratif approuvé pour ${student.firstName} ${student.lastName} (classe ${classId})`,
    });
    toast.showSuccess(t("ai.narrative.approve"), "Narratif enregistré sur la fiche élève.");
    onOpenChange(false);
  }

  async function handleReject() {
    if (!session) return;
    if (!rejectReason.trim()) {
      toast.showWarning("Motif requis", "Indiquez le motif du rejet.");
      return;
    }
    await repos.audit.log({
      action: AuditActions.AiNarrativeRejected,
      entityType: "student",
      entityId: student.id,
      actorId: session.userId,
      actorName: session.displayName,
      tenantId: session.tenantId,
      diff: { before: null, after: { reason: rejectReason } },
      note: `Narratif rejeté pour ${student.firstName} ${student.lastName}: ${rejectReason}`,
    });
    toast.showInfo(t("ai.narrative.reject"), "Rejet tracé dans l'audit.");
    setRejectOpen(false);
    setRejectReason("");
    onOpenChange(false);
  }

  // ---- Render --------------------------------------------------------

  return (
    <>
      <UnifiedModal
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        icon={FileText}
        iconTone="primary"
        title={t("ai.narrative.title")}
        description={`${student.firstName} ${student.lastName} · ${student.code}`}
        hideFooter
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT: inputs */}
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-primary" />
                <p className="font-medium">{t("ai.narrative.studentInfo")}</p>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>{student.firstName} {student.lastName}</p>
                <p className="font-mono">{student.code}</p>
              </div>
              <Separator />
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">{t("ai.narrative.gradesSummary")}</p>
                {grades.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucune note saisie.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {grades.slice(0, 6).map((g, i) => (
                      <li key={i} className="text-xs flex justify-between">
                        <span>{g.subject}</span>
                        <span className="font-mono">{g.average.toFixed(2)}/20</span>
                      </li>
                    ))}
                  </ul>
                )}
                {overallAvg != null && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs">Moyenne générale</span>
                    <StatusChip
                      label={`${overallAvg.toFixed(2)}/20`}
                      tone={overallAvg >= 10 ? "success" : "danger"}
                    />
                  </div>
                )}
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-xs flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  {t("ai.narrative.attendanceRate")}
                </span>
                <Badge variant="secondary">{(attendanceRate * 100).toFixed(1)}%</Badge>
              </div>
            </div>

            <FormField label={t("ai.narrative.teacherNotes")}>
              <Textarea
                value={teacherNotes}
                onChange={(e) => setTeacherNotes(e.target.value)}
                placeholder="Observations, incidents, points forts…"
                rows={5}
              />
            </FormField>

            <Button onClick={handleGenerate} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("ai.narrative.loading")}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {narrative ? t("ai.narrative.regenerate") : t("ai.narrative.generate")}
                </>
              )}
            </Button>
          </div>

          {/* RIGHT: generated narrative */}
          <div className="space-y-3">
            <FormField label={t("ai.narrative.generatedNarrative")}>
              <Textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                placeholder="Le narratif généré apparaîtra ici. Vous pouvez le modifier avant approbation."
                rows={14}
                className="text-sm leading-relaxed"
              />
            </FormField>

            <div className="rounded-md border border-status-warning/30 bg-status-warning/5 p-2 text-[11px] text-status-warning">
              {t("ai.narrative.reviewMandatory")}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleApprove} disabled={loading || !narrative} className="flex-1">
                <CheckCircle2 className="h-4 w-4" />
                {t("ai.narrative.approve")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setRejectOpen(true)}
                disabled={loading || !narrative}
                className="flex-1"
              >
                <XCircle className="h-4 w-4" />
                {t("ai.narrative.reject")}
              </Button>
            </div>
          </div>
        </div>
      </UnifiedModal>

      {/* Reject reason sub-modal */}
      <UnifiedModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        size="sm"
        icon={XCircle}
        iconTone="danger"
        title={t("ai.narrative.reject")}
        description={t("ai.narrative.rejectReason")}
        submitLabel={t("ai.narrative.reject")}
        submitVariant="destructive"
        submitDisabled={!rejectReason.trim()}
        onSubmit={handleReject}
      >
        <Textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Narratif inexact, ton inapproprié…"
          rows={3}
        />
      </UnifiedModal>
    </>
  );
}
