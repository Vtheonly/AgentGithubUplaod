/**
 * Full-application Excel export — T-368 (67th session, REPT-503).
 *
 * The unified "export the ENTIRE application's data and statistics" surface
 * the owner mandated: ONE workbook, ONE sheet per domain, plus a summary
 * sheet with the canonical computed indicators. Built OVER the existing
 * export engine (`buildXlsxBuffer` / `SheetSpec` — plan §14.03, the §6
 * reuse rule: no second Excel implementation), and fed by the SAME
 * repository streams the UI renders (RLS applies — the caller collects
 * what the current user may see).
 *
 * Sheets (in workbook order):
 *   1. Résumé        — counts + financial totals + calculated indicators
 *   2. Parents       — identity + children count + ledger balance
 *   3. Élèves        — identity + class + transport + status
 *   4. Personnel     — directory + hours + salary
 *   5. Paiements     — every payment (receipt, method, status, category)
 *   6. Tranches      — every installment (due/paid/pending, wave, status)
 *   7. Journal       — every ledger entry (the audit-friendly stream)
 *   8. Dépenses      — expense tickets lifecycle
 *   9. Notes         — assessments (grades per subject/term)
 *  10. Présences     — attendance records
 *  11. Créances      — debt summaries (aging)
 *  12. Classes       — class directory
 *  13. Services      — the pricing catalog (tuition/transport/registration/
 *                      additional/complementary services)
 *
 * The statistics on the Résumé sheet are computed from the SAME streams
 * (never re-derived from a second source): ledger totals follow the
 * data-export.ts conventions (charge + adjustment − payment), the
 * collection rate and installment coverage follow the dashboard KPI
 * definitions, debt follows DebtSummary. Nothing is invented — absent
 * data renders as 0 / "—".
 */
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";
import type { Personnel } from "../../domain/model/personnel";
import type { Payment, Installment, DebtSummary } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Expense } from "../../domain/model/expense";
import type { Assessment, Subject, AcademicClass, AttendanceRecord } from "../../domain/model/academic";
import type { PricingConfig } from "../../domain/model/pricing";
import { parentDisplayName } from "../../domain/model/parent";
import { studentDisplayName } from "../../domain/model/student";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  AGING_BUCKET_LABELS_FR,
} from "../../domain/model/payment";
import { LEVEL_LABELS_FR } from "../../domain/model/student";
import { STAFF_CATEGORY_LABELS_FR, PERSONNEL_STATUS_LABELS_FR } from "../../domain/model/personnel";
import { EXPENSE_CATEGORY_LABELS_FR, EXPENSE_STATUS_LABELS_FR, EXPENSE_URGENCY_LABELS_FR } from "../../domain/model/expense";
import { ATTENDANCE_STATUS_LABELS_FR } from "../../domain/model/academic";
import { buildXlsxBuffer, downloadBlob, type SheetSpec } from "./export-engine";

/* ------------------------------------------------------------------ */
/*  Input contract                                                     */
/* ------------------------------------------------------------------ */

