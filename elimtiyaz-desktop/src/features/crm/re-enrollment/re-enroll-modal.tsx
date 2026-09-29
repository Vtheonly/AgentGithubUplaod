/**
 * T-437 (issue #18 §5 / ADR-031): the PRE-FILLED re-enrollment form.
 *
 * The « Réinscrire » action does NOT open the new-student registration form
 * from scratch: the student identity, the parent, the previous academic
 * year, the previous class/level, the pass/fail status and the previous
 * academic results arrive PRE-FILLED (read-only) from the finalized
 * candidate snapshot — ONLY the new-year information needs review/update
 * (the confirmed level, the class, the payment plan, the transport, the
 * remise, the FI/transport toggles).
 *
 * The devis preview REUSES `computeBilling` (the wizard's exact engine);
 * the submitted billing legs are built by the ONE shared
 * `buildRegistrationBillingWires` (year-scoped source ids) and persisted by
 * `fn_re_enroll_student` in ONE transaction stamped with the TARGET
 * academic year (INV-25).
 */
import { useEffect, useMemo, useState } from "react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Wizard, type WizardStep } from "../../../shared/ui/wizard";
import { Badge } from "../../../shared/ui/badge";
import { FormField } from "../../../shared/ui/form-field";
import { Input } from "../../../shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { GRADE_LEVELS, GRADE_LEVEL_LABELS_FR, gradeLevelFromLevelYear } from "../../../domain/model/student";
import {
  TRANSPORT_DESTINATIONS,
  TRANSPORT_DESTINATION_LABELS_FR,
  type TransportDestination,
} from "../../../domain/model/parent";
import type { PaymentPlan } from "../../../domain/model/payment";
import { PROMOTION_DECISION_LABELS_FR } from "../../../domain/model/academic";
import { computeBilling } from "../batch-registration/compute-billing";
import { buildRegistrationBillingWires } from "../../../infrastructure/supabase/repositories/registration-billing-wires";
import { requireTenantId } from "../../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { ReEnrollmentCandidate } from "../../../domain/model/re-enrollment";
import { formatDzdPlain } from "../../../core/format/currency";

const NO_CLASS = "__none__";
const NO_TRANSPORT = "__none__";

