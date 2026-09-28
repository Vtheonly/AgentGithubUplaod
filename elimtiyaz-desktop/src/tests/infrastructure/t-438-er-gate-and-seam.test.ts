/**
 * T-438 — the ER-PMAE experimental gate + the T-414 seam suite
 * (identity-rules §7/§9; problems IDENT-100/101; issues #15/#16).
 *
 * What this suite pins:
 *
 *   A. THE EXPERIMENTAL FLAG (INV-56) — OFF by default, persists locally,
 *      fail-closed on garbage, never reads the server feature_flags.
 *   B. THE CONFIRMED-BINDINGS MATCHER — empty map answers "no match"
 *      (the NoOp-equivalent); a binding binds; a vanished target degrades
 *      honestly.
 *   C. THE ADAPTER SEAM (INV-40/45/50) — with a CONFIRMED binding, an
 *      incoming row whose legacy identity would CREATE a new family instead
 *      binds to the EXISTING family (the canonical write path — a student
 *      created under the existing parent, zero new parents); WITHOUT the
 *      matcher, the same row follows the legacy path byte-identically (a
 *      new family is created — the pre-T-438 behavior preserved).
 *   D. THE OBSERVATION BUILDERS — the shared id convention, the roster
 *      projection, the ImportRecord mapping.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-438-er-gate-and-seam.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EXPERIMENTAL_ER_PMAE_KEY,
  EXPERIMENTAL_CAPABILITIES,
  isExperimentalEnabled,
  setExperimentalEnabled,
  anyExperimentalEnabled,
} from "../../infrastructure/experimental/experimental-flags";
import {
  ConfirmedEntityMatcher,
  erImportRowObservationId,
  erObservationFromImportRow,
  erObservationsFromParents,
} from "../../infrastructure/excel/import-engine/er-matcher";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import { NoOpEntityMatcher } from "../../infrastructure/excel/import-config/extensions";
import type { ParentRepository, StudentRepository, Observable } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type { Student, CreateStudentInput, UpdateStudentInput, BatchRegistrationResult, GradeLevel } from "../../domain/model/student";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
  localStorage.removeItem(`el-imtiyaz:experimental:${EXPERIMENTAL_ER_PMAE_KEY}`);
});

// ---------------------------------------------------------------------------
// A. The experimental flag (INV-56)
// ---------------------------------------------------------------------------

describe("T-438 A — the experimental flag store", () => {
  it("is OFF by default and fail-closed on garbage", () => {
    localStorage.removeItem(`el-imtiyaz:experimental:${EXPERIMENTAL_ER_PMAE_KEY}`);
    expect(isExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY)).toBe(false);
    localStorage.setItem(`el-imtiyaz:experimental:${EXPERIMENTAL_ER_PMAE_KEY}`, "garbage");
    expect(isExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY)).toBe(false);
    localStorage.setItem(`el-imtiyaz:experimental:${EXPERIMENTAL_ER_PMAE_KEY}`, "1");
    expect(isExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY)).toBe(false);
  });

  it("persists locally when written", () => {
    setExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY, true);
    expect(isExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY)).toBe(true);
    setExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY, false);
    expect(isExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY)).toBe(false);
    expect(anyExperimentalEnabled()).toBe(false);
  });

  it("registers the ER-PMAE capability (the Settings → Expérimental surface's source)", () => {
    const cap = EXPERIMENTAL_CAPABILITIES.find((c) => c.key === EXPERIMENTAL_ER_PMAE_KEY);
    expect(cap).toBeDefined();
    expect(cap!.labelFr.length).toBeGreaterThan(0);
    expect(cap!.descriptionFr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// B. The confirmed-bindings matcher
// ---------------------------------------------------------------------------

describe("T-438 B — the ConfirmedEntityMatcher", () => {
  const existing = [
    { kind: "parent" as const, id: "par-1", attributes: { code: "PAR-2026-0001", displayName: "SEDIKI", phone: "0663701834" } },
    { kind: "parent" as const, id: "par-2", attributes: { code: "PAR-2026-0002", displayName: "BENALI", phone: "0770998877" } },
  ];

  it("an empty bindings map answers no-match for everything (the NoOp equivalent)", async () => {
    const matcher = new ConfirmedEntityMatcher(new Map());
    const outcome = await matcher.match({ kind: "parent", id: "import:row:42", attributes: {} }, existing);
    expect(outcome.matched).toBe(false);
  });

  it("a confirmed binding binds to the target", async () => {
    const matcher = new ConfirmedEntityMatcher(new Map([["import:row:42", "par-1"]]));
    const outcome = await matcher.match({ kind: "parent", id: "import:row:42", attributes: {} }, existing);
    expect(outcome.matched).toBe(true);
    if (outcome.matched) {
      expect(outcome.target.id).toBe("par-1");
      expect(outcome.strategy).toBe("er-pmae-confirmed");
      expect(outcome.confidence).toBe(1);
    }
  });

  it("a vanished target degrades honestly (no match, never a crash)", async () => {
    const matcher = new ConfirmedEntityMatcher(new Map([["import:row:42", "par-gone"]]));
    const outcome = await matcher.match({ kind: "parent", id: "import:row:42", attributes: {} }, existing);
    expect(outcome.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. The adapter seam (INV-40/45/50)
// ---------------------------------------------------------------------------

/** A parent stub with ONE existing family + create-call tracking. */
class OneFamilyParentStub implements ParentRepository {
  readonly created: CreateParentInput[] = [];
  readonly parent: Parent = {
    id: "par-er-1",
    tenantId: "00000000-0000-0000-0000-000000000001",
    code: "PAR-2026-ER01",
    firstName: "Mohamed",
    lastName: "SEDIKI",
    displayName: "SEDIKI Mohamed",
    gender: "unspecified",
    phone: "0663701834",
    whatsapp: null,
    email: null,
    occupation: null,
    address: null,
    cityTier: null,
    transportDestination: null,
    preferredLanguage: "fr",
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  observe(): Observable<Parent[]> {
    return new SubjectBehavior<Parent[]>([this.parent]);
  }
  observeById(): Observable<Parent | null> {
    return new SubjectBehavior<Parent | null>(this.parent);
  }
  async search(): Promise<Result<Parent[]>> {
    return Ok([this.parent]);
  }
  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    this.created.push(input);
    return Ok({
      ...this.parent,
      id: `par-created-${this.created.length}`,
      phone: input.phone ?? this.parent.phone,
    });
  }
  async updateParent(_id: string, _updates: UpdateParentInput): Promise<Result<Parent>> {
    return Err(Errors.server("stub"));
  }
  async deleteParent(): Promise<Result<void>> {
    return Err(Errors.server("stub"));
  }
}

