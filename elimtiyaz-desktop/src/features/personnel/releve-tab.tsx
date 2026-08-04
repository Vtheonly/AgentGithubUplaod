/**
 * ReleveTab — clock-in/out form for the current user.
 *
 * Plan §09.05: append-only ledger per teacher. Activities: Cours / Réunion /
 * Surveillance / Correction / Autre. Audit basis for payroll.
 */
import { useState } from "react";
import { Clock, Save, Loader2 } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
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
import { toIsoDay } from "../../core/format/date";

export function ReleveTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [date, setDate] = useState(toIsoDay());
  const [hoursIn, setHoursIn] = useState("08:00");
  const [hoursOut, setHoursOut] = useState("");
  const [activity, setActivity] = useState<ReleveActivity>("course");
  const [submitting, setSubmitting] = useState(false);

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
      <CardContent className="space-y-3 max-w-2xl">
        <div className="grid gap-3 md:grid-cols-2">
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

function activityLabel(a: ReleveActivity): string {
  return RELEVE_ACTIVITY_LABELS_FR[a];
}
