/**
 * service-pricing-profile.ts — T-334 (59th session, DATA-016): the DESKTOP
 * half of the exhaustive per-service pricing profile.
 *
 * The owner's mandate (2026-09-13): "every single minute detail of what the
 * price covers: which year, which level, the tranche framework, every
 * included service, every condition, every component that contributes to the
 * final price, and the entire process… structured and detailed enough that
 * the engine cannot misinterpret, translate, or incorrectly reconstruct the
 * profile and price when displaying or processing a student's purchase
 * history."
 *
 * OUTPUT PARITY: this module produces the SAME `ServicePricingProfile` node
 * shapes as the website's `src/lib/canonical/service-pricing-profile.ts`
 * (T-333) — identical field names, identical semantics — so a parent reading
 * the portal and a staff member reading the drawer see the same exhaustive
 * profile for the same family. The INPUT adapters differ by platform (this
 * one consumes the desktop domain models: LedgerEntry / Installment /
 * Student / PricingConfig); the parallel test suites pin the SAME vectors
 * (the LIVE ALIOUAT family: 4am, devis 350 000 vs catalog 340 000, FI/V2/2V
 * schedule, remise −20 000, Excel import provenance).
 *
 * Tranche due-months: the DB grid (grade_level_tuition.tranche_*_month) is
 * the truth — three live variants exist (9/1/5, 9/12/3, 9/12/4). The domain
 * `TuitionPricing`/`TransportPricing` carry `installmentMonths` when the
 * repository mapped them (T-334); when absent the canonical Prices.md
 * template [9, 12, 3] (Sept 15 / Dec 15 / Mar 15) applies — same fallback
 * the desktop's due-date templates use.
 *
 * Pure functions, no IO.
 */

import type { LedgerEntry } from "../../model/ledger";
import type { Installment, PaymentCategory } from "../../model/payment";
import type { Student, GradeLevel } from "../../model/student";
import { GRADE_LEVEL_LABELS_FR } from "../../model/student";
import type {
  PricingConfig,
  PricingEntry,
} from "../../model/pricing";
import { PRICING_CATEGORY_LABELS_FR } from "../../model/pricing";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../model/parent";
import { installmentRemaining } from "./queries";

/* ─── The profile output shape (IDENTICAL to the website's T-333 module) ─── */

/** One catalog tranche: number, amount and the due MONTH (1–12). */
export interface CatalogTrancheNode {
  readonly n: 1 | 2 | 3;
  readonly amount: number;
  readonly dueMonth: number;
}

/** WHO — one child's coverage of the service, with full identity context. */
export interface ChildCoverageNode {
  readonly studentId: string | null;
  readonly studentName: string;
  readonly studentCode: string | null;
  readonly gradeLevelCode: string | null;
  readonly gradeLevelLabel: string | null;
  readonly cycle: string | null;
  readonly classLabel: string | null;
  readonly amount: number;
  readonly itemCount: number;
}

/** Where a billed item came from (the "entire process" leg). */
export interface ChargeProvenance {
  readonly source: "excel_import" | "current_year_wizard" | "reconciliation" | "manual" | "unknown";
  readonly importRunId: string | null;
  readonly reconciliation: string | null;
  readonly excelRow: number | null;
}

/** WHAT — one billed charge line with its decoded context. */
export interface ChargeItemNode {
  readonly id: string;
  readonly studentId: string | null;
  readonly studentName: string;
  readonly amount: number;
  readonly description: string;
  readonly at: string;
  readonly academicYear: string | null;
  readonly gradeLevelCode: string | null;
  readonly trancheNumber: number | null;
  readonly destination: string | null;
  readonly paymentPlan: string | null;
  readonly serviceCode: string | null;
  readonly provenance: ChargeProvenance;
}

/** The official catalog reference the price maps to. */
export interface CatalogReferenceNode {
  readonly kind:
    | "tuition_by_grade"
    | "transport_by_destination"
    | "registration_fee"
    | "additional_service"
    | "complementary_service";
  readonly scopeLabel: string;
  readonly studentId: string | null;
  readonly annualAmount: number | null;
  readonly tranches: readonly CatalogTrancheNode[];
  readonly unitAmount: number | null;
  readonly semesterAmount: number | null;
  readonly billingModel: string | null;
}

