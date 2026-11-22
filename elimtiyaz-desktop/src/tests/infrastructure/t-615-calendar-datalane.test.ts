/**
 * t-615-calendar-datalane.test.ts — T-615 (CROSS-202): the exam & homework
 * CALENDAR DATA-LANE contract — one suite pinning the COMPLETE flow the
 * owner's calendar mandate names: "Exams and homework assignments are not
 * appearing on the website calendar, even when their dates and schedules
 * have been configured in the Pedagogy section."
 *
 * WHAT THIS PINS (the three layers of the lane, each against the REAL
 * artifacts — no re-implementations, source scans + schema parses + the
 * REAL repositories over the fake-client convention):
 *
 *   PEDAGOGY WRITE  →  DATABASE (0001 consolidated)  →  PORTAL READ
 *
 *   A. The exam write payload (SupabaseCalendarRepository insertRowOf,
 *      kind='exam' → kind='custom' + target_entity_type='exam') uses ONLY
 *      columns that exist in the CONSOLIDATED schema's calendar_events
 *      table — the wire contract cannot drift from the new-project chain.
 *   B. The parent read window survives the consolidation: 0001's
 *      calendar_events_select policy carries the exam-scoped parent branch
 *      (migration 0154's semantics — parents see exam rows scoped to their
 *      children's classes), and calendar_events_admin keeps the SEC-117
 *      staff role check.
 *   C. The homework write payload (SupabaseHomeworkRepository.push) uses
 *      ONLY columns that exist in the consolidated schema's homework table,
 *      INCLUDING tenant_id (HOMEWORK-100) and due_date (the calendar's
 *      date axis).
 *   D. The homework parent-read policy is tenant-scoped with NO role
 *      restriction (homework_canonical_select) — every authenticated
 *      parent in the tenant reads their children's homework.
 *   E. The PORTAL reads both populations through the canonical hooks
 *      (useEventsInRange on calendar_events; useHomeworkForClasses on
 *      homework), detects exams by the documented target_entity_type
 *      contract, and derives the calendar dateKey from due_date/start_at
 *      LOCAL slices (UI-343) — pinned by source scans of the sibling
 *      website repo (skipped gracefully when absent; the t-525/test-12
 *      convention).
 *   F. PERSISTENCE (the "remain visible after refreshing" criterion): a
 *      SECOND repository instance over the same client re-reads the pushed
 *      homework rows — the restart/refresh semantics for the homework lane
 *      (the calendar's test-10 pin covers the exam lane).
 *
 * WHY THIS SUITE EXISTS: T-525 fixed the exam/homework visibility defects
 * (UI-343 + CROSS-201 + SEC-117) against the OLD migration chain; the
 * 2026-11 relocation consolidated that chain into 0001..0005 for the NEW
 * project. Nothing pinned that the consolidation PRESERVED the lane — a
 * future chain edit could drop the parent read window or a homework column
 * and every calendar test would stay green (each layer's tests mock its
 * neighbours). This suite is the cross-layer pin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { SupabaseCalendarRepository } from "../../infrastructure/supabase/repositories/supabase-calendar-repository";
import { SupabaseHomeworkRepository } from "../../infrastructure/supabase/repositories/supabase-academic-repository";

// ============================================================================
// The consolidated chain of record (the NEW project's schema source)
// ============================================================================

const CONSOLIDATED_0001 = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/0001_initial_consolidated_schema.sql"),
  "utf-8",
);

/** Extract a `create table public.<name> (...)` block's column names. */
function tableColumns(tableName: string): Set<string> {
  const re = new RegExp(`create table public\\.${tableName}\\s*\\(([^;]+?)\\n\\);`, "s");
  const m = re.exec(CONSOLIDATED_0001);
  expect(m, `the consolidated 0001 must contain create table public.${tableName}`).toBeTruthy();
  const body = m![1];
  const cols = new Set<string>();
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--")) continue;
    // Column lines start with an identifier; constraint/index lines start
    // with 'constraint'/'primary key'/'unique'/'check'/'foreign key'.
    const colMatch = /^([a-z_][a-z0-9_]*)\s/.exec(line);
    if (colMatch && !/^(constraint|primary|unique|check|foreign|exclude)$/i.test(colMatch[1])) {
      cols.add(colMatch[1]);
    }
  }
  return cols;
}

/** Extract a `create policy <name> on public.<table> ...;` block. */
function policyBlock(policyName: string): string {
  const re = new RegExp(`create policy ${policyName} on public\\.[a-z_]+\\s*[^;]+;`, "s");
  const m = re.exec(CONSOLIDATED_0001);
  expect(m, `the consolidated 0001 must contain the ${policyName} policy`).toBeTruthy();
  return m![0];
}

