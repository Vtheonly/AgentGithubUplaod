/**
 * Import payment-conflict preview — T-638 / FIN-115 / ADR-038.
 *
 * The dry-run half of the owner's mandate: BEFORE an ETAT workbook is
 * committed, project every payment row the commit WOULD write (through
 * the SAME shared derivations the commit uses — `etat-identity.ts`), run
 * the CANONICAL conflict engine (`domain/calc/payment/payment-conflict.ts`)
 * against the CURRENT registered books, and hand the UI a report that
 * separates:
 *
 *   - NEW payments                (no counterpart in the books)
 *   - EXISTING matches            (the idempotent re-import identity —
 *                                  same source cell, same amount: IMPORT-107
 *                                  will no-op them; expected, NOT a warning)
 *   - POTENTIAL DUPLICATES        (near-miss pairs a human must examine)
 *   - CONFLICTS                   (the same source cell with a changed amount)
 *   - PARTIAL/CORRECTION patterns (the obligation arithmetic)
 *   - INSUFFICIENT information    (rows that cannot be attributed)
 *   - OVERPAYMENTS                (single payments above their obligation)
 *   - TRANCHE-TOTAL changes       (the per-family current → projected
 *                                  situation the worker must review before
 *                                  committing)
 *
 * READ-ONLY: this analysis never writes, never mutates its inputs, and
 * never decides — every ambiguous class is presented for human review.
 */
import type { ImportRecord } from "./types";
import {
  buildEtatParentInput,
  buildEtatPaymentSpecs,
  buildEtatStudentInput,
  etatAcademicPeriodAnchors,
  etatRealScheduleFor,
  findEtatStudentInFamily,
  numOrZero,
  resolveEtatParentSnapshot,
} from "./etat-identity";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";
import type { Payment, Installment } from "../../../domain/model/payment";
import {
  detectOverpayments,
  detectPaymentConflicts,
  normalizeStudentNameKey,
  projectObligationTotals,
  DEFAULT_PAYMENT_CONFLICT_THRESHOLDS,
  type PaymentConflictClass,
  type PaymentConflictSubject,
  type PaymentConflictThresholds,
} from "../../../domain/calc/payment/payment-conflict";

/* ================================================================== */
/*  The report shape                                                   */
/* ================================================================== */

/** One review-relevant finding tied to its workbook row(s). */
export interface ImportPaymentFinding {
  /** Stable per analysis run: the engine's finding id or a row-level id. */
  readonly id: string;
  readonly class: PaymentConflictClass;
  /** The workbook row the finding is anchored to (1-based, as displayed). */
  readonly rowIndex: number | null;
  /** FR: the family label (the matched parent's display name or the row's). */
  readonly parentLabel: string;
  /** FR: the student label (the workbook NOM). */
  readonly studentLabel: string | null;
  /** FR: the rule that produced this class. */
  readonly reason: string;
  readonly matchingEvidence: readonly string[];
  readonly differingEvidence: readonly string[];
  readonly missingEvidence: readonly string[];
  /** The amounts at stake, for the preview's before/after display. */
  readonly incomingAmount: number | null;
  readonly existingAmount: number | null;
  readonly requiresReview: boolean;
}

/** One obligation group's current → incoming → projected situation. */
export interface ImportFamilyProjectionRow {
  readonly parentLabel: string;
  readonly studentLabel: string | null;
  /** The raw category (the UI renders FR via paymentCategoryLabelFr). */
  readonly category: string | null;
  readonly currentPaid: number;
  readonly incoming: number;
  readonly projectedPaid: number;
  readonly expectedTotal: number | null;
  readonly overpaid: boolean;
}

export interface ImportPaymentConflictSummary {
  readonly rows: number;
  readonly projectedPayments: number;
  readonly newPayments: number;
  readonly existingMatches: number;
  readonly potentialDuplicates: number;
  readonly conflicts: number;
  readonly partialOrCorrections: number;
  readonly insufficientInfo: number;
  readonly overpayments: number;
  readonly trancheChanges: number;
  readonly requiresReview: number;
}

