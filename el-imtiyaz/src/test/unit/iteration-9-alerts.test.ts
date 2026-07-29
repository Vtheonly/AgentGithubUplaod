/**
 * Iteration 9 — Alert domain tests.
 *
 * Covers the new alert priority / source / targeting / sorting logic
 * introduced in the iteration 9 Alert & Notification System Overhaul.
 */
import { describe, it, expect } from "vitest";
import {
  ALERT_PRIORITY_LABELS_FR,
  ALERT_PRIORITY_TONE,
  ALERT_PRIORITY_WEIGHT,
  ALERT_SOURCE_LABELS_FR,
  NOTIFICATION_TYPE_LABELS_FR,
  isAlertVisibleTo,
  sortAlertsByPriority,
  type AppNotification,
  type AlertPriority,
  type AlertSource,
} from "../../domain/model/operations";
import { Role } from "../../core/rbac/roles";

function buildAlert(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: `ntf-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test alert",
    body: "Body content for test alert",
    type: "custom",
    priority: "medium",
    source: "manual",
    sourceLabel: "Test source",
    entityType: null,
    entityId: null,
    targetUserId: null,
    targetRole: null,
    triggeredAt: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    createdBy: "system",
    ...overrides,
  };
}

describe("Iteration 9 — Alert domain", () => {
  describe("labels & tones", () => {
    it("exposes French labels for every priority", () => {
      const priorities: AlertPriority[] = ["low", "medium", "high", "urgent"];
      for (const p of priorities) {
        expect(ALERT_PRIORITY_LABELS_FR[p]).toBeTruthy();
        expect(typeof ALERT_PRIORITY_LABELS_FR[p]).toBe("string");
      }
    });

    it("exposes French labels for every source", () => {
      const sources: AlertSource[] = ["system", "manual", "workflow", "schedule", "audit"];
      for (const s of sources) {
        expect(ALERT_SOURCE_LABELS_FR[s]).toBeTruthy();
      }
    });

    it("exposes a tone for every priority", () => {
      const priorities: AlertPriority[] = ["low", "medium", "high", "urgent"];
      for (const p of priorities) {
        const tone = ALERT_PRIORITY_TONE[p];
        expect(["neutral", "info", "warning", "danger"]).toContain(tone);
      }
    });

    it("exposes the new 'custom' notification type label", () => {
      expect(NOTIFICATION_TYPE_LABELS_FR.custom).toBe("Alerte personnalisée");
    });

    it("weights urgent highest and low lowest", () => {
      expect(ALERT_PRIORITY_WEIGHT.urgent).toBeGreaterThan(ALERT_PRIORITY_WEIGHT.high);
      expect(ALERT_PRIORITY_WEIGHT.high).toBeGreaterThan(ALERT_PRIORITY_WEIGHT.medium);
      expect(ALERT_PRIORITY_WEIGHT.medium).toBeGreaterThan(ALERT_PRIORITY_WEIGHT.low);
    });
  });

  describe("sortAlertsByPriority", () => {
    it("sorts urgent first, then high, then medium, then low", () => {
      const alerts: AppNotification[] = [
        buildAlert({ id: "1", priority: "low", createdAt: "2025-01-01T00:00:00Z" }),
        buildAlert({ id: "2", priority: "urgent", createdAt: "2025-01-02T00:00:00Z" }),
        buildAlert({ id: "3", priority: "medium", createdAt: "2025-01-03T00:00:00Z" }),
        buildAlert({ id: "4", priority: "high", createdAt: "2025-01-04T00:00:00Z" }),
      ];
      const sorted = sortAlertsByPriority(alerts);
      expect(sorted.map((a) => a.priority)).toEqual(["urgent", "high", "medium", "low"]);
    });

    it("within the same priority, sorts by createdAt desc (newest first)", () => {
      const alerts: AppNotification[] = [
        buildAlert({ id: "old", priority: "high", createdAt: "2025-01-01T00:00:00Z" }),
        buildAlert({ id: "new", priority: "high", createdAt: "2025-02-01T00:00:00Z" }),
      ];
      const sorted = sortAlertsByPriority(alerts);
      expect(sorted[0].id).toBe("new");
      expect(sorted[1].id).toBe("old");
    });

    it("returns an empty array for an empty input", () => {
      expect(sortAlertsByPriority([])).toEqual([]);
    });

    it("does not mutate the input array", () => {
      const alerts: AppNotification[] = [
        buildAlert({ id: "1", priority: "low" }),
        buildAlert({ id: "2", priority: "urgent" }),
      ];
      const original = [...alerts];
      sortAlertsByPriority(alerts);
      expect(alerts.map((a) => a.id)).toEqual(original.map((a) => a.id));
    });
  });

  describe("isAlertVisibleTo", () => {
    const adminSession = { userId: "usr-adm-001", role: Role.SuperAdmin };
    const teacherSession = { userId: "usr-tea-001", role: Role.Teacher };
    const workerSession = { userId: "usr-wrk-001", role: Role.Worker };

    it("returns true for broadcast alerts (no target) for any session", () => {
      const alert = buildAlert({ targetUserId: null, targetRole: null });
      expect(isAlertVisibleTo(alert, adminSession)).toBe(true);
      expect(isAlertVisibleTo(alert, teacherSession)).toBe(true);
      expect(isAlertVisibleTo(alert, workerSession)).toBe(true);
    });

    it("returns true for user-targeted alerts only when the session userId matches", () => {
      const alert = buildAlert({ targetUserId: "usr-tea-001", targetRole: null });
      expect(isAlertVisibleTo(alert, teacherSession)).toBe(true);
      expect(isAlertVisibleTo(alert, adminSession)).toBe(false);
      expect(isAlertVisibleTo(alert, workerSession)).toBe(false);
    });

    it("returns true for role-targeted alerts only when the session role matches", () => {
      const alert = buildAlert({ targetUserId: null, targetRole: Role.Teacher });
      expect(isAlertVisibleTo(alert, teacherSession)).toBe(true);
      expect(isAlertVisibleTo(alert, adminSession)).toBe(false);
      expect(isAlertVisibleTo(alert, workerSession)).toBe(false);
    });

    it("returns true when both targetUserId and targetRole are set and either matches", () => {
      const alert = buildAlert({ targetUserId: "usr-tea-001", targetRole: Role.SuperAdmin });
      // userId matches
      expect(isAlertVisibleTo(alert, teacherSession)).toBe(true);
      // role matches
      expect(isAlertVisibleTo(alert, adminSession)).toBe(true);
      // neither matches
      expect(isAlertVisibleTo(alert, workerSession)).toBe(false);
    });
  });
});
