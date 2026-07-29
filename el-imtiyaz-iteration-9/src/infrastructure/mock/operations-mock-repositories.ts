/**
 * Mock operations repository implementations — iteration 9.
 *
 * In-memory, reactive (via SubjectBehavior), seeded with realistic data so
 * the Buyer / Driver / Warehouse dashboards run end-to-end without a
 * backend. Every mutating method writes an audit log entry via the
 * workforce audit sink (wired in mock-repositories.ts).
 */
import type {
  SupplierRepository,
  PurchaseRequestRepository,
  DeliveryRepository,
  InventoryRepository,
  WarehouseTaskRepository,
} from "../../domain/repository/operations-repository";
import type { Observable } from "../../domain/repository/repository";
import type { Result } from "../../core/result/result";
import { Ok, Err } from "../../core/result/result";
import { Errors } from "../../core/errors/app-error";
import { logger } from "../../core/logging/logger";
import { SubjectBehavior } from "./subject-behavior";
import { TENANT_ID } from "./seed-data";
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
} from "../../domain/model/operations-workforce";

const nowIso = () => new Date().toISOString();

function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/*  Audit hook (reuses the workforce audit sink)                       */
/* ------------------------------------------------------------------ */

let _auditSink: ((input: {
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  actorName?: string;
  diff?: { before?: unknown; after?: unknown } | null;
  note?: string | null;
}) => void) | null = null;

export function setOperationsAuditSink(
  fn: typeof _auditSink,
): void {
  _auditSink = fn;
}

function audit(input: Parameters<NonNullable<typeof _auditSink>>[0]): void {
  if (_auditSink) _auditSink(input);
  logger.info("operations.audit", { ...input, tenantId: TENANT_ID });
}

/* ------------------------------------------------------------------ */
/*  Suppliers                                                          */
/* ------------------------------------------------------------------ */

const SEED_SUPPLIERS: Supplier[] = [
  { id: "sup-001", tenantId: TENANT_ID, name: "Fournitures Scolaires Oran", category: "Fournitures", contactName: "M. Benali", phone: "+213 41 12 34 56", email: "contact@fso.dz", address: "Rue Larbi Ben M'hidi, Oran", paymentTerms: "30 jours", rating: 4.5, createdAt: "2024-09-01T00:00:00.000Z", archivedAt: null },
  { id: "sup-002", tenantId: TENANT_ID, name: "Naftal Carburant", category: "Carburant", contactName: "M. Khaldi", phone: "+213 21 99 88 77", email: "pro@naftal.dz", address: "Téléémie, Oran", paymentTerms: "Comptant", rating: 4.0, createdAt: "2024-01-15T00:00:00.000Z", archivedAt: null },
  { id: "sup-003", tenantId: TENANT_ID, name: "Éditions Alpha", category: "Manuels", contactName: "Mme. Cherif", phone: "+213 21 55 44 33", email: "commandes@editions-alpha.dz", address: "Bab El Oued, Alger", paymentTerms: "45 jours", rating: 4.8, createdAt: "2023-09-01T00:00:00.000Z", archivedAt: null },
  { id: "sup-004", tenantId: TENANT_ID, name: "Mobilier Scolaire Plus", category: "Mobilier", contactName: "M. Saidi", phone: "+213 41 77 66 55", email: null, address: "Zone industrielle Es Senia", paymentTerms: "60 jours", rating: 3.8, createdAt: "2024-03-10T00:00:00.000Z", archivedAt: null },
];

class MockSupplierRepository implements SupplierRepository {
  private readonly subjects = new SubjectBehavior<Supplier[]>(SEED_SUPPLIERS);
  private items: Supplier[] = SEED_SUPPLIERS;

  observe(): Observable<Supplier[]> { return this.subjects; }
  observeById(id: string): Observable<Supplier | null> {
    return new SubjectBehavior<Supplier | null>(this.items.find((s) => s.id === id) ?? null);
  }

  async createSupplier(input: Omit<Supplier, "id" | "tenantId" | "createdAt" | "archivedAt">): Promise<Result<Supplier>> {
    const s: Supplier = { ...input, id: genId("sup"), tenantId: TENANT_ID, createdAt: nowIso(), archivedAt: null };
    this.items = [...this.items, s];
    this.subjects.set(this.items);
    audit({ action: "supplier.create", entityType: "supplier", entityId: s.id, diff: { after: s } });
    return Ok(s);
  }

  async updateSupplier(id: string, updates: Partial<Supplier>): Promise<Result<Supplier>> {
    const idx = this.items.findIndex((s) => s.id === id);
    if (idx === -1) return Err(Errors.notFound("supplier", id));
    const before = this.items[idx];
    const after = { ...before, ...updates, id: before.id, tenantId: before.tenantId };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.subjects.set(this.items);
    audit({ action: "supplier.update", entityType: "supplier", entityId: id, diff: { before, after } });
    return Ok(after);
  }

  async archiveSupplier(id: string): Promise<Result<Supplier>> {
    return this.updateSupplier(id, { archivedAt: nowIso() });
  }

