/**
 * T-368 (67th session) — the PDF generation RED→GREEN suite (REPT-500/501/502).
 *
 * Documents the owner mandate: "every section where PDF generation exists
 * must produce correct results". The suite pins, per document type:
 *
 *   REPT-500 — WinAnsi safety: every generator must render REALISTIC data
 *     (amounts >= 1 000 DZD — formatDzdPlain emits U+202F grouping; Arabic-
 *     script names) without pdf-lib's Helvetica throwing
 *     "WinAnsi cannot encode". RED proof (probe, 2026-09-14):
 *     `new Intl.NumberFormat("fr-FR").format(175000)` = "175 000"
 *     (codepoints 31 37 35 202f 30 30 30) → drawText THROWS.
 *
 *   REPT-501 — completeness: long documents must paginate instead of
 *     silently truncating (the account statement's 25-row cap + y<100
 *     breaks; the bulletin's y<100 break).
 *
 *   REPT-502 — honest pagination: multi-page documents must carry a real
 *     "Page i/N" on every page (the old drawFooter hardcodes "Page 1/1").
 *
 * Verification ladder for this file: vitest (this suite) + the FULL repo
 * suite + tsc --noEmit + eslint (re-run after every change, incl. tests).
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generatePaymentReceiptPdf } from "../../infrastructure/receipt-pdf/payment-receipt";
import { generateAccountStatementPdf } from "../../infrastructure/receipt-pdf/account-statement";
import { generateBulletinPdf } from "../../infrastructure/receipt-pdf/bulletin";
import { generatePayslipPdf } from "../../infrastructure/receipt-pdf/payslip";
import { generateReportPdf, type ReportSpec } from "../../infrastructure/receipt-pdf/report-document";
import type { Payment, ParentFinancialProfile } from "../../domain/model/payment";
import type { Parent } from "../../domain/model/parent";
import type { Student, AcademicLevel } from "../../domain/model/student";
import type { Assessment, Subject, AcademicTerm } from "../../domain/model/academic";
import type { Personnel } from "../../domain/model/personnel";

/* ============================================================ */
/*  Fixtures (domain-typed per REG-007 — no `as unknown` casts)  */
/* ============================================================ */

const BASE_ISO = "2026-09-10T10:00:00.000Z";

function makeParent(overrides: Partial<Parent> = {}): Parent {
  return {
    id: "par-001",
    tenantId: "ten-001",
    code: "PAR-2026-A4F9",
    firstName: "Mourad",
    lastName: "BENCHIKH",
    displayName: "BENCHIKH Mourad",
    gender: "male",
    phone: "+213 555 010 203",
    whatsapp: null,
    email: "benchik@example.dz",
    occupation: null,
    address: null,
    cityTier: null,
    transportDestination: null,
    preferredLanguage: "fr",
    avatarUrl: null,
    ...overrides,
  } as Parent;
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "8f14e45f-ceea-4672-8eaf-000000000001",
    tenantId: "ten-001",
    receiptNumber: "REC-2026-000123",
    parentId: "par-001",
    studentId: null,
    amount: 45_000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "Comptoir staff",
    collectedAt: BASE_ISO,
    createdAt: BASE_ISO,
    updatedAt: BASE_ISO,
    ...overrides,
  };
}

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-001",
    tenantId: "ten-001",
    code: "ELV-2026-001234",
    parentId: "par-001",
    firstName: "Sara",
    lastName: "BENCHIKH",
    displayName: "BENCHIKH Sara",
    gender: "female",
    birthDate: "2014-03-12",
    enrollmentDate: "2026-09-01",
    level: "primaire" as AcademicLevel,
    gradeYear: 3,
    gradeLevel: "3AP" as Student["gradeLevel"],
    classId: "cls-001",
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    ...overrides,
  } as Student;
}

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: `asm-${Math.random().toString(36).slice(2, 10)}`,
    studentId: "stu-001",
    classId: "cls-001",
    subjectId: "sub-001",
    term: "T1" as AcademicTerm,
    academicYear: "2026/2027",
    devoir1: 14,
    devoir2: 12,
    examen: 15,
    cc: null,
    subjectAverage: 13.8,
    coefficient: 2,
    coefficientDevoir1: 1,
    coefficientDevoir2: 1,
    coefficientExamen: 2,
    coefficientCc: 0,
    enteredBy: "staff",
    ...overrides,
  } as Assessment;
}

function makeSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "sub-001",
    tenantId: "ten-001",
    code: "MATH",
    name: "Mathematiques",
    nameAr: null,
    cycle: "primaire",
    level: "primaire" as AcademicLevel,
    coefficient: 2,
    passingGrade: 10,
    isExtracurricular: false,
    isActive: true,
    teacherId: null,
    ...overrides,
  } as Subject;
}

