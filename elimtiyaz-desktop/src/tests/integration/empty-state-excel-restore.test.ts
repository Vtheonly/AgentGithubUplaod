/**
 * IMPORT-106 — Empty-state Excel restore verification (T-365).
 *
 * The owner's exact scenario: the desktop database is COMPLETELY EMPTY (no
 * seeds, no prior data). Import the REAL `Suivis clients  2026_2027.xlsx`
 * and verify the import is a COMPLETE, CORRECT, ATOMIC, IDEMPOTENT restore:
 *
 *   - no missing records: every ETAT row with a NOM becomes a student;
 *     every unique NEM becomes exactly one parent;
 *   - no incorrect calculations: for EVERY one of the 390 rows the imported
 *     charges / payments / balance are cross-checked against the workbook's
 *     OWN cell values (read directly via exceljs, independently of the
 *     import pipeline); the aggregate totals reconcile EXACTLY;
 *   - no broken relationships: every FK (student→parent, payment→student,
 *     installment→student, ledger→student) resolves;
 *   - no partial imports: a mid-import flush failure rolls the database
 *     back to EMPTY (compensating rollback);
 *   - re-import safety (IMPORT-107/108/109 regressions): importing the same
 *     file a second time is a complete NO-OP in BOTH repository layers.
 *
 * Two layers:
 *   A — the pipeline contract (fast in-memory stubs): the ImportEngine +
 *       RepositoryStorageAdapter logic, per-row Excel cross-checks.
 *   B — the REAL mock repositories over a CLEARED shared store (the exact
 *       mock-mode desktop path — delay-mocked for speed): the mock layer's
 *       own restore + re-import no-op.
 *
 * The numbers are computed dynamically from the workbook so the suite stays
 * accurate as the file evolves; the 2026-09-14 constants are ALSO pinned as
 * regression anchors (a workbook replacement would trip them loudly).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import ExcelJS from "exceljs";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import { computeParentSummary } from "../../domain/calc/ledger/balance";
import type {
  ParentRepository, StudentRepository, LedgerRepository, PaymentRepository,
  InstallmentRepository, Observable, ImportInstallmentInput,
} from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type { Student, CreateStudentInput, UpdateStudentInput, BatchRegistrationInput, BatchRegistrationResult, GradeLevel } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Payment, Installment, CollectPaymentInput, PaymentCategory } from "../../domain/model/payment";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";
import { createChargeEntry, createPaymentEntry } from "../../domain/calc/ledger/entries";

// Mock-mode speed: the shared mock repositories have 120–400ms artificial
// delays per call (a 390-row import would take ~25 minutes). Layer B clears
// the shared store and runs the REAL repository classes with instant delays.
vi.mock("../../infrastructure/mock/repositories/mock-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infrastructure/mock/repositories/mock-store")>();
  return { ...actual, delay: async () => { /* instant — test speed */ } };
});

const REPO_ROOT = path.resolve(__dirname, "../../..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "Suivis clients  2026_2027.xlsx"), // double space — real file
  path.join(REPO_ROOT, "..", "Suivis clients  2026_2027.xlsx"),
  // T-417 (2026-09-27): the repo keeps the workbook under Excel/ — the
  // same candidates the real-excel-import suite uses. Without them these
  // suites silently SKIP on a fresh clone (their 13 pinned-census tests
  // contributed nothing to the suite's green state).
  path.join(REPO_ROOT, "Excel", "Suivis clients  2026_2027.xlsx"),
  path.join(REPO_ROOT, "..", "Excel", "Suivis clients  2026_2027.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p));
const describeOrSkip = XLSX_PATH ? describe : describe.skip;
const TEST_TIMEOUT_MS = 120_000;

// ── Pinned regression anchors (2026-09-14 workbook census) ──────────────────
const PINNED = {
  students: 390,
  parents: 253,
  ledgerEntries: 1283,
  payments: 891,
  installments: 1968,
  installmentsTuition: 1560,
  installmentsTransport: 408,
  paymentsTotal: 55_227_100, // == Excel Σ TOTAL VERSEMENTS
  installmentsDueTotal: 113_518_800, // == Excel C3 Σ(devis + dettes − remboursement)
  chargesTotal: 113_518_800, // == Excel Σ(devis + dettes)
  etatRows: 390,
};

// ── Excel ground truth (read directly, independent of the pipeline) ─────────

interface EtatRow {
  rowIndex: number;
  nem: string;
  nom: string;
  devis: number;
  remise: number;
  remboursement: number;
  dettes: number;
  reglementsDettes: number;
  totalVersements: number;
  totalCreance: number;
  fi: number; v2: number; v2Alt: number; v3: number;
  t1: number; t2: number; t3: number;
  psy1: number; psy2: number; orth1: number; orth2: number;
  eplant: number; ratrapage: number;
  septembre: number; decembre: number; mars: number;
  distination: string;
}

function excelNum(v: ExcelJS.CellValue): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object") {
    if ("result" in (v as object)) return excelNum((v as { result?: ExcelJS.CellValue }).result);
    if ("richText" in (v as object)) {
      return excelNum((v as { richText: { text: string }[] }).richText.map((t) => t.text).join(""));
    }
  }
  return 0;
}

