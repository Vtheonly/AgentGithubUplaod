/**
 * T-396 / OPS-320 — the backend CRUD integration test suite.
 *
 * What this suite pins:
 *
 *   A. The RUNNER (pure logic, in-memory mock client — no network):
 *      - the healthy run: 27 checks, every phase present in order, all PASS;
 *      - run-unique probe codes (never a fixed code — re-runs never collide);
 *      - the prep short-circuit: no SDK session → prep FAIL + every write
 *        category NON TESTÉ (the T-393 honest third state);
 *      - an insert failure surfaces the ACTUAL error on that check and the
 *        suite CONTINUES (honest legs — one failure never aborts the run);
 *      - the validation legs: a blank-string uuid rejection (22P02) PASSES
 *        (the SYNC-300 pin); an ACCEPTED invalid call FAILS (« APPEL
 *        ACCEPTÉ À TORT »);
 *      - the FK-violation leg: 23503 surfaces the code;
 *      - the delete phase: the list shapes EXCLUDE the soft-deleted rows
 *        (the UI-consistency contract);
 *      - the cleanup leg: zero live residue after the run;
 *      - SAFETY: no token/key material ever appears in the report or its
 *        text form.
 *
 *   B. The VIEW (injected fake runner + fake client):
 *      - the run button invokes the runner with the canonical client + the
 *        domain session;
 *      - the transparency banner (this test WRITES probe rows) renders;
 *      - the PASS/FAIL matrix + the summary badges render.
 *
 * Run:
 *   npx vitest run src/tests/features/t-396-crud-integration.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runCrudIntegrationTests,
  expectedCrudCheckCount,
} from "../../features/settings/supabase-diagnostics/crud-test-runner";
import { formatDiagnosticsReportText } from "../../features/settings/supabase-diagnostics/diagnostics-runner";
import { CrudTestTab } from "../../features/settings/supabase-diagnostics/crud-test-tab";
import type { DiagnosticsReport } from "../../features/settings/supabase-diagnostics/diagnostics-types";

/* ------------------------------------------------------------------ */
/* The view needs useAuth — mock the provider (the t-393 pattern).     */
/* ------------------------------------------------------------------ */

const mockAuthSession: { userId: string; email: string } | null = {
  userId: "user-1",
  email: "admin@elimtiyaz.dz",
};
vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: mockAuthSession }),
}));

/* ================================================================== */
/* The in-memory mock client — a tiny stateful DB so read-backs        */
/* reflect writes (the consistency the suite verifies).                */
/* ================================================================== */

type Row = Record<string, unknown>;
type ErrShape = { code?: string; message?: string } | null;

interface DbState {
  parents: Row[];
  students: Row[];
  installments: Row[];
  ledger_entries: Row[];
}

interface MockOptions {
  /** Fail the SDK session check (prep short-circuit). */
  noSession?: boolean;
  /** Fail tenant resolution (prep short-circuit). */
  noTenant?: boolean;
  /** Fail the FIRST parent upsert RPC with this error. */
  parentInsertError?: ErrShape;
  /** Accept a blank-string uuid instead of rejecting (the negative case). */
  acceptBlankUuid?: boolean;
  /** Fail the update PATCH on parents. */
  updateError?: ErrShape;
  /** Fail soft_delete_parent. */
  deleteError?: ErrShape;
}

const TENANT = "00000000-0000-0000-0000-000000000001";