/** A condition attached to the price (a rule that can modify it). */
export interface PriceConditionNode {
  readonly kind: "discount_rule" | "early_payment_bonus" | "late_penalty";
  readonly code: string | null;
  readonly label: string;
  readonly value: number;
  readonly valueType: "percentage" | "fixed_dzd";
  readonly deadline: string | null;
  readonly isActive: boolean;
}

/** A reduction actually applied to this service (ledger adjustment row). */
export interface AppliedDiscountNode {
  readonly id: string;
  readonly studentId: string | null;
  readonly studentName: string;
  readonly amount: number;
  readonly label: string;
  readonly reason: string | null;
  readonly at: string;
  readonly provenance: ChargeProvenance;
}

/** The tranche framework — one physical installment row. */
export interface InstallmentScheduleNode {
  readonly installmentId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly label: string;
  readonly trancheNumber: number | null;
  readonly amountDue: number;
  readonly amountPaid: number;
  readonly amountPending: number;
  readonly remaining: number;
  readonly status: string | null;
  readonly dueDate: string | null;
  readonly paymentPlan: string | null;
}

/** The explicit price construction (catalog → gross → net). */
export interface PriceConstructionNode {
  readonly catalogAnnual: number | null;
  readonly billedGross: number;
  readonly discountsTotal: number;
  readonly billedNet: number;
  readonly deltaVsCatalog: number | null;
  readonly hasSyntheticSchedule: boolean;
}

/** The exhaustive per-service pricing profile. */
export interface ServicePricingProfile {
  readonly category: string;
  readonly label: string;
  readonly academicYear: string;
  readonly totalBilled: number;
  readonly count: number;
  readonly childCoverage: readonly ChildCoverageNode[];
  readonly items: readonly ChargeItemNode[];
  readonly catalog: readonly CatalogReferenceNode[];
  readonly conditions: readonly PriceConditionNode[];
  readonly appliedDiscounts: readonly AppliedDiscountNode[];
  readonly installmentPlan: readonly InstallmentScheduleNode[];
  readonly construction: PriceConstructionNode;
}

/* ─── Canonical constants (shared wording with the website module) ──────── */

/** The canonical Prices.md due-month template (Sept / Dec / Mar). */
const CANONICAL_TRANCHE_MONTHS: readonly [number, number, number] = [9, 12, 3];

const ACADEMIC_YEAR_PATTERN = /20\d{2}[-/]20\d{2}/;
const SINGLE_YEAR_PATTERN = /\b(20\d{2})\b/;

/**
 * Grade → cycle map — IDENTICAL to the website module's CYCLE_OF_GRADE
 * (T-333): prescolaire grades map to "prescolaire" (the domain's
 * academicLevelFromGradeLevel folds them into "primaire" — the profile
 * keeps the finer cycle for output parity across platforms).
 */
const CYCLE_OF_GRADE: Record<string, string> = {
  prescolaire_1: "prescolaire",
  prescolaire_2: "prescolaire",
  "1ap": "primaire",
  "2ap": "primaire",
  "3ap": "primaire",
  "4ap": "primaire",
  "5ap": "primaire",
  "1am": "cem",
  "2am": "cem",
  "3am": "cem",
  "4am": "cem",
  "1ere_annee": "lycee",
  "2eme_annee": "lycee",
  "3eme_annee": "lycee",
};

/** "Scolarité" / "Transport" / … — canonical FR category labels. */
const SERVICE_LABEL_FR: Record<string, string> = {
  ...PRICING_CATEGORY_LABELS_FR,
  other: "Autres prestations",
};

/* ─── Metadata decoding (the "entire process" evidence) ─────────────────── */

interface DecodedMetadata {
  academicYear: string | null;
  gradeLevelCode: string | null;
  trancheNumber: number | null;
  destination: string | null;
  paymentPlan: string | null;
  serviceCode: string | null;
  provenance: ChargeProvenance;
}

