/**
 * T-481 — the Relevé Supabase port (WORKFORCE-508): the repository mapping
 * contract + the tab's canonical §09.05 redesign, pinned as unit tests
 * (the fake-client convention) and source guards (the t-374 convention).
 *
 * Repository pins:
 *   1. logEntry() writes the canonical shape: personnel_id (the member),
 *      recorded_by (the ACTING admin), clock_in_at/clock_out_at built in
 *      Africa/Algiers (+01:00) from the date + decimal hours, the activity
 *      vocabulary verbatim.
 *   2. Read mapping: date + decimal hours derive BACK from the timestamps
 *      in Algiers; personnelName via the personnel embed; DB 'admin' folds
 *      to domain 'other'.
 *   3. The UUID guards: a mock-era personnel id or recorder id is refused
 *      BEFORE the table (the T-178 precedent).
 *   4. The validation guards: bad date, out-of-range hours, hoursOut ≤
 *      hoursIn.
 *   5. A non-null subjectId is folded into the description (never silently
 *      dropped — the 0009 table has no subject column).
 *   6. Persistence across a repository re-instantiation.
 *
 * Tab pins (source guards):
 *   7. The tab keys the ledger by the PERSONNEL id (me.id / the selected
 *      member) — the pre-T-481 session.userId keying is gone.
 *   8. The admin form records FOR a selected member with recordedById =
 *      the acting session (the §09.05 contract); the teacher view has no
 *      write form.
 *   9. The wiring override exists.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseReleveRepository } from "../../infrastructure/supabase/repositories/supabase-releve-repository";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Fake Supabase client (the t-239/t-479 convention)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(private readonly table: Row[]) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
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
  single(): this {
    this.wantSingle = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert") {
      const row = {
        id: "rel-uuid-new",
        tenant_id: "irrelevant",
        recorded_at: "2026-10-04T10:00:00Z",
        created_at: "2026-10-04T10:00:00Z",
        duration_minutes: null,
        class_subject_id: null,
        ...this.payload,
      };
      this.table.push(row);
      return { data: row, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[this.orderCol] ?? "").localeCompare(String(b[this.orderCol] ?? ""));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle) {
      if (rows.length === 0) return { data: null, error: { message: "no rows (PGRST116)" } };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { code?: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(onFulfilled!(this.run() as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName]);
  }
}

const fakeClient = new FakeClient();

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const MEMBER_ID = "eeeeeeee-0000-0000-0000-0000000000e1";
const ADMIN_ACCOUNT = "cccccccc-0000-0000-0000-0000000000c1";

beforeEach(() => {
  fakeClient.tables = {};
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: ADMIN_ACCOUNT }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

function makeRepo(): SupabaseReleveRepository {
  return new SupabaseReleveRepository(fakeClient as unknown as SupabaseClient);
}

/** Let the async seed()/refresh() promises settle (the t-239 convention). */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

// ============================================================================
// Repository tests
// ============================================================================