function makeMockClient(opts: MockOptions = {}) {
  const db: DbState = { parents: [], students: [], installments: [], ledger_entries: [] };
  const calls: {
    rpc: Array<{ name: string; args?: Record<string, unknown> }>;
    from: string[];
    updates: string[];
    upserts: string[];
  } = { rpc: [], from: [], updates: [], upserts: [] };
  let idSeq = 0;
  const uuid = () => {
    idSeq += 1;
    return `00000000-0000-0000-0000-${String(idSeq).padStart(12, "0")}`;
  };

  // -- RPC dispatcher ---------------------------------------------------
  const rpc = (name: string, args?: Record<string, unknown>) => {
    calls.rpc.push({ name, args });
    const A = args ?? {};
    if (name === "current_tenant_id") {
      return Promise.resolve({ data: opts.noTenant ? null : TENANT, error: null });
    }
    if (name === "upsert_parent_from_import") {
      if (opts.parentInsertError) {
        return Promise.resolve({ data: null, error: opts.parentInsertError });
      }
      const existing = db.parents.find((p) => p.parent_code === A.p_parent_code);
      if (existing) {
        return Promise.resolve({
          data: [{ out_parent_id: existing.id, out_parent_code: existing.parent_code, out_was_inserted: false }],
          error: null,
        });
      }
      const id = uuid();
      db.parents.push({
        id,
        tenant_id: A.p_tenant_id,
        parent_code: A.p_parent_code,
        first_name: A.p_first_name,
        last_name: A.p_last_name,
        primary_phone: A.p_primary_phone,
        address: A.p_address,
        deleted_at: null,
      });
      return Promise.resolve({
        data: [{ out_parent_id: id, out_parent_code: A.p_parent_code, out_was_inserted: true }],
        error: null,
      });
    }
    if (name === "upsert_student_from_import") {
      // The SYNC-300 pin: a blank-string uuid must be rejected with 22P02.
      if (A.p_parent_id === "") {
        if (opts.acceptBlankUuid) return Promise.resolve({ data: [{ out_student_id: uuid() }], error: null });
        return Promise.resolve({
          data: null,
          error: { code: "22P02", message: "invalid input syntax for type uuid: \"\"" },
        });
      }
      const id = uuid();
      db.students.push({
        id,
        tenant_id: A.p_tenant_id,
        student_code: A.p_student_code,
        parent_id: A.p_parent_id,
        medical_notes: A.p_medical_notes,
        deleted_at: null,
      });
      return Promise.resolve({
        data: [{ out_student_id: id, out_student_code: A.p_student_code, out_was_inserted: true }],
        error: null,
      });
    }
    if (name === "upsert_ledger_entry_from_import") {
      // The category CHECK constraint (23514) + FK violation (23503).
      const VALID = ["tuition", "transport", "canteen", "uniform", "books", "extracurricular", "therapy_psychology", "therapy_speech", "second_apron", "parent_credit", "other"];
      if (typeof A.p_category === "string" && !VALID.includes(A.p_category)) {
        return Promise.resolve({
          data: null,
          error: { code: "23514", message: `new row for relation "ledger_entries" violates check constraint "ledger_entries_category_check"` },
        });
      }
      const parentExists = db.parents.some((p) => p.id === A.p_parent_id && !p.deleted_at);
      if (!parentExists) {
        return Promise.resolve({
          data: null,
          error: { code: "23503", message: "insert or update on table \"ledger_entries\" violates foreign key constraint" },
        });
      }
      db.ledger_entries.push({ id: uuid(), source_id: A.p_source_id, parent_id: A.p_parent_id, student_id: A.p_student_id, category: A.p_category });
      return Promise.resolve({ data: [{ ok: true }], error: null });
    }
    if (name === "soft_delete_student") {
      const s = db.students.find((x) => x.id === A.p_student_id);
      if (s) s.deleted_at = new Date().toISOString();
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    if (name === "soft_delete_parent") {
      if (opts.deleteError) return Promise.resolve({ data: null, error: opts.deleteError });
      const p = db.parents.find((x) => x.id === A.p_parent_id);
      if (p) p.deleted_at = new Date().toISOString();
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
  };

  // -- PostgREST-style builder (the subset the suite uses) --------------
  const filterRows = (table: string, conds: Array<[string, unknown]>) => {
    let rows = [...db[table as keyof DbState] as Row[]];
    for (const [col, val] of conds) {
      rows = rows.filter((r) => (r[col] ?? null) === val || String(r[col] ?? "") === String(val ?? ""));
    }
    return rows;
  };

  const from = (table: string) => {
    calls.from.push(table);
    const conds: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {
      select: (cols?: string) => {
        void cols;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        conds.push([col, val]);
        return builder;
      },
      is: (col: string, val: unknown) => {
        conds.push([col, val]);
        return builder;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        void col; void o;
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: filterRows(table, conds)[0] ?? null, error: null }),
      then: (onFulfilled: (v: { data: Row[]; error: ErrShape }) => void, onRejected?: (e: unknown) => void) => {
        // Awaitable terminal: apply the filters.
        let rows = filterRows(table, conds);
        // The deleted_at IS NULL filter semantics.
        for (const [col, val] of conds) {
          if (col === "deleted_at" && val === null) rows = rows.filter((r) => r.deleted_at == null);
        }
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
      update: (patch: Row) => {
        calls.updates.push(table);
        const run = () => {
          const rows = filterRows(table, conds);
          for (const r of rows) Object.assign(r, patch);
          return Promise.resolve({ error: opts.updateError ?? null });
        };
        // .update(patch).eq(...) continues building; awaiting runs it.
        const b2: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            conds.push([col, val]);
            return b2;
          },
          then: (onFulfilled: (v: { error: ErrShape }) => void, onRejected?: (e: unknown) => void) =>
            run().then(onFulfilled, onRejected),
        };
        // Directly-awaitable (no further .eq): if conds already has the id.
        (builder as { __run?: () => Promise<{ error: ErrShape }> }).__run = run;
        // If the caller awaits the UPDATE builder itself:
        Object.assign(builder, {
          then: (onFulfilled: (v: { error: ErrShape }) => void, onRejected?: (e: unknown) => void) =>
            run().then(onFulfilled, onRejected),
        });
        return b2;
      },
      upsert: (rows: Row[] | Row, conf?: unknown) => {
        void conf;
        calls.upserts.push(table);
        const list = Array.isArray(rows) ? rows : [rows];
        for (const r of list) {
          const arr = db[table as keyof DbState] as Row[];
          const key = table === "installments"
            ? `${r.tenant_id}|${r.parent_id}|${r.student_id}|${r.category}|${r.tranche_number}`
            : `${r.tenant_id}|${r.source_type}|${r.source_id}`;
          const existingIdx = arr.findIndex((x) =>
            table === "installments"
              ? `${x.tenant_id}|${x.parent_id}|${x.student_id}|${x.category}|${x.tranche_number}` === key
              : `${x.tenant_id}|${x.source_type}|${x.source_id}` === key,
          );
          if (existingIdx >= 0) arr[existingIdx] = { ...arr[existingIdx], ...r };
          else arr.push({ id: uuid(), ...r });
        }
        // .upsert(...).select("col") is awaited for the inserted count.
        return {
          select: (cols?: string) => {
            void cols;
            return Promise.resolve({ data: list.map((r) => ({ source_id: r.source_id, id: r.id ?? uuid() })), error: null });
          },
          then: (onFulfilled: (v: { data: Row[]; error: ErrShape }) => void, onRejected?: (e: unknown) => void) =>
            Promise.resolve({ data: list, error: null }).then(onFulfilled, onRejected),
        };
      },
      insert: (rows: Row[] | Row) => {
        const list = Array.isArray(rows) ? rows : [rows];
        const arr = db[table as keyof DbState] as Row[];
        for (const r of list) arr.push({ id: uuid(), ...r });
        return {
          select: (cols?: string) => {
            void cols;
            return Promise.resolve({ data: list.map(() => ({ id: uuid() })), error: null });
          },
        };
      },
    };
    return builder;
  };

  const client = {
    rpc,
    from,
    auth: {
      getSession: async () => ({
        data: { session: opts.noSession ? null : { expires_at: Math.floor(Date.now() / 1000) + 3600 } },
        error: null,
      }),
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    calls,
    db,
  };
}

/* ================================================================== */
/* A. The runner                                                       */
/* ================================================================== */

describe("T-396 A. crud-test-runner — the deterministic CRUD suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it("healthy run: 27 checks, all PASS, every phase present in order", async () => {
    const { client } = makeMockClient();
    const report = await runCrudIntegrationTests({
      client,
      domainSession: { userId: "u", email: "e" },
      now: () => 1789952286,
    });
    const ids = report.checks.map((c) => c.id);
    expect(report.summary).toEqual({ pass: expectedCrudCheckCount(), fail: 0, notTested: 0 });
    expect(report.checks).toHaveLength(expectedCrudCheckCount());
    // Phase order.
    expect(ids.indexOf("crud.prep.session")).toBeLessThan(ids.indexOf("crud.insert.parent"));
    expect(ids.indexOf("crud.insert.parent")).toBeLessThan(ids.indexOf("crud.insert.student"));
    expect(ids.indexOf("crud.insert.idempotency")).toBeGreaterThan(ids.indexOf("crud.insert.parent"));
    expect(ids.indexOf("crud.update.parent")).toBeLessThan(ids.indexOf("crud.read.parents-list"));
    expect(ids.indexOf("crud.bulk.ledger")).toBeLessThan(ids.indexOf("crud.relation.billing"));
    expect(ids.indexOf("crud.validation.blank-uuid")).toBeLessThan(ids.indexOf("crud.server.fk-violation"));
    expect(ids.indexOf("crud.delete.student")).toBeLessThan(ids.indexOf("crud.cleanup.residue"));
    // Every phase category represented.
    const cats = new Set(report.checks.map((c) => c.category));
    for (const cat of [
      "Préparation",
      "Insertion (parents / élèves)",
      "Mise à jour",
      "Lectures (listes)",
      "Import groupé (bulk)",
      "Relations",
      "Erreurs de validation",
      "Erreurs serveur / base",
      "Suppression",
      "Nettoyage",
    ]) {
      expect(cats.has(cat), `category ${cat}`).toBe(true);
    }
  });

  it("probe codes are run-unique (two runs never share a parent code)", async () => {
    const { client } = makeMockClient();
    const r1 = await runCrudIntegrationTests({ client, domainSession: null, now: () => 1111 });
    const r2 = await runCrudIntegrationTests({ client, domainSession: null, now: () => 2222 });
    expect(r1.probe!.parentCode).toContain("PAR-PROBE-T396-1111");
    expect(r2.probe!.parentCode).toContain("PAR-PROBE-T396-2222");
    expect(r1.probe!.parentCode).not.toBe(r2.probe!.parentCode);
  });

  it("prep short-circuit: no SDK session → prep FAIL + every write category NON TESTÉ", async () => {
    const { client } = makeMockClient({ noSession: true });
    const report = await runCrudIntegrationTests({ client, domainSession: null, now: () => 1 });
    const session = report.checks.find((c) => c.id === "crud.prep.session")!;
    expect(session.status).toBe("fail");
    expect(report.summary.notTested).toBe(9);
    expect(report.summary.fail).toBe(1);
    expect(report.summary.pass).toBe(1); // tenant still resolves in the mock
    // No write RPC was ever issued.
    const src = JSON.stringify(report);
    expect(src).not.toContain("upsert_parent_from_import en erreur");
  });

  it("insert failure surfaces the ACTUAL error and the suite CONTINUES (honest legs)", async () => {
    const { client, calls } = makeMockClient({
      parentInsertError: { code: "42501", message: "new row violates row-level security policy" },
    });
    const report = await runCrudIntegrationTests({ client, domainSession: null, now: () => 5 });
    const insert = report.checks.find((c) => c.id === "crud.insert.parent")!;
    expect(insert.status).toBe("fail");
    expect(insert.detail).toContain("42501");
    expect(insert.detail).toContain("row-level security");
    // The suite continued: the delete + cleanup phases still ran.
    const cleanup = report.checks.find((c) => c.id === "crud.cleanup.residue")!;
    expect(cleanup).toBeTruthy();
    expect(report.summary.fail).toBeGreaterThan(0);
    expect(calls.rpc.some((r) => r.name === "soft_delete_parent")).toBe(false); // nothing to clean
  });

  it("validation legs: the 22P02 blank-uuid rejection PASSES; an accepted invalid call FAILS", async () => {
    const good = await runCrudIntegrationTests({
      client: makeMockClient().client,
      domainSession: null,
      now: () => 7,
    });
    const blank = good.checks.find((c) => c.id === "crud.validation.blank-uuid")!;
    const cat = good.checks.find((c) => c.id === "crud.validation.invalid-category")!;
    expect(blank.status).toBe("pass");
    expect(blank.detail).toContain("22P02");
    expect(cat.status).toBe("pass");
    expect(cat.detail).toContain("23514");

    const bad = await runCrudIntegrationTests({
      client: makeMockClient({ acceptBlankUuid: true }).client,
      domainSession: null,
      now: () => 8,
    });
    const blankBad = bad.checks.find((c) => c.id === "crud.validation.blank-uuid")!;
    expect(blankBad.status).toBe("fail");
    expect(blankBad.detail).toContain("APPEL ACCEPTÉ À TORT");
  });

  it("FK-violation leg: the 23503 code is surfaced", async () => {
    const report = await runCrudIntegrationTests({
      client: makeMockClient().client,
      domainSession: null,
      now: () => 9,
    });
    const fk = report.checks.find((c) => c.id === "crud.server.fk-violation")!;
    expect(fk.status).toBe("pass");
    expect(fk.detail).toContain("23503");
  });

  it("delete phase: the list shapes EXCLUDE the soft-deleted rows (UI consistency)", async () => {
    const { client, db } = makeMockClient();
    const report = await runCrudIntegrationTests({ client, domainSession: null, now: () => 10 });
    const del = report.checks.find((c) => c.id === "crud.delete.parent")!;
    const consistency = report.checks.find((c) => c.id === "crud.delete.parent-consistency")!;
    const residue = report.checks.find((c) => c.id === "crud.cleanup.residue")!;
    expect(del.status).toBe("pass");
    expect(consistency.status).toBe("pass");
    expect(residue.status).toBe("pass");
    // The mock DB actually has the rows soft-deleted.
    expect(db.parents.every((p) => p.deleted_at != null)).toBe(true);
    expect(db.students.every((s) => s.deleted_at != null)).toBe(true);
  });

  it("update consistency: the list read reflects the updated address", async () => {
    const { client } = makeMockClient();
    const report = await runCrudIntegrationTests({ client, domainSession: null, now: () => 11 });
    const upd = report.checks.find((c) => c.id === "crud.update.parent-consistency")!;
    expect(upd.status).toBe("pass");
  });

  it("update failure FAILS its check with the error and does not abort the suite", async () => {
    const { client } = makeMockClient({ updateError: { code: "42501", message: "permission denied" } });
    const report = await runCrudIntegrationTests({ client, domainSession: null, now: () => 12 });
    const upd = report.checks.find((c) => c.id === "crud.update.parent")!;
    expect(upd.status).toBe("fail");
    expect(upd.detail).toContain("42501");
    const bulk = report.checks.find((c) => c.id === "crud.bulk.ledger")!;
    expect(bulk.status).toBe("pass"); // the suite continued
  });

  it("SAFETY: the report text never contains token material", async () => {
    const { client } = makeMockClient();
    const report = await runCrudIntegrationTests({ client, domainSession: null, now: () => 13 });
    const text = formatDiagnosticsReportText(report);
    expect(text).not.toMatch(/sb_secret|sbp_|eyJ|Bearer|apikey/i);
    expect(text).not.toMatch(/ghp_[A-Za-z0-9]/);
  });
});

