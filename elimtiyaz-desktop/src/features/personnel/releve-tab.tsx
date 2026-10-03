/**
 * ReleveTab — the append-only activity ledger (plan §09.05 / VAULT §09.06).
 *
 * T-481 (WORKFORCE-508) — the canonical workflow redesign:
 *   - ADMIN (super_admin): records entries FOR a selected staff member
 *     (the §09.05 contract — releve_entries.recorded_by is the ACTING
 *     administrator's account, and the 0009 RLS allows INSERTs only for
 *     the staff quartet; the prevent_self_releve_entry trigger raises if
 *     recorded_by equals the member's own bound account, so an admin
 *     cannot record for themselves either — "use a separate
 *     administrator"). The picker + the ledger of the selected member.
 *   - TEACHER (every non-admin role with the tab): READ-ONLY self view —
 *     their own ledger keyed by their PERSONNEL id (never the account id:
 *     the pre-T-481 tab keyed by session.userId, which never matched the
 *     canonical personnel_id FK). No write form (the server forbids it).
 *
 * The ledger is append-only — the base of the payroll audit. Entries are
 * recorded by the administration; each teacher views their own Relevé.
 */
import { useMemo, useState } from "react";
import { Clock, Save, Loader2, History, Bot, UserCog } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { FormField } from "../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { Role } from "../../core/rbac/roles";
import {
  RELEVE_ACTIVITY_LABELS_FR,
  STAFF_CATEGORY_LABELS_FR,
  type ReleveActivity,
  type Personnel,
} from "../../domain/model/personnel";
import { toIsoDay, formatDate } from "../../core/format/date";

