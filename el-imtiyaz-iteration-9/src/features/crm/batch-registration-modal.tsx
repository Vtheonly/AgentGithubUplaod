/**
 * BatchRegistrationModal — 4-step atomic registration wizard.
 *
 * Plan §04.03: "4-step atomic flow: Parent → N children → billing config → BEGIN…COMMIT"
 *
 * Steps:
 *   1. Parent info (firstName, lastName, phone, etc.)
 *   2. N children (unlimited — "Add Another Child" button, no upper bound per §04.02)
 *   3. Billing config (reads from PricingConfig — tuition per level + transport tier + registration fee)
 *   4. Review + atomic submit
 *
 * On submit, calls StudentRepository.batchRegister(input) which is the
 * atomic operation. If any step fails, the whole transaction rolls back.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Loader2,
  Users,
  User,
  Wallet,
  ClipboardCheck,
  UserPlus,
} from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useToast } from "../../state/toast-context";
import { useAuth } from "../../state/auth-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/components/unified-modal";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Badge } from "../../shared/ui/badge";
import { FormField } from "../../shared/components/form-field";
import { MoneyInput } from "../../shared/components/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import {
  LEVEL_LABELS_FR,
  LEVEL_YEARS,
  type AcademicLevel,
  type Gender,
  type CreateStudentInput,
} from "../../domain/model/student";
import type { CreateParentInput } from "../../domain/model/parent";
import type { CityTier } from "../../domain/model/parent";
import { formatDzd } from "../../core/format/currency";
import { tuitionForLevel, transportForTier, tuitionTranches } from "../../domain/model/pricing";

interface Step1Parent {
  firstName: string;
  lastName: string;
  gender: Gender;
  phone: string;
  whatsapp: string;
  email: string;
  occupation: string;
  address: string;
  cityTier: CityTier | "";
  preferredLanguage: "fr" | "ar";
}

interface Step2Student {
  firstName: string;
  lastName: string;
  gender: Gender;
  birthDate: string;
  level: AcademicLevel;
  gradeYear: number;
  transportTier: CityTier | "";
  medicalNotes: string;
}

const EMPTY_PARENT: Step1Parent = {
  firstName: "",
  lastName: "",
  gender: "unspecified",
  phone: "",
  whatsapp: "",
  email: "",
  occupation: "",
  address: "",
  cityTier: "",
  preferredLanguage: "fr",
};

const EMPTY_STUDENT: Step2Student = {
  firstName: "",
  lastName: "",
  gender: "unspecified",
  birthDate: "",
  level: "primaire",
  gradeYear: 1,
  transportTier: "",
  medicalNotes: "",
};

const PHONE_RE = /^[+]?[0-9\s]{8,15}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function BatchRegistrationModal({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmitted?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const pricing = useObservable(() => repos.pricing.observe(), []);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [parent, setParent] = useState<Step1Parent>(EMPTY_PARENT);
  const [students, setStudents] = useState<Step2Student[]>([{ ...EMPTY_STUDENT }]);
  const [includeRegistration, setIncludeRegistration] = useState(true);
  const [includeTransport, setIncludeTransport] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<NonNullable<UnifiedModalProps["alert"]> | null>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(1);
        setParent(EMPTY_PARENT);
        setStudents([{ ...EMPTY_STUDENT }]);
        setIncludeRegistration(true);
        setIncludeTransport(true);
        setErrors({});
        setAlert(null);
      }, 200);
    }
  }, [open]);

  // === Step validation ===
  function validateStep1(): boolean {
    const e: Record<string, string> = {};
    if (!parent.firstName.trim()) e.parent_firstName = "Prénom requis";
    if (!parent.lastName.trim()) e.parent_lastName = "Prénom requis";
    if (!parent.phone.trim()) e.parent_phone = "Téléphone requis";
    else if (!PHONE_RE.test(parent.phone)) e.parent_phone = "Format invalide (8-15 chiffres)";
    if (parent.email && !EMAIL_RE.test(parent.email)) e.parent_email = "E-mail invalide";
    if (parent.whatsapp && !PHONE_RE.test(parent.whatsapp)) e.parent_whatsapp = "Format invalide";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2(): boolean {
    const e: Record<string, string> = {};
    students.forEach((s, i) => {
      if (!s.firstName.trim()) e[`stu_${i}_firstName`] = "Prénom requis";
      if (!s.lastName.trim()) e[`stu_${i}_lastName`] = "Nom requis";
      if (!s.birthDate) e[`stu_${i}_birthDate`] = "Date de naissance requise";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // === Billing computation (step 3) ===
  const billing = useMemo(() => {
    const registrationFee = includeRegistration ? pricing.registrationFee : 0;
    let tuition = 0;
    let transport = 0;
    const perStudent = students.map((s, i) => {
      const t = tuitionForLevel(pricing, s.level);
      const tr = includeTransport && s.transportTier ? transportForTier(pricing, s.transportTier as CityTier) : 0;
      tuition += t;
      transport += tr;
      return {
        index: i + 1,
        name: `${s.firstName} ${s.lastName}`.trim() || `Élève ${i + 1}`,
        level: LEVEL_LABELS_FR[s.level],
        tuition: t,
        transport: tr,
        tranches: tuitionTranches(t),
      };
    });
    return {
      perStudent,
      registrationFee,
      totalTuition: tuition,
      totalTransport: transport,
      grandTotal: registrationFee + tuition + transport,
    };
  }, [students, pricing, includeRegistration, includeTransport]);

  // === Atomic submit ===
  async function submit() {
    if (!session) return;
    setSubmitting(true);
    try {
      const parentInput: CreateParentInput = {
        firstName: parent.firstName.trim(),
        lastName: parent.lastName.trim(),
        gender: parent.gender,
        phone: parent.phone.trim(),
        whatsapp: parent.whatsapp.trim() || null,
        email: parent.email.trim() || null,
        occupation: parent.occupation.trim() || null,
        address: parent.address.trim() || null,
        cityTier: parent.cityTier || null,
        preferredLanguage: parent.preferredLanguage,
      };
      const studentInputs: CreateStudentInput[] = students.map((s) => ({
        firstName: s.firstName.trim(),
        lastName: s.lastName.trim(),
        gender: s.gender,
        birthDate: s.birthDate,
        level: s.level,
        gradeYear: s.gradeYear,
        medicalNotes: s.medicalNotes.trim() || null,
        transportTier: s.transportTier || null,
      }));

      const result = await repos.students.batchRegister({
        parent: parentInput,
        students: studentInputs,
      });

      if (result.ok) {
        toast.showSuccess(
          "Inscription réussie",
          `Parent ${result.value.parent.code} + ${result.value.students.length} élève(s) créé(s) atomiquement.`,
        );
        onSubmitted?.(result.value.parent.id);
        onOpenChange(false);
      } else {
        setAlert({
          tone: "error",
          title: "Échec de l'inscription",
          description: result.error.userMessage,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const stepIcon = (n: 1 | 2 | 3 | 4) => {
    if (n === 1) return <User className="h-4 w-4" />;
    if (n === 2) return <Users className="h-4 w-4" />;
    if (n === 3) return <Wallet className="h-4 w-4" />;
    return <ClipboardCheck className="h-4 w-4" />;
  };

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      variant="dialog"
      icon={UserPlus}
      iconTone="primary"
      title="Inscription groupée (Parent + Élèves)"
      description="Inscription atomique — tout réussit ou tout échoue. Plan §04.03."
      alert={alert}
      onDismissAlert={() => setAlert(null)}
      footer={
        <>
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
              disabled={submitting}
            >
              <ChevronLeft className="h-4 w-4" /> Précédent
            </Button>
          )}
          <div className="flex-1" />
          {step < 4 && (
            <Button
              onClick={() => {
                if (step === 1 && !validateStep1()) {
                  setAlert({ tone: "warning", title: "Étape incomplète", description: "Vérifiez les champs requis du parent." });
                  return;
                }
                if (step === 2 && !validateStep2()) {
                  setAlert({ tone: "warning", title: "Étape incomplète", description: "Vérifiez les champs requis des élèves." });
                  return;
                }
                setAlert(null);
                setStep((s) => (s + 1) as 2 | 3 | 4);
              }}
            >
              Suivant <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          {step === 4 && (
            <Button onClick={submit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Inscription…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" /> Inscrire atomiquement
                </>
              )}
            </Button>
          )}
        </>
      }
    >
      {/* Stepper */}
      <div className="flex items-center justify-between gap-2 mb-4">
        {([1, 2, 3, 4] as const).map((n) => {
          const active = step === n;
          const done = step > n;
          return (
            <div key={n} className="flex items-center gap-2 flex-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-status-success bg-status-success/15 text-status-success"
                      : "border-border text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : stepIcon(n)}
              </div>
              <span className={`text-xs ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                {n === 1 ? "Parent" : n === 2 ? "Élèves" : n === 3 ? "Facturation" : "Validation"}
              </span>
              {n < 4 && <div className="flex-1 h-px bg-border mx-2" />}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="max-h-[50vh] overflow-y-auto">
        {step === 1 && <Step1 parent={parent} setParent={setParent} errors={errors} />}
        {step === 2 && (
          <Step2
            students={students}
            setStudents={setStudents}
            errors={errors}
            parentCityTier={parent.cityTier}
          />
        )}
        {step === 3 && (
          <Step3
            billing={billing}
            includeRegistration={includeRegistration}
            setIncludeRegistration={setIncludeRegistration}
            includeTransport={includeTransport}
            setIncludeTransport={setIncludeTransport}
          />
        )}
        {step === 4 && <Step4 parent={parent} students={students} billing={billing} />}
      </div>
    </UnifiedModal>
  );
}

// ============================================================
// Step 1 — Parent info
// ============================================================
function Step1({
  parent,
  setParent,
  errors,
}: {
  parent: Step1Parent;
  setParent: (p: Step1Parent) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FormField label="Prénom" required error={errors.parent_firstName}>
        <Input
          value={parent.firstName}
          onChange={(e) => setParent({ ...parent, firstName: e.target.value })}
          placeholder="Karim"
        />
      </FormField>
      <FormField label="Nom" required error={errors.parent_lastName}>
        <Input
          value={parent.lastName}
          onChange={(e) => setParent({ ...parent, lastName: e.target.value })}
          placeholder="Benali"
        />
      </FormField>
      <FormField label="Genre">
        <Select value={parent.gender} onValueChange={(v) => setParent({ ...parent, gender: v as Gender })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Homme</SelectItem>
            <SelectItem value="female">Femme</SelectItem>
            <SelectItem value="unspecified">Non spécifié</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Téléphone" required error={errors.parent_phone} hint="+213 555 12 34 56">
        <Input
          value={parent.phone}
          onChange={(e) => setParent({ ...parent, phone: e.target.value })}
          placeholder="+213 555 12 34 56"
        />
      </FormField>
      <FormField label="WhatsApp" error={errors.parent_whatsapp}>
        <Input
          value={parent.whatsapp}
          onChange={(e) => setParent({ ...parent, whatsapp: e.target.value })}
          placeholder="+213 555 12 34 56"
        />
      </FormField>
      <FormField label="E-mail" error={errors.parent_email}>
        <Input
          type="email"
          value={parent.email}
          onChange={(e) => setParent({ ...parent, email: e.target.value })}
          placeholder="k.benali@example.dz"
        />
      </FormField>
      <FormField label="Profession">
        <Input
          value={parent.occupation}
          onChange={(e) => setParent({ ...parent, occupation: e.target.value })}
          placeholder="Ingénieur"
        />
      </FormField>
      <FormField label="Zone de résidence" hint="Détermine le tarif transport">
        <Select
          value={parent.cityTier}
          onValueChange={(v) => setParent({ ...parent, cityTier: v as CityTier })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Sélectionner…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="t1">Zone urbaine (T1)</SelectItem>
            <SelectItem value="t2">Zone périurbaine (T2)</SelectItem>
            <SelectItem value="t3">Zone rurale (T3)</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Adresse" className="md:col-span-2">
        <Input
          value={parent.address}
          onChange={(e) => setParent({ ...parent, address: e.target.value })}
          placeholder="12 rue des Frères Bouadou, Oran"
        />
      </FormField>
      <FormField label="Langue préférée">
        <Select
          value={parent.preferredLanguage}
          onValueChange={(v) => setParent({ ...parent, preferredLanguage: v as "fr" | "ar" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="ar">العربية</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
    </div>
  );
}

// ============================================================
// Step 2 — Students (1 → N, unlimited)
// ============================================================
function Step2({
  students,
  setStudents,
  errors,
  parentCityTier,
}: {
  students: Step2Student[];
  setStudents: (s: Step2Student[]) => void;
  errors: Record<string, string>;
  parentCityTier: CityTier | "";
}) {
  function update(i: number, patch: Partial<Step2Student>) {
    const next = students.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setStudents(next);
  }
  function add() {
    setStudents([
      ...students,
      { ...EMPTY_STUDENT, transportTier: parentCityTier || "" },
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
                value={s.transportTier}
                onValueChange={(v) => update(i, { transportTier: v as CityTier })}
              >
                <SelectTrigger><SelectValue placeholder="Sans transport" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sans transport</SelectItem>
                  <SelectItem value="t1">Zone urbaine (T1)</SelectItem>
                  <SelectItem value="t2">Zone périurbaine (T2)</SelectItem>
                  <SelectItem value="t3">Zone rurale (T3)</SelectItem>
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

// ============================================================
// Step 3 — Billing config (reads from PricingConfig)
// ============================================================
function Step3({
  billing,
  includeRegistration,
  setIncludeRegistration,
  includeTransport,
  setIncludeTransport,
}: {
  billing: ReturnType<typeof computeBilling>;
  includeRegistration: boolean;
  setIncludeRegistration: (b: boolean) => void;
  includeTransport: boolean;
  setIncludeTransport: (b: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border border-border p-3 cursor-pointer hover:bg-accent/5">
          <input
            type="checkbox"
            checked={includeRegistration}
            onChange={(e) => setIncludeRegistration(e.target.checked)}
            className="h-4 w-4"
          />
          <div>
            <p className="text-sm font-medium">Frais d'inscription</p>
            <p className="text-xs text-muted-foreground">Facturé une fois à l'inscription</p>
          </div>
          <span className="ml-auto font-mono text-sm">{formatDzd(billing.registrationFee)}</span>
        </label>
        <label className="flex items-center gap-2 rounded-md border border-border p-3 cursor-pointer hover:bg-accent/5">
          <input
            type="checkbox"
            checked={includeTransport}
            onChange={(e) => setIncludeTransport(e.target.checked)}
            className="h-4 w-4"
          />
          <div>
            <p className="text-sm font-medium">Transport scolaire</p>
            <p className="text-xs text-muted-foreground">Basé sur la zone de résidence</p>
          </div>
          <span className="ml-auto font-mono text-sm">{formatDzd(billing.totalTransport)}</span>
        </label>
      </div>

      <div className="rounded-md border border-border">
        <div className="border-b border-border px-3 py-2 bg-muted/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Détail par élève
          </p>
        </div>
        <ul className="divide-y divide-border">
          {billing.perStudent.map((s) => (
            <li key={s.index} className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{s.level}</span>
                </div>
                <span className="font-mono text-sm font-semibold">
                  {formatDzd(s.tuition + s.transport)}
                </span>
              </div>
              <div className="pl-3 text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>Scolarité (3 tranches)</span>
                  <span className="font-mono">{formatDzd(s.tuition)}</span>
                </div>
                <div className="pl-3 text-[10px]">
                  {s.tranches.map((t) => (
                    <div key={t.label} className="flex justify-between">
                      <span>{t.label}</span>
                      <span className="font-mono">{formatDzd(t.amountDue)}</span>
                    </div>
                  ))}
                </div>
                {s.transport > 0 && (
                  <div className="flex justify-between">
                    <span>Transport</span>
                    <span className="font-mono">{formatDzd(s.transport)}</span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-border px-3 py-2 bg-muted/30 flex justify-between">
          <span className="text-sm font-semibold">Total facturé</span>
          <span className="font-mono text-base font-bold text-primary">{formatDzd(billing.grandTotal)}</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Les tarifs proviennent de la configuration administrateur (Paramètres → Tarification).
        Modifier un tarif ici n'affecte pas la configuration.
      </p>
    </div>
  );
}

// ============================================================
// Step 4 — Review + atomic submit
// ============================================================
function Step4({
  parent,
  students,
  billing,
}: {
  parent: Step1Parent;
  students: Step2Student[];
  billing: ReturnType<typeof computeBilling>;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-status-success/40 bg-status-success/5 p-3">
        <p className="text-sm font-medium text-status-success">Transaction atomique</p>
        <p className="text-xs text-muted-foreground mt-1">
          Tout sera créé en une seule opération (BEGIN…COMMIT). Si une étape échoue, tout est annulé.
        </p>
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Parent</p>
        <p className="text-sm font-medium">
          {parent.firstName} {parent.lastName}
        </p>
        <p className="text-xs text-muted-foreground">{parent.phone}</p>
        {parent.email && <p className="text-xs text-muted-foreground">{parent.email}</p>}
        {parent.cityTier && (
          <Badge variant="outline">
            {parent.cityTier === "t1" ? "Zone urbaine" : parent.cityTier === "t2" ? "Zone périurbaine" : "Zone rurale"}
          </Badge>
        )}
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Élèves ({students.length})
        </p>
        <ul className="space-y-1.5">
          {students.map((s, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span>
                {s.firstName} {s.lastName}
              </span>
              <span className="text-xs text-muted-foreground">
                {LEVEL_LABELS_FR[s.level]} · Année {s.gradeYear}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Facturation</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Frais d'inscription</span>
            <span className="font-mono">{formatDzd(billing.registrationFee)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Scolarité ({students.length} élève(s))</span>
            <span className="font-mono">{formatDzd(billing.totalTuition)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Transport</span>
            <span className="font-mono">{formatDzd(billing.totalTransport)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-border">
            <span className="font-semibold">Total</span>
            <span className="font-mono font-bold text-primary">{formatDzd(billing.grandTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Hoisted helper for type inference in step 3 / 4 props
function computeBilling(_input: {
  students: Step2Student[];
  pricing: import("../../domain/model/pricing").PricingConfig;
  includeRegistration: boolean;
  includeTransport: boolean;
}) {
  // This function is only used for type inference; the actual computation is
  // in the useMemo inside the parent component.
  return null as unknown as {
    perStudent: Array<{ index: number; name: string; level: string; tuition: number; transport: number; tranches: ReadonlyArray<{ label: string; amountDue: number }> }>;
    registrationFee: number;
    totalTuition: number;
    totalTransport: number;
    grandTotal: number;
  };
}