  async deleteSupplier(id: string): Promise<Result<void>> {
    const before = this.items.find((s) => s.id === id);
    this.items = this.items.filter((s) => s.id !== id);
    this.subjects.set(this.items);
    audit({ action: "supplier.delete", entityType: "supplier", entityId: id, diff: { before, after: null } });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Purchase requests                                                  */
/* ------------------------------------------------------------------ */

function computeTotal(lines: readonly PurchaseRequestLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity * l.estimatedUnitPrice, 0);
}

const SEED_PURCHASE_REQUESTS: PurchaseRequest[] = [
  {
    id: "pr-001",
    tenantId: TENANT_ID,
    requestCode: "PR-2025-001",
    title: "Fournitures rentrée scolaire",
    description: "Stylos, cahiers, ardoises pour la rentrée",
    priority: "high" as PurchaseRequestPriority,
    status: "ordered" as PurchaseRequestStatus,
    supplierId: "sup-001",
    departmentId: "dept-buyers",
    lines: [
      { id: "prl-001", description: "Stylos bleus (lot 50)", quantity: 20, unit: "lot", estimatedUnitPrice: 1200 },
      { id: "prl-002", description: "Cahiers 200 pages", quantity: 100, unit: "pièce", estimatedUnitPrice: 80 },
    ],
    totalAmount: 20 * 1200 + 100 * 80,
    requestedBy: "usr-buy-001",
    requestedByName: "Yacine Mansouri",
    requestedAt: "2025-08-15T10:00:00.000Z",
    approvedBy: "usr-adm-001",
    approvedAt: "2025-08-17T14:00:00.000Z",
    approvalNote: "Validé — rentrée imminente",
    orderedAt: "2025-08-18T09:00:00.000Z",
    receivedAt: null,
    cancelledAt: null,
    cancellationReason: null,
  },
  {
    id: "pr-002",
    tenantId: TENANT_ID,
    requestCode: "PR-2025-002",
    title: "Carburant bus scolaire septembre",
    description: "Plein diesel hebdomadaire × 4",
    priority: "medium" as PurchaseRequestPriority,
    status: "submitted" as PurchaseRequestStatus,
    supplierId: "sup-002",
    departmentId: "dept-drivers",
    lines: [
      { id: "prl-003", description: "Diesel (litre)", quantity: 800, unit: "litre", estimatedUnitPrice: 45 },
    ],
    totalAmount: 800 * 45,
    requestedBy: "usr-buy-001",
    requestedByName: "Yacine Mansouri",
    requestedAt: "2025-09-01T08:00:00.000Z",
    approvedBy: null,
    approvedAt: null,
    approvalNote: null,
    orderedAt: null,
    receivedAt: null,
    cancelledAt: null,
    cancellationReason: null,
  },
  {
    id: "pr-003",
    tenantId: TENANT_ID,
    requestCode: "PR-2025-003",
    title: "Manuels CEM 1ère année",
    description: "Manuels de Mathématiques et Français pour le CEM",
    priority: "urgent" as PurchaseRequestPriority,
    status: "approved" as PurchaseRequestStatus,
    supplierId: "sup-003",
    departmentId: "dept-buyers",
    lines: [
      { id: "prl-004", description: "Manuel Maths CEM1", quantity: 100, unit: "pièce", estimatedUnitPrice: 450 },
      { id: "prl-005", description: "Manuel Français CEM1", quantity: 100, unit: "pièce", estimatedUnitPrice: 450 },
    ],
    totalAmount: 100 * 450 + 100 * 450,
    requestedBy: "usr-buy-001",
    requestedByName: "Yacine Mansouri",
    requestedAt: "2025-09-05T11:00:00.000Z",
    approvedBy: "usr-adm-001",
    approvedAt: "2025-09-05T16:00:00.000Z",
    approvalNote: "Urgent — rentrée dans 5 jours",
    orderedAt: null,
    receivedAt: null,
    cancelledAt: null,
    cancellationReason: null,
  },
  {
    id: "pr-004",
    tenantId: TENANT_ID,
    requestCode: "PR-2025-004",
    title: "Mobilier salle de classe",
    description: "Tables + chaises pour la nouvelle salle",
    priority: "low" as PurchaseRequestPriority,
    status: "draft" as PurchaseRequestStatus,
    supplierId: "sup-004",
    departmentId: "dept-warehouse",
    lines: [
      { id: "prl-006", description: "Table élève", quantity: 30, unit: "pièce", estimatedUnitPrice: 8500 },
      { id: "prl-007", description: "Chaise élève", quantity: 30, unit: "pièce", estimatedUnitPrice: 3200 },
    ],
    totalAmount: 30 * 8500 + 30 * 3200,
    requestedBy: "usr-buy-001",
    requestedByName: "Yacine Mansouri",
    requestedAt: "2025-09-10T14:00:00.000Z",
    approvedBy: null,
    approvedAt: null,
    approvalNote: null,
    orderedAt: null,
    receivedAt: null,
    cancelledAt: null,
    cancellationReason: null,
  },
];

class MockPurchaseRequestRepository implements PurchaseRequestRepository {
  private readonly subjects = new SubjectBehavior<PurchaseRequest[]>(SEED_PURCHASE_REQUESTS);
  private items: PurchaseRequest[] = SEED_PURCHASE_REQUESTS;
  private counter = SEED_PURCHASE_REQUESTS.length;
  private readonly byId = new Map<string, SubjectBehavior<PurchaseRequest | null>>();

