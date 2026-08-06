/**
 * PsychFollowUpDetailDrawer — view + manage a single psychological follow-up.
 *
 * Shows:
 *   - Follow-up metadata (student, psychologist, dates, status)
 *   - Sessions list (with delete action for managers)
 *   - Reports list (with delete action)
 *   - Close follow-up action (managers)
 *   - Conduct-session action (managers)
 *   - Create-report action (managers)
 */
import { useState } from "react";
import {
  Brain,
  Clock,
  FileText,
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
  PsychologicalFollowUp,
  PsychologicalSession,
  PsychologicalReport,
  PsychologicalSessionType,
} from "../../../domain/model/therapy";
import {
  PSYCHOLOGICAL_FOLLOWUP_STATUS_LABELS_FR,
  PSYCHOLOGICAL_SESSION_TYPE_LABELS_FR,
  CONFIDENTIALITY_LABELS_FR,
} from "../../../domain/model/therapy";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function PsychFollowUpDetailDrawer({
  followUp,
  open,
  onOpenChange,
  canManage,
}: {
  followUp: PsychologicalFollowUp;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canManage: boolean;
}) {
  const repos = useRepositories();
  const sessions = useObservable(
    () => repos.psychology.observeSessions(followUp.id),
    [],
  );
  const reports = useObservable(
    () => repos.psychology.observeReports(followUp.id),
    [],
  );
  const [sessionOpen, setSessionOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      variant="drawer"
      icon={Brain}
      iconTone="primary"
      title={followUp.studentName}
      description={`Suivi psychologique · ${PSYCHOLOGICAL_FOLLOWUP_STATUS_LABELS_FR[followUp.status]}`}
      hideSubmit
      cancelLabel="Fermer"
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="p-3 text-xs space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {PSYCHOLOGICAL_FOLLOWUP_STATUS_LABELS_FR[followUp.status]}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  followUp.confidentialityLevel === "restricted"
                    ? "bg-status-danger/10 text-status-danger border-status-danger/30"
                    : ""
                }`}
              >
                {CONFIDENTIALITY_LABELS_FR[followUp.confidentialityLevel]}
              </Badge>
            </div>
            <div>
              <strong>Psychologue :</strong> {followUp.psychologistName}
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

        <SessionsCard
          followUp={followUp}
          sessions={sessions}
          canManage={canManage}
          onAddSession={() => setSessionOpen(true)}
        />

        <ReportsCard
          followUp={followUp}
          reports={reports}
          canManage={canManage}
          onCreateReport={() => setReportOpen(true)}
        />

        {canManage && followUp.status !== "closed" && (
          <Card>
            <CardContent className="p-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Clôturer ce suivi ? Aucune nouvelle séance ne pourra être ajoutée.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="text-status-warning hover:bg-status-warning/10"
                onClick={() => setCloseOpen(true)}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Clôturer le suivi
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {sessionOpen && (
        <ConductSessionModal
          open
          onOpenChange={setSessionOpen}
          followUp={followUp}
        />
      )}
      {reportOpen && (
        <CreateReportModal
          open
          onOpenChange={setReportOpen}
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
// Sessions card
// ============================================================================

function SessionsCard({
  followUp,
  sessions,
  canManage,
  onAddSession,
}: {
  followUp: PsychologicalFollowUp;
  sessions: readonly PsychologicalSession[];
  canManage: boolean;
  onAddSession: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  async function handleDelete(s: PsychologicalSession) {
    if (!session) return;
    const res = await repos.psychology.deleteSession(
      s.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Séance supprimée", s.summary.slice(0, 50));
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
          {canManage && followUp.status === "active" && (
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
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="rounded border border-border/60 bg-card p-3 hover:bg-accent/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[10px]">
                        {PSYCHOLOGICAL_SESSION_TYPE_LABELS_FR[s.type]}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {s.date.slice(0, 10)} · {s.durationMinutes} min
                      </span>
                    </div>
                    <p className="text-xs text-foreground">{s.summary}</p>
                    {s.recommendations && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        <strong>Recommandations :</strong> {s.recommendations}
                      </p>
                    )}
                    {s.nextSessionDate && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        <Clock className="h-2.5 w-2.5 inline mr-1" />
                        Prochaine séance : {s.nextSessionDate.slice(0, 10)}
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
// Reports card
// ============================================================================

function ReportsCard({
  followUp,
  reports,
  canManage,
  onCreateReport,
}: {
  followUp: PsychologicalFollowUp;
  reports: readonly PsychologicalReport[];
  canManage: boolean;
  onCreateReport: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  async function handleDelete(r: PsychologicalReport) {
    if (!session) return;
    const res = await repos.psychology.deleteReport(
      r.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Rapport supprimé", r.title);
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Rapports ({reports.length})
          </h3>
          {canManage && followUp.status !== "closed" && (
            <Button size="sm" variant="outline" onClick={onCreateReport}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nouveau rapport
            </Button>
          )}
        </div>

        {reports.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">
            Aucun rapport rédigé.
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {reports.map((r) => (
              <div
                key={r.id}
                className="rounded border border-border/60 bg-card p-3 hover:bg-accent/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.period} · par {r.psychologistName} ·{" "}
                      {r.createdAt.slice(0, 10)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {r.sharedWithParent && (
                        <Badge variant="outline" className="text-[10px]">
                          Parent informé
                        </Badge>
                      )}
                      {r.sharedWithAdministration && (
                        <Badge variant="outline" className="text-[10px]">
                          Administration informée
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">
                      {r.content}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-status-danger hover:bg-status-danger/10"
                      onClick={() => handleDelete(r)}
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
// Modals: conduct session, create report, close follow-up
// ============================================================================

function ConductSessionModal({
  open,
  onOpenChange,
  followUp,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  followUp: PsychologicalFollowUp;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [duration, setDuration] = useState("45");
  const [type, setType] = useState<PsychologicalSessionType>("follow_up");
  const [summary, setSummary] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [nextSessionDate, setNextSessionDate] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const res = await repos.psychology.conductSession({
      followUpId: followUp.id,
      date: new Date(date).toISOString(),
      durationMinutes: parseInt(duration, 10) || 45,
      type,
      summary: summary.trim(),
      recommendations: recommendations.trim() || null,
      nextSessionDate: nextSessionDate
        ? new Date(nextSessionDate).toISOString()
        : null,
      conductedById: session.userId,
      conductedByName: session.displayName,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Séance enregistrée", "La séance a été ajoutée au suivi.");
      onOpenChange(false);
      setSummary("");
      setRecommendations("");
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
      title="Nouvelle séance psychologique"
      description={`Pour ${followUp.studentName} · ${followUp.psychologistName}`}
      submitLabel="Enregistrer la séance"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
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
          <FormField label="Type" required>
            <Select
              value={type}
              onValueChange={(v) => setType(v as PsychologicalSessionType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="initial">Initiale</SelectItem>
                <SelectItem value="follow_up">Suivi</SelectItem>
                <SelectItem value="emergency">Urgence</SelectItem>
                <SelectItem value="closing">Clôture</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <FormField
          label="Résumé"
          required
          hint="Bref aperçu (1-3 phrases). Les notes cliniques détaillées restent dans le dossier confidentiel du psychologue."
        >
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
        <FormField label="Prochaine séance (optionnel)">
          <Input
            type="date"
            value={nextSessionDate}
            onChange={(e) => setNextSessionDate(e.target.value)}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}

function CreateReportModal({
  open,
  onOpenChange,
  followUp,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  followUp: PsychologicalFollowUp;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState("T1 2025-2026");
  const [content, setContent] = useState("");
  const [sharedParent, setSharedParent] = useState(false);
  const [sharedAdmin, setSharedAdmin] = useState(true);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const res = await repos.psychology.createReport({
      followUpId: followUp.id,
      title: title.trim(),
      period: period.trim(),
      content: content.trim(),
      sharedWithParent: sharedParent,
      sharedWithAdministration: sharedAdmin,
      authoredById: session.userId,
      authoredByName: session.displayName,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Rapport créé", title);
      onOpenChange(false);
      setTitle("");
      setContent("");
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
      icon={FileText}
      iconTone="primary"
      title="Nouveau rapport psychologique"
      description={`Pour ${followUp.studentName}`}
      submitLabel="Créer le rapport"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Titre" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. Bilan T1"
            />
          </FormField>
          <FormField label="Période" required>
            <Input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Contenu (markdown)" required>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            placeholder="## Synthèse\n\n…\n\n## Recommandations\n\n…"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Partage">
            <Label className="flex items-center gap-2 cursor-pointer text-sm font-normal">
              <input
                type="checkbox"
                checked={sharedParent}
                onChange={(e) => setSharedParent(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-muted-foreground">
                Partager avec le parent
              </span>
            </Label>
          </FormField>
          <FormField label="">
            <Label className="flex items-center gap-2 cursor-pointer text-sm font-normal">
              <input
                type="checkbox"
                checked={sharedAdmin}
                onChange={(e) => setSharedAdmin(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-muted-foreground">
                Partager avec l'administration
              </span>
            </Label>
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
  followUp: PsychologicalFollowUp;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    const res = await repos.psychology.closeFollowUp(
      followUp.id,
      new Date(endDate).toISOString(),
      session.userId,
      session.displayName,
    );
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess(
        "Suivi clôturé",
        `Le suivi de ${followUp.studentName} est maintenant clôturé.`,
      );
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
      description="Le suivi sera marqué comme clôturé. Aucune nouvelle séance ne pourra être ajoutée. Les rapports existants sont conservés."
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
