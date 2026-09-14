/**
 * T-368 (67th session) — the full-application Excel export suite (REPT-503).
 *
 * Pins the unified export the owner mandated ("export the ENTIRE
 * application's data and statistics into Excel files"):
 *   - ONE workbook, one sheet per domain (13 sheets), in a stable order.
 *   - Every sheet's rows correspond 1:1 to the input streams (no silent
 *     drops, no synthesis) — the completeness contract.
 *   - The Résumé statistics are computed from the SAME streams (ledger
 *     totals, installment coverage, debt totals, attendance rate) and
 *     reconcile with hand-computed expectations.
 *   - The workbook bytes are a REAL xlsx (parsed back with ExcelJS) with
 *     the expected sheet names and row counts.
 */
import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import { buildFullExportSheets, buildFullWorkbook, type FullExportData } from "../../infrastructure/excel/full-export";
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";
import type { Personnel } from "../../domain/model/personnel";
import type { Payment, Installment, DebtSummary } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Expense } from "../../domain/model/expense";
import type { Assessment, Subject, AcademicClass, AttendanceRecord } from "../../domain/model/academic";
import type { PricingConfig } from "../../domain/model/pricing";

/* ============================================================ */
/*  Fixtures (domain-typed)                                      */
/* ============================================================ */

const BASE_ISO = "2026-09-10T10:00:00.000Z";

const parents: Parent[] = [
  {
    id: "par-001", tenantId: "ten-001", code: "PAR-2026-A4F9",
    firstName: "Mourad", lastName: "BENCHIKH", displayName: "BENCHIKH Mourad",
    gender: "male", phone: "+213 555 010 203", whatsapp: null, email: "b@example.dz",
    occupation: null, address: null, cityTier: null, transportDestination: null,
    preferredLanguage: "fr", avatarUrl: null, createdAt: BASE_ISO,
  } as unknown as Parent,
  {
    id: "par-002", tenantId: "ten-001", code: "PAR-2026-B7C2",
    firstName: "Nadia", lastName: "ALIOUAT", displayName: "ALIOUAT Nadia",
    gender: "female", phone: "+213 555 020 304", whatsapp: null, email: null,
    occupation: null, address: null, cityTier: null, transportDestination: "BOUMERDES",
    preferredLanguage: "ar", avatarUrl: null, createdAt: BASE_ISO,
  } as unknown as Parent,
];

const students: Student[] = [
  {
    id: "stu-001", tenantId: "ten-001", code: "ELV-2026-001234", parentId: "par-001",
    firstName: "Sara", lastName: "BENCHIKH", displayName: "BENCHIKH Sara",
    gender: "female", birthDate: "2014-03-12", enrollmentDate: "2026-09-01",
    level: "primaire", gradeYear: 3, gradeLevel: "3AP", classId: "cls-001",
    photoUrl: null, medicalNotes: null, transportTier: null, status: "active",
  } as unknown as Student,
  {
    id: "stu-002", tenantId: "ten-001", code: "ELV-2026-001235", parentId: "par-001",
    firstName: "Yanis", lastName: "BENCHIKH", displayName: "BENCHIKH Yanis",
    gender: "male", birthDate: "2011-06-02", enrollmentDate: "2026-09-01",
    level: "cem", gradeYear: 1, gradeLevel: "1AM", classId: "cls-002",
    photoUrl: null, medicalNotes: null, transportTier: "BOUMERDES", status: "active",
  } as unknown as Student,
  {
    id: "stu-003", tenantId: "ten-001", code: "ELV-2026-001236", parentId: "par-002",
    firstName: "Lina", lastName: "ALIOUAT", displayName: "ALIOUAT Lina",
    gender: "female", birthDate: "2015-11-20", enrollmentDate: "2026-09-02",
    level: "primaire", gradeYear: 2, gradeLevel: "2AP", classId: null,
    photoUrl: null, medicalNotes: null, transportTier: null, status: "active",
  } as unknown as Student,
];

const personnel: Personnel[] = [
  {
    id: "per-001", tenantId: "ten-001", userId: null, firstName: "Amina", lastName: "HAMIDI",
    staffCategory: "teacher", roleId: "teacher", departmentId: null, supervisorId: null,
    position: "Professeure", phone: "+213 555 040 506", email: "a@elimtiyaz.dz",
    address: null, hireDate: "2025-09-01", terminationDate: null, salary: 65_000,
    paymentMethod: null, bankAccount: null, weeklyHoursTarget: 36, weeklyHoursLogged: 34,
    avatarUrl: null, status: "active", bonuses: [], documents: [], notes: [], emergencyContact: null,
  } as unknown as Personnel,
];