  observe(): Observable<PurchaseRequest[]> { return this.subjects; }
  observeByRequester(userId: string): Observable<PurchaseRequest[]> {
    return new SubjectBehavior<PurchaseRequest[]>(this.items.filter((r) => r.requestedBy === userId));
  }
  observeByStatus(status: PurchaseRequestStatus): Observable<PurchaseRequest[]> {
    return new SubjectBehavior<PurchaseRequest[]>(this.items.filter((r) => r.status === status));
  }
  observeById(id: string): Observable<PurchaseRequest | null> {
    let s = this.byId.get(id);
    if (!s) {
      s = new SubjectBehavior<PurchaseRequest | null>(this.items.find((r) => r.id === id) ?? null);
      this.byId.set(id, s);
    }
    return s;
  }

  private notifyAll(): void {
    this.subjects.set(this.items);
    this.byId.forEach((s, id) => s.set(this.items.find((r) => r.id === id) ?? null));
  }

  async createPurchaseRequest(input: {
    title: string;
    description: string;
    priority: PurchaseRequestPriority;
    supplierId: string | null;
    departmentId: string | null;
    lines: readonly PurchaseRequestLine[];
    requestedBy: string;
    requestedByName: string;
  }): Promise<Result<PurchaseRequest>> {
    this.counter += 1;
    const requestCode = `PR-2025-${String(this.counter).padStart(3, "0")}`;
    const pr: PurchaseRequest = {
      id: genId("pr"),
      tenantId: TENANT_ID,
      requestCode,
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: "draft",
      supplierId: input.supplierId,
      departmentId: input.departmentId,
      lines: input.lines,
      totalAmount: computeTotal(input.lines),
      requestedBy: input.requestedBy,
      requestedByName: input.requestedByName,
      requestedAt: nowIso(),
      approvedBy: null,
      approvedAt: null,
      approvalNote: null,
      orderedAt: null,
      receivedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    };
    this.items = [pr, ...this.items];
    this.notifyAll();
    audit({ action: "purchase_request.create", entityType: "purchase_request", entityId: pr.id, actorId: input.requestedBy, actorName: input.requestedByName, diff: { after: pr } });
    return Ok(pr);
  }

  async updateStatus(id: string, status: PurchaseRequestStatus, actorId: string, actorName: string, note?: string): Promise<Result<PurchaseRequest>> {
    const idx = this.items.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("purchase_request", id));
    const before = this.items[idx];
    const ts = nowIso();
    let updates: Partial<PurchaseRequest> = { status };
    if (status === "approved") {
      updates = { ...updates, approvedBy: actorId, approvedAt: ts, approvalNote: note ?? null };
    } else if (status === "ordered") {
      updates = { ...updates, orderedAt: ts };
    } else if (status === "received") {
      updates = { ...updates, receivedAt: ts };
    }
    const after: PurchaseRequest = { ...before, ...updates };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.notifyAll();
    audit({ action: "purchase_request.status_change", entityType: "purchase_request", entityId: id, actorId, actorName, diff: { before, after }, note: status });
    return Ok(after);
  }

