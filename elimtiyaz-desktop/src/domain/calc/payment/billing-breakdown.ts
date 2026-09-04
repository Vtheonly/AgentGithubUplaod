/**
 * Parent billing breakdown — the canonical read-side derivation that powers
 * the "Prestations facturées / Décomposition du prix" surfaces.
 *
 * What it computes (PURE — no IO, no React):
 *   1. The itemized "shopping list" of charge entries per child and the
 *      consolidated per-service totals (`byChild` / `byService`).
 *   2. The tranche coverage schedule — where the family's cleared payments
 *      landed. REAL `installments` rows are authoritative: their
 *      `amount_paid` / `amount_pending` come from the server-side waterfall
 *      (`collect_and_allocate_payment`, migration 0034). Only when a child
 *      has charges but NO physical tranche rows does this module synthesize
 *      the official 40/30/30 schedule (`splitNetTuitionByOfficialSchedule`)
 *      and run the canonical client waterfall
 *      (`allocatePaymentToInstallments`) for DISPLAY purposes — flagged
 *      `isSynthetic: true` so no surface can mistake it for stored data.
 *   3. Adjustment diagnostics (`describeAdjustment`) — the credit/debit
 *      badge + human-readable reason fallback shared by every platform.
 *
 * INVARIANTS honoured (docs/domain/financial-rules.md):
 *   - INV-4: remaining = clampNonNegative(amountDue − amountPaid − amountPending)
 *     — via `installmentRemaining`, never an inline `due − paid`.
 *   - Conservation: Σ synthetic tranche amounts === childBilledTotal (the
 *     official split absorbs the remainder into T3).
 *   - Real installments are never re-allocated client-side: the DB rows are
 *     the source of truth (ADR-002 — server-side canonical writers).
 *
 * Cross-platform parity contract:
 *   - Website port: `src/lib/canonical/billing-breakdown.ts` (elimtiyaz-website).
 *   - Android mirror: `core/BillingBreakdown.kt` (elimtiyaz-android).
 *   All three must produce identical numbers (same test corpus).
 *
 * T-164 (2026-09-05): extracted from the inline implementation that lived in
 * `features/crm/parent-detail-drawer.tsx` (defect class DATA-008 / DUP —
 * financial logic in a presentation component, waterfall ignoring
 * `amountPending`).
 */
import type { LedgerEntry } from "../../model/ledger";
import type {
  AccountAdjustment,
  Installment,
  Payment,
  PaymentCategory,
} from "../../model/payment";
import type { Student } from "../../model/student";
import { GRADE_LEVEL_LABELS_FR } from "../../model/student";
import { clampNonNegative } from "../shared/money";
import { splitNetTuitionByOfficialSchedule, getOfficialTuitionDueDates } from "../pricing/tuition";
import { allocatePaymentToInstallments } from "./waterfall-allocator";
import { installmentRemaining } from "./queries";
import { sumPaidPayments } from "./sums";

/* ============================================================ */
/*  Inputs                                                       */
/* ============================================================ */

/** Academic-year resolution hints injected by the caller (kept pure). */
export interface BillingAcademicYearHints {
  /** Class placement lookup — `(studentId) => "2025-2026" | null`. */
  readonly classAcademicYearOf?: (studentId: string) => string | null | undefined;
  /** The tenant's current academic year code, when known. */
  readonly currentYearCode?: string | null;
  /** Last-resort default (defaults to "2025-2026"). */
  readonly fallback?: string;
}

export interface BillingBreakdownInput {
  /** The family's ledger entries — charge entries are filtered internally. */
  readonly ledgerEntries: readonly LedgerEntry[];
  /** REAL installment rows for the family (empty list allowed). */
  readonly installments: readonly Installment[];
  /** The family's payments (cleared totals derived via `sumPaidPayments`). */
  readonly payments: readonly Payment[];
  /** The family's students. */
  readonly students: readonly Student[];
  /** Optional pre-resolved academic year (skips the internal heuristic). */
  readonly academicYear?: string | null;
  /** Academic-year resolution hints (see `resolveBillingAcademicYear`). */
  readonly hints?: BillingAcademicYearHints;
  /** Class-name lookup injected by the UI layer (presentational only). */
  readonly classLabelOf?: (studentId: string) => string | null | undefined;
  /** Profile-level `totalDue` used only when the ledger has no charge rows. */
  readonly fallbackTotalDue?: number;
}

