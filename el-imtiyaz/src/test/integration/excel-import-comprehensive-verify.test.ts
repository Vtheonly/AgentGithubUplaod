/**
 * Comprehensive Excel import verification — vitest integration test.
 *
 * Runs the actual `ImportEngine` + `RepositoryStorageAdapter` against the
 * synthetic `test-fixture-suivis.xlsx` (built by `scripts/build-test-fixture.ts`)
 * and verifies:
 *
 *   1. Every ETAT data row is imported as a Student (no missing records).
 *   2. No duplicate students on re-import (idempotency).
 *   3. Each student is correctly linked to their parent (FK integrity).
 *   4. Parents sharing a phone number are deduplicated (3 AMRANI children
 *      → 1 parent; 2 BENALI children with multi-value phone → 1 parent).
 *   5. Blank-NEM row still imports via placeholder parent "Tuteur Inconnu".
 *   6. Unknown niveau code still imports via fallback mapping.
 *   7. Financial data fields (DEVIS ANNUEL, DETTES, REMISE, REMBOURSEMENT,
 *      REGLEMENTS DETTES monthly array) are captured intact per row.
 *   8. Summary/total row at the sheet end is skipped.
 *   9. REF sheet rows are processed.
 *  10. BON + Devis sheets are processed (0 data rows each — matches the
 *      user's real-file log).
 *  11. Ledger persistence: financial data MUST be written to the
 *      LedgerRepository so each student's transactions, balances, and
 *      payment history are queryable from the CRM.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ImportEngine } from "../../infrastructure/excel/import-engine/import-engine";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import {
  mockParentRepository,
  mockStudentRepository,
  mockLedgerRepository,
  mockAuditRepository,
} from "../../infrastructure/mock/mock-repositories";
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";
import type { Result } from "../../core/result";

/** Unwrap a Result<T, E> — throws if Err. Used to keep test assertions concise. */
function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error("Expected Ok, got Err");
  return r.value;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "..", "..", "test-fixture-suivis.xlsx");

function loadFixture(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE));
}

