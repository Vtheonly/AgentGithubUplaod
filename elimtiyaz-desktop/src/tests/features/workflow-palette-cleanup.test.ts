/**
 * T-314 — palette cleanup: the low-level developer nodes
 * (`database_query`, `extract_field`) are hidden from the standard
 * school-admin palette while staying REGISTERED in the model (legacy graphs
 * keep validating + rendering; the SQL validator's 29-subtype whitelist is
 * untouched).
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_PALETTE_HIDDEN_SUBTYPES,
  NODE_SUBTYPES_BY_TYPE,
  NODE_SUBTYPE_TO_TYPE,
} from "../../domain/model/workflow";
import { PALETTE_VISIBLE_SUBTYPES_BY_TYPE } from "../../features/workflow/node-palette";

describe("admin palette cleanup (T-314)", () => {
  it("the developer nodes are hidden from the palette", () => {
    expect(ADMIN_PALETTE_HIDDEN_SUBTYPES.has("database_query")).toBe(true);
    expect(ADMIN_PALETTE_HIDDEN_SUBTYPES.has("extract_field")).toBe(true);
  });

  it("every visible palette group excludes the hidden dev nodes", () => {
    for (const subtypes of Object.values(PALETTE_VISIBLE_SUBTYPES_BY_TYPE)) {
      for (const subtype of subtypes) {
        expect(ADMIN_PALETTE_HIDDEN_SUBTYPES.has(subtype), `${subtype} must not appear in the admin palette`).toBe(false);
      }
    }
  });

  it("the transform group is empty in the palette (both dev nodes hidden)", () => {
    expect(PALETTE_VISIBLE_SUBTYPES_BY_TYPE.transform).toHaveLength(0);
  });

  it("the model registry still REGISTERS the dev nodes (legacy graphs stay valid)", () => {
    expect(NODE_SUBTYPES_BY_TYPE.transform).toContain("database_query");
    expect(NODE_SUBTYPES_BY_TYPE.transform).toContain("extract_field");
    expect(NODE_SUBTYPE_TO_TYPE.database_query).toBe("transform");
    expect(NODE_SUBTYPE_TO_TYPE.extract_field).toBe("transform");
  });

  it("the visible palette keeps the high-impact educational + financial nodes", () => {
    // Triggers: 3rd unexcused absence, payment overdue, check bounced, low
    // grade, term end (cron), manual run.
    for (const subtype of [
      "absence_limit_exceeded",
      "payment_overdue",
      "payment_cleared_or_bounced",
      "grade_below_threshold",
      "calendar_cron_event",
      "manual_run",
    ]) {
      expect(PALETTE_VISIBLE_SUBTYPES_BY_TYPE.trigger).toContain(subtype);
    }
    // Conditions: debt threshold, medical justification, time window, switch.
    for (const subtype of [
      "debt_over_threshold",
      "time_window",
      "route_switch",
      "student_status_match",
    ]) {
      expect(PALETTE_VISIBLE_SUBTYPES_BY_TYPE.condition).toContain(subtype);
    }
    // Actions: WhatsApp, staff task, portal notification, restriction, PDF.
    for (const subtype of [
      "send_whatsapp",
      "dispatch_task",
      "push_notification",
      "restrict_account",
      "generate_document",
    ]) {
      expect(PALETTE_VISIBLE_SUBTYPES_BY_TYPE.action).toContain(subtype);
    }
  });
});