/* ============================================================ */
/*  Outputs                                                      */
/* ============================================================ */

/** Display status of a tranche coverage node. */
export type TrancheDisplayStatus = "paid" | "partial" | "pending" | "unpaid";

export interface TrancheCoverageNode {
  /** Installment row id, or `syn-{studentId}-{n}` for synthesized tranches. */
  readonly key: string;
  /** The real installment row when `isSynthetic === false`, else null. */
  readonly installment: Installment | null;
  /** True when this node was derived client-side (no physical DB row). */
  readonly isSynthetic: boolean;
  readonly label: string;
  readonly dueDate: string | null;
  /** French due-window label ("Septembre" / "Décembre" / "Mars" / …). */
  readonly dueWindowLabel: string;
  readonly amountDue: number;
  /** Cleared funds on this tranche (INV-4 family). */
  readonly amountPaid: number;
  /** Uncleared non-cash funds on this tranche — real rows only. */
  readonly amountPending: number;
  /** INV-4: clampNonNegative(amountDue − amountPaid − amountPending). */
  readonly remaining: number;
  /** 0–100, rounded; 100 when fully satisfied. */
  readonly coveragePct: number;
  readonly status: TrancheDisplayStatus;
}

/** One billed line item (a charge ledger entry, human-labelled). */
export interface BillingLineItem {
  readonly id: string;
  readonly label: string;
  readonly category: PaymentCategory;
  readonly amount: number;
}

export interface ChildBillingBreakdown {
  readonly student: Student;
  readonly gradeLabel: string;
  readonly classLabel: string | null;
  /** Σ charges for this child (or estimated share when unattributed). */
  readonly billedTotal: number;
  readonly lineItems: readonly BillingLineItem[];
  readonly tranches: readonly TrancheCoverageNode[];
  readonly tranchesRemaining: number;
  /** True when the child had charges but no physical tranche rows. */
  readonly isSyntheticSchedule: boolean;
}

export interface ServiceTotalNode {
  readonly category: PaymentCategory;
  readonly label: string;
  readonly amount: number;
  readonly count: number;
}

export interface ParentBillingBreakdown {
  readonly academicYear: string;
  /** Σ charge entries; falls back to `fallbackTotalDue` when none exist. */
  readonly totalBilled: number;
  /** `sumPaidPayments(payments)` — cleared money only (canonical helper). */
  readonly totalClearedPaid: number;
  /** True when at least one child runs on a synthesized schedule. */
  readonly hasSyntheticTranches: boolean;
  readonly byChild: readonly ChildBillingBreakdown[];
  readonly byService: readonly ServiceTotalNode[];
}

/** Adjustment diagnostic shared by every platform's adjustments view. */
export interface AdjustmentDiagnostic {
  readonly kind: "credit" | "debit";
  /** "Crédit / Déduction" | "Débit / Majoration". */
  readonly badgeLabel: string;
  /** The stored reason, or a system diagnostic when blank/legacy. */
  readonly reasonLabel: string;
  /** True when the stored reason was blank and a diagnostic was substituted. */
  readonly isDiagnosticFallback: boolean;
}

/* ============================================================ */
/*  Labels (FR — shared across the three platforms)              */
/* ============================================================ */

const FULL_MONTH_LABELS_FR: readonly string[] = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const SERVICE_FALLBACK_LABEL = "Scolarité";
const DEFAULT_ACADEMIC_YEAR = "2025-2026";
const ACADEMIC_YEAR_PATTERN = /20\d{2}[-/]20\d{2}/;

/* ============================================================ */
/*  Academic-year resolution                                     */
/* ============================================================ */

/**
 * Resolve the academic year a family's billing belongs to.
 *
 * Priority: charge metadata → charge description → class placement →
 * tenant's current year → fallback. Pure: class/current lookups are
 * injected by the caller.
 */
