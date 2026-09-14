/**
 * T-368 LIVE E2E verification — the reporting/export system against the
 * REAL Supabase data (the owner's "make sure it works" leg).
 *
 * Read-only: SELECTs via the service-role key, then the ACTUAL generators
 * run over the real rows and write the artifacts to disk:
 *   1. The full-application workbook (13 sheets)  → .xlsx
 *   2. An account statement PDF for the busiest parent (pagination leg)
 *   3. The global revenue report PDF (the REPT-504 twin)
 *
 * Run: cd elimtiyaz-desktop && npx vite-node scripts/t-368-live-export-e2e.ts
 * (uses the project vite.config alias `@/`.)
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  buildFullWorkbook,
  type FullExportData,
} from "../src/infrastructure/excel/full-export";
import { generateAccountStatementPdf } from "../src/infrastructure/receipt-pdf/account-statement";
import { generateRevenueReportPdf } from "../src/infrastructure/receipt-pdf/global-reports";
import type { Payment, Installment, DebtSummary } from "../src/domain/model/payment";
import type { Parent } from "../src/domain/model/parent";
import type { Student } from "../src/domain/model/student";
import type { Personnel } from "../src/domain/model/personnel";
import type { LedgerEntry } from "../src/domain/model/ledger";
import type { Expense } from "../src/domain/model/expense";
import type { Assessment, Subject, AcademicClass, AttendanceRecord } from "../src/domain/model/academic";

const SUPABASE_URL = "https://hkvkefubghbbotgnteir.supabase.co";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTAwNDY4NCwiZXhwIjoyMTAwNTgwNjg0fQ.1CeNAMFfrIw4GQsTr3COLC5TO_uYtN1-oOmCrx1OuzM";

const OUT_DIR = "/home/z/my-project/download";

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function sel<T>(table: string, select: string, order?: string, pageSize = 1000): Promise<T[]> {
  // PostgREST caps responses at 1000 rows — page through .range() until exhausted.
  const out: T[] = [];
  let from = 0;
  for (let page = 0; page < 50; page++) {
    let q = supa.from(table).select(select).range(from, from + pageSize - 1);
    if (order) q = q.order(order);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Row → domain mappers (read-only, minimal fields the generators     */
/*  actually read; the canonical client mappers live in the repo).     */
/* ------------------------------------------------------------------ */

type ParentRow = {
  id: string; parent_code: string; first_name: string | null; last_name: string | null;
  display_name: string | null; primary_phone: string | null; secondary_phone: string | null;
  email: string | null; transport_destination: string | null;
  created_at: string;
};
const mapParent = (r: ParentRow): Parent =>
  ({
    id: r.id, tenantId: "live", code: r.parent_code,
    firstName: r.first_name ?? "", lastName: r.last_name ?? "",
    displayName: r.display_name, gender: "male", phone: r.primary_phone ?? "",
    whatsapp: r.secondary_phone, email: r.email, occupation: null, address: null,
    cityTier: null, transportDestination: (r.transport_destination as Parent["transportDestination"]) ?? null,
    preferredLanguage: "fr", avatarUrl: null,
    createdAt: r.created_at,
  }) as unknown as Parent;

type StudentRow = {
  id: string; student_code: string; parent_id: string; first_name: string; last_name: string;
  middle_name: string | null; display_name: string | null; gender: string | null; date_of_birth: string;
  enrollment_date: string; grade_level_code: string | null; class_id: string | null;
  transport_tier: string | null; enrollment_status: string;
};
const mapStudent = (r: StudentRow): Student =>
  ({
    id: r.id, tenantId: "live", code: r.student_code, parentId: r.parent_id,
    firstName: r.first_name, middleName: r.middle_name, lastName: r.last_name,
    displayName: r.display_name, gender: (r.gender ?? "other") as Student["gender"],
    birthDate: r.date_of_birth, enrollmentDate: r.enrollment_date,
    level: "primaire" as Student["level"], gradeYear: 1,
    gradeLevel: (r.grade_level_code ?? "1ap") as Student["gradeLevel"],
    classId: r.class_id, photoUrl: null, medicalNotes: null,
    transportTier: r.transport_tier, status: r.enrollment_status,
  }) as unknown as Student;