export interface FullExportData {
  readonly parents: readonly Parent[];
  readonly students: readonly Student[];
  readonly personnel: readonly Personnel[];
  readonly payments: readonly Payment[];
  readonly installments: readonly Installment[];
  readonly ledger: readonly LedgerEntry[];
  readonly expenses: readonly Expense[];
  readonly assessments: readonly Assessment[];
  readonly subjects: readonly Subject[];
  readonly attendance: readonly AttendanceRecord[];
  readonly debtSummaries: readonly DebtSummary[];
  readonly classes: readonly AcademicClass[];
  readonly pricing: PricingConfig | null;
  readonly exportedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Shared lookup helpers                                              */
/* ------------------------------------------------------------------ */

const lbl = (map: Record<string, string>, key: string | null | undefined): string =>
  (key != null && map[key]) || "—";

const isoDate = (v: string | null | undefined): string => (v ? v.slice(0, 10) : "");

/* ------------------------------------------------------------------ */
/*  Sheet builders (pure — unit-testable without a download)           */
/* ------------------------------------------------------------------ */

function buildSummarySheet(data: FullExportData): SheetSpec {
  // T-368 (REPT-505): the CANONICAL ledger sign convention (balance.ts:71):
  // every entry contributes its SIGNED amount to the balance — charges are
  // positive, payments/refunds are negative credits, adjustments are ±.
  // Display totals for paid/refunded use absolute values (balance.ts:80/93).
  // The legacy data-export formula (`charged + adjusted − paid`) assumed
  // positive payments and inflated the outstanding on real data — fixed
  // here and in data-export.ts in the same change.
  const totalCharged = data.ledger.filter((e) => e.type === "charge").reduce((s, e) => s + e.amount, 0);
  const totalPaid = data.ledger.filter((e) => e.type === "payment").reduce((s, e) => s + Math.abs(e.amount), 0);
  const totalRefunded = data.ledger.filter((e) => e.type === "refund").reduce((s, e) => s + Math.abs(e.amount), 0);
  const totalAdjusted = data.ledger.filter((e) => e.type === "adjustment").reduce((s, e) => s + e.amount, 0);
  const outstanding = data.ledger.reduce((s, e) => s + e.amount, 0); // signed balance
  const billable = totalCharged + totalAdjusted;
  const collectionRate = billable > 0 ? (totalPaid / billable) * 100 : 0;

  const installmentsDue = data.installments.reduce((s, i) => s + i.amountDue, 0);
  const installmentsPaid = data.installments.reduce((s, i) => s + i.amountPaid, 0);
  const installmentCoverage = installmentsDue > 0 ? (installmentsPaid / installmentsDue) * 100 : 0;

  const debtOutstanding = data.debtSummaries.reduce((s, d) => s + d.outstandingAmount, 0);
  const debtors = data.debtSummaries.filter((d) => d.outstandingAmount > 0).length;

  const paidPayments = data.payments.filter((p) => p.status === "paid");
  const expensesDisbursed = data.expenses.reduce((s, e) => s + (e.finalSpentAmount ?? e.amount), 0);

  const attendanceTotal = data.attendance.length;
  const attendancePresent = data.attendance.filter((a) => a.status === "present").length;
  const attendanceRate = attendanceTotal > 0 ? (attendancePresent / attendanceTotal) * 100 : 0;

  const byCategory = new Map<string, number>();
  for (const e of data.ledger) {
    if (e.type === "charge") byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  }

  const rows: Array<Record<string, string | number>> = [
    { metric: "Date d'export", value: data.exportedAt },
    { metric: "Schéma", value: "el-imtiyaz-full-export/v1" },
    { metric: "— Comptages —", value: "" },
    { metric: "Parents", value: data.parents.length },
    { metric: "Élèves", value: data.students.length },
    { metric: "Personnel", value: data.personnel.length },
    { metric: "Classes", value: data.classes.length },
    { metric: "Paiements", value: data.payments.length },
    { metric: "Tranches (installments)", value: data.installments.length },
    { metric: "Entrées de journal", value: data.ledger.length },
    { metric: "Dépenses", value: data.expenses.length },
    { metric: "Évaluations (notes)", value: data.assessments.length },
    { metric: "Présences", value: data.attendance.length },
    { metric: "— Totaux financiers (DZD) —", value: "" },
    { metric: "Total facturé (charges)", value: totalCharged },
    { metric: "Total ajustements (remises/majorations, signé)", value: totalAdjusted },
    { metric: "Total encaissé (paiements journal)", value: totalPaid },
    { metric: "Total remboursements", value: totalRefunded },
    { metric: "Solde global en attente (journal)", value: outstanding },
    { metric: "— Indicateurs calculés —", value: "" },
    { metric: "Taux de recouvrement (%)", value: Number(collectionRate.toFixed(1)) },
    { metric: "Tranches: total dû", value: installmentsDue },
    { metric: "Tranches: total payé", value: installmentsPaid },
    { metric: "Tranches: couverture (%)", value: Number(installmentCoverage.toFixed(1)) },
    { metric: "Créances: total dû", value: debtOutstanding },
    { metric: "Créances: familles débitrices", value: debtors },
    { metric: "Paiements au statut 'payé'", value: paidPayments.length },
    { metric: "Dépenses: total engagé", value: expensesDisbursed },
    { metric: "Présences: taux de présence (%)", value: Number(attendanceRate.toFixed(1)) },
    { metric: "— Facturé par catégorie (DZD) —", value: "" },
    ...Array.from(byCategory.entries()).map(([cat, amount]) => ({
      metric: `Catégorie: ${lbl(PAYMENT_CATEGORY_LABELS_FR, cat)}`,
      value: amount,
    })),
  ];

  return {
    name: "Résumé",
    accentColor: "349BD4",
    columns: [
      { header: "Métrique", key: "metric", width: 42 },
      { header: "Valeur", key: "value", width: 40 },
    ],
    rows,
  };
}

function buildParentsSheet(data: FullExportData): SheetSpec {
  const studentCountByParent = new Map<string, number>();
  for (const s of data.students) {
    studentCountByParent.set(s.parentId, (studentCountByParent.get(s.parentId) ?? 0) + 1);
  }
  const balanceByParent = new Map<string, number>();
  for (const e of data.ledger) {
    balanceByParent.set(e.parentId, (balanceByParent.get(e.parentId) ?? 0) + e.amount);
  }
  return {
    name: "Parents",
    accentColor: "349BD4",
    columns: [
      { header: "Code", key: "code", width: 18 },
      { header: "Nom", key: "name", width: 30 },
      { header: "Téléphone", key: "phone", width: 18 },
      { header: "WhatsApp", key: "whatsapp", width: 18 },
      { header: "E-mail", key: "email", width: 30 },
      { header: "Nb enfants", key: "childCount", width: 12 },
      { header: "Solde journal (DZD)", key: "balance", width: 20 },
      { header: "Langue", key: "language", width: 10 },
      { header: "Destination transport", key: "transport", width: 24 },
      { header: "Créé le", key: "createdAt", width: 22 },
    ],
    rows: data.parents.map((p) => ({
      code: p.code,
      name: parentDisplayName(p),
      phone: p.phone,
      whatsapp: p.whatsapp ?? "",
      email: p.email ?? "",
      childCount: studentCountByParent.get(p.id) ?? 0,
      balance: balanceByParent.get(p.id) ?? 0,
      language: p.preferredLanguage,
      transport: p.transportDestination ?? "",
      createdAt: isoDate(p.createdAt),
    })),
  };
}

function buildStudentsSheet(data: FullExportData): SheetSpec {
  const parentById = new Map(data.parents.map((p) => [p.id, p]));
  const classById = new Map(data.classes.map((c) => [c.id, c]));
  return {
    name: "Élèves",
    accentColor: "2B7FB0",
    columns: [
      { header: "Code", key: "code", width: 18 },
      { header: "TUTEUR", key: "tuteur", width: 30 },
      { header: "Téléphone parent", key: "parentPhone", width: 18 },
      { header: "NOM", key: "lastName", width: 22 },
      { header: "Prénom", key: "firstName", width: 22 },
      { header: "Niveau", key: "level", width: 14 },
      { header: "Année", key: "gradeYear", width: 8 },
      { header: "Grade level", key: "gradeLevel", width: 14 },
      { header: "Classe", key: "className", width: 20 },
      { header: "Transport", key: "transportTier", width: 20 },
      { header: "Statut", key: "status", width: 12 },
      { header: "Inscrit le", key: "enrollmentDate", width: 14 },
    ],
    rows: data.students.map((s) => {
      const parent = parentById.get(s.parentId);
      return {
        code: s.code,
        tuteur: parent ? parentDisplayName(parent) : "",
        parentPhone: parent?.phone ?? "",
        lastName: s.lastName,
        firstName: s.firstName,
        level: lbl(LEVEL_LABELS_FR, s.level),
        gradeYear: s.gradeYear,
        gradeLevel: s.gradeLevel,
        className: classById.get(s.classId ?? "")?.name ?? "",
        transportTier: s.transportTier ?? "",
        status: s.status,
        enrollmentDate: isoDate(s.enrollmentDate),
      };
    }),
  };
}

function buildPersonnelSheet(data: FullExportData): SheetSpec {
  return {
    name: "Personnel",
    accentColor: "2B7FB0",
    columns: [
      { header: "Matricule", key: "id", width: 16 },
      { header: "Prénom", key: "firstName", width: 18 },
      { header: "Nom", key: "lastName", width: 20 },
      { header: "Catégorie", key: "category", width: 18 },
      { header: "Poste", key: "position", width: 26 },
      { header: "Téléphone", key: "phone", width: 18 },
      { header: "E-mail", key: "email", width: 28 },
      { header: "Embauche", key: "hireDate", width: 14 },
      { header: "Statut", key: "status", width: 12 },
      { header: "Heures hebdo. cibles", key: "hoursTarget", width: 14 },
      { header: "Heures hebdo. effectuées", key: "hoursLogged", width: 14 },
      { header: "Salaire (DZD)", key: "salary", width: 16 },
    ],
    rows: data.personnel.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      category: lbl(STAFF_CATEGORY_LABELS_FR, p.staffCategory),
      position: p.position ?? "—",
      phone: p.phone,
      email: p.email ?? "",
      hireDate: isoDate(p.hireDate),
      status: lbl(PERSONNEL_STATUS_LABELS_FR, p.status),
      hoursTarget: p.weeklyHoursTarget,
      hoursLogged: p.weeklyHoursLogged,
      salary: p.salary ?? 0,
    })),
  };
}

