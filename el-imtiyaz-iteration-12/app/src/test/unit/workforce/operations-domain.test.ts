/**
 * Operations domain model tests — iteration 9.
 *
 * Verifies the operations entities, label maps, and the auth→personnel
 * bridge via the new `userId` field on Personnel + `observeByUserId`.
 */
import { describe, it, expect } from "vitest";
import {
  PURCHASE_REQUEST_STATUS_LABELS_FR,
  PURCHASE_REQUEST_PRIORITY_LABELS_FR,
  DELIVERY_STATUS_LABELS_FR,
  INVENTORY_CATEGORY_LABELS_FR,
  INVENTORY_TRANSACTION_LABELS_FR,
  RECEIPT_STATUS_LABELS_FR,
  DISPATCH_STATUS_LABELS_FR,
  type Supplier,
  type PurchaseRequest,
  type PurchaseRequestStatus,
  type PurchaseRequestPriority,
  type PurchaseRequestLine,
  type Delivery,
  type DeliveryStatus,
  type DeliveryStop,
  type InventoryItem,
  type InventoryTransaction,
  type InventoryTransactionType,
  type InventoryCategory,
  type PendingReceipt,
  type PendingDispatch,
  type ReceiptStatus,
  type DispatchStatus,
} from "../../../domain/model/operations-workforce";

describe("Operations domain — labels & constants", () => {
  it("PURCHASE_REQUEST_STATUS_LABELS_FR covers all 7 statuses", () => {
    const statuses: PurchaseRequestStatus[] = ["draft", "submitted", "approved", "rejected", "ordered", "received", "cancelled"];
    for (const s of statuses) {
      expect(PURCHASE_REQUEST_STATUS_LABELS_FR[s]).toBeDefined();
      expect(typeof PURCHASE_REQUEST_STATUS_LABELS_FR[s]).toBe("string");
    }
  });

  it("PURCHASE_REQUEST_PRIORITY_LABELS_FR covers all 4 priorities", () => {
    const priorities: PurchaseRequestPriority[] = ["low", "medium", "high", "urgent"];
    for (const p of priorities) {
      expect(PURCHASE_REQUEST_PRIORITY_LABELS_FR[p]).toBeDefined();
    }
  });

  it("DELIVERY_STATUS_LABELS_FR covers all 6 statuses", () => {
    const statuses: DeliveryStatus[] = ["assigned", "in_transit", "delivered", "confirmed", "delayed", "failed"];
    for (const s of statuses) {
      expect(DELIVERY_STATUS_LABELS_FR[s]).toBeDefined();
    }
  });

  it("INVENTORY_CATEGORY_LABELS_FR covers all 6 categories", () => {
    const cats: InventoryCategory[] = ["fournitures", "mobilier", "manuels", "informatique", "entretien", "autre"];
    for (const c of cats) {
      expect(INVENTORY_CATEGORY_LABELS_FR[c]).toBeDefined();
    }
  });

  it("INVENTORY_TRANSACTION_LABELS_FR covers all 6 transaction types", () => {
    const types: InventoryTransactionType[] = ["receive", "dispatch", "scan", "damage", "adjust", "return"];
    for (const t of types) {
      expect(INVENTORY_TRANSACTION_LABELS_FR[t]).toBeDefined();
    }
  });

  it("RECEIPT_STATUS_LABELS_FR covers all 4 statuses", () => {
    const statuses: ReceiptStatus[] = ["pending", "partial", "received", "cancelled"];
    for (const s of statuses) {
      expect(RECEIPT_STATUS_LABELS_FR[s]).toBeDefined();
    }
  });

  it("DISPATCH_STATUS_LABELS_FR covers all 4 statuses", () => {
    const statuses: DispatchStatus[] = ["pending", "preparing", "dispatched", "cancelled"];
    for (const s of statuses) {
      expect(DISPATCH_STATUS_LABELS_FR[s]).toBeDefined();
    }
  });
});

