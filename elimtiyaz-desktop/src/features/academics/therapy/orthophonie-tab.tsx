/**
 * OrthophonieTab — speech therapy follow-ups + evaluations + sessions.
 *
 * RESTRICTED ACCESS — only visible to users with ViewOrthophonie permission.
 *
 * FINANCE ISOLATION: This tab operates only on `repos.orthophonie`.
 * It does NOT touch the ledger / payments / installments / debt.
 * Billing for ORTH1/ORTH2 sessions is handled separately by Finance.
 */
import { useState, useMemo } from "react";
import {
  Plus,
  Stethoscope,
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
import type { SpeechTherapyFollowUp } from "../../../domain/model/therapy";
import {
  SPEECH_THERAPY_FOLLOWUP_STATUS_LABELS_FR,
} from "../../../domain/model/therapy";
import { canViewSpeechTherapyFollowUp } from "../../../domain/calc/therapy/validation";
import { OrthoFollowUpDetailDrawer } from "./ortho-followup-detail-drawer";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function OrthophonieTab({ canManage }: { canManage: boolean }) {
  const repos = useRepositories();
  const { session } = useAuth();
  const followUps = useObservable(
    () => repos.orthophonie.observeFollowUps(),
    [],
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<SpeechTherapyFollowUp | null>(null);

  const visibleFollowUps = useMemo(() => {
    if (!session) return [];
    return followUps.filter((f) =>
      canViewSpeechTherapyFollowUp(f, {
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
        f.therapistName.toLowerCase().includes(q) ||
        f.reason.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <Card className="border-status-warning/40 bg-status-warning/5">
        <CardContent className="p-3 flex items-start gap-3">
          <Shield className="h-5 w-5 text-status-warning shrink-0 mt-0.5" />
          <div className="text-xs text-foreground space-y-1">
            <p className="font-semibold">Module à accès restreint</p>
            <p className="text-muted-foreground">
              Les enregistrements orthophoniques contiennent des données médicales sensibles.
              L'accès est limité aux orthophonistes désignés, aux administrateurs et aux responsables.
              Toute consultation est journalisée.
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
                placeholder="Rechercher…"
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
            Aucun suivi orthophonique.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((f) => (
            <OrthoCard
              key={f.id}
              followUp={f}
              onClick={() => setDetailTarget(f)}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateOrthoFollowUpModal open onOpenChange={setCreateOpen} />
      )}
      {detailTarget && (
        <OrthoFollowUpDetailDrawer
          followUp={detailTarget}
          open={!!detailTarget}
          onOpenChange={(o) => !o && setDetailTarget(null)}
          canManage={canManage}
        />
      )}
    </div>
  );
}

function OrthoCard({
  followUp,
  onClick,
}: {
  followUp: SpeechTherapyFollowUp;
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
            {SPEECH_THERAPY_FOLLOWUP_STATUS_LABELS_FR[followUp.status]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          <strong>Motif :</strong> {followUp.reason}
        </p>
        <div className="flex items-center justify-between text-xs pt-2 border-t border-border/50">
          <span className="text-muted-foreground">
            <Stethoscope className="h-3 w-3 inline mr-1 text-primary" />
            {followUp.therapistName}
          </span>
          <span className="text-muted-foreground">
            Depuis {followUp.startDate.slice(0, 10)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateOrthoFollowUpModal({
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
  const [therapistId, setTherapistId] = useState("");
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [parentConsent, setParentConsent] = useState(true);
  const [parentConsentDate, setParentConsentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const therapists = personnel.filter(
    (p) =>
      p.firstName.toLowerCase().includes("amel") ||
      p.firstName.toLowerCase().includes("ortho") ||
      p.lastName.toLowerCase().includes("kaci"),
  );
  const therapistOptions = therapists.length > 0 ? therapists : personnel;

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const th = personnel.find((p) => p.id === therapistId);
    if (!th) {
      setAlert({
        tone: "error",
        title: "Orthophoniste requis",
        description: "Veuillez sélectionner un orthophoniste.",
      });
      setSubmitting(false);
      return;
    }
    const res = await repos.orthophonie.createFollowUp(
      {
        studentId,
        therapistId: th.id,
        therapistName: `${th.firstName} ${th.lastName}`,
        reason: reason.trim(),
        startDate,
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
      toast.showSuccess("Suivi ouvert", "Le suivi orthophonique a été créé.");
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
      icon={Stethoscope}
      iconTone="primary"
      title="Ouvrir un suivi orthophonique"
      description="Données sensibles — accès restreint. Consentement parental OBLIGATOIRE."
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
        <FormField label="Orthophoniste responsable" required>
          <Select value={therapistId} onValueChange={setTherapistId}>
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner un orthophoniste" />
            </SelectTrigger>
            <SelectContent>
              {therapistOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Motif du suivi" required hint="Au moins 10 caractères.">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ex. Troubles de l'articulation sur les sifflantes…"
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
          <FormField label="Consentement parental" required>
            <Label className="flex items-center gap-2 cursor-pointer text-sm font-normal">
              <input
                type="checkbox"
                checked={parentConsent}
                onChange={(e) => setParentConsent(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-muted-foreground">Obtenu</span>
            </Label>
          </FormField>
        </div>
        {parentConsent && (
          <FormField label="Date du consentement" required>
            <Input
              type="date"
              value={parentConsentDate}
              onChange={(e) => setParentConsentDate(e.target.value)}
            />
          </FormField>
        )}
        <FormField label="Notes de haut niveau">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}