/** A student stub recording where every student landed. */
class RecordingStudentStub implements StudentRepository {
  readonly rows: Student[] = [];
  private readonly cache = new SubjectBehavior<Student[]>([]);
  observe(): Observable<Student[]> { return this.cache; }
  observeByParent(): Observable<Student[]> { return new SubjectBehavior<Student[]>(this.rows); }
  observeByClass(): Observable<Student[]> { return new SubjectBehavior<Student[]>([]); }
  observeById(): Observable<Student | null> { return new SubjectBehavior<Student | null>(null); }
  async search(query: string): Promise<Result<Student[]>> {
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows]);
    return Ok(this.rows.filter((s) =>
      `${s.firstName} ${s.lastName} ${s.displayName ?? ""} ${s.code}`.toLowerCase().includes(q),
    ));
  }
  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    const student: Student = {
      ...BASE_STUDENT,
      id: `stu-${this.rows.length + 1}`,
      parentId,
      firstName: input.firstName,
      lastName: input.lastName ?? "",
    };
    this.rows.push(student);
    this.cache.set([...this.rows]);
    return Ok(student);
  }
  async updateStudent(_id: string, _updates: UpdateStudentInput): Promise<Result<Student>> {
    return Err(Errors.server("stub"));
  }
  async deleteStudent(): Promise<Result<void>> { return Err(Errors.server("stub")); }
  async batchRegister(): Promise<Result<BatchRegistrationResult>> { return Err(Errors.server("stub")); }
  async promote(): Promise<Result<Student[]>> { return Err(Errors.server("stub")); }
  async addStudentDocument(): Promise<Result<import("../../domain/model/student").StudentDocument>> {
    return Err(Errors.server("stub"));
  }
  async removeStudentDocument(): Promise<Result<void>> { return Err(Errors.server("stub")); }
}

