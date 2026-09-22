// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/operational-query-console.tsx
// ============================================================================

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Search,
  Bot,
  Filter,
  CheckCircle2,
  ArrowUpDown,
  UserRound,
  GraduationCap,
  CalendarDays,
  Wallet,
  CreditCard,
  AlertTriangle,
  Clock3,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { Button } from "../../../../shared/ui/button";
import { Input } from "../../../../shared/ui/input";
import { Badge } from "../../../../shared/ui/badge";
import { UnifiedModal } from "../../../../shared/ui/unified-modal";
import { formatDzdPlain } from "../../../../core/format/currency";
import { useAICopilot } from "../../../../app/providers/ai-copilot-provider";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import {
  OPERATIONAL_PRESETS,
  type StudentRiskProfile,
} from "./operational-query-engine";
import type {
  Assessment,
  AttendanceRecord,
  Subject,
} from "../../../../domain/model/academic";
import {
  ATTENDANCE_STATUS_LABELS_FR,
  SESSION_LABELS_FR,
} from "../../../../domain/model/academic";
import type {
  DebtSummary,
  Installment,
  Payment,
} from "../../../../domain/model/payment";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  paymentCategoryLabelFr,
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
} from "../../../../domain/model/payment";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import { isRemiseAdjustment } from "./executive-statistics";
import type { Student } from "../../../../domain/model/student";
import { GRADE_LEVEL_LABELS_FR } from "../../../../domain/model/student";
import type { Parent } from "../../../../domain/model/parent";

