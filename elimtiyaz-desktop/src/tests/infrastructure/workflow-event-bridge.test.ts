/**
 * T-314 — the school-domain → workflow event bridge, END-TO-END through the
 * REAL mock repositories. These tests re-enact the owner's 3 demonstration
 * flows at the repository level:
 *
 *   1. Attendance escalation: recordRollCall marks a student absent for the
 *      3rd unexcused time → the DEPLOYED absence_limit_exceeded workflow
 *      fires → REAL notification (bell +1) + REAL task (Personnel → Tâches)
 *      + run record (Workflow → Exécutions).
 *   2. Debt delinquent: execute() with a real-parent context → the TRUE
 *      branch runs → restrict_account sets financiallyRestricted on the
 *      parent (CRM « Accès restreint ») + WhatsApp prepared.
 *   3. payment_recorded / student_enrolled dispatchers fire on collect /
 *      batchRegister.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import {
  mockWorkflowRepository,
} from "../../infrastructure/mock/repositories/workflow-repository";
import { MockAttendanceRepository } from "../../infrastructure/mock/repositories/academic-repository";
import { mockTaskRepository } from "../../infrastructure/mock/workforce";
import type { WorkflowNode, WorkflowEdge } from "../../domain/model/workflow";

const ACTOR = { id: "usr-test-t314", name: "T-314 Test" };

function node(id: string, type: WorkflowNode["type"], subtype: WorkflowNode["subtype"], config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, subtype, label: id, position: { x: 0, y: 0 }, config };
}

function edge(from: string, to: string, sourceHandle?: "true" | "false"): WorkflowEdge {
  return { id: `e-${from}-${to}-${sourceHandle ?? "out"}`, from, to, ...(sourceHandle ? { sourceHandle } : {}) };
}

async function deployWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): Promise<string> {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const created = await mockWorkflowRepository.createWorkflow({
    name: `T-314 ${nodes[0]?.subtype ?? "flow"} ${suffix}`,
    description: "event-bridge probe",
    triggerType: "automatic",
    createdBy: ACTOR.id,
  });
  if (!created.ok) throw new Error(created.error.userMessage);
  const seeded = await mockWorkflowRepository.updateWorkflow(created.value.id, { nodes, edges }, ACTOR.id);
  if (!seeded.ok) throw new Error(seeded.error.userMessage);
  const deployed = await mockWorkflowRepository.deploy(created.value.id, ACTOR.id);
  if (!deployed.ok) throw new Error(deployed.error.userMessage);
  return created.value.id;
}

beforeEach(() => {
  // Nothing destructive: the shared store accumulates, and each test counts
  // DELTAS (before/after) rather than absolute values.
});

/* ------------------- demo flow 1 — attendance escalation ------------------ */

