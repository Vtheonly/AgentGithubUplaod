// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/data-inspector.tsx
// ============================================================================
/**
 * Universal dashboard Data Lineage & Inspection Engine.
 *
 * UI-only by design: it resolves against the same reactive repository streams
 * already consumed by AnalyticsTab. It never creates synthetic records.
 *
 * Flow:
 *   InspectTrigger -> compact contributor inspector -> forensic drawer
 *   -> exact source records -> reconciliation/export
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { UnifiedModal } from "../../../../shared/ui/unified-modal";
import { Button } from "../../../../shared/ui/button";
import { Input } from "../../../../shared/ui/input";
import { Badge } from "../../../../shared/ui/badge";
import { formatDzdPlain } from "../../../../core/format/currency";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import type { Student } from "../../../../domain/model/student";
import type { Parent } from "../../../../domain/model/parent";
import type { AcademicClass, Assessment, AttendanceRecord } from "../../../../domain/model/academic";
import type { Payment, Installment, PaymentMethod, PaymentCategory, DebtSummary } from "../../../../domain/model/payment";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
} from "../../../../domain/model/payment";
import { GRADE_LEVEL_LABELS_FR } from "../../../../domain/model/student";
import { installmentsForAcademicYear, inRange, type AnalyticsFilterState, NO_ANALYTICS_FILTERS } from "./analytics-derivations";

export type InspectorDomain =
  | "revenue"
  | "debt"
  | "payment-method"
  | "payment-category"
  | "tranche"
  | "enrollment"
  | "attendance"
  | "academic-risk"
  | "service"
  | "transport"
  | "discount";

export interface InspectRequest {
  domain: InspectorDomain;
  title: string;
  metric?: string;
  sourceValue: number;
  filters?: {
    from?: string;
    to?: string;
    method?: PaymentMethod;
    category?: PaymentCategory;
    trancheNumber?: 1 | 2 | 3;
    mode?: "collected" | "remaining";
    classId?: string;
    gradeLevel?: string;
    transportDestination?: string;
    agingBucket?: string;
  };
}

export interface LineageContributor {
  key: string;
  name: string;
  code: string;
  phone: string;
  amount: number;
  percentage: number;
  recordCount: number;
  latestDate: string | null;
  lateDays: number;
}

export interface LineageRecord {
  id: string;
  contributorKey: string;
  contributorName: string;
  contributorCode: string;
  contributorPhone: string;
  studentName: string;
  className: string;
  amount: number;
  percentage: number;
  date: string | null;
  description: string;
  status: string;
  reference: string;
  method: string;
}

export interface ResolvedInspection {
  request: InspectRequest;
  records: LineageRecord[];
  contributors: LineageContributor[];
  remainderAmount: number;
  remainderCount: number;
  resolvedValue: number;
  difference: number;
  formula: string;
  generatedAt: string;
  sourceCounts: Record<string, number>;
}

interface InspectorContextValue {
  inspectData: (request: InspectRequest) => void;
}

import { createContext, useContext } from "react";

const DataInspectorContext = createContext<InspectorContextValue | null>(null);

function displayName(parent: Parent | undefined): string {
  if (!parent) return "Famille non résolue";
  return parent.displayName?.trim() || `${parent.firstName} ${parent.lastName}`.trim();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function buildResolution(
  request: InspectRequest,
  input: {
    students: readonly Student[];
    parents: readonly Parent[];
    classes: readonly AcademicClass[];
    assessments: readonly Assessment[];
    attendance: readonly AttendanceRecord[];
    payments: readonly Payment[];
    installments: readonly Installment[];
    debts: readonly DebtSummary[];
    academicYear: string;
    range?: { from: string; to: string };
  },
): ResolvedInspection {
  const parentMap = new Map(input.parents.map((p) => [p.id, p]));
  const studentMap = new Map(input.students.map((s) => [s.id, s]));
  const classMap = new Map(input.classes.map((c) => [c.id, c]));
  const from = request.filters?.from ?? input.range?.from;
  const to = request.filters?.to ?? input.range?.to;
  const range = from && to ? { from, to } : input.range;

  const rows: Array<{
    id: string;
    contributorKey: string;
    contributorName: string;
    contributorCode: string;
    contributorPhone: string;
    studentName: string;
    className: string;
    amount: number;
    date: string | null;
    description: string;
    status: string;
    reference: string;
    method: string;
    lateDays: number;
  }> = [];

  if (request.domain === "revenue" || request.domain === "payment-method" || request.domain === "payment-category" || request.domain === "service") {
    for (const payment of input.payments) {
      if (payment.status !== "paid" || !inRange(payment, range)) continue;
      if (request.filters?.method && payment.method !== request.filters.method) continue;
      if (request.filters?.category && payment.category !== request.filters.category) continue;
      const parent = parentMap.get(payment.parentId);
      const student = payment.studentId ? studentMap.get(payment.studentId) : undefined;
      rows.push({
        id: payment.id,
        contributorKey: payment.parentId,
        contributorName: displayName(parent),
        contributorCode: parent?.code ?? payment.parentId,
        contributorPhone: parent?.phone ?? "—",
        studentName: student?.displayName || (student ? `${student.firstName} ${student.lastName}` : "—"),
        className: student?.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: payment.amount,
        date: payment.collectedAt,
        description: payment.installmentId
          ? input.installments.find((i) => i.id === payment.installmentId)?.label ?? PAYMENT_CATEGORY_LABELS_FR[payment.category]
          : PAYMENT_CATEGORY_LABELS_FR[payment.category],
        status: PAYMENT_STATUS_LABELS_FR[payment.status],
        reference: payment.receiptNumber,
        method: PAYMENT_METHOD_LABELS_FR[payment.method],
        lateDays: 0,
      });
    }
  } else if (request.domain === "debt" || request.domain === "tranche") {
    const scoped = installmentsForAcademicYear(input.installments, input.academicYear);
    for (const installment of scoped) {
      const remaining = Math.max(0, installment.amountDue - installment.amountPaid - installment.amountPending);
      if (request.domain === "debt" && remaining <= 0) continue;
      if (request.domain === "tranche" && request.filters?.trancheNumber && installment.trancheNumber !== request.filters.trancheNumber) continue;
      const mode = request.filters?.mode ?? "remaining";
      if (request.domain === "tranche" && mode === "collected" && installment.amountPaid <= 0) continue;
      if (request.domain === "tranche" && mode === "remaining" && remaining <= 0) continue;
      const parent = parentMap.get(installment.parentId);
      const student = installment.studentId ? studentMap.get(installment.studentId) : undefined;
      const overdueDays = Math.max(0, Math.floor((Date.now() - new Date(installment.dueDate).getTime()) / 86_400_000));
      const amount = request.domain === "tranche" && mode === "collected" ? installment.amountPaid : remaining;
      if (amount <= 0) continue;
      rows.push({
        id: installment.id,
        contributorKey: installment.parentId,
        contributorName: displayName(parent),
        contributorCode: parent?.code ?? installment.parentId,
        contributorPhone: parent?.phone ?? "—",
        studentName: student?.displayName || (student ? `${student.firstName} ${student.lastName}` : "—"),
        className: student?.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount,
        date: mode === "collected" ? installment.paidDate : installment.dueDate,
        description: installment.label,
        status: installment.status,
        reference: installment.id,
        method: PAYMENT_CATEGORY_LABELS_FR[installment.category],
        lateDays: installment.status === "overdue" ? overdueDays : 0,
      });
    }
  } else if (request.domain === "enrollment") {
    for (const student of input.students) {
      if (request.filters?.classId && student.classId !== request.filters.classId) continue;
      if (request.filters?.gradeLevel && student.gradeLevel !== request.filters.gradeLevel) continue;
      const parent = parentMap.get(student.parentId);
      rows.push({
        id: student.id,
        contributorKey: student.parentId,
        contributorName: displayName(parent),
        contributorCode: student.code,
        contributorPhone: parent?.phone ?? "—",
        studentName: student.displayName || `${student.firstName} ${student.lastName}`,
        className: student.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: 1,
        date: student.updatedAt,
        description: GRADE_LEVEL_LABELS_FR[student.gradeLevel],
        status: student.status,
        reference: student.code,
        method: "Effectif",
        lateDays: 0,
      });
    }
  } else if (request.domain === "attendance") {
    for (const record of input.attendance) {
      const student = studentMap.get(record.studentId);
      if (!student || (range && (record.date < range.from || record.date > range.to))) continue;
      const parent = parentMap.get(student.parentId);
      rows.push({
        id: record.id,
        contributorKey: student.parentId,
        contributorName: displayName(parent),
        contributorCode: student.code,
        contributorPhone: parent?.phone ?? "—",
        studentName: student.displayName || `${student.firstName} ${student.lastName}`,
        className: student.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: record.status === "absent" ? 1 : 0,
        date: record.date,
        description: record.status,
        status: record.status,
        reference: record.id,
        method: record.session,
        lateDays: 0,
      });
    }
  } else if (request.domain === "academic-risk") {
    const averages = new Map<string, number[]>();
    for (const a of input.assessments) {
      if (typeof a.subjectAverage !== "number") continue;
      const current = averages.get(a.studentId) ?? [];
      current.push(a.subjectAverage);
      averages.set(a.studentId, current);
    }
    for (const [studentId, values] of averages) {
      const average = values.reduce((s, v) => s + v, 0) / values.length;
      if (average >= 10) continue;
      const student = studentMap.get(studentId);
      if (!student) continue;
      const parent = parentMap.get(student.parentId);
      rows.push({
        id: student.id,
        contributorKey: student.parentId,
        contributorName: displayName(parent),
        contributorCode: student.code,
        contributorPhone: parent?.phone ?? "—",
        studentName: student.displayName || `${student.firstName} ${student.lastName}`,
        className: student.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: 1,
        date: student.updatedAt,
        description: `Moyenne ${average.toFixed(2)}/20`,
        status: "GPA < 10",
        reference: student.code,
        method: "Pédagogique",
        lateDays: 0,
      });
    }
  } else if (request.domain === "transport") {
    for (const parent of input.parents) {
      if (!parent.transportDestination) continue;
      if (request.filters?.transportDestination && parent.transportDestination !== request.filters.transportDestination) continue;
      const children = input.students.filter((s) => s.parentId === parent.id);
      for (const student of children) {
        rows.push({
          id: student.id,
          contributorKey: parent.id,
          contributorName: displayName(parent),
          contributorCode: parent.code,
          contributorPhone: parent.phone,
          studentName: student.displayName || `${student.firstName} ${student.lastName}`,
          className: student.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
          amount: 1,
          date: student.updatedAt,
          description: parent.transportDestination,
          status: "Transport",
          reference: parent.code,
          method: "Destination",
          lateDays: 0,
        });
      }
    }
  } else if (request.domain === "discount") {
    for (const student of input.students) {
      if (!(student.remise > 0)) continue;
      const parent = parentMap.get(student.parentId);
      rows.push({
        id: student.id,
        contributorKey: parent?.id ?? student.parentId,
        contributorName: displayName(parent),
        contributorCode: parent?.code ?? student.code,
        contributorPhone: parent?.phone ?? "—",
        studentName: student.displayName || `${student.firstName} ${student.lastName}`,
        className: student.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: student.remise,
        date: student.updatedAt,
        description: "Remise enregistrée",
        status: "Remise",
        reference: student.code,
        method: "Remise",
        lateDays: 0,
      });
    }
  }

  const resolvedValue = rows.reduce((sum, row) => sum + row.amount, 0);
  const grouped = new Map<string, LineageContributor>();
  for (const row of rows) {
    const existing = grouped.get(row.contributorKey);
    if (existing) {
      existing.amount += row.amount;
      existing.recordCount += 1;
      existing.latestDate = existing.latestDate && row.date
        ? new Date(existing.latestDate) > new Date(row.date) ? existing.latestDate : row.date
        : existing.latestDate ?? row.date;
      existing.lateDays = Math.max(existing.lateDays, row.lateDays);
    } else {
      grouped.set(row.contributorKey, {
        key: row.contributorKey,
        name: row.contributorName,
        code: row.contributorCode,
        phone: row.contributorPhone,
        amount: row.amount,
        percentage: 0,
        recordCount: 1,
        latestDate: row.date,
        lateDays: row.lateDays,
      });
    }
  }

  const contributors = [...grouped.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({
      ...item,
      percentage: resolvedValue > 0 ? (item.amount / resolvedValue) * 100 : 0,
    }));
  const topKeys = new Set(contributors.slice(0, 5).map((c) => c.key));
  const remainderAmount = contributors.filter((c) => !topKeys.has(c.key)).reduce((sum, c) => sum + c.amount, 0);
  const remainderCount = contributors.filter((c) => !topKeys.has(c.key)).length;

  const finalizedRecords: LineageRecord[] = rows
    .map((row) => ({
      ...row,
      percentage: resolvedValue > 0 ? (row.amount / resolvedValue) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  let formula = `${rows.length} enregistrement(s) live`; 
  if (request.domain === "revenue" || request.domain === "payment-method" || request.domain === "payment-category" || request.domain === "service") {
    formula = `Somme de ${rows.length} versement(s) PAID${range ? ` entre ${range.from} et ${range.to}` : ""}${request.filters?.method ? ` · méthode ${PAYMENT_METHOD_LABELS_FR[request.filters.method]}` : ""}${request.filters?.category ? ` · catégorie ${PAYMENT_CATEGORY_LABELS_FR[request.filters.category]}` : ""}`;
  } else if (request.domain === "debt") {
    formula = `Somme des restes dus positifs sur les échéances de ${input.academicYear}`;
  } else if (request.domain === "tranche") {
    formula = `Échéances T${request.filters?.trancheNumber ?? "?"} · ${request.filters?.mode === "collected" ? "montants encaissés" : "soldes restants"} · année ${input.academicYear}`;
  } else if (request.domain === "enrollment") {
    formula = `${rows.length} élève(s) du catalogue actif correspondant aux filtres`; 
  } else if (request.domain === "attendance") {
    formula = `${rows.length} présence(s)/absence(s) des enregistrements live sur la période sélectionnée`;
  } else if (request.domain === "academic-risk") {
    formula = `${rows.length} élève(s) avec moyenne calculée < 10/20 à partir des évaluations live`;
  } else if (request.domain === "transport") {
    formula = `${rows.length} rattachement(s) élève-famille avec destination transport enregistrée`;
  } else if (request.domain === "discount") {
    formula = `${rows.length} élève(s) avec remise > 0 dans le catalogue live`;
  }

  return {
    request,
    records: finalizedRecords,
    contributors,
    remainderAmount,
    remainderCount,
    resolvedValue,
    difference: resolvedValue - request.sourceValue,
    formula,
    generatedAt: new Date().toISOString(),
    sourceCounts: {
      payments: input.payments.length,
      installments: input.installments.length,
      students: input.students.length,
      parents: input.parents.length,
      assessments: input.assessments.length,
      attendance: input.attendance.length,
      debtSummaries: input.debts.length,
    },
  };
}

export function DataInspectorProvider({
  children,
  academicYear,
  range,
}: {
  children: ReactNode;
  academicYear: string;
  range?: { from: string; to: string };
}) {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);
  const assessments = useObservable(() => repos.grades.observeAll(), []);
  const attendance = useObservable(
    () => repos.attendance.observeAll(range?.from ?? "2020-01-01", range?.to ?? "2035-12-31"),
    [range?.from, range?.to],
  );
  const payments = useObservable(() => repos.payments.observe(), []);
  const installments = useObservable(() => repos.installments.observe(), []);
  const debts = useObservable(() => repos.debt.observeSummary(), []);
  const [request, setRequest] = useState<InspectRequest | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [sortDescending, setSortDescending] = useState(true);

  const resolved = useMemo(() => {
    if (!request) return null;
    return buildResolution(request, {
      students,
      parents,
      classes,
      assessments,
      attendance,
      payments,
      installments,
      debts,
      academicYear,
      range,
    });
  }, [request, students, parents, classes, assessments, attendance, payments, installments, debts, academicYear, range]);

  const visibleRecords = useMemo(() => {
    if (!resolved) return [];
    const needle = search.trim().toLocaleLowerCase("fr");
    return [...resolved.records]
      .filter((record) => {
        if (!needle) return true;
        return [record.contributorName, record.contributorCode, record.contributorPhone, record.studentName, record.reference, record.description]
          .some((value) => value.toLocaleLowerCase("fr").includes(needle));
      })
      .sort((a, b) => sortDescending ? b.amount - a.amount : a.amount - b.amount);
  }, [resolved, search, sortDescending]);

  function inspectData(next: InspectRequest) {
    setSearch("");
    setSortDescending(true);
    setExpanded(false);
    setRequest(next);
  }

  async function exportExcel() {
    if (!resolved) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Audit");
    sheet.addRow(["El-Imtiyaz — Data Lineage Audit"]);
    sheet.addRow(["Source", resolved.request.title]);
    sheet.addRow(["Formule", resolved.formula]);
    sheet.addRow(["Valeur affichée", resolved.request.sourceValue]);
    sheet.addRow(["Valeur résolue", resolved.resolvedValue]);
    sheet.addRow(["Écart", resolved.difference]);
    sheet.addRow([]);
    sheet.addRow(["Contributeur", "Code", "Téléphone", "Élève", "Classe", "Montant", "%", "Date", "Référence", "Statut", "Méthode", "Description"]);
    for (const row of visibleRecords) {
      sheet.addRow([row.contributorName, row.contributorCode, row.contributorPhone, row.studentName, row.className, row.amount, row.percentage / 100, row.date, row.reference, row.status, row.method, row.description]);
    }
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(8).font = { bold: true };
    sheet.columns.forEach((column) => { column.width = Math.min(32, Math.max(12, Number(column.header?.length ?? 12) + 3)); });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "elimtiyaz-lineage-audit.xlsx");
  }

  async function exportPdf() {
    if (!resolved) return;
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([842, 595]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    let y = 560;
    const draw = (text: string, size = 9) => {
      page.drawText(text.slice(0, 130), { x: 30, y, size, font, color: rgb(0.12, 0.12, 0.14) });
      y -= size + 6;
      if (y < 45) { y = 560; pdf.addPage([842, 595]); }
    };
    draw("El-Imtiyaz — Data Lineage Audit", 16);
    draw(resolved.request.title, 11);
    draw(resolved.formula);
    draw(`Valeur affichée: ${formatDzdPlain(resolved.request.sourceValue)} · Valeur résolue: ${formatDzdPlain(resolved.resolvedValue)} · Écart: ${formatDzdPlain(resolved.difference)}`);
    draw("");
    for (const row of visibleRecords.slice(0, 80)) {
      draw(`${row.contributorName} · ${row.studentName} · ${formatDzdPlain(row.amount)} · ${Math.round(row.percentage * 10) / 10}% · ${row.reference}`);
    }
    const bytes = await pdf.save();
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), "elimtiyaz-lineage-audit.pdf");
  }

  return (
    <DataInspectorContext.Provider value={{ inspectData }}>
      {children}
      <UnifiedModal
        open={Boolean(request && expanded)}
        onOpenChange={(open) => { if (!open) setExpanded(false); }}
        variant="drawer"
        size="xl"
        icon={Search}
        iconTone="primary"
        title={resolved?.request.title ?? "Inspection de données"}
        description="Vue forensique — enregistrements live, contributeurs et rapprochement mathématique"
        hideFooter
      >
        {resolved && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3"><div className="text-[10px] text-muted-foreground">Affiché</div><div className="font-mono font-semibold">{formatDzdPlain(resolved.request.sourceValue)}</div></div>
              <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3"><div className="text-[10px] text-muted-foreground">Composants</div><div className="font-mono font-semibold">{formatDzdPlain(resolved.resolvedValue)}</div></div>
              <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3"><div className="text-[10px] text-muted-foreground">Écart</div><div className={`font-mono font-semibold ${Math.abs(resolved.difference) < 0.5 ? "text-status-success" : "text-status-danger"}`}>{formatDzdPlain(resolved.difference)}</div></div>
              <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3"><div className="text-[10px] text-muted-foreground">Enregistrements</div><div className="font-mono font-semibold">{resolved.records.length}</div></div>
            </div>

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><div className="text-xs font-semibold">Formule auditée</div><div className="mt-1 text-[11px] text-muted-foreground">{resolved.formula}</div></div></div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px]"><Badge variant="outline">payments: {resolved.sourceCounts.payments}</Badge><Badge variant="outline">installments: {resolved.sourceCounts.installments}</Badge><Badge variant="outline">students: {resolved.sourceCounts.students}</Badge><Badge variant="outline">parents: {resolved.sourceCounts.parents}</Badge></div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[260px] flex-1"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 text-xs" placeholder="Rechercher famille, élève, référence…" /></div>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setSortDescending((v) => !v)}><ArrowDownUp className="h-3.5 w-3.5" />Montant {sortDescending ? "↓" : "↑"}</Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => void exportExcel()}><FileSpreadsheet className="h-3.5 w-3.5" />Excel</Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => void exportPdf()}><FileText className="h-3.5 w-3.5" />PDF</Button>
            </div>

            <div className="overflow-auto rounded-xl border border-border/70">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2 text-left">Famille</th><th className="px-3 py-2 text-left">Élève</th><th className="px-3 py-2 text-left">Classe</th><th className="px-3 py-2 text-right">Montant</th><th className="px-3 py-2 text-right">Part</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Référence</th><th className="px-3 py-2 text-left">Statut</th></tr></thead>
                <tbody>{visibleRecords.map((row) => <tr key={`${row.id}-${row.reference}`} className="border-t border-border/50"><td className="px-3 py-2"><div className="font-medium">{row.contributorName}</div><div className="text-[10px] text-muted-foreground">{row.contributorCode} · {row.contributorPhone}</div></td><td className="px-3 py-2">{row.studentName}</td><td className="px-3 py-2">{row.className}</td><td className="px-3 py-2 text-right font-mono">{formatDzdPlain(row.amount)}</td><td className="px-3 py-2 text-right font-mono">{(row.percentage).toFixed(1)}%</td><td className="px-3 py-2 whitespace-nowrap">{dateLabel(row.date)}</td><td className="px-3 py-2 font-mono text-[10px]">{row.reference}</td><td className="px-3 py-2">{row.status}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </UnifiedModal>

      {request && resolved && !expanded && (
        <div className="fixed right-5 top-24 z-[70] w-[340px] overflow-hidden rounded-2xl border border-border/80 bg-surface-panel/95 shadow-2xl backdrop-blur-md">
          <div className="border-b border-border/60 px-4 py-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Provenance</div><div className="truncate text-sm font-semibold text-foreground">{request.title}</div><div className="mt-1 font-mono text-base font-bold">{formatDzdPlain(request.sourceValue)}</div></div><button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setRequest(null)} aria-label="Fermer"><X className="h-4 w-4" /></button></div></div>
          <div className="px-4 py-3 space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-muted/60">{resolved.contributors.slice(0, 5).map((c) => <div key={c.key} className={`inline-block h-full ${c.percentage > 25 ? "bg-primary" : c.percentage >= 10 ? "bg-primary/60" : "bg-muted-foreground/30"}`} style={{ width: `${Math.max(0, Math.min(100, c.percentage))}%` }} />)}</div>
            <div className="space-y-2">{resolved.contributors.slice(0, 5).map((c) => <div key={c.key} className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="truncate text-xs font-medium">{c.name}</div><div className="text-[10px] text-muted-foreground">{c.code}{c.lateDays > 45 ? " · >45 j" : ""}</div></div><div className="shrink-0 text-right"><div className="font-mono text-xs font-semibold">{formatDzdPlain(c.amount)}</div><div className="text-[10px] text-muted-foreground">{c.percentage.toFixed(1)}%</div></div></div>)}</div>
            {resolved.remainderCount > 0 && <div className="border-t border-border/50 pt-2 text-[11px] text-muted-foreground">+ {resolved.remainderCount} autres familles · {formatDzdPlain(resolved.remainderAmount)}</div>}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 text-[10px] text-muted-foreground">{resolved.formula}<br />{Math.abs(resolved.difference) < 0.5 ? "Rapprochement 100%" : `Écart détecté: ${formatDzdPlain(resolved.difference)}`}</div>
            <div className="flex gap-2"><Button size="sm" className="flex-1 text-xs" onClick={() => setExpanded(true)}><ArrowUpRight className="h-3.5 w-3.5" />Agrandir / voir la liste</Button><Button size="sm" variant="outline" className="text-xs" onClick={() => void exportExcel()}><Download className="h-3.5 w-3.5" /></Button></div>
          </div>
        </div>
      )}
    </DataInspectorContext.Provider>
  );
}

export function useDataInspector(): InspectorContextValue {
  const context = useContext(DataInspectorContext);
  if (!context) throw new Error("useDataInspector must be used inside DataInspectorProvider");
  return context;
}

export function InspectTrigger({
  request,
  label = "Inspecter",
  compact = true,
}: {
  request: InspectRequest;
  label?: string;
  compact?: boolean;
}) {
  const { inspectData } = useDataInspector();
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); inspectData(request); }}
      className={`inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10 ${compact ? "" : "px-2.5 py-1.5"}`}
      title={label}
    >
      <Search className="h-3 w-3" />
      {label}
    </button>
  );
}

export function inspectRequestForKpi(domain: InspectorDomain, title: string, sourceValue: number, filters?: InspectRequest["filters"]): InspectRequest {
  return { domain, title, sourceValue, filters: filters ?? {} };
}

export const EMPTY_INSPECTOR_FILTERS: AnalyticsFilterState = NO_ANALYTICS_FILTERS;