function excelStr(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    if ("result" in (v as object)) return excelStr((v as { result?: ExcelJS.CellValue }).result);
    if ("richText" in (v as object)) {
      return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("").trim();
    }
  }
  return "";
}

async function readWorkbookRows(): Promise<EtatRow[]> {
  const wb = new ExcelJS.Workbook();
  const buf = fs.readFileSync(XLSX_PATH!);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((s) => /^ETAT/i.test(s.name));
  if (!ws) throw new Error("ETAT sheet not found in workbook");
  const rows: EtatRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nom = excelStr(row.getCell(6).value);
    if (!nom) continue; // the importer requires NOM — rows without it are not data rows
    rows.push({
      rowIndex: r,
      nem: excelStr(row.getCell(4).value),
      nom,
      devis: excelNum(row.getCell(12).value),
      remise: excelNum(row.getCell(10).value),
      remboursement: excelNum(row.getCell(13).value),
      dettes: excelNum(row.getCell(14).value),
      reglementsDettes: excelNum(row.getCell(15).value),
      totalVersements: excelNum(row.getCell(16).value),
      totalCreance: excelNum(row.getCell(17).value),
      fi: excelNum(row.getCell(18).value),
      v2: excelNum(row.getCell(19).value),
      v2Alt: excelNum(row.getCell(20).value),
      v3: excelNum(row.getCell(21).value),
      t1: excelNum(row.getCell(23).value),
      t2: excelNum(row.getCell(24).value),
      t3: excelNum(row.getCell(25).value),
      psy1: excelNum(row.getCell(26).value),
      psy2: excelNum(row.getCell(27).value),
      orth1: excelNum(row.getCell(28).value),
      orth2: excelNum(row.getCell(29).value),
      eplant: excelNum(row.getCell(30).value),
      ratrapage: excelNum(row.getCell(31).value),
      septembre: excelNum(row.getCell(32).value),
      decembre: excelNum(row.getCell(34).value),
      mars: excelNum(row.getCell(36).value),
      distination: excelStr(row.getCell(22).value),
    });
  }
  return rows;
}

/** Excel's own phone normalization (mirrors rules/phone.ts normalizePhone). */
function expectedParentPhone(nem: string): string {
  const firstPart = nem.split(/[/,]/)[0]?.trim() ?? "";
  if (firstPart === "") return "(inconnu)";
  if (/^\d+(\.\d+)?$/.test(firstPart) && !firstPart.startsWith("0") && firstPart.length >= 9) {
    return `0${firstPart.split(".")[0]}`;
  }
  return firstPart.replace(/[\s.]/g, "");
}

function paymentColumnsOf(r: EtatRow): number {
  return (
    r.fi + r.v2 + r.v2Alt + r.v3 + r.t1 + r.t2 + r.t3 +
    r.psy1 + r.psy2 + r.orth1 + r.orth2 + r.eplant + r.ratrapage +
    r.septembre + r.decembre + r.mars + r.reglementsDettes
  );
}

// ── Layer A: fast stubs + shared state ───────────────────────────────────────

let engineA: ImportEngine;
let parentsA: FastParentRepo;
let studentsA: FastStudentRepo;
let ledgerA: FastLedgerRepo;
let paymentsA: FastPaymentRepo;
let installmentsA: FastInstallmentRepo;
let excelRows: EtatRow[] = [];
let importStatsA: { rowsImported: number; rowsUpdated: number; rowsSkipped: number; rowsRejected: number };

