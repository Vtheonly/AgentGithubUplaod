/**
 * t-425-live-reimport.ts — the T-425 Phase C live remediation: re-import the
 * REAL workbook through the CORRECTED canonical pipeline (the owner-gated
 * runbook step 3).
 *
 * WHAT: the REAL ImportEngine + the REAL Supabase repositories (the same
 * classes the desktop app's import modal wires — ParentRepository,
 * StudentRepository, LedgerRepository, PaymentRepository,
 * InstallmentRepository, the audit log), driven headlessly with the
 * service-role client (the owner's credentials; the writes are the same
 * bulk RPCs the app's owner session issues).
 *
 * ORDER (the runbook — migration 0124's header): the T-425 app build is
 * deployed, 0124 is APPLIED (the purge + the (0,1,2,3) CHECK), THEN this
 * script runs. The re-import writes the registration fee (FI) at tranche 0
 * + the 3 official tranches (V1/2V/v3) with the canonical waterfall
 * attribution; the T-421 preflight skips the EXISTING parents/students/
 * payments/ledger identities (idempotent — only the installments, purged
 * by 0124, are rebuilt).
 *
 * USAGE:
 *   SUPABASE_SERVICE_KEY=sb_secret_… npx tsx scripts/t-425-live-reimport.ts
 *
 * SAFETY: refuses to run unless the installments table is EMPTY of imp-
 * rows (the 0124 purge must have run — otherwise the pre-existing stale
 * rows would make the re-import a silent no-op for the installments).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ImportEngine } from "../src/infrastructure/excel/import-engine/import-engine";
import { RepositoryStorageAdapter } from "../src/infrastructure/excel/import-engine/storage/repository-adapter";
import {
  SupabaseParentRepository,
  SupabaseStudentRepository,
  SupabasePaymentRepository,
  SupabaseLedgerRepository,
  SupabaseInstallmentRepository,
} from "../src/infrastructure/supabase/repositories/supabase-shared-repositories";
import { SupabaseAuditLogRepository } from "../src/infrastructure/supabase/repositories/supabase-audit-log-repository";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p))!;

// ── The headless session context ──────────────────────────────────────────
// The repositories resolve the working tenant through getTenantId() → the
// localStorage session (`el-imtiyaz.session` — the same key the tests seed
// and the app writes at login). Node has no localStorage: install the
// in-memory shim BEFORE the first repository call so requireTenantId()
// resolves the tenant (the service-key client otherwise carries no user
// context and current_tenant_id() cannot resolve anything).
const memStore = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => void memStore.clear(),
};
memStore.set(
  "el-imtiyaz.session",
  JSON.stringify({ tenantId: TENANT_ID, userId: "t-425-remediation" }),
);

async function main() {
  if (!SERVICE_KEY) {
    console.error("FATAL: SUPABASE_SERVICE_KEY env var required (service role — owner-gated)");
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Preflight 1: the 0124 purge must have run (0 imp- installments). ──
  const { count: impCount } = await db
    .from("installments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID)
    .eq("source_type", "bulk_import")
    .like("source_id", "imp-%");
  console.log(`preflight: imp- installments remaining = ${impCount ?? "?"}`);
  if ((impCount ?? 0) > 0) {
    console.error(
      "FATAL: the installments still carry imp- rows — apply migration 0124 FIRST (the purge), then re-run. " +
        "Without the purge the T-421 preflight would skip every installment identity and the re-import could not correct anything.",
    );
    process.exit(1);
  }

  // ── Preflight 2: migration 0124 applied. The registration table
  //    (supabase_migrations.schema_migrations) is NOT exposed over
  //    PostgREST — verify via the Management API SQL endpoint out-of-band
  //    (the apply_0124_live.sh + t-425-post-migration-verify.mjs pair).
  //    The definitive in-band proof is the import itself: a tranche-0
  //    write is REJECTED by the pre-0124 CHECK (1,2,3,4), so if 0124 were
  //    missing the first installments flush below fails loudly.

  // ── The REAL repositories over the service-role client (the same classes
  //    the app's import modal wires). ──
  const parents = new SupabaseParentRepository(db);
  const students = new SupabaseStudentRepository(db);
  const payments = new SupabasePaymentRepository(db);
  const ledger = new SupabaseLedgerRepository(db);
  const installments = new SupabaseInstallmentRepository(db);
  const audit = new SupabaseAuditLogRepository(db);

  const engine = new ImportEngine({
    storage: new RepositoryStorageAdapter({
      parents, students, ledger, payments, installments,
      tenantId: TENANT_ID,
      actorId: "t-425-remediation",
      actorName: "T-425 Remediation (owner-gated)",
    }),
    auditSink: {
      async logAction(action, entityType, entityId, diff, note) {
        await audit.log({
          action,
          entityType,
          entityId,
          actorId: "t-425-remediation",
          actorName: "T-425 Remediation (owner-gated)",
          tenantId: TENANT_ID,
          diff: diff ? { after: diff } : null,
          note: note ?? null,
        });
      },
    },
  });

  const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH));
  console.log(`workbook: ${XLSX_PATH}`);
  console.log("running the canonical import (dryRun: false)…");
  const t0 = Date.now();
  const ctx = await engine.importFile(bytes, XLSX_PATH, {
    dryRun: false,
    source: { user: "t-425-remediation" },
  });
  console.log(
    `import: ${Date.now() - t0}ms — imported=${ctx.stats.rowsImported} updated=${ctx.stats.rowsUpdated} skipped=${ctx.stats.rowsSkipped} rejected=${ctx.stats.rowsRejected} warnings=${ctx.stats.warnings}`,
  );
  if (ctx.errors?.length) {
    console.log("errors (first 10):", JSON.stringify(ctx.errors.slice(0, 10), null, 2));
  }

  // ── The post-import census (the verification input). ──
  const { data: cen } = await db
    .from("installments")
    .select("category, tranche_number, label, amount_due, amount_paid, due_date, status")
    .eq("tenant_id", TENANT_ID)
    .order("id", { ascending: true })
    .limit(1000);
  const byKey = new Map<string, { n: number; due: number; paid: number; labels: Set<string>; dues: Set<string> }>();
  for (const r of cen ?? []) {
    const key = `${r.category}|T${r.tranche_number}`;
    let c = byKey.get(key);
    if (!c) { c = { n: 0, due: 0, paid: 0, labels: new Set(), dues: new Set() }; byKey.set(key, c); }
    c.n++; c.due += Number(r.amount_due ?? 0); c.paid += Number(r.amount_paid ?? 0);
    c.labels.add(r.label ?? "—"); c.dues.add(String(r.due_date ?? "").slice(0, 10));
  }
  console.log("\n=== post-import census (first 1,000 rows by key) ===");
  for (const [key, c] of [...byKey.entries()].sort()) {
    console.log(
      `${key.padEnd(18)} n=${String(c.n).padStart(4)}  Σdue=${Math.round(c.due).toLocaleString("fr-DZ").padStart(13)}  Σpaid=${Math.round(c.paid).toLocaleString("fr-DZ").padStart(13)}  labels=[${[...c.labels].slice(0, 2).join(" / ")}] dues=[${[...c.dues].slice(0, 3).join(",")}]`,
    );
  }
  console.log("\nT-425 live re-import complete.");
}

main().catch((e) => {
  console.error("RE-IMPORT FAILED:", e);
  process.exit(1);
});
