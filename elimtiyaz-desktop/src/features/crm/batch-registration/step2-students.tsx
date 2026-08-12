/**
 * Step 2 — Students form (1 → N, unlimited per Plan §04.02).
 *
 * Pure presentational component — state lives in the orchestrator and is
 * threaded via props.
 */
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Badge } from "../../../shared/ui/badge";
import { FormField } from "../../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { LEVEL_YEARS, type AcademicLevel, type Gender } from "../../../domain/model/student";
import {
  TRANSPORT_DESTINATIONS,
  TRANSPORT_DESTINATION_LABELS_FR,
  type TransportDestination,
} from "../../../domain/model/parent";
import type { Step2Student } from "./types";
import { EMPTY_STUDENT } from "./types";

export function Step2({
  students,
  setStudents,
  errors,
  parentTransportDestination,
}: {
  students: Step2Student[];
  setStudents: (s: Step2Student[]) => void;
  errors: Record<string, string>;
  parentTransportDestination: TransportDestination | "";
}) {
  function update(i: number, patch: Partial<Step2Student>) {
    const next = students.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setStudents(next);
  }
  function add() {
    setStudents([
      ...students,
      { ...EMPTY_STUDENT, transportDestination: parentTransportDestination || "" },
    ]);
  }
  function remove(i: number) {
    if (students.length === 1) return; // keep at least 1
    setStudents(students.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {students.map((s, i) => (
        <div key={i} className="rounded-md border border-border p-3 space-y-3 relative">
          <div className="flex items-center justify-between">
            <Badge variant="default">Élève {i + 1}</Badge>
            {students.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-status-danger"
                onClick={() => remove(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Prénom" required error={errors[`stu_${i}_firstName`]}>
              <Input value={s.firstName} onChange={(e) => update(i, { firstName: e.target.value })} placeholder="Yacine" />
            </FormField>
            <FormField label="Nom" required error={errors[`stu_${i}_lastName`]}>
              <Input value={s.lastName} onChange={(e) => update(i, { lastName: e.target.value })} placeholder="Benali" />
            </FormField>
            <FormField label="Genre">
              <Select value={s.gender} onValueChange={(v) => update(i, { gender: v as Gender })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Garçon</SelectItem>
                  <SelectItem value="female">Fille</SelectItem>
                  <SelectItem value="unspecified">Non spécifié</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Date de naissance" required error={errors[`stu_${i}_birthDate`]}>
              <Input type="date" value={s.birthDate} onChange={(e) => update(i, { birthDate: e.target.value })} />
            </FormField>
            <FormField label="Niveau scolaire">
              <Select
                value={s.level}
                onValueChange={(v) => update(i, { level: v as AcademicLevel, gradeYear: 1 })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="primaire">Primaire (5 ans)</SelectItem>
                  <SelectItem value="cem">CEM (4 ans)</SelectItem>
                  <SelectItem value="lycee">Lycée (3 ans)</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Année">
              <Select
                value={String(s.gradeYear)}
                onValueChange={(v) => update(i, { gradeYear: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: LEVEL_YEARS[s.level] }, (_, k) => k + 1).map((y) => (
                    <SelectItem key={y} value={String(y)}>Année {y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Zone transport" hint="Laisser vide si pas de transport">
              <Select
                value={s.transportDestination}
                onValueChange={(v) => update(i, { transportDestination: v as TransportDestination | "" })}
              >
                <SelectTrigger><SelectValue placeholder="Sans transport" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sans transport</SelectItem>
                  {TRANSPORT_DESTINATIONS.map((d) => (
                    <SelectItem key={d} value={d}>{TRANSPORT_DESTINATION_LABELS_FR[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Notes médicales" hint="Allergies, conditions particulières">
              <Input
                value={s.medicalNotes}
                onChange={(e) => update(i, { medicalNotes: e.target.value })}
                placeholder="Asthme léger"
              />
            </FormField>
          </div>
        </div>
      ))}
      <Button variant="outline" className="w-full" onClick={add}>
        <Plus className="h-4 w-4" /> Ajouter un autre enfant
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Plan §04.02: pas de limite au nombre d'enfants par parent.
      </p>
    </div>
  );
}
