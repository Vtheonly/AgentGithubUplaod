/**
 * T-584 — the scheduled automation runner (EXECUTION-PLAN §4 5.16 /
 * ROADMAP 5.16).
 *
 * What this suite pins:
 *
 *   A. THE CRON EVALUATOR (the shared pure module — the SAME source the
 *      Edge Function imports):
 *      - field syntax: wildcards, values, ranges, steps (star-slash-n),
 *        lists;
 *      - DOW 0 AND 7 are both Sunday; DOM/DOW OR semantics;
 *      - malformed expressions fail honestly (never throw).
 *
 *   B. THE WINDOW SEMANTICS (the 10-minute tick contract):
 *      - a cron instant inside (start, end] fires;
 *      - adjacent windows are DISJOINT — the same instant can never fire
 *        twice across consecutive ticks (the double-fire guard);
 *      - an instant at the exact boundary belongs to the LATER window.
 *
 *   C. THE SELECTION CORE (the EF's Deno-free core — candidate filtering):
 *      - only PUBLISHED workflows with a calendar_cron_event/schedule
 *        trigger root are schedulable; drafts never fire;
 *      - event-trigger workflows are ignored (not skipped — their bridges
 *        own them); malformed cron → skipped with a reason.
 *
 *   D. THE MOCK END-TO-END (the card's "a scheduled workflow fires
 *      end-to-end in mock"):
 *      - the SEEDED PUBLISHED TEMPLATE (Clôture Trimestrielle — the card's
 *        working example) is deployed through the REAL mock repository;
 *      - a tick whose window contains the cron instant fires it: a
 *        WorkflowRun is recorded (triggerType 'scheduled'), the action
 *        nodes produce REAL side effects, and the audit trail carries the
 *        scheduling actor;
 *      - the NEXT tick (disjoint window) does NOT double-fire;
 *      - a tick outside the schedule does not fire;
 *      - the roll-call `absence_limit_exceeded` bridge (the card's event
 *        half) still fires — the working example's other leg.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-584-scheduled-runner.test.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCronExpression,
  cronMatchesDate,
  cronFiresInWindow,
} from "../../../supabase/functions/workflow-scheduled-runner/cron.ts";
import {
  selectDueScheduledWorkflows,
  windowForTick,
  type ScheduledWorkflowCandidate,
} from "../../../supabase/functions/workflow-scheduled-runner/core.ts";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { MockWorkflowRepository } from "../../infrastructure/mock/repositories/workflow-repository";
import {
  dispatchScheduledTick,
  dispatchAbsenceLimitExceeded,
} from "../../infrastructure/mock/repositories/workflow-event-bridge";
import {
  WORKFLOW_TEMPLATES,
  instantiateTemplate,
} from "../../domain/calc/workflow/templates";
import type { Student } from "../../domain/model/student";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../../../");
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

/* ---------------- helpers ---------------- */

/** A UTC Date at a whole minute. */
const at = (iso: string): Date => new Date(iso);

function parseOk(expr: string): ReturnType<typeof parseCronExpression> {
  const r = parseCronExpression(expr);
  expect(r.ok).toBe(true);
  return r;
}

/* ---------------- A — the cron evaluator ---------------- */