interface Props {
  profiles: StudentRiskProfile[];
  onOpenStudent?: (studentId: string) => void;
  onOpenParent?: (parentId: string) => void;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function paymentDescription(
  payment: Payment,
  installments: readonly Installment[],
): string {
  const installment = payment.installmentId
    ? installments.find((item) => item.id === payment.installmentId)
    : undefined;
  if (installment) return installment.label;
  return paymentCategoryLabelFr(payment.category);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-elevated/20 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <div className="py-4 text-center text-[11px] text-muted-foreground">{text}</div>;
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-border/70 bg-surface-panel shadow-sm">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription className="text-[10px]">{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

function AlertBox({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        active
          ? "border-status-warning/40 bg-status-warning/5"
          : "border-border/60"
      }`}
    >
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xs font-semibold text-foreground">{value}</div>
    </div>
  );
}

function Student360Modal({
  profile,
  onClose,
}: {
  profile: StudentRiskProfile | null;
  onClose: () => void;
}) {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const assessments = useObservable<readonly Assessment[]>(
    () => repos.grades.observeAll(),
    [],
  );
  const attendance = useObservable<readonly AttendanceRecord[]>(
    () => repos.attendance.observeAll("2020-01-01", "2035-12-31"),
    [],
  );
  const payments = useObservable<readonly Payment[]>(
    () => repos.payments.observe(),
    [],
  );
  const installments = useObservable<readonly Installment[]>(
    () => repos.installments.observe(),
    [],
  );
  const debts = useObservable<readonly DebtSummary[]>(
    () => repos.debt.observeSummary(),
    [],
  );
  // T-389 (INSPECT-500): the remise lives on the LEDGER (negative
  // adjustment entries — the T-103/DATA-008 rule), NOT on the Student
  // model (`student.remise` is a CreateStudentInput-only field; reading
  // it on the read side was always undefined — the always-"Aucune remise"
  // bug this fixes).
  const ledger = useObservable<readonly LedgerEntry[]>(
    () => repos.ledger.observe(),
    [],
  );

  const student = useMemo<Student | null>(
    () =>
      profile
        ? students.find((item) => item.id === profile.studentId) ?? null
        : null,
    [students, profile],
  );

  const parent = useMemo<Parent | null>(
    () =>
      student
        ? parents.find((item) => item.id === student.parentId) ?? null
        : null,
    [parents, student],
  );

  const studentPayments = useMemo(
    () =>
      profile
        ? payments
            .filter(
              (payment) =>
                payment.studentId === profile.studentId ||
                payment.parentId === profile.parentId,
            )
            .sort(
              (a, b) =>
                new Date(b.collectedAt).getTime() -
                new Date(a.collectedAt).getTime(),
            )
        : [],
    [payments, profile],
  );

  const studentInstallments = useMemo(
    () =>
      profile
        ? installments
            .filter(
              (item) =>
                item.studentId === profile.studentId ||
                item.parentId === profile.parentId,
            )
            .sort(
              (a, b) =>
                new Date(a.dueDate).getTime() -
                new Date(b.dueDate).getTime(),
            )
        : [],
    [installments, profile],
  );

  const studentAttendance = useMemo(
    () =>
      profile
        ? attendance
            .filter((item) => item.studentId === profile.studentId)
            .sort(
              (a, b) =>
                new Date(b.date).getTime() - new Date(a.date).getTime(),
            )
        : [],
    [attendance, profile],
  );

  const studentAssessments = useMemo(
    () =>
      profile
        ? assessments
            .filter((item) => item.studentId === profile.studentId)
            .sort((a, b) => {
              const termOrder = { T1: 1, T2: 2, T3: 3 };
              return (
                termOrder[b.term] - termOrder[a.term] ||
                b.academicYear.localeCompare(a.academicYear)
              );
            })
        : [],
    [assessments, profile],
  );

  const debt = useMemo(
    () =>
      profile
        ? debts.find((item) => item.parentId === profile.parentId) ?? null
        : null,
    [debts, profile],
  );

  const nextInstallment = useMemo(
    () =>
      studentInstallments.find(
        (item) =>
          item.status !== "paid" &&
          Math.max(0, item.amountDue - item.amountPaid - item.amountPending) > 0,
      ) ?? null,
    [studentInstallments],
  );

  const paidTotal = studentPayments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const paymentCount = studentPayments.length;
  const averagePayment = paymentCount > 0 ? paidTotal / paymentCount : 0;

  const paymentMethods = useMemo(() => {
    const counts = new Map<string, number>();
    for (const payment of studentPayments) {
      const label = PAYMENT_METHOD_LABELS_FR[payment.method];
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [studentPayments]);

  const services = useMemo(() => {
    const categories = new Set<string>();
    studentPayments.forEach((payment) =>
      categories.add(paymentCategoryLabelFr(payment.category)),
    );
    studentInstallments.forEach((item) =>
      categories.add(PAYMENT_CATEGORY_LABELS_FR[item.category]),
    );
    return [...categories];
  }, [studentPayments, studentInstallments]);

  const remainingOnInstallments = studentInstallments.reduce(
    (sum, item) =>
      sum + Math.max(0, item.amountDue - item.amountPaid - item.amountPending),
    0,
  );

  // T-389 (INSPECT-500): remise derived from the ledger adjustment stream
  // via the shared identification contract (isRemiseAdjustment) — the
  // student-scoped entries first, then the family-scoped ones when the
  // student carries none of its own.
  const remise = useMemo(() => {
    if (!student) return { studentScoped: 0, familyScoped: 0 };
    let studentScoped = 0;
    let familyScoped = 0;
    for (const entry of ledger) {
      if (!isRemiseAdjustment(entry)) continue;
      if (entry.parentId !== student.parentId) continue;
      if (entry.studentId === student.id) studentScoped += -entry.amount;
      else if (entry.studentId === null) familyScoped += -entry.amount;
    }
    return { studentScoped, familyScoped };
  }, [ledger, student]);
  const discount = remise.studentScoped > 0 ? remise.studentScoped : remise.familyScoped;
  const riskLabel =
    profile?.riskCategory === "healthy"
      ? "Profil régulier"
      : profile?.riskCategory;

  return (
    <UnifiedModal
      open={Boolean(profile)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="2xl"
      variant="dialog"
      icon={UserRound}
      iconTone="primary"
      title={student?.displayName || profile?.studentName || "Profil élève"}
      description="Vue 360° — état actuel, historique académique, présence et situation financière"
      hideFooter
    >
      {!profile ? null : (
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {student?.displayName || profile.studentName}
                  </h3>
                  <Badge
                    variant={
                      profile.riskCategory === "healthy" ? "success" : "warning"
                    }
                  >
                    {riskLabel}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {profile.className} · {profile.studentCode} ·{" "}
                  {student
                    ? GRADE_LEVEL_LABELS_FR[student.gradeLevel]
                    : profile.gradeLevel}
                </p>
              </div>
              <div className="text-right text-xs">
                <div className="text-muted-foreground">
                  Situation calculée à partir des flux live
                </div>
                <div className="font-mono font-semibold text-foreground">
                  {profile.gpa !== null
                    ? `${profile.gpa.toFixed(2)}/20`
                    : "Moyenne —"}{" "}
                  · {(profile.attendanceRate * 100).toFixed(0)}% présence
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Metric label="Risque" value={`${profile.riskScore}/100`} />
              <Metric
                label="Absences non excusées"
                value={String(profile.unexcusedAbsences)}
              />
              <Metric
                label="Dette famille"
                value={`${formatDzdPlain(
                  debt?.outstandingAmount ?? profile.debtAmount,
                )} DA`}
              />
            </div>
            {profile.primaryRiskReason !== "Profil régulier" && (
              <p className="mt-3 text-[11px] text-status-warning">
                {profile.primaryRiskReason}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard
              icon={GraduationCap}
              title="Situation pédagogique"
              description="Résultats actuels et progression historique"
            >
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info
                  label="Niveau actuel"
                  value={
                    student
                      ? GRADE_LEVEL_LABELS_FR[student.gradeLevel]
                      : profile.gradeLevel
                  }
                />
                <Info label="Classe" value={profile.className} />
                <Info
                  label="Moyenne actuelle"
                  value={
                    profile.gpa !== null
                      ? `${profile.gpa.toFixed(2)}/20`
                      : "—"
                  }
                />
                <Info label="Statut" value={student?.status ?? "—"} />
              </div>
              {student?.academicHistory && student.academicHistory.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {student.academicHistory
                    .slice()
                    .sort((a, b) => b.academicYear.localeCompare(a.academicYear))
                    .map((entry) => (
                      <div
                        key={entry.id ?? `${entry.academicYear}-${entry.gradeCode}`}
                        className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="font-medium">
                            {entry.academicYear} · {GRADE_LEVEL_LABELS_FR[entry.gradeCode]}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {entry.className ?? "Classe non renseignée"} · {entry.decision}
                          </div>
                        </div>
                        <span className="font-mono font-semibold">
                          {entry.gpa.toFixed(2)}/20
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyText text="Aucun historique académique archivé pour cet élève." />
              )}
            </SectionCard>

            <SectionCard
              icon={CalendarDays}
              title="Présence"
              description={`${studentAttendance.length} enregistrement(s) réel(s)`}
            >
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Info
                  label="Présence"
                  value={`${(profile.attendanceRate * 100).toFixed(0)}%`}
                />
                <Info
                  label="Abs. injustifiées"
                  value={String(profile.unexcusedAbsences)}
                />
                <Info
                  label="Retards"
                  value={String(
                    studentAttendance.filter((item) => item.status === "late")
                      .length,
                  )}
                />
              </div>
              <div className="mt-3 max-h-40 overflow-auto space-y-1.5">
                {studentAttendance.slice(0, 12).map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-[11px]"
                  >
                    <div>
                      <span className="font-medium">{formatShortDate(record.date)}</span>
                      <span className="ml-2 text-muted-foreground">
                        {SESSION_LABELS_FR[record.session]}
                      </span>
                    </div>
                    <span
                      className={
                        record.status === "present"
                          ? "text-status-success"
                          : "text-status-danger"
                      }
                    >
                      {ATTENDANCE_STATUS_LABELS_FR[record.status]}
                    </span>
                  </div>
                ))}
                {studentAttendance.length === 0 && (
                  <EmptyText text="Aucun enregistrement de présence trouvé." />
                )}
              </div>
            </SectionCard>

            <SectionCard
              icon={Wallet}
              title="Situation financière"
              description="Dette, échéances, remise et services"
            >
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info
                  label="Dette famille"
                  value={`${formatDzdPlain(
                    debt?.outstandingAmount ?? profile.debtAmount,
                  )} DA`}
                />
                <Info
                  label="Retard"
                  value={`${debt?.daysOverdue ?? profile.daysOverdue} j`}
                />
                <Info
                  label="Remise"
                  value={
                    discount > 0
                      ? `${formatDzdPlain(discount)} DA${remise.studentScoped > 0 ? "" : " (portée famille)"}`
                      : "Aucune remise enregistrée"
                  }
                />
                <Info
                  label="Reste échéances"
                  value={`${formatDzdPlain(remainingOnInstallments)} DA`}
                />
              </div>
              {services.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Services / obligations détectés
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((service) => (
                      <span
                        key={service}
                        className="rounded-full border border-border/70 px-2 py-1 text-[10px]"
                      >
                        {service}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 rounded-lg border border-border/60 bg-surface-elevated/30 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Clock3 className="h-3.5 w-3.5 text-primary" />
                  Prochaine échéance
                </div>
                {nextInstallment ? (
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-medium">{nextInstallment.label}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {PAYMENT_CATEGORY_LABELS_FR[nextInstallment.category]} · échéance{" "}
                        {formatShortDate(nextInstallment.dueDate)}
                      </div>
                    </div>
                    <span className="font-mono font-bold">
                      {formatDzdPlain(
                        Math.max(
                          0,
                          nextInstallment.amountDue -
                            nextInstallment.amountPaid -
                            nextInstallment.amountPending,
                        ),
                      )} DA
                    </span>
                  </div>
                ) : (
                  <EmptyText text="Aucune échéance restante trouvée dans le flux." />
                )}
              </div>
            </SectionCard>

            <SectionCard
              icon={CreditCard}
              title="Historique des paiements"
              description={`${paymentCount} paiement(s) réel(s) liés à cet élève ou à sa famille`}
            >
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Info label="Total payé" value={`${formatDzdPlain(paidTotal)} DA`} />
                <Info
                  label="Paiement moyen"
                  value={`${formatDzdPlain(averagePayment)} DA`}
                />
                <Info
                  label="Dernier paiement"
                  value={formatShortDate(studentPayments[0]?.collectedAt)}
                />
              </div>
              {paymentMethods.length > 0 && (
                <div className="mt-2 text-[10px] text-muted-foreground">
                  {paymentMethods
                    .map(([method, count]) => `${method}: ${count}`)
                    .join(" · ")}
                </div>
              )}
              <div className="mt-3 max-h-52 overflow-auto space-y-1.5">
                {studentPayments.slice(0, 15).map((payment) => (
                  <div
                    key={payment.id}
                    className="rounded-lg border border-border/50 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3 text-xs">
                      <div>
                        <div className="font-medium">
                          {paymentDescription(payment, studentInstallments)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDate(payment.collectedAt)} · {PAYMENT_METHOD_LABELS_FR[payment.method]} ·{" "}
                          {PAYMENT_STATUS_LABELS_FR[payment.status]}
                        </div>
                      </div>
                      <span className="font-mono font-bold whitespace-nowrap">
                        {formatDzdPlain(payment.amount)} DA
                      </span>
                    </div>
                    {(payment.expectedAmount != null || payment.excessAmount) && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Attendu : {formatDzdPlain(payment.expectedAmount ?? 0)} DA
                        {payment.excessAmount
                          ? ` · Excédent : ${formatDzdPlain(payment.excessAmount)} DA`
                          : ""}
                      </div>
                    )}
                  </div>
                ))}
                {studentPayments.length === 0 && (
                  <EmptyText text="Aucun paiement trouvé dans le flux live." />
                )}
              </div>
            </SectionCard>
          </div>

          <SectionCard
            icon={GraduationCap}
            title="Notes et évaluations"
            description={`${studentAssessments.length} évaluation(s) réelle(s), avec les snapshots de coefficients`}
          >
            <div className="max-h-52 overflow-auto">
              {studentAssessments.length > 0 ? (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-panel text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="px-3 py-2 text-left font-medium">Année / période</th>
                      <th className="px-3 py-2 text-left font-medium">Matière</th>
                      <th className="px-3 py-2 text-right font-medium">Moyenne</th>
                      <th className="px-3 py-2 text-right font-medium">Coeff.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {studentAssessments.slice(0, 30).map((assessment) => {
                      const subject = subjects.find(
                        (item: Subject) => item.id === assessment.subjectId,
                      );
                      return (
                        <tr key={assessment.id}>
                          <td className="px-3 py-2">
                            {assessment.academicYear} · {assessment.term}
                          </td>
                          <td className="px-3 py-2">
                            {subject?.name ?? assessment.subjectId}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {assessment.subjectAverage?.toFixed(2) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {assessment.coefficient}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <EmptyText text="Aucune évaluation trouvée pour cet élève." />
              )}
            </div>
          </SectionCard>

          <SectionCard
            icon={AlertTriangle}
            title="Alertes et points à surveiller"
            description="Signaux dérivés des mêmes données live que la console"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <AlertBox
                label="Risque composite"
                value={riskLabel ?? "—"}
                active={profile.riskCategory !== "healthy"}
              />
              <AlertBox
                label="Situation financière"
                value={
                  (debt?.outstandingAmount ?? profile.debtAmount) > 0
                    ? `${formatDzdPlain(
                        debt?.outstandingAmount ?? profile.debtAmount,
                      )} DA`
                    : "Soldée"
                }
                active={(debt?.outstandingAmount ?? profile.debtAmount) > 0}
              />
              <AlertBox
                label="Prochaine échéance"
                value={
                  nextInstallment
                    ? formatShortDate(nextInstallment.dueDate)
                    : "Aucune"
                }
                active={Boolean(nextInstallment)}
              />
            </div>
          </SectionCard>

          {parent && (
            <div className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
              Parent lié: <span className="font-medium text-foreground">{profile.parentName}</span>
              {parent.phone ? ` · ${parent.phone}` : ""}
            </div>
          )}
        </div>
      )}
    </UnifiedModal>
  );
}

export function OperationalQueryConsole({ profiles }: Props) {
  const { askAgent, setIsOpen: openCopilot } = useAICopilot();
  const [search, setSearch] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>("triple_critical");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortField, setSortField] = useState<"riskScore" | "debtAmount" | "gpa">("riskScore");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<StudentRiskProfile | null>(null);

  const filteredProfiles = useMemo(() => {
    return profiles
      .filter((p) => {
        if (activePreset) {
          const preset = OPERATIONAL_PRESETS.find((pr) => pr.id === activePreset);
          if (preset) {
            if (preset.filterCategory && p.riskCategory !== preset.filterCategory) return false;
            if (preset.customFilter && !preset.customFilter(p)) return false;
          }
        }
        if (selectedCategory !== "all" && p.riskCategory !== selectedCategory) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            p.studentName.toLowerCase().includes(q) ||
            p.studentCode.toLowerCase().includes(q) ||
            p.parentName.toLowerCase().includes(q) ||
            p.className.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const valA = a[sortField] ?? -1;
        const valB = b[sortField] ?? -1;
        if (valA === valB) return 0;
        return sortAsc ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
      });
  }, [profiles, activePreset, selectedCategory, search, sortField, sortAsc]);

  const queryStats = useMemo(() => {
    const count = filteredProfiles.length;
    const totalDebt = filteredProfiles.reduce((s, p) => s + p.debtAmount, 0);
    const gpas = filteredProfiles
      .map((p) => p.gpa)
      .filter((g): g is number => g !== null);
    const avgGpa = gpas.length > 0 ? gpas.reduce((s, g) => s + g, 0) / gpas.length : null;
    return { count, totalDebt, avgGpa };
  }, [filteredProfiles]);

  const handleAskAIAboutCohort = () => {
    if (filteredProfiles.length === 0) return;
    const topSample = filteredProfiles
      .slice(0, 5)
      .map(
        (p) =>
          `- ${p.studentName} (${p.className}) : GPA ${p.gpa ?? "N/A"}/20, ${p.unexcusedAbsences} abs., Dette: ${p.debtAmount} DA`,
      )
      .join("\n");
    const prompt =
      `Analyse de la cohorte sous le filtre « ${activePreset ?? selectedCategory} » (${filteredProfiles.length} élèves identifiés, dette cumulée: ${queryStats.totalDebt.toLocaleString("fr-FR")} DA) :\n${topSample}\n\n` +
      `Donne un diagnostic synthétique et 3 actions prioritaires.`;
    openCopilot(true);
    void askAgent(prompt);
  };

  const handleAskAIAboutStudent = (profile: StudentRiskProfile) => {
    const prompt =
      `Diagnostic personnalisé pour l'élève ${profile.studentName} (${profile.className}) :\n` +
      `- Moyenne : ${profile.gpa ?? "N/A"}/20\n` +
      `- Assiduité : ${(profile.attendanceRate * 100).toFixed(0)}% (${profile.unexcusedAbsences} absences)\n` +
      `- Créance : ${profile.debtAmount.toLocaleString("fr-FR")} DA (${profile.daysOverdue} j retard)\n` +
      `Propose une recommandation concrète pour la direction.`;
    openCopilot(true);
    void askAgent(prompt);
  };

  return (
    <>
      <Card className="border-border/70 bg-surface-panel shadow-sm">
        <CardHeader className="py-3.5 px-4 border-b border-border/50 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Console d'Investigation Opérationnelle
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Interrogation temps réel : profil académique, présence et statut financier
              </CardDescription>
            </div>
            {filteredProfiles.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAskAIAboutCohort}
                className="h-8 gap-1.5 border-primary/40 bg-primary/5 text-primary text-xs"
              >
                <Bot className="h-3.5 w-3.5" />
                Interroger l'IA sur cette sélection ({filteredProfiles.length})
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] font-bold uppercase text-muted-foreground mr-1 flex items-center gap-1">
              <Filter className="h-3 w-3" /> Requêtes rapides :
            </span>
            {OPERATIONAL_PRESETS.map((preset) => {
              const isActive = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    if (isActive) setActivePreset(null);
                    else {
                      setActivePreset(preset.id);
                      setSelectedCategory("all");
                    }
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-sm font-semibold"
                      : "bg-surface-elevated/40 text-muted-foreground border-border/70 hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {preset.title}
                </button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par élève, parent, code ou classe…"
                className="h-8 pl-8 text-xs bg-surface-elevated/40"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Trier :</span>
              <Button
                variant={sortField === "riskScore" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  if (sortField === "riskScore") setSortAsc(!sortAsc);
                  else {
                    setSortField("riskScore");
                    setSortAsc(false);
                  }
                }}
              >
                Niveau de Risque <ArrowUpDown className="h-3 w-3 ml-1" />
              </Button>
              <Button
                variant={sortField === "debtAmount" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  if (sortField === "debtAmount") setSortAsc(!sortAsc);
                  else {
                    setSortField("debtAmount");
                    setSortAsc(false);
                  }
                }}
              >
                Créance <ArrowUpDown className="h-3 w-3 ml-1" />
              </Button>
              <Button
                variant={sortField === "gpa" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  if (sortField === "gpa") setSortAsc(!sortAsc);
                  else {
                    setSortField("gpa");
                    setSortAsc(true);
                  }
                }}
              >
                Moyenne <ArrowUpDown className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-surface-elevated/40 border border-border/50 text-muted-foreground">
            <span>
              Dossiers filtrés :{" "}
              <strong className="text-foreground font-mono">{queryStats.count}</strong>
            </span>
            <div className="flex items-center gap-4">
              {queryStats.totalDebt > 0 && (
                <span>
                  Créances cumulées :{" "}
                  <strong className="text-status-danger font-mono font-bold">
                    {formatDzdPlain(queryStats.totalDebt)} DA
                  </strong>
                </span>
              )}
              {queryStats.avgGpa !== null && (
                <span>
                  Moyenne cohorte :{" "}
                  <strong className="text-foreground font-mono font-bold">
                    {queryStats.avgGpa.toFixed(2)}/20
                  </strong>
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/70 overflow-hidden">
            {filteredProfiles.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-xs space-y-1">
                <CheckCircle2 className="h-8 w-8 mx-auto text-status-success/60 mb-2" />
                <p className="font-semibold text-foreground">
                  Aucun dossier ne correspond à ces critères.
                </p>
                <p>Tous les profils vérifiés sont réguliers.</p>
              </div>
            ) : (
              <div className="max-h-[380px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground sticky top-0 bg-surface-panel z-10 text-left">
                    <tr className="border-b border-border/60">
                      <th className="py-2.5 px-3 font-medium">Élève & Classe</th>
                      <th className="py-2.5 px-3 font-medium">Parent & Contact</th>
                      <th className="py-2.5 px-2 text-center font-medium">Moyenne</th>
                      <th className="py-2.5 px-2 text-center font-medium">Présence</th>
                      <th className="py-2.5 px-3 text-right font-medium">Créance</th>
                      <th className="py-2.5 px-3 font-medium">Facteur d'Alerte</th>
                      <th className="py-2.5 px-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {filteredProfiles.map((p) => (
                      <tr key={p.studentId} className="hover:bg-accent/5 transition-colors">
                        <td className="py-2 px-3">
                          <div className="font-semibold text-foreground">{p.studentName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {p.className} · {p.studentCode}
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <div className="text-foreground truncate max-w-[130px]" title={p.parentName}>
                            {p.parentName}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">{p.parentPhone}</div>
                        </td>
                        <td className="py-2 px-2 text-center">
                          {p.gpa !== null ? (
                            <span
                              className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${
                                p.gpa >= 10
                                  ? "text-status-success bg-status-success/15"
                                  : "text-status-danger bg-status-danger/15"
                              }`}
                            >
                              {p.gpa.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center font-mono">
                          <div>{(p.attendanceRate * 100).toFixed(0)}%</div>
                          {p.unexcusedAbsences > 0 && (
                            <span className="text-[10px] text-status-danger font-semibold">
                              {p.unexcusedAbsences} abs.
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {p.debtAmount > 0 ? (
                            <div>
                              <span className="font-bold text-status-danger">
                                {formatDzdPlain(p.debtAmount)}
                              </span>
                              <span className="text-[10px] text-muted-foreground block">
                                {p.daysOverdue} j
                              </span>
                            </div>
                          ) : (
                            <span className="text-status-success font-medium">0 DA</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 max-w-[200px]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {p.riskCategory === "triple_critical" && (
                              <Badge variant="danger" className="text-[9px] px-1.5 py-0 font-bold">
                                Triple Risque
                              </Badge>
                            )}
                            <span
                              className="text-[11px] text-muted-foreground truncate block"
                              title={p.primaryRiskReason}
                            >
                              {p.primaryRiskReason}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1"
                              onClick={() => setSelectedProfile(p)}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Vue 360°
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px]"
                              onClick={() => handleAskAIAboutStudent(p)}
                            >
                              <Bot className="h-3 w-3" />
                              IA
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-status-success" />
            La liste et la vue 360° utilisent les mêmes flux repository réactifs que le dashboard.
          </div>
        </CardContent>
      </Card>

      <Student360Modal
        profile={selectedProfile}
        onClose={() => setSelectedProfile(null)}
      />
    </>
  );
}
