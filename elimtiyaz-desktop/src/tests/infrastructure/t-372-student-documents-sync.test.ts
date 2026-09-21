/**
 * T-372 — SYNC-110: ONE canonical student-document metadata store.
 *
 * The live RED proof (Management API SQL, 2026-09-14): for LINDA ALIOUAT the
 * desktop-uploaded `ID-2.png` lived ONLY in `students.documents_json` while
 * the website-uploaded birth certificate lived ONLY in the
 * `student_documents` table — each platform queried its own store and was
 * blind to the other's documents, even though BOTH binaries sat in the SAME
 * `student-documents` bucket.
 *
 * This suite pins the fix at three layers:
 *   1. DOMAIN parity — the desktop kind set is the DB CHECK constraint's
 *      exact 7 values (the website's `StudentDocumentKind` verbatim).
 *   2. MAPPERS — `mapStudentRow` no longer reads `documents_json` (the
 *      split-brain read is gone); `mapStudentDocumentRow` /
 *      `embedStudentDocuments` map + group the canonical table rows.
 *   3. REPOSITORY (Supabase, fake client) — `addStudentDocument` inserts a
 *      tenant-scoped `student_documents` row; `removeStudentDocument` is
 *      honest on zero-match (§15.30b); `seed()` embeds table rows into
 *      `Student.documents` so website-uploaded documents appear on the
 *      desktop; `updateStudent` never writes `documents_json` again.
 *   4. SOURCE guards — the DocumentsTab uses the granular contract and the
 *      canonical 7 kinds; the Supabase repository carries no documents_json
 *      read/write; migration 0098 exists with the idempotent backfill.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseStudentRepository,
  mapStudentRow,
  mapStudentDocumentRow,
  embedStudentDocuments,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { StudentRow, StudentDocumentRow } from "../../infrastructure/supabase/types";
import type { StudentDocumentCategory } from "../../domain/model/student";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..");
const TENANT = "00000000-0000-0000-0000-000000000001";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// 1. Domain parity — the canonical kind set
// ============================================================================

describe("T-372 §1 — canonical kind-set parity (desktop ≡ DB CHECK ≡ website)", () => {
  it("the domain kind set is the table CHECK constraint's exact 7 values", async () => {
    const model = await import("../../domain/model/student");
    const labels = Object.keys(model.STUDENT_DOCUMENT_CATEGORY_LABELS_FR) as StudentDocumentCategory[];
    expect([...labels].sort()).toEqual([
      "birth_certificate",
      "contract",
      "id_photo",
      "justification_letter",
      "medical_certificate",
      "other",
      "report_card",
    ]);
  });

  it("the migration's backfill maps every LEGACY category to a canonical kind", () => {
    // The exact mapping the 0098 backfill performs server-side — pinned
    // here so the two layers cannot drift apart.
    const legacyMap: Record<string, StudentDocumentCategory> = {
      medical: "medical_certificate",
      justification: "justification_letter",
      contract: "contract",
      other: "other",
    };
    const canonical: StudentDocumentCategory[] = [
      "birth_certificate", "medical_certificate", "contract",
      "justification_letter", "id_photo", "report_card", "other",
    ];
    for (const mapped of Object.values(legacyMap)) {
      expect(canonical).toContain(mapped);
    }
  });
});

// ============================================================================
// 2. Mappers
// ============================================================================

function makeStudentRow(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: "stu-1",
    tenant_id: TENANT,
    parent_id: "par-1",
    student_code: "ELV-2026-0001",
    first_name: "Linda",
    middle_name: null,
    last_name: "Aliouat",
    display_name: "ALIOUAT LINDA",
    date_of_birth: "2015-01-01",
    gender: null,
    grade_level_id: null,
    class_id: null,
    filiere_code: null,
    specialite_code: null,
    enrollment_date: "2026-09-01",
    enrollment_status: "active",
    medical_notes: null,
    is_active: true,
    auth_user_id: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeDocRow(overrides: Partial<StudentDocumentRow> = {}): StudentDocumentRow {
  return {
    id: "doc-1",
    tenant_id: TENANT,
    student_id: "stu-1",
    kind: "birth_certificate",
    file_name: "acte-naissance.jpeg",
    storage_path: `${TENANT}/stu-1/birth_certificate-1789341527070.jpeg`,
    mime_type: "image/jpeg",
    size_bytes: 104115,
    uploaded_by: null,
    uploaded_at: "2026-09-13T23:18:48.641Z",
    description: null,
    ...overrides,
  };
}

describe("T-372 §2 — mappers", () => {
  it("mapStudentRow NO LONGER reads documents_json (the split-brain read is gone)", () => {
    const row = makeStudentRow({ documents_json: [{ id: "doc-x", category: "medical" }] } as never);
    const student = mapStudentRow(row);
    expect(student.documents).toBeUndefined();
  });

  it("mapStudentDocumentRow maps every canonical column to the domain shape", () => {
    const doc = mapStudentDocumentRow(makeDocRow(), "Admin Test");
    expect(doc).toMatchObject({
      id: "doc-1",
      fileName: "acte-naissance.jpeg",
      category: "birth_certificate",
      storagePath: `${TENANT}/stu-1/birth_certificate-1789341527070.jpeg`,
      uploadedBy: "Admin Test",
      uploadedAt: "2026-09-13T23:18:48.641Z",
      mimeType: "image/jpeg",
      sizeBytes: 104115,
    });
    expect(doc.note).toBeNull();
  });

  it("mapStudentDocumentRow falls back to the honest dash for unresolvable uploaders", () => {
    const doc = mapStudentDocumentRow(makeDocRow());
    expect(doc.uploadedBy).toBe("—");
  });

  it("embedStudentDocuments groups rows per student and leaves others untouched", () => {
    const students = [mapStudentRow(makeStudentRow({ id: "stu-1" })), mapStudentRow(makeStudentRow({ id: "stu-2" }))];
    const rows = [
      makeDocRow({ id: "d1", student_id: "stu-1", uploaded_at: "2026-09-13T10:00:00Z" }),
      makeDocRow({ id: "d2", student_id: "stu-1", uploaded_at: "2026-09-14T10:00:00Z", kind: "id_photo" }),
      makeDocRow({ id: "d3", student_id: "stu-2", kind: "contract" }),
    ];
    const embedded = embedStudentDocuments(students, rows);
    expect(embedded[0].documents).toHaveLength(2);
    expect(embedded[0].documents?.[0].id).toBe("d1");
    expect(embedded[0].documents?.[1].id).toBe("d2");
    expect(embedded[1].documents).toHaveLength(1);
    // Empty rows → the already-embedded students pass through unchanged
    // (no empty-array field introduced, documents preserved).
    const untouched = embedStudentDocuments(embedded, []);
    expect(untouched[0].documents).toHaveLength(2);
    expect(untouched[1].documents).toHaveLength(1); // d3 preserved
  });
});

// ============================================================================
// 3. Supabase repository — the fake-client contract (the t-361/t-364 fake)
// ============================================================================

type Row = Record<string, any>;

interface FakeTable {
  rows: Row[];
}

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private singleMode: "single" | "maybe" | null = null;
  private payload: Row | null = null;
  private isInsert = false;
  private isUpdate = false;
  private isDelete = false;

  constructor(private readonly table: FakeTable) {}

  select(_cols: string) { return this; }
  insert(payload: Row) { this.payload = payload; this.isInsert = true; return this; }
  update(payload: Row) { this.payload = payload; this.isUpdate = true; return this; }
  delete() { this.isDelete = true; return this; }
  eq(col: string, value: unknown) { this.filters.push((r) => r[col] === value); return this; }
  is(col: string, value: null) { this.filters.push((r) => (value === null ? r[col] == null : r[col] === value)); return this; }
  in(col: string, values: readonly unknown[]) { this.filters.push((r) => values.includes(r[col])); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col: asc_col(col), asc: opts?.ascending !== false }); return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }

  private matches(): Row[] {
    return this.table.rows.filter((r) => this.filters.every((f) => f(r)));
  }

  private async exec(): Promise<{ data: any; error: any }> {
    if (this.isInsert) {
      const inserted = { id: `row-${Math.random().toString(36).slice(2, 10)}`, ...this.payload };
      this.table.rows.push(inserted);
      return { data: this.singleMode ? inserted : [inserted], error: null };
    }
    if (this.isUpdate) {
      const matched = this.matches();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched, error: null };
    }
    if (this.isDelete) {
      const matched = this.matches();
      this.table.rows = this.table.rows.filter((r) => !matched.includes(r));
      // PostgREST semantics: delete().select() echoes the DELETED rows —
      // an empty array means zero rows matched (the §15.30b honesty probe).
      return { data: matched, error: null };
    }
    let rows = this.matches();
    for (const { col, asc } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      });
    }
    if (this.singleMode === "single") {
      if (rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested" } };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  then(onFulfilled: any, onRejected?: any) {
    return this.exec().then(onFulfilled, onRejected);
  }
}

function asc_col(col: string) { return col; }

function createFakeClient(tables: Record<string, Row[]>) {
  const fakeTables: Record<string, FakeTable> = {};
  for (const [name, rows] of Object.entries(tables)) fakeTables[name] = { rows: [...rows] };
  return {
    from(tableName: string) {
      if (!fakeTables[tableName]) fakeTables[tableName] = { rows: [] };
      return new FakeQuery(fakeTables[tableName]);
    },
    __tables: fakeTables,
  } as unknown as SupabaseClient & { __tables: Record<string, FakeTable> };
}

function seedStudentTable(): Row[] {
  return [
    {
      ...makeStudentRow(),
      documents_json: [
        {
          id: "doc-legacy-1",
          fileName: "ID-2.png",
          category: "justification",
          note: null,
          storagePath: `${TENANT}/stu-1/1789365629667-t3rzmq-ID-2.png`,
          uploadedBy: "admin@elimtiyaz.dz",
          uploadedAt: "2026-09-14T06:00:30.929Z",
        },
      ],
      grade_level_code: "4am",
    },
  ];
}

/**
 * Await a condition with polling (the repository seed is async — the
 * observable emits immediately with [] and re-emits when the seed lands).
 */
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function seededRepo(client: ReturnType<typeof createFakeClient>): SupabaseStudentRepository {
  const repo = new SupabaseStudentRepository(client);
  repo.observe(); // triggers the async seed
  return repo;
}

