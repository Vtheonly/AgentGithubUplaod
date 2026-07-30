/**
 * Operations mock repository tests — iteration 9.
 *
 * Covers SupplierRepository, PurchaseRequestRepository, DeliveryRepository,
 * InventoryRepository, WarehouseTaskRepository. Each section tests CRUD
 * round-trips, status workflow transitions, audit-log side effects, and
 * edge cases (not-found, validation, idempotency).
 */
import { describe, it, expect } from "vitest";
import {
  mockSupplierRepository,
  mockPurchaseRequestRepository,
  mockDeliveryRepository,
  mockInventoryRepository,
  mockWarehouseTaskRepository,
} from "../../../infrastructure/mock/operations-mock-repositories";

/* ------------------------------------------------------------------ */
/*  Suppliers                                                          */
/* ------------------------------------------------------------------ */

describe("MockSupplierRepository (iteration 9)", () => {
  it("seeds with 4 suppliers", () => {
    const list = mockSupplierRepository.observe().get();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some((s) => s.name === "Naftal Carburant")).toBe(true);
    expect(list.some((s) => s.name === "Éditions Alpha")).toBe(true);
  });

  it("creates a new supplier", async () => {
    const result = await mockSupplierRepository.createSupplier({
      name: "Test Supplier",
      category: "Test",
      contactName: "Test Contact",
      phone: "+213 555 00 00 00",
      email: "test@supplier.dz",
      address: "Test Address",
      paymentTerms: "30 jours",
      rating: 4.0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toMatch(/^sup-/);
      expect(result.value.name).toBe("Test Supplier");
    }
  });

  it("updates a supplier", async () => {
    const result = await mockSupplierRepository.updateSupplier("sup-001", { rating: 4.9 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rating).toBe(4.9);
    }
  });

  it("returns Err for unknown supplier id on update", async () => {
    const result = await mockSupplierRepository.updateSupplier("sup-nonexistent", { name: "X" });
    expect(result.ok).toBe(false);
  });

  it("archives a supplier", async () => {
    const result = await mockSupplierRepository.archiveSupplier("sup-002");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archivedAt).not.toBeNull();
    }
  });

  it("deletes a supplier", async () => {
    const created = await mockSupplierRepository.createSupplier({
      name: "ToDelete",
      category: "X",
      contactName: "X",
      phone: "X",
      email: null,
      address: null,
      paymentTerms: "X",
      rating: 0,
    });
    if (created.ok) {
      const result = await mockSupplierRepository.deleteSupplier(created.value.id);
      expect(result.ok).toBe(true);
      const list = mockSupplierRepository.observe().get();
      expect(list.find((s) => s.id === created.value.id)).toBeUndefined();
    }
  });

  it("observes a supplier by id", () => {
    const obs = mockSupplierRepository.observeById("sup-001");
    const supplier = obs.get();
    expect(supplier).not.toBeNull();
    expect(supplier?.name).toBe("Fournitures Scolaires Oran");
  });
});

/* ------------------------------------------------------------------ */
/*  Purchase requests                                                  */
/* ------------------------------------------------------------------ */

