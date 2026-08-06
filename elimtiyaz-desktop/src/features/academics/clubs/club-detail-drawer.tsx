/**
 * ClubDetailDrawer — manage a club's memberships + activities.
 *
 * Shows:
 *   - Active memberships list with withdraw action
 *   - Past activities timeline with delete action
 *   - Enroll-student action (picker)
 *   - Log-activity action (form)
 */
import { useState } from "react";
import {
  Users,
  Calendar,
  UserPlus,
  UserMinus,
  Plus,
  Trash2,
  Clock,
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
import type { Club, ClubMembership, ClubActivity } from "../../../domain/model/club";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function ClubDetailDrawer({
  club,
  open,
  onOpenChange,
  canManage,
}: {
  club: Club;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canManage: boolean;
}) {
  const repos = useRepositories();
  const memberships = useObservable(
    () => repos.clubs.observeMemberships(club.id),
    [],
  );
  const activities = useObservable(
    () => repos.clubs.observeActivities(club.id),
    [],
  );
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [logActivityOpen, setLogActivityOpen] = useState(false);

  const activeMemberships = memberships.filter((m) => m.status === "active");
  const withdrawnMemberships = memberships.filter((m) => m.status === "withdrawn");

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      variant="drawer"
      icon={Users}
      iconTone="primary"
      title={club.name}
      description={`${club.code} · ${club.academicYearCode} · ${activeMemberships.length} membre(s) actif(s)`}
      hideSubmit
      cancelLabel="Fermer"
    >
      <div className="space-y-4">
        {club.description && (
          <Card>
            <CardContent className="p-3 text-sm text-muted-foreground">
              {club.description}
            </CardContent>
          </Card>
        )}

        <MembershipsCard
          club={club}
          activeMemberships={activeMemberships}
          withdrawnMemberships={withdrawnMemberships}
          canManage={canManage}
          onEnroll={() => setEnrollOpen(true)}
        />

        <ActivitiesCard
          club={club}
          activities={activities}
          canManage={canManage}
          onLogActivity={() => setLogActivityOpen(true)}
        />
      </div>

      {enrollOpen && (
        <EnrollMemberModal
          open
          onOpenChange={setEnrollOpen}
          club={club}
        />
      )}
      {logActivityOpen && (
        <LogActivityModal
          open
          onOpenChange={setLogActivityOpen}
          club={club}
          activeMemberIds={activeMemberships.map((m) => m.studentId)}
        />
      )}
    </UnifiedModal>
  );
}

// ============================================================================
// Memberships card
// ============================================================================

