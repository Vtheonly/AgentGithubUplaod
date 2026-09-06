/**
 * ReleveTab — clock-in/out form for the current user + read-only self-view.
 *
 * Plan §09.05 / VAULT §09.06: append-only ledger per teacher. Activities:
 * Cours / Réunion / Surveillance / Correction / Autre. Audit basis for
 * payroll. AUTO-POPULATED entries (grades entered, homework issued, roll
 * calls — tagged `autoKind`) appear alongside manual timestamps; the whole
 * ledger is read-only for the teacher (each teacher views their own Relevé,
 * admins view all teachers' Relevés via the personnel drawer).
 */
import { useState } from "react";
import { Clock, Save, Loader2, History, Bot } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { FormField } from "../../shared/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import {
  RELEVE_ACTIVITY_LABELS_FR,
  type ReleveActivity,
} from "../../domain/model/personnel";
import { toIsoDay, formatDate } from "../../core/format/date";

export function ReleveTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [date, setDate] = useState(toIsoDay());
  const [hoursIn, setHoursIn] = useState("08:00");
  const [hoursOut, setHoursOut] = useState("");
  const [activity, setActivity] = useState<ReleveActivity>("course");
  const [submitting, setSubmitting] = useState(false);

  // VAULT §09.06 — read-only self-view: the teacher sees their own last
  // 30 days of Relevé entries (manual + auto-populated).
  const myEntries = useObservable(
    () => repos.releve.observeByPersonnel(session?.userId ?? "", isoDaysAgo(30), toIsoDay()),
    [session?.userId],
  );

  async function submit() {
    if (!session) return;
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
      const r = await repos.releve.logEntry({
        personnelId: session.userId,
        personnelName: session.displayName,
        date,
        hoursIn: hin,
        hoursOut: hout,
        activity,
        classId: null,
        subjectId: null,
      });
      if (r.ok) {
        toast.showSuccess("Relevé enregistré", `${activityLabel(activity)} · ${date}`);
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
          Horodatage (clock-in/out). Append-only — base du audit paie (plan §09.05).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-2xl">
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
          <Button onClick={submit} disabled={submitting}>
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

        {/* VAULT §09.06 — self-view (last 30 days, read-only) */}
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2 bg-muted/30 flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Mon relevé — 30 derniers jours (lecture seule)
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
              Aucune entrée sur les 30 derniers jours. Les saisies de notes, publications de
              devoirs et appels y apparaissent automatiquement.
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

/** Format decimal hours back to HH:MM for the self-view list. */
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