describe("SupabaseReleveRepository (T-481 / WORKFORCE-508)", () => {
  it("1. logEntry() writes the canonical §09.05 shape", async () => {
    const repo = makeRepo();
    const result = await repo.logEntry({
      personnelId: MEMBER_ID,
      personnelName: "Amine Belkacem",
      date: "2026-10-04",
      hoursIn: 8.5,
      hoursOut: 14.25,
      activity: "course",
      classId: null,
      subjectId: null,
      recordedById: ADMIN_ACCOUNT,
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["releve_entries"][0];
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["personnel_id"]).toBe(MEMBER_ID);
    expect(row["recorded_by"]).toBe(ADMIN_ACCOUNT);
    expect(row["activity_type"]).toBe("course");
    // Decimal hours → Algiers (+01:00) timestamps.
    expect(row["clock_in_at"]).toBe("2026-10-04T08:30:00+01:00");
    expect(row["clock_out_at"]).toBe("2026-10-04T14:15:00+01:00");
    // Round-trips through the read mapping.
    if (result.ok) {
      expect(result.value.date).toBe("2026-10-04");
      expect(result.value.hoursIn).toBeCloseTo(8.5, 6);
      expect(result.value.hoursOut).toBeCloseTo(14.25, 6);
      expect(result.value.personnelId).toBe(MEMBER_ID);
    }
  });

  it("2. read mapping: the personnel embed + the 'admin'→'other' + 'surveillance'→'supervision' folds", async () => {
    fakeClient.tables["releve_entries"] = [
      {
        id: "rel-uuid-1",
        tenant_id: TENANT,
        personnel_id: MEMBER_ID,
        activity_type: "admin",
        class_id: null,
        class_subject_id: null,
        description: "Conseil de discipline",
        clock_in_at: "2026-10-01T10:00:00+01:00",
        clock_out_at: "2026-10-01T12:00:00+01:00",
        duration_minutes: 120,
        recorded_by: ADMIN_ACCOUNT,
        recorded_at: "2026-10-01T12:05:00Z",
        created_at: "2026-10-01T12:05:00Z",
        personnel: { first_name: "Amine", last_name: "Belkacem" },
      },
      {
        id: "rel-uuid-2",
        tenant_id: TENANT,
        personnel_id: MEMBER_ID,
        activity_type: "surveillance", // the 0009 French spelling (historical rows)
        class_id: null,
        class_subject_id: null,
        description: null,
        clock_in_at: "2026-10-02T09:00:00+01:00",
        clock_out_at: null,
        duration_minutes: null,
        recorded_by: ADMIN_ACCOUNT,
        recorded_at: "2026-10-02T09:05:00Z",
        created_at: "2026-10-02T09:05:00Z",
        personnel: { first_name: "Amine", last_name: "Belkacem" },
      },
    ];
    const repo = makeRepo();
    const obs = repo.observeByPersonnel(MEMBER_ID, "2026-09-01", "2026-10-31");
    await settle();
    const entries = obs.get();
    expect(entries.length).toBe(2);
    const e = entries.find((x) => x.id === "rel-uuid-1")!;
    expect(e.personnelName).toBe("Amine Belkacem");
    expect(e.activity).toBe("other"); // the DB-only 'admin' folds to 'other'
    expect(e.note).toBe("Conseil de discipline");
    expect(e.date).toBe("2026-10-01");
    expect(e.hoursIn).toBeCloseTo(10, 6);
    expect(e.hoursOut).toBeCloseTo(12, 6);
    // The 0140 alias fold: the 0009 French spelling reads as the clients'
    // wire code 'supervision'.
    const s = entries.find((x) => x.id === "rel-uuid-2")!;
    expect(s.activity).toBe("supervision");
    // The window filter is applied client-side.
    const empty = repo.observeByPersonnel(MEMBER_ID, "2026-01-01", "2026-01-31");
    expect(empty.get().length).toBe(0);
  });

  it("2b. the domain 'supervision' writes VERBATIM (the 0140-widened CHECK admits it)", async () => {
    const repo = makeRepo();
    const result = await repo.logEntry({
      personnelId: MEMBER_ID,
      personnelName: "Amine Belkacem",
      date: "2026-10-04",
      hoursIn: 10,
      hoursOut: 12,
      activity: "supervision",
      classId: null,
      subjectId: null,
      recordedById: ADMIN_ACCOUNT,
    });
    expect(result.ok).toBe(true);
    expect(fakeClient.tables["releve_entries"][0]["activity_type"]).toBe("supervision");
    if (result.ok) expect(result.value.activity).toBe("supervision");
  });

  it("3. mock-era ids are refused BEFORE the table (T-178 guard)", async () => {
    const repo = makeRepo();
    const r1 = await repo.logEntry({
      personnelId: "per-001", personnelName: "X", date: "2026-10-04",
      hoursIn: 8, hoursOut: null, activity: "course", classId: null,
      subjectId: null, recordedById: ADMIN_ACCOUNT,
    });
    const r2 = await repo.logEntry({
      personnelId: MEMBER_ID, personnelName: "X", date: "2026-10-04",
      hoursIn: 8, hoursOut: null, activity: "course", classId: null,
      subjectId: null, recordedById: "usr-current",
    });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(fakeClient.tables["releve_entries"] ?? []).toHaveLength(0);
  });

  it("4. validation guards: bad date / hours / ordering", async () => {
    const repo = makeRepo();
    const base = {
      personnelId: MEMBER_ID, personnelName: "X", classId: null,
      subjectId: null, recordedById: ADMIN_ACCOUNT, activity: "course" as const,
    };
    const badDate = await repo.logEntry({ ...base, date: "04/10/2026", hoursIn: 8, hoursOut: null });
    const badHours = await repo.logEntry({ ...base, date: "2026-10-04", hoursIn: 25, hoursOut: null });
    const badOrder = await repo.logEntry({ ...base, date: "2026-10-04", hoursIn: 10, hoursOut: 9 });
    expect(badDate.ok).toBe(false);
    expect(badHours.ok).toBe(false);
    expect(badOrder.ok).toBe(false);
    expect(fakeClient.tables["releve_entries"] ?? []).toHaveLength(0);
  });

  it("5. a non-null subjectId is folded into the description (never dropped)", async () => {
    const repo = makeRepo();
    const result = await repo.logEntry({
      personnelId: MEMBER_ID,
      personnelName: "Amine Belkacem",
      date: "2026-10-04",
      hoursIn: 9,
      hoursOut: 10,
      activity: "correction",
      classId: null,
      subjectId: "subj-math-uuid",
      recordedById: ADMIN_ACCOUNT,
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["releve_entries"][0];
    expect(String(row["description"])).toContain("subj-math-uuid");
  });

  it("6. persistence across a repository re-instantiation", async () => {
    const first = makeRepo();
    await first.logEntry({
      personnelId: MEMBER_ID, personnelName: "Amine Belkacem",
      date: "2026-10-04", hoursIn: 8, hoursOut: 12, activity: "course",
      classId: null, subjectId: null, recordedById: ADMIN_ACCOUNT,
    });
    const second = new SupabaseReleveRepository(fakeClient as unknown as SupabaseClient);
    const obs = second.observeByPersonnel(MEMBER_ID, "2026-09-01", "2026-10-31");
    await settle();
    expect(obs.get().length).toBe(1);
    expect(obs.get()[0].hoursOut).toBeCloseTo(12, 6);
  });
});

// ============================================================================
// Source guards (the tab + the wiring + the contract)
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const SRC = path.resolve(path.dirname(__filename), "../..");

describe("T-481 — the ReleveTab canonical redesign (source guards)", () => {
  const tab = fs.readFileSync(path.join(SRC, "features/personnel/releve-tab.tsx"), "utf8");
  const wiring = fs.readFileSync(
    path.join(SRC, "infrastructure/supabase/supabase-repositories.ts"),
    "utf8",
  );

  it("7. the ledger key is the PERSONNEL id — the account-id keying is gone", () => {
    // The pre-T-481 wrong key (the exact statements)…
    expect(tab.includes("observeByPersonnel(session?.userId")).toBe(false);
    expect(tab.includes("personnelId: session.userId")).toBe(false);
    // …replaced by the personnel-keyed views (the selected member / me.id).
    expect(tab.includes("repos.releve.observeByPersonnel(viewedPersonnelId")).toBe(true);
    expect(tab.includes("personnelId: target.id")).toBe(true);
  });

  it("8. the admin form records FOR a member (recordedById = the session); teachers are read-only", () => {
    // The §09.05 recording contract.
    expect(tab.includes("recordedById: session.userId")).toBe(true);
    expect(tab.includes("recordedBy")).toBe(true);
    // The teacher path renders NO write form: the form is gated on isAdmin
    // and the description states the read-only rule.
    expect(tab.includes("{isAdmin && (")).toBe(true);
    expect(tab.includes("lecture seule")).toBe(true);
  });

  it("9. the wiring override exists + the mock honours the recordedById contract + the 0140 widening", () => {
    expect(wiring.includes("const releve = new SupabaseReleveRepository(client);")).toBe(true);
    expect(wiring.includes("releve, // T-481")).toBe(true);

    const mock = fs.readFileSync(
      path.join(SRC, "infrastructure/mock/repositories/personnel-audit-repository.ts"),
      "utf8",
    );
    expect(mock.includes("recordedById: string;")).toBe(true);
    expect(mock.includes("actorId: input.recordedById")).toBe(true);

    // 0140 widened the activity CHECK with 'supervision' (the clients'
    // shared wire code — the 0009 CHECK's French 'surveillance' would have
    // rejected every client Surveillance entry; the discovery of this port).
    const migration = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations/0140_releve_activity_supervision_alias.sql"),
      "utf8",
    );
    expect(migration.includes("'supervision'")).toBe(true);
    expect(migration.includes("'surveillance'")).toBe(true);
    expect(migration.includes("drop constraint releve_entries_activity_type_check")).toBe(true);
  });
});
