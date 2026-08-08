/**
 * Ledger seed data — iteration 5 (updated iteration 6 for new pricing model).
 *
 * Generates immutable LedgerEntry records for the seeded parents and
 * students. Every charge (tuition tranche, transport) and every payment
 * in `seed-data.ts` produces a corresponding ledger entry.
 *
 * This is the SINGLE SOURCE OF TRUTH for the school's financial state.
 * The mock DebtRepository and DashboardRepository now compute balances
 * by REPLAYING these entries — they no longer read from hardcoded arrays.
 *
 * Iteration 6: Tuition is now derived from the per-grade-level pricing
 * (`tuitionByGradeLevel`) using the granular 3-tranche schedule. Transport
 * is now derived from the per-destination pricing (`transportByDestination`)
 * using the destination's own 3-tranche schedule. Sibling discounts use the
 * new `sibling_fixed` code (−5 000 DA per additional child).
 */
import type { LedgerEntry } from "../../domain/model/ledger";
import {
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  deriveAccountId,
} from "../../domain/model/ledger";
import {
  tuitionForGradeLevel,
  tuitionTranchesForGrade,
  transportForDestination,
  transportTranchesForDestination,
  applyDiscount,
  type PricingConfig,
} from "../../domain/model/pricing";
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
import { cityTierToDestination } from "../../domain/model/parent";

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

/**
 * Transport tranche due dates — distinct from tuition:
 *   Tranche 1: due at registration
 *   Tranche 2: Dec 01–15
 *   Tranche 3: Mar 01–15
 */
const transportTrancheDueDates: [string, string, string] = [
  "2025-09-15",
  "2025-12-15",
  "2026-03-15",
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

  // 1. For each parent + student: generate tuition tranches + transport tranches.
  for (const parent of seedParents) {
    const students = seedStudents.filter((s) => s.parentId === parent.id);
    // Iteration 6: use the sibling_fixed discount (−5 000 DA per additional child).
    // Applied to all children except the first.
    const siblingDiscount = students.length > 1
      ? config.discounts.find((d) => d.discountCode === "sibling_fixed")
      : null;

    for (const student of students) {
      const childIndex = students.findIndex((s) => s.id === student.id);

      // Tuition tranches (3 per student per academic year) — uses the
      // granular per-grade-level pricing.
      const tuition = tuitionForGradeLevel(config, student.gradeLevel).annualAmount;
      const tranches = tuitionTranchesForGrade(config, student.gradeLevel);

      tranches.forEach((tranche, i) => {
        let amount = tranche.amountDue;
        // Apply sibling_fixed discount to all children except the first.
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
          description: `Scolarité ${ACADEMIC_YEAR} — Tranche ${i + 1} (${student.firstName} ${student.lastName}, ${student.gradeLevel})`,
          actorId: "usr-adm-001",
          actorName: "Brahim Souilah",
          at: daysAgo(60),
          metadata: {
            tranche: i + 1,
            gradeLevel: student.gradeLevel,
            level: student.level,
            baseAmount: tuition,
            siblingDiscountApplied: siblingDiscount && childIndex >= 1 ? (siblingDiscount.discountCode ?? null) : null,
          },
        }));
      });

      // Transport fee — uses per-destination 3-tranche schedule if the parent
      // has a transport destination; falls back to legacy tier-based single
      // charge if only `transportTier` is set on the student.
      const destination = parent.transportDestination;
      if (destination) {
        const transportTranches = transportTranchesForDestination(config, destination);
        transportTranches.forEach((tranche, i) => {
          entries.push(createChargeEntry({
            tenantId: TENANT_ID,
            parentId: parent.id,
            studentId: student.id,
            category: "transport",
            amount: tranche.amountDue,
            sourceType: "installment",
            sourceId: `ins-${parent.id}-${student.id}-transport-t${i + 1}`,
            description: `Transport ${ACADEMIC_YEAR} — Tranche ${i + 1} (${student.firstName}, ${destination})`,
            actorId: "usr-adm-001",
            actorName: "Brahim Souilah",
            at: daysAgo(60),
            metadata: { tranche: i + 1, destination },
          }));
        });
      } else {
        // Legacy fallback — single transport charge based on student.transportTier.
        const tier = student.transportTier;
        if (tier === "t1" || tier === "t2" || tier === "t3") {
          // Best-effort: derive destination from tier for the lookup.
          const fallbackDestination = cityTierToDestination(tier);
          if (fallbackDestination) {
            const annualAmount = transportForDestination(config, fallbackDestination).annualAmount;
            entries.push(createChargeEntry({
              tenantId: TENANT_ID,
              parentId: parent.id,
              studentId: student.id,
              category: "transport",
              amount: annualAmount,
              sourceType: "installment",
              sourceId: `ins-${parent.id}-${student.id}-transport`,
              description: `Transport ${ACADEMIC_YEAR} — Zone ${tier.toUpperCase()} (${student.firstName})`,
              actorId: "usr-adm-001",
              actorName: "Brahim Souilah",
              at: daysAgo(60),
              metadata: { tier, destination: fallbackDestination },
            }));
          }
        }
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
  // (Backing payments for paid installments are now generated in seed-data.ts
  //  as part of `seedPayments`, so step 2 above already creates their ledger
  //  entries naturally — no synthetic ledger-only entries needed here.)
  return entries.map((e, i) => ({
    ...e,
    id: `led-2025-${String(i + 1).padStart(6, "0")}`,
    accountId: deriveAccountId(e.parentId, e.category, e.studentId),
  }));
}

export const seedLedger: LedgerEntry[] = buildSeedLedger();

// Re-export for convenience.
export { deriveAccountId };
