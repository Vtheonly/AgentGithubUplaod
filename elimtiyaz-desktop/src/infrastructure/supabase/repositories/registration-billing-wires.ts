/**
 * T-437 (BUSINESS-109 / INV-25a — ADR-031 §4): the ONE shared billing-wire
 * builder. EXTRACTED verbatim from `SupabaseStudentRepository.batchRegister`
 * (the T-397/T-398 wire construction) so the re-enrollment path reuses the
 * EXACT `register_family_batch` / `fn_re_enroll_student` wire shapes — never
 * a second builder (the no-parallel-implementation rule, §6/§9).
 *
 * E2.4 (2026-11-22): the AMOUNTS now come from the ONE domain engine —
 * `domain/calc/pricing/devis.ts` `computeStudentDevisPlan` on the per-year
 * `pricingBasis` (DUP-001's consolidation; the mock batchRegister consumes
 * the SAME plans — mock and live produce the SAME installment plan for the
 * same wizard input, DUP-037 dead). What changed vs the pre-E2.4 builder:
 *   - the per-student FI is charged PER STUDENT (per-grade amounts — the
 *     workbook's R-column model) instead of the flat family-level fee;
 *   - the tuition tranches are the era's STICKERS (V1 − remise / 2V / v3 —
 *     era B folding the FI into V1) instead of the 40/30/30 proportional
 *     split of the discounted net (the double-discounting family, DUP-001);
 *   - a year resolving to era B (2027+) prices on the era-B basis — the
 *     passed global config (an era-A seed) never overwrites it (R-2); the
 *     year-scoped config override lane is T-587/ADR-025's (yearPricingConfigs).
 * The wire FIELD contract (the RPC payload shapes) is unchanged.
 *
 * Two callers, one implementation:
 *   1. `batchRegister` — the new-family wizard (prefix `reg`, the FI labeled
 *      « nouvelle famille », bare source ids).
 *   2. the re-enrollment repository — a continuing student entering a new
 *      academic year (prefix `re-<target-year-code>`, the FI labeled
 *      « réinscription », YEAR-SCOPED source ids so a second re-enrollment
 *      into a later year can never collide on the ledger's source_uidx —
 *      the installment identity is the 0129 year-scoped index, source_id is
 *      provenance).
 */
import type { PaymentPlan } from "../../../domain/model/payment";
import type {
  PricingConfig,
} from "../../../domain/model/pricing";
import type { TransportDestination } from "../../../domain/model/parent";
import type { GradeLevel } from "../../../domain/model/student";
import {
  computeStudentDevisPlan,
  resolveDevisPricingBasis,
} from "../../../domain/calc/pricing/devis";
import { createChargeEntry } from "../../../domain/calc/ledger/entries";
import { toIsoDate } from "../../../core/format/date";
import { getOfficialTuitionDueDates } from "../../../domain/calc/pricing/tuition";


/** One student's billing inputs (the merged wizard/`CreateStudentInput` shape). */
export interface BillingWireStudent {
  /** The deterministic student code (the identity token the wires carry). */
  readonly studentCode: string;
  /** The 0-based payload index — the `student_ref` the wires reference. */
  readonly studentRef: number;
  readonly gradeLevel: GradeLevel;
  readonly paymentPlan: PaymentPlan | null;
  /** Student-level transport destination override (null = the parent's). */
  readonly transportTier: string | null;
  /** CALC-001: the negotiated remise (DZD). */
  readonly remise: number;
  /** CALC-001: the sticker-price case (remise recorded, not subtracted). */
  readonly chargeStickerPrice: boolean;
}

export interface BuildBillingWiresInput {
  readonly tenantId: string;
  /** The parent identity token (code placeholder — the server fills the uuid). */
  readonly parentCode: string;
  readonly students: readonly BillingWireStudent[];
  readonly pricingConfig: PricingConfig;
  readonly includeRegistration: boolean;
  readonly includeTransport: boolean;
  /** Calendar year the academic year starts (due dates + discount windows). */
  readonly year: number;
  /** ISO timestamp of the operation (the charge entries' `at`). */
  readonly at: string;
  /** The parent-level transport destination (the student override wins). */
  readonly parentTransportDestination: TransportDestination | null;
  /**
   * T-437: the source-id scope — `{ prefix, yearCode }`. Omitted/null = the
   * historical batch shape (`reg-…` ledger ids, bare installment ids). The
   * re-enrollment path passes `{ prefix: "re-2027-2028", yearCode: "2027-2028" }`
   * so every identity token is year-scoped.
   */
  readonly sourceIdScope?: { readonly prefix: string; readonly yearCode: string } | null;
  /**
   * T-437: the FI description override (the re-enrollment's
   * « Frais d'inscription 2027-2028 (réinscription) » vs the batch's
   * « (nouvelle famille) »). Omitted = the batch label.
   */
  readonly feeDescription?: string | null;
}

