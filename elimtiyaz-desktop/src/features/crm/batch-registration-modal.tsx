/**
 * BatchRegistrationModal — 4-step atomic registration wizard.
 *
 * Plan §04.03: "4-step atomic flow: Parent → N children → billing config → BEGIN…COMMIT"
 *
 * Phase 4B refactor: now built on the shared `<Wizard>` primitive
 * (`src/shared/ui/wizard/`). The custom stepper JSX, step-state index,
 * and custom next/back buttons have been removed — the wizard primitive
 * handles all of that. Each step's `render` delegates to the existing
 * sub-step components in `./batch-registration/`, and each step's
 * `validate` runs the corresponding validator + surfaces errors via
 * the wizard's built-in error slot.
 *
 * Steps:
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
  User,
  Users,
  Wallet,
  ClipboardCheck,
  UserPlus,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Wizard, type WizardStep } from "../../shared/ui/wizard";
import type { CreateStudentInput } from "../../domain/model/student";
import type { CreateParentInput, TransportDestination } from "../../domain/model/parent";

import { Step1 } from "./batch-registration/step1-parent";
import { Step2 } from "./batch-registration/step2-students";
import { Step3 } from "./batch-registration/step3-billing";
import { Step4 } from "./batch-registration/step4-review";
import { computeBilling } from "./batch-registration/compute-billing";
import type { Billing } from "./batch-registration/types";
import {
  EMPTY_PARENT,
  EMPTY_STUDENT,
  PHONE_RE,
  EMAIL_RE,
  type Step1Parent,
  type Step2Student,
} from "./batch-registration/types";

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

  const [parent, setParent] = useState<Step1Parent>(EMPTY_PARENT);
  const [students, setStudents] = useState<Step2Student[]>([{ ...EMPTY_STUDENT }]);
  const [includeRegistration, setIncludeRegistration] = useState(true);
  const [includeTransport, setIncludeTransport] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setParent(EMPTY_PARENT);
        setStudents([{ ...EMPTY_STUDENT }]);
        setIncludeRegistration(true);
        setIncludeTransport(true);
        setErrors({});
      }, 200);
    }
  }, [open]);

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

  // === Step validation (returns a human-readable error string or null) ===
  function validateStep1(): string | null {
    const e: Record<string, string> = {};
    if (!parent.firstName.trim()) e.parent_firstName = "Prénom requis";
    if (!parent.lastName.trim()) e.parent_lastName = "Prénom requis";
    if (!parent.phone.trim()) e.parent_phone = "Téléphone requis";
    else if (!PHONE_RE.test(parent.phone)) e.parent_phone = "Format invalide (8-15 chiffres)";
    if (parent.email && !EMAIL_RE.test(parent.email)) e.parent_email = "E-mail invalide";
    if (parent.whatsapp && !PHONE_RE.test(parent.whatsapp)) e.parent_whatsapp = "Format invalide";
    setErrors(e);
    return Object.keys(e).length === 0
      ? null
      : "Vérifiez les champs requis du parent (nom + téléphone valide).";
  }

  function validateStep2(): string | null {
    const e: Record<string, string> = {};
    students.forEach((s, i) => {
      if (!s.firstName.trim()) e[`stu_${i}_firstName`] = "Prénom requis";
      if (!s.lastName.trim()) e[`stu_${i}_lastName`] = "Nom requis";
      if (!s.birthDate) e[`stu_${i}_birthDate`] = "Date de naissance requise";
    });
    setErrors(e);
    return Object.keys(e).length === 0
      ? null
      : "Vérifiez les champs requis de chaque élève (nom + date de naissance).";
  }

  // === Atomic submit (called by Wizard onFinish on the last step) ===
  async function submit(): Promise<void> {
    if (!session) {
      throw new Error("Session expirée — reconnectez-vous puis réessayez.");
    }
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
      return;
    }
    throw new Error(result.error.userMessage);
  }

  // === Wizard step definitions ===
  const steps: readonly WizardStep[] = [
    {
      id: "parent",
      label: "Parent",
      description: "Identité et coordonnées du parent",
      render: () => <Step1 parent={parent} setParent={setParent} errors={errors} />,
      validate: validateStep1,
    },
    {
      id: "students",
      label: "Élèves",
      description: "Ajoutez un nombre illimité d'enfants",
      render: () => (
        <Step2
          students={students}
          setStudents={setStudents}
          errors={errors}
          parentTransportDestination={parent.transportDestination}
        />
      ),
      validate: validateStep2,
    },
    {
      id: "billing",
      label: "Facturation",
      description: "Configuration des frais (scolarité + transport + inscription)",
      render: () => (
        <Step3
          billing={billing}
          includeRegistration={includeRegistration}
          setIncludeRegistration={setIncludeRegistration}
          includeTransport={includeTransport}
          setIncludeTransport={setIncludeTransport}
        />
      ),
    },
    {
      id: "review",
      label: "Validation",
      description: "Vérification atomique avant soumission",
      render: () => <Step4 parent={parent} students={students} billing={billing} />,
      isFinal: true,
    },
  ];

  return (
    <Wizard
      open={open}
      onOpenChange={onOpenChange}
      title="Inscription groupée (Parent + Élèves)"
      steps={steps}
      onFinish={submit}
      widthClass="max-w-3xl"
    />
  );
}

// Re-export the step icons so callers (e.g. tests or future parent/pre-fill
// flows) can reuse the canonical icon mapping without re-importing from lucide.
export const STEP_ICONS = {
  parent: User,
  students: Users,
  billing: Wallet,
  review: ClipboardCheck,
  header: UserPlus,
} as const;