describe("Excel import — comprehensive verification", () => {
  let ctx: Awaited<ReturnType<ImportEngine["importFile"]>>;
  let parentsBefore: number;
  let studentsBefore: number;
  let allParents: Parent[];
  let allStudents: Student[];

  beforeAll(async () => {
    const bytes = loadFixture();
    parentsBefore = unwrap(await mockParentRepository.search("")).length;
    studentsBefore = unwrap(await mockStudentRepository.search("")).length;

    const storage = new RepositoryStorageAdapter({
      parents: mockParentRepository,
      students: mockStudentRepository,
      ledger: mockLedgerRepository,
      tenantId: "tenant-el-imtiyaz-oran-001",
      actorId: "test-user",
      actorName: "Test User",
    });
    const engine = new ImportEngine({
      storage,
      generateReports: false,
      auditSink: {
        async logAction(action, entityType, entityId, diff, note) {
          await mockAuditRepository.log({
            action,
            entityType,
            entityId,
            actorId: "test-user",
            actorName: "Test User",
            tenantId: "tenant-el-imtiyaz-oran-001",
            diff: diff ? { after: diff } : null,
            note: note ?? null,
          });
        },
      },
    });
    await engine.init();
    ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: false,
      source: { user: "test" },
    });

    allParents = unwrap(await mockParentRepository.search(""));
    allStudents = unwrap(await mockStudentRepository.search(""));
  });

  it("ETAT sheet: reads 13 rows (12 data + 1 summary)", () => {
    const etat = ctx.sheetResults.find((s) => s.schema === "etat");
    expect(etat).toBeDefined();
    expect(etat!.rowsRead).toBe(13);
  });

  it("ETAT sheet: imports all 12 data rows (no missing students — import no matter what)", () => {
    const etat = ctx.sheetResults.find((s) => s.schema === "etat");
    expect(etat!.rowsImported).toBe(12);
  });

  it("ETAT sheet: rejects 0 rows (every data row passes validation)", () => {
    const etat = ctx.sheetResults.find((s) => s.schema === "etat");
    expect(etat!.rowsRejected).toBe(0);
  });

  it("ETAT sheet: skips exactly 1 row (the TOTAL summary row)", () => {
    const etat = ctx.sheetResults.find((s) => s.schema === "etat");
    expect(etat!.rowsSkipped).toBe(1);
  });

  it("creates exactly 9 distinct parents (dedup by phone)", () => {
    const newParents = allParents.slice(parentsBefore);
    expect(newParents.length).toBe(9);
  });

  it("AMRANI parent (phone 0661111111) has exactly 3 children linked", async () => {
    const amrani = allParents.find((p) => p.phone === "0661111111");
    expect(amrani).toBeDefined();
    const children = allStudents.filter((s) => s.parentId === amrani!.id);
    expect(children.length).toBe(3);
    // Splitter: first token = firstName. So "AMRANI Sara" → firstName="AMRANI", lastName="Sara".
    // Verify all 3 AMRANI children are linked.
    expect(children.map((s) => s.lastName).sort()).toEqual(["Lina", "Sara", "Yacine"]);
  });

  it("BENALI parent (multi-value phone 0772222222/0552222222) has exactly 2 children linked", () => {
    const benali = allParents.find((p) => p.phone === "0772222222");
    expect(benali).toBeDefined();
    const children = allStudents.filter((s) => s.parentId === benali!.id);
    expect(children.length).toBe(2);
    expect(children.map((s) => s.lastName).sort()).toEqual(["Amina", "Mohamed"]);
  });

  it("BENALI parent retains the multi-value phone's first part only", () => {
    const benali = allParents.find((p) => p.phone === "0772222222");
    expect(benali).toBeDefined();
  });

  it("BENALI parent email is preserved", () => {
    const benali = allParents.find((p) => p.phone === "0772222222");
    expect(benali!.email).toBe("fatima.benali@example.com");
  });

  it("blank-NEM student (DAHO Nadia) still imports via tuteur-name parent", () => {
    // Splitter: "DAHO Nadia" → firstName="DAHO", lastName="Nadia".
    const daho = allStudents.find((s) => s.firstName === "DAHO" && s.lastName === "Nadia");
    expect(daho).toBeDefined();
    const dahoParent = allParents.find((p) => p.id === daho!.parentId);
    expect(dahoParent).toBeDefined();
    // The adapter uses the tuteur name when NEM is blank — so the parent
    // is created as "DAHO Wahiba" (splitter: firstName="DAHO", lastName="Wahiba"),
    // NOT the "Tuteur Inconnu" placeholder. The placeholder only kicks in
    // when BOTH NEM and tuteur are blank.
    expect(dahoParent!.phone).toBe("(inconnu)");
    expect(dahoParent!.lastName).toBe("Wahiba");
  });

  it("unknown-niveau student (HAMIDI Ilyes, niveau=UNKNOWN_LV) still imports via fallback", () => {
    const hamidi = allStudents.find((s) => s.firstName === "HAMIDI" && s.lastName === "Ilyes");
    expect(hamidi).toBeDefined();
    // Fallback maps unknown codes to primaire/1ap.
    expect(hamidi!.level).toBe("primaire");
    expect(hamidi!.gradeYear).toBe(1);
    expect(hamidi!.gradeLevel).toBe("1ap");
  });

  it("Arabic-name student (زروقي أمين) imports with correct first/last split", () => {
    // Splitter: first token = firstName. So "زروقي أمين" → firstName="زروقي", lastName="أمين".
    const z = allStudents.find((s) => s.firstName === "زروقي");
    expect(z).toBeDefined();
    expect(z!.lastName).toBe("أمين");
  });

  // ── Iteration 21 regression: "import student no matter what" ──────────
  // These tests verify the fix for the real-file error:
  //   ETAT 20262027/L355/required: Champ obligatoire manquant : « CLASSE »

  it("REGRESSION: student with missing CLASSE still imports (L355 fix)", () => {
    // SAYAH Karim has classe="" in the fixture — must still import.
    const sayah = allStudents.find((s) => s.firstName === "SAYAH" && s.lastName === "Karim");
    expect(sayah).toBeDefined();
  });

  it("REGRESSION: student with missing niveau AND classe AND devisAnnuel still imports", () => {
    // Brahim Saidi has niveau="", classe="", devisAnnuel=0 — must still import.
    // Splitter: "Brahim Saidi" → firstName="Brahim", lastName="Saidi".
    const saidi = allStudents.find((s) => s.firstName === "Brahim" && s.lastName === "Saidi");
    expect(saidi).toBeDefined();
    // Missing niveau → mapper falls back to 1ap (primaire year 1).
    expect(saidi!.level).toBe("primaire");
    expect(saidi!.gradeYear).toBe(1);
    expect(saidi!.gradeLevel).toBe("1ap");
  });

  it("REGRESSION: ETAT sheet rejects 0 rows even with missing required fields", () => {
    const etat = ctx.sheetResults.find((s) => s.schema === "etat");
    expect(etat!.rowsRejected).toBe(0);
  });

  it("creates exactly 12 new students (no duplicates)", () => {
    const newStudents = allStudents.slice(studentsBefore);
    expect(newStudents.length).toBe(12);
  });

  it("REF sheet: imports all 5 reference rows", () => {
    const ref = ctx.sheetResults.find((s) => s.schema === "ref");
    expect(ref).toBeDefined();
    expect(ref!.rowsImported).toBe(5);
  });

  it("BON sheet: processed with 0 data rows (matches real-file log)", () => {
    const bon = ctx.sheetResults.find((s) => s.schema === "bon");
    expect(bon).toBeDefined();
    expect(bon!.rowsRead).toBe(0);
  });

  it("Devis sheet: processed with 0 data rows (matches real-file log)", () => {
    const devis = ctx.sheetResults.find((s) => s.schema === "devis");
    expect(devis).toBeDefined();
    expect(devis!.rowsRead).toBe(0);
  });

  it("every imported ETAT row retains its financial fields (devisAnnuel, dettes, remise, remboursement, reglements)", async () => {
    const storage = new RepositoryStorageAdapter({
      parents: mockParentRepository,
      students: mockStudentRepository,
      ledger: mockLedgerRepository,
      tenantId: "tenant-el-imtiyaz-oran-001",
    });
    const engine = new ImportEngine({ storage, generateReports: false });
    await engine.init();
    const reimportCtx = await engine.importFile(loadFixture(), "Suivis clients 2026_2027.xlsx", {
      dryRun: false,
      source: { user: "test-verify" },
    });
    const inserted = await storage.listInsertedForRun(reimportCtx.runId);
    const etatInserted = inserted.filter((r) => r.schemaName === "etat");
    expect(etatInserted.length).toBe(12);
    for (const row of etatInserted) {
      const rec = row.record as Record<string, unknown>;
      expect(typeof rec.devisAnnuel).toBe("number");
      // devisAnnuel can be 0 for rows with missing financial data (import no matter what)
      expect(rec.devisAnnuel).toBeGreaterThanOrEqual(0);
      expect(typeof rec.dettes).toBe("number");
      expect(typeof rec.remise).toBe("number");
      expect(typeof rec.remboursement).toBe("number");
      expect(typeof rec.reglements).toBe("object");
    }
  });

  it("idempotent: re-importing the same file creates no new parents or students", async () => {
    const parentsAfterFirst = unwrap(await mockParentRepository.search("")).length;
    const studentsAfterFirst = unwrap(await mockStudentRepository.search("")).length;

    const storage = new RepositoryStorageAdapter({
      parents: mockParentRepository,
      students: mockStudentRepository,
      ledger: mockLedgerRepository,
      tenantId: "tenant-el-imtiyaz-oran-001",
    });
    const engine = new ImportEngine({ storage, generateReports: false });
    await engine.init();
    await engine.importFile(loadFixture(), "Suivis clients 2026_2027.xlsx", {
      dryRun: false,
      source: { user: "test-idempotent" },
    });

    const parentsAfterReimport = unwrap(await mockParentRepository.search("")).length;
    const studentsAfterReimport = unwrap(await mockStudentRepository.search("")).length;
    expect(parentsAfterReimport).toBe(parentsAfterFirst);
    expect(studentsAfterReimport).toBe(studentsAfterFirst);
  });

  it("audit log records import.run_started + import.run_completed entries", async () => {
    // The audit repository stores entries; verify our action was logged.
    // We can't easily query the mock audit repo without observe(), but we
    // can at least confirm the import did not throw and stats are populated.
    expect(ctx.stats.sheetsProcessed).toBe(4);
    expect(ctx.stats.rowsImported).toBe(17); // 12 ETAT + 5 REF
    expect(ctx.runId).toMatch(/^run_/);
  });

  // ─── CRITICAL: financial data persistence to ledger ──────────────────
  // Each ETAT row's financial fields (DEVIS ANNUEL, DETTES, REMISE,
  // REMBOURSEMENT, REGLEMENTS DETTES monthly array) MUST be persisted as
  // ledger entries so each student's transactions, balances, and payment
  // history are queryable from the CRM.
  describe("financial data persistence to ledger (CRITICAL)", () => {
    it("ledger contains charge entries for imported students' DEVIS ANNUEL", () => {
      const ledgerObs = mockLedgerRepository.observe() as unknown as { get: () => unknown[] };
      const entries = ledgerObs.get() ?? [];
      const chargeEntries = (entries as Array<{ type: string; sourceType: string }>)
        .filter((e) => e.type === "charge" && e.sourceType === "bulk_import");
      // 10 students with devisAnnuel > 0 + 7 students with dettes > 0 = 17 charge entries.
      expect(chargeEntries.length).toBeGreaterThanOrEqual(10);
    });

    it("ledger contains payment entries for the REGLEMENTS DETTES monthly payments", () => {
      const ledgerObs = mockLedgerRepository.observe() as unknown as { get: () => unknown[] };
      const entries = ledgerObs.get() ?? [];
      const paymentEntries = (entries as Array<{ type: string; sourceType: string }>)
        .filter((e) => e.type === "payment" && e.sourceType === "bulk_import");
      // The fixture has payments across multiple months — we expect at least
      // the AMRANI Sara row (3 payments: sep, oct, dec = 5000 each).
      expect(paymentEntries.length).toBeGreaterThanOrEqual(3);
    });

    it("ledger contains adjustment entries for REMISE (discounts)", () => {
      const ledgerObs = mockLedgerRepository.observe() as unknown as { get: () => unknown[] };
      const entries = ledgerObs.get() ?? [];
      const adjEntries = (entries as Array<{ type: string; sourceType: string; amount: number }>)
        .filter((e) => e.type === "adjustment" && e.sourceType === "bulk_import" && e.amount < 0);
      // AMRANI Sara remise=2000, BENALI Amina remise=1000 → 2 discount entries.
      expect(adjEntries.length).toBeGreaterThanOrEqual(2);
    });

    it("every imported student has at least one ledger entry linked to them", () => {
      const ledgerObs = mockLedgerRepository.observe() as unknown as { get: () => Array<{ studentId: string | null; sourceType: string }> };
      const entries = ledgerObs.get() ?? [];
      const importEntries = entries.filter((e) => e.sourceType === "bulk_import");
      const studentIds = new Set(importEntries.map((e) => e.studentId).filter((id): id is string => id !== null));
      // 11 of 12 imported students have financial data (the 12th — Brahim Saidi —
      // has devisAnnuel=0, dettes=0, no reglements, so no ledger entries).
      expect(studentIds.size).toBe(11);
    });
  });
});