describeOrSkip("IMPORT-106 Layer A — empty-state restore through the import pipeline (fast stubs)", () => {
  beforeAll(async () => {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    excelRows = await readWorkbookRows();
    parentsA = new FastParentRepo();
    studentsA = new FastStudentRepo();
    ledgerA = new FastLedgerRepo();
    paymentsA = new FastPaymentRepo();
    installmentsA = new FastInstallmentRepo();
    engineA = new ImportEngine({
      storage: new RepositoryStorageAdapter({
        parents: parentsA,
        students: studentsA,
        ledger: ledgerA,
        payments: paymentsA,
        installments: installmentsA,
        tenantId: "test-tenant",
        actorId: "test-actor",
        actorName: "Restore Verifier",
      }),
      auditSink: { async logAction() { /* no-op */ } },
    });
    // THE CLEAN, EMPTY DESKTOP STATE — every repository starts empty.
    const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH));
    const ctx = await engineA.importFile(bytes, XLSX_PATH, { dryRun: false });
    importStatsA = ctx.stats;
  }, TEST_TIMEOUT_MS);

  it("restores EVERY client record — one student per NOM row, no duplicate parents, none rejected", () => {
    expect(excelRows.length).toBe(PINNED.etatRows);
    expect(studentsA.rows.size).toBe(PINNED.students);
    // Parent dedup invariant: every real phone maps to AT MOST one parent
    // (blank-NEM families become per-family-name placeholder parents with
    // the "(inconnu)" phone — the adapter's documented identity strategy).
    const parentsList = [...parentsA.rows.values()];
    const realPhones = parentsList.filter((p) => p.phone !== "(inconnu)").map((p) => p.phone);
    expect(new Set(realPhones).size).toBe(realPhones.length);
    expect(realPhones.length).toBeGreaterThan(200); // the corpus is phone-dominated
    expect(parentsList.length).toBe(PINNED.parents);
    // Every ETAT row either imported or updated — none rejected.
    expect(importStatsA.rowsRejected).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("restores every row's financials EXACTLY — charges, payments, balance vs the workbook's own cells", () => {
    const studentRows = [...studentsA.rows.values()];
    const problems: string[] = [];
    for (const er of excelRows) {
      // Match by (normalized primary NEM, displayName) — names collide
      // across families (two "SIDI MAMER SAMYI" rows with different NEMs).
      const phone = expectedParentPhone(er.nem);
      const student = studentRows.find((s) => {
        if (s.displayName !== er.nom) return false;
        const parent = parentsA.rows.get(s.parentId);
        return parent?.phone === phone;
      });
      if (!student) {
        problems.push(`row ${er.rowIndex}: student "${er.nom}" (${phone}) not restored`);
        continue;
      }
      const le = ledgerA.rows.filter((e) => e.studentId === student.id);
      const charges = le.filter((e) => e.type === "charge").reduce((s, e) => s + e.amount, 0);
      const paymentCredits = le.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
      const adjustments = le.filter((e) => e.type === "adjustment").reduce((s, e) => s + e.amount, 0);

      const expCharges = er.devis + er.dettes;
      const expPayments = paymentColumnsOf(er);
      const expBalance = expCharges - er.remboursement - expPayments;
      // Ledger convention: charges positive, payments negative (credits).
      const importedBalance = charges + adjustments + paymentCredits;

      if (charges !== expCharges) {
        problems.push(`row ${er.rowIndex} "${er.nom}": charges ${charges} != devis+dettes ${expCharges}`);
      }
      if (paymentCredits !== -expPayments) {
        problems.push(`row ${er.rowIndex} "${er.nom}": payments ${paymentCredits} != ${-expPayments}`);
      }
      if (importedBalance !== expBalance) {
        problems.push(`row ${er.rowIndex} "${er.nom}": balance ${importedBalance} != ${expBalance}`);
      }
    }
    expect(problems, problems.slice(0, 20).join("\n")).toEqual([]);
  }, TEST_TIMEOUT_MS);

  it("restores the aggregate totals EXACTLY (payments, installments C3, charges, ledger mirror)", () => {
    const paymentsTotal = [...paymentsA.rows.values()].reduce((s, p) => s + p.amount, 0);
    const ledgerPaymentTotal = ledgerA.rows.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    const ledgerChargeTotal = ledgerA.rows.filter((e) => e.type === "charge").reduce((s, e) => s + e.amount, 0);
    const installmentDueTotal = [...installmentsA.rows.values()].reduce((s, i) => s + i.amountDue, 0);
    const installmentPaidTotal = [...installmentsA.rows.values()].reduce((s, i) => s + i.amountPaid, 0);

    // Dynamic vs the workbook…
    const excelPayments = excelRows.reduce((s, r) => s + paymentColumnsOf(r), 0);
    const excelP = excelRows.reduce((s, r) => s + r.totalVersements, 0);
    const excelC3 = excelRows.reduce((s, r) => s + r.devis + r.dettes - r.remboursement, 0);
    const excelCharges = excelRows.reduce((s, r) => s + r.devis + r.dettes, 0);

    expect(paymentsTotal).toBe(excelPayments);
    expect(paymentsTotal).toBe(excelP); // the workbook's own TOTAL VERSEMENTS column
    expect(ledgerPaymentTotal).toBe(-excelPayments);
    expect(ledgerChargeTotal).toBe(excelCharges);
    expect(installmentDueTotal).toBe(excelC3);
    expect(installmentPaidTotal).toBe(excelPayments);

    // …AND pinned as regression anchors (workbook replacement trips these).
    expect(paymentsTotal).toBe(PINNED.paymentsTotal);
    expect(installmentDueTotal).toBe(PINNED.installmentsDueTotal);
    expect(ledgerChargeTotal).toBe(PINNED.chargesTotal);
    expect(paymentsA.rows.size).toBe(PINNED.payments);
    expect(ledgerA.rows.length).toBe(PINNED.ledgerEntries);
    expect(installmentsA.rows.size).toBe(PINNED.installments);
  }, TEST_TIMEOUT_MS);

  it("preserves every relationship — no broken FK anywhere", () => {
    const parentIds = new Set(parentsA.rows.keys());
    const studentIds = new Set(studentsA.rows.keys());
    for (const s of studentsA.rows.values()) {
      expect(s.parentId, `student ${s.code} parentId`).toBeTruthy();
      expect(parentIds.has(s.parentId), `student ${s.code} → parent ${s.parentId}`).toBe(true);
    }
    for (const p of paymentsA.rows.values()) {
      if (p.studentId) expect(studentIds.has(p.studentId), `payment ${p.id} → student`).toBe(true);
      expect(parentIds.has(p.parentId), `payment ${p.id} → parent`).toBe(true);
    }
    for (const i of installmentsA.rows.values()) {
      if (i.studentId) expect(studentIds.has(i.studentId), `installment ${i.id} → student`).toBe(true);
      expect(parentIds.has(i.parentId), `installment ${i.id} → parent`).toBe(true);
    }
    for (const e of ledgerA.rows) {
      if (e.studentId) expect(studentIds.has(e.studentId), `ledger ${e.id} → student`).toBe(true);
      expect(parentIds.has(e.parentId), `ledger ${e.id} → parent`).toBe(true);
    }
    // Families with multiple children are preserved (shared NEM → one parent).
    const childrenPerParent = new Map<string, number>();
    for (const s of studentsA.rows.values()) {
      childrenPerParent.set(s.parentId, (childrenPerParent.get(s.parentId) ?? 0) + 1);
    }
    expect(Array.from(childrenPerParent.values()).filter((n) => n > 1).length).toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  it("restores the BON 4-tranche schedule per student (C3 per student + the ZIREG LEA reference)", () => {
    const installmentRows = [...installmentsA.rows.values()];
    const byStudent = new Map<string, Installment[]>();
    for (const i of installmentRows) {
      const key = i.studentId ?? "";
      byStudent.set(key, [...(byStudent.get(key) ?? []), i]);
    }
    const studentRows = [...studentsA.rows.values()];
    const problems: string[] = [];
    for (const er of excelRows) {
      const phone = expectedParentPhone(er.nem);
      const student = studentRows.find((s) => {
        if (s.displayName !== er.nom) return false;
        const parent = parentsA.rows.get(s.parentId);
        return parent?.phone === phone;
      });
      if (!student) continue;
      const inst = byStudent.get(student.id) ?? [];
      const due = inst.reduce((s, i) => s + i.amountDue, 0);
      const expDue = er.devis + er.dettes - er.remboursement;
      if (due !== expDue) {
        problems.push(`row ${er.rowIndex} "${er.nom}": Σ installment due ${due} != ${expDue}`);
      }
      for (const i of inst) {
        if (i.amountDue < 0) problems.push(`row ${er.rowIndex}: negative amountDue on ${i.id}`);
      }
    }
    expect(problems, problems.slice(0, 10).join("\n")).toEqual([]);

    // The pinned reference case: ZIREG LEA — FI 25 000 + 3 × 71 500 = 239 500
    // (the BON 4-payment structure, no reconciliation residual).
    const zireg = studentRows.find((s) => s.displayName === "ZIREG LEA");
    expect(zireg).toBeTruthy();
    const ziregInst = (byStudent.get(zireg!.id) ?? []).filter((i) => i.category === "tuition");
    expect(ziregInst).toHaveLength(4);
    expect(ziregInst.reduce((s, i) => s + i.amountDue, 0)).toBe(239_500);

    // Category census (pinned).
    const tuition = installmentRows.filter((i) => i.category === "tuition").length;
    const transport = installmentRows.filter((i) => i.category === "transport").length;
    expect(tuition).toBe(PINNED.installmentsTuition);
    expect(transport).toBe(PINNED.installmentsTransport);
  }, TEST_TIMEOUT_MS);

  it("feeds the canonical statistics EXACTLY — computeParentSummary aggregates over the imported ledger", () => {
    // The dashboard debt summaries derive from computeParentSummary over the
    // FULL ledger stream (DASH-401). The imported data must reproduce the
    // workbook's own aggregates through that exact derivation.
    let totalCharged = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    for (const p of parentsA.rows.values()) {
      const summary = computeParentSummary(ledgerA.rows, p.id, p.displayName ?? "");
      totalCharged += summary.totalCharged;
      totalPaid += summary.totalPaid;
      totalOutstanding += summary.totalOutstanding;
    }
    const excelCharges = excelRows.reduce((s, r) => s + r.devis + r.dettes, 0);
    const excelPayments = excelRows.reduce((s, r) => s + paymentColumnsOf(r), 0);
    const excelOutstanding = excelRows.reduce(
      (s, r) => s + r.devis + r.dettes - r.remboursement - paymentColumnsOf(r), 0);
    expect(Math.round(totalCharged)).toBe(excelCharges);
    expect(Math.round(totalPaid)).toBe(excelPayments);
    expect(Math.round(totalOutstanding)).toBe(excelOutstanding);
    // Pinned anchors.
    expect(excelCharges).toBe(PINNED.chargesTotal);
    expect(excelPayments).toBe(PINNED.paymentsTotal);
  }, TEST_TIMEOUT_MS);

  it("re-imports the same file as a COMPLETE NO-OP (IMPORT-107/108/109 regression)", async () => {
    const before = {
      students: studentsA.rows.size,
      parents: parentsA.rows.size,
      payments: paymentsA.rows.size,
      installments: installmentsA.rows.size,
      ledger: ledgerA.rows.length,
      paymentsTotal: [...paymentsA.rows.values()].reduce((s, p) => s + p.amount, 0),
      installmentDue: [...installmentsA.rows.values()].reduce((s, i) => s + i.amountDue, 0),
    };
    const engine2 = new ImportEngine({
      storage: new RepositoryStorageAdapter({
        parents: parentsA,
        students: studentsA,
        ledger: ledgerA,
        payments: paymentsA,
        installments: installmentsA,
        tenantId: "test-tenant",
        actorId: "test-actor",
        actorName: "Restore Verifier",
      }),
      auditSink: { async logAction() { /* no-op */ } },
    });
    const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH!));
    const ctx = await engine2.importFile(bytes, XLSX_PATH!, { dryRun: false });
    // Every ETAT row is an UPDATE (none imported as new students).
    expect(ctx.stats.rowsUpdated).toBe(PINNED.etatRows);
    // Nothing moved anywhere.
    expect(studentsA.rows.size).toBe(before.students);
    expect(parentsA.rows.size).toBe(before.parents);
    expect(paymentsA.rows.size).toBe(before.payments);
    expect(installmentsA.rows.size).toBe(before.installments);
    expect(ledgerA.rows.length).toBe(before.ledger);
    expect([...paymentsA.rows.values()].reduce((s, p) => s + p.amount, 0)).toBe(before.paymentsTotal);
    expect([...installmentsA.rows.values()].reduce((s, i) => s + i.amountDue, 0)).toBe(before.installmentDue);
  }, TEST_TIMEOUT_MS);

  it("classifies the auxiliary sheets correctly — Devis/BON are print layouts, not lost client data", () => {
    // The Devis + BON sheets are VLOOKUP-driven receipt PRINT VIEWS (their
    // per-client financial content is already carried by the ETAT columns:
    // DEVIS ANNUEL + the payment columns + the BON 4-tranche structure).
    // Their identity-less layout rows are counted as skipped — this pins
    // that NO ETAT client row is ever in that bucket.
    const skippedIsEtat = false; // the sheet stats prove the split:
    void skippedIsEtat;
    const totalSkipped = importStatsA.rowsSkipped;
    // Devis 188 + BON 14 = 202 skipped layout rows.
    //
    // T-417 (2026-09-27): this anchor was re-pinned 201 → 202 after a
    // drift investigation. The suite had been SILENTLY SKIPPING on fresh
    // clones (its workbook candidates missed the Excel/ location), so the
    // 2026-09-14 anchor (Devis 187) was never re-checked after the T-414
    // sheet-detection rework; un-skipping the suite (the Excel/ candidates
    // above) tripped the anchor loudly. Evidence that the drift is
    // classification-only and PRE-EXISTING at HEAD (not caused by the
    // T-417 batch importer): stash-verified — the ORIGINAL sequential
    // importer at HEAD produces the IDENTICAL stats (620 read / 418
    // imported / 202 skipped / 0 rejected), and every IMPORTED census
    // anchor is unchanged (390 students / 253 parents / 1283 ledger /
    // 891 payments / 1968 installments / Σ totals). One additional Devis
    // print-layout row (187 → 188) is now iterated and identity-skipped.
    expect(totalSkipped).toBe(202);
    // And every ETAT row was imported (390 imported of 620 total rows read,
    // 418 = 390 ETAT + 2 BON + 26 REF tracked rows).
    expect(importStatsA.rowsImported).toBe(418);
  }, TEST_TIMEOUT_MS);

  it("rolls back to EMPTY on a mid-import flush failure — no partial import (atomicity)", async () => {
    // A ledger whose appendMany throws at flush time: the import must fail
    // AND the compensating rollback must delete every created parent +
    // student, returning the database to the COMPLETELY EMPTY state.
    const parents = new FastParentRepo();
    const students = new FastStudentRepo();
    const failingLedger = new ThrowingLedgerRepo();
    const adapter = new RepositoryStorageAdapter({
      parents,
      students,
      ledger: failingLedger,
      payments: new FastPaymentRepo(),
      installments: new FastInstallmentRepo(),
      tenantId: "test-tenant",
      actorId: "test-actor",
      actorName: "Atomicity Probe",
    });
    const engine = new ImportEngine({
      storage: adapter,
      auditSink: { async logAction() { /* no-op */ } },
    });
    const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH!));
    await expect(engine.importFile(bytes, XLSX_PATH!, { dryRun: false })).rejects.toThrow();
    // The database is COMPLETELY EMPTY again — no partial import residue.
    expect(parents.rows.size).toBe(0);
    expect(students.rows.size).toBe(0);
    expect(failingLedger.rows.length).toBe(0);
  }, TEST_TIMEOUT_MS);
});

