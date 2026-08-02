/**
 * Mock pricing repository — configurable pricing config with reactive updates.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including iteration 6 granular
 * per-grade-level tuition + per-destination transport pricing and iteration
 * complementary services.
 */
import type {
  PricingRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { SubjectBehavior } from "../subject-behavior";
import type {
  PricingConfig,
  PricingEntry,
  DiscountType,
  DiscountCode,
} from "../../../domain/model/pricing";
import type { AcademicLevel, GradeLevel } from "../../../domain/model/student";
import type { TransportDestination } from "../../../domain/model/parent";
import { defaultPricingConfig } from "../pricing-seed";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

export class MockPricingRepository implements PricingRepository {
  private config: PricingConfig = defaultPricingConfig;
  private config$ = new SubjectBehavior<PricingConfig>(this.config);

  observe(): Observable<PricingConfig> {
    return this.config$;
  }

  private commit(next: PricingConfig, updatedBy: string): PricingConfig {
    this.config = next;
    this.config$.set(next);
    appendAudit({
      action: AuditActions.SettingsUpdate,
      entityType: "pricing",
      entityId: "config",
      actorId: updatedBy,
      actorName: "Session courante",
      diff: { before: null, after: { summary: "pricing config updated" } },
    });
    return next;
  }

  // ---- Legacy methods removed in iteration 16 (updateTuition / updateTransport) ----
  // Use updateTuitionForGradeLevel / updateTransportForDestination instead.

  async updateRegistration(amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, registrationFee: amount }, updatedBy));
  }

  async updateMonthly(level: AcademicLevel, amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, monthlyByLevel: { ...this.config.monthlyByLevel, [level]: amount } }, updatedBy));
  }

  async updateLatePenalty(amountPerDay: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, latePenaltyPerDay: amountPerDay }, updatedBy));
  }

  async addDiscount(input: { label: string; amount: number; discountType: DiscountType; discountCode?: DiscountCode }, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(180);
    const entry: PricingEntry = {
      id: `disc-${Date.now()}`,
      tenantId: TENANT_ID,
      category: "discount",
      qualifier: input.discountCode ?? `disc_${Date.now()}`,
      label: input.label,
      amount: input.amount,
      discountType: input.discountType,
      discountCode: input.discountCode ?? "custom",
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    };
    return Ok(this.commit({ ...this.config, discounts: [...this.config.discounts, entry] }, updatedBy));
  }

  async removeDiscount(id: string, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, discounts: this.config.discounts.filter((d) => d.id !== id) }, updatedBy));
  }

  async addAdditionalService(input: { label: string; amount: number }, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(180);
    const entry: PricingEntry = {
      id: `svc-${Date.now()}`,
      tenantId: TENANT_ID,
      category: "additional",
      qualifier: `svc_${Date.now()}`,
      label: input.label,
      amount: input.amount,
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    };
    return Ok(this.commit({ ...this.config, additionalServices: [...this.config.additionalServices, entry] }, updatedBy));
  }

  async removeAdditionalService(id: string, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, additionalServices: this.config.additionalServices.filter((s) => s.id !== id) }, updatedBy));
  }

  // ---- Iteration 6: granular pricing methods ----
  async updateTuitionForGradeLevel(
    gradeLevel: GradeLevel,
    annualAmount: number,
    installments: readonly [number, number, number],
    updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    await delay(180);
    // Validate that installments sum to the annual amount (within 1 DA tolerance).
    const sum = installments.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - annualAmount) > 1) {
      return Err(Errors.validation(`La somme des tranches (${sum}) doit égaler le montant annuel (${annualAmount})`));
    }
    if (installments.some((t) => t < 0)) {
      return Err(Errors.validation("Les tranches ne peuvent pas être négatives"));
    }
    return Ok(this.commit({
      ...this.config,
      tuitionByGradeLevel: {
        ...this.config.tuitionByGradeLevel,
        [gradeLevel]: {
          annualAmount,
          installments: [installments[0], installments[1], installments[2]] as const,
        },
      },
    }, updatedBy));
  }

  async updateTransportForDestination(
    destination: TransportDestination,
    annualAmount: number,
    installments: readonly [number, number, number],
    updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    await delay(180);
    const sum = installments.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - annualAmount) > 1) {
      return Err(Errors.validation(`La somme des tranches (${sum}) doit égaler le montant annuel (${annualAmount})`));
    }
    if (installments.some((t) => t < 0)) {
      return Err(Errors.validation("Les tranches ne peuvent pas être négatives"));
    }
    return Ok(this.commit({
      ...this.config,
      transportByDestination: {
        ...this.config.transportByDestination,
        [destination]: {
          annualAmount,
          installments: [installments[0], installments[1], installments[2]] as const,
        },
      },
    }, updatedBy));
  }

  async updateSecondApronFee(amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    if (amount < 0) {
      return Err(Errors.validation("Le montant du 2ème tablier ne peut pas être négatif"));
    }
    return Ok(this.commit({ ...this.config, secondApronFee: amount }, updatedBy));
  }

  async addComplementaryService(input: {
    label: string;
    qualifier: string;
    semesterAmount: number;
    annualAmount: number;
  }, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(180);
    if (input.semesterAmount < 0 || input.annualAmount < 0) {
      return Err(Errors.validation("Les montants ne peuvent pas être négatifs"));
    }
    if (input.annualAmount < input.semesterAmount) {
      return Err(Errors.validation("Le montant annuel doit être ≥ au montant semestriel"));
    }
    const entry: PricingEntry & { semesterAmount: number; annualAmount: number } = {
      id: `comp-${Date.now()}`,
      tenantId: TENANT_ID,
      category: "complementary",
      qualifier: input.qualifier,
      label: input.label,
      amount: input.annualAmount, // canonical annual amount
      semesterAmount: input.semesterAmount,
      annualAmount: input.annualAmount,
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    };
    return Ok(this.commit({
      ...this.config,
      complementaryServices: [...this.config.complementaryServices, entry],
    }, updatedBy));
  }

  async removeComplementaryService(id: string, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({
      ...this.config,
      complementaryServices: this.config.complementaryServices.filter((s) => s.id !== id),
    }, updatedBy));
  }
}

/** Singleton — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockPricingRepository: PricingRepository = new MockPricingRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
