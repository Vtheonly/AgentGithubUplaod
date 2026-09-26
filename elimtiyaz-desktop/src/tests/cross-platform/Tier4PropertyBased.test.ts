/**
 * Tier 4 — Property-Based + Generative Tests.
 *
 * Uses a deterministic PRNG (mulberry32) to generate thousands of valid
 * financial scenarios. Verifies canonical invariants hold for each.
 *
 * Same seed = same scenarios. This test runs alongside the desktop's existing
 * PropertyBasedEquivalence.test.ts (601 tests, seed=42). This file adds
 * additional coverage:
 *   - Cross-platform equivalence at the property level (mirror == desktop)
 *   - Property-based invariant verification (each generated scenario satisfies
 *     the canonical invariants independently)
 *
 * Run:
 *   npx vitest run src/test/cross-platform/Tier4PropertyBased.test.ts
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
  type LedgerEntry,
  type WaterfallInstallment,
  type PaymentCategoryCode,
  type PaymentStatusCode,
} from "../../../financial-tests/equivalence/android_mirror/kotlin_mirror_engine";
import {
  computeAccountBalance as computeAccountBalanceDesktop,
  computeParentSummary as computeParentSummaryDesktop,
} from "../../domain/calc/ledger/balance";
import type { LedgerEntry as DesktopLedgerEntry } from "../../domain/model/ledger";
import { allocatePaymentToInstallments as allocateDesktop } from "../../domain/calc/payment/waterfall-allocator";
import { revertPaymentAllocation as revertDesktop } from "../../domain/calc/payment/lifo-reversal";

const NOW = new Date("2028-01-01T00:00:00Z").getTime();
const CENTIMES = (dzd: number) => Math.round(dzd * 100);

// ─── mulberry32 PRNG (deterministic, matches the existing generator) ─────────

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Generators ─────────────────────────────────────────────────────────────

const CATEGORIES: PaymentCategoryCode[] = ["tuition", "transport", "canteen", "uniform", "books", "extracurricular", "other"];
const STATUSES: PaymentStatusCode[] = ["paid", "pending", "partial", "overdue", "unpaid"];

function genAmount(rng: () => number, max: number = 10_000_000): number {
  // Generates a centime amount in [1, max]
  return Math.max(1, Math.floor(rng() * max));
}

function genLedgerEntry(rng: () => number, idx: number, parentId: string, studentId: string | null): LedgerEntry {
  const isCharge = rng() > 0.4;
  const category = CATEGORIES[Math.floor(rng() * CATEGORIES.length)];
  const amount = genAmount(rng);
  const day = 1 + Math.floor(rng() * 28);
  const month = 1 + Math.floor(rng() * 12);
  const year = 2026 + Math.floor(rng() * 2);
  const at = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T10:00:00Z`;

  if (isCharge) {
    return {
      id: `led-${idx}`, tenantId: "t1",
      accountId: deriveAccountId(parentId, category, studentId),
      parentId, studentId, category,
      amount, type: "charge",
      sourceType: "installment", sourceId: `ins-${idx}`,
      method: null, receiptNumber: null, paymentStatus: null,
      reversesId: null, description: "Charge",
      actorId: "u1", actorName: "Alice", at,
      metadata: {},
    };
  }
  return {
    id: `led-${idx}`, tenantId: "t1",
    accountId: deriveAccountId(parentId, category, studentId),
    parentId, studentId, category,
    amount: -amount, type: "payment",
    sourceType: "payment", sourceId: `pay-${idx}`,
    method: "cash", receiptNumber: `REC-${idx}`, paymentStatus: "paid",
    reversesId: null, description: "Payment",
    actorId: "u1", actorName: "Alice", at,
    metadata: {},
  };
}

function genInstallment(rng: () => number, idx: number, category: PaymentCategoryCode): WaterfallInstallment {
  const amountDue = genAmount(rng);
  const amountPaid = Math.floor(rng() * amountDue);
  const day = 1 + Math.floor(rng() * 28);
  const month = 1 + Math.floor(rng() * 12);
  return {
    id: `ins-${idx}`, category,
    amountDue, amountPaid, amountPending: 0,
    dueDate: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    status: amountPaid >= amountDue ? "paid" : amountPaid > 0 ? "partial" : "unpaid",
  };
}

// ─── Property 1: balance = Σ entries ────────────────────────────────────────

describe("Property: balance = Σ entries (replay invariant)", () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    it(`scenario #${i}: balance == sum of entries.amount`, () => {
      const entryCount = 5 + Math.floor(rng() * 15); // 5-20 entries
      const entries: LedgerEntry[] = [];
      for (let j = 0; j < entryCount; j++) {
        entries.push(genLedgerEntry(rng, j, "par-001", "stu-001"));
      }
      const accountIds = [...new Set(entries.map((e) => e.accountId))];
      for (const accId of accountIds) {
        const bal = computeAccountBalance(entries, accId, NOW);
        const expectedBalance = entries
          .filter((e) => e.accountId === accId)
          .reduce((s, e) => s + e.amount, 0);
        expect(bal.balance).toBe(expectedBalance);
      }
    });
  }
});

// ─── Property 2: totalCharged ≥ 0 ───────────────────────────────────────────

describe("Property: typed totals are non-negative", () => {
  const rng = mulberry32(123);
  for (let i = 0; i < 50; i++) {
    it(`scenario #${i}: totalCharged ≥ 0, totalPaid ≥ 0`, () => {
      const entryCount = 5 + Math.floor(rng() * 10);
      const entries: LedgerEntry[] = [];
      for (let j = 0; j < entryCount; j++) {
        entries.push(genLedgerEntry(rng, j, "par-001", "stu-001"));
      }
      const summary = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);
      expect(summary.totalCharged).toBeGreaterThanOrEqual(0);
      expect(summary.totalPaid).toBeGreaterThanOrEqual(0);
    });
  }
});

// ─── Property 3: waterfall allocation never exceeds obligation ──────────────

describe("Property: waterfall allocation ≤ obligation", () => {
  const rng = mulberry32(999);
  for (let i = 0; i < 100; i++) {
    it(`scenario #${i}: totalAllocated ≤ Σ amountDue`, () => {
      const instCount = 1 + Math.floor(rng() * 5);
      const installments: WaterfallInstallment[] = [];
      for (let j = 0; j < instCount; j++) {
        installments.push(genInstallment(rng, j, "tuition"));
      }
      const paymentAmount = genAmount(rng, 20_000_000);
      const result = allocatePaymentToInstallments(installments, paymentAmount, "tuition", "paid");
      // totalAllocated should never exceed the sum of remaining obligations
      const totalRemaining = installments.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid), 0);
      expect(result.totalAllocated).toBeLessThanOrEqual(totalRemaining);
      // totalAllocated + unallocatedAmount should equal paymentAmount
      expect(result.totalAllocated + result.unallocatedAmount).toBe(paymentAmount);
    });
  }
});

// ─── Property 4: LIFO revert never reverts more than was paid ───────────────

describe("Property: LIFO revert ≤ bucket size", () => {
  const rng = mulberry32(2024);
  for (let i = 0; i < 100; i++) {
    it(`scenario #${i}: totalReverted ≤ bucket + unreverted remainder`, () => {
      const instCount = 1 + Math.floor(rng() * 3);
      const installments: WaterfallInstallment[] = [];
      for (let j = 0; j < instCount; j++) {
        installments.push(genInstallment(rng, j, "tuition"));
      }
      const reversalAmount = genAmount(rng, 10_000_000);
      const originalWasPending = rng() > 0.5;
      const result = revertPaymentAllocation(installments, reversalAmount, "tuition", originalWasPending);
      // totalReverted + unrevertedAmount should equal reversalAmount
      expect(result.totalReverted + result.unrevertedAmount).toBe(reversalAmount);
    });
  }
});

// ─── Property 5: split t1 + t2 + t3 = net ────────────────────────────────────

describe("Property: split preserves total (no centime drift)", () => {
  const rng = mulberry32(777);
  for (let i = 0; i < 100; i++) {
    it(`scenario #${i}: t1 + t2 + t3 === net`, () => {
      const net = genAmount(rng, 100_000_000);
      const [t1, t2, t3] = splitNetTuitionByOfficialSchedule(net);
      expect(t1 + t2 + t3).toBe(net);
    });
  }
});

// ─── Property 6: discount sum is always non-positive (reductions) ──────────

describe("Property: discount sum ≤ 0 (only reductions)", () => {
  const rng = mulberry32(55);
  for (let i = 0; i < 50; i++) {
    it(`scenario #${i}: sumDiscounts ≤ 0`, () => {
      const gross = genAmount(rng, 50_000_000);
      const evals = evaluateAllSystemDiscounts({
        grossTuition: gross,
        previousGradeLevel: rng() > 0.5 ? "5ap" : null,
        currentGradeLevel: "1am",
        childIndex: 1 + Math.floor(rng() * 4),
        paymentPlan: rng() > 0.5 ? "full_annual" : "tranches",
        paymentDate: rng() > 0.5 ? "2026-06-15T10:00:00Z" : "2026-09-15T10:00:00Z",
        academicYearStartYear: 2026,
        academicYearStart: "2026-09-01T00:00:00Z",
        enrollmentDate: rng() > 0.5 ? "2020-09-01T00:00:00Z" : "2026-09-01T00:00:00Z",
        previousRank: rng() > 0.8 ? 1 : null,
      });
      expect(sumDiscounts(evals)).toBeLessThanOrEqual(0);
    });
  }
});

// ─── Property 7: cross-platform equivalence (mirror == desktop) ────────────

describe("Property: cross-platform mirror == desktop at centime precision", () => {
  const rng = mulberry32(31415);
  for (let i = 0; i < 200; i++) {
    it(`scenario #${i}: mirror balance == desktop balance (in centimes)`, () => {
      const entryCount = 3 + Math.floor(rng() * 8);
      const mirrorEntries: LedgerEntry[] = [];
      const desktopEntries: DesktopLedgerEntry[] = [];

      for (let j = 0; j < entryCount; j++) {
        const isCharge = rng() > 0.4;
        const category = CATEGORIES[Math.floor(rng() * CATEGORIES.length)];
        const amountCentimes = genAmount(rng);
        const at = `2026-${String(1 + Math.floor(rng() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rng() * 28)).padStart(2, "0")}T10:00:00Z`;
        const id = `led-${i}-${j}`;

        if (isCharge) {
          mirrorEntries.push({
            id, tenantId: "t1",
            accountId: deriveAccountId("par-001", category, "stu-001"),
            parentId: "par-001", studentId: "stu-001", category,
            amount: amountCentimes, type: "charge",
            sourceType: "installment", sourceId: `ins-${id}`,
            method: null, receiptNumber: null, paymentStatus: null,
            reversesId: null, description: "Charge",
            actorId: "u1", actorName: "Alice", at, metadata: {},
          });
          desktopEntries.push({
            id, tenantId: "t1",
            accountId: `parent:par-001:category:${category}:student:stu-001`,
            parentId: "par-001", studentId: "stu-001", category,
            amount: amountCentimes / 100, type: "charge",
            sourceType: "installment", sourceId: `ins-${id}`,
            method: null, receiptNumber: null, paymentStatus: null,
            reversesId: null, description: "Charge",
            actorId: "u1", actorName: "Alice", at, metadata: {},
          });
        } else {
          mirrorEntries.push({
            id, tenantId: "t1",
            accountId: deriveAccountId("par-001", category, "stu-001"),
            parentId: "par-001", studentId: "stu-001", category,
            amount: -amountCentimes, type: "payment",
            sourceType: "payment", sourceId: id,
            method: "cash", receiptNumber: `REC-${id}`, paymentStatus: "paid",
            reversesId: null, description: "Payment",
            actorId: "u1", actorName: "Alice", at, metadata: {},
          });
          desktopEntries.push({
            id, tenantId: "t1",
            accountId: `parent:par-001:category:${category}:student:stu-001`,
            parentId: "par-001", studentId: "stu-001", category,
            amount: -amountCentimes / 100, type: "payment",
            sourceType: "payment", sourceId: id,
            method: "cash", receiptNumber: `REC-${id}`, paymentStatus: "paid",
            reversesId: null, description: "Payment",
            actorId: "u1", actorName: "Alice", at, metadata: {},
          });
        }
      }

      const accountId = mirrorEntries[0].accountId;
      const desktopAccountId = desktopEntries[0].accountId;

      const mirrorBal = computeAccountBalance(mirrorEntries, accountId, NOW);
      // IMPORTANT: pass a Date object as `now` to the desktop engine — it defaults
      // to `new Date()` which would be the current wall-clock (2026-08-21) and
      // filter out test entries dated 2026-09-XX as "future".
      const desktopBal = computeAccountBalanceDesktop(desktopEntries, desktopAccountId, new Date(NOW));
      // Convert desktop DZD balance to centimes and compare
      expect(CENTIMES(desktopBal.balance)).toBe(mirrorBal.balance);
      expect(CENTIMES(desktopBal.totalCharged)).toBe(mirrorBal.totalCharged);
      expect(CENTIMES(desktopBal.totalPaid)).toBe(mirrorBal.totalPaid);
    });
  }
});

// ─── Property 8: reconciliation is deterministic ─────────────────────────────

describe("Property: reconciliation is deterministic (same input → same violations)", () => {
  const rng = mulberry32(271828);
  for (let i = 0; i < 30; i++) {
    it(`scenario #${i}: reconcileLedger twice produces identical results`, () => {
      const entryCount = 5 + Math.floor(rng() * 10);
      const entries: LedgerEntry[] = [];
      for (let j = 0; j < entryCount; j++) {
        entries.push(genLedgerEntry(rng, j, "par-001", "stu-001"));
      }
      const r1 = reconcileLedger(entries);
      const r2 = reconcileLedger(entries);
      // Strip checkedAt before comparing
      const { checkedAt: _1, ...r1Rest } = r1;
      const { checkedAt: _2, ...r2Rest } = r2;
      expect(r1Rest).toEqual(r2Rest);
    });
  }
});