function decodeMetadata(row: LedgerEntry): DecodedMetadata {
  const meta = row.metadata ?? {};

  const field = typeof meta.field === "string" ? meta.field : null;
  const importRunId = typeof meta.importRunId === "string" ? meta.importRunId : null;
  const reconciliation = typeof meta.reconciliation === "string" ? meta.reconciliation : null;
  const excelRow = typeof meta.excel_row === "number" ? meta.excel_row : null;

  let source: ChargeProvenance["source"] = "unknown";
  if (reconciliation !== null) source = "reconciliation";
  else if (importRunId !== null) source = "excel_import";
  else if (typeof meta.tranche === "number" || typeof meta.gradeLevel === "string") {
    source = "current_year_wizard";
  } else if (row.description && row.description.trim().length > 0 && !field) {
    source = "manual";
  }

  const academicYear =
    typeof meta.academicYear === "string" && meta.academicYear.length > 0
      ? meta.academicYear
      : row.description.match(ACADEMIC_YEAR_PATTERN)?.[0] ??
        (row.description.match(SINGLE_YEAR_PATTERN)?.[1] ?? null);

  return {
    academicYear,
    gradeLevelCode:
      typeof meta.gradeLevel === "string" && meta.gradeLevel.length > 0 ? meta.gradeLevel : null,
    trancheNumber: typeof meta.tranche === "number" ? meta.tranche : null,
    destination:
      typeof meta.destination === "string" && meta.destination.length > 0 ? meta.destination : null,
    paymentPlan:
      typeof meta.paymentPlan === "string" && meta.paymentPlan.length > 0 ? meta.paymentPlan : null,
    serviceCode: field ?? (typeof meta.type === "string" ? meta.type : null),
    provenance: { source, importRunId, reconciliation, excelRow },
  };
}

/* ─── Service-code matching against the catalog (included services) ─────── */

function matchServiceCode(
  description: string,
  decoded: DecodedMetadata,
  catalog: PricingConfig,
): string | null {
  const haystack = `${description} ${decoded.serviceCode ?? ""}`.toLowerCase();
  const candidates: { code: string; label: string }[] = [
    ...catalog.additionalServices.map((s) => ({ code: s.qualifier, label: s.label })),
    ...catalog.complementaryServices.map((s) => ({ code: s.qualifier, label: s.label })),
  ];
  for (const c of candidates) {
    if (decoded.serviceCode && decoded.serviceCode.toLowerCase() === c.code.toLowerCase()) {
      return c.code;
    }
    const short = c.code.replace(/[_\s]/g, "");
    if (short.length >= 3 && haystack.replace(/[_\s-]/g, "").includes(short)) return c.code;
    const labelKey = c.label.toLowerCase();
    if (labelKey.length >= 6 && haystack.includes(labelKey)) return c.code;
  }
  return null;
}

/* ─── Category helpers ───────────────────────────────────────────────────── */

function isRegistrationCategory(rows: readonly LedgerEntry[]): boolean {
  return rows.every(
    (r) =>
      r.metadata?.type === "registration_fee" || /inscription/i.test(r.description ?? ""),
  );
}

function refinedLabel(category: string, chargeRows: readonly LedgerEntry[]): string {
  if (category !== "other") return SERVICE_LABEL_FR[category] ?? SERVICE_LABEL_FR.other;
  return isRegistrationCategory(chargeRows) ? "Inscription" : SERVICE_LABEL_FR.other;
}

/* ─── Tranche node builder (amounts + months) ───────────────────────────── */

function trancheNodesOf(
  installments: readonly [number, number, number] | undefined,
  months: readonly [number, number, number] | undefined,
): CatalogTrancheNode[] {
  if (!installments) return [];
  const m = months ?? CANONICAL_TRANCHE_MONTHS;
  return [
    { n: 1 as const, amount: installments[0], dueMonth: m[0] },
    { n: 2 as const, amount: installments[1], dueMonth: m[1] },
    { n: 3 as const, amount: installments[2], dueMonth: m[2] },
  ];
}

/** Tranche number parsed from the installment label ("Tranche 2" → 2). */
function trancheNumberFromLabel(label: string): number | null {
  const m = label.match(/tranche\s*(\d)/i);
  return m ? Number(m[1]) : null;
}

/* ─── The main derivation ────────────────────────────────────────────────── */

