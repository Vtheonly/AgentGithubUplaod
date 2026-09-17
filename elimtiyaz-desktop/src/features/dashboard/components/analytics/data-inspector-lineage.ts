// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/data-inspector-lineage.ts
// ============================================================================
/**
 * T-389 (INSPECT-500) — the PURE data-lineage resolution engine for the
 * dashboard Data Inspector.
 *
 * Extracted from data-inspector-core.tsx so the resolution logic is:
 *   (a) unit-testable without React rendering;
 *   (b) merge-safe (no user-visible strings for the concurrent i18n pass
 *       to conflict with);
 *   (c) built ENTIRELY on the canonical derivations (§6 reuse-first):
 *         — installmentRemaining (executive-statistics, INV-4)
 *         — installmentsForAcademicYear / inRange / deriveOutstandingDebt
 *           (analytics-derivations — the dashboard's own window semantics)
 *         — daysBetweenFloor + agingBucketFromDays (domain/calc — the
 *           aging-card bucketing)
 *         — evaluateStudentRiskProfiles (operational-query-engine — the
 *           canonical GPA, coefficient-weighted, extracurricular-excluded)
 *         — isRemiseAdjustment (executive-statistics — the live-verified
 *           remise IDENTIFICATION CONTRACT on ledger adjustment entries)
 *         — normalizeTransportTier (domain/calc/pricing — the route keys)
 *
 * THE DEFINITIONAL CONTRACT (the fix this file implements): every metric
 * trigger passes a `sourceValue` computed by the SAME derivation the
 * resolution replays, so `difference = resolvedValue − sourceValue` can
 * only be real data drift — never a definitional disagreement. Each
 * resolution also emits structured per-record lineage (category,
 * categoryLabel, sourceTable, amountKind, sourceId) and formula steps
 * with intermediate values, so the UI can prove WHAT / WHO / HOW MUCH /
 * FOR WHAT / HOW / WHERE / WHY for every displayed number.
 */

import type { Student } from "../../../../domain/model/student";
import type { Parent } from "../../../../domain/model/parent";
import type { AcademicClass, Assessment, AttendanceRecord } from "../../../../domain/model/academic";
import type {
  Payment,
  Installment,
  PaymentMethod,
  PaymentCategory,
  PaymentStatus,
  DebtSummary,
  AgingBucket,
} from "../../../../domain/model/payment";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  AGING_BUCKET_LABELS_FR,
} from "../../../../domain/model/payment";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import { GRADE_LEVEL_LABELS_FR } from "../../../../domain/model/student";
import { agingBucketFromDays } from "../../../../domain/calc/payment/queries";
import { normalizeTransportTier } from "../../../../domain/calc/pricing/transport";
import {
  installmentsForAcademicYear,
  inRange,
} from "./analytics-derivations";
import { installmentRemaining, daysBetweenFloor, isRemiseAdjustment } from "./executive-statistics";
import type { StudentRiskProfile } from "./operational-query-engine";

// ============================================================================
// Public types
// ============================================================================

export type InspectorDomain =
  | "revenue"
  | "debt"
  | "payment-method"
  | "payment-category"
  | "tranche"
  | "enrollment"
  | "attendance"
  | "academic-risk"
  | "service"
  | "transport"
  | "discount";

/**
 * The business meaning of a lineage amount — "what is this number FOR".
 * Every financial row declares its kind so no amount is ever ambiguous
 * (the owner's INSPECT-500 mandate).
 */
export type LineageAmountKind =
  | "payment-received" // money actually collected (payments table)
  | "installment-remaining" // what the family still owes on a tranche (INV-4)
  | "installment-collected" // cleared funds applied to a tranche
  | "installment-due" // the invoiced tranche amount
  | "adjustment-credit" // a negotiated remise / discretionary credit (ledger)
  | "unit-count"; // a count metric (enrollment, attendance records, …)

export const AMOUNT_KIND_LABELS_FR: Record<LineageAmountKind, string> = {
  "payment-received": "Paiement encaissé",
  "installment-remaining": "Reste dû (tranche)",
  "installment-collected": "Encaissé sur tranche",
  "installment-due": "Échéance facturée",
  "adjustment-credit": "Remise / ajustement crédit",
  "unit-count": "Unité (comptage)",
};

/** The live table every value is traceable to — "WHERE it came from". */
export type LineageSourceTable =
  | "payments"
  | "installments"
  | "ledger_entries"
  | "students"
  | "attendance_records"
  | "assessments"
  | "user_profiles";