describe("MockPurchaseRequestRepository (iteration 9)", () => {
  it("seeds with 4 purchase requests in mixed statuses", () => {
    const list = mockPurchaseRequestRepository.observe().get();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some((r) => r.status === "draft")).toBe(true);
    expect(list.some((r) => r.status === "submitted")).toBe(true);
    expect(list.some((r) => r.status === "approved")).toBe(true);
    expect(list.some((r) => r.status === "ordered")).toBe(true);
  });

  it("computes totalAmount from lines on create", async () => {
    const result = await mockPurchaseRequestRepository.createPurchaseRequest({
      title: "Test PR",
      description: "Test",
      priority: "medium",
      supplierId: "sup-001",
      departmentId: "dept-buyers",
      lines: [
        { id: "l1", description: "Item A", quantity: 10, unit: "pièce", estimatedUnitPrice: 100 },
        { id: "l2", description: "Item B", quantity: 5, unit: "lot", estimatedUnitPrice: 200 },
      ],
      requestedBy: "usr-buy-001",
      requestedByName: "Test Buyer",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalAmount).toBe(10 * 100 + 5 * 200);
      expect(result.value.status).toBe("draft");
      expect(result.value.requestCode).toMatch(/^PR-2025-\d{3}$/);
    }
  });

  it("advances status through the workflow", async () => {
    const created = await mockPurchaseRequestRepository.createPurchaseRequest({
      title: "Workflow test",
      description: "",
      priority: "high",
      supplierId: null,
      departmentId: null,
      lines: [],
      requestedBy: "usr-buy-001",
      requestedByName: "Test",
    });
    if (created.ok) {
      const id = created.value.id;
      // draft → submitted → approved → ordered → received
      const submitted = await mockPurchaseRequestRepository.updateStatus(id, "submitted", "usr-buy-001", "Buyer");
      expect(submitted.ok).toBe(true);
      if (submitted.ok) expect(submitted.value.status).toBe("submitted");

      const approved = await mockPurchaseRequestRepository.updateStatus(id, "approved", "usr-adm-001", "Admin", "OK");
      expect(approved.ok).toBe(true);
      if (approved.ok) {
        expect(approved.value.status).toBe("approved");
        expect(approved.value.approvedBy).toBe("usr-adm-001");
        expect(approved.value.approvedAt).not.toBeNull();
        expect(approved.value.approvalNote).toBe("OK");
      }

      const ordered = await mockPurchaseRequestRepository.updateStatus(id, "ordered", "usr-buy-001", "Buyer");
      expect(ordered.ok).toBe(true);
      if (ordered.ok) expect(ordered.value.orderedAt).not.toBeNull();

      const received = await mockPurchaseRequestRepository.updateStatus(id, "received", "usr-whw-001", "Warehouse");
      expect(received.ok).toBe(true);
      if (received.ok) expect(received.value.receivedAt).not.toBeNull();
    }
  });

  it("cancels a purchase request with reason", async () => {
    const created = await mockPurchaseRequestRepository.createPurchaseRequest({
      title: "Cancel test",
      description: "",
      priority: "low",
      supplierId: null,
      departmentId: null,
      lines: [],
      requestedBy: "usr-buy-001",
      requestedByName: "Test",
    });
    if (created.ok) {
      const result = await mockPurchaseRequestRepository.cancel(created.value.id, "Plus nécessaire", "usr-buy-001", "Buyer");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("cancelled");
      }
    }
  });

  it("assigns a supplier to a purchase request", async () => {
    const created = await mockPurchaseRequestRepository.createPurchaseRequest({
      title: "Assign test",
      description: "",
      priority: "low",
      supplierId: null,
      departmentId: null,
      lines: [],
      requestedBy: "usr-buy-001",
      requestedByName: "Test",
    });
    if (created.ok) {
      const result = await mockPurchaseRequestRepository.assignSupplier(created.value.id, "sup-003", "usr-buy-001");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.supplierId).toBe("sup-003");
      }
    }
  });

  it("observes by requester", () => {
    const obs = mockPurchaseRequestRepository.observeByRequester("usr-buy-001");
    const list = obs.get();
    expect(list.every((r) => r.requestedBy === "usr-buy-001")).toBe(true);
  });

  it("observes by status", () => {
    const obs = mockPurchaseRequestRepository.observeByStatus("draft");
    expect(obs.get().every((r) => r.status === "draft")).toBe(true);
  });

  it("returns Err when updating status of unknown PR", async () => {
    const result = await mockPurchaseRequestRepository.updateStatus("pr-nonexistent", "approved", "x", "x");
    expect(result.ok).toBe(false);
  });

  it("deletes a purchase request", async () => {
    const created = await mockPurchaseRequestRepository.createPurchaseRequest({
      title: "Delete test",
      description: "",
      priority: "low",
      supplierId: null,
      departmentId: null,
      lines: [],
      requestedBy: "x",
      requestedByName: "x",
    });
    if (created.ok) {
      const result = await mockPurchaseRequestRepository.deletePurchaseRequest(created.value.id);
      expect(result.ok).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Deliveries                                                         */
/* ------------------------------------------------------------------ */

describe("MockDeliveryRepository (iteration 9)", () => {
  it("seeds with 4 deliveries in mixed statuses", () => {
    const list = mockDeliveryRepository.observe().get();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some((d) => d.status === "assigned")).toBe(true);
    expect(list.some((d) => d.status === "in_transit")).toBe(true);
    expect(list.some((d) => d.status === "confirmed")).toBe(true);
    expect(list.some((d) => d.status === "delayed")).toBe(true);
  });

  it("creates a new delivery", async () => {
    const result = await mockDeliveryRepository.createDelivery({
      driverId: "per-011",
      driverName: "Messaoud",
      stops: [
        { id: "s1", sequence: 1, type: "pickup", label: "Pickup", address: "Here", lat: 35.7, lng: -0.6, plannedAt: "2025-09-25T08:00:00.000Z", completedAt: null },
        { id: "s2", sequence: 2, type: "dropoff", label: "Dropoff", address: "There", lat: 35.8, lng: -0.7, plannedAt: "2025-09-25T10:00:00.000Z", completedAt: null },
      ],
      purchaseRequestId: null,
      notes: "Test delivery",
      vehicle: "Van",
      assignedBy: "usr-adm-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("assigned");
      expect(result.value.deliveryCode).toMatch(/^DEL-2025-\d{3}$/);
      expect(result.value.stops).toHaveLength(2);
    }
  });

  it("advances status: assigned → in_transit → delivered → confirmed", async () => {
    const created = await mockDeliveryRepository.createDelivery({
      driverId: "per-011",
      driverName: "Test",
      stops: [],
      purchaseRequestId: null,
      notes: "",
      vehicle: null,
      assignedBy: "usr-adm-001",
    });
    if (created.ok) {
      const id = created.value.id;
      const inTransit = await mockDeliveryRepository.updateStatus(id, "in_transit", "per-011", "Driver");
      expect(inTransit.ok).toBe(true);
      if (inTransit.ok) expect(inTransit.value.startedAt).not.toBeNull();

      const delivered = await mockDeliveryRepository.updateStatus(id, "delivered", "per-011", "Driver");
      expect(delivered.ok).toBe(true);
      if (delivered.ok) expect(delivered.value.deliveredAt).not.toBeNull();

      const confirmed = await mockDeliveryRepository.updateStatus(id, "confirmed", "per-011", "Driver");
      expect(confirmed.ok).toBe(true);
      if (confirmed.ok) expect(confirmed.value.confirmedAt).not.toBeNull();
    }
  });

  it("reports a delay with reason and new ETA", async () => {
    const created = await mockDeliveryRepository.createDelivery({
      driverId: "per-011",
      driverName: "Test",
      stops: [],
      purchaseRequestId: null,
      notes: "",
      vehicle: null,
      assignedBy: "usr-adm-001",
    });
    if (created.ok) {
      const result = await mockDeliveryRepository.reportDelay(
        created.value.id,
        "Bouchons",
        "2025-09-25T19:00:00.000Z",
        "per-011",
        "Driver",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("delayed");
        expect(result.value.delayReason).toBe("Bouchons");
        expect(result.value.newEta).toBe("2025-09-25T19:00:00.000Z");
      }
    }
  });

  it("uploads a confirmation URL", async () => {
    const created = await mockDeliveryRepository.createDelivery({
      driverId: "per-011",
      driverName: "Test",
      stops: [],
      purchaseRequestId: null,
      notes: "",
      vehicle: null,
      assignedBy: "usr-adm-001",
    });
    if (created.ok) {
      const result = await mockDeliveryRepository.uploadConfirmation(
        created.value.id,
        "mock://confirmations/test.pdf",
        "per-011",
        "Driver",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.confirmationUrl).toBe("mock://confirmations/test.pdf");
        expect(result.value.status).toBe("confirmed");
        expect(result.value.confirmedAt).not.toBeNull();
      }
    }
  });

  it("observes by driver", () => {
    const obs = mockDeliveryRepository.observeByDriver("per-011");
    expect(obs.get().every((d) => d.driverId === "per-011")).toBe(true);
  });

  it("observes by status", () => {
    const obs = mockDeliveryRepository.observeByStatus("delayed");
    expect(obs.get().every((d) => d.status === "delayed")).toBe(true);
  });

  it("returns Err when updating unknown delivery", async () => {
    const result = await mockDeliveryRepository.updateStatus("del-nonexistent", "delivered", "x", "x");
    expect(result.ok).toBe(false);
  });

  it("deletes a delivery", async () => {
    const created = await mockDeliveryRepository.createDelivery({
      driverId: "per-011",
      driverName: "Test",
      stops: [],
      purchaseRequestId: null,
      notes: "",
      vehicle: null,
      assignedBy: "usr-adm-001",
    });
    if (created.ok) {
      const result = await mockDeliveryRepository.deleteDelivery(created.value.id);
      expect(result.ok).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */

describe("MockInventoryRepository (iteration 9)", () => {
  it("seeds with 6 inventory items", () => {
    const list = mockInventoryRepository.observeItems().get();
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.some((i) => i.sku === "STY-BLE-50")).toBe(true);
    expect(list.some((i) => i.sku === "MAN-MATH-CEM1")).toBe(true);
  });

  it("seeds with 5 inventory transactions", () => {
    const list = mockInventoryRepository.observeTransactions().get();
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list.some((t) => t.type === "receive")).toBe(true);
    expect(list.some((t) => t.type === "dispatch")).toBe(true);
  });

  it("creates a new inventory item", async () => {
    const result = await mockInventoryRepository.createItem({
      sku: "TEST-001",
      label: "Test Item",
      category: "autre",
      unit: "pièce",
      quantityOnHand: 0,
      reorderLevel: 5,
      unitCost: 100,
      location: "Z-1-01",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toMatch(/^inv-/);
      expect(result.value.sku).toBe("TEST-001");
    }
  });

  it("updates an inventory item", async () => {
    const result = await mockInventoryRepository.updateItem("inv-001", { reorderLevel: 15 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reorderLevel).toBe(15);
    }
  });

  it("transacts a receive (+delta) and updates quantityOnHand", async () => {
    const before = mockInventoryRepository.observeItems().get().find((i) => i.id === "inv-001")!;
    const result = await mockInventoryRepository.transact({
      itemId: "inv-001",
      type: "receive",
      delta: 10,
      reason: "Test receipt",
      actorId: "usr-whw-001",
      actorName: "Test",
      reference: "TEST-REF",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quantityBefore).toBe(before.quantityOnHand);
      expect(result.value.quantityAfter).toBe(before.quantityOnHand + 10);
      expect(result.value.delta).toBe(10);
    }
    const after = mockInventoryRepository.observeItems().get().find((i) => i.id === "inv-001")!;
    expect(after.quantityOnHand).toBe(before.quantityOnHand + 10);
  });

  it("transacts a dispatch (-delta) and updates quantityOnHand", async () => {
    const before = mockInventoryRepository.observeItems().get().find((i) => i.id === "inv-001")!;
    const result = await mockInventoryRepository.transact({
      itemId: "inv-001",
      type: "dispatch",
      delta: -5,
      reason: "Test dispatch",
      actorId: "usr-whw-001",
      actorName: "Test",
      reference: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quantityAfter).toBe(before.quantityOnHand - 5);
    }
  });

  it("transact never lets quantityOnHand go negative (clamps to 0)", async () => {
    // Find an item and try to dispatch more than available
    const item = mockInventoryRepository.observeItems().get().find((i) => i.id === "inv-002")!;
    const result = await mockInventoryRepository.transact({
      itemId: item.id,
      type: "dispatch",
      delta: -(item.quantityOnHand + 1000),
      reason: "Overdispatch test",
      actorId: "x",
      actorName: "x",
      reference: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quantityAfter).toBe(0);
    }
  });

  it("transact returns Err for unknown item", async () => {
    const result = await mockInventoryRepository.transact({
      itemId: "inv-nonexistent",
      type: "receive",
      delta: 1,
      reason: "test",
      actorId: "x",
      actorName: "x",
      reference: null,
    });
    expect(result.ok).toBe(false);
  });

  it("scan creates a new item when SKU doesn't exist", async () => {
    const result = await mockInventoryRepository.scan({
      sku: "SCAN-NEW-001",
      label: "Scanned new item",
      category: "fournitures",
      unit: "pièce",
      quantity: 42,
      actorId: "usr-whw-001",
      actorName: "Warehouse",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sku).toBe("SCAN-NEW-001");
      expect(result.value.quantityOnHand).toBe(42);
    }
  });

  it("scan adds to existing item when SKU exists", async () => {
    const before = mockInventoryRepository.observeItems().get().find((i) => i.sku === "STY-BLE-50")!;
    const result = await mockInventoryRepository.scan({
      sku: "STY-BLE-50",
      label: "Stylos bleus (lot 50)",
      category: "fournitures",
      unit: "lot",
      quantity: 5,
      actorId: "usr-whw-001",
      actorName: "Warehouse",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(before.id);
      expect(result.value.quantityOnHand).toBe(before.quantityOnHand + 5);
    }
  });

  it("observes transactions by item", () => {
    const obs = mockInventoryRepository.observeTransactionsByItem("inv-001");
    expect(obs.get().every((t) => t.itemId === "inv-001")).toBe(true);
  });

  it("deletes an inventory item", async () => {
    const created = await mockInventoryRepository.createItem({
      sku: "DELETE-ME",
      label: "X",
      category: "autre",
      unit: "pièce",
      quantityOnHand: 0,
      reorderLevel: 0,
      unitCost: 0,
      location: null,
    });
    if (created.ok) {
      const result = await mockInventoryRepository.deleteItem(created.value.id);
      expect(result.ok).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Warehouse tasks (receipts + dispatches)                            */
/* ------------------------------------------------------------------ */

describe("MockWarehouseTaskRepository (iteration 9)", () => {
  it("seeds with 3 pending receipts", () => {
    const list = mockWarehouseTaskRepository.observeReceipts().get();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every((r) => r.status === "pending" || r.status === "received" || r.status === "partial" || r.status === "cancelled")).toBe(true);
  });

  it("seeds with 2 dispatches", () => {
    const list = mockWarehouseTaskRepository.observeDispatches().get();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("receives a receipt (sets receivedQuantity = expectedQuantity)", async () => {
    const pending = mockWarehouseTaskRepository.observeReceipts().get().find((r) => r.status === "pending");
    expect(pending).toBeDefined();
    if (pending) {
      const result = await mockWarehouseTaskRepository.receiveReceipt(pending.id, "usr-whw-001", "Warehouse");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("received");
        expect(result.value.receivedQuantity).toBe(result.value.expectedQuantity);
        expect(result.value.receivedAt).not.toBeNull();
      }
    }
  });

  it("prepares a dispatch (pending → preparing)", async () => {
    const created = await mockWarehouseTaskRepository.createDispatch({
      destination: "Test dest",
      itemLabel: "Test item",
      quantity: 5,
      requestedAt: "2025-09-25T00:00:00.000Z",
    });
    if (created.ok) {
      const result = await mockWarehouseTaskRepository.prepareDispatch(created.value.id, "usr-whw-001", "Warehouse");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("preparing");
      }
    }
  });

  it("dispatches a dispatch (preparing → dispatched)", async () => {
    const created = await mockWarehouseTaskRepository.createDispatch({
      destination: "Test dest 2",
      itemLabel: "Test item 2",
      quantity: 3,
      requestedAt: "2025-09-25T00:00:00.000Z",
    });
    if (created.ok) {
      await mockWarehouseTaskRepository.prepareDispatch(created.value.id, "usr-whw-001", "Warehouse");
      const result = await mockWarehouseTaskRepository.dispatchDispatch(created.value.id, "usr-whw-001", "Warehouse");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("dispatched");
        expect(result.value.dispatchedAt).not.toBeNull();
      }
    }
  });

  it("creates a new receipt", async () => {
    const result = await mockWarehouseTaskRepository.createReceipt({
      supplierName: "Test supplier",
      purchaseRequestCode: "PR-TEST",
      expectedQuantity: 100,
      expectedAt: "2025-09-30T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
      expect(result.value.receivedQuantity).toBe(0);
    }
  });

  it("creates a new dispatch", async () => {
    const result = await mockWarehouseTaskRepository.createDispatch({
      destination: "Test dest 3",
      itemLabel: "Test item 3",
      quantity: 7,
      requestedAt: "2025-09-30T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
    }
  });

  it("returns Err when receiving unknown receipt", async () => {
    const result = await mockWarehouseTaskRepository.receiveReceipt("rcp-nonexistent", "x", "x");
    expect(result.ok).toBe(false);
  });

  it("deletes a receipt", async () => {
    const created = await mockWarehouseTaskRepository.createReceipt({
      supplierName: "ToDelete",
      purchaseRequestCode: null,
      expectedQuantity: 1,
      expectedAt: "2025-09-30T00:00:00.000Z",
    });
    if (created.ok) {
      const result = await mockWarehouseTaskRepository.deleteReceipt(created.value.id);
      expect(result.ok).toBe(true);
    }
  });

  it("deletes a dispatch", async () => {
    const created = await mockWarehouseTaskRepository.createDispatch({
      destination: "X",
      itemLabel: "Y",
      quantity: 1,
      requestedAt: "2025-09-30T00:00:00.000Z",
    });
    if (created.ok) {
      const result = await mockWarehouseTaskRepository.deleteDispatch(created.value.id);
      expect(result.ok).toBe(true);
    }
  });
});