export interface BillingWires {
  readonly ledgerWire: readonly Record<string, unknown>[];
  readonly installmentWire: readonly Record<string, unknown>[];
}

/**
 * Build the per-student billing wires (the FI + tuition tranches + transport
 * tranches) — the EXACT register_family_batch shapes, AMOUNTED by the ONE
 * domain devis engine on the per-year pricing basis. Pure and deterministic:
 * same inputs → same wires (idempotent retries converge).
 */
export function buildRegistrationBillingWires(
  input: BuildBillingWiresInput,
): BillingWires {
  const {
    tenantId,
    parentCode,
    students,
    pricingConfig,
    includeRegistration,
    includeTransport,
    year,
    at,
    parentTransportDestination,
  } = input;
  const scope = input.sourceIdScope ?? null;
  // The source-id stem: the batch path keeps its historical bare/`reg-`
  // tokens; the re-enrollment path scopes EVERY token by the target year.
  const ledgerStem = scope ? `${scope.prefix}` : "reg";
  const installmentStem = scope ? `${scope.prefix}` : "";

  const ledgerWire: Record<string, unknown>[] = [];
  const installmentWire: Record<string, unknown>[] = [];
  const [due1, due2, due3] = getOfficialTuitionDueDates(year);
  const basis = resolveDevisPricingBasis(year);
  // Era A: the passed config is the year's config of record (the default seed
  // and the DB's active config ARE the 2026-2027 numbers — its populated rows
  // win, today's precedence). Era B: the basis IS the 2027-2026 pricing of
  // record (R-2) — the GLOBAL config (an era-A seed) must never overwrite it;
  // the year-scoped config lane arrives with T-587/ADR-025 (yearPricingConfigs).
  const effectiveConfig = basis.academicYearStartYear === 2026 ? pricingConfig : null;

  const pushLedgerRow = (e: ReturnType<typeof createChargeEntry>, studentRef: number | null) => {
    ledgerWire.push({
      student_ref: studentRef,
      entry_number: e.id,
      entry_type: e.type,
      amount: e.amount,
      category: e.category,
      description: e.description,
      entry_date: toIsoDate(e.at) ?? at,
      source_type: e.sourceType,
      source_id: e.sourceId,
      method: e.method,
      receipt_number: e.receiptNumber,
      payment_status: e.paymentStatus,
      reverses_id: e.reversesId,
      actor_id: e.actorId,
      actor_name: e.actorName,
      at: toIsoDate(e.at),
      metadata: e.metadata as Record<string, string | number | boolean | null> | null,
    });
  };

  for (const sInput of students) {
    const { studentCode, studentRef } = sInput;
    const destination =
      (sInput.transportTier as TransportDestination | null) ?? parentTransportDestination;
    const plan = computeStudentDevisPlan(
      {
        gradeLevel: sInput.gradeLevel,
        remise: sInput.remise,
        chargeStickerPrice: sInput.chargeStickerPrice,
        transportDestination: destination,
        includeTransport,
        pricingConfig: effectiveConfig,
      },
      basis,
      { includeRegistration },
    );

    // ── The per-student FI (era A / unfolded worlds; the workbook's per-row
    // R-column model — PER STUDENT, never a flat family fee) ──
    if (includeRegistration && !plan.fiFoldedIntoFirstTranche && plan.fi > 0) {
      const e = createChargeEntry({
        tenantId,
        parentId: parentCode, // placeholder token — the RPC fills the uuid + account_id
        studentId: null, // the RPC fills the real student uuid
        category: "other",
        amount: plan.fi,
        sourceType: "installment",
        sourceId: `${ledgerStem}-${studentCode}-fi`,
        description:
          input.feeDescription ?? `Frais d'inscription ${year} (nouvelle famille)`,
        actorId: "system",
        actorName: "Inscription groupée",
        at,
        metadata: { type: "registration_fee", gradeLevel: sInput.gradeLevel },
      });
      pushLedgerRow(e, studentRef);
      installmentWire.push({
        student_ref: studentRef,
        category: "other",
        tranche_number: 0,
        label: "Frais d'inscription (FI)",
        amount_due: plan.fi,
        amount_paid: 0,
        amount_pending: 0,
        due_date: due1,
        paid_date: null,
        status: "unpaid",
        academic_cycle: null,
        payment_plan: sInput.paymentPlan ?? "tranches",
        is_custom_schedule: false,
        custom_schedule_note: null,
        source_type: "bulk_import",
        source_id: installmentStem
          ? `${installmentStem}-${studentCode}:fi`
          : `${studentCode}:fi`,
      });
    }

    // ── The tuition tranches (the era's stickers — V1 − remise / 2V / v3;
    // era B folds the FI into V1) ──
    if (plan.scolarite > 0 || plan.fi > 0) {
      const amounts =
        sInput.paymentPlan === "full_annual"
          ? [plan.tuitionTranches[0] + plan.tuitionTranches[1] + plan.tuitionTranches[2]]
          : [...plan.tuitionTranches];
      const dues = sInput.paymentPlan === "full_annual" ? [due1] : [due1, due2, due3];
      for (let t = 0; t < amounts.length; t++) {
        const e = createChargeEntry({
          tenantId,
          parentId: parentCode, // placeholder token — the RPC fills the uuid + account_id
          studentId: null, // the RPC fills the real student uuid
          category: "tuition",
          amount: amounts[t],
          sourceType: "installment",
          sourceId: `${ledgerStem}-${studentCode}-t${t + 1}`,
          description: `Scolarité ${year} — Tranche ${t + 1} (${sInput.gradeLevel})`,
          actorId: "system",
          actorName: "Inscription groupée",
          at,
          metadata: {
            tranche: t + 1,
            gradeLevel: sInput.gradeLevel,
            paymentPlan: sInput.paymentPlan ?? "tranches",
            // DATA-028: the negotiated remise travels with the charge.
            remise: plan.remise,
            remiseAppliedToDevis: plan.remiseAppliedToDevis,
            fiFoldedIntoFirstTranche: plan.fiFoldedIntoFirstTranche,
            pricingBasis: plan.basisCode,
          },
        });
        pushLedgerRow(e, studentRef);
        installmentWire.push({
          student_ref: studentRef,
          category: "tuition",
          tranche_number: (t + 1) as 1 | 2 | 3,
          label:
            sInput.paymentPlan === "full_annual"
              ? "Année complète"
              : (["Tranche 1 (V1)", "Tranche 2 (2V)", "Tranche 3 (v3)"] as const)[t],
          amount_due: amounts[t],
          amount_paid: 0,
          amount_pending: 0,
          due_date: dues[t],
          paid_date: null,
          status: "unpaid",
          academic_cycle: null,
          payment_plan: sInput.paymentPlan ?? "tranches",
          is_custom_schedule: false,
          custom_schedule_note: null,
          source_type: "bulk_import",
          source_id: installmentStem
            ? `${installmentStem}-${studentCode}:tuition:T${t + 1}`
            : `${studentCode}:tuition:T${t + 1}`,
        });
      }
    }

    // ── The transport tranches (per town — the basis matrix, the same
    // numbers the config seed carries) ──
    if (includeTransport && destination) {
      for (let t = 0; t < plan.transportTranches.length; t++) {
        if (plan.transportTranches[t] <= 0) continue;
        const e = createChargeEntry({
          tenantId,
          parentId: parentCode,
          studentId: null,
          category: "transport",
          amount: plan.transportTranches[t],
          sourceType: "installment",
          sourceId: `${ledgerStem}-${studentCode}-transport-t${t + 1}`,
          description: `Transport ${year} — Tranche ${t + 1} (${destination})`,
          actorId: "system",
          actorName: "Inscription groupée",
          at,
          metadata: { tranche: t + 1, destination },
        });
        pushLedgerRow(e, studentRef);
        installmentWire.push({
          student_ref: studentRef,
          category: "transport",
          tranche_number: (t + 1) as 1 | 2 | 3,
          label: `Transport T${t + 1}`,
          amount_due: plan.transportTranches[t],
          amount_paid: 0,
          amount_pending: 0,
          due_date: [due1, due2, due3][t],
          paid_date: null,
          status: "unpaid",
          academic_cycle: null,
          payment_plan: sInput.paymentPlan ?? "tranches",
          is_custom_schedule: false,
          custom_schedule_note: null,
          source_type: "bulk_import",
          source_id: installmentStem
            ? `${installmentStem}-${studentCode}:transport:T${t + 1}`
            : `${studentCode}:transport:T${t + 1}`,
        });
      }
    }
  }

  return { ledgerWire, installmentWire };
}

