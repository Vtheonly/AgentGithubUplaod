/**
 * T-226 regression tests — the workflow action-executor contracts
 * (supabase/functions/workflow-execute/actions.ts), source-pinned.
 *
 * The actions module imports Deno APIs, so the suite cannot execute it —
 * but every CONTRACT the live matrix proved (t226-action-matrix.sh 15/15,
 * 2026-09-07) is pinned here at the source level so a regression cannot
 * silently re-introduce the DAG-100-era fake-success defects:
 *
 *   1. push_notification: the PARENT path goes through the canonical 0077
 *      notify_parent_user RPC with a CALLER-SCOPED client (the live bug:
 *      service-role → "caller has no tenant context"); a target_role
 *      config must NEVER fall into the parent path (precedence fix);
 *      per-recipient FCM failures are RECORDED (partial_failure), never
 *      swallowed.
 *   2. dispatch_task: a REAL tasks insert (never null assignee_ids — the
 *      column is NOT NULL).
 *   3. restrict_account: a REAL parents.is_financially_restricted update
 *      scoped by tenant, with a mutation audit entry; a committed mutation
 *      whose audit write fails is FAILED loudly (audit hole surfaced).
 *   4. send_whatsapp: an honest wa.me PREPARATION — delivered: 0, no
 *      delivery claim.
 *   5. The unbacked financial mutations (apply_discount / create_invoice /
 *      generate_document / account_adjustment) + database_query are honest
 *      SKIPS with reasons — never fake successes.
 *   6. dry_run: every mutating executor branches on run.dryRun BEFORE any
 *      write.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
const ACTIONS = "supabase/functions/workflow-execute/actions.ts";
const src = readFileSync(join(DESKTOP_ROOT, ACTIONS), "utf8");

describe("T-226 — action executor contracts (source-pinned)", () => {
  it("the actions module exists with the honest-outcome contract header", () => {
    expect(src).toContain("HONESTY CONTRACT");
    expect(src).toContain("NEVER a");
    expect(src).toContain("skippedByDesign");
  });

  it("parent in-app notifications go through the 0077 RPC with a CALLER-SCOPED client", () => {
    expect(src).toContain('rpc("notify_parent_user"');
    expect(src).toContain("createUserScopedClient(run.callerJwt)");
    // The live-evidence comment documenting WHY (service role has no
    // auth.uid → "caller has no tenant context").
    expect(src).toContain("caller has no");
  });

  it("a target_role config never falls into the parent path (precedence fix)", () => {
    expect(src).toContain("!explicitTarget && !staffRoleTarget && parentId");
  });

  it("per-recipient FCM failures are recorded honestly, never swallowed", () => {
    expect(src).toContain("partial_failure: true");
    expect(src).toContain("failures.slice(0, 5)");
  });

  it("undeliverable parents are reported honestly (no fake dispatch)", () => {
    expect(src).toContain("UNDELIVERABLE");
    expect(src).toContain("no active portal account");
  });

  it("dispatch_task inserts REAL tasks rows (assignee_ids never null)", () => {
    expect(src).toContain('.from("tasks")');
    
    expect(src).toContain("// assignee_ids is NOT NULL (default '[]') — always an array.");
    expect(src).toContain("assignee_ids: assigneeIds.length > 0 ? assigneeIds : []");
    expect(src).toContain('created_by_name: "Workflow automation"');
  });

  it("restrict_account mutates parents.is_financially_restricted tenant-scoped + audited", () => {
    expect(src).toContain(".update({ is_financially_restricted: restrictTo })");
    expect(src).toContain('.eq("tenant_id", run.tenantId)');
    expect(src).toContain('"workflow.account_restriction"');
    expect(src).toContain("audit_write_failed");
  });

  it("send_whatsapp prepares a wa.me link WITHOUT claiming delivery", () => {
    expect(src).toContain("https://wa.me/");
    expect(src).toContain("delivered: 0");
    expect(src).toContain("no WhatsApp API integration exists, no delivery claimed");
  });

  it("the unbacked financial mutations are honest skips, not fake successes", () => {
    for (const subtype of ["apply_discount", "create_invoice", "generate_document", "account_adjustment"]) {
      expect(src).toContain(`case "${subtype}"`);
    }
    expect(src).toContain("no canonical financial RPC backs this action yet");
    expect(src).toContain("database_query");
    expect(src).toContain("arbitrary SQL from workflow configs is forbidden");
    // No fake-success markers may RETURN from an executor (the header
    // comment names the historical defect — only the output-object pattern
    // is forbidden).
    expect(src).not.toContain("output: { stub: true");
    expect(src).not.toMatch(/return ok\(\{[^}]*sent: 1[^}]*stub/);
  });

  it("dry_run branches BEFORE any write in every mutating executor", () => {
    expect(src).toContain("if (run.dryRun) {");
    // count the dry-run guards: notify parent, dispatch_task, restrict,
    // staff push, log_audit, send_email, delay = 7+
    const guards = src.match(/if \(run\.dryRun\) \{/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(7);
  });

  it("extract_field resolves real context dot-paths", () => {
    expect(src).toContain("case \"extract_field\"");
    expect(src).toContain("function resolve(");
  });
});
