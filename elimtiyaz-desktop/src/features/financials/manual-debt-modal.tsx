// ============================================================================
// FILE: elimtiyaz-desktop/src/features/financials/manual-debt-modal.tsx
// ============================================================================
/**
 * ManualDebtModal — T-466 (DEBT-102): the explicit creation of a
 * PRE-EXISTING debt, the owner's mandate ("a student or parent may owe the
 * school 500 DZD for a specific service, purchase, school-related charge,
 * or unpaid fee. We should be able to create that debt manually and specify
 * exactly what it represents. It should not simply be an unexplained 500
 * DZD value attached to a person.").
 *
 * ONE canonical record (§6/§15.53a — never a parallel implementation): the
 * modal is a thin FORM over `InstallmentRepository.createManualDebt` — the
 * write path whose row IS the canonical debt record (an installments row +
 * its matching ledger charge entry, migration 0137). The created obligation
 * flows into EVERY debt surface by construction — the Créances summary, the
 * « Suivi des Dettes » aging statuses, Year Tracking (the per-year service
 * group), the Dashboard statistics, the CRM échéancier — and settles through
 * the canonical payment waterfall exactly like a tranche. This component
 * computes NOTHING and derives NOTHING: it collects the owner's mandate
 * fields (family, student, amount, reason, associated service, date,
 * academic year, note, reference) and hands them to the repository.
 *
 * Mounted (the reuse-first rule — ONE component, several surfaces):
 *   - the Year-Tracking surface (`ParentYearHistorySection` — reachable from
 *     BOTH the CRM parent drawer's Finances tab AND the Debt-Aging drawer's
 *     « Par année » tab — the exact place the owner reported the gap);
 *   - the Finance « Créances » tab (`DebtTab`).
 */
import { useMemo, useState } from "react";
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  type PaymentCategory,
} from "../../domain/model/payment";
import { formatDzd } from "../../core/format/currency";

/**
 * The categories a manual DEBT can attach to — every billable service
 * except `parent_credit` (a credit is the OPPOSITE operation: the existing
 * canonical account-adjustment path (`adjust()` with a negative amount)
 * creates credits; this modal creates obligations only).
 */
const MANUAL_DEBT_CATEGORIES: readonly PaymentCategory[] = [
  "tuition",
  "transport",
  "canteen",
  "uniform",
  "books",
  "extracurricular",
  "therapy_psychology",
  "therapy_speech",
  "second_apron",
  "other",
];

const ManualDebtSchema = z.object({
  studentId: z.string().min(1, "L'élève concerné est requis (la dette est ancrée sur un élève de la famille)."),
  category: z.enum(["tuition", "transport", "canteen", "uniform", "books", "extracurricular", "therapy_psychology", "therapy_speech", "second_apron", "other"] as const satisfies readonly PaymentCategory[]),
  label: z.string().min(3, "Le motif est requis (min. 3 caractères) — ex. « Achat uniforme », « Frais de cantine impayés »."),
  amountDue: z
    .number({ invalid_type_error: "Le montant est requis." })
    .positive("Le montant doit être strictement positif (DZD)."),
  dueDate: z.string().min(1, "La date de la dette est requise."),
  academicYear: z.string().default(""),
  note: z.string().default(""),
  reference: z.string().default(""),
});

type ManualDebtFormData = z.infer<typeof ManualDebtSchema>;

export interface ManualDebtModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The debtor family (the parent_id every debt surface groups by). When
   * ABSENT (the Créances tab's global entry point), the form starts with a
   * family picker — families with NO existing debt must be reachable too. */
  parentId?: string | null;
  /** The family's display name (header context). */
  parentName?: string;
  /** Pre-selected student (e.g. the drawer's student), if any. */
  defaultStudentId?: string | null;
  /** Pre-selected academic-year code, if any. */
  defaultAcademicYear?: string | null;
}