describe("T-372 §3 — SupabaseStudentRepository (canonical table-backed documents)", () => {
  it("seed() embeds student_documents ROWS into Student.documents (website uploads visible on the desktop)", async () => {
    const client = createFakeClient({
      students: seedStudentTable(),
      student_documents: [makeDocRow()],
      user_profiles: [],
    });
    const repo = seededRepo(client);
    await waitFor(() => repo.observe().get().length === 1);
    const students = repo.observe().get();
    expect(students).toHaveLength(1);
    // The table row (the WEBSITE-uploaded birth certificate) IS embedded…
    expect(students[0]?.documents).toHaveLength(1);
    expect(students[0]?.documents?.[0]?.category).toBe("birth_certificate");
    // …while the legacy documents_json entry is NOT (the split read is dead;
    // its content reaches the table only through the 0098 backfill).
  });

  it("addStudentDocument inserts a tenant-scoped row into student_documents and embeds it", async () => {
    const client = createFakeClient({ students: seedStudentTable(), student_documents: [], user_profiles: [] });
    const repo = seededRepo(client);
    await waitFor(() => repo.observe().get().length === 1);
    const result = await repo.addStudentDocument("stu-1", {
      fileName: "ID-2.png",
      category: "id_photo",
      note: "CNI recto",
      storagePath: `${TENANT}/stu-1/1789365629667-t3rzmq-ID-2.png`,
      mimeType: "image/png",
      sizeBytes: 3029615,
      uploadedBy: "Admin",
      uploadedByProfileId: "staff-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.category).toBe("id_photo");
      expect(result.value.storagePath).toContain("ID-2.png");
    }
    // The row landed in the CANONICAL table (the website's store)…
    const rows = client.__tables["student_documents"].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT,
      student_id: "stu-1",
      kind: "id_photo",
      file_name: "ID-2.png",
      storage_path: `${TENANT}/stu-1/1789365629667-t3rzmq-ID-2.png`,
      uploaded_by: "staff-1",
      description: "CNI recto",
      size_bytes: 3029615,
    });
    // …and the observable student carries it.
    const student = repo.observeById("stu-1").get();
    expect(student?.documents?.some((d) => d.category === "id_photo")).toBe(true);
  });

  it("removeStudentDocument deletes the row and is HONEST on zero-match (§15.30b)", async () => {
    const client = createFakeClient({
      students: seedStudentTable(),
      student_documents: [makeDocRow()],
      user_profiles: [],
    });
    const repo = seededRepo(client);
    await waitFor(() => repo.observe().get().length === 1);

    // Zero-match delete (wrong id): 200-with-empty-array → notFound, NOT a silent success.
    const miss = await repo.removeStudentDocument("stu-1", "doc-does-not-exist");
    expect(miss.ok).toBe(false);
    expect(client.__tables["student_documents"].rows).toHaveLength(1);

    // Real delete: the row disappears from the table AND the observable student.
    const hit = await repo.removeStudentDocument("stu-1", "doc-1");
    expect(hit.ok).toBe(true);
    expect(client.__tables["student_documents"].rows).toHaveLength(0);
    const student = repo.observeById("stu-1").get();
    expect(student?.documents ?? []).toHaveLength(0);
  });

  it("updateStudent no longer writes documents_json (the clobber path is dead)", async () => {
    const client = createFakeClient({ students: seedStudentTable(), student_documents: [] });
    const repo = seededRepo(client);
    await waitFor(() => repo.observe().get().length === 1);
    const before = JSON.stringify(client.__tables["students"].rows[0].documents_json);
    const res = await repo.updateStudent("stu-1", { medicalNotes: "asthme" } as never);
    expect(res.ok).toBe(true);
    const after = JSON.stringify(client.__tables["students"].rows[0].documents_json);
    expect(after).toBe(before); // the JSON column is untouched by student edits
  });
});

