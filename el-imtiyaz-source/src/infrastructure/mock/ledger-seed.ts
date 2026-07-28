/**
 * Ledger seed data — iteration 5.
 *
 * Generates immutable LedgerEntry records for the seeded parents and
 * students. Every charge (tuition tranche, transport) and every payment
 * in `seed-data.ts` produces a corresponding ledger entry.
 *
 * This is the SINGLE SOURCE OF TRUTH for the school's financial state.
 * The mock DebtRepository and DashboardRepository now compute balances
 * by REPLAYING these entries — they no longer read from hardcoded arrays.
 */
import type { LedgerEntry } from "../../domain/model/ledger";
import {
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  deriveAccountId,
} from "../../domain/model/ledger";
import { tuitionForLevel, transportForTier, tuitionTranches, applyDiscount, type PricingConfig } from "../../domain/model/pricing";
import type { Payment } from "../../domain/model/payment";
import {
  TENANT_ID,
  ACADEMIC_YEAR,
  SEED_NOW,
  seedParents,
  seedStudents,
  seedPayments,
} from "./seed-data";
import { defaultPricingConfig } from "./pricing-seed";

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(SEED_NOW.getTime() - n * 86_400_000));
const daysFromNow = (n: number) => iso(new Date(SEED_NOW.getTime() + n * 86_400_000));

const config: PricingConfig = defaultPricingConfig;

/**
 * Tranche due dates for the academic year 2025-2026.
 * Tranche 1: start of year (Sept)
 * Tranche 2: mid-year (Dec)
 * Tranche 3: end of year (Mar)
 */
const trancheDueDates: [string, string, string] = [
  "2025-09-15", // T1
  "2025-12-15", // T2
  "2026-03-15", // T3
];

let entryCounter = 0;
function nextEntryId(): string {
  entryCounter++;
  return `led-2025-${String(entryCounter).padStart(6, "0")}`;
}

/**
 * Generate the seed ledger. Called once at module load.
 */
export function buildSeedLedger(): LedgerEntry[] {
  const entries: LedgerEntry[] = [];

  // 1. For each parent + student: generate tuition tranches + transport.
  for (const parent of seedParents) {
    const students = seedStudents.filter((s) => s.parentId === parent.id);
    for (const student of students) {
      // Tuition tranches (3 per student per academic year).
      const tuition = tuitionForLevel(config, student.level);
      const tranches = tuitionTranches(tuition);
      // Apply sibling discount if parent has > 1 child:
      // - 2nd child: 10% off (sibling_10)
      // - 3rd+: 15% off (sibling_15)
      const siblingDiscount = students.length >= 3
        ? config.discounts.find((d) => d.qualifier === "sibling_15")
        : students.length === 2
          ? config.discounts.find((d) => d.qualifier === "sibling_10")
          : null;
      const childIndex = students.findIndex((s) => s.id === student.id);

      tranches.forEach((tranche, i) => {
        let amount = tranche.amountDue;
        if (siblingDiscount && siblingDiscount.discountType && childIndex >= 1) {
          amount = applyDiscount(amount, { amount: siblingDiscount.amount, discountType: siblingDiscount.discountType });
        }
        const dueDate = trancheDueDates[i];
        entries.push(createChargeEntry({
          tenantId: TENANT_ID,
          parentId: parent.id,
          studentId: student.id,
          category: "tuition",
          amount,
          sourceType: "installment",
          sourceId: `ins-${parent.id}-${student.id}-t${i + 1}`,
          description: `Scolarité ${ACADEMIC_YEAR} — Tranche ${i + 1} (${student.firstName} ${student.lastName}, ${student.level})`,
          actorId: "usr-adm-001",
          actorName: "Brahim Souilah",
          at: daysAgo(60),
          metadata: {
            tranche: i + 1,
            level: student.level,
            baseAmount: tuition,
            siblingDiscountApplied: siblingDiscount && childIndex >= 1 ? siblingDiscount.qualifier : null,
          },
        }));
      });

      // Transport fee (one charge per student per year, due T1).
      const tier = student.transportTier;
      if (tier === "t1" || tier === "t2" || tier === "t3") {
        const transportAmount = transportForTier(config, tier);
        entries.push(createChargeEntry({
          tenantId: TENANT_ID,
          parentId: parent.id,
          studentId: student.id,
          category: "transport",
          amount: transportAmount,
          sourceType: "installment",
          sourceId: `ins-${parent.id}-${student.id}-transport`,
          description: `Transport ${ACADEMIC_YEAR} — Zone ${tier.toUpperCase()} (${student.firstName})`,
          actorId: "usr-adm-001",
          actorName: "Brahim Souilah",
          at: daysAgo(60),
          metadata: { tier },
        }));
      }
    }
  }

  // 2. For each payment: create a corresponding ledger entry.
  for (const payment of seedPayments) {
    const status = payment.status;
    entries.push(createPaymentEntry({
      tenantId: TENANT_ID,
      parentId: payment.parentId,
      studentId: payment.studentId,
      category: payment.category,
      amount: payment.amount,
      method: payment.method,
      receiptNumber: payment.receiptNumber,
      paymentStatus: status,
      sourceType: "payment",
      sourceId: payment.id,
      description: `Encaissement ${payment.receiptNumber} — ${payment.method} (${payment.category})`,
      actorId: payment.collectedBy,
      actorName: "Session courante",
      at: payment.collectedAt,
      metadata: {
        installmentId: payment.installmentId ?? null,
        proofUrl: payment.proofUrl ?? null,
      },
    }));
  }

  // 3. A few discretionary adjustments to demonstrate the adjustment flow.
  entries.push(createAdjustmentEntry({
    tenantId: TENANT_ID,
    parentId: "par-003",
    studentId: null,
    category: "tuition",
    amount: -5000, // credit: hardship waiver
    reason: "Aide sociale — remise partielle (décision direction)",
    sourceType: "adjustment",
    sourceId: "adj-001",
    actorId: "usr-adm-001",
    actorName: "Brahim Souilah",
    at: daysAgo(30),
    metadata: { decisionId: "DEC-2025-008" },
  }));

  entries.push(createAdjustmentEntry({
    tenantId: TENANT_ID,
    parentId: "par-005",
    studentId: null,
    category: "tuition",
    amount: 2000, // debit: late penalty
    reason: "Pénalité retard — 20 jours × 100 DZD/jour",
    sourceType: "adjustment",
    sourceId: "adj-002",
    actorId: "usr-fin-001",
    actorName: "Fatima Belkacem (Fin)",
    at: daysAgo(10),
    metadata: { daysLate: 20, ratePerDay: 100 },
  }));

  // 4. Assign deterministic IDs.
  return entries.map((e, i) => ({
    ...e,
    id: `led-2025-${String(i + 1).padStart(6, "0")}`,
    accountId: deriveAccountId(e.parentId, e.category, e.studentId),
  }));
}

export const seedLedger: LedgerEntry[] = buildSeedLedger();

// Re-export for convenience.
export { deriveAccountId };
