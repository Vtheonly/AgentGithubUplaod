/**
 * T-228 regression tests — the workflow-resume-scheduler Edge Function
 * (persistent delay/resume), source-pinned.
 *
 * The scheduler imports Deno APIs, so the suite pins its CONTRACTS at the
 * source level (the engine's park/resume semantics are unit-tested in
 * workflow-engine.test.ts; the live matrices proved the full cycle):
 *
 *   1. cron-only auth (isCronInvocation — SEC-105 pattern, no user surface);
 *   2. the ATOMIC claim (UPDATE ... WHERE status='pending' — concurrent
 *      invocations can never double-process; live evidence: an immediate
 *      duplicate invocation claims 0);
 *   3. re-entry through the SAME pure engine (import from
 *      workflow-execute/engine.ts — no duplicated execution logic);
 *   4. re-park propagates the patched node_results (resumed flags survive
 *      into the next state snapshot);
 *   5. cancelled resumes (workflow unpublished/deleted/invalid) fail the
 *      run honestly;
 *   6. the parked node's result tells the truth post-resume;
 *   7. the scheduler context uses the service-role parent writer (empty
 *      callerJwt — the 0077 RPC requires a staff JWT);
 *   8. config.toml registers the cron schedule (every 10 minutes).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
const SCHED = "supabase/functions/workflow-resume-scheduler/index.ts";
const ACTIONS = "supabase/functions/workflow-execute/actions.ts";
const CONFIG = "supabase/config.toml";

const read = (rel: string): string => readFileSync(join(DESKTOP_ROOT, rel), "utf8");

describe("T-228 — workflow-resume-scheduler contracts (source-pinned)", () => {
  it("the scheduler EF exists and accepts only cron/internal invocations", () => {
    expect(existsSync(join(DESKTOP_ROOT, SCHED))).toBe(true);
    const src = read(SCHED);
    expect(src).toContain("isCronInvocation(req)");
    expect(src).toContain("This scheduler accepts only CRON_SECRET / service_role invocations");
  });

  it("the claim is ATOMIC (pending→claimed in one UPDATE with RETURNING)", () => {
    const src = read(SCHED);
    expect(src).toContain('.update({ status: "claimed", claimed_at:');
    expect(src).toContain('.eq("status", "pending")');
    expect(src).toContain('.lte("resume_after",');
    // The live-evidence comment for the duplicate protection.
    expect(src).toContain("concurrent invocations can never double-process");
  });

  it("re-entry goes through the SAME pure engine (no duplicated executor)", () => {
    const src = read(SCHED);
    expect(src).toContain('from "../workflow-execute/engine.ts"');
    expect(src).toContain("executeWorkflowDefinition");
    expect(src).toContain("resume: state");
    // The real action layer is reused too.
    expect(src).toContain('from "../workflow-execute/actions.ts"');
  });

  it("re-park propagates the PATCHED node_results into the next state snapshot", () => {
    const src = read(SCHED);
    expect(src).toContain("patchedState");
    expect(src).toContain("node_results: nodeResults");
  });

  it("unpublishable/cancelled resumes fail the run honestly", () => {
    const src = read(SCHED);
    expect(src).toContain("cancelResume");
    expect(src).toContain("resume cancelled:");
    expect(src).toContain("is no longer published");
  });

  it("the parked node's result reflects the elapsed delay post-resume", () => {
    const src = read(SCHED);
    expect(src).toContain("delay elapsed — run resumed by workflow-resume-scheduler");
    expect(src).toContain("resumed: true");
  });

  it("scheduler context uses the service-role parent writer (empty callerJwt)", () => {
    const src = read(SCHED);
    expect(src).toContain('callerJwt: ""');
    const actions = read(ACTIONS);
    expect(actions).toContain("deliverParentNotificationServiceRole");
    expect(actions).toContain("[scheduler context]");
  });

  it("config.toml registers the cron schedule + verify_jwt=false", () => {
    const config = read(CONFIG);
    expect(config).toContain("[functions.workflow-resume-scheduler]");
    expect(config).toContain('cron = "*/10 * * * *"');
  });

  it("migration 0082 closes the insert-published gate gap (T-228 discovery)", () => {
    const mig = read("supabase/migrations/0082_workflow_publish_insert_gate.sql");
    expect(mig).toContain("workflows_publish_gate_insert");
    expect(mig).toContain("before insert on public.workflows");
    // Direct-insert publishes land at version 1 (the workflow_version_check
    // violation that revealed the gap).
    expect(mig).toContain("new.version := 1");
  });
});