export function ReEnrollModal({
  open,
  onOpenChange,
  candidate,
  onReEnrolled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidate: ReEnrollmentCandidate | null;
  onReEnrolled?: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const pricing = useObservable(() => repos.pricing.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);

  const [gradeLevelCode, setGradeLevelCode] = useState<string>("1ap");
  const [classId, setClassId] = useState<string>("");
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan>("tranches");
  const [transportDestination, setTransportDestination] = useState<TransportDestination | "">("");
  const [remise, setRemise] = useState("0");
  const [includeRegistration, setIncludeRegistration] = useState(true);
  const [includeTransport, setIncludeTransport] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // The PRE-FILL (issue #18 §5): everything already known arrives from the
  // candidate snapshot; only the new-year information starts editable.
  useEffect(() => {
    if (open && candidate) {
      setGradeLevelCode(candidate.expectedGradeLevelCode ?? candidate.studentGradeLevel ?? "1ap");
      setClassId("");
      setPaymentPlan("tranches");
      setTransportDestination("");
      setRemise("0");
      setIncludeRegistration(true);
      setIncludeTransport(true);
      setNotes("");
      setSubmitting(false);
    }
  }, [open, candidate]);

  // The devis preview — the wizard's EXACT engine over a single student.
  const billing = useMemo(() => {
    if (!candidate) return null;
    return computeBilling({
      students: [
        {
          firstName: candidate.studentFirstName,
          middleName: "",
          lastName: candidate.studentLastName,
          gender: "unspecified",
          birthDate: "",
          // T-439 (UI-320): the devis prices by the CONFIRMED grade — the
          // old hardcoded primaire/1 pair quoted 1AP rates for every
          // re-enrollment (a lycée student shown primaire prices) while
          // the persisted wires billed the confirmed grade (the §15.69
          // shown-vs-persisted violation).
          gradeLevel: gradeLevelCode as import("../../../domain/model/student").GradeLevel,
          level: "primaire",
          gradeYear: 1,
          filiereCode: "",
          specialiteCode: "",
          classId: "",
          transportDestination: transportDestination || "",
          medicalNotes: "",
          paymentPlan,
          remise,
          chargeStickerPrice: false,
          originType: "",
          previousSchoolName: "",
          previousSchoolLevel: "",
          previousAcademicYear: "",
          originNotes: "",
        },
      ],
      pricing,
      includeRegistration,
      includeTransport: includeTransport && !!transportDestination,
      academicYearStartYear: targetStartYear(candidate.targetAcademicYear),
    });
    // T-439 (UI-320): gradeLevelCode is a devis INPUT now — the quote must
    // recompute when the operator changes the confirmed grade.
  }, [candidate, pricing, paymentPlan, transportDestination, remise, includeRegistration, includeTransport, gradeLevelCode]);

  const levelClasses = useMemo(
    () => classes.filter((c) => c.gradeYear != null && matchesGradeLevel(c.level, c.gradeYear, gradeLevelCode)),
    [classes, gradeLevelCode],
  );

  async function submit(): Promise<void> {
    if (!candidate) return;
    setSubmitting(true);
    try {
      const year = targetStartYear(candidate.targetAcademicYear);
      const at = new Date().toISOString();
      // INV-25a: the ONE shared builder — year-scoped source ids so the
      // target-year rows can never collide with any prior-year row.
      const { ledgerWire, installmentWire } = buildRegistrationBillingWires({
        tenantId: requireTenantId(),
        parentCode: candidate.parentCode,
        students: [
          {
            studentCode: candidate.studentCode,
            studentRef: 0,
            gradeLevel: gradeLevelCode as (typeof GRADE_LEVELS)[number],
            paymentPlan,
            transportTier: transportDestination || null,
            remise: Math.max(0, Number(remise) || 0),
            chargeStickerPrice: false,
          },
        ],
        pricingConfig: pricing,
        includeRegistration,
        includeTransport: includeTransport && !!transportDestination,
        year,
        at,
        parentTransportDestination: null,
        sourceIdScope: {
          prefix: `re-${candidate.targetAcademicYear}`,
          yearCode: candidate.targetAcademicYear,
        },
        feeDescription: `Frais d'inscription ${candidate.targetAcademicYear} (réinscription)`,
      });

      const res = await repos.reEnrollment.reEnroll({
        reEnrollmentId: candidate.reEnrollmentId,
        gradeLevelCode: gradeLevelCode as (typeof GRADE_LEVELS)[number],
        classId: classId || null,
        paymentPlan,
        transportTier: transportDestination || null,
        installments: installmentWire as unknown as Record<string, unknown>[],
        ledgerEntries: ledgerWire as unknown as Record<string, unknown>[],
        notes: notes.trim() || null,
      });
      if (!res.ok) throw new Error(res.error.userMessage);
      toast.showSuccess(
        "Réinscription enregistrée",
        `${candidate.studentFirstName} ${candidate.studentLastName} est réinscrit pour ${candidate.targetAcademicYear} — ${res.value.installmentsWritten} tranche(s) écrite(s) pour cette année.`,
      );
      onReEnrolled?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (!candidate) return null;
  const per = billing?.perStudent[0];

  const steps: readonly WizardStep[] = [
    {
      id: "context",
      label: "Élève & année",
      description: "Les informations connues sont pré-remplies",
      render: () => (
        <div className="space-y-3">
          {/* The read-only PRE-FILLED context (issue #18 §5). */}
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Informations pré-remplies — historique {candidate.sourceAcademicYear}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Élève</p>
                <p className="font-medium">{candidate.studentFirstName} {candidate.studentLastName}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{candidate.studentCode}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Parent</p>
                <p className="font-medium">{candidate.parentDisplayName}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{candidate.parentCode}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Classe précédente</p>
                <p>{candidate.sourceClassName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Niveau précédent</p>
                <p>{candidate.sourceGradeLevelCode ? (GRADE_LEVEL_LABELS_FR[candidate.sourceGradeLevelCode as keyof typeof GRADE_LEVEL_LABELS_FR] ?? candidate.sourceGradeLevelCode) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Résultat final</p>
                {candidate.finalDecision ? (
                  <Badge
                    variant={candidate.finalDecision === "promoted" ? "success" : candidate.finalDecision === "repeated" ? "warning" : "outline"}
                  >
                    {PROMOTION_DECISION_LABELS_FR[candidate.finalDecision]}
                    {candidate.finalAverage != null ? ` — ${candidate.finalAverage.toFixed(2)}/20` : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600">Résultat non finalisé</Badge>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Année cible</p>
                <p className="font-medium">{candidate.targetAcademicYear}</p>
              </div>
            </div>
            {candidate.finalDecision == null && (
              <p className="text-[11px] text-amber-600">
                Le cycle de promotion de {candidate.sourceAcademicYear} n'a pas encore finalisé
                cet élève — le niveau proposé ci-dessous est une dérivation, ajustable.
              </p>
            )}
          </div>

          {/* ONLY the new-year information is editable. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Niveau confirmé pour l'année cible" required>
              <Select value={gradeLevelCode} onValueChange={(v) => { setGradeLevelCode(v); setClassId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GRADE_LEVELS.map((g) => (
                    <SelectItem key={g} value={g}>{GRADE_LEVEL_LABELS_FR[g]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Classe (optionnel)" hint="Filtrée par niveau">
              <Select value={classId || NO_CLASS} onValueChange={(v) => setClassId(v === NO_CLASS ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLASS}>Non assignée</SelectItem>
                  {levelClasses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Plan de paiement">
              <Select value={paymentPlan} onValueChange={(v) => setPaymentPlan(v as PaymentPlan)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tranches">3 tranches (15 sept. / 15 déc. / 15 mars)</SelectItem>
                  <SelectItem value="full_annual">Année complète (−5% avant le 30 juin)</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Commune (transport)" hint="Laisser vide si pas de transport">
              <Select
                value={transportDestination || NO_TRANSPORT}
                onValueChange={(v) => setTransportDestination(v === NO_TRANSPORT ? "" : (v as TransportDestination))}
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
          </div>
        </div>
      ),
      validate: () => (GRADE_LEVELS.includes(gradeLevelCode as (typeof GRADE_LEVELS)[number]) ? null : "Sélectionnez un niveau valide."),
    },
    {
      id: "billing",
      label: "Facturation",
      description: `Devis ${candidate.targetAcademicYear} — tranches rattachées à l'année cible`,
      render: () => (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Frais d'inscription (FI)">
              <Select value={includeRegistration ? "yes" : "no"} onValueChange={(v) => setIncludeRegistration(v === "yes")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Inclure le FI</SelectItem>
                  <SelectItem value="no">Sans FI</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Tranches de transport">
              <Select
                value={includeTransport ? "yes" : "no"}
                onValueChange={(v) => setIncludeTransport(v === "yes")}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Inclure le transport</SelectItem>
                  <SelectItem value="no">Sans transport</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Remise négociée (DZD)" hint="Déduite de la tranche V2">
              <Input
                value={remise}
                onChange={(e) => setRemise(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="ex. 5000"
              />
            </FormField>
            <FormField label="Note interne" hint="Optionnel — visible dans le registre">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="…" />
            </FormField>
          </div>

          {per && (
            <div className="rounded-md border border-border p-3 text-sm space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Devis {candidate.targetAcademicYear} — {candidate.studentFirstName} {candidate.studentLastName}
              </p>
              <div className="flex justify-between"><span className="text-muted-foreground">Scolarité annuelle</span><span>{formatDzdPlain(per.tuition)}</span></div>
              {per.remise > 0 && (
                <div className="flex justify-between text-status-success"><span>Remise</span><span>−{formatDzdPlain(per.remise)}</span></div>
              )}
              {per.netTuition !== per.tuition && (
                <div className="flex justify-between"><span className="text-muted-foreground">Scolarité nette</span><span>{formatDzdPlain(per.netTuition)}</span></div>
              )}
              {includeRegistration && per.registrationFee > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Frais d'inscription</span><span>{formatDzdPlain(per.registrationFee)}</span></div>
              )}
              {includeTransport && per.transport > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Transport ({per.transportDestinationLabel})</span><span>{formatDzdPlain(per.transport)}</span></div>
              )}
              <div className="flex justify-between font-medium border-t border-border pt-1.5">
                <span>Total {candidate.targetAcademicYear}</span>
                <span>{formatDzdPlain(billing?.grandTotal ?? 0)}</span>
              </div>
              <div className="pt-1 space-y-0.5">
                {per.tranches.map((t, i) => (
                  <div key={i} className="flex justify-between text-xs text-muted-foreground">
                    <span>{t.label}</span>
                    <span>{formatDzdPlain(t.amountDue)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                Les dettes de {candidate.sourceAcademicYear} restent attachées à leur année
                d'origine — ce devis ne couvre que {candidate.targetAcademicYear}.
              </p>
            </div>
          )}
        </div>
      ),
      isFinal: true,
    },
  ];

  return (
    <Wizard
      open={open}
      onOpenChange={(o) => !submitting && onOpenChange(o)}
      title={`Réinscrire ${candidate.studentFirstName} ${candidate.studentLastName} — ${candidate.targetAcademicYear}`}
      steps={steps}
      onFinish={submit}
      widthClass="max-w-2xl"
    />
  );
}

/** "2027-2028" → 2027 (the calendar year the academic year starts). */
function targetStartYear(code: string): number {
  const m = /^(\d{4})/.exec(code.trim());
  return m ? Number(m[1]) : new Date().getFullYear();
}

/** Whether an AcademicClass matches the confirmed grade level. */
function matchesGradeLevel(level: string, gradeYear: number, gradeCode: string): boolean {
  try {
    return gradeLevelFromLevelYear(level as "primaire" | "cem" | "lycee", gradeYear) === gradeCode;
  } catch {
    return false;
  }
}