function buildPaymentsSheet(data: FullExportData): SheetSpec {
  const parentById = new Map(data.parents.map((p) => [p.id, p]));
  const studentById = new Map(data.students.map((s) => [s.id, s]));
  return {
    name: "Paiements",
    accentColor: "3FA66E",
    columns: [
      { header: "Reçu", key: "receipt", width: 22 },
      { header: "Date", key: "date", width: 14 },
      { header: "Parent", key: "parent", width: 30 },
      { header: "Élève", key: "student", width: 26 },
      { header: "Montant (DZD)", key: "amount", width: 16 },
      { header: "Méthode", key: "method", width: 16 },
      { header: "Statut", key: "status", width: 16 },
      { header: "Catégorie", key: "category", width: 20 },
      { header: "Encaissé par", key: "collectedBy", width: 22 },
      { header: "Notes", key: "notes", width: 40 },
    ],
    rows: [...data.payments]
      .sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1))
      .map((p) => ({
        receipt: p.receiptNumber,
        date: isoDate(p.collectedAt),
        parent: parentById.get(p.parentId) ? parentDisplayName(parentById.get(p.parentId)!) : p.parentId,
        student: p.studentId ? (studentById.get(p.studentId) ? studentDisplayName(studentById.get(p.studentId)!) : p.studentId) : "",
        amount: p.amount,
        method: lbl(PAYMENT_METHOD_LABELS_FR, p.method),
        status: lbl(PAYMENT_STATUS_LABELS_FR, p.status),
        category: lbl(PAYMENT_CATEGORY_LABELS_FR, p.category),
        collectedBy: p.collectedBy,
        notes: p.notes ?? "",
      })),
  };
}

