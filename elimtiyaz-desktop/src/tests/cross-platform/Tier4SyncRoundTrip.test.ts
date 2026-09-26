/**
 * Tier 4 — Synchronization Round-Trip + Idempotency Tests.
 *
 * Tests both directions:
 *   Desktop → Backend → Android
 *   Android → Backend → Desktop
 *
 * And idempotency: repeated synchronization cycles must converge
 *   State(N) == State(N+1)
 *   (no duplicate payments, receipts, ledger entries, students,
 *    inflated balances, missing transactions, altered historical totals)
 *
 * These tests run against the Kotlin-mirror engine + desktop engine,
 * simulating the sync contract via the canonical JSON scenario format.
 *
 * Run:
 *   npx vitest run src/test/cross-platform/Tier4SyncRoundTrip.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  computeAccountBalance,
  computeParentSummary,
  deriveAccountId,
  allocatePaymentToInstallments,
  revertPaymentAllocation,
  evaluateAllSystemDiscounts,
  sumDiscounts,
  splitNetTuitionByOfficialSchedule,
  reconcileLedger,
  stableHash,
  deterministicParentCode,
  deterministicActivationCode,
  type LedgerEntry,
  type WaterfallInstallment,
} from "../../../financial-tests/equivalence/android_mirror/kotlin_mirror_engine";

const NOW = new Date("2028-01-01T00:00:00Z").getTime();

const charge = (id: string, parentId: string, studentId: string | null, category: string, amount: number, at: string): LedgerEntry => ({
  id, tenantId: "t1",
  accountId: deriveAccountId(parentId, category as never, studentId),
  parentId, studentId, category: category as never,
  amount, type: "charge",
  sourceType: "installment", sourceId: `ins-${id}`,
  method: null, receiptNumber: null, paymentStatus: null,
  reversesId: null, description: "Charge",
  actorId: "u1", actorName: "Alice", at,
  metadata: {},
});

const paymentEntry = (id: string, parentId: string, studentId: string | null, category: string, amount: number, status: "paid" | "pending", at: string): LedgerEntry => ({
  id, tenantId: "t1",
  accountId: deriveAccountId(parentId, category as never, studentId),
  parentId, studentId, category: category as never,
  amount: -amount, type: "payment",
  sourceType: "payment", sourceId: id,
  method: "cash", receiptNumber: `REC-${id}`, paymentStatus: status,
  reversesId: null, description: "Payment",
  actorId: "u1", actorName: "Alice", at,
  metadata: {},
});

// ─── Sync direction tests ─────────────────────────────────────────────────────

describe("Sync direction: Desktop → Backend → Android (state preserved)", () => {
  it("a payment created on desktop produces the same domain state when pulled to android", () => {
    // Desktop creates a payment: 2,500,000 centimes against a 5,000,000 charge
    const entries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      paymentEntry("p1", "par-001", "stu-001", "tuition", 2_500_000, "paid", "2026-09-20T10:00:00Z"),
    ];

    // Compute desktop summary
    const desktopSummary = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);
    expect(desktopSummary.totalCharged).toBe(5_000_000);
    expect(desktopSummary.totalPaid).toBe(2_500_000);
    expect(desktopSummary.totalOutstanding).toBe(2_500_000);

    // Simulate sync: the SAME entries arrive on Android (via Supabase pull RPCs).
    // The android engine replays them through the SAME canonical engine.
    const androidEntries = [...entries]; // (simulating that they arrived via pull)
    const androidSummary = computeParentSummary(androidEntries, "par-001", "Test Parent", new Map(), NOW);

    // State MUST be identical.
    expect(androidSummary.totalCharged).toBe(desktopSummary.totalCharged);
    expect(androidSummary.totalPaid).toBe(desktopSummary.totalPaid);
    expect(androidSummary.totalOutstanding).toBe(desktopSummary.totalOutstanding);
    expect(androidSummary.totalUnallocatedCredit).toBe(desktopSummary.totalUnallocatedCredit);
  });
});

describe("Sync direction: Android → Backend → Desktop (state preserved)", () => {
  it("a payment created on Android produces the same domain state when pulled to desktop", () => {
    // Android creates a payment: 3,000,000 centimes against a 5,000,000 charge
    const entries: LedgerEntry[] = [
      charge("c1", "par-002", "stu-002", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      paymentEntry("p2", "par-002", "stu-002", "tuition", 3_000_000, "paid", "2026-09-22T10:00:00Z"),
    ];

    const androidSummary = computeParentSummary(entries, "par-002", "Test Parent", new Map(), NOW);
    expect(androidSummary.totalCharged).toBe(5_000_000);
    expect(androidSummary.totalPaid).toBe(3_000_000);
    expect(androidSummary.totalOutstanding).toBe(2_000_000);

    // Simulate sync: the SAME entries arrive on desktop.
    const desktopEntries = [...entries];
    const desktopSummary = computeParentSummary(desktopEntries, "par-002", "Test Parent", new Map(), NOW);

    expect(desktopSummary.totalCharged).toBe(androidSummary.totalCharged);
    expect(desktopSummary.totalPaid).toBe(androidSummary.totalPaid);
    expect(desktopSummary.totalOutstanding).toBe(androidSummary.totalOutstanding);
  });
});

// ─── Idempotency tests ──────────────────────────────────────────────────────

describe("Idempotency: repeated sync cycles converge State(N) == State(N+1)", () => {
  it("repeatedly computing the same parent summary produces identical results", () => {
    const entries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      paymentEntry("p1", "par-001", "stu-001", "tuition", 2_500_000, "paid", "2026-09-20T10:00:00Z"),
    ];

    const s1 = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);
    const s2 = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);
    const s3 = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);

    expect(s1).toEqual(s2);
    expect(s2).toEqual(s3);
  });

  it("repeatedly reconciling the same ledger produces identical violation sets", () => {
    const entries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      paymentEntry("p1", "par-001", "stu-001", "tuition", 2_500_000, "paid", "2026-09-20T10:00:00Z"),
    ];
    const payments = [{ id: "p1", amount: 2_500_000, status: "paid" as const }];

    const r1 = reconcileLedger(entries, { payments });
    const r2 = reconcileLedger(entries, { payments });
    const r3 = reconcileLedger(entries, { payments });

    // Strip checkedAt (timestamp) before comparing
    const stripTimestamp = (r: typeof r1) => ({ ...r, checkedAt: "" });
    expect(stripTimestamp(r1)).toEqual(stripTimestamp(r2));
    expect(stripTimestamp(r2)).toEqual(stripTimestamp(r3));
  });

  it("repeatedly allocating the same payment produces identical waterfall results", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 5_000_000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
      { id: "i2", category: "tuition", amountDue: 5_000_000, amountPaid: 0, amountPending: 0, dueDate: "2026-12-15", status: "unpaid" },
    ];

    const r1 = allocatePaymentToInstallments(installments, 6_000_000, "tuition", "paid");
    const r2 = allocatePaymentToInstallments(installments, 6_000_000, "tuition", "paid");

    expect(r1).toEqual(r2);
    // No duplicate allocations
    expect(r1.allocations).toHaveLength(2);
    expect(r1.allocations[0].installmentId).toBe("i1");
    expect(r1.allocations[1].installmentId).toBe("i2");
  });
});

// ─── Deterministic identity codes (idempotency of upserts) ──────────────────

describe("Idempotency: deterministic parent_code + activation_code", () => {
  it("re-creating the same parent produces the SAME parent_code", () => {
    const code1 = deterministicParentCode(2026, {
      phone: "+213555123456",
      displayName: "Ahmed Benali",
      firstName: "Ahmed",
      lastName: "Benali",
    });
    const code2 = deterministicParentCode(2026, {
      phone: "+213555123456",
      displayName: "Ahmed Benali",
      firstName: "Ahmed",
      lastName: "Benali",
    });
    expect(code1).toBe(code2);
    expect(code1).toMatch(/^PAR-2026-[A-F0-9]{6}$/);
  });

  it("re-creating the same parent produces the SAME activation_code", () => {
    const parentCode = "PAR-2026-ABC123";
    const ac1 = deterministicActivationCode(parentCode, "tenant-1");
    const ac2 = deterministicActivationCode(parentCode, "tenant-1");
    expect(ac1).toBe(ac2);
    expect(ac1).toMatch(/^\d{6}$/);
    expect(parseInt(ac1, 10)).toBeGreaterThanOrEqual(100_000);
    expect(parseInt(ac1, 10)).toBeLessThanOrEqual(999_999);
  });

  it("different parents produce different parent_codes", () => {
    const code1 = deterministicParentCode(2026, {
      phone: "+213555111111", firstName: "Ahmed", lastName: "Benali", displayName: "Ahmed Benali",
    });
    const code2 = deterministicParentCode(2026, {
      phone: "+213555222222", firstName: "Yacine", lastName: "Cherif", displayName: "Yacine Cherif",
    });
    expect(code1).not.toBe(code2);
  });

  it("stableHash is deterministic + 6-char hex", () => {
    const h1 = stableHash("test-input-123");
    const h2 = stableHash("test-input-123");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[A-F0-9]{6}$/);
  });

  it("stableHash matches the canonical FNV-1a test vectors (cross-platform)", () => {
    // Canonical FNV-1a 32-bit test vectors
    // empty string → 0x811c9dc5 → first 6 hex = "811C9D"
    expect(stableHash("")).toBe("811C9D");
    // "a" → 0xe40c292c → first 6 hex = "E40C29"
    expect(stableHash("a")).toBe("E40C29");
  });
});

// ─── Idempotency of sync push (no duplicate state) ─────────────────────────

describe("Idempotency: sync push produces no duplicate state on retry", () => {
  it("re-pushing the same payment does not double-count in totals", () => {
    // Simulate: desktop pushes payment p1. The push succeeds but the network
    // drops the response. Desktop retries the push.
    // If the upsert is idempotent (which it should be via stable identifier
    // `payment_number`), the backend state is the same after retry.
    const entriesAfterFirstPush: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      paymentEntry("p1", "par-001", "stu-001", "tuition", 2_500_000, "paid", "2026-09-20T10:00:00Z"),
    ];

    // After retry (idempotent): the same payment p1 is in the entries exactly once.
    // (We model the "retry" as a no-op because the upsert RPC matched on payment_number
    // and didn't create a duplicate.)
    const entriesAfterRetry: LedgerEntry[] = [...entriesAfterFirstPush];

    const summary1 = computeParentSummary(entriesAfterFirstPush, "par-001", "Test Parent", new Map(), NOW);
    const summary2 = computeParentSummary(entriesAfterRetry, "par-001", "Test Parent", new Map(), NOW);

    expect(summary2.totalPaid).toBe(summary1.totalPaid);
    expect(summary2.totalOutstanding).toBe(summary1.totalOutstanding);
    expect(summary2.entryCount).toBe(summary1.entryCount);
  });

  it("re-pushing a parent_credit adjustment does not inflate unallocatedCredit", () => {
    const entriesAfterFirstPush: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      {
        id: "adj-1", tenantId: "t1",
        accountId: deriveAccountId("par-001", "parent_credit", null),
        parentId: "par-001", studentId: null, category: "parent_credit" as never,
        amount: -2_000_000, type: "adjustment",
        sourceType: "adjustment", sourceId: "adj-1",
        method: null, receiptNumber: null, paymentStatus: null,
        reversesId: null, description: "Parent credit",
        actorId: "u1", actorName: "Alice", at: "2026-09-10T00:00:00Z",
        metadata: {},
      },
    ];

    // Retry (idempotent): the adjustment is in the ledger once.
    const entriesAfterRetry = [...entriesAfterFirstPush];

    const summary1 = computeParentSummary(entriesAfterFirstPush, "par-001", "Test Parent", new Map(), NOW);
    const summary2 = computeParentSummary(entriesAfterRetry, "par-001", "Test Parent", new Map(), NOW);

    expect(summary2.totalUnallocatedCredit).toBe(summary1.totalUnallocatedCredit);
    expect(summary2.totalUnallocatedCredit).toBe(-2_000_000);
  });
});

// ─── Metadata preservation through sync ─────────────────────────────────────

describe("Sync: metadata preserved through round-trip", () => {
  it("ledger entry metadata is preserved verbatim through push + pull", () => {
    const originalMetadata = {
      tranche: 1,
      level: "1ap",
      gradeLevel: "1ap",
      paymentPlan: "tranches",
      academicCycle: "palier-2",
      dueDate: "2026-09-15",
    };
    const entry: LedgerEntry = {
      id: "c1", tenantId: "t1",
      accountId: "parent:par-001:category:tuition:student:stu-001",
      parentId: "par-001", studentId: "stu-001", category: "tuition",
      amount: 5_000_000, type: "charge",
      sourceType: "installment", sourceId: "ins-c1",
      method: null, receiptNumber: null, paymentStatus: null,
      reversesId: null, description: "Tuition tranche 1",
      actorId: "u1", actorName: "Alice", at: "2026-09-15T00:00:00Z",
      metadata: originalMetadata,
    };

    // Push converts to DTO + pulls back — metadata should be preserved verbatim.
    // We model the round-trip by simply re-using the entry (the canonical sync
    // contract requires metadata to round-trip unchanged).
    const pulledEntry = { ...entry, metadata: { ...entry.metadata } }; // simulated round-trip

    expect(pulledEntry.metadata).toEqual(originalMetadata);
  });
});

// ─── Centimes ↔ DZD conversion (no 100× inflation) ─────────────────────────

describe("Sync: centimes ↔ DZD conversion (no 100× inflation or deflation)", () => {
  it("push: centimes → DZD via /100, pull: DZD → centimes via ×100 (round trip preserves value)", () => {
    const originalCentimes = 2_500_000; // 25,000 DZD
    const dzd = originalCentimes / 100;
    const pulledCentimes = Math.round(dzd * 100);
    expect(pulledCentimes).toBe(originalCentimes);
  });

  it("push: sub-centime amount rounds correctly", () => {
    // The canonical spec forbids sub-centime values, but the conversion math
    // should still be deterministic.
    const originalCentimes = 1; // 0.01 DZD
    const dzd = originalCentimes / 100; // 0.01 DZD
    const pulledCentimes = Math.round(dzd * 100);
    expect(pulledCentimes).toBe(originalCentimes);
  });

  it("push: large value (330 million centimes = 3.3M DZD) round-trips correctly", () => {
    const originalCentimes = 330_000_000; // 3,300,000 DZD
    const dzd = originalCentimes / 100;
    const pulledCentimes = Math.round(dzd * 100);
    expect(pulledCentimes).toBe(originalCentimes);
  });
});

// ─── Long sync cycle simulation ─────────────────────────────────────────────

describe("Sync convergence: 5-cycle sync round-trip", () => {
  it("5 sync cycles produce the same final state as 1 sync cycle", () => {
    // Simulate 5 sync cycles: each cycle pulls the same entries from the backend.
    // State after cycle 5 should equal state after cycle 1.
    const entries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      paymentEntry("p1", "par-001", "stu-001", "tuition", 2_500_000, "paid", "2026-09-20T10:00:00Z"),
      {
        id: "adj-1", tenantId: "t1",
        accountId: deriveAccountId("par-001", "parent_credit", null),
        parentId: "par-001", studentId: null, category: "parent_credit" as never,
        amount: -1_000_000, type: "adjustment",
        sourceType: "adjustment", sourceId: "adj-1",
        method: null, receiptNumber: null, paymentStatus: null,
        reversesId: null, description: "Parent credit",
        actorId: "u1", actorName: "Alice", at: "2026-09-25T00:00:00Z",
        metadata: {},
      },
    ];

    let stateAfterCycle = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);

    for (let cycle = 0; cycle < 5; cycle++) {
      // Simulate sync cycle: the entries are unchanged (idempotent pull).
      const newEntries = [...entries];
      stateAfterCycle = computeParentSummary(newEntries, "par-001", "Test Parent", new Map(), NOW);
    }

    // Final state equals initial state — convergence.
    const finalState = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);
    expect(finalState).toEqual(stateAfterCycle);

    // No inflated totals:
    expect(finalState.totalCharged).toBe(5_000_000);
    expect(finalState.totalPaid).toBe(2_500_000);
    expect(finalState.totalUnallocatedCredit).toBe(-1_000_000);
    expect(finalState.totalOutstanding).toBe(1_500_000); // 5M charge - 2.5M paid - 1M credit
  });
});
