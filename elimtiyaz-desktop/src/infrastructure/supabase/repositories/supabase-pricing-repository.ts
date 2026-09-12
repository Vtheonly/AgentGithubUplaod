/**
 * SupabasePricingRepository — T-307 (48th session, 2026-09-12).
 *
 * T-047 Group-B port #1 (PRICING FIRST — the standing recommendation):
 * the pricing slot in Supabase mode previously stayed on
 * `mockRepositories.pricing`, so every price edit in the Settings →
 * Tarification tab was IN-MEMORY ONLY — never persisted to the canonical
 * 0006 tables, never audited, wiped on restart. The owner's report
 * ("I changed a name and a price, but nothing changed in the audit") was
 * exactly this gap for the price half.
 *
 * Adapter pattern of the T-238/T-239/T-240 ports onto the canonical tables:
 *   - pricing_configs            → registrationFee / latePenaltyPerDay /
 *                                  secondApronFee (0006 §1)
 *   - grade_level_tuition        → tuitionByGradeLevel (joined via
 *                                  academic_levels.grade_code) (0006 §2)
 *   - transport_destinations     → transportByDestination (by code) (0006 §3)
 *   - complementary_services     → complementaryServices (0006 §4)
 *   - additional_services        → additionalServices (0006 §5)
 *   - discounts                  → discounts (0006 §6, code CHECK widened
 *                                  to the domain DiscountCode union by 0086)
 *   - system_settings            → monthlyByLevel (keys
 *                                  `pricing.monthly.<level>`, the audited
 *                                  upsert_setting RPC — 0024; the 0006
 *                                  tables carry no monthly columns)
 *
 * AUDIT: writes go through plain PostgREST UPDATE/INSERT/DELETE — the 0086
 * row-level audit triggers (T-306) capture every mutation server-side with
 * full before/after snapshots + actor attribution. The repository writes NO
 * audit rows itself (zero duplication; the same coverage lands for any
 * other writer of these tables).
 *
 * READ FALLBACK: keys missing from the DB fall back to the seed config
 * (`defaultPricingConfig`) so the tab never renders holes while the live
 * rows exist (e.g. additional_services is empty live — the 4 seed services
 * keep rendering until the owner edits one, which then lands in the DB and
 * takes precedence on every subsequent read).
 *
 * UNKNOWN-011 (registered, not silently decided): the live grade_level_tuition
 * grid (0023 seed: 1ap 205 000 …) DIVERGES from the mock seed grid
 * (pricing-seed.ts documents the "OFFICIAL 2026-2027" 1ap 245 000 …). This
 * repository reads the DB as canonical (boundaries.md — the server tables
 * are the system of record). The owner resolves the divergence by editing
 * the prices in the UI (now persisted) or by a one-shot sync script.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable, PricingRepository } from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { defaultPricingConfig } from "../../mock/pricing-seed";
import { REAL_FI_BY_GRADE } from "../../../domain/calc/pricing/school-price-matrix";
import type {
  PricingConfig,
  DiscountType,
  DiscountCode,
} from "../../../domain/model/pricing";
import type { AcademicLevel, GradeLevel } from "../../../domain/model/student";
import { GRADE_LEVELS as ALL_GRADES } from "../../../domain/model/student";
import type { TransportDestination } from "../../../domain/model/parent";
import { TRANSPORT_DESTINATIONS } from "../../../domain/model/parent";
import { getTenantId, requireTenantId, isUuid } from "./supabase-shared-repositories";

// ============================================================================
// Row shapes (snake_case → domain camelCase)
// ============================================================================

interface ConfigRow {
  id: string;
  tenant_id: string;
  registration_fee: number | string;
  late_penalty_per_day: number | string;
  second_apron_fee: number | string;
  is_active: boolean;
}

interface TuitionRow {
  id: string;
  pricing_config_id: string;
  academic_level_id: string;
  annual_amount: number | string;
  tranche_1_amount: number | string;
  tranche_2_amount: number | string;
  tranche_3_amount: number | string;
  registration_fee?: number | null;
}

interface LevelRow {
  id: string;
  grade_code: string;
}

interface TransportRow {
  id: string;
  pricing_config_id: string;
  code: string;
  annual_amount: number | string;
  tranche_1_amount: number | string;
  tranche_2_amount: number | string;
  tranche_3_amount: number | string;
}

interface ComplementaryRow {
  id: string;
  pricing_config_id: string;
  code: string;
  label_fr: string;
  semester_amount: number | string | null;
  annual_amount: number | string | null;
  is_active: boolean;
}

interface AdditionalRow {
  id: string;
  pricing_config_id: string;
  code: string;
  label_fr: string;
  amount: number | string;
  is_active: boolean;
}

interface DiscountRow {
  id: string;
  pricing_config_id: string;
  code: string;
  label_fr: string;
  discount_type: string;
  amount: number | string;
  is_active: boolean;
}

/** Number coercion — numeric columns may arrive as strings. */
const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
};