const payments: Payment[] = [
  {
    id: "pay-001", tenantId: "ten-001", receiptNumber: "REC-2026-000001", parentId: "par-001",
    studentId: "stu-001", amount: 120_000, method: "cash", status: "paid", category: "tuition",
    installmentId: null, proofUrl: null, notes: null, collectedBy: "Comptoir",
    collectedAt: "2026-09-05T09:00:00.000Z", createdAt: BASE_ISO, updatedAt: BASE_ISO,
  } as unknown as Payment,
  {
    id: "pay-002", tenantId: "ten-001", receiptNumber: "REC-2026-000002", parentId: "par-002",
    studentId: "stu-003", amount: 35_000, method: "check", status: "pending", category: "transport",
    installmentId: null, proofUrl: null, notes: "Chèque à encaisser", collectedBy: "Comptoir",
    collectedAt: "2026-09-06T11:30:00.000Z", createdAt: BASE_ISO, updatedAt: BASE_ISO,
  } as unknown as Payment,
];

const installments: Installment[] = [
  {
    id: "ins-001", parentId: "par-001", studentId: "stu-001", category: "tuition",
    label: "Tranche 1", trancheNumber: 1, amountDue: 80_000, amountPaid: 80_000,
    amountPending: 0, dueDate: "2026-09-15", paidDate: "2026-09-05", status: "paid",
  } as unknown as Installment,
  {
    id: "ins-002", parentId: "par-001", studentId: "stu-001", category: "tuition",
    label: "Tranche 2", trancheNumber: 2, amountDue: 80_000, amountPaid: 40_000,
    amountPending: 0, dueDate: "2026-12-15", paidDate: null, status: "partial",
  } as unknown as Installment,
];

const ledger: LedgerEntry[] = [
  {
    id: "led-001", tenantId: "ten-001", type: "charge", category: "tuition",
    parentId: "par-001", studentId: "stu-001", amount: 240_000, sourceType: "bulk_import",
    sourceId: "src-1", receiptNumber: null, description: "Scolarité annuelle",
    actorName: "import", at: "2026-09-01T08:00:00.000Z", createdAt: BASE_ISO, updatedAt: BASE_ISO,
  } as unknown as LedgerEntry,
  {
    // T-368 (REPT-505): the DOMAIN convention — payments are NEGATIVE credits
    // (domain/calc/ledger/entries.ts:118 `amount: -input.amount`).
    id: "led-002", tenantId: "ten-001", type: "payment", category: "tuition",
    parentId: "par-001", studentId: "stu-001", amount: -120_000, sourceType: "counter",
    sourceId: "pay-001", receiptNumber: "REC-2026-000001", description: "Paiement comptoir",
    actorName: "staff", at: "2026-09-05T09:00:00.000Z", createdAt: BASE_ISO, updatedAt: BASE_ISO,
  } as unknown as LedgerEntry,
  {
    id: "led-003", tenantId: "ten-001", type: "adjustment", category: "tuition",
    parentId: "par-001", studentId: "stu-001", amount: -20_000, sourceType: "manual",
    sourceId: "adj-1", receiptNumber: null, description: "Remise fidélité",
    actorName: "staff", at: "2026-09-07T08:00:00.000Z", createdAt: BASE_ISO, updatedAt: BASE_ISO,
  } as unknown as LedgerEntry,
  {
    // A negative refund credit — exercises the abs() display total.
    id: "led-004", tenantId: "ten-001", type: "refund", category: "tuition",
    parentId: "par-002", studentId: "stu-003", amount: -5_000, sourceType: "manual",
    sourceId: "ref-1", receiptNumber: null, description: "Remboursement partiel",
    actorName: "staff", at: "2026-09-08T08:00:00.000Z", createdAt: BASE_ISO, updatedAt: BASE_ISO,
  } as unknown as LedgerEntry,
];

