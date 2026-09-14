// ============================================================================
// FILE: src/features/personnel/management/staff-attendance-center.tsx
// ============================================================================
/**
 * Staff Attendance & Absence Justification Center.
 *
 * WORKFLOW & BUSINESS RULES:
 *   1. When an employee is absent without prior authorization, the Super Admin
 *      or Supervisor issues a "Demande de Justification" with custom context.
 *   2. The employee sees this pending request in their Personnel tab with status `requested`.
 *   3. The employee submits their formal explanation and document reference.
 *   4. The Super Admin reviews the submitted explanation:
 *      - ACCEPT: Marks absence excused, updates status to `accepted`.
 *      - REJECT: Marks absence unexcused (payroll deduction flag), updates status to `rejected`.
 */

import { useState, useMemo } from "react";
import {
  Calendar,
  Clock,
  AlertCircle,
  FileCheck,
  Send,
  CheckCircle2,
  XCircle,
  PlayCircle,
  StopCircle,
  PauseCircle,
  RotateCcw,
  Search,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Role } from "../../../core/rbac/roles";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import { Badge } from "../../../shared/ui/badge";
import { StatusChip } from "../../../shared/ui/status-chip";
import { FormField } from "../../../shared/ui/form-field";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { formatDate } from "../../../core/format/date";
import {
  STAFF_JUSTIFICATION_STATUS_LABELS_FR,
  type StaffAbsenceRecord,
  type AttendanceEventType,
} from "../../../domain/model/workforce";

const JUSTIFICATION_TONES: Record<
  string,
  "neutral" | "warning" | "info" | "success" | "danger"
> = {
  none: "neutral",
  requested: "warning",
  submitted: "info",
  accepted: "success",
  rejected: "danger",
};

