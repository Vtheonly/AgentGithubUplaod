/**
 * T-626 — the REAL Excel import + RE-IMPORT end-to-end against the LOCAL
 * OFFLINE PostgreSQL (the T-625 `scripts/schema-test` harness running the
 * canonical chain 0001..0005), through the REAL ImportEngine +
 * RepositoryStorageAdapter and REAL canonical RPCs / table constraints.
 *
 * This is the owner's 2026-11-28 mandate, Step 2:
 *   "Re-test importing and re-importing the real Excel workbooks
 *    (Excel/2027-2026.xlsx ETAT 20262027) against local offline Supabase
 *    (must be idempotent, atomic, zero 409 duplicate crashes or 500
 *    installment errors). Cross-check Excel spreadsheet totals ↔ Local
 *    Supabase ↔ Desktop UI ↔ Website UI so numbers match 100%."
 *
 * The Postgres-backed repositories live in `src/tests/_helpers/local-pg-repos.ts`
 * (mirroring supabase-shared-repositories wire-for-wire). A 23505 (unique
 * violation — the PostgREST "409" class) or an RPC failure (the "500" class)
 * here means the PRODUCTION wire path is broken — the regression class the
 * in-memory twins cannot see.
 *
 * Environment-gated: runs only when the workbook + the harness script exist
 * (or LOCAL_PG_URL is set); otherwise the suite skips with an explicit reason.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import ExcelJS from "exceljs";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import { splitFullName } from "../../infrastructure/excel/import-engine/mappers/name-splitter";
import { computeParentSummary } from "../../domain/calc/ledger/balance";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { PaymentCategory } from "../../domain/model/payment";
import { selectRevenuePayments } from "../../domain/calc/payment/revenue-report";
import { mapPaymentRow } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";

import {
  PgParentRepo,
  PgStudentRepo,
  PgLedgerRepo,
  PgPaymentRepo,
  PgInstallmentRepo,
  type PgCtx,
} from "../_helpers/local-pg-repos";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// ── The workbook (the forensic evidence under Excel/) ──────────────────────
const REPO_ROOT = path.resolve(__dirname, "../../..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "2027-2026.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p));

// ── The local offline database (the T-625 harness) ─────────────────────────
const LOCAL_PG_SCRIPT = path.resolve(REPO_ROOT, "scripts/schema-test/local-pg.mjs");
const LOCAL_PG_PORT = Number(process.env.LOCAL_PG_PORT ?? 5435);
const PG_URL = { host: "127.0.0.1", port: LOCAL_PG_PORT, user: "postgres", database: "postgres" };

const IMPORT_TIMEOUT = 15 * 60_000; // the real workbook through real SQL (wasm PGlite)

// ── The suite ───────────────────────────────────────────────────────────────

const canRun = XLSX_PATH != null && (fs.existsSync(LOCAL_PG_SCRIPT) || process.env.LOCAL_PG_URL != null);
const describeOrSkip = canRun ? describe : describe.skip;

interface DbCounts {
  parents: number;
  students: number;
  ledger: number;
  payments: number;
  installments: number;
}

describeOrSkip("Real Excel import + re-import against the LOCAL OFFLINE PostgreSQL (T-626)", () => {
  let server: ChildProcess | null = null;
  let client: Client;
  let tenantId = "";
  let ctx: PgCtx;
  let engine: ImportEngine;
  let import1Stats: { rowsImported: number; rowsUpdated: number; rowsRejected: number };
  let import2Stats: { rowsImported: number; rowsUpdated: number; rowsRejected: number };
  let countsAfter1: DbCounts;

  const dbCounts = async (): Promise<DbCounts> => {
    const q = async (sql: string) => Number((await client.query(sql)).rows[0].n);
    return {
      parents: await q(`select count(*) n from parents where tenant_id = '${tenantId}' and deleted_at is null`),
      students: await q(`select count(*) n from students where tenant_id = '${tenantId}' and deleted_at is null`),
      ledger: await q(`select count(*) n from ledger_entries where tenant_id = '${tenantId}'`),
      payments: await q(`select count(*) n from payments where tenant_id = '${tenantId}'`),
      installments: await q(`select count(*) n from installments where tenant_id = '${tenantId}'`),
    };
  };

  beforeAll(async () => {
    // 1. Boot (or reuse) the local offline database.
    const scriptExists = fs.existsSync(LOCAL_PG_SCRIPT);
    if (scriptExists && process.env.LOCAL_PG_REUSE !== "1") {
      server = spawn(
        process.execPath,
        [LOCAL_PG_SCRIPT, "start", "--fresh", "--port", String(LOCAL_PG_PORT)],
        { stdio: ["ignore", "pipe", "pipe"], cwd: path.dirname(LOCAL_PG_SCRIPT) },
      );
      server.stderr?.on("data", (d) => { /* logged only on failure paths */ void d; });
      const stateFile = path.join(path.dirname(LOCAL_PG_SCRIPT), ".local-pg.json");
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(stateFile)) {
          try {
            const st = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
            if (st.port === LOCAL_PG_PORT && st.pid === server.pid) break;
          } catch { /* retry */ }
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!fs.existsSync(stateFile)) {
        throw new Error("local-pg harness failed to become READY within 180 s");
      }
    }
    client = new Client(PG_URL);
    await client.connect();

    // 2. Seed the tenant + the staff caller (postgres phase), then become
    //    the authenticated staff caller (the single-backend discipline).
    const tenant = await client.query(
      `insert into tenants (name, slug, country, default_locale, default_currency, timezone, is_active)
       values ('T-626 Local Import', $1, 'DZ', 'fr', 'DZD', 'Africa/Algiers', true) returning id`,
      [`t626-${Date.now() % 1000000}`],
    );
    tenantId = String(tenant.rows[0].id);
    const AUTH_UID = "00000000-0000-0000-0000-0000000000cc";
    await client.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, 't626@elimtiyaz.dz', now())
       on conflict (id) do nothing`,
      [AUTH_UID],
    );
    await client.query(
      `update user_profiles set tenant_id = $1, display_name = 'T-626 Staff', status = 'active'
       where auth_user_id = $2`,
      [tenantId, AUTH_UID],
    );
    const profile = await client.query(`select id from user_profiles where auth_user_id = $1`, [AUTH_UID]);
    const profileId = String(profile.rows[0].id);
    await client.query(
      `insert into role_assignments (tenant_id, user_profile_id, role_id)
       select $1, $2, r.id from roles r where r.code = 'super_admin' limit 1`,
      [tenantId, profileId],
    );
    // One academic year so the INV-14 stamping has a window (the seeded
    // 2025-2026 window covers the workbook's 2025-09/2025-12/2026-03 dates).
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: AUTH_UID, role: "authenticated", app_metadata: { tenant_id: tenantId } }),
    ]);

    ctx = { client, tenantId, profileId };
    const parents = new PgParentRepo(ctx);
    const students = new PgStudentRepo(ctx);
    const ledger = new PgLedgerRepo(ctx);
    const payments = new PgPaymentRepo(ctx);
    const installments = new PgInstallmentRepo(ctx);
    const storage = new RepositoryStorageAdapter({
      parents, students, ledger, payments, installments,
      tenantId,
      actorId: profileId,
      actorName: "T-626 Staff",
    });
    engine = new ImportEngine({
      storage,
      auditSink: { async logAction() { /* no-op */ } },
    });

    // 3. IMPORT #1 — the real workbook, through the real engine + real SQL.
    const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH!));
    const ctx1 = await engine.importFile(bytes, XLSX_PATH!, { dryRun: false });
    import1Stats = {
      rowsImported: ctx1.stats.rowsImported,
      rowsUpdated: ctx1.stats.rowsUpdated,
      rowsRejected: ctx1.stats.rowsRejected,
    };
    countsAfter1 = await dbCounts();

    // 4. IMPORT #2 — the SAME workbook again (the re-import).
    const ctx2 = await engine.importFile(bytes, XLSX_PATH!, { dryRun: false });
    import2Stats = {
      rowsImported: ctx2.stats.rowsImported,
      rowsUpdated: ctx2.stats.rowsUpdated,
      rowsRejected: ctx2.stats.rowsRejected,
    };
  }, IMPORT_TIMEOUT * 2);

  afterAll(async () => {
    try { await client?.end(); } catch { /* already closed */ }
    if (server != null && !server.killed) {
      server.kill("SIGTERM");
    }
  }, 30_000);

  it("IMPORT #1: the real 2027-2026.xlsx lands through the canonical RPCs + wire forms", () => {
    // The real workbook carries ~1,139 named student rows (the established
    // census from the in-memory twin).
    expect(import1Stats.rowsImported + import1Stats.rowsUpdated).toBeGreaterThan(1000);
    expect(import1Stats.rowsRejected).toBe(0);

    // The database actually holds them.
    expect(countsAfter1.students).toBeGreaterThanOrEqual(1100);
    expect(countsAfter1.parents).toBeGreaterThan(0);
    expect(countsAfter1.ledger).toBeGreaterThan(1000);
    expect(countsAfter1.payments).toBeGreaterThan(0);
    expect(countsAfter1.installments).toBeGreaterThan(0);
  }, IMPORT_TIMEOUT);

  it("RE-IMPORT #2: is a clean no-op — ZERO 23505/409-class duplicate crashes, ZERO 500-class RPC failures, stable counts", async () => {
    // The re-import either updates (the IMPORT-109 exact-match path) or
    // reports the rows as already-present — but it must NEVER fail.
    expect(import2Stats.rowsRejected).toBe(0);

    // The preflight filters (the T-421 contract) mean the financial streams
    // write NOTHING new: the DB counts are IDENTICAL after the second run.
    const countsAfter2 = await dbCounts();
    expect(countsAfter2).toEqual(countsAfter1);

    // And the ledger stream carries no duplicated source identities (the
    // `ledger_entries_source_uidx` contract — a violation would have raised
    // 23505 on the wire; this is the direct proof).
    const dup = await client.query(
      `select source_id, count(*) as n from ledger_entries
       where tenant_id = $1 and source_type = 'bulk_import' and source_id is not null
       group by source_id having count(*) > 1 limit 1`,
      [tenantId],
    );
    expect(dup.rows.length, "duplicated ledger source identities after re-import").toBe(0);

    const dupPay = await client.query(
      `select payment_number, count(*) as n from payments
       where tenant_id = $1 group by payment_number having count(*) > 1 limit 1`,
      [tenantId],
    );
    expect(dupPay.rows.length, "duplicated payment numbers after re-import").toBe(0);

    const dupIns = await client.query(
      `select parent_id, student_id, category, tranche_number, coalesce(academic_year_id::text,''), count(*) as n
       from installments where tenant_id = $1
       group by 1,2,3,4,5 having count(*) > 1 limit 1`,
      [tenantId],
    );
    expect(dupIns.rows.length, "duplicated tranche identities after re-import").toBe(0);
  }, IMPORT_TIMEOUT);

  it("TOTALS PARITY: workbook column sums ↔ DB ledger sums (the identity-projection oracle)", async () => {
    // THE ORACLE: the engine lands every workbook dinar EXACTLY ONCE per
    // resolved identity. The documented identity semantics (IMPORT-109 +
    // the T-420 first-wins merge):
    //   parent  = first token of NEM (/,; split) or the NOM-derived
    //             placeholder family name when NEM is blank;
    //   student = exact displayName, then (firstName, lastName) via the
    //             CANONICAL splitFullName — reused here, never re-implemented.
    // Two workbook rows that resolve to the same student (the real file
    // carries the KHALEF RAYAN pair + a whitespace-variant HEROUA pair)
    // merge: the FIRST row's financial cells land, the second's are
    // dropped by the within-batch dedup. The projection below computes
    // exactly that; the DB must match it to the dinar.
    const wb = new ExcelJS.Workbook();
    const xlsxBytes = new Uint8Array(fs.readFileSync(XLSX_PATH!));
    await wb.xlsx.load(
      xlsxBytes.buffer.slice(xlsxBytes.byteOffset, xlsxBytes.byteOffset + xlsxBytes.byteLength) as ArrayBuffer,
    );
    const ws = wb.getWorksheet("ETAT 20262027")!;
    const headers: Record<number, string> = {};
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col] = String(cell.value ?? "");
    });
    const val = (row: ExcelJS.Row, col: number): unknown => {
      const v = row.getCell(col).value;
      if (typeof v === "object" && v != null && "result" in (v as object)) {
        return (v as { result?: unknown }).result;
      }
      return v;
    };
    const num = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
      return 0;
    };
    // Column resolution by the ACTUAL header texts (the etat-2027-2026
    // config's canonical fields; V1 renames to the canonical v2).
    const FIELD_BY_HEADER: Record<string, string> = {
      FI: "FI", V1: "V2", "2V": "V2_ALT", v3: "V3", "1T": "T1", T2: "T2", t3: "T3",
      "DEVIS ANNUEL": "DEVIS_ANNUEL",
    };
    const columnByField: Record<string, number> = {};
    for (const [col, text] of Object.entries(headers)) {
      const field = FIELD_BY_HEADER[text.trim()];
      if (field && !columnByField[field]) columnByField[field] = Number(col);
    }
    expect(columnByField["DEVIS_ANNUEL"], "the DEVIS ANNUEL column must resolve").toBeDefined();
    expect(columnByField["FI"], "the FI column must resolve").toBeDefined();

    // The identity projection (first-wins) + the raw workbook sums.
    const FIELDS = Object.keys(columnByField);
    const projected: Record<string, number> = Object.fromEntries(FIELDS.map((f) => [f, 0]));
    const raw: Record<string, number> = Object.fromEntries(FIELDS.map((f) => [f, 0]));
    const families = new Map<string, Array<{ displayName: string; firstName: string; lastName: string }>>();
    let mergedRows = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nom = String(val(row, 6) ?? "").trim();
      if (!nom) continue;
      for (const [field, col] of Object.entries(columnByField)) {
        raw[field] += num(val(row, col));
      }
      const nemRaw = String(val(row, 4) ?? "").trim();
      const phone = nemRaw.split(/[/,;]/)[0]?.trim() || "(inconnu)";
      const parts = splitFullName(nom);
      const famKey = phone !== "(inconnu)" ? `tel:${phone}` : `fam:${parts.lastName}`;
      if (!families.has(famKey)) families.set(famKey, []);
      const fam = families.get(famKey)!;
      const existing =
        fam.find((st) => st.displayName === nom) ??
        fam.find((st) => st.firstName === parts.firstName && st.lastName === parts.lastName);
      if (existing) {
        mergedRows++;
        continue;
      }
      fam.push({ displayName: nom, firstName: parts.firstName, lastName: parts.lastName });
      for (const [field, col] of Object.entries(columnByField)) {
        projected[field] += num(val(row, col));
      }
    }
    // The merge class is small and documented (the real file: 2 rows).
    expect(mergedRows).toBeLessThanOrEqual(5);

    // The DB ledger sums, grouped by the metadata field contract.
    const { rows: dbSums } = await client.query(
      `select metadata->>'field' as field,
              entry_type,
              sum(amount)::float8 as total,
              count(*)::int as n
       from ledger_entries
       where tenant_id = $1 and source_type = 'bulk_import' and metadata->>'field' is not null
       group by 1, 2`,
      [tenantId],
    );
    const dbByField = new Map<string, { charge: number; payment: number }>();
    for (const r of dbSums) {
      const entry = dbByField.get(r.field) ?? { charge: 0, payment: 0 };
      if (r.entry_type === "charge") entry.charge += Number(r.total);
      if (r.entry_type === "payment") entry.payment += Math.abs(Number(r.total));
      dbByField.set(r.field, entry);
    }

    // PARITY: DB ≡ projection, to the dinar (1 DZD numeric tolerance).
    for (const field of FIELDS) {
      const db = dbByField.get(field);
      const dbSum = db ? (field === "DEVIS_ANNUEL" ? db.charge : db.payment) : 0;
      expect(
        Math.abs(projected[field] - dbSum),
        `field ${field}: projection ${projected[field]} vs DB ${dbSum}`,
      ).toBeLessThanOrEqual(1);
    }
    // And the merge class accounts for the raw-vs-projected gap.
    for (const field of FIELDS) {
      expect(
        Math.abs(raw[field] - projected[field]),
        `field ${field}: the merged-row drop must stay in the documented class`,
      ).toBeLessThanOrEqual(Math.max(1, raw[field] * 0.01));
    }
  }, IMPORT_TIMEOUT);

  it("T-630: revenue report population equals local SQL over the real re-imported workbook", async () => {
    const { rows } = await client.query<{ row: Parameters<typeof mapPaymentRow>[0] }>(
      "select row_to_json(p) as row from payments p where tenant_id = $1", [tenantId],
    );
    const payments = rows.map(({ row }) => mapPaymentRow(row));
    expect(payments.length).toBeGreaterThan(1000);
    for (const [from, to] of [["2026-07-01", "2026-09-30"], ["2026-12-01", "2026-12-31"], ["2027-03-01", "2027-03-31"]]) {
      const selected = selectRevenuePayments(payments, { from, to });
      const { rows: oracle } = await client.query(
        `select count(*)::int n, coalesce(sum(amount),0)::float8 total from payments
         where tenant_id = $1 and status = 'paid' and collected_at::date between $2::date and $3::date`,
        [tenantId, from, to],
      );
      expect(selected.length).toBe(oracle[0].n);
      expect(selected.reduce((sum, row) => sum + row.amount, 0)).toBe(oracle[0].total);
    }
  }, IMPORT_TIMEOUT);

  it("TOTALS PARITY: the canonical TS engine ↔ the SQL compute_parent_summary RPC (desktop = backend)", async () => {
    // Sample parents across the corpus.
    const { rows: sample } = await client.query(
      `select p.id from parents p
       where p.tenant_id = $1 and p.deleted_at is null
       order by p.created_at asc
       limit 25`,
      [tenantId],
    );
    expect(sample.length).toBeGreaterThan(0);
    const portalSource = path.resolve(REPO_ROOT, "../../elimtiyaz-website/src/lib/canonical/portal-derive.ts");
    const portal = fs.existsSync(portalSource) ? await import(/* @vite-ignore */ portalSource) : null;
    if (!portal) console.info("Portal parity NOT RUN: sibling elimtiyaz-website checkout is unavailable; TS/SQL checks still run.");
    for (const p of sample) {
      // The SQL canonical summary.
      const { rows } = await client.query(`select * from compute_parent_summary($1, now())`, [p.id]);
      const sql = rows[0];

      // The TS canonical engine over the SAME ledger rows.
      const { rows: entries } = await client.query(
        `select * from ledger_entries where tenant_id = $1 and parent_id = $2 order by at asc, created_at asc`,
        [tenantId, p.id],
      );
      const ts = computeParentSummary(
        entries.map((e: Record<string, unknown>) => ({
          id: String(e.id),
          tenantId: String(e.tenant_id),
          parentId: String(e.parent_id),
          studentId: e.student_id == null ? null : String(e.student_id),
          accountId: String(e.account_id),
          type: String(e.entry_type) as LedgerEntry["type"],
          amount: Number(e.amount),
          category: (e.category ?? "tuition") as PaymentCategory,
          description: String(e.description ?? ""),
          sourceType: (e.source_type as LedgerEntry["sourceType"]) ?? null,
          sourceId: e.source_id == null ? "" : String(e.source_id),
          method: (e.method as LedgerEntry["method"]) ?? null,
          receiptNumber: e.receipt_number == null ? null : String(e.receipt_number),
          paymentStatus: (e.payment_status as LedgerEntry["paymentStatus"]) ?? null,
          reversesId: e.reverses_id == null ? null : String(e.reverses_id),
          actorId: e.actor_id == null ? "" : String(e.actor_id),
          actorName: e.actor_name == null ? "" : String(e.actor_name),
          at: new Date((e.at ?? e.entry_date) as string | Date).toISOString(),
          metadata: (e.metadata as LedgerEntry["metadata"]) ?? {},
        })),
        String(p.id),
        "", // parentName — display-only for the summary totals
        new Map(), // no overdue map — the totals comparison is the target
      );
      // The live import path writes DZD amounts on BOTH sides (the DB
      // numeric column and the canonical model carry the same unit — the
      // production mapLedgerRow does no conversion); the comparison is
      // direct, with a 1-DZD numeric-stringification tolerance.
      // T-631: execute the actual sibling portal canonical engine over the
      // SAME locally imported rows (JSON timestamps match PostgREST).
      if (portal) {
        const web = portal.portalFinancialSummary(JSON.parse(JSON.stringify(entries)), String(p.id));
        expect(web.totalCharged).toBe(ts.totalCharged);
        expect(web.totalPaid).toBe(ts.totalPaid);
        expect(web.totalAdjusted).toBe(ts.totalAdjusted);
        expect(web.outstanding).toBe(ts.totalOutstanding);
      }
      const c = 1;
      expect(Math.abs((ts.totalCharged ?? 0) - Number(sql.total_charged))).toBeLessThanOrEqual(c);
      expect(Math.abs((ts.totalPaid ?? 0) - Number(sql.total_paid))).toBeLessThanOrEqual(c);
      expect(Math.abs((ts.totalOutstanding ?? 0) - Number(sql.total_outstanding))).toBeLessThanOrEqual(c);
    }
  }, IMPORT_TIMEOUT);
});