export function resolveBillingAcademicYear(
  chargeEntries: readonly LedgerEntry[],
  students: readonly Student[],
  hints: BillingAcademicYearHints = {},
): string {
  for (const c of chargeEntries) {
    if (c.metadata?.academicYear) return String(c.metadata.academicYear);
    const match = c.description?.match(ACADEMIC_YEAR_PATTERN);
    if (match) return match[0];
  }
  for (const s of students) {
    const year = hints.classAcademicYearOf?.(s.id);
    if (year) return year;
  }
  return hints.currentYearCode ?? hints.fallback ?? DEFAULT_ACADEMIC_YEAR;
}

/** Parse the start calendar year out of a "YYYY-YYYY" code (2025-2026 → 2025). */
function startYearOf(academicYear: string): number {
  const parsed = Number.parseInt(academicYear.slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : new Date().getUTCFullYear();
}

/* ============================================================ */
/*  Synthetic tranche synthesis (display-only, canonical split)  */
/* ============================================================ */

/**
 * Build the official 3-tranche schedule for a net annual amount.
 * Uses `splitNetTuitionByOfficialSchedule` (40/30/30, exact conservation)
 * and `getOfficialTuitionDueDates` (Sept 15 / Dec 15 / Mar 15) — the same
 * primitives the batch-registration billing pipeline uses, so a synthesized
 * display schedule is byte-identical to what registration would create.
 */
function synthesizeTranches(
  studentId: string,
  netAnnual: number,
  academicYear: string,
): Installment[] {
  const [t1, t2, t3] = splitNetTuitionByOfficialSchedule(netAnnual);
  const [d1, d2, d3] = getOfficialTuitionDueDates(startYearOf(academicYear));
  const amounts = [t1, t2, t3];
  const dueDates = [d1, d2, d3];
  return amounts.map((amount, i) => ({
    id: `syn-${studentId}-${i + 1}`,
    parentId: "synthetic",
    studentId,
    category: "tuition" as PaymentCategory,
    label: `Tranche ${i + 1}`,
    amountDue: amount,
    amountPaid: 0,
    amountPending: 0,
    dueDate: dueDates[i],
    paidDate: null,
    status: "unpaid" as const,
  }));
}

/** Convert an installment into a coverage view node. */
function toTrancheNode(installment: Installment, isSynthetic: boolean): TrancheCoverageNode {
  const remaining = installmentRemaining(installment);
  const pending = installment.amountPending ?? 0;
  const amountDue = installment.amountDue;
  const coveragePct = amountDue > 0
    ? Math.min(100, Math.round(((installment.amountPaid + pending) / amountDue) * 100))
    : 0;
  let status: TrancheDisplayStatus;
  if (amountDue > 0 && installment.amountPaid >= amountDue) status = "paid";
  else if (installment.amountPaid > 0) status = "partial";
  else if (pending > 0) status = "pending";
  else status = "unpaid";
  const monthLabel = installment.dueDate ? fullMonthLabelOf(installment.dueDate) : "—";
  return {
    key: installment.id,
    installment: isSynthetic ? null : installment,
    isSynthetic,
    label: installment.label,
    dueDate: installment.dueDate,
    dueWindowLabel: monthLabel,
    amountDue,
    amountPaid: installment.amountPaid,
    amountPending: pending,
    remaining,
    coveragePct,
    status,
  };
}

function fullMonthLabelOf(isoDate: string): string {
  const idx = new Date(isoDate).getUTCMonth();
  return idx >= 0 && idx < 12 ? FULL_MONTH_LABELS_FR[idx] : "—";
}

/* ============================================================ */
/*  Main derivation                                             */
/* ============================================================ */

/** Internal mutable sibling of `ChildBillingBreakdown` (frozen once returned). */
interface MutableChildBreakdown {
  student: Student;
  gradeLabel: string;
  classLabel: string | null;
  billedTotal: number;
  lineItems: BillingLineItem[];
  tranches: TrancheCoverageNode[];
  tranchesRemaining: number;
  isSyntheticSchedule: boolean;
}

/**
 * Compute the full parent billing breakdown view model.
 *
 * See the module docstring for the invariants. The function is pure —
 * call it from `useMemo` with repository streams.
 */
export function computeParentBillingBreakdown(
  input: BillingBreakdownInput,
): ParentBillingBreakdown {
  const chargeEntries = input.ledgerEntries.filter((e) => e.type === "charge");

  const academicYear =
    input.academicYear ??
    resolveBillingAcademicYear(chargeEntries, input.students, input.hints ?? {});

  const rawChargeTotal = chargeEntries.reduce((s, c) => s + c.amount, 0);
  const totalBilled = rawChargeTotal > 0 ? rawChargeTotal : (input.fallbackTotalDue ?? 0);

  const totalClearedPaid = sumPaidPayments(input.payments);
  const students = input.students;

  // Real installments already carry server-side waterfall results
  // (amountPaid/amountPending). Reserve that money: only the residual
  // cleared payments may feed the display waterfall over synthesized
  // tranches, otherwise money would be counted as covering both a real
  // tranche and a synthetic one.
  const realPaidOnInstallments = input.installments.reduce(
    (s, i) => s + (i.amountPaid ?? 0),
    0,
  );
  const syntheticPool = clampNonNegative(totalClearedPaid - realPaidOnInstallments);

  // -------- Per-child derivation (mutable during computation, frozen in
  // the returned view model) --------
  const syntheticBatches: Array<{ studentId: string; batch: Installment[] }> = [];
  const children: MutableChildBreakdown[] = students.map((student) => {
    let childCharges = chargeEntries.filter((c) => c.studentId === student.id);
    if (childCharges.length === 0 && students.length === 1 && chargeEntries.length > 0) {
      childCharges = chargeEntries;
    }
    const childBilledTotal =
      childCharges.length > 0
        ? childCharges.reduce((s, c) => s + c.amount, 0)
        : students.length === 1
          ? totalBilled
          : // Multi-child family with no per-student attribution: honest
            // equal-share estimate, clearly flagged via the synthetic path.
            Math.round(totalBilled / Math.max(1, students.length));

    const lineItems: BillingLineItem[] = childCharges.map((c) => ({
      id: c.id,
      label: c.description,
      category: c.category,
      amount: c.amount,
    }));

    // Real tranches for this child (direct attribution; family-level rows
    // only apply for a single-child family — legacy/mock compat).
    let realForChild = input.installments.filter((i) => i.studentId === student.id);
    if (realForChild.length === 0 && students.length === 1) {
      const familyLevel = input.installments.filter((i) => i.studentId == null);
      if (familyLevel.length > 0) realForChild = familyLevel;
    }

    const gradeLabel = student.gradeLevel
      ? (GRADE_LEVEL_LABELS_FR[student.gradeLevel] ?? student.gradeLevel)
      : legacyLevelLabel(student.level);
    const classLabel = input.classLabelOf?.(student.id) ?? null;

    if (realForChild.length > 0 || childBilledTotal <= 0) {
      const tranches = realForChild
        .slice()
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
        .map((i) => toTrancheNode(i, false));
      return {
        student,
        gradeLabel,
        classLabel,
        billedTotal: childBilledTotal,
        lineItems,
        tranches,
        tranchesRemaining: tranches.reduce((s, t) => s + t.remaining, 0),
        isSyntheticSchedule: false,
      };
    }

    // Synthesis path — display-only 40/30/30 schedule.
    const batch = synthesizeTranches(student.id, childBilledTotal, academicYear);
    syntheticBatches.push({ studentId: student.id, batch });
    return {
      student,
      gradeLabel,
      classLabel,
      billedTotal: childBilledTotal,
      lineItems,
      tranches: [], // filled after the single global waterfall run below
      tranchesRemaining: 0,
      isSyntheticSchedule: true,
    };
  });

  // -------- Display waterfall over ALL synthetic tranches at once --------
  // One canonical `allocatePaymentToInstallments` call guarantees global
  // chronological ordering (oldest due date first) across children — the
  // inline drawer version allocated child-by-child in list order instead.
  if (syntheticBatches.length > 0) {
    const allSynthetic = syntheticBatches.flatMap((b) => b.batch);
    const allocation = allocatePaymentToInstallments(
      allSynthetic,
      syntheticPool,
      undefined,
      "paid",
    );
    const paidByInstallmentId = new Map(
      allocation.allocations.map((a) => [a.installmentId, a.newAmountPaid]),
    );
    for (const child of children) {
      if (!child.isSyntheticSchedule) continue;
      const batch = syntheticBatches.find((b) => b.studentId === child.student.id)?.batch ?? [];
      const tranches = batch.map((i) =>
        toTrancheNode(
          { ...i, amountPaid: paidByInstallmentId.get(i.id) ?? 0 },
          true,
        ),
      );
      child.tranches = tranches;
      child.tranchesRemaining = tranches.reduce((s, t) => s + t.remaining, 0);
    }
  }

  // -------- Per-service consolidation --------
  const byService = summarizeByService(chargeEntries, totalBilled, students.length);

  return {
    academicYear,
    totalBilled,
    totalClearedPaid,
    hasSyntheticTranches: children.some((c) => c.isSyntheticSchedule),
    byChild: children,
    byService,
  };
}

function summarizeByService(
  chargeEntries: readonly LedgerEntry[],
  totalBilled: number,
  studentCount: number,
): ServiceTotalNode[] {
  const map = new Map<PaymentCategory, ServiceTotalNode>();
  for (const c of chargeEntries) {
    const label = SERVICE_LABELS_FR[c.category] ?? SERVICE_FALLBACK_LABEL;
    const existing = map.get(c.category);
    if (existing) {
      map.set(c.category, {
        ...existing,
        amount: existing.amount + c.amount,
        count: existing.count + 1,
      });
    } else {
      map.set(c.category, { category: c.category, label, amount: c.amount, count: 1 });
    }
  }
  if (map.size === 0 && totalBilled > 0) {
    return [
      {
        category: "tuition",
        label: "Scolarité Annuelle",
        amount: totalBilled,
        count: studentCount,
      },
    ];
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** FR labels for service categories (domain-level, shared by platforms). */
export const SERVICE_LABELS_FR: Record<PaymentCategory, string> = {
  tuition: "Scolarité",
  transport: "Transport",
  canteen: "Cantine",
  uniform: "Tenue / Uniforme",
  books: "Fournitures & Livres",
  extracurricular: "Activités parascolaires",
  therapy_psychology: "Accompagnement psychologique",
  therapy_speech: "Orthophonie",
  second_apron: "Deuxième tablier",
  parent_credit: "Crédit parent",
  other: "Autres prestations",
};

function legacyLevelLabel(level: string): string {
  if (level === "primaire") return "Primaire";
  if (level === "cem") return "CEM";
  if (level === "lycee") return "Lycée";
  return level;
}

/* ============================================================ */
/*  Adjustment diagnostics                                       */
/* ============================================================ */

/**
 * Derive the adjustment badge + human-readable reason.
 *
 * Ledger convention (see `createAdjustmentEntry` and the Supabase adjust()
 * writer): negative amounts are credits/remises (reduce what the family
 * owes), positive amounts are debits/majorations (add debt, e.g. a
 * discount reversal).
 *
 * When the stored reason is blank (legacy system entries), a diagnostic
 * fallback is substituted and flagged so the UI can style it differently
 * from a real operator note.
 */
export function describeAdjustment(
  adjustment: Pick<AccountAdjustment, "amount" | "reason">,
): AdjustmentDiagnostic {
  const isCredit = adjustment.amount < 0;
  const storedReason = adjustment.reason?.trim();
  const hasReason = !!storedReason && storedReason.length > 0;
  return {
    kind: isCredit ? "credit" : "debit",
    badgeLabel: isCredit ? "Crédit / Déduction" : "Débit / Majoration",
    reasonLabel: hasReason
      ? storedReason
      : isCredit
        ? "Déduction / remise enregistrée automatiquement par le système (motif non documenté)"
        : "Régularisation / rétablissement de dette (contrepassation automatique, motif non documenté)",
    isDiagnosticFallback: !hasReason,
  };
}
