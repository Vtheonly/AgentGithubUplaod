/**
 * T-368 (67th session) — the global report PDF twins suite (REPT-504).
 *
 * Pins the Reports-tab PDF variants: each of the five global reports
 * renders a valid, multi-page-capable PDF over the SAME data the XLSX
 * exports consume, with WinAnsi-safe amounts (REPT-500 regression) and
 * drawn text assertions (title + a data row) via the content-stream
 * extraction helper introduced in t-368-pdf-generation.test.ts.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import zlib from "node:zlib";
import { PDFRawStream, PDFArray } from "pdf-lib";
import {
  generateRevenueReportPdf,
  generateOutstandingDebtReportPdf,
  generateStudentRosterPdf,
  generatePersonnelDirectoryPdf,
  generateExpensesByCategoryPdf,
} from "../../infrastructure/receipt-pdf/global-reports";
import type { Payment } from "../../domain/model/payment";
import type { Student } from "../../domain/model/student";
import type { Personnel } from "../../domain/model/personnel";
import type { Expense } from "../../domain/model/expense";

/* ---------------- shared extraction helper (same as t-368-pdf suite) --- */

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

async function extractText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    let text = "";
    const collect = (obj: unknown) => {
      if (obj instanceof PDFRawStream) {
        text += zlib.inflateSync(Buffer.from(obj.getContents())).toString("latin1");
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
  return pages.join("\u000a");
}

/* ---------------- fixtures ------------------------------------------- */

const BASE_ISO = "2026-09-10T10:00:00.000Z";

const payments: Payment[] = [
  {
    id: "pay-001", tenantId: "ten-001", receiptNumber: "REC-2026-000001", parentId: "par-001",
    studentId: null, amount: 120_000, method: "cash", status: "paid", category: "tuition",
    installmentId: null, proofUrl: null, notes: null, collectedBy: "Comptoir",
    collectedAt: BASE_ISO, createdAt: BASE_ISO, updatedAt: BASE_ISO,
  } as unknown as Payment,
  {
    id: "pay-002", tenantId: "ten-001", receiptNumber: "REC-2026-000002", parentId: "par-002",
    studentId: null, amount: 35_000, method: "check", status: "paid", category: "transport",
    installmentId: null, proofUrl: null, notes: null, collectedBy: "Comptoir",
    collectedAt: BASE_ISO, createdAt: BASE_ISO, updatedAt: BASE_ISO,
  } as unknown as Payment,
];

const students: Student[] = [
  {
    id: "stu-001", tenantId: "ten-001", code: "ELV-2026-001234", parentId: "par-001",
    firstName: "Sara", lastName: "BENCHIKH", displayName: null, gender: "female",
    birthDate: "2014-03-12", enrollmentDate: "2026-09-01", level: "primaire",
    gradeYear: 3, gradeLevel: "3AP", classId: null, photoUrl: null, medicalNotes: null,
    transportTier: null, status: "active",
  } as unknown as Student,
];

const personnel: Personnel[] = [
  {
    id: "per-001", tenantId: "ten-001", userId: null, firstName: "Amina", lastName: "HAMIDI",
    staffCategory: "teacher", roleId: "teacher", departmentId: null, supervisorId: null,
    position: "Professeure", phone: "+213 555 040 506", email: null, address: null,
    hireDate: "2025-09-01", terminationDate: null, salary: 65_000, paymentMethod: null,
    bankAccount: null, weeklyHoursTarget: 36, weeklyHoursLogged: 34, avatarUrl: null,
    status: "active", bonuses: [], documents: [], notes: [], emergencyContact: null,
  } as unknown as Personnel,
];

const expenses: Expense[] = [
  {
    id: "exp-001", tenantId: "ten-001", requestCode: "REQ-2026-001", title: "Manuels CE",
    description: "Achat", amount: 45_000, category: "supplies", urgency: "medium",
    payee: "Librairie El-Kitab", status: "disbursed", submittedBy: "staff",
    submittedAt: BASE_ISO, approvedBy: null, approvedAt: null, approvalNote: null,
    disbursedBy: null, disbursedAt: null, proofUrl: null, proofUploadedBy: null,
    proofUploadedAt: null, finalSpentAmount: 43_500, anomalyScore: null, anomalyNote: null,
  } as unknown as Expense,
];

/* ---------------- tests ----------------------------------------------- */

describe("T-368 / REPT-504 — the global report PDF twins", () => {
  it("revenue PDF renders realistic totals + the transaction rows", async () => {
    const bytes = await generateRevenueReportPdf(payments, { from: "2025-09-14", to: "2026-09-14" });
    const text = await extractText(bytes);
    expect(text).toContain("RAPPORT DE REVENUS");
    expect(text).toContain("REC-2026-000001");
    expect(text).toContain("REC-2026-000002");
    // WinAnsi-safe amount: "155 000" (regular space, no ? glyphs)
    expect(text).toContain("155 000");
    expect(text).not.toMatch(/\?000/);
  });

  it("debt PDF renders the aging buckets + debtor rows", async () => {
    const bytes = await generateOutstandingDebtReportPdf([
      {
        parentCode: "PAR-2026-A4F9", parentName: "BENCHIKH Mourad",
        parentPhone: "+213 555 010 203", bucket: "0_30", daysOverdue: 12,
        outstandingAmount: 100_000,
      },
    ]);
    const text = await extractText(bytes);
    expect(text).toContain("CREANCES PAR TRANCHE D'AGE");
    expect(text).toContain("BENCHIKH Mourad");
    expect(text).toContain("100 000");
  });

  it("roster PDF renders the level summary + the student row", async () => {
    const bytes = await generateStudentRosterPdf(students);
    const text = await extractText(bytes);
    expect(text).toContain("EFFECTIFS PAR NIVEAU");
    expect(text).toContain("ELV-2026-001234");
    expect(text).toContain("BENCHIKH");
  });

  it("personnel directory PDF renders the staff row", async () => {
    const bytes = await generatePersonnelDirectoryPdf(personnel);
    const text = await extractText(bytes);
    expect(text).toContain("ANNUAIRE DU PERSONNEL");
    expect(text).toContain("HAMIDI");
  });

  it("expenses PDF renders the category aggregate + the ticket (final amount wins)", async () => {
    const bytes = await generateExpensesByCategoryPdf(expenses);
    const text = await extractText(bytes);
    expect(text).toContain("DEPENSES PAR CATEGORIE");
    expect(text).toContain("Manuels CE");
    expect(text).toContain("43 500");
  });

  it("long revenue PDFs paginate with true page counts (REPT-501/502 inherit)", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...payments[0],
      receiptNumber: `REC-2026-${String(i + 1).padStart(6, "0")}`,
      amount: 5_000 + i * 10,
    } as Payment));
    const bytes = await generateRevenueReportPdf(many, { from: "2025-09-14", to: "2026-09-14" });
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const total = doc.getPageCount();
    expect(total).toBeGreaterThanOrEqual(2);
    const text = await extractText(bytes);
    // The TRUE count is stamped on every page (page 1 declares the total).
    expect(text).toContain(`Page 1/${total}`);
    expect(text).toContain(`Page ${total}/${total}`);
  });
});
