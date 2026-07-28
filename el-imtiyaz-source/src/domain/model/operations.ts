/**
 * Operations / Dashboard domain — KPIs, charts, alerts, notifications.
 * Plan §15 (Dashboard & Analytics).
 */
import type { AgingBucket } from "./payment";

export type NotificationType =
  | "payment_overdue"
  | "expense_pending"
  | "attendance_alert"
  | "homework"
  | "audit"
  | "system"
  | "message";

export interface AppNotification {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly type: NotificationType;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface DashboardKpi {
  readonly totalStudents: number;
  readonly totalParents: number;
  readonly totalStaff: number;
  readonly monthlyRevenue: number;
  readonly outstandingDebt: number;
  readonly pendingExpenses: number;
  readonly attendanceRateToday: number;
  readonly overdueAlerts: number;
}

export interface RevenuePoint {
  readonly label: string; // "Sep", "Oct", ...
  readonly amount: number;
}

export interface DebtByAgingBucket {
  readonly bucket: AgingBucket;
  readonly amount: number;
  readonly debtorCount: number;
}

export type DemographicSlice = {
  readonly label: string;
  readonly count: number;
  readonly percent: number;
};

export const NOTIFICATION_TYPE_LABELS_FR: Record<NotificationType, string> = {
  payment_overdue: "Paiement en retard",
  expense_pending: "Dépense en attente",
  attendance_alert: "Alerte de présence",
  homework: "Devoir",
  audit: "Audit",
  system: "Système",
  message: "Message",
};
