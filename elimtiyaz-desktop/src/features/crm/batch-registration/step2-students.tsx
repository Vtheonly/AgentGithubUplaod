/**
 * Step 2 — Students form (1 → N, unlimited per Plan §04.02).
 *
 * Pure presentational component — state lives in the orchestrator and is
 * threaded via props.
 *
 * CALC-001 (2026-09-12): the ghost fields « Niveau l'année dernière » and
 * « Rang l'année dernière » (feeding the fictional passage_palier /
 * highest_average rules) are REMOVED. In their place: the negotiated
 * REMISE input (per student — the school's real-world discount is manual,
 * e.g. HEBBAZ 3 kids = 10 000 vs KOUBA 3 kids = 41 500) and the
 * sticker-price flag (the SEDIKI workbook case).
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
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import {
  TRANSPORT_DESTINATIONS,
  TRANSPORT_DESTINATION_LABELS_FR,
  type TransportDestination,
} from "../../../domain/model/parent";
import type { PaymentPlan } from "../../../domain/model/payment";
import type { Step2Student } from "./types";
import { EMPTY_STUDENT } from "./types";

/** Sentinel for "no transport" — Radix Select forbids empty-string values.
 *  FIX: `<SelectItem value="">` threw at runtime when the dropdown opened. */
const NO_TRANSPORT = "__none__";

/** Sentinel for "no class assigned" — Radix Select forbids empty-string values. */
const NO_CLASS = "__none__";

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
  const repos = useRepositories();
  // vault §04.03 — "Assigned Academic Level & Class": offer the class roster
  // filtered by the selected level so children can be placed in a section at
  // registration time (previously class assignment required a later edit).
  const classes = useObservable(() => repos.classes.observe(), []);

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
    setStudents(students.filter((s, idx) => idx !== i));
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Prénom" required error={errors[`stu_${i}_firstName`]}>
              <Input value={s.firstName} onChange={(e) => update(i, { firstName: e.target.value })} placeholder="Yacine" />
            </FormField>
            {/* vault §04.03 — optional middle name, part of the child block. */}
            <FormField label="Deuxième prénom" hint="Optionnel">
              <Input value={s.middleName} onChange={(e) => update(i, { middleName: e.target.value })} placeholder="Mohamed" />
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
                onValueChange={(v) => update(i, { gradeYear: Number(v), classId: "" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: LEVEL_YEARS[s.level] }, (_, k) => k + 1).map((y) => (
                    <SelectItem key={y} value={String(y)}>Année {y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {/* vault §04.03 — class assignment within the selected level. */}
            <FormField label="Classe" hint="Optionnel — filtré par niveau">
              <Select
                value={s.classId || NO_CLASS}
                onValueChange={(v) => update(i, { classId: v === NO_CLASS ? "" : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLASS}>Non assignée</SelectItem>
                  {classes
                    .filter((c) => c.level === s.level && c.gradeYear === s.gradeYear)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
            {/* CALC-001 — the 20 real towns replace the 4 grouped zones. */}
            <FormField label="Commune (transport)" hint="Laisser vide si pas de transport">
              {/* FIX (Radix crash): empty-string SelectItem values are
                  forbidden by Radix — use a sentinel mapped back to "". */}
              <Select
                value={s.transportDestination || NO_TRANSPORT}
                onValueChange={(v) =>
                  update(i, {
                    transportDestination: v === NO_TRANSPORT ? "" : (v as TransportDestination),
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TRANSPORT}>Sans transport</SelectItem>
                  {TRANSPORT_DESTINATIONS.filter((d) => !d.includes("_sahel_") && !d.startsWith("ville_") && !d.startsWith("boudouaou_") && d !== "autres").map((d) => (
                    <SelectItem key={d} value={d}>{TRANSPORT_DESTINATION_LABELS_FR[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Plan de paiement">
              <Select
                value={s.paymentPlan}
                onValueChange={(v) => update(i, { paymentPlan: v as PaymentPlan })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tranches">4 versements (FI + 3 tranches)</SelectItem>
                  <SelectItem value="full_annual">Année complète (−5% scolarité avant le 30 juin)</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {/* CALC-001 — negotiated remise (the school's real discount input). */}
            <FormField
              label="Remise négociée (DZD)"
              hint="Remise manuelle négociée — déduite de la tranche V2. La fratrie (−5 000 DA/enfant supp.) est suggérée par défaut."
            >
              <Input
                value={s.remise}
                onChange={(e) => update(i, { remise: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="ex. 5000"
                inputMode="numeric"
              />
            </FormField>
            {/* CALC-001 — the sticker-price case (SEDIKI rows in the workbook). */}
            <FormField
              label="Devis au prix affiché"
              hint="Exception SEDIKI : la remise est enregistrée mais NON déduite du devis annuel (elle réduit uniquement la tranche V2)."
            >
              <Select
                value={s.chargeStickerPrice ? "sticker" : "apply"}
                onValueChange={(v) => update(i, { chargeStickerPrice: v === "sticker" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="apply">Appliquer la remise au devis (défaut)</SelectItem>
                  <SelectItem value="sticker">Prix affiché — remise non déduite du devis</SelectItem>
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
