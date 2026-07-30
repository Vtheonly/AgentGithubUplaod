/**
 * Operations workforce repository interfaces — iteration 9.
 *
 * Pure abstract contracts for the operations entities (suppliers, purchase
 * requests, deliveries, inventory). Methods return Promises of Result<T>
 * for explicit failure handling; live reads expose Observable<T>.
 */
import type { Result } from "../../core/result/result";
import type { Observable } from "./repository";
import type {
  Supplier,
  PurchaseRequest,
  PurchaseRequestStatus,
  PurchaseRequestPriority,
  PurchaseRequestLine,
  Delivery,
  DeliveryStatus,
  DeliveryStop,
  InventoryItem,
  InventoryTransaction,
  InventoryTransactionType,
  InventoryCategory,
  PendingReceipt,
  PendingDispatch,
  ReceiptStatus,
  DispatchStatus,
} from "../model/operations-workforce";

/* ------------------------------------------------------------------ */
/*  Suppliers                                                          */
/* ------------------------------------------------------------------ */

export interface SupplierRepository {
  observe(): Observable<Supplier[]>;
  observeById(id: string): Observable<Supplier | null>;
  createSupplier(input: Omit<Supplier, "id" | "tenantId" | "createdAt" | "archivedAt">): Promise<Result<Supplier>>;
  updateSupplier(id: string, updates: Partial<Supplier>): Promise<Result<Supplier>>;
  archiveSupplier(id: string): Promise<Result<Supplier>>;
  deleteSupplier(id: string): Promise<Result<void>>;
}

/* ------------------------------------------------------------------ */
/*  Purchase requests                                                  */
/* ------------------------------------------------------------------ */

export interface PurchaseRequestRepository {
  observe(): Observable<PurchaseRequest[]>;
  observeByRequester(userId: string): Observable<PurchaseRequest[]>;
  observeByStatus(status: PurchaseRequestStatus): Observable<PurchaseRequest[]>;
  observeById(id: string): Observable<PurchaseRequest | null>;
  createPurchaseRequest(input: {
    title: string;
    description: string;
    priority: PurchaseRequestPriority;
    supplierId: string | null;
    departmentId: string | null;
    lines: readonly PurchaseRequestLine[];
    requestedBy: string;
    requestedByName: string;
  }): Promise<Result<PurchaseRequest>>;
  updateStatus(id: string, status: PurchaseRequestStatus, actorId: string, actorName: string, note?: string): Promise<Result<PurchaseRequest>>;
  assignSupplier(id: string, supplierId: string, actorId: string): Promise<Result<PurchaseRequest>>;
  cancel(id: string, reason: string, actorId: string, actorName: string): Promise<Result<PurchaseRequest>>;
  deletePurchaseRequest(id: string): Promise<Result<void>>;
}

/* ------------------------------------------------------------------ */
/*  Deliveries                                                         */
/* ------------------------------------------------------------------ */

export interface DeliveryRepository {
  observe(): Observable<Delivery[]>;
  observeByDriver(driverId: string): Observable<Delivery[]>;
  observeByStatus(status: DeliveryStatus): Observable<Delivery[]>;
  observeById(id: string): Observable<Delivery | null>;
  createDelivery(input: {
    driverId: string;
    driverName: string;
    stops: readonly DeliveryStop[];
    purchaseRequestId: string | null;
    notes: string;
    vehicle: string | null;
    assignedBy: string;
  }): Promise<Result<Delivery>>;
  updateStatus(id: string, status: DeliveryStatus, actorId: string, actorName: string): Promise<Result<Delivery>>;
  reportDelay(id: string, reason: string, newEta: string, actorId: string, actorName: string): Promise<Result<Delivery>>;
  uploadConfirmation(id: string, confirmationUrl: string, actorId: string, actorName: string): Promise<Result<Delivery>>;
  deleteDelivery(id: string): Promise<Result<void>>;
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */

export interface InventoryRepository {
  observeItems(): Observable<InventoryItem[]>;
  observeItemById(id: string): Observable<InventoryItem | null>;
  observeTransactions(limit?: number): Observable<InventoryTransaction[]>;
  observeTransactionsByItem(itemId: string): Observable<InventoryTransaction[]>;
  createItem(input: Omit<InventoryItem, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<Result<InventoryItem>>;
  updateItem(id: string, updates: Partial<InventoryItem>): Promise<Result<InventoryItem>>;
  deleteItem(id: string): Promise<Result<void>>;
  transact(input: {
    itemId: string;
    type: InventoryTransactionType;
    delta: number;
    reason: string | null;
    actorId: string;
    actorName: string;
    reference: string | null;
  }): Promise<Result<InventoryTransaction>>;
  scan(input: {
    sku: string;
    label: string;
    category: InventoryCategory;
    unit: string;
    quantity: number;
    actorId: string;
    actorName: string;
  }): Promise<Result<InventoryItem>>;
}

/* ------------------------------------------------------------------ */
/*  Pending receipts & dispatches (warehouse dashboard)                */
/* ------------------------------------------------------------------ */

export interface WarehouseTaskRepository {
  observeReceipts(): Observable<PendingReceipt[]>;
  observeDispatches(): Observable<PendingDispatch[]>;
  receiveReceipt(id: string, actorId: string, actorName: string): Promise<Result<PendingReceipt>>;
  prepareDispatch(id: string, actorId: string, actorName: string): Promise<Result<PendingDispatch>>;
  dispatchDispatch(id: string, actorId: string, actorName: string): Promise<Result<PendingDispatch>>;
  createReceipt(input: Omit<PendingReceipt, "id" | "tenantId" | "receivedQuantity" | "status" | "receivedAt">): Promise<Result<PendingReceipt>>;
  createDispatch(input: Omit<PendingDispatch, "id" | "tenantId" | "status" | "dispatchedAt">): Promise<Result<PendingDispatch>>;
  deleteReceipt(id: string): Promise<Result<void>>;
  deleteDispatch(id: string): Promise<Result<void>>;
}