export interface ImportPaymentConflictReport {
  readonly sourceFile: string;
  readonly summary: ImportPaymentConflictSummary;
  /** True when EVERY projected payment already exists identically and no
   *  finding requires review — the documented idempotent re-import. */
  readonly pureReimport: boolean;
  readonly findings: readonly ImportPaymentFinding[];
  /** Per-family obligation projections, families with findings FIRST. */
  readonly families: readonly ImportFamilyProjectionRow[];
}

/* ================================================================== */
/*  The analysis                                                       */
/* ================================================================== */

export interface AnalyzeImportPaymentConflictsParams {
  /** The dry-run's coerced ETAT rows with their 1-based row indexes. */
  readonly records: ReadonlyArray<{ record: ImportRecord; rowIndex: number }>;
  /** The CURRENT parents snapshot (repos.parents.search("")). */
  readonly parents: readonly Parent[];
  /** The CURRENT students snapshot. */
  readonly students: readonly Student[];
  /** The CURRENT registered payments (all origins). */
  readonly existingPayments: readonly Payment[];
  /** The CURRENT installments (the expected-obligation source). */
  readonly installments: readonly Installment[];
  /** The workbook's file name (provenance display). */
  readonly sourceFile: string;
  readonly thresholds?: PaymentConflictThresholds;
  /** Injected clock for the period anchors (default: the real clock). */
  readonly now?: Date;
}

interface RowProjection {
  readonly rowIndex: number;
  readonly record: ImportRecord;
  readonly parent: Parent | null;
  readonly student: Student | null;
  readonly parentLabel: string;
  readonly studentLabel: string | null;
  readonly studentNameKey: string | null;
  readonly subjects: PaymentConflictSubject[];
}

/**
 * Run the full import conflict analysis. PURE: snapshots in, report out.
 */
