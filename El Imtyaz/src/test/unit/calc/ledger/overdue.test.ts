/**
 * Characterization tests for `calc/ledger/overdue.ts`.
 *
 * Verifies the overdue calculations match the original behavior.
 */
import { describe, it, expect } from "vitest";
import {
  maxDaysOverdueFromLedger,
  buildOverdueDueDateMap,
} from "@/domain/calc/ledger/overdue";
import { createChargeEntry } from "@/domain/calc/ledger/entries";
import { createPaymentEntry } from "@/domain/calc/ledger/entries";
import type { LedgerEntry } from "@/domain/model/ledger";

const TENANT = "tenant-1";

function chargeAt(at: string, accountId = "parent:p1:category:tuition"): LedgerEntry {
  return createChargeEntry({
    tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
    amount: 1000, sourceType: "installment", sourceId: `src-${at}`,
    description: "Test", actorId: "a", actorName: "A", at,
  });
}

describe("calc/ledger/overdue — maxDaysOverdueFromLedger", () => {
  it("returns 0 when there are no entries", () => {
    expect(maxDaysOverdueFromLedger([], new Date())).toBe(0);
  });
  it("returns 0 when there are no charge entries", () => {
    const e = createPaymentEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 100, method: "cash", receiptNumber: "R", paymentStatus: "paid",
      sourceType: "payment", sourceId: "p",
      description: "P", actorId: "a", actorName: "A",
      at: "2025-01-01T00:00:00.000Z",
    });
    expect(maxDaysOverdueFromLedger([e], new Date("2025-09-15T00:00:00.000Z"))).toBe(0);
  });
  it("returns 0 when no charges are overdue (all in the future)", () => {
    const e = chargeAt("2025-12-01T00:00:00.000Z");
    expect(maxDaysOverdueFromLedger([e], new Date("2025-09-15T00:00:00.000Z"))).toBe(0);
  });
  it("returns 0 when a charge is exactly at `now` (strict less-than)", () => {
    const e = chargeAt("2025-09-15T00:00:00.000Z");
    expect(maxDaysOverdueFromLedger([e], new Date("2025-09-15T00:00:00.000Z"))).toBe(0);
  });
  it("returns the days overdue for a single past-due charge", () => {
    const e = chargeAt("2025-09-10T00:00:00.000Z");
    expect(maxDaysOverdueFromLedger([e], new Date("2025-09-15T00:00:00.000Z"))).toBe(5);
  });
  it("returns the MAX days overdue across multiple past-due charges", () => {
    const entries = [
      chargeAt("2025-09-13T00:00:00.000Z"), // 2 days
      chargeAt("2025-09-10T00:00:00.000Z"), // 5 days
      chargeAt("2025-09-14T00:00:00.000Z"), // 1 day
    ];
    expect(maxDaysOverdueFromLedger(entries, new Date("2025-09-15T00:00:00.000Z"))).toBe(5);
  });
  it("floors partial-day differences (preserves Math.floor behavior)", () => {
    // 23h59m overdue → floor → 0 days
    const e = chargeAt("2025-09-14T00:00:00.001Z");
    expect(maxDaysOverdueFromLedger([e], new Date("2025-09-14T23:59:59.999Z"))).toBe(0);
  });
});

describe("calc/ledger/overdue — buildOverdueDueDateMap", () => {
  it("returns an empty map when there are no entries", () => {
    expect(buildOverdueDueDateMap([]).size).toBe(0);
  });
  it("returns an empty map when there are no charge entries", () => {
    const e = createPaymentEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 100, method: "cash", receiptNumber: "R", paymentStatus: "paid",
      sourceType: "payment", sourceId: "p",
      description: "P", actorId: "a", actorName: "A",
      at: "2025-01-01T00:00:00.000Z",
    });
    expect(buildOverdueDueDateMap([e]).size).toBe(0);
  });
  it("returns a map keyed by accountId with the charge's timestamp", () => {
    const e = chargeAt("2025-06-01T10:00:00.000Z");
    const map = buildOverdueDueDateMap([e]);
    expect(map.size).toBe(1);
    expect(map.get("parent:p1:category:tuition")?.toISOString()).toBe("2025-06-01T10:00:00.000Z");
  });
  it("keeps the LATEST charge's timestamp per account", () => {
    const older = chargeAt("2025-01-01T00:00:00.000Z");
    const newer = chargeAt("2025-06-01T00:00:00.000Z");
    const map = buildOverdueDueDateMap([older, newer]);
    expect(map.size).toBe(1);
    expect(map.get("parent:p1:category:tuition")?.toISOString()).toBe("2025-06-01T00:00:00.000Z");
  });
  it("keeps separate entries for different accounts", () => {
    const tuition = createChargeEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 1000, sourceType: "installment", sourceId: "src-t",
      description: "T", actorId: "a", actorName: "A", at: "2025-06-01T00:00:00.000Z",
    });
    const transport = createChargeEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "transport",
      amount: 500, sourceType: "installment", sourceId: "src-tr",
      description: "T", actorId: "a", actorName: "A", at: "2025-07-01T00:00:00.000Z",
    });
    const map = buildOverdueDueDateMap([tuition, transport]);
    expect(map.size).toBe(2);
    expect(map.has("parent:p1:category:tuition")).toBe(true);
    expect(map.has("parent:p1:category:transport")).toBe(true);
  });
});