function buildInstallmentsSheet(data: FullExportData): SheetSpec {
  const parentById = new Map(data.parents.map((p) => [p.id, p]));
  const studentById = new Map(data.students.map((s) => [s.id, s]));
  return {
    name: "Tranches",
    accentColor: "C8A98C",
    columns: [
      { header: "Parent", key: "parent", width: 30 },
      { header: "Élève", key: "student", width: 26 },
      { header: "Libellé", key: "label", width: 26 },
      { header: "Vague", key: "wave", width: 8 },
      { header: "Catégorie", key: "category", width: 20 },
      { header: "Dû (DZD)", key: "due", width: 14 },
      { header: "Payé (DZD)", key: "paid", width: 14 },
      { header: "En attente (DZD)", key: "pending", width: 16 },
      { header: "Échéance", key: "dueDate", width: 14 },
      { header: "Payé le", key: "paidDate", width: 14 },
      { header: "Statut", key: "status", width: 16 },
    ],
    rows: data.installments.map((i) => ({
      parent: parentById.get(i.parentId) ? parentDisplayName(parentById.get(i.parentId)!) : i.parentId,
      student: i.studentId ? (studentById.get(i.studentId) ? studentDisplayName(studentById.get(i.studentId)!) : i.studentId) : "",
      label: i.label,
      wave: i.trancheNumber ?? 1,
      category: lbl(PAYMENT_CATEGORY_LABELS_FR, i.category),
      due: i.amountDue,
      paid: i.amountPaid,
      pending: i.amountPending,
      dueDate: isoDate(i.dueDate),
      paidDate: isoDate(i.paidDate),
      status: lbl(PAYMENT_STATUS_LABELS_FR, i.status),
    })),
  };
}

