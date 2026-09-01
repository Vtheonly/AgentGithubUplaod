/**
 * WEAK-030 regression suite — the expense-approval state machine + hard
 * no-self-approval are enforced at the DB LAYER (migration 0064), not only
 * in the desktop adapters.
 *
 * The bypasses this migration closes (both reproduced live by
 * scripts/verify_t-weak030.sql, run against the live project and rolled back):
 *   B1 STATE-MACHINE BYPASS — 0008's trigger checked individual invariants
 *      but no transition graph: a submitter (RLS lets them update their OWN
 *      ticket) or any manager/financial officer could jump the status to any
 *      value via direct PostgREST (pending_approval → settled_and_closed,
 *      reopen settled_and_closed → pending_approval, rejected → disbursed…).
 *   B2 NULL-APPROVER SELF-APPROVAL — 0008's self-approval rule only fired
 *      when approved_by = submitted_by; a submitter approving their own
 *      ticket could leave approved_by NULL and the trigger passed it.
 *
 * The canonical DB graph (established from the DB's OWN writers — 0008's
 * workflow header, the approve_expense/settle_expense RPCs of 0022, and the
 * T-093 adapter — NOT invented here):
 *     draft                    → pending_approval
 *     pending_approval         → approved_funds_released | rejected
 *     approved_funds_released  → disbursed | settled_and_closed
 *     disbursed                → settled_and_closed
 *     rejected, settled_and_closed → terminal
 *   INSERT may only start at draft or pending_approval.
 *
 * This suite pins:
 *   1. migration 0064 exists in the canonical chain and encodes exactly that
 *      graph (every legal edge present, both terminal states unreachable);
 *   2. the NULL-approver block exists and is scoped to the ENTERING change
 *      (legacy approved rows keep their other columns editable);
 *   3. the 0008 invariants survive verbatim (receipt, final amount,
 *      rejection reason);
 *   4. the desktop adapter's client-side machine (T-093) stays a SUBSET of
 *      the DB graph — a stricter client on a permissive-enough server is
 *      fine; the reverse would be a divergence.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
const MIGRATION = join(DESKTOP_ROOT, "supabase", "migrations", "0064_expense_transition_guard.sql");
const ADAPTER = join(DESKTOP_ROOT, "src", "infrastructure", "supabase", "repositories", "supabase-expense-repository.ts");

/** The canonical DB-side graph, as (from, to) pairs of DB status values. */
const DB_GRAPH: Array<[string, string[]]> = [
  ["draft", ["pending_approval"]],
  ["pending_approval", ["approved_funds_released", "rejected"]],
  ["approved_funds_released", ["disbursed", "settled_and_closed"]],
  ["disbursed", ["settled_and_closed"]],
  ["rejected", []],
  ["settled_and_closed", []],
];

/** Domain status → DB status (the adapter's lossless translation). */
const DOMAIN_TO_DB: Record<string, string> = {
  draft: "draft",
  submitted: "pending_approval",
  approved: "approved_funds_released",
  rejected: "rejected",
  disbursed: "disbursed",
  settled: "settled_and_closed",
};

describe("WEAK-030 — expense transition guard at the DB layer (migration 0064)", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("the migration exists in the canonical chain with a descriptive header", () => {
    expect(sql.startsWith("-- 0064_expense_transition_guard.sql")).toBe(true);
    expect(sql).toContain("WEAK-030");
  });

  it("encodes every legal edge of the canonical DB graph", () => {
    for (const [from, tos] of DB_GRAPH) {
      for (const to of tos) {
        // Each edge must appear as a guarded (old → new) pair. NB: the
        // pattern must not consume the quote right after "in (" — the
        // target may be the FIRST value of the list.
        const edge = new RegExp(
          `old\\.status = '${from}'[^;]*new\\.status in \\([^)]*'${to}'`,
        );
        expect({
          from,
          to,
          present: edge.test(sql),
        }).toEqual({ from, to, present: true });
      }
    }
  });

  it("no exit exists from the terminal states (rejected, settled_and_closed)", () => {
    expect(sql).not.toMatch(/old\.status = 'rejected'/);
    expect(sql).not.toMatch(/old\.status = 'settled_and_closed'/);
  });

  it("INSERT may only start at draft or pending_approval", () => {
    expect(sql).toMatch(
      /tg_op = 'INSERT' and new\.status not in \('draft', 'pending_approval'\)/,
    );
  });

  it("blocks the NULL-approver self-approval bypass, scoped to the entering change", () => {
    // (c) fires only when the ticket ENTERS approved_funds_released…
    expect(sql).toMatch(
      /tg_op = 'INSERT' or old\.status is distinct from 'approved_funds_released'/,
    );
    // …and requires the approver to be SET and different from the submitter.
    expect(sql).toMatch(/new\.approved_by is null or new\.approved_by = new\.submitted_by/);
    expect(sql).toContain("approver other than the submitter");
  });

  it("preserves the 0008 invariants verbatim (receipt, final amount, rejection reason)", () => {
    expect(sql).toContain("Receipt upload is mandatory before settlement (plan §08)");
    expect(sql).toContain("Final spent amount must be set before settlement");
    expect(sql).toContain("A rejection reason is required");
  });

  it("re-binds the trigger with rejected_reason in the guarded column list", () => {
    expect(sql).toMatch(
      /before insert or update of status, approved_by, receipt_path, final_spent_amount, rejected_reason/,
    );
    expect(sql).toMatch(/drop trigger if exists expense_tickets_enforce_workflow/);
  });

  it("the desktop adapter's client-side machine stays a SUBSET of the DB graph", () => {
    const adapter = readFileSync(ADAPTER, "utf8");
    // Extract the adapter's ALLOWED_TRANSITIONS literal.
    const m = adapter.match(
      /ALLOWED_TRANSITIONS[^=]*=\s*\{([\s\S]*?)\}\s*;/,
    );
    expect(m).not.toBeNull();
    const body = m![1];
    const clientEdges = [...body.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map(
      ([, from, tos]) =>
        [
          from.trim(),
          tos
            .split(",")
            .map((t) => t.trim().replace(/["']/g, ""))
            .filter(Boolean),
        ] as [string, string[]],
    );
    expect(clientEdges.length).toBeGreaterThan(0);
    for (const [domainFrom, domainTos] of clientEdges) {
      const dbFrom = DOMAIN_TO_DB[domainFrom];
      expect(dbFrom).toBeDefined();
      const dbTos = DB_GRAPH.find(([f]) => f === dbFrom)?.[1];
      expect(dbTos).toBeDefined();
      for (const domainTo of domainTos) {
        expect({
          clientEdge: `${domainFrom} → ${domainTo}`,
          dbEdge: `${dbFrom} → ${DOMAIN_TO_DB[domainTo]}`,
          allowedByDb: dbTos!.includes(DOMAIN_TO_DB[domainTo]),
        }).toEqual({
          clientEdge: `${domainFrom} → ${domainTo}`,
          dbEdge: `${dbFrom} → ${DOMAIN_TO_DB[domainTo]}`,
          allowedByDb: true,
        });
      }
    }
  });
});