export function ReleveTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const isAdmin = session?.role === Role.SuperAdmin;
  const currentUserId = session?.userId ?? "";

  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  // The viewer's own dossier (the teacher's self view / the admin's own
  // ledger when nothing is selected). T-374 discipline: the ledger key is
  // the PERSONNEL id, never the account id.
  const me = useObservable(
    () => repos.personnel.observeByUserId(currentUserId),
    [currentUserId],
  );

  const [date, setDate] = useState(toIsoDay());
  const [hoursIn, setHoursIn] = useState("08:00");
  const [hoursOut, setHoursOut] = useState("");
  const [activity, setActivity] = useState<ReleveActivity>("course");
  const [submitting, setSubmitting] = useState(false);
  // Admin mode: the staff member the entry is recorded FOR.
  const [targetPersonnelId, setTargetPersonnelId] = useState<string>("");

  const activePersonnel = useMemo(
    () => allPersonnel.filter((p) => p.status === "active"),
    [allPersonnel],
  );
  const target: Personnel | null = useMemo(
    () => activePersonnel.find((p) => p.id === targetPersonnelId) ?? null,
    [activePersonnel, targetPersonnelId],
  );

  // The viewed member: the admin's selection, else the viewer's own dossier.
  const viewedPersonnelId = isAdmin
    ? targetPersonnelId || me?.id || ""
    : me?.id ?? "";

  const myEntries = useObservable(
    () => repos.releve.observeByPersonnel(viewedPersonnelId || "", isoDaysAgo(30), toIsoDay()),
    [viewedPersonnelId],
  );

  async function submit() {
    if (!session || !isAdmin) return;
    if (!target) {
      toast.showWarning(
        "Membre requis",
        "Sélectionnez le collaborateur pour lequel vous enregistrez cette entrée.",
      );
      return;
    }
    const hin = parseTimeToHours(hoursIn);
    const hout = hoursOut ? parseTimeToHours(hoursOut) : null;
    if (hin == null) {
      toast.showWarning("Heure d'arrivée invalide", "Format attendu: HH:MM");
      return;
    }
    if (hout != null && hout <= hin) {
      toast.showWarning("Heures incohérentes", "L'heure de départ doit être après l'arrivée.");
      return;
    }
    setSubmitting(true);
    try {
      // §09.05: the entry is recorded BY this administrator FOR the selected
      // member — personnelId is the member's PERSONNEL id (the canonical FK)
      // and recordedById is the acting admin's account. The 0009 trigger +
      // RLS are the backstop; a rejection surfaces honestly below.
      const r = await repos.releve.logEntry({
        personnelId: target.id,
        personnelName: `${target.firstName} ${target.lastName}`,
        date,
        hoursIn: hin,
        hoursOut: hout,
        activity,
        classId: null,
        subjectId: null,
        recordedById: session.userId,
      });
      if (r.ok) {
        toast.showSuccess(
          "Relevé enregistré",
          `${activityLabel(activity)} · ${date} — ${target.firstName} ${target.lastName}`,
        );
        setHoursOut("");
      } else {
        toast.showError("Échec", r.error.userMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" /> Relevé d'activité
        </CardTitle>
        <CardDescription>
          Registre horaire append-only — base de l'audit paie (plan §09.05).
          {isAdmin
            ? " Les entrées sont enregistrées par l'administration pour le collaborateur sélectionné."
            : " Votre relevé est renseigné par l'administration ; il est consultable en lecture seule."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-2xl">
        {/* ── Admin: the recording form (§09.05 — FOR a selected member) ── */}
        {isAdmin && (
          <>
            <div className="rounded-lg border bg-surface-panel p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <UserCog className="size-3.5" /> Saisie administrateur
              </p>
              <p className="text-[11px] text-muted-foreground">
                Sélectionnez le collaborateur concerné — l'entrée sera horodatée à votre nom
                (enregistreur). Conformément au plan §09.05, un collaborateur ne peut pas
                enregistrer son propre relevé.
              </p>
            </div>

            <FormField label="Collaborateur concerné" required>
              <Select value={targetPersonnelId} onValueChange={setTargetPersonnelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un membre du personnel…" />
                </SelectTrigger>
                <SelectContent>
                  {activePersonnel.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} — {STAFF_CATEGORY_LABELS_FR[p.staffCategory]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField label="Date" required>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </FormField>
              <FormField label="Activité" required>
                <Select value={activity} onValueChange={(v) => setActivity(v as ReleveActivity)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(RELEVE_ACTIVITY_LABELS_FR).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Heure d'arrivée" required>
                <Input type="time" value={hoursIn} onChange={(e) => setHoursIn(e.target.value)} />
              </FormField>
              <FormField label="Heure de départ" hint="Laisser vide si en cours">
                <Input type="time" value={hoursOut} onChange={(e) => setHoursOut(e.target.value)} />
              </FormField>
            </div>
            <div className="flex justify-end">
              <Button onClick={submit} disabled={submitting || !target}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> Enregistrer le relevé
                  </>
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Le relevé est tracé dans le journal d'audit et ne peut pas être modifié après création.
            </p>
          </>
        )}

        {/* ── The ledger view (read-only — 30 days) ── */}
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2 bg-muted/30 flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {isAdmin
                ? target
                  ? `Relevé de ${target.firstName} ${target.lastName} — 30 derniers jours`
                  : me
                    ? "Mon relevé — 30 derniers jours"
                    : "Relevé — 30 derniers jours"
                : "Mon relevé — 30 derniers jours (lecture seule)"}
            </p>
          </div>
          {myEntries.length > 0 ? (
            <ul className="divide-y divide-border text-xs max-h-72 overflow-y-auto">
              {myEntries
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt))
                .map((e) => (
                  <li key={e.id} className="flex items-start gap-2 px-3 py-2">
                    {e.autoKind ? (
                      <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium">{RELEVE_ACTIVITY_LABELS_FR[e.activity]}</span>
                        <span className="text-muted-foreground font-mono">{formatDate(e.date)}</span>
                        <span className="text-muted-foreground font-mono">
                          {hoursToTime(e.hoursIn)}{e.hoursOut != null ? `–${hoursToTime(e.hoursOut)}` : ""}
                        </span>
                        {e.autoKind && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary">
                            auto
                          </span>
                        )}
                      </div>
                      {e.note && <p className="mt-0.5 text-muted-foreground">{e.note}</p>}
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              Aucune entrée sur les 30 derniers jours.
              {isAdmin
                ? " Sélectionnez un collaborateur puis enregistrez une entrée ci-dessus."
                : " Les relevés sont renseignés par l'administration."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function parseTimeToHours(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h + min / 60;
}

/** Format decimal hours back to HH:MM for the list. */
function hoursToTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** ISO date N days ago. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function activityLabel(a: ReleveActivity): string {
  return RELEVE_ACTIVITY_LABELS_FR[a];
}