export interface ServicePricingProfileInput {
  readonly ledgerEntries: readonly LedgerEntry[];
  readonly installments: readonly Installment[];
  readonly students: readonly Student[];
  readonly pricingConfig: PricingConfig;
  /** classId → label (the drawer's classLabelOf resolution). */
  readonly classLabelOf?: (studentId: string | null) => string | null;
  /** The academic year context ("2026-2027") — the drawer's resolved year. */
  readonly academicYearContext?: string | null;
  readonly fallbackAcademicYear?: string;
}

/**
 * Derive the exhaustive per-service pricing profiles for a family.
 *
 * Pure: same inputs → same outputs; output-shape-identical to the website's
 * `servicePricingProfiles()` (T-333) so both platforms render the same
 * profile for the same family.
 */
export function servicePricingProfiles(
  input: ServicePricingProfileInput,
): readonly ServicePricingProfile[] {
  const { ledgerEntries, installments, students, pricingConfig } = input;
  const classLabelOf = input.classLabelOf ?? (() => null);
  const fallbackYear = input.fallbackAcademicYear ?? "2025-2026";
  const catalogYear = input.academicYearContext ?? null;

  const chargeRows = ledgerEntries.filter((r) => r.type === "charge");
  const adjustmentRows = ledgerEntries.filter((r) => r.type === "adjustment");

  const nameOf = (studentId: string | null): string => {
    if (studentId == null) return "Famille";
    const k = students.find((x) => x.id === studentId);
    return k ? (k.displayName ?? `${k.firstName} ${k.lastName}`.trim()) : "Famille";
  };

  const gradeInfoOf = (studentId: string | null) => {
    const k = studentId == null ? undefined : students.find((x) => x.id === studentId);
    const code = k?.gradeLevel ?? null;
    return {
      gradeLevelCode: code,
      gradeLevelLabel: code ? (GRADE_LEVEL_LABELS_FR[code] ?? code) : null,
      cycle: code ? (CYCLE_OF_GRADE[code] ?? null) : null,
      classLabel: studentId == null ? null : classLabelOf(studentId),
    };
  };

  // Group the charge rows by category (order: amount desc, like byService).
  const byCategory = new Map<string, LedgerEntry[]>();
  for (const row of chargeRows) {
    const category = row.category ?? "other";
    const list = byCategory.get(category) ?? [];
    list.push(row);
    byCategory.set(category, list);
  }

  const profiles: ServicePricingProfile[] = [];
  for (const [category, rows] of byCategory) {
    const totalBilled = rows.reduce((s, r) => s + r.amount, 0);

    /* WHO — per-child coverage. */
    const coverageMap = new Map<string, ChildCoverageNode>();
    for (const row of rows) {
      const key = row.studentId ?? "__family__";
      const grade = gradeInfoOf(row.studentId);
      const kid = row.studentId == null ? undefined : students.find((x) => x.id === row.studentId);
      const existing = coverageMap.get(key);
      coverageMap.set(key, {
        studentId: row.studentId ?? null,
        studentName: nameOf(row.studentId),
        studentCode: kid?.code ?? null,
        ...grade,
        amount: (existing?.amount ?? 0) + row.amount,
        itemCount: (existing?.itemCount ?? 0) + 1,
      });
    }
    const childCoverage = [...coverageMap.values()].sort((a, b) => b.amount - a.amount);

    /* WHAT — the itemized charge list with decoded context. */
    const items: ChargeItemNode[] = rows.map((row) => {
      const decoded = decodeMetadata(row);
      return {
        id: row.id,
        studentId: row.studentId ?? null,
        studentName: nameOf(row.studentId),
        amount: row.amount,
        description: row.description?.trim() ?? "",
        at: row.at,
        academicYear: decoded.academicYear,
        gradeLevelCode: decoded.gradeLevelCode,
        trancheNumber: decoded.trancheNumber,
        destination: decoded.destination,
        paymentPlan: decoded.paymentPlan,
        serviceCode: matchServiceCode(row.description, decoded, pricingConfig),
        provenance: decoded.provenance,
      };
    });

    /* REFERENCE — the catalog nodes the price maps to. */
    const catalogRefs: CatalogReferenceNode[] = [];
    if (category === "tuition") {
      for (const child of childCoverage) {
        const rowGrade =
          items.find((i) => i.studentId === child.studentId && i.gradeLevelCode)?.gradeLevelCode ??
          null;
        const gradeCode = rowGrade ?? child.gradeLevelCode;
        const entry =
          gradeCode == null ? undefined : pricingConfig.tuitionByGradeLevel[gradeCode as GradeLevel];
        catalogRefs.push({
          kind: "tuition_by_grade",
          scopeLabel: gradeCode
            ? `${GRADE_LEVEL_LABELS_FR[gradeCode as GradeLevel] ?? gradeCode}${child.cycle ? ` (${child.cycle})` : ""}`
            : "—",
          studentId: child.studentId,
          annualAmount: entry?.annualAmount ?? null,
          tranches: trancheNodesOf(entry?.installments, entry?.installmentMonths),
          unitAmount: null,
          semesterAmount: null,
          billingModel: null,
        });
      }
    } else if (category === "transport") {
      const zones = new Set<string>();
      for (const item of items) {
        if (item.destination) zones.add(item.destination);
      }
      for (const zone of zones) {
        const entry = pricingConfig.transportByDestination[zone as keyof typeof pricingConfig.transportByDestination];
        catalogRefs.push({
          kind: "transport_by_destination",
          scopeLabel: TRANSPORT_DESTINATION_LABELS_FR[zone as keyof typeof TRANSPORT_DESTINATION_LABELS_FR] ?? zone,
          studentId: items.find((i) => i.destination === zone)?.studentId ?? null,
          annualAmount: entry?.annualAmount ?? null,
          tranches: trancheNodesOf(entry?.installments, entry?.installmentMonths),
          unitAmount: null,
          semesterAmount: null,
          billingModel: null,
        });
      }
    } else if (category === "other" && isRegistrationCategory(rows)) {
      for (const child of childCoverage) {
        const ownerGrade =
          child.gradeLevelCode ??
          (child.studentId == null && students.length === 1
            ? students[0].gradeLevel
            : null);
        const perGradeFee =
          ownerGrade == null ? undefined : pricingConfig.registrationFeeByGrade[ownerGrade as GradeLevel];
        catalogRefs.push({
          kind: "registration_fee",
          scopeLabel: ownerGrade ? (GRADE_LEVEL_LABELS_FR[ownerGrade as GradeLevel] ?? ownerGrade) : "—",
          studentId: child.studentId,
          annualAmount: perGradeFee ?? pricingConfig.registrationFee,
          tranches: [],
          unitAmount: perGradeFee ?? pricingConfig.registrationFee,
          semesterAmount: null,
          billingModel: "one_time",
        });
      }
    } else {
      // Additional / complementary services → the unit-price references
      // (also the "other" bucket when NOT a registration: PSY/ORTH/…).
      for (const item of items) {
        if (!item.serviceCode) continue;
        const additional = pricingConfig.additionalServices.find(
          (s) => s.qualifier.toLowerCase() === item.serviceCode!.toLowerCase(),
        );
        if (additional) {
          catalogRefs.push({
            kind: "additional_service",
            scopeLabel: additional.label,
            studentId: item.studentId,
            annualAmount: null,
            tranches: [],
            unitAmount: additional.amount,
            semesterAmount: null,
            billingModel: "one_time",
          });
          continue;
        }
        const complementary = pricingConfig.complementaryServices.find(
          (s) => s.qualifier.toLowerCase() === item.serviceCode!.toLowerCase(),
        );
        if (complementary) {
          catalogRefs.push({
            kind: "complementary_service",
            scopeLabel: complementary.label,
            studentId: item.studentId,
            annualAmount: complementary.annualAmount,
            tranches: [],
            unitAmount: null,
            semesterAmount: complementary.semesterAmount,
            billingModel: "per_session",
          });
        }
      }
    }

    /* CONDITIONS — every rule that can modify the price. */
    const conditions: PriceConditionNode[] = pricingConfig.discounts
      .filter((d) => d.isActive)
      .filter((d) => (category === "tuition" ? true : d.discountCode === "sibling_fixed"))
      .map((d) => ({
        kind: "discount_rule" as const,
        code: d.discountCode ?? null,
        label: d.label,
        value: Math.abs(d.amount),
        valueType: d.discountType === "percentage" ? ("percentage" as const) : ("fixed_dzd" as const),
        deadline: null,
        isActive: d.isActive,
      }));
    if (category === "tuition") {
      conditions.push({
        kind: "early_payment_bonus",
        code: "full_annual",
        label: "Paiement annuel avant le 30 juin",
        value: EARLY_PAYMENT_BONUS_PCT,
        valueType: "percentage",
        deadline: EARLY_PAYMENT_DEADLINE,
        isActive: true,
      });
    }
    conditions.push({
      kind: "late_penalty",
      code: null,
      label: "Pénalité de retard",
      value: pricingConfig.latePenaltyPerDay,
      valueType: "fixed_dzd",
      deadline: null,
      isActive: true,
    });

    /* APPLIED DISCOUNTS — the service's credit adjustments. */
    const appliedDiscounts: AppliedDiscountNode[] = adjustmentRows
      .filter((r) => (r.category ?? "other") === category && r.amount < 0)
      .map((r) => {
        const decoded = decodeMetadata(r);
        return {
          id: r.id,
          studentId: r.studentId ?? null,
          studentName: nameOf(r.studentId),
          amount: Math.abs(r.amount),
          label: r.description?.trim() || "Remise",
          reason: r.description?.trim() ?? null,
          at: r.at,
          provenance: decoded.provenance,
        };
      });

    /* THE TRANCHE FRAMEWORK — physical installment rows for this service. */
    const installmentPlan: InstallmentScheduleNode[] = installments
      .filter(
        (i) =>
          (i.category ?? "tuition") === category &&
          (i.studentId == null ||
            childCoverage.some((c) => c.studentId === i.studentId) ||
            students.some((k) => k.id === i.studentId)),
      )
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .map((i) => ({
        installmentId: i.id,
        studentId: i.studentId ?? "",
        studentName: nameOf(i.studentId),
        label: i.label?.trim() || "Tranche",
        trancheNumber: trancheNumberFromLabel(i.label ?? ""),
        amountDue: i.amountDue,
        amountPaid: i.amountPaid,
        amountPending: i.amountPending ?? 0,
        remaining: installmentRemaining(i),
        status: i.status ?? null,
        dueDate: i.dueDate ?? null,
        paymentPlan: i.paymentPlan ?? null,
      }));

    /* CONSTRUCTION — the explicit math. */
    const mappedAnnuals = catalogRefs.map((c) => c.annualAmount).filter((v): v is number => v != null);
    const catalogAnnual =
      catalogRefs.length > 0 && mappedAnnuals.length === catalogRefs.length
        ? mappedAnnuals.reduce((s, v) => s + v, 0)
        : null;
    const billedGross = totalBilled;
    const discountsTotal = appliedDiscounts.reduce((s, d) => s + d.amount, 0);
    const billedNet = billedGross - discountsTotal;
    const deltaVsCatalog = catalogAnnual == null ? null : billedNet - catalogAnnual;
    const hasSyntheticSchedule = rows.length > 0 && installmentPlan.length === 0;

    /* Academic year per service (metadata → description → context → fallback). */
    let academicYear = catalogYear ?? fallbackYear;
    for (const row of rows) {
      const decoded = decodeMetadata(row);
      if (decoded.academicYear) {
        if (ACADEMIC_YEAR_PATTERN.test(decoded.academicYear)) academicYear = decoded.academicYear;
        else if (catalogYear && catalogYear.startsWith(decoded.academicYear)) academicYear = catalogYear;
        else academicYear = decoded.academicYear;
        break;
      }
    }

    profiles.push({
      category,
      label: refinedLabel(category, rows),
      academicYear,
      totalBilled,
      count: rows.length,
      childCoverage,
      items,
      catalog: catalogRefs,
      conditions,
      appliedDiscounts,
      installmentPlan,
      construction: {
        catalogAnnual,
        billedGross,
        discountsTotal,
        billedNet,
        deltaVsCatalog,
        hasSyntheticSchedule,
      },
    });
  }

  return profiles.sort((a, b) => b.totalBilled - a.totalBilled);
}

/* ─── Constants shared with the website module's wording ────────────────── */

/** The early-payment bonus pinned from the workbook (5% scolarité, ≤ June 30). */
const EARLY_PAYMENT_BONUS_PCT = 5;
const EARLY_PAYMENT_DEADLINE = "2026-06-30";