describe("T-584 A — the shared cron evaluator", () => {
  it("A1: parses the five fields (values, ranges, steps, lists, wildcards)", () => {
    const a = parseOk("0 18 * 12 *"); // daily at 18:00 every December
    if (!a.ok) return;
    expect(a.cron.minutes.has(0)).toBe(true);
    expect(a.cron.hours.has(18)).toBe(true);
    expect(a.cron.daysOfMonth).toBeNull();
    expect(a.cron.months.has(12)).toBe(true);
    expect(a.cron.daysOfWeek).toBeNull();

    const b = parseOk("*/15 8-10 1,15 */2 1-5");
    if (!b.ok) return;
    expect([...b.cron.minutes].sort((x, y) => x - y)).toEqual([0, 15, 30, 45]);
    expect([...b.cron.hours].sort((x, y) => x - y)).toEqual([8, 9, 10]);
    expect([...b.cron.daysOfMonth!].sort((x, y) => x - y)).toEqual([1, 15]);
    // Standard cron: */2 in the month field steps from the field MINIMUM (1) — Jan, Mar, May…
    expect([...b.cron.months].sort((x, y) => x - y)).toEqual([1, 3, 5, 7, 9, 11]);
    expect([...b.cron.daysOfWeek!].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it("A2: DOW 0 and 7 are BOTH Sunday", () => {
    const zero = parseOk("0 8 * * 0");
    const seven = parseOk("0 8 * * 7");
    if (!zero.ok || !seven.ok) return;
    // 2026-11-22 is a Sunday.
    expect(cronMatchesDate(zero.cron, at("2026-11-22T08:00:00Z"))).toBe(true);
    expect(cronMatchesDate(seven.cron, at("2026-11-22T08:00:00Z"))).toBe(true);
    // ...and Monday is NOT.
    expect(cronMatchesDate(zero.cron, at("2026-11-23T08:00:00Z"))).toBe(false);
  });

  it("A3: DOM/DOW OR semantics when both are restricted (Vixie rule)", () => {
    // Both restricted: fires on the 13th OR on any Friday.
    const cron = parseOk("0 12 13 * 5");
    if (!cron.ok) return;
    expect(cronMatchesDate(cron.cron, at("2026-11-13T12:00:00Z"))).toBe(true); // the 13th (a Friday too)
    expect(cronMatchesDate(cron.cron, at("2026-11-20T12:00:00Z"))).toBe(true); // a Friday, not the 13th
    expect(cronMatchesDate(cron.cron, at("2026-11-19T12:00:00Z"))).toBe(false); // a Thursday, not the 13th
  });

  it("A4: malformed expressions fail honestly (never throw)", () => {
    expect(parseCronExpression("not a cron").ok).toBe(false);
    expect(parseCronExpression("0 18 * *").ok).toBe(false);
    expect(parseCronExpression("60 18 * * *").ok).toBe(false);
    expect(parseCronExpression("0 25 * * *").ok).toBe(false);
    expect(parseCronExpression("0 18 0 * *").ok).toBe(false);
    expect(parseCronExpression("0 18 * * 9").ok).toBe(false);
    expect(parseCronExpression("*/0 18 * * *").ok).toBe(false);
    expect(parseCronExpression("").ok).toBe(false);
  });
});

/* ---------------- B — the window semantics ---------------- */

describe("T-584 B — the 10-minute tick window (the double-fire guard)", () => {
  it("B1: a cron instant INSIDE the window fires", () => {
    const cron = parseOk("0 18 * 12 *"); // 18:00 every December day
    if (!cron.ok) return;
    // Tick at 18:03 — window (17:53, 18:03] contains 18:00.
    expect(cronFiresInWindow(cron.cron, { startMs: Date.parse("2026-12-01T17:53:00Z"), endMs: Date.parse("2026-12-01T18:03:00Z") })).toBe(true);
    // Tick at 18:00 exactly — window (17:50, 18:00] contains 18:00 (inclusive end).
    expect(cronFiresInWindow(cron.cron, { startMs: Date.parse("2026-12-01T17:50:00Z"), endMs: Date.parse("2026-12-01T18:00:00Z") })).toBe(true);
  });

  it("B2: adjacent windows are DISJOINT — the same instant never fires twice", () => {
    const cron = parseOk("0 18 * 12 *");
    if (!cron.ok) return;
    const t1 = Date.parse("2026-12-01T18:00:00Z");
    // Tick 1 at 18:00:00 (window (17:50, 18:00]) and tick 2 at 18:10:00
    // (window (18:00, 18:10]): the 18:00 instant belongs to tick 1 ONLY.
    expect(cronFiresInWindow(cron.cron, windowForTick(t1))).toBe(true);
    expect(cronFiresInWindow(cron.cron, windowForTick(t1 + 10 * 60 * 1000))).toBe(false);
    // And the reverse order: the tick BEFORE (17:50, window (17:40,17:50])
    // does not contain 18:00 either.
    expect(cronFiresInWindow(cron.cron, windowForTick(t1 - 10 * 60 * 1000))).toBe(false);
  });

  it("B3: a window entirely outside the schedule does not fire", () => {
    const cron = parseOk("0 18 * 12 *"); // December only
    if (!cron.ok) return;
    expect(cronFiresInWindow(cron.cron, windowForTick(Date.parse("2026-11-01T18:00:00Z")))).toBe(false);
    expect(cronFiresInWindow(cron.cron, windowForTick(Date.parse("2026-12-01T09:00:00Z")))).toBe(false);
  });
});

/* ---------------- C — the selection core (the EF's contract) ---------------- */

describe("T-584 C — the due-workflow selection core", () => {
  const mk = (over: Partial<ScheduledWorkflowCandidate>): ScheduledWorkflowCandidate => ({
    id: "wf-x",
    tenant_id: "t1",
    name: "X",
    code: "X",
    status: "published",
    trigger_type: "scheduled",
    dag_definition: {
      nodes: [
        { id: "n1", type: "trigger", subtype: "calendar_cron_event", config: { cron: "0 18 * 12 *" } },
        { id: "n2", type: "action", subtype: "log_audit", config: {} },
      ],
    },
    ...over,
  });

  const window = windowForTick(Date.parse("2026-12-01T18:00:00Z"));

  it("C1: a published scheduled workflow with a due cron is selected", () => {
    const r = selectDueScheduledWorkflows([mk({})], window);
    expect(r.due).toHaveLength(1);
    expect(r.due[0].cron).toBe("0 18 * 12 *");
    expect(r.due[0].triggerNodeId).toBe("n1");
  });

  it("C2: drafts and disabled workflows NEVER fire", () => {
    expect(selectDueScheduledWorkflows([mk({ status: "draft" })], window).due).toHaveLength(0);
    expect(selectDueScheduledWorkflows([mk({ status: "disabled" })], window).due).toHaveLength(0);
  });

  it("C3: event-trigger workflows are ignored (their bridges own them); malformed cron is skipped with a reason", () => {
    const eventWf = mk({
      dag_definition: { nodes: [{ id: "n1", type: "trigger", subtype: "payment_overdue", config: {} }] },
    });
    const badCron = mk({ dag_definition: { nodes: [{ id: "n1", type: "trigger", subtype: "schedule", config: { cron: "garbage" } }] } });
    const noCron = mk({ dag_definition: { nodes: [{ id: "n1", type: "trigger", subtype: "schedule", config: {} }] } });
    const r = selectDueScheduledWorkflows([eventWf, badCron, noCron], window);
    expect(r.due).toHaveLength(0);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toContain("invalid cron");
    expect(r.skipped[1].reason).toContain("no cron");
  });

  it("C4: the `schedule` (legacy) trigger flavour is schedulable too — via the shared cron", () => {
    const legacy = mk({
      dag_definition: { nodes: [{ id: "s1", type: "trigger", subtype: "schedule", config: { cron: "0 18 * 12 *" } }] },
    });
    expect(selectDueScheduledWorkflows([legacy], window).due).toHaveLength(1);
  });

  it("C5: a string dag_definition (the stored JSON form) parses identically", () => {
    const asString = mk({ dag_definition: JSON.stringify({ nodes: [{ id: "n1", type: "trigger", subtype: "calendar_cron_event", config: { cron: "0 18 * 12 *" } }] }) });
    expect(selectDueScheduledWorkflows([asString], window).due).toHaveLength(1);
  });
});

/* ---------------- D — the mock end-to-end ---------------- */

describe("T-584 D — a scheduled workflow fires end-to-end in mock", () => {
  let repo: MockWorkflowRepository;

  beforeEach(() => {
    // Isolated store per test (the shared-singleton discipline).
    store.workflows = [];
    store.workflowRuns = [];
    store.audit = [];
    store.notifications = [];
    repo = new MockWorkflowRepository();
  });

  /** Deploy a template through the REAL repository (create → update → deploy). */
  async function deployTemplate(templateId: string): Promise<string> {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId)!;
    const built = template.build();
    const created = await repo.createWorkflow({
      name: template.name,
      description: template.description,
      triggerType: template.triggerType,
      createdBy: "admin-1",
    });
    if (!created.ok) throw new Error(created.error.userMessage);
    const seeded = await repo.updateWorkflow(created.value.id, { nodes: built.nodes, edges: built.edges }, "admin-1");
    if (!seeded.ok) throw new Error(seeded.error.userMessage);
    const deployed = await repo.deploy(created.value.id, "admin-1");
    if (!deployed.ok) throw new Error(deployed.error.userMessage);
    return created.value.id;
  }

  /** The SEEDED scheduled template (Clôture Trimestrielle — the card's working example). */
  const SCHEDULED_TEMPLATE_ID = "cloture-trimestrielle";

  /** Find the template's next fire instant after 2026-01-01 (UTC). */
  function firstFireInstant(cronExpr: string): number {
    const parsed = parseCronExpression(cronExpr);
    if (!parsed.ok) throw new Error(`template cron must parse: ${parsed.error}`);
    for (let t = Date.parse("2026-01-01T00:00:00Z"); t < Date.parse("2027-03-01T00:00:00Z"); t += 60_000) {
      if (cronMatchesDate(parsed.cron, new Date(t))) return t;
    }
    throw new Error("no fire instant found in the scan window");
  }

  it("D1: the working example — the seeded Clôture Trimestrielle template IS the scheduled trigger family", () => {
    // The card's working example: a seeded published template carrying the
    // calendar_cron_event root with a cron expression.
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === SCHEDULED_TEMPLATE_ID)!;
    expect(template.triggerType).toBe("scheduled");
    const { nodes } = template.build();
    const trigger = nodes.find((n) => n.type === "trigger");
    expect(trigger?.subtype).toBe("calendar_cron_event");
    expect(String(trigger?.config.cron)).toMatch(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/);
    // The roll-call trigger (the event half of the working example) is a
    // REGISTERED trigger subtype on the seeded absenteeism template.
    const absenteeism = WORKFLOW_TEMPLATES.find((t) =>
      t.build().nodes.some((n) => n.subtype === "absence_limit_exceeded"),
    );
    expect(absenteeism).toBeDefined();
  });

  it("D2: a tick whose window contains the cron instant fires the workflow end-to-end", async () => {
    const wfId = await deployTemplate(SCHEDULED_TEMPLATE_ID);
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === SCHEDULED_TEMPLATE_ID)!;
    const cronExpr = String(template.build().nodes.find((n) => n.type === "trigger")!.config.cron);
    const fireAt = firstFireInstant(cronExpr);

    // The tick lands 3 minutes AFTER the instant — the window
    // (fireAt-13min, fireAt+3min] contains it (the runner's documented
    // ≤10-minute delay).
    const tickAt = new Date(fireAt + 3 * 60 * 1000);
    const before = store.workflowRuns.length;
    const report = await dispatchScheduledTick(tickAt);

    expect(report.due).toContain(wfId);
    expect(report.fired).toHaveLength(1);
    expect(store.workflowRuns.length).toBe(before + 1);
    const run = store.workflowRuns[0];
    expect(run.workflowId).toBe(wfId);
    expect(run.triggerType).toBe("scheduled");
    expect(run.status).toBe("succeeded");
    // The scheduled context facts are visible to the engine.
    expect(run.nodeResults.some((r) => r.status === "succeeded")).toBe(true);
    // The audit trail carries the scheduling actor.
    const audit = store.audit.find((a) => a.entityId === run.id);
    expect(audit?.actorId).toBe("system");
    expect(audit?.actorName).toContain("planificateur");
  });

  it("D3: the NEXT tick (disjoint window) does NOT double-fire", async () => {
    await deployTemplate(SCHEDULED_TEMPLATE_ID);
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === SCHEDULED_TEMPLATE_ID)!;
    const cronExpr = String(template.build().nodes.find((n) => n.type === "trigger")!.config.cron);
    const fireAt = firstFireInstant(cronExpr);
    const tick1 = new Date(fireAt + 3 * 60 * 1000);
    const tick2 = new Date(tick1.getTime() + 10 * 60 * 1000); // the next runner tick
    await dispatchScheduledTick(tick1);
    expect(store.workflowRuns.length).toBe(1);
    const report2 = await dispatchScheduledTick(tick2);
    expect(report2.fired).toHaveLength(0);
    expect(store.workflowRuns.length).toBe(1); // still exactly one run
  });

  it("D4: a tick OUTSIDE the schedule does not fire; a DRAFT scheduled workflow never fires", async () => {
    // Create but do NOT deploy — the draft never fires even when due.
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === SCHEDULED_TEMPLATE_ID)!;
    const built = template.build();
    const created = await repo.createWorkflow({
      name: template.name,
      description: template.description,
      triggerType: template.triggerType,
      createdBy: "admin-1",
    });
    if (!created.ok) throw new Error(created.error.userMessage);
    const seeded = await repo.updateWorkflow(created.value.id, { nodes: built.nodes, edges: built.edges }, "admin-1");
    if (!seeded.ok) throw new Error(seeded.error.userMessage);

    const report = await dispatchScheduledTick(new Date("2026-06-15T12:00:00Z"));
    expect(report.fired).toHaveLength(0);
    expect(store.workflowRuns.length).toBe(0);
  });

  it("D5: the roll-call absence_limit_exceeded bridge (the event half of the working example) still fires", async () => {
    // Deploy the absenteeism template (absence_limit_exceeded trigger).
    const template = WORKFLOW_TEMPLATES.find((t) =>
      t.build().nodes.some((n) => n.subtype === "absence_limit_exceeded"),
    )!;
    await deployTemplate(template.id);

    const student: Pick<Student, "id" | "parentId" | "firstName" | "lastName" | "status"> = {
      id: "elv-001",
      parentId: "par-001",
      firstName: "Amine",
      lastName: "Belkacem",
      status: "active",
    };
    const runs = await dispatchAbsenceLimitExceeded(student, 3, "usr-teacher");
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(store.workflowRuns[0].triggerType).toBe("automatic");
  });
});

