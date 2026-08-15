/**
 * Discount Engine — orchestrates the 5 canonical discount rules in a SINGLE PASS.
 * Prevents double-discounting bug (was applied per-tranche previously).
 */
import type { DiscountCode } from "../../model/pricing";
import type { GradeLevel } from "../../model/student";
import type { PaymentPlan } from "../../model/payment";
import {
  evaluatePassageDePalier, evaluateSiblingDiscount, evaluateEarlyAnnualDiscount,
  evaluateAcademicExcellenceDiscount, evaluateSeniorityDiscount,
} from "./discount-rules";

export {
  evaluatePassageDePalier, evaluateSiblingDiscount, evaluateEarlyAnnualDiscount,
  evaluateAcademicExcellenceDiscount, evaluateSeniorityDiscount,
};

export type SystemDiscountCode =
  | DiscountCode | "passage_palier" | "sibling_fixed" | "full_annual" | "highest_average" | "seniority_5y";

export interface DiscountEvaluation {
  readonly code: SystemDiscountCode;
  readonly label: string;
  readonly amount: number;
  readonly applied: boolean;
  readonly reason: string;
}

export interface EvaluateAllDiscountsParams {
  readonly grossTuition: number;
  readonly previousGradeLevel: GradeLevel | null;
  readonly currentGradeLevel: GradeLevel;
  readonly childIndex: number;
  readonly paymentPlan: PaymentPlan;
  readonly paymentDate: string | Date;
  readonly academicYearStartYear: number;
  readonly academicYearStart: string | Date;
  readonly enrollmentDate: string | Date;
  readonly previousRank: number | null;
  readonly siblingPerChildAmount?: number;
}

export function evaluateAllSystemDiscounts(
  params: EvaluateAllDiscountsParams,
): readonly DiscountEvaluation[] {
  const out: DiscountEvaluation[] = [];

  pushRule(out, {
    code: "passage_palier",
    label: "Passage de palier (−10 000 DA)",
    amount: evaluatePassageDePalier(params.previousGradeLevel, params.currentGradeLevel),
    reason: `Transition ${params.previousGradeLevel ?? "—"} → ${params.currentGradeLevel}`,
  });

  const sibling = evaluateSiblingDiscount(params.childIndex, params.siblingPerChildAmount);
  pushRule(out, {
    code: "sibling_fixed",
    label: `Fratrie — enfant #${params.childIndex} (−${Math.abs(sibling).toLocaleString("fr-FR")} DA)`,
    amount: sibling, reason: `Enfant ${params.childIndex} de la fratrie`,
  });

  const early = evaluateEarlyAnnualDiscount(
    params.paymentDate, params.grossTuition, params.paymentPlan, params.academicYearStartYear,
  );
  pushRule(out, {
    code: "full_annual", label: "Paiement annuel avant le 30 juin (−10%)",
    amount: -early, reason: "Paiement intégral avant le 30 juin",
  });

  const excellence = evaluateAcademicExcellenceDiscount(params.previousRank, params.grossTuition);
  pushRule(out, {
    code: "highest_average", label: "Meilleure moyenne du palier (−10%)",
    amount: -excellence, reason: "Rang 1 au palier l'année précédente",
  });

  const seniority = evaluateSeniorityDiscount(
    params.enrollmentDate, params.academicYearStart, params.grossTuition,
  );
  pushRule(out, {
    code: "seniority_5y", label: "Ancienneté > 5 ans (−5%)",
    amount: -seniority, reason: "Plus de 5 ans d'ancienneté",
  });

  return out;
}

function pushRule(
  out: DiscountEvaluation[],
  entry: { code: SystemDiscountCode; label: string; amount: number; reason: string },
): void {
  if (entry.amount === 0) return;
  out.push({ ...entry, applied: true });
}

export function sumDiscounts(evaluations: readonly DiscountEvaluation[]): number {
  return evaluations.reduce((sum, e) => sum + e.amount, 0);
}
