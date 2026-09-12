/**
 * Discount Engine — orchestrates the REAL 2026/2027 discount rules in a
 * SINGLE PASS on the gross scolarité.
 *
 * CALC-001 fix (2026-09-12): the engine previously ran 5 fictional rules
 * (passage_palier, highest_average, seniority_5y, 10% early, linear sibling).
 * The school's actual model — extracted from the workbook formulas — is:
 *
 *   1. `full_annual` early payment: −5% of the FRAIS DE SCOLARISATION
 *      (never of FI / transport), before June 30.
 *   2. `sibling_fixed`: −5 000 DZD per additional child (default component
 *      of the negotiated remise — the real remises are manual inputs).
 *
 * The negotiated REMISE itself is NOT computed here — it is collected in the
 * registration wizard (per student) and deducted from the V2 tranche by
 * `school-price-matrix.ts computeSchoolDevis`. This engine only evaluates
 * the two deterministic rules that can fire without manual input.
 */
import type { DiscountCode } from "../../model/pricing";
import type { GradeLevel } from "../../model/student";
import type { PaymentPlan } from "../../model/payment";
import { evaluateSiblingDiscount, evaluateEarlyAnnualDiscount } from "./discount-rules";

export { evaluateSiblingDiscount, evaluateEarlyAnnualDiscount };

export type SystemDiscountCode =
  | DiscountCode | "sibling_fixed" | "full_annual";

export interface DiscountEvaluation {
  readonly code: SystemDiscountCode;
  readonly label: string;
  readonly amount: number;
  readonly applied: boolean;
  readonly reason: string;
}

export interface EvaluateAllDiscountsParams {
  /**
   * The base for percentage rules = the gross SCOLARITÉ (FI and transport
   * excluded — mirrors the workbook's `SUM(F)*0.05`).
   */
  readonly grossScolarite?: number;
  /**
   * DEPRECATED alias for `grossScolarite` (CALC-001 rename — the base is the
   * scolarité only, never the tuition+FI+transport gross). Kept so the
   * shared cross-platform scenario fixtures keep compiling; new code must
   * pass `grossScolarite`.
   */
  readonly grossTuition?: number;
  /**
   * CALC-001: previous-grade / previous-rank inputs are DEPRECATED and
   * ignored (the rules they fed never existed). Kept in the interface so
   * older call sites compile; migration TODOs live in the task registry.
   */
  readonly previousGradeLevel?: GradeLevel | null;
  readonly currentGradeLevel?: GradeLevel;
  readonly childIndex: number;
  readonly paymentPlan: PaymentPlan;
  readonly paymentDate: string | Date;
  readonly academicYearStartYear: number;
  readonly academicYearStart?: string | Date;
  readonly enrollmentDate?: string | Date;
  readonly previousRank?: number | null;
  readonly siblingPerChildAmount?: number;
}

/** Group thousands with a plain space (fr-FR style, canonical byte-identical
 *  across desktop / Android / reports). */
function groupAmountFr(n: number): string {
  const parts: string[] = [];
  let rest = Math.floor(Math.abs(n));
  if (rest === 0) return "0";
  while (rest > 0) {
    parts.unshift(String(rest % 1000));
    rest = Math.floor(rest / 1000);
  }
  return parts.join(" ");
}

export function evaluateAllSystemDiscounts(
  params: EvaluateAllDiscountsParams,
): readonly DiscountEvaluation[] {
  const out: DiscountEvaluation[] = [];
  const grossScolarite = params.grossScolarite ?? params.grossTuition ?? 0;

  const sibling = evaluateSiblingDiscount(params.childIndex, params.siblingPerChildAmount);
  if (sibling !== 0) {
    out.push({
      code: "sibling_fixed",
      // CANONICAL (cross-platform equivalence): byte-identical label format
      // on desktop and Android — plain-space manual grouping.
      label: `Fratrie — enfant #${params.childIndex} (−${groupAmountFr(Math.abs(sibling))} DA)`,
      amount: sibling,
      applied: true,
      reason: `Enfant ${params.childIndex} de la fratrie`,
    });
  }

  const early = evaluateEarlyAnnualDiscount(
    params.paymentDate, grossScolarite, params.paymentPlan, params.academicYearStartYear,
  );
  if (early !== 0) {
    out.push({
      code: "full_annual",
      label: "Paiement annuel avant le 30 juin (−5% scolarité)",
      amount: -early,
      applied: true,
      reason: "Paiement intégral avant le 30 juin",
    });
  }

  // ── Removed rules (CALC-001): passage_palier, highest_average, seniority_5y.
  // Their params (previousGradeLevel / previousRank / enrollmentDate /
  // academicYearStart) are accepted but intentionally ignored.

  return out;
}

export function sumDiscounts(evaluations: readonly DiscountEvaluation[]): number {
  return evaluations.reduce((sum, e) => sum + e.amount, 0);
}