function buildLedgerSheet(data: FullExportData): SheetSpec {
  const parentById = new Map(data.parents.map((p) => [p.id, p]));
  const studentById = new Map(data.students.map((s) => [s.id, s]));
  return {
    name: "Journal",
    accentColor: "C8A98C",
    columns: [
      { header: "ID", key: "id", width: 26 },
      { header: "Date", key: "at", width: 14 },
      { header: "Type", key: "type", width: 14 },
      { header: "Catégorie", key: "category", width: 20 },
      { header: "Parent", key: "parent", width: 30 },
      { header: "Élève", key: "student", width: 26 },
      { header: "Montant (DZD)", key: "amount", width: 16 },
      { header: "Source", key: "sourceType", width: 16 },
      { header: "Reçu", key: "receiptNumber", width: 22 },
      { header: "Description", key: "description", width: 60 },
      { header: "Acteur", key: "actorName", width: 22 },
    ],
    rows: [...data.ledger]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((e) => ({
        id: e.id,
        at: isoDate(e.at),
        type: e.type,
        category: lbl(PAYMENT_CATEGORY_LABELS_FR, e.category),
        parent: parentById.get(e.parentId) ? parentDisplayName(parentById.get(e.parentId)!) : e.parentId,
        student: e.studentId ? (studentById.get(e.studentId) ? studentDisplayName(studentById.get(e.studentId)!) : e.studentId) : "",
        amount: e.amount,
        sourceType: e.sourceType,
        receiptNumber: e.receiptNumber ?? "",
        description: e.description,
        actorName: e.actorName,
      })),
  };
}

function buildExpensesSheet(data: FullExportData): SheetSpec {
  return {
    name: "Dépenses",
    accentColor: "C0504D",
    columns: [
      { header: "Code demande", key: "requestCode", width: 18 },
      { header: "Titre", key: "title", width: 30 },
      { header: "Bénéficiaire", key: "payee", width: 26 },
      { header: "Catégorie", key: "category", width: 20 },
      { header: "Urgence", key: "urgency", width: 12 },
      { header: "Montant demandé (DZD)", key: "amount", width: 18 },
      { header: "Montant final (DZD)", key: "final", width: 18 },
      { header: "Statut", key: "status", width: 16 },
      { header: "Soumis par", key: "submittedBy", width: 22 },
      { header: "Soumis le", key: "submittedAt", width: 14 },
      { header: "Approuvé le", key: "approvedAt", width: 14 },
      { header: "Décaissé le", key: "disbursedAt", width: 14 },
    ],
    rows: [...data.expenses]
      .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
      .map((e) => ({
        requestCode: e.requestCode,
        title: e.title,
        payee: e.payee,
        category: lbl(EXPENSE_CATEGORY_LABELS_FR, e.category),
        urgency: lbl(EXPENSE_URGENCY_LABELS_FR, e.urgency),
        amount: e.amount,
        final: e.finalSpentAmount ?? e.amount,
        status: lbl(EXPENSE_STATUS_LABELS_FR, e.status),
        submittedBy: e.submittedBy,
        submittedAt: isoDate(e.submittedAt),
        approvedAt: isoDate(e.approvedAt),
        disbursedAt: isoDate(e.disbursedAt),
      })),
  };
}