const BASE_STUDENT: Student = {
  id: "stu-x",
  tenantId: "t",
  code: "ELV-2026-XXXX",
  parentId: "par-x",
  firstName: "",
  middleName: null,
  lastName: "",
  displayName: null,
  gender: "unspecified",
  birthDate: "2000-01-01",
  enrollmentDate: "2026-09-01",
  level: "primaire",
  gradeYear: 1,
  gradeLevel: "1ap" as GradeLevel,
  classId: null,
  photoUrl: null,
  medicalNotes: null,
  transportTier: null,
  status: "active",
  paymentPlan: "tranches",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * The seam scenario: an incoming row whose phone is DIFFERENT from the
 * existing family's (the legacy path would CREATE a new family) but whose
 * identity the ER analysis confirmed.
 */
const ER_ROW = {
  record: {
    nem: "0555998877", // DIFFERENT phone — the legacy exact-match cannot bind
    nom: "SEDIKI ISHAK",
    classe: "1AP STG",
  },
  rowIndex: 42,
};

describe("T-438 C — the adapter seam (the T-414 EntityMatcher wiring)", () => {
  it("WITHOUT the matcher: the legacy path creates a NEW family (INV-40 — byte-identical pre-T-438)", async () => {
    const parents = new OneFamilyParentStub();
    const students = new RecordingStudentStub();
    const adapter = new RepositoryStorageAdapter({
      parents,
      students,
      tenantId: "00000000-0000-0000-0000-000000000001",
    });
    const etatSchema = { name: "etat" } as unknown as Parameters<typeof adapter.upsertRecordsBatch>[0];
    const results = await adapter.upsertRecordsBatch(etatSchema, [ER_ROW], ["NEM", "NOM"], "run-er-legacy");
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("insert");
    // The legacy path created the new family (the pre-T-438 behavior).
    expect(parents.created).toHaveLength(1);
    // The student landed under the NEWLY created parent — not the existing one.
    expect(students.rows).toHaveLength(1);
    expect(students.rows[0].parentId).not.toBe("par-er-1");
  });

  it("WITH a confirmed binding: the row binds to the EXISTING family through the canonical path (INV-50)", async () => {
    const parents = new OneFamilyParentStub();
    const students = new RecordingStudentStub();
    const bindings = new Map([[erImportRowObservationId(ER_ROW.rowIndex), "par-er-1"]]);
    const adapter = new RepositoryStorageAdapter({
      parents,
      students,
      tenantId: "00000000-0000-0000-0000-000000000001",
      entityMatcher: new ConfirmedEntityMatcher(bindings),
    });
    const etatSchema = { name: "etat" } as unknown as Parameters<typeof adapter.upsertRecordsBatch>[0];
    const results = await adapter.upsertRecordsBatch(etatSchema, [ER_ROW], ["NEM", "NOM"], "run-er-bound");
    expect(results).toHaveLength(1);
    // NO new family created — the confirmed binding routed the row to the
    // existing one (the aggregation: one profile, no duplicate).
    expect(parents.created).toHaveLength(0);
    expect(students.rows).toHaveLength(1);
    expect(students.rows[0].parentId).toBe("par-er-1");
  });

  it("an EMPTY confirmed matcher behaves exactly like no matcher (the NoOp contract)", async () => {
    const parents = new OneFamilyParentStub();
    const students = new RecordingStudentStub();
    const adapter = new RepositoryStorageAdapter({
      parents,
      students,
      tenantId: "00000000-0000-0000-0000-000000000001",
      entityMatcher: new ConfirmedEntityMatcher(new Map()),
    });
    const etatSchema = { name: "etat" } as unknown as Parameters<typeof adapter.upsertRecordsBatch>[0];
    await adapter.upsertRecordsBatch(etatSchema, [ER_ROW], ["NEM", "NOM"], "run-er-empty");
    // No bindings ⇒ the legacy path ⇒ the new family (same as without a matcher).
    expect(parents.created).toHaveLength(1);
    expect(students.rows[0].parentId).not.toBe("par-er-1");
  });

  it("the NoOpEntityMatcher (the T-414 default) leaves the path unchanged", async () => {
    const parents = new OneFamilyParentStub();
    const students = new RecordingStudentStub();
    const adapter = new RepositoryStorageAdapter({
      parents,
      students,
      tenantId: "00000000-0000-0000-0000-000000000001",
      entityMatcher: new NoOpEntityMatcher(),
    });
    const etatSchema = { name: "etat" } as unknown as Parameters<typeof adapter.upsertRecordsBatch>[0];
    await adapter.upsertRecordsBatch(etatSchema, [ER_ROW], ["NEM", "NOM"], "run-er-noop");
    expect(parents.created).toHaveLength(1); // the legacy path
  });
});

// ---------------------------------------------------------------------------
// D. The source-scan wiring guards (the repo's pin convention)
// ---------------------------------------------------------------------------

describe("T-438 D — the wiring source-guards", () => {
  it("the import modal gates EVERY ER construction behind the experimental flag (INV-40)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const modal = fs.readFileSync(
      path.resolve(process.cwd(), "src/features/crm/excel-import-modal.tsx"),
      "utf-8",
    );
    // The analysis runs only under the flag…
    expect(modal).toContain("isExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY)");
    // …and the matcher is built ONLY inside the same flag guard.
    const matcherConstruction = modal.indexOf("new ConfirmedEntityMatcher(");
    const flagGuard = modal.indexOf("isExperimentalEnabled(EXPERIMENTAL_ER_PMAE_KEY)");
    expect(flagGuard).toBeGreaterThan(-1);
    expect(matcherConstruction).toBeGreaterThan(flagGuard);
  });

  it("the Settings page exposes the Expérimental tab (IDENT-101's only activation path)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const page = fs.readFileSync(
      path.resolve(process.cwd(), "src/features/settings/settings-page.tsx"),
      "utf-8",
    );
    expect(page).toContain('"experimental"');
    expect(page).toContain("<ExperimentalTab />");
  });

  it("the backup service carries the ER sections (INV-57 — the EXISTING system, never a parallel one)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const svc = fs.readFileSync(
      path.resolve(process.cwd(), "src/infrastructure/backup/backup-service.ts"),
      "utf-8",
    );
    expect(svc).toContain("erBackupSnapshot()");
    expect(svc).toContain("erBackupRestore(parsed)");
  });
});