export interface InspectRequest {
  domain: InspectorDomain;
  title: string;
  metric?: string;
  sourceValue: number;
  filters?: {
    from?: string;
    to?: string;
    /** Single-method filter (backward compatible). */
    method?: PaymentMethod;
    /** Multi-select methods (T-389 — the slicers are multi-select). */
    methods?: readonly PaymentMethod[];
    /** Single-category filter (backward compatible). */
    category?: PaymentCategory;
    /** Multi-select categories (T-389). */
    categories?: readonly PaymentCategory[];
    trancheNumber?: 1 | 2 | 3;
    mode?: "collected" | "remaining";
    classId?: string;
    gradeLevel?: string;
    transportDestination?: string;
    transportMode?: "due" | "collected" | "remaining";
    agingBucket?: AgingBucket;
    /** T-389: attendance semantics — total records (default) or absences. */
    attendanceMode?: "records" | "absences";
    /** T-389: debt scoping — academic-year window (default) or all years. */
    scope?: "academic-year" | "all";
  };
}

export interface LineageContributor {
  key: string;
  name: string;
  code: string;
  phone: string;
  amount: number;
  percentage: number;
  recordCount: number;
  latestDate: string | null;
  lateDays: number;
}

export interface LineageRecord {
  id: string;
  contributorKey: string;
  contributorName: string;
  contributorCode: string;
  contributorPhone: string;
  studentName: string;
  className: string;
  amount: number;
  percentage: number;
  date: string | null;
  description: string;
  status: string;
  reference: string;
  method: string;
  lateDays: number;
  /** T-389 structured lineage — the business meaning of the amount. */
  amountKind: LineageAmountKind;
  /** The canonical financial category (tuition / transport / …), when the row carries one. */
  category: PaymentCategory | null;
  /** French label of the category ("Scolarité", "Transport", …). */
  categoryLabel: string;
  /** The live table the value is traceable to. */
  sourceTable: LineageSourceTable;
  /** The row id in that table (deep-link key). */
  sourceId: string;
  /** One-line "what this amount is for" (e.g. "Transport — Boumerdès · Tranche 2"). */
  detail: string;
}

/** A named intermediate value of the calculation (Σ due, Σ paid, N, …). */
export interface LineageIntermediate {
  label: string;
  value: string;
}

export interface ResolvedInspection {
  request: InspectRequest;
  records: LineageRecord[];
  contributors: LineageContributor[];
  remainderAmount: number;
  remainderCount: number;
  resolvedValue: number;
  difference: number;
  formula: string;
  /** T-389: the calculation as verifiable steps (with intermediates). */
  formulaSteps: string[];
  /** T-389: named intermediate values for the UI's proof panel. */
  intermediates: LineageIntermediate[];
  /** T-389: WHAT the metric measures (the definition line). */
  definition: string;
  /** T-389: the window actually applied, human-readable. */
  windowLabel: string | null;
  /** T-389: the scoping actually applied (year vs all). */
  scopeLabel: string;
  generatedAt: string;
  sourceCounts: Record<string, number>;
}

// ============================================================================
// T-389 — the top-10 contributor color system
// ============================================================================

/**
 * The 10-color contributor palette (INSPECT-500 mandate: "the top 10
 * contributors … each with a different, visually distinct color").
 *
 * Cohesion: the first entries mirror the dashboard's existing chart tokens
 * (brand blue / gold / success / coral / violet / cyan / amber), extended
 * with fuchsia + lime + slate for ten visually distinct hues. The values
 * are static hex (theme-agnostic): the inspector colors must stay STABLE
 * per rank across light/dark surfaces so a contributor keeps its color
 * everywhere — list, amounts, percentages, bars, record dots.
 */
export const INSPECTOR_CONTRIBUTOR_PALETTE: readonly string[] = [
  "#349bd4", // 1 — brand blue
  "#eab308", // 2 — gold
  "#10b981", // 3 — success green
  "#f43f5e", // 4 — coral rose
  "#8b5cf6", // 5 — violet
  "#3dd6d0", // 6 — cyan teal
  "#f59e0b", // 7 — amber
  "#d946ef", // 8 — fuchsia
  "#84cc16", // 9 — lime
  "#3b464c", // 10 — slate
] as const;

/** Neutral color for contributors beyond the top 10 (the "others" tail). */
export const INSPECTOR_NEUTRAL_COLOR = "#94a3b8";

/** The color of a contributor by its 0-based rank (top-10 palette, then neutral). */
export function contributorColor(rank: number): string {
  if (rank >= 0 && rank < INSPECTOR_CONTRIBUTOR_PALETTE.length) {
    return INSPECTOR_CONTRIBUTOR_PALETTE[rank];
  }
  return INSPECTOR_NEUTRAL_COLOR;
}

