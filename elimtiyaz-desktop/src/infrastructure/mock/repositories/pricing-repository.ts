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
  PricingConfigSummary,
  PricingEntry,
  DiscountType,
  DiscountCode,
} from "../../../domain/model/pricing";
import type { AcademicYear } from "../../../domain/model/academic";
import type { AcademicLevel, GradeLevel } from "../../../domain/model/student";
import type { TransportDestination } from "../../../domain/model/parent";
import { defaultPricingConfig } from "../pricing-seed";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

export class MockPricingRepository implements PricingRepository {
  private config: PricingConfig = defaultPricingConfig;
  private config$ = new SubjectBehavior<PricingConfig>(this.config);

  // ---- T-414 (PRICING-500 / ADR-025): per-year configuration state ----
  // One entry per academic year that has a config; `activeYearId` points at
  // the single ACTIVE config (mirrors the 0117 one-active-per-tenant
  // invariant). The default entry (before any listConfigs call) represents
  // the CURRENT academic year's active config — the legacy single-config
  // behavior preserved so existing tests/consumers are untouched.
  private readonly yearConfigs = new Map<string, PricingConfig>();
  private readonly yearMeta = new Map<string, { id: string; label: string; createdAt: string; updatedAt: string }>();
  private activeYearId: string | null = null;

  observe(): Observable<PricingConfig> {
    return this.config$;
  }

  private commit(next: PricingConfig, updatedBy: string): PricingConfig {
    this.config = next;
    this.config$.set(next);
    // T-414: keep the ACTIVE year's stored entry in sync — `observe()` and
    // the year entry must be the same configuration object.
    if (this.activeYearId) this.yearConfigs.set(this.activeYearId, next);
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

  // CALC-001 (owner mandate 2026-09-13): updateLatePenalty REMOVED — penalties do not exist.

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

  // ---- T-414 (PRICING-500 / ADR-025): per-year configuration management ----
  // Mock parity with the Supabase repository's RPC-backed methods: the
  // year-scoped configs live in memory, one ACTIVE at a time, historical
  // configs are read-only, and the ACTIVE config is what `observe()` (and
  // every update method) targets.

  /** Resolve the current mock year (honest null — §15.49 contract). */
  private currentMockYear(): AcademicYear | null {
    const years = [...store.academicYears];
    return years.find((y) => y.isCurrent && !y.isArchived) ?? null;
  }

  /** Materialize the CURRENT year's config entry if absent (the legacy
   *  single-config behavior maps onto year "<current>"). */
  private ensureCurrentYearEntry(): { year: AcademicYear } | null {
    const year = this.currentMockYear();
    if (!year) return null;
    if (!this.yearConfigs.has(year.id)) {
      this.yearConfigs.set(year.id, this.config);
      this.yearMeta.set(year.id, {
        id: `cfg-${year.id}`,
        label: `Tarification ${year.label}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      if (this.activeYearId === null) this.activeYearId = year.id;
    }
    return { year };
  }

  private summaries(): PricingConfigSummary[] {
    this.ensureCurrentYearEntry();
    const out: PricingConfigSummary[] = [];
    for (const year of store.academicYears) {
      if (!this.yearConfigs.has(year.id)) continue;
      const meta = this.yearMeta.get(year.id)!;
      out.push({
        id: meta.id,
        tenantId: TENANT_ID,
        academicYearId: year.id,
        academicYearLabel: year.label,
        academicYearCode: year.code,
        label: meta.label,
        isActive: this.activeYearId === year.id,
        isCurrentYear: year.isCurrent,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      });
    }
    return out;
  }

  async listConfigs(): Promise<Result<readonly PricingConfigSummary[]>> {
    await delay(60);
    return Ok(this.summaries());
  }

  async readForYear(academicYearId: string): Promise<Result<PricingConfig>> {
    await delay(80);
    // The current year's entry materializes lazily from the live config
    // (the legacy single-config behavior maps onto the current year).
    this.ensureCurrentYearEntry();
    const cfg = this.yearConfigs.get(academicYearId);
    if (!cfg) {
      return Err(Errors.notFound("Configuration de tarification pour l'année", academicYearId));
    }
    return Ok(cfg);
  }

  async createConfigForYear(
    input: { academicYearId: string; label?: string; cloneFromActive: boolean },
    updatedBy: string,
  ): Promise<Result<PricingConfigSummary>> {
    await delay(120);
    const year = store.academicYears.find((y) => y.id === input.academicYearId);
    if (!year) {
      return Err(Errors.notFound("Année académique", input.academicYearId));
    }
    if (this.yearConfigs.has(year.id)) {
      return Err(Errors.validation(
        `duplicate pricing config for year ${year.id} (the 0006 one-config-per-year constraint)`,
        `Une configuration de tarification existe déjà pour l'année ${year.label}`,
      ));
    }
    // Seed the current year's entry first so clone-from-active has a source.
    this.ensureCurrentYearEntry();
    const cloneSource = input.cloneFromActive && this.activeYearId
      ? this.yearConfigs.get(this.activeYearId)
      : undefined;
    // Structural clone (deep enough: the grids are rebuilt; entries arrays
    // copied; per-grade FI records copied shallow per grade).
    const base = cloneSource ?? defaultPricingConfig;
    const cloned: PricingConfig = {
      ...base,
      tuitionByGradeLevel: { ...base.tuitionByGradeLevel },
      transportByDestination: { ...base.transportByDestination },
      registrationFeeByGrade: { ...base.registrationFeeByGrade },
      monthlyByLevel: { ...base.monthlyByLevel },
      discounts: [...base.discounts],
      additionalServices: [...base.additionalServices],
      complementaryServices: [...base.complementaryServices],
    };
    this.yearConfigs.set(year.id, cloned);
    this.yearMeta.set(year.id, {
      id: `cfg-${year.id}`,
      label: input.label?.trim() ? input.label.trim() : `Tarification ${year.label}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    appendAudit({
      action: AuditActions.SettingsUpdate,
      entityType: "pricing",
      entityId: `cfg-${year.id}`,
      actorId: updatedBy,
      actorName: "Session courante",
      diff: { before: null, after: { summary: `config créée pour ${year.label}${input.cloneFromActive ? " (clone de la config active)" : ""}` } },
    });
    return Ok(this.summaries().find((s) => s.academicYearId === year.id)!);
  }

  async activateConfig(configId: string, updatedBy: string): Promise<Result<void>> {
    await delay(100);
    const target = this.summaries().find((s) => s.id === configId);
    if (!target) {
      return Err(Errors.notFound("Configuration de tarification", configId));
    }
    if (!target.isActive) {
      this.activeYearId = target.academicYearId;
      // The ACTIVE config becomes the one observe() / every update targets.
      this.config = this.yearConfigs.get(target.academicYearId)!;
      this.config$.set(this.config);
      appendAudit({
        action: AuditActions.SettingsUpdate,
        entityType: "pricing",
        entityId: configId,
        actorId: updatedBy,
        actorName: "Session courante",
        diff: { before: null, after: { summary: `config ${target.academicYearLabel} activée` } },
      });
    }
    return Ok(undefined);
  }
}

/** Singleton — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockPricingRepository: PricingRepository = new MockPricingRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