type PaymentRow = {
  id: string; payment_number: string; parent_id: string; student_id: string | null;
  amount: number; method: string; status: string; category: string;
  notes: string | null; collected_by: string | null; collected_at: string;
  proof_path: string | null; created_at: string; updated_at: string;
};
const mapPayment = (r: PaymentRow): Payment =>
  ({
    id: r.id, tenantId: "live", receiptNumber: r.payment_number, parentId: r.parent_id,
    studentId: r.student_id, amount: Number(r.amount), method: r.method, status: r.status,
    category: r.category, installmentId: null, proofUrl: r.proof_path, notes: r.notes,
    collectedBy: r.collected_by ?? "system", collectedAt: r.collected_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }) as unknown as Payment;

type InstallmentRow = {
  id: string; parent_id: string; student_id: string | null; category?: string | null;
  label?: string | null; tranche_number: number | null; amount_due: number; amount_paid: number;
  amount_pending?: number | null; due_date: string; paid_date: string | null; status: string;
};
const mapInstallment = (r: InstallmentRow): Installment =>
  ({
    id: r.id, parentId: r.parent_id, studentId: r.student_id,
    category: (r.category ?? "tuition") as Installment["category"],
    label: r.label ?? `Tranche ${r.tranche_number ?? 1}`,
    trancheNumber: (r.tranche_number ?? 1) as 1 | 2 | 3,
    amountDue: Number(r.amount_due ?? 0), amountPaid: Number(r.amount_paid ?? 0),
    amountPending: Number(r.amount_pending ?? 0), dueDate: r.due_date ?? new Date().toISOString(),
    paidDate: r.paid_date, status: (r.status ?? "unpaid") as Installment["status"],
  }) as unknown as Installment;

type LedgerRow = {
  id: string; parent_id: string; student_id: string | null; entry_type: string;
  amount: number; category: string; description: string | null; entry_date: string;
  entry_number: string; receipt_number: string | null; actor_name: string | null;
};
const mapLedger = (r: LedgerRow): LedgerEntry =>
  ({
    id: r.id, tenantId: "live", parentId: r.parent_id, studentId: r.student_id,
    type: r.entry_type, category: r.category, amount: Number(r.amount),
    sourceType: "live", sourceId: r.entry_number, receiptNumber: r.receipt_number,
    description: r.description ?? "", actorName: r.actor_name ?? "",
    at: r.entry_date, createdAt: r.entry_date, updatedAt: r.entry_date,
  }) as unknown as LedgerEntry;

type ExpenseRow = {
  id: string; request_code: string; title: string; payee: string | null;
  category: string; urgency: string; amount: number; final_spent_amount: number | null;
  status: string; submitted_by: string; submitted_at: string; approved_at: string | null;
  disbursed_at: string | null;
};
const mapExpense = (r: ExpenseRow): Expense =>
  ({
    id: r.id, tenantId: "live", requestCode: r.request_code, title: r.title,
    description: "", amount: Number(r.amount), category: r.category, urgency: r.urgency,
    payee: r.payee ?? "", status: r.status, submittedBy: r.submitted_by,
    submittedAt: r.submitted_at, approvedBy: null, approvedAt: r.approved_at,
    approvalNote: null, disbursedBy: null, disbursedAt: r.disbursed_at,
    proofUrl: null, proofUploadedBy: null, proofUploadedAt: null,
    finalSpentAmount: r.final_spent_amount != null ? Number(r.final_spent_amount) : null,
    anomalyScore: null, anomalyNote: null,
  }) as unknown as Expense;

type PersonnelRow = {
  id: string; first_name: string; last_name: string; staff_category: string;
  position: string | null; phone: string; email: string | null; hire_date: string;
  status: string; weekly_hours_target: number; weekly_hours_logged: number; salary: number | null;
};
const mapPersonnel = (r: PersonnelRow): Personnel =>
  ({
    id: r.id, tenantId: "live", userId: null, firstName: r.first_name, lastName: r.last_name,
    staffCategory: r.staff_category, roleId: "staff", departmentId: null, supervisorId: null,
    position: r.position ?? "", phone: r.phone, email: r.email, address: null,
    hireDate: r.hire_date, terminationDate: null, salary: r.salary != null ? Number(r.salary) : null,
    paymentMethod: null, bankAccount: null, weeklyHoursTarget: r.weekly_hours_target ?? 0,
    weeklyHoursLogged: r.weekly_hours_logged ?? 0, avatarUrl: null, status: r.status,
    bonuses: [], documents: [], notes: [], emergencyContact: null,
  }) as unknown as Personnel;