/** The contributor's color by key, given the rank-ordered contributor list. */
export function contributorColorByKey(
  contributors: readonly LineageContributor[],
  contributorKey: string,
): string {
  const rank = contributors.findIndex((c) => c.key === contributorKey);
  return contributorColor(rank);
}

// ============================================================================
// The resolution engine
// ============================================================================

export interface LineageInput {
  students: readonly Student[];
  parents: readonly Parent[];
  classes: readonly AcademicClass[];
  assessments: readonly Assessment[];
  attendance: readonly AttendanceRecord[];
  payments: readonly Payment[];
  installments: readonly Installment[];
  debts: readonly DebtSummary[];
  ledger: readonly LedgerEntry[];
  academicYear: string;
  range?: { from: string; to: string };
  /**
   * T-389: the canonical risk profiles (evaluateStudentRiskProfiles output).
   * When absent the caller may compute them; the engine NEVER re-derives a
   * second GPA algorithm (the INSPECT-500 parallel-implementation defect).
   */
  riskProfiles?: readonly StudentRiskProfile[];
}

interface InternalRow {
  id: string;
  contributorKey: string;
  contributorName: string;
  contributorCode: string;
  contributorPhone: string;
  studentName: string;
  className: string;
  amount: number;
  date: string | null;
  description: string;
  status: string;
  reference: string;
  method: string;
  lateDays: number;
  amountKind: LineageAmountKind;
  category: PaymentCategory | null;
  sourceTable: LineageSourceTable;
  sourceId: string;
  detail: string;
}

function displayName(parent: Parent | undefined): string {
  if (!parent) return "Famille non résolue";
  return parent.displayName?.trim() || `${parent.firstName} ${parent.lastName}`.trim();
}

function studentLabel(student: Student | undefined): string {
  if (!student) return "—";
  return student.displayName || `${student.firstName} ${student.lastName}`;
}

function fmt(n: number): string {
  return n.toLocaleString("fr-DZ");
}

function matchesMethodFilters(p: Payment, f: InspectRequest["filters"]): boolean {
  if (f?.method && p.method !== f.method) return false;
  if (f?.methods && f.methods.length > 0 && !f.methods.includes(p.method)) return false;
  return true;
}

function matchesCategoryFilters(p: Payment, f: InspectRequest["filters"]): boolean {
  if (f?.category && p.category !== f.category) return false;
  if (f?.categories && f.categories.length > 0 && !f.categories.includes(p.category)) return false;
  return true;
}

function methodFilterLabel(f: InspectRequest["filters"]): string {
  const methods = [
    ...(f?.method ? [f.method] : []),
    ...(f?.methods ?? []),
  ];
  const deduped = [...new Set(methods)];
  if (deduped.length === 0) return "";
  return ` · méthodes [${deduped.map((m) => PAYMENT_METHOD_LABELS_FR[m]).join(", ")}]`;
}

function categoryFilterLabel(f: InspectRequest["filters"]): string {
  const categories = [
    ...(f?.category ? [f.category] : []),
    ...(f?.categories ?? []),
  ];
  const deduped = [...new Set(categories)];
  if (deduped.length === 0) return "";
  return ` · catégories [${deduped.map((c) => PAYMENT_CATEGORY_LABELS_FR[c]).join(", ")}]`;
}

/**
 * The one resolution entry point: replay the metric's canonical derivation
 * over the live streams and return the full lineage (records, contributors,
 * formula steps, intermediates, reconciliation).
 */