const expenses: Expense[] = [
  {
    id: "exp-001", tenantId: "ten-001", requestCode: "REQ-2026-001",
    title: "Manuels CE", description: "Achat manuels", amount: 45_000, category: "supplies",
    urgency: "medium", payee: "Librairie El-Kitab", status: "disbursed",
    submittedBy: "staff", submittedAt: "2026-09-02T10:00:00.000Z",
    approvedBy: "admin", approvedAt: "2026-09-03T10:00:00.000Z", approvalNote: "OK",
    disbursedBy: "admin", disbursedAt: "2026-09-04T10:00:00.000Z",
    proofUrl: null, proofUploadedBy: null, proofUploadedAt: null,
    finalSpentAmount: 43_500, anomalyScore: null, anomalyNote: null,
  } as unknown as Expense,
];

const subjects: Subject[] = [
  {
    id: "sub-001", tenantId: "ten-001", code: "MATH", name: "Mathématiques", nameAr: null,
    cycle: "primaire", level: "primaire", coefficient: 2, passingGrade: 10,
    isExtracurricular: false, isActive: true, teacherId: null,
  } as unknown as Subject,
];

const assessments: Assessment[] = [
  {
    id: "asm-001", studentId: "stu-001", classId: "cls-001", subjectId: "sub-001",
    term: "T1", academicYear: "2026/2027", devoir1: 14, devoir2: 12, examen: 15,
    cc: null, subjectAverage: 13.8, coefficient: 2,
    coefficientDevoir1: 1, coefficientDevoir2: 1, coefficientExamen: 2, coefficientCc: 0,
    enteredBy: "staff",
  } as unknown as Assessment,
];

const attendance: AttendanceRecord[] = [
  {
    id: "att-001", studentId: "stu-001", classId: "cls-001", date: "2026-09-08",
    session: "morning", status: "present", arrivalTime: null, note: null,
    recordedBy: "staff", recordedAt: BASE_ISO, syncedAt: null,
  } as unknown as AttendanceRecord,
  {
    id: "att-002", studentId: "stu-001", classId: "cls-001", date: "2026-09-09",
    session: "morning", status: "absent_unexcused", arrivalTime: null, note: null,
    recordedBy: "staff", recordedAt: BASE_ISO, syncedAt: null,
  } as unknown as AttendanceRecord,
];

const debtSummaries: DebtSummary[] = [
  {
    parentId: "par-001", parentName: "BENCHIKH Mourad", parentPhone: "+213 555 010 203",
    studentCount: 2, outstandingAmount: 100_000, daysOverdue: 12, bucket: "0_30",
  },
  {
    parentId: "par-002", parentName: "ALIOUAT Nadia", parentPhone: "+213 555 020 304",
    studentCount: 1, outstandingAmount: 35_000, daysOverdue: 55, bucket: "31_60",
  },
];

const classes: AcademicClass[] = [
  {
    id: "cls-001", tenantId: "ten-001", academicYearId: "ay-001", academicLevelId: "lvl-pri",
    code: "CLS-3AP-A", name: "3AP - A", gradeCode: "3AP", level: "primaire", gradeYear: 3,
    section: "A", room: "12", capacity: 30, enrolledCount: 28,
    homeroomTeacherId: null, homeroomTeacherName: "Mme HAMIDI", notes: null,
    academicYear: "2026/2027", isActive: true,
  } as unknown as AcademicClass,
];

const pricing: PricingConfig = {
  tuitionByGradeLevel: {
    "3AP": { annualAmount: 240_000, installments: [80_000, 80_000, 80_000] },
  },
  transportByDestination: {
    BOUMERDES: { annualAmount: 35_000, installments: [12_000, 12_000, 11_000] },
  },
  registrationFee: 3_000,
  registrationFeeByGrade: { "3AP": 3_000 },
  monthlyByLevel: { primaire: 20_000 },
  discounts: [],
  additionalServices: [{ id: "svc-1", tenantId: "ten-001", category: "additional", qualifier: "apron", label: "Tablier", amount: 2_500 }],
  complementaryServices: [],
  secondApronFee: 0,
} as unknown as PricingConfig;

const DATA: FullExportData = {
  parents, students, personnel, payments, installments, ledger, expenses,
  assessments, subjects, attendance, debtSummaries, classes, pricing,
  exportedAt: BASE_ISO,
};

/* ============================================================ */
/*  Tests                                                        */
/* ============================================================ */

