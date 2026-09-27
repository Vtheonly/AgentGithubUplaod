/**
 * t-433-live-reimport.ts — T-433 Phase D: the FRESH WB2 import over the
 * purged domain (the owner's "purge everything first, then use the WB2
 * Excel file" mandate).
 *
 * This is the t-425-live-reimport.ts driver with ONE corrected seam — the
 * ACTOR IDENTITY: the T-425 driver passed the free-text actor string
 * "t-425-remediation" everywhere, which is INVALID for the payments
 * table's `collected_by` UUID column — its payments flush path was never
 * exercised with FRESH payments (the T-425 re-import ran over a DB whose
 * 2,198 payments already existed, so the payments leg was preflight-skipped
 * — the never-run-layer class). The first T-433 fresh run surfaced it
 * deterministically: `invalid input syntax for type uuid: "t-425-remediation"`.
 *
 * THE FIX (this driver): the actor is the OWNER ADMIN's user_profiles.id
 * (env ACTOR_PROFILE_ID, fail-closed when missing) — the same uuid the
 * desktop app's owner session would send as collected_by, and the same id
 * the audit trail attributes.
 *
 * ORDER (unchanged, the §15.65f runbook): the 0124 clear (imp- installments
 * must be 0 — verified by this script's own preflight) → THIS import.
 * Idempotent end-to-end: existing parents/students/ledger/payment identities
 * are preflight-skipped, so the driver is safe to re-run.
 *
 * USAGE:
 *   SUPABASE_SERVICE_KEY=sb_secret_… ACTOR_PROFILE_ID=<admin uuid> \
 *     npx tsx scripts/t-433-live-reimport.ts
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
const ACTOR_PROFILE_ID = process.env.ACTOR_PROFILE_ID;
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p))!;

// ── The headless session context (the t-425 convention, with the REAL uuid) ──
const memStore = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => void memStore.clear(),
};
memStore.set(
  "el-imtiyaz.session",
  JSON.stringify({ tenantId: TENANT_ID, userId: ACTOR_PROFILE_ID ?? "t-433-import" }),
);

async function main() {
  if (!SERVICE_KEY) {
    console.error("FATAL: SUPABASE_SERVICE_KEY env var required (service role — owner-gated)");
    process.exit(1);
  }
  if (!ACTOR_PROFILE_ID || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ACTOR_PROFILE_ID)) {
    console.error(
      "FATAL: ACTOR_PROFILE_ID env var required — the owner admin's user_profiles.id UUID " +
        "(the payments.collected_by column is uuid-typed; a free-text actor fails the flush with 22P02)",
    );
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Preflight 1: the 0124 clear must have run (0 imp- installments). ──
  const { count: impCount } = await db
    .from("installments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID)
    .eq("source_type", "bulk_import")
    .like("source_id", "imp-%");
  console.log(`preflight: imp- installments remaining = ${impCount ?? "?"}`);
  if ((impCount ?? 0) > 0) {
    console.error(
      "FATAL: the installments still carry imp- rows — apply migration 0124 FIRST (the clear), then re-run.",
    );
    process.exit(1);
  }

  // ── The REAL repositories over the service-role client ──
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
      actorId: ACTOR_PROFILE_ID,
      actorName: "T-433 WB2 import (owner mandate)",
    }),
    auditSink: {
      async logAction(action, entityType, entityId, diff, note) {
        await audit.log({
          action,
          entityType,
          entityId,
          actorId: ACTOR_PROFILE_ID,
          actorName: "T-433 WB2 import (owner mandate)",
          tenantId: TENANT_ID,
          diff: diff ? { after: diff } : null,
          note: note ?? null,
        });
      },
    },
  });

  const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH));
  console.log(`workbook: ${XLSX_PATH}`);
  console.log(`actor: ${ACTOR_PROFILE_ID} (the owner admin profile — collected_by/audit attribution)`);
  console.log("running the canonical import (dryRun: false)…");
  const t0 = Date.now();
  const ctx = await engine.importFile(bytes, XLSX_PATH, {
    dryRun: false,
    source: { user: ACTOR_PROFILE_ID },
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
  console.log("\nT-433 live re-import complete.");
}

main().catch((e) => {
  console.error("RE-IMPORT FAILED:", e);
  process.exit(1);
});
