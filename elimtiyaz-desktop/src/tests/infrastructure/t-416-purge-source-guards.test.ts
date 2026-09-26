/**
 * T-416 (PURGE-500/501/502 / ADR-027 / issue #12) — source-scan guards for the
 * canonical student/parent domain purge.
 *
 * The owner's session directive makes the contract explicit: "make sure the
 * purge does not interfere with the sync and backup processes." These guards
 * pin that contract to the migration FILES themselves — a regression (a
 * future edit that reaches into the backup family, blanket-clears the sync
 * queue, or drops the safety gates) fails the suite instead of silently
 * shipping.
 *
 * The chain now carries TWO canonical files (0121 is the PURGE-502 amendment,
 * the 0119 whole-function-replacement precedent):
 *  - 0120_purge_student_parent_domain.sql — the original canonical RPC
 *    (live-0118 overload reconciliation + the full family census).
 *  - 0121_purge_approval_request_orphan_closure.sql — the same body with
 *    ONE predicate extended in the account_approval_requests family
 *    (requests keyed to a purged auth account die with the account).
 *
 * Every invariant below is enforced against BOTH files (0121 must pass
 * everything 0120 passes — it is the live-effective function), plus
 * per-file specifics (0120: the overload drop; 0121: the delta discipline).
 *
 * Guarded invariants:
 *  1. The live-0118 overload reconciliation (0120 drops EVERY overload first).
 *  2. The three gates (super_admin/console, fail-closed tenant, typed phrase).
 *  3. Dry-run/execute parity (every delete family has a count branch).
 *  4. The FK-safe delete order (allocations → payments → … → students →
 *     parents → … → user_profiles → auth.users).
 *  5. THE NO-INTERFERENCE CONTRACT: no delete/drop/alter on backup_archives
 *     or any backup/sync infrastructure; the sync_queue delete carries the
 *     five-domain-entity filter; audit_logs is insert-only (write_audit_log).
 *  6. The receipts existence guard (the §57c live divergence).
 *  7. The staff-account guard (is_staff_role exclusion).
 *  8. The T-091 registration block + the PostgREST grants (per file).
 *  9. PURGE-502: the approval-request family matches target-linked rows AND
 *     requests keyed to purged auth accounts, while staying tenant-scoped.
 * 10. The 0121 delta discipline: the ONLY non-comment body change vs 0120
 *     is the PURGE-502 predicate — nothing else moved.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
const MIGRATIONS = join(DESKTOP_ROOT, "supabase", "migrations");
const FILE_0120 = "0120_purge_student_parent_domain.sql";
const FILE_0121 = "0121_purge_approval_request_orphan_closure.sql";
const sql0120 = readFileSync(join(MIGRATIONS, FILE_0120), "utf8");
const sql0121 = readFileSync(join(MIGRATIONS, FILE_0121), "utf8");

/** First index of a `delete from <table>` branch for a table. */
function firstDeleteIndex(table: string, sqlLower: string): number {
  const m = sqlLower.match(new RegExp(`delete\\s+from\\s+${table.replace(/\./g, "\\.")}\\b`));
  if (!m || m.index === undefined) return -1;
  return m.index;
}

/** All `delete from X` target tables in order of appearance. */
function deleteTargets(sqlLower: string): string[] {
  return [...sqlLower.matchAll(/delete\s+from\s+([\w.]+)/g)].map((m) => m[1]);
}

/** All `select count(*) into v_n from X` dry-run branches in order. */
function countTargets(sqlLower: string): string[] {
  return [...sqlLower.matchAll(/select\s+count\(\*\)\s+into\s+v_n\s+from\s+([\w.]+)/g)].map(
    (m) => m[1],
  );
}

/**
 * The shared canonical-invariant suite — run against EVERY file that
 * defines the live-effective function body (0120 and 0121).
 */