// ── Layer B: the REAL mock repositories over a CLEARED store ─────────────────

describeOrSkip("IMPORT-106 Layer B — empty-state restore through the REAL mock repositories (the mock-mode desktop path)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStoreMod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockReposMod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLedgerMod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockParentMod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStudentMod: any;

  function buildEngine(): ImportEngine {
    return new ImportEngine({
      storage: new RepositoryStorageAdapter({
        parents: mockParentMod.mockParentRepository,
        students: mockStudentMod.mockStudentRepository,
        ledger: mockLedgerMod.mockLedgerRepository,
        payments: mockReposMod.mockPaymentRepository,
        installments: mockReposMod.mockInstallmentRepository,
        tenantId: "test-tenant",
        actorId: "test-actor",
        actorName: "Restore Verifier",
      }),
      auditSink: { async logAction() { /* no-op */ } },
    });
  }

  beforeAll(async () => {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    mockStoreMod = await import("../../infrastructure/mock/repositories/mock-store");
    mockReposMod = await import("../../infrastructure/mock/repositories/financial-repository");
    mockLedgerMod = await import("../../infrastructure/mock/repositories/ledger-repository");
    mockParentMod = await import("../../infrastructure/mock/repositories/parent-repository");
    mockStudentMod = await import("../../infrastructure/mock/repositories/student-repository");

    // THE COMPLETELY EMPTY DESKTOP DATABASE (mock mode): every CRM +
    // financial collection of the shared store is cleared.
    const s = mockStoreMod.store;
    s.parents = [];
    s.students = [];
    s.payments = [];
    s.installments = [];
    s.ledger = [];
    s.audit = [];
    s.notifyParents();
    s.notifyStudents();
    s.notifyPayments();
    s.notifyInstallments();
    s.notifyLedger();

    const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH));
    const ctx = await buildEngine().importFile(bytes, XLSX_PATH, { dryRun: false });
    expect(ctx.stats.rowsRejected).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("restores the full corpus through the real repository classes (counts + totals EXACT)", () => {
    const s = mockStoreMod.store;
    expect(s.students.length).toBe(PINNED.students);
    expect(s.parents.length).toBe(PINNED.parents);
    expect(s.payments.length).toBe(PINNED.payments);
    expect(s.installments.length).toBe(PINNED.installments);
    expect(s.ledger.length).toBe(PINNED.ledgerEntries);
    expect(s.payments.reduce((sum: number, p: Payment) => sum + p.amount, 0)).toBe(PINNED.paymentsTotal);
    expect(s.installments.reduce((sum: number, i: Installment) => sum + i.amountDue, 0)).toBe(PINNED.installmentsDueTotal);
    expect(s.installments.reduce((sum: number, i: Installment) => sum + i.amountPaid, 0)).toBe(PINNED.paymentsTotal);
  }, TEST_TIMEOUT_MS);

  it("does NOT double-book: every ledger entry is bulk_import, every payment carries its deterministic IMP- receipt", () => {
    const s = mockStoreMod.store;
    // IMPORT-108 regression: the generic collect() fallback used to add a
    // SECOND "payment"-source ledger entry per imported payment and run the
    // waterfall a second time.
    expect(s.ledger.filter((e: LedgerEntry) => e.sourceType === "payment")).toHaveLength(0);
    expect(s.ledger.every((e: LedgerEntry) => e.sourceType === "bulk_import")).toBe(true);
    // IMPORT-108: the deterministic receipts are honoured (no auto REC-…).
    expect(s.payments.every((p: Payment) => p.receiptNumber.startsWith("IMP-"))).toBe(true);
    // The store is the desktop's mock-mode DB — its canonical aggregates:
    const charges = s.ledger.filter((e: LedgerEntry) => e.type === "charge")
      .reduce((sum: number, e: LedgerEntry) => sum + e.amount, 0);
    expect(charges).toBe(PINNED.chargesTotal);
  }, TEST_TIMEOUT_MS);

  it("feeds the dashboard's canonical debt summary EXACTLY from the restored store", () => {
    const s = mockStoreMod.store;
    let totalCharged = 0;
    let totalPaid = 0;
    for (const p of s.parents as Parent[]) {
      const summary = computeParentSummary(s.ledger as LedgerEntry[], p.id, p.displayName ?? "");
      totalCharged += summary.totalCharged;
      totalPaid += summary.totalPaid;
    }
    expect(Math.round(totalCharged)).toBe(PINNED.chargesTotal);
    expect(Math.round(totalPaid)).toBe(PINNED.paymentsTotal);
  }, TEST_TIMEOUT_MS);

  it("re-imports as a COMPLETE NO-OP through the real repositories (IMPORT-107/108/109)", async () => {
    const s = mockStoreMod.store;
    const before = {
      students: s.students.length,
      parents: s.parents.length,
      payments: s.payments.length,
      installments: s.installments.length,
      ledger: s.ledger.length,
    };
    const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH!));
    const ctx = await buildEngine().importFile(bytes, XLSX_PATH!, { dryRun: false });
    expect(ctx.stats.rowsUpdated).toBe(PINNED.etatRows);
    expect(s.students.length).toBe(before.students);
    expect(s.parents.length).toBe(before.parents);
    expect(s.payments.length).toBe(before.payments);
    expect(s.installments.length).toBe(before.installments);
    expect(s.ledger.length).toBe(before.ledger);
  }, TEST_TIMEOUT_MS);
});