export function StaffAttendanceCenter() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const isSuperAdmin =
    session?.role === Role.SuperAdmin ||
    session?.role === Role.FinancialOfficer;
  const currentUserId = session?.userId ?? "";

  const me = useObservable(
    () => repos.personnel.observeByUserId(currentUserId),
    [currentUserId],
  );
  const myPersonnelId = me?.id ?? currentUserId;

  const allAbsences = useObservable(
    () => repos.workforceAttendance.observeAbsences(),
    [],
  );

  // For Admin: show all absences; For Worker: show personal absences
  const displayedAbsences = useMemo(() => {
    if (isSuperAdmin) return allAbsences;
    return allAbsences.filter((a) => a.personnelId === myPersonnelId);
  }, [allAbsences, isSuperAdmin, myPersonnelId]);

  const [search, setSearch] = useState("");
  const [requestModalAbsence, setRequestModalAbsence] =
    useState<StaffAbsenceRecord | null>(null);
  const [requestNote, setRequestNote] = useState("");

  const [submitModalAbsence, setSubmitModalAbsence] =
    useState<StaffAbsenceRecord | null>(null);
  const [workerExplanation, setWorkerExplanation] = useState("");
  const [documentRef, setDocumentRef] = useState("");

  const [reviewModalAbsence, setReviewModalAbsence] =
    useState<StaffAbsenceRecord | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"accepted" | "rejected">(
    "accepted",
  );
  const [decisionNote, setDecisionNote] = useState("");

  // Quick clock in/out for workers
  const todayIso = new Date().toISOString().slice(0, 10);
  const [clockTick, setClockTick] = useState(0);
  const latestEvent = useMemo(() => {
    void clockTick;
    return repos.workforceAttendance.latestFor(myPersonnelId, todayIso);
  }, [repos.workforceAttendance, myPersonnelId, todayIso, clockTick]);

  const clockState = useMemo(() => {
    if (!latestEvent) return "out";
    if (
      latestEvent.eventType === "clock_in" ||
      latestEvent.eventType === "break_end"
    )
      return "in";
    if (latestEvent.eventType === "break_start") return "break";
    return "out";
  }, [latestEvent]);

  async function handleRecordClock(eventType: AttendanceEventType) {
    const res = await repos.workforceAttendance.recordEvent({
      personnelId: myPersonnelId,
      date: todayIso,
      eventType,
    });
    if (res.ok) {
      setClockTick((t) => t + 1);
      toast.showSuccess(
        "Pointage enregistré",
        "Votre présence a été mise à jour en temps réel.",
      );
    }
  }

  const filteredAbsences = useMemo(() => {
    return displayedAbsences.filter((a) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        a.personnelName.toLowerCase().includes(q) ||
        a.date.includes(q) ||
        (a.adminRequestNote ?? "").toLowerCase().includes(q) ||
        (a.workerExplanation ?? "").toLowerCase().includes(q)
      );
    });
  }, [displayedAbsences, search]);

  // Actions
  async function handleSendJustificationRequest() {
    if (!requestModalAbsence || !requestNote.trim() || !session) return;
    const res = await repos.workforceAttendance.requestAbsenceJustification({
      absenceId: requestModalAbsence.id,
      adminNote: requestNote.trim(),
      requestedBy: session.displayName ?? "Direction",
    });
    if (res.ok) {
      toast.showSuccess(
        "Demande envoyée",
        `Une notification de justification a été transmise à ${requestModalAbsence.personnelName}.`,
      );
      setRequestModalAbsence(null);
      setRequestNote("");
    }
  }

  async function handleSubmitWorkerJustification() {
    if (!submitModalAbsence || !workerExplanation.trim()) return;
    const res = await repos.workforceAttendance.submitAbsenceJustification({
      absenceId: submitModalAbsence.id,
      workerExplanation: workerExplanation.trim(),
      documentRef: documentRef.trim() || null,
    });
    if (res.ok) {
      toast.showSuccess(
        "Justification transmise",
        "Votre explication a été envoyée à l'administration pour validation.",
      );
      setSubmitModalAbsence(null);
      setWorkerExplanation("");
      setDocumentRef("");
    }
  }

  async function handleReviewDecision() {
    if (!reviewModalAbsence || !decisionNote.trim() || !session) return;
    const res = await repos.workforceAttendance.reviewAbsenceJustification({
      absenceId: reviewModalAbsence.id,
      decision: reviewDecision,
      decisionNote: decisionNote.trim(),
      decidedBy: session.displayName ?? "Super Admin",
    });
    if (res.ok) {
      toast.showSuccess(
        reviewDecision === "accepted"
          ? "Absence justifiée"
          : "Justification refusée",
        `La décision a été enregistrée pour ${reviewModalAbsence.personnelName}.`,
      );
      setReviewModalAbsence(null);
      setDecisionNote("");
    }
  }

  return (
    <div className="space-y-4">
      {/* Clock-in Station Banner for Workers */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Poste de pointage aujourd'hui
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm font-bold text-foreground">
                  Statut :{" "}
                  {clockState === "in"
                    ? "En service"
                    : clockState === "break"
                      ? "En pause"
                      : "Non pointé"}
                </span>
                <StatusChip
                  label={
                    clockState === "in"
                      ? "Actif"
                      : clockState === "break"
                        ? "Pause"
                        : "Déconnecté"
                  }
                  tone={
                    clockState === "in"
                      ? "success"
                      : clockState === "break"
                        ? "warning"
                        : "neutral"
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {clockState === "out" && (
              <Button size="sm" onClick={() => handleRecordClock("clock_in")}>
                <PlayCircle className="h-4 w-4 mr-1.5" /> Pointer Arrivée
              </Button>
            )}
            {clockState === "in" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRecordClock("break_start")}
                >
                  <PauseCircle className="h-4 w-4 mr-1.5" /> Pause
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRecordClock("clock_out")}
                >
                  <StopCircle className="h-4 w-4 mr-1.5" /> Pointer Départ
                </Button>
              </>
            )}
            {clockState === "break" && (
              <>
                <Button
                  size="sm"
                  onClick={() => handleRecordClock("break_end")}
                >
                  <RotateCcw className="h-4 w-4 mr-1.5" /> Reprise
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRecordClock("clock_out")}
                >
                  <StopCircle className="h-4 w-4 mr-1.5" /> Pointer Départ
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Absences & Justifications Queue */}
      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                {isSuperAdmin
                  ? "Gestion des Absences & Justifications du Personnel"
                  : "Mes Absences & Demandes de Justification"}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                {isSuperAdmin
                  ? "Suivi des absences non justifiées, émission de demandes d'explication et validation des certificats médicaux."
                  : "Consultez vos absences et répondez aux demandes d'explication émises par l'administration."}
              </CardDescription>
            </div>

            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une absence…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredAbsences.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-status-success" />
              Aucune absence enregistrée. L'assiduité est exemplaire !
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground border-b border-border text-left">
                  <tr>
                    <th className="py-2.5 px-3">Collaborateur</th>
                    <th className="py-2.5 px-3">Date d'absence</th>
                    <th className="py-2.5 px-3">Durée</th>
                    <th className="py-2.5 px-3">Statut Justification</th>
                    <th className="py-2.5 px-3">Explications / Notes</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredAbsences.map((abs) => (
                    <tr
                      key={abs.id}
                      className="hover:bg-accent/5 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-semibold text-foreground">
                        {abs.personnelName}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {formatDate(abs.date)}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {abs.durationHours}h
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusChip
                          label={
                            STAFF_JUSTIFICATION_STATUS_LABELS_FR[
                              abs.justificationStatus
                            ]
                          }
                          tone={JUSTIFICATION_TONES[abs.justificationStatus]}
                        />
                      </td>
                      <td className="py-2.5 px-3 max-w-[280px]">
                        {abs.adminRequestNote && (
                          <p className="text-[11px] text-status-warning font-medium">
                            Demande Admin : {abs.adminRequestNote}
                          </p>
                        )}
                        {abs.workerExplanation && (
                          <p className="text-[11px] text-foreground mt-0.5">
                            Explication : {abs.workerExplanation}
                          </p>
                        )}
                        {abs.decisionNote && (
                          <p className="text-[10px] text-muted-foreground italic mt-0.5">
                            Décision : {abs.decisionNote}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Super Admin Action: Request justification */}
                          {isSuperAdmin &&
                            (abs.justificationStatus === "none" ||
                              abs.justificationStatus === "rejected") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-status-warning hover:bg-status-warning/10"
                                onClick={() => {
                                  setRequestModalAbsence(abs);
                                  setRequestNote("");
                                }}
                              >
                                <Send className="h-3 w-3 mr-1" /> Demander
                                Justif.
                              </Button>
                            )}

                          {/* Super Admin Action: Review submitted justification */}
                          {isSuperAdmin &&
                            abs.justificationStatus === "submitted" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                                onClick={() => {
                                  setReviewModalAbsence(abs);
                                  setReviewDecision("accepted");
                                  setDecisionNote(
                                    "Justificatif médical valide conforme au règlement intérieur.",
                                  );
                                }}
                              >
                                <FileCheck className="h-3 w-3 mr-1" /> Examiner
                              </Button>
                            )}

                          {/* Worker Action: Respond to justification request */}
                          {abs.personnelId === myPersonnelId &&
                            abs.justificationStatus === "requested" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setSubmitModalAbsence(abs);
                                  setWorkerExplanation("");
                                  setDocumentRef("");
                                }}
                              >
                                <Send className="h-3 w-3 mr-1" /> Fournir
                                Justification
                              </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal 1: Admin requesting a justification */}
      {requestModalAbsence && (
        <UnifiedModal
          open={!!requestModalAbsence}
          onOpenChange={(o) => !o && setRequestModalAbsence(null)}
          title={`Demande de justification — ${requestModalAbsence.personnelName}`}
          description={`Absence du ${formatDate(requestModalAbsence.date)} (${requestModalAbsence.durationHours}h). Un message officiel sera adressé à l'employé.`}
          submitLabel="Envoyer la demande"
          onSubmit={handleSendJustificationRequest}
          submitDisabled={!requestNote.trim()}
          size="md"
        >
          <div className="space-y-3">
            <FormField label="Motif ou consigne transmise à l'employé" required>
              <Textarea
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="Ex. Merci de fournir un arrêt de travail ou certificat médical visé par un médecin avant le 20 du mois."
                rows={3}
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}

      {/* Modal 2: Worker submitting justification */}
      {submitModalAbsence && (
        <UnifiedModal
          open={!!submitModalAbsence}
          onOpenChange={(o) => !o && setSubmitModalAbsence(null)}
          title="Soumettre votre justification d'absence"
          description={`Absence du ${formatDate(submitModalAbsence.date)}. Votre réponse sera examinée par la direction.`}
          submitLabel="Transmettre à l'administration"
          onSubmit={handleSubmitWorkerJustification}
          submitDisabled={!workerExplanation.trim()}
          size="md"
        >
          <div className="space-y-3">
            <FormField label="Explication de l'absence" required>
              <Textarea
                value={workerExplanation}
                onChange={(e) => setWorkerExplanation(e.target.value)}
                placeholder="Ex. Consultation médicale urgente / Certificat délivré par le Dr. X..."
                rows={4}
              />
            </FormField>
            <FormField label="Référence de document / N° de certificat (optionnel)">
              <Input
                value={documentRef}
                onChange={(e) => setDocumentRef(e.target.value)}
                placeholder="Ex. Certificat Médical N° 458-2026"
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}

      {/* Modal 3: Admin reviewing justification */}
      {reviewModalAbsence && (
        <UnifiedModal
          open={!!reviewModalAbsence}
          onOpenChange={(o) => !o && setReviewModalAbsence(null)}
          title={`Examen de la justification — ${reviewModalAbsence.personnelName}`}
          description={`Absence du ${formatDate(reviewModalAbsence.date)} · Motif fourni : « ${reviewModalAbsence.workerExplanation} »`}
          submitLabel={
            reviewDecision === "accepted"
              ? "Accepter la justification"
              : "Rejeter la justification"
          }
          submitVariant={
            reviewDecision === "accepted" ? "default" : "destructive"
          }
          onSubmit={handleReviewDecision}
          size="md"
        >
          <div className="space-y-4">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setReviewDecision("accepted")}
                className={`flex-1 p-3 rounded-lg border text-left transition-all ${
                  reviewDecision === "accepted"
                    ? "border-status-success bg-status-success/10 text-status-success"
                    : "border-border text-muted-foreground hover:bg-muted/20"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <CheckCircle2 className="h-4 w-4" /> Accepter (Absence
                  Excusée)
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Aucune retenue sur salaire ne sera appliquée.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setReviewDecision("rejected")}
                className={`flex-1 p-3 rounded-lg border text-left transition-all ${
                  reviewDecision === "rejected"
                    ? "border-status-danger bg-status-danger/10 text-status-danger"
                    : "border-border text-muted-foreground hover:bg-muted/20"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <XCircle className="h-4 w-4" /> Rejeter (Non Justifiée)
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  L'absence sera comptabilisée comme non excusée.
                </p>
              </button>
            </div>

            <FormField label="Commentaire de décision administratif" required>
              <Textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="Précisez les motifs de votre décision..."
                rows={3}
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}
    </div>
  );
}