function canonicalInvariantSuite(fileName: string, sql: string): void {
  const sqlLower = sql.toLowerCase();

  describe(`T-416 — ${fileName}: the three safety gates`, () => {
    it("gate 1 — super_admin role OR a DB-superuser console session (never a PostgREST role)", () => {
      expect(sql).toContain("public.has_role('super_admin')");
      // The console path is gated on session_user rolsuper (PostgREST's
      // anon/authenticated/service_role are never superuser).
      expect(sql).toContain("rolname = session_user and rolsuper");
      // …and the gate FAILS CLOSED (returns forbidden) rather than falling through.
      expect(sql).toContain("'code', 'forbidden'");
    });

    it("gate 2 — tenant resolution is fail-closed (never a null-tenant match-everything)", () => {
      expect(sql).toContain("coalesce(p_tenant_id, public.current_tenant_id())");
      expect(sql).toContain("'code', 'tenant_unresolved'");
      expect(sql).toContain("'code', 'invalid_tenant'");
      // The resolved tenant must exist in tenants before anything else runs.
      expect(sql).toContain("from public.tenants where id = v_tenant");
    });

    it("gate 3 — the typed phrase gates EXECUTE mode only (dry-run never deletes)", () => {
      expect(sql).toContain("if not p_dry_run and coalesce(btrim(p_confirm_phrase), '') <> 'PURGER'");
      expect(sql).toContain("'code', 'confirmation_required'");
    });

    it("dry-run is the DEFAULT parameter (the issue's cannot-be-triggered-accidentally bar)", () => {
      expect(sql).toMatch(/p_dry_run\s+boolean\s+default\s+true/);
    });
  });

  describe(`T-416 — ${fileName}: dry-run/execute parity + the FK-safe order`, () => {
    it("every delete family has a matching dry-run count branch (the preview cannot drift)", () => {
      const dels = deleteTargets(sqlLower);
      const cnts = countTargets(sqlLower);
      expect(dels.length).toBeGreaterThan(0);
      expect(new Set(dels)).toEqual(new Set(cnts));
      expect(dels.length).toBe(cnts.length);
    });

    it("the financial closure runs children-first (allocations before payments before parents)", () => {
      const alloc = firstDeleteIndex("public.payment_allocations", sqlLower);
      const pay = firstDeleteIndex("public.payments", sqlLower);
      const inst = firstDeleteIndex("public.installments", sqlLower);
      const parents = firstDeleteIndex("public.parents", sqlLower);
      expect(alloc).toBeGreaterThan(-1);
      expect(alloc).toBeLessThan(pay);
      expect(pay).toBeGreaterThan(-1);
      expect(pay).toBeLessThan(inst); // payments die with their allocations gone; installments follow
      expect(inst).toBeLessThan(parents);
    });

    it("students die BEFORE parents (students.parent_id is on delete restrict)", () => {
      const students = firstDeleteIndex("public.students", sqlLower);
      const parents = firstDeleteIndex("public.parents", sqlLower);
      expect(students).toBeGreaterThan(-1);
      expect(students).toBeLessThan(parents);
    });

    it("the portal closure runs messages → channels → profiles → auth.users", () => {
      const msgs = firstDeleteIndex("public.chat_messages", sqlLower);
      const channels = firstDeleteIndex("public.chat_channels", sqlLower);
      const profiles = firstDeleteIndex("public.user_profiles", sqlLower);
      const authUsers = firstDeleteIndex("auth.users", sqlLower);
      expect(msgs).toBeLessThan(channels);
      expect(channels).toBeLessThan(profiles);
      expect(profiles).toBeLessThan(authUsers);
    });

    it("the sync-queue cleanup is the LAST family (staging reflects the purged domain)", () => {
      const queue = firstDeleteIndex("public.sync_queue", sqlLower);
      const last = Math.max(...deleteTargets(sqlLower).map((t) => firstDeleteIndex(t, sqlLower)));
      expect(queue).toBe(last);
    });
  });

  describe(`T-416 — ${fileName}: THE NO-INTERFERENCE CONTRACT (the owner's directive)`, () => {
    it("NEVER touches the backup family — no delete/drop/alter on backup_archives or the backup RPCs", () => {
      expect(sqlLower).not.toMatch(/delete\s+from\s+(public\.)?backup_archives/);
      expect(sqlLower).not.toMatch(/(drop|alter)\s+(table|function|index)[^;]*backup/);
      expect(sqlLower).not.toContain("purge_expired_backups");
    });

    it("NEVER touches the sync infrastructure — no drop/alter/call on the queue or the sync RPCs", () => {
      expect(sqlLower).not.toMatch(/(drop|alter)\s+(table|function)[^;]*sync_queue/);
      // Operational references to the sync RPCs are banned — a bare textual
      // mention inside the never-touched DOCUMENTATION comment is fine (the
      // header names what is preserved by design).
      expect(sqlLower).not.toMatch(/(drop|alter)\s+function[^;]*(mark_sync_queue_processed|upsert_parent_from_import|upsert_student_from_import)/);
      expect(sqlLower).not.toMatch(/(call|perform|select)\s+[^;]*(mark_sync_queue_processed|upsert_parent_from_import|upsert_student_from_import)\s*\(/);
      // …and the function body (the plpgsql block between the CREATE and the
      // grants) contains no statement touching them at all.
      const bodyStart = sqlLower.indexOf("as $$", sqlLower.indexOf("create or replace function public.purge_student_parent_domain"));
      const bodyEnd = sqlLower.indexOf("$$;", bodyStart);
      const body = sqlLower.slice(bodyStart, bodyEnd);
      for (const banned of ["mark_sync_queue_processed", "upsert_parent_from_import", "upsert_student_from_import"]) {
        expect(body).not.toContain(banned);
      }
    });

    it("the ONLY sync_queue deletes carry the five-domain-entity filter (PURGE-501)", () => {
      const queueDeletes = [...sqlLower.matchAll(/delete\s+from\s+public\.sync_queue[^;]*;/g)].map(
        (m) => m[0],
      );
      expect(queueDeletes.length).toBeGreaterThan(0);
      for (const d of queueDeletes) {
        expect(d).toContain("entity in ('parent', 'student', 'payment', 'installment', 'ledger_entry')");
        expect(d).toContain("tenant_id = v_tenant");
      }
      // And the function RETURNS the untouched remainder as evidence.
      expect(sql).toContain("'sync_queue_other'");
    });

    it("audit_logs is INSERT-ONLY — the purge writes one entry and deletes no history", () => {
      expect(sqlLower).not.toMatch(/delete\s+from\s+(public\.)?audit_logs/);
      expect(sqlLower).not.toMatch(/(drop|alter)\s+(table|function)[^;]*audit/);
      const auditWrites = [...sql.matchAll(/public\.write_audit_log\(/g)];
      expect(auditWrites.length).toBe(1);
      expect(sql).toContain("'system.purge_student_parent_domain'");
      // The audit entry is written in EXECUTE mode only (dry-run changed nothing).
      expect(sql).toContain("if not p_dry_run then");
    });

    it("NEVER touches the academic catalog or the workforce/operations domains", () => {
      const never: string[] = [
        "public.academic_years",
        "public.academic_levels",
        "public.subjects",
        "public.classes",
        "public.class_subjects",
        "public.filieres",
        "public.timetable_",
        "public.rooms",
        "public.personnel",
        "public.salary_",
        "public.workforce_",
        "public.expense_",
        "public.suppliers",
        "public.inventory_",
        "public.pending_receipts", // the OPERATIONS purchase-receipt table (ADR-027 naming trap)
        "public.releve_entries", // personnel timesheet
        "public.workflow_runs", // engine history — the §15.26 forensic precedent
        "public.ai_request_logs",
        "public.tasks",
      ];
      for (const table of never) {
        const re = new RegExp(`delete\\s+from\\s+${table.replace(/\./g, "\\.")}`);
        expect(sqlLower.match(re)).toBeNull();
      }
    });
  });

  describe(`T-416 — ${fileName}: the boundary guards`, () => {
    it("the receipts family is guarded by an information_schema existence check (§57c)", () => {
      const guard = sqlLower.indexOf("information_schema.tables");
      const receipts = firstDeleteIndex("public.receipts", sqlLower);
      expect(guard).toBeGreaterThan(-1);
      expect(receipts).toBeGreaterThan(-1);
      // The existence check wraps the receipts branch.
      expect(receipts).toBeGreaterThan(guard);
      expect(sqlLower).toContain("table_name = 'receipts'");
    });

    it("the staff-account guard excludes staff-role holders from the portal closure", () => {
      expect(sql).toContain("r.is_staff_role");
      expect(sql).toContain("where up.auth_user_id = ids.au");
    });

    it("grants PostgREST execute (authenticated + service_role)", () => {
      expect(sqlLower).toContain("grant execute on function public.purge_student_parent_domain");
      expect(sqlLower).toContain("to authenticated");
      expect(sqlLower).toContain("to service_role");
    });
  });
}

// ---------------------------------------------------------------------------
// The chain-level facts (both files, in order)
// ---------------------------------------------------------------------------
describe("T-416 — the canonical chain: 0120 + the 0121 amendment (PURGE-502)", () => {
  it("exactly TWO files define the function, in chain order (one canonical source + one amendment)", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    const definers = files.filter((f) => {
      const text = readFileSync(join(MIGRATIONS, f), "utf8");
      return /create\s+(or\s+replace\s+)?function\s+public\.purge_student_parent_domain/.test(text);
    });
    expect(definers).toEqual([FILE_0120, FILE_0121]);
  });

  it("0121 replaces the SAME signature (no overload drift — the PURGE-500 lesson)", () => {
    expect(sql0121).toMatch(
      /create or replace function public\.purge_student_parent_domain\(\s*p_confirm_phrase text,\s*p_dry_run boolean default true,\s*p_tenant_id uuid default null\s*\)/,
    );
  });

  it("PURGE-502 — the amended approval family: target-linked OR keyed to a purged account, tenant-scoped", () => {
    const approvalDeletes = [
      ...sql0121.toLowerCase().matchAll(/delete\s+from\s+public\.account_approval_requests[^;]*;/g),
    ].map((m) => m[0]);
    expect(approvalDeletes.length).toBe(1);
    expect(approvalDeletes[0]).toContain("target_parent_id");
    expect(approvalDeletes[0]).toContain("target_student_id");
    expect(approvalDeletes[0]).toContain("t.auth_user_id = any(v_auth_ids)");
    expect(approvalDeletes[0]).toContain("tenant_id = v_tenant");
  });

  it("PURGE-502 boundary preserved — v_auth_ids only ever contains accounts CLAIMED by the domain", () => {
    // The auth-id collection is the same claimed-accounts union (with the
    // staff exclusion) — an unclaimed pending signup's account is never in
    // the set, so its request can never match the amended predicate.
    expect(sql0121).toContain("where p.tenant_id = v_tenant and p.auth_user_id is not null");
    expect(sql0121).toContain("r.is_staff_role");
  });

  it("the 0121 delta discipline — the ONLY non-comment body changes vs 0120 are the PURGE-502 predicate and the audit-note fix", () => {
    const bodyLines = (sql: string): string[] => {
      const start = sql.indexOf("create or replace function public.purge_student_parent_domain");
      const end = sql.indexOf("$$;", start);
      return sql
        .slice(start, end)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("--"));
    };
    const before = new Set(bodyLines(sql0120));
    const after = new Set(bodyLines(sql0121));
    const added = [...after].filter((l) => !before.has(l));
    const removed = [...before].filter((l) => !after.has(l));
    // (a) the PURGE-502 predicate: the old single-line ending …)); is split
    //     into the same line without the terminator + the new auth-keyed line.
    // (b) the audit-note fix: jsonb_object_length(jsonb) does not exist on
    //     PG (live-caught run 7 — every EXECUTE would have died at the audit
    //     write) — replaced with the jsonb_object_keys count.
    expect(added.sort()).toEqual([
      "or t.auth_user_id = any(v_auth_ids));",
      "or t.target_student_id = any(v_student_ids)",
      "|| v_total || ' rows across ' || (select count(*) from jsonb_object_keys(v_counts)) || ' families; '",
    ]);
    expect(removed.sort()).toEqual([
      "or t.target_student_id = any(v_student_ids));",
      "|| v_total || ' rows across ' || jsonb_object_length(v_counts) || ' families; '",
    ]);
  });

  it("the live-effective body NEVER calls the nonexistent jsonb_object_length (the run-7 regression pin)", () => {
    // The HEADER documents the fix (and may name the dead function) — the
    // pin applies to the FUNCTION BODY only.
    const start = sql0121.indexOf("create or replace function public.purge_student_parent_domain");
    const body = sql0121.slice(start, sql0121.indexOf("$$;", start));
    expect(body).not.toContain("jsonb_object_length");
    // …and the working expression is present in the audit note.
    expect(body).toContain("select count(*) from jsonb_object_keys(v_counts)");
  });

  it("0120 registers itself atomically (the T-091 block)", () => {
    expect(sql0120).toContain(
      "values ('0120', '{0120_purge_student_parent_domain.sql}', 'purge_student_parent_domain')",
    );
  });

  it("0121 registers itself atomically (the T-091 block, idempotent)", () => {
    expect(sql0121).toContain(
      "values ('0121', '{0121_purge_approval_request_orphan_closure.sql}', 'purge_approval_request_orphan_closure')",
    );
    expect(sql0121.toLowerCase()).toContain("on conflict (version) do nothing");
  });
});

describe("T-416 — migration 0120: the live-0118 overload reconciliation (PURGE-500)", () => {
  it("drops EVERY existing overload of the function name BEFORE creating the canonical one", () => {
    const sqlLower = sql0120.toLowerCase();
    const dropBlock = sqlLower.indexOf("pg_proc");
    expect(dropBlock).toBeGreaterThan(-1);
    const dropLoop = sqlLower.indexOf("purge_student_parent_domain", dropBlock);
    expect(dropLoop).toBeGreaterThan(dropBlock);
    const createAt = sqlLower.indexOf("create or replace function public.purge_student_parent_domain");
    expect(createAt).toBeGreaterThan(-1);
    // The drop-everything loop must precede the canonical CREATE.
    expect(dropLoop).toBeLessThan(createAt);
    // The drop uses the pg_proc census (any signature), not a fixed one.
    expect(sqlLower).toContain("p.proname = 'purge_student_parent_domain'");
  });
});

// The full canonical invariant suite, per file — 0121 (the live-effective
// body) must pass everything 0120 passes.
canonicalInvariantSuite(FILE_0120, sql0120);
canonicalInvariantSuite(FILE_0121, sql0121);