// ── Fast in-memory stub repositories ─────────────────────────────────────────

class FastParentRepo implements ParentRepository {
  readonly rows = new Map<string, Parent>();
  private readonly cache = new SubjectBehavior<Parent[]>([]);
  observe(): Observable<Parent[]> { return this.cache; }
  observeById(id: string): Observable<Parent | null> {
    return new SubjectBehavior<Parent | null>(this.rows.get(id) ?? null);
  }
  async search(query: string): Promise<Result<Parent[]>> {
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows.values()]);
    return Ok([...this.rows.values()].filter((p) =>
      `${p.firstName} ${p.lastName} ${p.displayName ?? ""} ${p.phone} ${p.code}`.toLowerCase().includes(q)
    ));
  }
  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    const id = `par-${String(this.rows.size + 1).padStart(3, "0")}`;
    const now = new Date().toISOString();
    const parent: Parent = {
      id, tenantId: "test-tenant",
      code: `PAR-2026-${id.slice(-4)}`,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null,
      gender: input.gender, phone: input.phone,
      whatsapp: input.whatsapp ?? null, email: input.email ?? null,
      occupation: input.occupation ?? null, address: input.address ?? null,
      cityTier: input.cityTier ?? null,
      transportDestination: input.transportDestination ?? null,
      preferredLanguage: input.preferredLanguage ?? "fr",
      avatarUrl: null, createdAt: now, updatedAt: now,
    };
    this.rows.set(id, parent);
    this.cache.set([...this.rows.values()]);
    return Ok(parent);
  }
  async updateParent(id: string, updates: UpdateParentInput): Promise<Result<Parent>> {
    const existing = this.rows.get(id);
    if (!existing) return Err(Errors.notFound("Parent", id));
    const updated = { ...existing, ...updates } as Parent;
    this.rows.set(id, updated);
    this.cache.set([...this.rows.values()]);
    return Ok(updated);
  }
  async deleteParent(id: string): Promise<Result<void>> {
    this.rows.delete(id);
    this.cache.set([...this.rows.values()]);
    return Ok(undefined);
  }
}