describe("Operations domain — entity shapes (compile-time check)", () => {
  it("Supplier has required fields", () => {
    const s: Supplier = {
      id: "sup-1",
      tenantId: "tnt-1",
      name: "Test",
      category: "Test",
      contactName: "Contact",
      phone: "Phone",
      email: null,
      address: null,
      paymentTerms: "30j",
      rating: 4.0,
      createdAt: "2025-01-01T00:00:00.000Z",
      archivedAt: null,
    };
    expect(s.id).toBe("sup-1");
  });

  it("PurchaseRequest has required fields including lines + totalAmount", () => {
    const pr: PurchaseRequest = {
      id: "pr-1",
      tenantId: "tnt-1",
      requestCode: "PR-2025-001",
      title: "Test",
      description: "",
      priority: "medium",
      status: "draft",
      supplierId: null,
      departmentId: null,
      lines: [],
      totalAmount: 0,
      requestedBy: "u1",
      requestedByName: "User",
      requestedAt: "2025-01-01T00:00:00.000Z",
      approvedBy: null,
      approvedAt: null,
      approvalNote: null,
      orderedAt: null,
      receivedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    };
    expect(pr.requestCode).toBe("PR-2025-001");
  });

  it("PurchaseRequestLine has required fields", () => {
    const line: PurchaseRequestLine = {
      id: "l1",
      description: "Item",
      quantity: 10,
      unit: "pièce",
      estimatedUnitPrice: 100,
    };
    expect(line.quantity).toBe(10);
  });

  it("Delivery has required fields including stops + delay fields", () => {
    const d: Delivery = {
      id: "del-1",
      tenantId: "tnt-1",
      deliveryCode: "DEL-2025-001",
      driverId: "per-1",
      driverName: "Driver",
      status: "assigned",
      stops: [],
      purchaseRequestId: null,
      notes: "",
      assignedAt: "2025-01-01T00:00:00.000Z",
      startedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      delayReason: null,
      newEta: null,
      confirmationUrl: null,
      vehicle: null,
    };
    expect(d.deliveryCode).toBe("DEL-2025-001");
  });

  it("DeliveryStop has required fields", () => {
    const stop: DeliveryStop = {
      id: "s1",
      sequence: 1,
      type: "pickup",
      label: "Pickup",
      address: "Addr",
      lat: 35.7,
      lng: -0.6,
      plannedAt: null,
      completedAt: null,
    };
    expect(stop.type).toBe("pickup");
  });

  it("InventoryItem has required fields including reorderLevel", () => {
    const item: InventoryItem = {
      id: "inv-1",
      tenantId: "tnt-1",
      sku: "SKU-001",
      label: "Test",
      category: "fournitures",
      unit: "pièce",
      quantityOnHand: 10,
      reorderLevel: 5,
      unitCost: 100,
      location: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    expect(item.sku).toBe("SKU-001");
  });

  it("InventoryTransaction has required fields including quantityBefore/After", () => {
    const tx: InventoryTransaction = {
      id: "itx-1",
      tenantId: "tnt-1",
      itemId: "inv-1",
      itemSku: "SKU-001",
      itemLabel: "Test",
      type: "receive",
      delta: 10,
      quantityBefore: 0,
      quantityAfter: 10,
      reason: null,
      actorId: "u1",
      actorName: "User",
      timestamp: "2025-01-01T00:00:00.000Z",
      reference: null,
    };
    expect(tx.delta).toBe(10);
  });

  it("PendingReceipt has required fields", () => {
    const r: PendingReceipt = {
      id: "rcp-1",
      tenantId: "tnt-1",
      supplierName: "Supplier",
      purchaseRequestCode: "PR-001",
      expectedQuantity: 100,
      receivedQuantity: 0,
      status: "pending",
      expectedAt: "2025-09-30T00:00:00.000Z",
      receivedAt: null,
    };
    expect(r.status).toBe("pending");
  });

  it("PendingDispatch has required fields", () => {
    const d: PendingDispatch = {
      id: "dsp-1",
      tenantId: "tnt-1",
      destination: "Dest",
      itemLabel: "Item",
      quantity: 5,
      status: "pending",
      requestedAt: "2025-09-30T00:00:00.000Z",
      dispatchedAt: null,
    };
    expect(d.status).toBe("pending");
  });
});

describe("Personnel model — userId field (iteration 9)", () => {
  it("Personnel entity includes userId field", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const list = mockPersonnelRepository.observe().get();
    // Every personnel record should have a userId field (may be null)
    for (const p of list) {
      expect(p).toHaveProperty("userId");
      expect(p.userId === null || typeof p.userId === "string").toBe(true);
    }
  });

  it("seeded admin maps to usr-adm-001 via userId", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const admin = mockPersonnelRepository.observeByUserId("usr-adm-001").get();
    expect(admin).not.toBeNull();
    expect(admin?.firstName).toBe("Brahim");
    expect(admin?.lastName).toBe("Souilah");
    expect(admin?.roleId).toBe("super_admin");
  });

  it("seeded buyer maps to usr-buy-001 via userId", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const buyer = mockPersonnelRepository.observeByUserId("usr-buy-001").get();
    expect(buyer).not.toBeNull();
    expect(buyer?.firstName).toBe("Yacine");
    expect(buyer?.roleId).toBe("buyer");
  });

  it("seeded manager maps to usr-mgr-001 via userId", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const mgr = mockPersonnelRepository.observeByUserId("usr-mgr-001").get();
    expect(mgr).not.toBeNull();
    expect(mgr?.firstName).toBe("Leïla");
    expect(mgr?.roleId).toBe("manager");
  });

  it("seeded driver maps to usr-drv-001 via userId", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const drv = mockPersonnelRepository.observeByUserId("usr-drv-001").get();
    expect(drv).not.toBeNull();
    expect(drv?.firstName).toBe("Messaoud");
  });

  it("seeded warehouse worker maps to usr-whw-001 via userId", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const whw = mockPersonnelRepository.observeByUserId("usr-whw-001").get();
    expect(whw).not.toBeNull();
    expect(whw?.firstName).toBe("Rachid");
  });

  it("seeded worker maps to usr-wrk-001 via userId", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const wrk = mockPersonnelRepository.observeByUserId("usr-wrk-001").get();
    expect(wrk).not.toBeNull();
    expect(wrk?.firstName).toBe("Said");
  });

  it("seeded teacher maps to usr-tea-001 via userId", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const tea = mockPersonnelRepository.observeByUserId("usr-tea-001").get();
    expect(tea).not.toBeNull();
    expect(tea?.firstName).toBe("Aïcha");
  });

  it("observeByUserId returns null for unknown userId", async () => {
    const { mockPersonnelRepository } = await import("../../../infrastructure/mock/mock-repositories");
    const result = mockPersonnelRepository.observeByUserId("usr-nonexistent").get();
    expect(result).toBeNull();
  });
});