export function analyzeImportPaymentConflicts(
  params: AnalyzeImportPaymentConflictsParams,
): ImportPaymentConflictReport {
  const thresholds = params.thresholds ?? DEFAULT_PAYMENT_CONFLICT_THRESHOLDS;
  const now = params.now ?? new Date();
  const anchors = etatAcademicPeriodAnchors(now);
  const anchorTs: readonly [string, string, string] = [
    `${anchors[0]}T00:00:00.000Z`,
    `${anchors[1]}T00:00:00.000Z`,
    `${anchors[2]}T00:00:00.000Z`,
  ];

  const studentsByParent = new Map<string, Student[]>();
  for (const s of params.students) {
    const list = studentsByParent.get(s.parentId) ?? [];
    list.push(s);
    studentsByParent.set(s.parentId, list);
  }
  const studentById = new Map(params.students.map((s) => [s.id, s] as const));

  // ── Project every row into payment subjects ────────────────────────
  const projections: RowProjection[] = [];
  for (const { record, rowIndex } of params.records) {
    const parentInput = buildEtatParentInput(record);
    const parent = resolveEtatParentSnapshot(parentInput, params.parents);
    const studentInput = buildEtatStudentInput(record);
    const student = parent
      ? findEtatStudentInFamily(studentsByParent.get(parent.id) ?? [], studentInput)
      : null;
    const studentLabel =
      (record.nom as string | undefined)?.trim() || studentInput.displayName || null;
    const studentNameKey = normalizeStudentNameKey(studentLabel);

    // The SAME pricing derivation the commit path uses.
    const { fi: fiExpected, tuitionTranches, transport: transportSchedule, destination } =
      etatRealScheduleFor(record);
    const remise = numOrZero(record.remise);
    const expectedTuitionTranches: [number, number, number] = [
      Math.max(0, tuitionTranches[0] - remise),
      tuitionTranches[1],
      tuitionTranches[2],
    ];
    const expectedTransportTranches: [number, number, number] = [
      transportSchedule[1],
      transportSchedule[2],
      transportSchedule[3],
    ];
    const specs = buildEtatPaymentSpecs(record, {
      fiExpected,
      expectedTuitionTranches,
      expectedTransportTranches,
      destination,
    });

    const subjects: PaymentConflictSubject[] = [];
    for (const spec of specs) {
      if (spec.amount <= 0) continue;
      // The source-cell identity: only meaningful when the row resolves to
      // an EXISTING student (the commit will reuse that student's id, so
      // the IMP- receipt is predictable). New students mint new ids — no
      // source identity to conflict with.
      const sourceKey = student ? `IMP-${student.id}-${spec.field}` : null;
      subjects.push({
        key: `imp-row${rowIndex}-${spec.field}`,
        origin: "import",
        parentId: parent ? parent.id : null,
        studentId: student ? student.id : null,
        studentNameKey,
        amount: spec.amount,
        // The recorded-period anchor is the honest projected date; fields
        // with no period will carry the FUTURE run clock — unknowable at
        // preview time, so honestly null (missing information).
        collectedAt: spec.period !== null ? anchorTs[spec.period] : null,
        category: spec.category,
        installmentId: null,
        academicYearId: null,
        method: "cash",
        status: "paid",
        receiptNumber: null,
        sourceKey,
        description: spec.description,
        expectedAmount: spec.expectedAmount > 0 ? spec.expectedAmount : null,
        label: spec.description,
      });
    }
    projections.push({
      rowIndex,
      record,
      parent,
      student,
      parentLabel: parent
        ? parent.displayName ?? `${parent.firstName} ${parent.lastName}`.trim()
        : parentInput.displayName ?? `Famille ${parentInput.lastName}`,
      studentLabel,
      studentNameKey,
      subjects,
    });
  }

  // ── The existing books as engine subjects ──────────────────────────
  const existingSubjects: PaymentConflictSubject[] = params.existingPayments.map((p) => ({
    key: `pay-${p.id}`,
    origin: "application" as const,
    parentId: p.parentId,
    studentId: p.studentId,
    studentNameKey: p.studentId
      ? normalizeStudentNameKey(studentById.get(p.studentId)?.displayName ?? null)
      : null,
    amount: p.amount,
    collectedAt: p.collectedAt,
    category: p.category,
    installmentId: p.installmentId,
    academicYearId: p.academicYearId ?? null,
    method: p.method,
    status: p.status,
    receiptNumber: p.receiptNumber,
    sourceKey: /^IMP-/.test(p.receiptNumber) ? p.receiptNumber : null,
    description: p.notes,
    expectedAmount: p.expectedAmount ?? null,
    label: p.receiptNumber,
  }));

  const incomingSubjects = projections.flatMap((p) => p.subjects);

  // ── The pair analysis (cross pairs + same-workbook internal pairs) ─
  const pairFindings = detectPaymentConflicts([...existingSubjects, ...incomingSubjects], {
    pairScope: "incoming-vs-any",
    thresholds,
  });

  const findings: ImportPaymentFinding[] = [];
  const existingMatchKeys = new Set<string>();
  const implicatedIncoming = new Set<string>();
  const rowBySubjectKey = new Map<string, RowProjection>();
  for (const p of projections) {
    for (const s of p.subjects) rowBySubjectKey.set(s.key, p);
  }
  const existingAmountBySubjectKey = new Map(existingSubjects.map((s) => [s.key, s.amount] as const));

  for (const cf of pairFindings) {
    const incomingSide = cf.comparison.a.origin === "import" ? cf.comparison.a : cf.comparison.b;
    const otherSide = incomingSide === cf.comparison.a ? cf.comparison.b : cf.comparison.a;
    if (incomingSide.origin !== "import") continue; // existing-vs-existing: the auditor's lane
    const row = rowBySubjectKey.get(incomingSide.key) ?? null;

    // The BENIGN identity: an EXISTING payment with the same source cell
    // and the same amount → the documented idempotent re-import
    // (IMPORT-107 will no-op it). Counted, never a review finding.
    // (Two INCOMING rows sharing a source cell are NOT this case — they
    // are an in-workbook duplicate and stay a finding.)
    const sourceKeyMatch =
      incomingSide.sourceKey !== null &&
      otherSide.sourceKey !== null &&
      incomingSide.sourceKey === otherSide.sourceKey;
    const amountMatch =
      cf.comparison.attributes.find((x) => x.attribute === "amount")?.verdict === "match";
    if (
      cf.class === "confirmed_duplicate" &&
      otherSide.origin === "application" &&
      sourceKeyMatch &&
      amountMatch
    ) {
      existingMatchKeys.add(incomingSide.key);
      continue;
    }

    if (cf.class === "distinct") continue; // resolved by evidence — no review needed

    implicatedIncoming.add(incomingSide.key);
    findings.push({
      id: cf.id,
      class: cf.class,
      rowIndex: row ? row.rowIndex : null,
      parentLabel: row ? row.parentLabel : incomingSide.parentId ?? "—",
      studentLabel: row ? row.studentLabel : null,
      reason: cf.reason,
      matchingEvidence: cf.matchingEvidence,
      differingEvidence: cf.differingEvidence,
      missingEvidence: cf.missingEvidence,
      incomingAmount: incomingSide.amount,
      existingAmount: existingAmountBySubjectKey.get(otherSide.key) ?? null,
      requiresReview: cf.requiresReview,
    });
  }

  // ── Record-level attribution gaps ──────────────────────────────────
  for (const p of projections) {
    if (p.subjects.length === 0) continue;
    if (p.parent !== null && p.student === null) {
      // The family resolved but the CHILD did not — the payments cannot be
      // attributed to a specific obligation without the worker's eye.
      const familyStudentCount = (studentsByParent.get(p.parent.id) ?? []).length;
      if (familyStudentCount > 0) {
        findings.push({
          id: `conflict:insufficient_information:row${p.rowIndex}:unattributed`,
          class: "insufficient_information",
          rowIndex: p.rowIndex,
          parentLabel: p.parentLabel,
          studentLabel: p.studentLabel,
          reason:
            `La ligne correspond à une famille connue (${p.parentLabel}) mais à aucun de ses ` +
            `${familyStudentCount} élève(s) enregistré(s) — les paiements projetés ne peuvent pas ` +
            `être rattachés avec certitude à l'obligation d'un élève précis. La comparaison ` +
            `utilise le nom (« ${p.studentLabel ?? "?"} ») ; vérifiez l'identité avant d'importer.`,
          matchingEvidence: [],
          differingEvidence: [],
          missingEvidence: ["Élève non rattaché à cette famille"],
          incomingAmount: p.subjects.reduce((s2, x) => s2 + x.amount, 0),
          existingAmount: null,
          requiresReview: true,
        });
      }
    }
  }

  // ── Single-record overpayments (incoming only — existing are the
  //    auditor's lanes) ────────────────────────────────────────────────
  for (const op of detectOverpayments(incomingSubjects, thresholds.amountToleranceDzd)) {
    const row = rowBySubjectKey.get(op.subject.key) ?? null;
    findings.push({
      id: `conflict:tranche_balance_discrepancy:${op.subject.key}:overpayment`,
      class: "tranche_balance_discrepancy",
      rowIndex: row ? row.rowIndex : null,
      parentLabel: row ? row.parentLabel : op.subject.parentId ?? "—",
      studentLabel: row ? row.studentLabel : null,
      reason: op.reason,
      matchingEvidence: [],
      differingEvidence: [],
      missingEvidence: [],
      incomingAmount: op.subject.amount,
      existingAmount: op.subject.expectedAmount,
      requiresReview: true,
    });
  }

  // ── The obligation projection (current → incoming → projected) ─────
  const expectedTotals = new Map<string, number>();
  for (const inst of params.installments) {
    const key = `${inst.parentId}|${inst.studentId ?? ""}|${inst.category}`;
    expectedTotals.set(key, (expectedTotals.get(key) ?? 0) + inst.amountDue);
  }
  const obligationRows = projectObligationTotals(
    existingSubjects,
    incomingSubjects,
    expectedTotals,
    { amountToleranceDzd: thresholds.amountToleranceDzd },
  );

  const labelFor = (row: { parentId: string | null; studentId: string | null }): {
    parentLabel: string;
    studentLabel: string | null;
  } => {
    const parent = row.parentId ? params.parents.find((p2) => p2.id === row.parentId) : undefined;
    const student = row.studentId ? studentById.get(row.studentId) : undefined;
    return {
      parentLabel: parent
        ? parent.displayName ?? `${parent.firstName} ${parent.lastName}`.trim()
        : row.parentId ?? "—",
      studentLabel: student ? student.displayName ?? `${student.firstName} ${student.lastName}` : null,
    };
  };
  const familyRows: ImportFamilyProjectionRow[] = obligationRows.map((r) => {
    const { parentLabel, studentLabel } = labelFor(r);
    return {
      parentLabel,
      studentLabel,
      category: r.category,
      currentPaid: r.currentPaid,
      incoming: r.incoming,
      projectedPaid: r.projectedPaid,
      expectedTotal: r.expectedTotal,
      overpaid: r.overpaid,
    };
  });
  const parentLabelsWithFindings = new Set(findings.map((f) => f.parentLabel));
  familyRows.sort((a, b) => {
    const fa = parentLabelsWithFindings.has(a.parentLabel) ? 0 : 1;
    const fb = parentLabelsWithFindings.has(b.parentLabel) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.parentLabel < b.parentLabel ? -1 : a.parentLabel > b.parentLabel ? 1 : 0;
  });

  // Deterministic severity ordering for the review surface: the identity
  // conflicts first, then the duplicate ladder, then the obligation
  // patterns, the gaps, the overpayments — stable within each rank by id.
  const severityRank: Readonly<Record<PaymentConflictClass, number>> = {
    conflicting_information: 0,
    confirmed_duplicate: 1,
    high_confidence_duplicate: 2,
    possible_duplicate: 3,
    possible_correction: 4,
    possible_partial_split: 5,
    insufficient_information: 6,
    tranche_balance_discrepancy: 7,
    distinct: 8,
  };
  findings.sort((a, b) => {
    const ra = severityRank[a.class];
    const rb = severityRank[b.class];
    if (ra !== rb) return ra - rb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // ── The summary ────────────────────────────────────────────────────
  const countClass = (cls: PaymentConflictClass) =>
    findings.filter((f) => f.class === cls).length;
  const potentialDuplicates =
    countClass("confirmed_duplicate") +
    countClass("high_confidence_duplicate") +
    countClass("possible_duplicate");
  const partialOrCorrections =
    countClass("possible_partial_split") + countClass("possible_correction");
  const conflicts = countClass("conflicting_information");
  const insufficientInfo = countClass("insufficient_information");
  const overpayments = countClass("tranche_balance_discrepancy");
  const trancheChanges = obligationRows.filter((r) => r.changesTotal).length;
  const requiresReview = findings.filter((f) => f.requiresReview).length;
  const existingMatches = existingMatchKeys.size;
  const newPayments =
    incomingSubjects.length -
    existingMatches -
    implicatedIncoming.size;

  return {
    sourceFile: params.sourceFile,
    summary: {
      rows: params.records.length,
      projectedPayments: incomingSubjects.length,
      newPayments: Math.max(0, newPayments),
      existingMatches,
      potentialDuplicates,
      conflicts,
      partialOrCorrections,
      insufficientInfo,
      overpayments,
      trancheChanges,
      requiresReview,
    },
    pureReimport:
      incomingSubjects.length > 0 &&
      existingMatches === incomingSubjects.length &&
      findings.length === 0,
    findings,
    families: familyRows,
  };
}

/* ================================================================== */
/*  The commit gate                                                    */
/* ================================================================== */

/**
 * The T-638 commit gate: when the dry-run analysis found ANY financial
 * finding requiring review, the import may only proceed after the worker
 * explicitly acknowledges having examined the findings. No findings (or no
 * analysis — the honest-degradation path) → the gate is open and the
 * button behaves exactly as before. PURE — tested independently of the UI.
 */
export function importCommitGate(
  report: ImportPaymentConflictReport | null,
  rowsRead: number,
  acknowledged: boolean,
): { readonly canCommit: boolean; readonly reason: string | null } {
  if (rowsRead <= 0) {
    return { canCommit: false, reason: "Aucune ligne à importer." };
  }
  if (report !== null && report.summary.requiresReview > 0 && !acknowledged) {
    return {
      canCommit: false,
      reason:
        `${report.summary.requiresReview} avertissement(s) financier(s) à examiner ` +
        `avant l'import (case à cocher de confirmation).`,
    };
  }
  return { canCommit: true, reason: null };
}