function makePersonnel(overrides: Partial<Personnel> = {}): Personnel {
  return {
    id: "per-001",
    tenantId: "ten-001",
    userId: null,
    firstName: "Amina",
    lastName: "HAMIDI",
    staffCategory: "teacher",
    roleId: "teacher",
    departmentId: null,
    supervisorId: null,
    position: "Professeure de mathematiques",
    phone: "+213 555 040 506",
    email: "a.hamidi@elimtiyaz.dz",
    address: null,
    hireDate: "2025-09-01",
    terminationDate: null,
    salary: 65_000,
    paymentMethod: null,
    bankAccount: null,
    weeklyHoursTarget: 36,
    weeklyHoursLogged: 34,
    avatarUrl: null,
    status: "active",
    bonuses: [],
    documents: [],
    notes: [],
    emergencyContact: null,
    ...overrides,
  } as Personnel;
}

/** Load generated bytes back into pdf-lib — proves a structurally valid PDF. */
async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

/**
 * Extract the drawn text of every page (T-368 verification layer).
 *
 * pdf-lib writes text operators as hex strings (`<4D41524B…> Tj`) or
 * literal strings (`(Page 1/2) Tj`) inside Flate-compressed content
 * streams. This helper inflates each page's streams (Node zlib) and
 * decodes both string forms — giving the suite REAL text assertions
 * (row completeness, page labels, footnote markers) without an external
 * PDF parser.
 */
import zlib from "node:zlib";
import { PDFRawStream, PDFArray } from "pdf-lib";

function decodeDrawnStrings(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    const hex = m[1].replace(/\s+/g, "");
    let s = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      s += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
    }
    out.push(s);
  }
  for (const m of content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
    out.push(m[1].replace(/\\([()\\])/g, "$1"));
  }
  return out;
}

async function extractPageText(doc: PDFDocument): Promise<string[]> {
  const pages: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    let text = "";
    const collect = (obj: unknown) => {
      if (obj instanceof PDFRawStream) {
        const raw = obj.getContents();
        text += zlib.inflateSync(Buffer.from(raw)).toString("latin1");
      }
    };
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        collect(doc.context.lookup(contents.get(i)));
      }
    } else {
      collect(doc.context.lookup(contents));
    }
    pages.push(decodeDrawnStrings(text).join("\u000a"));
  }
  return pages;
}

/* ============================================================ */
/*  REPT-500 — WinAnsi safety on realistic amounts                */
/* ============================================================ */

