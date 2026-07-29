/**
 * Iteration 9 — integration tests for cross-module workflows.
 *
 * Verifies that the operations repositories compose correctly with the
 * rest of the system:
 *   - Purchase → Delivery → Receipt → Inventory workflow
 *   - Task assignment → status updates → audit log
 *   - Chat message → channel preview update → read receipts
 *   - Onboarding → department creation → personnel assignment
 *   - Leave request → manager approval → audit log
 *   - Inventory scan → transaction log → quantity update
 *
 * These tests exercise the repositories directly (not the UI) to verify
 * business logic flows end-to-end.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockRepositories } from "../../infrastructure/repository-provider";

describe("Iteration 9 — Purchase → Delivery → Receipt → Inventory workflow", () => {
  it("a complete purchase workflow flows through all 4 repositories", async () => {
    const { purchaseRequests, deliveries, warehouseTasks, inventory, audit } = mockRepositories;

    // 1. Buyer creates a purchase request
    const prResult = await purchaseRequests.createPurchaseRequest({
      title: "Workflow test PR",
      description: "End-to-end workflow",
      priority: "high",
      supplierId: "sup-001",
      departmentId: "dept-buyers",
      lines: [
        { id: "wl-1", description: "Test item", quantity: 50, unit: "pièce", estimatedUnitPrice: 100 },
      ],
      requestedBy: "usr-buy-001",
      requestedByName: "Test Buyer",
    });
    expect(prResult.ok).toBe(true);
    if (!prResult.ok) return;
    const prId = prResult.value.id;

    // 2. Manager approves the PR
    const approved = await purchaseRequests.updateStatus(prId, "approved", "usr-mgr-001", "Manager", "OK");
    expect(approved.ok).toBe(true);

    // 3. Buyer orders it
    const ordered = await purchaseRequests.updateStatus(prId, "ordered", "usr-buy-001", "Buyer");
    expect(ordered.ok).toBe(true);

    // 4. A delivery is created for the ordered PR
    const delResult = await deliveries.createDelivery({
      driverId: "per-011",
      driverName: "Messaoud",
      stops: [
        { id: "ws-1", sequence: 1, type: "pickup", label: "Supplier", address: "There", lat: null, lng: null, plannedAt: null, completedAt: null },
        { id: "ws-2", sequence: 2, type: "dropoff", label: "Warehouse", address: "Here", lat: null, lng: null, plannedAt: null, completedAt: null },
      ],
      purchaseRequestId: prId,
      notes: "Workflow delivery",
      vehicle: "Van",
      assignedBy: "usr-buy-001",
    });
    expect(delResult.ok).toBe(true);
    if (!delResult.ok) return;
    const delId = delResult.value.id;

    // 5. Driver picks up and delivers
    await deliveries.updateStatus(delId, "in_transit", "usr-drv-001", "Driver");
    await deliveries.updateStatus(delId, "delivered", "usr-drv-001", "Driver");
    await deliveries.uploadConfirmation(delId, "mock://confirm.pdf", "usr-drv-001", "Driver");

    // 6. Warehouse receives the goods — create a pending receipt
    const receiptResult = await warehouseTasks.createReceipt({
      supplierName: "Test supplier",
      purchaseRequestCode: prResult.value.requestCode,
      expectedQuantity: 50,
      expectedAt: "2025-09-30T00:00:00.000Z",
    });
    expect(receiptResult.ok).toBe(true);
    if (!receiptResult.ok) return;

    // 7. Warehouse worker receives the receipt
    const received = await warehouseTasks.receiveReceipt(receiptResult.value.id, "usr-whw-001", "Warehouse");
    expect(received.ok).toBe(true);
    if (received.ok) {
      expect(received.value.status).toBe("received");
    }

    // 8. The PR status advances to "received"
    const prReceived = await purchaseRequests.updateStatus(prId, "received", "usr-whw-001", "Warehouse");
    expect(prReceived.ok).toBe(true);
    if (prReceived.ok) {
      expect(prReceived.value.status).toBe("received");
    }

    // 9. Inventory is updated via a transact
    const invItem = inventory.observeItems().get()[0];
    const txResult = await inventory.transact({
      itemId: invItem.id,
      type: "receive",
      delta: 50,
      reason: `Receipt ${receiptResult.value.id}`,
      actorId: "usr-whw-001",
      actorName: "Warehouse",
      reference: prResult.value.requestCode,
    });
    expect(txResult.ok).toBe(true);

    // 10. Audit log captures the full chain
    const auditResult = await audit.recent(50);
    expect(auditResult.ok).toBe(true);
    if (auditResult.ok) {
      const actions = auditResult.value.map((a) => a.action);
      expect(actions).toContain("purchase_request.create");
      expect(actions).toContain("purchase_request.status_change");
      expect(actions).toContain("delivery.create");
      expect(actions).toContain("delivery.status_change");
      expect(actions).toContain("delivery.confirm");
      expect(actions).toContain("warehouse.receipt_create");
      expect(actions).toContain("warehouse.receipt_receive");
      expect(actions.some((a) => a.startsWith("inventory.transact"))).toBe(true);
    }
  });
});

describe("Iteration 9 — Task assignment → status → audit workflow", () => {
  it("creates a task, assigns it, updates status, and logs audit entries", async () => {
    const { tasks, audit } = mockRepositories;

    // 1. Create a task
    const createResult = await tasks.createTask({
      title: "Workflow task test",
      description: "End-to-end task workflow",
      priority: "medium",
      departmentId: "dept-workers",
      assigneeIds: ["per-010"],
      dueDate: "2025-12-31",
      createdBy: "usr-mgr-001",
      createdByName: "Manager",
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const taskId = createResult.value.id;
    expect(createResult.value.status).toBe("assigned");

    // 2. Worker starts the task
    const started = await tasks.updateTaskStatus(taskId, "in_progress", "usr-wrk-001");
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.value.status).toBe("in_progress");
      expect(started.value.progress).toBeGreaterThan(0);
    }

    // 3. Worker completes the task
    const completed = await tasks.updateTaskStatus(taskId, "completed", "usr-wrk-001");
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.value.status).toBe("completed");
      expect(completed.value.completedAt).not.toBeNull();
      expect(completed.value.progress).toBe(100);
    }

    // 4. Audit log captures the lifecycle
    const auditResult = await audit.recent(20);
    expect(auditResult.ok).toBe(true);
    if (auditResult.ok) {
      const taskActions = auditResult.value.filter((a) => a.entityType === "task");
      expect(taskActions.some((a) => a.action === "task.create")).toBe(true);
      expect(taskActions.some((a) => a.action === "task.status_change")).toBe(true);
    }
  });

  it("reassigns a task and the change is visible via observeByAssignee", async () => {
    const { tasks } = mockRepositories;

    const created = await tasks.createTask({
      title: "Reassign test",
      description: "",
      priority: "low",
      departmentId: null,
      assigneeIds: ["per-001"],
      dueDate: null,
      createdBy: "x",
      createdByName: "X",
    });
    if (created.ok) {
      const reassigned = await tasks.reassign(created.value.id, ["per-002", "per-003"], "x");
      expect(reassigned.ok).toBe(true);
      if (reassigned.ok) {
        expect(reassigned.value.assigneeIds).toEqual(["per-002", "per-003"]);
      }
    }
  });
});

describe("Iteration 9 — Chat message → channel preview → read receipts", () => {
  it("sending a message updates the channel preview and read receipts", async () => {
    const { chat } = mockRepositories;

    // 1. Create a direct channel between two users
    const channelResult = await chat.createChannel({
      type: "direct",
      name: "Integration test DM",
      description: null,
      memberIds: ["per-001", "per-002"],
      departmentId: null,
      createdBy: "per-001",
    });
    expect(channelResult.ok).toBe(true);
    if (!channelResult.ok) return;
    const channelId = channelResult.value.id;

    // 2. User 1 sends a message
    const msg1 = await chat.sendMessage({
      channelId,
      authorId: "per-001",
      authorName: "User 1",
      body: "Hello from integration test",
    });
    expect(msg1.ok).toBe(true);
    if (msg1.ok) {
      expect(msg1.value.readBy).toContain("per-001"); // author auto-reads
    }

    // 3. Channel preview is updated
    const channel = chat.observeChannel(channelId).get();
    expect(channel?.lastMessagePreview).toBe("Hello from integration test");
    expect(channel?.lastMessageAt).not.toBeNull();

    // 4. User 2 marks the channel as read
    const markReadResult = await chat.markRead(channelId, "per-002");
    expect(markReadResult.ok).toBe(true);

    // 5. All messages now have per-002 in readBy
    const messages = chat.observeMessages(channelId).get();
    expect(messages.every((m) => m.readBy.includes("per-002"))).toBe(true);

    // 6. User 2 replies
    const msg2 = await chat.sendMessage({
      channelId,
      authorId: "per-002",
      authorName: "User 2",
      body: "Reply",
    });
    expect(msg2.ok).toBe(true);

    // 7. Channel preview now shows the latest message
    const updatedChannel = chat.observeChannel(channelId).get();
    expect(updatedChannel?.lastMessagePreview).toBe("Reply");
  });
});

describe("Iteration 9 — Leave request → manager approval → audit", () => {
  it("an employee submits a leave request and a manager approves it", async () => {
    const { leaveRequests, audit } = mockRepositories;

    // 1. Employee submits a leave request
    const submitResult = await leaveRequests.submit({
      personnelId: "per-010",
      personnelName: "Said Bouzid",
      type: "leave",
      fromDate: "2025-11-01",
      toDate: "2025-11-05",
      reason: "Congé annuel",
    });
    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.value.status).toBe("pending");

    // 2. Manager sees it in pending
    const pending = leaveRequests.observePending().get();
    expect(pending.some((r) => r.id === submitResult.value.id)).toBe(true);

    // 3. Manager approves
    const approveResult = await leaveRequests.decide(
      submitResult.value.id,
      "approved",
      "usr-mgr-001",
      "Leïla Cherif",
      "Approuvé — couverture assurée",
    );
    expect(approveResult.ok).toBe(true);
    if (approveResult.ok) {
      expect(approveResult.value.status).toBe("approved");
      expect(approveResult.value.decidedBy).toBe("usr-mgr-001");
      expect(approveResult.value.decidedByName).toBe("Leïla Cherif");
    }

    // 4. Audit log captures both actions
    const auditResult = await audit.recent(20);
    expect(auditResult.ok).toBe(true);
    if (auditResult.ok) {
      const leaveActions = auditResult.value.filter((a) => a.entityType === "leave_request");
      expect(leaveActions.some((a) => a.action === "leave.submit")).toBe(true);
      expect(leaveActions.some((a) => a.action === "leave.decide")).toBe(true);
    }
  });

  it("a manager can reject a leave request with a reason", async () => {
    const { leaveRequests } = mockRepositories;

    const submitResult = await leaveRequests.submit({
      personnelId: "per-015",
      personnelName: "Omar",
      type: "absence",
      fromDate: "2025-11-10",
      toDate: "2025-11-10",
      reason: "Raison personnelle",
    });
    if (submitResult.ok) {
      const rejectResult = await leaveRequests.decide(
        submitResult.value.id,
        "rejected",
        "usr-mgr-001",
        "Manager",
        "Refusé — pic d'activité",
      );
      expect(rejectResult.ok).toBe(true);
      if (rejectResult.ok) {
        expect(rejectResult.value.status).toBe("rejected");
        expect(rejectResult.value.decisionNote).toBe("Refusé — pic d'activité");
      }
    }
  });
});

describe("Iteration 9 — Inventory scan → transaction → quantity update", () => {
  it("scanning a new SKU creates an item and logs a transaction", async () => {
    const { inventory } = mockRepositories;

    const beforeCount = inventory.observeItems().get().length;

    const scanResult = await inventory.scan({
      sku: "SCAN-INT-001",
      label: "Integration scan item",
      category: "fournitures",
      unit: "pièce",
      quantity: 25,
      actorId: "usr-whw-001",
      actorName: "Warehouse",
    });
    expect(scanResult.ok).toBe(true);

    const afterCount = inventory.observeItems().get().length;
    expect(afterCount).toBe(beforeCount + 1);

    if (scanResult.ok) {
      // The item exists with the right quantity
      const item = inventory.observeItemById(scanResult.value.id).get();
      expect(item?.quantityOnHand).toBe(25);

      // A scan transaction was logged
      const txs = inventory.observeTransactionsByItem(scanResult.value.id).get();
      expect(txs.some((t) => t.type === "scan")).toBe(true);
    }
  });

  it("scanning an existing SKU adds to its quantity", async () => {
    const { inventory } = mockRepositories;

    const item = inventory.observeItems().get()[0];
    const before = item.quantityOnHand;

    const scanResult = await inventory.scan({
      sku: item.sku,
      label: item.label,
      category: item.category,
      unit: item.unit,
      quantity: 5,
      actorId: "usr-whw-001",
      actorName: "Warehouse",
    });
    expect(scanResult.ok).toBe(true);
    if (scanResult.ok) {
      expect(scanResult.value.id).toBe(item.id);
      expect(scanResult.value.quantityOnHand).toBe(before + 5);
    }
  });

  it("reporting damage reduces quantity and logs a damage transaction", async () => {
    const { inventory } = mockRepositories;

    const item = inventory.observeItems().get().find((i) => i.quantityOnHand > 5)!;
    const before = item.quantityOnHand;

    const damageResult = await inventory.transact({
      itemId: item.id,
      type: "damage",
      delta: -3,
      reason: "Casse pendant le transport",
      actorId: "usr-whw-001",
      actorName: "Warehouse",
      reference: null,
    });
    expect(damageResult.ok).toBe(true);
    if (damageResult.ok) {
      expect(damageResult.value.quantityAfter).toBe(before - 3);
      expect(damageResult.value.type).toBe("damage");
    }

    const after = inventory.observeItemById(item.id).get();
    expect(after?.quantityOnHand).toBe(before - 3);
  });
});

describe("Iteration 9 — Onboarding → state persistence", () => {
  beforeEach(async () => {
    await mockRepositories.onboarding.reset();
  });

  it("the onboarding wizard can be started, advanced, and completed", async () => {
    const { onboarding } = mockRepositories;

    // Start
    const startResult = await onboarding.start();
    expect(startResult.ok).toBe(true);

    // Advance through steps
    await onboarding.completeStep("welcome");
    await onboarding.advanceTo("departments");
    await onboarding.updateData({
      departments: [{ name: "Test Dept", color: "brand-blue", headId: null }],
    });
    await onboarding.completeStep("departments");

    // Complete
    const completeResult = await onboarding.complete();
    expect(completeResult.ok).toBe(true);
    if (completeResult.ok) {
      expect(completeResult.value.completedAt).not.toBeNull();
      expect(completeResult.value.currentStep).toBe("done");
    }

    // isComplete returns true
    const isComplete = await onboarding.isComplete();
    expect(isComplete.ok).toBe(true);
    if (isComplete.ok) {
      expect(isComplete.value).toBe(true);
    }
  });

  it("onboarding data persists across advanceTo calls", async () => {
    const { onboarding } = mockRepositories;

    await onboarding.start();
    await onboarding.updateData({ employeeCount: 42 });
    await onboarding.advanceTo("roles");
    await onboarding.updateData({ departments: [{ name: "X", color: "brand-blue", headId: null }] });

    const state = onboarding.observe().get();
    expect(state).not.toBeNull();
    if (state) {
      expect(state.data.employeeCount).toBe(42);
      expect(state.data.departments).toHaveLength(1);
    }
  });
});
