/**
 * Operations domain — iteration 9.
 *
 * Entities that back the Buyer / Driver / Warehouse dashboards. In
 * iteration 8 these lived as inline mock arrays inside the dashboard
 * components; iteration 9 promotes them to first-class domain entities
 * with repository contracts, audit-logged mutations, and reactive
 * observables so changes propagate to every consumer.
 *
 * All entities are immutable records. Mutations return new instances.
 */

/* ------------------------------------------------------------------ */
/*  Suppliers                                                          */
/* ------------------------------------------------------------------ */

export interface Supplier {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly category: string;
  readonly contactName: string;
  readonly phone: string;
  readonly email: string | null;
  readonly address: string | null;
  readonly paymentTerms: string;
  readonly rating: number; // 0–5
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

/* ------------------------------------------------------------------ */
/*  Purchase requests                                                  */
/* ------------------------------------------------------------------ */

export type PurchaseRequestStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "ordered"
  | "received"
  | "cancelled";

export type PurchaseRequestPriority = "low" | "medium" | "high" | "urgent";

export const PURCHASE_REQUEST_STATUS_LABELS_FR: Record<PurchaseRequestStatus, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  approved: "Approuvée",
  rejected: "Refusée",
  ordered: "Commandée",
  received: "Reçue",
  cancelled: "Annulée",
};

export const PURCHASE_REQUEST_PRIORITY_LABELS_FR: Record<PurchaseRequestPriority, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
  urgent: "Urgente",
};

export interface PurchaseRequestLine {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly estimatedUnitPrice: number;
}

export interface PurchaseRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly requestCode: string;
  readonly title: string;
  readonly description: string;
  readonly priority: PurchaseRequestPriority;
  readonly status: PurchaseRequestStatus;
  readonly supplierId: string | null;
  readonly departmentId: string | null;
  readonly lines: readonly PurchaseRequestLine[];
  readonly totalAmount: number;
  readonly requestedBy: string;
  readonly requestedByName: string;
  readonly requestedAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvalNote: string | null;
  readonly orderedAt: string | null;
  readonly receivedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
}

/* ------------------------------------------------------------------ */
/*  Deliveries                                                         */
/* ------------------------------------------------------------------ */

export type DeliveryStatus =
  | "assigned"
  | "in_transit"
  | "delivered"
  | "confirmed"
  | "delayed"
  | "failed";

export const DELIVERY_STATUS_LABELS_FR: Record<DeliveryStatus, string> = {
  assigned: "Affectée",
  in_transit: "En cours",
  delivered: "Livrée",
  confirmed: "Confirmée",
  delayed: "En retard",
  failed: "Échouée",
};

export interface DeliveryStop {
  readonly id: string;
  readonly sequence: number;
  readonly type: "pickup" | "dropoff";
  readonly label: string;
  readonly address: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly plannedAt: string | null;
  readonly completedAt: string | null;
}

export interface Delivery {
  readonly id: string;
  readonly tenantId: string;
  readonly deliveryCode: string;
  readonly driverId: string;
  readonly driverName: string;
  readonly status: DeliveryStatus;
  readonly stops: readonly DeliveryStop[];
  readonly purchaseRequestId: string | null;
  readonly notes: string;
  readonly assignedAt: string;
  readonly startedAt: string | null;
  readonly deliveredAt: string | null;
  readonly confirmedAt: string | null;
  readonly delayReason: string | null;
  readonly newEta: string | null;
  readonly confirmationUrl: string | null;
  readonly vehicle: string | null;
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */

export type InventoryCategory =
  | "fournitures"
  | "mobilier"
  | "manuels"
  | "informatique"
  | "entretien"
  | "autre";

export const INVENTORY_CATEGORY_LABELS_FR: Record<InventoryCategory, string> = {
  fournitures: "Fournitures",
  mobilier: "Mobilier",
  manuels: "Manuels",
  informatique: "Informatique",
  entretien: "Entretien",
  autre: "Autre",
};

export interface InventoryItem {
  readonly id: string;
  readonly tenantId: string;
  readonly sku: string;
  readonly label: string;
  readonly category: InventoryCategory;
  readonly unit: string;
  readonly quantityOnHand: number;
  readonly reorderLevel: number;
  readonly unitCost: number;
  readonly location: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type InventoryTransactionType =
  | "receive"
  | "dispatch"
  | "scan"
  | "damage"
  | "adjust"
  | "return";

export const INVENTORY_TRANSACTION_LABELS_FR: Record<InventoryTransactionType, string> = {
  receive: "Réception",
  dispatch: "Expédition",
  scan: "Scan",
  damage: "Avarie",
  adjust: "Ajustement",
  return: "Retour",
};

export interface InventoryTransaction {
  readonly id: string;
  readonly tenantId: string;
  readonly itemId: string;
  readonly itemSku: string;
  readonly itemLabel: string;
  readonly type: InventoryTransactionType;
  readonly delta: number; // signed: +receive, -dispatch, etc.
  readonly quantityBefore: number;
  readonly quantityAfter: number;
  readonly reason: string | null;
  readonly actorId: string;
  readonly actorName: string;
  readonly timestamp: string;
  readonly reference: string | null; // PO #, delivery #, etc.
}

/* ------------------------------------------------------------------ */
/*  Pending receipts / dispatches (warehouse dashboard)                */
/* ------------------------------------------------------------------ */

export type ReceiptStatus = "pending" | "partial" | "received" | "cancelled";
export type DispatchStatus = "pending" | "preparing" | "dispatched" | "cancelled";

export const RECEIPT_STATUS_LABELS_FR: Record<ReceiptStatus, string> = {
  pending: "En attente",
  partial: "Partielle",
  received: "Reçue",
  cancelled: "Annulée",
};

export const DISPATCH_STATUS_LABELS_FR: Record<DispatchStatus, string> = {
  pending: "En attente",
  preparing: "En préparation",
  dispatched: "Expédiée",
  cancelled: "Annulée",
};

export interface PendingReceipt {
  readonly id: string;
  readonly tenantId: string;
  readonly supplierName: string;
  readonly purchaseRequestCode: string | null;
  readonly expectedQuantity: number;
  readonly receivedQuantity: number;
  readonly status: ReceiptStatus;
  readonly expectedAt: string;
  readonly receivedAt: string | null;
}

export interface PendingDispatch {
  readonly id: string;
  readonly tenantId: string;
  readonly destination: string;
  readonly itemLabel: string;
  readonly quantity: number;
  readonly status: DispatchStatus;
  readonly requestedAt: string;
  readonly dispatchedAt: string | null;
}
