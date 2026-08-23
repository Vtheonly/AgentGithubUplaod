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
 *
 * TIER 2 R17 (desktop) — fixed the per-tranche double-discount bug.
 * Previously the sibling discount was applied INSIDE the tranches.forEach
 * loop, so a 3-tranche student × −5,000 DZD per tranche = −15,000 DZD total
 * sibling discount, instead of the intended −5,000 DZD. The fix applies
 * discounts ONCE on the gross annual tuition via the canonical
 * `evaluateAllSystemDiscounts` engine, then splits the net via
 * `splitNetTuitionByOfficialSchedule` — exactly what `computeBilling`
 * does. This closes the desktop-internal inconsistency between the seed
 * state and the interactive batch-registration flow.
 *
 * TIER 2 R24 (desktop) — added a `parent_credit` adjustment entry to
 * `par-001` so the canonical overpayment flow is exercised in mock mode.
 * The desktop's `crossCheckParentCredit` reconciler now has data to verify.
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
  splitNetTuitionByOfficialSchedule,
  evaluateAllSystemDiscounts,
  sumDiscounts,
  type PricingConfig,
} from "../../domain/calc/pricing";
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

    for (const student of students) {
      const childIndex = students.findIndex((s) => s.id === student.id);

      // === TIER 2 R17 — Single-pass discount evaluation on the GROSS annual ===
      // Previously the sibling discount was applied INSIDE the tranches.forEach
      // loop, tripling it for 3-tranche families. Now we evaluate all 5
      // canonical discount rules ONCE on the gross annual tuition, then split
      // the net via `splitNetTuitionByOfficialSchedule` — exactly what
      // `computeBilling` does. Only `sibling_fixed` is wired here because the
      // seed data doesn't carry `previousGradeLevel` / `previousRank` /
      // `enrollmentDate` / `paymentPlan` per student; the other 4 rules
      // correctly return 0 because their preconditions aren't met.
      const grossTuition = tuitionForGradeLevel(config, student.gradeLevel).annualAmount;
      const discountEvals = evaluateAllSystemDiscounts({
        grossTuition,
        previousGradeLevel: null,           // not tracked in seed data
        currentGradeLevel: student.gradeLevel,
        childIndex: childIndex + 1,         // 1-based
        paymentPlan: "tranches",             // seed students default to tranches
        paymentDate: daysAgo(60),
        academicYearStartYear: 2025,
        academicYearStart: iso(new Date(Date.UTC(2025, 8, 1))),
        enrollmentDate: daysAgo(365 * 2),   // reasonable for new students
        previousRank: null,                  // not tracked in seed data
      });
      const tuitionDiscount = sumDiscounts(discountEvals); // negative
      const netTuition = Math.max(0, grossTuition + tuitionDiscount);

      // === Split the net tuition via the canonical 40/30/30 schedule ===
      // (preserves the `T1 + T2 + T3 === net` invariant — no dinar lost).
      const trancheSplits = splitNetTuitionByOfficialSchedule(netTuition);
      const trancheLabels = ["Tranche 1", "Tranche 2", "Tranche 3"];
      trancheSplits.forEach((amount, i) => {
        const dueDate = trancheDueDates[i];
        entries.push(createChargeEntry({
          tenantId: TENANT_ID,
          parentId: parent.id,
          studentId: student.id,
          category: "tuition",
          amount,
          sourceType: "installment",
          sourceId: `ins-${parent.id}-${student.id}-t${i + 1}`,
          description: `Scolarité ${ACADEMIC_YEAR} — ${trancheLabels[i]} (${student.firstName} ${student.lastName}, ${student.gradeLevel})`,
          actorId: "usr-adm-001",
          actorName: "Brahim Souilah",
          at: daysAgo(60),
          metadata: {
            tranche: i + 1,
            gradeLevel: student.gradeLevel,
            level: student.level,
            baseAmount: grossTuition,
            // TIER 2 R17 — record which discounts fired (audit trail).
            // FIX (type): metadata values must be primitives — serialize the
            // discount list to JSON.
            discountsApplied: JSON.stringify(
              discountEvals
                .filter((d) => d.applied)
                .map((d) => ({ code: d.code, amount: d.amount, reason: d.reason })),
            ),
            netTuition,
            tuitionDiscount,
          },
        }));
        void dueDate;
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
    void tuitionTranchesForGrade; // (kept for callers; not used in seed)
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

  // TIER 2 R24 — parent_credit adjustment on par-001.
  // This exercises the canonical overpayment → parent_credit flow in mock
  // mode. The entry:
  //   - category = "parent_credit"
  //   - studentId = null (parent-scoped, NOT student-scoped)
  //   - accountId = parent:par-001:category:parent_credit
  //   - amount = -50000 (credit: school owes parent 50,000 DZD from a
  //     previous-year overpayment that will auto-absorb on next invoice)
  //
  // After this entry, `computeParentSummary` will report
  // `totalUnallocatedCredit = 50,000 DZD` for par-001, and the desktop's
  // `crossCheckParentCredit` reconciler will have data to verify.
  entries.push(createAdjustmentEntry({
    tenantId: TENANT_ID,
    parentId: "par-001",
    studentId: null,
    category: "parent_credit",
    amount: -50000, // credit: overpayment from previous year
    reason: "Trop-perçu année précédente — sera absorbé sur la prochaine facture",
    sourceType: "adjustment",
    sourceId: "adj-003",
    actorId: "usr-fin-001",
    actorName: "Fatima Belkacem (Fin)",
    at: daysAgo(5),
    metadata: {
      origin: "previous_year_overpayment",
      autoAbsorb: true,
      decisionId: "DEC-2024-141",
    },
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