export function buildResolution(
  request: InspectRequest,
  input: LineageInput,
): ResolvedInspection {
  const parentMap = new Map(input.parents.map((p) => [p.id, p]));
  const studentMap = new Map(input.students.map((s) => [s.id, s]));
  const classMap = new Map(input.classes.map((c) => [c.id, c]));
  const from = request.filters?.from ?? input.range?.from;
  const to = request.filters?.to ?? input.range?.to;
  const range = from && to ? { from, to } : input.range;

  const rows: InternalRow[] = [];
  const steps: string[] = [];
  const intermediates: LineageIntermediate[] = [];
  let definition = "";
  let scopeLabel = `Année ${input.academicYear}`;
  let windowLabel: string | null = null;
  if (range) windowLabel = `[${range.from} → ${range.to})`;

  const f = request.filters;

  // ---------------------------------------------------------------------
  // Revenue family: payments actually collected (status "paid") in window
  // ---------------------------------------------------------------------
  if (
    request.domain === "revenue" ||
    request.domain === "payment-method" ||
    request.domain === "payment-category" ||
    request.domain === "service"
  ) {
    definition =
      "Somme des paiements ENCAISSÉS (statut « payé ») sur la fenêtre, chaque versement rattaché à sa famille, son élève et sa catégorie financière.";
    if (request.domain === "payment-method") {
      definition += " Le filtre méthode restreint la somme aux canaux sélectionnés.";
    }
    if (request.domain === "payment-category" || request.domain === "service") {
      definition += " Le filtre catégorie restreint la somme aux pôles tarifaires sélectionnés (scolarité, transport, cantine, …).";
    }
    let sumDue = 0;
    for (const payment of input.payments) {
      if (payment.status !== "paid" || !inRange(payment, range)) continue;
      if (!matchesMethodFilters(payment, f)) continue;
      if (!matchesCategoryFilters(payment, f)) continue;
      sumDue += payment.amount;
      const parent = parentMap.get(payment.parentId);
      const student = payment.studentId ? studentMap.get(payment.studentId) : undefined;
      const installment = payment.installmentId
        ? input.installments.find((i) => i.id === payment.installmentId)
        : undefined;
      rows.push({
        id: payment.id,
        contributorKey: payment.parentId,
        contributorName: displayName(parent),
        contributorCode: parent?.code ?? payment.parentId,
        contributorPhone: parent?.phone ?? "—",
        studentName: studentLabel(student),
        className: student?.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: payment.amount,
        date: payment.collectedAt,
        description: installment?.label ?? PAYMENT_CATEGORY_LABELS_FR[payment.category],
        status: PAYMENT_STATUS_LABELS_FR[payment.status],
        reference: payment.receiptNumber,
        method: PAYMENT_METHOD_LABELS_FR[payment.method],
        lateDays: 0,
        amountKind: "payment-received",
        category: payment.category,
        sourceTable: "payments",
        sourceId: payment.id,
        detail: `${PAYMENT_CATEGORY_LABELS_FR[payment.category]}${installment ? ` · ${installment.label}` : ""}${payment.installmentId ? "" : " · sans tranche rattachée"}`,
      });
    }
    steps.push(`Fenêtre : paiements collectés entre ${range ? `${range.from}T00:00 inclus et ${range.to}T00:00 EXCLU (convention [from, to))` : "— sans fenêtre : tout l'historique —"}.`);
    steps.push(`Filtre statut : payments.status = « paid » (les chèques non encaissés « pending » sont exclus).`);
    if (methodFilterLabel(f)) steps.push(`Filtre${methodFilterLabel(f)}.`);
    if (categoryFilterLabel(f)) steps.push(`Filtre${categoryFilterLabel(f)}.`);
    steps.push(`Agrégation : Σ payments.amount sur ${rows.length} versement(s) = ${fmt(sumDue)} DZD.`);
    intermediates.push({ label: "Versements retenus", value: String(rows.length) });
    intermediates.push({ label: "Σ montants", value: `${fmt(sumDue)} DZD` });
  }

  // ---------------------------------------------------------------------
  // Debt family: what families still owe (INV-4 remaining)
  // ---------------------------------------------------------------------
  else if (request.domain === "debt" || request.domain === "tranche") {
    const scope = f?.scope ?? "academic-year";
    const scoped =
      scope === "all"
        ? [...input.installments]
        : installmentsForAcademicYear(input.installments, input.academicYear);
    scopeLabel = scope === "all" ? "Toutes années (flux installments complet)" : `Année ${input.academicYear} (fenêtre de facturation)`;
    definition =
      request.domain === "debt"
        ? "Somme des RESTES DUS par tranche : max(0, amountDue − amountPaid − amountPending) sur les échéances non soldées (statut ≠ « payé »). Les fonds non encaissés (chèques en attente) réduisent le reste dû sans le solder (INV-4)."
        : "Restes dus (ou montants encaissés selon le mode) restreints à un numéro de vague (tranche 1 / 2 / 3).";

    const mode = f?.mode ?? "remaining";
    let sumDue = 0;
    let sumPaid = 0;
    let sumPending = 0;
    for (const installment of scoped) {
      if (installment.status === "paid") continue;
      if (request.domain === "tranche" && f?.trancheNumber && installment.trancheNumber !== f.trancheNumber) continue;
      const remaining = installmentRemaining(installment);
      if (request.domain === "debt" && remaining <= 0) continue;
      const amount =
        request.domain === "tranche" && mode === "collected"
          ? installment.amountPaid
          : remaining;
      if (amount <= 0) continue;
      if (f?.agingBucket) {
        // The aging-card computation, mirrored exactly (debtByAgingForRange):
        // daysOverdue = floor((now − dueDate)/day), negative for not-yet-due
        // tranches → they land in the 0_30 bucket (the "current" bucket).
        const daysOverdue = daysBetweenFloor(installment.dueDate, Date.now());
        if (agingBucketFromDays(daysOverdue) !== f.agingBucket) continue;
      }
      sumDue += installment.amountDue;
      sumPaid += installment.amountPaid;
      sumPending += installment.amountPending;
      const parent = parentMap.get(installment.parentId);
      const student = installment.studentId ? studentMap.get(installment.studentId) : undefined;
      const overdueDays = Math.max(0, daysBetweenFloor(installment.dueDate, Date.now()));
      rows.push({
        id: installment.id,
        contributorKey: installment.parentId,
        contributorName: displayName(parent),
        contributorCode: parent?.code ?? installment.parentId,
        contributorPhone: parent?.phone ?? "—",
        studentName: studentLabel(student),
        className: student?.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount,
        date: mode === "collected" ? installment.paidDate : installment.dueDate,
        description: installment.label,
        status: PAYMENT_STATUS_LABELS_FR[installment.status as PaymentStatus] ?? installment.status,
        reference: installment.id,
        method: PAYMENT_CATEGORY_LABELS_FR[installment.category],
        lateDays: installment.status === "overdue" ? overdueDays : 0,
        amountKind: mode === "collected" ? "installment-collected" : "installment-remaining",
        category: installment.category,
        sourceTable: "installments",
        sourceId: installment.id,
        detail: `${PAYMENT_CATEGORY_LABELS_FR[installment.category]} · ${installment.label} · reste ${fmt(remaining)} / dû ${fmt(installment.amountDue)}`,
      });
    }
    steps.push(`Périmètre : installments.statut ≠ « paid »${request.domain === "tranche" && f?.trancheNumber ? ` · vague ${f.trancheNumber}` : ""} · ${scopeLabel}${request.domain === "tranche" && mode === "collected" ? " · mode ENCAISSÉ (amountPaid, fonds clarifiés)" : " · mode RESTE DÛ"}.`);
    if (f?.agingBucket) {
      steps.push(`Filtre sénescence : bucket ${AGING_BUCKET_LABELS_FR[f.agingBucket]} (calcul identique à la carte de vieillissement — les échéances non échues tombent dans « 0–30 j »).`);
    }
    steps.push(`Formule par échéance : reste = max(0, amountDue − amountPaid − amountPending) (INV-4 — les fonds en attente réduisent le reste sans le solder).`);
    steps.push(`Intermédiaires : Σ dû = ${fmt(sumDue)} · Σ payé = ${fmt(sumPaid)} · Σ en attente = ${fmt(sumPending)} DZD.`);
    steps.push(`Agrégation : Σ restes sur ${rows.length} échéance(s) = ${fmt(rows.reduce((s, r) => s + r.amount, 0))} DZD.`);
    intermediates.push({ label: "Échéances retenues", value: String(rows.length) });
    intermediates.push({ label: "Σ amountDue", value: `${fmt(sumDue)} DZD` });
    intermediates.push({ label: "Σ amountPaid", value: `${fmt(sumPaid)} DZD` });
    intermediates.push({ label: "Σ amountPending", value: `${fmt(sumPending)} DZD` });
  }

  // ---------------------------------------------------------------------
  // Enrollment: the live student roster
  // ---------------------------------------------------------------------
  else if (request.domain === "enrollment") {
    definition =
      "Nombre d'élèves du catalogue live (flux « students » non supprimés — soft-delete exclu), filtrable par classe et niveau.";
    for (const student of input.students) {
      if (f?.classId && student.classId !== f.classId) continue;
      if (f?.gradeLevel && student.gradeLevel !== f.gradeLevel) continue;
      const parent = parentMap.get(student.parentId);
      rows.push({
        id: student.id,
        contributorKey: student.parentId,
        contributorName: displayName(parent),
        contributorCode: student.code,
        contributorPhone: parent?.phone ?? "—",
        studentName: studentLabel(student),
        className: student.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: 1,
        date: student.updatedAt,
        description: GRADE_LEVEL_LABELS_FR[student.gradeLevel],
        status: student.status,
        reference: student.code,
        method: "Effectif",
        lateDays: 0,
        amountKind: "unit-count",
        category: null,
        sourceTable: "students",
        sourceId: student.id,
        detail: `Élève ${student.code} · ${student.status}`,
      });
    }
    steps.push(`Source : flux « students » (tenant, deleted_at IS NULL) — la population du catalogue, pas le KPI is_active (écart possible si des élèves actifs-à-faux existent).`);
    if (f?.classId) steps.push(`Filtre classe : ${classMap.get(f.classId)?.name ?? f.classId}.`);
    if (f?.gradeLevel) steps.push(`Filtre niveau : ${f.gradeLevel}.`);
    steps.push(`Agrégation : COUNT = ${rows.length} élève(s).`);
    intermediates.push({ label: "Élèves", value: String(rows.length) });
  }

  // ---------------------------------------------------------------------
  // Attendance: presence records in window
  // ---------------------------------------------------------------------
  else if (request.domain === "attendance") {
    const mode = f?.attendanceMode ?? "records";
    definition =
      mode === "absences"
        ? "Nombre d'ABSENCES enregistrées sur la fenêtre (statut « absent » ou « absent_unexcused »)."
        : "Nombre d'ENREGISTREMENTS de présence sur la fenêtre (présents, retards et absences confondus).";
    for (const record of input.attendance) {
      const student = studentMap.get(record.studentId);
      if (!student || (range && (record.date < range.from || record.date > range.to))) continue;
      const isAbsence = record.status === "absent_excused" || record.status === "absent_unexcused";
      if (mode === "absences" && !isAbsence) continue;
      const parent = parentMap.get(student.parentId);
      rows.push({
        id: record.id,
        contributorKey: student.parentId,
        contributorName: displayName(parent),
        contributorCode: student.code,
        contributorPhone: parent?.phone ?? "—",
        studentName: studentLabel(student),
        className: student.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: 1,
        date: record.date,
        description: record.status,
        status: record.status,
        reference: record.id,
        method: record.session,
        lateDays: 0,
        amountKind: "unit-count",
        category: null,
        sourceTable: "attendance_records",
        sourceId: record.id,
        detail: `${record.status} · ${record.session ?? "séance"}`,
      });
    }
    steps.push(`Source : flux « attendance_records » sur la fenêtre ${windowLabel ?? "(tout)"}.`);
    steps.push(`Mode : ${mode === "absences" ? "ABSENCES seules (statut absent / absent_unexcused)" : "TOUS les enregistrements"}.`);
    steps.push(`Agrégation : COUNT = ${rows.length}.`);
    intermediates.push({ label: "Enregistrements", value: String(rows.length) });
  }

  // ---------------------------------------------------------------------
  // Academic risk: the canonical risk profiles (GPA < 10)
  // ---------------------------------------------------------------------
  else if (request.domain === "academic-risk") {
    definition =
      "Élèves dont la moyenne générale (GPA canonique — pondérée par coefficients, hors activités extrascolaires) est strictement inférieure à 10/20. Calcul identique à la console opérationnelle (evaluateStudentRiskProfiles → computeOverallGpa).";
    const profiles = input.riskProfiles ?? [];
    for (const profile of profiles) {
      if (profile.gpa === null || profile.gpa >= 10) continue;
      rows.push({
        id: profile.studentId,
        contributorKey: profile.parentId,
        contributorName: profile.parentName,
        contributorCode: profile.studentCode,
        contributorPhone: profile.parentPhone || "—",
        studentName: profile.studentName,
        className: profile.className,
        amount: 1,
        date: null,
        description: `Moyenne ${profile.gpa.toFixed(2)}/20`,
        status: "GPA < 10",
        reference: profile.studentCode,
        method: "Pédagogique",
        lateDays: 0,
        amountKind: "unit-count",
        category: null,
        sourceTable: "assessments",
        sourceId: profile.studentId,
        detail: `GPA ${profile.gpa.toFixed(2)}/20 · ${profile.primaryRiskReason}`,
      });
    }
    steps.push(`Source : profils de risque canoniques (evaluateStudentRiskProfiles) — le MÊME moteur que la console opérationnelle et les cartes executives (aucun second algorithme de moyenne).`);
    steps.push(`GPA : computeOverallGpa — moyenne des moyennes de matière pondérée par coefficient, activités extrascolaires exclues, moyennes nulles ignorées.`);
    steps.push(`Filtre : gpa ≠ null ET gpa < 10 → COUNT = ${rows.length} élève(s).`);
    intermediates.push({ label: "Élèves à risque", value: String(rows.length) });
    intermediates.push({ label: "Profils évalués", value: String(profiles.length) });
  }

  // ---------------------------------------------------------------------
  // Transport: transport installments with route attribution + AMOUNTS
  // ---------------------------------------------------------------------
  else if (request.domain === "transport") {
    const mode = f?.transportMode ?? "remaining";
    definition =
      mode === "due"
        ? "Montants TRANSPORT FACTURÉS par famille : Σ amountDue des échéances de transport, chaque montant attribué à sa ligne (destination normalisée de l'élève transporté)."
        : mode === "collected"
          ? "Montants TRANSPORT ENCAISSÉS par famille : Σ amountPaid (fonds clarifiés) des échéances de transport."
          : "RESTES DUS TRANSPORT par famille : Σ max(0, amountDue − amountPaid − amountPending) des échéances de transport (INV-4).";
    // Rider attribution — the deriveTransportYield pattern: a rider's
    // transport installments hang off their parent's account.
    const parentDestination = new Map<string, string>();
    for (const student of input.students) {
      if (student.status !== "active") continue;
      const dest = normalizeTransportTier(student.transportTier);
      if (dest === null) continue;
      if (!parentDestination.has(student.parentId)) {
        parentDestination.set(student.parentId, dest);
      }
    }
    const scoped = installmentsForAcademicYear(input.installments, input.academicYear);
    let sumDue = 0;
    let sumPaid = 0;
    for (const installment of scoped) {
      if (installment.category !== "transport") continue;
      if (installment.status === "paid" && mode === "remaining") continue;
      if (f?.transportDestination) {
        const dest = parentDestination.get(installment.parentId);
        if (dest !== f.transportDestination) continue;
      }
      const remaining = installmentRemaining(installment);
      const amount = mode === "due" ? installment.amountDue : mode === "collected" ? installment.amountPaid : remaining;
      if (amount <= 0) continue;
      sumDue += installment.amountDue;
      sumPaid += installment.amountPaid;
      const parent = parentMap.get(installment.parentId);
      const student = installment.studentId ? studentMap.get(installment.studentId) : undefined;
      const dest = parentDestination.get(installment.parentId);
      const overdueDays = Math.max(0, daysBetweenFloor(installment.dueDate, Date.now()));
      rows.push({
        id: installment.id,
        contributorKey: installment.parentId,
        contributorName: displayName(parent),
        contributorCode: parent?.code ?? installment.parentId,
        contributorPhone: parent?.phone ?? "—",
        studentName: studentLabel(student),
        className: student?.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount,
        date: mode === "collected" ? installment.paidDate : installment.dueDate,
        description: installment.label,
        status: PAYMENT_STATUS_LABELS_FR[installment.status as PaymentStatus] ?? installment.status,
        reference: installment.id,
        method: dest ?? "Destination inconnue",
        lateDays: installment.status === "overdue" ? overdueDays : 0,
        amountKind: mode === "due" ? "installment-due" : mode === "collected" ? "installment-collected" : "installment-remaining",
        category: "transport",
        sourceTable: "installments",
        sourceId: installment.id,
        detail: `Transport${dest ? ` — ${dest}` : " — ligne non résolue"} · ${installment.label} · reste ${fmt(remaining)} / dû ${fmt(installment.amountDue)}`,
      });
    }
    steps.push(`Source : échéances de TRANSPORT uniquement (installments.category = « transport »), fenêtre de facturation ${scopeLabel}.`);
    steps.push(`Attribution de ligne : destination normalisée de l'élève transporté rattaché au compte famille (normalizeTransportTier — alias de communes fusionnés).`);
    if (f?.transportDestination) steps.push(`Filtre ligne : ${f.transportDestination}.`);
    steps.push(`Mode : ${mode === "due" ? "FACTURÉ (amountDue)" : mode === "collected" ? "ENCAISSÉ (amountPaid)" : "RESTE DÛ (INV-4)"} · Σ dû = ${fmt(sumDue)} · Σ payé = ${fmt(sumPaid)} DZD.`);
    steps.push(`Agrégation : Σ sur ${rows.length} échéance(s) transport = ${fmt(rows.reduce((s, r) => s + r.amount, 0))} DZD.`);
    intermediates.push({ label: "Échéances transport", value: String(rows.length) });
    intermediates.push({ label: "Σ amountDue transport", value: `${fmt(sumDue)} DZD` });
    intermediates.push({ label: "Σ amountPaid transport", value: `${fmt(sumPaid)} DZD` });
  }

  // ---------------------------------------------------------------------
  // Discount: negotiated remises (ledger adjustment credits)
  // ---------------------------------------------------------------------
  else if (request.domain === "discount") {
    definition =
      "Somme des REMISES NÉGOCIÉES : ajustements CRÉDIT négatifs du grand livre (ledger_entries, type « adjustment ») identifiés par le contrat structurel metadata.field = « REMISE » (repli : description « Remise sur devis ») — le MÊME identification que la carte d'érosion des remises.";
    let sumRemise = 0;
    for (const entry of input.ledger) {
      if (!isRemiseAdjustment(entry)) continue;
      sumRemise += -entry.amount;
      const parent = parentMap.get(entry.parentId);
      const student = entry.studentId ? studentMap.get(entry.studentId) : undefined;
      rows.push({
        id: entry.id,
        contributorKey: entry.parentId,
        contributorName: displayName(parent),
        contributorCode: parent?.code ?? entry.parentId,
        contributorPhone: parent?.phone ?? "—",
        studentName: studentLabel(student),
        className: student?.classId ? classMap.get(student.classId)?.name ?? "—" : "—",
        amount: -entry.amount,
        date: entry.at,
        description: entry.description,
        status: "Remise",
        reference: entry.receiptNumber ?? entry.id,
        method: entry.actorName,
        lateDays: 0,
        amountKind: "adjustment-credit",
        category: entry.category,
        sourceTable: "ledger_entries",
        sourceId: entry.id,
        detail: `Remise ${fmt(-entry.amount)} DZD · ${PAYMENT_CATEGORY_LABELS_FR[entry.category]}${entry.studentId ? "" : " · portée famille"}`,
      });
    }
    steps.push(`Source : flux « ledger_entries » — écritures d'ajustement NÉGATIVES (crédits) uniquement.`);
    steps.push(`Identification (contrat live-vérifié) : metadata.field = « REMISE » OU description commençant par « Remise sur devis » — via isRemiseAdjustment (le prédicat partagé avec deriveDiscountErosion).`);
    steps.push(`Exclusions : les annulations « double_remise_cancel » (débits positifs) et les autres ajustements ne comptent PAS dans ce total brut.`);
    steps.push(`Agrégation : Σ |montant| sur ${rows.length} remise(s) = ${fmt(sumRemise)} DZD.`);
    intermediates.push({ label: "Remises", value: String(rows.length) });
    intermediates.push({ label: "Σ remises brutes", value: `${fmt(sumRemise)} DZD` });
  }

  // ---------------------------------------------------------------------
  // Grouping → contributors (rank-ordered; colors assigned by rank in UI)
  // ---------------------------------------------------------------------
  const resolvedValue = rows.reduce((sum, row) => sum + row.amount, 0);
  const grouped = new Map<string, LineageContributor>();
  for (const row of rows) {
    const existing = grouped.get(row.contributorKey);
    if (existing) {
      existing.amount += row.amount;
      existing.recordCount += 1;
      existing.latestDate = existing.latestDate && row.date
        ? new Date(existing.latestDate) > new Date(row.date) ? existing.latestDate : row.date
        : existing.latestDate ?? row.date;
      existing.lateDays = Math.max(existing.lateDays, row.lateDays);
    } else {
      grouped.set(row.contributorKey, {
        key: row.contributorKey,
        name: row.contributorName,
        code: row.contributorCode,
        phone: row.contributorPhone,
        amount: row.amount,
        percentage: 0,
        recordCount: 1,
        latestDate: row.date,
        lateDays: row.lateDays,
      });
    }
  }

  const contributors = [...grouped.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({
      ...item,
      percentage: resolvedValue > 0 ? (item.amount / resolvedValue) * 100 : 0,
    }));
  const topKeys = new Set(contributors.slice(0, 10).map((c) => c.key));
  const remainderAmount = contributors.filter((c) => !topKeys.has(c.key)).reduce((sum, c) => sum + c.amount, 0);
  const remainderCount = contributors.filter((c) => !topKeys.has(c.key)).length;

  const finalizedRecords: LineageRecord[] = rows
    .map((row) => ({
      ...row,
      percentage: resolvedValue > 0 ? (row.amount / resolvedValue) * 100 : 0,
      categoryLabel: row.category ? PAYMENT_CATEGORY_LABELS_FR[row.category] : "—",
    }))
    .sort((a, b) => b.amount - a.amount);

  const formula = steps.join("\n");
  const sourceCounts: Record<string, number> = {
    payments: input.payments.length,
    installments: input.installments.length,
    students: input.students.length,
    parents: input.parents.length,
    assessments: input.assessments.length,
    attendance: input.attendance.length,
    debtSummaries: input.debts.length,
    ledgerEntries: input.ledger.length,
  };

  return {
    request,
    records: finalizedRecords,
    contributors,
    remainderAmount,
    remainderCount,
    resolvedValue,
    difference: resolvedValue - request.sourceValue,
    formula,
    formulaSteps: steps,
    intermediates,
    definition,
    windowLabel,
    scopeLabel,
    generatedAt: new Date().toISOString(),
    sourceCounts,
  };
}
