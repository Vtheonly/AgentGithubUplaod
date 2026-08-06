/**
 * OrthoFollowUpDetailDrawer — manage a single speech therapy follow-up.
 *
 * Shows:
 *   - Follow-up metadata (student, therapist, dates, status)
 *   - Evaluations list (with score breakdown + delete action)
 *   - Sessions list (with delete action)
 *   - Close follow-up action (managers)
 *   - Conduct-evaluation + conduct-session actions (managers)
 */
import { useState } from "react";
import {
  Stethoscope,
  Clock,
  ClipboardCheck,
  Plus,
  Trash2,
  XCircle,
  Calendar,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import { FormField } from "../../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import {
  UnifiedModal,
  type UnifiedModalProps,
} from "../../../shared/ui/unified-modal";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import type {
  SpeechTherapyFollowUp,
  SpeechTherapyEvaluation,
  SpeechTherapySession,
  SpeechTherapyEvaluationType,
  SpeechTherapyProgress,
} from "../../../domain/model/therapy";
import {
  SPEECH_THERAPY_FOLLOWUP_STATUS_LABELS_FR,
  SPEECH_THERAPY_EVALUATION_TYPE_LABELS_FR,
  SPEECH_THERAPY_PROGRESS_LABELS_FR,
} from "../../../domain/model/therapy";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function OrthoFollowUpDetailDrawer({
  followUp,
  open,
  onOpenChange,
  canManage,
}: {
  followUp: SpeechTherapyFollowUp;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canManage: boolean;
}) {
  const repos = useRepositories();
  const evaluations = useObservable(
    () => repos.orthophonie.observeEvaluations(followUp.id),
    [],
  );
  const sessions = useObservable(
    () => repos.orthophonie.observeSessions(followUp.id),
    [],
  );
  const [evalOpen, setEvalOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      variant="drawer"
      icon={Stethoscope}
      iconTone="primary"
      title={followUp.studentName}
      description={`Suivi orthophonique · ${SPEECH_THERAPY_FOLLOWUP_STATUS_LABELS_FR[followUp.status]}`}
      hideSubmit
      cancelLabel="Fermer"
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="p-3 text-xs space-y-1.5">
            <Badge variant="outline" className="text-[10px]">
              {SPEECH_THERAPY_FOLLOWUP_STATUS_LABELS_FR[followUp.status]}
            </Badge>
            <div>
              <strong>Orthophoniste :</strong> {followUp.therapistName}
            </div>
            <div>
              <strong>Motif :</strong> {followUp.reason}
            </div>
            <div>
              <strong>Début :</strong> {followUp.startDate.slice(0, 10)}
              {followUp.endDate && (
                <> · <strong>Fin :</strong> {followUp.endDate.slice(0, 10)}</>
              )}
            </div>
            {followUp.parentConsent && (
              <div className="text-status-success">
                <CheckCircle2 className="h-3 w-3 inline mr-1" />
                Consentement parental obtenu le {followUp.parentConsentDate?.slice(0, 10)}
              </div>
            )}
            {followUp.notes && (
              <div className="pt-1 border-t border-border/50 mt-1.5 text-muted-foreground">
                <strong>Notes :</strong> {followUp.notes}
              </div>
            )}
          </CardContent>
        </Card>

        <EvaluationsCard
          followUp={followUp}
          evaluations={evaluations}
          canManage={canManage}
          onAddEval={() => setEvalOpen(true)}
        />

        <SessionsCard
          followUp={followUp}
          sessions={sessions}
          canManage={canManage}
          onAddSession={() => setSessionOpen(true)}
        />

        {canManage && followUp.status !== "closed" && (
          <Card>
            <CardContent className="p-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Clôturer ce suivi ?
              </p>
              <Button
                size="sm"
                variant="outline"
                className="text-status-warning hover:bg-status-warning/10"
                onClick={() => setCloseOpen(true)}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Clôturer
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {evalOpen && (
        <ConductEvaluationModal
          open
          onOpenChange={setEvalOpen}
          followUp={followUp}
        />
      )}
      {sessionOpen && (
        <ConductSessionModal
          open
          onOpenChange={setSessionOpen}
          followUp={followUp}
        />
      )}
      {closeOpen && (
        <CloseFollowUpModal
          open
          onOpenChange={setCloseOpen}
          followUp={followUp}
        />
      )}
    </UnifiedModal>
  );
}

// ============================================================================
// Evaluations card
// ============================================================================

function EvaluationsCard({
  followUp,
  evaluations,
  canManage,
  onAddEval,
}: {
  followUp: SpeechTherapyFollowUp;
  evaluations: readonly SpeechTherapyEvaluation[];
  canManage: boolean;
  onAddEval: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  async function handleDelete(e: SpeechTherapyEvaluation) {
    if (!session) return;
    const res = await repos.orthophonie.deleteEvaluation(
      e.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Évaluation supprimée", e.type);
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Évaluations ({evaluations.length})
          </h3>
          {canManage && followUp.status !== "closed" && (
            <Button size="sm" variant="outline" onClick={onAddEval}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nouvelle évaluation
            </Button>
          )}
        </div>

        {evaluations.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">
            Aucune évaluation enregistrée.
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {evaluations.map((e) => (
              <div
                key={e.id}
                className="rounded border border-border/60 bg-card p-3 hover:bg-accent/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[10px]">
                        {SPEECH_THERAPY_EVALUATION_TYPE_LABELS_FR[e.type]}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {e.date.slice(0, 10)}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[10px] mb-2">
                      <ScoreCell label="Artic." value={e.articulation} />
                      <ScoreCell label="Fluence" value={e.fluency} />
                      <ScoreCell label="Compr." value={e.comprehension} />
                      <ScoreCell label="Express." value={e.expression} />
                    </div>
                    <p className="text-xs text-foreground">{e.summary}</p>
                    {e.recommendations && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        <strong>Recommandations :</strong> {e.recommendations}
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-status-danger hover:bg-status-danger/10"
                      onClick={() => handleDelete(e)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="text-center p-1 rounded bg-muted/30 border border-border/40">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="text-xs font-bold text-foreground">
        {value == null ? "—" : value}
      </div>
    </div>
  );
}

// ============================================================================
// Sessions card
// ============================================================================

function SessionsCard({
  followUp,
  sessions,
  canManage,
  onAddSession,
}: {
  followUp: SpeechTherapyFollowUp;
  sessions: readonly SpeechTherapySession[];
  canManage: boolean;
  onAddSession: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  async function handleDelete(s: SpeechTherapySession) {
    if (!session) return;
    const res = await repos.orthophonie.deleteSession(
      s.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Séance supprimée", s.exercises.slice(0, 50));
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Séances ({sessions.length})
          </h3>
          {canManage && followUp.status !== "closed" && (
            <Button size="sm" variant="outline" onClick={onAddSession}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nouvelle séance
            </Button>
          )}
        </div>

        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">
            Aucune séance enregistrée.
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="rounded border border-border/60 bg-card p-3 hover:bg-accent/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-muted-foreground">
                        {s.date.slice(0, 10)} · {s.durationMinutes} min
                      </span>
                      {s.progress && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            s.progress === "improving"
                              ? "bg-status-success/10 text-status-success border-status-success/30"
                              : s.progress === "regressing"
                                ? "bg-status-danger/10 text-status-danger border-status-danger/30"
                                : ""
                          }`}
                        >
                          {SPEECH_THERAPY_PROGRESS_LABELS_FR[s.progress]}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-foreground">
                      <strong>Exercices :</strong> {s.exercises}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <strong>Observations :</strong> {s.observations}
                    </p>
                    {s.homework && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        <strong>Devoir :</strong> {s.homework}
                      </p>
                    )}
                    {s.nextSessionDate && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        <Clock className="h-2.5 w-2.5 inline mr-1" />
                        Prochaine : {s.nextSessionDate.slice(0, 10)}
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-status-danger hover:bg-status-danger/10"
                      onClick={() => handleDelete(s)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Modals: conduct evaluation, conduct session, close follow-up
// ============================================================================

function ConductEvaluationModal({
  open,
  onOpenChange,
  followUp,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  followUp: SpeechTherapyFollowUp;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<SpeechTherapyEvaluationType>("initial");
  const [articulation, setArticulation] = useState("");
  const [fluency, setFluency] = useState("");
  const [comprehension, setComprehension] = useState("");
  const [expression, setExpression] = useState("");
  const [summary, setSummary] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const res = await repos.orthophonie.conductEvaluation({
      followUpId: followUp.id,
      date: new Date(date).toISOString(),
      type,
      articulation: articulation ? parseInt(articulation, 10) : null,
      fluency: fluency ? parseInt(fluency, 10) : null,
      comprehension: comprehension ? parseInt(comprehension, 10) : null,
      expression: expression ? parseInt(expression, 10) : null,
      summary: summary.trim(),
      recommendations: recommendations.trim() || null,
      conductedById: session.userId,
      conductedByName: session.displayName,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Évaluation enregistrée", "");
      onOpenChange(false);
      setSummary("");
      setRecommendations("");
      setArticulation("");
      setFluency("");
      setComprehension("");
      setExpression("");
    } else {
      setAlert({
        tone: "error",
        title: "Échec",
        description: res.error.userMessage,
      });
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={ClipboardCheck}
      iconTone="primary"
      title="Nouvelle évaluation orthophonique"
      description={`Pour ${followUp.studentName} · ${followUp.therapistName}`}
      submitLabel="Enregistrer l'évaluation"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date" required>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="Type" required>
            <Select
              value={type}
              onValueChange={(v) => setType(v as SpeechTherapyEvaluationType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="initial">Initiale</SelectItem>
                <SelectItem value="reassessment">Réévaluation</SelectItem>
                <SelectItem value="final">Finale</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <FormField label="Articulation" hint="0-100">
            <Input
              type="number"
              min={0}
              max={100}
              value={articulation}
              onChange={(e) => setArticulation(e.target.value)}
              placeholder="—"
            />
          </FormField>
          <FormField label="Fluence" hint="0-100">
            <Input
              type="number"
              min={0}
              max={100}
              value={fluency}
              onChange={(e) => setFluency(e.target.value)}
              placeholder="—"
            />
          </FormField>
          <FormField label="Compréhension" hint="0-100">
            <Input
              type="number"
              min={0}
              max={100}
              value={comprehension}
              onChange={(e) => setComprehension(e.target.value)}
              placeholder="—"
            />
          </FormField>
          <FormField label="Expression" hint="0-100">
            <Input
              type="number"
              min={0}
              max={100}
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="—"
            />
          </FormField>
        </div>
        <FormField label="Résumé" required>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
          />
        </FormField>
        <FormField label="Recommandations (optionnel)">
          <Textarea
            value={recommendations}
            onChange={(e) => setRecommendations(e.target.value)}
            rows={2}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}

function ConductSessionModal({
  open,
  onOpenChange,
  followUp,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  followUp: SpeechTherapyFollowUp;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [duration, setDuration] = useState("30");
  const [exercises, setExercises] = useState("");
  const [observations, setObservations] = useState("");
  const [homework, setHomework] = useState("");
  const [progress, setProgress] = useState<SpeechTherapyProgress | "">("");
  const [nextSessionDate, setNextSessionDate] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const res = await repos.orthophonie.conductSession({
      followUpId: followUp.id,
      date: new Date(date).toISOString(),
      durationMinutes: parseInt(duration, 10) || 30,
      exercises: exercises.trim(),
      observations: observations.trim(),
      homework: homework.trim() || null,
      progress: progress || null,
      nextSessionDate: nextSessionDate
        ? new Date(nextSessionDate).toISOString()
        : null,
      conductedById: session.userId,
      conductedByName: session.displayName,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Séance enregistrée", "");
      onOpenChange(false);
      setExercises("");
      setObservations("");
      setHomework("");
    } else {
      setAlert({
        tone: "error",
        title: "Échec",
        description: res.error.userMessage,
      });
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={Calendar}
      iconTone="primary"
      title="Nouvelle séance orthophonique"
      description={`Pour ${followUp.studentName}`}
      submitLabel="Enregistrer"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date / Heure" required>
            <Input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="Durée (min)" required>
            <Input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Exercices pratiqués" required>
          <Textarea
            value={exercises}
            onChange={(e) => setExercises(e.target.value)}
            rows={2}
            placeholder="Ex. Échauffement articulatoire, répétition de syllabes…"
          />
        </FormField>
        <FormField label="Observations" required>
          <Textarea
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            rows={2}
          />
        </FormField>
        <FormField label="Devoir (optionnel)">
          <Input
            value={homework}
            onChange={(e) => setHomework(e.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Progression">
            <Select
              value={progress || "__none__"}
              onValueChange={(v) =>
                setProgress(v === "__none__" ? "" : (v as SpeechTherapyProgress))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Non évaluée —</SelectItem>
                <SelectItem value="improving">En progrès</SelectItem>
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="regressing">En régression</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Prochaine séance (optionnel)">
            <Input
              type="date"
              value={nextSessionDate}
              onChange={(e) => setNextSessionDate(e.target.value)}
            />
          </FormField>
        </div>
      </div>
    </UnifiedModal>
  );
}

function CloseFollowUpModal({
  open,
  onOpenChange,
  followUp,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  followUp: SpeechTherapyFollowUp;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    const res = await repos.orthophonie.closeFollowUp(
      followUp.id,
      new Date(endDate).toISOString(),
      session.userId,
      session.displayName,
    );
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Suivi clôturé", "");
      onOpenChange(false);
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      variant="dialog"
      icon={XCircle}
      iconTone="warning"
      title="Clôturer le suivi ?"
      submitLabel="Clôturer"
      submitLoading={submitting}
      submitVariant="destructive"
      onSubmit={handleSubmit}
    >
      <FormField label="Date de clôture" required>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </FormField>
    </UnifiedModal>
  );
}