  async assignSupplier(id: string, supplierId: string, actorId: string): Promise<Result<PurchaseRequest>> {
    const idx = this.items.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("purchase_request", id));
    const before = this.items[idx];
    const after: PurchaseRequest = { ...before, supplierId };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.notifyAll();
    audit({ action: "purchase_request.assign_supplier", entityType: "purchase_request", entityId: id, actorId, diff: { before, after } });
    return Ok(after);
  }

  async cancel(id: string, reason: string, actorId: string, actorName: string): Promise<Result<PurchaseRequest>> {
    return this.updateStatus(id, "cancelled", actorId, actorName, reason);
  }

  async deletePurchaseRequest(id: string): Promise<Result<void>> {
    const before = this.items.find((r) => r.id === id);
    this.items = this.items.filter((r) => r.id !== id);
    this.notifyAll();
    audit({ action: "purchase_request.delete", entityType: "purchase_request", entityId: id, diff: { before, after: null } });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Deliveries                                                         */
/* ------------------------------------------------------------------ */

const SEED_DELIVERIES: Delivery[] = [
  {
    id: "del-001",
    tenantId: TENANT_ID,
    deliveryCode: "DEL-2025-001",
    driverId: "per-011",
    driverName: "Messaoud Khalfaoui",
    status: "in_transit" as DeliveryStatus,
    stops: [
      { id: "stop-001", sequence: 1, type: "pickup", label: "Dépôt central", address: "Zone industrielle Es Senia", lat: 35.65, lng: -0.62, plannedAt: "2025-09-20T07:30:00.000Z", completedAt: "2025-09-20T07:35:00.000Z" },
      { id: "stop-002", sequence: 2, type: "dropoff", label: "Site principal El-Imtiyaz", address: "Rue des Frères Bouadou, Oran", lat: 35.69, lng: -0.64, plannedAt: "2025-09-20T09:00:00.000Z", completedAt: null },
    ],
    purchaseRequestId: "pr-001",
    notes: "Livraison fournitures rentrée",
    assignedAt: "2025-09-20T06:00:00.000Z",
    startedAt: "2025-09-20T07:30:00.000Z",
    deliveredAt: null,
    confirmedAt: null,
    delayReason: null,
    newEta: null,
    confirmationUrl: null,
    vehicle: "Fourgon Peugeot Boxer",
  },
  {
    id: "del-002",
    tenantId: TENANT_ID,
    deliveryCode: "DEL-2025-002",
    driverId: "per-011",
    driverName: "Messaoud Khalfaoui",
    status: "assigned" as DeliveryStatus,
    stops: [
      { id: "stop-003", sequence: 1, type: "pickup", label: "Éditions Alpha", address: "Bab El Oued, Alger", lat: 36.78, lng: 3.06, plannedAt: "2025-09-22T06:00:00.000Z", completedAt: null },
      { id: "stop-004", sequence: 2, type: "dropoff", label: "Site principal El-Imtiyaz", address: "Rue des Frères Bouadou, Oran", lat: 35.69, lng: -0.64, plannedAt: "2025-09-22T14:00:00.000Z", completedAt: null },
    ],
    purchaseRequestId: "pr-003",
    notes: "Manuels CEM1",
    assignedAt: "2025-09-21T15:00:00.000Z",
    startedAt: null,
    deliveredAt: null,
    confirmedAt: null,
    delayReason: null,
    newEta: null,
    confirmationUrl: null,
    vehicle: "Camion Renault Maxity",
  },
  {
    id: "del-003",
    tenantId: TENANT_ID,
    deliveryCode: "DEL-2025-003",
    driverId: "per-011",
    driverName: "Messaoud Khalfaoui",
    status: "confirmed" as DeliveryStatus,
    stops: [
      { id: "stop-005", sequence: 1, type: "pickup", label: "Naftal", address: "Téléémie, Oran", lat: 35.71, lng: -0.63, plannedAt: "2025-09-19T08:00:00.000Z", completedAt: "2025-09-19T08:10:00.000Z" },
      { id: "stop-006", sequence: 2, type: "dropoff", label: "Garage El-Imtiyaz", address: "Oran", lat: 35.69, lng: -0.64, plannedAt: "2025-09-19T09:00:00.000Z", completedAt: "2025-09-19T09:15:00.000Z" },
    ],
    purchaseRequestId: null,
    notes: "Carburant bus scolaire",
    assignedAt: "2025-09-19T07:00:00.000Z",
    startedAt: "2025-09-19T08:00:00.000Z",
    deliveredAt: "2025-09-19T09:15:00.000Z",
    confirmedAt: "2025-09-19T09:30:00.000Z",
    delayReason: null,
    newEta: null,
    confirmationUrl: "mock://confirmations/del-003.pdf",
    vehicle: "Camion-citerne",
  },
  {
    id: "del-004",
    tenantId: TENANT_ID,
    deliveryCode: "DEL-2025-004",
    driverId: "per-011",
    driverName: "Messaoud Khalfaoui",
    status: "delayed" as DeliveryStatus,
    stops: [
      { id: "stop-007", sequence: 1, type: "pickup", label: "Fournitures Scolaires Oran", address: "Rue Larbi Ben M'hidi, Oran", lat: 35.7, lng: -0.63, plannedAt: "2025-09-18T10:00:00.000Z", completedAt: "2025-09-18T10:30:00.000Z" },
      { id: "stop-008", sequence: 2, type: "dropoff", label: "Annexe Hydra", address: "Hydra, Alger", lat: 36.75, lng: 3.03, plannedAt: "2025-09-18T16:00:00.000Z", completedAt: null },
    ],
    purchaseRequestId: "pr-001",
    notes: "Trafic autoroute A1",
    assignedAt: "2025-09-18T07:00:00.000Z",
    startedAt: "2025-09-18T10:00:00.000Z",
    deliveredAt: null,
    confirmedAt: null,
    delayReason: "Bouchons sur l'A1 — accident",
    newEta: "2025-09-18T19:00:00.000Z",
    confirmationUrl: null,
    vehicle: "Fourgon Peugeot Boxer",
  },
];

class MockDeliveryRepository implements DeliveryRepository {
  private readonly subjects = new SubjectBehavior<Delivery[]>(SEED_DELIVERIES);
  private items: Delivery[] = SEED_DELIVERIES;
  private counter = SEED_DELIVERIES.length;
  private readonly byId = new Map<string, SubjectBehavior<Delivery | null>>();

  observe(): Observable<Delivery[]> { return this.subjects; }
  observeByDriver(driverId: string): Observable<Delivery[]> {
    return new SubjectBehavior<Delivery[]>(this.items.filter((d) => d.driverId === driverId));
  }
  observeByStatus(status: DeliveryStatus): Observable<Delivery[]> {
    return new SubjectBehavior<Delivery[]>(this.items.filter((d) => d.status === status));
  }
  observeById(id: string): Observable<Delivery | null> {
    let s = this.byId.get(id);
    if (!s) {
      s = new SubjectBehavior<Delivery | null>(this.items.find((d) => d.id === id) ?? null);
      this.byId.set(id, s);
    }
    return s;
  }

  private notifyAll(): void {
    this.subjects.set(this.items);
    this.byId.forEach((s, id) => s.set(this.items.find((d) => d.id === id) ?? null));
  }

  async createDelivery(input: {
    driverId: string;
    driverName: string;
    stops: readonly DeliveryStop[];
    purchaseRequestId: string | null;
    notes: string;
    vehicle: string | null;
    assignedBy: string;
  }): Promise<Result<Delivery>> {
    this.counter += 1;
    const deliveryCode = `DEL-2025-${String(this.counter).padStart(3, "0")}`;
    const d: Delivery = {
      id: genId("del"),
      tenantId: TENANT_ID,
      deliveryCode,
      driverId: input.driverId,
      driverName: input.driverName,
      status: "assigned",
      stops: input.stops,
      purchaseRequestId: input.purchaseRequestId,
      notes: input.notes,
      assignedAt: nowIso(),
      startedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      delayReason: null,
      newEta: null,
      confirmationUrl: null,
      vehicle: input.vehicle,
    };
    this.items = [d, ...this.items];
    this.notifyAll();
    audit({ action: "delivery.create", entityType: "delivery", entityId: d.id, actorId: input.assignedBy, diff: { after: d } });
    return Ok(d);
  }

  async updateStatus(id: string, status: DeliveryStatus, actorId: string, actorName: string): Promise<Result<Delivery>> {
    const idx = this.items.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("delivery", id));
    const before = this.items[idx];
    const ts = nowIso();
    let updates: Partial<Delivery> = { status };
    if (status === "in_transit") updates = { ...updates, startedAt: ts };
    else if (status === "delivered") updates = { ...updates, deliveredAt: ts };
    else if (status === "confirmed") updates = { ...updates, confirmedAt: ts };
    const after: Delivery = { ...before, ...updates };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.notifyAll();
    audit({ action: "delivery.status_change", entityType: "delivery", entityId: id, actorId, actorName, diff: { before, after }, note: status });
    return Ok(after);
  }

  async reportDelay(id: string, reason: string, newEta: string, actorId: string, actorName: string): Promise<Result<Delivery>> {
    const idx = this.items.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("delivery", id));
    const before = this.items[idx];
    const after: Delivery = { ...before, status: "delayed" as DeliveryStatus, delayReason: reason, newEta };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.notifyAll();
    audit({ action: "delivery.delay", entityType: "delivery", entityId: id, actorId, actorName, diff: { before, after }, note: reason });
    return Ok(after);
  }

  async uploadConfirmation(id: string, confirmationUrl: string, actorId: string, actorName: string): Promise<Result<Delivery>> {
    const idx = this.items.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("delivery", id));
    const before = this.items[idx];
    const after: Delivery = { ...before, confirmationUrl, status: "confirmed" as DeliveryStatus, confirmedAt: nowIso() };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.notifyAll();
    audit({ action: "delivery.confirm", entityType: "delivery", entityId: id, actorId, actorName, diff: { before, after } });
    return Ok(after);
  }

  async deleteDelivery(id: string): Promise<Result<void>> {
    const before = this.items.find((d) => d.id === id);
    this.items = this.items.filter((d) => d.id !== id);
    this.notifyAll();
    audit({ action: "delivery.delete", entityType: "delivery", entityId: id, diff: { before, after: null } });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */

const SEED_ITEMS: InventoryItem[] = [
  { id: "inv-001", tenantId: TENANT_ID, sku: "STY-BLE-50", label: "Stylos bleus (lot 50)", category: "fournitures" as InventoryCategory, unit: "lot", quantityOnHand: 25, reorderLevel: 10, unitCost: 1200, location: "A-1-03", createdAt: "2024-09-01T00:00:00.000Z", updatedAt: "2025-09-15T10:00:00.000Z" },
  { id: "inv-002", tenantId: TENANT_ID, sku: "CAH-200P", label: "Cahiers 200 pages", category: "fournitures" as InventoryCategory, unit: "pièce", quantityOnHand: 8, reorderLevel: 30, unitCost: 80, location: "A-1-04", createdAt: "2024-09-01T00:00:00.000Z", updatedAt: "2025-09-18T14:00:00.000Z" },
  { id: "inv-003", tenantId: TENANT_ID, sku: "MAN-MATH-CEM1", label: "Manuel Maths CEM1", category: "manuels" as InventoryCategory, unit: "pièce", quantityOnHand: 95, reorderLevel: 50, unitCost: 450, location: "B-2-01", createdAt: "2025-09-05T00:00:00.000Z", updatedAt: "2025-09-10T09:00:00.000Z" },
  { id: "inv-004", tenantId: TENANT_ID, sku: "TAB-ELV", label: "Table élève", category: "mobilier" as InventoryCategory, unit: "pièce", quantityOnHand: 5, reorderLevel: 15, unitCost: 8500, location: "C-1-01", createdAt: "2024-08-15T00:00:00.000Z", updatedAt: "2025-09-12T11:00:00.000Z" },
  { id: "inv-005", tenantId: TENANT_ID, sku: "CHA-ELV", label: "Chaise élève", category: "mobilier" as InventoryCategory, unit: "pièce", quantityOnHand: 12, reorderLevel: 20, unitCost: 3200, location: "C-1-02", createdAt: "2024-08-15T00:00:00.000Z", updatedAt: "2025-09-12T11:00:00.000Z" },
  { id: "inv-006", tenantId: TENANT_ID, sku: "ARD-VST", label: "Ardoise verte", category: "fournitures" as InventoryCategory, unit: "pièce", quantityOnHand: 60, reorderLevel: 25, unitCost: 150, location: "A-2-01", createdAt: "2024-09-01T00:00:00.000Z", updatedAt: "2025-09-01T00:00:00.000Z" },
];

const SEED_TRANSACTIONS: InventoryTransaction[] = [
  { id: "itx-001", tenantId: TENANT_ID, itemId: "inv-001", itemSku: "STY-BLE-50", itemLabel: "Stylos bleus (lot 50)", type: "receive" as InventoryTransactionType, delta: 30, quantityBefore: 0, quantityAfter: 30, reason: "Réception PR-2025-001", actorId: "usr-whw-001", actorName: "Rachid Hadj", timestamp: "2025-09-15T10:00:00.000Z", reference: "PR-2025-001" },
  { id: "itx-002", tenantId: TENANT_ID, itemId: "inv-001", itemSku: "STY-BLE-50", itemLabel: "Stylos bleus (lot 50)", type: "dispatch" as InventoryTransactionType, delta: -5, quantityBefore: 30, quantityAfter: 25, reason: "Distribution classe 5A", actorId: "usr-whw-001", actorName: "Rachid Hadj", timestamp: "2025-09-16T09:30:00.000Z", reference: null },
  { id: "itx-003", tenantId: TENANT_ID, itemId: "inv-002", itemSku: "CAH-200P", itemLabel: "Cahiers 200 pages", type: "dispatch" as InventoryTransactionType, delta: -22, quantityBefore: 30, quantityAfter: 8, reason: "Distribution rentrée", actorId: "usr-whw-001", actorName: "Rachid Hadj", timestamp: "2025-09-18T14:00:00.000Z", reference: null },
  { id: "itx-004", tenantId: TENANT_ID, itemId: "inv-003", itemSku: "MAN-MATH-CEM1", itemLabel: "Manuel Maths CEM1", type: "receive" as InventoryTransactionType, delta: 100, quantityBefore: 0, quantityAfter: 100, reason: "Réception manuels CEM", actorId: "usr-whw-001", actorName: "Rachid Hadj", timestamp: "2025-09-10T09:00:00.000Z", reference: "PR-2025-003" },
  { id: "itx-005", tenantId: TENANT_ID, itemId: "inv-003", itemSku: "MAN-MATH-CEM1", itemLabel: "Manuel Maths CEM1", type: "dispatch" as InventoryTransactionType, delta: -5, quantityBefore: 100, quantityAfter: 95, reason: "Échantillon direction", actorId: "usr-whw-001", actorName: "Rachid Hadj", timestamp: "2025-09-11T11:00:00.000Z", reference: null },
];

class MockInventoryRepository implements InventoryRepository {
  private readonly itemsSubject = new SubjectBehavior<InventoryItem[]>(SEED_ITEMS);
  private items: InventoryItem[] = SEED_ITEMS;
  private readonly transactionsSubject = new SubjectBehavior<InventoryTransaction[]>(SEED_TRANSACTIONS);
  private transactions: InventoryTransaction[] = SEED_TRANSACTIONS;

  observeItems(): Observable<InventoryItem[]> { return this.itemsSubject; }
  observeItemById(id: string): Observable<InventoryItem | null> {
    return new SubjectBehavior<InventoryItem | null>(this.items.find((i) => i.id === id) ?? null);
  }
  observeTransactions(limit = 50): Observable<InventoryTransaction[]> {
    return new SubjectBehavior<InventoryTransaction[]>(this.transactions.slice(0, limit));
  }
  observeTransactionsByItem(itemId: string): Observable<InventoryTransaction[]> {
    return new SubjectBehavior<InventoryTransaction[]>(this.transactions.filter((t) => t.itemId === itemId));
  }

  async createItem(input: Omit<InventoryItem, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<Result<InventoryItem>> {
    const ts = nowIso();
    const item: InventoryItem = { ...input, id: genId("inv"), tenantId: TENANT_ID, createdAt: ts, updatedAt: ts };
    this.items = [...this.items, item];
    this.itemsSubject.set(this.items);
    audit({ action: "inventory.item_create", entityType: "inventory_item", entityId: item.id, diff: { after: item } });
    return Ok(item);
  }

  async updateItem(id: string, updates: Partial<InventoryItem>): Promise<Result<InventoryItem>> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return Err(Errors.notFound("inventory_item", id));
    const before = this.items[idx];
    const after: InventoryItem = { ...before, ...updates, id: before.id, tenantId: before.tenantId, updatedAt: nowIso() };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.itemsSubject.set(this.items);
    audit({ action: "inventory.item_update", entityType: "inventory_item", entityId: id, diff: { before, after } });
    return Ok(after);
  }

  async deleteItem(id: string): Promise<Result<void>> {
    const before = this.items.find((i) => i.id === id);
    this.items = this.items.filter((i) => i.id !== id);
    this.itemsSubject.set(this.items);
    audit({ action: "inventory.item_delete", entityType: "inventory_item", entityId: id, diff: { before, after: null } });
    return Ok(undefined);
  }

  async transact(input: {
    itemId: string;
    type: InventoryTransactionType;
    delta: number;
    reason: string | null;
    actorId: string;
    actorName: string;
    reference: string | null;
  }): Promise<Result<InventoryTransaction>> {
    const idx = this.items.findIndex((i) => i.id === input.itemId);
    if (idx === -1) return Err(Errors.notFound("inventory_item", input.itemId));
    const item = this.items[idx];
    const before = item.quantityOnHand;
    const after = Math.max(0, before + input.delta);
    const tx: InventoryTransaction = {
      id: genId("itx"),
      tenantId: TENANT_ID,
      itemId: item.id,
      itemSku: item.sku,
      itemLabel: item.label,
      type: input.type,
      delta: input.delta,
      quantityBefore: before,
      quantityAfter: after,
      reason: input.reason,
      actorId: input.actorId,
      actorName: input.actorName,
      timestamp: nowIso(),
      reference: input.reference,
    };
    const updatedItem: InventoryItem = { ...item, quantityOnHand: after, updatedAt: nowIso() };
    this.items = [...this.items.slice(0, idx), updatedItem, ...this.items.slice(idx + 1)];
    this.transactions = [tx, ...this.transactions];
    this.itemsSubject.set(this.items);
    this.transactionsSubject.set(this.transactions);
    audit({ action: `inventory.transact.${input.type}`, entityType: "inventory_transaction", entityId: tx.id, actorId: input.actorId, actorName: input.actorName, diff: { after: tx }, note: input.reason });
    return Ok(tx);
  }

  async scan(input: {
    sku: string;
    label: string;
    category: InventoryCategory;
    unit: string;
    quantity: number;
    actorId: string;
    actorName: string;
  }): Promise<Result<InventoryItem>> {
    // Find existing by SKU or create new
    const existing = this.items.find((i) => i.sku === input.sku);
    if (existing) {
      return this.transact({
        itemId: existing.id,
        type: "scan",
        delta: input.quantity,
        reason: `Scan: ${input.label}`,
        actorId: input.actorId,
        actorName: input.actorName,
        reference: null,
      }).then((r) => r.ok ? Ok(this.items.find((i) => i.id === existing.id)!) : r as unknown as Result<InventoryItem>);
    }
    // Create new item with the scanned quantity
    const created = await this.createItem({
      sku: input.sku,
      label: input.label,
      category: input.category,
      unit: input.unit,
      quantityOnHand: input.quantity,
      reorderLevel: 5,
      unitCost: 0,
      location: null,
    });
    if (created.ok) {
      // Log a scan transaction
      const tx: InventoryTransaction = {
        id: genId("itx"),
        tenantId: TENANT_ID,
        itemId: created.value.id,
        itemSku: created.value.sku,
        itemLabel: created.value.label,
        type: "scan",
        delta: input.quantity,
        quantityBefore: 0,
        quantityAfter: input.quantity,
        reason: "Scan initial",
        actorId: input.actorId,
        actorName: input.actorName,
        timestamp: nowIso(),
        reference: null,
      };
      this.transactions = [tx, ...this.transactions];
      this.transactionsSubject.set(this.transactions);
      audit({ action: "inventory.scan_new", entityType: "inventory_transaction", entityId: tx.id, actorId: input.actorId, actorName: input.actorName, diff: { after: tx } });
    }
    return created;
  }
}

/* ------------------------------------------------------------------ */
/*  Warehouse tasks (pending receipts + dispatches)                    */
/* ------------------------------------------------------------------ */

const SEED_RECEIPTS: PendingReceipt[] = [
  { id: "rcp-001", tenantId: TENANT_ID, supplierName: "Fournitures Scolaires Oran", purchaseRequestCode: "PR-2025-001", expectedQuantity: 20, receivedQuantity: 0, status: "pending" as ReceiptStatus, expectedAt: "2025-09-22T10:00:00.000Z", receivedAt: null },
  { id: "rcp-002", tenantId: TENANT_ID, supplierName: "Éditions Alpha", purchaseRequestCode: "PR-2025-003", expectedQuantity: 200, receivedQuantity: 0, status: "pending" as ReceiptStatus, expectedAt: "2025-09-25T09:00:00.000Z", receivedAt: null },
  { id: "rcp-003", tenantId: TENANT_ID, supplierName: "Mobilier Scolaire Plus", purchaseRequestCode: "PR-2025-004", expectedQuantity: 60, receivedQuantity: 0, status: "pending" as ReceiptStatus, expectedAt: "2025-09-28T08:00:00.000Z", receivedAt: null },
];

const SEED_DISPATCHES: PendingDispatch[] = [
  { id: "dsp-001", tenantId: TENANT_ID, destination: "Site annexe Hydra", itemLabel: "Manuels Maths CEM1", quantity: 50, status: "pending" as DispatchStatus, requestedAt: "2025-09-20T08:00:00.000Z", dispatchedAt: null },
  { id: "dsp-002", tenantId: TENANT_ID, destination: "Classe 5A", itemLabel: "Stylos bleus (lot 50)", quantity: 5, status: "preparing" as DispatchStatus, requestedAt: "2025-09-21T10:00:00.000Z", dispatchedAt: null },
];

class MockWarehouseTaskRepository implements WarehouseTaskRepository {
  private readonly receiptsSubject = new SubjectBehavior<PendingReceipt[]>(SEED_RECEIPTS);
  private receipts: PendingReceipt[] = SEED_RECEIPTS;
  private readonly dispatchesSubject = new SubjectBehavior<PendingDispatch[]>(SEED_DISPATCHES);
  private dispatches: PendingDispatch[] = SEED_DISPATCHES;

  observeReceipts(): Observable<PendingReceipt[]> { return this.receiptsSubject; }
  observeDispatches(): Observable<PendingDispatch[]> { return this.dispatchesSubject; }

  async receiveReceipt(id: string, actorId: string, actorName: string): Promise<Result<PendingReceipt>> {
    const idx = this.receipts.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("receipt", id));
    const before = this.receipts[idx];
    const after: PendingReceipt = { ...before, receivedQuantity: before.expectedQuantity, status: "received" as ReceiptStatus, receivedAt: nowIso() };
    this.receipts = [...this.receipts.slice(0, idx), after, ...this.receipts.slice(idx + 1)];
    this.receiptsSubject.set(this.receipts);
    audit({ action: "warehouse.receipt_receive", entityType: "receipt", entityId: id, actorId, actorName, diff: { before, after } });
    return Ok(after);
  }

  async prepareDispatch(id: string, actorId: string, actorName: string): Promise<Result<PendingDispatch>> {
    const idx = this.dispatches.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("dispatch", id));
    const before = this.dispatches[idx];
    const after: PendingDispatch = { ...before, status: "preparing" as DispatchStatus };
    this.dispatches = [...this.dispatches.slice(0, idx), after, ...this.dispatches.slice(idx + 1)];
    this.dispatchesSubject.set(this.dispatches);
    audit({ action: "warehouse.dispatch_prepare", entityType: "dispatch", entityId: id, actorId, actorName, diff: { before, after } });
    return Ok(after);
  }

  async dispatchDispatch(id: string, actorId: string, actorName: string): Promise<Result<PendingDispatch>> {
    const idx = this.dispatches.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("dispatch", id));
    const before = this.dispatches[idx];
    const after: PendingDispatch = { ...before, status: "dispatched" as DispatchStatus, dispatchedAt: nowIso() };
    this.dispatches = [...this.dispatches.slice(0, idx), after, ...this.dispatches.slice(idx + 1)];
    this.dispatchesSubject.set(this.dispatches);
    audit({ action: "warehouse.dispatch_send", entityType: "dispatch", entityId: id, actorId, actorName, diff: { before, after } });
    return Ok(after);
  }

  async createReceipt(input: Omit<PendingReceipt, "id" | "tenantId" | "receivedQuantity" | "status" | "receivedAt">): Promise<Result<PendingReceipt>> {
    const r: PendingReceipt = { ...input, id: genId("rcp"), tenantId: TENANT_ID, receivedQuantity: 0, status: "pending" as ReceiptStatus, receivedAt: null };
    this.receipts = [...this.receipts, r];
    this.receiptsSubject.set(this.receipts);
    audit({ action: "warehouse.receipt_create", entityType: "receipt", entityId: r.id, diff: { after: r } });
    return Ok(r);
  }

  async createDispatch(input: Omit<PendingDispatch, "id" | "tenantId" | "status" | "dispatchedAt">): Promise<Result<PendingDispatch>> {
    const d: PendingDispatch = { ...input, id: genId("dsp"), tenantId: TENANT_ID, status: "pending" as DispatchStatus, dispatchedAt: null };
    this.dispatches = [...this.dispatches, d];
    this.dispatchesSubject.set(this.dispatches);
    audit({ action: "warehouse.dispatch_create", entityType: "dispatch", entityId: d.id, diff: { after: d } });
    return Ok(d);
  }

  async deleteReceipt(id: string): Promise<Result<void>> {
    this.receipts = this.receipts.filter((r) => r.id !== id);
    this.receiptsSubject.set(this.receipts);
    audit({ action: "warehouse.receipt_delete", entityType: "receipt", entityId: id });
    return Ok(undefined);
  }

  async deleteDispatch(id: string): Promise<Result<void>> {
    this.dispatches = this.dispatches.filter((d) => d.id !== id);
    this.dispatchesSubject.set(this.dispatches);
    audit({ action: "warehouse.dispatch_delete", entityType: "dispatch", entityId: id });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

export const mockSupplierRepository = new MockSupplierRepository();
export const mockPurchaseRequestRepository = new MockPurchaseRequestRepository();
export const mockDeliveryRepository = new MockDeliveryRepository();
export const mockInventoryRepository = new MockInventoryRepository();
export const mockWarehouseTaskRepository = new MockWarehouseTaskRepository();

// Re-export for type-tests that need the Observable type.
export type { Observable };