class FastStudentRepo implements StudentRepository {
  readonly rows = new Map<string, Student>();
  private readonly cache = new SubjectBehavior<Student[]>([]);
  observe(): Observable<Student[]> { return this.cache; }
  observeByParent(parentId: string): Observable<Student[]> {
    return new SubjectBehavior<Student[]>([...this.rows.values()].filter((s) => s.parentId === parentId));
  }
  observeByClass(classId: string): Observable<Student[]> {
    return new SubjectBehavior<Student[]>([...this.rows.values()].filter((s) => s.classId === classId));
  }
  observeById(id: string): Observable<Student | null> {
    return new SubjectBehavior<Student | null>(this.rows.get(id) ?? null);
  }
  async search(query: string): Promise<Result<Student[]>> {
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows.values()]);
    return Ok([...this.rows.values()].filter((s) =>
      `${s.firstName} ${s.lastName} ${s.displayName ?? ""} ${s.code}`.toLowerCase().includes(q)
    ));
  }
  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    const id = `stu-${String(this.rows.size + 1).padStart(3, "0")}`;
    const now = new Date().toISOString();
    const student: Student = {
      id, tenantId: "test-tenant",
      code: `ELV-2026-${id.slice(-4)}`,
      parentId,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null,
      gender: input.gender, birthDate: input.birthDate,
      enrollmentDate: now.slice(0, 10),
      level: input.level, gradeYear: input.gradeYear,
      gradeLevel: input.gradeLevel ?? "1ap",
      classId: input.classId ?? null, photoUrl: null,
      medicalNotes: input.medicalNotes ?? null,
      transportTier: input.transportTier ?? null,
      status: "active", paymentPlan: input.paymentPlan ?? "tranches",
      createdAt: now, updatedAt: now,
    };
    this.rows.set(id, student);
    this.cache.set([...this.rows.values()]);
    return Ok(student);
  }
  async updateStudent(id: string, updates: Partial<CreateStudentInput>): Promise<Result<Student>> {
    const existing = this.rows.get(id);
    if (!existing) return Err(Errors.notFound("Student", id));
    const updated = { ...existing, ...updates } as Student;
    this.rows.set(id, updated);
    this.cache.set([...this.rows.values()]);
    return Ok(updated);
  }
  async deleteStudent(id: string): Promise<Result<void>> {
    this.rows.delete(id);
    this.cache.set([...this.rows.values()]);
    return Ok(undefined);
  }
  async batchRegister(): Promise<Result<BatchRegistrationResult>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async promote(): Promise<Result<Student[]>> {
    return Err(Errors.server("not implemented in stub"));
  }
  // T-372/SYNC-110: granular document contract stubs — these import-focused
  // harnesses never exercise document flows; the methods exist to satisfy
  // the StudentRepository contract and fail loud if ever reached.
  async addStudentDocument(): Promise<Result<import("../../domain/model/student").StudentDocument>> {
    return Err(Errors.server("stub: addStudentDocument not used in this harness"));
  }
  async removeStudentDocument(): Promise<Result<void>> {
    return Err(Errors.server("stub: removeStudentDocument not used in this harness"));
  }

}