type AssessmentRow = {
  id: string; student_id: string; class_id: string | null; subject_id: string; term: string;
  academic_year: string; devoir1: number | null; devoir2: number | null; examen: number | null;
  cc: number | null; subject_average: number | null; coefficient: number;
};
const mapAssessment = (r: AssessmentRow): Assessment =>
  ({
    id: r.id, studentId: r.student_id, classId: r.class_id ?? "", subjectId: r.subject_id,
    term: r.term, academicYear: r.academic_year, devoir1: r.devoir1, devoir2: r.devoir2,
    examen: r.examen, cc: r.cc, subjectAverage: r.subject_average,
    coefficient: r.coefficient, coefficientDevoir1: 1, coefficientDevoir2: 1,
    coefficientExamen: 2, coefficientCc: 0, enteredBy: "live",
  }) as unknown as Assessment;

type SubjectRow = { id: string; code: string; name: string; level: string; coefficient: number };
const mapSubject = (r: SubjectRow): Subject =>
  ({
    id: r.id, tenantId: "live", code: r.code, name: r.name, nameAr: null,
    cycle: r.level, level: r.level as Subject["level"], coefficient: r.coefficient,
    passingGrade: 10, isExtracurricular: false, isActive: true, teacherId: null,
  }) as unknown as Subject;

type AttendanceRow = {
  id: string; student_id: string; class_id: string; date: string; session: string;
  status: string; arrival_time: string | null; note: string | null; recorded_at: string;
};
const mapAttendance = (r: AttendanceRow): AttendanceRecord =>
  ({
    id: r.id, studentId: r.student_id, classId: r.class_id, date: r.date,
    session: r.session as AttendanceRecord["session"], status: r.status as AttendanceRecord["status"],
    arrivalTime: r.arrival_time, note: r.note, recordedBy: "live", recordedAt: r.recorded_at,
    syncedAt: null,
  }) as unknown as AttendanceRecord;

