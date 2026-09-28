/**
 * T-437 (BUSINESS-109 / INV-25a — ADR-031 §4): the ONE shared billing-wire
 * builder. EXTRACTED verbatim from `SupabaseStudentRepository.batchRegister`
 * (the T-397/T-398 wire construction) so the re-enrollment path reuses the
 * EXACT `register_family_batch` / `fn_re_enroll_student` wire shapes — never
 * a second builder (the no-parallel-implementation rule, §6/§9).
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
 *
 * ALL money amounts stay CLIENT-DERIVED (§15.39b — the canonical TS calc
 * engine: evaluateAllSystemDiscounts / splitNetTuitionByOfficialSchedule
 * through the SAME createChargeEntry factory); the server only fills the
 * uuids and stamps the academic year.
 */
import type { PaymentPlan } from "../../../domain/model/payment";
import type {
  PricingConfig,
} from "../../../domain/model/pricing";
import type { TransportDestination } from "../../../domain/model/parent";
import type { GradeLevel } from "../../../domain/model/student";
import {
  evaluateAllSystemDiscounts,
  sumDiscounts,
  splitNetTuitionByOfficialSchedule,
  getOfficialTuitionDueDates,
  tuitionForGradeLevel,
  transportTranchesForDestination,
} from "../../../domain/calc/pricing";
import { createChargeEntry } from "../../../domain/calc/ledger/entries";


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
 * Build the per-student billing wires (tuition tranches + transport tranches
 * + the family-level FI) — the EXACT register_family_batch shapes. Pure and
 * deterministic: same inputs → same wires (idempotent retries converge).
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

  for (const sInput of students) {
    const { studentCode, studentRef } = sInput;
    const gross = tuitionForGradeLevel(pricingConfig, sInput.gradeLevel).annualAmount;
    if (gross > 0) {
      const evals = evaluateAllSystemDiscounts({
        grossTuition: gross,
        previousGradeLevel: null,
        currentGradeLevel: sInput.gradeLevel,
        childIndex: studentRef + 1,
        paymentPlan: sInput.paymentPlan ?? "tranches",
        paymentDate: at,
        academicYearStartYear: year,
        academicYearStart: new Date(Date.UTC(year, 8, 1)).toISOString(),
        // The pre-call equivalent of the created row's enrollment_date (the
        // RPC defaults it to NOW): the discount evaluation sees the same
        // "enrolled today" the post-fetch path did.
        enrollmentDate: at,
        previousRank: null,
      });
      // DATA-028 (T-411, FA-17): the negotiated remise is subtracted from the
      // net BEFORE the official split (the sticker-price case records it
      // without subtracting — the workbook's SEDIKI convention).
      const negotiatedRemise = Math.max(0, Number(sInput.remise) || 0);
      const remiseAppliedToDevis = sInput.chargeStickerPrice ? 0 : negotiatedRemise;
      const net = Math.max(0, gross + sumDiscounts(evals) - remiseAppliedToDevis);
      const amounts =
        sInput.paymentPlan === "full_annual"
          ? [net]
          : [...splitNetTuitionByOfficialSchedule(net)];
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
            remise: negotiatedRemise,
            remiseAppliedToDevis,
          },
        });
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
        installmentWire.push({
          student_ref: studentRef,
          category: "tuition",
          tranche_number: (t + 1) as 1 | 2 | 3,
          label: sInput.paymentPlan === "full_annual" ? "Année complète" : `Tranche ${t + 1}`,
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
    if (includeTransport) {
      const destination =
        (sInput.transportTier as TransportDestination | null) ?? parentTransportDestination;
      if (destination) {
        const tranches = transportTranchesForDestination(pricingConfig, destination);
        for (let t = 0; t < tranches.length; t++) {
          const e = createChargeEntry({
            tenantId,
            parentId: parentCode,
            studentId: null,
            category: "transport",
            amount: tranches[t].amountDue,
            sourceType: "installment",
            sourceId: `${ledgerStem}-${studentCode}-transport-t${t + 1}`,
            description: `Transport ${year} — Tranche ${t + 1} (${destination})`,
            actorId: "system",
            actorName: "Inscription groupée",
            at,
            metadata: { tranche: t + 1, destination },
          });
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
          installmentWire.push({
            student_ref: studentRef,
            category: "transport",
            tranche_number: (t + 1) as 1 | 2 | 3,
            label: `Transport T${t + 1}`,
            amount_due: tranches[t].amountDue,
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
  }

  // The family-level FI (frais d'inscription) — ONE entry for the batch.
  if (includeRegistration && pricingConfig.registrationFee > 0 && students.length > 0) {
    const e = createChargeEntry({
      tenantId,
      parentId: parentCode,
      studentId: null, // family-level fee — no student ref
      category: "other",
      amount: pricingConfig.registrationFee,
      sourceType: "manual_entry",
      sourceId: `${ledgerStem}-${parentCode}-fee`,
      description:
        input.feeDescription ?? `Frais d'inscription ${year} (nouvelle famille)`,
      actorId: "system",
      actorName: "Inscription groupée",
      at,
      metadata: { type: "registration_fee" },
    });
    ledgerWire.push({
      student_ref: null,
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
  }

  return { ledgerWire, installmentWire };
}

/**
 * The shared-repositories' ISO-date convention (supabase-shared-repositories
 * line ~203): a Date → toISOString; a string passes through; null → null.
 * (The core/format/date.ts `toIsoDate` takes a bare `Date` only.)
 */
function toIsoDate(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  return d;
}