/* ================================================================== */
/* B. The view                                                         */
/* ================================================================== */

describe("T-396 B. crud-test-tab — the Settings view", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it("renders the transparency banner and runs the injected runner with the client + session", async () => {
    const runTests = vi.fn().mockResolvedValue({
      ranAt: 1789952286000,
      checks: [
        {
          id: "crud.insert.parent",
          category: "Insertion (parents / élèves)",
          label: "Créer un parent (RPC upsert_parent_from_import)",
          status: "pass",
          detail: "parent créé — PAR-PROBE-T396-x",
          durationMs: 120,
        },
      ],
      summary: { pass: 1, fail: 0, notTested: 0 },
      probe: { runStamp: "1789952286" },
    } satisfies DiagnosticsReport & { probe: { runStamp: string } });
    const getClient = vi.fn().mockReturnValue(makeMockClient().client);

    render(<CrudTestTab runTests={runTests} getClient={getClient} />);
    expect(screen.getByText(/écrit dans la base/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /lancer la suite crud/i }));
    await waitFor(() => expect(screen.getByText(/1 PASS/)).toBeTruthy());
    expect(runTests).toHaveBeenCalledTimes(1);
    expect(runTests.mock.calls[0][0].client).toBeTruthy();
    expect(runTests.mock.calls[0][0].domainSession).toEqual({
      userId: "user-1",
      email: "admin@elimtiyaz.dz",
    });
    // The check row + its detail render.
    expect(screen.getByText(/Créer un parent/i)).toBeTruthy();
    expect(screen.getByText(/parent créé/i)).toBeTruthy();
  });

  it("renders the FAIL badge + summary when a check fails", async () => {
    const runTests = vi.fn().mockResolvedValue({
      ranAt: 1789952286000,
      checks: [
        {
          id: "crud.update.parent",
          category: "Mise à jour",
          label: "Mettre à jour le parent (PATCH parents)",
          status: "fail",
          detail: "PATCH /rest/v1/parents — code 42501, permission denied",
          durationMs: 90,
        },
      ],
      summary: { pass: 0, fail: 1, notTested: 0 },
    } satisfies DiagnosticsReport);
    render(<CrudTestTab runTests={runTests} getClient={() => makeMockClient().client} />);
    fireEvent.click(screen.getByRole("button", { name: /lancer la suite crud/i }));
    await waitFor(() => expect(screen.getByText(/DES TESTS ÉCHOUENT/)).toBeTruthy());
    expect(screen.getByText(/1 FAIL/)).toBeTruthy();
    expect(screen.getByText(/code 42501/)).toBeTruthy();
  });
});