type ClassRow = {
  id: string; code: string; name: string; level: string; grade_year: number;
  section: string; room: string | null; capacity: number | null; enrolled_count: number;
  homeroom_teacher_name: string | null; academic_year: string; is_active: boolean;
};
const mapClass = (r: ClassRow): AcademicClass =>
  ({
    id: r.id, tenantId: "live", academicYearId: "", academicLevelId: "", code: r.code,
    name: r.name, gradeCode: "N/A" as AcademicClass["gradeCode"], level: r.level as AcademicClass["level"],
    gradeYear: r.grade_year, section: r.section, room: r.room, capacity: r.capacity,
    enrolledCount: r.enrolled_count, homeroomTeacherId: null,
    homeroomTeacherName: r.homeroom_teacher_name, notes: null,
    academicYear: r.academic_year, isActive: r.is_active,
  }) as unknown as AcademicClass;

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("=== T-368 LIVE E2E — reading the REAL data ===");
  const [parentRows, studentRows, paymentRows, installmentRows, ledgerRows, expenseRows,
    personnelRows, assessmentRows, subjectRows, attendanceRows, classRows] = await Promise.all([
    sel<ParentRow>("parents", "*"),
    sel<StudentRow>("students", "*"),
    sel<PaymentRow>("payments", "*", "collected_at"),
    sel<InstallmentRow>("installments", "*"),
    sel<LedgerRow>("ledger_entries", "id, parent_id, student_id, entry_type, amount, category, description, entry_date, entry_number, receipt_number", "entry_date"),
    sel<ExpenseRow>("expense_tickets", "*"),
    sel<PersonnelRow>("personnel", "*"),
    sel<AssessmentRow>("assessments", "*"),
    sel<SubjectRow>("subjects", "*"),
    sel<AttendanceRow>("attendance_records", "*"),
    sel<ClassRow>("classes", "*"),
  ]);

  const parents = parentRows.map(mapParent);
  const students = studentRows.map(mapStudent);
  const payments = paymentRows.map(mapPayment);
  const installments = installmentRows.map(mapInstallment);
  const ledger = ledgerRows.map(mapLedger);
  const expenses = expenseRows.map(mapExpense);
  const personnel = personnelRows.map(mapPersonnel);
  const assessments = assessmentRows.map(mapAssessment);
  const subjects = subjectRows.map(mapSubject);
  const attendance = attendanceRows.map(mapAttendance);
  const classes = classRows.map(mapClass);

  // Debt summaries from the canonical ledger (signed sums + oldest open charge age)
  const byParent = new Map<string, { sum: number; oldest: number | null; name: string; phone: string; kids: Set<string> }>();
  for (const e of ledger) {
    const cur = byParent.get(e.parentId) ?? { sum: 0, oldest: null, name: "", phone: "", kids: new Set<string>() };
    cur.sum += e.amount;
    if (e.studentId) cur.kids.add(e.studentId);
    byParent.set(e.parentId, cur);
  }
  for (const p of parents) {
    const cur = byParent.get(p.id);
    if (cur) { cur.name = `${p.lastName} ${p.firstName}`.trim(); cur.phone = p.phone; }
  }
  for (const s of students) {
    const cur = byParent.get(s.parentId);
    if (cur) cur.kids.add(s.id);
  }
  const debtSummaries: DebtSummary[] = Array.from(byParent.entries())
    .filter(([, v]) => v.sum < 0)
    .map(([parentId, v]) => ({
      parentId,
      parentName: v.name || parentId,
      parentPhone: v.phone,
      studentCount: v.kids.size,
      outstandingAmount: Math.abs(v.sum),
      daysOverdue: 0,
      bucket: "0_30" as DebtSummary["bucket"],
    }));

  console.log("LIVE census:", {
    parents: parents.length, students: students.length, payments: payments.length,
    installments: installments.length, ledger: ledger.length, expenses: expenses.length,
    personnel: personnel.length, assessments: assessments.length, subjects: subjects.length,
    attendance: attendance.length, classes: classes.length, debtors: debtSummaries.length,
  });

  /* 1. The full workbook over the REAL data */
  const data: FullExportData = {
    parents, students, personnel, payments, installments, ledger, expenses,
    assessments, subjects, attendance, debtSummaries, classes, pricing: null,
    exportedAt: new Date().toISOString(),
  };
  const xlsxBytes = await buildFullWorkbook(data);
  const xlsxPath = `${OUT_DIR}/t368-live-export-complet.xlsx`;
  writeFileSync(xlsxPath, xlsxBytes);
  console.log("OK  full workbook:", xlsxPath, `${(xlsxBytes.length / 1024).toFixed(1)} KiB`);

  /* 2. Account statement for the busiest parent (pagination leg) */
  const countByParent = new Map<string, number>();
  for (const p of payments) countByParent.set(p.parentId, (countByParent.get(p.parentId) ?? 0) + 1);
  const busiest = Array.from(countByParent.entries()).sort((a, b) => b[1] - a[1])[0];
  if (busiest) {
    const parent = parents.find((p) => p.id === busiest[0]);
    const parentPayments = payments.filter((p) => p.parentId === busiest[0]);
    if (parent) {
      const pdfBytes = await generateAccountStatementPdf(parentPayments, parent);
      const pdfPath = `${OUT_DIR}/t368-live-releve-${parent.code}.pdf`;
      writeFileSync(pdfPath, pdfBytes);
      const doc = await PDFDocument.load(pdfBytes);
      console.log("OK  account statement:", pdfPath, `${parentPayments.length} payments → ${doc.getPageCount()} page(s)`);
    }
  }

  /* 3. The global revenue PDF twin over the REAL payments */
  const revBytes = await generateRevenueReportPdf(payments, { from: "2025-01-01", to: "2026-12-31" });
  const revPath = `${OUT_DIR}/t368-live-revenu.pdf`;
  writeFileSync(revPath, revBytes);
  const revDoc = await PDFDocument.load(revBytes);
  console.log("OK  revenue report:", revPath, `${payments.length} payments → ${revDoc.getPageCount()} page(s)`);

  /* 4. A payment receipt for the largest real payment (the REPT-500 leg) */
  const { generatePaymentReceiptPdf } = await import("../src/infrastructure/receipt-pdf/payment-receipt");
  const largest = [...payments].sort((a, b) => b.amount - a.amount)[0];
  if (largest) {
    const parent = parents.find((p) => p.id === largest.parentId) ?? null;
    const recBytes = await generatePaymentReceiptPdf(largest, parent);
    const recPath = `${OUT_DIR}/t368-live-recu-${largest.receiptNumber}.pdf`;
    writeFileSync(recPath, recBytes);
    const recDoc = await PDFDocument.load(recBytes);
    console.log("OK  payment receipt:", recPath, `${largest.amount} DZD → ${recDoc.getPageCount()} page(s)`);
  }

  console.log("=== T-368 LIVE E2E COMPLETE — all generators ran on the real data ===");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