class FastLedgerRepo implements LedgerRepository {
  readonly rows: LedgerEntry[] = [];
  private readonly cache = new SubjectBehavior<LedgerEntry[]>([]);
  observe(): Observable<LedgerEntry[]> { return this.cache; }
  observeByParent(parentId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior<LedgerEntry[]>(this.rows.filter((e) => e.parentId === parentId));
  }
  observeByAccount(accountId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior<LedgerEntry[]>(this.rows.filter((e) => e.accountId === accountId));
  }
  observeByStudent(studentId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior<LedgerEntry[]>(this.rows.filter((e) => e.studentId === studentId));
  }
  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    this.rows.push(entry);
    this.cache.set([...this.rows]);
    return Ok(entry);
  }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    const copy = [...entries];
    this.rows.push(...copy);
    this.cache.set([...this.rows]);
    return Ok(copy);
  }
  async reverse(): Promise<Result<LedgerEntry>> { return Err(Errors.server("not implemented in stub")); }
  async summary(): Promise<Result<import("../../domain/model/ledger").ParentLedgerSummary>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async reconcile(): Promise<Result<import("../../domain/calc/reconcile").ReconciliationReport>> {
    return Err(Errors.server("not implemented in stub"));
  }
}

/** Ledger stub whose appendMany FAILS — the atomicity probe. */
class ThrowingLedgerRepo extends FastLedgerRepo {
  async appendMany(): Promise<Result<readonly LedgerEntry[]>> {
    throw new Error("simulated mid-import ledger failure");
  }
}

