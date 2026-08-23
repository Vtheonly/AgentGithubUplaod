/**
 * Property-Based Scenario Generator.
 *
 * Generates a large number of canonical scenarios with deterministic
 * seeds so both runners can consume the same generated scenarios.
 *
 * Strategy:
 *   - Use a seeded PRNG (mulberry32) so the same seed produces the
 *     same scenarios on every run.
 *   - Generate scenarios across all categories: payment, overpayment,
 *     refund, discount, reconcile, boundary, complex_sequence.
 *   - Vary parameters: amountDue, paymentAmount, refundAmount, discounts,
 *     paymentStatus, originalWasPending, number of installments.
 *   - Include boundary values: 0, 1, max-1, max, max+1.
 *
 * Output: writes N scenarios to `generated/gen_<seed>_<i>.json`.
 *
 * Usage:
 *   npx tsx generators/scenario_generator.ts --count=1000 --seed=42
 *   npx tsx generators/scenario_generator.ts --count=500 --seed=98765 --boundary
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ───────────────────────────────────────────────────────────────────────────
// Seeded PRNG — mulberry32. Deterministic, fast, good distribution.
// Same seed → same sequence on every platform (works in JS and Kotlin).
// ───────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Scenario builders — generate scenarios by category.
// ───────────────────────────────────────────────────────────────────────────

interface GeneratedScenario {
  id: string;
  description: string;
  category: string;
  tags: string[];
  given: Record<string, unknown>;
  when: Record<string, unknown>;
  then?: Record<string, unknown>;
}

const CATEGORIES = ["payment", "overpayment", "refund_cleared", "refund_pending", "discount", "reconcile", "boundary", "multi_tranche"] as const;
type Category = typeof CATEGORIES[number];

const PAYMENT_METHODS = ["cash", "check", "transfer"];
const PAYMENT_STATUSES = ["paid", "pending"];
const CATEGORIES_LIST = ["tuition", "transport", "canteen", "uniform"];
const GRADE_LEVELS = ["1ap", "2ap", "3ap", "4ap", "5ap", "1am", "2am", "3am", "4am", "1ere_annee"];

const BOUNDARY_AMOUNTS = [0, 1, 100, 99, 1_000_000, 99_999_999, 100_000_000, 1_000_000_00];   // centimes
const NORMAL_AMOUNTS = [
  1_000_000, 2_500_000, 5_000_000, 7_500_000, 10_000_000, 15_000_000,
  20_000_000, 25_000_000, 33_000_000, 50_000_000, 75_000_000, 100_000_000,
  150_000_000, 200_000_000, 250_000_000, 330_000_000,
];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickAmount(rng: () => number, boundary: boolean): number {
  if (boundary && rng() < 0.3) {
    // CANONICAL STATE VALIDITY: ledger amounts must be non-zero (SQL CHECK
    // `amount <> 0` + the entry factories' invariants). Zero / negative
    // ledger amounts are IMPOSSIBLE canonical states — clamp to the smallest
    // valid magnitude (zero PAYMENT amounts are still generated deliberately
    // to exercise the amount > 0 operation validation).
    const raw = pick(rng, BOUNDARY_AMOUNTS);
    return Math.max(1, Math.abs(raw));
  }
  return pick(rng, NORMAL_AMOUNTS);
}

function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString();
}

function generatePaymentScenario(rng: () => number, idx: number, boundary: boolean): GeneratedScenario {
  const amountDue = pickAmount(rng, boundary);
  const paymentAmount = pickAmount(rng, boundary);
  const method = pick(rng, PAYMENT_METHODS);
  const status = method === "cash" ? "paid" : pick(rng, PAYMENT_STATUSES);
  const category = pick(rng, CATEGORIES_LIST);

  return {
    id: `gen_payment_${String(idx).padStart(4, "0")}`,
    description: `Generated payment scenario: ${paymentAmount / 100} DZD ${method} (${status}) against ${amountDue / 100} DZD ${category} charge.`,
    category: "waterfall",
    tags: ["generated", "payment", method, status],
    given: {
      tenantId: "t1",
      parent: { id: "par-gen", name: "Generated Parent" },
      students: [{ id: "stu-gen", parentId: "par-gen", gradeLevel: pick(rng, GRADE_LEVELS), paymentPlan: "tranches" }],
      ledgerEntries: [{
        id: "led-1", parentId: "par-gen", studentId: "stu-gen",
        category, amount: amountDue, type: "charge",
        sourceType: "installment", sourceId: "ins-1",
        actorId: "u1", actorName: "Alice",
        at: isoDate(-30), description: "Generated charge",
      }],
      installments: [{
        id: "ins-1", parentId: "par-gen", studentId: "stu-gen",
        category, label: "T1",
        amountDue, amountPaid: 0, amountPending: 0,
        dueDate: isoDate(60).slice(0, 10), status: "unpaid",
      }],
      payments: [],
      academicYearStartYear: 2025,
    },
    when: {
      type: "allocatePayment",
      paymentAmount, category, paymentStatus: status, paymentId: `pay-gen-${idx}`,
    },
  };
}

function generateOverpaymentScenario(rng: () => number, idx: number): GeneratedScenario {
  const amountDue = pick(rng, [1_000_000, 5_000_000, 10_000_000, 33_000_000]);
  // Always overpay by a random amount.
  const overpaymentAmount = pick(rng, [100, 1_000, 50_000, 500_000, 5_000_000]);
  const paymentAmount = amountDue + overpaymentAmount;
  const category = pick(rng, CATEGORIES_LIST);

  return {
    id: `gen_overpayment_${String(idx).padStart(4, "0")}`,
    description: `Generated overpayment: ${paymentAmount / 100} DZD against ${amountDue / 100} DZD ${category} — should produce ${overpaymentAmount / 100} DZD parent_credit.`,
    category: "overpayment",
    tags: ["generated", "overpayment", "parent_credit"],
    given: {
      tenantId: "t1",
      parent: { id: "par-gen", name: "Generated Parent" },
      students: [{ id: "stu-gen", parentId: "par-gen", gradeLevel: "1ap", paymentPlan: "tranches" }],
      ledgerEntries: [{
        id: "led-1", parentId: "par-gen", studentId: "stu-gen",
        category, amount: amountDue, type: "charge",
        sourceType: "installment", sourceId: "ins-1",
        actorId: "u1", actorName: "Alice",
        at: isoDate(-30), description: "Generated charge",
      }],
      installments: [{
        id: "ins-1", parentId: "par-gen", studentId: "stu-gen",
        category, label: "T1",
        amountDue, amountPaid: 0, amountPending: 0,
        dueDate: isoDate(60).slice(0, 10), status: "unpaid",
      }],
      payments: [],
      academicYearStartYear: 2025,
    },
    when: {
      type: "allocatePayment",
      paymentAmount, category, paymentStatus: "paid", paymentId: `pay-gen-${idx}`,
    },
    // Note: no `then` block — for generated scenarios, we only verify
    // desktop == android (cross-platform equivalence). The hand-crafted
    // scenarios in scenarios/ carry canonical expected values.
  };
}

function generateRefundScenario(rng: () => number, idx: number, originalWasPending: boolean): GeneratedScenario {
  const amountDue = pick(rng, [10_000_000, 33_000_000, 50_000_000]);
  const initialPayment = amountDue;   // pay in full first
  const refundAmount = pick(rng, [100, 1_000, 50_000, Math.floor(amountDue / 2), amountDue]);

  return {
    id: `gen_refund_${originalWasPending ? "pending" : "cleared"}_${String(idx).padStart(4, "0")}`,
    description: `Generated refund: ${refundAmount / 100} DZD refund of ${originalWasPending ? "PENDING" : "CLEARED"} payment of ${initialPayment / 100} DZD against ${amountDue / 100} DZD tuition.`,
    category: "lifo_reversal",
    tags: ["generated", "refund", originalWasPending ? "pending" : "cleared"],
    given: {
      tenantId: "t1",
      parent: { id: "par-gen", name: "Generated Parent" },
      students: [{ id: "stu-gen", parentId: "par-gen", gradeLevel: "1ap", paymentPlan: "tranches" }],
      ledgerEntries: [{
        id: "led-1", parentId: "par-gen", studentId: "stu-gen",
        category: "tuition", amount: amountDue, type: "charge",
        sourceType: "installment", sourceId: "ins-1",
        actorId: "u1", actorName: "Alice",
        at: isoDate(-30), description: "Generated charge",
      }],
      installments: [{
        id: "ins-1", parentId: "par-gen", studentId: "stu-gen",
        category: "tuition", label: "T1",
        amountDue,
        amountPaid: originalWasPending ? 0 : initialPayment,
        amountPending: originalWasPending ? initialPayment : 0,
        dueDate: isoDate(60).slice(0, 10),
        status: originalWasPending ? "pending_clearance" : "paid",
        paidDate: originalWasPending ? null : isoDate(-15).slice(0, 10),
      }],
      payments: [],
      academicYearStartYear: 2025,
    },
    when: {
      type: "revertPaymentAllocation",
      reversalAmount: refundAmount,
      category: "tuition",
      originalWasPending,
    },
  };
}

function generateDiscountScenario(rng: () => number, idx: number): GeneratedScenario {
  const grossTuition = pick(rng, [10_000_000, 20_000_000, 33_000_000, 50_000_000, 100_000_000]);
  const childIndex = 1 + Math.floor(rng() * 4);   // 1-4
  const previousGradeLevel = rng() < 0.5 ? "5ap" : (rng() < 0.5 ? "4am" : null);
  const currentGradeLevel = previousGradeLevel === "5ap" ? "1am" : (previousGradeLevel === "4am" ? "1ere_annee" : pick(rng, GRADE_LEVELS));
  const paymentPlan = rng() < 0.3 ? "full_annual" : "tranches";
  const paymentDate = rng() < 0.5 ? "2025-06-15T10:00:00Z" : "2026-09-15T10:00:00Z";
  const previousRank = rng() < 0.4 ? 1 : null;
  const enrollmentDate = rng() < 0.5 ? "2019-09-01T00:00:00Z" : "2024-09-01T00:00:00Z";

  return {
    id: `gen_discount_${String(idx).padStart(4, "0")}`,
    description: `Generated discount scenario: gross=${grossTuition / 100} DZD, child=${childIndex}, plan=${paymentPlan}, prevGrade=${previousGradeLevel}, rank=${previousRank ?? "n/a"}.`,
    category: "discount_engine",
    tags: ["generated", "discount"],
    given: {
      tenantId: "t1",
      parent: { id: "par-gen", name: "Generated Parent" },
      students: [], ledgerEntries: [], installments: [], payments: [],
      academicYearStartYear: 2025,
    },
    when: {
      type: "evaluateAllSystemDiscounts",
      discountParams: {
        grossTuition,
        previousGradeLevel,
        currentGradeLevel,
        childIndex,
        paymentPlan,
        paymentDate,
        academicYearStartYear: 2025,
        academicYearStart: "2025-09-01T00:00:00Z",
        enrollmentDate,
        previousRank,
      },
    },
  };
}

function generateReconcileScenario(rng: () => number, idx: number): GeneratedScenario {
  // Generate a ledger with a random mix of entries.
  const entries: unknown[] = [];
  const installments: unknown[] = [];
  const numCharges = 1 + Math.floor(rng() * 3);
  let totalCharged = 0;
  for (let i = 0; i < numCharges; i++) {
    const amount = pick(rng, [1_000_000, 5_000_000, 10_000_000]);
    entries.push({
      id: `led-c-${i}`, parentId: "par-gen", studentId: "stu-gen",
      category: "tuition", amount, type: "charge",
      sourceType: "installment", sourceId: `ins-${i}`,
      actorId: "u1", actorName: "Alice",
      at: isoDate(-30 - i), description: `Charge ${i}`,
    });
    installments.push({
      id: `ins-${i}`, parentId: "par-gen", studentId: "stu-gen",
      category: "tuition", label: `T${i}`,
      amountDue: amount, amountPaid: 0, amountPending: 0,
      dueDate: isoDate(60).slice(0, 10), status: "unpaid",
    });
    totalCharged += amount;
  }
  const numPayments = Math.floor(rng() * 3);
  for (let i = 0; i < numPayments; i++) {
    const amount = pick(rng, [500_000, 1_000_000, 2_500_000]);
    const status = rng() < 0.7 ? "paid" : "pending";
    entries.push({
      id: `led-p-${i}`, parentId: "par-gen", studentId: "stu-gen",
      category: "tuition", amount: -amount, type: "payment",
      sourceType: "payment", sourceId: `pay-${i}`,
      method: "cash", receiptNumber: `REC-${i}`,
      paymentStatus: status,
      actorId: "u1", actorName: "Alice",
      at: isoDate(-15 + i), description: `Payment ${i}`,
    });
  }

  return {
    id: `gen_reconcile_${String(idx).padStart(4, "0")}`,
    description: `Generated reconcile scenario: ${numCharges} charges + ${numPayments} payments on tuition account.`,
    category: "reconcile",
    tags: ["generated", "reconcile"],
    given: {
      tenantId: "t1",
      parent: { id: "par-gen", name: "Generated Parent" },
      students: [{ id: "stu-gen", parentId: "par-gen", gradeLevel: "1ap", paymentPlan: "tranches" }],
      ledgerEntries: entries,
      installments,
      payments: [],
      academicYearStartYear: 2025,
    },
    when: {
      type: "reconcileLedger",
      includePayments: false,
      includeInstallments: true,
      includeParentSummaries: false,
    },
  };
}

function generateBoundaryScenario(rng: () => number, idx: number): GeneratedScenario {
  // Test boundary amounts aggressively.
  // CANONICAL STATE VALIDITY: a ledger charge amount must be > 0 (SQL CHECK
  // `amount <> 0` + createChargeEntry invariant) — clamp zero to 1 centime so
  // the generated INITIAL STATE is seedable on the backend.
  const amountDue = Math.max(1, pick(rng, BOUNDARY_AMOUNTS));
  const paymentAmount = pick(rng, [
    0, 1, amountDue - 1, amountDue, amountDue + 1, amountDue + 100,
  ]);

  return {
    id: `gen_boundary_${String(idx).padStart(4, "0")}`,
    description: `Generated boundary scenario: payment=${paymentAmount} centimes against amountDue=${amountDue} centimes.`,
    category: "boundary",
    tags: ["generated", "boundary"],
    given: {
      tenantId: "t1",
      parent: { id: "par-gen", name: "Generated Parent" },
      students: [{ id: "stu-gen", parentId: "par-gen", gradeLevel: "1ap", paymentPlan: "tranches" }],
      ledgerEntries: [{
        id: "led-1", parentId: "par-gen", studentId: "stu-gen",
        category: "tuition", amount: amountDue, type: "charge",
        sourceType: "installment", sourceId: "ins-1",
        actorId: "u1", actorName: "Alice",
        at: isoDate(-30), description: "Boundary charge",
      }],
      installments: [{
        id: "ins-1", parentId: "par-gen", studentId: "stu-gen",
        category: "tuition", label: "T1",
        amountDue, amountPaid: 0, amountPending: 0,
        dueDate: isoDate(60).slice(0, 10), status: "unpaid",
      }],
      payments: [],
      academicYearStartYear: 2025,
    },
    when: {
      type: "allocatePayment",
      paymentAmount, category: "tuition", paymentStatus: "paid", paymentId: `pay-bnd-${idx}`,
    },
  };
}

function generateMultiTrancheScenario(rng: () => number, idx: number): GeneratedScenario {
  const numTranches = 1 + Math.floor(rng() * 3);   // 1-3
  const trancheAmount = pick(rng, [1_000_000, 2_500_000, 5_000_000]);
  const paymentAmount = trancheAmount * (0.5 + rng() * 2.5);   // 0.5x to 3x tranche

  const entries: unknown[] = [];
  const installments: unknown[] = [];
  for (let i = 0; i < numTranches; i++) {
    entries.push({
      id: `led-${i}`, parentId: "par-gen", studentId: "stu-gen",
      category: "tuition", amount: trancheAmount, type: "charge",
      sourceType: "installment", sourceId: `ins-${i}`,
      actorId: "u1", actorName: "Alice",
      at: isoDate(-30 - i * 10), description: `T${i + 1}`,
    });
    installments.push({
      id: `ins-${i}`, parentId: "par-gen", studentId: "stu-gen",
      category: "tuition", label: `T${i + 1}`,
      amountDue: trancheAmount, amountPaid: 0, amountPending: 0,
      dueDate: isoDate(60 + i * 90).slice(0, 10), status: "unpaid",
    });
  }

  return {
    id: `gen_multi_tranche_${String(idx).padStart(4, "0")}`,
    description: `Generated multi-tranche scenario: ${numTranches} tranches of ${trancheAmount / 100} DZD each, payment ${Math.round(paymentAmount) / 100} DZD.`,
    category: "waterfall",
    tags: ["generated", "multi_tranche"],
    given: {
      tenantId: "t1",
      parent: { id: "par-gen", name: "Generated Parent" },
      students: [{ id: "stu-gen", parentId: "par-gen", gradeLevel: "1am", paymentPlan: "tranches" }],
      ledgerEntries: entries,
      installments,
      payments: [],
      academicYearStartYear: 2025,
    },
    when: {
      type: "allocatePayment",
      paymentAmount: Math.round(paymentAmount), category: "tuition", paymentStatus: "paid",
      paymentId: `pay-mt-${idx}`,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Main — generate N scenarios with a seed, write to generated/.
// ───────────────────────────────────────────────────────────────────────────

function generate(count: number, seed: number, boundary: boolean, outputDir: string): void {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const rng = mulberry32(seed);
  const categoryBuilders: Array<(rng: () => number, idx: number) => GeneratedScenario> = [
    (r, i) => generatePaymentScenario(r, i, boundary),
    (r, i) => generateOverpaymentScenario(r, i),
    (r, i) => generateRefundScenario(r, i, false),
    (r, i) => generateRefundScenario(r, i, true),
    (r, i) => generateDiscountScenario(r, i),
    (r, i) => generateReconcileScenario(r, i),
    (r, i) => generateBoundaryScenario(r, i),
    (r, i) => generateMultiTrancheScenario(r, i),
  ];

  let generated = 0;
  for (let i = 0; i < count; i++) {
    const builder = categoryBuilders[i % categoryBuilders.length];
    const scenario = builder(rng, i);
    const file = path.join(outputDir, `${scenario.id}.json`);
    fs.writeFileSync(file, JSON.stringify(scenario, null, 2));
    generated++;
  }
  console.log(`Generated ${generated} scenarios with seed=${seed}, boundary=${boundary}`);
  console.log(`Output: ${outputDir}`);
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const countArg = args.find((a) => a.startsWith("--count="));
const seedArg = args.find((a) => a.startsWith("--seed="));
const boundaryArg = args.includes("--boundary");

const count = countArg ? parseInt(countArg.split("=")[1], 10) : 1000;
const seed = seedArg ? parseInt(seedArg.split("=")[1], 10) : 42;
const outputDir = path.resolve(__dirname, "..", "generated");

generate(count, seed, boundaryArg, outputDir);