export function ManualDebtModal({
  open,
  onOpenChange,
  parentId,
  parentName,
  defaultStudentId,
  defaultAcademicYear,
}: ManualDebtModalProps) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const students = useObservable(() => repos.students.observe(), []);
  const academicYears = useObservable(() => repos.academicYears.observeAll(), []);
  const parents = useObservable(() => repos.parents.observe(), []);

  // The UNLOCKED flow's step 0 — the picked family (the AutoFormModal's
  // static field descriptors cannot express a DEPENDENT select; a plain
  // picker step keeps the dependency logic explicit and testable).
  const [pickedParentId, setPickedParentId] = useState<string | null>(null);

  // The family context — fixed when parentId is given (the drawer mounts),
  // chosen in-form otherwise (the Créances tab's global entry point).
  const familyLocked = typeof parentId === "string" && parentId.length > 0;
  const effectiveParentId = familyLocked ? parentId : pickedParentId;

  // The family's students — the installments table's student_id is NOT NULL,
  // so the debt is anchored to one of them (the FAMILY stays the debtor:
  // parent_id is what every debt surface groups by).
  const familyStudents = useMemo(
    () => (effectiveParentId ? students.filter((s) => s.parentId === effectiveParentId) : []),
    [students, effectiveParentId],
  );

  const studentOptions = useMemo(
    () =>
      familyStudents.map((s) => ({
        label: `${s.displayName || `${s.firstName} ${s.lastName}`} · ${s.code}`,
        value: s.id,
      })),
    [familyStudents],
  );

  const yearOptions = useMemo(
    () => [
      // "" = the INV-14 window resolver stamps the year from the date (the
      // documented fallback — an explicit honest option, never a guess).
      { label: "— Déduire de la date (règle INV-14) —", value: "" },
      ...academicYears.map((y) => ({
        label: `${y.code}${y.isCurrent ? " (en cours)" : ""}`,
        value: y.code,
      })),
    ],
    [academicYears],
  );

  const fields: readonly AutoFormField[] = useMemo(
    () => [
      {
        name: "studentId",
        label: "Élève concerné",
        type: "select",
        required: true,
        options: studentOptions,
        wide: true,
        help: "La dette appartient à la famille ; l'élève ancre l'écriture (obligation du registre canonique).",
      },
      {
        name: "category",
        label: "Service / frais associé",
        type: "select",
        required: true,
        options: MANUAL_DEBT_CATEGORIES.map((c) => ({
          label: PAYMENT_CATEGORY_LABELS_FR[c],
          value: c,
        })),
      },
      {
        name: "amountDue",
        label: "Montant dû (DZD)",
        type: "money",
        required: true,
        min: 1,
        placeholder: "Ex. 500",
      },
      {
        name: "label",
        label: "Motif (ce que représente la dette)",
        type: "text",
        required: true,
        wide: true,
        placeholder: "Ex. Achat uniforme · Frais de cantine impayés · Dégradation matériel",
        help: "Ce texte devient le libellé de l'écriture — visible sur l'échéancier, le suivi par année et la lignée d'inspection.",
      },
      { name: "dueDate", label: "Date de la dette", type: "date", required: true },
      {
        name: "academicYear",
        label: "Année scolaire",
        type: "select",
        options: yearOptions,
        wide: true,
        help: "Vide = l'année est déduite de la date (la même précédence INV-14 que l'import).",
      },
      {
        name: "reference",
        label: "Référence / source (optionnel)",
        type: "text",
        wide: true,
        placeholder: "Ex. BL-2026-114 · reçu caisse · bon de commande",
      },
      {
        name: "note",
        label: "Note détaillée (optionnel)",
        type: "textarea",
        wide: true,
        placeholder: "Contexte, circonstances, accord de remboursement…",
      },
    ],
    [studentOptions, yearOptions],
  );

  async function handleSubmit(data: ManualDebtFormData) {
    // §15.15 (never fabricate): when the repository implementation does not
    // carry the canonical write path, surface the unavailability honestly.
    if (typeof repos.installments.createManualDebt !== "function") {
      throw new Error(
        "La création manuelle de dette n'est pas disponible sur ce dépôt de données (chemin canonique absent).",
      );
    }
    if (effectiveParentId === null) {
      throw new Error("La famille débitrice est requise.");
    }
    const res = await repos.installments.createManualDebt({
      parentId: effectiveParentId,
      studentId: data.studentId,
      category: data.category,
      label: data.label.trim(),
      amountDue: data.amountDue,
      dueDate: data.dueDate,
      academicYear: data.academicYear || null,
      note: data.note?.trim() || null,
      reference: data.reference?.trim() || null,
      actorId: session?.userId,
      actorName: session?.displayName ?? session?.userId,
    });
    if (!res.ok) {
      throw new Error(res.error.userMessage);
    }
    toast.showSuccess(
      "Dette enregistrée",
      `${formatDzd(data.amountDue)} — « ${data.label.trim()} » rattachée à ${effectiveParentName ?? "la famille"}. L'obligation est visible dans le Suivi des Dettes, le suivi par année, les statistiques et l'échéancier.`,
    );
    // The unlocked (family-picker) flow restarts cleanly for the next use.
    if (!familyLocked) setPickedParentId(null);
  }

  const parentOptions = useMemo(
    () =>
      [...parents]
        .sort((a, b) =>
          (a.displayName ?? `${a.lastName} ${a.firstName}`)
            .localeCompare(b.displayName ?? `${b.lastName} ${b.firstName}`, "fr"),
        )
        .map((p) => ({
          label: `${p.displayName || `${p.firstName} ${p.lastName}`} · ${p.code}`,
          value: p.id,
        })),
    [parents],
  );

  if (open && !familyLocked && pickedParentId === null) {
    return (
      <UnifiedModal
        open={open}
        onOpenChange={(o) => {
          if (!o) onOpenChange(false);
        }}
        title="Nouvelle dette manuelle — choisir la famille"
        description="La créance sera rattachée à la famille choisie (le débiteur), ancrée sur un de ses élèves, avec son motif exact."
        hideFooter
      >
        <div className="space-y-3" data-testid="manual-debt-family-picker">
          <FormField label="Famille débitrice" required htmlFor="manual-debt-parent">
            <Select value="" onValueChange={(v) => setPickedParentId(v)}>
              <SelectTrigger id="manual-debt-parent">
                <SelectValue placeholder="Sélectionner la famille…" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {parentOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <p className="text-[11px] text-muted-foreground">
            Une famille sans dette existante reste sélectionnable — le cas exact d'une créance
            préexistante jamais enregistrée.
          </p>
        </div>
      </UnifiedModal>
    );
  }

  // The unlocked flow's family name (the picker's choice) — the toast and
  // the header stay honest in both mounts.
  const pickedParent = pickedParentId ? parents.find((p) => p.id === pickedParentId) : undefined;
  const effectiveParentName =
    parentName ??
    pickedParent?.displayName?.trim() ??
    (pickedParent ? `${pickedParent.firstName} ${pickedParent.lastName}`.trim() : undefined);

  return (
    <AutoFormModal
      open={open}
      onOpenChange={(o) => {
        // The unlocked flow resets its picked family on close — the next
        // open starts at the picker (never a stale family context).
        if (!o && !familyLocked) setPickedParentId(null);
        onOpenChange(o);
      }}
      title="Nouvelle dette manuelle"
      description={
        effectiveParentName
          ? `Enregistrer une créance préexistante pour la famille ${effectiveParentName} — avec son motif exact, son service associé et sa référence.`
          : "Enregistrer une créance préexistante — avec son motif exact, son service associé et sa référence."
      }
      schema={ManualDebtSchema}
      fields={fields}
      initialValues={{
        studentId: defaultStudentId ?? familyStudents[0]?.id ?? "",
        academicYear: defaultAcademicYear ?? "",
      }}
      onSubmit={handleSubmit}
      submitLabel="Enregistrer la dette"
    />
  );
}
