/**
 * BatchRegistrationModal — 4-step atomic registration wizard.
 *
 * Plan §04.03: "4-step atomic flow: Parent → N children → billing config → BEGIN…COMMIT"
 *
 * Steps (each in ./batch-registration/):
 *   1. Parent info — step1-parent.tsx
 *   2. N children (unlimited — "Add Another Child" button, no upper bound per §04.02) — step2-students.tsx
 *   3. Billing config (reads from PricingConfig — tuition per level + transport tier + registration fee) — step3-billing.tsx
 *   4. Review + atomic submit — step4-review.tsx
 *
 * On submit, calls StudentRepository.batchRegister(input) which is the
 * atomic operation. If any step fails, the whole transaction rolls back.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Users,
  User,
  Wallet,
  ClipboardCheck,
  UserPlus,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import {
  LEVEL_LABELS_FR,
  gradeLevelFromLevelYear,
  type CreateStudentInput,
} from "../../domain/model/student";
import type { CreateParentInput, TransportDestination } from "../../domain/model/parent";
import {
  TRANSPORT_DESTINATION_LABELS_FR,
} from "../../domain/model/parent";
import {
  tuitionForLevel,
  tuitionTranchesForGrade,
  transportForDestination,
  transportTranchesForDestination,
} from "../../domain/model/pricing";

import { Step1 } from "./batch-registration/step1-parent";
import { Step2 } from "./batch-registration/step2-students";
import { Step3 } from "./batch-registration/step3-billing";
import { Step4 } from "./batch-registration/step4-review";
import { computeBilling } from "./batch-registration/compute-billing";
import type { Billing } from "./batch-registration/types";
import { EMPTY_PARENT, EMPTY_STUDENT, PHONE_RE, EMAIL_RE, type Step1Parent, type Step2Student } from "./batch-registration/types";

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
  // Now delegates to the pure `computeBilling` helper which evaluates all 5
  // official `Prices.md` discounts ONCE on the gross annual tuition, then
  // splits the net across tranches (or 1 entry for `full_annual`). This
  // eliminates the double-discounting bug documented in the architectural
  // blueprint (discounts were previously applied per-tranche inside
  // `buildTuitionChargeEntries`).
  const billing = useMemo<Billing>(() => {
    return computeBilling({
      students,
      pricing,
      includeRegistration,
      includeTransport,
    });
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
        transportDestination: (parent.transportDestination || null) as TransportDestination | null,
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
        // Student.transportTier is a bare string — we store the canonical destination key in it.
        transportTier: (s.transportDestination || null) as string | null,
        paymentPlan: s.paymentPlan,
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
            parentTransportDestination={parent.transportDestination}
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