/* ---------------- E — the deployment wiring (source pins) ---------------- */

describe("T-584 E — the runner is wired for deployment", () => {
  it("E1: config.toml declares the 10-minute cron for workflow-scheduled-runner", () => {
    const cfg = read("supabase/config.toml");
    expect(cfg).toContain("[functions.workflow-scheduled-runner]");
    const start = cfg.indexOf("[functions.workflow-scheduled-runner]");
    const next = cfg.indexOf("[functions.", start + 1);
    const section = cfg.slice(start, next === -1 ? cfg.length : next);
    expect(section).toContain('cron = "*/10 * * * *"');
    expect(section).toContain("verify_jwt = false");
  });

  it("E2: the EF index is cron-auth-gated (no user-facing surface)", () => {
    const src = read("supabase/functions/workflow-scheduled-runner/index.ts");
    expect(src).toContain("isCronInvocation");
    expect(src).toContain("401");
    // The EF reuses the SAME engine + actions as workflow-execute (no parallel engine).
    expect(src).toContain("../workflow-execute/engine.ts");
    expect(src).toContain("../workflow-execute/actions.ts");
    expect(src).toContain("./core.ts");
  });

  it("E3: the EF's run rows use the 0001 trigger_type enum spellings", () => {
    const src = read("supabase/functions/workflow-scheduled-runner/index.ts");
    expect(src).toContain('trigger_type: triggerType');
    expect(src).toContain('wf.trigger_type === "schedule" ? "schedule" : "calendar_cron_event"');
  });
});