function buildGradesSheet(data: FullExportData): SheetSpec {
  const studentById = new Map(data.students.map((s) => [s.id, s]));
  const subjectById = new Map(data.subjects.map((s) => [s.id, s]));
  return {
    name: "Notes",
    accentColor: "2B7FB0",
    columns: [
      { header: "Élève", key: "student", width: 28 },
      { header: "Code élève", key: "studentCode", width: 18 },
      { header: "Matière", key: "subject", width: 24 },
      { header: "Trimestre", key: "term", width: 10 },
      { header: "Année", key: "year", width: 12 },
      { header: "D1", key: "devoir1", width: 8 },
      { header: "D2", key: "devoir2", width: 8 },
      { header: "Examen", key: "examen", width: 8 },
      { header: "CC", key: "cc", width: 8 },
      { header: "Coef.", key: "coefficient", width: 8 },
      { header: "Moy. matière", key: "average", width: 12 },
    ],
    rows: data.assessments.map((a) => {
      const student = studentById.get(a.studentId);
      return {
        student: student ? studentDisplayName(student) : a.studentId,
        studentCode: student?.code ?? "",
        subject: subjectById.get(a.subjectId)?.name ?? a.subjectId,
        term: a.term,
        year: a.academicYear,
        devoir1: a.devoir1 ?? "",
        devoir2: a.devoir2 ?? "",
        examen: a.examen ?? "",
        cc: a.cc ?? "",
        coefficient: a.coefficient,
        average: a.subjectAverage ?? "",
      };
    }),
  };
}

function buildAttendanceSheet(data: FullExportData): SheetSpec {
  const studentById = new Map(data.students.map((s) => [s.id, s]));
  return {
    name: "Présences",
    accentColor: "2B7FB0",
    columns: [
      { header: "Élève", key: "student", width: 28 },
      { header: "Code élève", key: "studentCode", width: 18 },
      { header: "Classe", key: "classId", width: 20 },
      { header: "Date", key: "date", width: 14 },
      { header: "Séance", key: "session", width: 12 },
      { header: "Statut", key: "status", width: 20 },
      { header: "Heure arrivée", key: "arrival", width: 12 },
      { header: "Note", key: "note", width: 40 },
    ],
    rows: [...data.attendance]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((r) => {
        const student = studentById.get(r.studentId);
        return {
          student: student ? studentDisplayName(student) : r.studentId,
          studentCode: student?.code ?? "",
          classId: r.classId,
          date: isoDate(r.date),
          session: r.session,
          status: lbl(ATTENDANCE_STATUS_LABELS_FR, r.status),
          arrival: r.arrivalTime ?? "",
          note: r.note ?? "",
        };
      }),
  };
}

function buildDebtSheet(data: FullExportData): SheetSpec {
  const parentById = new Map(data.parents.map((p) => [p.id, p]));
  return {
    name: "Créances",
    accentColor: "C0504D",
    columns: [
      { header: "Code parent", key: "parentCode", width: 18 },
      { header: "Famille", key: "parentName", width: 30 },
      { header: "Téléphone", key: "parentPhone", width: 18 },
      { header: "Montant dû (DZD)", key: "outstanding", width: 18 },
      { header: "Jours de retard", key: "daysOverdue", width: 16 },
      { header: "Tranche d'âge", key: "bucket", width: 18 },
      { header: "Enfants", key: "studentCount", width: 10 },
    ],
    rows: data.debtSummaries
      .filter((d) => d.outstandingAmount > 0)
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
      .map((d) => ({
        parentCode: parentById.get(d.parentId)?.code ?? d.parentId,
        parentName: d.parentName,
        parentPhone: d.parentPhone,
        outstanding: d.outstandingAmount,
        daysOverdue: d.daysOverdue,
        bucket: lbl(AGING_BUCKET_LABELS_FR, d.bucket),
        studentCount: d.studentCount,
      })),
  };
}