function MembershipsCard({
  club,
  activeMemberships,
  withdrawnMemberships,
  canManage,
  onEnroll,
}: {
  club: Club;
  activeMemberships: readonly ClubMembership[];
  withdrawnMemberships: readonly ClubMembership[];
  canManage: boolean;
  onEnroll: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  async function handleWithdraw(m: ClubMembership) {
    if (!session) return;
    const res = await repos.clubs.withdrawMember({
      membershipId: m.id,
      withdrawnById: session.userId,
      withdrawnByName: session.displayName,
    });
    if (res.ok) {
      toast.showSuccess("Retrait effectué", `${m.studentName} a été retiré du club.`);
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Membres
            <Badge variant="outline" className="text-[10px]">
              {activeMemberships.length} actif(s)
            </Badge>
            {club.capacity != null && (
              <Badge variant="outline" className="text-[10px]">
                / {club.capacity} max
              </Badge>
            )}
          </h3>
          {canManage && !club.isArchived && (
            <Button size="sm" variant="outline" onClick={onEnroll}>
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Inscrire un élève
            </Button>
          )}
        </div>

        {activeMemberships.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">
            Aucun membre actif.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {activeMemberships.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 p-2 rounded border border-border/60 bg-card hover:bg-accent/5"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {m.studentName}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {m.studentCode} · inscrit le {m.enrolledAt.slice(0, 10)}
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-status-danger hover:bg-status-danger/10"
                    onClick={() => handleWithdraw(m)}
                  >
                    <UserMinus className="h-3 w-3 mr-1" />
                    Retirer
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {withdrawnMemberships.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              {withdrawnMemberships.length} ancien(s) membre(s)
            </summary>
            <div className="mt-2 space-y-1">
              {withdrawnMemberships.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 p-1.5 rounded opacity-70"
                >
                  <span>
                    {m.studentName}{" "}
                    <span className="text-[10px]">
                      (retiré le {m.withdrawnAt?.slice(0, 10)} —{" "}
                      {m.withdrawnReason ?? "—"})
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Activities card
// ============================================================================

function ActivitiesCard({
  club,
  activities,
  canManage,
  onLogActivity,
}: {
  club: Club;
  activities: readonly ClubActivity[];
  canManage: boolean;
  onLogActivity: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  async function handleDelete(a: ClubActivity) {
    if (!session) return;
    const res = await repos.clubs.deleteActivity(
      a.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Activité supprimée", a.title);
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
            Activités
            <Badge variant="outline" className="text-[10px]">
              {activities.length}
            </Badge>
          </h3>
          {canManage && !club.isArchived && (
            <Button size="sm" variant="outline" onClick={onLogActivity}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Loguer une activité
            </Button>
          )}
        </div>

        {activities.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">
            Aucune activité loguée pour ce club.
          </p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {activities.map((a) => (
              <div
                key={a.id}
                className="rounded border border-border/60 bg-card p-3 hover:bg-accent/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {a.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.description}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {a.date.slice(0, 10)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {a.durationMinutes} min
                      </span>
                      <span>
                        {a.attendeeStudentIds.length} participant(s)
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Par {a.conductedByName}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-status-danger hover:bg-status-danger/10"
                      onClick={() => handleDelete(a)}
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
// Enroll member modal
// ============================================================================

function EnrollMemberModal({
  open,
  onOpenChange,
  club,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  club: Club;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const students = useObservable(() => repos.students.observe(), []);
  const existingMemberships = useObservable(
    () => repos.clubs.observeMemberships(club.id),
    [],
  );
  const [studentId, setStudentId] = useState("");
  const [notes, setNotes] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Hide students already active in this club
  const activeMemberIds = new Set(
    existingMemberships
      .filter((m) => m.status === "active")
      .map((m) => m.studentId),
  );
  const availableStudents = students.filter(
    (s) => !activeMemberIds.has(s.id) && s.status === "active",
  );

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const res = await repos.clubs.enrollMember({
      clubId: club.id,
      studentId,
      enrolledById: session.userId,
      enrolledByName: session.displayName,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (res.ok) {
      const stu = students.find((s) => s.id === studentId);
      toast.showSuccess(
        "Inscription réussie",
        `${stu?.firstName} ${stu?.lastName} a été inscrit au club ${club.name}.`,
      );
      onOpenChange(false);
      setStudentId("");
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
      size="sm"
      variant="dialog"
      icon={UserPlus}
      iconTone="primary"
      title={`Inscrire un élève dans ${club.name}`}
      submitLabel="Inscrire"
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
              {availableStudents.length === 0 ? (
                <SelectItem value="__none" disabled>
                  Aucun élève disponible
                </SelectItem>
              ) : (
                availableStudents.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.firstName} {s.lastName} ({s.code})
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Notes (optionnel)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Ex. Débutant, interdit le mercredi…"
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}

// ============================================================================
// Log activity modal
// ============================================================================

function LogActivityModal({
  open,
  onOpenChange,
  club,
  activeMemberIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  club: Club;
  activeMemberIds: readonly string[];
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const students = useObservable(() => repos.students.observe(), []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState("60");
  const [attendees, setAttendees] = useState<Set<string>>(new Set());
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clubStudents = students.filter((s) => activeMemberIds.includes(s.id));

  function toggleAttendee(id: string) {
    setAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const res = await repos.clubs.logActivity({
      clubId: club.id,
      title: title.trim(),
      description: description.trim(),
      date: new Date(date).toISOString(),
      durationMinutes: parseInt(duration, 10) || 60,
      conductedById: session.userId,
      conductedByName: session.displayName,
      attendeeStudentIds: Array.from(attendees),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Activité loguée", title);
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setAttendees(new Set());
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
      title={`Loguer une activité — ${club.name}`}
      submitLabel="Enregistrer"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-3">
        <FormField label="Titre" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Séance 3 — Ouvertures italiennes"
          />
        </FormField>
        <FormField label="Description" required>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Contenu de la séance, exercices, observations…"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date" required>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="Durée (minutes)" required>
            <Input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label={`Participants (${attendees.size}/${clubStudents.length})`}>
          <div className="max-h-40 overflow-y-auto border border-border rounded p-2 space-y-1">
            {clubStudents.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">
                Aucun membre actif dans ce club.
              </p>
            ) : (
              clubStudents.map((s) => (
                <Label
                  key={s.id}
                  className="flex items-center gap-2 cursor-pointer text-sm font-normal hover:bg-accent/10 p-1 rounded"
                >
                  <input
                    type="checkbox"
                    checked={attendees.has(s.id)}
                    onChange={() => toggleAttendee(s.id)}
                    className="h-4 w-4"
                  />
                  <span>
                    {s.firstName} {s.lastName}
                  </span>
                </Label>
              ))
            )}
          </div>
        </FormField>
      </div>
    </UnifiedModal>
  );
}