describe("T-368 / REPT-500 — PDF generators survive realistic DZD amounts", () => {
  it("payment receipt renders a 45 000 DZD payment (U+202F grouping) without throwing", async () => {
    const payment = makePayment({ amount: 45_000 });
    const bytes = await generatePaymentReceiptPdf(payment, makeParent());
    const doc = await loadPdf(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(bytes.length).toBeGreaterThan(1_000);
  });

  it("payment receipt renders non-cash method-specific payments (check fields)", async () => {
    const payment = makePayment({
      amount: 120_000,
      method: "check",
      status: "pending",
      checkNumber: "CHQ-778899",
      checkBankName: "BNA — Agence Boumerdes",
      notes: "Chèque postdaté, encaissement fin de mois après autorisation de la direction.",
    });
    const bytes = await generatePaymentReceiptPdf(payment, makeParent());
    await loadPdf(bytes);
  });

  it("payment receipt renders Arabic-script parent names without throwing", async () => {
    const parent = makeParent({
      displayName: "بن شيخ مراد",
      firstName: "مراد",
      lastName: "بن شيخ",
    });
    const bytes = await generatePaymentReceiptPdf(makePayment({ amount: 9_500 }), parent);
    await loadPdf(bytes);
  });

  it("account statement renders paid/pending/refunded totals >= 1000 DZD without throwing", async () => {
    const payments = [
      makePayment({ amount: 210_000, status: "paid" }),
      makePayment({ amount: 95_000, status: "paid" }),
      makePayment({ amount: 15_000, status: "pending" }),
      makePayment({ amount: 7_500, status: "refunded" }),
    ];
    const bytes = await generateAccountStatementPdf(payments, makeParent());
    await loadPdf(bytes);
  });

  it("payslip renders a 65 000 DZD salary without throwing", async () => {
    const bytes = await generatePayslipPdf(makePersonnel({ salary: 65_000 }));
    await loadPdf(bytes);
  });

  it("bulletin renders accented French student identity without throwing", async () => {
    const bytes = await generateBulletinPdf({
      student: makeStudent({ firstName: "Éléonore", lastName: "MAÏZIÈRE" }),
      term: "T1",
      assessments: [makeAssessment()],
      gpa: 12.5,
      subjects: [makeSubject()],
      className: "3AP-A",
    });
    await loadPdf(bytes);
  });
});

/* ============================================================ */
/*  REPT-501 — completeness: no silent truncation                 */
/* ============================================================ */

describe("T-368 / REPT-501 — long PDFs paginate instead of truncating", () => {
  it("account statement with 60 payments renders MULTIPLE pages (the old cap was 25)", async () => {
    const payments = Array.from({ length: 60 }, (_, i) =>
      makePayment({
        amount: 5_000 + i * 100,
        receiptNumber: `REC-2026-${String(i + 1).padStart(6, "0")}`,
        collectedAt: new Date(Date.parse(BASE_ISO) - i * 86_400_000).toISOString(),
      }),
    );
    const bytes = await generateAccountStatementPdf(payments, makeParent());
    const doc = await loadPdf(bytes);
    // 60 rows × 16pt ≈ 960pt of table alone — cannot fit a single 841pt page.
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    // REPT-501 completeness pin: EVERY receipt number is drawn somewhere.
    const pages = await extractPageText(doc);
    const allText = pages.join("\u000a");
    for (const p of payments) {
      expect(allText).toContain(p.receiptNumber);
    }
    expect(allText).toContain("60 transaction(s)");
  });

  it("bulletin with 50 assessment rows renders MULTIPLE pages (the old y<100 break lost rows)", async () => {
    const subjects = Array.from({ length: 10 }, (_, i) =>
      makeSubject({ id: `sub-${i}`, name: `Matiere ${i + 1}`, code: `SUB${i}` }),
    );
    const assessments = Array.from({ length: 50 }, (_, i) =>
      makeAssessment({ subjectId: `sub-${i % 10}` }),
    );
    const bytes = await generateBulletinPdf({
      student: makeStudent(),
      term: "T1",
      assessments,
      gpa: 11.4,
      subjects,
      className: "3AP-A",
    });
    const doc = await loadPdf(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("report document renders its footnote even when tables fill pages", async () => {
    const spec: ReportSpec = {
      title: "RAPPORT DE VERIFICATION",
      meta: [["Periode", "2026/2027"]],
      sections: Array.from({ length: 3 }, (_, s) => ({
        heading: `Section ${s + 1}`,
        table: {
          columns: ["#", "Libelle", "Montant"],
          widths: [0.6, 3, 1.6],
          rows: Array.from({ length: 40 }, (_, i) => [
            String(s * 40 + i + 1),
            "Ligne de verification du moteur de restitution",
            "12 500",
          ]),
        },
      })),
      footnote: "FOOTNOTE-PRESENTE-MARQUEUR — document de travail interne.",
    };
    const bytes = await generateReportPdf(spec);
    const doc = await loadPdf(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    // REPT-501 completeness pin: the footnote text is actually DRAWN (the
    // old code silently dropped it when the tables filled the pages).
    const pages = await extractPageText(doc);
    expect(pages.join("\u000a")).toContain("FOOTNOTE-PRESENTE-MARQUEUR");
  });
});

/* ============================================================ */
/*  REPT-502 — honest page numbers                                */
/* ============================================================ */

describe("T-368 / REPT-502 — multi-page documents carry real page counts", () => {
  it("a multi-page statement no longer claims 'Page 1/1'", async () => {
    const payments = Array.from({ length: 40 }, (_, i) =>
      makePayment({ receiptNumber: `REC-2026-${String(i + 1).padStart(6, "0")}`, amount: 4_200 }),
    );
    const bytes = await generateAccountStatementPdf(payments, makeParent());
    const doc = await loadPdf(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    const pages = await extractPageText(doc);
    const total = doc.getPageCount();
    // REPT-502: every page carries the TRUE count — page 1 says 1/N, the
    // last page says N/N, and no page claims "Page 1/1" on a multi-page doc.
    pages.forEach((pageText, i) => {
      expect(pageText).toContain(`Page ${i + 1}/${total}`);
    });
    expect(pages.some((t) => t.includes("Page 1/1"))).toBe(false);
  });

  it("a single-page receipt still says 'Page 1/1'", async () => {
    const bytes = await generatePaymentReceiptPdf(makePayment(), makeParent());
    const doc = await loadPdf(bytes);
    expect(doc.getPageCount()).toBe(1);
    const pages = await extractPageText(doc);
    expect(pages[0]).toContain("Page 1/1");
  });
});

/* Type-only import guard (fixtures above reference these shapes). */
export type { ParentFinancialProfile };