const nowIso = (): string => new Date().toISOString();

// ============================================================================
// The DB → domain config builder (shared with the batchRegister billing path)
// ============================================================================

/**
 * Read the canonical pricing tables and build the domain `PricingConfig`.
 * Exported so `SupabaseStudentRepository.batchRegister` reads THE SAME
 * config (T-307's drift fix — the billing write path previously hardcoded
 * the mock seed grid). Returns the seed-merged config; throws nothing.
 */
export async function readDbPricingConfig(
  client: SupabaseClient,
): Promise<PricingConfig> {
  const tenantId = getTenantId();
  const seed = defaultPricingConfig;

  // 1. Active pricing config row (tenant-scoped).
  const { data: cfgRows } = await client
    .from("pricing_configs")
    .select("id, tenant_id, registration_fee, late_penalty_per_day, second_apron_fee, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .limit(1);
  const cfg = (cfgRows?.[0] as ConfigRow | undefined) ?? null;

  // 2. Grade tuition + academic levels (client-side join on level id).
  const { data: levels } = await client
    .from("academic_levels")
    .select("id, grade_code");
  const levelByCode = new Map<string, string>();
  for (const l of (levels ?? []) as LevelRow[]) levelByCode.set(l.grade_code, l.id);
  const levelIdToCode = new Map<string, string>();
  for (const [code, id] of levelByCode) levelIdToCode.set(id, code);

  let tuitionRows: TuitionRow[] = [];
  if (cfg) {
    const { data: tRows } = await client
      .from("grade_level_tuition")
      .select("id, pricing_config_id, academic_level_id, annual_amount, tranche_1_amount, tranche_2_amount, tranche_3_amount, registration_fee")
      .eq("pricing_config_id", cfg.id);
    tuitionRows = (tRows ?? []) as TuitionRow[];
  }
  const tuitionByGradeLevel: Record<GradeLevel, { annualAmount: number; installments: readonly [number, number, number] }> =
    {} as Record<GradeLevel, { annualAmount: number; installments: readonly [number, number, number] }>;
  // CALC-001: per-grade FI — REAL matrix defaults, overridden by DB rows.
  const registrationFeeByGrade: Record<GradeLevel, number> = { ...REAL_FI_BY_GRADE };
  const seenGrades = new Set<string>();
  for (const row of tuitionRows) {
    const code = levelIdToCode.get(row.academic_level_id);
    if (!code) continue;
    seenGrades.add(code);
    tuitionByGradeLevel[code as GradeLevel] = {
      annualAmount: num(row.annual_amount),
      installments: [
        num(row.tranche_1_amount),
        num(row.tranche_2_amount),
        num(row.tranche_3_amount),
      ],
    };
    // CALC-001: per-grade FI (migration 0088 additive column; falls back to
    // the real workbook matrix when the row predates the column).
    const fiFromRow = row.registration_fee == null ? null : num(row.registration_fee);
    registrationFeeByGrade[code as GradeLevel] = fiFromRow ?? REAL_FI_BY_GRADE[code as GradeLevel];
  }
  // Seed fallback per missing grade (the 14-row grid always renders whole).
  for (const g of ALL_GRADES) {
    if (!seenGrades.has(g)) tuitionByGradeLevel[g] = seed.tuitionByGradeLevel[g];
  }

  // 3. Transport destinations (by code, seed fallback per destination).
  let transportRows: TransportRow[] = [];
  if (cfg) {
    const { data: dRows } = await client
      .from("transport_destinations")
      .select("id, pricing_config_id, code, annual_amount, tranche_1_amount, tranche_2_amount, tranche_3_amount")
      .eq("pricing_config_id", cfg.id);
    transportRows = (dRows ?? []) as TransportRow[];
  }
  const transportByDestination: Record<TransportDestination, { annualAmount: number; installments: readonly [number, number, number] }> =
    {} as Record<TransportDestination, { annualAmount: number; installments: readonly [number, number, number] }>;
  for (const row of transportRows) {
    transportByDestination[row.code as TransportDestination] = {
      annualAmount: num(row.annual_amount),
      installments: [
        num(row.tranche_1_amount),
        num(row.tranche_2_amount),
        num(row.tranche_3_amount),
      ],
    };
  }
  for (const d of TRANSPORT_DESTINATIONS) {
    if (!(d in transportByDestination)) {
      transportByDestination[d] = seed.transportByDestination[d];
    }
  }

  // 4. Complementary + additional services + discounts (DB rows first, seed
  //    entries for qualifiers the DB lacks keep rendering).
  let compRows: ComplementaryRow[] = [];
  let addlRows: AdditionalRow[] = [];
  let discRows: DiscountRow[] = [];
  if (cfg) {
    const [compRes, addlRes, discRes] = await Promise.all([
      client.from("complementary_services")
        .select("id, pricing_config_id, code, label_fr, semester_amount, annual_amount, is_active")
        .eq("pricing_config_id", cfg.id),
      client.from("additional_services")
        .select("id, pricing_config_id, code, label_fr, amount, is_active")
        .eq("pricing_config_id", cfg.id),
      client.from("discounts")
        .select("id, pricing_config_id, code, label_fr, discount_type, amount, is_active")
        .eq("pricing_config_id", cfg.id),
    ]);
    compRows = (compRes.data ?? []) as ComplementaryRow[];
    addlRows = (addlRes.data ?? []) as AdditionalRow[];
    discRows = (discRes.data ?? []) as DiscountRow[];
  }

  const tenant = tenantId ?? "mock";
  const updatedBy = "supabase";

  const complementaryServices = compRows
    .filter((r) => r.is_active)
    .map((r) => ({
      id: r.id,
      tenantId: tenant,
      category: "complementary" as const,
      qualifier: r.code,
      label: r.label_fr,
      amount: num(r.annual_amount),
      semesterAmount: num(r.semester_amount),
      annualAmount: num(r.annual_amount),
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    }));
  const seedComp = seed.complementaryServices.filter(
    (s) => !compRows.some((r) => r.code === s.qualifier),
  );
  const complementaryAll = [...complementaryServices, ...seedComp];

  const additionalServices = addlRows
    .filter((r) => r.is_active)
    .map((r) => ({
      id: r.id,
      tenantId: tenant,
      category: "additional" as const,
      qualifier: r.code,
      label: r.label_fr,
      amount: num(r.amount),
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    }));
  const seedAddl = seed.additionalServices.filter(
    (s) => !addlRows.some((r) => r.code === s.qualifier),
  );
  const additionalAll = [...additionalServices, ...seedAddl];

  // Domain discount convention: percentage amounts POSITIVE, fixed_amount
  // NEGATIVE (applySingleDiscount: `base + amount` for fixed) — the DB stores
  // both positive.
  const discounts = discRows
    .filter((r) => r.is_active)
    .map((r) => ({
      id: r.id,
      tenantId: tenant,
      category: "discount" as const,
      qualifier: r.code,
      label: r.label_fr,
      amount: r.discount_type === "fixed_amount" ? -num(r.amount) : num(r.amount),
      discountType: r.discount_type as DiscountType,
      discountCode: r.code as DiscountCode,
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    }));
  const seedDisc = seed.discounts.filter(
    (s) => !discRows.some((r) => r.code === s.discountCode),
  );
  const discountsAll = [...discounts, ...seedDisc];

  // 5. Monthly by level — persisted as system_settings (category 'system',
  //    keys pricing.monthly.<level>); seed defaults when unset.
  const monthlyByLevel: Partial<Record<AcademicLevel, number>> = {
    ...seed.monthlyByLevel,
  };
  try {
    const { data: settings } = await client
      .from("system_settings")
      .select("key, value")
      .eq("tenant_id", tenantId)
      .eq("category", "system")
      .like("key", "pricing.monthly.%");
    for (const s of (settings ?? []) as { key: string; value: unknown }[]) {
      const level = s.key.replace("pricing.monthly.", "") as AcademicLevel;
      const v = typeof s.value === "number" ? s.value : Number(s.value);
      if (!Number.isNaN(v)) monthlyByLevel[level] = v;
    }
  } catch {
    // Monthly stays on seed defaults — the config is still fully usable.
  }

  return {
    tuitionByGradeLevel,
    transportByDestination,
    registrationFee: cfg ? num(cfg.registration_fee) : seed.registrationFee,
    registrationFeeByGrade,
    monthlyByLevel,
    latePenaltyPerDay: cfg ? num(cfg.late_penalty_per_day) : seed.latePenaltyPerDay,
    discounts: discountsAll,
    additionalServices: additionalAll,
    complementaryServices: complementaryAll,
    secondApronFee: cfg ? num(cfg.second_apron_fee) : seed.secondApronFee,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class SupabasePricingRepository implements PricingRepository {
  private readonly cache = new SubjectBehavior<PricingConfig>(defaultPricingConfig);
  private seeded = false;

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<PricingConfig> {
    void this.load();
    return this.cache;
  }

  /** Fetch + cache the DB config (idempotent re-fetch after writes). */
  private async load(): Promise<PricingConfig> {
    try {
      const config = await readDbPricingConfig(this.client);
      this.cache.set(config);
      this.seeded = true;
      return config;
    } catch {
      // Degrade to the seed config — the tab renders, writes still surface
      // their own errors.
      this.seeded = true;
      return this.cache.get();
    }
  }

  /** The active config row id (creating one from the seed when absent). */
  private async activeConfigId(): Promise<string> {
    const tenantId = requireTenantId();
    const { data, error } = await this.client
      .from("pricing_configs")
      .select("id, tenant_id, registration_fee, late_penalty_per_day, second_apron_fee, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(1);
    if (error) throw error;
    const row = (data?.[0] as ConfigRow | undefined) ?? null;
    if (row) return row.id;
    // No config row yet (fresh tenant) — create the initial one from the
    // seed's top-level fees so child writes have a parent.
    const { data: created, error: createErr } = await this.client
      .from("pricing_configs")
      .insert({
        tenant_id: tenantId,
        // academic_year_id is NOT NULL in 0006 — a config without a year is
        // impossible; resolve the current year.
        academic_year_id: (await this.currentAcademicYearId()) as string,
        label: `Tarification ${new Date().getFullYear()}`,
        registration_fee: defaultPricingConfig.registrationFee,
        late_penalty_per_day: defaultPricingConfig.latePenaltyPerDay,
        second_apron_fee: defaultPricingConfig.secondApronFee,
        is_active: true,
      })
      .select("id")
      .single();
    if (createErr || !created) throw createErr ?? new Error("pricing config create failed");
    return (created as { id: string }).id;
  }

  private async currentAcademicYearId(): Promise<string | null> {
    const { data } = await this.client
      .from("academic_years")
      .select("id, tenant_id, is_current")
      .eq("tenant_id", requireTenantId())
      .eq("is_current", true)
      .limit(1);
    return ((data?.[0] as { id: string } | undefined)?.id) ?? null;
  }

  /** Shared post-write step: refetch so observe() consumers re-render. */
  private async afterWrite(): Promise<Result<PricingConfig>> {
    await this.load();
    return Ok(this.cache.get());
  }

  // ---- Top-level fees ------------------------------------------------------

  async updateRegistration(amount: number, _updatedBy: string): Promise<Result<PricingConfig>> {
    try {
      const cfgId = await this.activeConfigId();
      const { error } = await this.client
        .from("pricing_configs")
        .update({ registration_fee: amount })
        .eq("id", cfgId);
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async updateMonthly(level: AcademicLevel, amount: number, _updatedBy: string): Promise<Result<PricingConfig>> {
    try {
      // Persisted through the audited upsert_setting RPC (0024) — the 0006
      // tables carry no monthly columns.
      const { error } = await this.client.rpc("upsert_setting", {
        p_tenant_id: requireTenantId(),
        p_category: "system",
        p_key: `pricing.monthly.${level}`,
        p_label_fr: `Tarif mensuel (${level})`,
        p_value: amount,
        p_value_type: "number",
      });
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async updateLatePenalty(amountPerDay: number, _updatedBy: string): Promise<Result<PricingConfig>> {
    try {
      const cfgId = await this.activeConfigId();
      const { error } = await this.client
        .from("pricing_configs")
        .update({ late_penalty_per_day: amountPerDay })
        .eq("id", cfgId);
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async updateSecondApronFee(amount: number, _updatedBy: string): Promise<Result<PricingConfig>> {
    if (amount < 0) {
      return Err(Errors.validation("Le montant du 2ème tablier ne peut pas être négatif"));
    }
    try {
      const cfgId = await this.activeConfigId();
      const { error } = await this.client
        .from("pricing_configs")
        .update({ second_apron_fee: amount })
        .eq("id", cfgId);
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  // ---- Tuition + transport (the owner's "price" surfaces) -----------------

  async updateTuitionForGradeLevel(
    gradeLevel: GradeLevel,
    annualAmount: number,
    installments: readonly [number, number, number],
    _updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    // Validation identical to the mock (parity — same contract, two modes).
    const sum = installments.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - annualAmount) > 1) {
      return Err(Errors.validation(`La somme des tranches (${sum}) doit égaler le montant annuel (${annualAmount})`));
    }
    if (installments.some((t) => t < 0)) {
      return Err(Errors.validation("Les tranches ne peuvent pas être négatives"));
    }
    try {
      const cfgId = await this.activeConfigId();
      const { data: levels } = await this.client
        .from("academic_levels")
        .select("id, grade_code");
      const level = ((levels ?? []) as LevelRow[]).find((l) => l.grade_code === gradeLevel);
      if (!level) return Err(Errors.notFound("Niveau académique", gradeLevel));

      const { data: existing } = await this.client
        .from("grade_level_tuition")
        .select("id")
        .eq("pricing_config_id", cfgId)
        .eq("academic_level_id", level.id)
        .maybeSingle();
      const row = existing as { id: string } | null;
      if (row) {
        const { error } = await this.client
          .from("grade_level_tuition")
          .update({
            annual_amount: annualAmount,
            tranche_1_amount: installments[0],
            tranche_2_amount: installments[1],
            tranche_3_amount: installments[2],
          })
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await this.client
          .from("grade_level_tuition")
          .insert({
            pricing_config_id: cfgId,
            academic_level_id: level.id,
            annual_amount: annualAmount,
            tranche_1_amount: installments[0],
            tranche_2_amount: installments[1],
            tranche_3_amount: installments[2],
          });
        if (error) throw error;
      }
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async updateTransportForDestination(
    destination: TransportDestination,
    annualAmount: number,
    installments: readonly [number, number, number],
    _updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    const sum = installments.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - annualAmount) > 1) {
      return Err(Errors.validation(`La somme des tranches (${sum}) doit égaler le montant annuel (${annualAmount})`));
    }
    if (installments.some((t) => t < 0)) {
      return Err(Errors.validation("Les tranches ne peuvent pas être négatives"));
    }
    try {
      const cfgId = await this.activeConfigId();
      const { data: existing } = await this.client
        .from("transport_destinations")
        .select("id")
        .eq("pricing_config_id", cfgId)
        .eq("code", destination)
        .maybeSingle();
      const row = existing as { id: string } | null;
      if (row) {
        const { error } = await this.client
          .from("transport_destinations")
          .update({
            annual_amount: annualAmount,
            tranche_1_amount: installments[0],
            tranche_2_amount: installments[1],
            tranche_3_amount: installments[2],
          })
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await this.client
          .from("transport_destinations")
          .insert({
            pricing_config_id: cfgId,
            code: destination,
            label_fr: destination,
            annual_amount: annualAmount,
            tranche_1_amount: installments[0],
            tranche_2_amount: installments[1],
            tranche_3_amount: installments[2],
          });
        if (error) throw error;
      }
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  // ---- Complementary services ----------------------------------------------

  async addComplementaryService(
    input: { label: string; qualifier: string; semesterAmount: number; annualAmount: number },
    _updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    if (input.semesterAmount < 0 || input.annualAmount < 0) {
      return Err(Errors.validation("Les montants ne peuvent pas être négatifs"));
    }
    if (input.annualAmount < input.semesterAmount) {
      return Err(Errors.validation("Le montant annuel doit être ≥ au montant semestriel"));
    }
    try {
      const cfgId = await this.activeConfigId();
      const { error } = await this.client
        .from("complementary_services")
        .insert({
          pricing_config_id: cfgId,
          code: input.qualifier,
          label_fr: input.label,
          semester_amount: input.semesterAmount,
          annual_amount: input.annualAmount,
          is_active: true,
        });
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async removeComplementaryService(id: string, _updatedBy: string): Promise<Result<PricingConfig>> {
    if (!isUuid(id)) {
      return Err(Errors.notFound("Service complémentaire", id));
    }
    try {
      const { error } = await this.client
        .from("complementary_services")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  // ---- Additional services --------------------------------------------------

  async addAdditionalService(
    input: { label: string; amount: number },
    _updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    try {
      const cfgId = await this.activeConfigId();
      const code = `svc_${Date.now()}`;
      const { error } = await this.client
        .from("additional_services")
        .insert({
          pricing_config_id: cfgId,
          code,
          label_fr: input.label,
          amount: input.amount,
          is_active: true,
        });
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async removeAdditionalService(id: string, _updatedBy: string): Promise<Result<PricingConfig>> {
    if (!isUuid(id)) {
      return Err(Errors.notFound("Service additionnel", id));
    }
    try {
      const { error } = await this.client
        .from("additional_services")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  // ---- Discounts -------------------------------------------------------------

  async addDiscount(
    input: { label: string; amount: number; discountType: DiscountType; discountCode?: DiscountCode },
    _updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    try {
      const cfgId = await this.activeConfigId();
      const code = input.discountCode ?? "custom";
      // DB stores positive amounts for both types (the read mapping negates
      // fixed_amount back to the domain convention).
      const dbAmount = Math.abs(input.amount);
      const { error } = await this.client
        .from("discounts")
        .insert({
          pricing_config_id: cfgId,
          code,
          label_fr: input.label,
          discount_type: input.discountType,
          amount: dbAmount,
          applies_to: "total",
          is_active: true,
        });
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async removeDiscount(id: string, _updatedBy: string): Promise<Result<PricingConfig>> {
    if (!isUuid(id)) {
      return Err(Errors.notFound("Remise", id));
    }
    try {
      const { error } = await this.client
        .from("discounts")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return this.afterWrite();
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }
}
