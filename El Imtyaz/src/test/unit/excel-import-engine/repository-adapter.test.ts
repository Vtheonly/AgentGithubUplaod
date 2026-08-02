import { describe, it, expect, beforeEach } from "vitest";
import { RepositoryStorageAdapter } from "../../../infrastructure/excel/import-engine/storage/repository-adapter";
import { ETAT_SCHEMA } from "../../../infrastructure/excel/import-engine/schemas/etat-schema";
import { MockParentRepository } from "../../../infrastructure/mock/repositories/parent-repository";
import { MockStudentRepository } from "../../../infrastructure/mock/repositories/student-repository";
import { store, TENANT_ID } from "../../../infrastructure/mock/repositories/mock-store";
import type { ImportRecord } from "../../../infrastructure/excel/import-engine/types";

describe("RepositoryStorageAdapter", () => {
  let parents: MockParentRepository;
  let students: MockStudentRepository;
  let adapter: RepositoryStorageAdapter;

  beforeEach(() => {
    // Reset mock store to seed state before each test.
    store.parents = [...store.parents];
    store.students = [...store.students];
    parents = new MockParentRepository();
    students = new MockStudentRepository();
    adapter = new RepositoryStorageAdapter({
      parents,
      students,
      tenantId: TENANT_ID,
    });
  });

  describe("upsertRecord — ETAT schema", () => {
    it("creates a parent + student when none exist", async () => {
      const parentCountBefore = store.parents.length;
      const studentCountBefore = store.students.length;

      const record: ImportRecord = {
        nom: "Ahmed Benali",
        niveau: "PRIM",
        classe: "1AP-A",
        nem: "0612345678",
        tuteur: "Mohamed Benali",
        email: "parent@example.com",
        devisAnnuel: 45000,
      };

      const result = await adapter.upsertRecord(
        ETAT_SCHEMA,
        record,
        ["NEM", "NOM"],
        "run-test-1",
      );

      expect(result.action).toBe("insert");
      expect(store.parents.length).toBe(parentCountBefore + 1);
      expect(store.students.length).toBe(studentCountBefore + 1);
    });

    it("reuses existing parent when phone matches (idempotent)", async () => {
      const record: ImportRecord = {
        nom: "Ahmed Benali",
        niveau: "PRIM",
        classe: "1AP-A",
        nem: "0612345678",
        tuteur: "Mohamed Benali",
        devisAnnuel: 45000,
      };

      await adapter.upsertRecord(ETAT_SCHEMA, record, ["NEM", "NOM"], "run-1");
      const parentCountAfterFirst = store.parents.length;

      // Import the same row again with a different student name.
      const record2 = { ...record, nom: "Fatima Benali" };
      await adapter.upsertRecord(ETAT_SCHEMA, record2, ["NEM", "NOM"], "run-2");

      // Parent count must NOT increase — the existing parent was reused.
      expect(store.parents.length).toBe(parentCountAfterFirst);
    });

    it("imports student even when NEM is blank (import no matter what)", async () => {
      const record: ImportRecord = {
        nom: "Solo Student",
        niveau: "COLG",
        classe: "1AM-A",
        nem: "",
        tuteur: "",
        devisAnnuel: 30000,
      };

      const result = await adapter.upsertRecord(
        ETAT_SCHEMA,
        record,
        ["NEM", "NOM"],
        "run-3",
      );

      expect(result.action).toBe("insert");
      // A placeholder parent should have been created.
      expect(store.parents.length).toBeGreaterThan(0);
      // The student should be in the store.
      const found = store.students.find(
        (s) => s.firstName === "Solo" && s.lastName === "Student",
      );
      expect(found).toBeDefined();
    });

    it("maps unknown niveau codes to default (1ap)", async () => {
      const record: ImportRecord = {
        nom: "Test Unknown",
        niveau: "UNKNOWN_CODE",
        classe: "X",
        nem: "0700000000",
        devisAnnuel: 10000,
      };

      await adapter.upsertRecord(ETAT_SCHEMA, record, ["NEM", "NOM"], "run-4");

      const student = store.students.find((s) => s.firstName === "Test");
      expect(student).toBeDefined();
      expect(student!.level).toBe("primaire");
      expect(student!.gradeYear).toBe(1);
    });

    it("splits multi-word last names correctly", async () => {
      const record: ImportRecord = {
        nom: "Jean De La Fontaine",
        niveau: "LYC",
        classe: "1L-A",
        nem: "0555112233",
        devisAnnuel: 60000,
      };

      await adapter.upsertRecord(ETAT_SCHEMA, record, ["NEM", "NOM"], "run-5");

      const student = store.students.find((s) => s.firstName === "Jean");
      expect(student).toBeDefined();
      expect(student!.lastName).toBe("De La Fontaine");
    });

    it("extracts first phone from multi-value NEM field", async () => {
      const record: ImportRecord = {
        nom: "Multi Phone",
        niveau: "PRIM",
        classe: "1AP-A",
        nem: "0612345678 / 0712345678",
        devisAnnuel: 25000,
      };

      await adapter.upsertRecord(ETAT_SCHEMA, record, ["NEM", "NOM"], "run-6");

      const parent = store.parents.find((p) => p.phone === "0612345678");
      expect(parent).toBeDefined();
    });
  });

  describe("listInsertedForRun", () => {
    it("returns every record inserted in the given run", async () => {
      const record: ImportRecord = {
        nom: "Tracked Student",
        niveau: "PRIM",
        classe: "1AP-A",
        nem: "0699999999",
        devisAnnuel: 20000,
      };

      await adapter.upsertRecord(ETAT_SCHEMA, record, ["NEM", "NOM"], "run-track-1");

      const inserted = await adapter.listInsertedForRun("run-track-1");
      expect(inserted.length).toBe(1);
      expect(inserted[0].schemaName).toBe("etat");
    });

    it("returns empty for an unknown run id", async () => {
      const inserted = await adapter.listInsertedForRun("nonexistent");
      expect(inserted).toEqual([]);
    });
  });

  describe("saveAuditRun + getRun + listRuns", () => {
    it("persists and retrieves run audit entries", async () => {
      // Build a minimal ImportContext-like object.
      const ctx = {
        runId: "audit-run-1",
        filePath: "test.xlsx",
        fileChecksum: "abc123",
        fileSize: 1024,
        startedAt: new Date("2026-01-01T00:00:00Z"),
        finishedAt: new Date("2026-01-01T00:00:01Z"),
        durationMs: 1000,
        options: {},
        source: {},
        stats: {
          sheetsProcessed: 1,
          rowsRead: 1,
          rowsImported: 1,
          rowsUpdated: 0,
          rowsSkipped: 0,
          rowsRejected: 0,
          warnings: 0,
        },
        sheetResults: [],
        errors: [],
        warnings: [],
        finish: () => {},
        computeFileMetadata: async () => {},
        addWarning: () => {},
        addError: () => {},
        addSheetResult: () => {},
      } as any;

      await adapter.saveAuditRun(ctx);
      const fetched = await adapter.getRun("audit-run-1");
      expect(fetched).not.toBeNull();
      expect(fetched!.runId).toBe("audit-run-1");
      expect(fetched!.status).toBe("success");

      const list = await adapter.listRuns();
      expect(list.length).toBe(1);
    });
  });

  describe("rollbackTransaction", () => {
    it("clears the per-run insertion log", async () => {
      const record: ImportRecord = {
        nom: "Rollback Test",
        niveau: "PRIM",
        classe: "X",
        nem: "0688888888",
        devisAnnuel: 10000,
      };
      await adapter.upsertRecord(ETAT_SCHEMA, record, ["NEM", "NOM"], "run-rb-1");
      expect(await adapter.listInsertedForRun("run-rb-1")).toHaveLength(1);

      await adapter.rollbackTransaction();
      // After rollback, the per-run log is cleared.
      expect(await adapter.listInsertedForRun("run-rb-1")).toEqual([]);
    });
  });
});