describe("T-368 / REPT-503 — the full-application Excel export", () => {
  it("builds 13 sheets in the stable workbook order", () => {
    const sheets = buildFullExportSheets(DATA);
    expect(sheets.map((s) => s.name)).toEqual([
      "Résumé", "Parents", "Élèves", "Personnel", "Paiements", "Tranches",
      "Journal", "Dépenses", "Notes", "Présences", "Créances", "Classes", "Services",
    ]);
  });

  it("every domain sheet carries EXACTLY the input rows (1:1, no drops)", () => {
    const sheets = new Map(buildFullExportSheets(DATA).map((s) => [s.name, s]));
    expect(sheets.get("Parents")!.rows).toHaveLength(2);
    expect(sheets.get("Élèves")!.rows).toHaveLength(3);
    expect(sheets.get("Personnel")!.rows).toHaveLength(1);
    expect(sheets.get("Paiements")!.rows).toHaveLength(2);
    expect(sheets.get("Tranches")!.rows).toHaveLength(2);
    expect(sheets.get("Journal")!.rows).toHaveLength(4);
    expect(sheets.get("Dépenses")!.rows).toHaveLength(1);
    expect(sheets.get("Notes")!.rows).toHaveLength(1);
    expect(sheets.get("Présences")!.rows).toHaveLength(2);
    expect(sheets.get("Créances")!.rows).toHaveLength(2); // both have outstanding > 0
    expect(sheets.get("Classes")!.rows).toHaveLength(1);
  });

  it("the Résumé statistics reconcile with hand-computed totals (canonical sign convention)", () => {
    const summary = buildFullExportSheets(DATA)[0];
    const row = (metric: string) => summary.rows.find((r) => r.metric === metric)?.value;
    // T-368 (REPT-505): ledger = charge +240 000, payment −120 000,
    // adjustment −20 000 (par-001), refund −5 000 (par-002).
    // Signed balance = 240 − 120 − 20 − 5 = 95 000.
    expect(row("Total facturé (charges)")).toBe(240_000);
    expect(row("Total ajustements (remises/majorations, signé)")).toBe(-20_000);
    expect(row("Total encaissé (paiements journal)")).toBe(120_000); // abs display
    expect(row("Total remboursements")).toBe(5_000); // abs display
    expect(row("Solde global en attente (journal)")).toBe(95_000); // signed sum
    expect(row("Taux de recouvrement (%)")).toBe(54.5); // 120 000 / 220 000
    // installments: due 160 000, paid 120 000
    expect(row("Tranches: total dû")).toBe(160_000);
    expect(row("Tranches: total payé")).toBe(120_000);
    expect(row("Tranches: couverture (%)")).toBe(75);
    // debt: 135 000 across 2 families
    expect(row("Créances: total dû")).toBe(135_000);
    expect(row("Créances: familles débitrices")).toBe(2);
    // attendance: 1 present of 2
    expect(row("Présences: taux de présence (%)")).toBe(50);
    // expenses: finalSpentAmount wins over requested
    expect(row("Dépenses: total engagé")).toBe(43_500);
  });

  it("cross-domain joins resolve (payments carry parent/child display names)", () => {
    const sheets = new Map(buildFullExportSheets(DATA).map((s) => [s.name, s]));
    const payRows = sheets.get("Paiements")!.rows as Array<Record<string, string | number>>;
    const first = payRows.find((r) => r.receipt === "REC-2026-000001");
    expect(first?.parent).toBe("BENCHIKH Mourad");
    expect(first?.student).toBe("BENCHIKH Sara");
    // labels are French display forms, not raw enum keys
    expect(first?.method).toBe("Espèces");
    expect(first?.status).toBe("Payé");
  });

  it("the workbook bytes are a REAL xlsx ExcelJS can parse back", async () => {
    const bytes = await buildFullWorkbook(DATA);
    expect(bytes.length).toBeGreaterThan(4_000);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toContain("Résumé");
    expect(names).toContain("Créances");
    const summary = wb.worksheets.find((ws) => ws.name === "Résumé")!;
    // header row + the metric rows
    expect(summary.rowCount).toBe(buildFullExportSheets(DATA)[0].rows.length + 1);
    const studentsSheet = wb.worksheets.find((ws) => ws.name === "Élèves")!;
    expect(studentsSheet.rowCount).toBe(4); // header + 3
    // REPT-505 pin: the Journal sheet carries the SIGNED amounts verbatim
    // (4 entries) while the summary displays abs() totals — both
    // conventions reconciled in one workbook.
    const journal = wb.worksheets.find((ws) => ws.name === "Journal")!;
    expect(journal.rowCount).toBe(5); // header + 4 entries
  });
});

// Silence the unused-import lint for vi (reserved for future spy use).
void vi;