// ============================================================================
// Fake Supabase client (the supabase-calendar-repository.test.ts convention)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private maybeMode = false;
  private orderCol = "";
  private orderAsc = true;

  constructor(
    private readonly table: Row[],
    private readonly onInsert?: (payload: Row) => void,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters.push((r) => String(r[col]) >= String(val));
    return this;
  }
  lt(col: string, val: unknown): this {
    this.filters.push((r) => String(r[col]) < String(val));
    return this;
  }
  in(col: string, vals: readonly unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(_n: number): this {
    return this;
  }
  select(_cols?: string): this {
    return this;
  }
  insert(row: Row): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row): this {
    this.mode = "update";
    this.payload = patch;
    return this;
  }
  single(): this {
    this.wantSingle = true;
    return this;
  }
  maybeSingle(): this {
    this.wantSingle = true;
    this.maybeMode = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { message: string } | null } {
    if (this.mode === "insert") {
      // Capture the REPOSITORY's payload verbatim (before the fake's own
      // default columns) — the wire-contract assertions read the capture,
      // never the decorated row.
      this.onInsert?.({ ...(this.payload ?? {}) });
      const row = {
        id: `new-row-${this.table.length + 1}`,
        created_at: "2026-11-22T10:00:00Z",
        updated_at: "2026-11-22T10:00:00Z",
        is_deleted: false,
        ...this.payload,
      };
      this.table.push(row);
      return { data: row, error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      if (this.wantSingle) {
        if (patched.length === 0) return { data: null, error: { message: "no rows (PGRST116)" } };
        return { data: patched[0], error: null };
      }
      return { data: patched, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[this.orderCol] ?? "").localeCompare(String(b[this.orderCol] ?? ""));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.wantSingle) {
      if (rows.length === 0) {
        return this.maybeMode
          ? { data: null, error: null }
          : { data: null, error: { message: "no rows (PGRST116)" } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(onFulfilled!(this.run() as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  /** The verbatim repository insert payloads, in order (per table). */
  insertCaptures: Record<string, Row[]> = {};

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    if (!this.insertCaptures[tableName]) this.insertCaptures[tableName] = [];
    return new FakeQuery(this.tables[tableName], (payload) => {
      this.insertCaptures[tableName].push(payload);
    });
  }

  async rpc(
    _fn: string,
    _args?: Record<string, unknown>,
  ): Promise<{ data: Row[] | null; error: { code?: string; message?: string } | null }> {
    // The version-skew shape (PGRST202) — the auto-releve side effect warns
    // and continues; the primary write is what this suite asserts.
    return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  }
}

const TENANT = "00000000-0000-0000-0000-000000000001";
const STAFF_PROFILE = "bbbbbbbb-0000-0000-0000-0000000000b1";
const CLASS_ID = "cccccccc-0000-0000-0000-0000000000c1";
const SUBJECT_ID = "eeeeeeee-0000-0000-0000-0000000000e1";
const TEACHER_ID = "ffffffff-0000-0000-0000-0000000000f1";

// T-053 (TENANT-103): the tenant context is the session's working tenant.
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: STAFF_PROFILE }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// A + B — the EXAM lane: write payload ↔ consolidated schema ↔ parent window
// ============================================================================

describe("T-615 A — the exam write payload vs the CONSOLIDATED calendar_events schema", () => {
  it("insertRowOf(kind='exam') emits ONLY columns the consolidated 0001 declares", async () => {
    const fake = new FakeClient();
    const client = fake as unknown as SupabaseClient;
    const repo = new SupabaseCalendarRepository(client);
    const result = await repo.create({
      kind: "exam",
      title: "Examen de mathématiques",
      date: "2026-11-24",
      time: "09:00",
      description: "Chapitres 1–4",
      priority: "high",
      createdBy: STAFF_PROFILE,
      classId: CLASS_ID,
      room: "Salle 12",
      invigilatorName: "M. KADRI",
    });
    expect(result.ok).toBe(true);

    // The VERBATIM repository payload (the fake's own default columns
    // excluded) — this is the wire contract.
    const inserted = fake.insertCaptures["calendar_events"]![0];
    const schemaCols = tableColumns("calendar_events");
    for (const key of Object.keys(inserted)) {
      expect(
        schemaCols.has(key),
        `the exam insert payload carries "${key}" which is NOT a calendar_events column in the consolidated 0001 — the wire contract drifted from the chain`,
      ).toBe(true);
    }
  });

  it("the persisted PHYSICAL contract: kind='custom' + target_entity_type='exam' + the class scoping", async () => {
    const fake = new FakeClient();
    const client = fake as unknown as SupabaseClient;
    const repo = new SupabaseCalendarRepository(client);
    await repo.create({
      kind: "exam",
      title: "Examen",
      date: "2026-11-24",
      time: null,
      description: null,
      priority: "medium",
      createdBy: STAFF_PROFILE,
      classId: CLASS_ID,
      room: "Salle 12",
      invigilatorName: "M. KADRI",
    });
    const row = fake.tables["calendar_events"]![0];
    // 0013's CHECK is untouched (no 'exam' kind value)…
    expect(row.kind).toBe("custom");
    // …and the portal's detection contract is the target_entity_type marker.
    expect(row.target_entity_type).toBe("exam");
    expect(row.target_entity_id).toBe(CLASS_ID);
    expect(row.location).toBe("Salle 12");
    expect(row.target_name).toBe("M. KADRI");
    expect(row.tenant_id).toBe(TENANT);
  });
});

describe("T-615 B — the consolidated RLS keeps the parent read window + the staff gate", () => {
  it("calendar_events_select carries the exam-scoped PARENT branch (0154's semantics survived the consolidation)", () => {
    const policy = policyBlock("calendar_events_select");
    // The parent branch: has_role('parent') AND target_entity_type='exam'
    // AND the class scoping through the parent's children. (The consolidated
    // chain renders the literals as 'parent'::text / 'exam'::text.)
    expect(policy).toContain("has_role('parent'::text)");
    expect(policy).toContain("target_entity_type = 'exam'::text");
    expect(policy).toContain("p.auth_user_id = auth.uid()");
    expect(policy).toContain("s.class_id");
  });

  it("calendar_events_admin keeps the SEC-117 staff role check (parents cannot write staff events)", () => {
    const policy = policyBlock("calendar_events_admin");
    // The FOR ALL policy must be GATED by the staff role list — never a bare
    // tenant-scoped grant (SEC-117's live-proven parent-write window).
    expect(policy).toContain("for all");
    expect(policy).toContain("has_any_role");
    expect(policy).toContain("'super_admin'::text");
    expect(policy).toContain("'teacher'::text");
  });

  it("the physical kind CHECK still has NO 'exam' value (the adapter, not the enum)", () => {
    const check = CONSOLIDATED_0001.match(/calendar_events_kind_check[^;]+;/s)?.[0] ?? "";
    expect(check).toContain("'custom'");
    expect(check).not.toContain("'exam'");
  });
});

// ============================================================================
// C + D — the HOMEWORK lane: write payload ↔ consolidated schema ↔ parent read
// ============================================================================

describe("T-615 C — the homework write payload vs the CONSOLIDATED homework schema", () => {
  it("push() emits ONLY columns the consolidated 0001 declares — including tenant_id and due_date", async () => {
    const fake = new FakeClient();
    const client = fake as unknown as SupabaseClient;
    // The push resolves the subject name + the current academic year first.
    fake.tables["subjects"] = [{ id: SUBJECT_ID, name_fr: "Mathématiques" }];
    fake.tables["academic_years"] = [
      { id: "ay-1", code: "2026-2027", label: "2026-2027", is_current: true },
    ];
    const repo = new SupabaseHomeworkRepository(client);
    const result = await repo.push({
      classId: CLASS_ID,
      subjectId: SUBJECT_ID,
      teacherId: TEACHER_ID,
      teacherName: "M. KADRI",
      title: "Devoir 3 — fractions",
      description: "Exercices 1 à 8, page 42",
      dueDate: "2026-11-26",
      attachments: [],
    });
    expect(result.ok).toBe(true);

    // The VERBATIM repository payload (the fake's own default columns
    // excluded) — this is the wire contract.
    const inserted = fake.insertCaptures["homework"]![0];
    const schemaCols = tableColumns("homework");
    for (const key of Object.keys(inserted)) {
      expect(
        schemaCols.has(key),
        `the homework push payload carries "${key}" which is NOT a homework column in the consolidated 0001 — the wire contract drifted from the chain`,
      ).toBe(true);
    }
    // The three columns the portal's calendar derivation consumes:
    expect(inserted.tenant_id).toBe(TENANT); // HOMEWORK-100
    expect(inserted.class_id).toBe(CLASS_ID); // the per-class scoping
    expect(inserted.due_date).toBe("2026-11-26"); // the calendar's date axis
  });

  it("push() REFUSES non-uuid ids (the ACAD-501/UUID guard — no mock-era ids reach the wire)", async () => {
    const fake = new FakeClient();
    const repo = new SupabaseHomeworkRepository(fake as unknown as SupabaseClient);
    const bad = await repo.push({
      classId: `class-${CLASS_ID}`,
      subjectId: SUBJECT_ID,
      teacherId: TEACHER_ID,
      teacherName: "M. KADRI",
      title: "X",
      description: "X",
      dueDate: "2026-11-26",
      attachments: [],
    });
    expect(bad.ok).toBe(false);
    expect(fake.tables["homework"]).toBeUndefined();
  });
});

describe("T-615 D — the consolidated homework RLS lets PARENTS read (no role restriction)", () => {
  it("homework_canonical_select is tenant-scoped with NO role gate — parents read the lane", () => {
    const policy = policyBlock("homework_canonical_select");
    expect(policy).toContain("for select");
    expect(policy).toContain("tenant_id = current_tenant_id()");
    expect(policy).not.toContain("has_any_role");
    expect(policy).not.toContain("has_role");
  });
});

// ============================================================================
// E — the PORTAL read shape (source scans of the sibling website repo)
// ============================================================================

describe("T-615 E — the portal reads BOTH populations through the canonical hooks", () => {
  const websiteRoot = path.resolve(__dirname, "../../../../../../elimtiyaz-website");

  function readWebsite(rel: string): string | null {
    const p = path.join(websiteRoot, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
  }

  it("calendar-view consumes the month-RANGE query + the ALL-children homework hook + the exam contract", () => {
    const view = readWebsite("src/features/calendar/calendar-view.tsx");
    if (!view) return; // sibling repo absent — the graceful-skip convention (test 12)
    expect(view).toContain("useEventsInRange(rangeStart, rangeEnd)");
    expect(view).toContain("useHomeworkForClasses(homeworkClassIds");
    expect(view).toContain('target_entity_type === "exam"');
    expect(view).toContain("hw.due_date.slice(0, 10)");
    expect(view).toContain("ev.start_at.slice(0, 10)");
    expect(view).toContain("localDateKey(day.date)");
  });

  it("portal-queries: useEventsInRange reads calendar_events with the range bounds; useHomeworkForClasses reads homework per class", () => {
    const queries = readWebsite("src/lib/hooks/portal-queries.ts");
    if (!queries) return;
    // The events-range query (the month grid's source):
    expect(queries).toContain('from("calendar_events")');
    expect(queries).toContain(".is(\"is_deleted\", false)");
    expect(queries).toContain(".gte(\"start_at\", rangeStart)");
    expect(queries).toContain(".lte(\"start_at\", rangeEnd)");
    // The homework-classes query (deduped across the parent's children):
    expect(queries).toContain('from("homework")');
    expect(queries).toContain(".eq(\"class_id\", classId)");
    expect(queries).toContain('.order("due_date", { ascending: true })');
  });

  it("the homework rows the desktop writes ARE the rows the portal's HomeworkRow describes", () => {
    const types = readWebsite("src/lib/types/database.ts");
    if (!types) return;
    // The calendar's derivation needs due_date + title + class_id on the
    // typed row — the same columns T-615 C pinned on the write side.
    for (const field of ["due_date", "title", "class_id", "subject_name"]) {
      expect(types).toContain(field);
    }
  });
});

// ============================================================================
// F — PERSISTENCE: the refresh/restart semantics of the homework lane
// ============================================================================

describe("T-615 F — homework persistence-across-restart (the refresh criterion)", () => {
  it("a SECOND repository instance reads the rows the first pushed (no in-memory-only state)", async () => {
    const fake = new FakeClient();
    const client = fake as unknown as SupabaseClient;
    fake.tables["subjects"] = [{ id: SUBJECT_ID, name_fr: "Mathématiques" }];
    fake.tables["academic_years"] = [
      { id: "ay-1", code: "2026-2027", label: "2026-2027", is_current: true },
    ];
    const writer = new SupabaseHomeworkRepository(client);
    await writer.push({
      classId: CLASS_ID,
      subjectId: SUBJECT_ID,
      teacherId: TEACHER_ID,
      teacherName: "M. KADRI",
      title: "Devoir 3 — fractions",
      description: "Exercices 1 à 8",
      dueDate: "2026-11-26",
      attachments: [],
    });

    // A fresh instance (the app restart / portal refresh analogue) must see
    // the row through the SAME table — the t-525 calendar test-10 pattern.
    const reader = new SupabaseHomeworkRepository(client);
    const stream = reader.observeForClass(CLASS_ID);
    // The fetch is an async chain (client.from → await → sub.set) — drain
    // the microtask queue with a macrotask tick, polling until the stream
    // is seeded (bounded — a hang fails the suite, never silently passes).
    for (let i = 0; i < 20; i++) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((stream as any).get() as Row[]).length > 0) break;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (stream as any).get() as Row[];
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Devoir 3 — fractions");
    expect(rows[0].dueDate).toBe("2026-11-26");
  });
});