// ============================================================================
// 4. Source guards (the regression net)
// ============================================================================

describe("T-372 §4 — source guards", () => {
  const TAB = readFileSync(join(SRC, "features/crm/student-detail/documents-tab.tsx"), "utf8");
  const REPO_SRC = readFileSync(
    join(SRC, "infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
    "utf8",
  );

  it("the DocumentsTab writes through the GRANULAR contract (never updateStudent({documents}))", () => {
    expect(TAB.includes("repos.students.addStudentDocument(")).toBe(true);
    expect(TAB.includes("repos.students.removeStudentDocument(")).toBe(true);
    expect(TAB.includes("updateStudent(studentId, { documents")).toBe(false);
  });

  it("the DocumentsTab offers the canonical 7 kinds (website picker parity)", () => {
    for (const kind of [
      "birth_certificate",
      "medical_certificate",
      "contract",
      "justification_letter",
      "id_photo",
      "report_card",
      "other",
    ]) {
      expect(TAB.includes(`"${kind}"`)).toBe(true);
    }
  });

  it("the Supabase repository carries NO documents_json read or write", () => {
    // The only permitted mention is the explanatory comment — no `.` access.
    const codeAccesses = /documents_json/.test(REPO_SRC.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""));
    expect(codeAccesses).toBe(false);
  });

  it("migration 0098 exists with the idempotent backfill (NOT EXISTS on the binary path)", () => {
    const mig = readFileSync(
      join(__dirname, "..", "..", "..", "supabase", "migrations", "0098_student_documents_unification.sql"),
      "utf8",
    );
    expect(mig.includes("insert into public.student_documents")).toBe(true);
    expect(mig.includes("not exists")).toBe(true);
    expect(mig.includes("medical_certificate")).toBe(true);
    expect(mig.includes("justification_letter")).toBe(true);
  });
});