function buildClassesSheet(data: FullExportData): SheetSpec {
  return {
    name: "Classes",
    accentColor: "349BD4",
    columns: [
      { header: "Code", key: "code", width: 18 },
      { header: "Nom", key: "name", width: 28 },
      { header: "Niveau", key: "level", width: 14 },
      { header: "Année", key: "gradeYear", width: 8 },
      { header: "Section", key: "section", width: 14 },
      { header: "Salle", key: "room", width: 12 },
      { header: "Capacité", key: "capacity", width: 10 },
      { header: "Inscrits", key: "enrolled", width: 10 },
      { header: "Prof. principal", key: "homeroom", width: 26 },
      { header: "Année scolaire", key: "year", width: 14 },
      { header: "Active", key: "isActive", width: 8 },
    ],
    rows: data.classes.map((c) => ({
      code: c.code,
      name: c.name,
      level: lbl(LEVEL_LABELS_FR, c.level),
      gradeYear: c.gradeYear,
      section: c.section,
      room: c.room ?? "",
      capacity: c.capacity ?? "",
      enrolled: c.enrolledCount,
      homeroom: c.homeroomTeacherName ?? "",
      year: c.academicYear,
      isActive: c.isActive ? "oui" : "non",
    })),
  };
}

function buildServicesSheet(data: FullExportData): SheetSpec {
  const rows: Array<Record<string, string | number>> = [];
  const pricing = data.pricing;
  if (pricing) {
    rows.push({ famille: "Frais d'inscription (FI)", libelle: "Tarif unique (legacy)", montant: pricing.registrationFee });
    for (const [grade, amount] of Object.entries(pricing.registrationFeeByGrade)) {
      rows.push({ famille: "Frais d'inscription (FI)", libelle: `Grade ${grade}`, montant: amount });
    }
    for (const [level, amount] of Object.entries(pricing.monthlyByLevel)) {
      rows.push({ famille: "Scolarité mensuelle", libelle: lbl(LEVEL_LABELS_FR, level), montant: amount ?? 0 });
    }
    for (const [grade, t] of Object.entries(pricing.tuitionByGradeLevel)) {
      rows.push({
        famille: "Scolarité annuelle",
        libelle: `Grade ${grade}`,
        montant: t.annualAmount ?? 0,
      });
    }
    for (const [dest, t] of Object.entries(pricing.transportByDestination)) {
      rows.push({
        famille: "Transport",
        libelle: dest,
        montant: t.annualAmount ?? 0,
      });
    }
    for (const s of pricing.additionalServices) {
      rows.push({ famille: "Service additionnel", libelle: s.label, montant: s.amount });
    }
    for (const s of pricing.complementaryServices) {
      rows.push({
        famille: "Service complémentaire",
        libelle: `${s.label} (semestriel ${s.semesterAmount} / annuel ${s.annualAmount})`,
        montant: s.annualAmount,
      });
    }
    for (const d of pricing.discounts) {
      rows.push({ famille: "Remise", libelle: d.label, montant: d.amount });
    }
  }
  return {
    name: "Services",
    accentColor: "349BD4",
    columns: [
      { header: "Famille", key: "famille", width: 28 },
      { header: "Libellé", key: "libelle", width: 34 },
      { header: "Montant (DZD)", key: "montant", width: 16 },
    ],
    rows,
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Build every sheet spec (pure — used by the tests + the workbook builder). */
export function buildFullExportSheets(data: FullExportData): SheetSpec[] {
  return [
    buildSummarySheet(data),
    buildParentsSheet(data),
    buildStudentsSheet(data),
    buildPersonnelSheet(data),
    buildPaymentsSheet(data),
    buildInstallmentsSheet(data),
    buildLedgerSheet(data),
    buildExpensesSheet(data),
    buildGradesSheet(data),
    buildAttendanceSheet(data),
    buildDebtSheet(data),
    buildClassesSheet(data),
    buildServicesSheet(data),
  ];
}

/** Build the full workbook bytes (callers decide whether to download). */
export async function buildFullWorkbook(data: FullExportData): Promise<Uint8Array> {
  return buildXlsxBuffer(buildFullExportSheets(data));
}

/**
 * Export the full workbook as a downloadable XLSX file. Returns the file
 * name used (timestamped so successive exports never overwrite).
 */
export async function exportFullWorkbook(
  data: FullExportData,
  fileName?: string,
): Promise<string> {
  const bytes = await buildFullWorkbook(data);
  const finalName =
    fileName ??
    `el-imtiyaz-export-complet-${data.exportedAt.replace(/[:.]/g, "-").slice(0, 19)}.xlsx`;
  downloadBlob(
    bytes,
    finalName,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  return finalName;
}