describe("event bridge — RollCallScreen → absence_limit_exceeded (demo 1)", () => {
  it("marking the 3rd unexcused absence fires the workflow: bell +1, task created, run recorded", async () => {
    const student = store.students[0];
    expect(student).toBeTruthy();
    const parentBefore = store.parents.find((p) => p.id === student.parentId);
    expect(parentBefore).toBeTruthy();

    const workflowId = await deployWorkflow(
      [
        node("t-att-1", "trigger", "absence_limit_exceeded", { threshold: 3 }),
        node("a-att-1", "action", "push_notification", {
          title: "Alerte absences",
          body: "3 absences non justifiées — merci de contacter l'administration.",
          recipient_role: "parent",
        }),
        node("a-att-2", "action", "dispatch_task", {
          title: "Convocation — surveillant général",
          assignee_role: "supervisor",
          priority: "urgent",
        }),
      ],
      [edge("t-att-1", "a-att-1"), edge("t-att-1", "a-att-2")],
    );

    const notificationsBefore = store.notifications.length;
    const runsBefore = store.workflowRuns.filter((r) => r.workflowId === workflowId).length;
    const auditBefore = store.audit.length;
    const tasksBefore = mockTaskRepository.observe().get().length;

    // Seed 2 prior unexcused absences in the current term, then roll-call the 3rd.
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const d1 = new Date(now.getTime() - 5 * 86_400_000);
    const d2 = new Date(now.getTime() - 4 * 86_400_000);
    store.attendance.push(
      {
        id: `att-seed-1-${student.id}`,
        studentId: student.id,
        classId: student.classId ?? "cls-001",
        date: iso(d1),
        session: "morning",
        status: "absent_unexcused",
        note: null,
        recordedBy: "usr-seed",
        recordedAt: d1.toISOString(),
        syncedAt: d1.toISOString(),
      },
      {
        id: `att-seed-2-${student.id}`,
        studentId: student.id,
        classId: student.classId ?? "cls-001",
        date: iso(d2),
        session: "morning",
        status: "absent_unexcused",
        note: null,
        recordedBy: "usr-seed",
        recordedAt: d2.toISOString(),
        syncedAt: d2.toISOString(),
      },
    );
    store.notifyAttendance();

    const attendanceRepo = new MockAttendanceRepository();
    const statuses = new Map<string, "absent_unexcused">([[student.id, "absent_unexcused"]]);
    const result = await attendanceRepo.recordRollCall({
      classId: student.classId ?? "cls-001",
      date: iso(now),
      session: "morning",
      statuses,
      recordedBy: ACTOR.id,
    });
    expect(result.ok).toBe(true);

    // The workflow dispatch is fire-and-forget inside recordRollCall; the
    // mock bridge executes synchronously, but give the microtask queue a beat.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 1. Bell +1 (at least one REAL notification from the workflow).
    const newNotifications = store.notifications.slice(0, store.notifications.length - notificationsBefore);
    const workflowNotification = newNotifications.find(
      (n) => n.source === "workflow" && (n.entityId === parentBefore?.id || n.entityId === null),
    );
    expect(workflowNotification).toBeTruthy();
    expect(workflowNotification?.title).toContain("Alerte absences");
    // The module-level alert may ALSO fire (alertAbsences) — that's fine;
    // the workflow's own notification is what we assert on.

    // 2. Task created in Personnel → Tâches.
    const tasksNow = mockTaskRepository.observe().get();
    expect(tasksNow.length).toBeGreaterThanOrEqual(tasksBefore + 1);
    const workflowTask = tasksNow.find(
      (t) => t.tags.includes("workflow") && t.tags.includes(workflowId),
    );
    expect(workflowTask).toBeTruthy();
    expect(workflowTask?.title).toContain("Convocation");

    // 3. Execution recorded in Workflow → Exécutions.
    const runsNow = store.workflowRuns.filter((r) => r.workflowId === workflowId);
    expect(runsNow.length).toBe(runsBefore + 1);
    const run = runsNow[0];
    expect(run.status).toBe("succeeded");
    expect(run.nodeResults.find((n) => n.nodeId === "a-att-2")?.status).toBe("succeeded");

    // 4. Audit trail entries written.
    expect(store.audit.length).toBeGreaterThan(auditBefore);
  });

  it("a roll call that does NOT cross the threshold fires nothing", async () => {
    const student = store.students[1] ?? store.students[0];
    const runsBefore = store.workflowRuns.length;
    const notificationsBefore = store.notifications.length;

    const attendanceRepo = new MockAttendanceRepository();
    const statuses = new Map<string, "present">([[student.id, "present"]]);
    await attendanceRepo.recordRollCall({
      classId: student.classId ?? "cls-001",
      date: new Date().toISOString().slice(0, 10),
      session: "morning",
      statuses,
      recordedBy: ACTOR.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.workflowRuns.length).toBe(runsBefore);
    expect(store.notifications.length).toBe(notificationsBefore);
  });
});

/* --------------------- demo flow 2 — debt delinquent ---------------------- */

describe("event bridge — debt delinquent flow (demo 2)", () => {
  it("execute() with a high-debt parent context: TRUE branch runs, parent RESTRICTED, WhatsApp prepared", async () => {
    const parent = store.parents.find((p) => !p.financiallyRestricted);
    expect(parent).toBeTruthy();

    const workflowId = await deployWorkflow(
      [
        node("t-debt-1", "trigger", "payment_overdue", { grace_days: 7 }),
        node("c-debt-1", "condition", "debt_over_threshold", {
          condition: { kind: "comparison", field: "debt.amount", op: ">", value: 40_000 },
        }),
        node("a-rest-1", "action", "restrict_account", { days_overdue: 30 }),
        node("a-wa-1", "action", "send_whatsapp", {
          template: "Bonjour {{parent.name}}, votre solde de {{debt.amount}} DZD nécessite votre attention.",
        }),
        node("a-soft-1", "action", "push_notification", { title: "Rappel doux", body: "Merci de régulariser." }),
      ],
      [
        edge("t-debt-1", "c-debt-1"),
        edge("c-debt-1", "a-rest-1", "true"),
        edge("c-debt-1", "a-wa-1", "true"),
        edge("c-debt-1", "a-soft-1", "false"),
      ],
    );

    const notificationsBefore = store.notifications.length;
    const r = await mockWorkflowRepository.execute(workflowId, ACTOR.id, ACTOR.name, {
      context: {
        parent: { id: parent!.id, name: `${parent!.firstName} ${parent!.lastName}`, outstanding_balance: 65_000 },
        debt: { amount: 65_000, threshold: 40_000, days_overdue: 45 },
        student: { absence_count: 0, status: "active", gpa: 12.5 },
      },
      targetParentId: parent!.id,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.userMessage);

    // TRUE branch ran; FALSE branch skipped.
    const byId = new Map(r.value.nodeResults.map((n) => [n.nodeId, n]));
    expect(byId.get("a-rest-1")?.status).toBe("succeeded");
    expect(byId.get("a-wa-1")?.status).toBe("succeeded");
    expect(byId.get("a-soft-1")?.status).toBe("skipped");

    // REAL side effect: the parent is restricted (CRM « Accès restreint »).
    const restricted = store.parents.find((p) => p.id === parent!.id);
    expect(restricted?.financiallyRestricted).toBe(true);

    // The run outputs carry the real-effect descriptions.
    expect(byId.get("a-rest-1")?.output).toContain("restreint");
    expect(byId.get("a-wa-1")?.output).toContain("WhatsApp");

    // The WhatsApp preparation produced a staff notification with the
    // resolved message (65 000 from the context).
    const newNotifications = store.notifications.slice(0, store.notifications.length - notificationsBefore);
    const waNotification = newNotifications.find((n) => n.title.startsWith("WhatsApp prêt"));
    expect(waNotification).toBeTruthy();
    expect(waNotification?.body).toContain("65");
  });
});

/* ------------------- payment + enrollment dispatchers --------------------- */

describe("event bridge — payment & enrollment dispatch (T-314)", () => {
  it("dispatchTrigger fires only the workflows whose trigger matches", async () => {
    const paymentWf = await deployWorkflow(
      [node("t-pay-1", "trigger", "payment_recorded", {}), node("a-pay-1", "action", "log_audit", { note: "paiement reçu" })],
      [edge("t-pay-1", "a-pay-1")],
    );
    // A workflow with a DIFFERENT trigger must NOT fire.
    const absenceWf = await deployWorkflow(
      [node("t-abs-1", "trigger", "student_enrolled", {}), node("a-abs-1", "action", "log_audit", { note: "inscrit" })],
      [edge("t-abs-1", "a-abs-1")],
    );

    const payRunsBefore = store.workflowRuns.filter((r) => r.workflowId === paymentWf).length;
    const absRunsBefore = store.workflowRuns.filter((r) => r.workflowId === absenceWf).length;

    const dispatch = await mockWorkflowRepository.dispatchTrigger?.({
      triggerSubtype: "payment_recorded",
      context: { payment: { amount: 20_000, method: "cash", status: "paid" } },
      actorId: "system",
      actorName: "Système (test)",
    });
    expect(dispatch?.ok).toBe(true);

    expect(store.workflowRuns.filter((r) => r.workflowId === paymentWf).length).toBe(payRunsBefore + 1);
    expect(store.workflowRuns.filter((r) => r.workflowId === absenceWf).length).toBe(absRunsBefore);
  });

  it("cycle detection still blocks deployment (Kahn — demo 3, repository gate)", async () => {
    const created = await mockWorkflowRepository.createWorkflow({
      name: `T-314 cycle ${Date.now().toString(36)}`,
      description: "cycle probe",
      triggerType: "manual",
      createdBy: ACTOR.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.userMessage);
    const cyclic = await mockWorkflowRepository.updateWorkflow(
      created.value.id,
      {
        nodes: [
          node("t-cy-1", "trigger", "manual_run"),
          node("a-cy-1", "action", "log_audit"),
        ],
        edges: [
          edge("t-cy-1", "a-cy-1"),
          edge("a-cy-1", "t-cy-1"), // the loop — action back to the trigger
        ],
      },
      ACTOR.id,
    );
    // Kahn runs on EVERY save (§10.09 best practice 1) — the save itself fails.
    expect(cyclic.ok).toBe(false);
    if (!cyclic.ok) {
      expect(cyclic.error.userMessage).toContain("Cycle");
    }
  });
});