// ---------------------------------------------------------------------------
// E. The observation builders
// ---------------------------------------------------------------------------

describe("T-438 D — the observation builders", () => {
  it("the shared id convention (the analysis ↔ matcher join key)", () => {
    expect(erImportRowObservationId(42)).toBe("import:row:42");
  });

  it("maps an ImportRecord to an observation (the family identity fields)", () => {
    const obs = erObservationFromImportRow(
      { nem: "0663701834/0770998877", nom: "SEDIKI, Ishak (NV)", classe: "1AP STG" },
      7,
      "xlsx:2027-2026.xlsx",
      "2026-2027",
    );
    expect(obs.id).toBe("import:row:7");
    expect(obs.sourceSystem).toBe("xlsx:2027-2026.xlsx");
    expect(obs.sourceRecordId).toBe("row-7");
    expect(obs.displayName).toBe("SEDIKI, Ishak (NV)");
    expect(obs.phones).toEqual(["0663701834/0770998877"]);
    expect(obs.tier).toBe("import");
    expect(obs.canonicalId).toBeNull();
    expect(obs.gradeLevelCode).not.toBeNull(); // the classe resolved
  });

  it("projects the roster (parents) as canonical observations", () => {
    const parents = [new OneFamilyParentStub().parent];
    const obs = erObservationsFromParents(parents);
    expect(obs).toHaveLength(1);
    expect(obs[0].id).toBe("canonical:par-er-1");
    expect(obs[0].sourceSystem).toBe("canonical");
    expect(obs[0].sourceRecordId).toBe("PAR-2026-ER01");
    expect(obs[0].tier).toBe("manual");
    expect(obs[0].canonicalId).toBe("par-er-1");
    expect(obs[0].phones).toContain("0663701834");
  });
});
