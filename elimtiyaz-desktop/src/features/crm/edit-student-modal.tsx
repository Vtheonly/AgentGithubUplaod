/**
 * EditStudentModal — edit form for an existing student.
 *
 * FIX (missing editing feature): `updateStudent` existed in every repository
 * implementation but NO UI ever called it — the CRM was read-only after
 * registration. This modal wires the student drawer's "Modifier" action to
 * `repos.students.updateStudent`, with validation + audit (repository-side).
 *
 * Editable fields: identity (prénom/nom/genre/date de naissance),
 * placement (niveau/année/classe), status, medical notes, transport tier,
 * and payment plan.
 */
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import {
  GRADE_LEVEL_LABELS_FR,
  LEVEL_LABELS_FR,
  STUDENT_STATUS_LABELS_FR,
  academicLevelFromGradeLevel,
  gradeYearFromGradeLevel,
  type GradeLevel,
  type Student,
  type StudentStatus,
} from "../../domain/model/student";
import type { Gender } from "../../domain/model/parent";
import type { PaymentPlan } from "../../domain/model/payment";
import {
  TRANSPORT_DESTINATIONS,
  TRANSPORT_DESTINATION_LABELS_FR,
  type TransportDestination,
} from "../../domain/model/parent";

/** Sentinel for "no transport" — Radix Select forbids empty-string values. */
const NO_TRANSPORT = "__none__";
/** Sentinel for "no class assigned". */
const NO_CLASS = "__unassigned__";

export function EditStudentModal({
  studentId,
  open,
  onOpenChange,
}: {
  studentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const student = useObservable(
    () => repos.students.observeById(studentId ?? ""),
    [studentId],
  );
  const classes = useObservable(() => repos.classes.observe(), []);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<Gender>("unspecified");
  const [birthDate, setBirthDate] = useState("");
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>("1ap");
  const [classId, setClassId] = useState<string>(NO_CLASS);
  const [status, setStatus] = useState<StudentStatus>("active");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [transportDestination, setTransportDestination] = useState<string>(NO_TRANSPORT);
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan>("tranches");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the modal opens or the target student changes.
  useEffect(() => {
    if (!open || !student) return;
    setFirstName(student.firstName);
    setLastName(student.lastName);
    setGender(student.gender);
    setBirthDate(student.birthDate);
    setGradeLevel(student.gradeLevel);
    setClassId(student.classId ?? NO_CLASS);
    setStatus(student.status);
    setMedicalNotes(student.medicalNotes ?? "");
    setTransportDestination(
      (student.transportTier as TransportDestination | null) ?? NO_TRANSPORT,
    );
    setPaymentPlan(student.paymentPlan);
    setErrors({});
  }, [open, student]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = "Prénom requis";
    if (!lastName.trim()) e.lastName = "Nom requis";
    if (!birthDate) e.birthDate = "Date de naissance requise";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!studentId || !session) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const result = await repos.students.updateStudent(studentId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: `${firstName.trim()} ${lastName.trim()}`,
        gender,
        birthDate,
        level: academicLevelFromGradeLevel(gradeLevel),
        gradeYear: gradeYearFromGradeLevel(gradeLevel),
        gradeLevel,
        classId: classId === NO_CLASS ? null : classId,
        medicalNotes: medicalNotes.trim() || null,
        transportTier: transportDestination === NO_TRANSPORT ? null : transportDestination,
        status,
        paymentPlan,
      });
      if (result.ok) {
        toast.showSuccess(
          "Élève modifié",
          `${firstName.trim()} ${lastName.trim()} a été mis à jour.`,
        );
        onOpenChange(false);
      } else {
        toast.showError("Échec de la modification", result.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="md"
      icon={Pencil}
      iconTone="primary"
      title="Modifier l'élève"
      description="Les changements sont tracés dans le journal d'audit."
      submitLabel="Enregistrer"
      submitIcon={Pencil}
      onSubmit={submit}
      submitLoading={saving}
      submitDisabled={saving}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Prénom" required error={errors.firstName}>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </FormField>
        <FormField label="Nom" required error={errors.lastName}>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </FormField>
        <FormField label="Genre">
          <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Garçon</SelectItem>
              <SelectItem value="female">Fille</SelectItem>
              <SelectItem value="unspecified">Non spécifié</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Date de naissance" required error={errors.birthDate}>
          <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </FormField>
        <FormField
          label="Niveau scolaire"
          hint={`${LEVEL_LABELS_FR[academicLevelFromGradeLevel(gradeLevel)]} · Année ${gradeYearFromGradeLevel(gradeLevel)}`}
        >
          <Select value={gradeLevel} onValueChange={(v) => setGradeLevel(v as GradeLevel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(GRADE_LEVEL_LABELS_FR) as GradeLevel[]).map((g) => (
                <SelectItem key={g} value={g}>{GRADE_LEVEL_LABELS_FR[g]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Classe" hint="Non assignée si aucune sélection">
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CLASS}>Non assignée</SelectItem>
              {classes
                .filter((c) => c.isActive !== false)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Statut">
          <Select value={status} onValueChange={(v) => setStatus(v as StudentStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(STUDENT_STATUS_LABELS_FR) as StudentStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STUDENT_STATUS_LABELS_FR[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Zone transport" hint="Sans transport si aucune sélection">
          <Select
            value={transportDestination}
            onValueChange={setTransportDestination}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TRANSPORT}>Sans transport</SelectItem>
              {TRANSPORT_DESTINATIONS.map((d) => (
                <SelectItem key={d} value={d}>{TRANSPORT_DESTINATION_LABELS_FR[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Plan de paiement" hint="Scolarité : 3 tranches ou année complète">
          <Select value={paymentPlan} onValueChange={(v) => setPaymentPlan(v as PaymentPlan)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tranches">3 tranches (40/30/30)</SelectItem>
              <SelectItem value="full_annual">Année complète (−10% avant le 30 juin)</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Notes médicales" className="md:col-span-2">
          <Textarea
            value={medicalNotes}
            onChange={(e) => setMedicalNotes(e.target.value)}
            placeholder="Allergies, conditions particulières…"
            rows={2}
          />
        </FormField>
      </div>
      {student && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Code élève <span className="font-mono">{student.code}</span> — non modifiable.
        </p>
      )}
    </UnifiedModal>
  );
}