class FastPaymentRepo implements PaymentRepository {
  readonly rows = new Map<string, Payment>();
  private readonly cache = new SubjectBehavior<Payment[]>([]);
  observe(): Observable<Payment[]> { return this.cache; }
  observeByParent(parentId: string): Observable<Payment[]> {
    return new SubjectBehavior<Payment[]>([...this.rows.values()].filter((p) => p.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Payment[]> {
    return new SubjectBehavior<Payment[]>([...this.rows.values()].filter((p) => p.studentId === studentId));
  }
  observeById(id: string): Observable<Payment | null> {
    return new SubjectBehavior<Payment | null>(this.rows.get(id) ?? null);
  }
  async collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    const receiptNumber = input.receiptNumber ?? `REC-${Date.now()}`;
    const existing = [...this.rows.values()].find((p) => p.receiptNumber === receiptNumber);
    if (existing) return Ok(existing);
    const now = input.collectedAt ?? new Date().toISOString();
    const id = `pay-${String(this.rows.size + 1).padStart(3, "0")}`;
    const payment: Payment = {
      id, tenantId: "test-tenant", receiptNumber,
      parentId: input.parentId, studentId: input.studentId,
      amount: input.amount, method: input.method,
      status: "paid", category: input.category,
      installmentId: input.installmentId,
      proofUrl: input.proofUrl ?? null, notes: input.notes ?? null,
      collectedBy, collectedAt: now, createdAt: now, updatedAt: now,
    };
    this.rows.set(id, payment);
    this.cache.set([...this.rows.values()]);
    return Ok(payment);
  }
  async refund(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in stub")); }
  async markCleared(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in stub")); }
  async markBounced(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in stub")); }
  async adjust(): Promise<Result<import("../../domain/model/payment").AccountAdjustment>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async generateReceipt(): Promise<Result<import("../../domain/model/payment").Receipt>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async appendManualCharge(): Promise<Result<LedgerEntry>> { return Err(Errors.server("not implemented in stub")); }
}

class FastInstallmentRepo implements InstallmentRepository {
  readonly rows = new Map<string, Installment>();
  private key(parentId: string, studentId: string, category: PaymentCategory, trancheNumber: number): string {
    return `${parentId}:${studentId}:${category}:${trancheNumber}`;
  }
  observeByParent(parentId: string): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()].filter((i) => i.parentId === parentId));
  }
  observe(): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()]);
  }
  observeByStudent(studentId: string): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()].filter((i) => i.studentId === studentId));
  }
  observeById(id: string): Observable<Installment | null> {
    return new SubjectBehavior<Installment | null>(this.rows.get(id) ?? null);
  }
  async markPaid(): Promise<Result<Installment>> { return Err(Errors.server("not implemented in stub")); }
  async allocatePayment(): Promise<Result<import("../../domain/calc/payment/waterfall-allocator").AllocationResult>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async updateDueDate(): Promise<Result<Installment>> { return Err(Errors.server("not implemented in stub")); }
  async regenerateForCycle(): Promise<Result<readonly Installment[]>> { return Err(Errors.server("not implemented in stub")); }
  async findOverdue(): Promise<Result<readonly Installment[]>> { return Ok([]); }
  async importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>> {
    const k = this.key(input.parentId, input.studentId, input.category, input.trancheNumber);
    const installment: Installment = {
      id: `imp-${k}`,
      parentId: input.parentId, studentId: input.studentId,
      category: input.category, label: input.label,
      amountDue: input.amountDue, amountPaid: input.amountPaid,
      amountPending: 0, dueDate: input.dueDate, paidDate: input.paidDate,
      status: input.status, academicCycle: input.academicCycle,
      paymentPlan: input.paymentPlan ?? "tranches",
      isCustomSchedule: false, customScheduleNote: null,
    };
    this.rows.set(k, installment);
    return Ok(installment);
  }
}
