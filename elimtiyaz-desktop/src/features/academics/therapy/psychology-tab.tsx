/**
 * PsychologyTab — psychological follow-ups + sessions + reports.
 *
 * RESTRICTED ACCESS — only visible to users with ViewPsychology permission.
 * Records marked `restricted` confidentiality are only visible to:
 *   - SuperAdmin / Manager (oversight)
 *   - The assigned psychologist
 *
 * FINANCE ISOLATION: This tab operates only on `repos.psychology`.
 * It does NOT touch the ledger / payments / installments / debt.
 * Billing for PSY1/PSY2 sessions is handled separately by Finance.
 */
import { useState, useMemo } from "react";
import {
  Plus,
  Brain,
  Lock,
  Search,
  Shield,
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
import type { PsychologicalFollowUp } from "../../../domain/model/therapy";
import {
  PSYCHOLOGICAL_FOLLOWUP_STATUS_LABELS_FR,
  CONFIDENTIALITY_LABELS_FR,
} from "../../../domain/model/therapy";
import { canViewPsychologicalFollowUp } from "../../../domain/calc/therapy/validation";
import { PsychFollowUpDetailDrawer } from "./psych-followup-detail-drawer";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function PsychologyTab({ canManage }: { canManage: boolean }) {
  const repos = useRepositories();
  const { session } = useAuth();
  const followUps = useObservable(
    () => repos.psychology.observeFollowUps(),
    [],
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<PsychologicalFollowUp | null>(null);

  // RBAC filtering: hide restricted records from non-authorized viewers
  const visibleFollowUps = useMemo(() => {
    if (!session) return [];
    return followUps.filter((f) =>
      canViewPsychologicalFollowUp(f, {
        userId: session.userId,
        role: session.role,
        hasPermission: (perm) => session.permissions.has(perm as never),
      }),
    );
  }, [followUps, session]);

  const filtered = visibleFollowUps.filter((f) => {
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        f.studentName.toLowerCase().includes(q) ||
        f.studentCode.toLowerCase().includes(q) ||
        f.psychologistName.toLowerCase().includes(q) ||
        f.reason.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Restricted-access warning banner */}
      <Card className="border-status-warning/40 bg-status-warning/5">
        <CardContent className="p-3 flex items-start gap-3">
          <Shield className="h-5 w-5 text-status-warning shrink-0 mt-0.5" />
          <div className="text-xs text-foreground space-y-1">
            <p className="font-semibold">Module à accès restreint</p>
            <p className="text-muted-foreground">
              Les enregistrements psychologiques contiennent des données médicales sensibles.
              L'accès est limité aux psychologues désignés, aux administrateurs et aux responsables.
              Toute consultation est journalisée à des fins d'audit.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="active">Actifs</SelectItem>
                <SelectItem value="paused">En pause</SelectItem>
                <SelectItem value="closed">Clôturés</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher (élève, motif…)"
                className="h-7 w-64 pl-7 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {filtered.length} suivi(s)
            </span>
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nouveau suivi
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucun suivi psychologique.{" "}
            {canManage
              ? "Cliquez sur « Nouveau suivi » pour en ouvrir un."
              : "Aucun suivi ne vous est actuellement accessible."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((f) => (
            <FollowUpCard
              key={f.id}
              followUp={f}
              onClick={() => setDetailTarget(f)}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateFollowUpModal open onOpenChange={setCreateOpen} />
      )}
      {detailTarget && (
        <PsychFollowUpDetailDrawer
          followUp={detailTarget}
          open={!!detailTarget}
          onOpenChange={(o) => !o && setDetailTarget(null)}
          canManage={canManage}
        />
      )}
    </div>
  );
}

// ============================================================================
// Follow-up card
// ============================================================================

function FollowUpCard({
  followUp,
  onClick,
}: {
  followUp: PsychologicalFollowUp;
  onClick: () => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:border-primary/40 transition-all"
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              {followUp.studentName}
            </h3>
            <p className="text-[10px] font-mono text-muted-foreground">
              {followUp.studentCode}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant="outline"
              className={`text-[10px] ${
                followUp.status === "active"
                  ? "bg-status-success/10 text-status-success border-status-success/30"
                  : followUp.status === "paused"
                    ? "bg-status-warning/10 text-status-warning border-status-warning/30"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {PSYCHOLOGICAL_FOLLOWUP_STATUS_LABELS_FR[followUp.status]}
            </Badge>
            {followUp.confidentialityLevel === "restricted" && (
              <Badge
                variant="outline"
                className="text-[10px] bg-status-danger/10 text-status-danger border-status-danger/30"
              >
                <Lock className="h-2.5 w-2.5 mr-0.5" />
                {CONFIDENTIALITY_LABELS_FR[followUp.confidentialityLevel]}
              </Badge>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2">
          <strong>Motif :</strong> {followUp.reason}
        </p>

        <div className="flex items-center justify-between text-xs pt-2 border-t border-border/50">
          <span className="text-muted-foreground">
            <Brain className="h-3 w-3 inline mr-1 text-primary" />
            {followUp.psychologistName}
          </span>
          <span className="text-muted-foreground">
            Depuis {followUp.startDate.slice(0, 10)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Create follow-up modal
// ============================================================================

function CreateFollowUpModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const students = useObservable(() => repos.students.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const [studentId, setStudentId] = useState("");
  const [psychologistId, setPsychologistId] = useState("");
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [confidentiality, setConfidentiality] = useState<"standard" | "restricted">("standard");
  const [parentConsent, setParentConsent] = useState(true);
  const [parentConsentDate, setParentConsentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filter personnel to only psychologists (best-effort heuristic — there is no
  // dedicated "psychologist" role/category in the existing model, so we use
  // a name-based heuristic + fallback to all staff).
  const psychologists = personnel.filter(
    (p) =>
      p.firstName.toLowerCase().includes("leila") ||
      p.firstName.toLowerCase().includes("psych") ||
      p.lastName.toLowerCase().includes("bensaïd") ||
      p.lastName.toLowerCase().includes("bensaid"),
  );
  // If no psychologists found in seed, fall back to all personnel
  const psychologistOptions =
    psychologists.length > 0 ? psychologists : personnel;

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const psy = personnel.find((p) => p.id === psychologistId);
    if (!psy) {
      setAlert({
        tone: "error",
        title: "Psychologue requis",
        description: "Veuillez sélectionner un psychologue.",
      });
      setSubmitting(false);
      return;
    }
    const res = await repos.psychology.createFollowUp(
      {
        studentId,
        psychologistId: psy.id,
        psychologistName: `${psy.firstName} ${psy.lastName}`,
        reason: reason.trim(),
        startDate,
        confidentialityLevel: confidentiality,
        parentConsent,
        parentConsentDate: parentConsent ? parentConsentDate : null,
        notes: notes.trim() || null,
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      session.userId,
      session.displayName,
    );
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess(
        "Suivi ouvert",
        "Le suivi psychologique a été créé avec succès.",
      );
      onOpenChange(false);
      setReason("");
      setNotes("");
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
      icon={Brain}
      iconTone="primary"
      title="Ouvrir un suivi psychologique"
      description="Données sensibles — accès restreint. Le consentement parental est OBLIGATOIRE."
      submitLabel="Ouvrir le suivi"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-3">
        <FormField label="Élève" required>
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner un élève" />
            </SelectTrigger>
            <SelectContent>
              {students
                .filter((s) => s.status === "active")
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.firstName} {s.lastName} ({s.code})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Psychologue responsable" required>
          <Select value={psychologistId} onValueChange={setPsychologistId}>
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner un psychologue" />
            </SelectTrigger>
            <SelectContent>
              {psychologistOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          label="Motif du suivi"
          required
          hint="Au moins 10 caractères. Décrivez la raison de l'orientation."
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ex. Anxiété scolaire signalée par l'enseignant…"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date de début" required>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="Niveau de confidentialité" required>
            <Select
              value={confidentiality}
              onValueChange={(v) => setConfidentiality(v as "standard" | "restricted")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="restricted">Restreint (cas sensible)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <FormField label="Consentement parental" required>
          <div className="space-y-2">
            <Label className="flex items-center gap-2 cursor-pointer text-sm font-normal">
              <input
                type="checkbox"
                checked={parentConsent}
                onChange={(e) => setParentConsent(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-muted-foreground">
                J'atteste que le consentement parental a été obtenu
              </span>
            </Label>
            {parentConsent && (
              <Input
                type="date"
                value={parentConsentDate}
                onChange={(e) => setParentConsentDate(e.target.value)}
                className="h-8 text-xs"
              />
            )}
          </div>
        </FormField>
        <FormField label="Notes de haut niveau" hint="Visibles au personnel autorisé. NE PAS y mettre le détail des séances.">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Ex. Suivi hebdomadaire. Coordination avec l'enseignant principal."
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}
